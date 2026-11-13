# Sandbox concurrency and rumor provenance

Status: **starter**. Baseline: `05a292c403442a24b8f420e8b851f41f0f581ce5`. Prepared as codex_starter; requested seat `grok-4.3`; actual vendor execution: none.

Keep scheduling and world time distinct. Current v1 implements serialized authority plus stale-head rejection; queue and transparent_fork remain unsupported. Proposed expedition calendars and truth assessments require migration.

## Sources

- **R2-S1** [Ben Robbins West Marches series, public transcription](https://www.scribd.com/document/326760110/West-Marches) — Original blog series 2007; transcription date unspecified; primary_work_mirror; accessed 2026-11-13. Locator: Scheduling: Players Are In Control; Sharing Info; Shared World table map; Running Your Own.
- **R2-S2** [Open Table Manifesto, Part3](https://thealexandrian.net/wordpress/38669/roleplaying-games/open-table-manifesto-part-3-organizing-your-open-table) — 2016-08-22; primary_page; accessed 2026-11-13. Locator: Campaign Time Management; Lockdown; End of Session Status.
- **R2-S3** [Hexcrawl Tool: Rumor Tables](https://thealexandrian.net/wordpress/48539/roleplaying-games/hexcrawl-tool-rumor-tables) — 2022-10-22; primary_page; accessed 2026-11-13. Locator: Source; Focus; Truth Value.
- **R2-S4** [Hearing Rumors](https://thealexandrian.net/wordpress/48549/roleplaying-games/hexcrawl-tool-rumor-tables-part-2-hearing-rumors) — 2022-10-23; primary_page; accessed 2026-11-13. Locator: Contextualizing Rumors; Open Table Rumor Pool.
- **R2-S5** [Restocking Your Rumor Table](https://thealexandrian.net/wordpress/48552/roleplaying-games/hexcrawl-tool-rumor-tables-part-3-restocking-your-rumor-table) — 2022-10-24; primary_page; accessed 2026-11-13. Locator: Same Rumor, New Context; Evolve Situations.

## Findings

- **R2-C1 (documented)** The reproduced Robbins protocol puts destinations and group assembly in players’ hands, coordinated with the referee. Shared reports and maps connect expeditions without proving every character knows every private fact. Sources: R2-S1.
- **R2-C2 (documented)** Alexander proposes real-day/campaign-day correspondence, then addresses journeys that outrun the calendar using character/location lockdowns. This is one design, not a universal West Marches requirement. Sources: R2-S2.
- **R2-C3 (documented)** Rumor content, provenance and underlying truth differ. Rumors can be partial or mixed, and changing circumstances can make an earlier report outdated. Sharing can remain an explicit player choice. Sources: R2-S3, R2-S4, R2-S5.

## Proposed mechanics and fields

### R2-P1: Explicit expedition checkpoints and authority-only rumor assessment

Compatibility: **versioned_migration**. Targets: SYSTEMS, MECHANICS, TESTS. Sources: R2-S1, R2-S2, R2-S3.

| Field | Type | Visibility | Meaning |
|---|---|---|---|
| `expedition_id` | stable ID | actor_scoped | Scheduling identity separate from causal history |
| `scheduled_start_utc` | timestamp | session_only | Appointment only, never world-time authority |
| `checkpoint_id` | existing scoped checkpoint reference | actor_scoped | Pin head/sequence/world_time |
| `truth_class` | true/false/partial/mixed/unknown | authority | Assessment at specified evidence prefix |
| `temporal_status` | current/outdated/undetermined | authority | Separate age from falsehood |
| `source_claim_id` | nullable provenance reference | actor_scoped | Preserve transmission chain and original acquisition |

- A stale solo action after a raid commit returns CONFLICT without queuing, rebasing or forking automatically.
- Rumor assessments bind assessed_at_sequence and evaluated_world_time; never leak them as narrator hints or retrieval-ranking side channels.
- Keep existing ClaimRecord.acquired_at plus sequence cutoff; backdating occurrence cannot backdate knowledge.
- Party membership alone grants no member’s private claim. Sharing commits specify eligible observers and party disclosure.
- Do not insert late expedition actions behind the committed ledger head; new scheduling semantics need a reviewed migration.

## Deterministic benchmark specifications

### R2-B1: Solo versus raid conflict

Status: **proposed**.

**Given:** Two proposals target H.
**When:** Raid commits before solo validation.
**Then:** Solo receives CONFLICT. No second event, queue or new branch.
**Oracle:** Event count and branch identifiers; exact retry returns original outcome.

### R2-B2: Explicit disclosure and acquisition cutoff

Status: **proposed**.

**Given:** A privately acquired R at tick10/sequence5.
**When:** Party queries, then receives authorized disclosure at tick12/sequence8.
**Then:** Initial party view excludes R. R appears only with both cutoffs and explicit observer authorization.
**Oracle:** Exact filtered claim sets, not model judgement.

### R2-B3: Outdated versus false

Status: **proposed**.

**Given:** Bridge was passable at20, destroyed at30; old report is heard at40.
**When:** Assess at20/40 and query actor knowledge before40.
**Then:** Assessment differs by evaluation time. Acquisition stays40. No authority-only assessment leaks to narrator.
**Oracle:** Bitemporal assessment and visibility fixtures; future migration.

## Limits and open questions

- Canonical Robbins URLs https://arsludi.lamemage.com/index.php/78/grand-experiments-west-marches/ and follow-ups returned403. The transcription is inspected evidence, not authenticated original retrieval; exclude its AI summary.
- No retroactive expedition scheduler or authoritative rumor truth classifier is implemented in v1.
