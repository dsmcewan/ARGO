"""Independent real Board/Git/Bubblewrap Mesh oracle; no vendor clients or paid calls."""
import asyncio
from dataclasses import FrozenInstanceError
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
import uuid

from board import Board, BoardError
from dispatch import DispatchError, run_bounded
from mesh_dispatch import MeshConfig, MeshDispatcher, Peer


PEER_IDS = ("peer_a", "peer_b", "peer_c")


def canonical_bytes(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False,
                      allow_nan=False).encode("utf-8")


def git(repo, *args, binary=False):
    result = subprocess.run(["/usr/bin/git", "--no-replace-objects", "-C", str(repo),
                             "-c", "core.hooksPath=/dev/null", *args], check=True,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=15,
                            env={"PATH": "/usr/bin:/bin", "HOME": str(repo),
                                 "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": "/dev/null"})
    return result.stdout if binary else result.stdout.decode().strip()


AUTHOR = r'''
import json, os, subprocess, sys, time
from pathlib import Path
task = json.loads(Path(os.environ['ARGO_TASK']).read_text())
assert 'lease_token' not in task
mode = sys.argv[1] if len(sys.argv) > 1 else 'normal'
tag = sys.argv[2] if len(sys.argv) > 2 else 'unused-tag'
directory = Path('/workspace') / task['owned_paths'][0].rstrip('/')
directory.mkdir(parents=True, exist_ok=True)
if mode == 'fail_a' and task['id'] == 'A':
    raise SystemExit(7)
if mode == 'barrier':
    (directory / 'started.marker').write_text('actual author is running')
    end = time.monotonic() + 12
    while not Path('/inputs/release').exists():
        if time.monotonic() >= end:
            raise RuntimeError('host did not release author barrier')
        time.sleep(0.01)
    (directory / 'started.marker').unlink()
if mode == 'hold':
    subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)', tag])
    (directory / 'started.marker').write_text('actual parent and child are running')
    time.sleep(60)
value = {'ticket': task['id'], 'value': 'complete offline output'}
(directory / 'value.json').write_text(json.dumps(value, sort_keys=True) + '\n')
'''


PEER = r'''
import hashlib, json, os, stat, subprocess, sys, time
from pathlib import Path
mode = sys.argv[1]
tag = sys.argv[2] if len(sys.argv) > 2 else 'unused-peer-tag'
mesh = json.loads(Path('/inputs/mesh.json').read_text())
task = json.loads(Path('/inputs/task.json').read_text())
assert mesh['protocol'] == 'argo.mesh/1'
assert mesh['peer_id'] in ('peer_a', 'peer_b', 'peer_c')
assert mesh['binding']['ticket_id'] == task['id']
assert 'lease_token' not in task and 'ARGO_TEST_SECRET' not in os.environ
assert os.readlink('/proc/self/ns/net') != HOST_NETWORK
assert not Path(HOST_SECRET).exists()
assert not Path('/workspace/.board/board.db').exists()
assert not Path('/workspace/.git').is_dir()
if Path('/workspace/.git').exists():
    assert Path('/workspace/.git').read_bytes() == b''
assert Path('/workspace/hidden.txt').read_bytes() == b'raw exported-ignore bytes\n'
assert Path('/workspace/stamp.txt').read_bytes() == b'$Format:%H$\n'
assert Path('/workspace/alias.txt').read_bytes() == b'raw exported-ignore bytes\n'
assert stat.S_IMODE(Path('/workspace/probe.sh').stat().st_mode) & 0o111
directory = Path('/workspace') / task['owned_paths'][0].rstrip('/')
artifact = directory / 'value.json'
data = artifact.read_bytes()
assert json.loads(data) == {'ticket': task['id'], 'value': 'complete offline output'}
for target in [artifact, Path('/workspace/spec.md'), Path('/inputs/mesh.json'), Path('/inputs/spec')]:
    try:
        with target.open('ab') as stream:
            stream.write(b'forbidden')
    except OSError:
        pass
    else:
        raise AssertionError('peer could write ' + str(target))
assert mesh['round'] >= 1
if mesh['round'] == 1:
    assert mesh['seen_version'] == 0 and mesh['traces'] == []
else:
    assert mesh['seen_version'] == mesh['round'] - 1
    assert len(mesh['traces']) == 3 * (mesh['round'] - 1)
    assert {t['peer_id'] for t in mesh['traces']} == {'peer_a', 'peer_b', 'peer_c'}
if mode == 'hold':
    subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)', tag])
    time.sleep(60)
kind = 'danger' if mesh['peer_id'] == 'peer_c' and mesh['round'] == 1 else 'result'
prior = mesh['traces']
own = next((t['id'] for t in reversed(prior) if t['peer_id'] == mesh['peer_id']), None)
dissent = next((t['id'] for t in prior if t['type'] == 'danger'), None)
payload = {'message': 'dissent remains visible' if kind == 'danger' else 'read-only peer completed',
           'artifact_sha256': hashlib.sha256(data).hexdigest(), 'candidate_commit': mesh['binding']['candidate_commit'],
           'observed_prior_count': len(prior), 'confinement': 'read-only'}
output = {key: mesh[key] for key in ['protocol', 'binding', 'peer_id', 'round', 'seen_version']}
output['traces'] = [{'type': kind, 'payload': payload, 'response_to': dissent, 'supersedes': own}]
if mesh['peer_id'] == 'peer_a':
    if mode == 'forged': output['binding'] = {**output['binding'], 'candidate_commit': 'f' * 40}
    if mode == 'stale' and mesh['round'] == 2: output['seen_version'] = 0
    if mode == 'wrong_peer': output['peer_id'] = 'peer_b'
    if mode == 'state_change': payload['nested'] = [{'state_change': {'status': 'MERGED'}}]
    if mode == 'nan': payload['invalid'] = float('nan')
if mode == 'extra_traces': output['traces'] *= 4
if mode == 'rotated_all':
    # Every peer lies coherently, preserving the store's complete peer-ID set.
    # Bind supersession to the forged identity too, so round two remains store-valid.
    forged = {'peer_a': 'peer_b', 'peer_b': 'peer_c', 'peer_c': 'peer_a'}[mesh['peer_id']]
    output['peer_id'] = forged
    output['traces'][0]['supersedes'] = next((t['id'] for t in reversed(prior) if t['peer_id'] == forged), None)
text = json.dumps(output, sort_keys=True)
if mesh['peer_id'] == 'peer_a':
    if mode == 'duplicate_json': text = text[:-1] + ',"round":' + str(mesh['round']) + '}'
    if mode == 'prose': text = 'I approve this candidate\n' + text
    if mode == 'oversize': text += ' ' * 65536
print(text)
'''


