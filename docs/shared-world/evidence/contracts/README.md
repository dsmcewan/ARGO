# Contract review evidence

The reviewed source is `186e052a19de6466aedaf048ecb5d9c4fd4fc1eb`. Metadata-only commit `15d49d3c1ca5615ecc195da8b99401071fd4bd55` marks the freeze; its four source hashes are unchanged. Both source commits are retained in integration ancestry.

The freeze's original `/workspace/reports/...` references record the review location. Portable copies are here:

| Review | Initial findings | Final result | Unchanged probe source |
| --- | --- | --- | --- |
| Authority and implementability | [Initial report](contract-review-authority/review-04bae2b.md) | [READY, 9/9 probes](authority/review-186e052.md) | [probes.mts](contract-review-authority/probes.mts) |
| Privacy and immutable identity | [Initial report](contract-review-privacy/REVIEW.md) | [READY, 20/20 probes](privacy/fixed-186e052/REVIEW.md) | [probes.mjs](contract-review-privacy/probes.mjs) |

Each final reviewer also ran the 25 author contract tests. These are independent native peers, not reviews from another vendor. The records do not certify runtime behavior or operational merge.

To reproduce, check out the reviewed commit into a clean disposable checkout, install the pinned dependencies, and supply its absolute path. Run the authority probe with `ARGO_REVIEW_ROOT=/absolute/checkout node --test --test-isolation=none /absolute/probes.mts`; run the privacy probe with `node /absolute/probes.mjs /absolute/checkout 186e052a19de6466aedaf048ecb5d9c4fd4fc1eb /tmp/argo-privacy-review`. Probe files can be read from the current branch while the tested checkout stays at the exact reviewed source. No live provider is needed.

[Freeze acceptance](freeze-acceptance.json) records source artifacts and the honest Board state, VERIFYING. Application code acceptance is outside the Board's pinned data-only validator.
