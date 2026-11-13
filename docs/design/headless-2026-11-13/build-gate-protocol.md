# D09 — External application acceptance for the build board

Status: design proposal; no adapter implementation, migration or new trust root was applied. The proposed adapter acceptance cases have not been executed; this does not reclassify existing baseline tests. Source baseline: `41f2cb8568b53fac984e1114d7342eef540bb6d5`. This is a build-control decision, separate from gameplay authority keys, scopes, receipts and world time.

## Decision and existing evidence

Recommend **board-owned Git integration with an independently trusted, verifier-only application controller**. A successful external verification makes an attempt eligible for review; only the board's integration transaction can make its artifacts accepted. Keep the data-validator profile available unchanged for suitable document/data tickets.

At the baseline:

- `tools/board.py:_policy` accepts pinned Python data validators; `_candidate` checks commit identity, owned changes, protected files and candidate/CAS byte equality. `verify` records a running gate reservation. `merge` performs a private fast-forward and an expected-old-value ref update. `merge_intent` survives recovery. `_accept` atomically marks the current attempt's artifacts accepted and unlocks dependents. These are implemented foundations, not an external application protocol. [Board](../../../tools/board.py)
- `controller/merge.mjs` stages exact candidate and trusted trees, checks policy before imports/install, runs the isolated full gate, and then performs its own Git merge. It currently has no verifier-only entrypoint, authenticated board request, signed acceptance receipt, or board reconciliation API. Calling this script from the board as-is would create two integration owners. [Controller](../../../controller/merge.mjs)
- `controller/acceptance-policy.mjs` pins the entire `tools/` control plane and the closed research import surface. Python application code imported into an oracle interpreter can forge that interpreter's completion report; the documented runner is not an isolation boundary against such code. Preserve this protection. [Policy](../../../controller/acceptance-policy.mjs), [trust boundary](../../../controller/README.md)
- The repair board's retirement record explicitly leaves unfinished lifecycle states truthful. A new adapter must not retrospectively declare those tickets MERGED because separately coordinated code reached Git. [Retirement record](../../../REPAIRS/acceptance/board-retirement.json)

| Integration owner | Necessary design | Assessment |
|---|---|---|
| Board | Controller verifies without target-write capability; board authenticates the result, performs the sole ref change, recovers it, and accepts CAS artifacts. | Recommended: keeps leases, path locks, durable intent, dependencies and artifact acceptance in one coordinator. Requires a new receipt adapter and verifier-only controller interface. |
| Controller | Board delegates an immutable integration request; controller must gain a durable integration journal, shared repository lock, authenticated completion/reconciliation API and idempotent retry semantics. Board must never call its own Git merge for that attempt. | Viable alternative, but current controller lacks this journal/protocol. It moves recovery authority away from the coordinator that owns artifact acceptance and adds another durable transaction boundary. |

For a registered repository/target ref, the selected mode is immutable. Do not alternate owners per retry. The existing standalone controller merge command must refuse a target registered to board integration, or be operationally disabled for that target by enforced permissions. Multiple boards must share one repository integration service and outstanding-intent registry; the current per-board `merge.lock` alone does not establish that property.

## Trust and execution boundary

Run the supervisor and verifier from separately approved immutable installations, with their executable/import closure, runtime/dependency manifests and sandbox profile pinned outside candidate-controlled configuration. An environment variable supplied by a worker is not a trust-root binding. New board/controller policy must be reviewed and promoted through a separate operator-controlled process, then used by a fresh immutable batch. Do not edit an active seed or let a candidate authorize its own policy update.

The verifier parent retains its build-attestation signing key outside all worker and application sandboxes. The board pins the corresponding public key and allowed policy identity in trusted board metadata. Use a distinct build key: do not reuse gameplay ledger or model-provider credentials. A key identifier in a receipt cannot select an arbitrary public key supplied with that receipt. Key rotation/revocation is an authenticated operator operation with a new trust generation; affected pending attempts stop until their policy permits a fresh verification. Trust-generation changes are serialized with integration eligibility and finalization under the repository integration service; finalization rechecks the current generation, and an invalidated pending intent stays unresolved with its locks held.

The worker receives only scoped task inputs, its candidate workspace and read-only accepted parent artifacts. It never receives the board database, verifier key, host Git control directories, supervisor command channel, or a general signing endpoint. A bounded authenticated local control channel connects the board and verifier; worker stdout and worker-written receipt files are data, not that channel. The verifier receives immutable candidate objects through a verified staging/export interface and has **no write capability to the target repository/ref**.

