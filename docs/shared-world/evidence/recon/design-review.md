# Independent shared-world builder/adversarial design review

**READY FOR CONTRACT DRAFTING.** No unresolved architectural blocker remains. This recommendation covers design intent and implementability; it does not attest concrete schemas, frozen API signatures, runtime implementation, application acceptance or deployment.

Final inspected delivery: `f65849c96448baf2cd4a0669ffd041981c3a08ec`. The design incorporates the five resolutions in `41e3458`, custody lifecycle in `3775f5b`, and restrictive compound disclosure in `76d819f`. `docs/shared-world/DESIGN.md` SHA256: `b389ab539846bd54f4cca52b2fc8e20017538991dac3143516f014849b625fdb`. Baseline: `3fd1e4d99eede6853f62b8078e5921183a9f048c`.

Read both `character-recon.md` and `storage-recon.md`, and relevant existing mortal reducer/campaign initialization, knowledge bindings, character authority, actor/narrator projection and NPC eligibility code. No source edits, subagents, paid/provider calls or runtime tests were performed. The separate contract seed/plan are not independently accepted by this design review.

## Architecture assessment

The fresh successor is the appropriate boundary. One immutable actor/controller namespace, global cursor, physical payload, RNG order, compound event and transactional request index avoid an unsound two-store handoff. Reusing only the pure mortal reducer preserves physical admission without inventing an inner signed journal. The sequence-zero inner-head exception is explicit; speech-first/mechanics-first interleavings remain testable without changing frozen v3 history.

The loan kernel has a coherent consent boundary. Authored policy is not authorization; an authenticated lender posts exact durable terms, and the named borrower accepts that offer. Custody and promise commit together. Model text is never interpreted as acceptance. Standing, custody, capacity, location and encounter checks apply at the accepting prefix. Loan rights survive third-party custody and close when the original lender regains custody. Existing worlds, Fate/donor-time authority and migration remain outside the new writer.

Operational limits remain honest: full cold replay, append-only trust for previously verified SQLite rows, external ancestor checkpoints, ambiguous post-dispatch failure and exact-request reconciliation, bounded state/context, no automatic agents, and no implicit paid clients. These choices match the baseline and reconnaissance.

## Findings raised and resolved

The initial draft required five contract decisions. The coordinator resolved them before contract drafting, then added the custody and compound-disclosure refinements.

| ID / original priority | Concrete failure to prevent | Final resolution |
| --- | --- | --- |
| D1 / high: memory visibility | Generic room witnesses could acquire private impressions, knowledge grants or loan terms; live loan tables could reveal remote withdrawal/return. | `DESIGN.md:46` defines recipients/payloads per action; `:60` excludes global offer/loan tables from actor views. `:62` gives restrictive fulfillment policy precedence over general room witnesses for compound custody actions. |
| D2 / high: acceptance authority | Mortal transfer requires the current holder's principal. The borrower's principal cannot transfer the lender's item; an arbitrary substituted principal would grant excessive authority. | `DESIGN.md:64` retains the borrower as outer principal and internally derives only the exact persisted-offer lender-to-borrower transfer. Current physical checks still apply. |
| D3 / medium: reply binding | An optional merely-visible inbound ID permits omitted references, repeated replies or treating overheard activity as a direct summons. | `DESIGN.md:50` separates addressees from witnesses; `:60` requires acquired explicitly addressed speech and atomically consumes the NPC/inbound pair. Proactive NPC speech is deferred. |
| D4 / high: circular provenance | Genesis-contained activations carrying the shared genesis hash would be self-referential. After-state memories containing their enclosing event hash would make event and state hashes depend on each other. | `DESIGN.md:66` defines pre-sign record IDs, genesis-origin entry IDs/sequence zero, sequence/time acquisitions and no enclosing-event hash in after-state fields. Outer event provenance supplies the signed binding. |
| D5 / medium: old-prefix bypass | Public callers could request an old valid state/query after closure or revocation and bypass present boundaries. | `DESIGN.md:70` restricts historical projection to host forensics. Player/NPC/session reads and model refresh require the latest prefix. |
| D6 / lifecycle refinement | A lender recovering a dropped item with pickup or a deceased borrower's item with loot could regain custody while a stale live loan permanently blocks re-offering it. | `DESIGN.md:40` reconciles every custody-changing action. Original-lender custody fulfills the loan; return location is a promised checkpoint, allowing earlier hand-back elsewhere without automatic penalties. |

These are resolved prose requirements, not claims that runtime regressions already pass.

## Concrete contract review requirements

Routine encodings can be selected within the approved scope, but must be explicit before freeze and parallel runtime work:

- Freeze shared-to-inner mortal command/principal/cursor mapping, including initial inner genesis, first mechanics after speech, and encounter tokens after nonphysical events. A loan uses one inner mechanical transition and one outer sequence.
- Close the offer shape/hash domain; bind lender, borrower, item, terms, expiry and authorization. Specify expiry equality, deterministic expired-offer treatment, withdrawal and at-most-one-live-offer/loan semantics. No implied fees or enforcement arise from dialogue or crossing a checkpoint.
- Use closed memory variants, stable pre-sign IDs, immutable acquisition sequence/time and exact catalog ownership/source bindings. Keep foreign acquisition lists and privileged command/effect fields out of actor DTOs. Do not cast new WorldQuery into old CharacterActorQuery. Impression evidence must be acquired, relevant to its subject and bound to the nature used.
- Specify concrete state/text/record/impression/offer/context limits. Reject overflow atomically without silently deleting history. Preserve exact retry precedence and complete authenticated request identity. Define pre-dispatch cancellation versus potentially committed post-dispatch failure unless a real worker-visible cancellation protocol is implemented.
- Freeze separate request/event/receipt domains, receipt fields, expected-request verification and host-only snapshots/events. Narration uses scoped projections, not receipt effects. Schema validity does not establish caller authentication or real-world perception.

## Required adversarial runtime evidence later

1. Interleave speech, knowledge, mechanics and recovery; verify the sole shared cursor/RNG/time and cold replay at every prefix, including first mechanics after speech.
2. Reject capacity, encounter, expiry, ownership and final epistemic-validation failures with no partial custody, obligation, memory, request index, time or RNG changes. Race distinct accepts and exact retries across handles/restart.
3. Re-sign deliberately wrong recipients, acquisitions, fulfillment, effects or state hashes with test keys; deterministic replay must still reject them.
4. Probe private actions beside unrelated standing actors, remote withdrawal/return, unconscious/dead recipients, room witnesses versus addressees, omitted/repeated NPC reply references, and mortal custody actions that also fulfill private loans.
5. Close or revoke while generation is pending; latest-prefix refresh suppresses output. Old public queries cannot reopen the boundary; forensic reads remain privileged.
6. Borrow, pass to a third party, drop, loot and regain custody through every path. Only original-lender custody fulfills the loan; no automatic repair charge or remote knowledge is created. Test refusal and early return separately from consent.
7. Verify responsive workers, real pre/post-COMMIT loss, draining close, full reopen verification, foreign-file refusal, external checkpoint ancestry, passive DTOs and detached responses. Full immutable application acceptance remains a later coordinator check.

The design is sufficiently specific to draft and independently review the new contract. Runtime lanes should still wait for concrete schema/type/guard/API review and freeze.