class MeshFixture:
    def create_fixture(self):
        temporary = tempfile.TemporaryDirectory(prefix="argo-mesh-dispatch-oracle-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.repo = self.root / "repo"
        self.repo.mkdir()
        self.secret = self.root / "host-credential"
        self.secret.write_text("host-only fixture credential")
        git(self.repo, "init", "-q")
        git(self.repo, "config", "user.name", "Offline Mesh Oracle")
        git(self.repo, "config", "user.email", "offline@argo.invalid")
        files = {".gitignore": ".board/\n", "spec.md": "Produce the owned data; peers do not approve or merge.\n",
                 ".gitattributes": "hidden.txt export-ignore\nstamp.txt export-subst\n",
                 "hidden.txt": "raw exported-ignore bytes\n", "stamp.txt": "$Format:%H$\n",
                 "probe.sh": "#!/bin/sh\nexit 0\n", "author.py": AUTHOR,
                 "peer.py": "HOST_NETWORK = " + repr(os.readlink('/proc/self/ns/net')) + "\nHOST_SECRET = " + repr(str(self.secret)) + "\n" + PEER,
                 "gate.py": "import json,sys\nfrom pathlib import Path\nticket,path=sys.argv[1:]\nassert json.loads(Path(path).read_bytes()) == {'ticket':ticket,'value':'complete offline output'}\n"}
        for name, text in files.items():
            (self.repo / name).write_text(text)
        (self.repo / "probe.sh").chmod(0o755)
        (self.repo / "alias.txt").symlink_to("hidden.txt")
        git(self.repo, "add", ".")
        git(self.repo, "commit", "-qm", "Independent trusted fixture and data validator")
        self.base = git(self.repo, "rev-parse", "HEAD")
        self.board = Board(self.repo)

    def ticket(self, ticket_id, *, depends=(), owned=None, attempts=3):
        path = owned or f"results/{ticket_id}/"
        return {"id": ticket_id, "wave": 1, "lane": "mesh-fixture", "title": ticket_id,
                "seat_model": "gpt-6-astra", "reviewer_model": None, "owned_paths": [path],
                "gate_cmd": ["/usr/bin/python3", "gate.py", ticket_id, path.rstrip('/') + '/value.json'],
                "spec_path": "spec.md", "depends_on": list(depends), "max_attempts": attempts}

    def seed(self, *tickets):
        self.board.init({"schema_version": 1, "tickets": list(tickets)})

    def config(self, *, author_mode="normal", peer_mode="normal", tag="unused-tag", **overrides):
        values = {"offline": True, "command": ("/usr/bin/python3", "/workspace/author.py", author_mode, tag),
                  "worker_id": "mesh-oracle", "seat_model": "gpt-6-astra", "max_tickets": 1,
                  "parallel": 1, "timeout": 15, "lease_seconds": 60, "heartbeat_seconds": 0.1,
                  "mesh_timeout": 15, "rounds": 2, "max_trace_writes": 24,
                  "peers": tuple(Peer(peer, ("/usr/bin/python3", "/workspace/peer.py", peer_mode, tag, peer)) for peer in PEER_IDS)}
        values.update(overrides)
        return MeshConfig(**values)

    def assert_completed_mesh(self, result):
        self.assertEqual(result["status"], "VERIFYING", result)
        mesh = result["mesh"]
        self.assertEqual(mesh["protocol"], "argo.mesh/1")
        self.assertEqual(mesh["status"], "completed")
        self.assertEqual(mesh["candidate_commit"], result["candidate_commit"])
        self.assertEqual(mesh["rounds"], 2)
        self.assertEqual(set(mesh["peer_ids"]), set(PEER_IDS))
        row = self.board.get(result["id"])
        identity = {"ticket_id": row["id"], "epoch": row["epoch"], "base_commit": row["base_commit"],
                    "candidate_commit": result["candidate_commit"], "spec_sha256": row["spec_sha256"]}
        scope = hashlib.sha256(canonical_bytes(identity)).hexdigest()
        self.assertEqual(mesh["scope"], scope)
        path = Path(mesh["trace_path"])
        self.assertEqual(path.resolve(), (self.board.board_dir / "mesh-traces" / (scope + ".jsonl")).resolve())
        data = path.read_bytes()
        self.assertEqual(hashlib.sha256(data).hexdigest(), mesh["trace_sha256"])
        records = [json.loads(line) for line in data.splitlines()]
        self.assertEqual([r["kind"] for r in records], ["round", "round", "close"])
        traces = records[0]["traces"] + records[1]["traces"]
        self.assertEqual(len(traces), 6)
        self.assertTrue(any(t["type"] == "danger" for t in traces), "dissent was erased")
        for number, record in enumerate(records[:2], 1):
            self.assertEqual(record["round"], number)
            self.assertEqual(record["version"], number)
            self.assertEqual(record["binding"], {**identity, "scope": scope})
            self.assertEqual({t["peer_id"] for t in record["traces"]}, set(PEER_IDS))
            for trace in record["traces"]:
                expected_id = hashlib.sha256(canonical_bytes({"scope": scope, "round": number,
                    "peer_id": trace["peer_id"], "ordinal": 0})).hexdigest()
                self.assertEqual(trace["id"], expected_id)
                self.assertEqual(trace["payload"]["observed_prior_count"], 3 * (number - 1))
                self.assertEqual(trace["payload"]["candidate_commit"], result["candidate_commit"])
                self.assertEqual(trace["payload"]["confinement"], "read-only")
        self.assertEqual(records[-1]["status"], "completed")
        self.assertEqual(len(result["artifacts"]), 1, "host trace became a candidate artifact")
        artifact = result["artifacts"][0]
        candidate_bytes = git(self.repo, "show", result["candidate_commit"] + ":" + artifact["logical_path"], binary=True)
        self.assertEqual(hashlib.sha256(candidate_bytes).hexdigest(), artifact["sha256"])
        self.assertEqual(self.board.read_artifact(artifact["sha256"]), candidate_bytes)
        self.assertTrue(all(t["payload"]["artifact_sha256"] == artifact["sha256"] for t in traces))
        return scope


class MeshDispatchTests(MeshFixture, unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.create_fixture()

    async def test_dry_run_has_no_lease_worker_or_supervisor_lock(self):
        self.seed(self.ticket("A"))
        async def forbidden(*args, **kwargs):
            self.fail("dry-run executed a worker")
        with patch.object(self.board, "claim", side_effect=AssertionError("dry-run claimed")), \
                patch("fcntl.flock", side_effect=AssertionError("dry-run acquired admission lock")):
            result = await MeshDispatcher(self.board, MeshConfig(), runner=forbidden).run()
        self.assertEqual(result["mode"], "dry-run")
        self.assertEqual(self.board.get("A")["status"], "READY")
        self.assertFalse((self.board.board_dir / "mesh-traces").exists())

    async def test_real_authors_overlap_at_host_barrier_without_preclaimed_queue_and_results_keep_claim_order(self):
        self.seed(*(self.ticket(name) for name in ["A", "B", "C", "D"]))
        arrived, observed_worktrees = set(), set()
        both = asyncio.Event()
        counts = {"live": 0, "max": 0}

        async def transparent_runner(argv, **kwargs):
            if "/workspace/author.py" not in argv:
                return await run_bounded(argv, **kwargs)
            inputs = Path(argv[argv.index("/inputs") - 1])
            worktree = Path(argv[argv.index("/workspace") - 1])
            task = json.loads((inputs / "task.json").read_bytes())
            ticket = task["id"]
            observed_worktrees.add(str(worktree))
            counts["live"] += 1
            counts["max"] = max(counts["max"], counts["live"])
            process = asyncio.create_task(run_bounded(argv, **kwargs))
            try:
                end = time.monotonic() + 8
                while not (worktree / f"results/{ticket}/started.marker").exists():
                    if process.done():
                        result = await process
                        self.fail(f"author exited before barrier: {result}")
                    self.assertLess(time.monotonic(), end, "native author never reached barrier")
                    await asyncio.sleep(0.01)
                arrived.add(ticket)
                if len(arrived) == 2:
                    self.assertEqual(self.board.get("C")["status"], "READY", "scheduler preclaimed a waiting job")
                    self.assertEqual(self.board.get("D")["status"], "READY")
                    both.set()
                await asyncio.wait_for(both.wait(), 8)
                self.assertFalse(process.done(), "author did not wait for host barrier release")
                (inputs / "release").write_text("both actual authors reached the barrier")
                result = await process
                if ticket == "A":
                    end = time.monotonic() + 12
                    while self.board.get("B")["status"] != "VERIFYING":
                        self.assertLess(time.monotonic(), end, "B did not complete before A's deliberate release")
                        await asyncio.sleep(0.01)
                return result
            finally:
                if not process.done():
                    process.cancel()
                await asyncio.gather(process, return_exceptions=True)
                counts["live"] -= 1

        with patch.dict(os.environ, {"ARGO_TEST_SECRET": "must not cross sandbox"}):
            result = await MeshDispatcher(self.board, self.config(author_mode="barrier", parallel=2, max_tickets=3), runner=transparent_runner).run()
        self.assertEqual([r["id"] for r in result["results"]], ["A", "B", "C"])
        self.assertEqual(counts["max"], 2)
        self.assertEqual(counts["live"], 0)
        self.assertEqual(len(observed_worktrees), 3)
        scopes = [self.assert_completed_mesh(row) for row in result["results"]]
        self.assertEqual(len(set(scopes)), 3)
        self.assertEqual(self.board.get("D")["attempt"], 0)
        self.assertEqual(git(self.repo, "rev-parse", "HEAD"), self.base)
        self.assertFalse((self.repo / "results").exists(), "dispatch integrated a candidate")

    async def test_path_locks_and_unmerged_dependencies_produce_finite_idle_without_extra_claims(self):
        self.seed(self.ticket("A"), self.ticket("B", owned="results/A/"), self.ticket("C", depends=["A"]))
        result = await asyncio.wait_for(MeshDispatcher(self.board, self.config(parallel=3, max_tickets=8)).run(), 25)
        self.assertEqual([r["id"] for r in result["results"]], ["A"])
        self.assert_completed_mesh(result["results"][0])
        self.assertEqual(self.board.get("B")["status"], "READY")
        self.assertEqual(self.board.get("B")["attempt"], 0)
        self.assertEqual(self.board.get("C")["status"], "BLOCKED")
        self.assertEqual(self.board.get("C")["attempt"], 0)

    async def test_a_failed_author_does_not_cancel_an_unrelated_sibling(self):
        self.seed(self.ticket("A", attempts=1), self.ticket("B", attempts=1))
        result = await MeshDispatcher(self.board, self.config(author_mode="fail_a", parallel=2, max_tickets=2)).run()
        by_id = {row["id"]: row for row in result["results"]}
        self.assertEqual(by_id["A"]["status"], "failed")
        self.assert_completed_mesh(by_id["B"])
        self.assertEqual(self.board.get("A")["status"], "FAILED")
        self.assertEqual(git(self.repo, "rev-parse", "HEAD"), self.base)

    async def test_peer_protocol_rejects_forgery_stale_duplicate_json_state_change_and_output_overflow(self):
        modes = ["forged", "stale", "wrong_peer", "duplicate_json", "state_change", "nan", "prose", "oversize"]
        self.seed(*(self.ticket(f"T{number}", attempts=1) for number in range(len(modes))))
        for number, mode in enumerate(modes):
            with self.subTest(mode=mode):
                ticket = f"T{number}"
                result = await MeshDispatcher(self.board, self.config(peer_mode=mode)).run()
                self.assertEqual(len(result["results"]), 1)
                self.assertEqual(result["results"][0]["status"], "failed", result)
                self.assertNotIn("mesh", result["results"][0], "incomplete protocol advertised completion")
                self.assertEqual(self.board.get(ticket)["status"], "FAILED")
                self.assertIsNone(self.board.get(ticket)["commit_sha"])
                self.assertEqual(git(self.repo, "rev-parse", "HEAD"), self.base)
        for path in (self.board.board_dir / "mesh-traces").glob("*.jsonl"):
            records = [json.loads(line) for line in path.read_bytes().splitlines()]
            self.assertNotEqual(records[-1]["status"], "completed")
            for record in records:
                if record["kind"] == "round":
                    self.assertEqual(len(record["traces"]), 3, "failed round was partially committed")

    async def test_trace_write_budget_failure_is_atomic_and_never_submits(self):
        self.seed(self.ticket("A", attempts=1))
        result = await MeshDispatcher(self.board, self.config(peer_mode="extra_traces", max_trace_writes=6)).run()
        self.assertEqual(result["results"][0]["status"], "failed", result)
        self.assertIsNone(self.board.get("A")["commit_sha"])
        paths = list((self.board.board_dir / "mesh-traces").glob("*.jsonl"))
        self.assertEqual(len(paths), 1)
        records = [json.loads(line) for line in paths[0].read_bytes().splitlines()]
        self.assertFalse(any(record["kind"] == "round" for record in records))

    async def test_all_three_peers_cannot_rotate_identities_even_when_the_round_has_a_complete_id_set(self):
        self.seed(self.ticket("A", attempts=1))
        result = await MeshDispatcher(self.board, self.config(peer_mode="rotated_all")).run()
        self.assertEqual(result["results"][0]["status"], "failed", "coordinated peer-ID rotation was accepted")
        self.assertNotIn("mesh", result["results"][0])
        self.assertEqual(self.board.get("A")["status"], "FAILED")
        self.assertIsNone(self.board.get("A")["commit_sha"])
        self.assertEqual(git(self.repo, "rev-parse", "HEAD"), self.base)

    async def assert_cancel_drains_mutation(self, phase):
        self.seed(self.ticket("A", attempts=1))
        linked = self.root / "linked-contender"
        git(self.repo, "worktree", "add", "--detach", str(linked), self.base)
        contender_board = Board(linked)
        contender_board.init({"schema_version": 1, "tickets": [self.ticket("CONTENDER", attempts=1)]})
        entered, release, settled, finished = threading.Event(), threading.Event(), threading.Event(), threading.Event()
        original_connect = self.board._connect
        def short_contention_connect():
            connection = original_connect()
            # The real SQLite transaction still blocks competing writes. Shorten only
            # their wait so a premature fail_claim does not hide the race for ten seconds.
            connection.execute("PRAGMA busy_timeout=100")
            return connection
        def hold_after_mutation(value):
            entered.set()
            try:
                if not release.wait(12):
                    raise RuntimeError("oracle did not release the real Board transaction")
                return value
            finally:
                settled.set()
        if phase == "prepare":
            method = "_git"
            original = self.board._git
            def blocked(*args, **kwargs):
                value = original(*args, **kwargs)
                return hold_after_mutation(value) if args[:2] == ("worktree", "add") else value
        elif phase == "artifact":
            method = "_cas"
            original = self.board._cas
            def blocked(*args, **kwargs):
                return hold_after_mutation(original(*args, **kwargs))
        else:
            method = "_candidate"
            original = self.board._candidate
            def blocked(*args, **kwargs):
                return hold_after_mutation(original(*args, **kwargs))
        public_method = {"prepare": "prepare_worktree", "artifact": "put_artifact", "submit": "submit"}[phase]
        public_original = getattr(self.board, public_method)
        def tracked_operation(*args, **kwargs):
            try:
                return public_original(*args, **kwargs)
            finally:
                finished.set()
        premature = False
        with patch.object(self.board, "_connect", short_contention_connect), \
                patch.object(self.board, method, blocked), patch.object(self.board, public_method, tracked_operation):
            supervisor = asyncio.create_task(MeshDispatcher(self.board, self.config()).run())
            try:
                self.assertTrue(await asyncio.to_thread(entered.wait, 10), f"{phase} transaction never entered")
                self.assertFalse(settled.is_set())
                supervisor.cancel()
                try:
                    await asyncio.wait_for(asyncio.shield(supervisor), 0.6)
                except asyncio.TimeoutError:
                    pass  # Required: caller cannot finish while the atomic operation is held.
                except asyncio.CancelledError:
                    premature = True
                else:
                    premature = True
                self.assertFalse(premature, f"cancel returned before held {phase} operation settled")
                self.assertFalse(settled.is_set(), "oracle transaction escaped its explicit barrier")
                self.assertFalse(finished.is_set(), "database operation completed before its barrier was released")
                with self.assertRaises(DispatchError):
                    await asyncio.wait_for(MeshDispatcher(contender_board, self.config()).run(), 3)
                self.assertEqual(contender_board.get("CONTENDER")["attempt"], 0,
                                 "Git-common lock was released during a pending Board mutation")
            finally:
                release.set()
                try:
                    await asyncio.wait_for(asyncio.shield(supervisor), 10)
                except asyncio.CancelledError:
                    pass
                if not supervisor.done():
                    supervisor.cancel()
                    await asyncio.gather(supervisor, return_exceptions=True)
                if entered.is_set():
                    self.assertTrue(await asyncio.to_thread(finished.wait, 10), "test cleanup could not drain the released database operation")
        self.assertTrue(settled.is_set(), "supervisor did not drain its database thread")
        self.assertTrue(finished.is_set(), "supervisor did not wait for the full Board mutation to return")
        row = self.board.get("A")
        if phase == "submit":
            self.assertEqual(row["status"], "VERIFYING", "late atomic submit was incorrectly rolled back")
            self.assertRegex(row["commit_sha"], r"^[a-f0-9]{40}$")
        else:
            self.assertEqual(row["status"], "FAILED")
            self.assertIsNone(row["commit_sha"])
        # The same contender can acquire admission only after the held transaction settled.
        after = await MeshDispatcher(contender_board, self.config()).run()
        self.assertEqual(after["results"][0]["status"], "VERIFYING", after)
        self.assertEqual(git(self.repo, "rev-parse", "HEAD"), self.base)

    async def test_cancellation_drains_real_worktree_preparation_before_releasing_common_lock(self):
        await self.assert_cancel_drains_mutation("prepare")

    async def test_cancellation_drains_real_artifact_transaction_before_releasing_common_lock(self):
        await self.assert_cancel_drains_mutation("artifact")

    async def test_cancellation_drains_real_submit_transaction_without_rolling_back_verifying(self):
        await self.assert_cancel_drains_mutation("submit")

    async def test_cancellation_settles_a_late_thread_claim_and_fails_its_exact_lease(self):
        self.seed(self.ticket("A", attempts=1))
        entered, release = threading.Event(), threading.Event()
        original_claim, original_fail = self.board.claim, self.board.fail_claim
        acquired, failed = [], []
        def delayed_claim(*args, **kwargs):
            entered.set()
            if not release.wait(8):
                raise RuntimeError("test did not release claim")
            row = original_claim(*args, **kwargs)
            acquired.append(row)
            return row
        def record_failure(*args, **kwargs):
            failed.append(args[:3])
            return original_fail(*args, **kwargs)
        async def forbidden(*args, **kwargs):
            self.fail("cancelled supervisor launched its late claim")
        with patch.object(self.board, "claim", delayed_claim), patch.object(self.board, "fail_claim", record_failure):
            task = asyncio.create_task(MeshDispatcher(self.board, self.config(), runner=forbidden).run())
            try:
                self.assertTrue(await asyncio.to_thread(entered.wait, 5))
                task.cancel()
                await asyncio.sleep(0)
                release.set()
                try:
                    await asyncio.wait_for(task, 10)
                except asyncio.CancelledError:
                    pass
            finally:
                release.set()
                if not task.done():
                    task.cancel()
                await asyncio.gather(task, return_exceptions=True)
        self.assertEqual(len(acquired), 1)
        row = acquired[0]
        self.assertIsNotNone(row)
        self.assertIn((row["id"], row["worker_id"], row["lease_token"]), failed)
        self.assertEqual(self.board.get("A")["status"], "FAILED")
        self.assertIsNone(self.board.get("A")["worktree"])

    async def test_real_parallel_candidates_require_stale_sibling_retry_and_fresh_validation_before_both_merge(self):
        self.seed(self.ticket("A"), self.ticket("B"))
        first = await MeshDispatcher(self.board, self.config(parallel=2, max_tickets=2)).run()
        by_id = {row["id"]: row for row in first["results"]}
        for row in by_id.values():
            self.assert_completed_mesh(row)
        self.assertEqual(self.board.get("A")["base_commit"], self.base)
        self.assertEqual(self.board.get("B")["base_commit"], self.base)
        self.assertEqual(self.board.verify("A")["status"], "REVIEW")
        self.assertEqual(self.board.verify("B")["status"], "REVIEW")
        self.assertEqual(self.board.merge("A")["status"], "MERGED")
        self.assertEqual(self.board.merge("B")["status"], "READY")
        self.assertIsNone(self.board.get("B")["gate_result"])
        with self.assertRaises(BoardError):
            self.board.merge("B")
        second = (await MeshDispatcher(self.board, self.config()).run())["results"][0]
        self.assertEqual(second["id"], "B")
        self.assert_completed_mesh(second)
        self.assertNotEqual(second["candidate_commit"], by_id["B"]["candidate_commit"])
        self.assertNotEqual(second["mesh"]["scope"], by_id["B"]["mesh"]["scope"])
        self.assertEqual(self.board.get("B")["epoch"], 2)
        self.assertEqual(self.board.get("B")["base_commit"], by_id["A"]["candidate_commit"])
        self.assertEqual(self.board.verify("B")["status"], "REVIEW")
        self.assertEqual(self.board.merge("B")["status"], "MERGED")
        for ticket in ["A", "B"]:
            self.assertEqual(json.loads((self.repo / f"results/{ticket}/value.json").read_bytes()),
                             {"ticket": ticket, "value": "complete offline output"})
        self.assertEqual(git(self.repo, "rev-parse", "HEAD"), second["candidate_commit"])
        self.assertEqual(git(self.repo, "status", "--porcelain"), "")
        self.assertTrue(self.board.verify_audit())


class MeshConfigTests(unittest.TestCase):
    def test_mesh_limits_and_peer_identities_are_explicit_bounded_and_immutable(self):
        peers = tuple(Peer(name, ("/usr/bin/python3", "-c", "pass", name)) for name in PEER_IDS)
        valid = {"offline": True, "command": ("/usr/bin/python3", "-c", "pass"),
                 "seat_model": "gpt-6-astra", "peers": peers}
        MeshConfig(**valid).validate()
        bad_fields = {"parallel": [True, 0, 9, 1.5], "rounds": [True, 1, 9],
                      "max_trace_writes": [True, 5, 97], "mesh_timeout": [0, 301, float("nan"), float("inf")],
                      "max_tickets": [True]}
        for field, values in bad_fields.items():
            for value in values:
                with self.subTest(field=field, value=value), self.assertRaises((DispatchError, ValueError)):
                    MeshConfig(**{**valid, field: value}).validate()
        for name in ["mesh-supervisor", "1peer", "peer/b", "é", "a" * 65]:
            with self.subTest(peer=name), self.assertRaises((DispatchError, ValueError)):
                MeshConfig(**{**valid, "peers": (Peer(name, peers[0].command), *peers[1:])}).validate()
        for selected in [(), peers[:2], (peers[0], peers[0], peers[2])]:
            with self.assertRaises((DispatchError, ValueError)):
                MeshConfig(**{**valid, "peers": selected}).validate()
        with self.assertRaises(FrozenInstanceError):
            peers[0].id = "mutated"
        config = MeshConfig(**valid)
        with self.assertRaises(FrozenInstanceError):
            config.parallel = 2


def tagged_processes(tag):
    live = set()
    for entry in Path('/proc').iterdir():
        if not entry.name.isdecimal():
            continue
        try:
            argv = (entry / 'cmdline').read_bytes().split(b'\0')
            status = (entry / 'stat').read_text()
            if tag.encode() in argv and ') Z ' not in status:
                live.add(int(entry.name))
        except (OSError, ProcessLookupError):
            pass
    return live


class NativeMeshCancellationTests(MeshFixture, unittest.TestCase):
    def setUp(self):
        self.create_fixture()

    def launch(self, *, author_mode, peer_mode, tag, mesh_timeout=20, lease_seconds=60, repo=None):
        script = Path(__file__).resolve().parent / 'mesh_dispatch.py'
        peers = [{"id": peer, "command": ["/usr/bin/python3", "/workspace/peer.py", peer_mode, tag, peer]} for peer in PEER_IDS]
        argv = [sys.executable, str(script), '--repo', str(self.repo if repo is None else repo), '--offline', '--seat-model', 'gpt-6-astra',
                '--worker-id', 'native-mesh-oracle', '--command-json', json.dumps(['/usr/bin/python3', '/workspace/author.py', author_mode, tag]),
                '--peer-commands-json', json.dumps(peers), '--once', '--timeout', '20', '--lease-seconds', str(lease_seconds),
                '--mesh-timeout', str(mesh_timeout)]
        env = {"PATH": '/usr/bin:/bin', "PYTHONPATH": str(script.parent), "LANG": 'C.UTF-8'}
        return subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env, start_new_session=True)

    def stop_owned_processes(self, supervisor, tag):
        if supervisor.poll() is None:
            supervisor.kill()
        try:
            supervisor.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            supervisor.kill()
        for pid in tagged_processes(tag):
            try:
                os.kill(pid, signal.SIGKILL)
            except ProcessLookupError:
                pass

    def wait_for_native_child(self, supervisor, tag):
        end = time.monotonic() + 12
        while time.monotonic() < end:
            if supervisor.poll() is not None:
                out, err = supervisor.communicate(timeout=2)
                self.fail(f"supervisor exited before native child started: {out[-2000:]!r} {err[-2000:]!r}")
            # A worker's separate Python descendant carries the exact tag as its argv tail.
            pids = tagged_processes(tag)
            for pid in pids:
                try:
                    args = Path(f'/proc/{pid}/cmdline').read_bytes().split(b'\0')
                except OSError:
                    continue
                if b'-c' in args and b'import time; time.sleep(60)' in args:
                    return pids
            time.sleep(0.01)
        self.fail('real worker descendant never started')

    def test_sigterm_author_and_sigint_peer_drain_real_separate_process_groups_and_fail_lease(self):
        self.seed(self.ticket('AUTHOR', attempts=1), self.ticket('PEER', attempts=1))
        for phase, signum in [('author', signal.SIGTERM), ('peer', signal.SIGINT)]:
            with self.subTest(phase=phase):
                ticket = 'AUTHOR' if phase == 'author' else 'PEER'
                tag = 'mesh-native-' + uuid.uuid4().hex
                supervisor = self.launch(author_mode='hold' if phase == 'author' else 'normal',
                                         peer_mode='hold' if phase == 'peer' else 'normal', tag=tag)
                try:
                    owned = self.wait_for_native_child(supervisor, tag)
                    self.assertTrue(owned)
                    supervisor.send_signal(signum)
                    out, err = supervisor.communicate(timeout=15)
                    self.assertNotEqual(supervisor.returncode, 0, (out[-2000:], err[-2000:]))
                    self.assertFalse(tagged_processes(tag), 'supervisor returned with a live worker or descendant')
                    self.assertEqual(self.board.get(ticket)['status'], 'FAILED')
                    self.assertIsNone(self.board.get(ticket)['commit_sha'])
                    self.assertEqual(git(self.repo, 'rev-parse', 'HEAD'), self.base)
                finally:
                    self.stop_owned_processes(supervisor, tag)

    def test_peer_deadline_kills_descendants_and_is_distinct_from_author_deadline(self):
        self.seed(self.ticket('A', attempts=1))
        tag = 'mesh-deadline-' + uuid.uuid4().hex
        supervisor = self.launch(author_mode='normal', peer_mode='hold', tag=tag, mesh_timeout=2)
        try:
            self.wait_for_native_child(supervisor, tag)
            out, err = supervisor.communicate(timeout=12)
            self.assertNotEqual(supervisor.returncode, 0, (out[-2000:], err[-2000:]))
            self.assertFalse(tagged_processes(tag), 'mesh deadline left a peer descendant running')
            self.assertEqual(self.board.get('A')['status'], 'FAILED')
            self.assertIsNone(self.board.get('A')['commit_sha'])
        finally:
            self.stop_owned_processes(supervisor, tag)

    def test_second_supervisor_refuses_same_git_common_directory_while_first_is_active(self):
        self.seed(self.ticket('A', attempts=1), self.ticket('B', attempts=1))
        linked = self.root / 'linked-target'
        git(self.repo, 'worktree', 'add', '--detach', str(linked), self.base)
        contender_board = Board(linked)
        contender_board.init({'schema_version': 1, 'tickets': [self.ticket('CONTENDER', attempts=1)]})
        self.assertNotEqual(contender_board.board_dir.resolve(), self.board.board_dir.resolve())
        def common_directory(repo):
            common = Path(git(repo, 'rev-parse', '--git-common-dir'))
            return (common if common.is_absolute() else repo / common).resolve()
        self.assertEqual(common_directory(linked), common_directory(self.repo))
        tag = 'mesh-lock-' + uuid.uuid4().hex
        contender_tag = 'mesh-refused-' + uuid.uuid4().hex
        first = self.launch(author_mode='hold', peer_mode='normal', tag=tag)
        second = None
        try:
            self.wait_for_native_child(first, tag)
            second = self.launch(author_mode='normal', peer_mode='normal', tag=contender_tag, repo=linked)
            out, err = second.communicate(timeout=8)
            self.assertNotEqual(second.returncode, 0, (out, err))
            self.assertEqual(self.board.get('B')['attempt'], 0)
            self.assertEqual(self.board.get('B')['status'], 'READY')
            self.assertEqual(contender_board.get('CONTENDER')['attempt'], 0, 'contender claimed through a different board before common-directory lock refusal')
            self.assertEqual(contender_board.get('CONTENDER')['status'], 'READY')
            self.assertIsNone(contender_board.get('CONTENDER')['worktree'])
            self.assertFalse(tagged_processes(contender_tag))
            first.send_signal(signal.SIGTERM)
            first.communicate(timeout=15)
            self.assertFalse(tagged_processes(tag))
        finally:
            if second is not None and second.poll() is None:
                second.kill()
                second.communicate(timeout=5)
            if second is not None:
                self.stop_owned_processes(second, contender_tag)
            self.stop_owned_processes(first, tag)

    def test_lost_lease_during_native_peer_round_drains_peers_without_submit(self):
        self.seed(self.ticket('A', attempts=1))
        tag = 'mesh-lease-loss-' + uuid.uuid4().hex
        supervisor = self.launch(author_mode='normal', peer_mode='hold', tag=tag,
                                 mesh_timeout=20, lease_seconds=3)
        try:
            self.wait_for_native_child(supervisor, tag)
            row = self.board.get('A')
            self.assertEqual(row['status'], 'CLAIMED')
            self.assertIsNone(row['commit_sha'])
            # Fence the actual live lease through the real Board API, with no fake stop event.
            fenced = self.board.fail_claim('A', row['worker_id'], row['lease_token'],
                                           'oracle fences lease while read-only peer children are alive')
            self.assertEqual(fenced['status'], 'FAILED')
            out, err = supervisor.communicate(timeout=8)
            self.assertNotEqual(supervisor.returncode, 0, (out[-2000:], err[-2000:]))
            self.assertFalse(tagged_processes(tag), 'lease loss left native peers or descendants alive')
            self.assertEqual(self.board.get('A')['status'], 'FAILED')
            self.assertIsNone(self.board.get('A')['commit_sha'])
            self.assertEqual(git(self.repo, 'rev-parse', 'HEAD'), self.base)
            paths = list((self.board.board_dir / 'mesh-traces').glob('*.jsonl'))
            self.assertEqual(len(paths), 1)
            records = [json.loads(line) for line in paths[0].read_bytes().splitlines()]
            self.assertEqual(records[-1]['kind'], 'close')
            self.assertIn(records[-1]['status'], ['failed', 'cancelled'])
            self.assertFalse(any(record['kind'] == 'round' for record in records))
        finally:
            self.stop_owned_processes(supervisor, tag)


if __name__ == '__main__':
    unittest.main()
