# Portable SC-610 compatibility evidence

`run-portable.py` runs the eight original ordinary-process checks through `compatibility.mjs`. Both files accept `--repo`, `--candidate`, `--fixture`, `--fixture-manifest`, and `--output`. The launcher pins the exact clean candidate, checks frozen/control source identities against baseline, records hashes, removes `NODE_TEST_CONTEXT`, and uses a 120-second external deadline with regular-file output. Run the launcher with normal Python 3, without `-O`.

The fixture and terminal digests come from the supplied manifest. Its source must be exactly `8e2104c6d466b8b2bee2d0b23d984d2e60a65e11`, with 512 events and the original fixture schema. Fixture bytes, genesis, saved terminal state, and terminal event identity must agree with that manifest before any check begins. Replay still verifies every original signature and event, and the detached generic canonical oracle remains unchanged. The launcher confirms that the generic serializer and frozen guards match baseline Git bytes.

The retained historical fixture passed all eight checks against clean `c4654d52b1a08bdb4bfa18822d2cc74229d606b6`; see `run-c4654d5/`. This candidate and integrated `7c16c0d8709b0b53dba0ab36051c1fe0100bd35a` differ only under `docs/session-continuation/`. This run is independent compatibility evidence, not a native completion gate or a 2,000-event performance benchmark.

## Reproduce with a fresh baseline fixture

Use Node 24.22.1, Python 3, Git, and the repository's local dependencies. The commands below do not invoke a provider. Dependencies must already be available in both checkouts; package installation is outside this offline harness. Use absolute paths for the placeholders and fresh output directories outside tracked source. Keep the portable harness files together.

1. Obtain an exact clean baseline checkout at `8e2104c6d466b8b2bee2d0b23d984d2e60a65e11` and an exact clean candidate checkout. For example, create detached worktrees from a repository containing those commits. Before building, check the baseline `git rev-parse HEAD` and empty `git status --porcelain` yourself: the fixture builder's `--source` field is an asserted input, not an independent Git attestation.
2. From an ordinary shell, use the public `docs/session-continuation/profile-replay.mjs` from integrated commit `7c16c0d8709b0b53dba0ab36051c1fe0100bd35a` to build using the baseline modules:

   ```sh
   env -u NODE_TEST_CONTEXT node /ABS/PUBLIC_CHECKOUT/docs/session-continuation/profile-replay.mjs \
     --mode build --repo /ABS/BASELINE_CHECKOUT \
     --source 8e2104c6d466b8b2bee2d0b23d984d2e60a65e11 \
     --output /ABS/NEW_BASELINE_OUTPUT --events 512
   ```

3. Run the portable launcher, supplying the full SHA matching the candidate checkout:

   ```sh
   python3 /ABS/PORTABLE/run-portable.py \
     --repo /ABS/CANDIDATE_CHECKOUT \
     --candidate c4654d52b1a08bdb4bfa18822d2cc74229d606b6 \
     --fixture /ABS/NEW_BASELINE_OUTPUT/private-fixture/signed-fixture.json \
     --fixture-manifest /ABS/NEW_BASELINE_OUTPUT/fixture-manifest.json \
     --output /ABS/NEW_COMPATIBILITY_RESULTS
   ```

   For the accepted integration checkout, substitute `7c16c0d8709b0b53dba0ab36051c1fe0100bd35a` as `--candidate`. Check exit status zero, eight passing checks in `results.json`, and clean/unchanged fields in `verification.json`.

A fresh build uses a new signing key, so its fixture, genesis, event, and terminal hashes will differ from the retained historical run. Its manifest provides the expected identities for that new fixture. This reproduces the baseline-to-candidate compatibility experiment; it does not reproduce the old private fixture bytes or independently attest who produced a supplied manifest. The generated private key is never persisted. Keep the private fixture directory at 0700 and its file at 0600; the launcher checks both. Do not commit or publish private fixture contents.

## Checks preserved

1. Exact replay of the old 512-event fixture and saved terminal state.
2. Detached generic canonical oracle for all 513 states, with selected raw/reordered copies and head independence.
3. Refusal of tampered signatures at first and last prefixes.
4. Independent immutable forks and retained-state/cache integrity.
5. Signed mixed social, Unicode, loan, physical, encounter, and closure trace.
6. All 50 frozen command-context cases, including raw guard and stale-cursor ordering.
7. Hostile values, getters/proxies, aliases, caller freezes, foreign genesis, and invented trust flags.
8. Late aggregate-budget refusal preserving custody, hash, and request reuse.

`parameterization.diff` records the derivative against the untouched original harness. `derivation.json` records the original evidence hashes and verifies the eight check bodies are unchanged except for replacing the two old terminal literals with manifest fields; the generic oracle is verbatim unchanged. `check-negative-manifests.py` accepts the same arguments and separately tests five corrupted manifest identities, each of which must fail before any check passes. Its retained results are under `negative-manifests/`.

No product files, schemas, trust policy, signatures, budgets, or native gate logic were changed. The original review evidence remains unchanged. The synthetic near-limit state in check 8 is a cache/admission probe and is not represented as signed-history authentication.
