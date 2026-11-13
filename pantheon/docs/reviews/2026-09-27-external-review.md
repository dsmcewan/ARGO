# Pantheon - external review, 2026-09-27

Reviewed: `~/Projects/pantheon` at `main` `fe9fb2b` (12:45) and the `seat-core` worktree at
`7beba20`. While the review ran, the tree gained one test commit (`fe9fb2b`) and uncommitted edits
to four `src/team/` files (+100/-22). Findings are against the committed code at `fe9fb2b` unless a
line says otherwise. Nothing in the repo was modified except the addition of this file.

Reviewer: Claude Fable 5.1, working from the Windows side over `\\wsl.localhost`, read-only, with
six specialist sub-reviews (board; swarm/roles/seating; view/scripts; team/docs/worktree; test
quality; CLI transport). No vendor API was called and no key was loaded at any point. Where a
sub-review ran a probe it did so with throwaway scripts inside WSL against temp directories.

Method: read `README.md`, `STATE.md`, `docs/architecture.md`, the vendor-facts spec and the SDD
progress file; ran both suites in WSL; ran the multi-model-seats hygiene scan (0 findings); read
`src/sdk/*`, `src/seat/{store,lock,identity}`, `src/route/router.mjs` line by line; checked the
wire-contract questions against live vendor docs on 2026-09-27 (OpenAI reasoning and
conversation-state guides, Anthropic thinking page, xAI Responses reference, Gemini
generateContent reference); each sub-review probed its own area.

Severity, as in the seat-audit skill: **critical** = wrong answers or a guaranteed failure on a
supported path; **important** = silent degradation or a capability claim the code does not deliver;
**minor** = docs, hygiene, latent.

## Verdict

The two ideas the README says carry the project - a seat as a proven identity and a board as a
content-addressed store with a controller that is not a vendor - are real in the code and are
tested with oracles that can fail. The seat store's refusal of content, the chain, the
compare-and-swap with fencing, the crash-marker on history, the four-process lock race and the
board's blob-bound critiques are the strongest parts of the tree and they hold up under probing.

The project's own sentence - "a green suite means consistent with the author's assumptions" -
applies to it. Nearly every defect below sits where the code meets something outside its fakes:
the vendor wire (stop reasons, finish reasons, truncation, thinking budgets, a second SDK's retry
policy), the HTTP surface, the merge-versus-ship boundary, and the superseded CLI resume. Several
load-bearing sentences in `README.md` and `STATE.md` are false against today's code, and the
project would want to know that more than it would want the individual bugs.

Counts: 3 critical on the current surface, 2 critical on the superseded CLI surface, roughly 25
important, roughly 40 minor.

## 1. What holds (verified)

- `node --test`: 405/405 at `b91615a`, 409/409 at `fe9fb2b`, ~4.3 s, with no vendor keys and no
  network. The `seat-core` worktree: 234/234.
- No vendor SDK is imported anywhere under `src/` (grep clean). The three SDKs are injected at
  `bin/` and `scripts/` as the README says.
- Hygiene scan (multi-model-seats `records/failure-modes.json`, as of 2026-09-17): 0 findings.
  No stale endpoints, deprecated parameters, or retired model ids.
- Git: no remote; `seat-core` is a strict ancestor of `main` (19 behind, 0 ahead); both trees
  were clean at the start of the review.
- `canon.mjs` refuses `undefined`, `NaN`, `-0`, `+/-Infinity`, BigInt at any depth; the codec is
  bound into the digest; a link to an absent cid is refused at put time with nested fields walked.
- Ref compare-and-swap is genuinely cross-process: a four-process race on one ref produced 1 ok
  and 3 `CAS_LOST` with no lost update. Fencing refuses a stale generation even when the expected
  cid matches. Bound-review is evaluated on fast-forward. The checker projection strips
  `commit.msg` and says so. `record-split` blocks a decision slot at every merge including ship.
- The board-refs mutation check (`tests/board-refs.test.mjs:223-251`) flips: strict path returns
  `CAS_LOST`, mutated path returns `ok:true` with item A gone.
- `lock.mjs` never age-steals from a live owner (`stealIfDead` gates on `process.kill(pid, 0)`,
  EPERM counts as alive; the test plants a one-hour-old lock owned by the live pid).
- `history.mjs` two-phase marker: the crash repro is real, the legacy (no-marker) path replays in
  full, and the control case at `tests/sdk-history.test.mjs:50-57` discriminates.
- Swarm: layer-2 pairing is a derangement for every N >= 2 (rotate-by-one; N = 1 is refused); a
  failed target is skipped and never re-paired to self; `Promise.allSettled` on every layer; same-
  round isolation in `discuss.mjs` is data-flow (snapshot, append after settle), not ordering.
- Router: refuses unknown needs by name; `familyChange` treats an unknown family as unsafe.
- Credential hygiene: the OAuth token reaches only the SDK constructor; `apiKey: null` is asserted
  with `ANTHROPIC_API_KEY` set in the environment; a missing key names the variable, never a value.
- The four CLI vendors' store layouts assumed by `locate.mjs` match what is on the machine
  (claude `<enc>/<uuid>.jsonl`, codex `YYYY/MM/DD/rollout-*.jsonl`, grok `<pct-cwd>/<uuid>/`,
  agy `<uuid>.db`), and `conform` holds against claude 2.1.274, codex 0.145.0, grok 1.0.41,
  agy 1.2.11.
- Live vendor docs on 2026-09-27 confirm: `reasoning.context: "all_turns"` is a real OpenAI field;
  OpenAI now returns `encrypted_content` on reasoning items by default in stateless mode (so the
  missing `include` is not a defect); persisted reasoning is reusable only within a model family;
  Anthropic `max_tokens` includes thinking; effort default is `high` on most models and `medium` on
  Opus 5.5; the parameter is `output_config.effort`; changing effort invalidates the prompt cache.
  The router's Anthropic notes are correct on every one of these.

## 2. Critical

### C1. The view's `/turn` can be driven by any web page or local process - `src/view/server.mjs:100-101, 142-156` (probe-verified)

