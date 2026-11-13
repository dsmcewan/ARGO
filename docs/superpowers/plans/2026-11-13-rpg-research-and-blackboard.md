# RPG research and offline blackboard implementation plan

> Implement in isolated worktrees with flat peer assignments. No recursive workers or paid vendor runs.

**Goal:** Save source-backed starter research, exact scout/synthesis/architect prompts, a headless follow-up ticket seed, and a tested offline board/dispatcher.

**Architecture:** Research produces evidence and proposed migrations against foundation commit `05a292c403442a24b8f420e8b851f41f0f581ce5`. A local trusted supervisor owns SQLite WAL coordination, immutable CAS inputs, fencing and real Git integration. Confined workers can submit candidates but cannot approve or merge them.

**Tech stack:** Existing TypeScript/Node 24 game core; stdlib Python 3.11+ orchestration; SQLite WAL; Git; Linux Bubblewrap. Research JSON Schema uses existing Ajv 8.

**Spec:** `RESEARCH/README.md`, `RESEARCH/SCOUT_DISPATCHER.md`, `RESEARCH/HEADLESS_FOUNDATION.md`.

## Constraints and review focus

- No paid inference, new gameplay service deployment, or persona/voice/UI build in this pass.
- Preserve frozen v1 files and existing audit evidence. Proposed graph/timing changes require a versioned migration.
- Treat requested model names as routing configuration, never as evidence that those models executed.
- Verify licenses by exact edition/material; missing primary evidence stays explicit.
- Fence expired workers; retain locks while verification/review or merge recovery is unresolved.
- Gate an immutable commit under trusted policy; `MERGED` means an actual verified Git integration.
- Keep the board database, supervisor capability and host Git metadata outside worker confinement.
- Reject path aliases/overlaps, cyclic dependencies, CAS corruption, stale submissions and same-vendor reviews.

## Tasks

- [ ] Produce five cited starter findings and machine-readable reports with validated evidence/proposal/benchmark distinctions.
- [ ] Write flat R1–R5 dispatcher, repo-audit refresh, synthesis and architect instructions; map actual Bible invariants rather than inventing a prior numbered law list.
- [ ] Write headless storage/graph/wire follow-up specification and ready-to-load Wave 1/2 seed; missing implementation gates fail closed.
- [ ] Implement/test `tools/board.py` in the board-engine worktree: WAL/DAG, fenced leases, CAS, immutable specs, audit verification, supervised gate/review and real merge.
- [ ] Implement/test `tools/dispatch.py` in its own worktree: finite offline loop, read-only handoffs, writable ownership mounts, bounded child processes and cancellation on lease loss.
- [ ] Integrate peer commits; run end-to-end offline fixtures, schema checks and existing deterministic gates. Obtain independent review of final boundaries.
- [ ] Commit and save to private ARGO, preserving intervening user commits. Record exact verification and remaining integration limits.
