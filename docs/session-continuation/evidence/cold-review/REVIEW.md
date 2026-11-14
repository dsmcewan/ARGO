# SC-610 independent compatibility review

**READY for source compatibility. No findings.** Exact candidate `c4654d52b1a08bdb4bfa18822d2cc74229d606b6`, implementation parent `3a0996f9c5722d1687ab33ca4c38b6e6d9697b07`, baseline `8e2104c6d466b8b2bee2d0b23d984d2e60a65e11`. The implementation commit changes only the engine, its private-ownership README and one new test file. The clean worktree and exact HEAD were verified before and after execution. All frozen/control group identities in `preflight.json` match baseline; no production edit, delegated agent, network or provider call was made by this reviewer.

This scoped verdict is not application acceptance. The coordinator retains the full immutable native-completion gate and 2000-event measurement.

## Independent evidence

The prepared ordinary-process harness passed **8/8 groups**, exit zero, in **14.46 seconds**. I also independently reran the seven focused source tests as an ordinary Node file entry: **7/7 passed**, zero skips/cancellations/TODOs. No harness or product changes were needed after execution began.

- The original privately retained **512-event signed fixture** is byte-identical: SHA-256 `0253cd63832456400fae1ec8cd88ab0a1da22b3f61980b9c70727a839e32038c`. Candidate full replay equals its complete saved state. Terminal state hash remains `3f73fc4e26d33455cf3a4e4a4e93d4fc72be10da7d59a5b7f8302d23528d809a` and terminal event hash remains `cb66cd306d91477db1e932243c5cddcaac21c9b34a0ecf9c514792513815e71a`.
- **All 513 prefixes**, including genesis, match an independent SHA-256 over the original generic canonical preimage computed from a detached raw state. Selected prefixes also match through raw and recursively reordered objects; private head finalization changes no state digest.
- Corrupted signatures at the first and final fixture prefixes refuse without altering retained state. Immutable forks at prefixes 1, 32, 256 and 512 have independent new hashes and leave original hashes/history untouched.
- A separate **16-event signed mixed trace** checks every prefix through speech, Unicode/control escaping/lone surrogate, impressions, activity, policy changes, offer/acceptance/third-party return, elapsed time, encounter/recovery and closure. Cold replay equals its final state.
- **50 differential command cases** use the unchanged frozen contextual guard as oracle. All nine social forms and sixteen mortal forms are represented. Twenty-eight context-valid cases reach the deliberate stale-cursor `CONFLICT`; twenty-two raw/context-invalid cases fail first with `INVALID_CONTRACT`. The matrix covers scope, actor/addressee/subject, borrower/item/checkpoint/policy, policy owner/item/cap and knowledge predicates. It also preserves the old distinction that several mortal references remain dynamic admission checks, not additional contextual predicates.
- Caller aliases, shallow freezing, invented trust/hash fields, foreign genesis, immutable-definition substitutions, getters, proxies, revoked proxies, negative zero and nonfinite/unsafe numbers do not gain cache trust. Hostile getter/proxy trap count is zero. Mutating a nested raw object after shallow freezing changes its hash exactly as the generic oracle predicts, while the owned original stays unchanged.
- A synthetic schema-valid near-limit history reaches final-stage aggregate refusal after tentative loan computation. Prior hash, custody, offer and absent obligation stay unchanged; a shorter action can reuse the refused request ID. The setup is clearly labeled synthetic host data, not signed historical provenance.

The full old-fixture replay itself took **1.527 seconds** in this one unprofiled ordinary-process correctness run. That is not a 2000-event, SQLite, startup-import or portable latency claim, and is not compared as a precise speedup to the profiled baseline.

## Static authority review

At `engine.ts:96`, fragment encodings are reachable only from `worldStateHash` after lookup of an exact privately registered State. Registration/detachment/deep ownership paths are unchanged. Each cached object is therefore an owned immutable record or bounded subtree; caller freezing is never a brand. The top-level compositor sorts state keys, keeps array order, delegates scalar/object escaping to unchanged generic canonical serialization and omits only cursor.head. Its fixed wrapper matches the frozen domain/preimage. Growing memories/impressions/offers/loans are assembled from record encodings without caching an encoded full history array or complete state for every prefix. SHA-256 still consumes every byte.

At `engine.ts:49`, the private binder reproduces the complete frozen **Command-only** contextual branch. The unchanged raw Command guard runs first at line 182, followed by the equivalent private context checks, unchanged Principal validation, then authentication/cursor/gameplay admission. The indexed genesis is validated, detached and deeply owned before its private metadata is registered. Neither metadata nor Maps/Sets escape. State, Event and Receipt guards are not replaced; raw State hashing retains its original full guard and generic hash path at lines 113–114. No new public trust parameter, export or contract grammar was introduced.

Journal/signing/replay, storage transactions/publication, budgets, prior fork/index handling, mortal rules, all frozen contracts and the generic canonical oracle are byte-unchanged. This patch does not introduce a snapshot trust shortcut or a migration.

## Gate accounting

The implementer's broad source native-runner attempt is **failed/incomplete**, not passed: it reported missing named assertion and native per-file completion events despite zero reported test failures. Its retained log is `/workspace/reports/2026-11-14-argo-continuation/SC-610/targeted-regressions.log`, SHA-256 `42909ec50062c7cc83f751e052b47d05e65b67655bafb6098a9f2d92db2e3e9e`. Ordinary per-file source runs and this independent ordinary-process harness do not replace that native gate. No runner, test-completion policy or production flag was changed to hide the failure. The coordinator's isolated immutable gate remains authoritative.

## Exact source hashes

| Owned file | SHA-256 |
| --- | --- |
| `TESTS/shared-world-cold.test.ts` | `6835f6c74db913796a33320d08e435d545f81812a29e303d464744687d4e74a0` |
| `packages/ledger/src/world/rules/README.md` | `c83f073e2554b63c01b351085d1b5f547d41cd543220b79431e869a2e4100a74` |
| `packages/ledger/src/world/rules/engine.ts` | `76bef309f955b0a83fb6f52f20e0d9a26874c4b7aad244f46519ebfe88a79777` |

`review.json` also records Git blobs, protected subtree manifests, fixture identity and artifact hashes. The original fixture remains private and unchanged; reports contain no copied private world or signing key.

Reproduce with the external launcher:

```sh
python3 /workspace/reports/2026-11-14-argo-continuation/cold-review/run-review.py \
  --repo /path/to/exact/candidate --candidate c4654d52b1a08bdb4bfa18822d2cc74229d606b6 \
  --output /path/to/new/evidence-directory
```

Remaining limits are final integrated acceptance, the coordinator's 2000-event measurement, SQLite/open/snapshot timing, retained-process memory/GC behavior, operational rollback anchors and live-provider quality. Full-history hashing remains asymptotically proportional to accumulated state, so repeated replay remains quadratic in hashed bytes.
