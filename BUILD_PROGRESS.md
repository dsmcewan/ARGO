# ARGO foundation progress

Plan: `docs/superpowers/plans/2026-11-13-argo-foundation.md`.

- Phase 1 complete at `3e3ad3a`: 840 verified blobs; 525 classified modules; no missing active Pantheon relative imports; parse-only checks pass. Audit saved to GitHub main at `bc875b2`.
- Isolated implementation branch: `argo/foundation-spine`, worktree `.worktrees/foundation`.
- Task 1 complete: 36 schema definitions and service/mechanics contracts frozen in SYSTEMS/CONTRACT_FREEZE.json. JSON Schema 2020-12 metaschema and local references pass; valid example accepted and five malformed/unsafe variants rejected. Phase 3 may start.
- Baseline: `node --test tests/*.test.mjs` in Pantheon: 71 file-level results, 50 pass/21 fail. Direct repro identifies hardcoded missing `/usr/bin/node` and restricted Bubblewrap NETLINK_ROUTE permissions. This was the pre-change baseline; the current result is below. Logs are `/tmp/argo-pantheon-baseline.log`, `/tmp/argo-baseline-run-item.log`.
- Preflight interfaces: Tasks 1→3→4 use the same proposal/query/outcome schemas; Task 2 is reusable provider transport only and does not depend on gameplay writes. Model package may be introduced in Phase 3 before the remaining monorepo packages in Phase 4.
- Decision: single writer plus stale-head rejection implements the foundation; queue and explicit branch-fork policies are frozen interfaces reserved for later scheduling. Unsupported modes fail explicitly. This avoids silently inventing merge semantics; later scheduling still needs implementation.
- Decision: immutable supplied Pantheon snapshots remain tracked because the user explicitly uploaded them. New changes target `pantheon/`; seat-core remains historical.

- Phase 3 complete: reusable model policy, active API routing, explicit credential pools, concurrent v2 cooldowns, terminal-error handling, completed-response checks, signed compaction generation recovery, async subprocess bounds and sandbox Node portability. Full offline suite: 728 tests passed (0 failures); the later OAuth-beta/compaction regression and affected SDK suites also passed. Google long decode exercised the pinned SDK HTTP serializer, not only an adapter mock. No live vendor calls.
- Offline CLI acceptance now uses explicit help fixtures; this does not certify installed CLI binaries. Bubblewrap and subprocess tests were run with the execution permissions needed for Linux namespaces and pipe observation; no isolation gate was removed.
- Phase 4 is next. The signed ledger, bridges and Test Zero have not been implemented yet.

- Phase 4 ledger step implemented sequentially: pinned workspace, generated TypeScript contracts, full Ajv validation, Ed25519 event signatures, private seeded RNG, durable append/fsync and cross-process lock/CAS. Consent and proxy lifecycle tests pass; independent processes accept one competing checkpoint. Durable incremental snapshots match signed replay. Schema freeze and typecheck pass. Deterministic ledger gate passed before bridge implementation (`/tmp/argo-ledger-gate.log`).
- Controller bootstrap added: trusted oracles and dependency manifests are selected by an external immutable commit binding; candidates cannot nominate their own policy. Bridge/scenario work is still pending.
