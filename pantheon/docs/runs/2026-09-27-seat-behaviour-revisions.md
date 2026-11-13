# Seat and subagent behaviour, and the revisions it forced

2026-09-27. Every entry below is a behaviour a real seat produced in a real run, and the change made
so that it would behave. Nothing here is a prediction or a preference: each row names the artifact it
came from. Paths under `~/.claude/jobs/579b7d26/tmp/` are this session's run logs; `outputs/` and
`~/.pantheon/boards/` are the run's own records.

The score for the day: **fourteen launches, four shipped board commits.** Ten launches died, and
**not one of them died on the work.** They died on the driver, the prompt contract, or the ticket —
that is what this document is a list of.

---

## 1. The seat was told something untrue about itself

### 1.1 A charter that assumes tools, given to a seat that has none

**Observed.** The scout charter says "report what you ran and what it printed." An SDK seat cannot run
anything. `grok-4.6` answered a four-sentence question with **82,390 characters in 159 seconds** —
`I'll list. I'll search. I'll run.` repeated some nine hundred times — and closed with an admission
that "no commands were run … tool calls did not execute." A second launch produced 127 characters that
announced tool calls and stopped.

**Revision.** Every seat prompt is now prefixed with a `NO_TOOLS` paragraph stating plainly that
nothing the seat writes executes, that it cannot read files, that everything it may rely on is in the
message, and that it must not narrate commands. Per-purpose output caps were added (`capFor`), the
scout's being 700 tokens — a cap is not a fix for a false premise, but it bounds the damage while the
premise is being corrected.

**Where.** `scripts/open-items-run.mjs` (`NO_TOOLS`, `capFor`).
**Evidence.** The blob is still on the board it was written to:
`~/.pantheon/boards/open-projectRecords-1790547104236/objects/blob/1f/c426b43ae0a9a71d8c472c11be041e6d9df2cceb38c7b4e2579f60c95e5d78`, 84 KB. After the revision, the same
vendor answered in 13.8–21.5 s with 256–332 characters (`outputs/open-items/*/run.json`, `turns[]`).

### 1.2 The Antigravity charter was true, and the tool names were wrong

**Observed.** The same charter given to a body that *does* have tools failed at session entry, not on
the work: `failed to construct executor: unknown component: tool "view_file_outline" not found in
registry`, and the same for `view_code_item` and `command_status`.

**Revision.** Those three names were removed from all three agent cards. The card now lists only what
the harness registry actually serves.

**Where.** `.agents/agents/pantheon-{reviewer,scout,fact-checker}/agent.md`.
**Evidence.** `outputs/agy-smoke/smoke1.json` (the failure, kept) and `smoke2.json` (the same agent
loading and answering in 3.8 s afterwards).

### 1.3 The tooled seat was still being told it had no tools

**Observed.** The `NO_TOOLS` preamble from 1.1 is false for the Antigravity seat, which holds the
worktree.

**Revision.** The agy path strips that preamble and substitutes the opposite instruction: the workspace
is the tree under review, run the acceptance command yourself, open the files you cite, hand the
fact-checker one direct check at a time.

**Where.** `scripts/open-items-run.mjs` (`agyTurn`).

---

## 2. The harness mishandled a legitimate seat answer

### 2.1 A missing verdict line was treated as fatal

**Observed.** A reviewer ended without the required `VERDICT:` line — it was mid-sentence about
wanting to read the implementation. The runner threw and the whole launch died at the check stage with
a green, full-suite-passing artifact already on the maker's branch.

**Revision.** The runner re-asks **once**, in the same seat, for nothing but the line; if that still
produces none, it **fails closed** to `request_changes` with the reviewer's text as the blocking
finding, and the REVIEW gate refuses on it. No parseable verdict is not an approval and is not a
crash.

**Where.** `scripts/open-items-run.mjs` (the `reask` path).
**Evidence.** `~/.claude/jobs/579b7d26/tmp/run-item6e.log`: `RUN FAILED at check: reviewer did not
give a parseable verdict; tail: … The suite passing only shows the new tests didn't catch a miss.`

