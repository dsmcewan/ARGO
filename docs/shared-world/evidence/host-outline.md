# SW-510 host and CLI implementation outline

Prepared read-only on 2026-11-14 against shared-world integration `68458b7`; implementation waits for the storage and SW-500 seed dependencies and a leased worktree. Frozen shared-world contracts and SW-510 ticket control this work. No live model calls or new dependencies.

## Headless session

Expose `createWorldSession({ genesis, ledger, principal })` with `query()`, `view(query)`, `prepare(action, requestId)`, and `submit(command)`. Construction validates, detaches and freezes the genesis and fixed authenticated principal. The host authenticates that principal; the library does not turn a supplied actor ID into authentication. Keep one injected WorldLedger as the only authority and leave its close lifecycle with the caller.

Every query/view/prepare uses a fresh validated snapshot. Actor views require the exact latest cursor, scope and fixed actor. Referee sessions can prepare and submit referee commands but cannot invent an actor for query/view. Prepare binds the current cursor and fixed identity into a validated detached command. No prose parsing, model invocation or second state history occurs here.

Submit validates and detaches the exact command and principal before dispatch, then delegates to the ledger before checking current-prefix freshness: an exact retry of a committed old command must reach the ledger's request index. Verify the returned receipt's signature against pinned scope, complete genesis hash, authority key ID/public key, and also require the exact request ID and `worldRequestHash(command, principal)`. Check sequence equals expected sequence plus one, receipt head/event hash binding and nondecreasing world time. A receipt from a different authentic request is a rejection. Do not require receipt cursor to equal latest snapshot, because later concurrent commits and old exact retries are legitimate. Return receipt only. Worker loss after dispatch is an ambiguous outcome; callers reconcile using the same command/request ID.

## Trusted local CLI

Commands: `init --dir PATH --config FILE`, `resume --dir PATH --actor ID` or `--referee`, and `demo --dir PATH`. Actor/referee flags are trusted local operator capabilities, not remote authentication. Inputs and options are closed shapes; stdin never overrides the fixed principal. No implicit provider client, environment-key discovery or default world directory.

Init/demo require a new explicit directory outside the source checkout. Resolve the nearest existing parent with realpath before deciding containment, so symlink aliases cannot place private state inside the repository. Refuse existing directories/worlds and overwrite. Use exclusive directory creation at mode 0700, files at mode 0600 with exclusive creation, and umask 0077 for database/WAL/SHM files. Preserve partial initialization for investigation rather than removing state automatically. Resume validates existing private files and uses persisted genesis/key, never regenerating them. Do not print keys, seeds, private model context or stack dumps.

Persist genesis, private signing key and provenance/initialization metadata under the explicit private directory. A colocated checkpoint is useful for restart comparison but is not independent rollback protection; a separately supplied checkpoint must retain that distinction. Reuse only existing public packages.

Bound stdin bytes while reading JSON-lines, rather than trusting readline's unbounded accumulation. Support closed `query`, `view`, `prepare` and `submit` operations. Return typed JSON rows and bounded errors. A prepared speech proposal is never labeled as spoken text. CLI speech display happens only after that exact command's receipt is verified and a fresh scoped view confirms the committed record remains visible and current cutoff permits release. Close storage in finally; no process.exit shortcut.

## Offline demonstration and tests

Use SW-500 `buildSharedWorldCampaign` with explicit hero profile, night, borrowed_lamp, legend, floor4 and Melia policy activation. The factory retains Melia's traveler_lamp and creates no loan. Generate a real Ed25519 key and signed persistent WorldLedger. Use separate fixed hero, Melia and referee sessions over that ledger.

Hero asks Melia about the lamp. Invoke the world model adapter through an injected offline provider and capture the actual contextual request privately. Its response is an explicit offline provider fixture, not renderer/template dialogue. Submit the resulting proposal unchanged and display only the verified committed speech. Assert ordinary conversation leaves custody, resources and loans unchanged. Then Melia issues an explicit offer; hero accepts its exact hash, causing one atomic loan/custody change. Travel out and back under night lighting, verify oil/time effects, return the lamp, retry an identical request, close/reopen and compare replayed state/hash.

Test fixed identity and scope; signature-correct receipts for different requests/principals; stale cursor/race refusals without partial effects; exact old retry; current-only views after revocation/closure; visibility/privacy; rejected generated speech never displayed; conversation never creates a bargain; custody and return fulfillment; signed restart/replay. CLI tests cover private directory mode, file mode, overwrite refusal, source-checkout/symlink containment, malformed JSON-lines and no live calls. Run the demo as an ordinary Node process with NODE_TEST_CONTEXT absent as well as test-runner integration.

## Ownership and dependency handoff

Implementation owns packages/session/, shared-world CLI/README and shared-world-session tests only. Coordinator owns lockfile, scenario dependency/export wiring and final controller acceptance. Confirm finalized `openWorldLedger`, `verifyWorldReceipt`, pure view/replay APIs and `createWorldModelAgent` after storage/model integration; do not change frozen contracts to fit the host. No source edits were made during this prep.
