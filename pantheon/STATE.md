# Pantheon — state as of 2026-09-27

Branch `main`. 518 tests green. No git remote: nothing has left this machine.

For the front door read `README.md`; for why the system is shaped this way read `docs/architecture.md`. **This file is a dated snapshot and rots on purpose** — it records what was verified live, by which command, and what is open. The other two are meant to stay true.

## What this is

A supervised multi-vendor AI seat harness. A **seat** is a durable identity (`vendor + purpose +
cwd`), not a process. Each turn is a fresh call whose continuity is **proven**, not assumed.

Transport is **vendor SDKs**, superseding the original CLI design (see the decision reversal at
the end of `docs/specs/2026-09-27-pantheon-design.md`). That change deleted the project's hardest
subsystem: with CLI transport the conversation lived in a vendor-owned file we had to locate and
parse, which is where defects C1, C2, C3 and the two silent zero-turn projectors all came from.

## Verified live, and how

Every claim below was executed against real vendors, not inferred. Re-run any of them — after
`npm install`, which a fresh checkout needs.

The unit suite runs WITHOUT that install and without any credential, because every vendor SDK is
injected at the edge rather than imported by the modules under test. That is deliberate, and it
also hid the missing install on a fresh clone until a gate ran one of the live scripts there: 234
tests passed in a checkout where `node scripts/live-check.mjs` could not resolve `openai`.

| what | command | evidence it cannot fake |
|---|---|---|
| continuity, all 4 seats | `node scripts/live-check.mjs <vendor> [model]` | turn 1 plants a random codeword, turn 2 must recall it |
| incremental streaming | `node scripts/stream-check.mjs <vendor>` | deltas must land at multiple distinct timestamps |
| live view end to end | `node scripts/view-check.mjs openai,agy_google` | deltas must reach the SSE client BEFORE `/turn` returns |
| multi-turn + cross review | `node scripts/demo.mjs` | per-seat private tokens; no seat may see another's |
| layered swarm | `node scripts/swarm-run.mjs "question"` | wall clock must equal the slowest seat, not the sum |
| delegation + execution oracle | `node scripts/delegate-run.mjs` | generated code is RUN; no model grades it |
| seat lock | `node --test tests/seat-lock.test.mjs` | four real processes; enter/exit markers must pair |
| routing | `node --test tests/route-router.test.mjs` | refuses any need it cannot justify from measured facts |
| discussion | `node scripts/discuss-run.mjs "q" [--adversarial\|--selfish]` | no seat sees a peer's SAME-round turn; movement must be declared |
| board lifecycle | `node scripts/board-run.mjs [--verbose]` | intake -> planning -> executing -> reviewing -> accepted with NO model in the loop |
| an open item closed BY THE SEATS | `node scripts/open-items-run.mjs --ticket scripts/tickets/<item>.json` (+ `node scripts/overseer.mjs outputs/open-items/<key>`) | the controller executes the FULL suite in a repo-copy worktree; an other-lab review acks the bytes; ship() runs all eight gates; nothing is written to the repo |
| board invariants | `node --test tests/board-*.test.mjs` | 116 tests; every refusal has a case, and the mutation check proves the strict one can fail |

Seats, all confirmed by codeword recall:

| seat | model used | continuity | credential |
|---|---|---|---|
| openai | `gpt-6-luna` | server **or replay** (toggle) | `OPENAI_API_KEY` |
| xai | `grok-4.6` | server **or replay** (toggle) | `XAI_API_KEY` |
| agy_google | `gemini-3.5-flash` | replay (local history) | `GEMINI_API_KEY` |
| anthropic | `claude-haiku-4-5-20251001` | replay (local history) | **subscription OAuth** |

Measured swarm concurrency: efficiency **1.00** on all three layers — wall clock equalled the
slowest seat within 68ms / 4ms / 4ms, against sequential times of 25.3s / 31.1s / 4.5s.

## Run it

```bash
npm install                                                      # REQUIRED before any live script
source ~/Projects/agentic-pipeline/sdk/keys-from-windows.sh     # loads keys into this shell only
node bin/pantheon-view.mjs 7777                                  # http://127.0.0.1:7777, loopback only
node scripts/swarm-run.mjs "your question"
```

