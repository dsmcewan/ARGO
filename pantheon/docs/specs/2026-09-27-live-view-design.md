# Pantheon live view — design spec

**Date:** 2026-09-27 · **Status:** DRAFT, awaiting the user's review · **Author:** Claude Fable 5.1, this session
**Mockup:** [`docs/design/2026-09-27-live-view-mockup.html`](../design/2026-09-27-live-view-mockup.html) — three frames of one real run, rendered from recorded events. Open it with `?frame=live`, `?frame=shipped`, `?frame=refused`.
**Evidence:** every sentence the screen shows is a sentence the runner already writes (`scripts/open-items-run.mjs`, `scripts/overseer.mjs`); every number is a recorded field. Sources are cited inline as `file:line`.

---

## 0. One paragraph

The live view is a still camera on a dusk floor where the chairs of a run stand as blocks of antique glass: thick, faceted, translucent, bending the light that moves through them. The planner's block stands at the back, on top. The implementer's block stands in the middle, largest, and the workers are spaced around it: the two scouts to its left, the reviewer and the controller to its right. The controller's block has eight facets, one per gate of `ship()`: a passed gate lights its facet, a refused one stays dark with a bar. Each accepted revision is a plate of glass laid inside the implementer's block. The subagents are not blocks; they are light. A light leaves the planner's block with its brief, travels to a worker's block, explores that block's edges while the worker works, and returns up to the planner with the answer; its size follows the payload and its colour the lab. Two panels flank the picture: the left one lists the job, the right one lists the state, both in the runner's own words. Nothing on the screen is drawn that the backend did not record; when the backend is idle the blocks stand unlit and empty of names. Live is the primary mode; replay is the same renderer fed from a file.

## 1. The brief, in the user's words

- "I want that but for Pantheon. Light points representing agents traveling between boxes. Think Ancient Greece but Daft Punk is performing a set at 6pm."
- "The frontend represents the backend." / "Live-first, showpiece that expresses that."
- "Acropolis in Blade Runner soundtrack by daft punk."
- "Acropolis Tron. But not Lisa frank acropolis. Duskish and lights follow the seat turn, they illuminated the seams between bricks."
- "And the panels list the job."
- "Take inventory of what needs to / can be animated."
- "React, JS, State of the art UI."
- "I like the panels. Lets do translucent boxes of the orchestrators in front of the pantheon." / "we'll show the activity with light wisps" / "Varying in size and color."
- "Planner on top to subagents literally exploring the edges before returning." / "No subagent box. Then light is the subagents"
- "No buildings just translucent light bending antique glass boxes." / (a photograph of a faceted vintage glass block) "not cases like blocks" / "Top is the planner and then every thing is spaced around the implementer and spaced workers"

What that means for the design: low chroma, dusk not black; the precinct's own light is one colour, the wisps carry the labs' colours; light is the only thing that moves and it moves because a seat is working; the panels are records, not decoration; React 19 in plain JavaScript, no TypeScript; the UI is judged by current standards of rendering, accessibility and motion, not by the amount of chrome.

## 2. What this is not

- **Not a dashboard of cards.** The existing seats page (`src/view/app.html`) is a grid of per-seat panes for chatting with seats. It stays as it is, at its own path. This view watches a run.
- **Not a new transport.** The runner already appends `progress.jsonl` as it goes (`scripts/open-items-run.mjs:97`); the overseer already narrates it. The view reads the same file. Additions to it are additive fields and events, never renamed or removed ones.
- **Not a replay tool with a live mode bolted on.** Live is the design; replay reuses the live renderer with a clock.
- **Not a Greek-mythology namespace claim.** Building words in this document (gateway, hall, colonnade) describe the picture. Code identifiers are plain English (`gateway`, `hall`, `reviewHouse`, `gateColonnade`); no name from the reserved mythological namespace is used.

## 3. The mapping

