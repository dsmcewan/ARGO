"""Offline dispatcher proofs; all workers are local fixtures, never model clients."""
import asyncio
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
import unittest
from unittest.mock import patch

import dispatch


def git(repo, *args):
    env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"),
           "HOME": str(repo), "GIT_CONFIG_NOSYSTEM": "1"}
    return subprocess.check_output(["git", "-C", str(repo), *args], env=env)


class FakeBoard:
    """A lease/CAS seam. Candidate commits still use a real temporary Git repository."""
    def __init__(self, root):
        self.repo = root / "repo"
        self.board_dir = root / "private-board"
        self.repo.mkdir()
        self.board_dir.mkdir()
        (self.repo / "owned").mkdir()
        (self.repo / "owned" / "original.txt").write_text("before\n")
        (self.repo / "unowned.txt").write_text("untouched\n")
        git(self.repo, "init", "-q")
        git(self.repo, "add", "--all")
        git(self.repo, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid",
            "commit", "-qm", "base")
        self.base = git(self.repo, "rev-parse", "HEAD").decode().strip()
        self.spec = b'{"goal":"offline fixture"}\n'
        self.upstream = b"accepted parent bytes\n"
        self.cas = {hashlib.sha256(data).hexdigest(): data for data in [self.spec, self.upstream]}
        self.row = {"id": "task-1", "status": "running", "lease_token": "secret-token",
                    "lease_until": int((time.time() + 60) * 1_000_000),
                    "base_commit": self.base, "owned_paths": ["owned/"],
                    "upstream_artifacts": [{"ticket_id": "parent-1", "logical_path": "report.txt",
                                            "sha256": hashlib.sha256(self.upstream).hexdigest()}],
                    "spec_sha256": hashlib.sha256(self.spec).hexdigest(), "epoch": 1, "attempt": 1}
        self.claims = 0
        self.heartbeats = 0
        self.failed = []
        self.submitted = []
        self.artifacts = []
        self.break_heartbeat = False
        self.worktree = root / "worker-epoch-1"

    def render(self):
        return "one ready offline fixture"

    def claim(self, worker_id, seat_model, lease_seconds=900):
        self.claims += 1
        return dict(self.row) if self.claims == 1 else None

    def heartbeat(self, task_id, worker_id, token, lease_seconds=900):
        self.heartbeats += 1
        if self.break_heartbeat:
            raise RuntimeError("lease no longer belongs to worker")
        return dict(self.row)

    def prepare_worktree(self, task_id, worker_id, token):
        git(self.repo, "worktree", "add", "--detach", str(self.worktree), self.base)
        return self.worktree

    def read_artifact(self, sha):
        return self.cas[sha]

    def put_artifact(self, task_id, worker_id, token, logical_path, data):
        sha = hashlib.sha256(data).hexdigest()
        self.cas[sha] = data
        self.artifacts.append((logical_path, sha))
        return sha

    def submit(self, task_id, worker_id, token, commit_sha):
        self.submitted.append(commit_sha)
        return {"id": task_id, "status": "VERIFYING", "candidate_commit": commit_sha}

    def fail_claim(self, task_id, worker_id, token, error):
        self.failed.append(error)
        return {"id": task_id, "status": "failed"}


class DispatcherTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="argo-dispatch-test-")
        self.root = Path(self.temp.name)
        self.board = FakeBoard(self.root)

    def tearDown(self):
        self.temp.cleanup()

    def config(self, **changes):
        values = dict(offline=True, command=("/usr/bin/python3", "-c", "pass"),
                      worker_id="offline-fixture", seat_model="requested-label", timeout=3,
                      lease_seconds=30, heartbeat_seconds=0.02)
        values.update(changes)
        return dispatch.Config(**values)

    async def test_default_dry_run_never_claims_or_starts_worker(self):
        async def forbidden(*args, **kwargs):
            self.fail("dry-run invoked a worker")
        result = await dispatch.Dispatcher(self.board, dispatch.Config(), runner=forbidden).run()
        self.assertEqual(result["mode"], "dry-run")
        self.assertEqual(self.board.claims, 0)
        self.assertFalse(self.board.worktree.exists())

    async def test_board_claim_refusals_are_bounded_dispatcher_errors(self):
        def invalid_label(*args, **kwargs):
            raise RuntimeError("unknown registered model label " + "x" * 1000)
        self.board.claim = invalid_label
        try:
            await dispatch.Dispatcher(self.board, self.config()).run()
        except Exception as error:
            self.assertIsInstance(error, dispatch.DispatchError)
            self.assertLessEqual(len(str(error)), 512)
        else:
            self.fail("invalid Board scheduling label was accepted")

    async def test_submission_contains_only_owned_bytes_and_verified_inputs(self):
        async def fixture(argv, **kwargs):
            inputs = Path(argv[argv.index("/inputs") - 1])
            self.assertEqual((inputs / "spec").read_bytes(), self.board.spec)
            manifest = json.loads((inputs / "task.json").read_text())
            self.assertNotIn("lease_token", manifest)
            self.assertEqual((inputs / manifest["upstream_artifacts"][0]["input_path"]).read_bytes(), self.board.upstream)
            (self.board.worktree / "owned" / "result.txt").write_text("fixture result\n")
            # An injected fixture can violate the mount; capture must still exclude this file.
            (self.board.worktree / "unowned.txt").write_text("must not be committed\n")
            return dispatch.ProcessResult(0, b"fixture only", b"")
        result = await dispatch.Dispatcher(self.board, self.config(), runner=fixture).run()
        self.assertEqual(result["results"][0]["status"], "VERIFYING")
        commit = self.board.submitted[0]
        self.assertRegex(commit, r"^[a-f0-9]{40}$")
        self.assertEqual(git(self.board.repo, "show", commit + ":owned/result.txt"), b"fixture result\n")
        self.assertEqual(git(self.board.repo, "show", commit + ":unowned.txt"), b"untouched\n")
        self.assertEqual(git(self.board.repo, "rev-parse", "HEAD").decode().strip(), self.board.base)
        self.assertEqual([path for path, _ in self.board.artifacts], ["owned/result.txt"])
        self.assertEqual(result["requested_seat_model"], "requested-label")
        self.assertNotIn("actual_model", result)

    async def test_corrupt_cas_prevents_worker_execution(self):
        self.board.cas[self.board.row["spec_sha256"]] = b"tampered"
        async def forbidden(*args, **kwargs):
            self.fail("corrupt CAS reached worker")
        result = await dispatch.Dispatcher(self.board, self.config(), runner=forbidden).run()
        self.assertEqual(result["results"][0]["status"], "failed")
        self.assertIn("digest", self.board.failed[0])
        self.assertFalse(self.board.submitted)

    async def test_missing_directory_hint_and_exact_file_roots_are_distinct(self):
        roots = dispatch.prepare_owned_paths(self.board.repo, ["new/output.md", "new-directory/"])
        self.assertTrue((self.board.repo / "new/output.md").is_file())
        self.assertTrue((self.board.repo / "new-directory").is_dir())
        self.assertEqual([item.path for item in roots], ["new/output.md", "new-directory"])

    async def test_no_change_and_symlink_output_refuse_submission(self):
        async def no_change(*args, **kwargs):
            return dispatch.ProcessResult(0, b"", b"")
        result = await dispatch.Dispatcher(self.board, self.config(), runner=no_change).run()
        self.assertEqual(result["results"][0]["status"], "failed")
        self.assertIn("no changes", self.board.failed[-1].lower())
        self.assertFalse(self.board.submitted)
        self.board.claims = 0
        self.board.worktree = self.root / "worker-epoch-2"
        self.board.row["epoch"] = 2
        async def symlink_output(*args, **kwargs):
            (self.board.worktree / "owned" / "escape").symlink_to(self.board.board_dir)
            return dispatch.ProcessResult(0, b"", b"")
        result = await dispatch.Dispatcher(self.board, self.config(), runner=symlink_output).run()
        self.assertEqual(result["results"][0]["status"], "failed")
        self.assertFalse(self.board.submitted)

    async def test_heartbeat_loss_cancels_worker_and_prevents_publication(self):
        async def blocked(*args, stop, **kwargs):
            self.board.break_heartbeat = True
            await asyncio.wait_for(stop.wait(), 1)
            raise dispatch.DispatchError("worker cancelled")
        result = await dispatch.Dispatcher(self.board, self.config(), runner=blocked).run()
        self.assertEqual(result["results"][0]["status"], "failed")
        self.assertIn("lease", self.board.failed[-1])
        self.assertFalse(self.board.artifacts)
        self.assertFalse(self.board.submitted)

    async def test_blocked_heartbeat_cannot_keep_worker_alive_beyond_granted_lease(self):
        calls = 0
        stopped_before_lease_overrun = []
        def blocked_heartbeat(*args, **kwargs):
            nonlocal calls
            calls += 1
            if calls == 1:
                return {**self.board.row, "lease_until": int((time.time() + 0.4) * 1_000_000)}
            time.sleep(0.7)
            raise RuntimeError("blocked heartbeat eventually refused")
        self.board.heartbeat = blocked_heartbeat
        async def blocked_worker(*args, stop, **kwargs):
            try:
                await asyncio.wait_for(stop.wait(), 0.6)
                stopped_before_lease_overrun.append(True)
            except asyncio.TimeoutError:
                stopped_before_lease_overrun.append(False)
            return dispatch.ProcessResult(0, b"", b"")
        await dispatch.Dispatcher(self.board, self.config(lease_seconds=3), runner=blocked_worker).run()
        self.assertEqual(stopped_before_lease_overrun, [True])
        self.assertFalse(self.board.artifacts)
        self.assertFalse(self.board.submitted)

    async def test_lease_is_rechecked_after_worker_exit_before_any_candidate_is_published(self):
        async def fixture(*args, **kwargs):
            (self.board.worktree / "owned" / "result.txt").write_text("too late\n")
            self.board.break_heartbeat = True
            return dispatch.ProcessResult(0, b"", b"")
        result = await dispatch.Dispatcher(self.board, self.config(), runner=fixture).run()
        self.assertEqual(result["results"][0]["status"], "failed")
        self.assertFalse(self.board.artifacts)
        self.assertFalse(self.board.submitted)

    async def test_dirty_reused_owned_tree_cannot_be_submitted_as_new_work(self):
        prepare = self.board.prepare_worktree
        def dirty(*args):
            path = prepare(*args)
            (path / "owned" / "original.txt").write_text("left by an older worker\n")
            return path
        self.board.prepare_worktree = dirty
        async def no_change(*args, **kwargs):
            return dispatch.ProcessResult(0, b"", b"")
        result = await dispatch.Dispatcher(self.board, self.config(), runner=no_change).run()
        self.assertEqual(result["results"][0]["status"], "failed")
        self.assertIn("base", self.board.failed[-1])
        self.assertFalse(self.board.submitted)

    async def test_actual_exact_file_mount_creates_only_the_declared_output(self):
        if not shutil.which("bwrap"):
            self.skipTest("Bubblewrap is not installed; missing-tool refusal has a separate test")
        self.board.row["owned_paths"] = ["new/result.md"]
        worker = "from pathlib import Path; Path('/workspace/new/result.md').write_text('exact file result\\n')"
        result = await dispatch.Dispatcher(self.board, self.config(command=("/usr/bin/python3", "-c", worker))).run()
        self.assertEqual(result["results"][0]["status"], "VERIFYING", result)
        self.assertEqual([name for name, _ in self.board.artifacts], ["new/result.md"])

    async def test_actual_bubblewrap_blocks_unowned_files_board_and_credentials(self):
        if not shutil.which("bwrap"):
            self.skipTest("Bubblewrap is not installed; missing-tool refusal has a separate test")
        secret = self.board.board_dir / "credential"
        secret.write_text("do not expose")
        worker = "\n".join([
            "from pathlib import Path",
            "import os",
            "assert 'ARGO_TEST_SECRET' not in os.environ",
            f"assert os.readlink('/proc/self/ns/net') != {os.readlink('/proc/self/ns/net')!r}",
            f"assert not Path({str(secret)!r}).exists()",
            "assert Path('/workspace/.git').read_bytes() == b''",
            "assert Path('/inputs/spec').read_bytes()",
            "try: Path('/workspace/unowned.txt').write_text('escape')",
            "except OSError: pass",
            "else: raise AssertionError('unowned path writable')",
            "try: Path('/inputs/spec').write_text('escape')",
            "except OSError: pass",
            "else: raise AssertionError('inputs writable')",
            "Path('/workspace/owned/result.txt').write_text('confined fixture\\n')",
        ])
        with patch.dict(os.environ, {"ARGO_TEST_SECRET": "parent-only-credential"}):
            result = await dispatch.Dispatcher(self.board, self.config(command=("/usr/bin/python3", "-c", worker))).run()
        self.assertEqual(result["results"][0]["status"], "VERIFYING", result)
        self.assertEqual(secret.read_text(), "do not expose")


