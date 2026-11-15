"""Offline blackboard contracts; all repositories and databases are disposable."""
import concurrent.futures
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import tempfile
import time
import unittest
from unittest.mock import patch

try:
    from board import Board, BoardError
except ImportError:
    Board = None
    BoardError = RuntimeError


def git(repo, *args):
    return subprocess.check_output(["git", "-C", str(repo), *args], stderr=subprocess.PIPE).decode().strip()


class BoardTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(Board, "The offline Board engine is not implemented")
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.repo = Path(self.temp.name) / "repo"
        self.repo.mkdir()
        git(self.repo, "init", "-q")
        git(self.repo, "config", "user.name", "Test")
        git(self.repo, "config", "user.email", "test@example.invalid")
        (self.repo / "spec.md").write_text("Implement only the owned feature.\n")
        (self.repo / ".gitignore").write_text(".board/\n")
        (self.repo / "feature").mkdir()
        (self.repo / "feature/a.txt").write_text("base\n")
        (self.repo / "gate.py").write_text("from pathlib import Path\nassert Path('feature/a.txt').read_text() == 'good\\n'\n")
        git(self.repo, "add", ".")
        git(self.repo, "commit", "-qm", "base")
        self.board = Board(self.repo)

    def seed(self, *tickets):
        return {"schema_version": 1, "tickets": list(tickets or [self.ticket()])}

    def ticket(self, id="A", **changes):
        return dict({"id": id, "wave": 1, "lane": "feature", "title": id,
                     "seat_model": "gpt-6-astra", "reviewer_model": None,
                     "owned_paths": ["feature"], "gate_cmd": ["/usr/bin/python3", "gate.py"],
                     "spec_path": "spec.md", "depends_on": [], "max_attempts": 3}, **changes)

    def claim(self):
        return self.board.claim("worker", "gpt-6-astra", 10)

    def candidate(self, claim, content="good\n", extra=None):
        work = self.board.prepare_worktree(claim["id"], "worker", claim["lease_token"])
        (work / "feature/a.txt").write_text(content)
        if extra:
            (work / extra).write_text("out of bounds\n")
        git(work, "add", "--all")
        git(work, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "candidate")
        return git(work, "rev-parse", "HEAD")

    def submitted(self, **changes):
        self.board.init(self.seed(self.ticket(**changes)))
        claim = self.claim()
        sha = self.candidate(claim)
        self.board.submit("A", "worker", claim["lease_token"], sha)
        return claim, sha

    def test_init_is_insert_only_and_snapshots_spec(self):
        seed = self.seed()
        self.board.init(seed)
        self.board.init(seed)
        claim = self.claim()
        (self.repo / "spec.md").write_text("changed")
        self.assertEqual(self.board.read_artifact(claim["spec_sha256"]), b"Implement only the owned feature.\n")
        self.assertEqual((self.board.board_dir / "tickets/A.spec").read_bytes(), b"Implement only the owned feature.\n")
        with self.assertRaises(BoardError):
            self.board.init(self.seed(self.ticket(title="replacement")))
        self.assertEqual(self.board.get("A")["status"], "CLAIMED")
        self.assertTrue(self.board.verify_audit())

    def test_invalid_dag_and_paths_are_atomic(self):
        for tickets in [
            [self.ticket(depends_on=["missing"])],
            [self.ticket(depends_on=["B"]), self.ticket("B", depends_on=["A"])],
            [self.ticket(owned_paths=["../escape"])],
            [self.ticket(owned_paths=[".git/config"])],
            [self.ticket(owned_paths=[".board"])],
        ]:
            with self.assertRaises(BoardError):
                self.board.init(self.seed(*tickets))
        with self.assertRaises(BoardError):
            self.board.get("A")

    def test_directory_hints_preserved_but_overlap_normalized(self):
        self.board.init(self.seed(self.ticket(owned_paths=["feature/"]), self.ticket("B", owned_paths=["feature/a.txt"])))
        claim = self.claim()
        self.assertEqual(claim["owned_paths"], ["feature/"])
        self.assertIsNone(self.claim())
        sha = self.candidate(claim)
        self.assertEqual(self.board.submit("A", "worker", claim["lease_token"], sha)["status"], "VERIFYING")

    def test_gate_source_cannot_be_replaced_even_when_owned(self):
        self.board.init(self.seed(self.ticket(owned_paths=["feature", "gate.py"])))
        claim = self.claim()
        work = self.board.prepare_worktree("A", "worker", claim["lease_token"])
        (work / "gate.py").write_text("# pretend checks passed\n")
        git(work, "add", ".")
        git(work, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "replace gate")
        with self.assertRaisesRegex(BoardError, "policy"):
            self.board.submit("A", "worker", claim["lease_token"], git(work, "rev-parse", "HEAD"))

    def test_missing_gate_script_cannot_be_supplied_by_candidate(self):
        with self.assertRaisesRegex(BoardError, "gate|Gate"):
            self.board.init(self.seed(self.ticket(gate_cmd=["/usr/bin/python3", "feature/new_gate.py"])))

    def test_absolute_gate_source_outside_pinned_repo_is_refused(self):
        with self.assertRaisesRegex(BoardError, "gate|Gate"):
            self.board.init(self.seed(self.ticket(gate_cmd=["/usr/bin/python3", "/tmp/mutable_gate.py"])))

    def test_gate_runtime_cannot_expand_readonly_mount_to_host_root(self):
        executable = Path(self.temp.name) / "custom-runtime"
        executable.write_text("#!/usr/bin/python3\nprint('untrusted runtime')\n")
        executable.chmod(0o755)
        with self.assertRaisesRegex(BoardError, "runtime"):
            self.board.init(self.seed(self.ticket(gate_cmd=[str(executable)])))

    def test_zero_exit_without_gate_completion_is_not_a_pass(self):
        self.submitted(gate_cmd=["/usr/bin/python3", "-c", "import os; os._exit(0)"])
        self.assertEqual(self.board.verify("A")["status"], "READY")

    def test_data_gate_refuses_dynamic_code_with_forged_stdlib_filename(self):
        self.submitted(gate_cmd=["/usr/bin/python3", "-c", "exec(compile('print(123)', '/usr/forged-gate.py', 'exec'))"])
        self.assertEqual(self.board.verify("A")["status"], "READY")

    def test_data_gate_refuses_child_process_execution(self):
        self.submitted(gate_cmd=["/usr/bin/python3", "-c", "import os; os.system('/usr/bin/true')"])
        self.assertEqual(self.board.verify("A")["status"], "READY")

    def test_data_gate_cannot_execute_candidate_imports(self):
        (self.repo / "gate.py").write_text("import sys\nsys.path.insert(0, '.')\nimport feature.plugin\nraise AssertionError('validation never passed')\n")
        git(self.repo, "add", ".")
        git(self.repo, "commit", "-qm", "trusted grader")
        self.board.init(self.seed())
        claim = self.claim()
        work = self.board.prepare_worktree("A", "worker", claim["lease_token"])
        (work / "feature/plugin.py").write_text("import os\nos._exit(0)\n")
        git(work, "add", ".")
        git(work, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "early exit")
        self.board.submit("A", "worker", claim["lease_token"], git(work, "rev-parse", "HEAD"))
        self.assertEqual(self.board.verify("A")["status"], "READY")

    def test_independent_process_claims_are_atomic(self):
        self.board.init(self.seed())
        program = str(Path(__file__).with_name("board.py"))
        def acquire(i):
            output = subprocess.check_output(["/usr/bin/python3", program, "--repo", str(self.repo), "claim", f"worker{i}", "gpt-6-astra"])
            return json.loads(output)
        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
            claims = list(pool.map(acquire, range(6)))
        self.assertEqual(sum(value is not None for value in claims), 1)

    def test_merge_crash_recovery_requires_reverification(self):
        _, sha = self.submitted()
        self.board.verify("A")
        accept = self.board._accept
        with patch.object(self.board, "_accept", side_effect=KeyboardInterrupt):
            with self.assertRaises(KeyboardInterrupt):
                self.board.merge("A")
        self.assertEqual(self.board.get("A")["status"], "MERGING")
        self.assertEqual(git(self.repo, "rev-parse", "HEAD"), sha)
        self.assertEqual(self.board.recover("A")["status"], "MERGED")
        self.assertTrue(self.board.verify_audit())

    def ignored_collision_fixture(self, kind):
        fixture = BoardTests()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        (fixture.repo / ".gitignore").write_text(".board/\nfeature/local\n")
        git(fixture.repo, "add", ".gitignore")
        git(fixture.repo, "commit", "-qm", "ignore local data")
        fixture.board.init(fixture.seed())
        claim = fixture.claim()
        work = fixture.board.prepare_worktree("A", "worker", claim["lease_token"])
        (work / "feature/a.txt").write_text("good\n")
        incoming = "feature/local/nested.txt" if kind.startswith("ancestor-") else "feature/local"
        (work / incoming).parent.mkdir(parents=True, exist_ok=True)
        (work / incoming).write_text("candidate\n")
        git(work, "add", "-f", "feature/a.txt", incoming)
        git(work, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "candidate")
        sha = git(work, "rev-parse", "HEAD")
        fixture.board.submit("A", "worker", claim["lease_token"], sha)
        self.assertEqual(fixture.board.verify("A")["status"], "REVIEW")
        return fixture, claim, sha

    def make_ignored_collision(self, fixture, kind):
        local = fixture.repo / "feature/local"
        if kind == "directory":
            local.mkdir()
            (local / "private.txt").write_text("private\n")
        elif kind in ("symlink", "ancestor-symlink"):
            local.symlink_to("missing-local-target")
        else:
            local.write_text("private\n")
        return local

    def assert_ignored_collision_unchanged(self, local, kind):
        if kind == "directory":
            self.assertEqual((local / "private.txt").read_text(), "private\n")
        elif kind in ("symlink", "ancestor-symlink"):
            self.assertTrue(local.is_symlink())
            self.assertEqual(os.readlink(local), "missing-local-target")
        else:
            self.assertEqual(local.read_text(), "private\n")

    def test_merge_refuses_ignored_collisions_before_ref_update(self):
        for kind in ("file", "directory", "symlink", "ancestor-file", "ancestor-symlink"):
            with self.subTest(kind=kind):
                fixture, claim, _ = self.ignored_collision_fixture(kind)
                local = self.make_ignored_collision(fixture, kind)
                with self.assertRaises(BoardError):
                    fixture.board.merge("A")
                self.assertEqual(git(fixture.repo, "rev-parse", "HEAD"), claim["base_commit"])
                self.assert_ignored_collision_unchanged(local, kind)

    def test_merge_rechecks_collisions_after_private_fast_forward(self):
        fixture, claim, _ = self.ignored_collision_fixture("file")
        original = fixture.board._git
        def late_local_file(*args, **kwargs):
            result = original(*args, **kwargs)
            if args[0] == "merge" and kwargs.get("cwd"):
                self.make_ignored_collision(fixture, "file")
            return result
        with patch.object(fixture.board, "_git", side_effect=late_local_file):
            with self.assertRaises(BoardError):
                fixture.board.merge("A")
        self.assertEqual(git(fixture.repo, "rev-parse", "HEAD"), claim["base_commit"])
        self.assert_ignored_collision_unchanged(fixture.repo / "feature/local", "file")

    def test_merge_preserves_noncolliding_ignored_directory_contents(self):
        fixture, _, _ = self.ignored_collision_fixture("ancestor-file")
        local = self.make_ignored_collision(fixture, "directory")
        self.assertEqual(fixture.board.merge("A")["status"], "MERGED")
        self.assert_ignored_collision_unchanged(local, "directory")
        self.assertEqual((local / "nested.txt").read_text(), "candidate\n")

    def tracked_directory_replacement(self):
        (self.repo / "feature/nested").mkdir()
        (self.repo / "feature/nested/old.txt").write_text("tracked\n")
        git(self.repo, "add", ".")
        git(self.repo, "commit", "-qm", "tracked directory")
        self.board.init(self.seed())
        claim = self.claim()
        work = self.board.prepare_worktree("A", "worker", claim["lease_token"])
        (work / "feature/a.txt").write_text("good\n")
        (work / "feature/nested/old.txt").unlink()
        (work / "feature/nested").rmdir()
        (work / "feature/nested").write_text("replacement\n")
        git(work, "add", ".")
        git(work, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "replace directory")
        sha = git(work, "rev-parse", "HEAD")
        self.board.submit("A", "worker", claim["lease_token"], sha)
        self.board.verify("A")
        return sha

    def test_merge_allows_tracked_directory_replacement(self):
        self.tracked_directory_replacement()
        self.assertEqual(self.board.merge("A")["status"], "MERGED")
        self.assertEqual((self.repo / "feature/nested").read_text(), "replacement\n")

    def test_tracked_directory_replacement_preserves_ignored_descendants(self):
        self.tracked_directory_replacement()
        (self.repo / ".git/info/exclude").write_text("feature/nested/private\n")
        base = git(self.repo, "rev-parse", "HEAD")
        for kind in ("file", "empty-directory", "symlink"):
            with self.subTest(kind=kind):
                local = self.repo / "feature/nested/private"
                if kind == "file":
                    local.write_text("private\n")
                elif kind == "empty-directory":
                    local.mkdir()
                else:
                    local.symlink_to("missing-local-target")
                with self.assertRaises(BoardError):
                    self.board.merge("A")
                self.assertEqual(git(self.repo, "rev-parse", "HEAD"), base)
                if kind == "empty-directory":
                    self.assertTrue(local.is_dir())
                    local.rmdir()
                else:
                    self.assert_ignored_collision_unchanged(local, kind)
                    local.unlink()

    def test_recovery_refuses_ignored_collisions_and_can_resume(self):
        for kind in ("file", "directory", "symlink", "ancestor-file", "ancestor-symlink"):
            with self.subTest(kind=kind):
                fixture, _, sha = self.ignored_collision_fixture(kind)
                original = fixture.board._git
                def interrupted(*args, **kwargs):
                    if args[0] == "read-tree" and not kwargs.get("cwd"):
                        raise KeyboardInterrupt
                    return original(*args, **kwargs)
                with patch.object(fixture.board, "_git", side_effect=interrupted):
                    with self.assertRaises(KeyboardInterrupt):
                        fixture.board.merge("A")
                self.assertEqual(git(fixture.repo, "rev-parse", "HEAD"), sha)
                local = self.make_ignored_collision(fixture, kind)
                with self.assertRaises(BoardError):
                    fixture.board.recover("A")
                self.assert_ignored_collision_unchanged(local, kind)
                if kind == "directory":
                    (local / "private.txt").unlink()
                    local.rmdir()
                else:
                    local.unlink()
                self.assertEqual(Board(fixture.repo).recover("A")["status"], "MERGED")

    def test_repeated_interrupted_recovery_preserves_integrated_candidate(self):
        self.board.init(self.seed(self.ticket(), self.ticket("B", depends_on=["A"], owned_paths=["other"])))
        claim = self.claim()
        sha256 = self.board.put_artifact("A", "worker", claim["lease_token"], "feature/a.txt", b"good\n")
        sha = self.candidate(claim)
        self.board.submit("A", "worker", claim["lease_token"], sha)
        self.board.verify("A")
        with patch.object(self.board, "_accept", side_effect=KeyboardInterrupt):
            with self.assertRaises(KeyboardInterrupt):
                self.board.merge("A")
        for _ in range(2):
            self.board = Board(self.repo)
            with patch.object(self.board, "_run_gate", side_effect=KeyboardInterrupt):
                with self.assertRaises(KeyboardInterrupt):
                    self.board.recover("A")
        self.assertEqual(Board(self.repo).recover("A")["status"], "MERGED")
        self.assertEqual(git(self.repo, "rev-parse", "HEAD"), sha)
        child = self.board.get("B")
        self.assertEqual(child["status"], "READY")
        self.assertEqual([a["sha256"] for a in child["upstream_artifacts"]], [sha256])
        self.assertTrue(self.board.verify_audit())

    def test_recovery_interrupted_after_gate_keeps_integration_intent(self):
        _, sha = self.submitted()
        self.board.verify("A")
        with patch.object(self.board, "_accept", side_effect=KeyboardInterrupt):
            with self.assertRaises(KeyboardInterrupt):
                self.board.merge("A")
        verify = self.board.verify
        def interrupted(ticket_id):
            verify(ticket_id)
            raise KeyboardInterrupt
        with patch.object(self.board, "verify", side_effect=interrupted):
            with self.assertRaises(KeyboardInterrupt):
                self.board.recover("A")
        with self.assertRaisesRegex(BoardError, "recover|integration"):
            self.board.merge("A")
        self.assertEqual(Board(self.repo).recover("A")["status"], "MERGED")
        self.assertEqual(git(self.repo, "rev-parse", "HEAD"), sha)

    def test_integrated_recovery_gate_refusal_retains_path_lock(self):
        self.board.init(self.seed(self.ticket(), self.ticket("B")))
        claim = self.claim()
        sha = self.candidate(claim)
        self.board.submit("A", "worker", claim["lease_token"], sha)
        self.board.verify("A")
        with patch.object(self.board, "_accept", side_effect=KeyboardInterrupt):
            with self.assertRaises(KeyboardInterrupt):
                self.board.merge("A")
        with patch.object(self.board, "_run_gate", side_effect=BoardError("temporary oracle refusal")):
            with self.assertRaises(BoardError):
                self.board.recover("A")
        self.assertIsNone(self.claim())
        self.assertEqual(self.board.get("A")["commit_sha"], sha)
        self.assertEqual(Board(self.repo).recover("A")["status"], "MERGED")

    def test_legacy_database_migrates_interrupted_integration_without_losing_history(self):
        _, sha = self.submitted()
        self.board.verify("A")
        with patch.object(self.board, "_accept", side_effect=KeyboardInterrupt):
            with self.assertRaises(KeyboardInterrupt):
                self.board.merge("A")
        with patch.object(self.board, "_run_gate", side_effect=KeyboardInterrupt):
            with self.assertRaises(KeyboardInterrupt):
                self.board.recover("A")
        with sqlite3.connect(self.board.database) as db:
            columns = {row[1] for row in db.execute("PRAGMA table_info(tickets)")}
            if "merge_intent" in columns:
                db.execute("ALTER TABLE tickets DROP COLUMN merge_intent")
            history = db.execute("SELECT * FROM audit ORDER BY seq").fetchall()
        reopened = Board(self.repo)
        self.assertEqual(reopened.get("A")["merge_intent"], sha)
        self.assertEqual(reopened.recover("A")["status"], "MERGED")
        with sqlite3.connect(reopened.database) as db:
            self.assertEqual(db.execute("SELECT * FROM audit WHERE seq<=? ORDER BY seq", (len(history),)).fetchall(), history)
        self.assertTrue(reopened.verify_audit())

    def test_legacy_database_migration_is_atomic_and_preserves_active_lease(self):
        self.board.init(self.seed())
        claim = self.claim()
        self.board.put_artifact("A", "worker", claim["lease_token"], "feature/a.txt", b"good\n")
        before = self.board.get("A")
        before.pop("merge_intent", None)
        with sqlite3.connect(self.board.database) as db:
            db.execute("ALTER TABLE tickets DROP COLUMN merge_intent")
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            boards = list(pool.map(lambda _: Board(self.repo), range(4)))
        after = boards[0].get("A")
        self.assertIsNone(after.pop("merge_intent"))
        self.assertEqual(after, before)
        self.assertEqual(boards[0].heartbeat("A", "worker", claim["lease_token"])["epoch"], claim["epoch"])
        with sqlite3.connect(self.board.database) as db:
            self.assertEqual(db.execute("SELECT count(*) FROM audit WHERE event='STORAGE_MIGRATED'").fetchone()[0], 1)
        self.assertTrue(self.board.verify_audit())

    def test_thousand_ticket_dependency_chain_initializes(self):
        tickets = [self.ticket(f"D{i:04}", owned_paths=[f"out/{i}"],
                               depends_on=[f"D{i+1:04}"] if i < 999 else []) for i in range(1000)]
        self.board.init(self.seed(*tickets))
        self.assertEqual(self.board.get("D0000")["status"], "BLOCKED")
        self.assertEqual(self.claim()["id"], "D0999")
        with sqlite3.connect(self.board.database) as db:
            self.assertEqual(db.execute("SELECT count(*) FROM tickets").fetchone()[0], 1000)
            self.assertEqual(db.execute("SELECT count(*) FROM dependencies").fetchone()[0], 999)

    def test_candidate_cannot_add_symlink_escape(self):
        self.board.init(self.seed())
        claim = self.claim()
        work = self.board.prepare_worktree("A", "worker", claim["lease_token"])
        (work / "feature/escape").symlink_to("../../outside")
        git(work, "add", ".")
        git(work, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "escape")
        with self.assertRaisesRegex(BoardError, "symlink"):
            self.board.submit("A", "worker", claim["lease_token"], git(work, "rev-parse", "HEAD"))

    def test_existing_internal_parent_symlink_is_supported(self):
        (self.repo / "packages/model-client").mkdir(parents=True)
        (self.repo / "packages/model-client/models.json").write_text("{}\n")
        (self.repo / "pantheon/src/config").mkdir(parents=True)
        (self.repo / "pantheon/src/config/models.json").symlink_to("../../../packages/model-client/models.json")
        git(self.repo, "add", ".")
        git(self.repo, "commit", "-qm", "internal shared registry")
        self.board.init(self.seed())
        claim = self.claim()
        sha = self.candidate(claim)
        self.assertEqual(self.board.submit("A", "worker", claim["lease_token"], sha)["status"], "VERIFYING")

    def test_artifacts_must_match_owned_candidate_regular_file_bytes(self):
        self.board.init(self.seed())
        claim = self.claim()
        with self.assertRaisesRegex(BoardError, "owned|ownership"):
            self.board.put_artifact("A", "worker", claim["lease_token"], "outside.txt", b"unowned")
        self.board.put_artifact("A", "worker", claim["lease_token"], "feature/a.txt", b"different bytes")
        sha = self.candidate(claim)
        with self.assertRaisesRegex(BoardError, "Artifact|artifact"):
            self.board.submit("A", "worker", claim["lease_token"], sha)

    def test_claim_race_and_path_overlap_have_one_owner(self):
        self.board.init(self.seed(self.ticket(), self.ticket("B", owned_paths=["feature/a.txt"])))
        def acquire(i):
            return Board(self.repo).claim(f"worker{i}", "gpt-6-astra", 10)
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            claims = list(pool.map(acquire, range(8)))
        self.assertEqual(sum(c is not None for c in claims), 1)
        self.assertTrue(self.board.verify_audit())

    def test_expired_worker_is_fenced_and_new_epoch_has_new_worktree(self):
        self.board.init(self.seed())
        with patch("board.now_us", return_value=1_000_000):
            first = self.claim()
            old = self.board.prepare_worktree("A", "worker", first["lease_token"])
        with patch("board.now_us", return_value=11_000_000):
            with self.assertRaises(BoardError):
                self.board.heartbeat("A", "worker", first["lease_token"])
            second = self.claim()
            new = self.board.prepare_worktree("A", "worker", second["lease_token"])
            self.assertGreater(second["epoch"], first["epoch"])
            self.assertNotEqual(old, new)
            with self.assertRaises(BoardError):
                self.board.fail_claim("A", "worker", first["lease_token"], "late")
            with self.assertRaises(BoardError):
                self.board.heartbeat("A", "intruder", second["lease_token"])

    def test_cas_is_deduplicated_and_corruption_detected(self):
        self.board.init(self.seed())
        claim = self.claim()
        digest = self.board.put_artifact("A", "worker", claim["lease_token"], "feature/result.txt", b"evidence")
        self.assertEqual(digest, hashlib.sha256(b"evidence").hexdigest())
        self.assertEqual(self.board.put_artifact("A", "worker", claim["lease_token"], "feature/copy.txt", b"evidence"), digest)
        self.assertEqual(self.board.read_artifact(digest), b"evidence")
        blob = self.board.board_dir / "cas" / digest[:2] / digest
        blob.chmod(0o600)
        blob.write_bytes(b"tampered")
        with self.assertRaises(BoardError):
            self.board.read_artifact(digest)

    def test_submit_rejects_unowned_paths_and_wrong_worker(self):
        self.board.init(self.seed())
        claim = self.claim()
        sha = self.candidate(claim, extra="outside.txt")
        with self.assertRaises(BoardError):
            self.board.submit("A", "worker", claim["lease_token"], sha)
        with self.assertRaises(BoardError):
            self.board.submit("A", "other", claim["lease_token"], sha)
        self.assertEqual(self.board.get("A")["status"], "CLAIMED")

    def test_submit_rechecks_expiry_after_candidate_inspection(self):
        clock = [1_000_000]
        with patch("board.now_us", side_effect=lambda: clock[0]):
            self.board.init(self.seed())
            claim = self.claim()
            sha = self.candidate(claim)
            inspect = self.board._candidate
            def delayed(*args):
                result = inspect(*args)
                clock[0] = claim["lease_until"]
                return result
            with patch.object(self.board, "_candidate", side_effect=delayed):
                with self.assertRaisesRegex(BoardError, "lease|expired"):
                    self.board.submit("A", "worker", claim["lease_token"], sha)
            self.assertEqual(self.board.get("A")["status"], "CLAIMED")

    def test_gate_failure_does_not_merge_or_release_failed_artifacts(self):
        self.board.init(self.seed(self.ticket(), self.ticket("B", owned_paths=["other"], depends_on=["A"])))
        claim = self.claim()
        self.board.put_artifact("A", "worker", claim["lease_token"], "feature/a.txt", b"bad\n")
        sha = self.candidate(claim, "bad\n")
        self.board.submit("A", "worker", claim["lease_token"], sha)
        base = git(self.repo, "rev-parse", "HEAD")
        result = self.board.verify("A")
        self.assertEqual(result["status"], "READY")
        self.assertEqual(git(self.repo, "rev-parse", "HEAD"), base)
        self.assertEqual(self.board.get("B")["status"], "BLOCKED")
        with self.assertRaises(BoardError):
            self.board.merge("A")

    def test_gate_review_real_merge_unlocks_only_accepted_artifacts(self):
        self.board.init(self.seed(self.ticket(reviewer_model="claude-fable-5-2"), self.ticket("B", depends_on=["A"], owned_paths=["other"])))
        claim = self.claim()
        digest = self.board.put_artifact("A", "worker", claim["lease_token"], "feature/a.txt", b"good\n")
        sha = self.candidate(claim)
        self.board.submit("A", "worker", claim["lease_token"], sha)
        self.assertEqual(self.board.verify("A")["status"], "REVIEW")
        with self.assertRaises(BoardError):
            self.board.merge("A")
        with self.assertRaises(BoardError):
            self.board.review("A", "reviewer", "gpt-6-sol", True, "same vendor")
        self.board.review("A", "reviewer", "claude-fable-5-2", True, "checked independently")
        self.assertEqual(self.board.merge("A")["status"], "MERGED")
        self.assertEqual(git(self.repo, "rev-parse", "HEAD"), sha)
        child = self.claim()
        self.assertEqual(child["id"], "B")
        self.assertEqual([r["sha256"] for r in child["upstream_artifacts"]], [digest])
        self.assertTrue(self.board.verify_audit())

    def test_reviewed_candidate_cannot_merge_after_target_head_changes(self):
        _, sha = self.submitted()
        self.board.verify("A")
        (self.repo / "unrelated.txt").write_text("sibling\n")
        git(self.repo, "add", ".")
        git(self.repo, "commit", "-qm", "sibling")
        head = git(self.repo, "rev-parse", "HEAD")
        result = self.board.merge("A")
        self.assertEqual(result["status"], "READY")
        self.assertEqual(git(self.repo, "rev-parse", "HEAD"), head)

    def test_git_ref_cas_refuses_a_last_moment_target_change(self):
        self.board.init(self.seed())
        claim = self.claim()
        middle = self.candidate(claim, "middle\n")
        work = Path(self.board.get("A")["worktree"])
        (work / "feature/a.txt").write_text("good\n")
        git(work, "add", ".")
        git(work, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "final candidate")
        sha = git(work, "rev-parse", "HEAD")
        self.board.submit("A", "worker", claim["lease_token"], sha)
        self.board.verify("A")
        original = self.board._git
        fired = False
        def race(*args, **kwargs):
            nonlocal fired
            if not fired and ((args[0] == "merge" and not kwargs.get("cwd")) or args[0] == "update-ref"):
                fired = True
                git(self.repo, "reset", "--hard", middle)
            return original(*args, **kwargs)
        with patch.object(self.board, "_git", side_effect=race):
            with self.assertRaises(BoardError):
                self.board.merge("A")
        self.assertTrue(fired)
        self.assertEqual(git(self.repo, "rev-parse", "HEAD"), middle)
        self.assertNotEqual(self.board.get("A")["status"], "MERGED")

    def test_supervisor_states_do_not_expire_into_worker_claims(self):
        self.submitted()
        with patch("board.now_us", return_value=10**18):
            self.assertIsNone(self.claim())
        self.assertEqual(self.board.get("A")["status"], "VERIFYING")

    def test_gate_interruption_retains_lock_until_explicit_recovery(self):
        self.submitted()
        with patch.object(self.board, "_run_gate", side_effect=KeyboardInterrupt):
            with self.assertRaises(KeyboardInterrupt):
                self.board.verify("A")
        self.assertEqual(self.board.get("A")["status"], "VERIFYING")
        with self.assertRaises(BoardError):
            self.board.verify("A")
        self.assertEqual(self.board.recover("A")["status"], "REVIEW")

    def test_gate_timeout_and_output_limits_refuse_candidate(self):
        for program, timeout, cap in [("import time; time.sleep(10)", 0.1, 1024), ("print('X'*10000)", 5, 100)]:
            with self.subTest(program=program):
                other_dir = Path(self.temp.name) / hashlib.sha256(program.encode()).hexdigest()
                board = Board(self.repo, other_dir)
                board.init(self.seed(self.ticket(gate_cmd=["/usr/bin/python3", "-c", program])))
                claim = board.claim("worker", "gpt-6-astra", 10)
                work = board.prepare_worktree("A", "worker", claim["lease_token"])
                (work / "feature/a.txt").write_text("good\n")
                git(work, "add", ".")
                git(work, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "candidate")
                board.submit("A", "worker", claim["lease_token"], git(work, "rev-parse", "HEAD"))
                with patch.object(board, "GATE_TIMEOUT_SECONDS", timeout), patch.object(board, "GATE_OUTPUT_CAP", cap):
                    self.assertEqual(board.verify("A")["status"], "READY")
                self.assertRegex(board.get("A")["error"], "deadline|output limit")

    def test_audit_tampering_is_detected(self):
        self.board.init(self.seed())
        self.claim()
        with sqlite3.connect(self.board.board_dir / "board.db") as db:
            db.execute("UPDATE audit SET payload='{}' WHERE seq=1")
        self.assertFalse(self.board.verify_audit())


if __name__ == "__main__":
    unittest.main()
