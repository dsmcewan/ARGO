# Shared-world storage reconnaissance

Read-only source baseline: `3fd1e4d99eede6853f62b8078e5921183a9f048c`, `/workspace/ARGO`, 2026-11-14. This report proposes a boundary; it is not a schema freeze, implementation result, application gate, migration approval, or production deployment. No repository files, Board state, external services, or provider calls were changed.

## Recommendation

Create one explicitly selected fresh-world profile, provisionally `shared-world/0.1.0`, with a new signed aggregate event and a dedicated SQLite file/table namespace. Reuse the mortal-v3 worker, transaction, request-index, receipt, and cold-replay patterns. A single admitted intent resolves mechanical changes and epistemic acquisitions together, signs them together, and inserts one event/receipt row in one SQLite transaction. Speech-only and mechanics-only intents still advance this one sequence. A session coordinator must not call `openMortalV3Ledger().submit()` and `createCharacterAuthority().submit()` as two halves of a successful turn.

Keep v1, character-memory/1.0.0, mortal-v2, and mortal-v3 opening/replay intact. Do not choose the new profile by inspecting an old database, append new tables to an existing mortal database, invent a v1 system-carrier bridge, or regenerate a campaign over live state. Cross-profile continuation needs its own anchored import and atomic cutover design. The new profile may compose frozen value types, but must not falsely label its aggregate cursor/history as a mortal-v3 or character-v1 journal.

## What can be reused

| Existing source | Reuse | Boundary to preserve |
| --- | --- | --- |
| `packages/ledger/src/mortal-v3/storage.ts` | Dedicated worker; detached passive DTO inputs; validated replies; bounded queue/pages/replies; asynchronous close that drains admitted calls | `openMortalV3Ledger` is host-only. Its interface has no cancellation API. A new session API must define cancellation rather than assume worker termination safely cancels a write. |
| `packages/ledger/src/mortal-v3/storage-worker.ts` | `BEGIN IMMEDIATE`; refresh before request lookup; unique request ID; canonical event/receipt storage; commit before publishing cache; rollback on failure; WAL/FULL; OS-managed SQLite locks | Worker-owned synchronous SQLite keeps the parent event loop responsive. Every separate handle has its own cache/worker; SQLite serialization, not that cache, supplies the shared writer order. |
| `packages/ledger/src/mortal-v3/journal.ts` | Complete signed command/principal, genesis/scope binding, before/after state hashes, deterministic draw/effect recomputation, domain-separated signed receipt, duplicate-ID whole-replay check | New effects and acquisitions must be in a new event grammar. Existing v3 receipts contain privileged effects and are not public session views. |
| `packages/ledger/src/mortal-v3/rules.ts` | Pure `resolveMortalV3` mechanics through a reviewed internal adapter | It owns cursor checks, global RNG order, time, encounter turn sequence tokens and immutable genesis definitions. Do not persist its journal separately. |
| `packages/ledger/src/index.ts` | Exact retry before new policy; recheck cancellation after awaited reads; deterministic prefix validation; durable-append acknowledgment discipline | JSONL plus snapshot is one v1 journal, not a transaction coordinator for two stores. Snapshot is derived, not authority. Its within-handle byte-prefix guarantees exceed mortal-v3's documented cached-prefix assumption. |
| `packages/ledger/src/characters.ts` | Admission invariants, immutable replay staging, acquisition-time/sequence semantics, complete request hashing and conflict reconciliation, historical projection tests | There is no independent character database: the authority stores private system `observe_claim` carriers in the v1 ledger. `replayCharacters` depends on v1 actors/alive/Fate/cutoff state and selected v1 action types. It cannot consume mortal-v3 events unchanged. |
| `tools/board.py` | Build ticket coordination, disjoint write claims, immutable candidate/CAS evidence | This is a separate build-control database. It is not gameplay storage or an application-test runner. |

Existing mortal-v3 limits are concrete starting bounds, not unlimited scalability: 128 outstanding RPCs, 16 MiB replies, at most 1,000 events/page, one million events, five-second SQLite busy wait. Snapshot size also grows with accumulated state; new epistemic histories need bounded projected views/pages, and explicit limits, before claiming long-running sessions. A worker prevents parent-loop blocking but does not remove O(history) cold replay or growing-memory costs.