class BoundsTests(unittest.IsolatedAsyncioTestCase):
    def test_offline_execution_requires_an_explicit_scheduling_label(self):
        with self.assertRaises(dispatch.DispatchError):
            dispatch.Config(offline=True, command=("/usr/bin/python3", "-c", "pass")).validate()

    def test_aggregate_capture_budget_stops_before_reading_later_files(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "owned").mkdir()
            for name in ["a", "b", "c"]:
                (root / "owned" / name).write_bytes(b"12345678")
            original_open = os.open
            def bounded_open(path, *args, **kwargs):
                if Path(path).name == "c":
                    raise AssertionError("capture continued reading after its aggregate budget was exhausted")
                return original_open(path, *args, **kwargs)
            with patch.object(os, "open", bounded_open), self.assertRaises(dispatch.DispatchError):
                dispatch.collect_changes(root, [dispatch.OwnedPath("owned", True)], {},
                                         dispatch.Config(max_total_bytes=8, max_artifacts=1))

    def test_empty_directories_are_bounded_during_output_traversal(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "owned").mkdir()
            for index in range(4097):
                (root / "owned" / str(index)).mkdir()
            with self.assertRaises(dispatch.DispatchError):
                dispatch.collect_changes(root, [dispatch.OwnedPath("owned", True)], {}, dispatch.Config())

    def test_unsafe_overlapping_and_symlink_owned_paths_fail_closed(self):
        for paths in [["."], ["../escape"], ["/tmp/out"], ["a/../b"], [".git/config"],
                      ["nested/.board/file"], ["src", "src/file"], ["src/", "src"]]:
            with self.subTest(paths=paths), self.assertRaises(dispatch.DispatchError):
                dispatch.normalize_owned_paths(paths)
        with tempfile.TemporaryDirectory() as root:
            (Path(root) / "link").symlink_to("/tmp")
            with self.assertRaises(dispatch.DispatchError):
                dispatch.prepare_owned_paths(Path(root), ["link/output"])

    def test_missing_bubblewrap_refuses_instead_of_running_without_isolation(self):
        with tempfile.TemporaryDirectory() as root:
            with self.assertRaises(dispatch.DispatchError):
                dispatch.sandbox_argv(Path(root), Path(root), [], ("/usr/bin/python3",), bwrap="/nonexistent/bwrap")

    async def test_output_limit_counts_bytes_and_timeout_kills_descendants(self):
        with self.assertRaises(dispatch.ProcessFailure) as overflow:
            await dispatch.run_bounded(("/usr/bin/python3", "-c", "print('😀'*100,flush=True);import time;time.sleep(10)"), timeout=2, max_output_bytes=100)
        self.assertIn("output", str(overflow.exception))
        self.assertLessEqual(len(overflow.exception.stdout) + len(overflow.exception.stderr), 100)
        code = "import subprocess,signal,time,json,os;signal.signal(signal.SIGTERM,lambda *a:None);p=subprocess.Popen(['/usr/bin/python3','-c','import signal,time;signal.signal(signal.SIGTERM,lambda *a:None);time.sleep(30)']);print(json.dumps([os.getpid(),p.pid]),flush=True);time.sleep(30)"
        with self.assertRaises(dispatch.ProcessFailure) as timed:
            await dispatch.run_bounded(("/usr/bin/python3", "-c", code), timeout=0.2, max_output_bytes=4096)
        self.assertIn("deadline", str(timed.exception))
        for pid in json.loads(timed.exception.stdout):
            stat = Path(f"/proc/{pid}/stat")
            self.assertTrue(not stat.exists() or ") Z " in stat.read_text(), f"descendant {pid} survived")

    async def test_cancellation_terminates_the_process(self):
        stop = asyncio.Event()
        asyncio.get_running_loop().call_later(0.05, stop.set)
        with self.assertRaises(dispatch.ProcessFailure):
            await dispatch.run_bounded(("/usr/bin/python3", "-c", "import time;time.sleep(30)"),
                                       timeout=2, max_output_bytes=4096, stop=stop)


if __name__ == "__main__":
    unittest.main()
