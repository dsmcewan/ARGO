"""Real Git + SQLite + confined-worker integration; no vendor calls or mock Board."""
import asyncio
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

from board import Board, BoardError
from dispatch import Config, Dispatcher


def git(repo, *args):
    return subprocess.check_output(["/usr/bin/git", "-C", str(repo), *args], stderr=subprocess.PIPE).decode().strip()


class BoardDispatchTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="argo-board-integration-")
        self.addCleanup(temporary.cleanup)
        self.repo = Path(temporary.name) / "repo"
        self.repo.mkdir()
        git(self.repo, "init", "-q")
        git(self.repo, "config", "user.name", "Offline Integration")
        git(self.repo, "config", "user.email", "offline@argo.invalid")
        (self.repo / ".gitignore").write_text(".board/\n")
        (self.repo / "spec.md").write_text("Produce only the owned result; do not approve or merge.\n")
        (self.repo / "fixture.py").write_text('''import json, os
from pathlib import Path
task = json.loads(Path(os.environ['ARGO_TASK']).read_text())
assert 'lease_token' not in task
assert not Path('/workspace/.board/board.db').exists()
assert Path('/workspace/.git').read_bytes() == b''
parents = []
for item in task['upstream_artifacts']:
    data = (Path(os.environ['ARGO_INPUTS']) / item['input_path']).read_bytes()
    parents.append(json.loads(data)['ticket'])
Path(task['owned_paths'][0]).write_text(json.dumps({'ticket': task['id'], 'parents': parents}, sort_keys=True) + '\\n')
''')
        (self.repo / "gate.py").write_text('''import json, sys
from pathlib import Path
ticket, path = sys.argv[1:]
result = json.loads(Path(path).read_text())
assert result == {'ticket': ticket, 'parents': [] if ticket == 'A' else ['A']}
''')
        git(self.repo, "add", ".")
        git(self.repo, "commit", "-qm", "Trusted fixture and data oracle")
        self.base = git(self.repo, "rev-parse", "HEAD")
        self.board = Board(self.repo)
        self.seed = {"schema_version": 1, "tickets": [self.ticket("A"), self.ticket("B", ["A"])]}
        self.board.init(self.seed)

    def ticket(self, id, deps=None):
        path = f"results/{id}.json"  # Initially absent exact file, not a directory grant.
        return {"id": id, "wave": 1 if id == "A" else 2, "lane": "offline-fixture", "title": id,
                "seat_model": "gpt-6-astra", "reviewer_model": None, "owned_paths": [path],
                "gate_cmd": ["/usr/bin/python3", "gate.py", id, path], "spec_path": "spec.md",
                "depends_on": deps or [], "max_attempts": 3}

    def dispatch(self, **kwargs):
        config = Config(offline=True, command=("/usr/bin/python3", "/workspace/fixture.py"),
                        worker_id="offline-fixture", seat_model="gpt-6-astra", timeout=10,
                        lease_seconds=30, **kwargs)
        return asyncio.run(Dispatcher(self.board, config).run())

    def test_two_ticket_handoff_stops_at_verification_then_really_merges(self):
        dry_run = asyncio.run(Dispatcher(self.board, Config()).run())
        self.assertEqual(dry_run["mode"], "dry-run")
        self.assertEqual(self.board.get("A")["status"], "READY")
        first = self.dispatch()["results"][0]
        self.assertEqual(first["status"], "VERIFYING", first)
        self.assertEqual(git(self.repo, "rev-parse", "HEAD"), self.base)
        self.assertFalse((self.repo / "results/A.json").exists())
        self.assertEqual(self.board.get("B")["status"], "BLOCKED")
        self.assertEqual(self.board.verify("A")["status"], "REVIEW")
        self.assertEqual(self.board.merge("A")["status"], "MERGED")
        self.assertEqual(git(self.repo, "rev-parse", "HEAD"), first["candidate_commit"])
        self.assertEqual(self.board.get("B")["status"], "READY")
        artifact = first["artifacts"][0]
        data = (self.repo / artifact["logical_path"]).read_bytes()
        self.assertEqual(hashlib.sha256(data).hexdigest(), artifact["sha256"])
        self.assertEqual(self.board.read_artifact(artifact["sha256"]), data)
        second = self.dispatch()["results"][0]
        self.assertEqual(second["status"], "VERIFYING", second)
        self.assertEqual(self.board.get("B")["base_commit"], first["candidate_commit"])
        self.assertEqual(self.board.verify("B")["status"], "REVIEW")
        self.assertEqual(self.board.merge("B")["status"], "MERGED")
        self.assertEqual(json.loads((self.repo / "results/B.json").read_text()), {"ticket": "B", "parents": ["A"]})
        self.assertEqual(git(self.repo, "rev-parse", "HEAD"), second["candidate_commit"])
        self.assertEqual(git(self.repo, "status", "--porcelain"), "")
        self.assertTrue(self.board.verify_audit())

    def test_rejected_data_never_advances_target_or_unlocks_dependency(self):
        (self.repo / "fixture.py").write_text("from pathlib import Path\nPath('results/A.json').write_text('{}')\n")
        git(self.repo, "add", "fixture.py")
        git(self.repo, "commit", "-qm", "Fixture submits invalid data")
        head = git(self.repo, "rev-parse", "HEAD")
        result = self.dispatch()["results"][0]
        self.assertEqual(result["status"], "VERIFYING", result)
        refused = self.board.verify("A")
        self.assertEqual(refused["status"], "READY")
        self.assertEqual(self.board.get("B")["status"], "BLOCKED")
        self.assertEqual(git(self.repo, "rev-parse", "HEAD"), head)
        with self.assertRaises(BoardError):
            self.board.merge("A")
        self.assertTrue(self.board.verify_audit())


if __name__ == "__main__":
    unittest.main()
