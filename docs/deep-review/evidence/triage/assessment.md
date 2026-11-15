# Supplied findings 2–4 and dialogue protocol triage

Reviewed `/workspace/ARGO` at `0c24b32f947143c5b1095f702c878ed92888aa8d`, Node v24.22.1. Repository status stayed clean. No repository changes, paid/provider/network calls or subagents. Probe journals and outputs are retained beside this file. Runtime imports use unmodified repository source, the external Node import hook `resolve.mjs`, and existing Ajv 8.17.1 in `/tmp/argo-review2-ledger-deps/node_modules`.

Reproduce:

```sh
node --import /workspace/reports/2026-11-14-argo-deep-review/triage/resolve.mjs /workspace/reports/2026-11-14-argo-deep-review/triage/probes.mjs
```

This was a targeted product/contract review with offline validation, not an exhaustive security scan. No live model quality or deployment exposure was established.

## Finding 2: global encounter lock

**Behavior confirmed; current frozen scheduling rule, with a material recovery/product limitation.**

`packages/ledger/src/mortal/rules.ts:104–109` refuses every noncombat actor command while an encounter exists, before testing actor membership or location. Combat actions require the current actor. `rules.ts:93–100` limits the referee to encounter creation; `packages/contracts/src/mortal-types.ts:24–41` contains no close, cancel, timeout, delegation, or referee-pass command. The only encounter close is the deterministic combat viability transition at `rules.ts:191–197`. The pure reducer has no wall-clock dependency.

The probe opens hero-vs-raider at harbor while companion is at ruin. Companion travel/wait both return `CONFLICT`; the nonacting participant cannot retreat (`UNAUTHORIZED`); referee pass and invented end_encounter are invalid contracts; a second encounter conflicts. Current raider can retreat, ending the encounter and charging six world seconds. Thus not every action is frozen: the current actor can progress or legally escape. If that controller stops submitting, all other gameplay remains blocked indefinitely through the supported API.

`SYSTEMS/mortal-v2/CONTRACT.md:25` explicitly specifies one active encounter per world, blocks out-of-combat actions, and says wall time does not advance the clock. The observed behavior is not an implementation regression against this freeze. A recovery action, disconnect/delegation policy, timeout evidence, or separately scheduled encounters requires a versioned rules decision with replay semantics; silently allowing remote travel would violate the current time rule.

## Finding 3: Melia's authored loan terms absent from model context

**The specific omission is confirmed; disposition and basic scene knowledge are present, and the exclusion matches the presentation contract.**

The captured real campaign request includes Melia's nature/activity/speech limit, her `wants` and `will_not`, the ordinary-lamp harbor description, and one acquired addressed speech. It excludes all three `private_knowledge` entries and the five-obol repair limit/next-harbor-return terms.

`scenarios/tempted-fates/campaign/catalog.ts:242–248` seeds nature/activity/speech profiles only. `campaign/dialogue.ts:44–49` emits the queried actor's name/occupation/wants/will_not and one explicitly granted room description. `packages/interventions/src/dialogue-context.ts:81–86` adds only authorized experiences/impressions and that supplement. The exact operational terms are `world.json:904–916`, especially costs at `911–913`, and `CAMPAIGNS/Tempting_Fates/QUICKSTART.md:21`; they are not fields in the included actor disposition. Merely adding `private_knowledge` would still omit these encounter terms.

`docs/npc-dialogue/CONTRACT.md:9–13,21` intentionally closes the DTO and excludes pack/referee/private data; the prompt also instructs the model not to invent missing knowledge (`character-model.ts:10`). This is incomplete knowledge integration for the playable scene, not justification to leak the full campaign. A later authorized, source-bound actor-knowledge/terms projection should select those facts separately from referee truth and sample dialogue. It must distinguish currently offered terms from an actually agreed promise or causal custody transfer.

## Finding 4: v1 private claim observer/source forgery

**Raw v1 behavior confirmed; it is a permissive authority-boundary weakness, distinct from canonical truth and the newer character memory path.**

`packages/ledger/src/mechanics.ts:64–70` checks existing observers and requires the submitting actor to be the source OR an observer. With `party_id:null`, there is no party/witness/perception authorization. A signed-journal probe accepts (a) donor as source naming outsider as sole observer; (b) Clotho as claimed source while donor adds itself and outsider as observers. Outsider is outside donor's party and its authenticated private LEXI query receives both claims. No victim action, source authentication, or witness grant occurs. `packages/lexi-bridge/src/index.ts:28–39` trusts recorded observer membership; the public claim DTO exposes claimed source but not the signing submitter as a separate provenance field.

The records remain typed belief/external_account, not canonical facts. Current mechanics explicitly permits authenticated observe_claim with existing observers (`MECHANICS/tempted-fates-v1.md:22`), so tightened authorization is a versioned boundary change, not a safe unreviewed modification to frozen replay. The host still authenticates the principal; this probe does not impersonate one.

Ordinary epistemic claims do **not** enter the new dialogue CharacterView. `packages/ledger/src/characters.ts:169–183` recognizes tightly checked private system carriers and captures other events only when causal. The probe configures outsider, submits both forged claims, and gets zero character experiences. Genuine character speech uses source-bound commands plus host witness grants (`characters.ts:77–83,92–99,125–128`). Do not use raw v1 observe_claim as a shortcut for new knowledge seeding.

## Realistic dialogue output: fences and 241 characters

**Rejection confirmed and required by the current contract.** Injected responses containing fenced JSON or a 241-code-point text both raise `INVALID_CONTRACT`; exact JSON containing 240 characters succeeds. Each uses one provider stub call and no generated speech commits. `dialogue-context.ts:89–92` uses JSON.parse and the configured character bound; `character-model.ts:65–78` performs the bounded generation/parse. `docs/npc-dialogue/CONTRACT.md:15–19` requires exactly one JSON object, the character's current speech cap, and one successful generation call. `TESTS/character-model.test.ts:93–96` already explicitly exercises 241-character refusal.

This establishes protocol brittleness against common outputs, not actual rejection rates or poor prose from any live model. A later reliability design can consider provider structured output and bounded correction, but must retain fail-closed validation and the end-to-end budget. Never silently truncate a promise, consent, or price term.

## Recommended dependency order

1. Finish the currently authorized scaling repair and verify its immutable candidate; none of these findings requires changing that patch.
2. Before multi-actor sessions, specify versioned encounter recovery/scheduling. In parallel, specify observation source/witness authority and authored actor-knowledge acquisition; preserve the frozen histories and the separation between mortal and v1/character authority profiles.
3. Implement the authorized knowledge boundary before expanding model context or adapting legacy claims into CharacterView. Then add curated Melia loan terms with provenance and acquisition/disclosure tests, without loading referee/private packs wholesale or fabricating speech to seed memory.
4. Evaluate realistic dialogue protocol compliance after the model has adequate authorized context. Any correction strategy is separate from world-state authority and must preserve speech/turn budgets. Offline fixtures can precede a separately authorized live quality benchmark.
