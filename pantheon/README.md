# Pantheon

A supervised harness for running work across several AI vendors, where continuity is **proven** and
what shipped is **certified from disk** — never taken from a model's report.

Two ideas carry the whole project:

- A **seat** is a durable identity (`vendor + purpose + cwd`), not a process. Every turn is a fresh
  API call, and before continuing a seat the harness re-derives its conversation from the vendor's
  own store and refuses to proceed if the chain it holds was not extended.
- A **board** is a typed, versioned, leased store of partial results plus a controller that decides
  who may write which slot next. It is not a shared chat log. Underneath it is a merkle DAG, so a
  seat's view of the world is provable rather than remembered. Names are political; hashes are not.

The controller is deterministic code. It is not a vendor, it cannot write a `decision` on a model's
behalf, and no seat can grade its own work.

## Quick start

The unit suite needs **no vendor SDK install and no credentials** — vendor clients are injected.
Pipeline and isolation tests additionally require Linux, `/usr/bin/bwrap`, and permission to create
user, mount, PID and network namespaces. Acceptance refuses before vendor calls if that boundary
cannot be established. Node ≥ 20 runs everything except the `agy` seat's SQLite conversation store,
which needs `node:sqlite` (Node ≥ 22.5) and is loaded on first use.

```bash
git clone <this repo> && cd pantheon
node --test tests/*.test.mjs # inspected root suite; includes real acceptance-isolation tests
```

To watch the board drive a task end to end with **no model in the loop** — intake → planning →
executing → reviewing → accepted, entirely from the controller's trigger predicates:

```bash
node scripts/board-run.mjs --verbose
```

Anything that talks to a real vendor needs the install and a credential in the shell:

```bash
npm install                                                   # required before any live script
source ~/Projects/agentic-pipeline/sdk/keys-from-windows.sh   # loads keys into this shell only
node scripts/live-check.mjs openai                            # proves continuity: turn 2 recalls turn 1's codeword
node bin/pantheon-view.mjs 7777                               # live view, http://127.0.0.1:7777
```

To have the seats work one of the project's own open items through every gate — planner, implementer,
controller-executed full suite (failures go back to the seat, bounded), other-lab review, `ship()` —
and watch it happen:

```bash
node scripts/open-items-run.mjs --ticket scripts/tickets/open-item-6-project-records.json   # source files change only on explicit apply
node scripts/overseer.mjs outputs/open-items/projectRecords                                # narrates progress; warns on silence
```

Every shipped slot lands under `outputs/open-items/<key>/artifact/`, with a versioned manifest in
`run.json`. Preview with `node scripts/apply-artifact.mjs --key <key>`; add `--apply` to apply all
certified files after every destination baseline passes. Refused work is saved separately under
`artifact-latest/` and cannot be applied by that command. Legacy outputs lack the required certificate
and must be rebuilt. `STATE.md` item 1 records the first historical item closed through the pipeline.

The unit suite passing without that install is deliberate, and it once hid a missing install on a
fresh clone: 234 tests passed in a checkout where `node scripts/live-check.mjs` could not resolve
`openai`. If a live script fails on module resolution, you skipped `npm install`.

## Two transports, two vendor namespaces

This trips up every new reader, so it is the first thing to know. **The names are different sets and
they are not interchangeable:**

| transport | vendors | used by | status |
|---|---|---|---|
| **SDK** | `openai` `xai` `agy_google` `anthropic` | the live scripts, the board, the router, the view | current |
| **CLI** | `claude` `codex` `grok` `agy` | `bin/pantheon.mjs` only | superseded, still working |

Transport moved to vendor SDKs partway through the project, which deleted its hardest subsystem —
with CLI transport the conversation lived in a vendor-owned file that had to be located and parsed,
and that was the source of three confirmed defects and two silent zero-turn projectors. The CLI
entrypoint was kept because its resume-verification contract is independently testable and its
black-box exit codes are worth keeping. Anything new should use the SDK path.

## The CLI (CLI transport: `claude` `codex` `grok` `agy`)