A signature authenticates the verifier's statement; it cannot repair a weak oracle. Keep the current protected Python control plane pinned. Never import mutable candidate Python into `board_support.py`, the receipt signer, or an application oracle process. For each supported mutable application profile, trusted parent oracles must own the expected checks and judge candidate behavior across a bounded process/data protocol. Candidate processes may return observations and outputs, never authoritative test-pass records. Existing same-interpreter test receipts remain completion evidence within their documented trust assumptions; they do not alone establish that hostile imported code cannot forge success. The complete current gate remains required regression evidence. A profile lacking an independently trustworthy semantic oracle remains unsupported and fails closed; W14 must implement and review the first concrete profile before claiming general application acceptance.

## Immutable request and receipt

Define versioned schemas and one canonical JSON encoding with safe integer bounds, explicit algorithms, unknown-field rejection and bounded collections. Persist the exact request before launch. An acceptance receipt contains the following bindings directly or through canonical manifests whose bytes the board retains and verifies:

| Binding | Required fields |
|---|---|
| Protocol and identity | `protocol_version`, `receipt_kind`, operator-provisioned `repository_id`, `board_id`, `ticket_id`, `attempt_epoch`, `request_id`, `gate_run_id`, `request_sha256` |
| Task and inputs | ticket-definition digest, spec digest, ownership-manifest digest, accepted-upstream-manifest digest, acceptance-profile ID/version and required-review-policy digest |
| Git | explicit object format (initially the existing SHA-1 Git format), full `target_ref`, exact expected base commit, candidate commit and candidate tree; never a moving `HEAD` string |
| Trusted verification | approved verifier/controller commit, complete policy digest, required-check/oracle manifest digest, runtime/dependency/sandbox manifest digest, trust generation and verifier key ID |
| Outputs | candidate artifact-manifest digest, change-manifest digest including deletions and modes, evidence manifest with bounded logs/traces and their SHA-256 digests |
| Result | `pass`, `fail`, `cancelled` or `timeout`; parent-observed required-check identities/results/completion; execution identity; informational timestamps; signature |

The artifact manifest uses `(repository_id, board_id, ticket_id, attempt_epoch, logical_path, mode, size, sha256, git_blob_id)` and binds every advertised output to a regular file in the candidate tree. The change manifest represents deletions explicitly; a deleted file is not a downloadable CAS object. Verifier evidence is a separate namespace from worker output artifacts.

Sign a domain-separated canonical payload, for example `ARGO_BUILD_ACCEPTANCE/v1` plus the canonical unsigned receipt. The receipt digest is SHA-256 of that unsigned payload. The board checks the pinned key, signature, exact request bytes, current epoch/run reservation, all identity/manifests, and complete required results. It independently rechecks candidate/artifact bytes. A pass for another ticket, board, repository, base, tree, policy or run is unusable even if correctly signed. A model review cannot replace a missing/failed deterministic receipt.

Exact request retries return the previously sealed result. Reusing the request ID with different bytes is refused. The verifier journals request identity before launching execution and records completion durably before replying. Cancellation and timeout are bounded and terminate/reap the candidate process tree before a run is declared stopped. An uncertain transport outcome leaves verification unresolved: query the same request identity rather than guessing that the process ended. A newly authorized run fences any late result from the previous run. Timestamps alone never make a stale receipt valid.

## State transitions and the single integration operation

Retain the visible lifecycle, with new versioned verification-run and integration-intent records:

1. `BLOCKED -> READY -> CLAIMED`: existing dependency, owned-path, epoch and lease rules apply. The trusted dispatcher creates the immutable candidate and captures candidate-matching artifacts. Workers cannot choose the acceptance profile or verifier policy.
2. `CLAIMED -> VERIFYING`: submission freezes candidate, input/output manifests and acceptance policy for this epoch. The board durably reserves a gate run and request. No artifact is accepted yet.
3. `VERIFYING -> REVIEW`: only a complete authenticated passing receipt matching the live reservation permits this transition. A known pre-integration failure/cancellation returns `READY` within the attempt budget, otherwise `FAILED`. Unknown completion remains `VERIFYING` with path locks. Required independent review is recorded against this exact candidate, receipt and review policy; model labels alone do not prove reviewer provenance.
4. `REVIEW -> MERGING`: the sole integration service obtains a repository/target-wide lock, checks that no older intent is unresolved, rechecks receipt/key/policy/review validity, candidate/CAS bytes, ownership, expected base, target branch and local-data collisions. A stale base returns for a fresh attempt and verification, or reaches `FAILED` if its configured budget is exhausted. Disjoint paths do not authorize automatic rebase or receipt reuse.
5. Before any Git mutation, durably persist an integration intent containing `integration_id`, repository/target identity, expected old commit, exact candidate/tree, attempt epoch, receipt digest, review-record digest and output-manifest digest. Keep this record independently of `VERIFYING`/`REVIEW` state during any re-verification. Reserve the target until reconciliation finishes.
6. The board alone performs the exact fast-forward, with an expected-old-value update of the **pinned full target ref**, and safely updates the supervisor-owned checkout. The target checkout is writable only by the integration service; every cooperating operator operation uses the same repository lock. Preserve ignored files, directories and symlinks on collisions, including recovery. Detect dirty or changed target state and retain the intent rather than overwriting local data. W14 must prove the selected checkout primitive and crash ordering; a preflight check is not an atomic filesystem transaction against an uncooperative host administrator.
7. Independently inspect the actual target ref, tree and checkout after integration. In one SQLite transaction, require the same live intent/epoch/receipt, set `MERGED` and `merged_commit`, bind and accept exactly that artifact manifest, append audit evidence and unlock eligible dependents. Clear the pending marker only in this transaction. A command return code or receipt by itself never causes `MERGED`.

