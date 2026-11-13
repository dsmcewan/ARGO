# Character and narrator implementation plan

> For agentic workers: use the user's established flat peer/blackboard execution method. Freeze shared contracts first; no recursive workers. Root integrates disjoint patches and a separate peer reviews the combined branch.

**Goal:** Implement observer-owned character impressions, bounded quiet character reactions, and an audience-safe traveler record for ARGO's world-external narrator.

**Architecture:** Add `character-memory/1.0.0` as private, authority-authored epistemic records in the existing signed journal. Preserve every frozen v1 byte and historical rule. A verified authority projection feeds scoped readers; autonomous characters return untrusted proposals; narration has read capabilities only.

**Tech Stack:** Existing TypeScript/Node24, Ajv2020, signed filesystem ledger, Python blackboard and offline injected provider tests. No new dependencies or paid runs.

**Spec:** `docs/design-intent/characters-and-narrator/README.md` and `SYSTEMS/characters-v1/CONTRACT.md`.

## Authorization and implementation choices

The owner's `Implement` instruction authorizes execution of the published all-campaign intent. Continue without another plan-confirmation cycle. The following are implementation choices, not reconstructed owner decisions: accepted speech plus committed actions from activation define captured history; old chat/rejected attempts are not retrospectively captured; existing persona labels remain compatible; the common onlooker voice is a separate presentation policy; quiet characters have caller-configured speech budgets; presence/disclosure is supplied by a trusted host adjudicator. The missing abuse section stays unimplemented.

The alternative is a new physical ledger format and ruleset migration. The internal versioned extension is chosen because it preserves one authoritative writer and existing replay while delivering this feature. It is campaign-neutral at the character interface; its first carrier adapter uses the current v1 ruleset transport.

## Global constraints

- Preserve `SYSTEMS/CONTRACT_FREEZE.json` and `SYSTEMS/proposals/headless-v2/FREEZE.json` bytes and their files.
- Do not merge the separate `bfe2957` review-repair candidate or promote a new operational controller trust root.
- Only the configured system identity writes extension carriers; opaque carriers have that system actor as their sole outer observer.
- Speech identity comes from the authenticated principal; witnesses/disclosure come from a host callback, never a caller's witness list.
- Replay verifies the entire outer signed history and system provenance. Ordinary-user marker spoofing grants no extension authority.
- Private history and observer impressions never enter an unauthorized model request. Scope, prefix and current cutoff bind reads and delivery.
- Nature/interpretation is recorded once and replayed; no model participates in replay. No global traveler reputation property.
- Models/characters receive reader and proposal interfaces, never a ledger handle, signing key or system principal.

## Review focus

1. Forged internal markers, observer acquisition and source identity must not poison projections (authority tests).
2. Delayed callbacks, concurrent commits and altered retries must not append stale/duplicate events (authority tests).
3. Party context must exclude private history even across pagination, retry and object mutation (reader/narrator tests).
4. Ended actors, busy characters and stale/cutoff responses must not produce new speech (authority/runtime/narrator tests).
5. Nature revisions, same-tick ordering and historical replay must preserve private interpretation ownership (projection/integration tests).

## Task 1 — Shared profile (root, sequential)

Files: `SYSTEMS/characters-v1/{CONTRACT.md,characters.schema.json,FREEZE.json}`, `packages/contracts/src/characters.ts`, additive exports in `packages/contracts/src/index.ts`, `TESTS/character-contracts.test.ts`.

- [x] Write failing schema/API tests for unknown fields, spoofed actor input, invalid cursors, scope identity, bounded arrays and temporal fields.
- [x] Implement the typed profile and runtime validators; make the tests pass and run typecheck.
- [x] Freeze schema/spec hashes before assigning runtime workers. The freeze records interface identity, not operational trust approval.

## Task 2 — Authority and replay (flat authority lane)

Files: `packages/ledger/src/characters.ts`, `packages/telos-bridge/src/characters.ts`, `TESTS/character-authority.test.ts`.

Interfaces: `createCharacterAuthority({ledger,systemPrincipal,authorizeWitnesses})` returns async `submit(command,principal,call)` and authority-only `readProjection(call)`. `replayCharacters(genesis,events,systemPrincipal)` is a pure reducer. `createCharacterBridge({scope,transport,timeoutMs})` binds command/receipt and forwards bounded calls. Exact DTO names are frozen by Task1.

