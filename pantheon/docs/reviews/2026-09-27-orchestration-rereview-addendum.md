# Pantheon orchestration re-review — clarification and additional finding

**Revision unchanged:** main is still `e34c0f4454096f38d412f99b503708270e241256`; seat-core is still `7beba20`. There are no tracked changes since the preceding orchestration review. The existing untracked `docs/reviews/` directory was preserved. This pass challenged the prior conclusions against actual callers and added one targeted offline execution probe. It did not repeat the unchanged full suite: the earlier 443/443 result remains evidence for this same revision.

**This addendum supersedes the severity and interpretation of the corresponding findings in `orchestration-review.md`.** The earlier report and its reproduction evidence are preserved.

## Assessment

Pantheon remains a working multi-model orchestration prototype with real exploration, cross-review, delegation, and bounded discussion paths. The persistent-team components are tested but not yet composed into a running lifecycle. Absence of dependency scheduling or repair loops is a limitation of the current standalone-task mode, rather than proof that it fails an implemented general-workflow contract.

The central operational issue is the mismatch between multi-task dispatch and durable-seat capacity. The central reporting issue is distinguishing a successful call, a passed artifact check, partial work, and completed orchestration. Several earlier findings described these too broadly as failures of overall correctness or certification.

## Corrections to the earlier review

| Earlier finding | More precise conclusion |
|---|---|
| Failed required worker yields successful orchestration, P1 | **P2:** `report.ok` can be true despite an assigned task failing. The schema does not distinguish required and optional tasks. The only production caller prints individual outcomes and does not use this flag to ship or publish. A downstream release bypass was not demonstrated. |
| Abstention disappears from incomplete work | **Retracted as phrased.** Abstention remains in `verdicts`, the integration prompt says NOT APPLICABLE, and the CLI counts it separately. `unverified` specifically denotes absence of an oracle result. Mixed-outcome completion status still needs a clear contract. |
| New discussions inherit context, P1 | **P2:** intentional durable reuse lacks an explicit new-run versus resume boundary. An ordinary discussion after an assigned-stance discussion can report an independent round-one opening while restoring old peer context. This does not break within-round ordering isolation, and the probe does not show how a live model would react to the old instructions. |
| Swarm produces a successful synthesis with no proposals | **P2 output-labeling gap:** `synthesis.ok` is success of that individual call, not an aggregate orchestration pass. Upstream failures remain visible. The fresh answer should be labeled as a fallback or insufficient-input outcome rather than synthesis of unavailable proposals. |
| Duplicate task IDs erase failure, P1 | **P2 validation defect:** the overwrite is reproduced and violates retention of failed verdicts. No shipping consequence or malicious exploit was demonstrated. |
| Lock oracle insufficient | **Retained, scoped to the generated-code delegation demo.** This is not evidence that Pantheon's actual seat lock is broken; its dedicated tests use real processes. |

## Concrete findings that remain

1. **P2 — A valid decomposition can lose work at dispatch.** The planner may assign three tasks across two workers. All tasks launch concurrently, and tasks sharing a worker use the same `deleg-work` seat. The view rejects the overlapping turn as busy. This was demonstrated with the actual view admission path. Queue by seat, or allocate explicit separate task instances when independence is intended. Sources: `src/swarm/orchestrate.mjs:141–145`, `scripts/delegate-run.mjs:28–32`, `src/view/server.mjs:35–39`.
2. **P2 — Duplicate task IDs overwrite verifier results.** A FAIL followed by a PASS under the same ID leaves no recorded failure in the aggregate. Validate unique IDs before dispatch. Sources: `src/swarm/orchestrate.mjs:40–54,159`.
3. **P2 — Discussion labels contradict the recorded trajectory.** An initially opposed pair that reaches agreement can be labeled as having agreed from round one; two models that swap positions can be described as having made no movement. Distinguish individual changes, remaining disagreement, and textual similarity. Sources: `src/swarm/discuss.mjs:241–243,269–283`.

The prior evidence files retain the corresponding assertions and outputs. No additional full-suite run was needed to reclassify these unchanged observations.

## New finding: execution-to-review handoff

**P2 — The reviewer is told tests passed even when execution failed.**

`scripts/live-ship.mjs:249–255` executes the produced module and publishes its actual exit status. At `:285`, the reviewer prompt nevertheless contains the fixed statement `It was run as ${CMD} and exited 0.` The recorded result is not used to build this part of the handoff.

The new probe executed the actual `live-ship.mjs` driver and its real board/publication/shipping code. A loader replaced provider constructors and `sdkTurn` with deterministic local replies. The implementer reply was a module that throws, and that module was genuinely executed in a child process. The reviewer reply was a fixed approval; no live model judgment was involved.

Observed:

- The actual module execution and stored repro both recorded exit **1**.
- The review stage was reached, and its prompt claimed exit **0**.
- The final TESTS gate read the correct record, refused shipment, and the script exited **1**.

The demonstrated consequence is incorrect context supplied to cross-model review, not a bypass of the shipping gate. Fix the handoff by deriving the reviewer brief from the stored execution result, including failure output when relevant. A failed execution can still be useful review material; it must be represented accurately.

Receipt: `orchestration-rereview-evidence.json`. The reproduction and preserved board state are under `work/rereview-live/`; run its `probe.mjs` with Node from the review workspace. Only the provider edge is mocked. The checkout source was not modified, and no credentials or network provider calls were used.

## Recommended next step

Connect assignment IDs, seat capacity, per-task outcome states, and reviewer evidence into one explicit run contract. Preserve useful partial work, report the remaining obligations, and make starting a new run distinct from resuming a persistent conversation. This directly strengthens the multi-model coordination already implemented without requiring more models or a broader workflow engine.

---

*Provenance note (added when this file was placed in the repo, 2026-09-27): verbatim body of the reviewer's upload; the receipt and `work/rereview-live/` probe it names live in the reviewer's workspace and were not copied here. The handoff defect it reports is addressed by `testsBrief()` in `src/board/controller.mjs`, called from `scripts/live-ship.mjs`, with `tests/board-tests-brief.test.mjs` carrying the addendum's repro as its first case.*