### 2.2 A late failure re-spent every earlier stage

**Observed.** Consequence of 2.1: recovering from a check-stage death meant paying for intake, the
plan and the implementation again, although all three were already on the board's refs.

**Revision.** `--resume <board dir>` reads the state back out of the refs — ticket, maker, artifact
revision, recorded acceptance exit, board status — and skips intake, plan and work. The board is the
state.

**Where.** `scripts/open-items-run.mjs` (`RESUME`).

### 2.3 The reviewer could answer from a different lab than the chair it sat in

**Observed.** `roleTurn` walks a ladder of candidates when one times out. The critique entry, however,
is published under the seat identity chosen *before* that walk — so a fall-through would have
published one lab's verdict under another lab's name, with law 3 checked against the wrong one.

**Revision.** A mismatch between the answering body's lab and the critique seat now throws before
anything is published: "a mislabelled verdict is worse than none." When the Antigravity transport was
added, that check became lab-aware (`LAB("agy") === "google"`) rather than vendor-literal, so a
transport name can never be mistaken for a lab.

**Where.** `scripts/open-items-run.mjs` (the check stage, `LAB`).

---

## 3. Transport

### 3.1 One pool, no interval, and every rung in it

**Observed.** The planner chair's ladder is anthropic on every rung. Anthropic answered **429 with no
`retry-after` and no `anthropic-ratelimit-*` headers** — a subscription-side limit, so there was no
documented interval to wait for and nowhere for a reseat to go. The launch died at the plan stage.
Measured twice, two hours apart, so it is a condition and not a blip.

**Revision.** `--seat <role>=<vendor>/<model>` — a *declared* operator reseat, recorded in `run.json`
under `reseats`, which puts a named body in a chair for one run while leaving the chair and its pack
unchanged. The chair is the job; the occupant is staffing.

**Where.** `scripts/open-items-run.mjs` (`OVERRIDES`).
**Evidence.** `run-item6.log` and `run-item2-agy-b.log`, same message.

### 3.2 A long prompt on a non-streamed call died in the transport

**Observed.** `TypeError: fetch failed` at the check stage — the reviewer was still thinking when the
fetch headers timeout expired. The turn had produced nothing to show and nothing to keep.

**Revision.** Every reviewer turn is streamed, so headers arrive immediately and the deltas feed the
progress file; a transport timeout now falls through to the next rung in the same ladder instead of
killing the launch.

**Where.** `scripts/open-items-run.mjs` (`turn`, `roleTurn`).
**Evidence.** `run-item6c.log`.

### 3.3 Headless mode cannot answer a permission prompt

**Observed.** The Antigravity CLI lane loaded the custom agent and answered in 3.8 s, but every shell
command it tried was auto-denied: `a tool required the "command" permission that headless mode cannot
prompt for, so it was auto-denied`. The turn "succeeded" with an empty response and a
`denied_actions` entry.

**Revision.** The SDK lane is the default seat; the CLI lane is documented as needing an explicit
`permissions.allow` rule. A seat whose tools are silently denied is worse than one with no tools,
because its report still reads like work.

**Where.** `STATE.md` item 2, `scripts/tickets/README.md`, `AGY_SEAT.lanes.cli.why`.
**Evidence.** `outputs/agy-smoke/smoke2.json` (`denied_actions: [{action: "command"}]`).

---

## 4. The seat broke a rule, and the rule was right

### 4.1 An offer published without the lease its author held

**Observed.** The implementer's offer-for-review was published without presenting the lease the maker
was holding, and the fence refused it. The refusal was correct: the fence exists so that two writers
of one name cannot both proceed.

**Revision.** The offer now presents the lease, in the runner and in the standalone ship script. The
fence was not loosened.

**Where.** `scripts/open-items-run.mjs`, `scripts/live-ship.mjs`.

### 4.2 A path is not a slot

**Observed.** `artifact publish (rev 1): artifact.slot ".claude/agents/controller.md" is not a valid
slot key` — the board's key grammar refuses a leading dot, and the ticket had been using one field
for two different things.

