# Phase A authored-knowledge independent contract review

**Verdict: READY at `42ce113010fb3725fba04007af3f72e996d43555`; no blocking contract or guard findings.** This approves the reviewed authored-knowledge/dialogue-0.2 contract bytes against design `a366d8e88ac2ea48abf493ac792c1ebe3bb3faa9`. The coordinator owns the final combined Phase A barrier and runtime release. The model packet, bundled catalog/data helper, persisted activation integration and live disclosure host are not implemented or certified by this contract review.

Initial semantic source: `af9ce4030a386499d5bababa583c798f80e8f402`. Final `42ce113` changes only the freeze test to check the new freeze manifest and removes the manifest's temporary pending-status field. All five pinned contract/schema/source-manifest/types/guard files are byte-identical between those commits. The reviewed worktree remained clean and at the final identity during final checks.

## Findings

No unresolved blockers; no source edits requested. The final revision addresses the missing automated check of its own freeze manifest. No additional contract change is needed before the coordinator's combined acceptance.

## Trust and semantic checks

**Document and excerpt authenticity.** The bundled manifest pins both complete Markdown byte hashes and explicit inclusive line ranges with exact excerpt hashes. I independently recomputed all three entries against the actual QUICKSTART and ENCOUNTERS files; all document/excerpt hashes match. `assertAuthoredSourceBytes` requires the independently trusted canonical manifest hash, exact referenced document set, unique paths, consistent whole-document identity, valid ranges and exact excerpt bytes. It does not open caller-provided paths. Relative Markdown paths reject traversal, absolute paths, URLs and backslashes.

The catalog is separately pinned: `assertKnowledgeCatalogIdentity` verifies canonical catalog/manifest hashes plus exact pack identity, then checks every referenced source ID. `assertKnowledgeViewBinding` compares the entire selected projection to the pinned catalog in catalog order and only referenced metadata in manifest order. A real source hash cannot by itself authorize invented text or changed financial terms: changing them changes the pinned catalog, and changing only the emitted view fails exact projection comparison. The trusted pin source remains a privileged host/content-preparation responsibility, correctly documented rather than inferred from self-reported hashes.

**Owner, tenant and query binding.** Activation has a full rights/world/branch scope and a single owner; grants bind the complete actor query, catalog/manifest identities and activation hash. Registration requires owner/scope/acquired cursor to equal the verified current actor query. Reads reject foreign owner/scope, altered exact query, unknown IDs, selection outside activation, and policy validity failures. A valid pack/catalog for another tenant cannot replace the exact scoped activation/disclosure. Guard functions inspect passive DTOs before dereferencing caller fields and do not mutate inputs.

**Acquisition and no backdating.** Registration rejects an older, future or altered acquisition cursor. Reads require both acquisition sequence and world time to be no later than the requested cursor; equal sequence requires exact head/time equality. For an older sequence, ancestry remains an explicit trusted current-host attestation, not something two hashes prove. A catalog update needs a new reviewed identity and registered persisted activation. A runtime helper must not recreate or re-date activation on reads. The contract honestly states that this host state is not reconstructible from existing ledger history alone.

**Empty binding behavior.** Read-binding validation accepts absent activation, absent disclosure, or an empty selection as a no-knowledge case, but still validates any supplied binding. No such case can pass nonempty view certification; views require 1–8 claims and `assertKnowledgeViewBinding` requires both bindings plus a nonempty grant. The intended runtime representation is `actor_knowledge: null`, not an empty pretend acquisition or a fabricated activation. Invalid supplied owner/scope/selection still fails even if the companion binding is missing.

**Honest provenance and offer semantics.** Entries use only `offer_policy`, explicit loan terms and `authored_actor_policy` provenance. They contain no fabricated event IDs or ordinary acquired-memory claim. Structured fields distinguish zero fee/deposit, five-obol replacement and agreed actual-repair cap, borrower-supplied oil at one obol per six turns, agreed return, and no service/oath. Repair cap cannot exceed replacement value. The content does not establish acceptance, debt, consent, custody or canonical truth. The initial Melia catalog itself still requires reviewed Phase B data implementation; generic schema conformance cannot judge prose truth.

**Presentation and budgets.** Supplement 0.2 keeps actor knowledge separate from shared room fields and acquired experiences and binds its complete query and pack hash. Existing supplement 0.1 retains its exact original shape and rejects an injected actor_knowledge field. Schema and passive guards impose record, Unicode, depth/node and aggregate UTF-8 bounds. Valid selected records can still exceed a particular model request's configured context budget: Phase B must check the assembled packet before provider invocation and either fail closed or obtain a smaller authorized selection. It must not silently truncate an exact host-selected view after certification or send the full catalog/documents as fallback.

## Verification

On Node v24.22.1 at final source:

```sh
node --test --test-isolation=none TESTS/dialogue-knowledge.test.ts
npm run typecheck
```

**17 tests passed, 0 failed/cancelled/skipped; typecheck passed.** Logs: `knowledge-phase-a-tests-42ce113.log` and `knowledge-phase-a-typecheck-42ce113.log`. The suite covers independent strict schema compilation, all public DTOs' required/extra keys, passive attacks, exact source-byte verification, pins, registration and temporal limits, actor/scope isolation, missing/empty bindings, exact projection, old supplement compatibility and all relevant freeze hashes.

I separately verified all five new FREEZE entries and every bundled document/excerpt pin. A direct diff also confirmed unchanged v1 schema/freeze, character-v1, mortal-v2 and frozen campaign interface bytes. The final revision adds automated new-freeze verification without changing the reviewed semantic content.

| Frozen file | SHA-256 |
| --- | --- |
| SYSTEMS/dialogue-knowledge-v1/CONTRACT.md | 3fc976f9e2c875f950c46bcc9c793297196e874eefb4f26430a19a8641c29272 |
| SYSTEMS/dialogue-knowledge-v1/knowledge.schema.json | b336a195b7ec00e9ce78b980930262bbee91735ca228935ee2dfc79f6cb3cdf1 |
| SYSTEMS/dialogue-knowledge-v1/authored-sources.json | ca15ebcbe3d0bbaf2ee721df26f22b50abdcff93dc632c95c1af72d5b40fac97 |
| packages/contracts/src/dialogue-knowledge-types.ts | 582becd45418f9909c5ddf725b4e8a3773096b70d56e7e6312d7f5e6bacef13b |
| packages/contracts/src/dialogue-knowledge.ts | acf09f258bcfbfb0647fe1ea143d48e00b487644f952651bf8a0b6416b31b267 |

## Required Phase B evidence

The runtime review must prove fixed trusted assets/pins rather than caller-selected trust, persisted once-only current activation, correct missing-binding null behavior, exact host-selected projection, actual Melia terms in an injected-provider request, no private/referee/variant/sample leakage, model context budgeting before any call, version-specific packet/cache identity, and refreshed query/grant/activation/content checks before generation and delivery. Changed or revoked disclosure must suppress late generation. Existing silence and post-ANOMALY cutoffs remain mandatory; no ledger acquisition or causal write is created by loading authored policy.

This review does not certify production host authentication/entitlement, ancestor attestation, activation persistence, semantic truth of future authored catalogs, live model quality, old unsafe observation quarantine, unified mortal/character identity, migration, runtime correctness or full application-gate completion. No repository edits, spawned workers/subagents, provider calls or deployment were performed; only external review artifacts were written.