No Host, Origin, `Sec-Fetch-Site`, content-type or token check, and no CORS response. A page
anywhere does `fetch("http://127.0.0.1:7777/turn", { method: "POST", mode: "no-cors", body })`
with a `text/plain` body; no preflight fires and the server parses the body anyway. The probe sent
`Origin: https://evil.example` and `Host: evil.example:1` and got 200 with results. The attacker
picks `models` (the dearest rung), injects prompts into existing seats by `purpose`, or fills
`~/.pantheon` with seat and history files. Because the Host header is discarded, DNS rebinding
gives a page same-origin reads of `/seats` (each label's full last reply), `/events?from=0`
(2000-event replay including whole Response objects) and `/board`. "Binds loopback only" is true
and is the only control. Fix: require `Host` in `{127.0.0.1:port, localhost:port}`, require
`content-type: application/json`, refuse any cross-site `Origin`, and consider a per-process token.

### C2. `merge()` is a second door onto the shipping ref - `src/board/merge.mjs:189-206`; used by `scripts/board-run.mjs:224` (probe-verified)

`ship()` evaluates eight gates. The controller can also call `merge(wip -> refs/board/*)` under
`DEFAULT_POLICY`, where an artifact slot moves on a cross-lab approval alone: no TESTS, no LEASE,
no ACTOR. Probe: approved artifact, zero `repro` entries anywhere, `merge().ok === true`, artifact
on the shipping ref. The demo script's "ship it" step goes through this path, not through
`ship()`. `docs/architecture.md:117` ("`ship()` is the only way work reaches the shipping ref") is
false. Fix: refuse `merge()` targets under `refs/board/` unless called from `ship()`, or make
`ship()` the only exported writer for that class.

### C3. On the superseded CLI surface, Codex cannot be resumed and the post-turn chain is never verified - `src/seat/turn.mjs:111-115`, `src/seat/argv.mjs:23-36, 94-104`, `bin/pantheon.mjs:163-181, 195-211`

The README says the CLI path is "superseded, still working". Two things make "still working"
false. (a) `turn.mjs` matches `session_id | conversation_id | sessionId`; a recorded `codex exec
--json` stream on this machine begins `thread.started { thread_id }`, which never matches, so no
token and no chain are stored and `turn` exits 0 printing "seat not updated". Even with an id,
the resume argv is `exec resume <id> -C <cwd> --sandbox read-only ...`, and `codex exec resume
--help` (0.145.0) lists neither `-C` nor `--sandbox`; `conform` checks only top-level
`codex --help`, where both exist. (b) `pantheon.mjs` verifies the chain against the seat's OLD id
before the turn, then overwrites token and chain with whatever id and transcript the vendor
reports, with no `verifyExtends(after, held.chain)`. A fake `claude` on PATH that answers
`--resume` with a new id and a new transcript produced `verified ... grew=0`, `ok ... resumed`,
exit 0, and a rebased seat. "Refuses to proceed if the chain it holds was not extended" is a
pre-turn property only. Execution against real vendors was not attempted (forbidden here);
help output and a recorded sample were checked.

## 3. Important - SDK transport (the current surface)

### T1. The streamed replay path keeps only prose, dropping reasoning and thinking items - `src/sdk/adapter.mjs:210-215, 333-338`; `src/sdk/stream.mjs:108-112`

`STATE.md` says "keeping only the prose would silently drop reasoning while still looking like a
working replay", and the blocking replay path preserves every output item
(`adapter.mjs:249`). The streaming replay path does not: `streamTurn` returns `text`, `tools`,
`response_id` but not `final`, and `appendReplay` appends `{ role: "assistant", content: text }`.
The view always streams, so every Google and Anthropic turn through the view - and every OpenAI or
xAI turn under `PANTHEON_CONTINUITY=replay` - replays a text-only history while `continuity`
reports "replayed the full local history". No test calls `sendTurn`/`sdkTurn` with both `onEvent`
and replay; `tests/` contains zero references to `stream.mjs`. Fix: return `final` (or the
accumulated output items / content blocks) from `streamTurn` and build history from it exactly as
the blocking path does; add the missing test.

### T2. Anthropic: a 1024-token hard cap, `stop_reason` never read, and a default model the docs say will think - `src/sdk/adapter.mjs:76, 285-298, 329`; `src/sdk/stream.mjs:58-71`

`max_tokens` is `extra?.max_tokens ?? 1024` and no caller ever passes `extra` (grep: `extra` is
threaded through `seat-sdk.mjs:49, 82` and reaches no call site). The adapter's default model is
`claude-sonnet-5`, not the `claude-haiku-4-5-20251001` that `STATE.md` and `SEAT_FACTS` name.
Anthropic's docs: thinking is adaptive, effort defaults to `high`, "`max_tokens` is a hard cap on
total output for the request, thinking and response text combined", and "a `max_tokens` sized for a
response with no thinking is often too small once Claude starts thinking". Neither the blocking
path nor the streaming path reads `stop_reason` (`message_delta` carries it), so a reply cut at
`max_tokens`, or a `refusal`, is returned with `complete: true`, hashed into the chain and
appended to the replay history as a full assistant turn. Fix: read `stop_reason`, treat anything
but `end_turn`/`stop_sequence` as `complete: false` with the reason, raise the default cap to the
thousands, and reconcile the default model with the facts table.

### T3. Google: blocked or empty replies are persisted and then poison the seat - `src/sdk/adapter.mjs:274-283, 340-343`; `src/sdk/stream.mjs:43-54`

Neither path reads `promptFeedback.blockReason`, candidate presence, or `finishReason`. Gemini's
reference: "if set, the prompt was blocked and no candidates are returned". The adapter then
returns `text: ""` with `complete: true` and writes `{ role: "model", parts: [{ text: "" }] }` into
`history/<key>.json`. Gemini rejects an empty text part on a later request ("Unable to submit
request because it has an empty text parameter"; multiple independent reports against the JS,
Python and Go SDKs), so one safety block makes every subsequent turn on that seat fail until the
history file is hand-edited. A `MAX_TOKENS` finish is likewise silent. Fix: fail closed on absent
candidates and on any `finishReason` other than `STOP`; never append an empty model part.

### T4. Responses: `status`/`incomplete_details` never read; refusals collapse to an empty answer - `src/sdk/adapter.mjs:373-389`; `src/sdk/seat-sdk.mjs:40`

The blocking path's `normalize` reads `id`, `output_text`, `output` and nothing else, so a
`status: "incomplete"` (cut at `max_output_tokens`) response is returned as complete and persisted
because it carries an id. A `refusal` content item has a `refusal` field, not `text`, so
`collectText` yields `""`; `exchangeTurns` then drops the assistant turn from the chain (empty text,
no tools) while `sdkTurn` returns `ok: true`. The seat ends with a dangling user turn and no record
that a refusal happened. Streaming: `response.incomplete` is unhandled and falls through to
"stream ended without a terminal event" - fail-closed, wrong diagnosis (minor).

### T5. Effort never reaches the wire - `src/role/seating.mjs:99-126, 493-519`; `scripts/live-ship.mjs:71, 88-124`

`SEAT_FACTS` records the effort parameter per lab, `seatingPlan` returns `effort` and
`effort_state` per chair, `raiseEffort`/`escalate` "escalate effort before the model", and the
commit message for `ab64772` says so. Nothing converts any of it into `reasoning: { effort }` or
`output_config: { effort }` on a request: `live-ship`'s `turn()` sends `{ vendor, purpose, model,
prompt }`, the view sends `{ vendor, purpose, prompt, model }`, `extra` has no caller. Every
vendor runs at its own default effort. This is the same shape as the defect the project recorded
about fallback ranks ("nothing consulted it at runtime, which made the ranks decoration"). Latent:
once wired through `extra`, `{ reasoning: { context: "all_turns" }, ...extra }` at
`adapter.mjs:239-240` and `:322` would clobber `context` with `{ effort }`.

### T6. xAI replay: the reasoning-continuity claim is OpenAI's, applied to a vendor whose docs do not make it - `src/sdk/adapter.mjs:234-254` (shared Responses path)

xAI's Responses reference documents `reasoning.effort`, `reasoning.generate_summary`,
`reasoning.summary` - no `context`. It lists `reasoning.encrypted_content` as an `include` value
the caller must request, which suggests encrypted reasoning is not returned by default there as it
now is at OpenAI. Codeword recall proves text replay on xAI; it does not prove reasoning replay.
`STATE.md`'s "replay loses nothing in continuity, including reasoning ... verified live in both
modes on openai and xai" is established for OpenAI only. Fix: on xai replay, send
`include: ["reasoning.encrypted_content"]`, and have the adapter report whether the returned
reasoning items actually carry `encrypted_content` rather than assuming.

### T7. The Google client still retries five times - `src/sdk/adapter.mjs:182`; `tests/sdk-transport.test.mjs:327-340`

`@google/genai` 2.24.0 has no `maxRetries` constructor option; its retries live at
`httpOptions.retryOptions.attempts` (default 5 on 408/429/5xx, per `dist/genai.d.ts`). The
adapter passes `maxRetries: 0`, which the SDK ignores, and the test asserts it on a universal fake
that accepts anything. So "one visible retry policy, in one place" holds for three vendors and
the fourth silently takes up to five attempts under a log line that says one - the exact
`shouldFallThrough`/spend corruption the test's own comment names.

### T8. The two-phase history write has a second window that loses an acknowledged exchange - `src/sdk/seat-sdk.mjs:101-114`; `src/sdk/history.mjs:43-44`

A crash after `saveSeat` and before `commitHistory` leaves the seat record's `exchanges` and chain
containing the exchange while the marker is short. The next turn drops the tail (reported as
`history_rolled_back`), replays a history that lacks it, and rewrites the file at `:99` - the text
is gone and chain and history now disagree. `history.mjs:43-44` ("the seat record never saw that
exchange") is false for this window, and `recordExtendsLocally` (`seat-sdk.mjs:145`) is never
called by `sdkTurn`, so nothing reconciles them. `STATE.md:182-191` "only a marker is recoverable"
is overstated: the marker recovers one of the two windows.

### T9. `stealIfDead` can seat two holders after a dead owner - `src/seat/lock.mjs:69-80` (probe-reproduced)

Check-then-unlink. Two waiters, one dead owner: B reads the dead lock and is preempted; A unlinks
and acquires (`:88-93`); B resumes, unlinks A's fresh lock, and acquires. The nonce guards
`release`, not `steal`. Reproduced on a scratch copy with a 400 ms gap between read and unlink
(log: enter A, enter B, exit A, exit B). The suite's dead-owner test uses one waiter. Fix: claim
the stale file atomically (`renameSync` to a per-nonce name) and unlink only what you renamed.

### T10. The lock is proven as a module, never through `sdkTurn` - `src/sdk/seat-sdk.mjs:68-82`

No test runs two `sdkTurn` calls concurrently with a slow fake client. Shrink the critical section
to `saveSeat` alone and all 409 tests stay green while the lost update `STATE.md` calls closed
returns. The "with a no-op lock the same test interleaves 4 times" mutation check in `STATE.md:200`
is not in the tree; a sub-review reproduced it out of tree (8/8 interleaved).

### T11. Retry policy exists in one script only

`maxRetries: 0` everywhere; the only retry is `roleTurn` in `scripts/live-ship.mjs:88-124`. The
view's `/turn`, `swarm-run`, `demo` and `discuss-run` have none, and `/turn` has no timeout or
cancellation, so a stream that stalls mid-body leaves the seat "already running" and its lock held
until the process restarts (`server.mjs:39`). Fail-closed, so not a silent-degradation finding, but
undocumented, and the README's configuration table should say it.

## 4. Important - board

- **B1. Blob tampering is not detected** - `src/board/cas.mjs:65` returns blob bytes before the
  re-hash at `:70` (entries do throw). Probe: an edited blob file served under the original cid.
  `docs/architecture.md:71` ("tampering is detected") is false for blobs. Gates compare cids, so
  REVIEW/TESTS are unaffected; `getBlobText` and any prompt built from stored artifact bytes are.
- **B2. A seat-authored `offer_ref` halts the controller** - `src/board/schema.mjs:173` checks
  only that it is a string; `controller.mjs:47` calls `refs.resolve()` on it and `parseRef` throws.
  Probe: `offer_ref: "garbage"` from a work seat; `schedule()` and `ship()` both throw. One model
  output stops scheduling for the whole board.
- **B3. "Acceptance is executed, never asserted" is a harness property** - `MODE_WRITES.work`
  includes `repro` (`schema.mjs:76`); `acceptanceStatus` (`controller.mjs:86-89`) checks that a
  repro cites the artifact and records `exit: 0`, never that anything ran. Probe: a seat-written
  repro with body "(never run)" and `ship()` returned SHIPPED. Only `scripts/live-ship.mjs:251`
  executes anything; `board-run.mjs:171-173` writes a canned exit 0.
- **B4. The checker still receives maker prose** - `src/board/project.mjs:241` hands the checker
  the full artifact payload; `commit.msg` is stripped (`:261-262`) but `payload.summary` is free
  text written by the maker (`board-run.mjs:166`, `live-ship.mjs:243`). Probe: the checker slice
  contained the planted "MAKER DEFENSE via summary".
- **B5. The live-ship acceptance oracle is model-controlled** - `scripts/live-ship.mjs:58, 171`:
  the command is `node <the model's own file>`, so a module that omits its self-test exits 0 and
  passes TESTS, and the reviewer is told "exited 0" (`:285`) before judging. By reading;
  UNVERIFIED live.

