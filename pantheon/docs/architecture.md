# Pantheon architecture

**Read this for why the system is shaped the way it is.** For what has been verified live and what
is still open, read `STATE.md` — it is a dated snapshot and rots on purpose. For the original design
argument and its reversals, read `docs/specs/2026-09-27-pantheon-design.md`. This document is meant
to stay true as the code changes; if it stops being true, it is the bug.

## Context and goals

Several vendors' models work one task. The hard problems are not prompting:

1. **Continuity is a claim, not a fact.** Every turn is a fresh HTTP call. A seat that silently
   restarted looks exactly like a seat that continued, and a vendor id parsed out of output is not
   the same kind of evidence as one the vendor confirmed.
2. **A shared chat log is not a workspace.** If every participant sees every message, an early
   answer anchors everyone downstream, reviewers agree with what they were handed, and "three models
   concurred" means one model's framing was restated three times.
3. **Self-report is not evidence.** A model reporting that it ran the tests, wrote the file, or
   fixed the defect is a sentence, not an exit code.

So the system is built around three refusals: a seat that cannot prove continuity does not continue;
a reader only receives what its role admits; and nothing ships on a report.

## Four concepts

| concept | what it is | where |
|---|---|---|
| **seat** | a durable identity, `vendor + purpose + cwd`. Not a process, not a model. Two vendor namespaces exist and are not interchangeable: SDK seats are `openai` `xai` `agy_google` `anthropic`; the superseded CLI entrypoint's are `claude` `codex` `grok` `agy` (see the README). | `src/seat/` |
| **role** | the job: an instruction, a projection, a tool set, a set of context tokens. | `src/role/roles.mjs` |
| **seating** | which model sits in which chair, at which difficulty. | `src/role/seating.mjs` |
| **board** | the typed, versioned, leased store of partial results, plus the controller. | `src/board/` |

### The role is not the model

The role instructs; the model is the contractor you drop in the chair. **Same contractor in two
chairs is legal. Same pack in two chairs is the bug** — two seats sharing a projection are one
opinion with two names. Precedence when they conflict: role > pack/projection > lab (review only) >
model.

A consequence worth stating because it is easy to get backwards: **a difficulty band is a fit, not a
tier.** The easy-band occupant is not the leftover that gets the scraps; on easy work it is the
better answer than the hard-band one, which arrives slower, dearer, and prone to reasoning past a
question that did not need it. The seating tables route work to a band; they do not rank the models,
and this project has measured no model's quality at any difficulty. Rungs chosen by preference carry
`TASTE`; rungs making an untested capability claim carry `UNMEASURED`. Neither is a finding.

`src/route/router.mjs` routes on continuity, quota-pool independence and stated needs only. It
**refuses** a need like "best at code" by name, because nothing here has measured that and a guess
cited as a reason launders itself into every downstream report.

**The withholding inspects values, not key names.** The first `contextFor` stopped at the top-level
key, so `ticket: { plan }` reached an implementer with `withheld: []`. It walks permitted values now —
nested objects, arrays, and strings that parse as JSON — and refuses a permitted key that carries a
withheld kind rather than stripping it, because a caller nesting withheld kinds is a bug to surface.
What it cannot police is free text that merely mentions a plan; that is the stated limit, and the
reason the swarm paths build every prompt through `promptFor()` with typed tokens instead of prose.

## The board: two graphs over one store

```
  lineage                             board
  entry ──derived_from──▶ entry       commit ──parent──▶ commit
    │                                   │
    ├──supports──▶ entry                └──tree──▶ { slot: cid, ... }
    └──target────▶ entry
  "why this claim exists"             "what is true now"

              └──────────── one content-addressed store ────────────┘
```

Seats read a **checkout** (a projection of one commit). The controller **appends** commits. A
critique binds to a **blob cid**, not to "the file" — so a critique cannot silently come to be about
different bytes than the ones it judged.

