# Public SC-630 independent review evidence

Scoped **READY** for exact candidate `f2641d92f5f07bc69b672ee6f6c3a189ee5f46cc`, base `3c8ff55d872891014c89fe43515b3c28fd492626`. Read `candidate-f2641d9/REVIEW.md` and `candidate-f2641d9/final-results.json`. Full application/native-gate acceptance remains separate.

`EXPORT_MANIFEST.json` is the explicit safe publication allowlist for this directory. All listed historical evidence was copied byte-for-byte; no original result, failure, stderr, source identity or hash was sanitized or overwritten. The original `verification.json` retains hashes for the fuller local evidence inventory; only the stricter export allowlist is published here. Files not included in this export are not implied available from this public archive.

Excluded: every generated world/outbox database and sidecar, signing key, genesis, generated private fixture state, private world configuration, raw model prompt/request, ordinary full view/turn captures and large captures. `fixture-valid.json`, `world-config.json`, and `operation-sequences.json` are **hand-authored synthetic reproduction inputs prepared before execution**, not a generated world or private runtime state; they contain no seed, signing key or database contents. Probe source may describe private-world paths it creates at runtime. Never place those outputs in this public evidence directory or a tracked checkout.

## Reproduce offline against a pinned checkout

Use Node 24.22.1, Python 3, Git, and installed local workspace dependencies. Use a clean detached checkout of the full candidate above. Confirm `git -C /ABS/CANDIDATE rev-parse HEAD` and empty `git -C /ABS/CANDIDATE status --porcelain` before and after. Source hashes must match `candidate-f2641d9/preflight.json`; its frozen/control directories match the accepted base. No provider or network is needed.

Run from an ordinary shell with NODE_TEST_CONTEXT absent. Keep all probe files and the three authored JSON inputs together. Create new private output directories outside all source checkouts, e.g. under a private `/tmp` review directory. Each probe uses the actual candidate CLI/host/store/journal. The Node probes label the candidate but do not themselves replace the external Git identity check.

The initial all-in-one `probes.mjs` run timed out after 180 seconds of cumulative work. To reproduce the completed checks, run `probes-grouped.mjs` once per C01–C12, serially, with a separate output directory per group. Bound each ordinary process externally to 180 seconds and capture stdout/stderr in regular files. Its child CLI deadline stays 45 seconds and production generation policy stays 10 seconds.

For each group:

```sh
timeout --signal=KILL 180s env -u NODE_TEST_CONTEXT node /ABS/EVIDENCE/probes-grouped.mjs   --repo /ABS/CANDIDATE   --candidate f2641d92f5f07bc69b672ee6f6c3a189ee5f46cc   --output /ABS/PRIVATE_RUN/C01   --group C01 --common-root /ABS/PRIVATE_RUN/C01/private-restart   > /ABS/PRIVATE_RUN/C01/stdout.log 2> /ABS/PRIVATE_RUN/C01/stderr.log
```

Create each group output directory first. Change `--group` and `--output` for subsequent groups, retaining C01's `--common-root`. C01 creates the common world; C02/C04/C05/C06/C07 intentionally reuse it, in order. C03/C08/C09/C11/C12 create separate worlds under their own output directory. The helper's internal CLI subprocesses use private regular-file stdin/stdout/stderr and clear NODE_TEST_CONTEXT.

Concurrency is nondeterministic. Original C11 required both simultaneous callers to exit zero and observed one safe stale-cursor CONFLICT. This is a retained overly strong availability expectation, not an authority failure. When that same case occurs, run `concurrency-reconciliation.mjs` with the common `--repo`, `--candidate`, `--output` plus `--original-run /ABS/PRIVATE_RUN/C11` and `--original-world-parent /ABS/PRIVATE_RUN/C11/private-concurrent`. This correction targets the actually observed one-success/one-conflict case; it verifies exact reconciliation, a single unchanged attempt and input/reply, and isolated distinct-turn replies. If a fresh scheduling run has both callers succeed, the original first assertion passes and there is no identical conflict artifact to recheck. Do not force a scheduling outcome or treat every safe conflict as lost durability.

Run `pending-and-stdout.mjs` in another new private output directory, with `--repo`, `--candidate`, and `--output`, to exercise a real accepted-row status/cancel race and actual executable broken stdout. The retained script has a known stderr formatting expectation: it matches `OutputFailure:` while Node 24 prints `OutputFailure [Error]:`. Preserve its resulting evidence. Then run `verify-broken-stdout.mjs` with the same source arguments, a new output directory, and `--original /ABS/PRIVATE_PENDING_RUN`; it checks the retained OS-fault artifacts and signed world with the correct matcher, without replaying the failing child or overwriting the initial result.

The public archive intentionally omits the private worlds needed to re-open historical executions. Reproduction creates new keys/genesis/receipts and new digests; it validates the same invariants rather than manufacturing the historical private bytes. Source artifacts, known harness corrections and exact original outcome hashes remain immutable here.
