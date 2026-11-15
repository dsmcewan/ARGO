# Preliminary shared-world contract review

Read-only review of the mutable SW-100 draft under `/workspace/ARGO/.board/shared-world-contract/worktrees/SW-100-1-e257d63310`, against the coordinator's later `docs/shared-world/DESIGN.md` in `/workspace/ARGO/.worktrees/shared-world`. This is preliminary advice, not approval or a frozen-candidate verdict. No repository edits or paid calls.

## Notes communicated before freeze

1. Visible memory inherited caller-chosen `request_id`, although `record_id` already identifies evidence. Remove transport metadata from actor/model views.
2. A single mortal payload reaches witnesses at source-before and destination-after. Both route endpoints are not necessarily observed by both audiences; avoid disclosing them through `location_ids`.
3. A later holder returning a found/received item may not know its original loan or borrower. A raw `loan_returned` payload discloses this private history. Redact the uninformed holder's view while preserving actual loan participants' acquired record.
4. Specify strict expiry, replacement after expiration, permanent offer-ID uniqueness, and the effect of later policy revocation. Match offer owner/item/cap to its source policy and current lender custody. Automatic withdrawal on lender custody loss or nonstanding addresses stale consent.
5. Define bounded `replied_to` as relevant returned inbound IDs, while enforcing one reply against complete history.

No obvious circular hash or identifier-grammar issue was found in the design: memory IDs bind genesis/request/sequence; offers hash immutable terms; genesis acquisitions avoid embedding their enclosing genesis hash; state hashing excludes its newly signed event head. Mortal and authored-knowledge IDs both use a safe 96-character grammar. Campaign-derived identity collisions must still be rejected.

## Coordinator resolutions received

The coordinator reported these instructions to the author: omit `request_id` from views; leave travel `location_ids` empty; give uninformed third holders a separate `custody_returned` payload containing only item/from/to, not original borrower or loan IDs; preserve `loan_returned` for actual loan parties; use strict `current_time < expires_at`; never reuse offer IDs; check response duplication against full history and expose only relevant bounded `replied_to`.

These are reported decisions, not verified implementation claims. Formal immutable review follows under `contract-review-privacy/`.
