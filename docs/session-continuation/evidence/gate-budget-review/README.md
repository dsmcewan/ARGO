Independent SC-640 gate-budget review preparation

Status: PREPARED, NOT EXECUTED against an implementation candidate. Base 9fa800493a3c033b45bc3df7ab18a56e25bcd9a8. Await the completed all-49-foundation diagnostic measurement and coordinator's immutable candidate before judging any selected budget. The prior 600-second external timeout remains a failed run; no partial output is a passing full-gate count.

Review scope is exactly the owned scripts/gate.mjs, controller/merge.mjs, docs/characters-runtime/evidence/run-candidate-gate.py and GATE_BUDGET.md. No repository writes, subagents, providers or operational trust changes.

Prepared portable checks:

    node static-check.mjs CHECKOUT BASE_SHA CANDIDATE_SHA OUTPUT FOUNDATION_MS OUTER_MS
    python3 helper-ast-check.py CHECKOUT BASE_SHA CANDIDATE_SHA OUTPUT HELPER_OUTER_SECONDS

The JavaScript checker requires a clean exact candidate and TypeScript already installed in its checkout. It parses both runner/controller versions without executing them and normalizes only the selected timeout literal. All other AST structure must match: all ten ordered groups, test discovery, serial unchanged native completion runner, candidate hashing/cleanliness, output caps, SIGKILL, sandbox flags, trust pin/policy checks and merge conditions. Protected files and CI are byte compared. The Python checker parses the external helper without importing it and compares sandbox/offline install AST plus original success/identity assertions. Source movement that safely changes their structure will receive manual review and a documented narrow checker correction rather than weakening an acceptance oracle silently.

Final helper-failure controls will execute only the external helper under an explicitly mocked subprocess transport in scratch space. Cases: real helper timeout exception with partial bytes, nonzero exit with partial stdout, malformed/foreign/missing-group success record, and a stale prior gate-result in reused output. Each failed invocation must raise/exit failure, preserve applicable partial output and a structured failure artifact, and never leave a misleading current success artifact. A valid mocked success control proves the negative harness is not refusing everything. These controls do not run or grade the actual ten-group application workload, and their fake summaries will be labeled fixtures.

Budget assessment: use retained measured complete foundation timing, remaining group overhead and a bounded margin; record actual measurements separately from configured maxima. Check foundation < whole-gate bound and identify the unchanged CI 20-minute cap including setup. Do not choose a value merely to make the interrupted test appear accepted. No subgroup outside foundation may change. Protected controller edits still require externally reviewed trust-policy handling; this review itself cannot move a trust pin.

Before final verdict retain exact diff, source/test-runner hashes, prior timeout evidence hashes, selected measurement identity, AST/check output, helper fault-fixture output and known limits. Completion here means scoped source review only. The coordinator still owns the final unchanged full ten-group application gate, CI and merge.