```
pantheon conform                                              # does each vendor's flag table hold?
pantheon turn <vendor> <purpose> <cwd> <prompt...>            # take a turn on a seat
pantheon snapshot <vendor> <purpose> <cwd> [--session-id <id>]
pantheon verify-resume <vendor> <purpose> <cwd> <record.json>
```

`conform` needs the vendor CLIs on `PATH` but no credential — it checks each one's flag table
against what this project records, and prints one line per vendor:

```
OK   claude (5 checked: --resume --session-id --model --effort -p)
OK   codex (2 checked: -m -C)
OK   grok (4 checked: --resume --session-id --effort -p)
OK   agy (4 checked: --conversation --model --add-dir -p)
```

Exit codes are one per failure class, because a caller must be able to tell them apart without
parsing prose: `0` ok/resumed, `1` not-resumed, `2` usage, `3` unknown-vendor, `4`
identity-unresolvable, `5` refused-stale-seat, `6` bad-record, `7` unreadable-transcript. An
independent black-box suite found `unknown-vendor` colliding with two other classes before these
were split — a missing file was reading as an authoritative "did not resume".

## Configuration

| variable | effect |
|---|---|
| `PANTHEON_CONTINUITY` | `server` (vendor holds the thread, hashes only on disk) or `replay` (whole prefix each turn, every reply auditable offline). Per call: `sdkTurn({ continuity })`. Precedence: explicit > env > vendor default. |
| `PANTHEON_VIEW_PORT` | live view port, default 7777, loopback only |
| `OPENAI_API_KEY` / `XAI_API_KEY` / `GEMINI_API_KEY` | the keyed **SDK** seats (`openai`, `xai`, `agy_google`) |
| anthropic | the `anthropic` SDK seat uses subscription OAuth, **not** a key — see below |

A vendor that cannot honour the requested continuity mode runs what it can and reports
`continuity_honoured: false` rather than substituting silently.

**Choosing a credential means excluding the other.** These SDKs read their key env var themselves,
so `apiKey: null` on the OAuth path is not tidiness — an OAuth client on a machine with
`ANTHROPIC_API_KEY` set sends both, and the metered one wins.

**The view binds loopback only, and loopback is not a permission.** A browser on this machine is on
the loopback too, so `/turn` additionally requires a loopback `Host` for this port, refuses any
foreign `Origin` or cross-site `Sec-Fetch-Site`, requires `application/json` (the `text/plain` form a
cross-site page can send without preflight is refused), and never sets a CORS header. Before that, any
web page open in your browser could spend all four vendors' credits, and DNS rebinding could read seat
text off `/events`. Found by an external review, not by the suite.

## Layout

| path | what it owns |
|---|---|
| `src/config/models.json` | **change a model ID here, nowhere else** — the single source `adapter.mjs`/`router.mjs`/`seating.mjs` all read from; see the header comment in `src/config/models.mjs` |
| `src/seat/` | seat identity, the turn, the on-disk store, the cross-process lock (claim-protocol steal, start-time identity) |
| `src/sdk/` | vendor transport: client construction, streaming, replay history, the intent record that makes a turn lost mid-flight visible |
| `src/board/` | the blackboard — CAS, merkle DAG, refs, schema, merge, projections, controller, ship |
| `src/role/` | roles (the job), seating (which model sits in which chair, at which difficulty) |
| `src/route/` | routing on measured facts only; refuses any need it cannot justify |
| `src/context/` | locating and projecting a vendor's conversation store; the proof chain |
| `src/swarm/` | layered fan-out, delegation, structured discussion |
| `src/view/` | the live SSE view and its event bus |
| `src/team/` | the standing org: chairs that survive reseating, pods as context ceilings, seven laws, rented patterns, the continuity brief, subagent rules |
| `scripts/` | runnable checks, each with an oracle that cannot be satisfied by a plausible-looking failure |
| `docs/architecture.md` | why it is shaped this way — start here after this file |
| `STATE.md` | dated snapshot: what has been verified live, and what is open |


