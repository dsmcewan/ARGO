# ARGO sequential foundation implementation plan

> **For agentic workers:** Use superpowers:executing-plans task-by-task. The user requires one dependency spine before parallel implementation lanes; do not fan out workers during these tasks.

**Goal:** Freeze the audited ARGO contracts, repair the active harness's model boundary, then build a deterministic ledger/bridge/scenario foundation.

**Architecture:** Stateless DM and gateway submit untrusted proposals to TELOS authority. A single scoped signed ledger records causal and epistemic events; LEXI materializes actor-limited historical claims. The reusable provider client lives outside gameplay state and is also used by Pantheon.

**Tech stack:** Node 24 ESM, TypeScript for new typed gameplay packages, JSON Schema 2020-12 with Ajv, native Node tests, injected provider clients, Ed25519/SHA-256/HMAC from Node crypto, asynchronous filesystem storage.

**Spec:** `ARGO_BRIEF.md`, `SYSTEMS/ARCHITECTURE.md`, `SYSTEMS/argo-v1.schema.json`, `MECHANICS/tempted-fates-v1.md`, `SCENARIOS/Tempted_Fates.md`.

## Global constraints

- Strict order: audit → contract freeze → harness repair → sequential ledger/bridges/scenario → optional parallel feature lanes.
- No live model calls, pool spending, service deployment or production database access in this work.
- Complete scope on every request/event; four content lanes; no private-solo to public-party knowledge union.
- Proposal/model text never commits world truth. Controller checks bind the candidate actually merged.
- Nonnegative safe integer ticks; ruleset `tempted-fates/1.0.0`; immutable schema version `1.0.0`.
- Fable `high` default, architecture `xhigh`; Astra input strictly below 250000; Google output+thinking budget at least 65536 on supported transport; terminal 400/auth failures; opaque reasoning preservation.

## Review focus

- A provider fails permanently on the retry after 429: no additional request or provider substitution (Task 2).
- Two processes commit against one head or two pools update concurrently: no lost updates or duplicate accepted sequence (Tasks 2/3).
- Tampered event, corrupted tail, wrong-world parent or changed proposal under the same ID: halt rather than repair history (Task 3).
- A donor revokes/expires consent or a proxy grant after proposal creation: commit rechecks and refuses (Task 3).
- A historical view or persona switch after disappearance: no ontological explanation and no reengagement after naming (Task 4).

### Task 1: freeze contracts

Files: `SYSTEMS/argo-v1.schema.json`, `SYSTEMS/ARCHITECTURE.md`, `MECHANICS/tempted-fates-v1.md`, `SYSTEMS/CONTRACT_FREEZE.json`.

Interfaces: the schema's 36 definitions; `submit(IntentProposal, Principal, {signal}) -> Promise<Outcome>`; `query(KnowledgeQuery, Principal, {signal}) -> Promise<KnowledgeView>`; pure `validate/apply/replay` mechanics.

- [x] Check JSON Schema metaschema, every local reference and all forbidden-extra-property boundaries; review semantics against TF-01..TF-12.
- [x] Freeze SHA-256 for each normative schema/design/mechanics/source file; verify recomputation matches.
- [x] Commit schema freeze before changing the harness.

### Task 2: repair and package the model boundary

Files: `packages/model-client/` (model registry, request policy, async routing and typed declarations); active `pantheon/src/sdk/adapter.mjs`, `stream.mjs`, `src/route/`, `src/config/`, `src/board/run-item.mjs`, `spawn.mjs`, `acceptance.mjs`; regression tests under `pantheon/tests/` and package tests.

Interfaces: `prepareRequest({vendor,model,prompt,history,extra,scope,...}, capabilities)`, `routeCall({candidates, invoke, signal, deadline, cooldown})`, injected SDK client constructors, result identity and complete/partial status. The client owns no world state. Exact requested API model seats route through their proper API transport; legacy CLI remains explicit.

- [ ] Write and run failing tests for Fable extras/effort/compaction lifecycle, Gemini combined budget/continuation/partial responses, Astra 249999/250000 input, Grok encrypted multi-turn history/cache scope, terminal errors on every attempt, bounded 429 routing and cross-process pool state.
- [ ] Implement the shared policy and route the active board/SDK path through it. Centralize model IDs without duplicate tables. Preserve true provider/pool identity through fallback.
- [ ] Write failing child-process tests for byte caps, ignored SIGTERM, descendants, cancellation and event-loop responsiveness; fix runner and acceptance toolchain portability.
- [ ] Run offline regressions and full Pantheon suite with necessary sandbox permissions. No disabled gates or live CLI fallbacks. Commit only after required checks pass; record environmental limitations explicitly if a check cannot run.

### Task 3: authoritative ledger first

Files: root workspace config, `packages/contracts/`, `packages/ledger/`, `ARGO_SYSTEM_BIBLE.md`, `OWNERSHIP.json`, `TESTS/ledger.test.ts`, CI/controller gate scripts.

Interfaces: contract validation/canonical encoding; `openLedger({directory,genesis,privateKey,verifyReceipt})`; async `submit(proposal,principal)`; pure `replay(genesis,events,expectedHead?)`; scoped current snapshot and private event read for authority only.

- [ ] Write failing replay-prefix, signature/tamper, corrupted-tail, idempotency, concurrent-process CAS, scope/parent, RNG and consent/proxy lifecycle tests.
- [ ] Implement canonical validation, pure ruleset, signatures, deterministic seeded draws and async locked append with durable recovery. Snapshot and seed remain private. Fail closed on unknown/corrupt state.
- [ ] Pin workspace dependencies and ownership. CI runs full JSON Schema validation, typechecks, process checks and deterministic replay hashes over the exact candidate; models never self-certify.
- [ ] Run tests/typechecks and commit the foundation ledger before adapters.

### Task 4: bridges and canonical Test Zero

Files: `packages/lexi-bridge/`, `packages/telos-bridge/`, `packages/argo-dm/`, `packages/interventions/`, `scenarios/tempted-fates/`, `TESTS/tempted-fates.test.ts`, `TESTS/bridges.test.ts`.

Interfaces: Task 1's async calls, deterministic mocks, NPC/Fate/intervention subscriber interfaces returning optional proposals, pure stateless narration from validated projections/outcomes.

- [ ] Write failing tests for callback deadlines/abort, response contracts, scope mismatch, actor/party/time knowledge filtering, jurisdiction and the full TF-01..TF-12 scenario matrix.
- [ ] Implement bridges with injected transports and deterministic mocks; filter epistemic projections at both actor and acquisition cutoffs; never retry a mutation with a new ID.
- [ ] Implement minimal independent Fate proposal adapters and hard cutoff rendering; no quest engine or automatic anomaly trigger. Add all required package boundaries and manifests.
- [ ] Run the entire deterministic gate and save hashes/status. Only now permit independent review/parallel feature lanes.

### Final review and save

- [ ] Obtain one independent whole-branch review after the sequential spine, fix material issues with red→green tests, and rerun the required gate.
- [ ] Save the tested branch and merge results to the private ARGO repository, preserving any new user commits. Update README/status with actual passed gates and live-service limitations.
