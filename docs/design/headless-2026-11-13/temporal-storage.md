# Temporal storage, identifiers and delivery

Status: **design proposal for review, not a freeze or implementation**. Decisions D02, D05 and D06 remain open. Native Codex contribution; no paid vendor execution. Source baseline: `41f2cb8568b53fac984e1114d7342eef540bb6d5`, inspected 2026-11-13. Runtime and frozen v1 files are unchanged. All companion cases are declarative and `not_executed`; no new runtime guarantee is claimed.

## 1. Evidence and existing behavior

References below name repository files at that exact baseline:

- **S1:** `SYSTEM_ROADMAP.md:150–190,283–290,300–317`: D02/D05/D06 deliverables, W03 contract gate, independent projector lanes and later bus integration.
- **S2:** `SYSTEMS/ARCHITECTURE.md:3–54`: frozen contracts; scoped authority; causal/epistemic shared sequence; acquisition filters; current exposition policy; serialized/reject execution; only authorized clock advancement.
- **S3:** `packages/contracts/src/generated.ts:19–37` and `SYSTEMS/argo-v1.schema.json:508–510,885–918,943–967,1086–1234`: present proposal/checkpoint/query fields and identifier-keyed state maps. Generated types are evidence of v1 shapes, not permission to change them.
- **S4:** `packages/contracts/src/index.ts:13–47,59–63`: canonical strings are preserved; object properties `__proto__`, `constructor`, `prototype`, accessors and unsafe values are rejected; lookup uses own-property checks.
- **S5:** `packages/ledger/src/mechanics.ts:18–35,64–75,88–128`: head/time checks; observation occurrence and party rules; acquisition at commit; mutable state maps; strict replay. V1 has no general historical-correction, membership-change, speech-delivery or expedition action.
- **S6:** `packages/ledger/src/index.ts:43–69,74–110,119–122`: private signed file ledger, supplied/file genesis equality, exact retries, durable append, derived snapshot cache and explicit queue/fork refusal.
- **S7:** `packages/lexi-bridge/src/index.ts:28–44`: snapshot-based mock; acquisition-time and sequence filtering; explicit observer and party checks; current world/branch anomaly cutoffs. No background materializer is implemented.
- **S8:** `packages/argo-dm/src/index.ts:8–42` and `packages/interventions/src/index.ts:4–36`: scoped checkpoint proposals, narration refresh before/after generation, bounded optional callbacks, no automatic rebase of subsequent proposals.
- **S9:** `RESEARCH/HEADLESS_FOUNDATION.md:14–39`, `RESEARCH/SYNTHESIS.md:27–41`: proposed separate graph planes, temporal axes, common checkpoints, future 10,000-event workload and bus; SQLite is not an established gameplay store.
- **S10:** `REPAIRS/RESOLUTIONS.md:18–21`: unresolved outcome binding, identifier domain, authenticated genesis and rollback assurance.
- **S12:** `MECHANICS/tempted-fates-v1.md:7–15`: one v1 tick is one second; clock advancement alone does not debit lifespan or change age. Later time models must version that behavior.
- **S11:** `RESEARCH/findings/01_referee_loops.md:26–66`, `02_sandbox_concurrency.md:27–69`, `03_world_simulation.md:26–57`: proposed session state, expedition appointments, explicit disclosure, bounded ticks and no implicit wall-clock catch-up.

Today both event kinds enter one scoped authority ledger. `ClaimRecord.acquired_at` is committed world time, `sequence` is committed order, and `Observation.occurred_at` may be earlier. `KnowledgeQuery.as_of_world_time` limits acquisition; it is not a generic canonical-fact valid-time query. All actors in a v1 world/branch share the current anomaly presentation restrictions. Private claims and hidden physical state are not public merely because a projector can read them. [S2,S5–S7]

## 2. D05: storage options and recommendation

Considered options:

1. **Two SQLite databases per complete scope, plus a checkpoint coordinator — recommended for the first headless implementation.** Local, deterministic, rebuildable; operationally similar to existing tooling without reusing its database. Independent transactions require an explicit publication barrier.
2. **Separate PostgreSQL databases/services.** Better candidate for demonstrated multi-host operation and concurrent query demand, with additional deployment, security and backup work. No measured workload currently justifies selecting it.
3. **Dedicated graph engines for both planes.** Potentially useful for measured traversal workloads; schema/temporal semantics and isolation would still need implementation. Existing LEXI evidence establishes no deployed gameplay graph to reuse.

