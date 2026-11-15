# Tempting Fates campaign-kit contract 0.1.0

This additive `tempting-fates-pack/0.1.0` profile defines referee content, public extracts, host seed construction and pure tabletop calculators. `types.ts` contains the exact TypeScript signatures; `content.schema.json` is the closed JSON grammar. `FREEZE.json` pins those files and this specification. It does not change the source scenario, existing freezes or the `tempted-fates/1.0.0` causal ruleset. The display title is **Tempting Fates**.

This is an original Greek-myth campaign continuity. Institutional decline and divine excess are provisional tone choices; they do not establish a universal morality, reputation or degeneracy score. Content can express individual judgments through observer-owned impressions. No character creation, charisma check, rumor or calculator supplies consent to a time gift.

## Content and validation

The root `CampaignPack` requires version, title, subtitle, tone/adaptation notes, public introduction, starting location, calendar and the nine collections specified in `types.ts`. All objects are closed: unknown fields fail. IDs use the existing v1 ASCII pattern (1–96 characters, starting alphanumeric, then alphanumeric/underscore/hyphen), excluding `__proto__`, `prototype` and `constructor`. Identity is case-sensitive; do not normalize or silently repair input.

The schema bounds strings, arrays and integers; titles/names have 256-code-point bounds and general text has 8192. NPC nature/activity/speech fit the existing character profile, with at least one stated priority for this campaign. Optional information uses explicit nulls or empty arrays, not omitted fields. `wants` and `will_not` are prose strings. Item `custodian_id` may be null for an unheld item. Location and NPC minimum production counts are acceptance criteria for the authored pack, not requirements for every test fixture.

`assertCampaignPack(value: unknown): asserts value is CampaignPack` performs passive DTO inspection **before** schema/property access. Reject proxies without triggering traps; reject accessors, exotic prototypes, symbols, nonenumerable data, sparse/decorated arrays, cycles, undefined values, nonfinite/unsafe/fractional numbers and negative zero. Validate closed JSON grammar, then all semantics below. Reject rather than coerce, default or remove fields. Invalid inputs throw an `ArgoError` with `INVALID_CONTRACT`; no caller object is changed. Plain objects and null-prototype objects are acceptable if all other checks pass. Bound inspection depth to 32 and visited entries to 100,000 so malicious input cannot require unbounded traversal.

Required semantic checks (JSON Schema alone is not proof of them):

1. IDs are unique within each collection. NPC and item IDs are also disjoint from each other and from reserved seed IDs `system` and `expedition`. Variant IDs are exactly one each of `genuine`, `counterfeit`, `legend`.
2. Every referenced location, NPC, route and item exists. `start_location_id` identifies a non-loom location. Exactly one location has `is_loom: true`.
3. Routes are **undirected**; endpoints differ. A route ID occurs in both endpoint `route_ids` and nowhere else. Ordinary routes never touch the loom. Every non-loom site is reachable from the start through ordinary routes. Conditional routes may describe a possible loom entrance, but their prose is not an executable permission or guarantee.
4. Each NPC occurs exactly once in the occupant list of its declared location and nowhere else. Each Fate role occurs exactly once on its corresponding actor ID (`clotho`, `lachesis`, `atropos`); all three are at the loom. Other NPCs have null Fate roles. The runtime must never assign these roles to travelers.
5. Faction members, rumor speakers and encounter participants reference NPCs; encounter, rumor, lead and hook locations exist. Rumor speaker location must equal its stated rumor location at seed time. Faction membership and encounter participation do not confer perception, custody or consent.
6. Every item's non-null custodian is an NPC. An artifact reference resolves to an item included in that same variant. `genuine` and `counterfeit` must reference an item; `legend` must reference null. Any item referenced as an artifact by any variant is included only in variants whose `artifact_item_id` equals that item's ID. Thus legend contains no physical claimed artifact, and a distinct artifact from another variant cannot leak into the selection. Non-artifact items can exist in all variants. The referee truth is fixed by explicit seed selection, never by retrieval or a roll.
7. Clock progress cannot exceed segments; resources are finite nonnegative integers. NPC age/remaining-year conversion and route/calendar arithmetic must remain safe integers. An NPC speech example must fit its speech policy by Unicode code points. Natural-language conditions, triggers, costs and consequences remain referee guidance, not machine-executable predicates.

