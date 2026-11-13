# Projection Contracts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Deliver an additive reviewed projection/query contract profile with executable adversarial coverage and unchanged gameplay v1.

**Architecture:** Follow the prior headless design and [exact interface](../../projection-contracts/INTERFACE.md). Root is the sole repository writer; flat read-only peers stage schema, runtime and independent oracle contributions in temporary files. The data board coordinates the staging branch; the separately trusted full application controller gates main.

**Tech Stack:** Node24, TypeScript5.9, existing Ajv8.17.1, Python3 stdlib generation; no dependency additions.

**Spec:** docs/design/headless-2026-11-13/temporal-storage.md and docs/projection-contracts/INTERFACE.md.

## Global Constraints

- No paid runs, deployment, persistent graph, bus, history migration or live-provider authenticity claim.
- Preserve all frozen v1 bytes and current ledger/bridge behavior.
- Use exact full scope, acquisition time, ledger prefix and current-policy separation; one v1 tick remains one second.
- New identifiers retain the v1 grammar and use sorted entry arrays; no renaming old signed history.
- Shared contract edits serialize under PC-001. Native peers are not a claimed cross-vendor pipeline.
- Current policy/source ancestry authenticity are trusted host responsibilities. Schema fields do not authenticate providers or event linkage.

## Review Focus

- Foreign or missing actor/tenant/rights/party authority must fail at runtime, with no private-observer/provenance metadata in public output.
- Historical interval revisions and equal-tick changes must retain prefix-specific results; unavailable or mixed checkpoints fail.
- Current cutoff must withhold public claim payload even for historical queries; v1 remains untouched.
- Mutable/accessor/proxy/deep DTOs cannot execute getters or mutate accepted outputs; bounded data tuples avoid iterator code.
- New test/generator policy is independently reviewed and pinned; a structural board pass does not imply application behavior passes.

## Task 1: independent negative oracle

Files: TESTS/projection-contracts.test.ts, TESTS/projection-fixtures.ts (new only).
Consumes: exact interface above. Produces: named tests for real schema/runtime API plus frozen v1/manifest/generator checks.
- [x] Write independent positive and negative fixtures/tests before product integration.
- [x] Run node --test TESTS/projection-contracts.test.ts; expect failure because the new module is absent. Preserve RED evidence.

## Task 2: schemas, generated types and guards

Files: SYSTEMS/proposals/headless-v2/projection-v2.schema.json, packages/contracts/src/projection-generated.ts, projection-v2.ts, additive index.ts exports, scripts/generate-projection-types.py.
Consumes: oracle and exact DTO/function definitions. Produces: closed versioned schemas, generated types, context-bound runtime guards and pure reference selectors.
- [x] Integrate schema/generator/runtime after RED, generate types, and run focused tests plus typecheck.
- [x] Fix actual defects; retain adversarial oracles. Run generator --check.
- [x] Record GREEN counts and limits; no graph or source-verification claim.

## Task 3: independent review and bounded freeze

Files: SYSTEMS/proposals/headless-v2/CONTRACT.md, FREEZE.json; docs/projection-contracts/profile.json, README.md, progress.md; roadmap updates.
Consumes: green contract candidate. Produces: independently reviewed local profile and explicit compatibility/reliance conditions.
- [x] Review exact code/schema/oracle and current-policy/temporal boundaries independently.
- [x] Address material findings with failing regression cases before fixes.
- [x] Pin schema/protocol hashes in FREEZE.json and the manifest digest in the independently reviewed test policy; rerun focused checks.
- [x] Update roadmap only for the verified local scope; keep deferred authority/storage guarantees explicit.

## Task 4: actual acceptance and save

Files: docs/projection-contracts verification/board records.
- [ ] Upload candidate-matching CAS outputs; submit, run the pinned data gate and merge only the isolated staging branch.
- [ ] Record actual board state without fabricated cross-vendor review or general application adapter claims.
- [ ] Promote the independently reviewed TESTS/script policy into a separate immutable trusted checkout. Preserve prior policy bytes.
- [ ] Run all ten required checks through the actual trusted controller on the exact final candidate and integrate main only on success.
- [ ] Push main non-forcing, verify remote identity and report CI honestly.

## Rulings and scope

User continuation authorizes this next contract work from the previously reviewed design; no repeated design-approval question is necessary. The supervisor selects TypeScript/Ajv and conservative local DTO bounds, not a new storage vendor. Public v2 cutoff withholding is deliberately stricter than the v1 payload-plus-flags interface and must be documented/tested. Storage implementation and production D07/D06 providers remain later prerequisites. Use the user-requested blackboard and retained progress record as the execution ledger; do not replace them with hidden agent completion claims.
