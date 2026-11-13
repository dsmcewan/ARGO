# Resume ARGO's strict dependency spine

**Current continuation:** Read `../BUILD_PROGRESS.md` and `AUDIT_STATUS.json` for implementation and validation status. The audit and schema freeze are complete; the remainder of this document preserves the original extraction itinerary. Do not repeat it or treat its former source blocker as current.

**Historical update:** Phase 1 static source audit passed after Pantheon was supplied at ARGO commit `6f75c29c8e66df2c76996c33b763390807d62bda`. Read `PANTHEON_AUDIT.md` and `AUDIT_STATUS.json`. The missing-source section and scout prompt below are historical. Next: freeze SYSTEMS/MECHANICS, then patch the active `pantheon/` API path, then build the foundation. Optional local CLI installations are not required for the injected offline API path.

The user authorized four phases in order: read-only extraction → SYSTEMS/MECHANICS schema freeze → actual harness model/router patch → sequential ledger/bridges/Tempted Fates foundation. Parallel implementation lanes may start only after the spine passes. This authorization persists; do not ask for another generic permission to continue.

## Current result

Read `../REPO_INVENTORY.md` and `evidence/extraction-summary.json`. 567 source files match their Git blob hashes. All 418 cataloged source modules have a proposed reuse classification. 170 LEXI route declarations and 114 model classes were extracted statically. Source snapshots were under `sources/` in the original cloud workspace and are excluded from this Git archive. Rehydrate the pinned sources before rerunning extraction. No production code was changed or live model call made.

LEXI is a forensic FastAPI/SQLCipher application with one shared identity. TELOS is a build gate with signed provenance and build/proposal ledgers. Neither is already the specified gameplay authority/knowledge service. Do not erase this distinction in the architecture.

## Blocking source

LEXI references Pantheon at `/home/colchis/Projects/pantheon`; this checkout and an accessible GitHub Pantheon repository were not found. `claude-config` contains only allowlisted pieces of installed workflows. User was asked for an accessible Pantheon URL/path. This is the remaining source blocker.

The user supplied `ARGO_Tempted_Fates.md`. Its byte-identical retained copy is `../SCENARIOS/Tempted_Fates.md`; source identity is in `evidence/tempted-fates-source.json`. Read `SCENARIO_REQUIREMENTS.md` and the source before designing Integration Test Zero. The scenario-source blocker is resolved. Core canon includes independent Fate jurisdictions, honest informed gifts, no automatic youth/reward, optional encounters and post-anomaly disengagement without explanatory epilogue. The polished dialogue is conditional, not a fixed trigger script. Ordinary Fate speech about their work remains possible after disengagement; renewed engagement with the traveler does not.

## Read-only scout prompt for Pantheon

> Inspect the supplied Pantheon repository without modifying source, installing/upgrading dependencies, starting services, running builds, using model pools, or reading secret values. Pin the Git commit and record dirty state without discarding changes. Read applicable AGENTS.md instructions. Extract exact contracts and source references for `src/view/build-server.mjs`, `src/board/run-item.mjs`, `src/sdk/adapter.mjs`, `src/route/cooldown.mjs`, and their reachable routing/orchestration dependencies. Trace ticket input through stages to deterministic acceptance and settlement. Inventory every runtime module as Expose As-Is, Wrap via Adapter, or Build Net-New; distinguish source observations from documentation claims. Map all subprocess launches, blocking calls, cancellation paths, output limits, sparse worktree creation, copy/ownership manifests, 429 routing/pool state, model IDs, request parameter builders, token accounting, and continuation/compaction handling. Inspect the complete dependency closure, including installed-package sources referenced by claude-config. Do not execute its probe scripts or launch overnight workers. Compare the consumer ticket and cooldown schemas against LEXI's producer contracts. Record missing facts explicitly; do not fill them from model memory. Return a delta to REPO_INVENTORY.md with pinned paths/lines and concrete verification commands for later phases.

## Remaining gates

1. Finish the above audit. Review lexical missing-import candidates manually; test strings are not dependency failures. If repositories advanced, retain old evidence and explicitly repin new source.
2. Freeze ARGO service schemas only after Phase 1 completes. Preserve the user's stateless gateway/DM, causal+epistemic commits, untrusted NPC/intervention proposals, rights-scoped namespace, actor acquisition cutoffs, encounter checkpoint/conflict policy, and proxy/consent requirements. Choose one exact canonical codec and ruleset interface. Record schema hashes and code ownership. Do not treat TELOS's limited schema validator as full JSON Schema.
3. Patch the actual harness in an isolated checkout against the frozen contracts. Start with the official-source findings in MODEL_API_AUDIT.md. Verify model/transport compatibility; Gemini's 65536 target requires more than changing a numeric cap on raw non-streaming HTTP. Package the client for ARGO reuse. Pass offline payload/error/429/cancellation/token/continuation tests before any overnight run. Keep controller merge decisions deterministic and candidate-bound.
4. Build the requested standalone `argo` monorepo sequentially: contracts → immutable authoritative ledger → deterministic reducer/replay → async bridge clients/mocks → canonical Tempted Fates test. Include the requested package boundaries, bible and ownership manifests. Unknown legacy services remain mocks/new adapters, not fictitious deployed APIs.
5. Only after the spine passes, partition feature work by disjoint ownership and immutable contract versions. Shared ledger writes belong to the authority/controller, not worker lanes. Any independent review is advisory; successful deterministic checks establish the claimed gate evidence.

## Reproduce the extraction

From the ARGO repository root: `python3 repo-audit/extract_inventory.py`

First rehydrate the exact source files listed in `evidence/source-manifest.json` beneath `repo-audit/sources/<repo>/`. The extractor verifies every required blob before it can rewrite derived catalogs. It then reads snapshot source and rewrites only derived audit catalogs. It never imports the application, accesses LEXI's database, starts Pantheon or invokes a vendor.
