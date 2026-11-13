# Pantheon role cards

Claude Code agent cards for the seven pantheon roles plus one
non-dispatchable reference doc for the controller. Every claim in these
cards traces to a source file under `src/`; see each card's body for exact
citations. This index does not restate their content — read the card for
the role you're occupying.

| file | role | chair(s) | may ship | may judge |
|---|---|---|---|---|
| `scout.md` | pre-board evidence gathering | `scout@opt` (intake) | no | no |
| `planner.md` | decides what work exists, hands off | `lead@orch` | no | no |
| `implementer.md` | produces the artifact | `impl@build` | no | no |
| `reviewer.md` | attacks the artifact, cross-lab | `check@review` | no | no |
| `explorer.md` | independent position, isolated, no code access | `scout@opt` (stuck swarm) | no | no |
| `advocate.md` | defends one position, isolated fork | `scout@opt` (split debate) | no | no |
| `judge.md` | synthesizes forks into a recommendation | `arbiter@judge` | no | yes |
| `controller.md` | **not an agent** — documents `ship()` | — (code, `src/board/integrate.mjs`) | — | — |

No card may ship. `controller.md` explains why it isn't itself a card in
the dispatchable sense: it carries no `model:` field, so this machine's
delegation guard refuses any attempt to invoke it as a subagent.

## The handoff chain

```
                              PRE-BOARD (outside the chain entirely)
                              ┌─────────────────────────────────────┐
  raw question ──opened by──▶ │  scout@opt / scout role              │
  (lead@orch, law 5,          │  runs commands, reads sources,       │
   turn_cap: 3)               │  produces search+repro on iso/* refs │
                              └───────────────────┬───────────────────┘
                                                   │ evidence cited by cid
                                                   ▼
                                     A HUMAN WRITES THE TICKET
                              (schema.mjs: ticket writers = human | controller,
                               never a seat — this is the one write no card in
                               this directory may ever perform)
                                                   │
                                                   ▼
                              ┌───────────────────────────────────────┐
                              │  lead@orch / planner role              │
                              │  brainstorming → writing-plans →       │
                              │  plan + work_item, hands off, stops    │
                              └───────────────────┬───────────────────┘
                                                   │ plan + work_item (≤8192B brief, law 4)
                                                   ▼
                              ┌───────────────────────────────────────┐
                              │  impl@build / implementer role         │
                              │  writes artifact under a named lease   │
                              │  (law 2), TDD, offers a fork for review│
                              └───────────────────┬───────────────────┘
                                                   │ work_item.links.offer → offer_ref
                                                   ▼
                              ┌───────────────────────────────────────┐
                              │  check@review / reviewer role          │
                              │  DIFFERENT LAB (law 3), reads frozen   │
                              │  bytes, never commit_msg, writes a     │
                              │  critique bound to the exact cid       │
                              └───────────────────┬───────────────────┘
                                                   │ critique (findings + verdict)
                                                   ▼
                              ┌───────────────────────────────────────┐
                              │  CONTROLLER — ship() (integrate.mjs)   │
                              │  ACTOR→TARGET→TICKET→GRAFT→LEASE→      │
                              │  REVIEW→TESTS→MERGE, all 8 evaluated,  │
                              │  one commit or a no-op refusal         │
                              │  (controller.md — code, not a card)    │
                              └─────────────────────────────────────────┘


                    Two rented patterns branch off the conveyor above,
                    per src/team/modes.mjs — neither is a standing seat:

  board status "stuck"                          board status "split"
  ──────────────────────                        ──────────────────────
  lead@orch opens a                              lead@orch opens isolated
  timeboxed_swarm on scout@opt,                  forks on scout@opt (advocate
  in the EXPLORER role, turn_cap 3               role) + arbiter@judge, turn_cap
  (roster.mjs scout@opt.turn_cap)                = arbiter@judge.turn_cap (2)

  ┌───────────────────────┐                     ┌───────────────────────┐
  │ explorer.md            │                     │ advocate.md            │
  │ ticket only, no peer,  │                     │ ticket + assigned      │
  │ no code, no board      │                     │ hypothesis, isolated   │
  │ write — returns a      │                     │ fork, writes hypothesis│
  │ falsifiable position   │                     │ (visibility: isolated) │
  │ to the caller           │                     │ "Do not concede."      │
  └───────────────────────┘                     └───────────┬───────────┘
                                                              │ isolated forks,
                                                              │ handed by commit
                                                              ▼
                                                 ┌───────────────────────┐
                                                 │ judge.md                │
                                                 │ (or the human takes     │
                                                 │ this seat, per          │
                                                 │ modes.mjs "forced")     │
                                                 │ reads every fork,       │
                                                 │ writes a hypothesis     │
                                                 │ (a recommendation) —    │
                                                 │ never a decision        │
                                                 └───────────┬───────────┘
                                                              │
                                                              ▼
                                                 controller resolves:
                                                 unanimous | controller_rule
                                                 | split (recorded:true) —
                                                 never a seat-authored
                                                 decision (schema.mjs:
                                                 decision.writers has no
                                                 "seat")
```

## Reading order

1. Read `src/role/roles.mjs`, `src/role/seating.mjs`, `src/team/law.mjs`,
   `src/team/roster.mjs`, `src/team/subagent.mjs`, `src/board/integrate.mjs`,
   and `docs/architecture.md` once, before occupying any of these roles for
   real — the cards summarize them, they do not replace them.
