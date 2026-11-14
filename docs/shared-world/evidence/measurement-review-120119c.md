# Measurement runner asynchronous Git correction

**READY for the scoped static delta review; no new finding.**

Candidate: `120119c81c4e4562e5078b30f58390d364be13cb`.
File: `docs/shared-world/measure-runtime.mjs`.
SHA-256: `24e7fd011ff0f043deda58ccb9a18f2c5ea450a2a79cdec1cc85d56d4b4a62e9`.
Checkout was clean during the read-only check. Reviewed the exact commit diff and final call sites; no tests, benchmark, provider calls or source edits were performed.

The only change replaces synchronous Git subprocesses with `promisify(execFile)` and awaited results. Lines26–29 capture HEAD and require clean status before project imports at lines31–35. Lines114–115 await unchanged-HEAD and clean-status checks before recording results. Child-process failures reject and prevent the result artifact; stdout trimming and assertion semantics are preserved. The helper uses a fixed executable and an argument array, without a shell.

Startup identity checks remain outside all timers and precede enabling event-loop monitoring. Final checks remain after event-loop monitoring is disabled, after the standalone replay timer has stopped and after full replay/snapshot equality. Therefore the change neither adds Git latency to measured intervals nor changes their labels or attribution.

Data generation, alternating request/inbound identities, retry and suffix-refresh assertions, provider fixture, API calls, full replay comparison and measurement output fields are unchanged from the previously reviewed runner. This review does not claim that the reported `711e775` environment-specific subprocess failure is fixed in execution; that remains for the newly started measurement run. Prior instrument review and stated single-machine/workload limitations still apply.
