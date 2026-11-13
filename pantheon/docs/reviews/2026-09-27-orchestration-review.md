# Pantheon — multi-model orchestration re-review

Reviewed 2026-09-27 at `e34c0f4454096f38d412f99b503708270e241256` in `/home/colchis/Projects/pantheon`. The companion `/home/colchis/Projects/pantheon-seat-core` checkout remains the older `seat-core` worktree at `7beba20`, not a separate package. Current main passed **443 tests, zero failures**. Repository files were not modified. The existing untracked `docs/reviews/` directory was preserved. No credentials were loaded and no live provider calls were made.

**Assessment: Pantheon is a substantive multi-model orchestration prototype.** It implements multiple coordination patterns, separates roles from vendors, constrains information passed to each role, and makes cross-model criticism an explicit stage. Its most interesting direction is a persistent team whose jobs survive changes of model. That team layer is currently a tested set of components; the executable workflows have not yet connected it into a continuous lifecycle.

My first review concentrated on storage and acceptance integrity. This review evaluates orchestration itself: who gets assigned work, what context they receive, how results move between models, what happens on failure, and whether the final outcome represents completed work.

## What actually runs

| Capability | Current implementation | Practical boundary |
|---|---|---|
| Multi-vendor seats | SDK adapters and persistent vendor/purpose/directory conversation identities | Transport exists; this review used injected clients, not live vendors |
| Explore → refute → synthesize | Concurrent independent prompts, rotated cross-review, a synthesis stage that must discuss disagreement | First-run prompt isolation is real; persistent history can undermine isolation on later runs |
| Planner → workers → verifier → integrator | Model-generated assignments, concurrent dispatch, executable verification, final reporting | One work batch; no dependency execution, repair loop, or assembled artifact integration |
| Structured discussion | Frozen previous-round transcript, explicit positions and declared movement, bounded rounds | Meaningful argument exchange; outcome labels currently misclassify some results |
| Roles and staffing | Role-specific context filters; model/vendor candidate ladders; cross-vendor review pairing | Model quality rankings are not measured; difficulty/effort escalation helpers are not used by the live runners |
| Board-driven work | State predicates identify planning, work, review, integration, and discussion opportunities | Demo runners execute scripted stages; they do not form a general persistent dispatcher |
| Persistent team | Stable chairs, occupancy, bounded handoff memory, optional modes, and subagent briefs | Tested helpers with no executable workflow callers yet |

The three running patterns solve different problems. Exploration seeks alternative answers; delegation divides production work; discussion tests how positions survive objections. Keeping those separate is a strength. Likewise, keeping the role independent of its model occupant is a useful foundation for replacing an unavailable vendor without redefining the job.

The current `live-ship.mjs` connects real SDK turns to a board and cross-vendor review in code. It is a fixed demonstration: the planner supplies one title, the task is already specified by the harness, and the harness writes and executes a returned module. This is more than a disconnected board mock, but it is not general repository-task execution. Historical live-run claims were not independently revalidated here.

## Actionable findings

**1. P1 — A failed required worker can still produce a successful orchestration.**

At `src/swarm/orchestrate.mjs:158–175`, failed workers are omitted from verification. Overall success requires only one oracle PASS and no recorded oracle FAIL. The parent goal can therefore be reported complete with required work missing.

This occurs on an ordinary accepted plan: assign two tasks to the same worker. The orchestrator dispatches both concurrently (`:141–145`); `scripts/delegate-run.mjs:28–32` gives them the same persistent purpose; `src/view/server.mjs:35–39` rejects the second as already running. A probe using the actual view's `runTurn()` and a fake SDK stream produced one completed worker, one admission failure, and `report.ok:true`.

A separate probe with one PASS and one verifier abstention also returned success; the abstention was absent from `unverified`. The integration prompt omits the failed worker's `ok` and `why` fields (`orchestrate.mjs:96–107`), so the final summarizer is not even given the explicit transport failure.

**Fix:** schedule work according to seat capacity, track required versus optional tasks, and derive parent completion from all required task states. Keep failure, abstention, and unverified work explicit in the integration handoff. Retaining useful partial results is appropriate; labeling them full completion is the defect.

**2. P1 — Starting a new discussion can restore an earlier discussion's peer context.**

`scripts/discuss-run.mjs:30–38` always uses `purpose:"discuss"`. Seat identity includes vendor, purpose, and cwd; it has no discussion-run identity. The SDK restores that seat's prior history before sending a new opening prompt. A normal discussion after an adversarial or assigned-stance run therefore inherits those prior arguments and instructions.

The probe used the real streaming Google adapter with an injected client. The new opening prompt excluded a unique marker from an old peer's argument, but the actual request included it. The result reported `resumed:true` and the prompt policy reported `withheld:[]`. Fixed purposes in `scripts/swarm-run.mjs:35` produce the same cross-run lifetime issue for exploration, review, and synthesis.

**Fix:** distinguish a new run from a deliberate resume. Include a run identity in conversation purposes while preserving continuity within a discussion. Enforce context rules against the complete request, including restored history; filtering only the latest prompt cannot establish isolation.

**3. P1 — Duplicate task identifiers can erase a failed verdict.**

Plan validation at `src/swarm/orchestrate.mjs:40–54` checks for tasks and known assignees but not unique identifiers. Verification stores results in `verdicts[r.id]` (`:159`). Two tasks with the same ID, the first failing and the second passing, yielded `gate.failed:[]` and `report.ok:true` in the probe.

