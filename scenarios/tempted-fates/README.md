# Tempted Fates integration seed

The three proposal-only Fate adapters have separate actor identities. Clotho may propose naming an already absent thread; Lachesis may record an authorized observation about measure; Atropos may propose ending a present thread. TELOS independently enforces those jurisdictions. All three may decline or remain silent. They never solicit a gift, donate another actor's time, or trigger disappearance.

`TESTS/tempted-fates.test.ts` is Integration Test Zero, covering TF-01..TF-12 from `repo-audit/SCENARIO_REQUIREMENTS.md`. `TESTS/authority.test.ts` and `TESTS/bridges.test.ts` add expiry, revocation, concurrent commits, actor/party disclosure and temporal negatives. The system-only disappearance event is used as a rare scenario fixture; no transfer threshold or guaranteed campaign event invokes it.

The v1 knowledge schema has a single world/branch encounter context, so current anomaly cutoffs conservatively apply to every actor view in that world/branch. Localizing simultaneous encounters requires a versioned subject/encounter contract; it must not reopen exposition through another observer's view.