## Proposed exact boundary for contract review

New paths should be owned explicitly: `SYSTEMS/shared-world-v1/{CONTRACT.md,shared-world.schema.json,FREEZE.json}`, `packages/contracts/src/shared-world-types.ts`, `packages/contracts/src/shared-world.ts`, and `packages/ledger/src/shared-world/{index.ts,rules.ts,journal.ts,storage.ts,storage-worker.ts,view.ts}`. Naming/version is proposed; freeze it before parallel implementation. The global freeze index and package exports remain coordinator-owned integration files.

The minimal public signatures should be:

```ts
type SharedWorldCursor = {sequence: number; head: string};
type SharedWorldReceiptTrust = {
  scope: Scope; genesis_hash: string;
  authority_key_id: string; authority_public_key: string;
};
type SharedWorldOpenOptions = {
  path: string; genesis: SharedWorldGenesis; privateKey: KeyObject;
  expectedHead?: SharedWorldCursor; // trusted ancestor, not asserted latest
};
interface SharedWorldLedger { // host capability; never public transport
  snapshot(): Promise<SharedWorldState>;
  events(page?: {after: number; limit: number}): Promise<SharedWorldEvent[]>;
  submit(command: SharedWorldCommand,
         principal: SharedWorldPrincipal): Promise<SharedWorldReceipt>;
  close(): Promise<void>;
}
function openSharedWorldLedger(options: SharedWorldOpenOptions): Promise<SharedWorldLedger>;
function initialSharedWorldState(genesis: SharedWorldGenesis): SharedWorldState;
function resolveSharedWorld(genesis: SharedWorldGenesis, state: SharedWorldState,
  command: SharedWorldCommand, principal: SharedWorldPrincipal,
  admission: SharedWorldAdmission): SharedWorldResolution;
function createSharedWorldEvent(genesis: SharedWorldGenesis, state: SharedWorldState,
  command: SharedWorldCommand, principal: SharedWorldPrincipal,
  admission: SharedWorldAdmission, privateKey: KeyObject): {
    event: SharedWorldEvent; state: SharedWorldState; receipt: SharedWorldReceipt;
  };
function verifySharedWorldEvent(genesis: SharedWorldGenesis, state: SharedWorldState,
  event: SharedWorldEvent): SharedWorldState;
function replaySharedWorld(genesis: SharedWorldGenesis,
  events: readonly SharedWorldEvent[]): SharedWorldState;
function verifySharedWorldReceipt(receipt: SharedWorldReceipt,
  trust: SharedWorldReceiptTrust,
  expected: {request_id: string; request_hash: string}): void;
```

`admission` is an authority-created, closed DTO, not a submit-caller argument. With a fully deterministic frozen witness policy it can be a versioned policy identifier and checked inputs derived from the current state. If the milestone needs external host evidence, open options require a separate reviewed host capability and the event must persist its bounded, fully bound assertion. The worker must not execute a host/model callback in a SQLite transaction. Preflight outside-lock host work must bind full command/principal, scope, cursor, policy and recipients, then relock and revalidate before append. The prior observation callback is transient and cannot simply be reused as replayable evidence. Final session policy owns the exact witness rules; this storage recommendation does not equate party membership or being addressed with hearing.

For the smallest implementation, keep storage's `submit` free of a signal API and let a session coordinator cancel before dispatch. Once RPC dispatch has occurred, cancellation or lost response is an ambiguous outcome reconciled by identical request ID. If caller cancellation after dispatch is a milestone requirement, add a separately specified cancellation protocol with an atomic/worker-visible flag and explicit commit point; sending a cancellation message behind a blocked synchronous transaction cannot prevent that transaction from committing. Never kill a shared worker to cancel one request. A parent-side `Promise.race` alone only abandons waiting.

Required wire identity:

