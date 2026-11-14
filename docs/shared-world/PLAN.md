# Shared headless world implementation plan

> For agentic workers: use the existing flat, isolated blackboard workflow. No nested workers. Each lane reads this plan and DESIGN.md. Contract review/freeze precedes runtime; the pure reducer precedes journal/storage integration. Source Board state and external application acceptance stay distinct.

**Goal:** Run and resume an offline Tempting Fates session with one identity map, clock and atomic physical/epistemic history.

**Architecture:** A new shared-world authority embeds the existing pure mortal-v3 rules. One signed event commits its physical result and derived knowledge; the session host and model adapter consume scoped views.

**Tech stack:** Existing TypeScript/Node24, JSON Schema/Ajv, SQLite worker and model-client. No new external dependencies.

**Spec:** [DESIGN.md](DESIGN.md).

## Global constraints

- Preserve all frozen historical profiles and source evidence. New worlds only.
- Zero paid calls, no deployment, no implicit model client or recursive NPC loop.
- Schema validation does not authenticate principals, witnesses, entitlement or keys.
- One shared cursor/time and physical roster; one compound event per accepted command.
- Ordinary mortal campaign only; Fate/lifespan actions remain outside this new profile.
- Disjoint owned paths; coordinator owns exports, package manifests/lock, integration tests and delivery docs.

## Review focus

- Social-first sequence zero must not break the mortal reducer's genesis binding.
- A failed/stale/duplicate loan acceptance cannot create a partial obligation or second transfer.
- Addressing a remote actor or quoting another speaker cannot plant their knowledge.
- In-flight generation must not publish after movement, death, grant revocation or cutoff.
- Worker loss/timeout after dispatch is ambiguous; exact retries must reconcile without duplication.

## SW-100: contract freeze

Create `SYSTEMS/shared-world-v1/{CONTRACT.md,world.schema.json,FREEZE.json}`, `packages/contracts/src/shared-world-types.ts`, `shared-world.ts`, `TESTS/shared-world-contracts.test.ts` and contract fixtures.

Produces `WORLD_PROFILE`, `WorldGenesis`, `WorldPhysical`, `WorldState`, `WorldProfile`, `WorldCommand`, `WorldAction`, `WorldPrincipal`, `WorldCursor`, `WorldQuery`, `WorldActorView`, `WorldMemory`, `WorldImpression`, `WorldLoanOffer`, `WorldLoan`, `WorldResolution`, `WorldEvent`, `WorldReceipt`, `WorldReceiptTrust`, `WorldLedger`, `WorldLedgerOptions`, and `assertWorldData`, `assertWorldContract`, `assertWorldGenesis`, `worldSchema`. Public helper names are fixed; final exact fields are recorded in the freeze before runtime.

- [x] Write failing tests for closure, passive data, full scope/cursor, all action variants, semantic referential integrity, source/knowledge identity and cross-profile rejection.
- [x] Implement bounded schema/type/semantic validators, including standing/living distinctions and duplicate actor/item/generated-ID detection.
- [x] Run dedicated contract tests, typecheck and schema checks; commit immutable contract candidate.
- [x] Obtain independent adversarial contract review, repair defects, freeze hashes and integrate source ancestry. Runtime remains stopped until then.

## SW-200: pure authority and scoped projection

Create `packages/ledger/src/world/{rules.ts,view.ts}` and `TESTS/shared-world-{rules,views}.test.ts`.

Consumes the frozen types. Produces `initialWorldState(genesis): WorldState`, `resolveWorld(genesis,state,command,principal): WorldResolution`, `worldStateHash(state): string`, `viewWorldActor(genesis,state,query,principal): WorldActorView`. All arguments use the corresponding World types. No persistence, model calls or callbacks.

- [x] Write failing tests for social-first then physical actions, one clock/RNG, exact actor controller matching and duplicate NPC reply refusal.
- [x] Implement pure dispatch through `resolveMortalV3` using reconstructed internal metadata, extracting only its physical payload and elapsed world time.
- [x] Add durable speech/witness acquisition, owner impressions, activities, knowledge activation/revocation and monotone closure.
- [x] Add free-loan offer, withdrawal, exact acceptance and return. Test capacity/expiry/foreign acceptance and no relending or partial effects.
- [x] Add actor views with current/full-scope binding, bounded explicit memory coverage, own knowledge/opinions, shared scene and safe physical disclosure; test solo privacy and cutoff.
- [x] Verify source tests and deterministic prefix replay inputs; commit for integration and independent review.

## SW-300: journal and storage (after SW-200 integration)

Create `packages/ledger/src/world/{journal.ts,storage.ts,storage-worker.ts,index.ts}` and `TESTS/shared-world-{journal,storage}.test.ts`.

