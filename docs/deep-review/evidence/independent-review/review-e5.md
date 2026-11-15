# Independent review of v1 incremental verification repair

Verdict: **NOT READY at e5a6c55e6a2b53652a58c1e01d1068b05dfda8fc**. Two new regressions and one gap in the proposed within-handle rollback guarantee need correction. This verdict does not apply to later repairs.

Reviewed base: `0c24b32f947143c5b1095f702c878ed92888aa8d`. Reviewed head: `e5a6c55e6a2b53652a58c1e01d1068b05dfda8fc`. Exact requested diff: `packages/ledger/src/index.ts`, `packages/ledger/src/characters.ts`, `TESTS/ledger-cache.test.ts`, `TESTS/character-cache.test.ts`, and `docs/deep-review/PLAN.md`. Adjacent reducers, contract guards, existing authority/knowledge tests, and the new offline benchmark were also inspected. Repository AGENTS instructions and named context documents were read. Source was not mutated; probes and copies were written outside the checkout. No subagents or provider calls were used.

## Ranked findings

### IR-01 — P2: Acknowledged appends are excluded from the remembered prefix

Location: `packages/ledger/src/index.ts:121` (through the return at line 125); missing regression at `TESTS/ledger-cache.test.ts:54`.

`submit()` verifies, writes, fsyncs, and acknowledges an event but deliberately leaves the cache at the pre-append prefix. If storage then restores that immediately preceding prefix before any accessor reads the new event, the same still-open handle accepts the rollback. The new rollback test warms `snapshot()` after submitting, which conceals the gap.

Reproduction: open an empty ledger, retain its empty journal bytes, submit `advance_time` and receive sequence 1, restore the retained empty journal, then call the same handle's `snapshot()`. The probe reports `{acknowledged_sequence:1, accepted:true, sequence:0}`. The same sequence applies to restoring a pre-revocation history after acknowledging a revoke. A post-append derived-snapshot error also leaves this hole after a durable append.

This behavior also exists in the base, so it is not an introduced regression. It prevents claiming that this repair detects all rollback within the lifetime of an open handle: a returned signed outcome is already an observation. Publish the verified appended bytes/state/indexes immediately after successful durable append, before the disposable snapshot write, and add rollback tests with no intervening accessor. At the character layer, an injected Ledger can likewise acknowledge a successful character submit while returning the old events prefix, which the character cache currently accepts. The additional immutable probe confirms receipt sequence 1 followed by projection sequence 0. A remembered acknowledged cursor/head can enforce the same guarantee for that supported structural boundary.

### IR-02 — P2: UTF-8 BOM at a new suffix boundary is accepted only by warmed handles

Location: `packages/ledger/src/index.ts:53`; decoder at line 15.

The full-file reader used `TextDecoder` once at the start of the journal. The new reader starts a fresh decoder for every suffix. Its default BOM handling strips a UTF-8 BOM at any newly observed suffix boundary, admitting bytes that a fresh full-file read rejects. The signed event itself remains valid; the regression is in the canonical persisted-byte acceptance rule and warm/cold consistency.

Reproduction: warm a handle at one event; append a second valid signed event through another handle; insert bytes `EF BB BF` immediately before the second event; read through the first handle. Warm `snapshot()` succeeds at sequence 2. Fresh `openLedger()` on the identical bytes throws `CORRUPT_LEDGER: Corrupt ledger JSON`. The base rejects this file both warm and cold. This can turn an accepted running ledger into one that refuses restart.

Preserve BOM bytes when decoding a nonzero-offset suffix, or reject an interior BOM explicitly, without silently changing legacy offset-zero behavior. Add a warm/cold acceptance parity regression that uses a nonempty prefix and a valid signed suffix.

### IR-03 — P2: Serialized load queues delay even already-cancelled requests behind unrelated host I/O

Location: `packages/ledger/src/characters.ts:214`–218.