**Revision.** Tickets now carry `slot` (the board key) and `path` (the file in the worktree)
separately, and the runner uses each where it belongs.

**Where.** `scripts/open-items-run.mjs`, the ticket schema and template.
**Evidence.** `run-item7a.log`.

---

## 5. The ticket was the defect

### 5.1 A tool-less seat cannot go and look

**Observed.** Asked to decide which of a card's claims still held, the implementer wrote "current
source is unavailable here" nine times — correctly. It had been given the card and no sources.

**Revision.** Tickets gained `attach`: repo-relative files mounted read-only under the artifact token.
With thirteen sources attached, the same seat kept seven claims open with probes that execute, closed
five against passing tests, and marked one genuinely unverifiable because that file was not in the
set. Put the evidence in the brief; do not expect the seat to fetch it.

**Where.** `scripts/open-items-run.mjs` (`SPEC.attach`), `outputs/open-items/controllerCardB/`.

### 5.2 An oracle that contradicted an existing test the seat may not edit

**Observed.** Three consecutive revisions, each **519 pass / 1 fail**, all on the same line — an
existing test still asserting the state the ticket had been written to change. The implementer is
forbidden from editing tests, so it could not win, and it kept rewriting the file it was allowed to
touch. This was the human's error, not the seat's.

**Revision.** The human fixes any test that pins the old state *before* the launch, and that rule is
now the loudest paragraph in the ticket template and the runbook. The reviewer, meanwhile, behaved
exactly as wanted: it ran the suite itself, found the one failing test, named the exact assertion as a
blocking finding, and requested changes in 32 seconds; `ship()` then refused at REVIEW and TESTS.

**Where.** `scripts/tickets/templates/ticket.template.json`, `scripts/tickets/README.md`.
**Evidence.** `run-item2-agy.log`; board `~/.pantheon/boards/open-agySeat-1790553916202`.

### 5.2b The same defect again, one run later — and both seats handled it better than I did

**Observed.** The very next ticket after §5.2 was launched with an oracle of mine asserting that
`"planning the check"` is 17 bytes. It is 18. Three revisions failed at **523 pass / 2 fail**. The
seats' behaviour on an impossible assertion is worth recording in full:

- The **implementer** diagnosed it, implemented the semantics the ticket actually specified, and left
  the reasoning in the code because it is forbidden from touching tests:

  > `// Count the complete UTF-8 payload, with no trimming or framing adjustment.`
  > `// "planning the check" is 18 bytes; an assertion expecting 17 conflicts with`
  > `// the required Buffer.byteLength semantics and must be corrected in the test.`

- The **reviewer** ran the suite itself, found the failure, *read the maker's comment*, cited it by
  file and line — and blocked anyway, because acceptance fails whoever's fault it is. It did not get
  talked out of the finding by the maker's explanation, and it did not soften the verdict to reflect
  that the human was wrong. `ship()` refused at REVIEW and TESTS.

The artifact was correct: applied against the corrected oracle it passes **525/525**.

**Revision.** The oracle was fixed. The rule from §5.2 was already written down when this happened,
which is the point worth keeping: writing a lesson down is not the same as applying it, so the check
belongs in the template's loudest paragraph and in a pre-launch step, not in a document I have already
read.

**Where.** `tests/sdk-stream-thinking.test.mjs`, `scripts/tickets/templates/ticket.template.json`.
**Evidence.** `outputs/open-items/streamThinking/repro-rev3.txt`, `review.md`, and the artifact's own
comment at `outputs/open-items/streamThinking/artifact/src/sdk/stream.mjs`.

### 5.2c A ticket's `copy` list must satisfy the whole suite, not the change

**Observed.** The second of the two failures above was `pantheon-reviewer: agent.md missing under
.agents/agents` — an oracle written earlier in the day, for an unrelated item, checking that the seat
cards exist. The ticket's `copy` list brought `src`, `tests`, `scripts`, `bin` and `package.json` into
the worktree, which is everything *this* change needed and not everything the *acceptance command*
needed. Since acceptance is the full suite, a `copy` list scoped to the change silently fails somebody
else's test.

