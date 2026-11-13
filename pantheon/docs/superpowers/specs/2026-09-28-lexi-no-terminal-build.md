# LEXI no-terminal build pipeline — design spec

**Date:** 2026-09-28 · **Status:** Design approved in chat, pending written-spec review
**Author:** Claude Sonnet 5, this session

## 1. What this is

A bridge from LEXI's own interface to Pantheon's real multi-vendor build pipeline, so the user can
hand LEXI a written implementation document and talk to her, and she actually gets it built —
without the user running a terminal command at any point. Pantheon's build machinery
(`open-items-run.mjs`: intake → promote → plan → work → check → ship, real vendor API calls, a
different lab reviewing than the one that wrote the code, the controller executing acceptance
itself) already exists and is proven (544 tests, several real runs this session). What does not
exist is any way to reach it except a CLI invocation with a hand-written JSON ticket.

## 2. The user's words, verbatim

- "Let's finish LEXI in the Pantheon." / "LEXI into the Pantheon." / "Pantheon needs to be infused
  into LEXI" — three restatements of the same want, across several turns, before it was named
  plainly.
- "It should be a piece of her it doesn't need to interfere with her chat." — additive, not a
  rewire of LEXI's existing chat path.
- "No I just want her to be able to build what I want. Without dealing with the terminal." — the
  actual requirement, once stated directly.
- "I'll feed her .MD implementaions and talk to her." — the input is a written document plus
  conversation.
- "I don't write anything I have another model do it." — the `.md` itself may be authored by
  another model/tool; irrelevant to this design, since LEXI's side treats it as an opaque document
  regardless of its source.
- On approval flow, asked "she shows me, I say go" vs. "she just does it end-to-end" vs. "depends
  on the request": answered **"She just does it end-to-end."**
- On build scope, asked "LEXI herself only" vs. "LEXI + satellites" vs. "anything in ~/Projects":
  answered **"Anything in ~/Projects."**
- On whether Pantheon's own internal review/acceptance gate (a different vendor checks the code,
  the controller executes the real acceptance test — not the maker's own say-so) should survive
  "fully autonomous": **"Correct she has the same thing"** — the gate stays, and it is framed as a
  principle LEXI herself runs on, not a restriction bolted on underneath her.

## 3. Explicitly named risk, accepted as-is

"Anything in ~/Projects" plus "no approval step from the user" is real exposure: a bad build can
land in any project on this machine with nobody checking first *from the user's side*. This was
named once in chat and the user's answers did not change after hearing it. The mitigation this
design relies on is **not** a user-facing approval gate — it is Pantheon's own existing, proven
internal gate (§5), which the user explicitly confirmed should stay in force. There is no
additional repo allowlist or human checkpoint beyond that in this design; if a narrower scope is
wanted later, that is a scope change to bring back to this spec, not an implicit assumption.

## 4. Non-goals (out of scope for this spec)

- **The Codex/Claude session → LEXI knowledge-graph refactor.** Raised in the same conversation
  ("Let's have her refactor sessions from CODEX and Claude into her own knowledge graph"),
  clarified as a *future build target* ("During off time.") — i.e., it is intended to be the kind
  of thing fed to LEXI as a `.md` document *through this pipeline once it exists*, not a piece of
  this pipeline's own architecture. Its scope (which session transcripts, what "her own knowledge
  graph" means, real sensitivity given other tools'/sessions' content on a shared machine) is
  deliberately left for whoever drafts that future `.md`, not resolved here.
- Rewiring LEXI's existing chat path. This is additive only (§1, §2).
- A UI for browsing/managing past builds. Not asked for; add later if wanted.

## 5. Architecture

Three new components, reusing existing patterns rather than inventing new ones:

1. **Pantheon build API** — new, a sibling to the existing `src/view/server.mjs` HTTP server
   (Pantheon already runs a local HTTP service for its live view; this follows the same shape).
   Takes a ticket JSON (the same schema `scripts/tickets/*.json` already use — `key`, `repo_root`,
   `title`, `slot`, `path`, `copy`, `tests_file`, `acceptance_cmd`, `question`, `goal`,
   `constraints`, `forbidden`), runs the real pipeline, and streams progress. `open-items-run.mjs`'s
   current body is a CLI script with its logic inline; this work extracts that logic into an
   importable function both the existing CLI and the new HTTP endpoint call, so there are not two
   copies of the pipeline to keep in sync.