## 5. Important - swarm, roles, seating

- **S1. The layer-3 judge can be a seat that failed layer 1** - `src/swarm/layered.mjs:181-185,
  192-206`. `clean` excludes only seats whose answer succeeded; a seat that 429'd in layer 1 still
  refutes in layer 2 and is then elected judge with `judgeCompromised: false`. Probe: seats a, b, c;
  b fails explore; judge = b; the synthesis prompt contains "[b attacking c]". "No seat can grade
  its own work" holds for answers, not for refutations.
- **S2. The context policy is a silent name filter, and one production prompt bypasses it** -
  `src/role/roles.mjs:148-153` drops known-but-unpermitted tokens without throwing (only undeclared
  kinds throw, `:142-147`); the free-text `task` argument (`:193`) and token contents are unchecked;
  `src/swarm/orchestrate.mjs:96-108` `integratePrompt` never calls `promptFor` and is dispatched at
  `:181`; orchestrate's report carries no `withheld`. On every production path `withheld` is
  structurally `[]`. `README.md:151` and `STATE.md:170` ("every swarm prompt is built by
  `promptFor()`") and `STATE.md:173` ("a refusal rather than loop ordering") are false. The test
  commit `fe9fb2b` covers `planPrompt`/`workerPrompt`, not `integratePrompt`.
- **S3. "Efficiency 1.00" certifies concurrent dispatch, not overlapping vendor calls** -
  `layered.mjs:153` divides `max(ms)` by wall, but `ms` is measured from dispatch in all three
  scripts (`swarm-run.mjs:32-37`, `discuss-run.mjs:35-42`, `delegate-run.mjs:29-36`). Probe: four
  seats serialized on a promise chain with `ms` from dispatch reported `eff 1.00 CONCURRENT`;
  measured from actual start, 0.25. The `e400875` numbers are also producible by serial execution.
  This is the stand-in defect `STATE.md:225-229` warns about.
- **S4. The execution oracle runs model code with the user's environment** -
  `scripts/delegate-run.mjs:65-70`: `spawnSync("/usr/bin/node", [probe])` with no `cwd`, no `env`,
  a 20 s timeout on the probe only. Model code runs at import, in the repo cwd, with the full
  environment - including any keys the README tells the operator to `source` into that shell.
  Files are written to `os.tmpdir()` (good). Two one-line fixes: `env: { PATH }` and `cwd: <tmp>`;
  Node 24's `--permission --allow-fs-read=<dir>` is available too.

## 6. Important - live view

- **V1. Two remote process kills** - `src/view/server.mjs:100-101, 144`: the async handler's
  rejections are unhandled. Probe: `GET //[` (Invalid URL) and a client that drops mid-body
  (ECONNRESET) each exited the process.
- **V2. Prototype pollution through `label`** - `src/view/bus.mjs:65` (label flows from
  `server.mjs:153, 164`). Probe: `POST /turn { label: "__proto__" }` then `GET /seats`;
  `{}.status === "done"`, `{}.text === "hello"`, and every later `fetch().status` in that process
  read `"done"`. Use `Object.hasOwn` / null-prototype maps and validate `label`.
- **V3. Error text and paths reach every SSE client** - `server.mjs:47, 52, 171`: vendor errors
  verbatim, lock paths with pid (`lock.mjs:99-101`), absolute store paths, and `/board` returns
  `boardRoot`. No credential can reach a response (checked), but `/events?from=0` replays up to
  2000 events including whole Response objects, which the README does not say.
- **V4. `view-check`'s oracle is satisfiable by a per-seat buffering server** -
  `scripts/view-check.mjs:82-84`: with two seats of different duration the faster seat's single
  flush lands before `/turn` returns because `/turn` waits on the slower one. Assert per seat inside
  that seat's own start..done window. Also README/STATE say `openai,google`; the default is
  `openai,anthropic` (`:16`).

## 7. Important - documentation that is false or stale against the code

- `README.md:123` - `src/team/` is "another session's uncommitted work ... not part of this
  surface". It was committed in `b7dc939` at 10:45, 83 minutes before the README commit; two board
  tests import `law.mjs` and `src/board/integrate.mjs:223-251` bridges to it. It is orphaned
  (nothing else imports it), contradicts `board/project.mjs` role-to-projection mappings
  (`roster.mjs:30, 33`), and four of its five modules have no tests. As of 12:50 it is under
  uncommitted edit again, so this may be in motion.
- `docs/architecture.md:117` - "`ship()` is the only way work reaches the shipping ref" (C2).
- `docs/architecture.md:71` - "tampering is detected" (B1, blobs).
- `STATE.md:106` - "acceptance is executed, never asserted" (B3).
- `STATE.md:99-101` - "the controller turns that into a decision under a named rule, or records a
  split": no code in `src/` or `scripts/` authors a `decision` entry (grep).
- `STATE.md:117` - "every cap that drops coverage is logged": `dag.mjs:98-110` discards
  `history().truncated`; 505 traces returned as 500 with no flag.
- `STATE.md:39` - "every refusal has a case": the synthesize writing-clause and the `ours` resolver
  have none.
- `README.md:45` - "234 tests" is the seat-core count; main is 409.
- `README.md` "still working" for the CLI path (C3), and "refuses to proceed if the chain it holds
  was not extended" (pre-turn only).
- `STATE.md` seat table names `claude-haiku-4-5-20251001` for the anthropic seat; the adapter's
  default is `claude-sonnet-5` (`adapter.mjs:76`). Whichever is intended, only one should be true.
- `src/route/router.mjs:59-61` says the google seat "reaches Gemini through the ANTIGRAVITY SDK"
  directly above `notes: "raw Gemini API; NOT the agy seat"` and `adapter.mjs:49`. The README warns
  that exactly this confusion trips every new reader.
- `src/route/router.mjs:129` `MODEL_FAMILY` still carries `grok-4.20-multi-agent`, the id the
  facts doc says was corrected to `grok-4.20-multi-agent-0309`, and lacks `claude-opus-5-5`,
  `claude-fable-5-1`, `grok-4.7`; unknown reads as "unsafe", so conservative, but inconsistent.
- `docs/specs/2026-09-27-vendor-model-facts.md` has no Google API section: `gemini-3.5-flash`, the
  live google default, is unrecorded there. `gpt-6-astra` and `grok-4.7` appear in seating and
  have never been live-called anywhere in the repo.
- `src/role/seating.mjs:86-90` cites the facts doc for Anthropic's five effort values; the doc does
  not contain that list (the router does, and the live docs agree with the router).
- `src/role/seating.mjs:317` declares `claude-fable-5-1` "not a seat"; `:166` seats it as the
  planner's hard rung.
- `package.json` `engines: >=20` is false: `src/context/{locate,project}.mjs` import `node:sqlite`,
  which needs Node 22.13+; on the machine's Node 20.20.2 the CLI dies at import.

## 8. Important - CLI transport (superseded surface, beyond C3)

- A failed fresh turn wedges the seat - `bin/pantheon.mjs:195-198`, `src/seat/turn.mjs:89-90`: a
  token is stored whenever `vendor_session_id` is truthy regardless of `r.ok`; with the binary
  absent (spawn ENOENT) the record is saved with an operator token and an empty chain, and every
  later turn "resumes" a conversation that never existed. `turn.mjs:64` drops the spawn error.
- `verify-resume` is not seat-scoped without `--session-id` - `pantheon.mjs:138` resolves the
  record's id before the seat; a record snapshotted from X verifies as RESUMED against a seat on Y.
- A corrupt seat record throws uncaught from `store.mjs:22` and exits 1 = NOT_RESUMED with a stack
  trace - the collision the record.json path fixed, one layer over.
- Zero-turn projections are silent at `snapshot` - `src/context/project.mjs:170-184` skips
  unparseable lines; the agy JSONL "fail loudly" throw at `:165-167` is swallowed by the per-line
  catch at `:179`. Only `projectLocated` routes agy to SQLite, where it does fail loud.
- No lock on the CLI path (`withSeatLock` has zero uses in `bin/pantheon.mjs`).
- Path escape: `locate.mjs:34, 110, 143` join `--session-id` into the path; `../../x` read a file
  outside `~/.claude` (exit 0).

## 9. Minor

Board: `canon.mjs:30-40` canonicalizes `Date`, `Map`, `Set`, `RegExp`, `Error` to `{}` and a
`Buffer` to an index object (silent, unlike the refused kinds); `merge.mjs:148-159` the `ours`
resolver takes theirs; `refs.mjs:158-166` lease verify and fence run under different locks;
`controller.mjs:218` reads `occupancy.branch === "iso"` which nothing sets, and `setOccupancy` is
an unlocked read-modify-write (`runtime.mjs:132-137`); `controller.mjs:107` any human decision on
any key satisfies `human_ack`, and `:89` one green run outranks later red runs on the same bytes;
`runtime.mjs:22` a corrupt `leases.json` reads as `{}` and generations restart at 1; `project.mjs:208`
walks tree slots only, so `kinds` on checker/worker/debater admit nothing and `mounts` are never
populated; writer identity is an unauthenticated string (`refs.mjs:69-73`) and iso refs are
per-vendor, so two seats of one vendor share a name.

Swarm: `layered.mjs:194-199` an explicit `synthesizer` that proposed is swapped silently; `:141` a
synchronously-throwing `runSeat` rejects the whole run; `:147, 153` failed seats get `ms = 0` and
collapse `efficiency`; `:165` and `discuss.mjs:212` record only one seat's `withheld`;
`discuss.mjs:151, 187, 283` undeclared movement counts as not moved, so "movement must be declared"
is a prompt instruction; `--adversarial` hardcodes `CHANGED: no` (`:114`); `seating.mjs:220-229`
duplicate `advocate` key; `:206-209` comment calls gemini a reseat while `band: "easy"` makes it the
primary easy reviewer. Nothing in the code explains the 0/6 delegation result; `runOrchestration`
dispatches unconditionally (`orchestrate.mjs:141`), and the env-lab prompt's "if that helps" suffix
is the likelier cause.

View and scripts: `server.mjs:156` `ADAPTERS[v]` is truthy for inherited names (`seats:
["constructor"]` passes validation); `/events` ignores `res.write`'s return (`:134, 137`) and
replays the full buffer to every new connection; `stream-check` passes on two TCP segments at 1 ms
resolution and its "ordered in time" line cannot fail; `live-check.mjs:45, 50` `process.exit`
inside `try` skips the `finally` cleanup; `demo.mjs` uses fixed tokens on durable seats under the
real home, so a rerun's turn-2 recall can pass without this run's turn 1, and FAIL is print-only;
`app.html:47-48` loads React from `esm.sh` at runtime in the credentialed origin with no CSP or SRI
(no XSS found: `createElement` with string children throughout); `app.html:225, 239` `.mode` and
`.continuity` are never set by the reducer.

Transport and seat: switching a live seat between `server` and `replay` is unguarded (a replay-minted
`replay-<key>` handle sent as `previous_response_id`, or a server-mode seat whose history file is
empty extending its chain over a fresh conversation); `identity.mjs:13` uses `resolve()` not
`realpath`, so a symlinked cwd is a second seat; `adapter.mjs:233-262` builds the blocking replay
request inline while `:315-316` claims one builder for both paths.

Tests: `tests/sdk-transport.test.mjs:49-52` cannot fail (`try { makeClient(...) } catch (e) {
assert.ok(!e.message.includes("secret")) }` with no value supplied); `tests/board-integrate.test.mjs:
295-309` is named "stale head refused by the CAS" and asserts `ok === true` (`expected` is not a
`ship()` parameter); `tests/seat-lock.test.mjs:55` spawns hardcoded `/usr/bin/node` and waits only
on `exit`, so ENOENT hangs the suite instead of failing it; `tests/seat-conformance.test.mjs:79-82`
guards its assertion behind a condition that is always false; `tests/acceptance-cli.test.mjs:
282-300` "unconfirmed vendor stores" pass because `/unconfirmed/i` matches the fixture path, and no
such word exists in `src/` or `bin/`; exit codes 5 and 7 are never exercised black-box though both
are reachable without a vendor.

Team (against `b7dc939`; under edit now): `continuity.mjs:64-68, 131-132` `trim()` inserts note
objects that render as `- undefined` and miscounts from the third trim; `roster.mjs:113-114`
`purpose` omits the defaulted role so one occupancy yields two seat keys; `subagent.mjs:71-73`
requires `parent.lease`, which nothing attaches; `modes.mjs:34` conveyor needs `ready > 0` while
the controller's `executing` also covers 0 ready / N in flight.

Worktree: `pantheon-seat-core` is stale and git-safe to remove, but
`.superpowers/sdd/2026-09-27-pantheon-seat-core/progress.md` is the only record of the SDD rulings,
the retracted stall theory and the unpaid review debt (Tasks 1-5 were never independently
reviewed; the `review-9af66b3..f335808.diff` package was prepared for a reviewer that never ran).
Archive it before `git worktree remove`. `docs/plans/` holds Plan 1 of 4; Plans 2-4 were never
written, and the design doc's header still says "320 lines" (it is 785). `spike/conversation-chain.mjs`
has no importer and its text-only projector no longer matches `project.mjs`.

## 10. What "409 tests green" establishes

It establishes: every board refusal in `schema`/`dag`/`refs`/`integrate` has a case; CAS, fencing
and bound-review run on real stores and real child processes; the history crash is reproduced on
disk and through `sdkTurn`; the lock module's three hazards are pinned; content never reaches a seat
record or provenance, with fixtures that prove the withheld thing was present first.

It does not establish: that `sdkTurn` serializes across processes (T10); that any vendor accepts
the request bodies - all four SDKs are fakes, one of which accepts an option the real SDK does not
(T7); that streaming works at all (zero test references to `stream.mjs`); that `extra` is
well-formed (spread unvalidated); that the view's HTTP layer behaves (`/turn`, `/events`, `/seats`,
`/`, 404 and the body cap are untested; only the three `/board` tests use the `makeClientFor` seam).
Green is a statement about the fakes' contract plus the board and store invariants, not about the
wire. That is the project's own thesis, and it is right.

