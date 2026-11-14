# Shared-world contract privacy and identity review

Candidate: `04bae2b1f5ccb5f570ee76231efe3104b1309243` at `/workspace/ARGO/.board/shared-world-contract/worktrees/SW-100-2-a51b1a9778`.

**Verdict: CHANGES REQUIRED before contract freeze.** Twenty author contract tests pass. Twenty independent checks yield 14 passes and six reproducible failures of intended rejection. These are contract-validation defects; no runtime exists in this candidate, and this review does not claim a deployed authorization exploit.

The four freeze hashes match. Historical argo-v1, character-v1, mortal-v2/v3 and authored-knowledge-v1 schema/type/guard bytes are unchanged from `3fd1e4d99eede6853f62b8078e5921183a9f048c`. Candidate SHA and clean worktree status were checked before and after probes. No repository changes, nested agents, paid calls or authority writes.

## Findings

### P1 — Resolution's supplied genesis is never applied to its nested state

`packages/contracts/src/shared-world.ts:302` validates `Resolution.state` using the context-free `state()` helper. `bindGenesis()` has no `Resolution` case, so the later context step adds no nested reference checks.

Reproduction: take the valid offered-state fixture; change `state.physical.actors[0].controller_id` to `attacker`. `assertWorldContract('State', state, genesis)` correctly rejects. Wrap the same state in `{state,draws:[],effects:[],memory:state.memories.at(-1)}` and `assertWorldContract('Resolution', wrapped, genesis)` accepts.

Impact: the composite guard promises optional immutable genesis checks but accepts a nested authority/controller change that its constituent guard refuses. Future lanes must not build a trusted-object registry around this incomplete check. Apply genesis binding recursively to nested State (and retain its memory consistency check).

### P2 — Genesis-bound ActorView accepts changed immutable item definitions

`packages/contracts/src/shared-world.ts:273` checks only that each visible item ID exists in genesis. Unlike State validation at line243, it never compares immutable item properties.

Reproduction: change the hero's spear name to `FORGED ITEM NAME` and damage die from6 to8 in a valid ActorView. Passing the original genesis still accepts the view. Its owner and ID remain unchanged.

Impact: a supposedly genesis-bound own-inventory view may present invented fixed item data. Compare name, slots, kind, damage die, ability, armor and tool against the corresponding genesis item, while leaving mutable custody/equipped fields to state/projection verification.

### P2 — Visible offer terms can belong to a different genesis

`packages/contracts/src/shared-world.ts:182` verifies offer hashing and reader membership, but does not compare `terms.genesis_hash` with the ActorView's genesis. The optional ActorView binding at lines262–273 does not visit memory terms.

Reproduction: change `worldOffer().terms.genesis_hash` to64 `f` characters, recompute its valid offer hash, insert it into an otherwise valid hero-visible `loan_offered` record. The ActorView guard accepts it with the original genesis supplied.

Impact: the same DTO asserts one world while its acquired offer asserts another. Reject this locally provable contradiction; optionally bind visible offer policy/owner/item/checkpoint to the supplied genesis as well. This requires no proof of current acquisition.

### P2 — Visible speech can omit its actor source

`packages/contracts/src/shared-world.ts:178` applies visibility restrictions without the raw-memory direct-source checks at lines100–104. A visible `speak` record with `actor_id:null` passes ActorView validation even when genesis is supplied. The code also lacks a genesis actor-reference check for visible memory authors.

Reproduction: insert a one-record room-speech payload into a valid actor view with proper sequence/coverage but null author. Validation accepts it. The raw Memory guard requires a direct actor for the same payload.

Impact: the presentation contract admits unattributed speech despite its authenticated-speaker design. Share the locally decidable payload/source checks between raw and visible memory, and reject unknown actor references when genesis is supplied. The probe's null-source rejection fails first; unknown-source absence is corroborated by code rather than an additional passing probe iteration.

### P2 — A fabricated older nature bypasses immutable profile binding

`packages/contracts/src/shared-world.ts:199` checks nature equality only when impression revision equals profile revision; smaller revisions are accepted. State uses the same rule at line144. This successor has no profile/nature-changing action, and its contract explicitly makes revision/nature immutable.

Reproduction: create a valid genesis whose hero profile revision is2; create a bound hero view with an impression claiming revision1 and unrelated `nature:{description:'Fabricated prior nature',priorities:['forged']}`. The guard accepts it.

Impact: model context can present an impression as grounded in a nature that never existed in this fresh world's immutable profile. Require equality with the owner's fixed revision and nature for this version; supporting real historic revisions would require an explicit history contract.

### P2 — ActorView can invent an initial knowledge activation

`packages/contracts/src/shared-world.ts:271` compares returned entry bytes to the catalog, but never requires `origin:'genesis'` acquisitions to belong to `genesis.initial_knowledge_ids`. State performs this check at line248.

Reproduction: use a genesis with the same policy catalog but an empty initial grant list. Build its correctly rehashed sequence-zero view while retaining the policy's `{origin:'genesis',sequence:0,world_time:0,active:true}` acquisition. ActorView validation accepts.

Impact: at the known initial prefix, the view contradicts the genesis's explicit grant set. Match genesis-origin acquisitions to initial IDs. Later acquisition/current-prefix authenticity remains a separate runtime responsibility.

## Passing checks and preserved boundaries

- Full rights/scope grammar, complete expected cursor and causation binding.
- Request hash binds command and principal while making no authentication claim.
- Private request IDs/acquisition rosters removed from visible memory; receipts reject effects.
- Travel endpoints suppressed; third holders cannot receive full loan identity, and redacted custody facts are accepted.
- Owner-only private records, exact source metadata, knowledge ownership/validity/active state and catalog/source pins.
- Closure suppresses retained dialogue context.
- Offer owner/item/cap, hash, strict expiry, lender custody and standing checks.
- Full-history response dedup after an inbound falls outside the32-record context window.
- Passive hostile values fail without invoking getters/proxy traps; reserved IDs and exact encoded-byte overflow fail.

The contract explicitly leaves exact current-prefix authentication, current grant/witness derivation, signatures, transitions and delivery to the future runtime. Acceptance of a self-described detached current view is not itself reported as a defect. The findings above concern contradictions that are already decidable from the DTO and optional genesis provided.

## Reproduction and artifacts

```
node --test --test-isolation=none TESTS/shared-world-contracts.test.ts
node /path/to/probes.mjs /path/to/clean-candidate 04bae2b1f5ccb5f570ee76231efe3104b1309243 /path/to/output
```

`contract-tests.log` records all20 named author tests. The ordinary outer-sandbox subprocess run in `contract-tests.initial.log` reported only a file-level result; it was not counted as20 executed subtests. The same file was run with Node's no-isolation test option to expose the actual tests without modifying repository code or test assertions. This is scoped test execution, not a controller gate.

`probes.mjs` is the portable independent check suite; `probe-results.json` and `probes.log` retain all14 passes and six expected-rejection failures. The script exits1 for those failures. `verification.json` records candidate/source/artifact hashes.
