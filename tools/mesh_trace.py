"""Host-owned advisory traces committed at complete three-peer round barriers.

This is an exclusive single-owner audit, not a shared JSONL database. Validation
and publication are atomic at the host API boundary. A process or machine crash
can leave an incomplete final line; this module deliberately has no reopen,
resume, replay, external-state, approval, or merge authority API.
"""
from __future__ import annotations

import hashlib
import json
import math
import os
from pathlib import Path
import re
import stat
import threading
import time

__all__ = ["MeshTraceError", "make_binding", "RoundTraceStore"]
_PROTOCOL = "argo.mesh/1"
_SAFE_INTEGER = (1 << 53) - 1
_TICKET = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,95}", re.ASCII)
_PEER = re.compile(r"[A-Za-z][A-Za-z0-9_.-]{0,63}", re.ASCII)
_SHA1 = re.compile(r"[0-9a-f]{40}", re.ASCII)
_SHA256 = re.compile(r"[0-9a-f]{64}", re.ASCII)
_BINDING_KEYS = frozenset(("scope", "ticket_id", "epoch", "base_commit", "candidate_commit", "spec_sha256"))
_RESPONSE_KEYS = frozenset(("protocol", "binding", "peer_id", "round", "seen_version", "traces"))
_TRACE_KEYS = frozenset(("type", "payload", "response_to", "supersedes"))
_TYPES = frozenset(("claim", "contradiction", "evidence", "result", "danger", "info"))
_UNSAFE_KEYS = frozenset(("__proto__", "constructor", "prototype", "state_change"))
_TERMINAL = frozenset(("completed", "failed", "cancelled"))


class MeshTraceError(ValueError):
    """The bounded host trace protocol or its private audit was refused."""


def _canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"),
                      ensure_ascii=False, allow_nan=False).encode("utf-8", "strict")


def _detached(value):
    return json.loads(_canonical(value))


def _matches(value, pattern):
    return type(value) is str and pattern.fullmatch(value) is not None


def _integer(value, low, high, label):
    if type(value) is not int or not low <= value <= high:
        raise MeshTraceError(f"invalid {label}")
    return value


def _object(value, keys, label):
    if (type(value) is not dict or len(value) != len(keys)
            or any(type(key) is not str for key in value) or value.keys() != keys):
        raise MeshTraceError(f"invalid {label} fields")


def make_binding(ticket_id, epoch, base_commit, candidate_commit, spec_sha256):
    """Bind one exact ticket epoch, candidate, base and specification digest."""
    if not _matches(ticket_id, _TICKET):
        raise MeshTraceError("invalid ticket_id")
    _integer(epoch, 1, _SAFE_INTEGER, "epoch")
    if not _matches(base_commit, _SHA1) or not _matches(candidate_commit, _SHA1):
        raise MeshTraceError("invalid full lowercase Git commit")
    if not _matches(spec_sha256, _SHA256):
        raise MeshTraceError("invalid spec_sha256")
    identity = {"ticket_id": ticket_id, "epoch": epoch, "base_commit": base_commit,
                "candidate_commit": candidate_commit, "spec_sha256": spec_sha256}
    return {**identity, "scope": hashlib.sha256(_canonical(identity)).hexdigest()}


def _binding(value):
    _object(value, _BINDING_KEYS, "binding")
    expected = make_binding(value["ticket_id"], value["epoch"], value["base_commit"],
                            value["candidate_commit"], value["spec_sha256"])
    if not _matches(value["scope"], _SHA256) or value["scope"] != expected["scope"]:
        raise MeshTraceError("binding scope does not match identity")
    return expected