## The board (`src/board/`)

A blackboard is not a shared chat log. It is a typed, versioned, leased store of partial results plus
a controller that decides who may write which slot next -- and underneath it, a merkle DAG, so a
seat's world is provable rather than remembered. Names are political; hashes are not.

**Two graphs, one content-addressed store.** `entry -> derived_from / supports / target` is lineage,
"why this claim exists". `commit -> parent commits + a tree of slots` is the board, "what is true
now". Seats read a checkout; the controller appends commits; a critique binds to a blob cid, not to
"the file".

| module | what it owns |
|---|---|
| `canon.mjs` | canonical bytes and cids. Refuses `undefined`, `NaN`, `-0` and unstable key order, because each one makes two different nodes hash alike |
| `cas.mjs` | the object store. Put is idempotent; a link to an absent cid is refused at put time, so a cycle cannot form and a fabricated citation cannot be written |
| `schema.mjs` | levels 0-6, per-kind writers, slotted vs accumulative, typed links |
| `dag.mjs` | the seven-step write, named in the result so a refusal says where it stopped |
| `refs.mjs` | mutable names, compare-and-swap, branch classes as write permissions |
| `runtime.mjs` | level 7, deliberately OUTSIDE the DAG: leases with generations, occupancy, spend |
| `merge.mjs` | typed resolvers: `ours`, `union`, `slot-wise`, `bound-review`, `record-split` |
| `project.mjs` | sparse checkouts -- worker, checker, isolated_debater, supervisor, synthesizer |
| `controller.mjs` | status ladder, trigger predicates, the scheduler. Deterministic code, not a vendor |

### Why ref compare-and-swap is not the concurrency story

Content addressing means object writes never contend: the path IS the hash, so two seats writing the
same bytes write one object and two seats writing different bytes touch different paths. Only a
mutable NAME can contend, and every writer has its own -- `refs/seat/<id>/wip`,
`refs/iso/<vendor>/<claim>`. One writer per name means the queue is per seat and the CAS never fires.
It is an integrity backstop for when that invariant is violated (two controller processes, a resumed
session, a crash-restart replaying a publish), not the mechanism that makes concurrency safe.

### Invariants the board adds

- **L7 is never hashed.** Leases, heartbeats, occupancy and spend live in `runtime/`. Hash a lease
  expiry into a node and the same claim forks every turn. Spend is DERIVED from a side log keyed by
  commit cid; a stored counter is a second source of truth and it drifts towards "still under budget".
- **The controller is not a vendor.** No mode can write a `decision` and `seat` is not in its
  `writers`. A synthesizer records a hypothesis whose parents are the isolated forks; the controller
  turns that into a decision under a named rule, or records a split.
- **A checker never reads the maker's defense.** In the entry world that was `peer_defense`; in the
  merkle world it is `commit.msg`, and the checker projection strips it and says so.
- **An artifact slot moves only on a critique of THOSE BYTES**, evaluated on every merge including a
  fast-forward -- linear history is the case that ships.
- **Acceptance is executed, never asserted.** `integrate` fires on a repro recording exit 0 whose
  lineage CITES the artifact entry. A pass that names no revision is a pass on nothing.
- **A claim from an isolated mode must be isolated.** Structural, not status-dependent: the earlier
  form ("refuse a board-visible debate entry while executing") made the same entry legal or illegal
  depending on a clock. Evidence is exempt -- a repro is a fact and facts are shared.
- **discuss is never a peer of work.** Scheduled only when the board is stuck or split AND something
  is open. The first predicate returned "a seat is free", which made it eligible during planning;
  that is the whole failure mode in one line.
- **An offer is a pointer to a fork.** bound-review keeps unreviewed work off the shipping ref, so a
  controller reading only that ref could never see what needs reviewing. `work_item.links.offer`
  names the candidate and `offer_ref` names the branch -- a pull request.
- **Every cap that drops coverage is logged.** Silent truncation reads as "covered everything".

## Continuity is a toggle, and it decides what you can audit

