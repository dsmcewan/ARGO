#!/usr/bin/env python3
"""Offline, trusted-operator build blackboard (Python 3.11+, SQLite WAL).

All API callers are trusted dispatcher/supervisor processes. Lease capabilities
fence stale work; they do not authenticate hostile local OS processes. Never
mount the database, CAS, supervisor process, credentials or host Git metadata into
a worker. The dispatcher owns commit creation; supervisor commands are operator
operations, not model tools. No vendor calls or shell command strings exist here.

BLOCKED -> READY -> CLAIMED -> VERIFYING -> REVIEW -> MERGING -> MERGED.
VERIFYING includes submitted work and a durable running-gate reservation. REVIEW
means deterministic checks passed; review is an additional condition, never a
replacement for checks. MERGING is a crash-recovery marker for the Git/SQLite
transaction boundary. These supervisor states never expire into worker leases.
recover() reruns checks; it may reconcile MERGING only when Git names the exact
recorded candidate. A stale target instead requires a new lease, rebase and gate.

Gate scripts, test oracles, dependency manifests, controller sources and explicit
argv file inputs are pinned at init. Changing protected policy needs a new board
created by the operator. Gate commands run in Bubblewrap with no network, host
repository or board mounted. Dependencies are NOT installed or fetched: gates
must be Python standard-library data validators under /usr, using a direct pinned
script or inline source. A trusted isolated wrapper denies candidate/dynamic code
execution and subprocess creation, and issues an explicit completion record.
Direct Node/pytest/module/application-test commands are unsupported. Application
tests and approved dependency caches require a separately reviewed external-process
oracle adapter (such as the existing ARGO controller), not candidate imports.
Audit verification checks the surviving local hash chain; without an external
trusted head it cannot detect rollback/truncation of the whole local database.
"""
from __future__ import annotations

import argparse
from contextlib import closing, contextmanager
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import selectors
import shutil
import signal
import sqlite3
import stat
import subprocess
import tempfile
import time
import uuid


class BoardError(RuntimeError):
    """A refused operation; no worker-granted authority is implied."""


def now_us() -> int:
    return time.time_ns() // 1000


def canonical(value) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def relative_path(value: str) -> str:
    if not isinstance(value, str) or not value or len(value) > 512 or "\\" in value or "\x00" in value:
        raise BoardError("Invalid relative path")
    parts = value.split("/")
    if any(p in ("", ".", "..", ".git", ".board") for p in parts) or value.startswith("/"):
        raise BoardError("Unsafe relative path")
    if any(ord(c) < 32 for c in value):
        raise BoardError("Control character in path")
    return value


def overlaps(a: str, b: str) -> bool:
    a, b = a.rstrip("/"), b.rstrip("/")
    return a == b or a.startswith(b + "/") or b.startswith(a + "/")


def vendor(model: str) -> str:
    # Full model IDs only; aliases cannot manufacture an independent vendor.
    for prefix, name in (("gpt-", "openai"), ("claude-", "anthropic"), ("gemini-", "google"), ("grok-", "xai")):
        if isinstance(model, str) and model.startswith(prefix) and re.fullmatch(r"[a-zA-Z0-9._-]{3,100}", model):
            return name
    raise BoardError("Unknown model vendor; use a full registered vendor model ID")


def bounded_process(argv: list[str], cwd: Path, *, timeout: float = 30, cap: int = 4 * 1024 * 1024,
                    env: dict | None = None) -> tuple[int, bytes]:
    """Bound both pipes together; terminate the entire process group on all exits."""
    process = subprocess.Popen(argv, cwd=cwd, env=env, stdin=subprocess.DEVNULL,
                               stdout=subprocess.PIPE, stderr=subprocess.STDOUT, start_new_session=True)
    output = bytearray()
    deadline = time.monotonic() + timeout
    try:
        with selectors.DefaultSelector() as poll:
            poll.register(process.stdout, selectors.EVENT_READ)
            while poll.get_map():
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise BoardError("Process deadline exceeded")
                for key, _ in poll.select(min(remaining, 0.1)):
                    part = os.read(key.fileobj.fileno(), 65536)
                    if not part:
                        poll.unregister(key.fileobj)
                        continue
                    output.extend(part)
                    if len(output) > cap:
                        raise BoardError("Process output limit exceeded")
            code = process.wait(timeout=max(0.001, deadline - time.monotonic()))
            return code, bytes(output)
    finally:
        # Even successful parents must not leave descendants behind.
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.wait()
        process.stdout.close()


