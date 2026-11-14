# Reviewed successor repairs: design and implementation sequence

Baseline: `7292ef71c6c96f6bcdcc82f0e3740f5e3b4b885f`. DR-190 coordinates the remaining three supplied high findings. This is the coordinator's concrete implementation design under the owner's instruction to continue repairs; choices below are implementation decisions, not new owner quotations. Paid provider runs stay disabled. The unseen fourteen findings are not covered.

## Scope and alternatives

Changing frozen v1 or mortal-v2 semantics in place would invalidate historical replay. Doing nothing would preserve those vulnerabilities. We instead add a mortal successor profile, an authored-knowledge presentation extension, and a restrictive versioned admission policy for new legacy observation writes. Existing frozen schemas/types and historical replay stay byte-compatible. No shared-world identity migration, live host, automatic model run or narrator authority is added.

The split character and mortal worlds still need one identity map, causal clock and atomic cross-profile transaction design. These repairs are prerequisites, not evidence that the two profiles have become one playable game.

## A. Encounter scope and recovery: mortal-rules/0.3.0

Add separate contracts/types/schema under SYSTEMS/mortal-v3 and packages/contracts/src/mortal-v3*.ts, with a freeze manifest. Preserve mortal-v2 files and behavior. The new version has its own explicit public API, reducer, signed event/receipt domain and SQLite entry point. Storage must retain existing async worker, incremental verification, exact retry, signature, scope, cursor and restart guarantees. Never reinterpret a v2 database as v3 or silently upgrade a genesis.

The small successor retains one active encounter. Its entire roster and site are locked until the encounter closes. A nonparticipant may act outside that site; travel into it, transfer to any roster actor and other reads/actions that mutate its objects/resources remain refused. An escaped roster member may not spend out-of-combat time until closure in this first policy. This avoids changing the existing same-site/cost assumptions; independent simultaneous encounters remain future work.

World time remains the sum of serialized action durations. Remote actors pay only their own active_seconds costs. An encounter pauses locally while remote activity advances that shared clock; no automatic turn passes, starvation or wall-clock decisions follow from that advancement. This is an explicit scheduling policy, not a simultaneous physical simulation.

A referee-only recover_encounter action carries encounter_id, turn_started_sequence, resolution (pass or close), and a bounded reason. The acting controller does not gain this capability. The turn token changes only when the active turn changes, not for unrelated remote commits. A normal expected cursor still protects every submission. A host_timeout reason is a trusted authenticated referee attestation, not cryptographic proof of elapsed wall time. Recovery passes the same current turn or closes the encounter, settles the current six-second round at most once, and never adds loot, heals, relocates actors or refunds resources. Closing/advancing must replay deterministically from the recorded action. Repeated IDs return the prior receipt; stale recovery tokens fail.

## B. Curated actor knowledge: dialogue 0.2.0

Keep the frozen campaign pack0.1 unchanged. Add a versioned, closed authored-knowledge sidecar and dialogue supplement0.2.0. Old supplement0.1.0 still validates with its original exact key set. The new sidecar records owner_actor_id, kind, bounded text, acquisition/validity bounds and exact source provenance. It is authored presentation input, not a canonical world fact, transferred memory, accepted bargain or authoritative acquisition event.

The campaign helper binds the catalog to the exact pack hash and full actor query. Host disclosure explicitly selects permissible knowledge for that actor/cursor/tenant. No catalog or pack-wide private data is sent to the model. A knowledge row must belong to the queried actor, be acquired by the query's time and sequence, and satisfy its validity/disclosure grant. Reject unknown IDs, cross-actor selection, malformed/passive-data violations, bad source hashes and oversized records. Refresh hashing covers the selected knowledge and provenance so revoked or changed context suppresses late generation.

