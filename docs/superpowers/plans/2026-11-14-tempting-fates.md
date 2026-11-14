# Tempting Fates implementation plan

> For agentic workers: use the owner's established flat blackboard peers. Freeze shared content/types before parallel workers; do not spawn recursive workers. Root assembles the candidate, then a separate reviewer checks it.

**Goal:** Deliver a playable original Greek-myth campaign kit with source-attributed rules tools and a tested ARGO seed adapter.

**Architecture:** Add a static referee content profile under the existing scenario package. Pure rule functions return previews; host seed construction uses existing Genesis and character contracts. Existing ledger/authority code is unchanged.

**Tech Stack:** TypeScript/Node24, existing Ajv8, JSON/Markdown, Python SQLite build board; no new external service or model call.

**Spec:** `docs/superpowers/specs/2026-11-14-tempting-fates-design.md`.

## Constraints and review focus

- Preserve every existing frozen schema and the source scenario; new display title is not a source rename.
- Do not import unapproved repair branches or modify active character-runtime lane paths.
- Keep private referee truth out of the player handout and rumor candidate cards; no card automatically grants knowledge.
- Explicit variant and supplied private seed establish one world; no retrieval-based relocation/reroll.
- Literal dice/capacity/death/morale boundaries; invalid values reject before a preview, with no world mutation.
- Meaningful open choices, finite projects, separate Fate roles, no mandatory gift or automatic anomaly.
- Correct Knave1e attribution and adaptation labels; all new setting prose original.

## TF-000 — root content interface freeze

Files: `scenarios/tempted-fates/campaign/{types.ts,content.schema.json,CONTRACT.md,FREEZE.json}`, `TESTS/tempting-fates-contracts.test.ts`.

- [x] Define closed DTOs, stable IDs and exact public/tool interfaces; freeze before dependent dispatch.
- [x] Add failing schema/meta and reference fixture tests, implement source grammar, capture baseline and freeze hashes.

## TF-100 — campaign author

Files: `scenarios/tempted-fates/campaign/world.json`; `CAMPAIGNS/Tempting_Fates/{ATLAS.md,ENCOUNTERS.md,REFEREE_GUIDE.md}`.

- [ ] Populate complete world data using frozen fields/IDs and write playable situations, clocks and consequences.
- [ ] Keep GM truth separate, give all hooks refusal/exit outcomes, preserve optional relic/Fates.
- [ ] Validate pack after runtime is available; commit owned paths for integration/content review.

## TF-200 — rules tools and reference

Files: `scenarios/tempted-fates/campaign/rules.ts`; `TESTS/tempting-fates-rules.test.ts`; `CAMPAIGNS/Tempting_Fates/{RULES.md,CHARACTER_SHEET.md,ATTRIBUTION.md}`.

- [ ] RED: fixed ability dice, strict save ties, advantage/disadvantage, invalid dice/overflow, capacity, damage/rest/morale, exhausted project budget.
- [ ] Implement frozen pure APIs; no RNG, I/O, model or world writes. Document exactly what tabletop procedures remain manual.
- [ ] GREEN: literal expected results and nonmutation checks; typecheck and source attribution; commit owned paths.

## TF-300 — catalog and seed adapter

Files: `scenarios/tempted-fates/campaign/catalog.ts`; `TESTS/tempting-fates-catalog.test.ts`.

- [ ] RED: malformed/passive data, duplicate/dangling IDs, broken routes/Fate roles, hidden truth in public outputs, invalid roster/scope/seed, stable variants.
- [ ] Implement validator, public handout, rumor candidate and host-only seed builder as specified in the frozen contract.
- [ ] GREEN using independent small fixtures; root runs actual authored pack and real-ledger tests. Commit owned paths.

## TF-900 — root integration and playable start

Files: `scenarios/tempted-fates/{index.ts,package.json}`, `package-lock.json`; `TESTS/tempting-fates-integration.test.ts`; `CAMPAIGNS/Tempting_Fates/{README.md,PLAYER_GUIDE.md,QUICKSTART.md}`; `docs/tempting-fates/`; this plan and design spec.

- [ ] Wire package exports and existing Ajv dependency; provide an immediately usable solo and party opening plus player orientation.
- [ ] Real-ledger integration tests: seed variants, configure characters, disclose rumor to one actor, preserve party secrecy, transfer actual item custody, replay, and unchanged history from rules previews.
- [ ] Validate actual pack and all document references, review content for playability/canon, run full offline repository gate.
- [ ] Retain source/test/review hashes and accurate blackboard submissions; no push/merge approval or paid runs implied.

## Owner clarification and Phase2 boundary

The owner selected dark tragic mythology (horror, hubris, divine punishment), and explicitly confirmed campaign kit, strict TypeScript/JSON schemas and deterministic tools only. No exploration/combat/resource writes enter the ledger or character authority. TF900 adds a separate non-authoritative tabletop state blueprint with a strict JSON grammar, matching TypeScript example, validation tests and documented future transaction invariants under docs/tempting-fates/phase2.