| module | owns |
|---|---|
| `canon.mjs` | canonical bytes and cids. Refuses `undefined`, `NaN`, `-0`, unstable key order — each makes two different nodes hash alike |
| `cas.mjs` | the object store. Put is idempotent; `get` re-derives the name from the bytes, so tampering is detected rather than trusted |
| `schema.mjs` | levels 0–6: ten kinds (`ticket` `repro` `search` `trace` `hypothesis` `plan` `work_item` `artifact` `critique` `decision`), per-kind writers, slotted vs accumulative, typed links |
| `dag.mjs` | the seven-step write, each step named in the result so a refusal says where it stopped |
| `refs.mjs` | mutable names, compare-and-swap, branch classes as write permissions |
| `runtime.mjs` | **level 7, deliberately outside the DAG**: leases with generations, occupancy, derived spend |
| `merge.mjs` | typed resolvers — `ours`, `union`, `slot-wise`, `bound-review`, `record-split` |
| `project.mjs` | sparse checkouts: `planner` `worker` `checker` `isolated_reader` `isolated_debater` `synthesizer` `supervisor` |
| `controller.mjs` | status ladder, trigger predicates, the scheduler — deterministic code |
| `integrate.mjs` | `ship()` and its gates |

### Link integrity at put time

A link to an absent cid is refused when the object is written. Two properties fall out of that one
rule: a cycle cannot form (every parent already exists), and **a fabricated citation cannot be
written at all** — not detected later, not written.

### Why level 7 is outside the DAG

Leases, heartbeats, occupancy and spend are harness chrome. Hash a lease expiry into a node and the
same claim forks every turn, and the history fills with churn that carries no meaning. Spend is
**derived** from a side log keyed by commit cid; a stored counter is a second source of truth and it
drifts in one direction — towards "still under budget".

Stated as a slogan: **hash the work, lease the name.**

### Why compare-and-swap is not the concurrency design

Content addressing means object writes never contend: the path *is* the hash, so two seats writing
the same bytes write one object, and two seats writing different bytes touch different paths. Only a
mutable **name** can contend, and every writer has its own — `refs/seat/<id>/wip`,
`refs/iso/<vendor>/<claim>`. One writer per name means **the queue is per seat**, and the CAS never
fires in normal operation.

It is an integrity backstop for when that invariant is violated — two controller processes, a
resumed session, a crash-restart replaying a publish — not the mechanism that makes concurrency
safe. Reading it as the design leads to the wrong fix for a real race.

**Underneath the leases is a plain file lock per seat**, and it has been wrong three times: a
check-then-unlink steal, then a rename that renamed whatever was at the path. It is a claim protocol
now — `<lock>.steal` taken with `wx`, the lock re-read under the claim, removed only if it is still the
exact lock judged dead — and every lock records the holder's start time so a reused pid is not honoured
as the holder. The remaining unfixable window, a process dying after the vendor acted and before the
first write, is made visible instead of atomic: an intent record before the call, removed after the
seat record lands, and a lingering one refuses the next turn until the loss is acknowledged.

### The controller is not a vendor

No mode can write a `decision`, and `seat` does not appear in that kind's `writers`. A synthesizer
records a *hypothesis* whose parents are the isolated forks; the controller turns that into a
decision under a named rule, or records a **split**. The asymmetry is the point: a model may
propose; only deterministic code may conclude.

## The team layer: chairs, not contractors

`src/team/` sits above roles. A **chair** (`impl@build`, `check@review`, `lead@orch`, `scout@opt`,
`arbiter@judge`) is a job that survives reseating: its key is `name + pod + cwd` and deliberately
excludes the occupant, where a seat's key (`vendor + purpose + cwd`) necessarily dies when the model
changes. The chair owns the **continuity brief** — what it decided, what it tried and abandoned *and
why*, which files it may touch, who sat there last — capped at 4 KiB and refusing rather than
truncating, because a brief that grows without bound is a diary the next occupant skims.

A **pod** is a context ceiling, not a group: the widest projection any occupant may hold. The
occupant's actual projection comes from its role and must sit inside the ceiling; a test asserts that
inclusion for every chair. Two corrections landed here: the lead's pod had been on the `supervisor`
projection, which is the controller's own view and controller-only — a chair on it is a vendor holding
the controller's eyes — and the scout's pod had one projection for three roles, when a scout is
pre-board and has none. Seven **laws** (`law.mjs`) refuse actions rather than describe virtues; law 4
defers to the role table's context policy rather than keeping a vocabulary of its own, because a law
that checks names nothing produces is green forever. **Patterns are rented**: board status selects a
shape run through existing chairs, and an on-request chair (scout, judge) must be opened by a lead
and dies at a turn cap — a standing debate seat litigates for days because nothing tells it to stop.

