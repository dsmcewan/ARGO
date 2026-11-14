# Independent observation runtime review

**Candidate:** `ba72fe06fef3ebf5a4c14c942a5a1c35d4f116c9`  
**Observation implementation ancestor:** `67e156c6a6d7925c2fdcb30fe63665b2bb9095d7`  
**Reviewed worktree:** `/workspace/ARGO/.worktrees/successor-review-runtime`

**Verdict:** no Critical or Important observation-admission/cache defect was established. One reproducible **Minor** cancellation-contract mismatch remains. The expanded independent probe suite is therefore not fully passing. Correct the narrow retry-return check before claiming complete conformity with the frozen cancellation contract.

The review covered the immutable candidate's observation ingress, transient authorization helper, corresponding pure contract, and the existing verified-prefix cache/replay paths. Other successor runtime lanes were excluded. Git HEAD and tracked cleanliness were checked before and after the probes; the checkout was not edited. No provider calls, delegated agents, or production services were used.

## Minor: cancellation during the second durable read is ignored for an exact retry

**Location:** `packages/ledger/src/index.ts:102`–`:106`.

After the second lock is acquired, `readChecked()` awaits journal I/O. If the caller aborts during that read and another handle has committed the identical proposal, the `prior` branch returns the recorded receipt immediately, without another signal check. The ordinary new-append path checks cancellation later, so the gap affects the exact-retry branch.

Reproduction in `review.test.mjs`, test **“cancellation during the second durable read is checked before returning an exact concurrent retry”**:

1. Handle A submits an outward observation and waits for its host callback.
2. Handle B commits the same immutable proposal with the same authenticated identity.
3. A's callback returns its valid grant.
4. Abort A's signal while A reads `events.jsonl` after reacquiring the writer lock.
5. A resolves successfully with B's receipt, despite its signal already being aborted. The probe expects `CANCELLED` and fails.

The frozen CONTRACT's runtime stage 6 explicitly says: **“An already-cancelled call still fails closed according to normal call cancellation behavior; it may have committed concurrently and must be reconciled by retry.”** A signal check immediately after the durable read and before returning the prior receipt would close this gap while preserving exact-retry precedence over new admission policy.

**Impact:** the caller receives a successful acknowledgment after cancellation rather than the specified cancellation result. The probe does not demonstrate an unauthorized append, duplicate append, state mutation, foreign receipt, or cache corruption; B's authorized event is the only committed observation. This limited effect is why the finding is Minor.

## Independent evidence

| Suite | Result | Log |
| --- | --- | --- |
| Portable independent probes, expanded | 11 passed, 1 failed as described above | `ba72fe0-expanded.log` |
| Candidate observation contract/runtime tests | 24 passed | `ba72fe0-admission.log` |
| Candidate ledger cache regressions | 12 passed | `ba72fe0-ledger-cache.log` |
| Candidate character cache regressions | 12 passed | `ba72fe0-character-cache.log` |

The earlier prepared probe run passed 10/10; its log is retained as `ba72fe0-independent.log`. The expanded run supersedes that total rather than adding ten distinct tests. Tests ran directly under Node 24.22.1. The outer sandbox reported a Git child-bookkeeping `EPERM` even though the read-only Git child returned status zero and complete output; the harness accepts only that explicit successful child result and otherwise fails. Actual HEAD/cleanliness checks also passed through the shell tool independently.

The independent checks established:

- Callback-free admission stays direct, self-only and private, including after reopening.
- A slow host holds no writer lock. Another handle can read and commit; a now-stale grant cannot deliver its claim.
- Cancellation while the host ignores its signal rejects and prevents its later reply from appending.
- An exact concurrent duplicate reconciles against another handle's committed event before stale-cursor checks, even after a subsequent clock event and warm-cache reads.
- A historical signed observation with a spoofed source and **66** recipients retries under the original authenticated identity without applying the new source/recipient policy; altered identity/proposal retries fail.
- A willing host cannot override direct-source identity or a valid legacy proxy grant for a new observation.
- Callback request/snapshot data is deeply frozen, caller mutations cannot rewrite the retained proposal, and returned grants are detached before waiting on the second lock.
- Preflight delay, verifier delay and relocking share the original five-second window. Expiration during relocking cannot create a new allowance.
- An observation durably appended before derived-snapshot failure remains protected by the verified-prefix cache. Retry returns the original receipt without witness work; prefix truncation remains rejected.

The code review also confirmed that the new authorization helper executes after the first `locked()` operation has completed its `finally` cleanup; the helper creates a detached frozen snapshot and request; grants remain transient and are not inserted into signed events/receipts; and the original `readChecked`/prefix verification and post-sync cache update logic remains intact. A final signal/lifetime check after awaiting the journal open protects the new append boundary.

## Identities and reproduction

`ba72fe0-manifest.json` records SHA-256 hashes for the reviewed runtime/helper/contract/test files, probe source and all logs. Principal runtime hashes:

- `packages/ledger/src/index.ts`: `bf8f1585f86688fb1da2f5961e1bb8a3d0c98cfc5348d29e9fe47a40dc6c6c43`
- `packages/ledger/src/observation-admission.ts`: `aa7399a9b04a7881b9264270db6925660d30c2826374bee2fb09d1ba0981221f`
- `packages/ledger/src/mechanics.ts`: `b609add08bf42b34cf88cef436cf6c47295aac874b5e3e35291d2b8fe79b6a3c`
- `packages/contracts/src/observation-admission.ts`: `066ea4e430acfd9aeb7ac9f578a860aa6b47db4aa5eed7815d29cfe573c3cb02`

```sh
ARGO_REVIEW_ROOT=/workspace/ARGO/.worktrees/successor-review-runtime \
ARGO_REVIEW_SHA=ba72fe06fef3ebf5a4c14c942a5a1c35d4f116c9 \
node /workspace/reports/2026-11-14-argo-followup/runtime-observation-review/review.test.mjs
```

The full immutable application gate remains the coordinator's responsibility. This review does not certify a live perception service, authenticity of the host verifier, persisted witness evidence, quarantine of old claims, dynamic revocation at an unchanged ledger head, storage-operator rollback protection, or unrelated prior audit repairs. Those limitations remain explicit in the frozen contract rather than being silently reinterpreted.
