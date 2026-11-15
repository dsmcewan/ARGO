# V1 journal and character replay repair

The repair removes repeated signature/rule verification and full reduction of unchanged history from both `openLedger` and `createCharacterAuthority`. It addresses finding 1 of the owner-supplied review of `0c24b32`. The other three supplied high findings remain open in [FOLLOWUPS.md](FOLLOWUPS.md). ARGO remains a library foundation; this change does not create a shared playable world or validate a live model.

Implementation candidate: `9564af23fc52ff934c8ac39dd0777dc7c683120a`. All ten immutable offline application gate groups passed (265 seconds). The exact acceptance result, source-to-integration mapping and file identities are in [verification.json](verification.json).

## Behavior and integrity

Each ledger handle retains a verified byte prefix, snapshot and indexes. Every call still reads the complete journal under the existing writer lock, compares the entire known prefix, and checks immutable genesis. Only appended records undergo signature/rule verification and reduction. A durable local append enters the remembered prefix immediately after fsync, before file close or snapshot writing can fail. `snapshot.json` remains disposable.

Each character authority retains an independently verified projection prefix. It compares canonical event bytes, stages appended carriers on detached state and serializes event capture. Interrupted callers cancel promptly; failed suffixes cannot publish partial state. Acknowledged character commits remain a minimum required prefix even with an injected ledger source. Returned DTOs remain detached; witness freshness, scoped knowledge, retries and cutoffs are preserved.

Within a surviving handle, removal or replacement of an observed/acknowledged prefix now fails closed. **This is not cross-restart rollback assurance:** a separately trusted monotonic checkpoint is still required for that. Frozen SYSTEMS/MECHANICS/contracts, storage format, action permissions and the legacy observation policy are unchanged. An extra blank record at the file tail is now rejected; ordinary writer output has exactly one newline per record. BOM handling is consistent between warm and cold readers.

## Offline measurements

Same machine and Node 24.22.1, synthetic signed character carrier history, instant scripted provider. Single measurements under shared CI/review load; these are not percentile claims or live latency guarantees. Fixture construction is excluded. The baseline ran the unmodified `0c24b32` runtime; final rows ran `9564af2`.

| Events | Before: scripted dialogue | After: scripted dialogue | Warm submit: before → after |
| --- | --- | --- | --- |
| 128 | 3.63 s (speech) | 0.19 s | 0.43 s → 0.026 s |
| 512 | 13.28 s (Service transport unavailable) | 0.50 s | 4.89 s → 0.097 s |
| 1000 | 21.50 s (Service deadline exceeded; a submitted mutation may have committed) | 0.65 s | 22.01 s → 0.068 s |

At 1,000 events the final cold ledger open still took **19.0 seconds**, and first character projection took **17.3 seconds**. Warm snapshot was 24 ms; warm projection was 105 ms. Full-file reads, DTO copies, retained history and growing state remain linear costs. Cold replay can still be quadratic and blocks the Node event loop. A host should load the ledger and call `await authority.readProjection()` during startup before admitting timed dialogue requests. This patch is not a worker-thread or paged-storage migration.

The initial baseline and preliminary patched run attempted a 2,000-event row; both were stopped after completing 128/512/1,000 while review corrections were integrated. No 2,000-event result or extrapolation is claimed. `benchmark-before.jsonl`, `benchmark-after.jsonl` and `benchmark-final.jsonl` retain those earlier measurements; `benchmark-9564af2.jsonl` is the final three-row run. The final benchmark constructs only fixture envelope cursors; measured cold opens still verify every generated event and reconstruct state.

Reproduce with installed checkout dependencies:

```sh
node docs/deep-review/benchmark.mts "$PWD" 128,512,1000
node --test TESTS/ledger-cache.test.ts TESTS/character-cache.test.ts
node docs/deep-review/evidence/independent-review/probes.mts "$PWD"
node docs/deep-review/evidence/independent-review/close-failure-probe.mts "$PWD"
node docs/deep-review/evidence/triage/probes-portable.mjs "$PWD" /tmp/argo-review-triage
```

## Review and board records

A separate native peer found acknowledgment, BOM, queued cancellation and post-fsync close gaps in intermediate candidates. All received regressions observed failing before correction. The final peer passed 64 targeted tests, including 24 cache regressions, and seven independent probes. This was a separate instance of the same native model, not cross-vendor review or application gate certification. The retained intermediate negative reviews must not be read as verdicts on the final candidate.

DR-100 and DR-110 are submitted as VERIFYING on `.board/deep-review`. The board's pinned data-only acceptance is deliberately not an application-test adapter; no worker promoted itself to MERGED. The coordinator's last close-error correction is an integration commit after the two immutable source submissions. [board-snapshot.json](board-snapshot.json) records actual states. A separate `.board/deep-review-followups` intake has DR-190 unclaimed and its encounter/knowledge/observation/shared-world/dialogue successors BLOCKED; dispatch remains off.

The Claude artifact retry reached a 200 page wrapper, but the document bootstrap requires sign-in (401). Only the four supplied high findings and two limits were assessed; the remaining fourteen findings were not retrieved. No paid provider call, deployment, schema migration, or operational trust-root promotion occurred.