def _payload(value):
    """Validate before canonicalizing; bound total work and encoded bytes.

    Root depth is zero. Nodes count containers and JSON values; object keys are
    checked separately and count toward canonical bytes. Repeated container
    aliases are copied, but cycles and non-plain Python values are refused.
    """
    if type(value) is not dict or not value:
        raise MeshTraceError("payload must be a nonempty plain object")
    nodes = 0
    size = 0
    active = set()

    def charge(amount):
        nonlocal size
        size += amount
        if size > 4096:
            raise MeshTraceError("payload exceeds canonical UTF-8 byte limit")

    def string(text):
        if len(text) > 4096:
            raise MeshTraceError("payload string exceeds limit")
        try:
            charge(len(_canonical(text)))
        except UnicodeError as exc:
            raise MeshTraceError("payload has invalid Unicode") from exc
        return text

    def visit(item, depth):
        nonlocal nodes
        nodes += 1
        if depth > 8 or nodes > 1024:
            raise MeshTraceError("payload depth or node limit exceeded")
        kind = type(item)
        if item is None:
            charge(4)
            return None
        if kind is bool:
            charge(4 if item else 5)
            return item
        if kind is int:
            if not -_SAFE_INTEGER <= item <= _SAFE_INTEGER:
                raise MeshTraceError("payload integer is not safe")
            charge(len(str(item)))
            return item
        if kind is str:
            return string(item)
        if kind not in (dict, list):
            raise MeshTraceError("payload contains a non-JSON or non-integer value")
        if id(item) in active:
            raise MeshTraceError("payload contains a cycle")
        if kind is list and len(item) > 256:
            raise MeshTraceError("payload array limit exceeded")
        if len(item) > 1024 - nodes:
            raise MeshTraceError("payload node limit exceeded")
        charge(2 + max(0, len(item) - 1))
        active.add(id(item))
        try:
            if kind is list:
                return [visit(child, depth + 1) for child in item]
            result = {}
            for key, child in item.items():
                if type(key) is not str or key in _UNSAFE_KEYS:
                    raise MeshTraceError("payload has a forbidden or non-string key")
                string(key)
                charge(1)
                result[key] = visit(child, depth + 1)
            return result
        finally:
            active.remove(id(item))

    return visit(value, 0)


