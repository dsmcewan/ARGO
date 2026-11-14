# SC-620 independent host/driver review

Candidate: **`e096530b2618119ab3dd545f3defe36b754021bd`**, clean immutable checkout `/workspace/reports/2026-11-14-argo-continuation/turn-candidate-e096530`.

Verdict: **NOT READY within the host/driver review scope: two Important findings and one Minor finding.** The 19 prepared semantic controls pass across the original run and a corrected reviewer child-process rerun, but three additional boundary controls reproduce the findings below. No product source/index/refs changed. All clients are explicit offline injections; no provider/network calls or subagents. This ordinary-process review is not the later isolated native ten-group application gate.

## H1 — Important: provider dispatch after completed durable cancellation

`packages/session/src/conversation.ts:77`

The generation `refreshContext` callback loads and checks the attempt revision/cancellation, then returns `npc.view(query)` without checking ownership again after that asynchronous view completes. The adapter's final `beforeGenerate` refresh can therefore return authorized-looking old context after another handle has cancelled the turn. Cross-handle cancellation cannot abort the original host's in-memory controller.

Reproduction A in `late-await-probes.mjs` pauses the third generation view refresh, verifies zero provider calls, completes `cancel` through a second store/host handle, then releases the paused view. The injected provider's actual `responses.create` runs **once after cancellation completed**. The later result is suppressed and only player speech commits, but the contract promises cancellation prevents subsequent generation as well as delivery.

Recheck the exact attempt identity/revision, phase, cancellation and absolute deadline after the awaited NPC view and before returning it to the adapter. Preserve the existing abort checks. The regression must count actual provider dispatch, not merely eventual absence of NPC speech. `late-await-results-e096530.json` records the failing `1 !== 0` assertion.

## H2 — Important: close waits on unresolved caller-owned journal acknowledgment

`packages/session/src/conversation.ts:138`

`close()` waits for every tracked operation and active driver. Those promises include arbitrary external `ledger.submit`, `events` and snapshot waits, not just bounded local outbox work. Aborting generation does not interrupt a pending journal submission. A lost acknowledgment whose promise never resolves can therefore prevent the host from closing, despite the durable pending command already being sufficient for recovery through another handle.

Reproduction B in `late-await-probes.mjs` uses the real journal to commit player speech, then holds its acknowledgment promise. `host.close()` stays unresolved until that acknowledgment is released; it is causally coupled to the caller-owned ledger. The test confirms the event exists, cancellation was not requested, no model call occurred, and the ledger remains usable. This is distinct from the passing prepared close test, which covers an abort-ignoring provider with the adapter's timeout/abort race.

Close should stop local admission, abort/fence generation and detach/fence external awaits while retaining exact pending intent. It must not close the caller's ledger, report the event rejected, discard the command, or let a late continuation mutate a closed store. Add recovery through a fresh host after close while the original acknowledgment remains unresolved; check late fulfillment and rejection too.

## H3 — Minor: active event-page containers execute before validation

`packages/session/src/conversation.ts:34-35`

The event DTO is guarded, but its returned page is inspected with `page.length` and `page[0]` first. An array index accessor executes once; a proxy page executes eight get traps during the independent control. `page-container-probes.mjs` reproduces both while reading an otherwise committed turn.

Guard the passive, dense, bounded outer page before reading its length or elements, then keep the existing event/signature/prefix checks. This is a passive-DTO contract defect, not a claim that an injected ledger callback is an untrusted sandbox: the capability itself remains a trusted dependency. Results are in `page-container-results-e096530.json`.

## Passing evidence and reviewer corrections

`results-e096530.json` records **18 passing groups and one initial child-harness timeout**. Passing groups cover exact saved commands before dispatch; contextual provider text and metadata; both player/NPC real commits followed by bad receipts; unchanged retry after later events; pending cancellation; concurrent handles and waiter abort; durable cancellation/late text; close during generation; absolute deadline; stale context with another active writer; closure after reply commit; player memory eviction while the NPC still sees the reply; cancellation during a player read; silence/malformed/tool outputs; passive public input and opaque capabilities; missing/foreign signed prefixes; real journal-only rollback; occupied-slot rejection proof; and ignored token counting. Some groups contain multiple controls.

The actual child process did not reach its provider marker within the reviewer's initial five-second startup allowance. The diagnostic run was still alive with no emitted error. The original polling helper also kept a timer alive after the readiness failure; after all assertions and the JSON record were saved, those two reviewer processes were stopped. These are preserved harness failures, not product findings or native gate passes.

`probes-harness-fixed.mjs` changes only the child control's startup allowance to 20 seconds, stops its readiness poll on cleanup, and adds private stage diagnostics. The unchanged child semantic assertions then passed in `child-fixed-results-e096530.json`, process exit **0**: actual SIGKILL after provider entry, intact permanent attempt after restart, zero second provider calls, and terminal `generation_uncertain`. Thus **19/19 prepared semantic groups are passing across these runs**, not a claim that the original 19-group process exited successfully. The original prepared source/hash and all failure logs remain.

Both supplemental lifecycle controls and the outer-page control exited **1** with their intended product assertions failing. A first outer-page invocation had a misspelled candidate path and stopped at Git identity checking before product imports; it was corrected, not counted as runtime evidence.

Reproduce with the retained script, exact `--root`, `--expected-sha e096530b2618119ab3dd545f3defe36b754021bd` and an outside-repository `--report` path. `--only` permits the named control. The scripts require an ordinary Node process and check exact clean Git identity before imports and after execution. Source/evidence hashes and observed run exits are in `verification-e096530.json`.

## Scope deliberately set aside

Store/schema/permission/COMMIT internals have a separately assigned independent review. This report checks the host interactions with those capabilities, not a replacement store verdict. Cold-replay optimization, existing authority rules and full application/GitHub acceptance are not re-audited here. Injected executable behavior is not authenticated by a policy hash; both-store rollback and lost attempt/silence tombstones retain the documented trusted-local-storage limit. Current view disclosure uses its valid snapshot/read linearization; this review does not invent an impossible guarantee that no world change can occur between every asynchronous read and JavaScript return.