These are engineering recommendations, not benchmark results. Before adoption, W01 must verify selected reuse evidence and the owner must supply scale, latency, retention and recovery objectives. Select the TypeScript SQLite binding/runtime separately; do not assume an installed package or add Python gameplay rules.

Retain the signed **file ledger** as authority. For each canonical full `Scope`, allocate an opaque service-controlled directory containing logically named `canonical.sqlite` and `epistemic.sqlite`; never derive paths from untrusted IDs. These are physically distinct files, not two tables in `board.db` or LEXI's case database. Each has exactly one designated projector writer and read-only query connections. WAL plus full durability is a proposed operating configuration requiring crash/power-loss verification on the selected filesystem. Distinct files alone do not authenticate readers or provide separate tenant/process security.

The initial trusted projector enclave can verify the private journal and derive both planes. Public services receive neither journal access nor signing keys. Plane A stores authorized physical history and excludes undisclosed claim payloads, donor receipts and raw RNG. Plane B stores claims, acquisitions and provenance and excludes private seed/draw material. Neither database is mounted into an agent. A scoped query service enforces actor/rights authorization; physical facts are not automatically actor knowledge. Separate OS write capabilities and a single projector lease per plane are implementation requirements, not established features.

Proposed internal metadata sketches (names/version strings are provisional):

```text
Prefix = {scope: Scope, sequence: SafeInt, head: Hash|null}
PlaneCursor = {plane: "canonical"|"epistemic", prefix: Prefix,
  projector_version: string, schema_version: string,
  store_generation: OpaqueId, state_digest: Hash}
CommonCheckpoint = {checkpoint_id: OpaqueId, prefix: Prefix,
  genesis_identity_ref: OpaqueId, canonical: PlaneCursor,
  epistemic: PlaneCursor, checkpoint_format: string}
```

All complete scopes, sequences and head hashes must agree; a common numeric minimum alone is insufficient. Each projector records every verified event position, even when an event produces no rows in its plane. Each SQLite transaction commits both row changes and its cursor. Reprocessing the same position/hash has no extra effect; a different hash at that position halts. Digests cover deterministic logical rows at the prefix, not SQLite page/WAL bytes. Internal plane digests and manifests are private operational metadata; callers receive an opaque checkpoint handle whose server-side binding is verified.

A trusted coordinator selects bounded target prefix N, waits for both committed cursor receipts, verifies the same ledger identity/hash and publishes an immutable manifest plus an atomic durable current pointer. It writes no world truth. Do not claim an atomic distributed transaction across the two files. Readers atomically register a bounded retention pin with the coordinator for a manifest/store generation, open read transactions in both databases, verify each store identity and retained coverage, then read temporal rows at exactly N. Both read transactions remain open until the bounded query finishes. If a pin expires before transactions open, refuse/restart; do not read a possibly retired generation. Active transactions protect their snapshots while the coordinator pin prevents generation deletion/history compaction. Release transactions and pin after completion; crashed-reader pins expire under the reviewed retention protocol. Keep the prior published generation available while reads are pinned. Bounded historical retention and unavailable-history errors must be specified; never prune a still-pinned prefix. Initial scheduling should use publication barriers rather than unlimited projector divergence.

Crash behavior is part of the protocol:

- A commits N while B remains M: retain the last verified common manifest M; a caller explicitly requesting N gets lag/unavailable, never A(N)+B(M). No silent downgrade of an exact request.
- Both commit N, coordinator crashes before publication: on recovery verify both receipts and authority prefix, then publish N once. Do not replay effects to manufacture matching cursors.
- A published file/cursor is missing or corrupt: fail that checkpoint closed. Rebuild into new private store generations from verified history, compare logical digests, then publish replacements atomically. Do not silently reinterpret an old handle.
- Ledger append succeeds while either projection lags: the action remains committed. Retry the same proposal identity to reconcile; projection lag is not rollback or action failure.

A local genesis fingerprint is useful for accidental mismatch detection but is not D03 authenticated import. A coordinator manifest in the same storage/backup domain is not D04 rollback protection. Imported or restored histories require those separately reviewed trust decisions before their stronger assurances are advertised. [S6,S9,S10]

## 3. D05: temporal model and query boundary

Keep four concepts explicit:

