# Phase 0.5 — mechanics research and headless follow-up

This track follows the already completed four-phase foundation at `05a292c403442a24b8f420e8b851f41f0f581ce5`. The name “Phase 0.5” describes its research role; it does not rewrite history or reopen the v1 freeze.

The user authorized **dispatcher + source-backed starter research, then the offline board engine**. Paid model runs remain off. Codex helpers researched independent topics; Grok, Gemini and Claude pipeline stages have **not** executed.

Read [the exact dispatcher](SCOUT_DISPATCHER.md), [audit refresh prompt](REPO_AUDIT_PROMPT.md), [headless foundation specification](HEADLESS_FOUNDATION.md), and [starter synthesis](SYNTHESIS.md). Reports live under `findings/`; their JSON sidecars distinguish documented observations, design inferences, hypotheses and future tests. `schemas/report.schema.json` is a research-output contract, not a gameplay schema.

Run `node RESEARCH/validate.mjs` to check all five reports, source references, coverage paths and the unchanged v1 freeze. A passing research-format check does not prove that a proposed mechanic works or that a source's conclusion is true.

The requested routes remain R1–R4 → `grok-4.3`, R5 → `grok-4.7`, synthesis → `gemini-4-carbon`, architecture proposal → `claude-fable-5-2` at high effort. The local deterministic supervisor, never a model verdict, controls verification and merge. The offline dispatcher runs operator-supplied local fixtures under confinement; it does not connect these model seats to vendors.

## Loadable planning seed

[`argo_night1_seed.json`](argo_night1_seed.json) contains 11 follow-up tickets: three source/KG delta audits, five research lanes, two syntheses and one versioned architecture proposal. The original foundation is already complete, so this seed neither repeats its harness patch nor schedules narration/UI/voice work. Ticket specifications are in `tickets/`.

The seed can be initialized without launching workers; see [offline board operations](../tools/README.md). **It is not an unattended execution-ready pipeline.** T-104 through T-108 have report-format gates that refuse these starter files as completed work. T-101 through T-103, T-201, T-202 and T-301 fail explicitly with `GATE_NOT_IMPLEMENTED` until source verification, synthesis coverage and graph adversarial oracles exist. They cannot pass on headings or a model's approval. New gate policy requires a new reviewed board. Reports do not provide licensing clearance, production endpoint verification or implemented graph mechanics.

Canonical and epistemic projections, bus integration and the 10,000-event fuzz target remain **specified future work**. No new KG runtime is claimed by this research pass.

## Reading order

1. `findings/01_referee_loops.md`: bounded session coordination and explicit ruling authority.
2. `findings/02_sandbox_concurrency.md`: expedition scheduling, causal checkpoints and rumor disclosure.
3. `findings/03_world_simulation.md`: bounded discrete ticks, resource circulation and inspectable history.
4. `findings/04_open_rulesets.md`: edition-specific licensing and a provisional Knave 1e kernel recommendation.
5. `findings/05_competitor_autopsy.md`: Foundry v13 mappings and measurable attack cases.

History is context, not an acceptance oracle. Sandbox and plotted play coexist; the proposed six-era progression does not establish that the entire hobby abandoned persistent worlds. Likewise, do not treat all AI RPG tools as stateless, or all OSR rules as CC BY.
