# Fresh shared-world campaign seed

`buildSharedWorldCampaign(pack, options)` prepares a fresh `shared-world/0.1.0` genesis from the exact pinned Tempting Fates pack and the existing pure mortal-v3 factory. It returns `{genesis, manifest}` as detached, deeply frozen data. It opens no journal, writes no file, calls no model and migrates no world. The genesis contains the private deterministic seed, controller mapping and actor-owned profiles and is host-only; actor sessions must use the scoped authority projection.

The exported types are `SharedWorldTraveler`, `SharedWorldCampaignOptions`, `SharedWorldCampaignManifest` and `SharedWorldCampaignSeed`. Import from `scenarios/tempted-fates/shared-world/seed.ts` until the coordinator publishes package exports.

## Required host options

All fields are explicit; unknown fields fail. Passive-data validation precedes property reads. The host authenticates scope, controllers and grants; shape validation does not authenticate them.

| Field | Value |
| --- | --- |
| `scope` | Full tenant, rights lane, workspace, campaign, world and branch scope. |
| `seed` | Private 32-byte lowercase hexadecimal deterministic seed. |
| `authority_key_id`, `authority_public_key` | Explicit key ID and public Ed25519 PEM. Private PEM is refused. |
| `referee_id`, `npc_controller_id` | Host-selected authenticated controller identities, not model-generated identities. |
| `variant` | `genuine`, `counterfeit` or `legend`, as in the existing authored initialization. |
| `hp_mode` | `classic` or `floor4`; preserves existing deterministic creation rolls and equipment rules. |
| `environment` | `day` or `night`. Every ordinary route requires held lamp/firekit and oil at night through existing mortal rules. |
| `starting_kit` | `standard` or `borrowed_lamp`. The latter omits each traveler's personal generated lamp only. |
| `initial_knowledge_ids` | Explicit unique selection from the pinned catalog; `[]` withholds all initial policy knowledge. Current policy ID: `melia_lamp_loan_offer`. |
| `travelers` | One to six complete `SharedWorldTraveler` values, described below. |

A traveler requires `{id, name, controller_id, weapon, nature, presentation, max_speech_characters}`. Weapon is `spear` or `sling`. Nature is `{description, priorities}`; presentation is `{occupation, wants, will_not}`. These are the traveler's own supplied traits and goals. Speech cap is1..2048 Unicode characters. Revision starts at1, activity is `Following their own course.` and busy_until is0. There is no inferred personality or other observer's opinion. This new profile deliberately has no legacy minimum_interval: zero-time conversational response scheduling belongs to shared authority and host policy.

NPC profiles copy only their own authored nature/activity, speech cap and occupation/wants/will_not. One profile corresponds to each physical actor ID. Canonical actor names remain in the physical roster rather than being copied into profiles. One scene description corresponds to each physical location, with canonical location names likewise stored only in physical definitions. Private knowledge arrays, referee notes, variants' truth, rumors and sample dialogue are not imported into profiles or scene prose.

## Source identity and initialization choices

The exact campaign hash, curated policy catalog and provenance manifest come from the reviewed campaign knowledge package. Arbitrary replacement packs/catalogs/manifests are refused. The package's source manifest pins the full QUICKSTART/ENCOUNTERS documents and selected excerpts; source-content tests verify those bytes. There is no runtime arbitrary-path read.

The returned source manifest has exactly:

```ts
{
  adapter: 'tempting-fates-shared/0.1.0',
  pack_hash, genesis_hash, mortal_genesis_hash,
  catalog_hash, source_manifest_hash,
  variant, hp_mode, environment, starting_kit, initial_knowledge_ids,
}
```

These hashes bind the exact final genesis and its final embedded mortal initialization after route/kit choices. Metadata includes no private seed, key material, controller map, profiles or prose. The genesis separately contains the full pinned authored source manifest and policy catalog. Initial policy grants are genesis-bound entry IDs, not fabricated prior observation events, accepted bargains or automatic possession. Passing the catalog alone does not activate it.

`night` changes the ordinary routes' requires_light flags in the fresh generated mortal genesis. `day` leaves them false. This is a fixed session initialization choice, not a moving sun, weather simulator or complete indoor-light policy. Existing opportunities keep their authored lighting requirements. The unchanged mortal kernel enforces light and consumes oil when a night route is used.

`borrowed_lamp` retains traveler weapons, firekits, six initial oil turns, provisions, money and all other existing equipment. Melia still holds `traveler_lamp`; the seed creates no loan, promise, fee or transfer. A traveler must later acquire a lamp through an accepted authoritative action. `standard` retains each personal lamp. These choices alter only a newly constructed output and leave the original v2/v3 factories and frozen pack unchanged.

The ordinary mortal roster excludes the three Fate actors and loom locations. Lifespan, donor time-transfer and Fate jurisdiction are not adapted into combat. The authored variant remains part of the private initialization, without exposing its referee truth as dialogue context.

Authored public descriptions are fixed scene prose, not proof of current occupancy, activity or custody. Some source descriptions mention initial NPC activity. After movement, the authority's current occupants and possessions take precedence; a host/model adapter must not infer present actors or items from that static description.

## Namespace and demo settings

Actor/item IDs share one collision-checked namespace. The builder reserves all authored NPC/item IDs across variants, then every generated NPC work knife and traveler weapon/lamp/firekit. It checks generated length and exact safe spelling before invoking the older factory. The same reservation applies even when a kit omits a personal lamp; changing a kit cannot hide an identity collision.

Use `hero` for the demonstration player. `traveler` would generate `traveler_lamp`, which collides with Melia's authored lamp, and is refused. `melia_work_knife` as a traveler ID and two travelers whose generated equipment collides are also refused.

```ts
const seed = buildSharedWorldCampaign(pack, {
  scope, seed: privateSeedHex, authority_key_id: 'shared_key',
  authority_public_key: publicEd25519Pem,
  referee_id: 'referee', npc_controller_id: 'npc_host',
  variant: 'legend', hp_mode: 'floor4',
  environment: 'night', starting_kit: 'borrowed_lamp',
  initial_knowledge_ids: ['melia_lamp_loan_offer'],
  travelers: [{
    id: 'hero', name: 'The visitor', controller_id: 'auth_hero', weapon: 'spear',
    nature: {description: 'Practical, wary and curious.', priorities: ['return borrowed things']},
    presentation: {occupation: 'Traveler', wants: 'Find a safe route.', will_not: 'Accept a hidden debt.'},
    max_speech_characters: 1024,
  }],
});
```

This example prepares data only. The session/CLI lane owns key creation, authenticated principal injection, one-writer persistence, response scheduling, structured loan acceptance, save/resume and the offline demonstration. Reusing this builder against a live world would create a different initial world, not migrate or resume it.

## Verification

`TESTS/shared-world-campaign.test.ts` checks strict passive options, fixed source bytes/hashes, actual day/night travel behavior through the unchanged mortal reducer, all variant/kit combinations, generated-ID collisions, actor-owned profiles, selected initial policy grants, ordinary mortal roster, detached frozen outputs and unchanged old factory results/freeze hashes. No provider or live service is needed.