| Backend fact (source) | On the screen |
|---|---|
| A run starts (`run.start`) | The blocks take their occupants' names; the header shows the board name and "Live" |
| A chair and its occupant (`run.start.chairs`, `chair`, `reseat`; §7 A1) | A glass block: the planner's at the back on top, the implementer's in the middle, the two scouts to its left, the reviewer and the controller to its right. Under each block, the role and the occupant as the runner names it (`vendor/model`). A reseat rewrites the occupant and leaves a note. The block's rim carries its lab's colour |
| Brief sent (`turn.start`, `detail` = "purpose, N chars of prompt") | A light leaves the planner's block on an arc to the worker's block; its size follows log(N); its colour is the seat's lab |
| Subagent working (`turn.start` … `turn.done`, `turn.progress` with `thinking_bytes` §7 A5) | The light explores the edges of its block: it runs the rim and the facet edges, brightest at its head, its trail cooling behind it; the head's glow follows the thinking bytes. The Antigravity reviewer's `subagent.start`/`subagent.done` split a smaller light off the reviewer's that rejoins it |
| Answer returned (`turn.done`, `detail` = "N chars…") | The light returns up the arc to the planner's block and is absorbed; size follows log(N) |
| Board written (`wrote`, `board.commit` §7 A2) | The writing block flares along its edges; a `wrote` lays a plate of glass inside the implementer's block (rev 1, 2, 3 stack upward) |
| Lease (`lease.taken`, `lease.released` §7 A3) | The implementer's block glows from within while the lease is held |
| Acceptance (`acceptance.start`, `acceptance.done` §7 A4) | A chalk light runs from the controller's block to the implementer's and back; the caption and the right panel say the result; the newest plate brightens on a pass |
| Verdict (`verdict`) | The reviewer's light returns to the planner in its lab colour; the word itself is in the right panel and inside the reviewer's block |
| Ship (`stage.start ship`, eight `gate` events, `ship`) | The controller's eight facets light in `GATES` order (`src/board/integrate.mjs:27`); a passed gate lights its facet, a refused gate stays dark with a bar across it; a shipped run leaves the block lit amber |
| Silence (no event for ≥ the overseer's stall threshold) | The light stops and dims; the caption is the overseer's stall warning |
| Idle board (no run) | Unlit blocks with no names, the idle copy |

## 4. Visual system

**Colour.** Six named values, and one semantic pair.

| token | hex | role |
|---|---|---|
| dusk | `#141A2E` | page and sky top: a blue-slate dusk, deliberately not black |
| stone | `#2A2E3E` | building bodies in shadow |
| marble | `#A0A4B2` | secondary text, stage names |
| chalk | `#E8E4DA` | primary text: marble dust, not white |
| lamp | `#DDB275` | the one light. Sodium amber, low chroma. Seams light in this colour and no other |
| afterglow | `#6E4A5C` | the horizon band the silhouettes stand against |
| refuse / refuse-ink | `#7A3B44` / `#D2848C` | the only second hue, used only for a refused gate |

Why amber and not cyan for the precinct: Tron's cyan on black is the default a generator reaches for. The brief says dusk, Blade Runner and the acropolis; sodium lamps against a plum sky are that picture.

**Lab hues.** The lights, and each block's rim, carry the colour of the lab that produced the activity, because the lab is the one axis Pantheon's laws care about (law 3: the checker's lab differs from the maker's). Four dusty hues, none saturated, so the scene stays dusk and never a rainbow:

| lab | hex | |
|---|---|---|
| anthropic | `#DDB275` | the lamp itself |
| openai | `#8FAFC9` | steel |
| google (and the agy seat) | `#8FB5A0` | sage |
| xai | `#B39AC4` | mauve |
| the controller | `#E8E4DA` | chalk |

**Type.** One family, Bahnschrift (a DIN), with `font-stretch` narrowing it for data, timestamps and the gate inscriptions and full width for reading. Fallbacks are explicit because the view is local and zero-dependency: `"Liberation Sans Narrow", "Arial Narrow"` for the condensed role, `"Segoe UI", system-ui, "Liberation Sans"` for reading. Monospace only where the string is code: a path, a command, a hash. Scale: 12 / 13.5 / 15 / 19 / 24 / 32, body 15/1.5, lines under 80 characters.

The eight gate names are set in capitals because the code names them so and because they are inscriptions on the colonnade. Every other label is sentence case. No eyebrow labels, no numbered markers, no middle-dot metadata strings.

**Layout.** Three columns on a wide screen: the job (320 px), the precinct (fluid), the state (320 px). Text left-aligned; the precinct centred on a low horizon; the stage timeline and the caption under the picture. Below 1100 px the columns stack: picture, then job, then state. No cards, no boxes; a rule appears only between rows of a list.

**Motion.** Only light moves. A light travels its arc in about 1.2 s, drifting off course on the way on a noise-driven wander that vanishes at both ends, so it arrives exactly where it aimed; while its subagent works it orbits the block on a Kepler ellipse with the block at the focus, fastest at its closest pass and slowest at its farthest, precessing so no loop retraces, leaving a trail that cools over about ten seconds; it returns up the arc when the answer lands. Its glow falls off with distance by the Frostbite windowed inverse square, reaching zero with zero slope, and the glass picks up that glow along its rim where the light passes. The blocks do not move. The eight facets light in gate order at ship, which is the one orchestrated moment. The formulas and their sources are in `docs/plans/2026-09-28-live-view-section-3a-light-physics.md`. The eight columns light in gate order at ship, which is the one orchestrated moment. `prefers-reduced-motion` replaces travel with a fade in place and keeps every state change.

**Principles.** Light is the only bright thing, and every light is a subagent's turn. Idle looks idle. Every word is a runner sentence, so the screen and the log never disagree. The future is not drawn: a live timeline shows the stages that have happened at their recorded length, the running one growing, and the remaining ones as names with no width.

## 5. The screen

**Header.** "Pantheon", the board directory name in monospace, then the status word with its dot (Live / Shipped / Refused / Idle / Stalled) and the elapsed clock in condensed figures. Nothing else.

**Left panel, the job.** The ticket title as the heading, the key under it, then two facts: *Changes* (the slot path) and *Acceptance* (the command). Then **Chairs**: one row per role — scout, scout, planner, implementer, reviewer, controller — with the seat as the runner names it (`vendor/model`) and a note for a reseat or a lab ("another lab"; "acceptance and the gates" for the controller). The active chair's seat is in lamp. Then **Turns**: the overseer's sentences, one per row, stamped with the overseer's own `fmt` (`5s`, `1m02s`) in a right-aligned condensed column.

**Centre.** Two canvases in one frame: the glass (the six blocks, their facets, plates and rims, drawn from a pure geometry) and the light over it. The names under the blocks are real text (React elements positioned in the glass canvas's coordinate space), so a screen reader and a search find them. Under the picture, the stage timeline (§4 Principles), then the caption: the overseer's latest sentence, verbatim, centred, in an `aria-live="polite"` region. Under the caption, one line of legend: a dot in each lab's hue and the lab's name, so a first-time viewer can read the lights without asking. Each block is drawn as a faceted prism in slight perspective: its back facets first, dim, then its top face, then its front facets, with the glass tinted pale green like old glass and the edges catching light; a wavy refraction (a displaced highlight) inside each block reads as antique, not modern, glass.

**Right panel, the state.** The current stage name large, and under it the stage's own `detail` string ("another lab acks the bytes"). Three facts: *Revision* ("1 of up to 3"), *Acceptance* ("passed. 525 passed, 0 failed" / "failed (exit 1). 523 passed, 2 failed"), *Verdict* ("waiting on the reviewer" / `approve` / `request_changes`). Then **Gates**: eight rows in `GATES` order, name and state, where a refused gate's state is the gate's own `why` string.

**Copy rules** (from the ux-copy pass). Same term everywhere: stage, rev, acceptance, verdict, gate, ship, reseat, chair, seat. Sentence case. Active voice. A state never apologises. The only string the view rewrites is the acceptance result: the runner records node's reporter fragments (`ℹ pass 525, ℹ fail 0`, `scripts/open-items-run.mjs:436`); the view says "525 passed, 0 failed". That rewrite is made honest by §7 A4, which records the two numbers as fields.

Idle copy: "No run on the board. The precinct stays dark until one starts. Start one with `node scripts/open-items-run.mjs --ticket scripts/tickets/<ticket>.json`." Stall copy is the overseer's own warning. Reconnect copy is the bus's own gap message ("history truncated: N earlier event(s) dropped", `src/view/bus.mjs`).

## 6. States

| state | trigger | screen |
|---|---|---|
| idle | no `run.start` seen, or the last event is `run.end`/`run.error` older than the stall threshold and no newer file | dark precinct, idle copy, no clock |
| live | a `run.start` with no `run.end` | light walking, clock running |
| stalled | live, and no event for ≥ 60 s (the overseer's STALL) | light frozen and dimmed to 40 %, status word "Stalled", caption is the overseer warning |
| shipped | `ship` with `shipped` in detail | eight columns lit, status "Shipped", door dark |
| refused | `ship` with `refused` | refused columns dark with a bar, status "Refused" |
| died | `run.error` | status "Failed", the caption is the `run.error` detail |
| replay | `?replay=<recorded file>` | identical rendering driven by a scrubber; status word "Replay" |
| reconnecting | SSE dropped | header dot hollow, caption unchanged; the bus gap message if events were missed |

## 7. Data contract

**Existing events, unchanged:** `run.start, stage.start, turn.start, turn.progress, turn.done, turn.error, reseat, wait, wrote, acceptance.start, acceptance.done, revise, reask, verdict, gate, ship, resumed, run.end, run.error` plus the Antigravity seat's `seat.start, tool.start, tool.done, tool.error, subagent.start, subagent.done, turn.text`. Every row already carries `at, elapsed_s, stage` (`scripts/open-items-run.mjs:98`).

**Additive changes (A1–A6).** Each is a new field on an existing event or a new event type; none renames, removes or retypes anything.

- **A1** `run.start` gains `board` (the board directory), `ticket: { key, title, slot, path, acceptance_cmd }` and `chairs: [{ role, vendor, model, lab, override }]` — the roster as resolved at start (`OVERRIDES` and the chain's assignments, `scripts/open-items-run.mjs:51,272,340,377`); and a new event `chair { role, vendor, model, lab, why }` is emitted each time a chair is actually occupied (the two scouts, the planner, the implementer, the reviewer as paired at `:503`), because the reviewer is paired after the work stage and a roster written at start can be overtaken.
- **A2** new event `board.commit { ref, commit, author, detail }` emitted after every `publish()` and after `ship()` (`scripts/open-items-run.mjs:315,332,356,424,439,451,545,559`), `commit` being the short cid.
- **A3** new events `lease.taken { resource, gen, holder }` and `lease.released { resource, gen, holder }` at the two lease sites (`scripts/open-items-run.mjs:384,456`).
- **A4** `acceptance.done` gains `pass` and `fail` numbers parsed from the same reporter output it already summarises (`:436`); `detail` is unchanged.
- **A5** `turn.progress` gains `thinking_bytes`, accumulated from the `thinking` events that `streamTurn` already emits (`src/sdk/stream.mjs`), on the same 10-second throttle as `chars`.
- **A6** `verdict` gains `model`.

**Two hard requirements.**
1. *Additive only, proven.* A test replays every recorded `progress.jsonl` under `outputs/open-items/` through the overseer's line formatter before and after the change and asserts the output is byte-identical; a second test adds A1–A6 fields to those rows and asserts the formatter's output is still byte-identical. The formatter is extracted from `scripts/overseer.mjs` into an importable module for this purpose; the overseer's behaviour does not change.
2. *Recorded runs still render.* The view's reducer accepts every recorded file (no A1–A6 present) and renders it in replay with the chair roster and ticket fields shown as "not recorded".

**Validator.** `src/view/progress-contract.mjs` recognises rows by structure (an object with `at`, `elapsed_s`, `event`), classifies every event type it knows, and reports every one it does not as `unknown`, never silently. It is the oracle for the runner wiring: after the first live run on the new runner, `node scripts/check-progress.mjs outputs/open-items/<key>/progress.jsonl` must report A1–A6 present and zero `unknown`.

## 8. Architecture

```
scripts/open-items-run.mjs ──appends──▶ outputs/open-items/<key>/progress.jsonl
                                              │ tail (poll 250 ms + fs.watch)
                              src/view/run-feed.mjs ──publish──▶ createBus()  (src/view/bus.mjs, unchanged)
                                              │                        │
                       GET /run  (snapshot: reduceRun(bus.snapshot()))  GET /run/events (SSE, Last-Event-ID, same headers as /events)
                       GET /runs (recorded files for replay)            GET /live (the page)
                                              │
                        browser: src/view/live.html  →  src/view/ui/app.js (React 19, esm.sh import map pinned from package.json)
                          useRunStore (useSyncExternalStore over EventSource or a replay clock)
                          reduceRun  (src/view/run-state.mjs, pure, shared with the server)
                          glass geometry: blocks, facets, rims, plates (src/view/ui/glass.mjs, pure)
                          lights (src/view/ui/lights.mjs, pure: state + clock → every light alive now: phase, position, size, hue)
                          Stage component: canvas (glass) under the name labels (React) under a canvas (lights); one requestAnimationFrame loop
                          JobPanel, StatePanel, Timeline, Caption, Header: plain React components rendered from the reduced state
```

- **Server.** `createViewServer` gains `runFile` (path or `null`) and `runsDir` options and three routes. The origin, Host and subscriber-cap policies of `/events` apply unchanged to `/run/events`. The tailer reads the file from byte 0 on start, so a late-opened view sees the whole run; it re-opens on truncation or replacement (a new run in the same directory), exactly as the overseer does (`scripts/overseer.mjs:61`).
- **Store.** `reduceRun(rows) → state` is a pure fold used by the server for `/run` and by the browser for live and replay. State shape: `{ status, ticket, chairs, stage, rev, acceptance, verdict, gates, ship, turns, lease, commits, spans, latestLine, elapsed_s, light: { building, since, thinkingBytes } }`. Unknown events are counted, not thrown on.
- **Geometry.** `glass.mjs` builds the six blocks once from a table of `{ id, cx, top, R, H, sides }` (six sides for the seats, eight for the controller) in a 960 by 520 space with a perspective squash of 0.42 on the top face, and derives from each block its top polygon, its facets in back-to-front order, its rim path (the edges a light explores) and its plate positions. `glassState(state) → { facets: gate → 0..1 | refused, plates: n, lit: id → 0..1 }` is pure and reads the reduced state only.
- **Lights.** `lights.mjs` is pure, and draws its motion from `light-physics.mjs` (seeded simplex noise, a curl field, the wavering flight path, the Kepler orbit, the attenuation curves): given the reduced state and the clock it returns every light alive at that instant, each `{ seat, hue, phase, x, y, size, glow, trail }` where `phase` is one of `out` (on the arc from the planner's block to the worker's block), `exploring` (running the block's rim and facet edges, with a trail of recent positions), `back` (on the arc to the planner's block) or `gone`. A turn.start begins `out`; `exploring` runs from arrival until the turn.done row; `back` runs 1.2 s after it; size is log of the payload bytes; glow follows the thinking bytes; a `subagent.start` spawns a smaller light of the same hue that rejoins at `subagent.done`. Nothing is remembered between frames: the function is evaluated from the clock, which is what makes replay free.
- **Renderer.** Canvas 2D, two canvases, one animation frame loop. The glass canvas draws the unlit blocks once into an offscreen canvas at load (they never change), then per frame only what changed: lit facets, plates, the inner glow of a leased block, the rim colour. The light canvas draws each light as a blurred disc with a bright core and its trail as fading discs, additive. No per-frame allocation; arrays are built once. Budget: under 3 ms per frame for both canvases at 1600 px on the operator's machine, measured by the plan's perf task. WebGL is not needed for six prisms and a few hundred discs; both renderers sit behind pure functions, so that decision can change without touching state.
- **React.** React 19, plain JavaScript modules, `React.createElement` through a local `h` as the seats page already does (`src/view/app.html:50`). The import map is written by the server from the version pinned in `package.json`, so the browser and the tests use the same React. Components are functions of the reduced state and are tested with `react-dom/server`'s `renderToStaticMarkup` under `node --test`.
- **Replay.** `?replay=<file>` loads the recorded rows via `/runs/<name>`, and a scrubber (a range input, keyboard-operable) sets the clock; the store folds rows with `elapsed_s ≤ clock` through the same reducer. The precinct animates between scrubber positions because `lightState` takes the clock.

## 9. Quality floor

- Contrast: chalk on dusk ≥ 12:1, marble on dusk ≥ 6:1, lamp on dusk ≥ 8:1, refuse-ink on dusk ≥ 5:1 (computed in the plan's a11y test with the WCAG formula, not eyeballed).
- The caption is a polite live region; the status word is a status role; every stat has a text form; the scrubber is a labelled range input; visible focus everywhere focus can land.
- `prefers-reduced-motion: reduce` stops the walk and the decay animation; state still changes.
- Responsive to 360 px wide; no horizontal scroll.
- The page loads React from esm.sh, so it needs the network once; this is the existing pattern of the seats page and is recorded as a known limitation. Vendoring is out of scope.
- No credential, prompt text or conversation content is ever rendered: the view reads `progress.jsonl`, which carries counts and names only.

## 10. Build split

Execution method, per the user: **Pantheon builds it.** Each single-file deliverable becomes a ticket under `scripts/tickets/` with a human-written oracle test committed first and baselined failing, following `scripts/tickets/README.md`. Work that is not a single file, or cannot be judged by `node --test` alone, is done by hand and verified by an executed check.

| deliverable | how | oracle |
|---|---|---|
| `src/view/run-state.mjs` reduceRun | ticket | fixture replays of two recorded runs → expected state |
| `src/view/progress-contract.mjs` validator + event constructors | ticket | classification of every recorded file; A1–A6 detection |
| `scripts/lib/overseer-format.mjs` extraction | by hand (moves code) | byte-identical formatting on every recorded file |
| runner wiring A1–A6 | ticket (one file) | full suite + validator on the next live run |
| `src/view/ui/glass.mjs` blocks, facets, rims, plates | ticket | six blocks, eight facets on the controller's, rim length positive, plates equal to revisions, idle unlit |
| `src/view/run-feed.mjs` tailer | ticket | temp-file append/truncate/replace cases |
| `src/view/server.mjs` routes | ticket | mirrors `tests/view-events.test.mjs` and `view-security.test.mjs` for the new routes |
| `src/view/ui/lights.mjs` lights from state and clock | ticket | phases per recorded frame; none when idle; size monotone in bytes; a light is on its block's rim while exploring |
| `src/view/ui/*.js` components, `live.html` | by hand, then reviewed by the seats | `renderToStaticMarkup` of each frame state contains the recorded strings; every block's label carries role and occupant |
| replay scrubber, a11y, perf measurement | by hand | perf task's measured ms per frame; contrast test |
| docs and STATE | by hand | `graph-check` still green; README runbook |

The whole is accepted when: the speed-run ticket (`scripts/tickets/open-item-streaming-thinking.json`) runs again on the new runner with the view open and a screenshot of the live frame is recorded; the validator reports A1–A6 and zero unknown on that run; every recorded run replays; the compat test is green.

## 11. Open questions and out of scope

- **Naming.** "live view" is the working name; the page is `/live`. The user may want a name. No mythological name is proposed.
- **`src/view/agora.html`** is an uncommitted canvas sketch written before the design gate. It is not the proposal. Fold or delete on the user's word; the plan deletes it.
- **Pending evidence.** Five read-only agents were dispatched for: the view server surface, additive-event compatibility, the animatable-state inventory, the Canvas 2D vs WebGL threshold, and seam-lit rendering technique. None had reported when this spec was written. The decisions they bear on (§8 renderer, §7 requirement 1) are stated as rulings with the test that would overturn them.
- **Out of scope.** Vendoring React; sound; camera movement; editing anything from the view.