class RoundTraceStore:
    """A single host owns one exclusive, bounded, append-only round audit."""

    def __init__(self, path: Path, binding: dict, peer_ids: tuple[str, ...], *,
                 rounds=2, max_writes=24, lifetime=120, clock=time.monotonic):
        checked_binding = _binding(binding)
        if (type(peer_ids) is not tuple or len(peer_ids) != 3
                or any(not _matches(peer, _PEER) or peer == "mesh-supervisor" for peer in peer_ids)
                or len(set(peer_ids)) != 3):
            raise MeshTraceError("exactly three distinct valid peer IDs are required")
        _integer(rounds, 2, 8, "round count")
        _integer(max_writes, 6, 96, "trace write budget")
        if (type(lifetime) not in (int, float) or not 0 < lifetime <= 300
                or not math.isfinite(lifetime)):
            raise MeshTraceError("invalid lifetime")
        if not callable(clock):
            raise MeshTraceError("clock must be callable")
        self._clock = clock
        start = self._now()
        deadline = start + lifetime
        if not math.isfinite(deadline):
            raise MeshTraceError("invalid clock deadline")
        if not isinstance(path, Path) or not path.name:
            raise MeshTraceError("audit path must name a file")
        self._binding = checked_binding
        self._peers = peer_ids
        self._rounds = rounds
        self._max_writes = max_writes
        self._started = start
        self._deadline = deadline
        self._version = 0
        self._status = None
        self._traces = []
        self._by_id = {}
        self._seen = {}
        self._lock = threading.RLock()
        self._path = path.absolute()
        self._audit_size = 0
        self._audit_broken = False
        self._create_audit()

    def _now(self):
        try:
            now = self._clock()
            if type(now) not in (int, float) or not math.isfinite(now):
                raise MeshTraceError("clock did not return a finite number")
            return now
        except MeshTraceError:
            raise
        except Exception as exc:
            raise MeshTraceError("clock failed") from exc

    def _create_audit(self):
        fd = None
        try:
            # These directories are host-owned. Refuse an existing symlink in
            # the path rather than following it to create an audit elsewhere.
            for parent in reversed(self._path.parents):
                if parent.is_symlink():
                    raise MeshTraceError("audit parent is a symlink")
                if not parent.exists():
                    parent.mkdir(mode=0o700, exist_ok=True)
                    if parent.is_symlink():
                        raise MeshTraceError("audit parent is a symlink")
            flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC
            fd = os.open(self._path, flags, 0o600)
            os.fchmod(fd, 0o600)
            info = os.fstat(fd)
            if not stat.S_ISREG(info.st_mode):
                raise MeshTraceError("audit must be a regular file")
            self._audit_identity = (info.st_dev, info.st_ino)
            os.fsync(fd)
            directory = os.open(self._path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
        except OSError as exc:
            raise MeshTraceError("could not exclusively create private audit") from exc
        finally:
            if fd is not None:
                os.close(fd)

    def _work(self):
        if self._status is not None or self._audit_broken:
            raise MeshTraceError("trace store is closed")
        if self._version >= self._rounds:
            raise MeshTraceError("configured rounds are exhausted")
        now = self._now()
        if now < self._started or now >= self._deadline:
            raise MeshTraceError("trace store lifetime expired or clock moved backwards")

    def _audit_fd(self, flags):
        fd = os.open(self._path, flags | os.O_NOFOLLOW | os.O_CLOEXEC)
        try:
            info = os.fstat(fd)
            if (not stat.S_ISREG(info.st_mode)
                    or (info.st_dev, info.st_ino) != self._audit_identity
                    or info.st_size != self._audit_size):
                raise MeshTraceError("private audit identity or size changed")
            return fd
        except BaseException:
            os.close(fd)
            raise

    def _append(self, record):
        data = _canonical(record) + b"\n"
        fd = None
        started = False
        try:
            fd = self._audit_fd(os.O_WRONLY | os.O_APPEND)
            started = True
            offset = 0
            while offset < len(data):
                written = os.write(fd, data[offset:])
                if written <= 0:
                    raise OSError("short audit write")
                offset += written
            os.fsync(fd)
            self._audit_size += len(data)
        except (OSError, MeshTraceError) as exc:
            if started:
                try:
                    os.ftruncate(fd, self._audit_size)
                    os.fsync(fd)
                except OSError:
                    pass
            self._audit_broken = True
            self._status = "failed"
            raise MeshTraceError("audit append failed; store is fenced") from exc
        finally:
            if fd is not None:
                os.close(fd)

    def peer_input(self, peer_id):
        with self._lock:
            self._work()
            if type(peer_id) is not str or peer_id not in self._peers:
                raise MeshTraceError("unknown peer")
            snapshot = _detached({"protocol": _PROTOCOL, "binding": self._binding,
                                  "peer_id": peer_id, "round": self._version + 1,
                                  "seen_version": self._version, "traces": self._traces,
                                  "limits": {"rounds": self._rounds, "max_trace_writes": self._max_writes}})
            self._seen[peer_id] = self._version
            return snapshot

    def commit_round(self, responses: list[dict]):
        with self._lock:
            self._work()
            if type(responses) is not list or len(responses) != 3:
                raise MeshTraceError("a round requires exactly three peer responses")
            round_number = self._version + 1
            accepted = {}
            for response in responses:
                _object(response, _RESPONSE_KEYS, "peer response")
                peer = response["peer_id"]
                if type(peer) is not str or peer not in self._peers or peer in accepted:
                    raise MeshTraceError("unknown or duplicate responding peer")
                if type(response["protocol"]) is not str or response["protocol"] != _PROTOCOL:
                    raise MeshTraceError("wrong peer protocol")
                if _binding(response["binding"]) != self._binding:
                    raise MeshTraceError("peer binding differs from this attempt")
                if (type(response["round"]) is not int or response["round"] != round_number
                        or type(response["seen_version"]) is not int
                        or response["seen_version"] != self._version
                        or self._seen.get(peer) != self._version):
                    raise MeshTraceError("peer did not read this exact round and version")
                traces = response["traces"]
                if type(traces) is not list or not 1 <= len(traces) <= 4:
                    raise MeshTraceError("each peer must supply one to four traces")
                checked = []
                wire_traces = []
                for ordinal, trace in enumerate(traces):
                    _object(trace, _TRACE_KEYS, "trace")
                    if type(trace["type"]) is not str or trace["type"] not in _TYPES:
                        raise MeshTraceError("unknown trace type")
                    payload = _payload(trace["payload"])
                    for field in ("response_to", "supersedes"):
                        reference = trace[field]
                        if reference is not None:
                            if not _matches(reference, _SHA256) or reference not in self._by_id:
                                raise MeshTraceError("trace reference is not in a prior committed round")
                            if field == "supersedes" and self._by_id[reference]["peer_id"] != peer:
                                raise MeshTraceError("a peer can only supersede its own prior trace")
                    identity = {"scope": self._binding["scope"], "round": round_number,
                                "peer_id": peer, "ordinal": ordinal}
                    wire = {"type": trace["type"], "payload": payload,
                            "response_to": trace["response_to"], "supersedes": trace["supersedes"]}
                    checked.append({"id": hashlib.sha256(_canonical(identity)).hexdigest(), **identity, **wire})
                    wire_traces.append(wire)
                # Raw stdout byte count/duplicate JSON keys are enforced by the
                # wire parser; already-parsed Python dicts cannot retain them.
                envelope = {"protocol": _PROTOCOL, "binding": self._binding,
                            "peer_id": peer, "round": round_number,
                            "seen_version": self._version, "traces": wire_traces}
                if len(_canonical(envelope)) > 65536:
                    raise MeshTraceError("peer response exceeds canonical byte limit")
                accepted[peer] = checked
            rows = [trace for peer in self._peers for trace in accepted[peer]]
            if len(self._traces) + len(rows) > self._max_writes:
                raise MeshTraceError("trace write budget exceeded")
            self._work()  # The validation work must not outlive the deadline.
            self._append({"kind": "round", "protocol": _PROTOCOL, "binding": self._binding,
                          "round": round_number, "version": round_number,
                          "peer_ids": list(self._peers), "traces": rows})
            self._traces.extend(rows)
            self._by_id.update((row["id"], row) for row in rows)
            self._version = round_number
            self._seen.clear()
            return _detached(rows)

    def close(self, status):
        with self._lock:
            if type(status) is not str or status not in _TERMINAL:
                raise MeshTraceError("invalid terminal status")
            if self._status is not None:
                if status == self._status:
                    return None
                raise MeshTraceError("terminal status cannot be changed")
            incomplete = status == "completed" and self._version != self._rounds
            actual = "failed" if incomplete else status
            # Fence before I/O: audit failure can never reopen work.
            self._status = actual
            self._append({"kind": "close", "protocol": _PROTOCOL, "binding": self._binding,
                          "status": actual, "version": self._version})
            if incomplete:
                raise MeshTraceError("completed requires every configured round; closed failed")
            return None

    def parent_read(self):
        with self._lock:
            if self._status is None:
                raise MeshTraceError("parent read is embargoed until close")
            return _detached({"protocol": _PROTOCOL, "binding": self._binding,
                              "status": self._status, "version": self._version,
                              "peer_ids": list(self._peers), "traces": self._traces,
                              "rounds": self._rounds, "max_trace_writes": self._max_writes})

    def digest(self):
        with self._lock:
            fd = None
            try:
                fd = self._audit_fd(os.O_RDONLY)
                result = hashlib.sha256()
                while True:
                    chunk = os.read(fd, 65536)
                    if not chunk:
                        return result.hexdigest()
                    result.update(chunk)
            except OSError as exc:
                raise MeshTraceError("could not read private audit") from exc
            finally:
                if fd is not None:
                    os.close(fd)
