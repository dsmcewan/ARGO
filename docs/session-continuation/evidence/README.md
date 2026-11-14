# Continuation evidence

Evidence is bound to the recorded source commits; it is not automatically evidence for every later commit. Source ancestry is preserved by integration merges. Paths under `/workspace/reports` in captured logs describe the original run; use a fresh external checkout/output directory when reproducing.

- `cold-review/portable/` contains the parameterized compatibility reproduction, manifest checks and preserved generic hashing oracle. `COLD_RESULTS.md` one level above indexes the actual campaign measurements and remaining performance limit.
- `turn-author/` preserves source-worker tests, failed first attempts, repaired runs and exact source hashes. These are author checks, not independent acceptance.
- `turn-review-store/` contains independent ordinary-process public API, SQLite fault/RPC and real two-process controls. `final-e096530/` is the execution record; `final-0458268/` explicitly rebinds unchanged store bytes without claiming a second execution. Root-level probe scripts accept a checkout, exact SHA and output directory as described by the retained review.
- `turn-review-host/REVIEW-e096530.md` records the three initial host findings and prior 19-group coverage. `REVIEW-0458268.md` records ten focused checks of the repaired source. The corrected page-container probe distinguishes Promise `then` assimilation from prohibited data reads; its failing old-source control is retained. Run the parameterized scripts with `--root`, `--expected-sha` and `--report`; ordinary-process checks require `NODE_TEST_CONTEXT` absent.
- `SC-610-source-record.json` and `SC-620-source-record.json` retain actual Board/CAS states. A source record, scope-specific review and complete application gate are different assertions.
- `checkpoint-proposal-review.md` is a read-only design review. It is not checkpoint implementation or execution evidence.

Generated private keys, playable world databases, conversation outboxes, lease tokens and dependency checkouts are not part of this packet. All clients were injected offline fixtures; these records do not establish live model behavior, paid provider access or production authentication.
