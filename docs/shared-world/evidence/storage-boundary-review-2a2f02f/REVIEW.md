# SW-300 independent storage boundary review

Verdict: **READY for the reviewed storage-boundary and signed-ledger/model integration scope** at exact commit `2a2f02faf0c95e4095a8b5a43d022218cc15d0bc`, base `521e826b9588a1293ed22c243a14b83924c275bd`.

All 18 named storage/journal source tests and 10 independent ordinary-process probe groups passed. No scoped blocker was found. The candidate remained clean at the exact SHA before and after, with six new files and unchanged frozen contracts. Verification, probes, logs and per-file hashes are preserved here. No source edits, paid provider calls or nested workers by this reviewer occurred. Temporary SQLite databases were dedicated review fixtures and removed after checks.

## Independently verified boundaries

- **Passive inputs before work.** Option getters, proxies/revoked proxies, nested active genesis data, proxy key wrappers, custom prototypes, unknown fields and decorated cursors were refused without invoking caller traps or creating a database. Submit and event-page getters/proxies/invalid bounds and a 16 MiB speech input produced zero worker `postMessage` dispatches. Mutating an otherwise valid command/principal immediately after submission did not alter the event or bound request hash.
- **Private parent cache and marker.** Unchanged snapshots reuse the exact immutable owned object; nested resources cannot be mutated. Another handle's commit replaces it. A caller-supplied forged cursor/unchanged marker passed as an extra snapshot argument never enters the private IPC protocol and cannot pin an old snapshot. Parent request observation confirms only its actual cached cursor is sent. Mutable returned event/receipt DTOs do not change the database, later retries or cached snapshot; old snapshots remain unchanged.
- **Failed suffix isolation.** After a verified prefix, the fixture inserts one correctly signed next event followed by a corrupt next row. Snapshot, page read and submit all refuse. Removing only the injected suffix restores the exact prior parent snapshot identity; a subsequent valid request succeeds at the correct sequence. Neither the partially verified state nor the attempted request ID was published into a durable/cached successful prefix.
- **Whole encoded reply bounds.** Exact boundary probes include the maximum legal RPC ID and the complete `{id,ok,value}` envelope. ASCII, four-byte UTF-8, NUL escapes and quote escapes are measured correctly: a maximum fitting value passes and one extra encoded character fails. A payload that alone occupies 16 MiB is refused because its reply envelope would exceed the cap. Source inspection confirms snapshot/receipt preflight occurs before insertion and final result preflight before COMMIT; event pages account for the envelope and inter-element commas. The pure authority separately reserves 64 bytes for snapshots.
- **Actual signed SQLite → scoped view → model.** A hero self-private statement and subsequent addressed whisper are committed through SQLite. Melia's view and exact captured injected-provider request include only the acquired whisper plus her pinned owner policy; the self-private secret is absent, and hero has no authored Melia grant. The generated reply is submitted with the real NPC principal. Its receipt verifies against the fixture's public key and exact request hash/ID; it adds one speech event while physical state/offers/loans remain unchanged. Complete deterministic replay equals the stored snapshot.
- **Currentness across handles.** A second handle revoking Melia's policy during token counting prevents any provider generation. Real travel by a second handle during generation suppresses the pending response; an earlier generated command cannot submit at the new prefix. Closure committed during async cooldown success suppresses release and prevents later provider calls. These checks use actual signed database transitions, not edited view fixtures or synthetic heads.

The signed integration captured five refresh reads for the successful reply. Model output is supplied by an injected local transport; this proves the request contents, response binding and freshness checks, not the quality or availability of a live provider.

## Source review notes

`packages/ledger/src/world/storage.ts` validates options and request DTOs before cloning or crossing IPC; `snapshotCache` and its unchanged marker are closed over the ledger handle. Snapshot results are converted into privately owned immutable state. `submit` verifies the returned receipt under pinned trust and compares both request ID and complete request hash.

`storage-worker.ts` refreshes the verified suffix for each operation, including unchanged snapshot reads. The transaction wrapper assigns `cached = state` only after successful COMMIT. For new submissions, complete state/receipt envelopes are checked before INSERT and the result envelope again before COMMIT. Event-page overflow refuses with a smaller-page instruction. Parent/worker queues are asynchronous; no caller callback or model runs inside the SQLite transaction.

The independent authority reviewer covers the complementary transaction, competing-writer, signed false-outcome, rollback and lost-acknowledgment probes. Their results are not counted as this reviewer's independent tests.

## Reproduction and evidence

```sh
# In candidate checkout:
node --test --test-isolation=none TESTS/shared-world-storage.test.ts TESTS/shared-world-journal.test.ts
# External probe script, outside the Node test runner:
node --experimental-import-meta-resolve probes.mjs CHECKOUT_PATH 2a2f02faf0c95e4095a8b5a43d022218cc15d0bc OUTPUT_DIRECTORY
```

`source-tests.log` contains 18 named passing tests. `results.json` / `probes.log` record ten passing independent groups and exact before/after SHA/status. `actual-signed-provider-request.json` is the captured request; `actual-signed-view.json`, `actual-signed-receipt.json` and `actual-signed-evidence.json` record its scoped context and real receipt/cursors. Receipt verification happens inside the reproducible script under a newly generated fixture key; the private key is never written, and the archived receipt is not a durable externally anchored production checkpoint.

## Limits and next gates

The worker protocol is private to trusted host code; this is not a sandbox against hostile same-process code that can monkeypatch Node worker/crypto primitives. Parent-side `postMessage` interception in one probe only observes request dispatch and is restored afterwards. The byte-budget boundary is tested directly plus inspected at commit sites; this pass did not manufacture a nearly full 16 MiB committed world history or benchmark 10,000 events.

Warm verified handles deliberately trust earlier database rows to remain append-only. Cold replay and independent external checkpoints remain necessary for restart/rollback assurance. This review does not claim authentication for raw snapshots or caller-constructed principals. Snapshot/event methods remain host-only. The root `@argo/ledger` storage re-export is intentionally pending integration; this candidate's supported storage barrel is `packages/ledger/src/world/index.ts`. The actual session host, transport identity, actor delivery and end-to-end CLI still need their acceptance gates. There is no storage per-call cancellation protocol: a lost dispatched-submit acknowledgment remains ambiguous and requires retrying the identical request.
