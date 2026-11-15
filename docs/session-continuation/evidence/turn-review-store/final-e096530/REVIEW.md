Independent SC-620 store review — READY for the reviewed store scope

Exact candidate: `e096530b2618119ab3dd545f3defe36b754021bd`. The inspected checkout remained clean; frozen SYSTEMS/contracts bytes are unchanged from checkpoint `3870f44`. `verification.json` pins all reviewed source and evidence hashes. This verdict covers store/filesystem/guard/RPC/CAS/durability behavior. It is not final driver/privacy, Board acceptance, native completion or full application-gate approval.

All five checkpoint findings are resolved on the actual candidate:

| Finding | Final ordinary-process evidence |
| --- | --- |
| SC620-ST01, mutable open mode after await | Both normal empty-file open and the original immediate caller-mode mutation refuse; the opener captures mode/path before awaiting. |
| SC620-ST02, SQLite LIKE wildcard | A real sqliteXforeign table now causes refusal; both schema scans use literal-prefix GLOB. |
| SC620-ST03, close at RPC capacity | All 64 accepted writes fulfilled, zero rejected, and close succeeded after draining. |
| SC620-ST04, parse before byte bound | The same 262,158-byte corrupt row refuses, and external worker parse instrumentation records zero oversized parse calls. |
| SC620-ST05, expired null outcome | Settlement as no_reply at deadline+1 refuses; generation_uncertain recovery remains allowed. |

The coordinator-selected immediate-directory symlink refusal also passes. The three identifier-newline negative controls continue to refuse; the original suspicion remains disproved. `fix-verification.json` asserts these observed booleans/counts. The original checkpoint observation script was deliberately reused unchanged, so its historical descriptive strings are not claims about the repaired source or driver availability. The old CHANGES REQUIRED report and evidence remain intact outside this final directory.

Eight distinct public API groups passed: explicit create/open and no replacement; unsafe paths/permissions/file/directory/sidecar symlinks; foreign schema plus complete world/player/policy binding; exact registered capability and passive-data guards; same-file two-handle attempt/cancellation fencing; same-file two-process public-host generation ownership; durable silence across reopen/read/resume; and five controlled stored-row/metadata corruption variants. The cross-process race produced one generation call and one settled replied turn. The two-handle test retained the exact immutable attempt, increased revision on cancellation, suppressed late text and never regenerated. Row edits restore original triggers before reopening, so their failures exercise row/metadata validation rather than absent-schema refusal.

Three additional ordinary-process worker groups passed. A controlled failure immediately before outbox COMMIT rolled back the insertion: public read returned null, world sequence stayed zero, and the same turn then succeeded with two speech events and one generation. An actual worker exit after COMMIT but before acknowledgment rejected the initial call; reopen/read recovered the accepted input without generation, and explicit resume completed it once. Unknown operations/envelope fields and a request above one MiB refused, after which a valid raw worker read returned the intact settled row. These use external preload instrumentation; repository source is unchanged. COMMIT refusal is a simulated error, not a physical disk-full test.

Harness history is retained honestly: the first public run passed seven groups and failed its process race because the review child script had an unmatched parenthesis, confirmed by node --check before source import. `initial-harness-syntax-error/` preserves that script/log/results. The corrected process group passed separately in `process-rerun/`; no source finding relied on that harness failure. Counts above are distinct independent probe groups, not claims of native test-completion receipts.

Source review confirms short worker-owned transactions, BEGIN IMMEDIATE CAS/accounting, selected-row validation before and after transitions, exact binding/schema checks, immutable input/command/attempt fields, monotone cancellation, tombstone deletion refusal, and reply publication only after COMMIT. No world-ledger or model callback runs inside a store transaction. The parent keeps supplied genesis/principals in the registered capability; worker binding data excludes private genesis profiles/seed. Public constructors cannot substitute a frozen or cloned capability. Provider policy IDs bind declared serializable configuration; they do not authenticate callback code.

Reproduce with checkout dependencies installed and an exact clean SHA:

    env -u NODE_TEST_CONTEXT node probes.mjs CHECKOUT SHA OUTPUT
    ARGO_REVIEW_PARSE_TRACE=OUTPUT/parse-trace.jsonl node --import trace-json.mjs checkpoint-probes.mjs CHECKOUT SHA OUTPUT
    ARGO_REVIEW_FAULT_TRACE=OUTPUT/fault-trace.jsonl env -u NODE_TEST_CONTEXT node --import worker-fault-hook.mjs worker-fault-probes.mjs CHECKOUT SHA OUTPUT

Scripts reside one directory above this report; use absolute script paths when elsewhere and prepare the trace output directory. Final artifacts are public-probes/results.json, process-rerun/results.json, fix-controls/observations.json, fix-verification.json and worker-faults/results.json, with corresponding logs/traces and hashes. Temporary keys/databases were private and removed after the probes.

Limits remain explicit: the outbox assumes trusted local storage; row hashes do not authenticate adversarial rehashing or restore lost attempt/silence tombstones. Both-store rollback is not independently detected. Different outbox files cannot coordinate at-most-one generation. Same-UID filesystem races are outside the claimed local trust boundary. All provider responses were injected offline fixtures. No paid/network calls, repository edits, nested agents or Board operations occurred. Any later candidate requires exact store-hash comparison and review of material changes; the separate host reviewer owns driver/disclosure findings.
