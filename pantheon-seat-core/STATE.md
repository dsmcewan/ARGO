# Pantheon — state as of 2026-09-27

Branch `seat-core`. 234 tests green, working tree clean, nothing uncommitted.

## What this is

A supervised multi-vendor AI seat harness. A **seat** is a durable identity (`vendor + purpose +
cwd`), not a process. Each turn is a fresh call whose continuity is **proven**, not assumed.

Transport is **vendor SDKs**, superseding the original CLI design (see the decision reversal at
the end of `docs/specs/2026-09-27-pantheon-design.md`). That change deleted the project's hardest
subsystem: with CLI transport the conversation lived in a vendor-owned file we had to locate and
parse, which is where defects C1, C2, C3 and the two silent zero-turn projectors all came from.

## Verified live, and how

Every claim below was executed against real vendors, not inferred. Re-run any of them.

| what | command | evidence it cannot fake |
|---|---|---|
| continuity, all 4 seats | `node scripts/live-check.mjs <vendor> [model]` | turn 1 plants a random codeword, turn 2 must recall it |
| incremental streaming | `node scripts/stream-check.mjs <vendor>` | deltas must land at multiple distinct timestamps |
| live view end to end | `node scripts/view-check.mjs openai,google` | deltas must reach the SSE client BEFORE `/turn` returns |
| multi-turn + cross review | `node scripts/demo.mjs` | per-seat private tokens; no seat may see another's |
| layered swarm | `node scripts/swarm-run.mjs "question"` | wall clock must equal the slowest seat, not the sum |
| delegation + execution oracle | `node scripts/delegate-run.mjs` | generated code is RUN; no model grades it |
| seat lock | `node --test tests/seat-lock.test.mjs` | four real processes; enter/exit markers must pair |
| routing | `node --test tests/route-router.test.mjs` | refuses any need it cannot justify from measured facts |
| discussion | `node scripts/discuss-run.mjs "q" [--adversarial\|--selfish]` | no seat sees a peer's SAME-round turn; movement must be declared |

Seats, all confirmed by codeword recall:

| seat | model used | continuity | credential |
|---|---|---|---|
| openai | `gpt-6-luna` | server **or replay** (toggle) | `OPENAI_API_KEY` |
| xai | `grok-4.6` | server **or replay** (toggle) | `XAI_API_KEY` |
| google | `gemini-3.5-flash` | replay (local history) | `GEMINI_API_KEY` |
| anthropic | `claude-haiku-4-5-20251001` | replay (local history) | **subscription OAuth** |

Measured swarm concurrency: efficiency **1.00** on all three layers — wall clock equalled the
slowest seat within 68ms / 4ms / 4ms, against sequential times of 25.3s / 31.1s / 4.5s.

## Run it

```bash
source ~/Projects/agentic-pipeline/sdk/keys-from-windows.sh     # loads keys into this shell only
node bin/pantheon-view.mjs 7777                                  # http://127.0.0.1:7777, loopback only
node scripts/swarm-run.mjs "your question"
```

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

## Open, and honestly so

1. **`agy` has no adapter.** Antigravity carries Gemini, Opus 4.6 and GPT-OSS on one
   subscription; its SDK is Python and its CLI emits `--output-format stream-json`. Its store was
   located empirically at `~/.gemini/antigravity-cli/conversations/<id>.db` (SQLite), which the
   vendor does not document.
2. **Replay hazard (evidence §U1, CONFIRMED).** History is written before the seat record, so a
   crash between them replays an exchange — harmless for text, not harmless for a non-idempotent
   tool call. Needs a commit marker, not a reorder.
3. ~~**Lost update (§U2)**~~ — **CLOSED.** `src/seat/lock.mjs` serialises the whole seat
   read-modify-write, including the model call, across processes. Proven by a real four-process
   race, and mutation-checked: with a no-op lock the same test interleaves 4 times. The fix was
   produced by delegation (Claude planned, gpt-6-sol wrote it, an execution oracle judged it)
   and then rewritten here rather than pasted — the generated version passed the probe but
   would have stolen a lock from a LIVE owner once it aged past staleMs, breaking exactly the
   long turns it protects.
4. **The swarm does not produce independent corroboration (evidence §V).** Layer-2 reviewers are
   anchored by the answer they are handed, and the default synthesizer is a participant. It
   demonstrates concurrency and produces real critique; it must not be counted as N confirmations.
5. **The multi-seat premise is still unproven for DOING work.** The 2026-09-27 paired eval
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
