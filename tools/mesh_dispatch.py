#!/usr/bin/env python3
"""Finite offline Mesh dispatcher; peer traces are advisory, never gate receipts.

The existing dispatcher remains the author/lease/CAS/submission implementation.
This additive layer runs exactly three read-only peers in bounded feedback rounds
against the raw Git blobs of that author's immutable candidate. No vendor client,
review, verification, merge, controller, or automatic retry policy is invoked.

One flock excludes other Mesh supervisors in the same Git common directory. It
is not a lock against legacy dispatchers or arbitrary Git users. One Board is the
ownership domain. Process-group limits are not cgroup CPU/RAM/PID quotas.
"""
from __future__ import annotations

import argparse
import asyncio
from contextvars import ContextVar
from dataclasses import dataclass
import fcntl
import hashlib
import json
import math
import os
from pathlib import Path, PurePosixPath
import re
import signal
import stat
import sys
import tempfile
import time
from typing import Callable

from dispatch import (Change, Config, DispatchError, Dispatcher, clean_env,
                      run_bounded, sandbox_argv, stage_inputs, validate_command)
from mesh_trace import MeshTraceError, RoundTraceStore, make_binding

_PROTOCOL = "argo.mesh/1"
_PEER_ID = re.compile(r"[A-Za-z][A-Za-z0-9_.-]{0,63}\Z")
_SHA1 = re.compile(r"[a-f0-9]{40}\Z")
_SNAPSHOT_FILES = 8192
_SNAPSHOT_BYTES = 134_217_728
_RESPONSE_BYTES = 65_536


def _number(value, maximum, name):
    if type(value) not in (int, float) or not math.isfinite(value) or not 0 < value <= maximum:
        raise DispatchError(f"invalid {name}")


@dataclass(frozen=True)
class Peer:
    id: str
    command: tuple[str, ...]

    def validate(self):
        if (type(self.id) is not str or not _PEER_ID.fullmatch(self.id)
                or self.id == "mesh-supervisor"):
            raise DispatchError("invalid or reserved Mesh peer id")
        if type(self.command) is not tuple:
            raise DispatchError("peer command must be an immutable argv tuple")
        validate_command(self.command)


@dataclass(frozen=True)
class MeshConfig(Config):
    parallel: int = 1
    peers: tuple[Peer, ...] = ()
    rounds: int = 2
    mesh_timeout: float = 120
    max_trace_writes: int = 24

    def validate(self):
        # Config predates these strict bool/type rules; validate before delegating.
        for name in ("max_tickets", "lease_seconds", "max_output_bytes", "max_artifacts",
                     "max_artifact_bytes", "max_total_bytes"):
            if type(getattr(self, name)) is not int:
                raise DispatchError(f"{name} must be an integer, not bool")
        if type(self.offline) is not bool or type(self.command) is not tuple:
            raise DispatchError("offline must be bool and command must be an immutable argv tuple")
        _number(self.timeout, 3600, "worker deadline")
        if self.heartbeat_seconds is not None:
            _number(self.heartbeat_seconds, 3600, "heartbeat interval")
        for name, lower, upper in (("parallel", 1, 8), ("rounds", 2, 8), ("max_trace_writes", 6, 96)):
            value = getattr(self, name)
            if type(value) is not int or not lower <= value <= upper:
                raise DispatchError(f"{name} must be an integer between {lower} and {upper}")
        _number(self.mesh_timeout, 300, "mesh_timeout")
        if type(self.peers) is not tuple or (self.peers and len(self.peers) != 3):
            raise DispatchError("peers must be an immutable tuple of exactly three peers")
        for peer in self.peers:
            if type(peer) is not Peer:
                raise DispatchError("peers must contain Peer values")
            peer.validate()
        if len({peer.id for peer in self.peers}) != len(self.peers):
            raise DispatchError("peer ids must be distinct")
        if self.offline and len(self.peers) != 3:
            raise DispatchError("offline Mesh execution requires exactly three explicit peers")
        if self.max_trace_writes < 3 * self.rounds:
            raise DispatchError("trace budget cannot complete the configured rounds")
        super().validate()


