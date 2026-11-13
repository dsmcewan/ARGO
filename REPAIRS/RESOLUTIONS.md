# Review repair resolutions

Baseline: `a9745e72e93d82c72e87f5159edd5c59f4c426c0`. The original review is retained in `REVIEW_2026-11-13.md`. This is a new repair record, not a rewrite of historical verification. No paid model calls. Frozen v1 bytes stay unchanged.

| Ticket | Findings | Scope | Current evidence |
| --- | --- | --- | --- |
| T-R100 | R02, R03, R11 | Board collision preservation, repeatable recovery, iterative DAG validation | Claimed; regression work in progress |
| T-R200 | R01 | Trusted controller includes complete board/research acceptance | Claimed; trust-policy repair in progress |
| T-R300 | R04, R05 | Subscriber checkpoint and DTO boundary checks | Claimed; regression work in progress |
| T-R400 | R07, R08, R09 | Shared cooldown, Google count serialization, public types | Claimed; regression work in progress |
| T-R500 | R14, R15, R16 | Ownership semantics, class-count clarification, closed historical save steps | Documentation corrected; independent review pending |
| T-R800 | Accepted candidates | Exact-commit integration and independent verification | Blocked on repaired lanes and reviewed application acceptance |

## Deferred decisions: no v1 implementation in this pass

All four remain BLOCKED on the unclaimed T-R900 decision hold. The hold's gate deliberately cannot pass; elapsed time cannot unlock it.

- **R06 / T-R906 — outcome binding.** Specify a versioned receipt carrying complete scope and a canonical full-proposal identity; define how the caller authenticates the authority, verifies receipt identity and handles legacy peers. Acceptance must reject a real foreign-namespace receipt even when proposal ID, sequence, time and action kind match. The existing v1 wire format lacks these fields; comparing only fields it contains cannot solve this finding.
- **R10 / T-R910 — identifier/map domain.** Choose either an explicit identifier restriction or a map encoding that supports the documented domain. Specify compatibility for persisted snapshots and old IDs before changing the frozen schema. Acceptance must reconcile every allowed proposal ID with canonical serialization, while unsafe property behavior remains fail-closed. Moving the same rejection earlier would not resolve the contract mismatch.
- **R12 / T-R912 — authenticated genesis.** Define a versioned genesis identity bound to signed history, or an independently authenticated import manifest, plus legacy export/import rules. Acceptance must reject modified untouched genesis balances under an unchanged expected history head. Existing `openLedger` supplied/file genesis checks remain valid; they do not establish standalone replay/import identity.
- **R13 / T-R913 — rollback assurance.** Decide the supported storage/restore trust model. Current authority assumes its private journal has not been rolled back by its storage operator; a valid prefix can omit a revocation. If rollback detection is required, choose an independently trusted monotonic checkpoint and explicit restore/reconciliation behavior. Another file in the same rollback domain is insufficient. If rollback detection is selected, acceptance must refuse a restored pre-revocation prefix before accepting new proxy actions.

## Board status versus external acceptance

The SQLite board records actual leases, immutable specs and disjoint path claims in `/workspace/ARGO/.board`. Its pinned v1 data-validator policy does not run application suites or permit self-modification of protected control code. This batch therefore has a fail-closed acceptance gate. Peer completion is not a MERGED transition; exact controller results and independently reviewed trust-policy migration must be recorded before any board reconciliation. No SQL status editing or fabricated different-vendor review is permitted.

These local review peers use supervisor-assigned host worktrees. Prefix locks coordinate their ownership; this does not claim that the peers themselves ran through `dispatch.py` filesystem confinement. The confined dispatcher remains separately tested offline.