Of the three mutation checks `STATE.md` claims: board-refs is real and flips; sdk-history is a
genuine control case that discriminates; the seat-lock "no-op lock interleaves 4x" check is a
manual observation not in the tree (reproduced out of tree, 8/8).

## 11. Strengths, specifically

- Content-free seat records enforced at the single writer (`store.mjs:41-51`), with a fixture that
  puts the prompt on stderr and asserts the diagnostic survives while the prompt does not
  (`tests/seat-turn.test.mjs:263-274`).
- `tests/sdk-transport.test.mjs:202-220` sets `ANTHROPIC_API_KEY` in the fixture so the
  both-credentials bug reproduces, and asserts `apiKey === null`, not `undefined`.
- `tests/board-refs.test.mjs:77-110` fencing: expected cid still matches, gen-1 refused, ref
  unchanged, bytes retained, gen-2 lands. A CAS-only design cannot pass it. `:187-221` uses a file
  barrier and an explicit overlap assertion, so a serialized run fails loudly - the discipline the
  swarm's efficiency oracle (S3) is missing.
- `tests/sdk-history.test.mjs:24-45, 146-171`: the crash is on-disk state, the recovery is asserted
  as reported (`history_rolled_back.dropped === 2`), then re-verified through the real `sdkTurn`.