**Revision.** `.agents` added to that ticket's `copy`; the template now states the rule as a property
of the acceptance command rather than of the change.

**Where.** `scripts/tickets/open-item-streaming-thinking.json`,
`scripts/tickets/templates/ticket.template.json`.

### 5.2d The Antigravity subagent invocation failed, and the parent carried on correctly

**Observed.** In that same review turn, the fact-checker subagent came back not with a report but with
a harness error: `error executing cascade step: CORTEX_STEP_TYPE_INVOKE_SUBAGENT: failed to fetch
tiered models for subagent model resolution: PlatformClient is nil`. The string landed in the review
body. The parent seat did not treat the failed delegation as evidence either way: it had already run
the suite with its own shell, and its verdict rests on that.

**Revision.** None yet, and deliberately: the parent's behaviour was right, and one occurrence of a
vendor-side subagent resolution failure is a fact to record rather than a contract to change. What it
does show is that a subagent's *report* must never be the only evidence for a gate — the fact-checker
is a convenience, and the chair's own executed command is the anchor. Watch for a second occurrence.

**Evidence.** `outputs/open-items/streamThinking/review.md`, final paragraph.

### 5.3 The executed failure is the teaching signal

**Observed.** On the first item, revision 1 came back **489 pass / 29 fail**: the seat had iterated a
function's return object as if it were an array. Nothing about the prompt was wrong; the seat simply
had the interface backwards.

**Revision.** Kept as the contract rather than patched: the controller executes the acceptance itself
and the **executed output** goes back as the next brief's tests mount. Revision 2 passed 518/518. The
same shape produced a clean first revision on the two runs after it.

**Where.** `scripts/open-items-run.mjs` (the revision loop, `testsBrief`).
**Evidence.** `outputs/open-items/projectRecords/run.json` (`revisions: 2`).

---

## 6. Observability — the operator asked for this three times before it existed

### 6.1 "There needs to be some sort of overseer"

**Observed.** Three launches in a row died — the 429, the lease refusal, the transport timeout — and
the operator learned about each one by asking "Status?". A watcher that only reports success is silent
through a hang, and silence is indistinguishable from work.

**Revision.** The runner writes `progress.jsonl` (one line per stage, seat turn, executed result,
refusal, gate and terminal state) and `scripts/overseer.mjs` reads it back as one plain sentence per
event, with a heartbeat while a seat is writing and a WARNING when nothing has happened for a
threshold. The operator's second instruction — "Not a monitor that doesnt tell me anything" — is why
it narrates instead of ticking.

**Where.** `scripts/open-items-run.mjs` (`progress`), `scripts/overseer.mjs`.

### 6.2 The heartbeat was reset by the events it was filtering

**Observed.** Streaming seats emit a progress event every few seconds. Printing each is noise, so they
were filtered — and the filter reset the "last shown" clock, so the overseer stayed silent through
long writes anyway.

**Revision.** Streamed progress is folded into the heartbeat: at most one "still writing: N chars" per
interval, and the stall warning measures the file, not the print.

**Where.** `scripts/overseer.mjs`.

### 6.3 The first run's ending closed the watch on the next run

**Observed.** Relaunching against the same key appends to the same progress file. The reader exited at
the first `run.end` it saw and reported the *previous* launch's outcome.

**Revision.** A later `run.start` reopens the watch.

**Where.** `scripts/overseer.mjs`.

### 6.4 `attached is not defined`

**Observed.** `RUN FAILED at check: attached is not defined` — the attach hoisting of 5.1 was
block-scoped below the stage that used it. My defect, caught by the runtime at the worst possible
stage.

**Revision.** Hoisted above the stages.
**Evidence.** `run-item7c.log`.

---

## 7. Placement — the operator's rulings, not the harness's findings

### 7.1 A body with no readable channel does not belong in a judgment chair