## Shipping: one function, eight gates

`ship()` is the only way work reaches the shipping ref, and it evaluates every gate on every call:

```
ACTOR ─▶ TARGET ─▶ TICKET ─▶ GRAFT ─▶ LEASE ─▶ REVIEW ─▶ TESTS ─▶ MERGE
```

Two rules about this list matter more than the individual gates:

- **"No chair ships" is not a sister law to "ship is a controller transaction" — it is the first
  field `ship()` reads.** ACTOR is a gate, not a separate policy enforced somewhere else.
- **The gates share rules; they never consume each other's leftovers.** The candidate set is
  computed once and every gate evaluates against it. An earlier version had REVIEW read the filtered
  output of the merge planner, which made it blind to exactly the case it existed to catch.

Acceptance is **executed, never asserted**: integration fires on a repro recording exit 0 whose
lineage *cites the artifact entry* **and whose author is not the artifact's author** — the controller,
or another lab. A pass that names no revision is a pass on nothing, and the maker's own green is
recorded and shown but does not close the gate; before that rule, "acceptance is executed" held only
while no maker lied. An artifact slot moves only on a critique of **those bytes**, checked on every
merge including a fast-forward — linear history is the case that actually ships.

**`merge()` cannot land a reviewed slot on the shipping ref.** It was a second door: a generic merge
onto `refs/board/*` moved an artifact with nothing but bound-review's cross-lab approval — no ACTOR,
TESTS or LEASE gate — and the demo script shipped through it. It now refuses (`SHIP_ONLY`) any slot
the default policy marks bound-review; carry-merges of items, verdicts and plans stay legal, and that
is what the controller uses `merge()` for. "One function is the right object" has to be enforced
against the other functions, not only stated about the one.

**Nor can a raw ref swap.** A holder of the handles from `openBoard()` could `putCommit` and
`refs.swap` straight onto `refs/board/*`, bypassing `merge()`'s refusal by construction. The ref
itself now refuses (`SHIP_ONLY`) a bound-review slot unless the caller is `ship()`, which says so with
`ship: true` — an in-process flag, not a capability, but a named, greppable one: every landing of
reviewed work on the shipping ref goes through one function or through a line that spells out that it
is bypassing it. The slot policy table lives in `src/board/policy.mjs` so the ref can read it without
importing the resolver, and the ship-only set is judged against the DEFAULT table, never a caller's.

**Fencing is not opt-in.** A seat that omitted `lease` used to write past an active lease with no
error at all. `refs.swap` refuses (`LEASE_REQUIRED`) a seat write that moves a directly leased slot
(`item:<key>`, `plan`) without presenting that lease, and `publish()` refuses an artifact slot listed
by a leased item's `artifact_slots`. The decision and the write run under the runtime's lease lock —
the same lock `acquire()` and `fence()` take — so a fence cannot land between "verified" and "written".
Lock order is always ref → leases; nothing under the lease lock touches a ref.

## The Antigravity seat

**Whose decision this was.** The placement is the operator's correction, not a conclusion this
harness reached. Watching the xAI reviewer return a verdict after minutes of nothing, they asked
whether Grok has agent-to-agent messaging (2026-09-27T23:04:42Z, session transcript), and on being
told it does not, ruled: *"you lose everything with no understanding everytime it gets to the
reviewer and it goes dark because theres no A2A"*, and *"as a subagent that needs those tools and
has a direct task maybe more suitable"* — with Gemini moved into the scout and reviewer chairs. That
is the rule this section implements: **a body with strong tools and no readable channel belongs on a
bounded direct task whose output someone else can execute; a judgment chair needs a body that can be
read while it works.** Everything below is the mechanism for that ruling, and the timings in
`STATE.md` are its confirmation, not its source. The correction preceded the measurement.

