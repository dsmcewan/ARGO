# Portable verification evidence

`contracts/` records native peer reviews of exact frozen interfaces. `runtime/` retains independent probe source, findings, fixes, source identities and logs. These reviewers are separate native instances of the same model; no cross-vendor or live-provider review is claimed. Runtime source commits are retained in the integration history.

From a clean checkout of the runtime candidate with cached dependencies installed:

```sh
ARGO_REVIEW_ROOT="$PWD" ARGO_REVIEW_SHA="$(git rev-parse HEAD)" node docs/review-successors/evidence/runtime/observation/review.test.mjs
ARGO_MORTAL_REVIEW_ROOT="$PWD" node docs/review-successors/evidence/runtime/mortal/probes.mts
node docs/review-successors/evidence/runtime/knowledge/runtime-probes.mjs "$PWD" "$(git rev-parse HEAD)" /tmp/argo-knowledge-review
```

The retained scripts are added in a later evidence commit, so to inspect the original code exactly, copy the scripts outside the checkout and check out the named runtime candidate first. The scripts accept an explicit checkout root; they do not depend on the historical sandbox checkout paths printed in original reports. Logs describe the actual tested candidates, not an assertion that any future HEAD passes.

The full application gate uses the existing portable `docs/characters-runtime/evidence/run-candidate-gate.py`, a disposable exact-commit clone, cached dependencies and read-only, network-unshared Bubblewrap. It requires Linux namespaces and the pinned Node version. The outer workspace sandbox cannot establish those checks; its earlier file-level failures are not counted as successful application acceptance.

`application/e576fe0/` contains the final ten-group pass, dependency-install logs and their recorded hashes. `application/ba72fe0/` retains the earlier full pass before the independent cancellation finding. The final run repeated all ten groups after that repair. `ARTIFACTS.json` hashes every evidence file except itself; runtime's older manifest is retained as its own snapshot. All file references in these manifests are relative to their containing directories.