The collection bounds intentionally fit a campaign kit, not an unbounded event archive. This profile defines no authority state, actor knowledge or world-time advancement merely by being loaded.

## Public catalog APIs

`getPlayerHandout(pack: CampaignPack): PlayerHandout` validates the pack and returns exactly:

```ts
{version, title, subtitle, introduction: pack.public_intro,
 start: {id, name, description}, rules_profile: 'tempting-fates-rules/0.1.0'}
```

The start description is that location's `public_description`. It contains no calendar, full atlas, NPC private knowledge, rumor assessment, referee truth, selected variant or private seed. The author controls public prose: validation of shape cannot prove its text contains no spoiler. Content review must enforce that distinction.

`getRumorCandidate(pack: CampaignPack, rumorId: string): RumorCandidate` validates the pack and ID, fails on an unknown rumor, and returns exactly `{id, speaker_id, text, lead_location_id}`. It does not return assessment, source-location metadata or referee basis. A candidate is content for an authenticated speaker's possible proposal; its speaker field is not authority to impersonate that NPC. It does not deliver knowledge, assert truth, choose witnesses, establish consent or append an event. Actual delivery uses the authenticated character speech path and host witness adjudication. Both extractors return detached data, never references into a mutable referee pack.

## Host-only seed API

```ts
buildCampaignSeed(pack: CampaignPack, options: CampaignSeedOptions): CampaignSeed
```

Options are exactly `{scope, privateSeed, authorityKeyId, authorityPublicKey, variant, travelers}`. Validate the same passive DTO constraints before reading them. `scope` must pass existing Scope validation and exact workspace/right-lane identity checks; never substitute a shared public scope. `privateSeed` is exactly 64 lowercase hexadecimal characters supplied by the caller. The key ID follows the safe ID rule; the public key must import as an Ed25519 public key. Only a public key is accepted, not private-key PEM. Variant is explicit, never randomly chosen. A traveler is exactly `{actor_id, name, nature}`; provide 1–6 unique travelers with safe IDs, nonempty names up to 256 code points and campaign-valid nature. Traveler IDs cannot collide with any NPC, item, `system` or `expedition`.

The result is exactly `{genesis, profiles, manifest}`:

- `genesis` passes existing Genesis validation with schema version `1.0.0`, ruleset `tempted-fates/1.0.0`, caller scope/key/seed, and `world_time: 0`. Every actor is alive with a present thread. The fixed `system` actor has zero age/time and null Fate role. NPC age/time comes from its age/remaining years multiplied by 360 × 86400. These are synthetic initialization measures, including the Fates' values; they are not simulated biology or claims about mythological immortality.
- Travelers start at synthetic age 25 years and remaining balance 50 years, with null Fate role. These are explicit seed defaults, not a process that ages or kills characters. The only party is `expedition`, containing travelers in input order. NPCs and the system are not party members.
- Include only items whose `variants` contain the selected variant, preserving IDs and custodians; all begin `destroyed: false`. Slots and artifact descriptions remain referee content: old v1 items do not gain hidden combat or capacity fields.
- `profiles` contains all NPCs then travelers in input order, each revision 1; exclude `system`. Copy NPC nature/activity/speech policy. Traveler profiles copy nature, use activity `{description: 'Following their own course.', busy_until: 0}` and speech policy `{max_characters: 2048, minimum_interval: 0}`. Names are campaign/host metadata; v1 actor records and character profiles have no name field. The host retains its roster if it needs display names.
- `manifest` is `{pack_version: pack.version, pack_hash: hash(pack), variant}` using existing canonical JSON SHA-256 (`@argo/contracts` `hash`), not a raw-file hash. The manifest is referee/host-only and contains no private seed.

