# SW-520 protected gate-policy review

**READY for the narrowly scoped foundation timeout change. No findings.** Reviewed exact candidate `0c4b1026f40dbc804f38c274f6cbbc0415e97bcd` against `1ea79ef89c649f4930b18327071d4a5ef9f97ebd` in a clean worktree. This verdict does not certify application acceptance or promote an operational trust root. The supervisor must complete the full immutable ten-group gate on the integrated candidate.

The only executable difference is the foundation tuple's fourth argument, `{timeout:600000}`, in `scripts/gate.mjs:24`. A byte-exact reconstruction of the base file with that single replacement equals the complete candidate file. The only other changed path is `docs/shared-world/GATE_BUDGET.md`. No mode, runner, test, dependency, controller, external-runner or CI change is included.

## Preserved controls

- All ten groups remain in their original order and execute serially. Foundation discovery still includes the complete sorted `TESTS/*.test.ts` set; model/process discovery is unchanged.
- The default child timeout remains 300000 ms. SIGKILL enforcement, 16-MiB output cap, nonzero-exit propagation and absence of an automatic success path are unchanged. Only foundation receives 600000 ms.
- The native runner is byte-identical: `concurrency:1`, trusted source-location/name matching, positive native per-file completion and refusal of failed, missing, cancelled, skipped or TODO assertions remain mandatory. Plain stdout or a zero exit is still insufficient.
- Clean-candidate admission, before/after candidate-byte hashing, HEAD equality and final gate identity remain unchanged.
- Both the external isolated application runner and trusted merge controller still bound the **whole** gate to 600 seconds. CI still permits 20 minutes including setup. Earlier/later groups consume part of the outer budget; foundation is not guaranteed its entire child allowance, and any outer timeout remains failure.
- Protected-policy enforcement is unchanged. A direct control using the real unchanged policy comparator accepts identical base script bytes and **rejects the exact revised gate** against the old pinned script bytes with `Candidate protected policy differs: scripts`. The trusted policy still includes `scripts`, `TESTS` and `controller`; controller execution still requires externally pinned `ARGO_CONTROLLER_TRUSTED_SHA` and compares policy before installing or executing candidate code. Board policy code is unchanged.

## Rationale and evidence integrity

The retained `83bc6c154cd0879f481185eb159cded8fa1e507d` failure record reports eight completed groups followed by foundation termination with `killed: true` and `SIGKILL`. All five retained log hashes match their recorded digests and are byte-identical to the base, as is `failure.json`. The document accurately states that no assertion failure was emitted before termination while treating the run as **incomplete acceptance**, without inferring that unfinished assertions would pass.

A bounded foundation-only increase is consistent with the expanded serial worker/reopen/ordinary-CLI workload. The patch preserves those integration checks rather than editing their selection or completion rules. Documentation explicitly requires a new full immutable gate, disclaims retroactive certification, distinguishes source delivery/application acceptance/operational trust, and forbids candidate self-promotion or editing existing Board records to manufacture approval.

## Exact identities and checks

| File | SHA-256 |
| --- | --- |
| Base `scripts/gate.mjs` | `f81dcb0b3f7d4d15e3d8c7218cdb1ebcc4719c1a487187eae692ef7871334bc0` |
| Candidate `scripts/gate.mjs` | `2711c874af35eb93c3b67a566cf33413cbf2569c3e0328d13df0983d3d10e79b` |
| Candidate budget document | `ca0e14726d3ec917f2df68955102a3b65b378bd975f5028fac496fc66d0e3bce` |

`node --check scripts/gate.mjs`, `git diff --check`, the byte-exact replacement check, ownership check, preserved-control comparisons, failure-log hash checks and direct protected-policy refusal control all passed. Evidence and reproducible external helpers are in `static-check.py`, `static-check.json`, `policy-refusal.mjs`, `policy-refusal.json` and `review.json`.

The integrated commit `dcfc4d9dd23bff699278a6fbbb9e0b04c95b7c12` has the exact reviewed gate bytes; no application-run result is inferred from that equality. The first review helper encountered the outer environment's `spawnSync git EPERM` before assertions. Its source/error are preserved in `initial-harness-spawnsync.*`; the final Python static driver completed normally. This changed only the external review harness, never the candidate gate or its native completion requirements.

No multi-minute suite, merge controller, Board operation or paid call was executed. No checkout file, trust pin or acceptance status was changed. The clean exact candidate was verified again after the checks.
