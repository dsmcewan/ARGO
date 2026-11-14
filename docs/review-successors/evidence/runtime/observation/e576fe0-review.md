# Final independent observation runtime review

**Verdict: no remaining scoped findings.** The Minor cancellation mismatch reported for `ba72fe06fef3ebf5a4c14c942a5a1c35d4f116c9` is fixed and independently reproduced as passing. This is a review of observation admission and related ledger/character cache behavior, not approval of unrelated successor lanes or a substitute for the coordinator's full immutable gate.

Reviewed immutable candidate: **`e576fe0ad1c57ea71ec1aad2a48f0f7ed400ead1`** at `/workspace/ARGO/.worktrees/successor-review-final`.

- Original observation runtime source: `67e156c6a6d7925c2fdcb30fe63665b2bb9095d7`.
- Cancellation fix source: `4bb2a8a287e296b82c5c2429fceed890281a4e7f`.
- Prior scoped review: `ba72fe0-review.md`, retained unchanged alongside this record.

## Fix verification

The complete candidate diff from the prior review contains only the immediate post-`readChecked()` signal check in `packages/ledger/src/index.ts` and its observation regression test. The signal check occurs before exact-retry lookup/return. It prevents a cancellation that arrives during durable history reading from being ignored, while preserving retry precedence over new author/grant policy for noncancelled calls.

The previously failing independent scenario now rejects with `CANCELLED`: handle A waits for a witness, handle B commits the same proposal, and A is aborted during its second journal read. The committed event remains available for an ordinary authenticated retry. The candidate's new regression additionally checks that retry returns the original receipt without another callback.

No checkout files, index, or refs were edited during review. Git HEAD and tracked cleanliness passed before and after verification. All tests used local signed fixtures and injected callbacks; no paid/provider calls or nested agents were used.

## Fresh verification on the fixed candidate

| Suite | Result | Evidence |
| --- | --- | --- |
| Expanded independent probes | **12/12 passed** | `e576fe0-independent.log` |
| Candidate observation contract/runtime suite | **25/25 passed** | `e576fe0-admission.log` |
| Candidate ledger cache suite | **12/12 passed** | `e576fe0-ledger-cache.log` |
| Candidate character cache suite | **12/12 passed** | `e576fe0-character-cache.log` |

All **61** tests passed directly under Node 24.22.1. The independent suite retained the same probe-source hash as the failing prior-candidate run: `5c9f0e8f040ab87217ca535a35c7b2561ea6edd24c42880bc4ab08bab66baa21`.

These checks cover default self-private admission, source/proxy refusal, slow lock-free callbacks, changed prefixes, exact concurrent and historical retries, original operation deadlines, noncooperative callback cancellation, caller/grant/snapshot isolation, and durable-append/cache recovery. The final check adds no authority data or persisted witness metadata; the reviewed transient-grant/replay distinction remains intact.

## Source and evidence identities

`e576fe0-manifest.json` records the full candidate/source identities and SHA-256 values for all reviewed files, logs, and the portable probes. Key source hashes:

| File | SHA-256 |
| --- | --- |
| `packages/ledger/src/index.ts` | `eb55ff82e683ec04df9341a66b51c21c742d93a24b31aafbe4d6ded61748fe95` |
| `packages/ledger/src/observation-admission.ts` | `aa7399a9b04a7881b9264270db6925660d30c2826374bee2fb09d1ba0981221f` |
| `packages/ledger/src/mechanics.ts` | `b609add08bf42b34cf88cef436cf6c47295aac874b5e3e35291d2b8fe79b6a3c` |
| `packages/contracts/src/observation-admission.ts` | `066ea4e430acfd9aeb7ac9f578a860aa6b47db4aa5eed7815d29cfe573c3cb02` |
| `TESTS/observation-admission.test.ts` | `0aa6f0af4a7bc92458cc59a0c4e49954447b8c9bb6c5b5ece8dbae08504dafb8` |

Reproduce the independent checks with:

```sh
ARGO_REVIEW_ROOT=/workspace/ARGO/.worktrees/successor-review-final \
ARGO_REVIEW_SHA=e576fe0ad1c57ea71ec1aad2a48f0f7ed400ead1 \
node /workspace/reports/2026-11-14-argo-followup/runtime-observation-review/review.test.mjs
```

The coordinator is independently repeating the complete application gate on this fixed candidate. This scoped review makes no claim about live host authenticity/perception, persisted witness evidence, legacy-claim quarantine, same-head host-policy revocation, storage-operator rollback assurance, or unrelated prior audit findings; the contract's stated limits remain applicable.
