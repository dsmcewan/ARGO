# Starter synthesis — not a vendor synthesis run

Prepared in this Codex session from the five starter reports. `gemini-4-carbon` and `claude-fable-5-2` have not run. No proposed gameplay schema is frozen or implemented by this document.

The useful design pattern is an observable decision loop over persistent authority, supported by selective background simulation and explicit knowledge acquisition. Its appeal does not require a linear history in which all tabletop play abandoned sandboxes or every AI competitor lacks memory.

## Local invariant coverage index

The current Bible has prose constraints rather than an original numbered list of eleven laws. The following I01–I11 are a **local research review index** extracted from those constraints, not a replacement normative contract. All eleven have research/test mappings; this is trace coverage, not proof of implementation.

| ID | Bible constraint | Research and deterministic check |
|---|---|---|
| I01 | Only authorized ledger commits mutate world truth. | R1/R3/R5: unsupported action and illegal custody append nothing. |
| I02 | Gateway/narrator do not hold mutable world truth. | R1/R5: session timeout/prose leave ledger head unchanged. |
| I03 | Entire tenant/rights/workspace/campaign/world/branch scope is immutable. | R2/R4/R5: scope/rights identity differs; foreign responses refused. |
| I04 | Canonical facts remain separate from beliefs, rumors and accounts. | R2/R3: temporal rumor assessment cannot overwrite canonical projection. |
| I05 | Actor/party authorization and acquisition cutoffs govern knowledge. | R1/R2/R5: private perception and solo claims excluded from shared views. |
| I06 | Causal and epistemic history reconstruct deterministically. | R2/R3/R5: disclosure commits and graph cursors replay from one ledger prefix. |
| I07 | Causal preconditions/idempotency reject stale or duplicate effects. | R1/R2/R3: stale solo/raid rejection; exact retry adds no event. |
| I08 | Seed/hidden draws stay authority-private and replayable. | R3/R5: fixed draw slots and tampered-RNG refusal. |
| I09 | Time gifts require exact direct living-donor consent. | R3: autonomous tick cannot manufacture consent or transfer effects. |
| I10 | Proxy grants are scoped, limited, expiring and revocable. | R2/R5 plus existing authority tests: commit-time grant checks; no inherited permission from imported documents. |
| I11 | Autonomous proposals are optional; Fate jurisdictions and anomaly cutoffs remain hard. | R1/R3/R5: leave/refuse produces no forced event; no post-cutoff exposition or jurisdiction escalation. |

## Decisions and corrections

- Keep TypeScript for the game core and SQLite WAL/Python for build coordination. Add graph projection stores only through a migration; the audited LEXI SQLite backend does not prove an existing gameplay KG.
- Separate valid-time, recorded sequence and actor acquisition. A field named `as_of_tick` alone cannot express all three.
- Preserve current serialized writer/CAS semantics. Expedition calendars are proposed coordination records, not permission to append into the past or enable reserved queue/fork modes.
- Prototype bounded discrete ticks before autonomous narrative planning. The R3 caps are explicit hypotheses, not benchmarked limits. No wall-clock catch-up is implicit.
- Prefer a source-pinned Knave1e subset for the next CC BY kernel; defer until actual rule bytes/fixtures are reviewed. Cairn is share-alike; OSE2026 and YearZero require different license analysis. Do not transfer a first-edition grant to Knave2e.
- Treat Foundry as a versioned adapter source. Its document permissions, embedded IDs and recursive rolls are not ARGO authority or knowledge contracts.
- The initial “all competitors fold” language is unsupported. Measure attack hypotheses with synthetic fixtures and deterministic oracles, while acknowledging documented memory systems and source limitations.

## Follow-up order

1. Refresh exact graph/read-boundary evidence from pinned LEXI/TELOS sources.
2. Draft versioned projection/query/envelope schemas and negative fixtures; keep v1 intact.
3. Implement canonical and epistemic projections with stable checkpoints and a 10,000-event reproducible generator. Save failing seeds and traces.
4. Integrate a bounded component bus and headless NPC/intervention mocks; test duplicates, races, cancellation and solo/raid leakage.
5. Reconsider session/persona/voice implementation only after these gates pass.

Research JSON conformance and eleven-row mapping are necessary organizational checks, not substitutes for the future property/replay/concurrency suites.