- Genesis contains the full Scope, immutable actor/controller registry, rules/profile versions, seed, authority key identity, immutable mechanics seed and character/knowledge initialization. Character and mechanical actor IDs share one registry; no mutable sidecar mapping can grant identity.
- Command contains profile version, Scope, request ID, actor ID, expected aggregate cursor, causation reference and one closed action union. It contains intentions; callers do not submit resolved effects, knowledge acquisitions, state hashes or authority roles as trusted facts. Typed atomic compound intents must be admitted explicitly; do not expose an arbitrary list of subcommands/effects as a shortcut.
- State has one aggregate sequence/head/world time and one RNG order, plus mechanics and epistemic/character data. Avoid two mutable actor-life/custody/location authorities. A mechanical transition determines those values; character views derive their current-life status from the same prefix.
- Resolution returns detached next state plus canonical ordered `draws`, `mechanical_effects` and `epistemic_effects`. Each acquisition identifies its record, observer, committing sequence and acquisition world time; the claim's alleged occurrence time is separate. Same-tick later speech cannot backdate acquisition to an earlier sequence.
- Event body contains version, Scope, genesis hash, sequence, previous hash, complete command, complete authenticated principal, persisted admission, before/after aggregate state hashes and both effect lists/draws. A successful transfer with a witnessed utterance is one event; either both consequences replay or neither exists.

Specify exact signing domains instead of reusing another profile's bytes:

```text
request_hash = SHA256(canonical({domain:'shared-world-request/0.1.0', command, principal}))
before_hash / after_hash = SHA256(canonical(state without head))
event_signature = Ed25519(canonical({domain:'shared-world-event/0.1.0', event:body}))
event_hash = SHA256(canonical({...body, signature:event_signature}))
receipt_signature = Ed25519(canonical({domain:'shared-world-receipt/0.1.0', receipt:receiptBody}))
```

The receipt body should contain version, Scope, genesis hash, authority key ID, request ID/hash, event hash, cursor and after-state hash. It does not need all effects: omit them to reduce accidental disclosure and get presentation data through a separately authorized view. Receipt verification requires externally pinned trust and expected request identity; a valid signature alone is not permission to disclose its contents. Sequence zero head should be the aggregate genesis hash, giving a non-null checkpoint convention.

### Mechanical reducer adapter detail

Do not put a `MortalV3State` with its original independent cursor into persistent aggregate state. Persist its domain fields (actors, items, stocks, opportunities, encounter, RNG/time) under aggregate identity, and reconstruct a transient v3 state only to call the frozen pure reducer. Validate the outer command's aggregate cursor first. Supply the adapter command's expected cursor from that reconstructed transient state, not caller-chosen substitutes.

There is an important initial-state exception: `rules.ts::bindState` compares sequence-zero state byte-for-byte with `initialMortalV3State`, whose head equals `hash(mortalGenesis)`. Passing `hash(sharedGenesis)` at sequence zero fails. The adapter must use the canonical inner initial head for that first pure call while the outer layer has already enforced the shared genesis cursor. At later sequences, use the aggregate sequence/head consistently; strip adapter-only version/scope/genesis/cursor fields from the resulting mechanics payload. Document and test this mapping. Encounter `turn_started_sequence` must be the aggregate next-event sequence and remain unchanged across speech/remote events that do not advance that turn. A speech-only event advances aggregate sequence without consuming mechanical RNG or time unless the new contract expressly gives it duration.

Do not reuse `createMortalV3Event`/`replayMortalV3` as the aggregate journal or hide an inner signed ledger. Reuse `resolveMortalV3` behind the explicit adapter and sign/replay the resulting shared transition once. If implementing this adapter requires changing frozen v3 semantics, prefer a new versioned reducer module over modifying existing v3 replay.

## Atomic store algorithm

Use a single application file and new strict tables, e.g. `shared_world_v1_meta(singleton,genesis_hash,genesis_json)` and `shared_world_v1_events(sequence,event_hash UNIQUE,request_id UNIQUE,request_hash,event_json,receipt_json)`. One event row already serves as the durable request index; no sidecar request journal is needed. Read-only projections may initially be rebuilt in memory. A later SQL materialization must update its cursor in this same transaction, or be an explicitly derived, replayable consumer that serves only a common confirmed prefix. Transport delivery is not knowledge acquisition; any durable delivery queue is an outbox in the same transaction, not another authoritative store.

