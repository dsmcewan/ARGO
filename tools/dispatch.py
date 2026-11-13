#!/usr/bin/env python3
"""Finite, explicitly offline Board dispatcher (Python 3.11 standard library).

Dry-run is the default and never claims a ticket. Execution requires --offline and
an operator-supplied JSON argv array. A seat_model is a requested scheduling label,
never evidence that a model ran. No vendor client, credential lookup, gate, review,
merge, recursive dispatcher, or network transport is implemented here.

Missing owned paths are exact files unless suffixed with '/'. Existing directories
grant subtree ownership. Exact file bind mounts support direct writes; atomic
rename/deletion requires an explicitly owned directory. Only changed owned regular
files become artifacts; deletions remain represented in the candidate commit.
"""
from __future__ import annotations

import argparse
import asyncio
from dataclasses import dataclass
import hashlib
import json
import math
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import signal
import stat
import tempfile
import time
from typing import Any, Callable


class DispatchError(RuntimeError):
    pass


@dataclass(frozen=True)
class ProcessResult:
    returncode: int
    stdout: bytes
    stderr: bytes


class ProcessFailure(DispatchError):
    def __init__(self, message: str, stdout: bytes = b"", stderr: bytes = b""):
        super().__init__(message)
        self.stdout, self.stderr = stdout, stderr


@dataclass(frozen=True)
class Config:
    offline: bool = False
    command: tuple[str, ...] = ()
    worker_id: str = "offline-worker"
    seat_model: str = "offline-fixture"
    max_tickets: int = 1
    timeout: float = 300
    lease_seconds: int = 900
    heartbeat_seconds: float | None = None
    max_output_bytes: int = 1_048_576
    max_artifacts: int = 256
    max_artifact_bytes: int = 4_194_304
    max_total_bytes: int = 33_554_432

    def validate(self) -> None:
        if not isinstance(self.max_tickets, int) or not 1 <= self.max_tickets <= 100:
            raise DispatchError("max_tickets must be between 1 and 100")
        if not math.isfinite(self.timeout) or not 0 < self.timeout <= 3600:
            raise DispatchError("worker deadline must be between 0 and 3600 seconds")
        if not isinstance(self.lease_seconds, int) or not 3 <= self.lease_seconds <= 3600:
            raise DispatchError("lease_seconds must be between 3 and 3600")
        if self.heartbeat_seconds is not None and (not math.isfinite(self.heartbeat_seconds)
                or not 0 < self.heartbeat_seconds < self.lease_seconds):
            raise DispatchError("heartbeat interval must be positive and shorter than the lease")
        for name, maximum in [("max_output_bytes", 16_777_216), ("max_artifacts", 1024),
                              ("max_artifact_bytes", 33_554_432), ("max_total_bytes", 134_217_728)]:
            value = getattr(self, name)
            if not isinstance(value, int) or not 1 <= value <= maximum:
                raise DispatchError(f"invalid {name}")
        if not self.worker_id or len(self.worker_id) > 128 or not self.seat_model or len(self.seat_model) > 128:
            raise DispatchError("bounded worker_id and requested seat_model are required")
        if self.offline:
            validate_command(self.command)


def validate_command(command: tuple[str, ...] | list[str]) -> None:
    if not isinstance(command, (tuple, list)) or not 1 <= len(command) <= 256:
        raise DispatchError("an explicit JSON argv array is required for offline execution")
    if any(not isinstance(arg, str) or "\0" in arg for arg in command) or not command[0]:
        raise DispatchError("command argv must contain strings and a nonempty executable")
    if sum(len(arg.encode()) for arg in command) > 65_536:
        raise DispatchError("command argv exceeds the configured bound")


@dataclass(frozen=True)
class OwnedPath:
    path: str
    directory: bool = False
    created: bool = False