| Concept | Meaning and proposed representation |
|---|---|
| Valid time | When a physical assertion applies in fictional time: `valid_from_tick`, exclusive `valid_to_tick` or null. |
| Recorded sequence | The ledger prefix at which that assertion version was recorded: `recorded_from_sequence`, exclusive `recorded_to_sequence` or null. Ledger sequence, not OS arrival time. |
| Acquisition | When a named actor's observation became committed knowledge: `acquired_at_tick`, `acquired_at_sequence`. Initial compatibility preserves commit-time acquisition. |
| Current policy | Present entitlement/actor authorization and anomaly restrictions applied at response/delivery, even when querying earlier history. This is a separate fresh policy checkpoint. |

A physical relation sketch:

```text
CanonicalRelationVersion = {scope, relation_id, subject_id, predicate,
  object_ref, valid_from_tick, valid_to_tick,
  recorded_from_sequence, recorded_to_sequence, source_event_refs}
Acquisition = {scope, acquisition_id, claim_id, knower_id,
  acquired_at_tick, acquired_at_sequence, source_event_ref,
  party_disclosure_id: Id|null}
Claim = {scope, claim_id, kind, source_actor_id, content,
  occurred_at_tick, source_claim_refs: Id[]}
```

`object_ref` needs an explicit tagged entity/scalar union before freeze. No untyped arbitrary graph properties become authority rules. Use separate claim and per-actor acquisition rows so later disclosure does not alter an earlier actor's cutoff. V1 `observers` expands to one acquisition per observer without inventing any additional observer. A claim's provenance is not automatically readable merely because its derived claim is; private source references must be redacted or returned only through authorized handles. Source confidence stays a belief attribute; authority truth assessments are separately privileged.

All tick/sequence bounds are nonnegative safe integers; starts must precede finite exclusive ends. Record-version rows use half-open intervals. Do not publish empty valid intervals; preserve an earlier same-tick state through its recorded revisions instead. For ordinary v1 physical transitions, valid time starts at the committed action tick. Recorded revision ranges preserve the different answers at each prefix; consecutive changes at the same tick must not collapse earlier prefix results. Closing a derived row's interval is rebuildable projection maintenance, not editing ledger history. **Do not overwrite an old row's valid_to and merely filter source_sequence.** For example, at recorded seq10 the row says custody=B over valid `[30,infinity)`. An authorized clock advance reaches tick40 before prefix12; a later seq13 event at that same tick40 changes custody to C. Preserve the old B revision as `(valid=[30,infinity), recorded=[10,13))`; append B's shortened revision `(valid=[30,40), recorded=[13,infinity))` and C's new interval `(valid=[40,infinity), recorded=[13,infinity))`. At valid40/prefix12 the answer remains B; at valid40/prefix13 it is C. Both queries are within their prefix world-clock bounds. A single overwritten B row would incorrectly erase the first answer. Use explicit deterministic revision IDs and retain all superseded revisions needed by pinned prefixes. Updating recorded_to closes that version's visibility; its historical valid interval remains intact.

Proposed API separation:

```text
CanonicalHistoryQuery = {scope, checkpoint_id, valid_at_tick, selector}
ActorKnowledgeQuery = {scope, checkpoint_id, actor_id,
  audience: "actor"|"party", party_id: Id|null,
  acquired_through_tick, acquired_through_sequence,
  claim_occurred_at_or_before: Tick|null}
```

The principal is authenticated outside these JSON objects. A canonical-history endpoint is authority/operator-only initially; no generic player graph join is implied. `checkpoint_id` binds a verified prefix, store generations and projection versions. Acquisition cutoffs cannot exceed its sequence/world-time bounds. Reject canonical valid-time requests later than that prefix's committed world clock, earlier than supported genesis history, or outside retained coverage. An open-ended stored interval is not permission to forecast future facts. An optional occurrence filter narrows eligible claims; it never substitutes for acquisition. Actor views require explicit observers, current entitlement and the selected party-disclosure rules. Response envelopes bind the exact request and common checkpoint. The query service adds a fresh policy-checkpoint identity; this is not the historical data checkpoint. Before releasing each response, read current anomaly state from the authority and current identity/rights decisions from their trusted providers, independent of either projector's progress. If those sources are unavailable, refuse output requiring them; a recently published common checkpoint is not a freshness proof. A caller cannot choose an older safety checkpoint. Refresh after asynchronous generation and again at the delivery boundary. Return only the policy booleans/authorized provenance needed by the caller, not the hidden state used to derive them.

