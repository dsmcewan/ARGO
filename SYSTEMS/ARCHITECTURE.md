# ARGO service contracts 1.0.0

Normative data schemas: `argo-v1.schema.json` (JSON Schema 2020-12). Frozen hashes are in `CONTRACT_FREEZE.json`. Changes after freeze require a versioned migration and renewed dependent gates. This contract defines new ARGO services; it does not pretend legacy LEXI/TELOS already expose them.

## Authority and service ownership

Gateway authenticates the principal and binds its scope outside model JSON. It parses speech into `IntentProposal` candidates; a model cannot supply its own `Principal`. ARGO DM is stateless regarding world truth and consumes only an authorized `KnowledgeView` and validated `Outcome`. The Chronicler, The Fates and Plain Guide alter presentation only.

TELOS bridge calls `submit(proposal, principal, {signal}) -> Promise<Outcome>` on the authority adapter. Authority validates the entire proposal against the current ledger head while holding the world writer lock, derives effects with the pinned ruleset, signs and durably appends the event, then returns an outcome. Validation alone never reserves a future right to commit. A previously approved proposal must be checked again against current revocation, consent, time, resource and head state.

LEXI bridge calls `query(query, principal, {signal}) -> Promise<KnowledgeView>`. Its projection consumes ledger events in sequence, with an idempotent durable cursor. Physical facts come from the authoritative snapshot; dialogue claims remain claims. The foundation's deterministic mocks implement these same interfaces and explicitly identify their in-process test role. Legacy HTTP clients can be injected only behind these contracts; there is no default call to a fictitious LEXI gameplay endpoint.

NPC runtime and independent intervention planner subscribe to derived views and return zero or more optional proposals. No subscription callback receives the ledger writer, signing key or full snapshot. An NPC never forces a quest; silence and walking away are valid. Cross-service calls are asynchronous, cancellable, time-bounded and schema-checked at both boundaries.

## Namespace and content rights

Every request, event, genesis and projection carries `Scope`. `workspace_tenant_id` MUST equal `tenant_id + ':' + rights_lane + ':' + workspace_id`. The four lanes are `open_license`, `homebrew`, `marketplace_entitlement`, `private_upload`. Campaign, world and branch remain additional exact identity components. Equality compares the complete canonical scope; matching only `world_id` is insufficient.

Authentication binds the complete scope. An open-license campaign cannot retrieve or cache material from a private-upload workspace even when names or actors match. Entitlement checking is an injected, fail-closed gateway concern before a principal is constructed; the foundation provides no marketplace authentication service. Cache keys include complete scope, actor/audience, session and provider/model. Party context includes only observations explicitly disclosed to that party, never the union of member-private views.

## Dual event paths

`LedgerEvent.kind` is `epistemic` exactly for `observe_claim`; all other supported actions are causal. Both paths share one signed sequence and previous-hash chain. Event scope and ruleset must match its nested proposal and immutable genesis. The proposal's `expected_sequence` and `expected_head` bind the state against which it was authorized. `causal_parents` are earlier event hashes in the same scoped ledger; cross-world, unknown and future references fail.

The authority signs canonical unsigned event bytes with an injected Ed25519 key. The unsigned body omits the event hash and authority signature. The stored event hash is SHA-256 of the canonical signed body with only `hash` omitted. Verification uses the public key pinned in immutable genesis; a caller-supplied replacement key cannot validate another history. Sequence starts at 1, previous hash is null only at sequence 1, and event IDs are deterministic `event_<sequence>` within the full scope. Stable proposal IDs provide idempotency: an exact duplicate returns its original outcome; changed bytes under the same ID fail.

Canonical codec `argo-json-v1`: UTF-8 compact JSON, object keys sorted lexicographically by JavaScript UTF-16 comparison, array order retained, strings preserved without Unicode normalization. Only null, booleans, strings, arrays, plain objects and safe integer numbers are admitted. Reject non-finite/fractional numbers, negative zero, undefined, sparse arrays, cycles and prototype-sensitive keys. Empty final lines are allowed only after the final newline; malformed/partial records, sequence gaps and hash/signature failures halt replay. No silent line skipping.

Ledger storage is private to authority. Seed, complete random draw records, undisclosed observations and consent evidence never enter public logs or narration. `Outcome` includes identifiers and optional blinded RNG commitment, not a snapshot or hidden roll. Returning an event hash does not authorize fetching its event. Any future event-export endpoint needs its own disclosure contract.

## Knowledge and temporal policy

Observations record `belief`, `rumor`, or `external_account`, source identity, occurred time and explicit observers. The committed world's time is acquisition time, irrespective of the claim's earlier occurred time. Neither the source's confidence nor a model's wording can promote an observation into canonical fact.

`KnowledgeQuery` authorizes `actor_id` against the authenticated principal. Party queries additionally require current and checkpoint-authorized membership and explicit `party_id`; private actor queries require `party_id:null`. Apply both `acquired_at <= as_of_world_time` and `sequence <= as_of_sequence`. A query beyond the materialized cursor fails rather than mixing snapshots. Party observations must name only authorized members present in the disclosure. An actor receives a claim only if explicitly listed among observers. Two events at the same timestamp are ordered by sequence.

A historical query does not undo a committed exposition cutoff: presentation policy uses current cutoff state even when the requested knowledge prefix predates disappearance. This prevents rewinding knowledge queries to reopen forbidden ontology. `ontology_blocked` is set on thread disappearance; `engagement_closed` follows anomaly naming. Post-cutoff arbitrary generated prose is discarded; deterministic permitted work-related responses or silence remain available. Neither persona changes nor another agent bypasses this rule.

## Concurrency, encounters and world time

The foundation implements `reject` plus serialized authority execution: exactly one writer per complete scope, head compare-and-swap inside its lock, stale proposals return `CONFLICT`. A lock timeout returns unavailable without stealing a possibly live lock. An abandoned lock requires explicit operator recovery after proving the owner is gone. Process-local promise queues alone do not satisfy this requirement.

Encounter checkpoints freeze head, sequence, world time and participating actor IDs. A party raid uses one checkpoint; an asynchronous solo session that read an older head must rebase and obtain fresh validation. It cannot overwrite the party's committed past. The policy vocabulary reserves:

- `serialize`: process proposals one at a time; stale state is revalidated, never blindly replayed.
- `reject`: return the current conflict without committing.
- `queue`: retain untrusted proposals only; reauthorize against current state when dequeued, expire with the checkpoint.
- `transparent_fork`: create an explicit new branch scope with declared parent checkpoint; never silently merge its physical or epistemic history back.

Version 1's runtime accepts only reject/serialized execution. Queue/fork scheduling is an interface reservation and must fail explicitly until implemented; enum presence is not feature support. Branch-aware schemas let later workers add scheduling without inventing identity. World time is a nonnegative safe integer, nondecreasing. Only `advance_time` may advance it; that event's time equals its `to_time`. All other proposals use the current clock. Expiry intervals are half-open: valid_from <= time < expires_at.

## Errors and compatibility

Malformed data and unknown actions fail closed. Errors use the schema's code enum and bounded redacted message. Conflicts, unavailable transport and cancellation are distinct from authority refusal. An async timeout never means a mutation did not commit: retry the identical proposal ID, not a newly minted action. The bridge does not auto-repeat writes.

Legacy Pantheon build tickets remain distinct from `IntentProposal`. Build pipeline artifacts, its board DAG and its fictional-name governance roles never become world events merely by renaming fields.
