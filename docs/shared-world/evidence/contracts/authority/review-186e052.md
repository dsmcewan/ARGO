# SW-100 authority contract review — fixed candidate

**READY for contract freeze within this independent authority/implementability review scope.** Both reproduced findings from `04bae2b1f5ccb5f570ee76231efe3104b1309243` are resolved in immutable candidate `186e052a19de6466aedaf048ecb5d9c4fd4fc1eb`. No remaining actionable finding or regression was identified in the reviewed delta. This is a contract verdict, not runtime/application acceptance; the coordinator still owns the combined review barrier and runtime release.

The same contract worktree was read-only throughout review: `/workspace/ARGO/.board/shared-world-contract/worktrees/SW-100-2-a51b1a9778`. Exact HEAD and clean status were checked before and after the tests. No source edits, spawned agents or paid/provider calls occurred. Prior reports and failing logs are preserved unchanged.

## Fresh evidence

- **9/9 unchanged independent probes passed:** [source](probes.mts), [fixed-candidate log](probes-186e052.log). The probe source SHA256 matches its initial failing-run record exactly.
- **25/25 authored contract tests passed:** [log](contract-tests-186e052.log).
- All four new FREEZE entries independently match the immutable candidate. The JSON schema and public type/API bytes are unchanged from the initial candidate; only guards, clarifying contract prose, tests/fixtures and updated freeze hashes changed.
- Exact source and evidence SHA256 values are recorded in [review-186e052.json](review-186e052.json).

## Resolution assessment

**C1 is fixed.** `bindGenesis` now handles Resolution by binding its nested State to the supplied genesis. Existing complete shape/state checks and latest-memory equality run first, then the same immutable identity checks apply as a direct State+genesis validation. Both independent mutations—changed controller and a wholly foreign internally coherent scope/genesis—now reject. This introduces no public trust bypass or nested revalidation exception.

**C2 is fixed.** The shared `impressionNature` check requires exact owner ID, immutable profile revision and nature content. State and ActorView call it; standalone Impression with supplied genesis now also binds known owner/subject and exact nature. The original invented revision-2 personality under a revision-3 genesis now rejects. Valid exact-revision impressions still pass.

The additional peer-requested fixes consistently bind owned-item immutable definitions, offered-memory source/world/issued-prefix/policy, known visible speech actors/addressees, and genesis-origin knowledge eligibility. Reviewed positive cases preserve permitted mutable activity, HP/resources, current location, equipment/custody and later event-origin grants. Durable issued offers remain valid context after current policy revocation. No new schema field, public API, dependency or historical-profile change was introduced.

The passing independent lifecycle probes still demonstrate that expired offers cease blocking a fresh offer, policy revocation does not erase an issued durable offer, dropped-item pickup can complete the original loan, request identity binds cursor/principal, and private recipients/host-only memory metadata remain refused.

## Remaining limits and next gate

The candidate still contains no shared-world reducer, signed journal implementation, SQLite store, view constructor, session or CLI. This review does not certify authentication, verified-current-prefix delivery, runtime witness derivation, full signature verification, physical/epistemic commit atomicity, actual exact-retry behavior, warm-history performance or operational rollback protection. These remain the explicit runtime obligations in the contract and original scoped report.

Full untrusted State validation intentionally scans supplied history; future reuse must use exact privately owned immutable verified object identities. No performance or linear cold-replay claim is inferred from these tests. The contract is ready for the coordinator's combined freeze decision and subsequent implementation review.