def normalize_owned_paths(paths: Any) -> list[OwnedPath]:
    if not isinstance(paths, list) or not 1 <= len(paths) <= 256:
        raise DispatchError("owned_paths must be a nonempty bounded array")
    result: list[OwnedPath] = []
    for raw in paths:
        if not isinstance(raw, str) or not raw or len(raw) > 4096:
            raise DispatchError("invalid owned path")
        path = raw[:-1] if raw.endswith("/") else raw
        parts = path.split("/")
        if (not path or PurePosixPath(path).as_posix() != path or path.startswith("/")
                or "\\" in path or any(ord(c) < 32 for c in path)
                or any(part in {"", ".", "..", ".git", ".board"} for part in parts)):
            raise DispatchError("owned paths must be normalized relative paths without administration metadata")
        if any(path == item.path or path.startswith(item.path + "/") or item.path.startswith(path + "/") for item in result):
            raise DispatchError("owned paths overlap or alias")
        result.append(OwnedPath(path, raw.endswith("/")))
    return result


def prepare_owned_paths(worktree: Path, paths: Any) -> list[OwnedPath]:
    roots = normalize_owned_paths(paths)
    prepared = []
    for root in roots:
        current = worktree
        for part in root.path.split("/")[:-1]:
            current = current / part
            if current.is_symlink() or (current.exists() and not current.is_dir()):
                raise DispatchError("owned path has a symbolic or non-directory ancestor")
            current.mkdir(exist_ok=True)
        target = worktree / root.path
        if target.is_symlink():
            raise DispatchError("owned roots cannot be symbolic links")
        created = not target.exists()
        if created:
            if root.directory:
                target.mkdir()
            else:
                target.touch(exist_ok=False)
        if not target.is_file() and not target.is_dir():
            raise DispatchError("owned roots must be regular files or directories")
        if root.directory and not target.is_dir():
            raise DispatchError("directory ownership hint names an existing non-directory")
        prepared.append(OwnedPath(root.path, target.is_dir(), created))
    return prepared


def clean_env() -> dict[str, str]:
    return {"PATH": "/usr/bin:/bin", "LANG": "C.UTF-8", "HOME": "/nonexistent",
            "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": "/dev/null"}


async def run_bounded(argv, *, timeout: float, max_output_bytes: int,
                      stop: asyncio.Event | None = None, env=None, cwd=None) -> ProcessResult:
    """Bound combined output bytes, wall time, pipe lifetime, and the owned process group."""
    if stop is not None and stop.is_set():
        raise ProcessFailure("worker cancelled before execution")
    proc = await asyncio.create_subprocess_exec(*argv, stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        start_new_session=True, env=clean_env() if env is None else env, cwd=cwd)
    buffers = [bytearray(), bytearray()]
    used = 0

    async def drain(stream, index):
        nonlocal used
        while chunk := await stream.read(65_536):
            available = max(0, max_output_bytes - used)
            buffers[index].extend(chunk[:available])
            used += min(available, len(chunk))
            if len(chunk) > available:
                raise DispatchError("worker output byte limit exceeded")

    def kill(sig):
        try:
            os.killpg(proc.pid, sig)
        except ProcessLookupError:
            pass

    async def terminate():
        kill(signal.SIGTERM)
        await asyncio.sleep(0.2)
        kill(signal.SIGKILL)
        try:
            await asyncio.wait_for(proc.wait(), 1)
        except asyncio.TimeoutError:
            pass

    readers = [asyncio.create_task(drain(proc.stdout, 0)), asyncio.create_task(drain(proc.stderr, 1))]
    completion = asyncio.gather(proc.wait(), *readers)
    cancellation = asyncio.create_task(stop.wait()) if stop is not None else None
    try:
        pending = {completion} | ({cancellation} if cancellation else set())
        ready, _ = await asyncio.wait(pending, timeout=timeout, return_when=asyncio.FIRST_COMPLETED)
        if not ready:
            raise DispatchError("worker deadline exceeded")
        if cancellation is not None and cancellation in ready:
            raise DispatchError("worker cancelled or lease heartbeat failed")
        await completion
        kill(signal.SIGKILL)  # A successful direct child must not leave background descendants.
        return ProcessResult(proc.returncode, bytes(buffers[0]), bytes(buffers[1]))
    except asyncio.CancelledError:
        await asyncio.shield(terminate())
        raise
    except Exception as error:
        await terminate()
        raise ProcessFailure(str(error), bytes(buffers[0]), bytes(buffers[1])) from error
    finally:
        completion.cancel()
        for task in readers:
            task.cancel()
        if cancellation:
            cancellation.cancel()
        await asyncio.gather(completion, *readers, *([cancellation] if cancellation else []), return_exceptions=True)


