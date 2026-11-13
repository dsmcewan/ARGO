# Pantheon: Dead Reckoning — proposed UI design

Status: proposed for review; implementation has not started.
Baseline inspected: Pantheon commit 3837eda, with existing untracked UI drafts.
Reference: the user's 19670.jpg, showing a moonlit gallows, role figures, orbiting wisps, and operational labels.

## Purpose and assumptions

Build a usable live orchestration view whose visual language is dark corporate satire. Governance, accountability, journeys, transitions, and reorganization are operational concepts expressed through the scene. The operator must be able to determine what is happening, which artifact and revision are involved, who acted, what evidence supports the outcome, and where work returned for correction.

Working decision for this proposal: the gallows concept is the main direction for a new /live view. The existing seats page remains the place to converse with seats. The unapproved glass-block draft and its mockup remain intact. This proposal does not treat either draft as an approved implementation contract.

The first release is an interactive observer: selection, inspection, filtering, and replay work locally. Starting, stopping, approving, or reseating a worker requires a separate, verified command interface and is outside this release. Human authority is visible through recorded instructions and decisions; the picture grants no authority. The OpenAI Babysitter is not installed by this work.

## What exists today

- src/view/server.mjs serves the seat page, /seats, /board, /events, and POST /turn. Its origin checks, subscriber limits, and streamed-event behavior are existing infrastructure.
- src/view/app.html uses React 18.3.1 and React DOM 18.3.1 through esm.sh. React 19 is mentioned in a separate draft, but is not a current package dependency.
- src/view/bus.mjs provides sequence numbers, bounded replay, and explicit gap notifications for seat events.
- scripts/open-items-run.mjs writes progress.jsonl and run.json. Run outcomes, reviews, acceptance commands, and the shipping gates are already recorded.
- scripts/agy-seat.py also writes progress rows. Its turn and subagent activity must be correlated with its parent invocation, rather than counted as unrelated workers.
- The recorded agySeat progress file contains three run.start records: one filename is not necessarily one run.
- The runner emits ship for both successful and refused shipping attempts. run.end alone does not prove successful shipping.
- docs/runs/graph/2026-09-27-build.jsonl is historical graph data using a t discriminator, including approximate timestamps. It is a different schema from live progress events.

## The screen

At desktop size, use three columns: a 300 px job panel, a flexible scene, and a 340 px inspector. A timeline spans the scene's lower edge. Under 1100 px, stack scene, job, and inspector; retain keyboard navigation and readable details down to 360 px.

The central scene retains the reference's dark wood, stone, fog, hooded silhouettes, cyan and magenta motion, and cold moonlight. Figures are role anchors. Their labels show the actual role and current occupant; no role is invented to fill a decorative position. In the current open-item workflow, the layout supports two scouts, planner, implementer, reviewer, and the controller. The controller is visibly labeled as code, not counted as a model agent.

Worker activity uses cyan wisps; critique activity uses magenta; external oversight uses icy blue only when a connected source records that activity. Provider identity is conveyed with a badge and text, so color is not overloaded with two meanings. Solid figures represent roles, larger wisps represent parent turns, and smaller wisps represent recorded child invocations. Counts distinguish active turns, completed turns, known child invocations, and unknown coverage.