- [x] RED: forged witnesses/internal markers, altered retries, dead speech, impression without acquisition and stale host callback must fail without an append.
- [x] Implement private carriers, replay/provenance, activation coverage, whitelisted action records, authorized speech and append-only impression revisions; publish only through the existing ledger.
- [x] GREEN: reopen ledger and compare replay at sampled prefixes; verify exact retries and receipt scope/hash bindings. Capture logs; commit only owned files.

## Task 3 — Knowledge readers (flat knowledge lane)

Files: `packages/lexi-bridge/src/characters.ts`, `TESTS/character-knowledge.test.ts`.

Interface: `createCharacterViews({scope,readProjection,timeoutMs})` returns `actor(query,principal,call)` and `narrator(query,principal,call)`. The host supplies a trusted fresh projection reader. Queries require the exact current prefix; replaying a supplied prefix separately remains possible for tests. Actor views contain only their own latest impressions and the latest16 authorized experiences. Narrator pages filter audience before pagination and never return private impressions.

- [x] RED: traveler reading another observer's impressions, party/private crossover, future/stale prefix and unauthorized page membership.
- [x] Implement binding and detached results; exclude opaque carrier/provenance fields and all hidden authority material.
- [x] GREEN: literal expected private/party records, same-tick acquisition and pagination without hidden-row gaps/counts. Commit owned files.

## Task 4 — Quiet characters and narrator (flat presentation lane)

Files: `packages/interventions/src/characters.ts`, `packages/argo-dm/src/characters.ts`, `TESTS/character-presentation.test.ts`.

Interfaces: `createCharacterAgent({actorId,interpret,speak,timeoutMs})` produces optional `impress(view,subject,evidence,requestId,call)` and `respond(view,recordId,requestId,call)` commands. `createCharacterNarrator({scope,sessionId,candidates,clientFor,refreshContext})` exposes `narrate({query,prompt,persona?,signal?})`. No writer is accepted by either factory.

- [x] RED: busy/ended/unaddressed characters cause no speech callback; unauthorized evidence and oversized speech produce no valid proposal.
- [x] Implement sparse optional reactions through the observer's nature and current activity. Current turn and speech policy bind every proposal.
- [x] Implement common tired/dry/sarcastic onlooker header over audience-filtered archive pages, fixed private cache scope and pre/post-generation refresh. A changed disclosure view or cutoff discards output.
- [x] GREEN: captured model payload excludes private solo text, nature/impression context remains observer-owned, cutoff/mutation/retry behavior and legacy persona compatibility. Commit owned files.

## Task 5 — Integration and delivery (root)

Files: additive package public exports, `TESTS/character-integration.test.ts`, `docs/characters-runtime/`, ownership/roadmap documentation if needed.

- [x] Wire real ledger → character authority/bridge → views → two character agents → narrator using only injected provider transport. Two witnesses must preserve different impressions; a third actor gets neither.
- [x] Demonstrate accepted speech, custody action, private-to-party selection, quiet working characters, exact replay and Tempted Fates cutoff.
- [x] Run `npm test`, typecheck, frozen contract checks and the full ten-group gate in a network-isolated read-only candidate. No live models.
- [x] Obtain a separate same-model code review, fix material findings with reproducing tests, retain portable evidence and accurate blackboard states. Such review is advisory, not an operational trust-root promotion.

## Progress

- Baseline `100e6c2`: 80 foundation tests passed before changes.
- Implementation runs in `.worktrees/character-runtime`; main and earlier repair branches are preserved.

- Shared profile frozen at `3f231e8` before runtime leases. Authority, reader and presentation lanes are assembled at `0b827e1`; public entry-point integration passes 4 real-ledger tests and strict TypeScript. All ten candidate gate groups passed on that exact commit in a network-isolated, read-only clone. Its foundation group executes the complete native test suite; the separate authority review passed 26 existing tests and 6 additional real-ledger probes with no confirmed blocking finding. Portable evidence and exact code hashes are in `docs/characters-runtime/verification.json`.