def sandbox_argv(worktree: Path, inputs: Path, owned: list[OwnedPath], command,
                 *, bwrap: str | None = None) -> list[str]:
    validate_command(command)
    isolation = bwrap if bwrap is not None else shutil.which("bwrap")
    if not isolation or not Path(isolation).is_file():
        raise DispatchError("Bubblewrap is required; unconfined execution is refused")
    executable = shutil.which(command[0]) if "/" not in command[0] else command[0]
    if not executable:
        raise DispatchError("operator worker executable was not found")
    executable = str(Path(executable).resolve(strict=True))
    if not Path(executable).is_file() or not os.access(executable, os.X_OK):
        raise DispatchError("operator worker executable must be an executable regular file")
    args = [isolation, "--unshare-all", "--cap-drop", "ALL", "--die-with-parent", "--new-session",
            "--ro-bind", "/usr", "/usr", "--symlink", "usr/bin", "/bin",
            "--symlink", "usr/sbin", "/sbin", "--symlink", "usr/lib", "/lib",
            "--symlink", "usr/lib64", "/lib64", "--proc", "/proc", "--dev", "/dev",
            "--tmpfs", "/tmp", "--dir", "/tools", "--ro-bind", executable, "/tools/worker",
            "--ro-bind", str(worktree), "/workspace", "--ro-bind", str(inputs), "/inputs",
            "--ro-bind", str(inputs / "empty-git"), "/workspace/.git"]
    for item in owned:
        args.extend(["--bind", str(worktree / item.path), "/workspace/" + item.path])
    args += ["--clearenv", "--setenv", "PATH", "/tools:/usr/bin:/bin", "--setenv", "HOME", "/tmp",
             "--setenv", "LANG", "C.UTF-8", "--setenv", "ARGO_TASK", "/inputs/task.json",
             "--setenv", "ARGO_SPEC", "/inputs/spec", "--setenv", "ARGO_INPUTS", "/inputs",
             "--setenv", "ARGO_OUTPUTS", "/workspace", "--chdir", "/workspace", "--", "/tools/worker", *command[1:]]
    return args


def stage_inputs(board, row: dict, directory: Path, config: Config) -> None:
    total = 0

    def verified(sha):
        nonlocal total
        if not isinstance(sha, str) or not re.fullmatch(r"[a-f0-9]{64}", sha):
            raise DispatchError("invalid input artifact digest")
        data = board.read_artifact(sha)
        if not isinstance(data, bytes) or hashlib.sha256(data).hexdigest() != sha:
            raise DispatchError("input artifact digest mismatch")
        total += len(data)
        if total > config.max_total_bytes:
            raise DispatchError("input artifacts exceed the byte bound")
        return data

    (directory / "spec").write_bytes(verified(row["spec_sha256"]))
    upstream = row.get("upstream_artifacts")
    if not isinstance(upstream, list) or len(upstream) > config.max_artifacts:
        raise DispatchError("upstream_artifacts must be an accepted bounded array")
    (directory / "upstream").mkdir()
    refs = []
    for index, item in enumerate(upstream):
        if not isinstance(item, dict) or not isinstance(item.get("ticket_id"), str):
            raise DispatchError("invalid upstream artifact reference")
        normalize_owned_paths([item.get("logical_path")])
        data = verified(item.get("sha256"))
        name = f"upstream/{index:04d}-{item['sha256']}"
        (directory / name).write_bytes(data)
        refs.append({**item, "input_path": name})
    manifest = {key: row[key] for key in ["id", "base_commit", "owned_paths", "spec_sha256", "epoch"]}
    manifest.update(upstream_artifacts=refs, requested_seat_model=config.seat_model,
                    execution="offline operator command; no model execution claimed")
    (directory / "task.json").write_text(json.dumps(manifest, sort_keys=True, indent=2) + "\n")
    (directory / "empty-git").write_bytes(b"")
    for path in directory.rglob("*"):
        if path.is_file():
            path.chmod(0o444)


