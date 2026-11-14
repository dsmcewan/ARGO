# Measured gate execution budget

SC-640, 2026-11-14. These bounded execution allowances support running the complete gate after the conversation host and CLI additions. Independent policy review and a successful complete application gate on the final integrated candidate remain required.

## Evidence and limits

The earlier full-gate attempt at `3c8ff55d872891014c89fe43515b3c28fd492626` exceeded the external 600-second deadline. Its [failure record](evidence/host-gate-3c8ff55/failure.json) and [runner result](evidence/host-gate-3c8ff55/runner-result.json) remain failures. The former helper lost partial subprocess output on timeout, so that attempt supports no passed-group or assertion-completion count.

A subsequent [foundation diagnostic](evidence/foundation-diagnostic-3c8ff55/gate-result.json) used the unchanged native `scripts/run-tests.mjs` on all 49 foundation files at that same commit. It exited zero and [verified 567 named tests](evidence/foundation-diagnostic-3c8ff55/application-gate.log), including their source locations and normal per-file completion. The source head remained unchanged. Total elapsed time was **895.626 seconds, including clone and dependency installation**; foundation-only duration was not isolated. The diagnostic used an external 1200-second allowance and executed only the foundation group.

Concurrent author suites and independent checks competed for CPU during portions of the diagnostic. This is a loaded-workspace execution measurement, not a portable performance benchmark. The later CLI additions increase the final test workload. An 18-minute foundation allowance gives 184.374 seconds beyond this observed diagnostic total; that arithmetic is a planning allowance, not a guarantee for the expanded suite. A quiet complete ten-group run on the final candidate must demonstrate completion within the selected bounds.

Pinned diagnostic evidence SHA-256:

| File | SHA-256 |
| --- | --- |
| `gate-result.json` | `a05ee0cc0660d1966da653a19822964f7798199a336fdd37f49e66ab6b8e5bbe` |
| `application-gate.log` | `71844c76b286ca54ced5e5d6404ebb04bbed5bbde260a1ab7e84b023b5db01c9` |

## Selected bounds

| Execution boundary | Previous | Selected |
| --- | --- | --- |
| Foundation group in `scripts/gate.mjs` | 600000 ms | 1080000 ms / 18 minutes |
| Whole confined gate in `controller/merge.mjs` | 600000 ms | 1200000 ms / 20 minutes |
| Whole confined gate in the external Python helper | 600 seconds | 1200 seconds / 20 minutes |
| Every other group in `scripts/gate.mjs` | 300000 ms | Unchanged |

The whole-gate limits cover the confined application-gate subprocess. Clone, installation and staging retain their existing separate bounds. All ten groups, ordered discovery, the native runner's source-location and file-completion checks, immutable candidate/hash checks, network isolation, read-only sandbox, output caps and nonzero/timeout refusal remain in force. No test is skipped, parallelized or weakened. Trust pins, merge admission rules and CI configuration are unchanged.

The [GitHub Actions job](../../.github/workflows/deterministic-gate.yml) still has a **20-minute total job cap**, including checkout, tool setup and both dependency installations. It invokes `scripts/gate.mjs` directly. Therefore the external helper's 20-minute application allowance does not give CI 20 additional minutes after setup: CI can expire earlier, and its eventual result must be checked separately. A timeout remains a failure requiring diagnosis; it cannot be converted into acceptance from this measurement.

## Failure evidence

The external helper now requires an empty output directory, preserving earlier evidence instead of overwriting it. Capture the helper's own console output outside that directory. Timeout output, including merged stderr, is retained in the relevant stage log; nonzero exits retain their output too. Failure writes `gate-failure.json` with stage, exception type, timeout/return-code details, elapsed time, source-head comparison and log hashes, then exits nonzero. A malformed final record or changed source head also fails. Only verified success writes `gate-result.json`.

Eight external synthetic process controls cover timeout output, nonzero output, malformed records, wrong candidate, missing group, changed source head, success and preservation of earlier output. They test the reporting helper and do not stand in for application acceptance. The author retained an intermediate harness failure whose 100 ms synthetic timeout preceded child output; increasing only that control's allowance to one second made the controls reliable without changing production behavior. Exact source and control evidence are recorded in the SC-640 handoff; final independent review and application results belong to the coordinator's acceptance record.