- `lock.mjs:60-80` refuses to steal from a live owner at any age and says why in the comment; the
  per-process chain survives a rejected holder (`:131-146`).
- Critiques bind to blob cids and `tests/board-merge.test.mjs:66-83` really closes
  rev-3-approves-rev-4; `ship()` computes the candidate set once and stamps `evaluated` per gate
  (`integrate.mjs:151-156`), a regression guard for the REVIEW blindness it documents.
- `mergeBases` reports `ambiguousBase` instead of picking; `acceptanceStatus` fails closed on an
  empty target list and says why the earlier version failed open (`controller.mjs:82-87`).
- The bus: shared `seq` across replay and live, a gap notice instead of silent truncation, bounded
  buffer, a throwing subscriber evicted and recorded - all tested.
- The swarm's `overlapFactor` test uses identical durations under both schedules; the lock oracle
  in `delegate-run` abstains outside its domain and the gate, not the integrator, sets `ok`.
- Locate-by-identity with content confirmation for all four CLI stores, real C1/C2/C3 regression
  tests, and the agy path honestly labelled "observed, not documented".
- The `.gitignore` is deny-all with an allowlist, as the mechanical form of "conversations never
  commit", and the lockfile exception explains itself.
- `progress.md` in the worktree records a wrong ruling, its retraction, and the unpaid review debt
  in plain words. `STATE.md` retracts its own convergence claim. The vendor-facts spec says
  UNRECORDED where it does not know. This is rarer than it should be and it is why the review above
  could be as specific as it is.