def _strict_json(raw: bytes, maximum: int):
    if type(raw) is not bytes or len(raw) > maximum:
        raise DispatchError("JSON output exceeds the byte bound")

    def pairs(entries):
        result = {}
        for key, value in entries:
            if key in result:
                raise DispatchError("duplicate JSON key")
            result[key] = value
        return result

    def constant(_):
        raise DispatchError("non-finite JSON numbers are refused")

    try:
        return json.loads(raw.decode("utf-8", errors="strict"), object_pairs_hook=pairs,
                          parse_constant=constant)
    except (ValueError, UnicodeError, RecursionError) as error:
        raise DispatchError("invalid bounded UTF-8 JSON document") from error


def _canonical(value) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False,
                      allow_nan=False).encode("utf-8")


async def _settle(task, *, propagate_cancel=True):
    """Await owned cleanup even if a caller repeats cancellation.

    Only callers already handling cancellation use this helper. They re-raise the
    original cancellation after durable claims and process groups have settled.
    """
    cancelled = False
    while not task.done():
        try:
            await asyncio.shield(task)
        except asyncio.CancelledError:
            cancelled = True
    result = task.result()
    if cancelled and propagate_cancel:
        raise asyncio.CancelledError
    return result


def _host_directory(path: Path):
    """Refuse host directory aliases before creating a trace or lock file.

    Host operators are trusted; this is a preflight, not an openat-based defense
    against a hostile concurrent host administrator replacing checked parents.
    """
    path = path.absolute()
    current = Path(path.anchor)
    for part in path.parts[1:]:
        current /= part
        info = current.lstat()
        if not stat.S_ISDIR(info.st_mode):
            raise DispatchError("host control directory contains a symlink or non-directory")
    return path


def _logical_path(raw: str):
    if (not raw or len(raw.encode("utf-8")) > 4096 or raw.startswith("/")
            or "\\" in raw or PurePosixPath(raw).as_posix() != raw
            or any(ord(char) < 32 or ord(char) == 127 for char in raw)
            or any(part in {"", ".", "..", ".git", ".board"} for part in raw.split("/"))):
        raise DispatchError("unsafe snapshot path")
    return raw


def _link_destination(name: str, data: bytes, entries):
    try:
        target = data.decode("utf-8", errors="strict")
    except UnicodeError as error:
        raise DispatchError("snapshot link target is not UTF-8") from error
    if (not target or len(data) > 4096 or target.startswith("/") or "\\" in target
            or any(ord(char) < 32 or ord(char) == 127 for char in target)):
        raise DispatchError("unsafe snapshot symbolic link")
    parts = name.split("/")[:-1]
    for part in target.split("/"):
        if part in {".git", ".board", ""}:
            raise DispatchError("snapshot symbolic link names control metadata")
        if part == ".":
            continue
        if part == "..":
            if not parts:
                raise DispatchError("snapshot symbolic link escapes its root")
            parts.pop()
        else:
            parts.append(part)
    resolved = "/".join(parts)
    if resolved not in entries or entries[resolved][0] not in {"100644", "100755"}:
        raise DispatchError("snapshot links must target contained tracked regular files, without chains")
    return target


@dataclass
class _Attempt:
    row: dict
    stop: asyncio.Event | None = None
    mesh: dict | None = None


