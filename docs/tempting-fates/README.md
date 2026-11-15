# Tempting Fates campaign build

The [campaign kit](../../CAMPAIGNS/Tempting_Fates/README.md) supplies human-refereed play, original Greek-myth content, validated host seed construction and pure rules previews. The source scenario and existing authoritative rules remain unchanged. The owner requested this build; the owner's clarified dark-tragic tone, kit/tool scope and implementation choices are recorded in [the design](../superpowers/specs/2026-11-14-tempting-fates-design.md), with implementation ownership in [the plan](../superpowers/plans/2026-11-14-tempting-fates.md).

## Use the kit

Read the player guide and rules, then run the quickstart using the atlas, encounters and referee guide. Those files contain the procedures, content and choices needed for a first session. The campaign does not require a relic search or a meeting with the Fates.

`scenarios/tempted-fates/campaign/world.json` is **referee/host authoring data**. It includes alternative hidden truths and private NPC knowledge. Do not serve it as a player asset or pass it wholesale to a narrator. The package exports functions and types, not the raw world pack. An authorized host loads and validates the file, chooses a variant once when creating a world, and supplies its own scope and authority key.

```ts
import {
  assertCampaignPack, getPlayerHandout, getRumorCandidate, buildCampaignSeed,
  abilityFromDice, resolveCheck, capacity, previewDamage, previewRest,
  resolveMorale, previewProject,
} from '@argo/tempted-fates';
```

The separate [Phase 2 state blueprint](phase2/README.md) supplies matching TypeScript and JSON state definitions without accepting them as authoritative saves.

The exact [content and API contract](../../scenarios/tempted-fates/campaign/CONTRACT.md) and [freeze](../../scenarios/tempted-fates/campaign/FREEZE.json) describe the input bounds, semantics and outputs. `getPlayerHandout` returns a small author-approved introduction. `getRumorCandidate` returns a claim and speaker identity for possible use by an authenticated host; it neither authenticates that speaker nor delivers knowledge. Both intentionally omit referee assessments.

`buildCampaignSeed(pack, options)` returns a compatible Genesis, initial character profiles and a private manifest binding the pack and selected variant. The host keeps its private seed and key, opens the existing ledger, configures profiles through character authority, and independently supplies witness adjudication. The builder performs no I/O and no append. It does not authenticate player identities, grant rights or establish legitimate perception.

The [real-ledger integration test](../../TESTS/tempting-fates-integration.test.ts) demonstrates private rumor acquisition, explicit custody, party separation and deterministic replay. Its synthetic principals and witness callback are fixtures, not a deployed authentication/perception service.

## Supported boundaries

| Capability | Current execution |
| --- | --- |
| Content shape, references and variants | Validated closed content profile; malformed or inconsistent packs refused |
| Ability/check/capacity/damage/rest/morale/project arithmetic | Pure previews with explicit dice and finite inputs; no implicit randomness or world writes |
| Custody, scoped speech and observer impressions | Existing signed ARGO authority and character profile |
| Time gifts and Fate jurisdiction | Existing consent and Fate rules; no new automatic gift/anomaly trigger |
| Combat health, travel, food, full economy, faction consequences | Human referee records in this campaign kit; no new causal engine adapter is claimed |
| Narration | Existing scoped reader/narrator adapters; no raw pack or referee truth is a narration input |

One world tick remains one second. The campaign's day/year/turn/round/watch durations are explicit tabletop adaptations; loading them does not make `advance_time` debit lifespan or supplies. A failed or successful arithmetic preview cannot create a game event. Ordinary combat cannot call Atropos's `end_thread` as a substitute for a vitals ruleset.

The original anomaly cutoff currently covers the entire world/branch. It is not an ordinary faction clock or an encounter reward. A narrower shared-campaign cutoff requires its own versioned contract change. Legacy authority/storage limitations and the separate review-repair candidate remain outside this content build.

## Verification and board

Shared grammar is frozen before the three parallel content/rules/catalog lanes. TF-000, TF-100, TF-200, TF-300 and TF-900 are tracked on the local `.board/tempting-fates` board with disjoint owned paths. The coordinator assembles immutable commits and runs the full application gate separately. Board v1's data gate cannot approve application code; `VERIFYING` does not mean `MERGED` or an operational trust-root update.

All ten application gate groups passed at **`12229dec115abb8d34c5abba987530fbeda3daa8`**, in an offline, network-isolated, read-only disposable clone. The gate includes all 40 new campaign tests. Separate code and book reviews found no unresolved material defect within their scope. One proposed state-type mismatch was reproduced, repaired and independently rechecked. These are separate same-model Codex reviews, not another vendor or an operator's approval.

Read [the exact verification record](verification.json), [gate output](evidence/full-gate/application-gate.log), [review/evidence index](evidence/README.md) and [board snapshot](board-snapshot.json). Evidence is retained here rather than depending on scratch paths. This branch builds on the separately pending character-runtime candidate `9d0f0e7`; neither branch is implicitly approved by these checks.

TF-000/100/200/300 are **VERIFYING**, with immutable source artifacts in CAS. TF-900's source is retained, but submission refused the direct existing Ajv dependency declaration and workspace lock change because Board v1 pins dependency manifests. Its failure is recorded and lease released to **READY**; automatic dispatch is off. No gate failure was disguised as a merge and no pinned policy was changed. The [board policy](../../tools/board.py) says “Changing protected policy needs a new board created by the operator”; the [controller](../../controller/README.md) separately requires an operator-approved trust root. Application-policy acceptance is a next integration step, not a missing tabletop feature.

The final documentation addendum changes status/evidence, guide spacing and a referee-only link label. Code, schema, world data and test hashes remain those of the gated commit. All provider calls remain off. Main and GitHub are unchanged.