Construction is deterministic, detached and pure: no randomness, filesystem, models, callbacks or world writes. It does not configure the character authority automatically. The authenticated host submits profiles through the existing authority, and independently supplies perception. Supplying a pack does not authenticate a player, issue rights, give a Fate to a traveler or activate a narrator with omniscient context.

## Pure rules APIs

The exported functions in `rules.ts` must satisfy `CampaignRules` in `types.ts`. No calculator performs RNG, I/O or canonical writes. All dice are explicit trusted/adjudicated inputs to these previews, not proof of a fair random draw. Validate passive closed DTOs/arrays and safe integers; reject negative zero, overflow and invalid values with `ArgoError('INVALID_CONTRACT', ...)`. Outputs are new objects; inputs remain unchanged. No preview result is an existing v1 action or grant of Fate authority.

| API | Exact behavior and bounds |
| --- | --- |
| `abilityFromDice(dice)` | Exactly three d6 results (1–6). `bonus = minimum die`; `defense = bonus + 10`. |
| `resolveCheck({rolls, mode, bonus, target})` | Normal requires one d20; advantage/disadvantage exactly two. Choose first/max/min respectively. Bonus is an integer 0–10; target is a nonnegative safe integer. Return selected die, safe sum and `success: total > target`; a tie fails. |
| `capacity({constitutionDefense, itemSlots})` | Defense 10–20; each slot cost is a nonnegative safe integer, at most 1024 entries. Safe sum is occupied; remaining is capacity minus occupied, including negatives. `fits` means remaining ≥0. This reports capacity only and never drops or moves items. |
| `previewDamage({hitPoints, damage})` | HP is a signed safe integer; damage is a nonnegative safe integer. Safe subtraction preserves negative HP. Positive HP is standing, zero unconscious, negative dead. |
| `previewRest({hitPoints, maxHitPoints, constitutionBonus, die})` | HP ≥0 and ≤max; maxHP positive safe integer; Constitution bonus 0–10; d8 result 1–8. Return `min(maxHP, HP + die + bonus)` and its condition, with checked safe intermediate sums. Negative HP refuses: rest never resurrects. Food/full-night/safe-haven conditions remain referee responsibilities; this function previews only the ordinary d8+Con rest. |
| `resolveMorale({dice, rating})` | Exactly two d6 results; rating 2–12. Return total and `holds: total <= rating`. A failed check suggests flight, retreat or parley; it does not make choices for player characters. |
| `previewProject({progress, segments, resources, steps})` | Integers: 0≤progress≤segments, segments positive, resources nonnegative, steps positive; all safe. Apply `min(steps, resources, segments-progress)` segments at one resource per segment. Return new progress, original segments, remaining resources and `completed: progress === segments`. Already-complete or exhausted projects apply zero. No recursive follow-up, auto-clock advance or automatic consequence. |

The calendar is deliberately synthetic: day 86400 seconds, year 360 days, exploration turn 600 seconds, combat round 6 seconds, watch 14400 seconds. These durations and the project procedure are campaign adaptations, not assertions that Knave specifies them or that v1 advance-time debits life. Tabletop HP, travel, supplies, combat and projects remain manually recorded by the referee until a separately reviewed causal-rules extension exists.

## Source and acceptance boundary

Knave first edition by Ben Milton / Questing Beast supplies the adapted ability, strict-save, capacity, damage/rest and morale structure: https://questingbeast.itch.io/knave, licensed CC BY 4.0 at https://creativecommons.org/licenses/by/4.0/. Exact source bytes and license are retained in `docs/design/headless-2026-11-13/evidence/knave-1e/`. This specification describes new software interfaces and original campaign adaptations; no endorsement, Knave2e grant, third-party setting/art license or copied modern myth translation is implied. Product attribution must retain required notices and identify changes.

Contract tests meta-validate the schema, exercise literal valid/invalid DTOs and verify freeze hashes. Cross-reference, passive-object, seed, source-rule boundary and nonmutation tests belong to the catalog/rules implementation lanes. Actual authored-pack counts, playability and privacy are integration/content-review gates. A schema pass does not establish correct mythology, content truth, authentication, rights, safe consent, anomaly authorization or merge approval.