`PANTHEON_CONTINUITY=server|replay`, or per call `sdkTurn({ continuity })`. Precedence: explicit >
env > vendor default. A vendor that cannot do the requested mode runs what it can and REPORTS
`continuity_honoured: false` rather than substituting silently.

| mode | cost | what is on disk |
|---|---|---|
| `server` | one id per turn, no growing prefix | hashes only — a reply cannot be read back locally |
| `replay` | whole prefix each turn (largely absorbed by prompt caching) | every reply, auditable offline, and `store:false` means the vendor retains nothing |

Replay loses nothing in continuity, including reasoning, provided every output ITEM is preserved
and replayed — the reasoning items carry `encrypted_content` and are what make `all_turns` work
next turn. Keeping only the prose would silently drop reasoning while still looking like a working
replay. Verified live in both modes on openai and xai: codeword recalled, and in replay the
codeword is in the history file.

Routing caveat, from OpenAI's docs: persisted reasoning is reusable only within a model family, so
re-routing a LIVE seat across families drops its reasoning continuity while the turn still appears
continuous. `familyChange(from, to)` in the router answers this, and treats an unknown family as
unsafe rather than assuming compatibility.

## Invariants that are load-bearing

Breaking any of these silently reintroduces a defect this project already paid for.

- **Seat records never contain conversation text.** `store.mjs` refuses it at the only module
  that writes to disk. Replay vendors need the words, so those live in `history/<seatKey>.json`,
  mode 0600, in a file whose body says what it holds.
- **A locally minted handle is never labelled `sdk`.** Provenance rank is
  `sdk > hook > scrape > operator > adoption`; a replay seat's handle is `operator`, because that
  is what it is.
- **Choosing a credential means excluding the other.** `apiKey: null` on the OAuth path is not
  tidiness: these SDKs read their key env var themselves, so an OAuth client on a machine with
  `ANTHROPIC_API_KEY` set sends both and the metered one wins.
- **A response with no id is refused, never persisted.** A null token reads as "fresh" next turn,
  converting lost continuity into a new conversation.
- **Swarm layer-2 pairing is a derangement by construction**, so no seat can grade its own work.
- **Loopback only.** This process holds four vendors' credentials.
- **The router carries no quality ranking.** `src/route/router.mjs` routes on continuity, quota-pool
  independence and stated needs only, and REFUSES needs like "best at code" by name — nothing here
  has measured that, and a guess cited as a reason launders itself into every downstream report.
  `UNMEASURED` lists what is deliberately unsupported.

## Closed on 2026-09-27 by the external review round

Six reviewer reports (swarm/roles/seating, team, board, view, test quality, CLI) landed while this
file's earlier sections were current. Each finding below was reproduced first and fixed with the repro
as its regression test; the rest of this file's "verified live" claims were NOT re-run in that round.

- **`/turn` took a `text/plain` POST from any web page on this machine** and would spend four vendors'
  credits; DNS rebinding read seat text off `/events`. Now: loopback `Host` for this port, no foreign
  `Origin`, no cross-site `Sec-Fetch-Site`, `application/json` only, never a CORS header. A malformed
  URL, a dropped connection and a `__proto__`/`constructor` label are responses, not crashes.
  `tests/view-security.test.mjs` fires real HTTP requests -- over raw sockets where `fetch()` would
  silently drop the header under test.
- **`merge()` was a second door onto the shipping ref**, landing an artifact on nothing but a
  cross-lab approval; `scripts/board-run.mjs` shipped through it. It refuses (`SHIP_ONLY`) any
  bound-review slot on a board ref; the demo ships through `ship()` and prints the eight gates.
- **A maker's own passing repro closed the TESTS gate.** Independence is now required: the run's author
  must be the controller or a different lab from the artifact's author. Every fixture that had the
  maker run its own tests now has the controller run them, which is what the design said all along.
- **A seat that failed layer 1 and refuted in layer 2 could judge** -- refuters are participants now.
- **A malformed `offer_ref` string crashed the scheduler**; it is now an offer that resolves to nothing.
- **Blob bytes were served before their hash was re-checked** -- the one object every "bound to a hash"
  claim is about was the one never re-hashed on read.