Curate Melia's actual authored loan terms from QUICKSTART/ENCOUNTERS: free loan/no deposit, borrower supplies oil, an agreed return, and actual damage limited to five obols. They are her offer, not a claim that the player agreed or owes anything. Keep private impressions separate from shared room descriptions. Do not blanket-import private_knowledge, referee notes, variant truth, sample speech or every signal. Preserve deterministic silence and the post-ANOMALY cutoff.

## C. Legacy observation admission: observation-admission/1.0.0

This is deliberate containment at the authenticated write boundary, not a rewrite of v1 historical rules. The default new-submission policy admits self-authored, self-only private observations. Source identities must exist and match the proposing actor's authorized voice. Outsider recipient injection and third-party source impersonation are refused. Existing exact private system character carriers retain their self-source/self-observer shape and privilege checks.

External delivery requires a trusted host witness authorization bound to the full immutable proposal, authenticated principal, complete rights scope, current cursor and observation recipients. Party membership alone is not witness evidence. Keep the verifier outside the ledger writer lock; recheck cursor/authorization under the lock immediately before append, and honour cancellation. Exact authenticated retries may return their already committed receipt without acquiring a new witness grant. If any compatibility fixture explicitly exercises old admission, label it legacy and isolate it; do not make unsafe mode the production default or claim a fabricated witness.

The new callback authorizes current admission only. A legacy signed event does not contain that witness grant, so old replay still certifies only the original v1 rule/signature. Existing unsafe observations are not retroactively trusted, deleted or relabeled. Persisted signed witness evidence, quarantine/migration of old claims and a full successor epistemic profile remain explicit follow-up dependencies. New CharacterView still does not ingest ordinary legacy claims.

## Execution and ownership

Use a fresh integration branch and isolated Board worktrees; preserve all previous VERIFYING source records, worktrees and immutable intake seeds. Those records concern completed integrations, not active peers. The intake Board's deliberately failing gate cannot certify application code or unlock its DAG: record the reviewed successor batch separately, with links back to DR-190/200/210/220. No SQL status editing or fabricated cross-vendor review.

1. Freeze/review the three independent contracts and tests before parallel runtime implementation. Coordinator owns exports/integration manifests. Each implementation ticket owns disjoint files. Review peers are native instances, not cross-vendor reviewers.
2. Encounter lane: new mortal-v3 contract/schema/type files; version-specific ledger files and tests. Acceptance: v2 unchanged; v3 remote progress, site/roster lock, stale recovery, forged referee, exact retry, resource/time conservation, signed replay and restart. Store rejects version mixing.
3. Knowledge lane: new sidecar schema/types/data/helper; dialogue extension and model packet changes; dedicated tests. Acceptance: exact Melia terms in injected-provider request; wrong actor/scope/cursor/source absent or refused; future/expired/missing grants absent or refused; changed content cancels late output; no private/referee fields or new authoritative writes.
4. Observation lane: new admission contract/helper, openLedger ingress and dedicated tests. Acceptance: supplied private-source/recipient attacks rejected without state mutation; explicit host witness succeeds only for its exact binding; race/cancellation cannot deliver stale grants; character carriers and historical replay remain compatible.
5. Integrate immutable source commits, run affected tests and typecheck/contracts, obtain independent adversarial review, fix reproduced gaps, then run all ten application gate groups on the exact candidate with network disabled.
6. Retain portable evidence, candidate/source hashes, Board statuses, API examples, limitations and next dependencies; push/review/merge under the owner's standing authorization only after exact-candidate checks pass.

## Review focus

- Remote work must not reset a turn's recovery token or grant access to encounter inventory/site.
- Close/pass recovery must not double-charge a round or restart death/needs assessments.
- Shared room facts must never become a character's private opinion or vice versa.
- Catalog hashing alone does not establish host entitlement; knowledge needs an exact scoped disclosure grant.
- An asynchronous observation witness must not hold the writer lock or authorize a changed prefix; historical replay must not be misrepresented as proof of new witness evidence.

Design review and concrete schema hashes will be recorded with the successor batch before runtime lanes start.
