# Foundation acceptance budget

The immutable full-gate attempt at `83bc6c154cd0879f481185eb159cded8fa1e507d` passed the first eight groups, then exceeded the foundation child's 300000 ms deadline. Its recorded child error reports `killed: true` and `SIGKILL`; no assertion failure was emitted before termination. The run **was not accepted**. The retained [failure record](evidence/full-gate-83bc6c1/failure.json) and [application log](evidence/full-gate-83bc6c1/application-gate.log) remain evidence of that attempt, not a successful gate or proof that uncompleted assertions would pass.

SW-520 adds `{timeout:600000}` only to the foundation entry in [scripts/gate.mjs](../../scripts/gate.mjs). The expanded serial acceptance workload includes independent SQLite workers, cold reopen/corruption checks and ordinary-process session CLI tests. Giving this complete group a bounded ten-minute allowance preserves those integration boundaries without sharing mutable fixtures or replacing real process checks.

All ten groups, complete sorted test-file discovery, the default 300000 ms budget for other groups, output limits, exit handling and SIGKILL deadline enforcement remain unchanged. [The native runner](../../scripts/run-tests.mjs) still executes with `concurrency:1`, matches named assertions to trusted source locations, requires successful native per-file completion and refuses failures, missing assertions, cancellations, skips and TODOs. Candidate-byte and HEAD checks remain unchanged. This adjustment introduces no environment bypass, reduced test selection, production test mode or automatic success path.

The timeout layers remain intentionally distinct:

| Boundary | Limit |
| --- | ---: |
| Foundation child | 600000 ms |
| Other gate children, by default | 300000 ms |
| External isolated full-gate runner | 600000 ms for the whole gate |
| Trusted merge controller's isolated full gate | 600000 ms for the whole gate |
| CI job | 20 minutes, including setup and all checks |

The outer 600000 ms bounds are unchanged. Time spent in other groups therefore reduces the effective time available to foundation; this patch does not guarantee that foundation can consume its entire child allowance. An outer timeout remains a failed acceptance attempt. The supervisor must run the complete ten-group gate on the subsequent immutable candidate and retain its actual result; the longer child budget does not retroactively certify the earlier candidate.

This is a protected acceptance-policy change. [Controller policy](../../controller/acceptance-policy.mjs) pins `scripts/`, `TESTS/`, `controller/`, the CI workflow and other oracle/dependency roots. A controller pinned to a differing earlier gate must continue to refuse this candidate. Independent review and explicitly authorized immutable trust-policy handling are required where controller integration is used; a candidate's own passing gate cannot promote `ARGO_CONTROLLER_TRUSTED_SHA`. Existing Board policy pins and recorded statuses must not be edited to manufacture approval. Source delivery, external application acceptance and operational controller trust remain separate records.

The assigned verification for this minimal change is syntax checking, a byte-exact comparison proving the foundation tuple is the only executable change, and an ownership/diff check. Those checks do not replace the supervisor's independent review or full immutable application gate. No runner, test assertion, external timeout, CI cap or trust pin is changed by SW-520.
