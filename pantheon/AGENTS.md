# AGENTS.md — pantheon

A supervised multi-vendor build pipeline. Model seats propose, review and implement; a
**deterministic controller** decides what ships. The controller is code, never a model.

## Setup and commands

```bash
npm install            # three vendor SDKs; see "Dependencies" below
npm test               # == node --test  (639 tests at time of writing; all must pass)
node --test tests/board-run-item.test.mjs     # one file
```

Node **>= 20** (`package.json` engines); this machine runs `/usr/bin/node` v24. Use native Linux
Node — a Windows `npm` on PATH cannot run this from a `\\wsl.localhost` UNC path.

Entry points in `bin/`:

| Binary | What it is |
| --- | --- |
| `pantheon.mjs` | the CLI |
| `pantheon-view.mjs` | the read-only view server |
| `pantheon-build.mjs` | the build HTTP API (default port 7778) |
| `pantheon-agents-mcp.mjs` | MCP server over the agent store (stdio) |

Vendor credentials are environment-only and never enter the repo. They do not persist between
shell invocations here: source them and run in **one** command.

## Dependencies

**This project is NOT zero-dependency** — that rule belongs to TELOS, next door, and importing it
here has bitten before. `package.json` declares `@anthropic-ai/sdk`, `@google/genai` and `openai`.

What *is* enforced: **no pipeline module imports a vendor SDK.** Injection happens at the edge
through `makeClientFor(vendor)`, which is why the whole pipeline is testable with scripted fakes
and no credentials (see `tests/board-multi-slot.test.mjs`). Do not `import OpenAI from "openai"`
inside `src/board/` or `src/role/` — pass a client in.

## Invariants that are enforced, not merely requested

Each of these is a function that throws. Breaking one is a failing test, not a style note.

- **Context policy** — `contextFor()` in `src/role/roles.mjs` filters what a role may see and
  refuses withheld kinds nested inside permitted ones. A key-name filter is not a content filter;
  that hole shipped once and was found by re-review.
- **Cross-lab review** — `assertReviewCutsAcross()`: a reviewer must not share a vendor with the
  maker. This is the one routing rule in the project with direct evidence behind it.
- **Maker's defense is withheld** — `project()` in `src/board/project.mjs` keeps the commit message
  from the reviewer. A producer's account of its own patch is not evidence.
- **Fan-out is outside** — `assertFanOutIsOutside()`: breadth only at `stage: "intake"`,
  `depth: 0`. Breadth nested inside a running hierarchy is one answer in three accents plus a bill.
- **Ship gates** — `src/board/integrate.mjs`. REVIEW and TESTS gate per artifact, across all of
  them. A gate never reads a model's self-report; it re-reads disk.

## Model IDs live in exactly one place

`src/config/models.json`, read through `modelId(vendor, name)`. Every call site goes through it.
A second copy once shipped a wrong id (`grok-4.20-multi-agent` for the documented
`...-multi-agent-0309`) and nothing caught it. **Do not re-type a model id anywhere else.**

## Agent cards: the name is a contract

`scripts/agy-seat.py` opens `.agents/agents/pantheon-<role>/agent.md` **by role alone**. A card
named anything else parses perfectly and is never found — an install that reports success and
changes nothing. That loader also never strips quotes (`key, _, val = raw.partition(":")`), so
frontmatter values must be unquoted and single-line.

Verify with the real consumer, not the test suite:

```bash
python3 scripts/probe-agent-card-consumer.py     # expect: FOUND / PARSED OK / ISSUES: none
```

The suite grades the renderer against itself; this grades it against the seat.

## The Codex seat

Codex has **two** agent surfaces, and this repo uses the second one.

1. **Custom agent files** — standalone TOML under `~/.codex/agents/` (personal) or `.codex/agents/`
   (project), requiring `name`, `description`, `developer_instructions`, and optionally `model`,
   `model_reasoning_effort`, `sandbox_mode`, `mcp_servers`, `skills.config`. Built-ins are
   `default`, `worker`, `explorer`. Global defaults live under `[agents]` in `config.toml`. This is
   real and documented; it simply does not exist on this machine — nothing has created either
   directory. (AGENTS.md, this file, is NOT that surface: it is instructions only and cannot define
   an agent.)
2. **The SDK call** — `openai_codex.Codex.thread_start(developer_instructions=..., sandbox=...,
   approval_mode=...)`, which is what Pantheon uses, because a seat is chosen per run by the
   seating table rather than pinned in a file a user maintains.

`src/agents/render.mjs` renders the call's arguments; `scripts/codex-seat.py` makes the call.

This needs a venv that is not created for you, and is gitignored:

```bash
python3 -m venv .venv-codex && .venv-codex/bin/pip install openai-codex
.venv-codex/bin/python scripts/probe-codex-seat-contract.py   # expect: all checks passed
```

The probe reads `thread_start`'s real signature by reflection and validates every emitted enum
against the SDK's own `Sandbox`/`ApprovalMode` — it is not the suite checking itself. If the venv
is absent, the probe exits 2 and says so; that is a missing prerequisite, not a failure.

Seat policy, and both are deliberate refusals of a default: `sandbox` is `read-only` for every
role except the implementer (a reviewer that can write holds the capability its charter forbids,
and `full-access` is never emitted at all), and `approval_mode` is `deny_all` rather than the SDK
default `auto_review` — approval belongs to `ship()`'s gates, which re-read disk, not to the model
being gated.

## Style

Match the surrounding code. Comments here explain **why**, usually citing the failure that caused
the line — keep that density; it is the project's memory. Tests carry the same: a test's comment
names the defect it would catch.

Write the failing test first and watch it fail. A test that passes before the implementation exists
is a finding about the test.

## Code Review Rules

- **Default to finding a problem.** "Looks good" is acceptable only with the strongest counter you
  could construct and why it fails. This is the reviewer role's actual charter, and it applies to
  human review here too.
- **Every finding carries a concrete failing case** — an input or a command, with observed vs.
  expected. A finding without one is a preference.
- **Do not review your own work.** Same author, same blind spots. Cross-lab review is enforced in
  the pipeline for this reason; honour it outside the pipeline as well.
- **Judge the bytes, not the account of them.** A commit message, a summary field, or a PR
  description is the maker's defense. Read the diff.
- **Run the repro.** A claim that something passes is a sentence, not an exit code.

## Checks that do not count

- `existsSync`, a regex match, an mtime, a path prefix, or an agent's report are **not** the
  properties they stand for. Parse it, execute it, hash it, re-run it.
- Green tests mean "consistent with the author's assumptions," not "correct."
- A verifier shipped inside the artifact it judges is not a trust anchor.

## Git

`~/Projects` is a multi-project workspace whose root repo is an empty shell. **Never run
parent-level git operations from it** (`git add -A`, `git add .`, `reset`, `clean`) — they sweep
across unrelated repos, other sessions' worktrees, and read-only evidence snapshots. Stage explicit
paths inside this repo.

This repo has worktrees under `.worktrees/` and `.claude/worktrees/`. Know which one you are on.
