"""Independent Mesh trace protocol oracle. All state is disposable and offline."""
import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from mesh_trace import MeshTraceError, RoundTraceStore, make_binding


def canonical_bytes(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False,
                      allow_nan=False).encode("utf-8")


def expected_binding(ticket="ticket_A", epoch=1, base="a" * 40, candidate="b" * 40, spec="c" * 64):
    identity = {"ticket_id": ticket, "epoch": epoch, "base_commit": base,
                "candidate_commit": candidate, "spec_sha256": spec}
    return {**identity, "scope": hashlib.sha256(canonical_bytes(identity)).hexdigest()}


def trace_id(binding, round_number, peer, ordinal=0):
    identity = {"scope": binding["scope"], "round": round_number, "peer_id": peer, "ordinal": ordinal}
    return hashlib.sha256(canonical_bytes(identity)).hexdigest()


def reply(input_value, *, kind="claim", payload=None, response_to=None, supersedes=None):
    return {"protocol": "argo.mesh/1", "binding": copy.deepcopy(input_value["binding"]),
            "peer_id": input_value["peer_id"], "round": input_value["round"],
            "seen_version": input_value["seen_version"],
            "traces": [{"type": kind, "payload": payload or {"message": "independent finding"},
                        "response_to": response_to, "supersedes": supersedes}]}


class MeshTraceTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="argo-mesh-trace-oracle-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.binding = expected_binding()
        self.peers = ("peer_a", "peer_b", "peer_c")
        self.now = 100.0
        self.number = 0

    def store(self, **kwargs):
        self.number += 1
        path = self.root / f"trace-{self.number}.jsonl"
        options = {"rounds": 2, "max_writes": 24, "lifetime": 10, "clock": lambda: self.now}
        options.update(kwargs)
        return RoundTraceStore(path, self.binding, self.peers, **options), path

    def inputs(self, store):
        return [store.peer_input(peer) for peer in self.peers]

    def first_round(self, store):
        responses = [reply(value) for value in self.inputs(store)]
        return store.commit_round(responses)

    def assert_atomic_refusal(self, store, path, responses):
        before = path.read_bytes()
        with self.assertRaises(MeshTraceError):
            store.commit_round(responses)
        self.assertEqual(path.read_bytes(), before, "invalid round changed the durable audit")

    def test_binding_and_trace_ids_use_the_exact_public_canonical_codec(self):
        self.assertEqual(make_binding("ticket_A", 1, "a" * 40, "b" * 40, "c" * 64), self.binding)
        variants = [("ticket_B", 1, "a" * 40, "b" * 40, "c" * 64),
                    ("ticket_A", 2, "a" * 40, "b" * 40, "c" * 64),
                    ("ticket_A", 1, "d" * 40, "b" * 40, "c" * 64),
                    ("ticket_A", 1, "a" * 40, "d" * 40, "c" * 64),
                    ("ticket_A", 1, "a" * 40, "b" * 40, "d" * 64)]
        for args in variants:
            self.assertNotEqual(make_binding(*args)["scope"], self.binding["scope"])
        store, path = self.store()
        rows = store.commit_round([reply(value, payload={"message": "étude"}) for value in self.inputs(store)])
        self.assertEqual({row["id"] for row in rows}, {trace_id(self.binding, 1, p) for p in self.peers})
        for row in rows:
            self.assertEqual(set(row), {"id", "scope", "round", "peer_id", "ordinal", "type", "payload", "response_to", "supersedes"})
            self.assertEqual(row["ordinal"], 0)
        record = json.loads(path.read_bytes().splitlines()[0])
        self.assertEqual(set(record), {"kind", "protocol", "binding", "round", "version", "peer_ids", "traces"})
        self.assertEqual(record["kind"], "round")
        self.assertEqual(record["version"], 1)
        self.assertEqual(record["binding"], self.binding)
        self.assertEqual(record["traces"], rows)

    def test_three_peers_read_complete_prior_round_and_dissent_survives_completion(self):
        store, path = self.store()
        inputs = self.inputs(store)
        self.assertTrue(all(value["round"] == 1 and value["seen_version"] == 0 and value["traces"] == [] for value in inputs))
        responses = [reply(value, kind="danger" if value["peer_id"] == "peer_c" else "claim",
                           payload={"message": "unresolved dissent" if value["peer_id"] == "peer_c" else "proposal"}) for value in inputs]
        first = store.commit_round(list(reversed(responses)))
        self.assertEqual(len(first), 3)
        second_inputs = self.inputs(store)
        for value in second_inputs:
            self.assertEqual(value["round"], 2)
            self.assertEqual(value["seen_version"], 1)
            self.assertEqual(value["traces"], first)
        second = [reply(value, kind="result", payload={"message": "agreement remains disputed"},
                        response_to=trace_id(self.binding, 1, "peer_c"),
                        supersedes=trace_id(self.binding, 1, value["peer_id"])) for value in second_inputs]
        store.commit_round(second)
        with self.assertRaises(MeshTraceError):
            store.peer_input("peer_a")
        with self.assertRaises(MeshTraceError):
            store.parent_read()
        store.close("completed")
        parent = store.parent_read()
        self.assertEqual(set(parent), {"protocol", "binding", "status", "version", "peer_ids", "traces", "rounds", "max_trace_writes"})
        self.assertEqual(parent["status"], "completed")
        self.assertEqual(parent["version"], 2)
        self.assertEqual(len(parent["traces"]), 6)
        self.assertTrue(any(t["type"] == "danger" and t["payload"]["message"] == "unresolved dissent" for t in parent["traces"]))
        self.assertEqual(store.digest(), hashlib.sha256(path.read_bytes()).hexdigest())
        records = [json.loads(line) for line in path.read_bytes().splitlines()]
        self.assertEqual([record["kind"] for record in records], ["round", "round", "close"])
        self.assertEqual(records[-1], {"kind": "close", "protocol": "argo.mesh/1", "binding": self.binding, "status": "completed", "version": 2})

    def test_parent_embargo_close_fences_work_and_repeated_close_is_idempotent(self):
        store, path = self.store()
        with self.assertRaises(MeshTraceError):
            store.parent_read()
        store.close("failed")
        before = path.read_bytes()
        store.close("failed")
        self.assertEqual(path.read_bytes(), before)
        self.assertEqual(store.parent_read()["status"], "failed")
        for action in [lambda: store.peer_input("peer_a"), lambda: store.commit_round([]), lambda: store.close("completed")]:
            with self.assertRaises(MeshTraceError):
                action()
        self.assertEqual(path.read_bytes(), before)

    def test_premature_completion_closes_failed_and_invalid_terminal_enum_does_not_close(self):
        store, path = self.store()
        before = path.read_bytes()
        with self.assertRaises(MeshTraceError):
            store.close("approved")
        self.assertEqual(path.read_bytes(), before)
        self.assertEqual(store.peer_input("peer_a")["round"], 1)
        with self.assertRaises(MeshTraceError):
            store.close("completed")
        self.assertEqual(store.parent_read()["status"], "failed")
        with self.assertRaises(MeshTraceError):
            store.peer_input("peer_a")

    def test_outputs_are_detached_and_peer_input_must_precede_each_commit(self):
        store, path = self.store()
        fabricated = {"protocol": "argo.mesh/1", "binding": self.binding, "peer_id": "peer_c", "round": 1, "seen_version": 0}
        responses = [reply(store.peer_input("peer_a")), reply(store.peer_input("peer_b")), reply(fabricated)]
        self.assert_atomic_refusal(store, path, responses)
        store.peer_input("peer_c")
        store.commit_round(responses)
        view = store.peer_input("peer_a")
        view["binding"]["ticket_id"] = "forged"
        view["traces"][0]["payload"]["message"] = "tampered"
        fresh = store.peer_input("peer_a")
        self.assertEqual(fresh["binding"], self.binding)
        self.assertNotEqual(fresh["traces"][0]["payload"]["message"], "tampered")
        store.close("cancelled")
        parent = store.parent_read()
        parent["traces"].clear()
        self.assertEqual(len(store.parent_read()["traces"]), 3)

    def test_wrong_binding_round_watermark_peer_and_duplicate_peer_are_atomic_refusals(self):
        mutations = [
            lambda rows: rows[0]["binding"].update(candidate_commit="f" * 40),
            lambda rows: rows[0]["binding"].update(scope="f" * 64),
            lambda rows: rows[0].update(round=2),
            lambda rows: rows[0].update(seen_version=1),
            lambda rows: rows[0].update(peer_id="outsider"),
            lambda rows: rows.__setitem__(1, copy.deepcopy(rows[0])),
            lambda rows: rows[0].update(extra="not allowed"),
            lambda rows: rows[0]["traces"][0].update(approval=True),
        ]
        for mutate in mutations:
            store, path = self.store()
            rows = [reply(value) for value in self.inputs(store)]
            mutate(rows)
            self.assert_atomic_refusal(store, path, rows)
        store, path = self.store()
        first_inputs = self.inputs(store)
        store.commit_round([reply(value) for value in first_inputs])
        self.inputs(store)
        self.assert_atomic_refusal(store, path, [reply(value) for value in first_inputs])

    def test_unknown_foreign_same_round_and_other_peer_supersession_refs_are_refused(self):
        store, path = self.store()
        rows = [reply(value) for value in self.inputs(store)]
        rows[0]["traces"][0]["response_to"] = trace_id(self.binding, 1, "peer_b")
        self.assert_atomic_refusal(store, path, rows)
        first = self.first_round(store)
        self.assertEqual(len(first), 3)
        for reference, field in [("f" * 64, "response_to"),
                                 (trace_id(expected_binding(ticket="other"), 1, "peer_a"), "response_to"),
                                 (trace_id(self.binding, 1, "peer_b"), "supersedes")]:
            rows = [reply(value) for value in self.inputs(store)]
            rows[0]["traces"][0][field] = reference
            self.assert_atomic_refusal(store, path, rows)

    def test_trace_budget_and_peer_trace_count_have_no_partial_round_writes(self):
        store, path = self.store(max_writes=6)
        self.first_round(store)
        rows = [reply(value) for value in self.inputs(store)]
        rows[2]["traces"].append(copy.deepcopy(rows[2]["traces"][0]))
        self.assert_atomic_refusal(store, path, rows)
        for count in [0, 5]:
            rows = [reply(value) for value in self.inputs(store)]
            rows[0]["traces"] = rows[0]["traces"] * count
            self.assert_atomic_refusal(store, path, rows)
        store.commit_round([reply(value) for value in self.inputs(store)])
        store.close("completed")
        self.assertEqual(len(store.parent_read()["traces"]), 6)

    def test_payload_bounds_and_structured_state_change_are_refused_but_text_is_inert(self):
        deep = 1
        for _ in range(12):
            deep = {"nested": deep}
        bad_payloads = [{}, [], {"x": float("nan")}, {"x": 1.5}, {"x": 2 ** 53},
                        {"x": "é" * 2049}, {"x": "x" * 4097}, {"x": [0] * 257},
                        {"x": [[0] * 256 for _ in range(4)]}, {"x": deep},
                        {"__proto__": 1}, {"constructor": 1}, {"x": {"prototype": 1}},
                        {"state_change": {}}, {"x": [{"state_change": {"status": "MERGED"}}]}]
        for payload in bad_payloads:
            store, path = self.store()
            rows = [reply(value) for value in self.inputs(store)]
            rows[0]["traces"][0]["payload"] = payload
            self.assert_atomic_refusal(store, path, rows)
        store, path = self.store()
        rows = [reply(value, kind="info", payload={"message": "state_change is advisory text; approved does not merge", "approved": True}) for value in self.inputs(store)]
        store.commit_round(rows)
        store.close("failed")
        self.assertEqual(len(store.parent_read()["traces"]), 3)

    def test_ttl_uses_injected_clock_and_expiry_refuses_round_without_partial_writes(self):
        store, path = self.store(lifetime=3)
        rows = [reply(value) for value in self.inputs(store)]
        self.now = 102.999
        store.peer_input("peer_a")
        self.now = 103.0
        with self.assertRaises(MeshTraceError):
            store.peer_input("peer_b")
        self.assert_atomic_refusal(store, path, rows)
        store.close("failed")
        self.assertEqual(store.parent_read()["status"], "failed")

    def test_constructor_exclusively_creates_audit_and_refuses_existing_file_or_symlink(self):
        store, path = self.store()
        before = path.read_bytes()
        with self.assertRaises((MeshTraceError, FileExistsError)):
            RoundTraceStore(path, self.binding, self.peers)
        self.assertEqual(path.read_bytes(), before)
        victim = self.root / "victim"
        victim.write_text("must remain unchanged")
        link = self.root / "linked.jsonl"
        link.symlink_to(victim)
        with self.assertRaises((MeshTraceError, FileExistsError, OSError)):
            RoundTraceStore(link, self.binding, self.peers)
        self.assertEqual(victim.read_text(), "must remain unchanged")

    def test_peer_identity_grammar_and_reserved_supervisor_name_are_enforced(self):
        for peer in ["", "1peer", "_peer", "épeer", "peer/escape", "a" * 65, "mesh-supervisor"]:
            with self.subTest(peer=peer), self.assertRaises(MeshTraceError):
                RoundTraceStore(self.root / ("bad-" + str(self.number) + ".jsonl"), self.binding,
                                (peer, "peer_b", "peer_c"))
            self.number += 1
        for peers in [("peer_a", "peer_a", "peer_c"), ("peer_a", "peer_b")]:
            with self.subTest(peers=peers), self.assertRaises(MeshTraceError):
                RoundTraceStore(self.root / ("bad-" + str(self.number) + ".jsonl"), self.binding, peers)
            self.number += 1
        store, _ = self.store()
        with self.assertRaises(MeshTraceError):
            store.peer_input("outsider")


if __name__ == "__main__":
    unittest.main()
