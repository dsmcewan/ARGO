# SC-640 final source handoff

Candidate `2debc1b6e1848c481abe6eeeef2271d207b07081` is clean in the leased SC-640 worktree. It contains the independently reviewable helper checkpoint `47d3fa6a3b247986a0a6bb9aaad1f65cfff25273` plus one exact deadline literal in each gate caller and `docs/session-continuation/GATE_BUDGET.md`. Base `9fa800493a3c033b45bc3df7ab18a56e25bcd9a8`. Only the four owned files changed.

Selected bounds are 1080000 ms for foundation and 1200000 ms / 1200 seconds for the controller/helper whole-gate subprocess. Other gate groups retain 300000 ms; native runner/test discovery/source checks, sandbox/output caps, CI and trust pins are unchanged. `narrow-policy-check.json` verifies the gate/controller diffs are only these literals and the helper differs from checkpoint only in its whole-gate literal. Root archived diagnostic evidence at the relative paths linked in GATE_BUDGET.

Measurement: coordinator's unchanged 49-file / 567-test foundation diagnostic at `3c8ff55d872891014c89fe43515b3c28fd492626` passed with 895.626 seconds elapsed INCLUDING clone/install, during concurrent CPU load. This is neither foundation-only timing nor full ten-group acceptance. Earlier 600-second full-gate failure remains explicitly failed. Additional CLI tests require a new final complete gate. CI still caps the total job at 20 minutes including setup, so the external application allowance does not guarantee CI completion.

Helper failure handling retains partial timeout/nonzero output, produces separate structured `gate-failure.json` and exits nonzero. It refuses nonempty output directories to preserve prior evidence. Only valid final candidate/merge-ready/ten-check records with unchanged source head produce `gate-result.json`.

Checks: 8/8 external synthetic controls pass; both JavaScript syntax checks, Python AST parse, narrow source-policy comparison and diff check pass. The original helper fails 7 of the 8 controls. An intermediate checkpoint rerun had 7/8 pass because 100 ms expired before the synthetic child's first print; that evidence is retained. With only the external harness allowance increased to 1 second, 8/8 pass on both checkpoint and final source. No repository test was changed or skipped; these synthetic controls are not an application gate.

`verification-final.json` binds source/evidence/diagnostic hashes and exact outcomes. No paid calls, nested workers, Board submit, merge, push or trust promotion. Root owns independent final review and complete application acceptance. Stop source edits pending review.