1. Validate passive/closed/bounded DTOs before reading active properties or cloning; copy before queuing RPC. Validate filename and signer and refuse foreign/v1/v2/v3/mixed application files before changing journal mode, schema or metadata.
2. Worker starts `BEGIN IMMEDIATE`, verifies metadata and refreshes the durable prefix, then looks up request ID. An exact complete command/principal retry returns the committed receipt before current-head, cooldown or new-author checks. Changed content or authenticated identity conflicts. New host attempt IDs must not change client request identity.
3. Validate the original expected aggregate cursor, authorization, all mechanical dependencies and all disclosure/admission constraints against that one state. Resolve mechanical and epistemic consequences on detached candidate state. A bad last acquisition must not leave earlier mechanical mutations cached.
4. Sign aggregate event and receipt; insert their canonical bytes and request identity. COMMIT once. Only after successful COMMIT publish the candidate cache and reply. Failure before COMMIT rolls back event, request ID, state/RNG/time and acquisitions together. Failure after COMMIT but before reply requires retry reconciliation; never promise it means no commit.
5. Full cold replay at open verifies signatures, hash chain, genesis identity, deterministic effects/draws, state hashes, acquisitions and whole-history request uniqueness. Replay must not consult network, a current host callback, wall clock, or a new catalog version. Catalog/activation references affecting meaning must be immutable and genesis/event-pinned.
6. Multiple workers/handles serialize writes through SQLite, refresh after acquiring the transaction and reject stale distinct requests. They can return the same receipt for concurrent exact duplicates. `close()` drains admitted work. No callback, provider call, narration, or filesystem sidecar is required to decide a transaction.

### Integrity and restart limits

Mortal-v3 `refresh()` checks immutable metadata and the SQL `event_hash` at the cached sequence, then verifies only suffix events. Pages/retries call `rowValue()` and rebind canonical event bytes to their signed receipt. A snapshot on a warm handle does not reread every old byte; a privileged editor who bypasses append-only triggers can alter an old row while preserving the cached terminal hash. This is documented in v3, not a new complete tamper guarantee. Reopen cold replay catches invalid old bytes; an external trusted ancestor checkpoint catches rollback to an older valid history. A metadata row or checkpoint inside the same database is not an external anchor.

Minimum reuse recommendation: freeze that append-only trusted-host storage assumption explicitly for the new fresh-world profile, with cold verification and optional externally supplied checkpoint. Do not advertise the stronger v1 exact-byte warm-prefix detection unless it is implemented. If stronger live-editor detection is required, add a measured full-prefix byte/fingerprint recheck in the worker before adopting incremental replay; do not call file size/mtime or a stored terminal hash sufficient. Preserve this choice in tests and release limitations rather than changing trust silently when moving from v1 to SQLite.

Backup/restore must include committed WAL semantics: use SQLite backup or a correctly checkpointed closed database, not an arbitrary copy of the main file while WAL commits are outstanding. A restart after process death must release SQLite locks and return either the old full aggregate prefix or the new full prefix. Persistence of external trusted checkpoints, signer custody, backup provisioning and authenticated host sessions remain operational responsibilities.

## Required test evidence

Prefer new `TESTS/shared-world-contracts.test.ts`, `shared-world-rules.test.ts`, `shared-world-journal.test.ts`, `shared-world-storage.test.ts`, `shared-world-session.test.ts` and scoped-view tests. Existing useful patterns are `mortal-v3-storage.test.ts` (14 tests), `mortal-journal.test.ts`, `ledger-cache.test.ts`, `character-cache.test.ts`, and `observation-admission.test.ts`. Port the properties to the new grammar; passing old tests alone does not verify a new transaction boundary.