## 12. Suggested order

1. `/turn`: Host and Origin check, JSON content-type, `label` validation, catch handler
   rejections, a per-turn timeout (C1, V1, V2, V3).
2. `merge()` onto `refs/board/*` only through `ship()`; validate `offer_ref` at `putEntry`; re-hash
   blobs on `get` (C2, B2, B1).
3. Transport: read `stop_reason`, `finishReason`/`promptFeedback`, `status`/`incomplete_details`;
   make `streamTurn` return the final items and build replay history from them; raise the Anthropic
   cap and settle the default model; set `httpOptions.retryOptions` on the genai client
   (T1, T2, T3, T4, T7).
4. Decide whether effort is a claim or a feature: wire `seatingPlan().effort` through `extra` with
   a deep-merge on `reasoning`, or delete the ladder (T5).
5. `stealIfDead` rename-claim; a concurrent-`sdkTurn` test; reconcile chain and history in the
   second crash window (T9, T10, T8).
6. Fix the sentences in `README.md`, `STATE.md`, `docs/architecture.md` listed in section 7, or fix
   the code they describe. Either is fine; the mismatch is the problem.
7. Judge exclusion after any layer failure; `integratePrompt` through `promptFor`; measure `ms`
   from the seat's own start (S1, S2, S3).
8. Either fix the codex resume argv and `thread.started`, and add post-turn `verifyExtends`, or
   change "still working" to "kept for its exit-code contract; not verified against current CLIs"
   (C3).

## 13. Limits of this review

No vendor was called, so every "verified live" claim in `STATE.md` remains the project's own
assertion; where a live check's oracle was found weak (S3, V4, `demo.mjs`) the underlying claim is
UNVERIFIED rather than false. The team directory was under uncommitted edit during the review.
Probe scripts were run inside WSL against temp directories only; a copy of the lock module was
modified in a sub-reviewer's scratchpad to inject the delay for T9, never in the repo.


---

# 14. Re-review at `e34c0f4` (2026-09-27, 13:32-14:10)

Sections 1-13 above are left exactly as written at `fe9fb2b`. This section records what changed,
which findings survived an adversarial pass, what the pass corrected, and what is new.

