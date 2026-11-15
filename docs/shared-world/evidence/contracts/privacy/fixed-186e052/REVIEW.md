# Shared-world contract fix verification

Candidate: `186e052a19de6466aedaf048ecb5d9c4fd4fc1eb` at `/workspace/ARGO/.board/shared-world-contract/worktrees/SW-100-2-a51b1a9778`.

**READY for the shared-world contract's scoped privacy/identity review.** The unchanged independent probe suite passes20/20; the expanded author suite passes25/25. All six findings in the initial `04bae2b` review are resolved, and no new blocking issue was found in the targeted fix delta. This is a native-peer contract review, not a runtime, deployment, cross-vendor or merge-controller approval.

## Verified fixes

1. `Resolution` now recursively binds its complete nested State to supplied genesis. Altered controller, scope, immutable item and profile fields are rejected consistently with the direct State guard.
2. ActorView own-inventory entries compare immutable item definitions to genesis, while valid mutable custody/equipped changes remain permitted. Existing self/profile/route immutable checks remain intact.
3. Visible offer records bind their enclosing world, lender/source, issue sequence/time, hash, known parties, policy owner/item/cap and return-location references. Durable offered terms remain valid context after current policy revocation.
4. Visible speech rejects null/unknown actor sources, self-addressing and direct self-reply identity. Known actor/addressee references are checked with genesis.
5. State, ActorView and genesis-bound standalone Impression require exact immutable owner nature/revision; fabricated earlier revisions are rejected.
6. ActorView genesis-origin acquisition requires membership in the initial grant set at every prefix. A valid later event-origin acquisition is still structurally representable.

The original passing privacy, rights, passive-input, strict expiry, full-history response dedup, source-pin, closure and redaction checks still pass. No schema/type/API change was made in this fix. The delta changes only the helper guard, corresponding contract explanations and freeze pins, plus additive fixtures/tests.

## Identity and evidence

- Exact candidate SHA and empty worktree status checked before and after the independent suite and again at report creation.
- Four declared freeze hashes match their files.
- Historical argo-v1, character-v1, mortal-v2/v3 and authored-knowledge-v1 schema/type/guard bytes remain unchanged from `3fd1e4d99eede6853f62b8078e5921183a9f048c`.
- The original `../probes.mjs` bytes match the initial review's recorded SHA256; it was rerun without changes. Its initial six-failure evidence remains in the parent report directory.
- `contract-tests.log`:25 named tests,0 failures, using `node --test --test-isolation=none TESTS/shared-world-contracts.test.ts` so this outer sandbox exposes all actual subtests.
- `probe-results.json` and `probes.log`:20 independent checks,0 failures; no paid calls or repository edits.
- `verification.json`: candidate, source, probe and artifact hashes.

## Remaining runtime obligations

The guards do not authenticate a principal, prove that a detached state/view is the latest verified prefix, derive real witnesses, validate signatures, perform transitions, or demonstrate atomic persistence. Those remain the explicit next runtime lanes and their gates. Genesis/source hashes do not prove authorship or entitlement. Request construction, model quality and live providers were outside this contract review.