**Fix:** validate the whole plan before dispatch, including unique nonempty IDs, task shape, supported kinds, and the intended task limit. Bind each result and verdict to one validated assignment. This is a coordination identity problem, not merely malformed JSON handling.

**4. P2 — Discussion outcome labels contradict the actual movement recorded.**

`src/swarm/discuss.mjs:241–243` infers whether disagreement ever existed from only later-round declarations. Two initially opposed models that agree after hearing each other are labeled “NO DISCUSSION OCCURRED” and said to have agreed from round one (`:269–272`). The probe recorded similarity rising from 0 to 1 and one model explicitly declaring a change, yet produced that headline.

The “DEADLOCKED … nobody moved” branch (`:279–281`) also ignores declared movement. Two models swapping their positions produced that label even though both appeared in the movement list.

**Fix:** distinguish initial opposition, remaining opposition, individual movement, and lexical similarity. Do not infer “nobody moved” from unchanged similarity between models. Where opening data cannot establish disagreement, report that uncertainty.

**5. P2 — A swarm with no successful proposals still emits a successful synthesis.**

`src/swarm/layered.mjs:178–180` correctly skips reviews of missing proposals, but `:192–219` proceeds to synthesis unconditionally. Both explorers failed in the probe; zero proposals and zero refutations were available; the synthesizer still returned a successful answer with `judgeCompromised:false`.

**Fix:** require usable source material before synthesis. Return an insufficient-input outcome when none exists, and label reduced coverage when some proposals lack reviews. A judge's successful response is not proof that the multi-model process succeeded.

**6. P2 — The delegation demo's oracle does not test its advertised process boundary.**

The task explicitly requests an inter-process lock (`scripts/delegate-run.mjs:88–98`), but the verifier runs four asynchronous calls inside one process (`:54–63`). A purely in-memory Promise queue passed the existing verifier. Two real child processes using that same implementation overlapped in a separate probe.

**Fix:** exercise the actual cross-process requirement with separate processes and shared overlap evidence. The executable verifier is a valuable design choice; its assertions must match the parent task's acceptance conditions.

## The persistent-team layer

`src/team/` deserves attention as architecture, even though it is not yet wired into execution. A chair identifies the job independently of vendor; the conversation identifies one vendor session. A compact chair brief records decisions, abandoned paths and their reasons, file ownership, and prior occupants. Optional debate/scouting modes have explicit openers and caps. These are sensible ingredients for work that survives beyond one batch of prompts.

The latest commit fixes several local contracts and adds five team test files. Searches of `src/`, `scripts/`, and `bin/` nevertheless found no production callers of `occupy`, `recordOccupancy`, `restoreBrief`, `patternFor`, `assertOpened`, `assertLawful`, or `subagentBrief`. The standing team's memory, staffing, modes, and subagent rules therefore remain library behavior rather than properties of a running workflow.

Offline composition probes found three issues to address while connecting it:

- Occupancy generations use retained history length. After history is capped at twelve records, generations repeat: `1…13,13,13` (`team/roster.mjs:128`, `team/continuity.mjs:131–132`). Persist the monotonic counter independently of the bounded history.
- A vendor returning to a chair receives the same conversation key as its previous occupancy. Conversely, omitting versus explicitly specifying the default role produces different purposes for the same effective role (`team/roster.mjs:125–128`). Normalize roles and define whether occupancy changes resume or start conversations.
- The board scheduler returns `ready` as an array, while `patternFor()` expects a count (`board/controller.mjs:313`, `team/modes.mjs:34`). A real scheduled work item produced “no rented pattern” until its length was passed explicitly. Define the adapter between these components.

These are latent composition defects, not failures observed in a deployed team loop. The reviewed code has no such integrated loop.

## Development priority

The next milestone should be one complete orchestration lifecycle: accept a task, decompose it, execute with capacity-aware scheduling, collect explicit per-task outcomes, request bounded repairs, hand off to an independent reviewer, and report completion only when the required work is complete. Connect chair memory and model replacement into that lifecycle rather than maintaining them as a parallel API.

Use the current patterns where they fit. Independent exploration is useful for breadth; review should examine actual work and preserve disagreements; delegation should separate assignments with concrete outputs. Evaluate each pattern against a single-model baseline with the same task, completion criteria, latency measurement, and cost budget. Current repository evidence does not establish a general quality or productivity advantage from adding models.

The strongest concept here is the deliberate relationship between **who does the work, what they may see, and who evaluates it**. The main remaining work is making that relationship survive real scheduling, partial failure, fresh runs, and reseating.

## Evidence

- `orchestration-main-tests.log`: current main, 443 passed, zero failures.
- `orchestration-delegation-evidence.json`: revision, source hashes, reproduction commands, exit codes, and outputs for task failure, duplicate IDs, same-seat admission, and the demo oracle.
- `orchestration-discussion-evidence.jsonl`: complete-request history isolation, contradictory discussion labels, and empty-input synthesis probes.
- `orchestration-team-evidence.json`: helper composition results, explicitly scoped to unwired team components.

Reproduction scripts and their isolated state are preserved under the review workspace's `work/delegation-review/`, `work/discussion-review/`, and `work/team-composition-probe.mjs`. Their assertions confirm the observed defects; a zero exit code is not a product acceptance verdict. This review also read the existing external review as context, but the findings above rest on inspected code and the retained local probes.

---

*Provenance note (added when this file was placed in the repo, 2026-09-27): this text is the verbatim body of the reviewer's upload; the evidence files and probe workspace it names live in the reviewer's own workspace and were not copied here. Its severities are superseded by `2026-09-27-orchestration-rereview-addendum.md`.*