**Scope.** One commit landed since the review: `e34c0f4` (12:55, "team: seven defects found by
executing it against the modules it references") - parts of `src/team/{continuity,law,roster,
subagent}.mjs` rewritten and five `tests/team-*.test.mjs` files added (34 tests; committed suite
443/443). Nothing else in the tree changed between the two commits, so every cite in sections 2-13
was re-read at HEAD rather than re-derived. At 14:05 the index also held a staged, uncommitted set:
this review file, two third-party documents (`2026-09-27-orchestration-review.md` and its
`-rereview-addendum.md`, placed with provenance notes), nine role cards under `.claude/agents/`, a
`testsBrief()` helper in `src/board/controller.mjs` wired into `scripts/live-ship.mjs`, and
`tests/board-tests-brief.test.mjs` (6 tests). With those files the suite is 449/449. `README.md`
is unchanged.

**Method.** I re-read every critical and important cite myself; ran `codex exec --help` and
`codex exec resume --help` and inspected the key names of a recorded `codex exec --json` stream;
settled the `@google/genai` type question from `genai.d.ts`. Three sub-reviews then ran: a fresh
read of `src/team` at HEAD, and two adversarial passes whose brief was to refute each finding in
sections 2-8 and 10 with probes against temp directories and fake clients. One probe exercised the
real `@google/genai` 2.24.0 with an intercepting fetch and a fake key; no network, no vendor call.

## 14.1 Verdicts on the original findings

Every critical and important finding survived except T7.

| id | verdict |
|---|---|
| C1, C2, C3 | CONFIRMED. C3(a) re-run by me: `codex exec resume --help` (0.145.0) lists neither `-C` nor `--sandbox` while `codex exec --help` lists both; the recorded stream's four events (`thread.started`, `turn.started`, `item.completed`, `turn.completed`) carry only `thread_id` and an item `id`, so `idFromObj` can never match. One verifier reads C2 as "important" under this review's strict definitions (a false capability claim) and critical only as an invariant break; it stays critical here because "nothing ships on a report" is the property the README says carries the board. |
| T1 | CONFIRMED, and wider: the Google *blocking* path is text-only as well (`adapter.mjs:281`), and Gemini thought signatures and function-call parts are never persisted on either path. |
| T2 | CONFIRMED (probe: `message_delta` with `stop_reason: max_tokens` returned `complete: true`, request carried `max_tokens: 1024`). Fix text corrected: `tool_use` and `pause_turn` are legitimate non-terminal stop reasons; treat `max_tokens`, `refusal` and `model_context_window_exceeded` as incomplete, and read `stop_details`. |
| T3 | CONFIRMED via `sdkTurn` with `promptFeedback.blockReason: "SAFETY"`: `ok: true`, `text: ""`, `{ role: "model", parts: [{ text: "" }] }` persisted on both paths. The empty-text-part rejection remains report-sourced; it is not in the reference docs. |
| T4, T5, T6 | CONFIRMED. |
| **T7** | **OVERSTATED - downgraded to minor.** `maxRetries` is not a `GoogleGenAIOptions` field (it exists only on the internal `GoogleGenAIRequestOptions` type), so the adapter's `maxRetries: 0` is a no-op. But `@google/genai` retries only when an `httpOptions.retryOptions` object is supplied (`apiCall`: `if (!retryOptions) return runFetch()`), and the real SDK built the adapter's way made **one** attempt on a 429. The "default to 5" in the type file describes the `attempts` field of a supplied object. Net: the one-attempt posture holds for Google by accident of an opt-in default, and `tests/sdk-transport.test.mjs:327-340` still proves nothing for that vendor. Fix: pass `httpOptions: { retryOptions: { attempts: 1 } }` explicitly and assert it. |
| T8, T9, T10 | CONFIRMED by independent probes (T8: chain 6 vs history 4 with the exchange text gone and `history_rolled_back.why` false for that window; T9: `enter A / enter B / exit A / exit B` with a 400 ms gap injected between read and unlink; T10: lock shrunk to `saveSeat` only, 449/449 green). |
| T11 | CONFIRMED and sharper: the OpenAI and Anthropic SDK timeouts are cleared once response headers arrive, so a mid-body stall is unbounded, and genai has no default timeout. |
| B1-B5 | CONFIRMED. B4 is latent today (no current prompt builder forwards `payload.summary`; the cite is `board-run.mjs:165`). B5 was understated: `live-ship.mjs:285` says "exited 0" as a *literal*, because `exit` is block-scoped to lines 218-268, so a failed run is reported as a pass to cross-lab review. See 14.6. |
| S1-S4 | CONFIRMED by probes (S1: `judge = b`, `judgeCompromised = false` after b failed layer 1; S3: four serialized fake seats reported `eff 1.00`). |
| V1-V4 | CONFIRMED (V1 and V2 reproduced against a credential-less server). V4 correction: README never mentions view-check; `STATE.md:31` is the line that says `openai,google`. |
| section 8 (CLI) | CONFIRMED with corrections: the fresh-turn wedge reaches only claude and grok, because the minted id at `pantheon.mjs:187` exists only for vendors with a `session_id_flag` (codex and agy print "seat not updated" instead); the zero-turn projector swallow is unreachable from the CLI because agy always routes to SQLite - minor, not important; the path escape needs three `..` levels to leave `~/.claude`, and the input is operator-supplied - minor. |

## 14.2 Errata for sections 1-13

- Section 7, "`README.md:45` - 234 tests": wrong line; `:45` is historical prose. The stale counts
  are `README.md:25`, `README.md:129` and `STATE.md:3` ("405"); the committed suite is 443.
- Section 7, "`STATE.md` seat table names haiku ... adapter default is sonnet-5": STATE's column is
  "model used", and `swarm-run`, `discuss-run` and `delegate-run` pass haiku explicitly, so the
  table is accurate. The real inconsistency is `adapter.mjs:76` (`claude-sonnet-5`) versus the
  `SEAT_FACTS` default at `router.mjs:66` (haiku); `live-check.mjs:24` takes the adapter's.
- Section 9, "the design doc's header still says 320 lines (it is 785)": `design.md:4` describes
  the *evidence base*; `evidence-base.md` is 785 lines and `design.md` is 443. Stale either way.
- Section 9, "`project.mjs:208` ... `mounts` are never populated": overstated. `slice.acceptance`
  is populated for every projection, including those declaring `mounts: []`
  (`project.mjs:264-267`); declaration and slice disagree in both directions.
- Section 9, "failed seats get `ms = 0` and collapse `efficiency`": failed seats are excluded from
  `durations` at `layered.mjs:153`; efficiency drops because `wallMs` includes the failure's time,
  not because a zero enters the maximum.
- Section 9, "`seat-lock.test.mjs:55` ... ENOENT hangs the suite": under `node --test` it fails
  with exit 1; it does not hang.
- Section 10, first paragraph: "every board refusal in schema/dag/refs/integrate has a case"
  contradicts section 7's `STATE.md:39` item. Section 7 is right: the synthesize writing-clause and
  the `ours` resolver have no case.
- Section 3, T7: see 14.1.

## 14.3 New findings from the re-review

Important

- **N1. `seats: ["__proto__"]` is a second prototype-pollution vector** - `server.mjs:156`
  validates vendors with `ADAPTERS[v]`, which is truthy for inherited names; the error branch
  publishes `seat: label ?? vendor`, and `GET /seats` then leaves `({}).status === "error"`
  (probe-verified). Validating `label` alone does not close V2; use `Object.hasOwn(ADAPTERS, v)`.
- **N2. `live-ship.mjs:285` reports "exited 0" unconditionally** (B5 understated, and the same
  defect the orchestration re-review addendum reports). The reviewer seat is told the acceptance
  command passed whether or not it did; the TESTS gate still reads the real record and refuses.
  Addressed by the staged `testsBrief()` - see 14.6.
- **N3. An Anthropic refusal with empty content is persisted as `{ role: "assistant", content: [] }`**
  (`adapter.mjs:296`) while `exchangeTurns` drops it from the chain. The Messages API rejects an
  assistant message with empty content on the next request, so this is T3's poison shape on the
  anthropic seat (persist probe-verified; the rejection is per docs, not re-verified live).
- **N4. `src/team` at `e34c0f4`** (fresh read): (a) `subagentBrief` accepts `plan`, `peer_output`
  and `transcript` through `context` - `subagent.mjs:60-61` forbids two names, one of which is not
  in the vocabulary, which is the defect law 4 was just fixed for; (b) an occupancy with a `lease`
  but no `files` gives a child an unbounded write set (`subagent.mjs:78-85`; opened by the new
  passthrough; probe: `/etc/passwd` accepted); (c) `modes.mjs:34` reads a numeric `ready` that no
  producer emits (`schedule()` returns an array, `boardStatus` a string), so the conveyor shape can
  never fire from real board output; (d) law 6 refuses the `human` ship actor that
  `integrate.mjs:214-221` and `schema.mjs:57` admit, so `shipClaim`'s "pass the result straight to
  `enforce`" contradicts the gate it bridges.

Minor

- `scripts/swarm-run.mjs:5-7` still documents the retired sum/wall verdict that
  `layered.mjs:37-48` calls corrected.
- `project.mjs:264-267` materializes the `tests` mount as `acceptance` on every projection
  regardless of `mounts`.
- B2's fix belongs in the validator: call `parseRef` at `schema.mjs:173`.
- `team-modes.test.mjs:31` is vacuous for four of five entries, and no team test covers the
  `executing`/conveyor shape; `team-law.test.mjs:12` claims a throw it never exercises;
  `team-continuity.test.mjs:72-79` misses legacy `{note}` markers, which `loadChair:54` still
  spreads through and renders as `- undefined`.
- Three `purpose` conventions now coexist for one occupancy (`roster.mjs:126` `"build"` versus
  `"build/implementer"`; `roles.mjs:164` `role#instance`).
