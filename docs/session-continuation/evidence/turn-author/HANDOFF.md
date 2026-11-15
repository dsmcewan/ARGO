# SC-620 handoff

Candidate `e096530b2618119ab3dd545f3defe36b754021bd`, on base `3a2fab7ab5a50dc7cd4f9eaa8732f027a1ce733d`; interim store checkpoint `3870f44b20d241e9ca855279ccf3fd703801a22d`. Only packages/session and the two assigned new test files changed. Source hashes are in verification.json. No Board writes, paid calls, network, subagents, merges or pushes.

## Implemented API

The public session package exports the frozen-contract `openWorldConversationStore`, `createWorldConversation` and public types. Store open requires explicit create/open and supplies the fixed genesis, authenticated direct player/NPC principals and complete resolved model policy. Its opaque capability contains only public host binding metadata and close; generic writes are internal. Parent-directory symlink aliases, unsafe permissions, foreign schema/application/binding, missing existing stores and overwrite are refused. A worker owns the separate SQLite outbox with short WAL/FULL transactions, closed phase guards, revision CAS, capacity bounds and permanent generation markers. It receives no private seed or profile text.

The host internally constructs fixed sessions and the existing model adapter, injecting immutable per-turn callback metadata. It offers turn/resume/read/cancel/close, keeps waiter abort separate from durable cancel, saves exact input/reply commands before dispatch, and never regenerates a consumed attempt. Any submit exception remains uncertain unless a signed current-journal event proves a different request occupied the expected next slot. Signatures, full command/principal identity and actual event prefix bind saved receipts. Reply delivery is selected only from the latest PLAYER projection; cancellation, closure, eviction or a stale read cannot fall back to outbox text. No speech invokes a physical or loan action.

## Verification and review repairs

Thirteen host tests passed, plus the strengthened exact-retry-after-later-appends case passed separately. The store's combined run passed ten of eleven cases; the final child harness initially inherited --input-type into its Worker and failed before the race. It now writes/runs a private ordinary .mjs file, and the separate-process CAS test passes. This verifies all eleven store cases, with exact intermediate outcomes retained rather than relabeled. The five independently reproduced store defects are fixed with regressions: captured open mode, literal internal SQLite prefix, full-queue close drain, raw byte bound before parse and worker-enforced deadline rejection of late null/failure results. Explicit parent-alias refusal is also covered.

Existing regression suites pass: dialogue 23, views 13, session 10 and storage 13 (59 checks). Typecheck, frozen contracts and import boundaries pass. The erroneous singular view filename in an earlier shell command is retained in regression-view.log; the correct unchanged shared-world-views suite passed in regression-views.log. No runner/policy was altered, and no application acceptance is claimed here.

## Integration and limitations

Root owns the package-lock update for the session manifest's declared @argo/interventions and @argo/model-client dependencies, CLI integration, Board records and independent exact-candidate gates. The source manifest is a protected-file edit and must follow the recorded Board refusal/release process if applicable. SC-630 can use the selected API directly; no further API invention is needed.

At-most-one generation is coordinated only through one canonical outbox file. Unknown generation after a crash becomes a durable uncertainty outcome, not another model call. The outbox is trusted local operational storage, not a second world authority or independent anti-rollback anchor; consistent local tampering/tombstone loss and restoring both stores are not solved. Provider-policy IDs and canonical resolved configuration bind declarations, not callback executable authenticity. Every test uses injected offline provider responses; no live coherence/latency is asserted.
