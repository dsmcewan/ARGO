# Bounded world ticks and ecology failure modes

Status: **starter**. Baseline: `05a292c403442a24b8f420e8b851f41f0f581ce5`. Prepared as codex_starter; requested seat `grok-4.3`; actual vendor execution: none.

Use compact state, finite action tables and inspectable event history. Proposed caps are design defaults, not measured throughput. NPC and intervention principals remain separate; neither can force a quest, consent, Fate action or anomaly.

## Sources

- **R3-S1** [Blades Progress Clocks](https://bladesinthedark.com/progress-clocks) — Online SRD, revision unspecified; primary_page; accessed 2026-11-13. Locator: Opening guidance; Faction Clocks.
- **R3-S2** [Stars Without Number Revised, Free Edition](https://tesera.ru/images/items/2287258/stars-without-number-revised_free_edition.pdf) — Kevin Crawford, 2017; primary_work_mirror; accessed 2026-11-13. Locator: Printed pp.211–214: Using Factions; Faction Turn; Acting During A Turn.
- **R3-S3** [Dwarf Fortress development: Legends and World Chronicle](https://store.steampowered.com/news/posts/?appids=975370&enddate=1649948305&feed=steam_community_announcements) — Bay12/Kitfox, 2022-01-13 and 2022-01-27; primary_page; accessed 2026-11-13. Locator: New Legends Mode; World Chronicle.
- **R3-S4** [Did players destroy the UO ecology?](https://www.raphkoster.com/games/snippets/did-players-destroy-the-uo-ecology/) — Raph Koster, updated2024-08-28; primary_page; accessed 2026-11-13. Locator: Numbered points1,4,5,8.

## Findings

- **R3-C1 (documented)** Blades clocks summarize fictional progress, while SWN uses selective faction turns and typically one action type per faction per turn. Neither requires continuous simulation of every actor. Sources: R3-S1, R3-S2.
- **R3-C2 (documented)** Dwarf Fortress development notes describe accumulated historical entries and linked navigation. They support inspectable history, not proof of an ARGO-compatible replay algorithm. Sources: R3-S3.
- **R3-C3 (documented)** Koster’s firsthand retrospective says ecology AI was removed during beta because of search/pathfinding cost, and separately describes finite-resource hoarding blocking replenishment. He disputes popular retellings. Launch-week extinction is not established here. Sources: R3-S4.

## Proposed mechanics and fields

### R3-P1: Bounded deterministic background tick policy

Compatibility: **versioned_migration**. Targets: SYSTEMS, MECHANICS, TESTS. Sources: R3-S1, R3-S2, R3-S3, R3-S4.

| Field | Type | Visibility | Meaning |
|---|---|---|---|
| `authorized_target_tick` | nonnegative safe integer | authority | Explicit advance request; no wall-clock default |
| `processed_through_tick` | safe integer | authority | Durable catch-up cursor |
| `project_progress` | bounded integer/threshold | authority | Finite project state |
| `draw_slot` | versioned deterministic identifier | authority | Seed remains private; caller cannot fish by retry ID |

- At most8ticks per invocation,16active entities,4projects per entity,64evaluated candidates per tick and32effect entries. Reject oversized configurations rather than silently dropping actors.
- Canonical ID order; finite prerequisite/resource rules; one action per entity per tick. Waiting is valid. No LLM call required.
- Authority derives draw slots from scope/ruleset/tick/entity/project/slot, never retry IDs or invocation chunking; this changes current RNG semantics and needs migration.
- Validate all effects under the writer lock and head check, then commit the complete tick atomically or reject it.
- Completion may produce one bounded follow-up candidate eligible next tick, never an immediate recursive cascade. Resume remaining authorized backlog only through another bounded call.

## Deterministic benchmark specifications

### R3-B1: Wall-clock isolation

Status: **proposed**.

**Given:** World is at10 with no authorized advance.
**When:** 30wall-clock days pass and polling occurs.
**Then:** World time, canonical projection and head are unchanged.
**Oracle:** Compare canonical snapshots and head.

### R3-B2: Chunk-independent catch-up

Status: **proposed**.

**Given:** Explicit target20 from10 with a fixed seed.
**When:** Run8ticks then2; compare10single-tick invocations.
**Then:** Same physical state and per-tick random commitments. No skipped ticks; retries append no duplicate effects.
**Oracle:** Canonical graph/state comparison; full event hashes need identical message identities too.

### R3-B3: No completion cascade

Status: **proposed**.

**Given:** Faction has1resource and project3/4.
**When:** Valid action spends1 for1progress.
**Then:** One completion and zero remaining resource. Follow-up cannot execute before next tick. Injected consent/intervention effect is rejected.
**Oracle:** Effect counts, resource invariants and unchanged state on rejected tick.

## Limits and open questions

- SWN primary book was inspected on a third-party mirror; official storefront returned403. Pin the final distributed edition before encoding detailed rules.
- UO testimony is retrospective and contested, not contemporaneous telemetry.
- No background tick action, resource ecology or physical graph projection is implemented by this starter research.