- **`@google/genai` has no `maxRetries`**; it silently ignored the option and retried up to 5 times
  while the harness believed retries were off. Its knob is `httpOptions.retryOptions.attempts`, set
  to 1.
- **The seat lock's steal was check-then-unlink**: two waiters seeing a dead owner could both acquire.
  It became a rename, and the second review found the rename renamed whatever was AT the path -- a
  live lock created between the read and the rename. It is a **claim protocol** now (see the second
  round below).
- **The §U1 fix had a second crash window** that LOST an acknowledged exchange (crash between saveSeat
  and the history commit). The seat record now carries `history_len` and is the authority; the marker
  alone handled only the first window. Both windows tested, with a mutation check each.
- **`src/team/` was committed with one test touching one file.** Seven defects found by executing it
  against the modules it references, two of them integration faults (a chair on the controller-only
  `supervisor` projection; law 4 checking a vocabulary that exists nowhere). Five suites now.
- **The lock was proven as a module, never through `sdkTurn`.** `tests/sdk-lock-crossprocess.test.mjs`
  drives two real processes through `sdkTurn` on one seat and asserts the held intervals do not
  overlap and no exchange is lost.

## Second review round, 2026-09-27 — 34 findings, 30 fixed here

`outputs/project-review.md` (untracked by design) is the review: eight dimension reviewers, every
finding run through three refuters, none refuted by majority. Each fix below carries the review's
reproduction as its regression test. What was NOT fixed here: ranks 17–19 and 32 are stale claims in
the role cards under `.claude/agents/`, which another session owns; rank 21 is documented, not routed
(open item 6 below).

- **`contextFor` filtered on key NAMES.** `ticket: { plan }` reached an implementer with
  `withheld: []`. It now walks permitted values -- nested objects, arrays and JSON-encoded strings --
  and REFUSES a permitted key that carries a withheld kind (`ContextViolation`), rather than stripping
  it: a caller nesting withheld kinds is a bug to surface. Free text that merely mentions a plan is the
  stated limit. `tests/role-context-smuggle.test.mjs`.
- **An in-session probe right after that fix found three more carriers** -- `Plan`/`plan ` key variants,
  a double-encoded JSON string, and `Map` values (never enumerated) -- and, in the same family, that
  `JSON.stringify`-based byte caps (law 4, the continuity brief) are shrunk by a `toJSON` on the value.
  Kind names are matched trimmed and lower-cased, `"`-prefixed strings are parsed, Map/Set are walked,
  and both caps measure the DATA through `src/team/measure.mjs`. A renamed key (`the_theory`) remains
  the stated limit, same as free text.
- **The board fixes were probed the same way** (12 cases, in-session, after the refuter agents blocked
  on a permission prompt that never surfaced): `refs.swap` keyed every check -- slot class, `SHIP_ONLY`,
  the lease fence -- on the CALLER's `changedSlots`, so a raw caller passing `[]` landed an artifact on
  the shipping ref and a seat wrote past a lease the same way. The ref now holds the store and diffs the
  two commits itself; both halves of the lease fence (direct slots and artifact slots covered by a leased
  item) live in `refs.swap`; a `branch()` diffs against its source; and a board ref may be CREATED only
  from another board ref (`BOARD_FROM`). A `null` or payload-less entry is a typed `ENTRY` refusal
  instead of a TypeError. Three further probes (lock/intent 12 cases, SDK 13, swarm/team 13) refuted
  nothing; the edges they surfaced (negative union on a reversed interval, ratios above 1 on inconsistent
  timings, delta text disagreeing with the completed message) are clamped and named.
  `tests/board-fencing.test.mjs`, `tests/swarm-overlap.test.mjs`, `tests/sdk-stream-replay.test.mjs`.
- **`publish()` threw `BoardViolation` on an ordinary seat mistake** and took the driver down. It
  returns `{ ok:false, code, why, steps }` like every other refusal. `tests/board-fencing.test.mjs`.
- **The lock steal is a claim protocol.** `<lock>.steal` is taken with `wx` (one stealer decides at a
  time), the lock is re-read UNDER the claim and removed only if it is still the exact lock judged
  dead (pid + nonce); a claim left by a dead stealer is itself reclaimed. Locks record the holder's
  `/proc` start time, so a reused pid is not mistaken for the holder. Five real processes race one dead
  lock in `tests/seat-lock-claim.test.mjs`; one holder at a time.
