# Review successor repairs implementation plan

> For agentic workers: execute the assigned ticket in its isolated worktree. Use the existing flat peer workflow; do not spawn nested workers. Runtime implementation waits for the coordinator's contract freeze.

**Goal:** Fix encounter-wide denial of service, missing NPC offer knowledge and unauthorized new legacy observations without rewriting old histories.

**Architecture:** Separate mortal-v3 authority, additive dialogue knowledge catalog/grants and a versioned v1 write-admission boundary. Exact-candidate offline application gates and native peer review remain separate from Board lifecycle.

**Tech stack:** TypeScript, Node24, JSON Schema/Ajv, SQLite workers; no new dependencies.

**Spec:** [DR-190 design](../deep-review/design/sequence.md).

## Global constraints

- Frozen v1, character, campaign0.1 and mortal-v2 bytes stay unchanged.
- No paid model calls, deployment, automatic legacy migration or direct model writes.
- One source worktree and disjoint owned paths per ticket; coordinator owns exports/fixture compatibility/docs.
- Preserve actual Board states; its data-only policy cannot certify application changes.

## Review focus

- Remote activity cannot reset recovery tokens or touch an encounter's site, roster or inventory.
- Recovery cannot double-charge a round, revive actors or mint resources.
- Authored terms remain owner policy; no private/shared-fact conflation or automatic player obligation.
- A catalog's self-reported hash is not trusted provenance; activation/grants must bind pinned source bytes and full scope/prefix.
- Async observation grants cannot hold the writer lock, outlive the call deadline or authorize a changed cursor.

## DR-201: scoped encounters and recovery

Files: new `SYSTEMS/mortal-v3/`, `packages/contracts/src/mortal-v3{,-types}.ts`, `packages/ledger/src/mortal-v3/`, and `TESTS/mortal-v3-*.ts`.

Produces `MORTAL_V3_PROFILE`, `MortalV3*` DTOs, `assertMortalV3Contract`, `assertMortalV3Genesis`, `assertMortalV3Data`, `mortalV3Schema`; then explicit v3 initialization/resolution/journal/store/view APIs. Consumes the scoped v1 namespace and immutable v2 definitions only where reuse preserves version distinctions.

- [ ] Write failing schema tests: closed recovery command/turn token, cross-version rejection, unsafe payloads and freeze identity.
- [ ] Implement/freeze schema/types/guards; verify with `node --test --test-isolation=none TESTS/mortal-v3-contracts.test.ts`; commit for contract review.
- [ ] After freeze, write failures for remote travel/wait, protected site/roster, forged/stale recovery, exact pass/close time, resource conservation and version mixing.
- [ ] Implement explicit v3 reducer/journal/async store/view; verify deterministic replay/restart/receipt binding and concurrency.
- [ ] Commit source and report exact SHA plus evidence; coordinator supplies a fresh-campaign v3 builder and exports.

## DR-211: authored actor knowledge

Files: new `SYSTEMS/dialogue-knowledge-v1/`, `packages/contracts/src/dialogue-knowledge{,-types}.ts`, `scenarios/tempted-fates/campaign/knowledge/`, plus existing `dialogue-types.ts`/`dialogue-context.ts` and new dedicated knowledge tests.

Produces closed `AuthoredSourceManifest`, `AuthoredKnowledgeCatalog`, `AuthoredKnowledgeActivation`, `AuthoredKnowledgeDisclosure` and dialogue0.2 selected knowledge. Consumes the exact CharacterActorQuery and frozen campaign pack; grant authentication/ancestry remains a trusted host loader obligation.

- [ ] Write failing tests for wrong actor/scope/hash/time/head, missing activation, unselected/oversized/active data and unsupported entry kinds.
- [ ] Implement/freeze the contract and pinned source-manifest format, run dedicated schema tests and commit for contract review.
- [ ] After freeze, curate source-backed Melia terms, implement opt-in projection and additive supplement parsing/packet construction.
- [ ] Capture the injected provider request: exact terms present for Melia only; no referee secrets; reading causes no ledger/custody/resource mutation; changed grants suppress late generation.
- [ ] Commit source and evidence; coordinator exports the helper and documents persisted initialization/activation and exact-query host disclosure.

## DR-221: restrictive new observation admission

Files: `SYSTEMS/observation-admission-v1/`, `packages/contracts/src/observation-admission.ts`, `packages/ledger/src/observation-admission.ts`, existing ledger `index.ts`, and `TESTS/observation-admission.test.ts`.

Produces `OBSERVATION_ADMISSION_PROFILE`, `ObservationAdmissionRequest`, `ObservationWitnessGrant`, `observationNeedsWitness`, `createObservationAdmissionRequest`, `assertObservationWitnessGrant`. A per-attempt request hashes full proposal/principal/window; a host grant binds it to scope, cursor, source and recipients. Historic v1 replay remains unchanged.

- [ ] Write failing contract tests for source/proxy forgery and altered grant bindings/deadlines; implement/freeze guards and commit for review.
- [ ] After freeze, test the supplied foreign-recipient attack, no-host refusal, correct host grant, slow host/nonblocking read, stale cursor, exact concurrent retry and cancellation/deadline.
- [ ] Implement locked preflight, outside-lock grant and locked retry-first revalidation/append; never infer witnesses from party membership.
- [ ] Preserve historical signed replay tests separately from new admission tests; coordinator updates only fixture setup whose old writes are intentionally invalid now.
- [ ] Commit source/evidence; record admission-only limit and deferred persisted witness evidence.

## Integration and acceptance

- [x] Review the contract commits before permitting runtime work; record hashes (contract-record.json).
- [ ] Cherry-pick immutable source commits, wire exports/fresh campaign helper and compatibility fixtures; run contracts, typecheck and affected tests.
- [ ] Obtain independent native adversarial review; reproduce/fix reported gaps and retest affected paths.
- [ ] Run the exact immutable candidate through all ten offline application groups without changing gate policy.
- [ ] Retain portable evidence and truthful Board state, push PR, check GitHub CI, then merge under standing authorization and synchronize main.
