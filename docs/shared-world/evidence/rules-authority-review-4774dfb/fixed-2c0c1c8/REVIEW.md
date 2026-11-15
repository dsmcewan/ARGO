# SW-200 fixed-candidate authority re-review

**READY for the SW-200 pure authority scope.** Exact candidate `2c0c1c8cc1f0aadedc7c94754ad917f9538b60a1` supersedes `4774dfb6d44145183f6c7760d032728aa6a84739`. No remaining authority blocker or regression was found. The original report and evidence remain unchanged in the parent directory.

The worktree was clean at the exact candidate before and after verification. The immutable delta contains only `packages/ledger/src/world/rules/engine.ts` and `TESTS/shared-world-rules.test.ts`; frozen contracts, schemas, types and previous mortal rules are unchanged. Source hashes and every author repair-handoff log hash matched independently.

At `engine.ts:200`, a custody action that would fulfill an open loan now requires the original lender to be standing. The guard runs after the mortal reducer produces its detached tentative result but before loan status, history or cache publication. Failure discards that local result. It covers the previously admitted ordinary transfer to an unconscious lender. Pickup/loot already require a standing acting lender, so this guard preserves their valid fulfillment paths. Transfers of items without an open loan and transfers of borrowed items to another holder retain their previous rules.

Verification on this exact commit:

- **11/11 unchanged independent authority probes passed**, including real post-offer capacity refusal/recovery, repeated custody cycles, cold/owned pure replay, immutable forks, combat recovery and final aggregate-limit loan refusal.
- **31/31 authored rules/views tests passed**, including the new unconscious-lender regression with standing positive control, direct-return refusal, unchanged input/digest/cursor/loan/offer/memory checks, successful reuse of the rejected request ID, and an unrelated item transfer to the unconscious actor that remains allowed without granting acquisition.
- The external probe SHA-256 remains `5b2ccea63f29def4efd61edbfa7ab0dbb05bc10fc92969a723adee104e3c98b6`, identical to the initial review artifact.

Evidence: `probes.log`, `authored-tests.log`, `delta.diff`, and `review.json`. Both test commands exited zero under Node v24.22.1 using `--test --test-isolation=none`. No source edits, agents, provider calls or network operations were performed. The broader 80-test/typecheck/contracts results are author evidence whose file hashes were checked; this re-review independently executed the 31-test rules/views suite and the 11 external probes.

The initial pure performance measurements were not rerun: the delta changes only fulfillment admission and does not affect their speech-history path. Those measurements remain explicitly attached to the original candidate. This READY verdict does not certify SW-300 signing, persistent retry, storage/concurrency/crash atomicity, verified-prefix membership, rollback anchoring, worker/RPC cancellation or event-loop responsiveness.