The recommended initial headless release uses one serialized authority/presentation release gate: a bounded read and authorization check is serialized with relevant policy changes, and the complete finalized unit is handed to the authenticated headless recipient transport at that gate's release point. Pending units remain unsent until this check; a policy change ordered first blocks them. No network acknowledgement or model generation occurs while holding the world writer lock. Already released content cannot be made unknown by a later cutoff. A distributed gateway or revocation provider needs D07's explicit equivalent ordering protocol before claiming this guarantee; a timestamp TTL alone is insufficient.

A viewer cannot request Plane A by changing `audience`, selecting an authority filter, or passing a checkpoint handle. Reject unknown/privileged selectors rather than routing to a raw store. Never expose full private genesis, seed, draws, full signed event/receipt bodies, or internal plane/genesis commitments through these APIs. Existing public blinded RNG commitments remain only the separately authorized v1 outcome field. An opaque checkpoint handle is a reference, not a capability to bypass actor/scope/rights checks.

A v1 adapter maps `as_of_world_time` to acquisition cutoff and `as_of_sequence` to the knowledge prefix, preserving response equality and current anomaly behavior. It must never reinterpret `as_of_world_time` as canonical valid time. Current v1 exposes claims, not a general physical-fact player view. Any later perception-to-canonical-fact disclosure needs its own reviewed contract.

Worked timelines:

1. **Late rumor:** a claim concerns tick10, A's acquisition commits at tick20/seq8. Query tick19/seq8 excludes it; tick20/seq7 excludes it; tick20/seq8 includes it for A. A party member B still gets nothing. A later authorized disclosure to B at tick24/seq11 creates B's acquisition; it does not move A's acquisition or claim occurrence.
2. **Equal tick custody:** item held by A moves to B at tick30/seq12, then B to C at tick30/seq13. Canonical query `(valid=30, recorded=12)` returns B; `(30,13)` returns C. Distinct recorded versions preserve B even though no positive-duration interval separates the two moves. An actor sees only what its independent knowledge permissions expose.
3. **Historical correction:** at seq18 a proposed authorized correction says a bridge assertion was wrong for ticks10–15. Earlier prefixes still return the previous recorded assertion; prefix18 may return the replacement over that valid interval. This is a future contract example, **not an available v1 action**. Recommendation: first projector release faithfully projects existing events and rejects correction commands. Before enabling corrections, specify the authority, supersession links and physical-state consequences, including whether custody/consent can ever be corrected. Never infer correction authority from a model or permit insertion into the old journal.
4. **Current anomaly:** historical data prefix20 predates disappearance at25 and naming at27. A present query for20 still receives current `ontology_blocked`/`engagement_closed`. It cannot fetch an older policy manifest to reopen exposition. Preserve v1's world/branch-wide reach; per-traveler narrowing would be another reviewed behavior change.

## 4. D02: identifier domain without rewriting history

The v1 regex `^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$` admits `constructor`, `prototype` and `toString`; it already excludes `__proto__` because the first character is an underscore. The canonical codec rejects dangerous **object property names**, not matching string values. Therefore a scalar claim ID can survive where a proposal ID later used as a key cannot. `apply()` writes `next.proposals[p.proposal_id]` then validates the complete snapshot before append. An earlier rejection alone would not repair the frozen schema/runtime disagreement. [S3–S6,S10]

Inventory before migration: entity actor/item/party keys; proposal-history keys; consent and grant keys; traveler cutoff keys; scalar claim/source/observer IDs; confirmation, principal and key IDs; complete scope components; checkpoint IDs; proposed relation/acquisition/delivery IDs. The first set become map keys today; later sets may legitimately contain strings that never became property names. Do not assume no old ID equals a reserved property word.

Options:

- Restrict new IDs everywhere and preserve special legacy IDs under a compatibility profile. Smaller wire change, but multiple domains and exceptions are easy to misapply and cannot silently invalidate existing scalar IDs.
- **Recommended:** retain the existing ASCII/length domain for new identifiers, and replace identifier-keyed maps in a new wire version with sorted arrays of fixed-key entries. Runtime lookup uses `Map` or audited own-property access; no ID is installed as an unchecked object property.

