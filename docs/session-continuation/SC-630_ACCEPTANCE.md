# Offline conversation CLI source acceptance

Exact source `f2641d92f5f07bc69b672ee6f6c3a189ee5f46cc` is independently accepted for SC-630. It changes only the CLI, its guide and its new tests; original source ancestry is retained by integration. The final complete application gate remains separate.

The [guide](../../scenarios/tempted-fates/shared-world/README.md) documents exclusive `talk-init`, open-only `talk`, a fully pinned explicit offline fixture and direct turn/continue/status/cancel operations. Output is bounded and awaited across new and existing modes. The host remains responsible for recovery, proposal admission and fresh player-scoped delivery; the CLI does not duplicate those rules.

[Author verification](evidence/cli-author/candidate.md) records 19 passing targeted tests, types, contracts and boundaries at the exact source. An extra full npm test run was intentionally cancelled to release CPU, after reporting three file-level failures without final assertion diagnostics. Its exit130/incomplete result is retained, not accepted or assigned an unverified cause.

The [independent review](evidence/cli-review/candidate-f2641d9/REVIEW.md) covers twelve planned areas plus genuine pending-row/non-driving status and executable broken-output controls. It verifies exact retries, canonical fixture binding, no preflight side effects, no mechanical actions from dialogue, player closure/eviction suppression and output backpressure. An initial aggregate launcher timeout was retained before segmenting the same checks. A simultaneous caller's safe stale-query CONFLICT was reconciled without duplicate events or generation; success for every racing caller is not promised. A Node error-name formatting expectation was corrected against the original retained EBADF artifacts. No product defect remained.

The [safe evidence export](evidence/cli-review/EXPORT_MANIFEST.json) retains originals by hash and supplies parameterized reproduction instructions. Generated worlds, keys, databases, raw prompts and full private captures are excluded explicitly. Independent means a separate native Codex peer; no paid or live-provider evaluation was performed.

The [actual Board record](evidence/SC-630-source-record.json) is **VERIFYING**, with three immutable CAS artifacts. Its data-only source gate was not run as application acceptance. No Board MERGED state is fabricated. The one-pair-per-world-directory CLI limit, trusted local operator boundary, uncertain lost generation and external rollback-anchor requirement remain explicit.
