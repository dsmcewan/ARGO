# Using the review successor interfaces

The final offline verification is recorded in [verification.json](verification.json). These are opt-in host-library interfaces, not a deployed game or a new common world. Never pass model JSON as authenticated host capabilities.

## Fresh mortal worlds

`buildMortalV3Campaign(pack, options)` from `@argo/tempted-fates` explicitly creates a `mortal-rules/0.3.0` genesis and manifest. It reuses the existing authored roster/equipment and deterministic creation rolls; scheduling/recovery changes do not silently rebalance characters. Use a fresh world namespace and storage path. Existing `buildMortalCampaign` and mortal-v2 storage remain unchanged.

The v3 ledger API is `openMortalV3Ledger`; its journal, receipt verification, reducer and actor-view functions have `MortalV3` in their names. Do not change `version` in a saved v2 genesis, rewrite its records, or regenerate a campaign over a live database. Anchored v2 continuation/migration is a separate dependency.

Only one encounter is active in this first successor. Its whole roster and site remain protected, including escaped roster members until closure. Remote nonparticipants can continue outside that site. An affected actor receives `activity_lock`; private stats and resources of other actors stay undisclosed.

An authenticated configured referee may submit:

```ts
{
  type: 'recover_encounter',
  encounter_id: encounter.id,
  turn_started_sequence: encounter.turn_started_sequence,
  resolution: 'pass', // or 'close'
  reason: 'Host verified that the current controller is absent.'
}
```

The enclosing command still needs the current expected cursor, request ID, scope and null actor identity. Normal actors cannot grant themselves referee authority. The turn token survives unrelated commits; an old recovery cannot skip a different turn. Pass follows normal turn/round settlement. Close charges the current round once and gives no healing, loot, relocation or refund.

There is no automatic wall-clock timeout. A host timeout is a recorded referee decision. World time remains the sum of serialized action durations; remote actions also share the global RNG order. This is local encounter pause with actor-specific active time, not simultaneous physical simulation or multiple independent battles.

## Authored NPC knowledge

Frozen campaign pack0.1 and dialogue supplement0.1 remain supported. The new helper is `buildCampaignKnowledgeDialogueSupplement(pack, read, {location_id})`; it creates supplement0.2 with a separate `actor_knowledge` field. It uses the pinned campaign catalog, source manifest and identity exported alongside it.

The host must register and persist an activation exactly once at a verified current query using `createCampaignKnowledgeActivation(pack, query, activationId, knowledgeIds)`. For an existing world this is an explicit current-prefix activation, not a silent backfill to genesis. A later read requires that persisted activation plus a host disclosure bound to the exact current query, selected IDs, activation hash, catalog hash and source-manifest hash. The host authenticates entitlement and verifies that the acquisition prefix is an ancestor. DTO validation does not prove those external facts.

`buildCampaignKnowledgeView(pack, read)` returns only selected owner knowledge, or null when no knowledge is granted. The supplementary room grant is still explicit; authored seed occupancy does not prove live perception. Missing activation/disclosure never exposes the catalog by default. Revising the catalog requires a new identity and explicit activation.

Melia's ordinary-lamp terms are an offer policy: free loan, no deposit, borrower-provided oil at the authored price, an expressly agreed return and repair limited to actual agreed damage up to five obols. Reading the terms does not lend a lamp, debit money, create consent or establish a promise. Other actors learn only what she actually says through the existing accepted speech/witness path.

The model receives selected structured terms and provenance, not a dialogue template, the whole campaign book, all private knowledge, variant truth or referee notes. Scene description stays separate from owner policy and private impressions. Existing before/after-generation refresh and cutoff checks cover the selected knowledge too. No live model quality or latency result is claimed by the offline request-capture tests.

The authored activation is additional trusted host state. Arbitrary later knowledge grants cannot yet be reconstructed from the existing character ledger alone. Persisted signed knowledge-activation events and a shared character/mortal timeline remain later contracts.

## New v1 observations

`openLedger` defaults new `observe_claim` writes to direct self-authorship, one self observer and private scope. Third-party source impersonation and new observation proxies are refused. An attributed outside account uses the authenticated submitter as source and identifies the reported speaker in its account text.

To deliver a new claim to others, the host configures `authorizeObservationWitnesses(request, snapshot, {signal})`. The callback receives a detached, verified prefix and a bounded unique attempt. It returns null unless trusted scene/perception information authorizes the exact delivery. Party membership, addressed names and model assertions do not count as witness evidence.

The returned grant binds the request hash, attempt ID/deadline, complete scope, sequence/head/world time, source, ordered observers and party. The contract contains its exact fields. The callback runs outside the writer lock; the ledger reacquires that lock, reconciles an exact retry first, checks the unchanged cursor and grant, and admits at most one append. Cancellation and expiration are checked before append. An acknowledged old exact retry does not require a new grant.

The grant is irrevocable for its single bounded attempt; same-head external policy revocation cannot be inferred from a ledger cursor. It is transient admission evidence, not a field in the legacy signed record. Old signed history, including old source/recipient assignments, still replays under original v1 rules and is not retroactively certified or quarantined. V1 receipts still have their separately documented scope-binding limit. The successor persisted epistemic profile remains necessary.