class MeshDispatcher(Dispatcher):
    def __init__(self, board, config: MeshConfig, *, runner: Callable = run_bounded):
        if type(config) is not MeshConfig:
            raise DispatchError("MeshDispatcher requires MeshConfig")
        self._attempt: ContextVar[_Attempt | None] = ContextVar("argo_mesh_attempt", default=None)
        self._process_runner = runner
        self._board_calls: dict[asyncio.Task, str] = {}
        self._detached_board_calls: set[asyncio.Task] = set()
        self._late_board_errors: list[tuple[str, BaseException]] = []
        self._cleanup_diagnostics: list[str] = []
        self._unsettled_claims: dict[tuple[str, str, str], str] = {}

        async def author_runner(argv, **kwargs):
            attempt = self._attempt.get()
            if attempt is None or attempt.stop is not None or not isinstance(kwargs.get("stop"), asyncio.Event):
                raise DispatchError("author runner lacks a unique active lease context")
            attempt.stop = kwargs["stop"]
            return await runner(argv, **kwargs)

        # The wrapper is permanent. Concurrent attempts never replace self.runner.
        super().__init__(board, config, runner=author_runner)

    def _cleanup_note(self, name, error):
        message = f"Board {name}: {type(error).__name__}: {str(error)[:300]}"
        if message not in self._cleanup_diagnostics and len(self._cleanup_diagnostics) < 32:
            self._cleanup_diagnostics.append(message)

    async def _board(self, name, *args, **kwargs):
        # Cancelling a coroutine cannot stop its already-running SQLite/Git
        # thread. Keep the thread task alive and owned until run() drains it
        # under the repository flock. Awaiters may still stop promptly, notably
        # the inherited heartbeat deadline and lease-loss process shutdown.
        operation = asyncio.create_task(asyncio.to_thread(getattr(self.board, name), *args, **kwargs))
        self._board_calls[operation] = name
        try:
            return await asyncio.shield(operation)
        except asyncio.CancelledError:
            self._detached_board_calls.add(operation)
            raise
        except Exception as error:
            if name == "fail_claim":
                # Inherited _one deliberately ignores a fenced failure-record
                # refusal. Retain it as a diagnostic; this is never rollback.
                self._cleanup_note(name, error)
            raise
        finally:
            if operation not in self._detached_board_calls:
                self._board_calls.pop(operation, None)

    async def _drain_board_calls(self):
        errors = self._late_board_errors
        self._late_board_errors = []
        while self._board_calls:
            operations = tuple(self._board_calls.items())
            outcomes = await asyncio.gather(*(task for task, _ in operations), return_exceptions=True)
            for (task, name), outcome in zip(operations, outcomes):
                self._board_calls.pop(task, None)
                self._detached_board_calls.discard(task)
                if isinstance(outcome, BaseException):
                    if name in {"fail_claim", "heartbeat"}:
                        self._cleanup_note(name, outcome)
                    else:
                        errors.append((name, outcome))
        # The first inherited fail_claim may have met a still-running SQLite
        # transaction and timed out. Once all mutations settle, retry only the
        # exact unfinished capability. An atomic submit that already reached
        # VERIFYING stays there; cancellation does not roll it back.
        unfinished = self._unsettled_claims
        self._unsettled_claims = {}
        for identity, reason in unfinished.items():
            try:
                row = await self._board("get", identity[0])
                if (row.get("status") == "CLAIMED" and row.get("lease_token") == identity[2]
                        and row.get("worker_id") == identity[1]):
                    await self._board("fail_claim", *identity, reason)
                elif row.get("status") == "VERIFYING":
                    self._cleanup_note("cancelled attempt", RuntimeError(
                        f"ticket {identity[0]} completed atomic submit and remains VERIFYING; no rollback"))
            except Exception as error:
                errors.append(("settle_claim", error))
        if errors:
            details = "; ".join(f"{name}: {type(error).__name__}: {str(error)[:160]}"
                                for name, error in errors[:8])
            failure = DispatchError(("Board operations failed while draining shutdown: " + details)[:1600])
            raise failure from BaseExceptionGroup("late Board operation failures", [error for _, error in errors])

    def _annotate_cleanup(self, error):
        for diagnostic in self._cleanup_diagnostics:
            error.add_note(diagnostic)

    async def _one(self, row: dict) -> dict:
        attempt = _Attempt(row)
        token = self._attempt.set(attempt)
        try:
            result = await super()._one(row)
            result = {**result, **{key: row[key] for key in ("epoch", "base_commit", "spec_sha256")}}
            if result.get("status") == "failed":
                identity = (row["id"], self.config.worker_id, row["lease_token"])
                self._unsettled_claims[identity] = result.get("error", "Mesh attempt failed")[:512]
            if (attempt.mesh is not None and result.get("status") == "VERIFYING"
                    and result.get("candidate_commit") == attempt.mesh["candidate_commit"]):
                result = {**result, "mesh": attempt.mesh}
            return result
        except asyncio.CancelledError:
            identity = (row["id"], self.config.worker_id, row["lease_token"])
            self._unsettled_claims[identity] = "Mesh supervisor cancelled; exact unfinished lease settled"
            raise
        finally:
            self._attempt.reset(token)

    def _live(self, attempt: _Attempt):
        if attempt.stop is None or attempt.stop.is_set():
            raise DispatchError("Mesh attempt lost its author lease")

    async def _renew_mesh(self, attempt: _Attempt):
        self._live(attempt)
        row, config = attempt.row, self.config
        record = await asyncio.wait_for(self._board("heartbeat", row["id"], config.worker_id,
            row["lease_token"], lease_seconds=config.lease_seconds), min(30, config.lease_seconds / 3))
        self._live(attempt)
        if (record.get("id") != row["id"] or record.get("lease_token") != row["lease_token"]
                or record.get("worker_id", config.worker_id) != config.worker_id
                or type(record.get("lease_until")) is not int
                or record["lease_until"] / 1_000_000 <= time.time()):
            raise DispatchError("Mesh final heartbeat returned a stale or foreign lease")

    async def _materialize(self, worktree: Path, candidate: str, target: Path,
                           attempt: _Attempt):
        """Copy verified raw blobs; Git export-ignore/filters cannot omit/change data."""
        self._live(attempt)
        if not _SHA1.fullmatch(candidate):
            raise DispatchError("Mesh v1 requires full SHA-1 Git identities")
        raw = await self._git(worktree, "ls-tree", "-rz", "--full-tree", candidate)
        entries = {}
        try:
            for record in raw.split(b"\0"):
                if not record:
                    continue
                header, encoded = record.split(b"\t", 1)
                mode, kind, oid = header.decode("ascii").split(" ")
                name = _logical_path(encoded.decode("utf-8", errors="strict"))
                if (kind != "blob" or mode not in {"100644", "100755", "120000"}
                        or not _SHA1.fullmatch(oid) or name in entries):
                    raise DispatchError("unsupported or duplicate snapshot tree entry")
                entries[name] = (mode, oid)
                if len(entries) > _SNAPSHOT_FILES:
                    raise DispatchError("snapshot file count exceeds 8192")
        except (ValueError, UnicodeError) as error:
            raise DispatchError("malformed raw Git tree") from error
        for name in entries:
            if any(str(parent) in entries for parent in PurePosixPath(name).parents if str(parent) != "."):
                raise DispatchError("snapshot path aliases a tracked file ancestor")
        total, links = 0, []
        for name, (mode, oid) in sorted(entries.items()):
            self._live(attempt)
            result = await run_bounded(("/usr/bin/git", "--no-replace-objects", "-C", str(worktree),
                "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "cat-file", "blob", oid),
                timeout=30, max_output_bytes=_SNAPSHOT_BYTES - total + 1,
                stop=attempt.stop, env=clean_env())
            if result.returncode:
                raise DispatchError("cannot read exact candidate blob")
            data = result.stdout
            total += len(data)
            if total > _SNAPSHOT_BYTES:
                raise DispatchError("snapshot aggregate bytes exceed 128MiB")
            actual = hashlib.sha1(f"blob {len(data)}\0".encode("ascii") + data).hexdigest()
            if actual != oid:
                raise DispatchError("candidate blob identity mismatch")
            destination = target / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            if mode == "120000":
                links.append((destination, _link_destination(name, data, entries)))
            else:
                # No host worker can see this separate, newly created snapshot.
                with destination.open("xb") as stream:
                    stream.write(data)
                destination.chmod(0o555 if mode == "100755" else 0o444)
        for destination, link in links:
            destination.symlink_to(link)
        (target / ".git").write_bytes(b"")  # Additionally masked by sandbox_argv.
        self._live(attempt)

    def _trace_path(self, scope: str):
        base = _host_directory(Path(self.board.board_dir))
        directory = base / "mesh-traces"
        try:
            directory.mkdir(mode=0o700)
        except FileExistsError:
            pass
        _host_directory(directory)
        return directory / (scope + ".jsonl")

    async def _peer(self, peer: Peer, snapshot: Path, row: dict, payload: dict,
                    attempt: _Attempt):
        self._live(attempt)
        with tempfile.TemporaryDirectory(prefix="argo-mesh-peer-inputs-") as temporary:
            inputs = Path(temporary)
            staging = asyncio.create_task(asyncio.to_thread(stage_inputs, self.board, row, inputs, self.config))
            try:
                await asyncio.shield(staging)
            except asyncio.CancelledError:
                await _settle(staging, propagate_cancel=False)
                raise
            (inputs / "mesh.json").write_bytes(_canonical(payload))
            (inputs / "mesh.json").chmod(0o444)
            argv = sandbox_argv(snapshot, inputs, [], peer.command)
            self._live(attempt)
            result = await self._process_runner(argv, timeout=self.config.mesh_timeout,
                max_output_bytes=min(_RESPONSE_BYTES, self.config.max_output_bytes),
                stop=attempt.stop, env=clean_env())
        self._live(attempt)
        if result.returncode:
            raise DispatchError(f"Mesh peer {peer.id} exited {result.returncode}")
        response = _strict_json(result.stdout, min(_RESPONSE_BYTES, self.config.max_output_bytes))
        if type(response) is not dict:
            raise DispatchError("Mesh peer response must be one JSON object")
        # The store validates the complete peer set, but that alone cannot bind
        # a response to its actual process: three peers could rotate their IDs.
        # Compare each envelope with exactly the input sent to this invocation.
        echoes = ("protocol", "binding", "peer_id", "round", "seen_version")
        expected = {key: payload[key] for key in echoes}
        actual = {key: response.get(key) for key in echoes}
        if payload["peer_id"] != peer.id or _canonical(actual) != _canonical(expected):
            raise DispatchError(f"Mesh peer {peer.id} returned a foreign process envelope")
        return response

    async def _round(self, peers, snapshot, row, store, attempt):
        payloads = [store.peer_input(peer.id) for peer in peers]
        tasks = [asyncio.create_task(self._peer(peer, snapshot, row, payload, attempt))
                 for peer, payload in zip(peers, payloads)]
        try:
            return await asyncio.gather(*tasks)
        finally:
            for task in tasks:
                if not task.done() and not task.cancelling():
                    task.cancel()
            await _settle(asyncio.ensure_future(asyncio.gather(*tasks, return_exceptions=True)))

    async def _commit(self, worktree: Path, row: dict, changes: list[Change]) -> str:
        attempt = self._attempt.get()
        if attempt is None or attempt.row is not row:
            raise DispatchError("candidate construction lacks its attempt context")
        self._live(attempt)
        candidate = await super()._commit(worktree, row, changes)
        self._live(attempt)
        binding = make_binding(row["id"], row["epoch"], row["base_commit"], candidate, row["spec_sha256"])
        trace_path = self._trace_path(binding["scope"])
        store = RoundTraceStore(trace_path, binding, tuple(peer.id for peer in self.config.peers),
            rounds=self.config.rounds, max_writes=self.config.max_trace_writes,
            lifetime=self.config.mesh_timeout)
        try:
            # One deadline covers snapshot extraction, inputs, every feedback round,
            # and final lease renewal. Per-peer deadlines cannot reset this budget.
            async with asyncio.timeout(self.config.mesh_timeout):
                with tempfile.TemporaryDirectory(prefix="argo-mesh-snapshot-") as temporary:
                    snapshot = Path(temporary)
                    await self._materialize(worktree, candidate, snapshot, attempt)
                    for _ in range(self.config.rounds):
                        self._live(attempt)
                        responses = await self._round(self.config.peers, snapshot, row, store, attempt)
                        self._live(attempt)
                        store.commit_round(responses)
                    await self._renew_mesh(attempt)
                    store.close("completed")
            attempt.mesh = {"protocol": _PROTOCOL, "scope": binding["scope"],
                "candidate_commit": candidate, "status": "completed", "trace_sha256": store.digest(),
                "trace_path": str(trace_path), "rounds": self.config.rounds,
                "peer_ids": [peer.id for peer in self.config.peers]}
            return candidate
        except BaseException as error:
            try:
                store.close("cancelled" if isinstance(error, asyncio.CancelledError) else "failed")
            except (MeshTraceError, OSError):
                pass  # Preserve original failure; incomplete audit is never completion.
            if isinstance(error, TimeoutError):
                raise DispatchError("overall Mesh deadline exceeded") from error
            raise

    async def _claim(self, active=()):
        claim = asyncio.create_task(self._board("claim", self.config.worker_id, self.config.seat_model,
                                               lease_seconds=self.config.lease_seconds))
        try:
            return await asyncio.shield(claim)
        except asyncio.CancelledError:
            for task in active:
                if not task.done() and not task.cancelling():
                    task.cancel()
            # to_thread cannot cancel a SQLite transaction already in flight. Keep
            # the repository lock until its exact late capability is settled.
            row = None
            try:
                row = await _settle(claim, propagate_cancel=False)
            except Exception as error:
                self._late_board_errors.append(("claim", error))
            if row is not None:
                identity = (row["id"], self.config.worker_id, row["lease_token"])
                self._unsettled_claims[identity] = "Mesh supervisor cancelled during a late claim"
                cleanup = asyncio.create_task(self._board("fail_claim", row["id"], self.config.worker_id,
                    row["lease_token"], "Mesh supervisor cancelled while claim was in flight"))
                try:
                    await _settle(cleanup, propagate_cancel=False)
                except Exception as error:
                    self._cleanup_note("fail_claim", error)
                    # A superseding epoch must not be stolen to log failure.
            raise
        except Exception as error:
            raise DispatchError(("Board claim refused: " + str(error))[:512]) from error

    async def _scheduler(self):
        results, active = [], {}
        try:
            while len(results) < self.config.max_tickets or active:
                while len(active) < self.config.parallel and len(results) < self.config.max_tickets:
                    # Capacity is available before the atomic claim; no lease queue.
                    row = await self._claim(active)
                    if row is None:
                        break
                    index = len(results)
                    results.append(None)
                    active[asyncio.create_task(self._one(row))] = index
                if not active:
                    break
                done, _ = await asyncio.wait(active, return_when=asyncio.FIRST_COMPLETED)
                for task in done:
                    index = active.pop(task)
                    results[index] = task.result()
            return {"mode": "offline", "requested_seat_model": self.config.seat_model,
                    "execution": "operator command; no model execution claimed", "results": results}
        finally:
            for task in active:
                if not task.done() and not task.cancelling():
                    task.cancel()
            await _settle(asyncio.ensure_future(asyncio.gather(*active, return_exceptions=True)))

    async def run(self) -> dict:
        if not self.config.offline:
            result = await super().run()
            if isinstance(result.get("board"), Path):
                result["board"] = str(result["board"])
            return result
        common = (await self._git(Path(self.board.repo), "rev-parse", "--path-format=absolute",
                                  "--git-common-dir")).decode("utf-8").strip()
        directory = _host_directory(Path(common))
        fd = os.open(directory / "argo-mesh-supervisor.lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        try:
            info = os.fstat(fd)
            if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
                raise DispatchError("Mesh supervisor lock must be an unaliased regular file")
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as error:
                raise DispatchError("another Mesh supervisor holds this repository") from error
            failure = None
            try:
                result = await self._scheduler()
            except BaseException as error:
                failure = error
                raise
            finally:
                try:
                    # The scheduler has drained attempt/peer coroutines. Threads
                    # abandoned by cancelled Board awaiters still own durable
                    # work: never unlock before those actual operations settle.
                    await _settle(asyncio.create_task(self._drain_board_calls()))
                except BaseException as error:
                    self._annotate_cleanup(error)
                    raise
                finally:
                    if failure is not None:
                        self._annotate_cleanup(failure)
            if self._cleanup_diagnostics:
                result["cleanup_diagnostics"] = list(self._cleanup_diagnostics)
            return result
        finally:
            fcntl.flock(fd, fcntl.LOCK_UN)
            os.close(fd)


async def _run_signalled(dispatcher):
    """SIGTERM/INT initiates cleanup, never immediate interpreter termination.

    The adapter must give this process enough grace to drain separately grouped
    children and in-flight Board claims. Hard SIGKILL/crash cannot run this code;
    lease expiry and failed/incomplete traces remain the fail-closed boundary.
    """
    loop = asyncio.get_running_loop()
    task = asyncio.create_task(dispatcher.run())
    received = []

    def stop(signum):
        if not received:
            received.append(signum)
            task.cancel()

    for signum in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(signum, stop, signum)
    try:
        try:
            return await task, 0
        except asyncio.CancelledError as error:
            if not received:
                raise
            for note in getattr(error, "__notes__", ()):
                print("mesh cleanup diagnostic: " + note, file=sys.stderr)
            # task's finally blocks have completed before cancellation reaches us.
            return None, 128 + received[0]
    finally:
        for signum in (signal.SIGTERM, signal.SIGINT):
            loop.remove_signal_handler(signum)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--repo", type=Path, default=Path.cwd())
    parser.add_argument("--board-dir", type=Path)
    parser.add_argument("--offline", action="store_true")
    parser.add_argument("--command-json")
    parser.add_argument("--worker-id", default=f"offline-mesh-{os.getpid()}")
    parser.add_argument("--seat-model")
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--max-tickets", type=int, default=1)
    parser.add_argument("--timeout", type=float, default=300)
    parser.add_argument("--lease-seconds", type=int, default=900)
    parser.add_argument("--max-output-bytes", type=int, default=1_048_576)
    parser.add_argument("--parallel", type=int, default=1)
    parser.add_argument("--peer-commands-json")
    parser.add_argument("--mesh-rounds", type=int, default=2)
    parser.add_argument("--mesh-timeout", type=float, default=120)
    parser.add_argument("--max-trace-writes", type=int, default=24)
    args = parser.parse_args(argv)
    try:
        command = _strict_json(args.command_json.encode("utf-8"), 262_144) if args.command_json is not None else []
        peers = _strict_json(args.peer_commands_json.encode("utf-8"), 262_144) if args.peer_commands_json is not None else []
        if type(command) is not list or type(peers) is not list or len(peers) not in {0, 3}:
            raise DispatchError("commands and peers must be bounded JSON arrays")
        if any(type(peer) is not dict or set(peer) != {"id", "command"}
               or type(peer["command"]) is not list for peer in peers):
            raise DispatchError("peer entries require exactly id and command")
        if args.once and args.max_tickets != 1:
            raise DispatchError("--once requires --max-tickets=1")
        config = MeshConfig(offline=args.offline, command=tuple(command), worker_id=args.worker_id,
            seat_model=args.seat_model, max_tickets=args.max_tickets, timeout=args.timeout,
            lease_seconds=args.lease_seconds, max_output_bytes=args.max_output_bytes,
            parallel=args.parallel, peers=tuple(Peer(peer["id"], tuple(peer["command"])) for peer in peers),
            rounds=args.mesh_rounds, mesh_timeout=args.mesh_timeout, max_trace_writes=args.max_trace_writes)
        config.validate()
        from board import Board
        result, code = asyncio.run(_run_signalled(MeshDispatcher(Board(args.repo, args.board_dir), config)))
        if result is not None:
            print(json.dumps(result, sort_keys=True, indent=2, allow_nan=False))
            return 1 if any(row["status"] == "failed" for row in result.get("results", [])) else 0
        print("mesh dispatch cancelled; owned child cleanup and claim settlement completed", file=sys.stderr)
        return code
    except (DispatchError, MeshTraceError, ValueError, OSError) as error:
        parser.exit(2, f"mesh dispatch refused: {str(error)[:512]}\n")
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
