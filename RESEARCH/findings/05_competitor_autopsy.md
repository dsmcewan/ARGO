# VTT document boundaries and adversarial benchmarks

Status: **starter**. Baseline: `05a292c403442a24b8f420e8b851f41f0f581ce5`. Prepared as codex_starter; requested seat `grok-4.7`; actual vendor execution: none.

Documentation research only: no competitor attack was executed and no product-specific security defect is established. Foundry documentation is pinned to v13, not claimed latest. Existing test references mean source assertions were inspected; future graph/bus/voice tests are not passing implementations.

## Sources

- **R5-S1** [Foundry Actor](https://foundryvtt.com/api/v13/classes/foundry.documents.Actor.html) — v13; primary_page; accessed 2026-11-13. Locator: isToken, itemTypes, getUserLevel, defineSchema.
- **R5-S2** [Foundry Item](https://foundryvtt.com/api/v13/classes/foundry.documents.Item.html) — v13; primary_page; accessed 2026-11-13. Locator: actor aliases parent; isOwned aliases isEmbedded.
- **R5-S3** [Foundry Scene](https://foundryvtt.com/api/v13/classes/foundry.documents.Scene.html) — v13; primary_page; accessed 2026-11-13. Locator: defineSchema: tokens, notes, walls, journal references.
- **R5-S4** [Foundry JournalEntry](https://foundryvtt.com/api/v13/classes/foundry.documents.JournalEntry.html) — v13; primary_page; accessed 2026-11-13. Locator: embedded pages, ownership, permission methods.
- **R5-S5** [Foundry RollTable](https://foundryvtt.com/api/v13/classes/foundry.documents.RollTable.html) — v13; primary_page; accessed 2026-11-13. Locator: TableResult; draw/drawMany; recursive and chat options.
- **R5-S6** [AI Dungeon context construction](https://help.aidungeon.com/faq/what-goes-into-the-context-sent-to-the-ai) — Unversioned live documentation; primary_page; accessed 2026-11-13. Locator: Required/Dynamic context; summary, Story Cards, Memory Bank.
- **R5-S7** [AI Dungeon multiplayer](https://help.aidungeon.com/faq/do-you-support-multiplayer) — Unversioned live documentation; primary_page; accessed 2026-11-13. Locator: Why use Third Person in Multiplayer?.

## Findings

- **R5-C1 (documented)** Foundry documents parent/embedded relationships and ownership APIs. Item.isOwned describes embedding, not the current user’s authorization. Synthetic Token Actors require distinct identity from world Actors. Sources: R5-S1, R5-S2.
- **R5-C2 (design_inference)** Scenes can reference journals and embedded objects; journals contain pages; RollTable operations can recurse or emit chat. None of this establishes ARGO actor knowledge, historical acquisition or authoritative random draws. Sources: R5-S3, R5-S4, R5-S5.
- **R5-C3 (documented)** AI Dungeon documents finite context assembly and memory facilities; context may be trimmed. Its multiplayer documentation describes simultaneous character inputs. Neither proves cross-tenant leakage, voice corruption or that the product is stateless. Sources: R5-S6, R5-S7.
- **R5-C4 (hypothesis)** Sycophancy, loot inflation, secret leakage and forced choices are attack hypotheses to measure, not findings proven against all competitors. Sources: R5-S6.

## Proposed mechanics and fields

### R5-P1: Versioned adapter provenance and headless adversarial matrix

Compatibility: **versioned_migration**. Targets: SYSTEMS, MECHANICS, TESTS. Sources: R5-S1, R5-S2, R5-S3, R5-S4, R5-S5, R5-S6, R5-S7.

| Field | Type | Visibility | Meaning |
|---|---|---|---|
| `source_uuid` | stable source identifier | authority | Retain parent/synthetic identity |
| `source_document_type` | Actor/Item/Scene/JournalEntry/RollTable | authority | Map to a specific adapter |
| `source_system_version` | version tuple | research_only | Pin Foundry and game-system semantics |
| `source_sha256` | digest | authority | Bind imported bytes |
| `rights_provenance` | manifest reference | authority | Separate permission to import from permission to disclose |

- Actor -> entity and scoped capability mapping; Item -> parent-qualified custody proposal; Scene -> authorized geography/view; JournalEntry -> typed source/claims; RollTable -> ruleset data, not independent RNG authority.
- Foundry permissions never substitute for actor/tenant/rights/time authorization.
- No live competitor verdicts: use synthetic canaries and deterministic oracles. Canary absence alone does not prove absence of every semantic leak.
- Keep future voice tests parked until headless authority, graph and bus gates pass; present source references are not proof of an implemented voice stack.

## Deterministic benchmark specifications

### R5-B1: Unauthorized narrator context

Status: **existing_source_assertion**; inspected source: [TESTS/review-regressions.test.ts](../../TESTS/review-regressions.test.ts).

**Given:** Stale/private FOREIGN_SECRET claim and clean authenticated refresh.
**When:** Narrator attempts generation, including a retry after shared-object mutation.
**Then:** Captured vendor requests contain no FOREIGN_SECRET or foreign world.
**Oracle:** Captured request bytes; tests were inspected, not rerun by this research helper.

### R5-B2: Illegal loot/custody

Status: **proposed**.

**Given:** Actor does not hold the requested object; prose claims a reward.
**When:** Submit unauthorized custody transfer or render claimed reward.
**Then:** Rejected action appends nothing. Narration cannot change canonical snapshot.
**Oracle:** Canonical state/event counts; general loot catalog adapter remains future.

### R5-B3: Deterministic replay

Status: **existing_source_assertion**; inspected source: [TESTS/ledger.test.ts](../../TESTS/ledger.test.ts).

**Given:** Fixed genesis and causal/epistemic/RNG event sequence.
**When:** Rebuild each prefix and tamper an event.
**Then:** Snapshots match canonical replay. Tampered authority/RNG records are rejected.
**Oracle:** Byte comparison and deterministic exception assertions.

### R5-B4: Refusal remains optional

Status: **existing_source_assertion**; inspected source: [TESTS/tempted-fates.test.ts](../../TESTS/tempted-fates.test.ts).

**Given:** Each Fate or subscriber is offered a refused/declined action.
**When:** Process leave/refuse or an empty candidate list.
**Then:** Returned proposal list is empty. No forced quest, gift or canonical mutation.
**Oracle:** Proposal list and ledger event count.

### R5-B5: Future voice collision

Status: **proposed**.

**Given:** A owns turn; B overlaps; A final is duplicated; narration epoch7 cancelled.
**When:** Deliver late epoch7 audio.
**Then:** One A proposal; explicit busy response for B. No extra commit from duplicate; no late epoch7 audio.
**Oracle:** Entire voice/gateway trace fixture is deferred, not implemented.

## Limits and open questions

- Full cross-tenant cache matrix and graph/bus replay workloads require new executable fixtures.
- Foundry v13 import mapping is future work, not an integration currently shipped.