## Testing

```bash
node --test tests/*.test.mjs           # root suite, including isolated pipeline fixtures
node --test tests/board-*.test.mjs    # board invariants alone
node --test tests/seat-lock.test.mjs  # four real processes racing one seat
```

Tests here are written to fail for one reason each, and several exist because a *checker* was wrong
rather than the code under test. If you add one, give it an oracle that can distinguish the claimed
outcome from its failure: a green suite means "consistent with the author's assumptions", and this
project has paid for the difference more than once. Where a check cannot run, it must say
`UNVERIFIED` rather than imply a check that never happened.

## Status, honestly

Verified live against real vendors: continuity on all four seats, incremental streaming, the live
view end to end, cross-seat review with private per-seat tokens, swarm concurrency at efficiency
1.00, and a cross-process seat lock proven by a real four-process race. `STATE.md` lists each with
the command that produced it and the evidence it cannot fake.

Not true yet, and load-bearing to say so:

- **No vendor seat has ever written a board entry.** `scripts/board-run.mjs` uses canned producers
  on purpose, so the schedule is reproducible without a model, and it now ships through `ship()` and
  its eight gates rather than the `merge()` door it used to walk through. The swarm paths do not call
  `project()`, so no live run produces a board commit. (The ROLE context policy *is* enforced there —
  every swarm prompt is built by `promptFor()` — but that is the role table, not the board.)
- **The multi-seat premise is unproven for doing work.** A paired evaluation returned every task
  tied, with 0 of 6 trials in the delegating arm delegating at all.
- **The swarm is not independent corroboration.** Layer-2 reviewers are anchored by the answer they
  are handed and the default synthesizer is a participant. It produces real critique; it must not be
  counted as N confirmations.
- ~~**`agy` (Antigravity) has no adapter.**~~ It has two lanes since 2026-09-27, both loading the same
  role text from `.agents/agents/pantheon-<role>/agent.md`: the **SDK seat** `scripts/agy-seat.py`
  (the `google-antigravity` Agent under `agentic-pipeline/sdk/.venv-antigravity`, `GEMINI_API_KEY`,
  read-only tools plus a shell, one bounded `pantheon-fact-checker` subagent, a budget, and hooks
  that append every tool call and subagent start/finish to the run's `progress.jsonl`), seated with
  `--seat reviewer=agy/gemini-3.7-flash`; and the **CLI lane** (`agy --agent pantheon-reviewer` in
  headless mode), which loads the same cards but auto-denies `run_command` without a permissions
  rule, so the SDK lane is the default. First live turn: `outputs/agy-smoke/sdk1/result.json` — 22 s,
  5 tool calls, the subagent ran `tests/board-fencing.test.mjs` (8/8), structured verdict returned.
  `agy` is a transport name; for the lab laws it is the google lab. What is still true: this seat's
  quota is one subscription pool, so fan-out across Antigravity's models buys isolation, not throughput.
- ~~**Streaming has no unit test.**~~ It has five, on a clean checkout with no credential:
  `tests/sdk-stream-thinking.test.mjs` drives `streamTurn` against scripted stubs for all three
  surfaces. They came with the `thinking` event — reasoning now surfaces as a byte count so a working
  seat cannot be mistaken for a silent one, which is what one xAI review's ~124 KB of dropped reasoning
  events had made it look like. Shipped by the seats as board commit `1bbfe335f394` in 89 seconds,
  ticket to eight gates. The rest of the module's behaviour is still covered only by
  `scripts/stream-check.mjs`, which needs a credential.
- **There is no git remote.** Nothing has left this machine, and a disk loss is total.

## Contributing

Zero runtime dependencies in `src/` beyond the three vendor SDKs, which are imported only at the
edge (`bin/`, `scripts/`) and injected inward — that is what keeps the suite runnable with no
install and no credential.

Before changing anything under `src/board/`, read `docs/architecture.md` on the two graphs and on
why level 7 is outside the DAG. Both are invariants that look like implementation detail and are
not.