The first cancellation check moved inside `loading.then(...)`. An already-aborted `readProjection()` now waits for every earlier pending event capture before rejecting. An injected Ledger whose `events()` stalls therefore prevents even a pre-cancelled independent call from settling; the previous implementation rejected it immediately. This also affects `submit()` before it reaches admission, and cancellation after queue admission cannot interrupt that wait.

Reproduction: make the first injected `events()` return a deferred promise, start a read, then call `readProjection({signal: AbortSignal.abort()})`. The probe observes that the second call has not settled before releasing the first promise; afterward it rejects with `CANCELLED`. On the base, the second call settles with `CANCELLED` before the release. Existing cache cancellation coverage only tests an idle queue.

Check pre-abort before joining the queue and make the caller's queued wait abortable while retaining serialization of actual capture/replay. Test both an already-aborted queued call and a signal aborted while queued; release the source afterward and ensure cancellation neither publishes nor corrupts state.

## Strengths

- Every normal warmed ledger read still loads the complete journal bytes under the existing writer lock and compares the full previously verified prefix. Same-size edits and restored mtimes cannot evade the comparison.
- Genesis remains checked on every accessor and submission. `snapshot.json` remains disposable and supplies no authority.
- Every new suffix event still passes the existing schema, signature/hash, causal-parent, order, rules, RNG, and duplicate-proposal checks. Standalone replay remains a cold verifier.
- Ledger cache publication is staged until the whole suffix succeeds. Character extension clones mutable projection, state, receipts, and indexes before applying a suffix. Failed later events therefore do not poison prior cache state.
- Character event capture itself is serialized, preventing a delayed old response from being published after a newer prefix. Retained results and suspended witness adjudications retain independent state.
- Public projections and receipt DTOs remain detached/frozen; ledger snapshots/events remain detached. Existing hidden-roll, consent-detail, actor-acquisition, party-disclosure, historical-nature, and cutoff tests pass.
- The new benchmark injects its scripted provider response through `clientFor`; the inspected path does not call a live model provider.

## Execution evidence

Environment: Node `v24.22.1`; all probes offline.

`node --test --test-isolation=none TESTS/ledger-cache.test.ts TESTS/character-cache.test.ts TESTS/ledger.test.ts TESTS/character-authority.test.ts TESTS/character-knowledge.test.ts`

Result: **55 passed, 0 failed**, including new cache tests and existing witness freshness, concurrent retry, source validation, hidden-state and disclosure cases. Log: `targeted-tests.log`.

Independent adversarial probe source: `probes.mts`. It accepts a checkout path. Results from exact source archives: `probes-e5-immutable.jsonl` and `probes-base-immutable.jsonl`. The archive copies live under `/tmp/argo-independent-review-e5` and `/tmp/argo-independent-review-base`; source package files came from `git archive` at the named identities, with the installed dependency tree linked from the review checkout. Contracts/dependencies were unchanged by the reviewed diff. `probes-e5.jsonl` records the initial execution before any working-tree source modification.

Additional independent probes: `additional-probes.mts`, with output `additional-probes-e5-immutable.jsonl`. These confirm the character acknowledgment gap, rejection/recovery after mutation of an injected event object retained by the source, and atomic failure when a valid signed character carrier with an invalid profile revision follows a valid state-mutating suffix. The latter two probes pass.

## Declined to judge

- The unseen original eighteen findings; only the supplied review summary and this exact repair were available.
- Cross-restart/operator rollback assurance, authenticated standalone genesis, existing v1 map identifier limitations, and fully bound remote receipts. Those remain separately documented design decisions.
- The root agent's complete immutable controller gate; this peer ran targeted native tests only and does not substitute its verdict for that gate.
- Live model behavior, paid inference, deployment, real service authorization, production workload latency, or statistically representative performance. None was exercised.
- Arbitrary malicious code execution in the same JavaScript process, hostile platform builtins, or unsupported filesystem actors ignoring the writer-lock protocol. The injected-Ledger probes test the expressly supplied boundary and ordinary delayed promises, not a claim of process isolation.
