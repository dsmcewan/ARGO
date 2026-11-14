# SW-200 repaired candidate privacy verification

Verdict: **READY for the reviewed pure-rules/view scope** at `2c0c1c8cc1f0aadedc7c94754ad917f9538b60a1`.

The unchanged final fourteen-group independent probe from the original review now passes 14/14. All 31 named source rules/view tests pass. The exact checkout stayed clean before and after testing, and every frozen contract hash matches. This resolves the sole scoped defect reported at `4774dfb6d44145183f6c7760d032728aa6a84739`; the original failing artifacts remain intact in the parent directory.

The two-file repair adds a standing-lender check only after a mortal item custody change would fulfill an existing open loan. The check runs before state/history/index publication. Direct return is unchanged. Source inspection found no other runtime changes.

The original reproduction now returns `UNAUTHORIZED` for the unconscious-lender case; direct-return refusal and standing-lender success still pass. `unconscious-lender.json` records this exact outcome. Additional controls run as an ordinary Node process, outside the test runner, confirm rejection leaves the original state/hash/custody/open loan unchanged; its request ID can immediately be reused for a valid alternative; transferring a loaned item to someone other than the lender remains allowed; and an ordinary nonloan item can still transfer to a living unconscious recipient without giving that recipient new witness memory. See `narrow-controls.mjs` and `narrow-controls.log`.

The fourteen unchanged groups retain the original acquisition, reader/scope/cursor, addressed versus overheard NPC reply, full-history dedup, private impression, travel endpoint, remote offer/loan status, third-holder return redaction, owner knowledge, closure, and passive/cache coverage. No new scoped blocker was found.

Reproduction commands:

```sh
node probes.mjs CHECKOUT_PATH 2c0c1c8cc1f0aadedc7c94754ad917f9538b60a1 OUTPUT_DIRECTORY
node narrow-controls.mjs CHECKOUT_PATH
# In checkout:
node --test --test-isolation=none TESTS/shared-world-rules.test.ts TESTS/shared-world-views.test.ts
```

Scope remains pure reducer/projection only. Synthetic fixture heads are not signed journal commits; actual journal durability/current-prefix authentication, host authorization and model refresh, receipt/request binding, and combined CLI acceptance remain separate gates. No repository edits, nested workers, paid provider calls, authority commits or board mutations were made by this reviewer.