Every other seat in this repository is a chat call: the harness sends a brief, the model sends text,
and anything the model says it ran is a sentence. The Antigravity seat (vendor `agy_google`, Google's
lab) is an agent. `scripts/agy-seat.py` runs the `google-antigravity` SDK's `Agent` over the run's worktree with
read-only tools plus a shell, one static subagent (`pantheon-fact-checker`) that takes a single direct
check and returns commands, exit codes and output, a budget (`BudgetConfig`), a destructive-command
deny policy, and `response_schema` for the verdict. Its role text is the body of
`.agents/agents/pantheon-<role>/agent.md`, the same file the `agy` CLI loads as a custom agent, so the
two lanes cannot drift.

The messenger is the hooks. `pre_tool_call_decide` and `post_tool_call` append one JSON line per tool
call and per subagent start/finish to the run's `progress.jsonl`, and a heartbeat folds the thought and
text streams into "thinking N KB, M tool calls" lines. `scripts/overseer.mjs` reads that file, so a
person sees the review happen: "ran `node --test`", "asked the fact-checker to run the oracle",
"read the diff". A seat that cannot go dark without the file saying so is the property; the 6–9 minute
silent reviews earlier the same day are what it replaces.

The lab laws see `agy_google` as the lab `google` (`LAB()` in the runner): the reviewer's lab must
still differ from the maker's and the planner's, and the seat's quota is still one subscription pool
(`AGY_SEAT.pool`). `agy_google` is a merge of what used to be two vendor identifiers ("google", the
raw Gemini API, and "agy", this subprocess) — both authenticate with the same `GEMINI_API_KEY`, so
they were never on separate quotas; see `docs/specs/2026-09-27-vendor-model-facts.md`'s "Where each
Claude model is actually selected" section for the full reasoning and the one caveat (Antigravity's
separate CLI lane, unused by default, has a genuinely broader roster).

## Data flow

**A turn on a seat, CLI transport** (`pantheon turn` — the superseded path, still the clearest
statement of the contract because the vendor owns the transcript and we must go and read it):

```
load seat ─▶ locate the vendor's store BY THE SEAT'S OWN id ─▶ project to turns
   ─▶ verifyExtends(live, stored chain)
        ├─ not extended ──▶ REFUSE (exit 5). The conversation this seat held is gone.
        ├─ cannot locate ─▶ print UNVERIFIED and continue. Not the same as verified.
        └─ extended ──────▶ take the turn ─▶ snapshot against the id in force AFTER the turn
                              ─▶ save { token with its real provenance, chain }
```

Resolving by the seat's *own* stored id, rather than by directory, was a defect fix: in a shared
directory the locator handed back whichever session wrote last, which then "verified" as a resume.

**On the SDK path the same contract holds against a local record instead of a vendor file.**
`recordExtendsLocally(allTurns, recorded)` hashes the live turn list and requires the recorded head
to sit at exactly `recorded.length - 1`; a chain shorter than the record, or a prefix whose hash
differs, is refused. An empty recorded chain is `{ ok: false, why: "no baseline" }` — a zero-turn
projection is not a baseline, and treating it as one is how a seat silently loses its history. That
is the whole reason the SDK transport deleted a subsystem without weakening the guarantee: the proof
moved from "locate and parse the vendor's file" to "hash what we replayed", and the refusals are the
same shape.

**Provenance rank** is `sdk > hook > scrape > operator > adoption`. A locally minted handle is
labelled `operator`, never `sdk`, so a value we invented cannot later outrank one a vendor confirmed.

**A board cycle** (`scripts/board-run.mjs`, no model in the loop):

```
ticket ─▶ [controller: boardStatus + TRIGGERS] ─▶ schedule(role, projection, target slot)
   ─▶ seat writes to its OWN ref ─▶ offer = a pointer to a fork
   ─▶ cross-lab critique of those bytes ─▶ ship() ─▶ shipping ref moves
```

An **offer is a pointer to a fork**, like a pull request: `bound-review` keeps unreviewed work off
the shipping ref, and `work_item.links.offer` plus `offer_ref` name the candidate and its branch. An
earlier design put the candidate on the shipping ref, which meant a controller reading only that ref
could never see what needed reviewing — the first review was unschedulable.

