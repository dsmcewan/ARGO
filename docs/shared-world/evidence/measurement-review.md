# Shared-world measurement instrument review

**READY for static instrument/API review. No remaining finding in the reviewed scope.**

Exact final candidate: `fb5f140199a4523786da05fd297f9e8857a80208`.
File: `docs/shared-world/measure-runtime.mjs`.
File SHA-256: `06aab24ccbe212b12356a73cbfc062542d557571a40a02f6cad546150cb74107`.
Checkout: `/workspace/ARGO/.worktrees/shared-world`, clean when checked.

This was a read-only review of the measurement instrument, not acceptance of my adapter implementation or any runtime. No repository edits, provider calls or runtime executions were performed. `node --check docs/shared-world/measure-runtime.mjs` passed. Required shared storage/replay exports are not yet present at this integration commit; execution/performance claims must wait for runtime integration.

## Verified corrections

The initial candidate was `cc4919c8a83172f63c8794f72684b6f9cdeeab9d`; label corrections were reviewed at `a58c9b5727d301ed066b88a432c95013f707daeb`. The final `fb5f140` delta resolves the remaining provenance/verification observations. Earlier finding text is preserved in `measurement-review-a58c9b5.md`.

1. **Whole-workload event-loop attribution:** lines108/116 now name `host_workload_parent_event_loop_delay_ms`; line120 explicitly includes projection, complete-state hashes, JSON sizing and logging and disclaims isolated store/worker blocking. The histogram is disabled before the separately timed synchronous forensic replay.
2. **Cold-handle terminology:** line99 names `cold_handle_open_ms`; line119 explicitly says the OS page cache is warmed and no cold-disk measurement is claimed.
3. **Source provenance:** lines25–27 pin HEAD and require a clean checkout before project imports; lines112–114 require unchanged HEAD and a clean checkout at completion and record the pinned candidate. Dirty input and persistent source changes can no longer silently produce the old misleading candidate record. This remains an ordinary-process measurement rather than immutable filesystem isolation.
4. **Complete sibling prefix checks:** lines74–76 and95–97 compare both cursor and content hash. Lines81–83 check the timed one-event refresh against both append receipt cursor and its committed state hash. These additional assertions are outside the timed intervals. Because state hashing excludes only head, combining full cursor equality with state-hash equality binds the complete projected prefix.

## Static API and protocol checks

- The campaign options match the closed seed API. The pinned pack has Melia at the starting harbor, standing with busy_until0, the configured `npc_host` controller, and the selected authored loan policy. The hero ID avoids the known generated lamp collision. No scene movement or time advance is introduced by these zero-duration speech fixtures.
- At each configured even prefix N, odd records belong to hero and even records to Melia. Every request is `observation_<resulting sequence>`. A bulk NPC turn at N references the immediately preceding hero memory by the frozen domain/genesis/request/sequence formula.
- The measured append after prefix N is hero record N+1. Its five exact retries retain the identical old expected cursor, request, command and principal and compare the original receipt. Then the measured contextual reply references memory N+1 and uses request N+2. Each checkpoint therefore ends at N+2; the next fill resumes on an even sequence. All configured targets satisfy this parity.
- `prefix_events` identifies the pre-sample checkpoint; `after_sample_events`, `state_bytes` and `state_hash` describe the post-dialogue checkpoint. `fill_ms` is the incremental fill since the previous checkpoint's additional two sampled commits:128,382,486 and998 fixture appends, not cumulative construction cost.
- `warm_scoped_view` includes both an asynchronous snapshot and synchronous authenticated actor projection. `warm_contextual_dialogue_and_commit_ms` includes all fresh-context reads, injected adapter work and commit. The labels are appropriately end-to-end.
- The injected xAI `responses.create` client shape matches model-client wire handling and returns one complete text-only JSON object. Its registered capability does not require a token counter. The adapter receives the fixed Melia actor, exact scope and current cursor; no live SDK/default client exists. The explicit `modelCalls===1` assertion checks normal injected generation count.
- The sibling is opened at prefix N, remains at that prefix during writer append/retries, and its measured snapshot at line81 consumes exactly one unseen event. Its later post-dialogue snapshot consumes one more event. No sibling writes occur.
- Event pagination uses the contiguous accepted-event count as exclusive sequence cursor. Whole-history `replayWorld` is timed separately. `assert.deepEqual(replay.value,final)` at line111 compares the full replayed state, including cursor/head, rather than trusting only a state hash. Final deterministic hash is recorded afterward.

## Deliberately limited coverage

The retry measurement covers repeated exact retries on the same live writer immediately after its commit; it does not claim restart/lost-acknowledgment or retry after a different handle writes. The sibling measurement covers suffix-read refresh, not competing writers/CAS races. Those need storage tests elsewhere.

Five warm read/retry samples and one append/dialogue/suffix sample per prefix are descriptive single-machine observations. The aggregate event-loop histogram cannot attribute cost to one operation or prefix. There is no measured provider latency, live response quality, combat/custody load, resource progression or general graph-scale conclusion. Runtime measurements must wait for the missing authority/storage implementations and their public exports.
