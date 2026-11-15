# Offline concurrent Mesh build interface v1

Target: ARGO's Python blackboard, reached directly or through a new Pantheon edge adapter. Adapt the coordination pattern from TELOS PR205 at acc61c2abcf3611d2b3f7c7b03d59d493316f292; do not copy or merge that draft repository. No paid runs or live provider broker. Existing gameplay contracts and existing tools/Pantheon modules stay unchanged.

## Dispatch contract

New `tools/mesh_dispatch.py` exports frozen dataclasses `Peer(id: str, command: tuple[str,...])`, `MeshConfig(Config)` and `MeshDispatcher(Dispatcher)` plus `main(argv=None)`.

Additional MeshConfig fields: `parallel=1` (integer1..8), `peers=()` (exactly3 distinct Peer IDs (commands may be identical) for offline execution), `rounds=2` (integer2..8), `mesh_timeout=120` seconds (finite>0..300), `max_trace_writes=24` (integer6..96). Existing Config fields and limits remain; bool is not an integer limit. Dry-run needs no commands/peers and acquires no lease or execution lock. CLI retains existing dispatcher flags and adds `--parallel`, `--peer-commands-json` (array of exactly `{id,command}` records), `--mesh-rounds`, `--mesh-timeout`, `--max-trace-writes`. --once requires max_tickets1. No implicit model/provider lookup.

One Mesh supervisor holds a nonblocking flock in the Git common directory for its entire offline run, refusing a duplicate Mesh supervisor for linked worktrees/boards in the same repository. One Board remains the ownership domain. This does not claim to exclude legacy dispatchers or arbitrary external Git users; only one supervisor may drive integration. Maximum live worker groups is `3 * parallel`; authors and peer rounds do not overlap within one attempt. Each peer process may spawn children, so this is not a cgroup PID/RAM quota.

The scheduler reserves capacity before atomically claiming. It counts claimed attempts against max_tickets, never preclaims a waiting queue, preserves claim-order results, keeps unrelated attempts running after ordinary per-job failure, and drains all children on supervisor cancellation. Shield/settle in-flight to_thread claims on cancellation and fail a late acquired claim with its exact token. Return a finite idle result if no eligible tickets remain; VERIFYING parents never unlock dependents. Never call verify, review, merge or an application controller from this dispatcher.

Use an additive subclass: per-_one ContextVar holds row and lease-stop event captured by a permanent author-runner wrapper. Override _commit: call super to construct the exact candidate; run the peer protocol against a separate read-only materialization of that commit; check stop and renew the exact lease; return unchanged SHA to the existing artifact/submission path. Do not mutate self.runner/config per job. Existing author output capture, heartbeats, expiry, CAS and submit fencing remain in force. No author revision occurs during peer rounds.

Snapshot materialization must use the raw Git tree/blobs, verify modes/blob hashes and contained symlinks, avoid archive export-ignore attributes, and bound files/aggregate bytes/time. No host Git metadata is exposed. Peer commands use existing sandbox_argv with no owned writable mounts, separate temporary input directories, existing bounded process-group runner and the same lease-stop event. No network, board DB or credentials reach a peer. All peer children settle before a round or attempt terminates. Failed peers or invalid output fail that attempt; sibling builds continue.

## Peer wire protocol

Every peer receives `/inputs/mesh.json` and normal verified `/inputs/task.json`, spec and upstream CAS. The mesh input is:

```
{protocol:"argo.mesh/1", binding:{scope,ticket_id,epoch,base_commit,candidate_commit,spec_sha256},
 peer_id, round, seen_version, traces:[...], limits:{rounds,max_trace_writes}}
```

`scope` is SHA256 of canonical binding identity excluding scope (ticket/epoch/base/candidate/spec). Base/candidate are full40 lowercase Git SHAs, spec SHA256. Round1 starts seen_version0. The host sends complete prior committed round history, including superseded records; no filtered read may acknowledge unseen peer data.

A peer emits exactly one bounded UTF-8 JSON document on stdout, no surrounding prose or duplicate keys/NaN:

```
{protocol:"argo.mesh/1", binding:<exact echo>, peer_id:<exact echo>, round:<exact echo>,
 seen_version:<exact echo>, traces:[{type,payload,response_to:null|trace_id,supersedes:null|trace_id}]}
```

Exactly1..4 traces per peer response. Types: claim, contradiction, evidence, result, danger, info. Payload is a nonempty plain JSON object, max4096 UTF-8 canonical bytes, depth<=8, <=1024 nodes, arrays<=256, strings<=4096, safe integers only, no unsafe keys. Structured `state_change` at any depth is refused; text is inert. No approval/ship/status field can become an authority decision. References must name previously committed traces in this scope; supersession only the same peer's own prior trace. Each trace ID is host-derived from scope, round, peer_id and ordinal. All complete response bytes bounded64KiB, and existing output cap if smaller.

Three peers run concurrently in each round against the same immutable candidate and previous version. Host atomically commits their complete validated round as one JSONL record only if all three supplied exact bindings and read watermarks. This explicit round barrier replaces the prototype's per-write stale-context retry: same-round traces become visible together; next round sees all of them. Keep every dissenting trace. At least two rounds establish peer feedback/reconciliation. Host criterion is completed protocol (exact three peers in every bounded round), never model consensus on correctness.

