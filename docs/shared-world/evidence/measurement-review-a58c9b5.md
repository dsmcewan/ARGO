# Shared-world measurement instrument review

Read-only static review of `docs/shared-world/measure-runtime.mjs`.
Initial candidate: `cc4919c8a83172f63c8794f72684b6f9cdeeab9d`.
Label-fix candidate checked: `a58c9b5727d301ed066b88a432c95013f707daeb`.
File SHA-256 at the latter: `cc5f389a5af3a03a12e0246d42f84affd98c92fd363453547a1d947c029ca627`.
Worktree `/workspace/ARGO/.worktrees/shared-world` was clean when read. No repository edits, provider calls or runtime executions were performed. `node --check docs/shared-world/measure-runtime.mjs` passed. Storage/replay exports are not yet implemented in this integration candidate, so this is not a runtime acceptance or performance result.

## Remaining findings

### Important — reported source identity does not necessarily identify executed bytes

`docs/shared-world/measure-runtime.mjs:104` reads Git HEAD only after all measurements. There is no initial SHA or clean-worktree assertion before dynamic imports at lines26–30, and no final equality/clean check. Running a dirty checkout labels changed executed source with the unchanged committed SHA; committing/changing the checkout during a long run can label already-imported code with a later SHA. The result's `candidate` field would then be misleading evidence.

Capture the expected commit and clean status before imports; refuse dirty input and changed HEAD/status at the end. Record the starting immutable identity. This is instrument provenance, not a storage behavior finding.

### Minor — sibling correctness checks do not bind cursor and state content together at every checkpoint

At lines71 and89, comparison uses `worldStateHash`, which deliberately omits `cursor.head`. A sibling snapshot with an incorrect head but otherwise matching content passes those assertions. At the actually timed one-event refresh, line77 compares only cursor, so that returned snapshot's body is not checked against the committed receipt; a subsequent refresh could repair the body before line89.

For the initial/final sibling snapshots compare both cursor and state hash (or full state outside the timed block). After the timed one-event refresh, retain the cursor equality and compare `worldStateHash(refresh.value)` with `append.value.state_hash`. These are small assertion additions; the measured intervals need not change.

## Label delta verified

The initial event-loop histogram attribution was too narrow: it includes parent-side projection, complete-state hashes, equality assertions, JSON sizing and stdout logging in addition to storage work. The `a58c9b5` change renames it `host_workload_parent_event_loop_delay_ms` and explicitly states that it does not isolate store/worker blocking. The histogram is disabled before standalone synchronous forensic replay, which is measured separately. This correction resolves the attribution issue.

`cold_handle_open_ms` now accurately describes a newly opened/fully verified handle against a database just written by the existing writer. The explicit warmed-OS-page-cache limitation resolves the former cold-disk ambiguity.

## Static API and protocol checks

- The campaign options match the closed seed API. The pinned pack has Melia at the starting harbor, standing with busy_until0, the configured `npc_host` controller, and the selected authored loan policy. The hero ID avoids the known generated lamp collision. No scene movement or time advance is introduced by these zero-duration speech fixtures.
- At each configured even prefix N, odd records belong to hero and even records to Melia. Every request is `observation_<resulting sequence>`. A bulk NPC turn at N references the immediately preceding hero memory by the frozen domain/genesis/request/sequence formula.
- The measured append after prefix N is hero record N+1. Its five exact retries retain the identical old expected cursor, request, command and principal and compare the original receipt. Then the measured contextual reply references memory N+1 and uses request N+2. Each checkpoint therefore ends at N+2; the next fill resumes on an even sequence. All configured targets satisfy this parity.
- `prefix_events` identifies the pre-sample checkpoint; `after_sample_events`, `state_bytes` and `state_hash` describe the post-dialogue checkpoint. `fill_ms` is the incremental fill since the previous checkpoint's additional two sampled commits:128,382,486 and998 fixture appends, not cumulative construction cost.
- `warm_scoped_view` includes both an asynchronous snapshot and synchronous authenticated actor projection. `warm_contextual_dialogue_and_commit_ms` includes all fresh-context reads, injected adapter work and commit. The labels are appropriately end-to-end.
- The injected xAI `responses.create` client shape matches model-client wire handling and returns one complete text-only JSON object. Its registered capability does not require a token counter. The adapter receives the fixed Melia actor, exact scope and current cursor; no live SDK/default client exists. The explicit `modelCalls===1` assertion checks normal injected generation count.
- The sibling is opened at prefix N, remains at that prefix during writer append/retries, and its measured snapshot at line76 consumes exactly one unseen event. Its later post-dialogue snapshot consumes one more event. No sibling writes occur.
- Event pagination uses the contiguous accepted-event count as exclusive sequence cursor. Whole-history `replayWorld` is timed separately. `assert.deepEqual(replay.value,final)` at line103 compares the full replayed state, including cursor/head, rather than trusting only a state hash. Final deterministic hash is recorded afterward.

## Deliberately limited coverage

The retry measurement covers repeated exact retries on the same live writer immediately after its commit; it does not claim restart/lost-acknowledgment or retry after a different handle writes. The sibling measurement covers suffix-read refresh, not competing writers/CAS races. Those need storage tests elsewhere.

Five warm read/retry samples and one append/dialogue/suffix sample per prefix are descriptive single-machine observations. The aggregate event-loop histogram cannot attribute cost to one operation or prefix. There is no measured provider latency, live response quality, combat/custody load, resource progression or general graph-scale conclusion. Runtime measurements must wait for the missing authority/storage implementations and their public exports.