**Observed by the operator**, from the chair's behaviour rather than from any metric: the xAI reviewer
returned a substantive verdict both times, but only after six to ten minutes in which the harness
could show nothing. They asked whether Grok has agent-to-agent messaging
(2026-09-27T23:04:42Z), and on being told it does not, ruled:

> "you lose everything with no understanding everytime it gets to the reviewer and it goes dark
> because theres no A2A"
>
> "as a subagent that needs those tools and has a direct task maybe more suitable"

with Gemini moved into the scout and reviewer chairs.

**Revision.** The Antigravity seat: `scripts/agy-seat.py` runs the `google-antigravity` Agent with
read-only tools plus a shell, one bounded fact-checker subagent, a budget, and hooks that put every
tool call and subagent start/finish into the run's progress file. `AGY_SEAT` replaced
`NOT_SEATED.agy`. The rule is written onto the reviewer card as a standing rule, not as a
measurement: **an opaque, tool-rich body takes a bounded direct task whose output someone else can
execute; a judgment chair needs a body that can be read while it works.**

**Where.** `scripts/agy-seat.py`, `.agents/agents/`, `src/role/seating.mjs` (`AGY_SEAT`),
`.claude/agents/reviewer.md`, `docs/architecture.md`.
**Confirmation, after the fact:** 32 s to a correct block on a failing artifact, 48 s to an approve on
the fixed one with twelve tool calls and a subagent run, against 6–10 minutes dark.

### 7.2 The role instructs, the model staffs

**Observed by the operator**, correcting an earlier conflation of mine: "The same model can have two
different roles. It's the role that instructs it not the model. Some models however are better suited
for certain roles." And on seating bases: "Quota is called latency. Isolation is producer vs reviewer
labs. Quality is explicitly unmeasured. That is the correction."

**Revision.** Chairs and packs are fixed; the occupant is a reseat. `--seat` records the staffing
change in `run.json` and changes nothing about the chair. Seating bases are named (`BASIS`) and the
quality basis is explicitly absent rather than implied.

**Where.** `src/role/seating.mjs` (`BASIS`, `SEATING`), `src/role/roles.mjs`.

### 7.3 A scout sits outside, and there is no swarm inside

**Observed by the operator**: "I think a scout sits outside of it because its initial, like you
wouldn't have a swarm inside."

**Revision.** `assertFanOutIsOutside` refuses breadth nested under a running chair;
`PRE_BOARD_ROLES` gives the scout no projection at all, because at intake there is no commit to check
out; the scout ref may only exist before a board ref does. Confirmed by the runs: the scouts are cited
by the ticket and never read by the chain, so more scouts buy the ticket's author more reading and buy
the chain nothing — which is what the operator was asking about with "Should there be more scouts if
they have that much?"

**Where.** `src/role/seating.mjs`, `src/board/project.mjs`, `src/board/refs.mjs`.

---

## 8. Still open, and stated as such

- **A `pkill -f` against a running launch returned success while the run continued to completion**, with
  no `run.error` recorded. The signal never reached the process; the cause is unknown. A probe confirmed
  a Node `SIGTERM` handler does fire once a blocking `spawnSync` returns, so that is not the
  explanation. Do not rely on killing a run.
- **The machine's seat router has no Antigravity rows** (`build-candidate-table.mjs` probes only the
  codex cache and the xai SDK), so its plan gate could only admit this seat through a `--table`
  override built from a live model list.
- **Gemini bodies under a 4,000-token output cap returned no verdict, no verdict, and a bare verdict
  line** on a 217,000-character brief. The cap is a confound — reasoning counts against it — so this is
  recorded as unmeasured rather than as a fact about those bodies. The brief itself was the real
  defect: a reviewer should get the diff and the executed result, not thirteen attached files.
- **A reasoning-only stream still reads as silence** to anything that consumes only text events. One
  xAI review pushed roughly 124 KB of reasoning that the normalizer dropped. The ticket that closes it
  is `scripts/tickets/open-item-streaming-thinking.json`, with `tests/sdk-stream-thinking.test.mjs` as
  its human-written oracle, baselined failing 5/5.