Wisp motion decision, 2026-09-28: adapt [Aether's existing attraction and curl-noise motion](https://github.com/mikeascendx/aether/blob/main/js/field.js). Replace the cursor attraction point with the assigned scene object's center. Each wisp has its own target object, such as its role or current task destination; it flutters toward and around that anchor. A recorded transition changes the target. Resolve both positions in scene coordinates so resizing does not change the relationship. Cursor movement continues to support selection without redirecting these agent journeys. Preserve the MIT notice for any reused source. Deterministic timing, reduced motion, and recorded-state rules still apply.

The left panel shows the ticket, artifact path, acceptance command, current revision, run identity, and stage. The right inspector shows the selected entity's actual state, provider/model, parent, activity records, artifact references, acceptance result, review verdict, and relevant gate decisions. Text is selectable and rendered as text, including content that resembles HTML.

## Governance and accountability

Display the eight shipping gates in their source order: ACTOR, TARGET, TICKET, GRAFT, LEASE, REVIEW, TESTS, MERGE. Each has a recorded status, reason, and source-event reference. A reviewer approval is distinct from acceptance execution, and both are distinct from shipping.

An artifact view connects a revision to its producing turn, acceptance receipt, review, and shipping result where those links were recorded. Missing links display Not recorded. The operator can inspect a correction and the later revision that addresses it without losing the earlier attempt.

The visual may use theatrical captions, but each caption has an adjacent literal state. For example: Organizational realignment — reviewer reseated from A to B. The operator must never need to decode a joke to discover a failure or determine whether an action occurred.

## Journeys, transitions, and reorganization

| Recorded condition | Scene behavior | Literal detail |
|---|---|---|
| turn.start | A wisp travels from its recorded parent or an explicitly unassigned origin to its role | Turn started |
| turn.progress | The active trail brightens within a fixed range | Observed progress; last-event time |
| tool.start / tool.done | A small pulse near the owning wisp | Tool name and result category, without raw arguments |
| subagent.start / subagent.done | A smaller wisp separates and returns, linked by identity | Child invocation and parent |
| turn.done | The wisp returns to its recorded destination or settles at its role | Answer returned; this is not acceptance |
| turn.error | The trail stops with a visible failure mark | Transport or turn failure, as recorded |
| revise or request_changes | The journey loops back to the implementation step | Correction requested; current revision |
| chair replacement | The old occupant becomes a historical outline and the new occupant takes the same role | Previous and new occupant, reason, source |
| gate refusal | That gate remains visibly closed | Recorded refusal reason |
| ship with ok=true | The gate sequence settles into a completed state | Shipped, with recorded commit |
| ship with ok=false | The sequence stops without a success flourish | Refused |
| connection lost / old activity | Motion pauses; a connection-age label stays visible | Disconnected or no recent progress; never presumed dead |

Reorganization is a visual treatment of a recorded change, not a new backend operation. A mere reseat attempt does not prove that a replacement took the chair. Actual role absorption is displayed only if an event identifies the source role, destination role, reason, and affected work; the current runner has no such event. Role absorption is consequently not fabricated or implemented as a control in release one.

Replay exposes play, pause, seek, speed, and return-to-live. It uses the same state reducer and visual projection as live mode. Rewinding removes later outcomes and later occupants from the displayed state. Live activity continues to be received while the operator inspects history; a new-events count offers a deliberate return to live.

The build graph is available as a separate History source. Preserve node and edge types, correction relationships, commit references, and timestamp precision. Approximate historical times remain labeled approximate. Do not interleave the build graph with live worker activity as if they shared an execution clock.

## Four components

1. Recorded state: a normalizer and pure reducer for progress events, plus a separate historical-graph adapter.
2. Run feed: incremental file ingestion, snapshots, and server-sent events, with explicit identities and gap recovery.
3. Scene and inspector: React DOM controls and text over an SVG scene with a Canvas wisp layer.
4. Journey clock: deterministic live/replay timing and chronological lineage selection.

The scene receives view models. It does not call a provider, run an acceptance command, or make a shipping decision.

## Constraints

- Node >=20; JavaScript ESM; React and React DOM pinned to 18.3.1 for this slice.
- No new production dependency, WebGL engine, build system, or provider API integration.
- Use the existing loopback origin protections and subscriber limits for every new route.
- Live and replay share one reducer and one visual projection.
- All state-changing visual effects derive from recorded events; decorative fog never signifies progress.
- Preserve event ordering, source offsets, run boundaries, old attempts, and explicit missing evidence.
- Every opaque run/history identifier resolves through a server-owned registry; clients cannot request arbitrary filesystem paths.
- Stream an allowlisted display projection. Do not expose prompt bodies, raw tool arguments, environment variables, or credentials.
- With reduced motion, all information remains visible and travel becomes an immediate state change.
- Provide a visible text equivalent, keyboard focus, and a non-color status indicator for every meaningful scene object.
- The current esm.sh-based React setup requires initial network access; this proposal does not claim offline availability.

## Acceptance

1. The recorded AGY file exposes its three run segments independently, with each segment's own result.
2. Successful shipping, refused shipping, review rejection, a transport failure, and a replacement occupant are visibly different and supported by fixture evidence.
3. One parent call with nested Antigravity lifecycle events counts as one parent, with explicitly identified children.
4. A reconnect neither duplicates a journey nor loses state silently; a history gap restores a consistent snapshot.
5. Selecting a figure, wisp, gate, or revision shows its recorded evidence and missing fields.
6. Replaying the same segment at the same timestamp produces the same scene; backward seeking cannot retain future state.
7. History renders the build graph's correction edges and approximate timestamps without asserting live activity.
8. The scene works at 360 px, with keyboard-only interaction and reduced motion; the reference styling remains recognizable at desktop size.
9. Target p95 frame time <=16.7 ms on the operator's machine at 1600x900 with 200 synthetic display entities. This is a measured target, not a performance claim; density is reduced if the target fails.
10. Final evidence includes test output and labeled screenshots of live, refused, disconnected, and replay states. A synthetic live fixture is labeled synthetic; real provider execution is not required for UI acceptance.

## Delivery boundary

Deliver the new observer view, real progress ingestion, inspectable journeys, and historical graph access. A later control feature must define an acknowledged command/result protocol before adding operational pause, approve, cancel, or reseat buttons. A later external OpenAI supervisor may contribute its own typed findings; release one simply reports that no supervisor is connected.