def parse_tree(raw: bytes) -> dict[str, tuple[str, str]]:
    entries = {}
    for record in raw.split(b"\0"):
        if not record:
            continue
        header, name = record.split(b"\t", 1)
        mode, kind, oid = header.decode("ascii").split(" ")
        if kind != "blob" or mode not in {"100644", "100755", "120000"}:
            raise DispatchError("submodules and unsupported Git entries are refused")
        entries[name.decode("utf-8")] = (mode, oid)
    return entries


@dataclass(frozen=True)
class Change:
    path: str
    mode: str
    data: bytes | None


def collect_changes(worktree: Path, owned: list[OwnedPath], baseline: dict, config: Config) -> list[Change]:
    found: set[str] = set()
    changes: list[Change] = []
    scanned = 0

    def read(path: Path, logical: str, placeholder=False):
        nonlocal scanned
        st = path.lstat()
        if path.is_symlink():
            raise DispatchError("symbolic output paths are refused")
        if path.is_dir():
            for child in sorted(path.iterdir()):
                read(child, logical + "/" + child.name)
            return
        normalize_owned_paths([logical])
        if not stat.S_ISREG(st.st_mode) or st.st_nlink != 1:
            raise DispatchError("outputs must be unaliased regular files")
        scanned += 1
        if scanned > 4096 or st.st_size > config.max_artifact_bytes:
            raise DispatchError("owned file scan exceeds configured bounds")
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        try:
            with os.fdopen(fd, "rb") as stream:
                data = stream.read(config.max_artifact_bytes + 1)
        except BaseException:
            raise
        if len(data) > config.max_artifact_bytes:
            raise DispatchError("output file exceeds byte bound")
        found.add(logical)
        old = baseline.get(logical)
        mode = "100755" if st.st_mode & stat.S_IXUSR else "100644"
        algorithm = "sha256" if old and len(old[1]) == 64 else "sha1"
        digest = hashlib.new(algorithm, f"blob {len(data)}\0".encode() + data).hexdigest()
        if old != (mode, digest) and not (placeholder and not data and old is None):
            changes.append(Change(logical, mode, data))

    for item in owned:
        path = worktree / item.path
        if path.exists() or path.is_symlink():
            read(path, item.path, item.created and not item.directory)
    for name in baseline:
        if name not in found and any(name == item.path or name.startswith(item.path + "/") for item in owned):
            changes.append(Change(name, "0", None))
    if len(changes) > config.max_artifacts or sum(len(item.data or b"") for item in changes) > config.max_total_bytes:
        raise DispatchError("changed artifacts exceed configured count or byte bounds")
    return sorted(changes, key=lambda item: item.path)


