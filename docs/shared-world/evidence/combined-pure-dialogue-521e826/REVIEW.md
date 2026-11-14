# Combined seed, pure authority and dialogue acceptance probe

Verdict: **READY for this combined pure/injected-provider scope** at exact integration `521e826b9588a1293ed22c243a14b83924c275bd`.

Eight ordinary-process integration groups passed, using the actual pinned Tempting Fates pack, public package exports, real shared-world reducer and views, and five injected provider requests. No live provider or paid call was used. The detached checkout `/tmp/argo-combined-pure-dialogue-521e826` stayed at the exact SHA and clean before and after. Reviewed SW200, SW400 and SW500 source/test files are byte-identical to their accepted candidates, and frozen contract hashes are unchanged; `verification.json` records each hash.

The probe imports `buildSharedWorldCampaign` from `@argo/tempted-fates`, `initialWorldState`, `resolveWorld`, `worldStateHash` and `viewWorldActor` from `@argo/ledger`, and `createWorldModelAgent` / `worldDialoguePacket` from `@argo/interventions` through their package exports. It also loads the actual ESM model-client public surface. No missing public binding was found. The model profile is `shared-world-dialogue/0.1.0`.

## What passed

1. The pinned seed composes with the selected night environment and borrowed-lamp kit. Melia holds `traveler_lamp`; hero has no automatic lamp, loan or accepted bargain. Only Melia receives her explicitly selected authored policy. Pack, genesis, catalog, source manifest and exact source document/excerpt hashes match. The physical roster excludes the Fates.
2. Hero's actual addressed whisper becomes an acquired record in Melia's real view. The captured request contains the exact owner policy, nature, priorities, current physical scene and focused inbound once, together with the fixed instructions. It contains no other NPC private-knowledge strings, full private pack, controller map, authority key or RNG internals. One input, empty prior history, no tools or previous response ID, `store:false`, and explicit 700-output-token cap are preserved. The combined instruction/body is 7,187 UTF-8 bytes in this fixture.
3. The generated text proposes only a speech command bound to Melia, the current query/head and inbound, addressed back to hero. Hero's principal cannot submit it. The actual NPC principal can: one epistemic memory is added, while physical state, world time, RNG, effects, offers, loans and custody remain unchanged. Hero's spoken agreement likewise makes no loan. Actor policy does not become hero's authored knowledge grant.
4. Melia's subsequent structured offer records the exact free/no-deposit/actual-damage terms and leaves custody with her. Hero's exact acceptance creates one open loan and transfers the lamp without charging obols. A forged offer hash rejects. This is the same evolving pure world used for the dialogue.
5. Mixed local/remote or nonexistent audiences and foreign scope reject atomically. Unaddressed room speech may be acquired by Melia but starts no provider call or NPC response.
6. Actual night travel after acquiring the lamp moves hero out of the room. A previously generated reply then fails the real authority precondition, the updated packet is ineligible, and travel during provider generation suppresses the pending reply at refresh.
7. Actual closure rejects both an already generated stale reply and a freshly rebound NPC speech command. Closure during generation suppresses release; a closed view contains no dialogue memories/knowledge and starts no later provider request.
8. Wrong-actor and foreign-scope model queries refuse before any provider request.

## Evidence and reproduction

`actual-provider-request.json` is the exact captured injected request, not a reconstructed prompt. `actual-melia-view.json`, `generated-reply.json`, `structured-loan-outcome.json`, `travel-suppression.json` and `closure-suppression.json` capture the real intermediate outputs. `results.json` records all eight assertions groups and exact before/after source identity. The private key generated for the fixture was never written; no signing occurs.

```sh
node --experimental-import-meta-resolve probe.mjs CHECKOUT_PATH 521e826b9588a1293ed22c243a14b83924c275bd OUTPUT_DIRECTORY
```

Run from any directory after installing the checkout's root dependencies. ESM resolution uses the explicit checkout parent because the probe is outside that checkout. The probe runs outside Node's test runner. `npm ci --offline --ignore-scripts` succeeded; its log is preserved as `dependency-install.log`.

Initial reviewer harness issues are preserved separately: sandbox `spawnSync` refused the Git child call, CommonJS resolution correctly rejected the ESM-only model-client, and a reviewer JSON parser initially failed to strip the known frozen instruction prefix. The final harness uses async Git, ESM package resolution and exact prefix validation. None was a product finding.

## Remaining acceptance boundaries

This is a pure/injected-provider integration, not a running host or storage implementation. The only private source helper used is `withWorldHead`, solely to make explicit synthetic test heads between reducer steps; that helper is deliberately absent from the public ledger exports. These heads are **not signed journal proof**, and the locally supplied principals/refresh callback do not authenticate a real transport. Durable atomic commits, concurrent storage/reopen/replay, current-prefix authentication, exact signed receipt/request binding, actual host routing and the ordinary CLI remain later acceptance gates. No live narration quality or provider availability claim is made.
