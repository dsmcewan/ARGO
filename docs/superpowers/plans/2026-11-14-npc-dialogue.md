# NPC Dialogue Connection Implementation Plan

**Goal:** Connect character speech and impression callbacks to the shared model client with private, bounded context and existing commit authority.

**Architecture:** Add an actor-scoped model adapter to interventions and an explicitly authorized static campaign projection. Keep narration and character speech distinct; preserve frozen ledger contracts. A narrow opt-in model-client output policy supports short interactive generation without changing harness defaults.

**Tech Stack:** Existing TypeScript, Node 24, native test runner and shared multi-vendor client. No new third-party dependency or paid model run.

**Spec:** [Fixed presentation interface](../../npc-dialogue/CONTRACT.md).

## Global constraints

- User requested connecting the contextual dialogue path; existing authorization supports implementation without another design-approval round.
- Work from `6ff1218` in an isolated branch. Claims and owned paths are recorded in a separate offline Board namespace; no automatic dispatch, self-certified merge or trust-policy update.
- Preserve `SYSTEMS/characters-v1`, mortal authority and all historical evidence. Each model output remains an untrusted proposal.
- Use injected provider transports for tests. Production host supplies SDK clients, identity-bound readers and optional token counters.

## Review focus

Actor/cursor mismatch, stale disclosure between retries, active input objects, Unicode limits and provider truncation/tool responses must fail without a speech commit. Short-output limits must not be silently inflated. Static campaign content must never be mistaken for live location or shared opinion.

### Task ND-100: Scoped context and model-backed agent

Files: `packages/interventions/src/dialogue-types.ts`, `dialogue-context.ts`, `character-model.ts`, package entry/manifest; `TESTS/character-model.test.ts`; root lockfile and documentation.

- [ ] Write failing tests for free-form provider output, exact addressed input, actor-private traits, impression provenance, normalized nature and silence gates.
- [ ] Implement the fixed interface and bounded passive supplement/response validation. Use the existing agent for proposal construction and the existing router/client for providers.
- [ ] Prove before/after refresh, cancellation, stale suppression, byte/Unicode bounds, no tools/history and per-pool failover with offline tests.
- [ ] Commit the implementation; retain red/green evidence outside mutable source.

### Task ND-200: Explicit provider output budget

Files: `packages/model-client/request.mjs`, `index.d.mts`, `tests/request.test.mjs` (or a separately named output-budget test).

- [ ] Write a failing test showing bounded Google dialogue output stays at the caller's explicit limit.
- [ ] Add `outputBudgetPolicy?:'long_decode'|'explicit'`. Explicit mode requires a positive explicit output cap and preserves it; omitted/long_decode keeps legacy behavior. Reject unknown modes.
- [ ] Test all provider surfaces and both policies; run the model-client suite and commit only owned files.

### Task ND-300: Campaign projection and real authority integration

Files: `scenarios/tempted-fates/campaign/dialogue.ts`, scenario entry; `TESTS/campaign-dialogue.test.ts`, `TESTS/character-model-integration.test.ts`.

- [ ] Write failing tests for explicit room disclosure, own actor goals, null room/traveler behavior, and absent private/referee/variant/sample-speech content.
- [ ] Implement the helper against the fixed supplement type; do not infer room visibility from initial occupancy.
- [ ] Wire an injected model through the real signed character journal and bridge. Verify accepted generated speech and replay without a second generation call.

### Integration and release verification

- [ ] Run typechecks, relevant suites and the full immutable offline application gate.
- [ ] Obtain a separate review of the assembled change; fix reproduced material defects.
- [ ] Record exact code identities, evidence and Board dispositions honestly. Documentation distinguishes connected library functionality from deployed live services and measured dialogue quality.

## Progress

The merged baseline has an identical tree to the prior release's ten-gate candidate. The two read-only scouts confirmed the fixed interface's compatibility and the Google cap issue. Implementation has not started when this plan is recorded.