| Required regression | Observable assertion |
| --- | --- |
| One action with physical and epistemic consequences | One row, one receipt/cursor, one RNG progression; every replay prefix has both effects or neither. |
| Later epistemic validation failure | Resource/custody/time/RNG, knowledge, row count and request ID remain unchanged; valid retry with a new ID can still succeed. |
| Speech-only and mechanics-only interleaving | One global sequence; no accidental speech RNG/time cost; encounter turn token survives irrelevant events. |
| Initial inner-genesis adapter and speech-first world | First mechanical event works both as sequence 1 and after speech; full replay is identical; stale outer cursor cannot borrow an internal cursor. |
| Independently signed tampering | Re-sign wrong mechanical effects, recipients, acquisition times, draws or after hash with test key; deterministic replay still rejects. |
| Duplicate request ID | Same complete request/principal across two handles and restart gives the identical receipt and no second spend/acquisition; altered scope/content/principal conflicts even after state advances. |
| Two distinct requests at one cursor | Exactly one succeeds; loser has no event or acquisition. Re-resolving on a new cursor requires a newly constructed command. |
| Crash/worker loss before COMMIT and after COMMIT-before-reply | Reopen shows exactly old or new aggregate prefix; exact retry returns the original durable result if committed. Use independent workers/process control and real SQLite boundaries, not a mocked successful submit. |
| Slow writer and close | Parent heartbeat remains responsive, busy timeout is bounded, process death releases lock, close drains admitted calls and rejects new ones. |
| Cold replay/ancestors | Every event prefix matches snapshot; wrong genesis/key/scope, missing middle row, altered index/receipt/event bytes and external-checkpoint rollback fail. A valid ancestor is allowed, never reported as latest. |
| Foreign-file refusal | Old/mixed database bytes and journal mode unchanged on refused open. |
| Passive data/mutation/bounds | No getter/proxy trap invocation; caller mutation after enqueue cannot alter the request; detached responses cannot poison cache; caps reject predictably. |
| Witness/host evidence, if used | Host runs outside lock; full binding, original budget, expiry and cancel checks; stale state no append; late callback no resurrection; duplicate-first reconciliation. |
| Safe disclosure at one cursor | Session actor/party views never use privileged snapshot/event/receipt effects; other actors' private impressions stay private; an earlier sequence/time cannot gain later acquisitions; current cutoffs still apply. |
| Restarted session and authored activation | Session resume validates identity/cursor; catalogs/activation and observations resolve to the committed prefix without reconstructing knowledge from rendered transcript. |

The signer is trusted to attest host admission, not to make an unobserved claim true. Persisted authority signatures prove what that authority committed; tests cannot establish real human hearing, production authentication or host perception quality.

## Board tickets and honest application acceptance

Use `tools/board.py`, not Pantheon's distinct JavaScript Board. `owned_paths` is the exact write-claim field; there is no `read_paths` seed field. A path owns its subtree whether or not written with a trailing slash. Avoid one lane owning `packages/ledger/src/shared-world/` while another owns a file inside it. The CLI claim chooses the first ready ticket matching model/wave/order; it does not accept a desired ticket ID. Parse the returned ticket ID/token and assign that actual claim.

Recommended sequence: contract/spec review and freeze first; then create a new source-delivery batch at the frozen integrated baseline with disjoint lanes. Example ownership split:

| Lane | Exact write paths |
| --- | --- |
| Pure authority | `packages/ledger/src/shared-world/rules.ts`, `packages/ledger/src/shared-world/journal.ts`, `TESTS/shared-world-rules.test.ts`, `TESTS/shared-world-journal.test.ts` |
| Durable store | `packages/ledger/src/shared-world/storage.ts`, `packages/ledger/src/shared-world/storage-worker.ts`, `TESTS/shared-world-storage.test.ts` |
| Scoped session/view | Separate session module subtree plus `packages/ledger/src/shared-world/view.ts`, its new session/view tests |
| Coordinator only | Public `index.ts` exports, package manifests, global freeze registry, shared fixtures, integrated scenario and application gate evidence |

Freeze the reducer/journal/store signatures before those lanes start. Production module imports may refer to frozen not-yet-implemented sibling paths, but a worker must not create competing stubs in the other lane. Report integration-only type failures distinctly. Give each lane its own evidence-directory ownership if committed evidence is required; CAS artifacts must name an owned candidate regular file and match its committed bytes.

Required seed fields are exactly `schema_version:1` and `tickets`, with each ticket containing `id,wave,lane,title,seat_model,reviewer_model,owned_paths,gate_cmd,spec_path,depends_on,max_attempts`. A fail-closed source-delivery gate can follow the existing review-successors seed:

```json
"gate_cmd": ["python3", "-c", "raise SystemExit('Application acceptance remains external to data-only Board policy')"],
"reviewer_model": null,
"depends_on": []
```