## Trace API

New `tools/mesh_trace.py` exports `MeshTraceError`, `make_binding(ticket_id,epoch,base_commit,candidate_commit,spec_sha256)` and `RoundTraceStore(path: Path, binding:dict, peer_ids:tuple[str,...], *, rounds=2, max_writes=24, lifetime=120, clock=time.monotonic)`.

Constructor validates inputs and exclusively creates the host-only JSONL audit path (no reuse/symlink overwrite). `peer_input(peer_id)` returns a detached complete input for next round; each peer must read before commit. `commit_round(responses:list[dict])` validates all responses atomically before appending one round and incrementing version; no partial writes on malformed response/budget/stale binding. `close(status)` accepts only completed/failed/cancelled, always fences later reads-for-work/writes, and completed requires exact configured round count. `parent_read()` refuses until close, then returns detached `{protocol,binding,status,version,peer_ids,traces,rounds,max_trace_writes}`. `digest()` returns SHA256 of actual audit bytes. There is no public external-state or merge method; escalation/danger remains an advisory trace for the later supervisor.

A new host trace path per scope lives under `<board_dir>/mesh-traces/<scope>.jsonl`. It is not an owned candidate artifact or accepted dependency CAS input. Dispatch result attaches `mesh:{protocol:"argo.mesh/1",scope,candidate_commit,status:"completed",trace_sha256,trace_path,rounds,peer_ids}` only on protocol completion. It must still report Board VERIFYING, not MERGED. On failure retain any trace with failed/cancelled close where possible; no stale trace reuse.

## Pantheon edge

New `pantheon/src/board/blackboard-mesh.mjs` exports `runBlackboardMesh({repo,boardDir,command,peers,seatModel,workerId,parallel=1,maxTickets=1,rounds=2,timeout=300,meshTimeout=120,leaseSeconds=900,offline=false,signal,python="python3"}, {runner=spawnPromise}={})`. Build fixed argv for the trusted repository-relative tools/mesh_dispatch.py, not a caller-selected script. No shell, vendor imports or credential reads. Python owns leases and all worker lifecycle. Pass AbortSignal and bounded output/deadline to spawnPromise, validate bounded JSON result correlation/mode/count and refuse nonzero/malformed result. Return `{...parsed, transport_exit:0}` without relabeling gate state. New bin/pantheon-mesh.mjs is a thin explicit CLI with --config JSON-file and optional --offline, --help. Config offline alone cannot enable execution; operator CLI --offline is required. Default dry-run. Node adapter invocation offline:true is explicit caller authorization for local fixtures only. Existing runOpenItem/HTTP paid pipeline is not repurposed.

## Acceptance

New normal unittest files and named Pantheon tests; independent oracle before product integration. Prove native two-author overlap with a host barrier, isolated worktrees/paths/traces, complete feedback rounds, read-only peers, malformed/foreign/stale response refusal, process timeout/cancel cleanup, one-board path conflicts and finite bounds, parent embargo, exact CAS/commit binding, and actual serialized data-fixture merges including stale sibling fresh retry. Whole-control-policy additions independently reviewed and adopted before all ten controller gates. Application merges stay supervised; no generic D09 adapter is claimed.

## Reviewed clarifications

Peer IDs match `[A-Za-z][A-Za-z0-9_.-]{0,63}`; `mesh-supervisor` is reserved. The dispatcher binds each output to that process's exact protocol, binding, peer ID, round and read watermark before aggregate validation. Coordinated identity rotation is refused.

Each committed trace is `{id,scope,round,peer_id,ordinal,type,payload,response_to,supersedes}`; ordinal begins at zero for each peer. IDs hash canonical `{scope,round,peer_id,ordinal}`. Canonical JSON uses sorted keys, compact separators, UTF-8 without ASCII escaping and no nonfinite numbers. A round record is `{kind:"round",protocol,binding,round,version,peer_ids,traces}`; a close record is `{kind:"close",protocol,binding,status,version}`. Invalid close enums have no effect; incomplete `completed` closes as failed and raises. Same-terminal close is idempotent; a different terminal close is refused.

Cancellation retains every in-flight Board thread until its actual operation settles under the repository lock. Fenced heartbeat/failure-record refusals are diagnostics; unexpected late operation failures surface explicitly. Exact-token cleanup retries only unfinished CLAIMED tickets. An atomic submit can legitimately finish as VERIFYING during cancellation. There is no rollback claim.

The Pantheon transport deadline is `maxTickets * (timeout + meshTimeout + 120) * 1000 + 60000` milliseconds, with 60 seconds of termination grace. That grace is not an upper-bound proof for arbitrary storage stalls. Forced termination is failed transport and requires inspection of the actual Board. Normal graceful termination drains descendants and Board mutations before releasing the lock.

The trace store assumes a trusted host: inode/size preflights are not a cryptographic defense against same-inode, same-size host tampering. Peer sandboxes cannot access the trace store. Host-only traces are advisory and are not automatically promoted into dependency artifacts.