## Key decisions and trade-offs

| decision | trade-off accepted |
|---|---|
| **Vendor SDKs, not CLIs** (a reversal of the original design) | Deleted the hardest subsystem — with CLI transport the conversation lived in a vendor-owned file we had to locate and parse, the source of three confirmed defects and two silent zero-turn projectors. Cost: no `agy` seat, whose SDK is Python. |
| **`maxRetries: 0` on every client** | The SDKs retry 429/408/409/5xx twice by default, which made the third refusal look like the first: fall-through logic, latency, and cost accounting were all wrong, understating a subtree's cost by up to 3×. Cost: the caller must handle transient failures. |
| **Continuity as a toggle** (`server` \| `replay`) | `server` is cheap but a reply cannot be read back locally; `replay` costs the whole prefix each turn (largely absorbed by prompt caching) and every reply is auditable offline with `store:false`. Auditability and cost genuinely conflict; the operator chooses. |
| **Replay keeps every output ITEM, not just prose** | Reasoning items carry `encrypted_content` and are what make the next turn work. Keeping only the prose silently drops reasoning while still looking like a working replay. |
| **Level 7 outside the DAG** | Leases and spend are not in history, so a historical "who held this lease" question needs the side log. Worth it: the alternative forks every claim every turn. |
| **No quality ranking in the router** | The router cannot express "use the best model for this", which some callers want. A measured-facts-only rule is the only way a reason cited downstream is worth anything. |
| **Loopback-only view, plus an origin policy** | No remote monitoring. That process holds four vendors' credentials — and loopback alone did not protect them from a browser on the same machine, so `/turn` also checks `Host`, `Origin`, `Sec-Fetch-Site` and content type. |
| **Two-phase replay history with the seat as authority** | History is written before the seat record and committed after; a crash in the first window drops an unacknowledged tail (never replays a tool call twice), a crash in the second keeps a tail the seat record vouches for (never loses an acknowledged exchange). The marker alone got only the first window right. |

## What the evidence actually says about multi-model work

Recorded here because the architecture should not imply a benefit the measurements do not show.

Cross-model review of a design the reviewers did **not author** found two real defects that 185
self-written tests, four live vendor checks and three temporal oracles all missed (the counts are
from this project's own record in `STATE.md`, which names the defects as evidence §U) — because the same
author wrote the tests and the assumptions they encode. The swarm, with its shared framing and a
participant as judge, did **not** find them. The difference was not the number of models: it was
that nothing primed the reviewers toward one answer, and neither graded its own work.

That is the design rule the whole board encodes. **Verification is structurally different from
generation.** A verifier must run a repro, hold a runnable oracle, or apply a genuinely distinct
lens — and default to refuted when it cannot reproduce. Trust anchors live outside the artifact
being judged.

## Acceptance and artifact recovery boundary

Acceptance runs generated code under mandatory Linux Bubblewrap isolation (`bwrap-v1`), with a
scrubbed launcher/child environment, private network and PID namespaces, no capabilities or nested
user namespaces, read-only system runtime files, and only the copied worktree plus private temporary
storage writable. Missing or denied namespace support refuses the run before vendor calls. This is
an execution boundary; a worktree directory alone is not one. Artifact bytes are rechecked after
execution, and controller/apply file operations reject symlink traversal.

Version-2 run state belongs to the board. It binds the exact ticket, every slot, real maker/ref,
immutable original destination baseline, artifact CID, byte CID, and revision. Successful shipping
adds the controller commit and complete export manifest. Refusal/salvage never produces an applyable
certificate. Apply uses a read-only CAS/ref view to recheck shipping membership, isolated controller
acceptance and bound review, and checks all source hashes and destination baselines before writing.
Legacy output summaries and prompt-derived baselines are insufficient and fail closed.

Recovery restores every saved slot. A failed acceptance resumes revision; a passing candidate may
resume review/shipping; an already shipped board restores exports without model turns. Early runs
without a complete per-slot checkpoint are refused. The independent orchestration path also requires
every required task to succeed and be verified; one passing sibling cannot cover an absent worker,
an abstention, or an analysis task with no executable verifier. Task IDs must be unique.
