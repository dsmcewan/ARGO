# Curated Tempting Fates dialogue knowledge

This optional sidecar lets Melia explain the campaign's actual ordinary-lamp loan terms. It is her offered policy, not a world fact, observed memory, accepted bargain or resource transaction. No ledger, custody, exploration, combat or resource action is added.

`catalog.json` contains one policy, `melia_lamp_loan_offer`, owned by `melia` and concerning `traveler_lamp`. It records a free loan with no advance deposit, five-obol replacement value, explicitly agreed actual-damage repairs capped at five, borrower-supplied oil costing one obol for six exploration turns, an explicitly agreed return normally at the next agreed harbor return, and no compulsory service or oath. Its text makes clear that a promise alone does not transfer custody. It contains no sample reply or dialogue template.

The canonical provenance authoring file is `SYSTEMS/dialogue-knowledge-v1/authored-sources.json`. The package-local `sources.json` is an exact bundled mirror to respect workspace import boundaries. Tests compare it with the canonical manifest and verify the actual QUICKSTART/ENCOUNTERS document and excerpt bytes. `identity.json` pins the canonical JSON hashes of the catalog, source manifest and exact frozen campaign pack. Runtime helpers accept no alternative catalog, source path or caller-chosen identity. They read no files and make no model calls. Changed content requires a reviewed identity update and a new explicit activation; it cannot silently replace an old offer in an existing world.

## API

Import from `scenarios/tempted-fates/campaign/knowledge/index.ts` until the coordinator publishes the scenario exports:

```ts
campaignKnowledgeCatalog
campaignKnowledgeSourceManifest
campaignKnowledgeIdentity

createCampaignKnowledgeActivation(pack, currentQuery, activationId, knowledgeIds)
buildCampaignKnowledgeView(pack, read)
buildCampaignKnowledgeDialogueSupplement(pack, read, {location_id})
```

The three data exports are deeply frozen. `createCampaignKnowledgeActivation` is pure preparation for host persistence: it validates the fixed pack, owner, selected IDs and exact current query, then returns a detached frozen activation. The authenticated host must persist it once at that verified sequence/head/time. It must not call the activation helper on each dialogue read. New-world registration may use a verified initial cursor; an existing world must use its current cursor. The helper cannot prove that the caller's cursor is current, authenticate a caller or provide storage.

`buildCampaignKnowledgeView` requires the closed `AuthoredKnowledgeRead`: `{version:'authored-knowledge-read/1.0.0', query, activation, disclosure}`. The host supplies previously persisted activation and a current grant attesting entitlement and ancestor membership. The grant binds the complete query, activation hash, catalog hash, source manifest hash and explicitly selected IDs. The helper validates that binding against fixed bundled identities, then returns only selected owner policies and their referenced provenance. Missing activation, missing grant or empty selection returns `null`; malformed supplied data fails. Reading an earlier acquisition never re-dates it. Policy validity and acquisition sequence/time are checked independently.

`buildCampaignKnowledgeDialogueSupplement` composes that view with the existing actor/room helper and returns `character-dialogue/0.2.0`. It keeps authored knowledge separate from shared room description and the actor's private goals. `location_id:null` discloses no room; seed NPC occupancy does not grant presence. No `private_knowledge`, referee notes, variant truth, rumors or sample speech is imported. The original `buildCampaignDialogueSupplement` still returns its exact 0.1 shape and does not gain knowledge implicitly.

## Host integration

At a trusted registration boundary, independently of dialogue reads:

```ts
const activation = createCampaignKnowledgeActivation(
  pack, verifiedCurrentMeliaQuery, 'melia_offer_v1', ['melia_lamp_loan_offer'],
);
// Persist once in trusted host storage; this helper does not write anything.
await saveActivationOnce(activation);
```

Supply a current loader through the existing model agent's `readSupplement` option:

```ts
readSupplement: async (query, {signal}) => {
  const activation = await loadPersistedActivation(query, {signal});
  const disclosure = activation === null ? null :
    await authorizeCurrentKnowledge(query, activation, {signal});
  const location_id = await authorizeVisibleRoom(query, {signal});
  return buildCampaignKnowledgeDialogueSupplement(pack, {
    version: 'authored-knowledge-read/1.0.0',
    query, activation, disclosure,
  }, {location_id});
}
```

`saveActivationOnce`, `loadPersistedActivation`, `authorizeCurrentKnowledge` and `authorizeVisibleRoom` above represent application-supplied capabilities, not deployed ARGO services. They must authenticate the actor, enforce current rights, verify journal ancestry, honor cancellation and persist registration. A grant's JSON shape or hash alone does not provide those guarantees. Withholding or emptying the grant revokes current disclosure.

The model adapter validates the complete supplement query and refreshes the selected context before a provider attempt, after asynchronous token counting and after generation. A revoked grant, changed activation or changed content suppresses stale generated speech. The 0.2 packet carries the complete actor query once and preserves policy ownership, source definitions, identity hashes and acquisition metadata. It remains ordinary untrusted model context; only a proposed character speech/impression command is returned, and existing authority decides whether it may commit. Host instructions and cache identity must distinguish packet 0.2; the coordinator owns that model-adapter integration.

## Verification and remaining boundaries

`TESTS/campaign-knowledge.test.ts` uses injected offline providers to inspect exact structured terms in a real model request, without paying for inference. It tests fixed content identity, source bytes, registration, actor/scope/cursor isolation, future/expired knowledge, missing grants, revoked/changed context, malformed active inputs, old 0.1 compatibility and deterministic silence including the anomaly cutoff. Historical schemas stay byte-identical. This is presentation integration; persistence, trusted entitlement/witness services, accepted bargains and cross-profile authority remain separate work.