- **Streamed replay turns dropped reasoning items.** The unary Responses path kept `res.output`; the
  streaming path rebuilt history from text. `streamTurn` returns the completed response and the
  streamed replay uses its items, so the two paths produce the same history. `tests/sdk-stream-replay.test.mjs`.
- **`overlapFactor` excluded failed seats and could not see serialisation.** Every seat's interval
  counts, overlap is measured from the union of intervals (a queued `runSeat` cannot fake 1.00), and
  the report carries `coverage` plus a caveat when a layer was partial. `tests/swarm-overlap.test.mjs`.
- **The third crash window** -- vendor acted, process died before the first write -- is now VISIBLE: an
  intent record under `home/intents/` is written before `sendTurn` and removed after the seat record
  lands. A lingering one refuses the next turn (`UNRESOLVED_TURN`) until `acknowledgeLost: true`.
  The repro kills a child mid-turn. `tests/sdk-intent.test.mjs`.
- **Fencing was opt-in.** A seat that omitted `lease` wrote past an active lease with no error. Now
  `LEASE_REQUIRED`: `refs.swap` refuses a seat write to a directly leased slot (`item:`, `plan`) without
  that lease, and `publish()` refuses an artifact slot listed by a leased item. `tests/board-fencing.test.mjs`.
- **`SHIP_ONLY` is enforced at the ref**, not only in `merge()`: `putCommit` + `refs.swap` onto
  `refs/board/*` with a bound-review slot is refused unless the caller is `ship()` (`ship: true`).
  The policy table moved to `src/board/policy.mjs` so the ref reads it without importing the resolver.
- **One lock domain.** `refs.swap` verified its lease under the REF lock while `fence()` ran under the
  LEASE lock; the decide-and-write now runs under `runtime.locked()`, the same lock `acquire`/`fence`
  take. `tests/board-lock-domain.test.mjs`.
- **Continuity writers lost updates** (3 × 20 decisions → 30 kept). They are async and serialised per
  chair under the cross-process lock; the repro runs three real processes. `tests/team-continuity.test.mjs`.
- **`chain` had no allowlist**; `{ head, length, transcript }` persisted a transcript. Only `head` and
  `length` may be saved. `tests/seat-store-chain-allowlist.test.mjs`.
- **`node:sqlite` was imported at module top level**, so `bin/pantheon` and its suite failed to load
  on the Node 20 that `package.json` declares. It loads on first use (agy store only) with an error
  naming the real floor (≥ 22.5). `tests/context-sqlite-lazy.test.mjs` runs the modules with the builtin disabled.
- Smaller: `/events` caps subscribers (64) and flushes headers on connect; the verdict-word list covers
  `judge`/`decide`/`grade`/`sign off`; a chair brief that parses as a non-object fails closed; the
  orchestrator's closing prompt and the demo's review prompt go through `promptFor()`; `boardStatus`
  emits `ready`/`active` counts so `team/modes.mjs` can select against a real board; `escalate()`
  refuses to read array order as a rung for band-less roles; law 6 requires the review pod to mark
  done; law 4 measures the brief instead of trusting `bytes`; four tests that could pass while asserting
  nothing (seat-conformance, team-roster, swarm-layered mixed case, acceptance-cli exit 5) now assert.

## The day's runs, and who decided what

Fourteen launches, five shipped board commits, and **not one launch died on the work** — they died on
the driver, the prompt contract or the ticket. Both of those lists, with the evidence for each row, are
`docs/runs/2026-09-27-seat-behaviour-revisions.md`; the launches' own stage-by-stage records are
`docs/runs/2026-09-27-build-transcript.md`, generated from `progress.jsonl` by
`scripts/run-transcript.mjs` rather than written by hand.

