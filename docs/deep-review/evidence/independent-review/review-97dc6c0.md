# Independent repair re-review: 97dc6c0

Candidate: `97dc6c0726f323d25f1fba9f6a3295ea17aa99d9`. Base review: `review-e5.md`.

All three original findings are fixed. One additional, narrower durability-stage gap was found and reported to the root before completing this candidate review.

## Verified original repairs

- **IR-01:** A successful native ledger append is now retained before the derived snapshot write. The exact no-intervening-read rollback probe rejects with `CORRUPT_LEDGER`. New tests also prove durable appends remain remembered after a failed derived snapshot write. Character authority now checks a monotonic acknowledged sequence/hash against verified history, including in-flight old reads and out-of-order responses; the structural-source rollback probe rejects, then recovers on the real history.
- **IR-02:** Interior BOM bytes are preserved when decoding a nonzero-offset suffix. Both warmed and cold readers now reject the same adversarial bytes. Legacy offset-zero decoding remains unchanged.
- **IR-03:** Pre-cancelled calls reject before queue admission. Queued waits race abort while the underlying capture remains serialized. Tests cover both pre-abort and abort while queued; cancelled work does not later invoke the source.

The character guard uses detached primitive acknowledgment data and a private verified-head array. Public output shape is unchanged. The check after the await also covers a commit acknowledged between event capture and public result publication. Cache extension still clones prior state before mutation, and failed acknowledgment checks occur before new cache publication.

## Additional finding IR-04 — P2: successful fsync followed by close failure skips publication

Location: `packages/ledger/src/index.ts:123`.

Cache publication occurs after the `try/finally` that closes the journal. A file close error following a successful append and fsync prevents that publication, despite the handle already knowing that the verified append was durably written. Restoring the earlier prefix then succeeds on the same handle. This is a narrower version of the durable-append/snapshot-failure gap just repaired; there is no acknowledged-success regression here because submit rejects.

Reproduction: inject a FileHandle wrapper that performs the real `writeFile`, real successful `sync`, and real `close`, then throws an `EIO` from close. Submit rejects. The journal contains 1168 bytes for event 1. Restore its earlier empty prefix. The still-open handle's snapshot succeeds at sequence 0. Probe: `close-failure-probe.mts`; output: `close-failure-final-97dc6c0.jsonl`.

Publish the already verified bytes/state/indexes immediately after successful `sync`, inside the try and before the finally-close. The close error can still propagate, but must not erase knowledge of the durable append. Keep partial-write or failed-sync behavior fail-closed and do not publish an unverified suffix.

## Evidence

Exact changed package and test source was extracted with `git archive` at the candidate identity into `/tmp/argo-independent-review-final-97dc6c0`. Installed dependencies and unchanged contract/bridge packages were linked from the review checkout.

- `probes-final-97dc6c0.jsonl`: original native rollback, BOM, and pre-aborted queue probes now show the expected rejection/parity/prompt cancellation.
- `additional-probes-final-97dc6c0.jsonl`: structural character acknowledgment rollback is rejected and recovery works; mutable injected event objects remain detached/detected; a valid signed but invalid carrier following a valid mutating suffix is rejected atomically.
- `targeted-tests-final-97dc6c0-complete.log`: **63 passed, 0 failed**, using `node --test --test-isolation=none` for cache, ledger, authority, and character knowledge suites.
- `targeted-tests-final-97dc6c0.log`: initial temporary archive setup omitted the unchanged telos bridge, causing one missing-factory assertion. Adding that unchanged package link to the temporary copy resolved the harness setup problem. No candidate source changed between the failed setup run and the complete 63-pass run.

This peer did not run the full controller gate or performance benchmark. Those remain the root's separately recorded checks. The declined-to-judge list and v1 trust limits in `review-e5.md` continue to apply. No source edits, subagents, or model-provider calls were performed.
