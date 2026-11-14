# Independent DR-221 runtime probes

Prepared against the observation admission contract frozen by coordinator commit `199e5bb`. This preparation is not a runtime verdict. The probe runner refuses a missing/mismatched full commit identity or tracked working-tree edits. No provider calls are used; temporary signed ledgers live under the system temporary directory and are removed after each test.

After the supervisor supplies the immutable runtime candidate:

```sh
ARGO_REVIEW_ROOT=/absolute/path/to/candidate \
ARGO_REVIEW_SHA=FULL_40_CHARACTER_COMMIT_SHA \
node /workspace/reports/2026-11-14-argo-followup/runtime-observation-review/review.test.mjs
```

Run directly with Node 24, avoiding native child-runner/reporting restrictions in the outer sandbox. The probe sources use candidate fixtures and frozen mechanics to construct data, and independently orchestrate the admission races. They do not invoke a production unsafe-admission mode. A historical signature fixture deliberately contains v1-valid content that the new policy forbids, to verify exact authenticated retry compatibility.

Coverage: callback-free default/reopen, writer-lock release while a host is slow, intervening commits and warm-cache reads, cancellation with a noncooperative host, concurrent exact duplicate reconciliation, legacy retry before new author/recipient limits, source/proxy prohibition even with a willing host, detached frozen callback context, caller/grant mutation during awaits, grant expiry while relocking, and durable append/cache preservation when derived snapshot output fails.

Final review must also inspect the immutable implementation's original-operation budget and explicit deadline API. Add a targeted preflight-plus-verifier-plus-relock budget probe using that published API if required; do not infer its option names from an unfinished worktree. Existing ledger cache regressions remain part of the supervisor's broader gate.
