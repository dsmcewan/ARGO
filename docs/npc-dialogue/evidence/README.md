# Retained dialogue verification

`manifest.json` binds retained files to their original offline reports. Source code and regression tests are committed in the repository; root paths inside historical logs identify the execution environment and are not dependencies.

Run `node TESTS/character-model.test.ts`, `node TESTS/character-model-integration.test.ts`, `node TESTS/campaign-dialogue.test.ts`, and the package tests with Node 24 and locked dependencies. Run the repository's complete gate in its supported Linux/Bubblewrap environment before delivery. `../verification.json` describes the earlier targeted checks and exact implementation identity, rather than predicting a later gate result.

The independent `review-probes.mts` intentionally asserts the bad behavior at reviewed commit `724485d`. To reproduce it, create an isolated checkout of that commit, install cached locked dependencies, and pass its absolute path to `node docs/npc-dialogue/evidence/review-probes.mts /path/to/reviewed-checkout` from a current checkout. It is expected to fail against the fixed implementation. The committed regression tests assert the repaired behavior.

The red logs demonstrate missing implementation and four reproduced review failures. The green logs demonstrate their fixes using injected transports. They do not establish live-model dialogue quality or verify vendor API availability. No paid calls or production data were used.
