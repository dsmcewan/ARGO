# Cold reconstruction result

Accepted as a byte-compatible performance improvement; the coordinator's under-ten-second cold-open target remains **unmet**. No verification was removed to meet it. Conversation implementation can proceed against the reviewed unchanged authority; faster checkpoint boot is a separate trust-model decision.

The unchanged ordinary-process campaign runner completed at clean `7c16c0d8709b0b53dba0ab36051c1fe0100bd35a` on Node 24.22.1. Compared with the prior completed-session measurement at `639d31b1414c21fa7516dc9d363ad35bae148afd`:

| Operation | Earlier observation | This observation |
| --- | ---: | ---: |
| Verified cold handle, 2,000 events | 74.37 s | **13.88 s** |
| Complete deterministic replay, 2,002 events | 59.40 s | **10.09 s** |
| Warm scoped view, median of five | 20.66 ms | 13.95 ms |
| Warm contextual reply and signed commit | 358 ms | 369 ms |
| Warm speech append | 119 ms | 42 ms |

Both runs use actual campaign data, alternating addressed speech, injected provider responses and warm OS file cache. They are one-machine observations, not cold-disk, live-model, combat-scale or statistically established latency guarantees. The 369 ms reply includes current-query acquisition, five scoped context refreshes and receipt verification. The improvement is in reconstruction; these observations do not establish faster model responses. Every measurement replay exactly matched its full signed snapshot.

Source commit `c4654d52b1a08bdb4bfa18822d2cc74229d606b6` is retained as an ancestor of the integration branch, so its reviewed bytes remain inspectable. It adds private immutable-record encoding reuse and a cached-genesis Command binder equivalent to the frozen contextual guard. Frozen contracts, journal/storage code, signatures, admission, aggregate bounds and original tests are unchanged. The full-history SHA-256 input still grows with the journal; total replay is not claimed linear.

Evidence:

- [Measurement](evidence/cold-measurement-7c16c0d.json), produced by the unchanged [runtime runner](../shared-world/measure-runtime.mjs).
- [Independent source review](evidence/cold-review/REVIEW.md): eight ordinary-process groups, all 513 prefix hash oracles against the preserved baseline fixture, context/reference matrix, hostile inputs, forks and capacity refusal; no findings. The [portable reproduction harness](evidence/cold-review/portable/README.md) accepts a separately created, source-pinned baseline fixture; it retains the same eight checks and generic oracle and passed five malformed-manifest controls.
- [Native completion record](evidence/cold-native-c4654d5.json): the unchanged native runner verified **114 named tests** in a read-only, network-isolated disposable clone. Its [completion output](evidence/cold-native-c4654d5.log) is retained. The earlier normal-workspace run was refused for missing child completion events and remains recorded as a refusal, never a pass.
- [Source Board/CAS record](evidence/SC-610-source-record.json): actual state VERIFYING. This is source submission, not a claim that the Board's data-only gate approved executable application changes. The final ten-group application gate remains a later integration step.

No paid calls, checkpoint shortcuts or operational controller trust promotions occurred.
