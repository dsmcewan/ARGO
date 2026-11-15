# Cold replay baseline

At clean `8e2104c6d466b8b2bee2d0b23d984d2e60a65e11`, an ordinary Node 24.22.1 process replayed 512 signed campaign events in **7.880 seconds**. Complete terminal state and hash matched the original authority result. Imports, fixture creation and JSON parsing were outside the CPU profile; SQLite opening and receipt verification were not measured here. No provider calls were made.

| Disjoint sampled stack | Share |
| --- | ---: |
| State hashing and descendants | 53.59% |
| Immutable genesis validation | 16.36% |
| Genesis contextual binding | 7.74% |
| Event signature verification | 2.12% |
| Ownership/size measurement | 1.78% |
| Index extension | 0.64% |
| Garbage collection | 2.77% |
| Other | 15.00% |

These measurements justify removing repeated canonical traversal and genesis checks while preserving their exact result. They do not justify skipping signatures or trusting a stored checkpoint. Inclusive function totals overlap; do not add them to the disjoint categories above. The full historical hash input still grows with every event.

[Aggregate evidence](evidence/cold-baseline.json) pins source, harness, fixture and terminal hashes. The original synthetic signed fixture is retained outside source control for candidate comparison; no signing key was persisted. [The diagnostic harness](profile-replay.mjs) is included unchanged so a fresh baseline fixture can be created independently and then retained for candidate comparison. From a clean checkout of the pinned baseline, with dependencies installed, run this harness by absolute path from the newer checkout:

```sh
node /path/to/new-checkout/docs/session-continuation/profile-replay.mjs \
  --mode build --repo /path/to/clean-baseline \
  --source 8e2104c6d466b8b2bee2d0b23d984d2e60a65e11 --output /tmp/argo-cold-profile
node /path/to/new-checkout/docs/session-continuation/profile-replay.mjs \
  --mode profile --repo /path/to/clean-baseline \
  --source 8e2104c6d466b8b2bee2d0b23d984d2e60a65e11 --output /tmp/argo-cold-profile
```

Use a new output directory and a 90-second external deadline per process. Verify the baseline checkout identity and cleanliness before/after; the harness records source-file hashes and checks the profile against its fixture manifest. A newly generated signing key produces different fixture hashes, which is expected: compare candidate replay with that same saved baseline fixture, never candidate-generated expected results. The original exact 512-event fixture hash is `0253cd63832456400fae1ec8cd88ab0a1da22b3f61980b9c70727a839e32038c`.