Use an immutable integration ID for retries; a completed retry returns its original result. Application recovery need not rerun every check when a durable authenticated receipt remains valid under its pinned policy and current trust generation. If fresh verification is required, retain the integration intent and all path/target reservations throughout it. The existing data-only profile may keep its current re-verification behavior.

## Crash and uncertainty reconciliation

| Durable evidence / observed target | Required recovery |
|---|---|
| Verification request exists; receipt absent; execution status unknown | Remain `VERIFYING`; query or safely stop the same verifier request. No fresh worker claim or inferred pass. |
| Valid receipt persisted; no integration intent | Restore `REVIEW` eligibility for that exact run and required review. No Git work has been authorized yet. |
| Integration intent exists; ref still equals expected base | Revalidate pinned evidence, trust and clean/collision checks under the repository lock, then perform that intent once. A refusal retains the unresolved intent until an explicit audited pre-integration abort or safe retry. |
| Ref equals candidate; checkout incomplete or finalization absent | Never reset Git to base. Finish safe checkout/reconciliation, verify receipt and CAS, then finalize that same intent. Repeated crashes and failed recovery checks preserve intent and locks. |
| Ref equals neither expected base nor exact candidate | Hold `MERGING` and target reservation for operator investigation. Candidate ancestry alone is not proof of this operation's successful integration. |
| Ref equals candidate but receipt/key is invalid, CAS is corrupt/missing, or local data collides | Keep integration unresolved; expose no accepted artifacts. Restore only verified identical evidence/bytes or perform a separately authorized trust/recovery operation. Never silently roll back an integrated candidate. |
| SQLite finalization committed; caller lost the reply | Return the existing accepted result. Do not update Git again or duplicate artifact acceptance/dependency transitions. |

## Accepted CAS handoff

An upstream manifest becomes available only after the atomic `MERGED` finalization. Each accepted reference records source repository/board/ticket/epoch, merged candidate/tree, acceptance receipt and manifest digest. Dependency lookup selects that accepted epoch/manifest, not every artifact ever uploaded under the ticket ID. The downstream claim pins this input manifest. The dispatcher verifies each content hash again and mounts the inputs read-only. Retries may deliver identical content repeatedly; consumer identity must make use idempotent. This is not a promise of exactly-once network delivery.

Corrupt CAS, foreign-board references, old-epoch outputs and post-verification manifest changes fail before child execution. Missing objects may be reconstructed only from the exact accepted candidate blob with matching manifest digest/size/mode, through a separately audited repair path; reconstruction cannot substitute a new artifact or silently accept a failed attempt.

## Required code and operational changes

- Split a separately trusted verifier-only entrypoint from `controller/merge.mjs`; remove target Git-write capability from its execution identity. Add bounded request/status/cancel APIs, durable run records and parent-owned receipt signing. The existing CLI cannot supply this protocol unchanged.
- Add a reviewed seed/board policy version with discriminated `python_data` and supported `external_application` profiles. Current seeds reject additional fields and cannot be edited in place. Add receipt verification/storage and gate-run fencing to `tools/board.py`; preserve legacy data-only behavior.
- Expand the durable integration record beyond the current candidate-only `merge_intent`. Add repository-wide ownership/reservation, full-ref binding, accepted-manifest provenance and idempotent external recovery. Migrate storage transactionally with real older-database fixtures; never synthesize an external passing receipt from an old `passed: true` field.
- Keep `tools/`, the signer, oracle imports, manifests and policy inventory protected. Bootstrap adapter/control-plane changes by independent review plus an explicit trusted-policy release, not ordinary worker acceptance. Fresh immutable batches adopt the release. Retired boards remain truthful historical records.
- Implement the first externally judged application profile and all declarative cases before enabling W14/W15. Retain complete offline regression checks and test hostile early exits, forged child reports, late receipts, crashes, collisions and accepted handoff through the actual adapter.

Trust assumptions remain explicit: a hostile administrator able to replace the approved verifier, steal its key, rewrite Git and roll back all trusted board/journal storage is outside this local protocol's assurance. Signatures and a local audit hash chain do not independently detect complete storage rollback. A stronger build-storage restore guarantee needs a separately anchored checkpoint and tested reconciliation. None of this proposal authorizes a deployment, paid model run, gameplay migration or live change to HD-001's current data-only gate.
