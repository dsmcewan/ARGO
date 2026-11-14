# Verified startup and durable conversation

Status: implementation design, 2026-11-14. Base: `8e2104c6d466b8b2bee2d0b23d984d2e60a65e11` (shared-world PR #5). The owner requested completing the remaining work. This pass implements startup improvements first, then an explicitly invoked conversational host. Paid provider calls remain disabled.

## 1. Scope and unchanged authority

Use the existing `shared-world/0.1.0` journal, authenticated sessions, scoped views and proposal-only model adapter. Preserve frozen contracts, signing domains, exact state/event/receipt hashes, full historical verification and existing gameplay admission. No checkpoint trust shortcut, world migration, Fate authority, background agent loop, UI or voice subsystem is introduced. An NPC reply cannot perform a physical action or accept a loan. Model calls use the existing context builder and character policies; deterministic test responses are labeled fixtures, not evidence of conversational quality.

Implementation order is cold replay → independent compatibility review and measurement → durable turn storage/host → explicit offline CLI → application acceptance. Source work uses separate Board leases/worktrees; native peers do not spawn subworkers. A Board source submission and independent source review are distinct from application acceptance. Its existing data-only protected gate is not rewritten to approve executable work.

## 2. Cold reconstruction

The earlier ordinary-process campaign measurement reports 74.37 seconds to open a verified handle at 2,000 events, and 59.40 seconds to replay 2,002 events. Both include all history checks; the handle measurement uses warm filesystem cache. The coordinator's improvement target is under ten seconds at 2,000 events on this machine, measured rather than asserted as a portable timing test.

Profile a fixed signed campaign history before editing. Preserve the baseline fixture privately for byte-exact comparison. Optimize only privately owned immutable identities. Candidate approaches are cached canonical fragments for unchanged state subtrees and an equivalent cached-genesis command binder. The public raw DTO guards must still reject hostile objects and foreign or caller-frozen state. No caller-provided flag, hash or `Object.isFrozen` is a trust capability.

Every state digest must equal the existing generic canonical hash preimage, including Unicode, key order, array order, numeric rules and all historical memories. Keep prior states and forks immutable. Preserve aggregate size/depth/node limits, every signature, every deterministic transition, receipt/request bindings and transaction publication after COMMIT. The fixed state preimage still contains all history, so full replay remains asymptotically quadratic in hashed bytes; this pass does not claim otherwise.

Do not edit freeze-pinned schema/validator files. If genesis contextual validation is a measured cost, the private binder runs the unchanged public Command guard without context and then reproduces every contextual scope/reference/policy predicate against a privately validated genesis. Test it differentially against the frozen guard for every action and invalid reference. Do not generalize the shortcut to arbitrary event/state/receipt inputs.

## 3. Durable host turn

One host is bound to one complete genesis, one authenticated player and one authenticated NPC. It receives free-form player text and a stable turn ID; identities, provider configuration and audience policy are host configuration. It constructs one player speech and invokes the existing NPC adapter at most once for that turn. Routing can try a bounded configured list of provider pools, once per pool; this is not a promise of exactly one HTTP request. No provider is discovered implicitly from environment variables.

Use a separate private SQLite outbox, never extra tables in `world.sqlite`. It stores operational delivery intent, not world truth. A worker owns SQLite so disk waits do not block the host event loop. Short transactions and revision compare-and-swap coordinate handles/processes; no transaction spans a session read, journal submit or model callback. Enforce bounded records/bytes/inflight RPCs, private paths and files, explicit create/open modes, schema identity and complete world/principal/policy binding. Corruption or a missing existing store is not a fresh conversation.

The session package exposes a durable store opener and a conversation constructor. The constructor internally creates fixed player/NPC sessions and the existing world model adapter, injecting its fresh NPC view. Model configuration accepts injected clients; tests and the CLI use explicit offline fixtures. Stable request IDs use a new host domain and complete world/actor/turn identity. Memory IDs retain the frozen `hash({domain:'shared-world/0.1.0/memory',genesis_hash,request_id,sequence})` grammar. Same turn ID with changed input conflicts. Validate and detach passive public DTOs before reading fields or awaiting.

The bounded API comprises starting/resuming a turn, reading its current result, explicit durable cancellation and closing the host/store. Final names and TypeScript types are recorded with source tests before CLI integration. A read never drives generation. Waiter cancellation does not cancel a different caller's turn. Explicit cancellation persists separately from dispatch recovery.

| Phase | Meaning and recovery |
| --- | --- |
| accepted | Input identity saved. Preparation may be retried because no submit is authorized yet. |
| input_pending | Exact prepared player command durably saved; dispatch intent is irrevocable. Reconcile only these exact bytes after ambiguity. |
| input_committed | Exact signed receipt verified and saved. Locate the inbound record through a fresh NPC scoped view. |
| generating | One permanent attempt marker, unique owner and deadline saved before calling the adapter. Other callers never invoke it again. |
| reply_pending | Exact generated NPC command saved before submit. Retry this command unchanged after acknowledgment loss; no rebase. |
| settled | Terminal outcome and verified receipts saved. This never authorizes cached text disclosure. |

The first durable CAS winner performs generation. This guarantee covers handles/processes sharing one canonical outbox file; independent outbox databases cannot coordinate their attempt markers. The CLI pins one outbox per fixed player/NPC/policy binding. If a process dies after consuming the attempt but before saving a result, recovery reports `generation_uncertain` and never automatically regenerates. A bounded deadline may terminate that attempt, but cannot authorize another. Fence late results by revision/attempt identity and cancellation. A duplicate caller may observe a pending attempt rather than steal it. Keep model deadlines absolute across recovery; do not restart a generation budget.

Pending dispatches are reconciled even when cancellation arrives after intent was saved: cancellation cannot undo a possible canonical commit. Cancellation prevents subsequent generation and delivery. Return a resumable pending state on unavailable storage; do not spin indefinitely. Definite admission failures settle; uncertain submit outcomes retain the exact pending command. `respond() === null` means generic `no_reply`, not proof of intentional silence. Errors may be privately classified without exposing NPC-private context.

Before NPC submission, recheck that the returned proposal is exactly the configured NPC, namespace, derived request ID, expected query and inbound record; speech only, addressed only to the fixed player with the configured audience. Never reprepare generated text at a newer cursor. The existing ledger decides stale admission and canonical reply deduplication.

## 4. Disclosure, receipts and local trust

After an accepted reply, get a fresh PLAYER query/view and select the exact committed memory using record ID, sequence, actor, text, audience and reply reference. Never display the model output, NPC-only view, raw event or cached outbox text. Repeat reads re-project, including after closure or memory eviction; they may return a committed receipt without currently disclosable text. A stable delivery ID permits consumer deduplication, but terminal printing is not claimed exactly once.

On recovery validate saved signed receipts against this exact command/principal and the verified journal prefix, using an internal bounded event lookup if necessary. A signature in the outbox alone is not proof that its prefix remains in the opened journal. Refuse a missing/divergent acknowledged prefix or foreign store. The sidecar is trusted local storage, not an independent anti-rollback anchor: restoring both stores together or losing silence/attempt tombstones remains a documented limitation. Do not claim this fixes historical rollback finding R13.

## 5. CLI and evidence

Extend the existing trusted-local-operator CLI without removing low-level session operations or the labeled demo. Conversation mode requires an explicit fixed NPC and offline reply configuration. Missing/invalid fixture configuration is rejected before dispatch. No SDK, credential lookup or arbitrary module loading is added. Every fixture result is labeled `offline_fixture`; unknown fixture turns fail rather than invent a fallback. Bound input/output and honor stdout backpressure.

Required evidence: independent ordinary-process replay comparison; raw DTO/fork/capacity/tamper/rollback controls; current two-handle and exact retry tests; crash points around both commits and generation; simultaneous claims through two handles/processes of the same outbox; cancellation and ignored late provider results; scope/policy binding; player-only disclosure after closure/eviction; same-ID conflicts; false/malformed/tool replies; held callback with an unrelated world writer; and CLI restart with private files. Finally run the unchanged ten-group application gate on the exact committed integration candidate, then CI and merge. Report actual measurements and live-provider limits separately.