```text
Id = string matching the existing ASCII/length regex
IdEntries<T> = [{id: Id, value: T}, ...]
```

Require unique IDs and strictly increasing JavaScript UTF-16 lexicographic order (equivalent to byte order for this ASCII domain), with no locale sorting, case folding or normalization. This keeps `constructor`, `prototype` and `toString` representable as values while leaving `__proto__` invalid as an ID. JSON object member safety remains unchanged. Reject unsorted/duplicate entry arrays rather than silently sorting signed input. Treat imported nonmatching external IDs as external references under a separate explicit mapping, not by lossy sanitization. SQL uses bound parameters and data columns, never ID-derived table names or paths.

Compatibility requirements:

1. Preserve frozen v1 schema, codec, signatures and original event bytes. Verify legacy input with the v1 reader before translating a derived representation; never normalize and then claim the old signature covers the new bytes.
2. Convert accepted v1 snapshots to versioned projection rows/entry arrays with exact IDs. A v1 claim ID `constructor` remains that string; no alias or silent rename.
3. A malformed v1 object-key snapshot rejected by the original canonical rules does not become authenticated history merely because v2 can represent its contents. Quarantine/refuse it; any recovery import needs D03 provenance.
4. New histories and write APIs advertise the reviewed version. Do not send a v2 state/proposal needing a reserved-word key to an unchanged v1 runtime. Return explicit capability incompatibility before mutation; do not silently narrow the advertised v2 domain.
5. Keep old history replay and new derived-state hashing distinct. A new projection schema changes its logical digest; it does not change an old ledger head or confer genesis authentication. Version the projector and migration manifest.

Required fixtures include accepted legacy scalar IDs, case-distinct IDs, maximum length, duplicate arrays, reserved property names, invalid leading underscore, hostile accessors and legacy snapshots. W03/W04 must serialize shared-contract changes; no amendment to the freeze is made by this proposal.

## 5. D06: clock and expedition semantics

Recommend the first headless release retain **explicit authorized advancement, serialized authority and stale-head rejection**. Do not introduce continuous real-time simulation, automatic downtime catch-up, queue mode or transparent forks in this packet. These alternatives require separate mechanics/recovery contracts; the current enum entries are not implementations. [S2,S5,S6,S11]

All world ticks remain nonnegative safe integers. **One v1 tick is one second**; preserve that frozen unit and replay behavior. V1 clock advancement alone does not debit lifespan or change age. New action durations or a different ruleset time model require a versioned contract. Ten wall-clock minutes of play still do not automatically advance the fictional clock by 600 ticks. [S12] Session timers can pause, remind or close transport, but never fabricate pass, movement, consent or `advance_time`. An explicit system-authorized `advance_time` still requires a current head and a strictly greater target. Proposed background tick budgets are hypotheses; they neither benchmark capacity nor grant autonomous authority.

```text
ExpeditionSession = {session_id, scope, session_revision,
  mode: "solo"|"party", participant_ids, party_id: Id|null,
  scheduled_start_utc: string|null, encounter_checkpoint,
  phase: "scheduled"|"collecting"|"paused"|"reframe"|"closed",
  responses: IdEntries<"awaiting"|"submitted"|"explicit_pass"|"deferred">}
```

This lives in coordination storage, outside world truth. Session revision is transport CAS, not ledger head. The appointment is neither a past insertion slot nor a reservation of an item/actor. A world-time checkpoint expiry and a wall-clock transport deadline are separate fields with separate effects. No new movement, location, fatigue or initiative mechanics are inferred from these records.

A raid collects intents against a shared checkpoint. If one action commits, subsequent proposals based on that old head conflict; refresh views and reframe before obtaining confirmation for changed intent/stakes. A `serialize` label does not authorize blind replay. An exact retry of the already committed proposal returns its original outcome, even after the world advances. A changed request needs a new identity. Solo sessions follow the same rule: after another expedition advances the world they cannot append into its past. Pausing retains coordination history but no resource reservation; resume obtains a fresh checkpoint. Missing participants remain awaiting/deferred according to explicit coordination policy, never automatically consenting.

## 6. D06: speech, acknowledgement and epistemic commit

Recommend atomic, finalized **text disclosure units** for the first headless protocol. Voice/chunk playback is deferred until partial-unit semantics are designed. Generating text, sending a socket packet and acknowledging display are different observations; none proves comprehension, belief or free consent.

