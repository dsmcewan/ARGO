# Offline blackboard

The board coordinates local peer workers. SQLite WAL serializes claims; immutable specs and SHA-256 CAS blobs carry inputs; isolated Git worktrees carry candidate changes. No model client, credentials, recursive workers or paid inference are wired to these tools.

Use Python 3.11+, Git and Linux Bubblewrap with usable unprivileged namespaces. A missing isolation capability is an error, not permission to run an unconfined worker. This is a trusted local operator interface, not a network authentication service. Worker processes must run through the confined dispatcher and must never receive host database access or supervisor commands.

## Prepare without running workers

From a committed ARGO checkout:

```sh
python3 tools/board.py init RESEARCH/argo_night1_seed.json
python3 tools/board.py render
python3 tools/board.py verify-audit
python3 tools/dispatch.py
```

`init` is insert-only and idempotent for the same seed. It pins the seed, source specifications, installed Python executable, gate wrapper and trusted policy files. It does not claim a ticket or launch a worker. `dispatch.py` defaults to a status-only dry run. The supplied seed is a **planning seed**: all reports are starters, and audit, synthesis and graph-contract gates deliberately refuse until their semantic oracles have been implemented and independently reviewed. See [the research track](../RESEARCH/README.md).

Local state, excluded from Git:

```text
.board/board.db                 SQLite WAL coordination and audit events
.board/BOARD.md                 renderable status snapshot
.board/cas/ab/<full-sha256>     verified immutable bytes
.board/tickets/<id>.json       pinned definition and gate policy
.board/tickets/<id>.spec       exact source specification bytes
.board/worktrees/<attempt>     isolated Git working copies
```

Render after operations to refresh the status snapshot, or watch `python3 tools/board.py render`. The engine does not run a background scheduler. Expired `CLAIMED` leases are reclaimed on the next claim sweep. Verification, review and unresolved integration retain their path locks until a supervisor resolves them.

## Execute a local fixture

For a disposable fixture repository with a **tracked** `fixture.py`, seed and data validator:

```sh
python3 tools/dispatch.py --repo /path/to/fixture-repo \
  --offline --seat-model gpt-6-astra --worker-id local-fixture \
  --command-json '["/usr/bin/python3","/workspace/fixture.py"]' --once
```

The seat name is a scheduling label. It does not invoke or impersonate that model. The operator supplies the exact argv; shell command strings are not supported. Execution is finite: one ticket by default, or an explicit `--max-tickets` bound.

The worker sees its worktree at `/workspace` with only `owned_paths` writable; verified spec and parent artifacts are read-only under `/inputs`. `ARGO_TASK`, `ARGO_SPEC`, `ARGO_INPUTS` and `ARGO_OUTPUTS` identify these surfaces. The task manifest contains no lease token. Host Git metadata, the board database, home credentials and networking are absent. The parent dispatcher owns heartbeat, artifact capture and Git commit construction. A missing path ending in `/` grants a directory subtree; any other missing path grants one exact file. Exact file mounts support direct writes; replacement by rename or deletion requires directory ownership. Unchanged empty placeholders are not outputs.

Output bytes, artifact counts/sizes, traversal, process duration and pipe lifetime are bounded. Lease loss or worker timeout terminates its process group. This version does not provide cgroup CPU, RAM, PID or filesystem quotas, so use a disposable constrained host for untrusted workload capacity isolation.

## Supervisor lifecycle

```text
BLOCKED -> READY -> CLAIMED -> VERIFYING -> REVIEW -> MERGING -> MERGED
                     |             |          |
              expired/failure   gate fails  review rejects
                     +-------------+----------+--> READY or FAILED
```

An atomic claim checks dependency completion, overlapping path prefixes and a fresh lease token/epoch. Heartbeats and submissions require the current worker, token and unexpired lease. Artifacts must match owned regular files in the exact candidate commit; only artifacts from a merged attempt are handed downstream. No `HEAD` shorthand is accepted as a candidate identity.

Workers stop at `VERIFYING`. The operator runs these commands separately:

```sh
python3 tools/board.py verify T-104
# Only if that ticket assigns an independently obtained reviewer result:
python3 tools/board.py review T-104 reviewer-id assigned-model 'structured defect notes' --approve
python3 tools/board.py merge T-104
python3 tools/board.py render
```

`REVIEW` means the exact-candidate deterministic gate passed. With no assigned reviewer, `merge` can proceed directly; otherwise the assigned different-vendor reviewer and a different worker identity are required. The operator is responsible for authentic reviewer provenance; a model label is not proof of an API response. A review cannot override a failed gate.

`MERGED` requires an actual fast-forward of the tested candidate, an expected-old-value Git ref update and a clean target. If a sibling has already advanced the base, the ticket returns for a fresh attempt and fresh verification; disjoint paths do not waive this check. Durable `MERGING` intent allows `recover <id>` to reconcile a process interruption. `recover` also reruns interrupted supervisor verification. There is no rollback of an already integrated candidate on recovery failure: that requires operator investigation. The audit detects chain/content mutation, but without an externally stored checkpoint it cannot prove that an administrator did not truncate or restore the entire database.

## Gate boundary

Board v1 accepts **pinned Python standard-library data validators**. It runs a read-only trusted entrypoint in a fresh candidate materialization through `board_support.py`, Python `-I -S` and Bubblewrap. Candidate bytes are data: candidate imports, dynamic code and subprocess execution are refused. Successful termination also needs the wrapper's normal-completion record; exit code zero alone is insufficient. Gate mutation of tracked candidate bytes fails verification.

This interface deliberately does not run arbitrary pytest, Node, npm or candidate application code inside the validator process. Those need a separately reviewed parent-process oracle adapter; ARGO's existing [application merge controller](../controller/README.md) remains available for its frozen foundation checks. Updating pinned policy or a runtime requires a newly initialized, reviewed board, not rewriting an in-flight ticket.

## Verification

```sh
python3 -m unittest discover -s tools -p 'test_*.py' -v
node RESEARCH/validate.mjs
node RESEARCH/test_validate.mjs
python3 -m unittest discover -s RESEARCH -p 'test_*.py' -v
```

The combined integration tests use a real Board, SQLite, Git and confined workers. They prove new-file creation, hash-bound parent handoff, no target change before verification, actual merge and dependency unlocking, and refusal of invalid output. Separate engine/dispatcher tests cover lease fencing, competing claims, path locks, CAS corruption, process bounds, failed gates and merge recovery. They do not certify a production service or the future 10,000-event gameplay graph fuzz suite.
