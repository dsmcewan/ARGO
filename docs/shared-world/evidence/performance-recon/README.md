# Provisional shared-world contract performance reconnaissance

This is a read-only synthetic contract microbenchmark against the mutable SW-100 draft. It is **not runtime performance, a signed replay benchmark, or an acceptance verdict**. Timings alone are not unique acceptance evidence. The report does not claim that a storage worker, session, provider turn or 2,000-event cold open meets a latency target.

Artifacts:

- `contract-microbenchmark.mjs`: portable Node runner; accepts the candidate root as its first argument and writes JSON to stdout. It only reads source/Git metadata, imports the contract/fixtures, and allocates in-memory synthetic states. No subprocess, provider, ledger/database or repository writes.
- `measurement.json`: retained rerun, including all seven samples per operation, median, Node/platform metadata, detached HEAD identity and SHA-256 hashes for 17 relevant draft/schema/fixture/dependency files captured before and after. Observed inputs and HEAD remained unchanged during the run. The source hashes, rather than the worktree's baseline HEAD alone, identify the mutable draft.

Reproduce with Node 24 and the candidate's existing dependencies:

```sh
node /workspace/reports/2026-11-14-argo-shared-world/performance-recon/contract-microbenchmark.mjs \
  /workspace/ARGO/.board/shared-world-contract/worktrees/SW-100-1-e257d63310 \
  > /tmp/shared-world-contract-measurement.json
```

The fixture uses one valid self-only player-speech memory per sequence, 240 text characters per record, a small fixed actor/item roster and no accumulated impressions or loans. Fixture construction, imports/schema compilation and one preliminary State validation per size are outside timing. The hash case uses existing canonical hashing with only `cursor.head` omitted; there is no production `worldStateHash` implementation under test. Generated fixture keys remain in memory and are not exported. Guard timing includes optional genesis binding.

Retained run medians, milliseconds:

| Memories | State + genesis guard | Whole-state hash | structuredClone |
| ---: | ---: | ---: | ---: |
| 128 | 7.46 | 2.09 | 0.38 |
| 512 | 13.82 | 11.47 | 1.73 |
| 1,000 | 30.08 | 16.10 | 3.60 |
| 2,000 | 49.40 | 34.97 | 6.73 |

The earlier exploratory run reported 56.01/40.26/6.44 ms at 2,000 memories for guard/hash/clone. Its source hashes and raw timing samples were not captured; it is not the portable measured record. Variation between runs reinforces that these numbers are provisional rather than an exact performance promise.

The draft's repeated full-State validation/hash is O(n) in retained state size per warm operation. Repeating it over every growing replay prefix makes cumulative cold work O(N²). The smallest supported recommendation is to retain the wire grammar, keep full validation of raw inputs, and use internally owned deeply immutable state/genesis identities with cached validation and hashes. Validate new suffix/changed components and maintain derived record/acquisition/reply indexes. Preserve cumulative resource limits and atomic cache publication. Repeated unchanged reads should reuse trusted work; newly committed full-state canonical hashes still cost O(n), so validation caching alone does not make cold replay linear.

Require separate signed end-to-end evidence at 128/512/1,000/2,000 events for cold open, unchanged scoped reads, speech append, exact retry and second-handle refresh. Include realistic reply/impression/loan histories and actual bounded actor-view projection. Keep the one-million-event ceiling distinct from the earlier 16 MiB/500,000-value capacity limit. If cold replay misses an agreed budget, a history commitment/archive representation is a contract design decision, not an optimization this microbenchmark silently proves safe.
