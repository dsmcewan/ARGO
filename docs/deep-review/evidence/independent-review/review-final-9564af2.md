# Final independent review: READY

**Verdict: READY from this independent review at `9564af23fc52ff934c8ac39dd0777dc7c683120a`. No unresolved findings remain in the reviewed repair.** The root's full immutable gate remains a separate acceptance requirement; this report does not claim to have executed it.

Original base: `0c24b32f947143c5b1095f702c878ed92888aa8d`. Initial reviewed candidate: `e5a6c55e6a2b53652a58c1e01d1068b05dfda8fc`. Intermediate review: `97dc6c0726f323d25f1fba9f6a3295ea17aa99d9`. Earlier reports and failing evidence remain intact in this directory.

## Findings closed

| Finding | Final behavior and independent evidence |
| --- | --- |
| IR-01: acknowledged/durable append rollback gap | Native submit remembers the verified journal bytes/state/indexes after successful fsync. The same-handle no-intervening-read rollback probe now rejects. Character authority retains the greatest acknowledged sequence/hash, rejects missing or divergent history, preserves the maximum across out-of-order responses, and checks in-flight reads before publication. The structural-source probe rejects rollback and recovers when the actual history is restored. |
| IR-02: interior BOM accepted only by warm readers | Nonzero-offset suffix decoding preserves BOM bytes. The same corrupted persisted bytes now produce `CORRUPT_LEDGER` for both warm and cold reads; offset-zero behavior is preserved. |
| IR-03: queued cancellation waits for unrelated source I/O | Pre-aborted reads reject immediately; abort while queued rejects the caller promptly while preserving actual source/replay serialization. Cancelled queued tasks do not later invoke events. |
| IR-04: close failure after fsync skips cache publication | Final diff moves publication inside the append try, immediately after successful sync and before finally-close. The independent injected post-fsync close-EIO probe now reports rollback rejected with `CORRUPT_LEDGER`. The close error still propagates, and failed writes/syncs do not publish prematurely. |

The final correction changes only `packages/ledger/src/index.ts` and `TESTS/ledger-cache.test.ts` relative to 97dc6c0. Its narrow ordering change closes the reproduced failure without altering validation, signing, locking, snapshot authority, or public DTOs.

## Verification

All final source/probes executed offline on Node `v24.22.1`. Exact changed package and test source was extracted with `git archive` at the final candidate into `/tmp/argo-independent-review-final-9564af2`; installed dependencies and unchanged contract/bridge packages were linked from the review checkout.

**64 targeted tests passed; 0 failed, cancelled, or skipped.** Command:

```sh
node --test --test-isolation=none TESTS/ledger-cache.test.ts TESTS/character-cache.test.ts TESTS/ledger.test.ts TESTS/character-authority.test.ts TESTS/character-knowledge.test.ts
```

Final log: `targeted-tests-final-9564af2.log`. This includes all 24 cache tests, plus existing ledger, witness freshness, concurrent retry, character authority, hidden-state, actor/party knowledge, and cutoff coverage.

All seven independent probe cases returned the expected final behavior:

- `close-failure-final-9564af2.jsonl`: actual fsync succeeds, injected close EIO propagates, later rollback is rejected.
- `probes-final-9564af2.jsonl`: acknowledged rollback rejected; warm/cold interior-BOM parity restored; pre-aborted queued call settles before the held source is released.
- `additional-probes-final-9564af2.jsonl`: character acknowledgment rollback rejected with recovery; retained injected objects cannot rewrite prior output or evade the next prefix check; a valid signed but invalid character carrier after a valid mutating suffix fails atomically.

Probe sources are `close-failure-probe.mts`, `probes.mts`, and `additional-probes-final.mts`, each accepting a checkout path. The same probes' earlier failing outputs are retained for comparison.

`git diff --exit-code 0c24b32f947143c5b1095f702c878ed92888aa8d 9564af23fc52ff934c8ac39dd0777dc7c683120a -- SYSTEMS packages/contracts` returned 0: frozen schema/contract source is unchanged.

## Preserved strengths and limits

The repair still checks the full persisted byte prefix and genesis under the writer lock, verifies every new event's signatures/rules/RNG/causality, ignores snapshot files as authority, stages failing suffixes without partial cache publication, serializes character captures, and returns detached results. Cold replay remains independent. New private cache metadata does not appear in public projections. No additional character acknowledgment or abort-race defect was found.

This review does not certify unseen original findings, production workloads or deployment, live model behavior, paid inference, cross-restart/operator rollback resistance, standalone genesis authentication, the deferred v1 map identifier/receipt design decisions, or arbitrary hostile code running in the same process. The full controller gate and benchmark results are the root's separately recorded checks. The inspected new benchmark uses an injected scripted provider.

No source mutation, subagent delegation, provider call, deployment, or external message was performed by this review peer. Reports, probes, and temporary source archives were written outside the source checkout.