**The seating is the operator's call, not a measurement of ours.** Watching the xAI reviewer return good
verdicts after six to ten minutes of apparent silence, they asked whether Grok has agent-to-agent
messaging and then ruled that a body with strong tools and no readable channel belongs on a bounded
direct task, while a judgment chair needs a body that can be read while it works — with Gemini moved
into the scout and reviewer chairs. The Antigravity seat implements that ruling; the timings that
followed confirmed it and did not produce it. `docs/architecture.md` → "The Antigravity seat" and
`.claude/agents/reviewer.md` carry it as a standing rule.

**The fastest clean run of the day: 89 seconds, ticket to shipped**, on the `thinking` event that closes
the silence the operator diagnosed — intake 14 s, plan 4 s, implementation 30 s, full suite 525/0 at
50 s, an Antigravity review with seven tool calls at 89 s, eight gates, board commit `1bbfe335f394`.
Its first launch had died at 2m23s on a wrong byte count in my own oracle, which no seat is allowed to
fix; the implementer said so in a code comment and the reviewer cited that comment and blocked anyway.
Both behaved correctly. See `docs/runs/2026-09-27-seat-behaviour-revisions.md` §5.2b.

## Open, and honestly so

1. ~~**No vendor seat has written a board entry.**~~ — **CLOSED 2026-09-27**, by `scripts/open-items-run.mjs`
   on open item 6 below. `gpt-6-astra` wrote `src/board/project.mjs` on `refs/seat/openai-work/wip` through the
   implementer projection (plan and commit message withheld); the CONTROLLER executed `node --test` in a
   copy of this repository — rev 1: 489 pass / 29 fail (it iterated `history()`'s return object), the
   executed output went back to the seat, rev 2: 518 / 518; `grok-4.7` (a third lab: not the maker's, not
   the planner's) reviewed for 7m18s and approved on the bytes; `ship()` passed ACTOR, TARGET, TICKET,
   GRAFT, LEASE, REVIEW, TESTS and MERGE; board commit `b7963c1ef9d5` in
   `~/.pantheon/boards/open-projectRecords-1790548842797`. The shipped bytes are the `project.mjs` in this
   commit. It took six launches: the first five stopped on DRIVER faults, none on the work — an anthropic
   429 with every planner rung in one pool (reseated to google with `--seat`), an offer written without the
   lease the maker held (the fence refused it, correctly), a non-streamed review that hit the fetch header
   timeout, a scout that wrote 82k chars of "I'll list. I'll search." because its charter assumes tools
   (`NO_TOOLS` preamble + output caps), and a review with no `VERDICT:` line treated as fatal (re-ask, then
   fail closed). `--resume <board>` finished run 5 from its own refs without re-spending a stage.
   `scripts/overseer.mjs` narrates `progress.jsonl` so the operator does not have to ask.
   Still open in this item: the swarm paths (`layered.mjs` / `orchestrate.mjs` / `discuss.mjs`) do not
   call `project()`; only the ticket-driven runner does.

   The original note, kept for the record:
   **No vendor seat has written a board entry.** `scripts/board-run.mjs` uses canned producers on
   purpose -- the schedule must be reproducible without a model -- and the board is still not wired
   into `layered.mjs` / `orchestrate.mjs` / `discuss.mjs`. They do not call `project()`, so no swarm
   run produces a board commit, and this remains the missing fact.

   **Half of this closed on 2026-09-27.** The three swarm paths now build every prompt through
   `promptFor()`, so the ROLE context policy is enforced where work runs: explore is an `explorer`,
   refutation a `reviewer`, synthesis a `judge`, orchestration `planner` -> `implementer`, and a
   discussion's round 1 without an assigned stance is an `explorer` -- which cannot hold `peer_output`
   at all, making the independence-of-round-1 guarantee a refusal rather than a property of the loop's
   ordering. Each run report carries `withheld` per layer, so a run can SHOW its refusals instead of
   asserting them. What is still open is the BOARD side: `project()` and board commits, not the
   context policy.
2. ~~**`agy` has no adapter.**~~ — **CLOSED 2026-09-27, by the seat itself.** Two lanes, one role text:
   `scripts/agy-seat.py` runs the `google-antigravity` SDK `Agent` (read-only tools plus a shell over
   the run's worktree, one `pantheon-fact-checker` subagent for a single direct check, a `BudgetConfig`,
   a destructive-command deny policy, `response_schema` for the verdict, and hooks that append every
   tool call and subagent start/finish to the run's `progress.jsonl`); the same
   `.agents/agents/pantheon-<role>/agent.md` cards load in the `agy` CLI as custom agents. The runner
   seats it as vendor `agy` (`--seat reviewer=agy/gemini-3.7-flash`); for the lab laws it is google.
   The closure was run through the board on itself — ticket
   `scripts/tickets/open-item-2-agy-seat.json`, oracle `tests/seating-agy.test.mjs` (human-written,
   baselined 0/2), `NOT_SEATED.agy` replaced by `AGY_SEAT` in `src/role/seating.mjs`:
   - Launch 1 (xai planner, agy reviewer): three revisions all 519 pass / 1 fail on
     `tests/role-seating.test.mjs:156`, which still asserted `NOT_SEATED.agy` — a ticket defect of the
     human's (the oracle contradicted an existing test the ticket forbade the seat to edit). The agy
     reviewer ran `node --test` itself, found that one test, named the exact assertion as a `block`
     and requested changes in 32 s; `ship()` refused REVIEW and TESTS. Board
     `open-agySeat-1790553916202`.
   - Launch 2 (anthropic planner): 429, subscription-side, no interval — the same refusal as at 18:08,
     re-measured at 20:2x rather than assumed.
   - Launch 3 (xai planner, agy reviewer, stale test fixed): rev 1 passed 520/0; the reviewer re-ran
     the suite, had the fact-checker run the oracle, checked the diff and the export list, approved in
     48 s with 12 tool calls; `ship()` 8/8, board commit `123b769ea9f8` in
     `open-agySeat-1790554708728`; applied here, full suite 520/0.
   Smoke evidence before the run: `outputs/agy-smoke/smoke2.json` (CLI lane: agent loaded,
   gemini-3.7-flash answered in 3.8 s, `run_command` auto-denied in headless mode — why the SDK lane is
   the default) and `outputs/agy-smoke/sdk1/result.json` (SDK lane: 22 s, 5 tool calls, 1 subagent,
   106,340 prompt tokens of which 32,508 cached).
   Audited before commit by the user's read-only `overbearing-babysitter` card in a fresh headless
   session (`outputs/babysitter/review-1.md`): every deliverable above traced to its artifact, the
   `role-seating` test edit judged a replacement rather than a weakening, one correction — an abandoned
   reviewer-comparison script from the approach the user had rejected was still in the tree, unreferenced;
   removed rather than committed.
   Still true: one subscription pool (`AGY_SEAT.pool`). Still open around it: the machine's seat
   router (`~/.claude/skills/multi-model-seats/scripts/build-candidate-table.mjs`) has no Antigravity
   reach source, so its plan gate could only admit this seat through a `--table` override built from a
   live `models.list`; and a `pkill -f` aimed at the first launch returned 0 while that run completed
   normally with no `run.error` recorded — the signal never reached the process, cause unknown (a
   probe shows a Node `SIGTERM` handler does fire once a blocking `spawnSync` returns, so that is not it). The conversation store
   located at `~/.gemini/antigravity-cli/conversations/<id>.db` (SQLite) remains undocumented by the
   vendor.
3. ~~**Replay hazard (evidence §U1)**~~ — **CLOSED** 2026-09-27. History is now written in two
   phases: `saveHistory(..., { committed })` marks the new tail as unacknowledged, and
   `commitHistory()` moves the mark only after `saveSeat` returns. A crash between them leaves the
   mark short, and `loadHistoryState` returns the committed prefix -- the pending tail is dropped on
   load, never replayed, and never deleted from disk. `sdkTurn` reports the recovery as
   `history_rolled_back` rather than performing it silently.

   A commit marker and not a reorder, for the reason the original note gave: saving the seat first
   and crashing leaves a record claiming a chain the history cannot produce, which costs the
   conversation instead of duplicating it. Both orders have a window; only a marker is recoverable.

   Proven by `node --test tests/sdk-history.test.mjs` (10 tests) -- a file that had to be created,
   because nothing in `tests/` imported `saveHistory` or `loadHistory` at all. It carries the crash
   repro, a **mutation check** showing the same tail IS returned without the marker, the legacy path
   (a history with no marker replays in full rather than being discarded by a safety feature), and a
   wiring test that drives `sdkTurn` through the crash state end to end.
4. ~~**Lost update (§U2)**~~ — **CLOSED.** `src/seat/lock.mjs` serialises the whole seat
   read-modify-write, including the model call, across processes. Proven by a real four-process
   race, and mutation-checked: with a no-op lock the same test interleaves 4 times. The fix was
   produced by delegation (Claude planned, gpt-6-sol wrote it, an execution oracle judged it)
   and then rewritten here rather than pasted — the generated version passed the probe but
   would have stolen a lock from a LIVE owner once it aged past staleMs, breaking exactly the
   long turns it protects.
6. ~~**`project()` cannot see accumulative kinds.**~~ — **CLOSED 2026-09-27, by a seat.** The oracle
   `tests/board-project-records.test.mjs` was written by the human first and baselined failing (0/2) on
   the code as it stood; the implementer seat produced the change; the controller's executed run and a
   third-lab review closed it (item 1 above). `slice.records` now carries admitted accumulative entries
   and `withheld[]` names the refused ones by cid. The original note:
   **`project()` cannot see accumulative kinds.** `repro`, `search` and `trace` are `slotted:false`,
   never enter `treeSlots()`, and so appear in neither `slice.slots` nor `withheld[]`; `spec.kinds`
   governs the static ceiling and the slotted entries only. Evidence reaches a reader through the
   tests mount and lineage links. Routing them means per-projection accounting over the commit's
   `records` list -- a design change, recorded here rather than patched.
7. ~~**The role cards under `.claude/agents/` carry stale "known holes"**~~ — **CLOSED 2026-09-27, by a
   seat.** `controller.md`'s Known-holes section was rewritten by `gpt-6-astra` from 13 attached sources
   into a form a script checks: a runnable `probe:` per open hole (exit 0 only while it reproduces), a
   passing `tests/*.test.mjs` per closure, resolving `path:line` citations. Reviewed by `grok-4.7`
   (9 m 39 s), `ship()` 8/8, board commit `c3b0ef6c871e`; applied here and verified
   `node scripts/card-check.mjs .claude/agents/controller.md --head 1d5186f` → 18 verified, 0 problems
   (`outputs/open-items/controllerCardB/`). The index's stale table was replaced with a pointer to that
   section. The original note, kept: the cards carried SHIP_ONLY, the TESTS author check and blob
   re-hashing as open when all three were closed, plus a drifted line citation.
5. **The swarm does not produce independent corroboration (evidence §V).** Layer-2 reviewers are
   anchored by the answer they are handed. It demonstrates concurrency and produces real critique; it
   must not be counted as N confirmations.

   The "default synthesizer is a participant" half of this is **no longer true** and the note was
   stale: `runSwarm` prefers a seat that did not propose, and a participant judge now requires
   `allowParticipantJudge: true` explicitly, with `judgeCompromised` and `judgeNote` on every report
   either way. The anchoring of layer 2 is the part that stands -- it is inherent to handing a
   reviewer an answer, not a defaulting bug.
6. **The multi-seat premise is still unproven for DOING work.** The 2026-09-27 paired eval
   (env-lab `627eafe`) returned every task tied with 0 of 6 arm-W trials delegating at all.

## What actually paid, on the evidence

Cross-model review of a design the reviewers did not author found two real defects (§U) that 185
of my own tests, four live vendor checks and three temporal oracles all missed — because I wrote
the tests and the assumptions they encode. The swarm, with its shared framing and participant
judge, did not (§V). The difference was not the number of models; it was that nothing primed the
reviewers toward one answer and neither graded its own work.

Five defects this session were in my own checkers rather than in the code under test: `onEvent`
silently dropped so streaming ran blocking while reporting success; `complete` computed and never
returned so its assertion could not fail; an absolute-millisecond streaming oracle that failed a
correctly-streaming reply; `sum/wall` used as a parallelism verdict when it cannot distinguish
parallel from serial; and the OAuth client carrying both credentials. Every one was caught by
executing against reality, none by reading.
