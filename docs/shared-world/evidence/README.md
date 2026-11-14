# Shared-world evidence

These are portable copies of the offline source reviews and measurements. Some original logs retain absolute scratch/worktree paths; those identify the review environment, not required deployment locations. Probe scripts accept a checkout path or document their source path. Use each reviewed source commit when reproducing a source-specific record.

| Evidence | Scope |
| --- | --- |
| [Contracts](contracts/README.md) | Initial findings, repaired contract probes and exact frozen hashes. |
| `rules-authority-review-4774dfb/`, `rules-privacy-review-4774dfb/` | Original rules review and unchanged probes on repaired `2c0c1c8`; retained failure and successful controls. |
| `dialogue-review-dfed2b9/` | Actual injected provider requests, freshness/privacy tests and identified reviewer-harness corrections. |
| `seed-review-31e8c42/` | Source/identity/kit/knowledge checks over the campaign seed. |
| `combined-pure-dialogue-521e826/` | Real campaign context through the model adapter and pure authority. Synthetic cursor heads in this early proof are explicitly not signed-store evidence. |
| `storage-authority-review-2a2f02f/`, `storage-boundary-review-2a2f02f/` | Signed SQLite concurrency, actual COMMIT rollback, lost acknowledgment, cache integrity and scoped model reads. |
| [First runtime measurement](runtime-measure-120119c/measurement.json) | Ordinary-process signed store/context workload before the session wrapper; full replay equality and explicit cold-start limitations. |
| `host-authority-review-0d29515/`, `host-privacy-review-0d29515/` | Fixed-principal sessions, exact receipt binding, private CLI initialization/resume, ordinary demo and cutoff-safe release. Initial reviewer matcher failure and corrected targeted result are retained. |
| `host-source-0d29515/` | Author suite and demonstration. Its missing dependency boundary was resolved by coordinator commit `897a2e3`; the original failure log is retained. |
| `measurement-session-review/` | Static review of final session measurement and package wiring at `897a2e3`; it makes no timing claim. |
| [Complete session measurement](session-measure-639d31b/measurement.json) | Ordinary-process fixed-principal query/view/submit, five context refreshes and exact receipt verification; 2002-event full replay equals the saved state. |
| `SW-*-source-submission.json` | Sanitized actual Board/CAS submissions; no lease tokens or invented MERGED states. Contract submission is in its freeze acceptance record. |

Independent reviewers are separate native Codex peers, not cross-vendor or human reviews. Retained provider requests contain synthetic test-world data, not private user worlds or provider credentials. Private signing keys, random seeds, live world directories and databases are excluded.

The first measurement attempt at `711e775` failed in its Git identity subprocess before importing the runtime or creating a world; its logs remain. The runner's process invocation was corrected and independently reviewed before the successful `120119c` run. This is not a runtime failure or a successful measurement.

The session and measurement records are retained above. `full-gate-83bc6c1/` preserves the first integrated acceptance failure: eight groups passed, then the foundation runner hit its 300000 ms cap. That run is not passing evidence. SW-520 separately reviews the bounded policy adjustment before another full run. `integration-record-review-639d31b/` verifies source/CAS/review provenance and retains the minor documentation finding plus its correction. Source tests, independent probes, a full application gate and a GitHub CI result establish different boundaries; none should be relabeled as another.