class Dispatcher:
    def __init__(self, board, config: Config, *, runner: Callable = run_bounded):
        config.validate()
        self.board, self.config, self.runner = board, config, runner

    async def _board(self, name, *args, **kwargs):
        return await asyncio.to_thread(getattr(self.board, name), *args, **kwargs)

    async def _git(self, worktree: Path, *args, env=None) -> bytes:
        result = await run_bounded(("/usr/bin/git", "--no-replace-objects", "-C", str(worktree),
            "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "-c", "commit.gpgsign=false", *args),
            timeout=30, max_output_bytes=16_777_216, env=clean_env() if env is None else env)
        if result.returncode:
            raise DispatchError("trusted Git operation failed: " + result.stderr[-300:].decode(errors="replace"))
        return result.stdout

    async def _commit(self, worktree: Path, row: dict, changes: list[Change]) -> str:
        with tempfile.TemporaryDirectory(prefix="argo-dispatch-index-") as temporary:
            private = Path(temporary)
            env = {**clean_env(), "GIT_INDEX_FILE": str(private / "index"),
                   "GIT_AUTHOR_NAME": "ARGO Offline Dispatcher", "GIT_AUTHOR_EMAIL": "offline@argo.invalid",
                   "GIT_COMMITTER_NAME": "ARGO Offline Dispatcher", "GIT_COMMITTER_EMAIL": "offline@argo.invalid"}
            await self._git(worktree, "read-tree", row["base_commit"], env=env)
            for item in changes:
                if item.data is None:
                    await self._git(worktree, "update-index", "--force-remove", "--", item.path, env=env)
                else:
                    blob = private / "blob"
                    await asyncio.to_thread(blob.write_bytes, item.data)
                    oid = (await self._git(worktree, "hash-object", "-w", "--no-filters", str(blob), env=env)).decode().strip()
                    await self._git(worktree, "update-index", "--add", "--cacheinfo", item.mode, oid, item.path, env=env)
            tree = (await self._git(worktree, "write-tree", env=env)).decode().strip()
            commit = (await self._git(worktree, "commit-tree", tree, "-p", row["base_commit"], "-m",
                f"Offline task {row['id']} lease epoch {row['epoch']}; operator command, no model execution claimed", env=env)).decode().strip()
            if not re.fullmatch(r"[a-f0-9]{40}|[a-f0-9]{64}", commit):
                raise DispatchError("Git did not return a full candidate commit identity")
            return commit

    async def _one(self, row: dict) -> dict:
        config = self.config
        identity = (row["id"], config.worker_id, row["lease_token"])
        stop = asyncio.Event()
        heartbeat_errors: list[Exception] = []

        async def renew():
            return await self._board("heartbeat", *identity, lease_seconds=config.lease_seconds)

        async def monitor():
            try:
                while True:
                    await asyncio.sleep(config.heartbeat_seconds or min(30, config.lease_seconds / 3))
                    await renew()
            except asyncio.CancelledError:
                raise
            except Exception as error:
                heartbeat_errors.append(error)
                stop.set()

        heartbeat = asyncio.create_task(monitor())
        try:
            await renew()
            if not re.fullmatch(r"[a-f0-9]{40}|[a-f0-9]{64}", row["base_commit"]):
                raise DispatchError("claim requires a full immutable base commit")
            worktree = Path(await self._board("prepare_worktree", *identity)).resolve(strict=True)
            if (await self._git(worktree, "rev-parse", "HEAD")).decode().strip() != row["base_commit"]:
                raise DispatchError("prepared worktree differs from the claimed base")
            if not (worktree / ".git").is_file() or (worktree / ".git").is_symlink():
                raise DispatchError("worker must use a fresh linked Git worktree")
            board_dir = Path(self.board.board_dir).resolve()
            if board_dir == worktree or worktree in board_dir.parents:
                raise DispatchError("board metadata cannot be inside the worker worktree")
            baseline = parse_tree(await self._git(worktree, "ls-tree", "-rz", "--full-tree", row["base_commit"]))
            owned = await asyncio.to_thread(prepare_owned_paths, worktree, row["owned_paths"])
            # Refuse aliases before any writable mount is exposed to the worker.
            if await asyncio.to_thread(collect_changes, worktree, owned, baseline, config):
                raise DispatchError("prepared owned files differ from the immutable base")
            with tempfile.TemporaryDirectory(prefix="argo-dispatch-inputs-") as temporary:
                inputs = Path(temporary)
                await asyncio.to_thread(stage_inputs, self.board, row, inputs, config)
                argv = sandbox_argv(worktree, inputs, owned, config.command)
                result = await self.runner(argv, timeout=config.timeout, max_output_bytes=config.max_output_bytes,
                                           stop=stop, env=clean_env())
            if stop.is_set():
                raise DispatchError("lease heartbeat failed")
            if result.returncode:
                raise DispatchError(f"offline worker exited {result.returncode}: " + result.stderr[-300:].decode(errors="replace"))
            await renew()
            changes = await asyncio.to_thread(collect_changes, worktree, owned, baseline, config)
            if not changes:
                raise DispatchError("offline worker produced no changes")
            await renew()
            commit = await self._commit(worktree, row, changes)
            artifacts = []
            for item in changes:
                if item.data is not None:
                    sha = await self._board("put_artifact", *identity, item.path, item.data)
                    if sha != hashlib.sha256(item.data).hexdigest():
                        raise DispatchError("published artifact digest differs from candidate bytes")
                    artifacts.append({"logical_path": item.path, "sha256": sha})
            await renew()
            submitted = await self._board("submit", *identity, commit)
            return {"id": row["id"], "status": submitted["status"], "candidate_commit": commit, "artifacts": artifacts}
        except BaseException as error:
            if isinstance(error, (SystemExit, KeyboardInterrupt)):
                raise
            reason = str(heartbeat_errors[0] if heartbeat_errors else error)[:512] or "offline worker cancelled"
            try:
                await asyncio.shield(self._board("fail_claim", *identity, reason))
            except Exception:
                pass  # A lost lease must not be reclaimed just to record its failure.
            if isinstance(error, asyncio.CancelledError):
                raise
            return {"id": row["id"], "status": "failed", "error": reason}
        finally:
            stop.set()
            heartbeat.cancel()
            await asyncio.gather(heartbeat, return_exceptions=True)

    async def run(self) -> dict:
        if not self.config.offline:
            return {"mode": "dry-run", "requested_seat_model": self.config.seat_model,
                    "board": await self._board("render"), "message": "No lease acquired and no worker executed."}
        results = []
        for _ in range(self.config.max_tickets):
            row = await self._board("claim", self.config.worker_id, self.config.seat_model,
                                    lease_seconds=self.config.lease_seconds)
            if row is None:
                break
            results.append(await self._one(row))
        return {"mode": "offline", "requested_seat_model": self.config.seat_model,
                "execution": "operator command; no model execution claimed", "results": results}


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--repo", type=Path, default=Path.cwd())
    parser.add_argument("--board-dir", type=Path)
    parser.add_argument("--offline", action="store_true", help="authorize a confined local fixture command")
    parser.add_argument("--command-json", help='explicit argv, e.g. ["/usr/bin/python3","/workspace/fixture.py"]')
    parser.add_argument("--worker-id", default=f"offline-{os.getpid()}")
    parser.add_argument("--seat-model", default="offline-fixture", help="requested scheduling label only")
    parser.add_argument("--once", action="store_true", help="process at most one ticket (the default)")
    parser.add_argument("--max-tickets", type=int, default=1)
    parser.add_argument("--timeout", type=float, default=300)
    parser.add_argument("--lease-seconds", type=int, default=900)
    parser.add_argument("--max-output-bytes", type=int, default=1_048_576)
    args = parser.parse_args(argv)
    try:
        command = json.loads(args.command_json) if args.command_json is not None else []
        if args.once and args.max_tickets != 1:
            raise DispatchError("--once requires --max-tickets=1")
        config = Config(offline=args.offline, command=command, worker_id=args.worker_id,
                        seat_model=args.seat_model, max_tickets=args.max_tickets, timeout=args.timeout,
                        lease_seconds=args.lease_seconds, max_output_bytes=args.max_output_bytes)
        config.validate()
        from board import Board  # Sibling engine; importing this module never initializes a Board.
        result = asyncio.run(Dispatcher(Board(args.repo, args.board_dir), config).run())
        print(json.dumps(result, sort_keys=True, indent=2))
        return 1 if any(row["status"] == "failed" for row in result.get("results", [])) else 0
    except (DispatchError, ValueError, OSError) as error:
        parser.exit(2, f"dispatch refused: {str(error)[:512]}\n")
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
