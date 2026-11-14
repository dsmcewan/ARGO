# SW-200 independent authority review

Candidate: `4774dfb6d44145183f6c7760d032728aa6a84739`. Base: `8ff20160fcd949a64e5e11c356d5de57d769983e`. Source worktree: `/workspace/ARGO/.board/shared-world-foundation/worktrees/SW-200-1-d8fbe5da6f`. Review completed read-only against the exact clean candidate. The source was checked before testing and again after probes/performance completed; later author repairs are outside this report. All source hashes in `review.json` come from immutable Git objects. No checkout edits, nested agents, provider calls, or network operations were performed.

**Authority lane clear; overall candidate changes required.** No additional authority/correctness blocker was found. The parallel [privacy review](../rules-privacy-review-4774dfb/REVIEW.md) reproduced one blocking loan-return defect: an ordinary transfer can fulfill a loan to an already unconscious lender and record acquisition by that lender. The relevant compound branch is `packages/ledger/src/world/rules/engine.ts:196`, with unconditional lender inclusion at line 135. The coordinator selected a contract-preserving repair that rejects this narrow ordinary transfer atomically. That fix is not present in this candidate and requires a subsequent exact-source review.

## Evidence and strengths

The authored rules/views suite passed **30/30** (`authored-tests.log`). Independent probes passed **11/11** (`probes-4774dfb.log`), with each successful functional transition rechecked against the complete genesis-bound State and Resolution guards. The probe harness supplies deterministic synthetic heads explicitly; it does not claim signed-journal replay.

1. Direct frozen mortal-v3 oracle agrees with the shared adapter at both sequence-zero physical-first and social-first prefixes for physical bytes, RNG draws, effects and time.
2. Full scope, actor/controller/role, expected sequence/head/time and causation mutations refuse. Rejected request IDs remain usable. Caller freezing does not confer owned-cache trust.
3. Durable offer consent binds owner policy, exact item, capped terms and named borrower. Revoking policy blocks new issuance while preserving an already-issued offer. The outer acceptance memory remains borrower-authored; only the internal exact transfer capability uses the lender.
4. A real post-offer purchase fills borrower capacity. Acceptance refuses without custody, offer, loan, time or RNG change; after a real resource transfer frees capacity, the same rejected request ID succeeds.
5. Another actor's wait advances the shared expiry clock. Exact expiry refuses; custody loss permanently invalidates an offer even after the lender recovers the item.
6. Third-party possession, drop and pickup fulfill only the original obligation. A later fresh loan works independently, while the original returned loan cannot be returned again.
7. Social actions and a remote wait preserve the combat turn token. Foreign or stale recovery refuses; valid close charges exactly six seconds per round participant without additional RNG.
8. A mixed sequence of social, loan, physical, activity and closure actions reproduces exactly through cold cloned inputs and owned inputs, including state digest.
9. Immutable fork indexes retain independent requests, replies and prior views. Mutation attempts and foreign-genesis state reuse refuse; unregistered frozen clones cannot use private head finalization.
10. NPC reply deduplication survives more than 32 visible records, cold re-entry and failed attempts.
11. A near-16-MiB host input is validated, then converted into an owned prefix by a real transition. Loan acceptance fails at the aggregate limit after mechanical computation; custody, obligations, offer status and prior digest remain unchanged. A shorter action can reuse the rejected request ID, proving no partial index publication. The large setup history is explicitly shape-valid synthetic host input, not claimed signed history.

The eight-file diff adds the new layer without changing frozen contracts or earlier mortal implementations. Private caches recognize only detached owned identities, keep mutable Map/Set indexes private, and register a newly resolved state only after complete growth checks. Old branches retain independent immutable indexes.

## Measured pure-call performance

`performance.mts` generated actual pure transitions up to 1000 records, using owned genesis/state and synthetic head finalization. Each sampled prefix passed the cold State guard. Nine samples per prefix yielded these medians in milliseconds:

| Records | Cached hash | Actor view | New resolution | New hash |
| --- | ---: | ---: | ---: | ---: |
| 128 | 0.0012 | 5.82 | 2.57 | 2.17 |
| 512 | 0.0021 | 4.90 | 2.58 | 11.22 |
| 1000 | 0.0027 | 5.64 | 2.65 | 24.53 |

The measurements support reusable unchanged-state hashes and bounded indexed views. Newly computed state hashes still scale with history; generating all 1000 transitions took about 20 seconds in this run. This is a pure in-process measurement, not a storage throughput, event-loop, worker, RPC or provider claim. Cold repeated replay can remain quadratic as the implementation documentation states.

## Reproduction

```sh
ARGO_SW_ROOT=/path/to/exact/candidate node --test --test-isolation=none /workspace/reports/2026-11-14-argo-shared-world/rules-authority-review-4774dfb/probes.mts
ARGO_SW_ROOT=/path/to/exact/candidate node /workspace/reports/2026-11-14-argo-shared-world/rules-authority-review-4774dfb/performance.mts
```

The probes import only committed fixture construction and the candidate APIs; their scenarios and assertions are external review artifacts. The performance harness additionally uses the committed command/query helpers.

## Not adjudicated here

Signed event/receipt creation and cryptographic replay, durable current-prefix membership, exact persisted retry semantics, concurrent journal writers, lost acknowledgements, crash/COMMIT atomicity, worker cancellation/event-loop behavior, production RPC envelope bounds and storage rollback/tamper anchoring await SW-300. Shape-valid raw state admission is not signed-history authentication. The parallel review owns broader actor-privacy coverage. No provider or live-service claim follows from this review.