This does not pass a Board gate. `reviewer_model:null` must be accompanied by an honest separately recorded native independent review; do not invent a different vendor to satisfy the Board's cross-vendor review check. If an actual reviewed application oracle adapter is introduced, that is separately authorized control-plane work, not an ordinary feature-lane change.

Coordinator/operator command templates (not executed here):

```sh
python3 tools/board.py --repo /workspace/ARGO --board-dir /workspace/ARGO/.board/shared-world init docs/shared-world/seed.json
python3 tools/board.py --repo /workspace/ARGO --board-dir /workspace/ARGO/.board/shared-world claim shared-storage gpt-6-astra --lease-seconds 900
python3 tools/board.py --repo /workspace/ARGO --board-dir /workspace/ARGO/.board/shared-world prepare-worktree "$TICKET" "$WORKER" "$TOKEN"
python3 tools/board.py --repo /workspace/ARGO --board-dir /workspace/ARGO/.board/shared-world heartbeat "$TICKET" "$WORKER" "$TOKEN" --lease-seconds 900
python3 tools/board.py --repo /workspace/ARGO --board-dir /workspace/ARGO/.board/shared-world put-artifact "$TICKET" "$WORKER" "$TOKEN" packages/ledger/src/shared-world/storage.ts "$WORKTREE/packages/ledger/src/shared-world/storage.ts"
python3 tools/board.py --repo /workspace/ARGO --board-dir /workspace/ARGO/.board/shared-world submit "$TICKET" "$WORKER" "$TOKEN" "$FULL_SOURCE_SHA"
python3 tools/board.py --repo /workspace/ARGO --board-dir /workspace/ARGO/.board/shared-world get "$TICKET"
python3 tools/board.py --repo /workspace/ARGO --board-dir /workspace/ARGO/.board/shared-world render
python3 tools/board.py --repo /workspace/ARGO --board-dir /workspace/ARGO/.board/shared-world verify-audit
```

Only a live CLAIMED lease supports heartbeat/artifacts/submit. Submit consumes the lease and moves to VERIFYING. If no source is submitted, release with `fail-claim "$TICKET" "$WORKER" "$TOKEN" 'precise reason'`; it is a retry/failure transition, not completion. Do not give workers Board DB/CAS/control metadata access or treat a full Git worktree's existence as OS-level confinement.

Two important limitations affect planning:

1. At initialization Board pins existing TESTS/scripts/controller/tools/manifests/global-freeze blobs; modifying them can be refused at submit even when an owned path permits the edit. New test files are not pre-existing pinned blobs, but the data gate still cannot execute them. Contract-first integration before opening the runtime batch avoids freezing stale manifests/tests into a later ticket's baseline.
2. Board dependencies unblock only when predecessors are actually MERGED. Source deliveries retained at VERIFYING under the intentionally data-only policy never satisfy those dependencies. Do not create an automatic runtime DAG depending on a contract ticket that cannot honestly reach MERGED. Complete the independently reviewed contract/integration phase externally, then initialize the runtime source batch from that baseline. Do not edit SQL status or call `merge` to imply an external application pass was a Board pass.

For external application acceptance, use the existing reviewed exact-candidate runner, after source integration and independent review:

```sh
python3 docs/characters-runtime/evidence/run-candidate-gate.py \
  --repo /workspace/ARGO --candidate "$FULL_INTEGRATED_SHA" \
  --npm-cache /home/agent/.npm \
  --output /workspace/reports/2026-11-14-argo-shared-world/application-gate
```

It performs an offline disposable clone/install and a read-only network-isolated Bubblewrap ten-group gate; it never merges or promotes operational trust. Namespace denial is a failed/unavailable gate, not success. Review and acceptance must name the exact full commit and artifact hashes, then final source changes require a new gate. Ordinary protected-policy merges also require the separately trusted controller and explicitly approved trust root described in `controller/README.md`; a raw local `npm run gate` or a Board source submission is not that approval.

Record the Board's real source-delivery states and external application verification separately, as `docs/review-successors/{BOARD.md,source-submissions.json,verification.json}` already do. Preserve reachability of reviewed source commits in integration history. No paid/live test is needed for these storage/replay/concurrency claims.
