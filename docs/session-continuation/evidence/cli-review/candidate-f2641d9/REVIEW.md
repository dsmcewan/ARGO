# SC-630 independent CLI review — READY

Exact candidate **f2641d92f5f07bc69b672ee6f6c3a189ee5f46cc**, base **3c8ff55d872891014c89fe43515b3c28fd492626**. The worktree was clean before review and remains clean afterward. Only the three owned CLI/README/new-test files differ. `SYSTEMS`, all `packages` (including the accepted SC-620 host), `scripts`, and `controller` are byte-identical to the accepted base. Source/spec SHA-256 identities are in `preflight.json` and `verification.json`.

**No blocking source or authority finding.** The twelve planned areas have independent evidence, plus two focused controls for a genuinely pending host row and actual executable stdout failure. This is scoped readiness for CLI integration, not a claim that the complete application/native gate passed.

## Implementation strengths

- `scenarios/tempted-fates/shared-world/cli.ts:152` bounds the actual read, refuses nonregular/symlink fixture files, decodes UTF-8 fatally, and validates passive closed data. Lines 161–166 check unique safe identities and each saved actor's exact speech limit, then detach/freeze the fixture.
- `cli.ts:185` resumes the existing authenticated private world. Lines 189–198 bind the entire canonical fixture and adapter version into the resolved host policy; use only `WORLD/turns.sqlite`; choose a fixture through the immutable host turn metadata; and construct no SDK/client discovery. Lines 170–181 verify actual NPC/world/query/focused inbound/sole whisper audiences before returning strict text/null.
- `cli.ts:204` validates operation fields and known fixture ID/exact input before any host dispatch. Line 209 directly maps to host turn/resume/read/cancel. Public results remain the host DTO; context, proposals, commands and row internals are not disclosure fallbacks. Finalizers at line 217 close host, store and caller-owned journal in order.
- `cli.ts:214` emits outside operation recovery. Lines 257–274 validate the full encoded row plus newline, wait for the actual write callback, and distinguish transport failure. Lines 277–298 await legacy/new output and avoid recursive stdout error emission after an OutputFailure.

## Independent evidence

| Area | Result |
| --- | --- |
| C01 | Ordinary subprocess initialization, explicit missing-store refusal, exclusive canonical creation and private directory/files passed. |
| C02 | 16 full-binding/path/permission/missing-file refusals preserved logical world/outbox contents; formatting-only fixture changes reopened successfully. |
| C03 | 16 malformed/oversized fixture cases, fatal invalid UTF-8, closed shapes, actor limits, duplicate/reserved IDs and top-level labels passed; 256 legal bounded entries passed. |
| C04 | Eight known-ID/exact-input/extra-field refusals and a known absent status read caused no turn or event changes. |
| C05 | Real signed replies selected distinct fixtures for identical text; exact whitespace/Unicode survived; null produced no_reply. |
| C06 | Separate-process status/continue/same-ID retries preserved receipt, revision and delivery identity; cancellation suppressed committed delivery. |
| C07 | Full signed replay matched snapshot. Dialogue changed no physical state, time, resources, custody, offers, loans, effects or RNG draws. |
| C08 | Real PLAYER projection suppressed old committed text after 33 acquired memories and after referee closure, while preserving receipts across status/continue/retry. |
| C09 | Held output blocked subsequent input/admission. Eight sync/async sink-failure variants escaped without recursion or further dispatch; numeric-return sinks and awaited init worked; resources reopened. |
| C10 | The actual public writer accepted exactly 16 MiB including escaping/wrappers/newline, rejected one extra byte before another write, awaited callbacks, and rejected broken/active inputs. |
| C11F | The original same-ID concurrent conflict reconciled to the unchanged single turn/attempt and exactly one player plus one NPC event. Distinct processes did not mix responses; full replay matched. |
| C12 | Ordinary legacy query/view/prepare/submit, referee query refusal and the existing seven-event offline demo/replay passed. |
| C06P | An actual host accepted row held before its first snapshot remained revision 0 under CLI status. CLI cancellation then prevented any input event or provider invocation. |
| C10P | A real CLI process writing to a read-only regular stdout FD failed with EBADF and exit 1, retained one replied turn/two events, and never admitted the second input. Retained artifacts verified with correct Node error formatting. |

Use `final-results.json` for the consolidated result and per-area details. `probes.mjs`, `probes-grouped.mjs`, `concurrency-reconciliation.mjs`, `pending-and-stdout.mjs`, and `verify-broken-stdout.mjs` remain in the parent directory. Each subprocess used ordinary Node with NODE_TEST_CONTEXT absent and private regular-file descriptors; the fault test deliberately opened stdout read-only. No provider calls or source edits occurred. Author-reported nine tests/typecheck/contracts/boundaries are separate evidence and were not rerun as a broad suite here.

## Preserved deviations and nonblocking observation

The first combined review launcher exhausted its **180-second aggregate budget** after C01/C02 passed. Its logs and partial results remain unchanged. Subsequent runs select individual original check bodies (`grouping.diff`), retaining the 180-second group budget, 45-second ordinary child deadline and fixed 10-second host generation deadline. No application runner or product timeout was changed. These loaded-environment timings are not performance claims.

Original C11 failed an overly strong availability assertion that **both** simultaneous callers must exit zero. One returned the labeled `CONFLICT: World query requires the exact shared cursor` while the other completed the single turn. The accepted host can race between preparing a cursor and obtaining its matching view before its CAS (`packages/session/src/conversation.ts:118`). The frozen contract does not promise both concurrent calls succeed. `concurrency-reconciliation/` checked the actual originally observed world: unchanged input, single attempt, two events, stable receipts/revision/delivery under three exact reconciliations, and independent distinct-turn selection. The original failing assertion is retained under `group-C11/`; no authority or deduplication assertion was relaxed. Concurrent callers must handle a safe conflict and reconcile the same ID.

C10P's original child already exited 1 on EBADF. Its probe then failed only because Node formats the class as `OutputFailure [Error]:`, while the matcher expected `OutputFailure:`. `stdout-artifact-verification/` checks the retained stderr, zero-byte output, single replied row and exact two-event signed replay with the correct formatting. It did not rerun the child, overwrite the failing result, or alter production behavior.

## Declined to judge / limits

- Full ten-group application acceptance, trusted native assertion completion, CI, merge and any gate-budget change are the coordinator's separate gates.
- The fixture's private response validator has no exported hostile-packet injection seam. I inspected all fixed actor/scope/genesis/focus/input/audience checks and exercised real contexts end-to-end; I did not patch it open or claim arbitrary malformed packet branch coverage.
- These checks establish offline deterministic integration, not live provider quality, network behavior, portable startup latency or automatic success for every concurrent caller.
- Local owner/sidecar rollback/tombstone-loss trust limits are unchanged. This CLI does not add an independent rollback anchor or remote authentication.

## Evidence handling

Publish only the report, hashes, probe sources and explicitly selected nonprivate logs/results. **Do not publish any generated `private-*` directory or the `pending-and-stdout/{pending,broken-stdout}/world` directories**: they contain generated signing keys and host-only genesis/databases. The safe artifact inventory in `verification.json` excludes those private worlds. Original timeout, concurrency expectation and stderr matcher failures remain part of the evidence.
