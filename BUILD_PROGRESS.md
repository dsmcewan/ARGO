# ARGO foundation progress

Plan: `docs/superpowers/plans/2026-11-13-argo-foundation.md`.

- Phase 1 complete at `3e3ad3a`: 840 verified blobs; 525 classified modules; no missing active Pantheon relative imports; parse-only checks pass. Audit saved to GitHub main at `bc875b2`.
- Isolated implementation branch: `argo/foundation-spine`, worktree `.worktrees/foundation`.
- Task 1 complete: 36 schema definitions and service/mechanics contracts frozen in SYSTEMS/CONTRACT_FREEZE.json. JSON Schema 2020-12 metaschema and local references pass; valid example accepted and five malformed/unsafe variants rejected. Phase 3 may start.
- Baseline: `node --test tests/*.test.mjs` in Pantheon: 71 file-level results, 50 pass/21 fail. Direct repro identifies hardcoded missing `/usr/bin/node` and restricted Bubblewrap NETLINK_ROUTE permissions. No harness code changed yet. Logs are `/tmp/argo-pantheon-baseline.log`, `/tmp/argo-baseline-run-item.log`.
- Preflight interfaces: Tasks 1→3→4 use the same proposal/query/outcome schemas; Task 2 is reusable provider transport only and does not depend on gameplay writes. Model package may be introduced in Phase 3 before the remaining monorepo packages in Phase 4.
- Decision: single writer plus stale-head rejection implements the foundation; queue and explicit branch-fork policies are frozen interfaces reserved for later scheduling. Unsupported modes fail explicitly. This avoids silently inventing merge semantics; later scheduling still needs implementation.
- Decision: immutable supplied Pantheon snapshots remain tracked because the user explicitly uploaded them. New changes target `pantheon/`; seat-core remains historical.
