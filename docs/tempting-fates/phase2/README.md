# Phase 2: promoting tabletop procedures into authority

The owner explicitly requested clean state schemas while keeping exploration, combat and resources outside the authoritative ledger in this pass. These [TypeScript types](tabletop-state.ts), [JSON Schema](tabletop-state.schema.json) and [example record](example-state.json) describe an isolated **human-referee record**, with `authoritative: false`. They do not install a new ruleset or authorize importing a save into ARGO. The example's all-zero pack hash is an illustrative placeholder, never a claim to identify a real pack.

The state stores actor position, six ability bonuses, HP, equipment references, consumable balances, item custody, bounded project progress, conditions and recorded rulings. HP determines tabletop standing/unconscious/dead; there is no second `alive` field that could silently disagree with ARGO's frozen life/thread semantics. Named items have one custodian or a ground location. Food/water/oil/currency use resource counters and must not also appear as a second spendable inventory stack. Slot cost for those resource bundles must be defined by the promoted ruleset; the current preview takes explicit slot costs.

Scope, rules profile, pack identity and selected variant remain explicit. The actor's nature/impressions are not copied into a second reputation system: the character profile retains that ownership. Referee time and revisions do not advance an existing ledger; a loaded record is not proof that any ruling occurred.

## Promotion requirements

| Tabletop procedure | Required future authoritative change | Acceptance boundary |
| --- | --- | --- |
| Travel | Versioned departure/arrival, location and elapsed-time effects with explicit party and resource costs | Current cursor, valid route/access, living actor, finite supplies; one atomic accepted event or no effect |
| Attack/stunt | Encounter state, legal target/range/turn, owned equipment, recorded private draws and damage/condition effects | No narrator-selected roll; rejected action consumes no world RNG or resource; retries apply once |
| Injury/death | Explicit vitals/life/thread mapping and ruleset migration | Ordinary combat does not inherit Atropos's jurisdiction; old signed histories keep their original meaning |
| Rest/consume | Owned resource decrements, safe place/time prerequisites and bounded recovery | No negative supplies, duplicate spend, resurrection by rest or implicit offline catch-up |
| Faction project | Authorized trigger, finite resource spend, progress and declared consequences | Stable tick identity, one resource per admitted step, no recursive completion chain; absent players supply no consent |
| Divine consequence | Specific declared taboo/obligation and attributable cause, bounded effect and remedy | No universal virtue score or arbitrary punishment for refusing a quest; never synthesize consent to life transfer |
| Knowledge delivery | Separate committed speech/perception with source, viewer and acquisition cursor | Observing combat or a ritual is not implied by party membership; GM truth never becomes public by projection |

Before promotion, define a new causal ruleset/envelope and migration rather than adding unknown fields to v1 Genesis or using an epistemic claim to smuggle physical state. Bind each proposal to full scope, actor authority, expected state/cursor, idempotency and causation. Reconcile positions, inventory and resources under the same single writer. Preserve untrusted autonomous proposals and actor-scoped disclosure. Any imported referee record requires an independently adjudicated genesis/import policy, not blind acceptance of `source: human_referee`.

JSON Schema checks shape and ranges. Phase 2 must additionally enforce unique/referenced IDs, actual pack hash, exact rights namespace identity, HP≤maximum, progress≤segments, equipment ownership and capacity, condition provenance/expiry, chronological rulings and conservation of resources. These are state-dependent invariants; this document does not pretend the current shape schema proves them. Scope authentication, witness reality and rights remain host responsibilities.

The current world-wide anomaly cutoff also needs an explicit subject/encounter migration before a rare disappearance can safely affect one traveler amid simultaneous unrelated play. No normal project, score or donated-time threshold triggers it in this kit.

For this pass, the deterministic preview APIs and a human referee can exercise these procedures. The existing ledger continues to refuse unsupported physical actions. The example is validated under the strict schema and against its TypeScript companion in the campaign integration tests; no production state import or engine action is added.
