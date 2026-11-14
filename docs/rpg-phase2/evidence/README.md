# Retained implementation evidence

Original reports and logs are copied byte-for-byte. `retention-map.json` maps their historical absolute paths to files in this directory and records SHA-256 digests. Those old paths describe the execution environment; the retained files are the evidence. No lease tokens, database content, production keys or provider credentials are included.

The final `../verification.json` binds the assembled runtime commit, gate result, study reports and current source hashes. Author commits in individual worktrees can have different IDs from their reachable cherry-picks; compare the recorded file hashes and integration mapping rather than assuming a source author's commit is in the assembled ancestry. The contract freeze predates all parallel implementation lanes.

## Reproducing checks

Use the assembled candidate named in `verification.json`, Node 24 and the locked dependencies. The original source contains no access to paid models in these checks.

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run contracts
npm run typecheck
node --test TESTS/mortal-contracts.test.ts TESTS/mortal-rules.test.ts TESTS/mortal-journal.test.ts TESTS/mortal-storage.test.ts TESTS/mortal-integration.test.ts TESTS/mortal-balance.test.ts
node docs/rpg-phase2/evidence/argo-rp200-probes.mjs "$PWD" "$PWD"
node docs/rpg-phase2/evidence/argo-rp300-review-crash-early.mjs "$PWD"
node docs/rpg-phase2/evidence/argo-rp300-review-crash.mjs "$PWD"
node docs/rpg-phase2/evidence/argo-rp900-review-probe-portable.mjs "$PWD" /tmp/mortal-view-probe.json
```

Dependency installation requires either a populated npm cache with `--offline` or separately available package access. The actual recorded run used offline installs. The full application gate also installs Pantheon's locked dependencies and needs local subprocess/namespace support. Its retained `argo-review2-stage-gate.py` creates a disposable clone, installs offline, mounts the candidate read-only in network-unshared Bubblewrap and runs all ten checks. It does not merge or promote a trust root.

The original `argo-rp900-review-probe.mjs` is retained for its original hash; use the portable variant above for a new run. A full gate rerun is an implementation check, not operational approval. Crash probes sample process termination, not power loss. The ten retained SIGKILL cases cover precommit and already acknowledged commits; none hit the narrower durable-commit-before-acknowledgment window.

The initial balance review identified confidence-interval and censoring defects before the retained outcome study. Preserve it alongside its fix verification; it is not a claim those defects remain open. The ten-seed pilot is timing evidence only. Training and held-out report paths, selection and limits belong in the balance evidence record; never silently overwrite an exclusive `.started.json` or count a previously exposed holdout as fresh evidence.

The independent Python verifier reads retained rows only; it does not import the game engine or generate new trials:

```sh
python3 docs/rpg-phase2/evidence/argo-rp400-verify-report.py docs/rpg-phase2/balance/evidence/holdout-bb7c838.json --training docs/rpg-phase2/balance/evidence/train-bb7c838.json --decision docs/rpg-phase2/balance/evidence/train-bb7c838.json.decision.json --expected-source bb7c838252f320548d47c6c433b0eb429afd8e70
```

It reconstructs every stored outcome row and aggregate digest, statistics and decision binding. It cannot independently reconstruct gameplay transitions from a digest alone; the real-resolver trial replay and signed-history tests provide separate evidence for that behavior.