Consumes SW-200 pure functions. Produces `createWorldEvent(genesis,state,command,principal,privateKey)`, returning `{event,state,receipt}`; `verifyWorldEvent(genesis,state,event): WorldState`; `replayWorld(genesis,events): WorldState`; `verifyWorldReceipt(receipt,trust): void`; and `openWorldLedger(options: WorldLedgerOptions): Promise<WorldLedger>`.

- [x] Write failing signed identity, tamper, duplicate-request, restart, stale-writer and prefix-checkpoint tests.
- [x] Implement new signing domains and whole-history replay, preserving exact command/principal and complete genesis binding.
- [x] Implement separate SQLite table identity and atomic event/receipt/request insert in a worker. Cache publishes after commit and refreshes only unseen suffixes.
- [x] Test competing accepts/mechanical commands across two handles, failed append/no partial state, lost acknowledgment/retry, bounded pages/replies and event-loop responsiveness.
- [x] Verify journal/storage tests; commit for review. No public receipt or event exposes host-private state without a separate view policy.

## SW-400: scoped model adapter (after contract freeze)

Create `packages/interventions/src/world-{context,model}.ts` and `TESTS/shared-world-dialogue.test.ts`.

Produces `worldDialoguePacket(view,recordId)` and `createWorldModelAgent(options)` with `respond(query,recordId,requestId,call?): Promise<WorldCommand|null>`. Options include the fixed actor/full scope, authenticated refresh callback, injected clients/candidates and bounded model-client options. The adapter has no writer and emits only the new `speak` action.

- [x] Write failing injected-request tests proving selected policy/traits/received speech presence, no foreign secrets or duplicate shared definitions, and no templated response substitution.
- [x] Reuse existing model-client routing with explicit output limits, scoped cache identity and zero default live client.
- [x] Enforce addressed acquired inbound speech, standing/nonbusy state, one-response semantics, closed output shape and strict text limit.
- [x] Test cancellation and changed/revoked context before and after generation, including token-count delay; no stale release or tools.
- [x] Verify and commit adapter source for independent review.

## SW-500: fresh campaign seed (after contract freeze)

Create `scenarios/tempted-fates/shared-world/{seed.ts,SEED.md}` and `TESTS/shared-world-campaign.test.ts`. Produces `buildSharedWorldCampaign(pack,options): {genesis:WorldGenesis,manifest}`.

- [x] Test fresh seed source pins, identity collisions, selected owner knowledge, mortal-only roster and explicit day/night and starting-kit options.
- [x] Build new seed from the pinned campaign and v3 factory without modifying original pack bytes. Loan demo uses a safe player ID and no personal starting lamp.

## SW-510: session and CLI (after storage and seed integration)

Create `scenarios/tempted-fates/shared-world/{cli.ts,README.md}`, `packages/session/{package.json,src/index.ts}` and `TESTS/shared-world-session.test.ts`. Coordinator owns root workspace exports/lock and shared end-to-end acceptance.

Produces `createWorldSession({genesis,ledger,principal})`, a host capability with `query()`, `view(query)`, `prepare(action,requestId)` and `submit(command)`; the principal is bound once by authenticated host construction. The CLI uses those interfaces and explicit JSON actions; it does not parse prose into authority. Receipt verification binds the exact request and principal as well as the trusted key, genesis and scope.

- [x] Add the session host and trusted local JSON-line CLI with explicit initialization/resume, private local keys and refusal to overwrite a world.
- [x] Execute the full lamp conversation/offer/accept/travel/oil/return scenario using injected provider responses; retain actual requests/receipts and replay hash.
- [x] Test refusal, concurrent commands, private solo facts, closure and restart through public APIs; document exact run commands and host trust limits.

## SW-520: foundation gate budget after actual integrated timeout

The first immutable full gate at `83bc6c1` passed eight groups and then killed the expanded serial foundation suite at its 300000 ms cap. It emitted no assertion failure before termination, but did not complete. This is a failed acceptance result.

- [x] Retain the failed run and open an isolated Board ticket with ownership of `scripts/gate.mjs` and the budget rationale only.
- [ ] Independently review the minimal bounded 600000 ms foundation override; preserve every group/assertion/native completion check and all other resource/trust limits.
- [ ] Rerun the complete immutable application gate; no completion claim until it passes.

## Final acceptance and delivery

- [x] Integrate all exact source commits, exports and manifests; run contracts/typecheck/boundaries and relevant tests.
- [x] Obtain independent native reviews of authority/storage and context/host; fix and retest findings.
- [ ] Run all ten application groups and named assertions on an immutable candidate in read-only network isolation. The first full run at83bc6c1 timed out; SW-520 separately reviews a foundation-only bounded timer adjustment before rerun.
- [ ] Retain portable evidence and real Board states; push PR, require successful GitHub checks, merge under standing authorization and synchronize main.
