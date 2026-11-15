# Portable verification evidence

These files retain the captured RED/GREEN output and separate review records for the character profile. `manifest.json` hashes every retained evidence file other than itself. Absolute paths inside original logs/JSON record where the command ran; their referenced `/tmp/<basename>` artifacts are retained here under the same basename. No temporary checkout is needed to read them.

Run the repository tests from the exact code commit in `../verification.json`. The standalone reader probe accepts the checkout path:

```sh
node docs/characters-runtime/evidence/argo-cr200-adversarial.mjs "$PWD"
```

The lane author/reviewer commits are local source identities. `../verification.json` maps each lane to reachable integration commits and exact file hashes. Verification on one lane is not a combined-candidate or operational approval. RED logs intentionally record failing tests before the corresponding behavior existed. The current implementation is checked by the combined gate, not by reclassifying those historical failures.

The complete gate ran in a disposable read-only clone with networking disabled. Its original summary and install logs are in `full-gate/`. The wrapper can be rerun with explicit local paths (Linux Bubblewrap and a populated npm cache are required):

```sh
python3 docs/characters-runtime/evidence/run-candidate-gate.py \
  --repo "$PWD" --candidate 0b827e1e41bc954c73df36d7513a9007de15a0cb \
  --npm-cache /path/to/npm-cache --output /tmp/argo-character-gate-rerun
```

The `merge_ready` field is the gate's clean-candidate check mode. This run did not invoke the merge controller, authorize a trust root, or change the target branch.

Additional separate review probes are retained verbatim:

```sh
node docs/characters-runtime/evidence/argo-cr300-independent-probes.mjs "$PWD"
ARGO_REVIEW_ROOT="$PWD" node --test docs/characters-runtime/evidence/argo-character-combined-probe.mjs
```