2. **LEXI backend endpoint** — new FastAPI route on LEXI's existing backend. Takes the fed `.md`
   content plus the surrounding conversation, makes a model call (reusing LEXI's own existing
   model-calling path — the same place `claude_model_tiers.py`, built earlier this session, already
   centralizes model selection) to draft a Pantheon ticket JSON from that input, POSTs it to
   Pantheon's build API, and relays the streamed progress back to the frontend.
3. **Companion frontend addition** — inside the existing `companion/` module (`CompanionApp`,
   already a separate surface from LEXI's main chat dashboard): a way to hand over the `.md`, talk
   about it, trigger the build, watch progress live, and see the final result. No new window, no
   CLI, and no change to the main chat interface.

## 6. Data flow

```
user hands LEXI a .md + talks (via companion)
  -> companion frontend -> LEXI backend endpoint
  -> LEXI's own model drafts a Pantheon ticket JSON from (.md + conversation)
  -> POST to Pantheon's build API
  -> Pantheon runs the real pipeline (scout -> plan -> work -> check -> ship)
       - real vendor API calls, same as every ticket run this session
       - a different lab reviews than the one that wrote the code (existing law, unchanged)
       - the controller executes the real acceptance command itself (existing law, unchanged)
  -> progress streamed back through LEXI's backend to the companion frontend
  -> final result: shipped, or NOT shipped with a stated reason (see §7)
```

## 7. The autonomy/gate distinction (the point the user confirmed)

"Fully autonomous" describes the user's own involvement: no separate approval prompt from them.
It does **not** describe Pantheon's internal behavior. Pantheon's existing gate — no seat grades
its own work, a different vendor must independently check it, the controller (not the maker, not
the reviewer's say-so) executes the real acceptance command — stays exactly as it is today. This
was demonstrated for real earlier this session: the `lexiModelConfig` ticket's implementer wrote
correct code that passed its real acceptance test, but the review stage hit a genuine integrity
check (a reviewer fallthrough whose recorded identity didn't match who actually reviewed it) and
correctly refused to ship — nothing was silently accepted, and nothing required the user to have
pre-approved anything for that refusal to happen correctly.

Under this design, that same outcome — code written, tests passed, but not shipped because
Pantheon's own gate didn't clear — is a normal, expected result, not a system failure. LEXI's job
in that case is to report it conversationally with the real reason (§8), not to report success, and
not to silently retry past the gate.

## 8. Error handling

- **Pipeline failure at any stage** (intake, plan, work, check): LEXI reports back in conversation
  what was attempted, what stage it failed at, and why — using the real message Pantheon's pipeline
  already produces (e.g. the exact "the review fell through to X but the critique seat is Y; a
  mislabelled verdict is worse than none" class of message), not a generic "something went wrong."
- **Ticket-drafting failure** (the `.md` + conversation don't resolve into a valid ticket — e.g. no
  clear single file/goal, or the request doesn't fit the ticket schema's one-file-change shape):
  LEXI says so and asks for clarification, the same way a planner would, rather than guessing and
  submitting a malformed ticket.
- **Nothing auto-retries past a failed gate.** A blocked run stays blocked; if the user wants
  another attempt, that is a new request, not an automatic retry loop.

## 9. Testing

- **Pantheon build API**: `node --test`, same harness as the rest of Pantheon. Covers: valid ticket
  → real run → streamed progress shape; invalid ticket → rejected before any vendor spend; the
  extracted shared pipeline function behaves identically whether called from the CLI or the API
  (a regression test comparing both entry points against the same fixture ticket).
- **LEXI backend endpoint**: `pytest`, isolated the same way `tests/test_models_config.py` already
  is (self-contained, no dependency on the full FastAPI/SQLModel/SQLCipher stack where avoidable).
  Covers: request shape validation, correct POST to Pantheon's build API, progress relay.
- **Ticket-drafting step**: not deterministic (it's a model call), so this gets a golden-example
  test instead of an exact-output assertion — given a known `.md` fixture, assert the drafted
  ticket has the required shape (`key`, `repo_root`, `slot`, `path`, `acceptance_cmd` all present
  and well-formed) rather than asserting its exact content.

## 10. Open items for the implementation plan

- Exact wire format for streamed progress from Pantheon's build API to LEXI's backend to the
  companion frontend (SSE, matching Pantheon's own view server's existing pattern, is the likely
  default — not decided here).
- Where `open-items-run.mjs`'s extracted shared function should live (`src/board/run.mjs`? kept in
  `scripts/` but exported?) — an implementation-plan-level decision, not an architectural one.
- Authentication/network exposure of Pantheon's new build API — it should stay loopback-only, same
  as `src/view/server.mjs`'s existing origin check, but this needs to be stated explicitly in the
  plan and tested, not assumed.
