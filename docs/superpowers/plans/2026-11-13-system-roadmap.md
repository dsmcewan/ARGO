# System documentation Implementation Plan

> For agentic workers: use the writing-plans verification/handoff discipline. This authorized pass writes documentation only; runtime execution of roadmap items requires separately reviewed subsystem plans. Keep flat peers and no paid runs.

**Goal:** Give a new contributor a source-backed account of current ARGO, the target system, available data, missing capabilities and the dependency spine.

**Architecture:** One human-readable system roadmap plus a matching non-executable JSON dependency map. Preserve normative frozen contracts, source inventories and historical verification; link them instead of replacing them. Register this documentation ticket in a fresh SQLite board batch.

**Tech Stack:** Markdown, JSON, existing stdlib Python data gate, Git and current board/controller.

**Spec:** docs/roadmap/DOC-001.md and the user's system-documentation request.

## Global Constraints

- No paid vendor runs, runtime feature changes, deployment or v1 contract edits.
- Existing forensic LEXI and build TELOS are not deployed gameplay services.
- Proposed components, missing data, unresolved designs and future tests stay labeled.
- The old repair board is retired; use a fresh immutable documentation batch.

## Review Focus

- Avoid conflating gameplay ledger, build SQLite and historical LEXI tables.
- Do not present declarations, mocks or starter research as live data or executed vendor research.
- Preserve four deferred repair decisions and the application-gate limitation.
- Expose dependencies and genuine parallel opportunities without dispatching unspecified implementation.
- Keep the next steps evidence-backed, with concrete outputs and acceptance criteria.

## Task 1: System roadmap and dependency map

Files: SYSTEM_ROADMAP.md, docs/roadmap/system.json; navigation updates in README.md, AGENTS.md and STATUS_AND_ARCHITECTURE.md.

- [x] Reconcile actual components/storage/tests and existing research evidence against baseline eb2d4c5.
- [x] Document present and target boundaries, data availability, decisions, ordered work and deterministic acceptance.
- [x] Validate IDs, dependency references/acyclicity, evidence paths, link navigation and unchanged frozen bytes.
- [x] Obtain independent semantic review; submit the exact documentation commit to the pinned data gate.
- Publication/main acceptance is recorded by the final Git commit and its Actions run; this checklist records the completed documentation and board-gate task.

DOC-001 passed its pinned data-only gate and reached real MERGED at `cf7fa02dbbd0520b20a5e278c4bd58086426f40d`. Independent review and the sanitized CAS/audit record are in `docs/roadmap/verification.json`. The roadmap remains non-executable; no runtime work was dispatched.
