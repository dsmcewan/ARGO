# ARGO foundation brief

This records the user's requested build scope. It is not the Phase 2 schema freeze. Exact extracted facts and outstanding gaps are in `REPO_INVENTORY.md`.

## Phase 1 — existing repository audit

Perform read-only scout passes over LEXI, TELOS and the actual orchestration harness. Classify modules as **Expose As-Is**, **Wrap via Adapter**, or **Build Net-New** in the canonical inventory.

- LEXI: extract API, graph/relational, temporal and encrypted-storage contracts. Identify gaps in canonical facts versus actor beliefs, rumors and external accounts; per-actor and party knowledge isolation; and hard knowledge-acquisition cutoffs at world time.
- TELOS: extract deterministic validation, permissions, signatures/hash chains and fail-closed runners. Identify adapter needs for untrusted NPC/intervention/proxy proposals, replayable private random draws and scoped, expiring, revocable proxy grants.
- Harness: trace stage handoffs, sparse worktrees, async process execution, 429 routing/pools, model IDs, sampling parameters and output-token budgets.

## Phase 2 — freeze architecture contracts

Freeze versioned service schemas in `SYSTEMS/` and ruleset interfaces in `MECHANICS/` before concurrent implementation.

- Gateway and ARGO DM remain stateless regarding world truth. Personas include The Chronicler, The Fates and Plain Guide. Intent parsing produces candidate `IntentProposal` payloads for TELOS; narration renders validated outcomes.
- Distinguish causal commits from epistemic commits in the authoritative ledger. Physical state, clocks, custody and donor time transfers belong to causal commits. Hearing or observing claims during dialogue must also produce deterministic epistemic records.
- NPC runtime and independent intervention planner subscribe to Derived World State and submit optional proposals through TELOS. They cannot write the ledger or force quests.
- Isolate tenant/campaign namespaces and content lanes: `open_license`, `homebrew`, `marketplace_entitlement`, `private_upload`. Apply the boundary to retrieval and caches as well as final responses.
- Define encounter checkpoints and explicit `serialize`, `reject`, `queue`, or `transparent_fork` conflict policies for asynchronous solo play and synchronous party raids on a shared timeline.

## Phase 3 — model capability and routing repair

Requested seats: Fable 5.2 for orchestration/planning; Gemini 4 Carbon/Argon for synthesis/design and fast loops; GPT-6 Astra for implementation/schema work; Grok 4.3/4.7 for scouting/review; local deterministic controller for execution/merge gates.

Use the officially sourced corrections in `repo-audit/MODEL_API_AUDIT.md`. Model names and prices alone do not establish account availability or transport support. Address unsupported parameters, combined thinking/output limits, the requested Astra input limit below 250K, provider-specific cache/state preservation, compaction, and bounded 400/429 behavior. In particular, raw non-streaming Gemini 4 calls need continuation handling to deliver the requested larger output budget.

Package the multi-vendor client for reuse by ARGO narration and background agents. Preserve code ownership in worker prompts. Model self-grading never replaces JSON Schema validation, typechecks, process checks or replay evidence.

## Phase 4 — sequential foundation

After the earlier gates pass, establish the standalone monorepo with:

```text
packages/contracts
packages/ledger
packages/lexi-bridge
packages/telos-bridge
packages/argo-dm
packages/interventions
scenarios/tempted-fates
```

Add `ARGO_SYSTEM_BIBLE.md` and explicit ownership manifests during that phase. Implement the append-only ledger first, binding immutable world identity, ruleset version, actor/authority provenance, causal parents and seeded RNG records. CI must prove replay of each event prefix reproduces the corresponding snapshot bit-for-bit.

Then provide non-blocking LEXI/TELOS clients and deterministic contract mocks, followed by Integration Test Zero in `TESTS/`, grounded in `SCENARIOS/Tempted_Fates.md`. It must verify independent jurisdiction-bounded Fates, freely chosen donor transfers, and the post-ANOMALY boundary. The scenario's rarity and optionality are constraints; a test fixture must not become a guaranteed production quest or exploit recipe.

Only after these four phases pass may feature teams work concurrently against immutable contracts with disjoint code ownership and one authoritative ledger writer.