- `projectionFor(role, pod)` never checks the ceiling (only the test does); `isPreBoard`'s
  dual-shape guard is dead code and ignores `ROLES.scout.preBoard`; `recordOccupancy` gens repeat
  after a trim; three "diary" thresholds (4096 / 8192 / none).

## 14.4 The team commit against the earlier team findings

| earlier item | status at `e34c0f4` |
|---|---|
| trim inserts `{note}` -> `- undefined`, count resets | fixed for new writes (`continuity.mjs:81-86`); legacy records still render the marker |
| `occupy()` `purpose` omits the defaulted role -> two seat keys | not fixed (`roster.mjs:126`) |
| subagent requires `parent.lease`, nothing attaches | fixed at the API (`roster.mjs:143-144`); no runtime caller exists, and the passthrough opened N4(b) |
| conveyor `ready > 0` versus controller `executing` | not fixed, declared "left alone"; worse than stated (N4(c): unreachable) |
| contradicts `board/project.mjs` mappings | fixed (`roster.mjs:43`, `projectionFor`), with an inclusion test |
| orphan | not fixed: zero static imports from `src/`, `scripts/`, `bin/`; two board tests dynamic-import `law.mjs` |

`README.md:123-124` is now wrong in every clause: committed at 10:45, five suites and 34 tests
under `npm test`, and it imports from both `src/role` and `src/board`. It remains outside the
runtime graph. Vocabulary is converging (one-way imports, no cycle); mechanism is diverging: the
board's scheduler emits a shape `modes.mjs` cannot read, ships are gated by a law table that
disagrees with `integrate.mjs` on `human`, and file authority now lives in three places.

## 14.5 Reconciliation with the orchestration review and its addendum

Those two documents are a third reviewer's, written at `e34c0f4` after reading this review. Where
they overlap with sections 2-13 the observations agree: the live-ship "exited 0" handoff (N2), the
in-process delegation oracle (S4, and their point that it never tests the cross-process requirement
the task states is an addition this review did not make), and the team composition items (gen
repeats, the two `purpose` conventions, `ready` array versus count) match 14.3 and 14.4.

One of their findings extends S2 and this review did not have it: fixed seat purposes
(`discuss-run.mjs:30-38`, `swarm-run.mjs:35`) mean a new discussion or swarm run *resumes* the
prior run's replay history, so old peer context re-enters the request while `withheld` reports `[]`
for the latest prompt. The context policy is applied to the prompt, never to the restored history.
That belongs with S2 as important.

Their remaining items - `report.ok` true with a failed assigned task, duplicate task ids overwriting
a FAIL verdict, discussion headlines contradicting recorded movement, synthesis proceeding with zero
proposals - were not independently re-verified here; their addendum's P2 severities are consistent
with this review's definitions. The staged `.claude/agents/README.md` already lists all of them,
and this review's items, as "known-open at HEAD", with cites that match.

## 14.6 The staged fix

`testsBrief({ store, state, artifact, from })` (`src/board/controller.mjs`, staged) builds the
checker's `tests` mount from the ticket's acceptance rows plus every citing repro's exit and output
(bounded, bound stated), and `acceptanceStatus` rows now carry `runs` including failures.
`scripts/live-ship.mjs` uses it for both the implementer's brief (before any run: "nothing has been
shown to pass yet") and the reviewer's, and asserts the reviewer text says `exited <recordedExit>`
and never `exited 0` after a failure. `tests/board-tests-brief.test.mjs` carries the addendum's
repro as its first case; 6/6 pass, 449/449 with the staged tree. This closes N2 as a unit-tested
property. Two notes: the cards' README marks it "written, not yet executed" live, and once it lands
B1 stops being latent - `testsBrief` is the first production path that reads blob bytes back into a
prompt through `getBlobText`, which does not re-hash blobs (`cas.mjs:65`).

## 14.7 The role cards

Nine cards under `.claude/agents/` (staged, ~1,600 lines) were not reviewed in depth. Their
"Known-open at HEAD" table matches sections 2-13 and the orchestration review item for item, and
their seating table documents the `roster.mjs`-versus-`SEATING` candidate mismatches consistent with
14.4. One item there is not in this review and was not checked: "`lease_gen` on commits is never
re-read" (`dag.mjs:178`).

## 14.8 Changes to the suggested order (section 12)

- Step 1 (view): validate `vendor` with `Object.hasOwn`, not only `label` (N1).
- Step 3 (transport): the Google item becomes "pass `httpOptions.retryOptions.attempts: 1` and
  assert it" (T7); add Anthropic empty-content handling (N3) and `stop_details`; re-hash blobs on
  `get` before `testsBrief` lands (B1).
- Step 7 (swarm): add a run identity to seat purposes so a new run does not resume the last one, or
  apply the context policy to the restored history (14.5).
- Step 8 (CLI): the wedge and path-escape items are narrower than written; C3 stands.
- New step 9: decide whether `src/team` is the roster the board will use or a parallel description.
  If the former, fix N4's four items and wire it; if the latter, say so in `README.md:123` instead
  of "uncommitted".

## 14.9 Limits

No vendor was called. The nine role cards and the two third-party documents were read, not
audited. Sub-review probes ran against temp directories and copies; the repo was not modified
except for this file, which the index now holds - re-stage it before committing if this addendum
should ship with the rest.
