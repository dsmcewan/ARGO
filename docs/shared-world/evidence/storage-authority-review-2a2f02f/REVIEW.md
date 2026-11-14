# SW-300 independent authority/storage review

**READY for the reviewed SW-300 authority/storage scope.** No blocking or nonblocking authority defect was identified in exact candidate `2a2f02faf0c95e4095a8b5a43d022218cc15d0bc`, based on `521e826b9588a1293ed22c243a14b83924c275bd`. This is a scoped code-and-probe verdict; the coordinator retains final integration, application-gate and benchmark acceptance.

The source worktree `/workspace/ARGO/.board/shared-world-storage/worktrees/SW-300-1-054041f70a` was clean at the exact SHA before and after testing. The delta contains only six new owned journal/storage/index/test files; frozen shared contracts, previous mortal rules and other storage profiles are unchanged. `review.json` records immutable Git blob IDs, SHA-256 source hashes and evidence hashes. No checkout edits, delegated agents, paid/model calls or network operations were performed. Node worker threads are the implementation and test mechanism.

## Validation

- Authored journal/storage suite: **18/18 passed**, exit zero, `authored-tests.log`.
- External independent authority/storage probes: **10/10 passed**, exit zero, `probes.mts` and `probes.log`.
- Independent SQLite fault-stage control: passed, `commit-stage-control.mjs` and `.log`. It proves the chosen deferred foreign-key fault permits insertion and the AFTER INSERT trigger, fails specifically at COMMIT, and rolls back both inserted rows under the same foreign-key/trusted-schema settings.
- `git diff --check` passed. The entire six-file diff was inspected, including API exports, cryptographic domains, database initialization, transaction order, replay, request identity, close behavior and test mechanisms. No production fault option, environment flag, injected callback or alternate admission path was found.

Tests ran offline with Node v24.22.1 and `node --test --test-isolation=none`. The 91 adjacent tests, typecheck/contracts/boundary author results were read as handoff context; this reviewer independently reran the named 18-test suite and external probes rather than claiming to have rerun those additional gates.

## Authority and durability evidence

1. **Independent cryptographic oracle.** Event signatures verify only over the documented domain/body, event hashes bind the signed bytes, and receipt signatures independently verify over their separate domain. Request hashes cover complete command and principal. Full shared genesis identity includes profiles, scenes and authored policy; altered variants refuse. Receipts bind current event head/state and expose no effects. All seven receipt-scope mutations refuse.
2. **A valid signature cannot bless a false transition.** Independently re-signed witness, speech-text, state-hash, effect, RNG, principal, expected-time and causation mutations fail replay. The accepted original remains valid.
3. **Mixed signed prefixes.** Speech, offer, remote physical time and loan acceptance replay exactly at every prefix. Acceptance yields one custody transfer, one obligation and one shared timestamp. Mutating returned event/receipt DTOs cannot mutate the immutable authority state.
4. **Competing writers.** Acceptance raced against withdrawal through separate handles: exactly one command commits, the other conflicts, and both handles converge. The original offer request returns its identical historical receipt after policy revocation, closure and restart. Changed principal or command under the same ID conflicts.
5. **Identical writers.** Three simultaneous identical acceptances across two handles return identical receipts and create one acceptance event, one acquisition and one loan. Cold replay equals the resulting snapshot.
6. **Failure at COMMIT.** An external test-only deferred-FK trigger lets event insertion occur but causes COMMIT to fail. The worker returns unavailable; event and fault rows roll back; the exact parent snapshot identity, custody, open offer, absent obligation and request availability remain unchanged. Removing the fault allows the identical request to apply once, and restart returns the same receipt. This directly exercises cache publication after COMMIT at `storage-worker.ts:48`.
7. **Fully signed false database suffix.** A forged event with false derived effects was independently re-signed; its new event hash, request index, receipt cursor and receipt signature were all made consistent. Receipt verification succeeds, but warm suffix refresh and cold open both reject deterministic replay. Removing that injected row restores the original snapshot identity, and the identical legitimate request succeeds. Thus rejection is not merely a bad-signature or row-binding check.
8. **External checkpoints and honest rollback limits.** A genuine ancestor checkpoint opens a later prefix; wrong time/hash/sequence refuses. Deleting an acknowledged tail makes the live handle and a restart pinned to that tail refuse. An unanchored cold restart accepts the remaining valid prefix, explicitly matching the frozen trust limitation.
9. **Lost acknowledgment of compound acceptance.** An external `Worker.prototype.emit` test interception captures the committed signed acceptance receipt and terminates the worker before parent delivery. The caller sees unavailable. Reopen/retry returns that exact durable receipt with one transfer, obligation and acquisition. The hook is restored in `finally`; there are no source test hooks. This demonstrates post-COMMIT-before-parent-ack loss, not an unspecified power-loss boundary.
10. **Foreign database preservation.** Opening a legacy-profile SQLite file fails before changing its bytes or DELETE journal mode.

The authored suite additionally passed receipt/index tampering, multi-row suffix staging failure, passive input traps, queued caller detachment, warm immutable snapshot reuse, complete reply encoding bounds, 128-request admission limits and close draining with a responsive parent during SQLite lock waits. Complementary independent IPC/view/model-boundary review is recorded separately by the peer lane.

## Source reasoning

The journal signs complete body identity and recomputes sequence/time, draws, effects, memory and after-state hash rather than trusting signed derived fields. Stored rows bind event bytes, unique request identity and receipt. `BEGIN IMMEDIATE` precedes writer refresh and request lookup; exact duplicates return before new-action admission, preserving legitimate historical retries. New event, request and receipt occupy one row in one transaction. Reply capacity is checked before insertion and again before commit. The authoritative worker cache pointer is assigned only after successful COMMIT; failed suffix and failed write paths retain the old pointer.

Warm refresh deliberately verifies only unseen suffixes and checks that the known terminal head still exists. It does not rescan every previously verified byte on every snapshot. Historical pages/retries rebind returned rows to signed receipts, while cold open performs full deterministic replay. These behaviors match the frozen lifetime append-only trust model; they do not create external rollback assurance.

## Reproduction

```sh
ARGO_SW_ROOT=/path/to/exact/candidate node --test --test-isolation=none /workspace/reports/2026-11-14-argo-shared-world/storage-authority-review-2a2f02f/probes.mts
node /workspace/reports/2026-11-14-argo-shared-world/storage-authority-review-2a2f02f/commit-stage-control.mjs
```

The independent harness imports fixture constructors and exact candidate APIs through `world/index.ts`; assertions, races, corruption, cryptographic oracles and fault injection live outside the source checkout. Temporary databases and generated test keys are not committed or retained as source.

## Limits

No long-history latency or throughput verdict is inferred from these correctness runs. The coordinator owns the separate benchmark and full application gate. Power-loss/filesystem durability beyond SQLite's configured WAL/FULL behavior, arbitrary privileged editing of trusted live rows/schema, operational checkpoint custody, production key/transport authentication, deployment, provider quality and later package integration are not adjudicated here. There is no per-call cancellation guarantee after dispatch; unavailable can mean committed, as the explicit lost-ack probe demonstrates.
