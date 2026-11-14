# SW-200 independent privacy review

Verdict: **CHANGES REQUIRED** for exact commit `4774dfb6d44145183f6c7760d032728aa6a84739`.

The eight-file pure rules/view candidate remained clean at the exact SHA before and after testing. The 30 named source-author rules/view tests passed. Thirteen of fourteen independent adversarial probe groups passed; the remaining group reproducibly demonstrates the defect below. No repository source, board state, paid provider or authority journal was modified.

## Confirmed defect: ordinary loan fulfillment lets an unconscious lender acquire new memory

`packages/ledger/src/world/rules/engine.ts:197` marks a loan returned after an ordinary mortal item transfer reaches its original lender. Unlike direct `return_loan`, this path does not require the lender to be standing. `loanReturn` at lines 134–136 always includes the lender in `acquired_by`, and `viewWorldActor` consequently exposes the new return record to the unconscious lender.

The probe uses accepted transitions only: offer the lamp; companion accepts; hero with one HP and no rations waits using deterministic seed `0000000000000000000000000000000000000000000000000000000000000006`, whose hunger draw leaves HP zero; companion ordinarily transfers the lamp back. The transition succeeds, custody changes to hero, the loan becomes returned and the hero receives a fresh `loan_returned` memory despite remaining unconscious. The input state is still immutable, but the accepted next state violates the intended standing acquisition rule.

Controls establish the boundary: ordinary return to the standing lender succeeds and gives the proper return memory; direct `return_loan` to the same unconscious lender rejects. Normal subsequent room speech, addressed whispers and ordinary physical witnessing correctly exclude the unconscious hero.

Root confirmed the intended rule and selected a contract-preserving remedy: reject the ordinary compound custody transfer when it would fulfill a loan to a nonstanding lender, before publishing any state/custody/loan/memory change. No schema change is needed. Re-run this portable probe unchanged against the immutable repaired candidate, and add the regression to source tests.

Evidence: `unconscious-lender.json`, final failing probe group in `probe-results.json`, and `probes.mjs`. The JSON captures before/after HP, standing positive control, direct-return negative control, resulting custody/loan and newly exposed lender memory.

## Passing independent coverage

- Exact candidate identity, clean checkout, eight owned files and every frozen contract-file hash.
- Complete namespace, current passed-state cursor, reader role, controller and actor binding.
- Derived self/whisper/room acquisition; valid remote whisper rejection; no retroactive private/room history on arrival; no outgoing request IDs or witness lists.
- Addressed versus overheard NPC speech, independent replies by two addressed NPCs, busy/standing restrictions, and full-history duplicate rejection after the inbound falls outside the 32-record view window.
- Owner-private impressions, acquired subject-authored evidence, exact predecessor and fixed owner nature; no recipient opinion bleed.
- Before/after travel witnesses receive an empty location list and no route, endpoint, resources or rolls.
- Remote withdrawal updates canon without new remote borrower memory or global offer/loan status disclosure.
- A later third holder returning the item sees only `custody_returned` with item/from/to; no loan/offer/original-borrower identifiers. A remote original borrower and nearby unrelated witnesses receive no fulfillment memory. Original lender retains the full return payload.
- Owner-only active authored knowledge, exact source definitions, committed activation sequence, future validity, revocation, stale query refusal and exclusive expiry.
- Mythic closure empties dialogue context and denies NPC speech; stale cursors cannot bypass it.
- Passive descriptor/proxy boundaries, immutable cached outputs, forged immutable profile refusal, and independent pure-state forks.

## Reproduction

From any directory, with the candidate dependencies available:

```sh
node /workspace/reports/2026-11-14-argo-shared-world/rules-privacy-review-4774dfb/probes.mjs CHECKOUT_PATH CANDIDATE_SHA OUTPUT_DIRECTORY
```

Expected current result: 13 passing groups and one failed unconscious-lender assertion; process exit 1. Source tests used `node --test --test-isolation=none TESTS/shared-world-rules.test.ts TESTS/shared-world-views.test.ts`; exact named output is in `tests.log` (30 passed, zero failures).

## Scope and evidence limits

This review exercises the real pure reducer and actor projection. Fixture helpers construct valid genesis/commands and synthetic chain heads; these are **not signed journal commits**. A structurally valid cold state is not authenticated by the schema, and an old valid state can intentionally produce a historical view. Real journal prefix authentication, host currentness, model refresh, exact receipt/request binding and combined CLI integration require later runtime review. No live model calls occurred. The review is an independent Codex instance, not a cross-vendor assessment.

An initial reviewer fixture used a malformed remote audience argument, so that one negative assertion proved only shape rejection. Its script/log/results are preserved under `initial-probe-run/`; the final probe uses a valid whisper aimed at an actor actually elsewhere. No finding relied on the weak fixture. Final evidence is the top-level run.