```text
DisclosureUnit = {delivery_id, scope, speaker_actor_id,
  content_digest, source_claim_refs, intended_recipient_ids,
  party_id: Id|null, authorized_data_checkpoint_id, unit_version}
DeliveryReceipt = {delivery_id, recipient_actor_id, scope,
  content_digest, authorization_reference, acknowledgement_id,
  observation_kind: "text_unit_acknowledged"}
DeliveryRecord = {unit, per_recipient_status,
  observation_proposal_id: Id|null, committed_event_ref: Ref|null}
```

Receipts come from an authenticated trusted gateway/session path, not model JSON. Exact authentication and revocation linearization are D07 prerequisites. Keep payloads/receipt evidence private; digests do not authorize retrieval. For first implementation, an acknowledgement means the authenticated recipient client reported the complete text unit available/displayed. It does not claim a biological hearing fact or informed acceptance.

Recommended state sequence: `PREPARED → AUTHORIZED_FOR_DELIVERY → SENT_UNCONFIRMED → ACKNOWLEDGED → OBSERVATION_PENDING → COMMITTED`. Cancellation before emission can suppress delivery; after emission its outcome is uncertain until reconciled. Persist immutable delivery identity before emission and receipt before submitting the observation. Retransmit the same unit ID; bind each receipt to the exact recipient, scope and bytes. Reauthorization at actual delivery checks current rights and anomaly restrictions. A stale policy check does not justify sending forbidden text.

After authenticated acknowledgement, the authority may record the disclosure through a reviewed epistemic action. V1 has only `observe_claim`: it has no delivery evidence, source-claim chain or durable delivery deduplication fields. Do not smuggle new semantics into prose or undocumented metadata. A new action/envelope and trusted receipt verifier are prerequisites to claiming this delivery guarantee. Record actual permitted past delivery separately from permission to send anything now; revocation after emission must not trigger re-emission. Pending receipts must be reconciled under explicit historical-delivery rules even if current membership changed; until those rules are approved, fail the unresolved transition closed and retain private evidence.

Retain **commit-time acquisition** for initial v1 compatibility. Delivery/ack diagnostics may record separate evidence time, but a delayed observation committed at tick40 is not visible at acquisition cutoff30 even if a client acknowledged at30. This defines conservative committed knowledge, not a claim that the human knew nothing earlier. Using physical receipt time as acquisition would require a different reviewed historical-knowledge contract. An acknowledgement creates no physical fact, donor consent, proxy grant or truth assessment.

A party disclosure records only individually authorized recipients with accepted receipts. Party membership never unions private knowledge or proves delivery. Later receipts produce later acquisitions without changing the original record. Repeated receipts reconcile one acquisition per `(scope, delivery_id, recipient)`; authority-side deduplication is needed beyond transport retries. If a proposal conflicts before commit, reconcile its identity first, then create a newly authorized proposal with a fresh expected head while retaining that delivery key. If cancellation races append, query/retry the original proposal before taking any further action. Do not change bytes under an existing proposal ID.

An anomaly arriving during generation or before delivery suppresses prohibited output under current policy, even if its historical source view was valid. The UI may show deterministic permitted work speech or silence, as v1 already specifies. It must not generate an observation for suppressed content. Full delivery locking, dynamic membership, partial voice and durable outbox recovery remain unimplemented prerequisites, not implicit capabilities of the present narrator.

## 7. Review and implementation boundaries

This packet makes recommendations for D02/D05/D06, not decisions for D01/D03/D04/D07. Complete-scope receipt authentication, trusted genesis import, independent rollback assurance and live identity/entitlement operations retain their own acceptance gates. No SQLite layout solves those issues by itself. Projection/schema design, fixture preparation and engine comparison can proceed without a new licensed ruleset, paid calls or the board application adapter.

Before W03: approve temporal semantics and storage objectives, verify W01 evidence, choose the ID representation and explicit v1 compatibility, define complete schema constraints/query bounds and deterministic negative oracles. Before W05/W06: freeze reviewed versioned contracts and split ownership. Before W07: implement both projectors, shared publication/rebuild protocol and seeded workload; then execute the 10,000-event acceptance. Before W08/D06 reliance: approve receipt/delivery authentication, deduplication and current-policy behavior. The companion JSON lists required negative examples, not test results. No new gameplay file, schema version or public API is frozen here.