class Board:
    GATE_TIMEOUT_SECONDS = 120
    GATE_OUTPUT_CAP = 1024 * 1024
    ARTIFACT_CAP = 16 * 1024 * 1024
    LOCKED_STATES = ("CLAIMED", "VERIFYING", "REVIEW", "MERGING")

    def __init__(self, repo: Path, board_dir: Path | None = None):
        self.repo = Path(repo).resolve()
        self.board_dir = Path(board_dir).resolve() if board_dir else self.repo / ".board"
        if self._git("rev-parse", "--show-toplevel").strip() != str(self.repo):
            raise BoardError("Board requires the target Git worktree root")
        self.board_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
        for name in ("cas", "tickets", "worktrees", "gates"):
            (self.board_dir / name).mkdir(mode=0o700, exist_ok=True)
        self.database = self.board_dir / "board.db"
        with closing(self._connect()) as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.executescript("""
                CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS tickets (
                    id TEXT PRIMARY KEY, definition TEXT NOT NULL, spec_sha256 TEXT NOT NULL,
                    policy TEXT NOT NULL, status TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0,
                    attempt INTEGER NOT NULL DEFAULT 0, epoch INTEGER NOT NULL DEFAULT 0,
                    worker_id TEXT, lease_token TEXT, lease_until INTEGER, base_commit TEXT,
                    commit_sha TEXT, worktree TEXT, gate_run TEXT, gate_result TEXT,
                    reviewer_id TEXT, review_model TEXT, review_approved INTEGER,
                    error TEXT, merged_commit TEXT, merge_intent TEXT
                );
                CREATE TABLE IF NOT EXISTS dependencies (
                    ticket_id TEXT REFERENCES tickets(id), dependency_id TEXT REFERENCES tickets(id),
                    PRIMARY KEY(ticket_id,dependency_id)
                );
                CREATE TABLE IF NOT EXISTS artifacts (
                    ticket_id TEXT REFERENCES tickets(id), epoch INTEGER NOT NULL,
                    logical_path TEXT NOT NULL, sha256 TEXT NOT NULL, accepted INTEGER NOT NULL DEFAULT 0,
                    PRIMARY KEY(ticket_id,epoch,logical_path)
                );
                CREATE TABLE IF NOT EXISTS audit (
                    seq INTEGER PRIMARY KEY, at_us INTEGER NOT NULL, event TEXT NOT NULL,
                    ticket_id TEXT, payload TEXT NOT NULL, previous_hash TEXT, hash TEXT NOT NULL
                );
            """)
        # Serialize the additive migration with every other board writer. Older
        # supervisors must be stopped before upgrading their executable policy.
        with self._tx() as db:
            columns = {row["name"] for row in db.execute("PRAGMA table_info(tickets)")}
            if "merge_intent" not in columns:
                db.execute("ALTER TABLE tickets ADD COLUMN merge_intent TEXT")
                for row in db.execute("SELECT * FROM tickets WHERE status IN ('MERGING','VERIFYING','REVIEW') AND commit_sha IS NOT NULL").fetchall():
                    # Old recovery changed MERGING to VERIFYING/REVIEW. Its
                    # append-only history still identifies the current attempt's
                    # integration intent; a subsequent claim starts a new attempt.
                    latest = db.execute("SELECT event FROM audit WHERE ticket_id=? AND event IN ('CLAIMED','MERGE_STARTED') ORDER BY seq DESC LIMIT 1", (row["id"],)).fetchone()
                    if row["status"] == "MERGING" or (latest and latest["event"] == "MERGE_STARTED"):
                        self._change(db, row, "MERGE_INTENT_RECOVERED", merge_intent=row["commit_sha"])
                self._record(db, "STORAGE_MIGRATED", None, {"added_column": "tickets.merge_intent"})
        self.database.chmod(0o600)

    def _connect(self):
        db = sqlite3.connect(self.database, timeout=10, isolation_level=None)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        db.execute("PRAGMA busy_timeout=10000")
        db.execute("PRAGMA synchronous=FULL")
        return db

    @contextmanager
    def _tx(self):
        db = self._connect()
        try:
            db.execute("BEGIN IMMEDIATE")
            yield db
            db.commit()
        except BaseException:
            db.rollback()
            raise
        finally:
            db.close()

    def _git(self, *args, cwd=None, binary=False):
        env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "LANG": "C.UTF-8",
               "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": "/dev/null", "GIT_TERMINAL_PROMPT": "0"}
        code, data = bounded_process(["git", "-c", "core.hooksPath=/dev/null", *args],
                                     Path(cwd) if cwd else self.repo, env=env, cap=64 * 1024 * 1024)
        if code:
            raise BoardError("Git operation refused: " + data.decode("utf8", "replace")[:1000])
        return data if binary else data.decode("utf8")

    def _row(self, db, ticket_id):
        row = db.execute("SELECT * FROM tickets WHERE id=?", (ticket_id,)).fetchone()
        if row is None:
            raise BoardError("Unknown ticket")
        return row

    def _record(self, db, event, ticket_id, payload):
        last = db.execute("SELECT seq,at_us,hash FROM audit ORDER BY seq DESC LIMIT 1").fetchone()
        entry = {"seq": last["seq"] + 1 if last else 1,
                 "at_us": max(now_us(), last["at_us"] + 1 if last else 0), "event": event,
                 "ticket_id": ticket_id, "payload": payload, "previous_hash": last["hash"] if last else None}
        db.execute("INSERT INTO audit VALUES (?,?,?,?,?,?,?)", (entry["seq"], entry["at_us"], event,
                   ticket_id, canonical(payload), entry["previous_hash"], digest(canonical(entry).encode())))

    def _change(self, db, row, event, **changes):
        if row["status"] == "CLAIMED" and event != "LEASE_EXPIRED" and row["lease_until"] <= now_us():
            raise BoardError("Worker lease expired before transition")
        fields = dict(changes, revision=row["revision"] + 1)
        result = db.execute("UPDATE tickets SET " + ",".join(f"{k}=?" for k in fields) + " WHERE id=? AND revision=?",
                            [*fields.values(), row["id"], row["revision"]])
        if result.rowcount != 1:
            raise BoardError("Ticket compare-and-swap conflict")
        # Tokens are capabilities; audit only the fencing epoch, never the token.
        public = {k: v for k, v in fields.items() if k != "lease_token"}
        self._record(db, event, row["id"], {"from": row["status"], "changes": public})
        return self._row(db, row["id"])

    def _view(self, db, row):
        value = dict(json.loads(row["definition"]), **{k: row[k] for k in row.keys() if k not in ("definition", "policy")})
        value["gate_result"] = json.loads(row["gate_result"]) if row["gate_result"] else None
        value["upstream_artifacts"] = [dict(r) for r in db.execute("""
            SELECT a.ticket_id,a.logical_path,a.sha256 FROM artifacts a JOIN dependencies d
            ON d.dependency_id=a.ticket_id JOIN tickets t ON t.id=a.ticket_id
            WHERE d.ticket_id=? AND t.status='MERGED' AND a.accepted=1 ORDER BY a.ticket_id,a.logical_path
        """, (row["id"],))]
        return value

    def get(self, ticket_id):
        with self._tx() as db:
            return self._view(db, self._row(db, ticket_id))

    def _cas(self, data: bytes):
        if not isinstance(data, bytes) or len(data) > self.ARTIFACT_CAP:
            raise BoardError("Artifact must be bounded bytes")
        sha = digest(data)
        path = self.board_dir / "cas" / sha[:2] / sha
        path.parent.mkdir(mode=0o700, exist_ok=True)
        if path.exists():
            self.read_artifact(sha)
            return sha
        fd, temporary = tempfile.mkstemp(prefix=".blob-", dir=path.parent)
        try:
            with os.fdopen(fd, "wb") as stream:
                stream.write(data)
                stream.flush()
                os.fsync(stream.fileno())
            os.chmod(temporary, 0o400)
            try:
                os.link(temporary, path)  # Atomic create-if-absent; never replace bytes.
            except FileExistsError:
                self.read_artifact(sha)
            directory = os.open(path.parent, os.O_DIRECTORY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
        finally:
            os.unlink(temporary)
        return sha

    def read_artifact(self, sha256):
        if not isinstance(sha256, str) or not re.fullmatch(r"[a-f0-9]{64}", sha256):
            raise BoardError("Invalid artifact digest")
        path = self.board_dir / "cas" / sha256[:2] / sha256
        try:
            if path.is_symlink() or path.stat().st_size > self.ARTIFACT_CAP:
                raise BoardError("Unsafe CAS object")
            data = path.read_bytes()
        except OSError as error:
            raise BoardError("Missing CAS object") from error
        if digest(data) != sha256:
            raise BoardError("CAS digest mismatch")
        return data

    def _tree(self, sha):
        entries = {}
        for record in self._git("ls-tree", "-rz", "--full-tree", sha, binary=True).split(b"\0"):
            if not record:
                continue
            header, raw_path = record.split(b"\t", 1)
            mode, kind, oid = header.decode().split()
            path = relative_path(raw_path.decode("utf8"))
            if kind != "blob" or mode not in ("100644", "100755", "120000"):
                raise BoardError("Unsupported Git tree entry (including submodules)")
            entries[path] = {"mode": mode, "oid": oid}
        return entries

    def _safe_file(self, relative):
        path = self.repo / relative_path(relative)
        for parent in [path, *path.parents]:
            if parent == self.repo:
                break
            if parent.is_symlink():
                raise BoardError("Symlink source is not allowed")
        if not path.is_file():
            raise BoardError("Missing specification source")
        return path

    def _policy(self, definition, tree):
        command = definition["gate_cmd"]
        executable = shutil.which(command[0], path="/usr/bin:/bin")
        if not executable:
            raise BoardError("Gate executable is not installed")
        executable = str(Path(executable).resolve())
        if not Path(executable).is_relative_to(Path("/usr")):
            raise BoardError("Gate runtime must be installed under /usr; custom runtime mounts are unsupported")
        if self.repo == Path(executable) or self.repo in Path(executable).parents:
            raise BoardError("Gate executable must be an installed trusted runtime")
        files = {}
        explicit = {arg for arg in command[1:] if isinstance(arg, str) and arg in tree}
        runtime = Path(executable).name
        # A grader that does not exist until the candidate creates it cannot be
        # trusted policy. Supported interpreter modes are explicit tracked source,
        # a tracked Python module, or immutable inline code contained in the seed.
        if runtime.startswith("python"):
            if len(command) < 2:
                raise BoardError("Gate interpreter requires pinned source")
            first = command[1]
            if first == "-c":
                if len(command) < 3:
                    raise BoardError("Gate inline source is missing")
            elif first.startswith("-") or first not in tree or tree[first]["mode"] == "120000":
                raise BoardError("Gate source must be a tracked relative regular file at init")
            else:
                explicit.add(first)
        else:
            raise BoardError("Unsupported gate runtime: v1 requires an isolated Python data validator")
        for path, entry in tree.items():
            parts = PurePosixPath(path).parts
            protected = (path in explicit or parts[0] in ("scripts", "controller", "TESTS") or
                         "tests" in parts or PurePosixPath(path).name in
                         ("package.json", "package-lock.json", "pyproject.toml", "Cargo.lock", ".npmrc", "tsconfig.json") or
                         path in ("tools/board.py", "tools/board_support.py", "SYSTEMS/CONTRACT_FREEZE.json"))
            if protected:
                files[path] = entry
        return {"argv": [executable, *command[1:]], "executable_sha256": digest(Path(executable).read_bytes()),
                "wrapper_sha256": digest(Path(__file__).with_name("board_support.py").read_bytes()), "files": files}

    def init(self, seed: dict):
        if not isinstance(seed, dict) or set(seed) != {"schema_version", "tickets"} or seed["schema_version"] != 1:
            raise BoardError("Unsupported board seed")
        tickets = seed["tickets"]
        if not isinstance(tickets, list) or not tickets or len(tickets) > 1000:
            raise BoardError("Seed requires 1..1000 tickets")
        required = {"id", "wave", "lane", "title", "seat_model", "reviewer_model", "owned_paths", "gate_cmd", "spec_path", "depends_on", "max_attempts"}
        definitions = {}
        for original in tickets:
            if not isinstance(original, dict) or set(original) != required:
                raise BoardError("Unexpected ticket fields")
            item = json.loads(canonical(original))
            if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,95}", item["id"]) or item["id"] in definitions:
                raise BoardError("Invalid or duplicate ticket ID")
            for field in ("title", "lane"):
                if not isinstance(item[field], str) or not 1 <= len(item[field]) <= 500:
                    raise BoardError("Invalid ticket text")
            if type(item["wave"]) is not int or not 0 <= item["wave"] <= 1000:
                raise BoardError("Invalid wave")
            if type(item["max_attempts"]) is not int or not 1 <= item["max_attempts"] <= 20:
                raise BoardError("Invalid attempt limit")
            vendor(item["seat_model"])
            if item["reviewer_model"] is not None and vendor(item["reviewer_model"]) == vendor(item["seat_model"]):
                raise BoardError("Independent review requires another vendor")
            if not isinstance(item["owned_paths"], list) or not 1 <= len(item["owned_paths"]) <= 100:
                raise BoardError("Owned paths must be a bounded nonempty list")
            paths = [relative_path(p[:-1] if isinstance(p, str) and p.endswith("/") else p) for p in item["owned_paths"]]
            if any(overlaps(a, b) for i, a in enumerate(paths) for b in paths[i + 1:]):
                raise BoardError("Owned paths overlap within ticket")
            cmd = item["gate_cmd"]
            if not isinstance(cmd, list) or not 1 <= len(cmd) <= 64 or any(not isinstance(a, str) or not a or len(a) > 8192 or "\0" in a for a in cmd):
                raise BoardError("Gate requires bounded argv, never a shell string")
            relative_path(item["spec_path"])
            if not isinstance(item["depends_on"], list) or any(not isinstance(d, str) for d in item["depends_on"]) or len(set(item["depends_on"])) != len(item["depends_on"]):
                raise BoardError("Invalid dependency list")
            definitions[item["id"]] = item
        remaining = {id: len(item["depends_on"]) for id, item in definitions.items()}
        dependents = {id: [] for id in definitions}
        for id, item in definitions.items():
            for dependency in item["depends_on"]:
                if dependency not in definitions:
                    raise BoardError("Missing dependency or dependency cycle")
                dependents[dependency].append(id)
        ready = [id for id, count in remaining.items() if count == 0]
        visited = 0
        while ready:
            visited += 1
            for dependent in dependents[ready.pop()]:
                remaining[dependent] -= 1
                if remaining[dependent] == 0:
                    ready.append(dependent)
        if visited != len(definitions):
            raise BoardError("Missing dependency or dependency cycle")
        seed_json = canonical(seed)
        with self._tx() as db:
            previous = db.execute("SELECT value FROM meta WHERE key='seed'").fetchone()
            if previous:
                if previous[0] != seed_json:
                    raise BoardError("Seed is immutable; cannot replace running task definitions")
                return
            base = self._git("rev-parse", "HEAD").strip()
            tree = self._tree(base)
            prepared = []
            for id, item in definitions.items():
                spec = self._cas(self._safe_file(item["spec_path"]).read_bytes())
                policy = self._policy(item, tree)
                prepared.append((id, item, spec, policy))
            db.execute("INSERT INTO meta VALUES ('seed',?)", (seed_json,))
            db.execute("INSERT INTO meta VALUES ('initial_commit',?)", (base,))
            self._record(db, "INIT", None, {"seed_sha256": digest(seed_json.encode()), "base_commit": base})
            for id, item, spec, policy in prepared:
                status = "BLOCKED" if item["depends_on"] else "READY"
                db.execute("INSERT INTO tickets(id,definition,spec_sha256,policy,status) VALUES(?,?,?,?,?)",
                           (id, canonical(item), spec, canonical(policy), status))
                snapshot = canonical({"definition": item, "spec_sha256": spec, "policy": policy}).encode()
                for suffix, contents in ((".json", snapshot), (".spec", self.read_artifact(spec))):
                    path = self.board_dir / "tickets" / (id + suffix)
                    if path.exists() and path.read_bytes() != contents:
                        raise BoardError("Immutable ticket file differs")
                    if not path.exists():
                        with path.open("xb") as file:
                            file.write(contents)
                            file.flush()
                            os.fsync(file.fileno())
                        path.chmod(0o400)
                self._record(db, "TICKET_CREATED", id, {"status": status, "definition_sha256": digest(snapshot)})
            for id, item in definitions.items():
                db.executemany("INSERT INTO dependencies VALUES (?,?)", [(id, dep) for dep in item["depends_on"]])

    def _retry(self, db, row, event, error):
        if row["merge_intent"]:
            raise BoardError("Unresolved integration requires recovery; its path lock cannot be released")
        definition = json.loads(row["definition"])
        status = "FAILED" if row["attempt"] >= definition["max_attempts"] else "READY"
        return self._change(db, row, event, status=status, worker_id=None, lease_token=None, lease_until=None,
                            gate_run=None, gate_result=None, reviewer_id=None, review_model=None,
                            review_approved=None, commit_sha=None, error=str(error)[:2000])

    def _lease(self, db, id, worker, token):
        row = self._row(db, id)
        if row["status"] != "CLAIMED" or row["worker_id"] != worker or row["lease_token"] != token or row["lease_until"] <= now_us():
            raise BoardError("Worker lease expired, fenced, or owned by another worker")
        return row

    @staticmethod
    def _duration(seconds):
        if type(seconds) is not int or not 1 <= seconds <= 3600:
            raise BoardError("Lease must be 1..3600 seconds")
        return seconds * 1_000_000

    def claim(self, worker_id, seat_model, lease_seconds=900):
        duration = self._duration(lease_seconds)
        if not isinstance(worker_id, str) or not re.fullmatch(r"[A-Za-z0-9_.-]{1,100}", worker_id):
            raise BoardError("Invalid worker identity")
        vendor(seat_model)
        with self._tx() as db:
            for expired in db.execute("SELECT * FROM tickets WHERE status='CLAIMED' AND lease_until<=?", (now_us(),)).fetchall():
                self._retry(db, expired, "LEASE_EXPIRED", "Worker lease expired")
            rows = db.execute("SELECT * FROM tickets WHERE status='READY' ORDER BY id").fetchall()
            rows.sort(key=lambda r: (json.loads(r["definition"])["wave"], r["id"]))
            held = [json.loads(r[0])["owned_paths"] for r in db.execute("SELECT definition FROM tickets WHERE status IN ('CLAIMED','VERIFYING','REVIEW','MERGING')")]
            for row in rows:
                definition = json.loads(row["definition"])
                if definition["seat_model"] != seat_model or any(overlaps(a, b) for a in definition["owned_paths"] for paths in held for b in paths):
                    continue
                if db.execute("SELECT 1 FROM dependencies d JOIN tickets t ON t.id=d.dependency_id WHERE d.ticket_id=? AND t.status!='MERGED'", (row["id"],)).fetchone():
                    continue
                row = self._change(db, row, "CLAIMED", status="CLAIMED", worker_id=worker_id,
                                   lease_token=uuid.uuid4().hex, lease_until=now_us() + duration,
                                   attempt=row["attempt"] + 1, epoch=row["epoch"] + 1,
                                   base_commit=self._git("rev-parse", "HEAD").strip(), worktree=None,
                                   commit_sha=None, error=None, gate_result=None, review_approved=None)
                return self._view(db, row)
            return None

    def heartbeat(self, ticket_id, worker_id, lease_token, lease_seconds=900):
        duration = self._duration(lease_seconds)
        with self._tx() as db:
            row = self._lease(db, ticket_id, worker_id, lease_token)
            return self._view(db, self._change(db, row, "HEARTBEAT", lease_until=now_us() + duration))

    def prepare_worktree(self, ticket_id, worker_id, lease_token):
        with self._tx() as db:
            row = self._lease(db, ticket_id, worker_id, lease_token)
            if row["worktree"]:
                path = Path(row["worktree"])
                if not path.is_dir():
                    raise BoardError("Prepared worktree disappeared")
                return path
            path = self.board_dir / "worktrees" / f"{ticket_id}-{row['epoch']}-{uuid.uuid4().hex[:10]}"
            self._git("worktree", "add", "--detach", str(path), row["base_commit"])
            self._change(db, row, "WORKTREE_PREPARED", worktree=str(path))
            return path

    def put_artifact(self, ticket_id, worker_id, lease_token, logical_path, data):
        logical_path = relative_path(logical_path)
        with self._tx() as db:
            row = self._lease(db, ticket_id, worker_id, lease_token)
            owned_paths = json.loads(row["definition"])["owned_paths"]
            if not any(logical_path == p.rstrip("/") or logical_path.startswith(p.rstrip("/") + "/") for p in owned_paths):
                raise BoardError("Artifact path is outside ticket ownership")
            sha = self._cas(data)
            self._lease(db, ticket_id, worker_id, lease_token)
            prior = db.execute("SELECT sha256 FROM artifacts WHERE ticket_id=? AND epoch=? AND logical_path=?",
                               (ticket_id, row["epoch"], logical_path)).fetchone()
            if prior:
                if prior[0] != sha:
                    raise BoardError("Artifact reference is immutable within an attempt")
                return sha
            db.execute("INSERT INTO artifacts(ticket_id,epoch,logical_path,sha256) VALUES(?,?,?,?)", (ticket_id, row["epoch"], logical_path, sha))
            self._record(db, "ARTIFACT_ADDED", ticket_id, {"epoch": row["epoch"], "logical_path": logical_path, "sha256": sha})
            return sha

    def _candidate(self, row, sha):
        if not isinstance(sha, str) or not re.fullmatch(r"[a-f0-9]{40}", sha):
            raise BoardError("Candidate must be an immutable full Git commit SHA")
        if self._git("rev-parse", sha + "^{commit}").strip() != sha:
            raise BoardError("Candidate is not a commit")
        self._git("merge-base", "--is-ancestor", row["base_commit"], sha)
        definition = json.loads(row["definition"])
        changed = self._git("diff", "--name-only", "--no-renames", "-z", row["base_commit"], sha, binary=True).split(b"\0")
        for raw in changed:
            if raw:
                path = relative_path(raw.decode("utf8"))
                if not any(path == owned.rstrip("/") or path.startswith(owned.rstrip("/") + "/") for owned in definition["owned_paths"]):
                    raise BoardError("Candidate changes a path outside ticket ownership")
        tree = self._tree(sha)
        for path, expected in json.loads(row["policy"])["files"].items():
            if tree.get(path) != expected:
                raise BoardError("Candidate changes pinned gate policy")
        for path, entry in tree.items():
            if entry["mode"] == "120000":
                target = self._git("cat-file", "blob", entry["oid"], binary=True).decode("utf8")
                parts = list(PurePosixPath(path).parent.parts)
                if target.startswith("/") or not target or "\x00" in target:
                    raise BoardError("Candidate symlink escapes or names control metadata")
                for part in target.split("/"):
                    if part in (".git", ".board"):
                        raise BoardError("Candidate symlink names control metadata")
                    if part == "..":
                        if not parts:
                            raise BoardError("Candidate symlink escapes repository")
                        parts.pop()
                    elif part not in ("", "."):
                        parts.append(part)
                linked = tree.get("/".join(parts))
                if not linked or linked["mode"] == "120000":
                    raise BoardError("Candidate symlink must name an internal regular file")
        with closing(self._connect()) as db:
            artifacts = db.execute("SELECT logical_path,sha256 FROM artifacts WHERE ticket_id=? AND epoch=?", (row["id"], row["epoch"])).fetchall()
        for artifact in artifacts:
            path = artifact["logical_path"]
            entry = tree.get(path)
            if not any(path == p.rstrip("/") or path.startswith(p.rstrip("/") + "/") for p in definition["owned_paths"]) or not entry or entry["mode"] not in ("100644", "100755"):
                raise BoardError("Artifact must name an owned candidate regular file")
            committed = self._git("cat-file", "blob", entry["oid"], binary=True)
            if digest(committed) != artifact["sha256"] or self.read_artifact(artifact["sha256"]) != committed:
                raise BoardError("Artifact bytes differ from the exact candidate")
        return tree

    def submit(self, ticket_id, worker_id, lease_token, commit_sha):
        with self._tx() as db:
            row = self._lease(db, ticket_id, worker_id, lease_token)
            self._candidate(row, commit_sha)
            return self._view(db, self._change(db, row, "SUBMITTED", status="VERIFYING", commit_sha=commit_sha,
                                             lease_token=None, lease_until=None, gate_run=None))

    def fail_claim(self, ticket_id, worker_id, lease_token, error):
        with self._tx() as db:
            row = self._lease(db, ticket_id, worker_id, lease_token)
            return self._view(db, self._retry(db, row, "WORKER_FAILED", error))

    def _materialize(self, sha, directory, tree):
        for name, entry in tree.items():
            path = directory / name
            path.parent.mkdir(parents=True, exist_ok=True)
            data = self._git("cat-file", "blob", entry["oid"], binary=True)
            if entry["mode"] == "120000":
                path.symlink_to(data.decode("utf8"))
            else:
                path.write_bytes(data)
                path.chmod(0o755 if entry["mode"] == "100755" else 0o644)
        # Independent Git metadata contains only this snapshot; host object storage
        # and refs never enter the gate namespace. Raw tree extraction avoids archive attributes.
        self._git("init", "-q", cwd=directory)
        self._git("add", "--all", cwd=directory)
        self._git("-c", "user.name=ARGO Gate", "-c", "user.email=gate@argo.invalid", "commit", "-qm", "isolated candidate", cwd=directory)

    def _run_gate(self, row):
        tree = self._candidate(row, row["commit_sha"])
        policy = json.loads(row["policy"])
        executable = Path(policy["argv"][0])
        if digest(executable.read_bytes()) != policy["executable_sha256"]:
            raise BoardError("Pinned gate executable changed")
        wrapper = Path(__file__).with_name("board_support.py").resolve()
        if digest(wrapper.read_bytes()) != policy["wrapper_sha256"]:
            raise BoardError("Pinned supervisor gate wrapper changed")
        bwrap = shutil.which("bwrap")
        if not bwrap or os.name != "posix":
            raise BoardError("Bubblewrap is required; no unconfined fallback")
        with tempfile.TemporaryDirectory(prefix="gate-", dir=self.board_dir / "gates") as name:
            directory = Path(name)
            self._materialize(row["commit_sha"], directory, tree)
            args = [bwrap, "--unshare-all", "--cap-drop", "ALL", "--die-with-parent", "--new-session",
                    "--ro-bind", "/usr", "/usr", "--symlink", "usr/bin", "/bin", "--symlink", "usr/sbin", "/sbin",
                    "--symlink", "usr/lib", "/lib", "--symlink", "usr/lib64", "/lib64",
                    "--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp", "--dir", "/workspace",
                    "--bind", str(directory), "/workspace", "--chdir", "/workspace", "--clearenv",
                    "--setenv", "PATH", "/usr/local/bin:/usr/bin:/bin", "--setenv", "HOME", "/tmp",
                    "--setenv", "LANG", "C.UTF-8", "--setenv", "ARGO_CANDIDATE_COMMIT", row["commit_sha"]]
            for path in policy["files"]:
                args += ["--ro-bind", str(directory / path), "/workspace/" + path]
            completion = uuid.uuid4().hex
            argv = policy["argv"]
            if argv[1] == "-c":
                source = argv[2].encode()
                config = {"kind": "inline", "source": argv[2], "argv": ["-c", *argv[3:]]}
            else:
                source = (directory / argv[1]).read_bytes()
                config = {"kind": "file", "source": "/workspace/" + argv[1], "argv": ["/workspace/" + argv[1], *argv[2:]]}
            config.update(source_sha256=digest(source), completion=completion)
            args += ["--ro-bind", str(wrapper), "/board-gate.py", "--", str(executable), "-I", "-S", "/board-gate.py", canonical(config)]
            code, output = bounded_process(args, directory, timeout=self.GATE_TIMEOUT_SECONDS, cap=self.GATE_OUTPUT_CAP,
                                           env={"PATH": "/usr/bin:/bin", "LANG": "C.UTF-8"})
            # Gate code may create reports, but cannot change any tested tracked byte.
            for path, entry in tree.items():
                file = directory / path
                if entry["mode"] == "120000":
                    data = os.readlink(file).encode()
                else:
                    if file.is_symlink() or not file.is_file():
                        raise BoardError("Gate changed a tracked file type")
                    data = file.read_bytes()
                oid = hashlib.sha1(f"blob {len(data)}\0".encode() + data).hexdigest()
                if oid != entry["oid"]:
                    raise BoardError("Gate changed candidate bytes")
            completed = output.count(("\nARGO_GATE_COMPLETED " + completion + "\n").encode()) == 1
            return {"passed": code == 0 and completed, "completed": completed, "exit_code": code, "output_sha256": digest(output),
                    "output_tail": output[-2000:].decode("utf8", "replace"), "candidate": row["commit_sha"],
                    "policy_sha256": digest(row["policy"].encode()), "at_us": now_us()}

    def verify(self, ticket_id):
        with self._tx() as db:
            row = self._row(db, ticket_id)
            if row["status"] != "VERIFYING" or row["gate_run"] is not None:
                raise BoardError("Ticket is not awaiting verification; interrupted runs require recover")
            run_id = uuid.uuid4().hex
            row = dict(self._change(db, row, "GATE_STARTED", gate_run=run_id))
        # Interruptions retain VERIFYING and the run reservation. Only deterministic
        # refusals release an attempt; operator recovery must explicitly rerun checks.
        try:
            result = self._run_gate(row)
        except (BoardError, OSError) as error:
            result = {"passed": False, "candidate": row["commit_sha"], "error": str(error)[:2000], "at_us": now_us()}
        with self._tx() as db:
            current = self._row(db, ticket_id)
            if current["status"] != "VERIFYING" or current["gate_run"] != run_id:
                raise BoardError("Gate completion was fenced")
            self._record(db, "GATE_RESULT", ticket_id, result)
            if result["passed"]:
                current = self._change(db, current, "GATE_PASSED", status="REVIEW", gate_run=None, gate_result=canonical(result))
            elif current["merge_intent"]:
                # Git may already contain this attempt. Never make its paths
                # claimable or discard the candidate merely because recovery's
                # oracle refused or became temporarily unavailable.
                current = self._change(db, current, "RECOVERY_GATE_FAILED", status="MERGING", gate_run=None,
                                       gate_result=canonical(result), error="Integrated candidate failed recovery verification; operator investigation required")
            else:
                current = self._retry(db, current, "GATE_FAILED", result.get("error", result.get("output_tail", "Gate failed")))
            return self._view(db, current)

    def review(self, ticket_id, reviewer_id, reviewer_model, approved, notes):
        if type(approved) is not bool or not isinstance(notes, str) or len(notes) > 16000:
            raise BoardError("Invalid review payload")
        with self._tx() as db:
            row = self._row(db, ticket_id)
            definition = json.loads(row["definition"])
            if row["status"] != "REVIEW" or not row["gate_result"]:
                raise BoardError("Review requires a passed exact-candidate deterministic gate")
            if not isinstance(reviewer_id, str) or not reviewer_id or reviewer_id == row["worker_id"]:
                raise BoardError("Reviewer identity must be independent")
            if vendor(reviewer_model) == vendor(definition["seat_model"]) or definition["reviewer_model"] != reviewer_model:
                raise BoardError("Review requires the assigned independent vendor/model")
            self._record(db, "REVIEW_RECORDED", ticket_id, {"candidate": row["commit_sha"], "reviewer_id": reviewer_id,
                         "model": reviewer_model, "approved": approved, "notes": notes})
            if not approved:
                row = self._retry(db, row, "REVIEW_REFUSED", "Independent review requested changes")
            else:
                row = self._change(db, row, "REVIEW_APPROVED", reviewer_id=reviewer_id, review_model=reviewer_model, review_approved=1)
            return self._view(db, row)

    def _clean_target(self):
        raw = self._git("status", "--porcelain=v1", "--untracked-files=all", "-z", binary=True)
        try:
            own_dir = self.board_dir.relative_to(self.repo).as_posix() + "/"
        except ValueError:
            own_dir = None
        for record in raw.split(b"\0"):
            if not record:
                continue
            name = record[3:].decode("utf8")
            if own_dir and name.startswith(own_dir) and record[:2] == b"??":
                continue
            raise BoardError("Target worktree must be clean")

    def _checkout_collisions(self, candidate):
        """Refuse untracked/ignored data that Git's read-tree would overwrite.

        Inspect the current index, not HEAD: after a ref update interrupted before
        checkout, HEAD names the candidate while the index still names the base.
        lstat also detects dangling symlinks without following local ancestors.
        """
        tracked = {raw.decode("utf8") for raw in self._git("ls-files", "--cached", "-z", binary=True).split(b"\0") if raw}
        tracked_directories = {parent.as_posix() for name in tracked for parent in PurePosixPath(name).parents
                               if parent != PurePosixPath(".")}

        def replacing_directory(relative):
            pending = [relative]
            while pending:
                directory = pending.pop()
                if directory not in tracked_directories:
                    raise BoardError("Target checkout collides with local untracked directory: " + directory)
                with os.scandir(self.repo / directory) as entries:
                    for entry in entries:
                        child = directory + "/" + entry.name
                        mode = entry.stat(follow_symlinks=False).st_mode
                        if stat.S_ISDIR(mode):
                            pending.append(child)
                        elif child not in tracked or not (stat.S_ISREG(mode) or stat.S_ISLNK(mode)):
                            raise BoardError("Target checkout collides with local untracked data: " + child)

        incoming = self._tree(candidate)
        for name in incoming:
            parts = PurePosixPath(name).parts
            for index in range(1, len(parts) + 1):
                relative = "/".join(parts[:index])
                try:
                    mode = (self.repo / relative).lstat().st_mode
                except FileNotFoundError:
                    break
                if index == len(parts):
                    if stat.S_ISDIR(mode):
                        replacing_directory(relative)
                    elif relative not in tracked:
                        raise BoardError("Target checkout collides with local untracked data: " + relative)
                elif not stat.S_ISDIR(mode):
                    if relative in tracked and relative not in incoming:
                        # A tracked file/symlink is intentionally becoming a
                        # directory; read-tree checks that tracked entry's edits.
                        break
                    raise BoardError("Target checkout collides with local ancestor: " + relative)

    def _accept(self, db, row):
        row = self._change(db, row, "MERGED", status="MERGED", merged_commit=row["commit_sha"], gate_run=None,
                           merge_intent=None, error=None)
        db.execute("UPDATE artifacts SET accepted=1 WHERE ticket_id=? AND epoch=?", (row["id"], row["epoch"]))
        for blocked in db.execute("SELECT * FROM tickets WHERE status='BLOCKED'").fetchall():
            waiting = db.execute("SELECT 1 FROM dependencies d JOIN tickets t ON t.id=d.dependency_id WHERE d.ticket_id=? AND t.status!='MERGED'", (blocked["id"],)).fetchone()
            if not waiting:
                self._change(db, blocked, "DEPENDENCIES_MERGED", status="READY")
        return row

    @contextmanager
    def _merge_lock(self):
        # flock releases on supervisor death, unlike a guessed-timeout lock steal.
        import fcntl
        with (self.board_dir / "merge.lock").open("a") as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as error:
                raise BoardError("Another supervisor owns the merge lock") from error
            yield

    def merge(self, ticket_id):
        with self._merge_lock():
            with self._tx() as db:
                row = self._row(db, ticket_id)
                definition = json.loads(row["definition"])
                if row["merge_intent"]:
                    raise BoardError("Pending integration requires recover before another merge")
                if row["status"] != "REVIEW" or not row["gate_result"] or not json.loads(row["gate_result"]).get("passed"):
                    raise BoardError("Merge requires a passed gate")
                if definition["reviewer_model"] is not None and row["review_approved"] != 1:
                    raise BoardError("Required independent review has not approved")
                self._clean_target()
                if self._git("rev-parse", "HEAD").strip() != row["base_commit"]:
                    return self._view(db, self._retry(db, row, "TARGET_STALE", "Target moved; claim a fresh base, rebase and retest"))
                self._candidate(row, row["commit_sha"])
                self._checkout_collisions(row["commit_sha"])
                row = dict(self._change(db, row, "MERGE_STARTED", status="MERGING", merge_intent=row["commit_sha"]))
            # A durable intent precedes the real Git operation. Do not claim a merge
            # from return-code alone; independently re-read HEAD and clean state.
            if self._git("rev-parse", "HEAD").strip() != row["base_commit"]:
                raise BoardError("Target changed before merge; recover required")
            self._clean_target()
            # git merge alone reads HEAD afresh, so surrounding Python reads are
            # not a ref CAS. Perform the real FF merge privately, then use Git's
            # expected-old-value update to integrate exactly that result.
            integration = self.board_dir / "worktrees" / ("integration-" + uuid.uuid4().hex)
            self._git("worktree", "add", "--detach", str(integration), row["base_commit"])
            try:
                self._git("merge", "--ff-only", "--no-edit", row["commit_sha"], cwd=integration)
                if self._git("rev-parse", "HEAD", cwd=integration).strip() != row["commit_sha"]:
                    raise BoardError("Private fast-forward differs from candidate")
                self._checkout_collisions(row["commit_sha"])
                self._git("update-ref", "-m", "ARGO verified fast-forward", "HEAD", row["commit_sha"], row["base_commit"])
                # Two-tree read-tree preserves/refuses concurrent local edits
                # instead of destroying them. A failure leaves MERGING for recovery.
                self._checkout_collisions(row["commit_sha"])
                self._git("read-tree", "-u", "-m", row["base_commit"], row["commit_sha"])
            finally:
                self._git("worktree", "remove", "--force", str(integration))
            if self._git("rev-parse", "HEAD").strip() != row["commit_sha"]:
                raise BoardError("Git did not integrate the exact candidate")
            self._clean_target()
            with self._tx() as db:
                current = self._row(db, ticket_id)
                if current["status"] != "MERGING" or current["commit_sha"] != row["commit_sha"]:
                    raise BoardError("Merge finalization was fenced")
                return self._view(db, self._accept(db, current))

    def recover(self, ticket_id):
        with self._merge_lock():
            with self._tx() as db:
                row = self._row(db, ticket_id)
                if row["status"] not in ("VERIFYING", "REVIEW", "MERGING"):
                    raise BoardError("Only supervisor states require recovery")
                intent = row["merge_intent"]
                head = self._git("rev-parse", "HEAD").strip()
                if intent and (intent != row["commit_sha"] or head not in (row["base_commit"], intent)):
                    raise BoardError("Target differs from durable merge intent; operator investigation required")
                already_integrated = bool(intent and head == intent)
                self._change(db, row, "RECOVERY_REQUESTED", status="VERIFYING", gate_run=None, gate_result=None,
                             review_approved=None, reviewer_id=None, review_model=None,
                             merge_intent=intent if already_integrated else None)
            result = self.verify(ticket_id)
            if already_integrated:
                if result["status"] != "REVIEW":
                    raise BoardError("Integrated candidate failed recovery gate")
                if self._git("rev-parse", "HEAD").strip() != result["commit_sha"]:
                    raise BoardError("Target changed during recovery")
                self._checkout_collisions(result["commit_sha"])
                self._git("read-tree", "-u", "-m", result["base_commit"], result["commit_sha"])
                self._clean_target()
                if self._git("rev-parse", "HEAD").strip() != result["commit_sha"]:
                    raise BoardError("Target changed during recovery")
                with self._tx() as db:
                    current = self._row(db, ticket_id)
                    if current["status"] != "REVIEW" or current["merge_intent"] != result["commit_sha"] or current["commit_sha"] != result["commit_sha"]:
                        raise BoardError("Recovery finalization was fenced")
                    return self._view(db, self._accept(db, current))
            return result

    def verify_audit(self):
        with self._tx() as db:
            previous, timestamp = None, -1
            for seq, row in enumerate(db.execute("SELECT * FROM audit ORDER BY seq"), 1):
                try:
                    entry = {k: row[k] for k in ("seq", "at_us", "event", "ticket_id", "previous_hash")}
                    entry["payload"] = json.loads(row["payload"])
                    if row["seq"] != seq or row["at_us"] <= timestamp or row["previous_hash"] != previous or canonical(entry["payload"]) != row["payload"] or digest(canonical(entry).encode()) != row["hash"]:
                        return False
                except (ValueError, TypeError):
                    return False
                previous, timestamp = row["hash"], row["at_us"]
            return True

    def render(self):
        with self._tx() as db:
            lines = ["# Offline build board", "", "| Ticket | State | Attempt | Epoch | Title |", "| --- | --- | --- | --- | --- |"]
            for row in db.execute("SELECT * FROM tickets ORDER BY id"):
                title = json.loads(row["definition"])["title"].replace("|", "\\|").replace("\n", " ")
                lines.append(f"| {row['id']} | {row['status']} | {row['attempt']} | {row['epoch']} | {title} |")
        path = self.board_dir / "BOARD.md"
        temporary = path.with_name(".BOARD-" + uuid.uuid4().hex)
        temporary.write_text("\n".join(lines) + "\n")
        os.replace(temporary, path)
        return path


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--repo", type=Path, default=Path.cwd())
    parser.add_argument("--board-dir", type=Path)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("init").add_argument("seed", type=Path)
    for name in ("get", "verify", "merge", "recover"):
        commands.add_parser(name).add_argument("ticket_id")
    for name in ("render", "verify-audit"):
        commands.add_parser(name)
    claim = commands.add_parser("claim")
    claim.add_argument("worker_id")
    claim.add_argument("seat_model")
    claim.add_argument("--lease-seconds", type=int, default=900)
    for name in ("heartbeat", "prepare-worktree", "submit", "fail-claim", "put-artifact"):
        sub = commands.add_parser(name)
        for field in ("ticket_id", "worker_id", "lease_token"):
            sub.add_argument(field)
        if name == "heartbeat":
            sub.add_argument("--lease-seconds", type=int, default=900)
        if name == "submit":
            sub.add_argument("commit_sha")
        if name == "fail-claim":
            sub.add_argument("error")
        if name == "put-artifact":
            sub.add_argument("logical_path")
            sub.add_argument("file", type=Path)
    review = commands.add_parser("review")
    for field in ("ticket_id", "reviewer_id", "reviewer_model", "notes"):
        review.add_argument(field)
    review.add_argument("--approve", action="store_true")
    args = vars(parser.parse_args(argv))
    board = Board(args.pop("repo"), args.pop("board_dir"))
    command = args.pop("command").replace("-", "_")
    if command == "init":
        args = {"seed": json.loads(args["seed"].read_text())}
    elif command == "put_artifact":
        args["data"] = args.pop("file").read_bytes()
    elif command == "review":
        args["approved"] = args.pop("approve")
    try:
        result = getattr(board, command)(**args)
        print(canonical(str(result) if isinstance(result, Path) else result))
        return 1 if command == "verify_audit" and result is False else 0
    except BoardError as error:
        print(canonical({"error": str(error)}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
