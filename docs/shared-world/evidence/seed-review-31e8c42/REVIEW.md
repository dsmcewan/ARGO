# Independent shared-world seed review

Candidate: `31e8c428472a0130fc75e46ce156dd5bddc0c534` at `/workspace/ARGO/.board/shared-world-foundation/worktrees/SW-500-1-a9f62992bf`.

**READY for seed-only integration.** No blocking defect found. All37 named tests pass (12 seed tests plus25 frozen-contract tests);11 independent portable checks pass. Exact candidate SHA and empty worktree status verified before/after. The change adds only the seed implementation, its documentation and its tests. No source edits, paid calls, nested workers or storage/authority writes occurred in this review.

Verified independently:

- Fixed pack/catalog/source identities and actual document/excerpt bytes authenticate against their manifests. Changed pack content, changed source bytes and caller-selected replacement pins are rejected.
- One safe actor/item namespace rejects authored, generated and cross-kind collisions even when the kit would remove the colliding lamp. The generated firekit suffix bounds traveler IDs to56 characters;56 works and57 fails.
- All three variants exclude Fate actors and loom locations/routes from the mortal roster and profiles. Any measure-cup prop is ordinary loot in this adapter; no lifespan/thread authority is introduced.
- Melia owns the exact curated loan policy: zero fee/deposit, replacement/repair cap5, agreed actual damage, borrower oil at1 obol/6 turns, explicit return, no forced service/oath. Initial grant selection is explicit; an empty selection remains empty. Seed construction creates no offer, loan, consent or custody transfer.
- NPC/traveler profiles remain owner-specific. Public descriptions are selected once per physical location; private knowledge arrays, sample speech, referee notes and variant-truth prose are excluded.
-24 combinations of variant, HP mode, environment and kit match the unchanged mortal-v3 factory except documented route lighting and personal-lamp removal. Six travelers retain every other resource/equipment item; Melia retains her authored `traveler_lamp`.
- Direct pure mortal resolution rejects night travel without a held lamp, allows it after a separately authorized fixture transfer, and consumes the expected oil/world time. Day travel needs no lamp. This verifies initialized mechanical fields, not the forthcoming shared loan transaction.
- Hostile accessors/proxies, malformed options and private-key PEM are rejected without executing traps. Results are detached/deeply frozen; caller data remains mutable and unchanged.
- Shared, mortal-v3, character-v1, authored-knowledge and campaign freeze hashes match. Only the three assigned new files differ from frozen runtime baseline `8ff20160fcd949a64e5e11c356d5de57d769983e`; old factories and profiles are byte-identical.

Two documented integration constraints remain: the returned manifest includes `variant` and is host metadata, not an actor-context payload; authored public scene prose mentions initial NPC activity and must never establish current occupants, activity or custody after movement. Current authority projection must govern those dynamic facts. They do not block this seed-only change.

No claim is made about public package-export integration (coordinator pending), authenticated current views, witness acquisition, receipt binding, dialogue quality, shared persistence/replay or runtime performance. Those require their own exact integrated-candidate checks.

Evidence: `tests.log`, `probes.mjs`, `probes.log`, `probe-results.json` and `verification.json`. Reproduce with `node --test --test-isolation=none TESTS/shared-world-campaign.test.ts TESTS/shared-world-contracts.test.ts`, then `node probes.mjs <clean-checkout> 31e8c428472a0130fc75e46ce156dd5bddc0c534 <output-dir>`. No-isolation mode exposes the actual named subtests in this outer sandbox; this review does not substitute for a controller gate.