2. Occupy exactly one card per session. A card is a chair, not a personality
   — do not blend two roles' context tokens because it seems convenient.
3. If a card's "Seating" section flags a mismatch between `roster.mjs`
   candidates and the `SEATING`/`INTAKE` tables (several do — see below),
   that mismatch is in the source, not a card error.

## What these cards are — and are not — seating

Pantheon's own automated routing (`seatingPlan()`, `selectFor()`,
`candidatesFor()` in `src/role/seating.mjs`) resolves chairs to vendor SDK
seats (openai/xai/agy_google/anthropic), never to a Claude Code session running
interactively. These cards exist for the *other* case: a human driving
Claude Code who wants to occupy a pantheon chair directly, honoring the same
context boundaries, laws, and refusals the automated seating would enforce
on whichever vendor actually got routed there.

That means several of these cards document a chair anthropic is not
actually a candidate for, or is a candidate for only through a mismatch
between `roster.mjs` and `seating.mjs`. Documented plainly, per card, rather
than smoothed over:

| chair | `roster.mjs` candidates | `SEATING`/`INTAKE` table | discrepancy |
|---|---|---|---|
| `scout@opt` (scout) | agy_google, xai, openai | agy_google, xai, openai | none — **but anthropic is absent from both** |
| `lead@orch` (planner) | anthropic, openai | anthropic only (3 rungs) | roster allows openai; `SEATING.planner` never offers it. Also: `NOT_SEATED` declares `claude-fable-5-1` "not a seat" while `SEATING.planner` seats it as the hard rung |
| `impl@build` (implementer) | openai, anthropic | openai only (3 rungs) | roster allows anthropic; `SEATING.implementer` never offers it |
| `check@review` (reviewer) | xai, agy_google, anthropic, openai | all four, anthropic as last ISOLATION reseat (haiku) | vendor sets agree; but gemini's comment says "reseat" while its `band: "easy"` makes it the primary easy-difficulty pick |
| `scout@opt` (explorer) | agy_google, xai, openai | agy_google, xai only | roster allows openai; `SEATING.explorer` never offers it; anthropic in neither |
| `scout@opt` (advocate) | agy_google, xai, openai | agy_google, xai only (declared **twice**, byte-identical — a duplicate key in the source) | same as explorer, plus the duplicate-key defect |
| `arbiter@judge` (judge) | anthropic, openai, agy_google, xai | all four | none |

Where a row says "none," `seatingPlan()`'s automated path and `roster.mjs`'s
manual `occupy()` path agree on who may sit there. Where it doesn't, the
card for that role says so again, in place, with the file and the exact
sets compared.

## Known-open — see `controller.md` (probed at HEAD `1d5186f`)

The table that stood here was pinned to `e34c0f4` and went stale within hours: three of its rows
(`merge()` as a second door, TESTS trusting a seat's exit 0, blobs served before re-hash) were closed
the same day while the table still called them open. It was replaced by a section a script can check.
`controller.md` → "Known holes at HEAD `1d5186f`" carries a runnable `probe:` per open hole (exit 0
only while the hole reproduces); "Closed since e34c0f4" cites a passing test per closure; quoted
`path:line` citations must resolve. `node scripts/card-check.mjs .claude/agents/controller.md --head
1d5186f` verifies all of it. The current section was written by a seat (`gpt-6-astra`) from the
attached sources, reviewed by another lab, shipped as board commit `c3b0ef6c871e`, applied here and
verified 18/0 (`outputs/open-items/controllerCardB/card-check-applied.txt`).

Short form at `1d5186f` — **open, with probes:** checker projection carries maker prose in artifact
payloads (3); live runner does not wire the team-law helpers (5); no decision-authoring trigger (6);
`patternFor(schedule())` loses the conveyor pattern (7); chair occupancy generations repeat after
trimming (8); discussion headline ignores declared movement (10); law 6 refuses the human actor
`ship()` admits (11). **Closed, with tests:** the second door (1), TESTS author check (2), the
fencing windows (4), the fixed `exited 0` review line (9), blob re-hash (12). **Unverified:** item
10's orchestration subclaims (`orchestrate.mjs` was not in the attached set).

Read the handoff diagram above as the design these cards hold you to, and `controller.md`'s probed
section as how much of it the runtime enforces today.

## Skills coverage

Every superpowers skill installed in this environment
(`~/.claude/plugins/cache/claude-plugins-official/superpowers/6.4.1/skills/`)
was read before writing these cards. Roles with a strong, direct fit
(planner ↔ brainstorming/writing-plans; implementer ↔
test-driven-development/subagent-driven-development/executing-plans/
systematic-debugging/receiving-code-review/verification-before-completion/
using-git-worktrees; reviewer ↔ requesting-code-review's `code-reviewer.md`
rubric, adapted) say so plainly. Roles with no purpose-built fit (scout,
explorer, advocate, judge) say that plainly too, and name the nearest
adapted fit with an explicit caveat rather than force a mapping that isn't
there. `finishing-a-development-branch` and its human-facing merge/PR/keep
menu were deliberately **not** mapped to any role: it is superpowers' own
analog of `ship()`, but it assumes a human choosing among git-branch
integration options, which is not how pantheon's own gated, code-only
`ship()` transaction works — that tension belongs to `controller.md`, not
to any seatable role.
