# ARGO system bible

The normative service and ruleset contracts are frozen in `SYSTEMS/CONTRACT_FREEZE.json`. This bible explains their implementation; it cannot override them. The source scenario is `SCENARIOS/Tempted_Fates.md` and its meaning takes precedence over illustrative dialogue.

World truth has one writer: TELOS-authorized causal and epistemic events in the scoped ledger. LEXI projects authorized knowledge. Gateway and narrator never hold mutable world truth. A persona, NPC or intervention can propose, remain silent, or decline; it cannot commit, force a quest, invent consent, or award itself authority.

Each ledger pins the entire tenant/rights/workspace/campaign/world/branch scope, ruleset, seed, authority key and genesis. All records use safe integer world ticks and canonical JSON. The private seed, undisclosed claims, signatures' receipt provenance and hidden roll material remain in authority storage. Public outcomes contain only validated identifiers and blinded random commitments.

Concurrency is one asynchronous cross-process writer lock plus head compare-and-swap. Exact proposal retries return the original outcome. A different proposal reusing an ID, a stale checkpoint, an unknown causal parent, a changed genesis or a partial journal tail is refused. Locks are never stolen by a guessed timeout. Recover an abandoned lock only after independently proving the writer stopped; preserve evidence before any manual recovery. A timeout after append may mean committed: retry the same proposal ID.

Canonical facts live in the ledger's physical projection. Belief, rumor and external accounts stay separate typed claims, with explicit observers, party disclosure, acquisition time and sequence. A party view is never the union of members' private observations. Rights lanes are part of workspace identity and every authorization/cache identity.

Time gifts require an injected trusted verifier for the living donor's exact informed receipt. The default is denial. No model boolean proves consent. Grants are scoped to resources and two allowed action kinds, have half-open time intervals and use counts, and revoke immediately. Proxies cannot delegate or donate. No gift changes age, moral status, relationships, or the rarity of an absent thread.

Clotho, Lachesis and Atropos are independent principals with separate jurisdictions. Disappearance blocks ontological exposition immediately. Naming closes engagement; silence or ordinary work speech remains. A historical query, another sister or a different narrator cannot reopen the boundary. There is no production anomaly trigger in this foundation.

The new bridge mocks are explicitly in-process adapters, not evidence that the audited forensic LEXI/build TELOS repositories expose gameplay endpoints. Live deployment still needs authenticated domain services, entitlement verification, consent capture and durable operational backup/key management. Those boundaries fail closed when unconfigured.

Only deterministic JSON Schema validation, TypeScript, bounded process checks and signed replay decide the foundation merge gate. Model reviews can identify defects but cannot certify a merge. Use the trusted controller described in `controller/README.md`; candidate-owned tests alone are not an external trust anchor. Parallel teams start only after the sequential foundation gate passes and use the disjoint ownership manifest.
