# SW-510 independent authority/receipt/persistence review

**READY for the reviewed owned-code scope.** No authority, receipt-binding or persistence blocker was found in exact candidate `0d295152d7ee8a7e9a2a97a7f470e8108c2b26b2`, based on `120119c81c4e4562e5078b30f58390d364be13cb`. Five owned files were reviewed; the worktree remained clean at the exact candidate before and after verification. `review.json` records immutable source/blob hashes, source-author hash agreement and evidence hashes. No source edits, delegated agents, paid/provider calls or network operations were performed.

This is not a claim that the standalone source candidate passes every workspace gate. Its documented boundary check stops at the scenario's undeclared `@argo/session` dependency. The coordinator explicitly owns that manifest/lock/ownership integration and the final integrated gate. Frozen contract bytes and earlier authority implementations are unchanged.

## Evidence

This reviewer ran **8/8 external independent probe groups**, exit zero, under Node v24.22.1 with `--test --test-isolation=none`; see `probes.mts` and `probes.log`. One probe launches the real ordinary CLI `init` entry with `NODE_TEST_CONTEXT` removed and private regular-file descriptors for all three streams. Additional filesystem/input matrix cases invoke its exported `main` function with explicit input/output capabilities; no production special case or source patch is used.

The parallel privacy reviewer reran the **10/10 authored session tests** in [source-tests.log](../host-privacy-review-0d29515/source-tests.log). I read that completed log without duplicating the test load. Its separately captured ordinary [demo output](../host-privacy-review-0d29515/demo.stdout) shows seven events, one accepted Melia utterance, no loan from conversation alone, explicit loan return, signed replay/restart, two oil turns and 1200 elapsed seconds. Those are peer-run evidence, not a second demo run by this reviewer. Broader model/disclosure conclusions remain in that peer's report.

## Independent checks and source conclusions

1. **Fixed authority.** Mutating constructor-supplied genesis/profile/controller or principal after construction cannot change the pinned session. Wrong controller, role, actor, referee identity and each of seven scope fields refuse. Foreign actor commands and queries refuse before a ledger call.
2. **Copies before await.** Controlled unresolved snapshot/submit promises prove prepare actions, view queries and submitted commands detach before yielding. Mutating the originals while paused cannot rewrite work. Submitted command/principal objects are frozen, and returned receipts are separately copied/frozen so later ledger-side mutation cannot alter the result.
3. **Authentic wrong receipts refuse.** Genuine authority-signed receipts for another request, changed action under the same ID, another principal, or an independently re-signed wrong resulting sequence refuse. A re-signed backward-time receipt also refuses. A valid exact receipt succeeds even when the injected ledger snapshot always throws, proving `submit` does not accidentally perform a stale-prefix precheck before storage retry reconciliation.
4. **Referee boundaries.** Referee query/view refuses before snapshot access. Player/referee action-role mismatches fail before storage. A prepared referee command remains actorless and cannot be submitted through the player session. A forged raw referee snapshot with changed controller identity fails full validation.
5. **Real persisted retries.** A session issues a loan, the borrower accepts and returns it, then the referee closes engagement. The original exact acceptance still returns its identical receipt without another transfer or memory, even after restart with an external checkpoint. The old query is rejected, the obligation stays returned, custody stays with the original lender, and signed replay matches the four-event final state.
6. **Private ordinary initialization.** The real process creates 0700 world directory and 0600 genesis, manifest, key, marker and database files. A second init refuses without replacing genesis. A referee-prepared closure cannot run through a player CLI capability; referee submission commits once and exact retry returns the same row. Referee query refuses.
7. **Resume safeguards.** Symlink genesis/key/ready/database files, a symlink world directory, unsafe file or directory permissions, a missing database, wrong ready-marker genesis hash, and a symlink WAL sidecar all refuse. Missing database refusal does not create an empty replacement. The sidecar symlink target remains unchanged. Restoring the legitimate files resumes the untouched sequence-zero world.
8. **Closed input and partial initialization.** A supplied seed/unknown config field refuses before creating a world. Malformed JSON and identity-injecting operation fields produce errors while a later independent valid query still runs; the final result is nonzero. Oversized lines refuse. Missing ready marker makes resume fail and init still refuses to overwrite the partial directory. A dangling directory symlink remains intact and is refused.

The session owns no secondary authority or database. Current query/view methods refresh the injected ledger and apply the public actor projector; copied queries are checked against that current prefix. New command preparation fixes the actor and full cursor. Submission pins full genesis/key/scope trust and exact command/principal request hash, request ID, next sequence and nondecreasing time before returning the receipt (`packages/session/src/index.ts:66`). Host authentication and correctness of the injected ledger capability remain prerequisites; shape guards do not authenticate invented history.

The CLI separates submitted action acceptance from display. Its JSON operation grammar contains no principal override; local `--actor` and `--referee` selection is explicitly trusted-operator capability, not remote authentication. Private initialization uses exclusive file creation and refuses existing paths. Resume checks the saved complete genesis, marker, signer and database before opening the journal; the full signed storage replay remains authoritative. Normal resume does not claim an external rollback anchor.

## Reproduction

```sh
ARGO_SW_ROOT=/path/to/exact/candidate node --test --test-isolation=none /workspace/reports/2026-11-14-argo-shared-world/host-authority-review-0d29515/probes.mts
```

Temporary worlds, signing keys and private files are removed by the harness. The retained log contains test results, not raw private worlds or model requests. The source diff and hashes are saved alongside it.

## Limits

The coordinator owns dependency integration, immutable application gates and the final host benchmark. Referee preparation explicitly calls the complete State guard at `packages/session/src/index.ts:35`; this review makes no long-history referee latency claim. Actor projection retains the owned-snapshot path. Remote authentication, hostile same-user filesystem races, OS privilege abuse, power-loss persistence of initial key/genesis files, independent checkpoint custody, provider quality and campaign balance are outside this scoped verdict.
