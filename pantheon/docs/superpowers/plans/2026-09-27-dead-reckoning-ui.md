# Dead Reckoning UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for native implementation, or superpowers:subagent-driven-development if that execution method is selected. Steps use checkbox syntax for tracking. Read the companion design before implementing any task.

**Goal:** Deliver a functioning gallows-themed Pantheon observer with live orchestration, inspectable governance and accountability, agent journeys, recorded seat changes, and replay.

**Architecture:** Four components: recorded state, a run feed, the scene and inspector, and a journey clock. Existing progress files feed one deterministic state model; live and replay use the same rendering path. The historical build graph has its own adapter and source selector.

**Tech Stack:** Node >=20, JavaScript ESM, React 18.3.1, React DOM 18.3.1, SVG, Canvas 2D, server-sent events, node:test, Python 3 standard library for the Antigravity progress helper. No new production dependency.

**Spec:** [Dead Reckoning proposed design](../specs/2026-09-27-dead-reckoning-ui-design.md).

**Section Two:** [Detailed live tail, replay, camera, and showcase plan](2026-09-28-dead-reckoning-ui-section-two.md) expands Tasks 3–5 and the recording checks in Task 6. It adds retained capture generations and a shared camera transform while preserving this plan's normalized event contracts.

**Status:** Concrete proposal ready for review. No product code has been changed or test result claimed by writing this plan. Baseline inspected: 3837eda. The scene is proposed as the new /live direction; existing drafts remain preserved.

## The user experience

Open /live and select the current run. The job is on the left; the moonlit gallows and moving agents occupy the center; selected evidence appears on the right. Select a figure to see its occupant and work, a wisp to see a turn or child invocation, a gate to see its decision, or a revision to trace production through review and shipping. Use the timeline to replay a journey, or switch to History to inspect the build graph.

The satire is in the scene and captions. Literal status remains beside it. Reorganization animates an actual occupant replacement; a failed seat attempt alone cannot trigger that animation. The scene shows no fabricated supervisor and no decorative agent counts.

## Global constraints

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

Do not delete or rewrite the untracked glass-block draft, mockup, agora sketch, or Babysitter card. At execution start, recheck the working tree and account for concurrent work. Use a suitable isolated checkout if another active task owns these surfaces. Commit only files belonging to a completed task after its checks pass.

## Review focus

1. One progress file contains several launches, and nested producers use different elapsed clocks: segmentation and timing must remain correct. Task 1.
2. A ship event can mean refusal, and run.end can follow a failed attempt: the page must not announce success based on event names. Tasks 1 and 4.
3. A file may be replaced with equal or greater size, or a client may reconnect beyond the replay buffer: restore a coherent snapshot without duplicate work. Task 3.
4. A nested provider lifecycle can duplicate its parent's apparent start/done, while child events lack usable identity: counts must show uncertainty. Tasks 1 and 2.
5. The operator seeks backward while new events arrive, and event text can contain HTML: future state must disappear from replay, selection must remain safe, and text must stay inert. Tasks 4 and 5.

## File map and responsibilities

Paths below are relative to /home/colchis/Projects/pantheon.

| Component | Create | Modify |
|---|---|---|
| Recorded state | src/view/progress-contract.mjs; src/view/run-state.mjs; src/view/history-graph.mjs | none initially |
| Producer identity | scripts/lib/progress-events.mjs; scripts/lib/agy_progress.py | scripts/open-items-run.mjs; scripts/agy-seat.py |
| Run feed | src/view/run-feed.mjs; src/view/live-routes.mjs | src/view/server.mjs; bin/pantheon-view.mjs |
| Journey clock and scene | src/view/ui/journey.mjs; src/view/ui/scene.mjs; src/view/ui/scene-render.mjs | none |
| UI | src/view/live.html; src/view/ui/live-app.mjs; src/view/ui/live.css | none |
| Acceptance | tests/live-*.test.mjs; tests/fixtures/live/*; scripts/live-view-check.mjs | README.md |

The new route assets are served from an explicit file table. Do not expose src or the repository through a general file server.

## Shared interfaces

Use these signatures consistently in tasks and tests:

~~~js
// progress-contract.mjs
normalizeProgressRow(row, context); // -> PublicRecord
segmentProgress(lines, { sourceId, epoch }); // -> Segment[]

// run-state.mjs
reduceRun(records, { runId }); // -> RunState; pure; no wall-clock reads

// history-graph.mjs
parseHistoryGraph(text); // -> { nodes, edges, phases, launches, meta, diagnostics }

// run-feed.mjs
createRunFeed({ roots, pollMs, bufferCap }); // -> feed
// feed.start(); feed.listRuns(); feed.snapshot(id);
// feed.records(id, { epoch, after, through, limit });
// feed.subscribe(id, { epoch, after }, listener); feed.close();

// ui/journey.mjs
stateAt(records, { runId, timeMs }); // -> RunState

// ui/scene.mjs
projectScene(state, { timeMs, reducedMotion }); // -> Scene

// ui/scene-render.mjs
drawScene({ svg, canvas, scene }); // SVG and Canvas rendering only

// live-routes.mjs
createLiveRoutes({ feed, historyRegistry }); // -> handle(req, res, url): boolean|Promise<boolean>
~~~

PublicRecord uses camelCase fields: id, runId, cursor, kind, timeMs, roleId, turnId, parentTurnId, producer, seat, model, lab, rev, ok, verdict, gate, commit, reason, coverage, source. Only relevant fields are present. source contains a registered source ID, epoch, and byte offsets, not raw content. coverage is recorded, legacy, or uncorrelated. Unknown rows become diagnostic records; malformed lines get a source-position diagnostic and are not counted as task activity.

RunState contains run { id, status, stage }, roles[], turns[], revisions[], acceptance, verdict, gates[], shipping, diagnostics[], and lastTimeMs. roles retain occupancy history; turns are keyed by identity rather than vendor; shipping has outcome unknown/reported_shipped/shipped/refused and recorded commit when available. Status is idle/running/failed/shipped/refused/ended_unverified. Transport connection status is separate from the run outcome.

Scene contains roles[], wisps[], gates[], captions[], and selectionTargets[]. Every target includes a stable ID and a link back to state. Historical snapshots use the same Scene schema. Realms and invented management roles are not added to match the picture.

## Task 1: Establish recorded state and a real replay fixture

**Files:** Create src/view/progress-contract.mjs, src/view/run-state.mjs, tests/live-state.test.mjs, and tests/fixtures/live/agy-segments.jsonl.

**Consumes:** Existing progress schema from scripts/open-items-run.mjs and scripts/agy-seat.py; the recorded outputs/open-items/agySeat/progress.jsonl.
**Produces:** PublicRecord, Segment, RunState, normalizeProgressRow, segmentProgress, reduceRun.

- [ ] Copy the recorded AGY event structure into a sanitized fixture. Retain all three run.start boundaries, failed and successful terminal outcomes, nested producer activity, and original order. Remove private tool argument text. Store the source SHA-256 and the sanitization description beside the fixture; tests use the fixture, not a mutable live output directory.
- [ ] Add failing semantic tests. This shipping case is mandatory:

~~~js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeProgressRow } from '../src/view/progress-contract.mjs';
import { reduceRun } from '../src/view/run-state.mjs';

test('shipping refusal stays refused after run.end', () => {
  const rows = [
    { event: 'run.start', run_id: 'r1', at: '2026-09-27T00:00:00Z' },
    { event: 'ship', ok: false, reason: 'TESTS', at: '2026-09-27T00:00:01Z' },
    { event: 'run.end', at: '2026-09-27T00:00:02Z' }
  ];
  const records = rows.map((row, index) => normalizeProgressRow(row, {
    runId: 'r1', cursor: index + 1, sourceId: 'fixture', epoch: 'e1',
    startAt: rows[0].at, previousTimeMs: index * 1000,
    startByte: index, endByte: index + 1
  }));
  const state = reduceRun(records, { runId: 'r1' });
  assert.equal(state.shipping.outcome, 'refused');
  assert.equal(state.run.status, 'refused');
});
~~~

- [ ] Run node --test tests/live-state.test.mjs and record the expected failure before implementing the modules.
- [ ] Normalize explicit typed fields first. For legacy files, segment on run.start and assign a deterministic segment identity from registered source, source generation, and boundary offset. Use recorded at timestamps relative to the segment start, preserve file order, and make display time nondecreasing. Never combine the Python producer's local elapsed_s with the parent clock as if they had the same origin.
- [ ] Implement outcome precedence and uncertainty with explicit functions:

~~~js
export function shippingOutcome(row) {
  if (row.ok === false) return 'refused';
  if (row.ok === true) return 'shipped';
  if (/^refused:/i.test(row.detail ?? '')) return 'refused';
  if (/^shipped\b/i.test(row.detail ?? '')) return 'reported_shipped';
  return 'unknown';
}

export function finishStatus(previousStatus, shipping) {
  if (shipping.outcome === 'refused') return 'refused';
  if (shipping.outcome === 'shipped') return 'shipped';
  if (previousStatus === 'failed') return 'failed';
  return 'ended_unverified';
}
~~~

- [ ] Add tests for three segments; backward/unequal producer timestamps; two concurrent turns from the same vendor; unknown fields; missing child IDs; parent/provider duplicate lifecycle events; turn.done with no acceptance; an unrecognized verdict; and ship with no boolean or recognizable legacy outcome. Legacy reported shipping must be labeled as such, with no inferred acceptance.
- [ ] Make the reducer idempotent for repeated record IDs and safe for labels such as __proto__. Mark ambiguous historical child activity uncorrelated; do not invent a precise active-child count.
- [ ] Run node --test tests/live-state.test.mjs. Commit the modules and fixtures together after they pass.

**Reviewable result:** Recorded AGY runs can be decoded and reduced correctly without providers, a browser, or new event fields.

## Task 2: Emit stable identity and structured results from both producers

**Files:** Create scripts/lib/progress-events.mjs, scripts/lib/agy_progress.py, tests/live-producer.test.mjs. Modify scripts/open-items-run.mjs and scripts/agy-seat.py at their progress, turn, subagent, verdict, gate, and ship emission sites.

**Consumes:** The field contract in Task 1.
**Produces:** Additive schema-v2 rows with run_id, event_id, producer, role, and turn_id; parent_turn_id/child_id only when known; typed gate and shipping outcomes.

- [ ] Write a failing test for a pure Node encoder and a standard-library Python encoder. Expose makeProgressEncoder({ runId, producer, clock, newId }) returning encode(payload), with clock and newId injectable. Expose Python encode_progress(payload, context, at, event_id) with identical reserved-key behavior. Both reject caller attempts to overwrite run_id/event_id/producer.

~~~js
test('encoder owns identity and preserves legacy detail', () => {
  const encode = makeProgressEncoder({
    runId: 'r1', producer: 'runner', clock: () => '2026-09-27T00:00:00Z',
    newId: () => 'event-1'
  });
  const row = encode({ event: 'ship', detail: 'refused: TESTS', ok: false });
  assert.equal(row.run_id, 'r1');
  assert.equal(row.event_id, 'event-1');
  assert.equal(row.producer, 'runner');
  assert.equal(row.detail, 'refused: TESTS');
  assert.equal(row.ok, false);
  assert.throws(() => encode({ event: 'ship', run_id: 'different' }));
});
~~~

- [ ] Run node --test tests/live-producer.test.mjs; confirm the pre-implementation failure.
- [ ] Allocate one run ID per launch and one turn ID per actual parent call. Pass run ID, turn ID, and role into agyTurn and through explicit Python CLI arguments. Give provider lifecycle rows the parent turn ID and producer=agy, so they enrich the parent instead of spawning a second parent entity. SDK child IDs, when exposed, become child_id; missing IDs stay missing.
- [ ] Add typed events at actual action boundaries. Emit chair only when an occupant actually takes a role; a retry failure remains reseat-attempt evidence. Encode shipping directly from the controller result:

~~~js
progress({
  event: 'ship',
  ok: r.ok,
  commit: r.ok ? r.commit : null,
  reason: r.ok ? null : r.why,
  detail: r.ok
    ? `shipped ${r.shipped.join(', ')} as ${shortCid(r.commit)}`
    : `refused: ${r.why}`
});
~~~

- [ ] Add role/occupant metadata at run and chair boundaries, artifact revision and byte/commit identifiers where already available, typed verdict, gate name/ok/why, acceptance exit/pass/fail, and numeric progress counts. Keep existing detail strings unchanged. Do not fabricate unavailable hashes or task identities.
- [ ] Test Node and Python encoders without importing a provider SDK. A child-process Python test imports only scripts/lib/agy_progress.py and returns sanitized fixture JSON. Add fixtures for duplicate provider callbacks and an uncorrelated child result. Compare existing event text fields with their original values to protect overseer output.
- [ ] Run node --test tests/live-producer.test.mjs tests/live-state.test.mjs and python3 -m py_compile scripts/lib/agy_progress.py scripts/agy-seat.py. Run the existing full suite because the runner is shared. Commit only this task's files.

**Reviewable result:** New runs carry reliable UI correlation and typed outcomes; old runs remain readable. No live provider call is needed to test encoding.

## Task 3: Deliver the file feed, snapshots, and reconnectable routes

**Files:** Create src/view/run-feed.mjs, src/view/live-routes.mjs, tests/live-feed.test.mjs, tests/live-routes.test.mjs. Modify src/view/server.mjs and bin/pantheon-view.mjs.

**Consumes:** Task 1 normalizer/reducer; raw progress files; createBus and the current server origin policy.
**Produces:** feed interfaces above, explicit run registry, GET /runs, GET /runs/:id, GET /runs/:id/events, GET /runs/:id/records, GET /live, and fixed live asset routes.

- [ ] Add a failing feed test with a temporary directory and an incomplete final line:

~~~js
test('partial append is invisible until the JSON line completes', async () => {
  await writeFile(progressPath, '{"event":"run.start","run_id":"r1"');
  await feed.start();
  assert.equal(feed.listRuns().length, 0);
  await appendFile(progressPath, ',"at":"2026-09-27T00:00:00Z"}\n');
  await waitUntil(() => feed.listRuns().length === 1);
  assert.equal(feed.snapshot(feed.listRuns()[0].id).state.run.status, 'running');
});
~~~

The test owns progressPath and feed via node:test setup/cleanup in a temporary directory; define waitUntil locally with a 2-second deadline and a 10 ms polling interval. It must throw at the deadline. No production path is a test writer.

- [ ] Run node --test tests/live-feed.test.mjs tests/live-routes.test.mjs and confirm failure before implementing the feed and routes.
- [ ] Tail incrementally from byte offsets, preserving incomplete UTF-8 and partial JSON lines. Use a file watcher plus a 250 ms poll. Detect inode replacement, truncation, and changed prefix on equal-size/in-place replacement. Assign a new epoch and invalidate old cursors instead of joining different source generations. Emit a diagnostic for a malformed complete line and continue at the next newline.
- [ ] Maintain a cumulative reduced snapshot independently of the bounded event buffer. Give each public event a source-derived stable identity and an SSE cursor containing epoch and sequence. A reconnect outside the retained buffer receives a gap/reset message and fetches a new snapshot. The client then resumes after that snapshot's cursor.
- [ ] Implement the route contract exactly:

~~~text
GET /runs
  { runs: [{ id, label, startedAt, status, coverage }] }
GET /runs/:id
  { id, epoch, cursor, state }
GET /runs/:id/events
  SSE with Last-Event-ID; gap/reset includes the snapshot URL
GET /runs/:id/records?epoch=...&after=...&through=...&limit=500
  { epoch, records, nextCursor, done }; reject stale epochs with 409
GET /live
  new observer page; current GET / remains the seats page
~~~

- [ ] Use configured roots and a server-side ID registry. Resolve real paths within roots before reading; reject traversal, symlink escapes, unregistered IDs, and malformed cursors. Apply origin checks before every new route, cap live subscribers, flush SSE headers immediately, and clean up watches/subscriptions on close. Expose only the normalized public projection, never the raw JSONL or arbitrary file contents.
- [ ] Support an explicit CLI --runs-dir path while retaining the existing positional port. Start the feed independently of lazy provider clients. Document the launch command only after it has been tested in Task 6.
- [ ] Add tests for equal-size replacement, truncated/malformed UTF-8, two segments in one append, reconnect deduplication, buffer eviction, stale epoch, escaping IDs/symlinks, invalid origins, prompt/tool-argument suppression, and immediate headers with no run events. Reuse the current raw HTTP test approach from tests/view-events.test.mjs.
- [ ] Run node --test tests/live-feed.test.mjs tests/live-routes.test.mjs tests/view-events.test.mjs tests/view-security.test.mjs. Commit the feed and integration after passing.

**Reviewable result:** A browser or test client can obtain a consistent run snapshot and follow new activity without invoking any model.

## Task 4: Build deterministic journeys and the gallows scene

**Files:** Create src/view/ui/journey.mjs, src/view/ui/scene.mjs, src/view/ui/scene-render.mjs, tests/live-journey.test.mjs, tests/live-scene.test.mjs.

**Consumes:** RunState and PublicRecord from Task 1.
**Produces:** stateAt, projectScene, drawScene, and stable selection targets. Pure model functions remain importable by node:test without a DOM.

- [ ] Write a failing backward-seek test:

~~~js
test('rewinding removes a future shipping result', () => {
  const records = [
    { id: 'a', runId: 'r1', kind: 'run.start', timeMs: 0 },
    { id: 'b', runId: 'r1', kind: 'ship', timeMs: 2000, ok: true, commit: 'c1' }
  ];
  assert.equal(stateAt(records, { runId: 'r1', timeMs: 2500 }).shipping.outcome, 'shipped');
  assert.equal(stateAt(records, { runId: 'r1', timeMs: 500 }).shipping.outcome, 'unknown');
});
~~~

- [ ] Run node --test tests/live-journey.test.mjs tests/live-scene.test.mjs and confirm failure before implementation.
- [ ] Implement a pure stateAt by filtering the selected segment through the requested time and reducing from an empty state. Optimize using checkpoints only after the basic equivalence tests pass. Preserve record order and never use previously rendered future state as the starting point for a backward seek.
- [ ] Model wisp positions with deterministic interpolation:

~~~js
export function arcPoint(from, to, progress, lift = 80) {
  const t = Math.max(0, Math.min(1, progress));
  return {
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t - Math.sin(Math.PI * t) * lift
  };
}
~~~

Use recorded start/end times and IDs as inputs. Travel takes at most 1200 ms; long work remains visibly active at its destination. Reduced motion goes directly to the current state. No Math.random or Date.now inside the projection. Clamp and coalesce visual intensity; activity counts remain exact or explicitly incomplete.

- [ ] Adapt [Aether's attract-mode force and curl motion](https://github.com/mikeascendx/aether/blob/main/js/field.js) to object targets: give each wisp a targetObjectId and resolve that object's center from the scene at the selected time. Supply that point in place of the cursor/idle-ghost attractor. The target belongs to that wisp; unrelated agents must not converge on a shared pointer. Keep the approach path above for travel outside the local attraction radius, then blend into bounded flutter around the object. A recorded transition changes the target; a missing object uses the explicitly unassigned anchor.
- [ ] Drive any integrated attraction/flutter motion with seeded initialization and fixed simulation ticks derived from journey time, independent of display frame rate. Reconstruct from a valid checkpoint on seek. Render a bounded trail from those samples so backward seeking also clears future trail geometry. Retain [Aether's MIT notice](https://github.com/mikeascendx/aether/blob/main/LICENSE) for reused source; no new runtime dependency is required.
- [ ] Extend the journey checks to cover two wisps with different object targets, target changes on a recorded transition, missing targets, arrival from outside the local attraction radius, and identical positions/trails after direct seek versus continuous playback. Resizing changes projection only; reduced motion places each wisp at its assigned anchor.
- [ ] Draw the frame, gallows, landscape, fog, and role silhouettes as reusable SVG elements. Place moving wisps on one Canvas layer. Provider/model badges and focusable role controls stay in the DOM. Use cyan for worker flow, magenta for critique, icy blue for connected oversight, and a non-color mark for failure. Layout the roles from actual state; the controller is labeled code.
- [ ] Implement actual-replacement animation using occupancy history: the old occupant fades to a historical outline, the replacement takes its role, and selecting either shows its own evidence. A reseat attempt without a new chair event produces only a retry marker. Role absorption remains unavailable unless separately recorded.
- [ ] Add tests for no wisps when idle; one parent wisp despite duplicate producer callbacks; child-parent linkage; reduced-motion equivalence; missing parent shown as unassigned; gate refusal without success effects; same time producing the same scene; historical occupant selection; and no reorganization on an unsuccessful retry.
- [ ] Run node --test tests/live-journey.test.mjs tests/live-scene.test.mjs tests/live-state.test.mjs. Commit the scene model and renderer.

**Reviewable result:** The reference-inspired scene can render any recorded timestamp deterministically and return stable IDs for inspection.

## Task 5: Connect the inspector, replay controls, and historical graph

**Files:** Create src/view/live.html, src/view/ui/live-app.mjs, src/view/ui/live.css, src/view/history-graph.mjs, tests/live-history.test.mjs. Extend src/view/live-routes.mjs and tests/live-routes.test.mjs for registered history sources.

**Consumes:** feed endpoints, stateAt, projectScene, drawScene, and the build graph JSONL.
**Produces:** A usable /live page with source selection, evidence inspection, playback controls, and History mode.

- [ ] Add a failing graph test before implementing the adapter:

~~~js
test('history preserves correction direction and approximate time', () => {
  const graph = parseHistoryGraph([
    { t: 'node', id: 'N1', title: 'Initial claim', at_precision: 'approx' },
    { t: 'node', id: 'N2', title: 'Correction' },
    { t: 'edge', from: 'N2', to: 'N1', rel: 'corrects' }
  ].map(JSON.stringify).join('\n'));
  assert.equal(graph.nodes[0].at_precision, 'approx');
  assert.deepEqual(graph.edges[0], { t: 'edge', from: 'N2', to: 'N1', rel: 'corrects' });
});
~~~

- [ ] Run node --test tests/live-history.test.mjs and record the pre-implementation failure.
- [ ] Implement parseHistoryGraph with explicit support for meta/phase/node/edge/metrics/launch. Preserve original IDs and directional relationship labels; report duplicate IDs, unknown record types, malformed rows, and missing edge endpoints. Unknown evidence remains inspectable as a diagnostic, never a fabricated node.
- [ ] Add GET /history and GET /history/:id over a configured registry of graph files. Reuse containment and origin policy from Task 3. Serve a display projection containing graph relationships, labels, source references, and precision; no arbitrary file route.
- [ ] Pin both React browser imports to 18.3.1. Build Header, JobPanel, Scene, Inspector, GateList, Timeline, and HistoryPanel with React.createElement. Store selected IDs separately from rendered frames. Render all event-derived content as React text children:

~~~js
const h = React.createElement;
const EvidenceText = ({ value }) => h('pre', { className: 'evidence' }, String(value ?? 'Not recorded'));
const SelectRole = ({ role, onSelect }) => h('button', {
  type: 'button',
  'aria-label': `Inspect ${role.label}`,
  onClick: () => onSelect({ kind: 'role', id: role.id })
}, role.label);
~~~

- [ ] Implement a snapshot-then-subscribe store with deduplication, gap recovery, and separate connection state. Keep React state updates coalesced at a maximum of 10 Hz during streaming; animate the scene in one requestAnimationFrame loop using the latest immutable view model. Hidden tabs pause animation without dropping incoming state.
- [ ] Load replay pages through a fixed epoch and through-cursor, then drive stateAt from the replay clock. Offer play/pause, 0.5x/1x/2x/4x speed, a labeled range input, event stepping, and return-to-live. New live records update the live store and its pending count while the replay state remains at the chosen time.
- [ ] Implement inspector selections for roles, turns, children, gates, revisions, graph nodes, and graph edges. Show literal state before theatrical captions. If a selected entity does not yet exist at the replay time, state that fact and keep the operator's selection without showing its future details.
- [ ] Use CSS Grid for the three-column desktop layout and stack under 1100 px. Render readable controls down to 360 px. Provide visible focus, Escape to return focus from the inspector, labeled connection/replay modes, text status symbols, and reduced-motion styles. Do not put role labels or the only copy of evidence inside Canvas.
- [ ] Run node --test tests/live-history.test.mjs tests/live-routes.test.mjs. In the browser, verify click and keyboard selection, escaped hostile text, backward seek during incoming live events, zoom to 200%, and reduced motion. Record failures and fix them before committing the UI.

**Reviewable result:** The user can watch, inspect, rewind, and understand real work and historical corrections through the proposed visual language.

## Task 6: Exercise the whole view and publish the runbook

**Files:** Create scripts/live-view-check.mjs and tests/live-integration.test.mjs. Update README.md. Store verification artifacts under outputs/dead-reckoning-ui-validation/<timestamp>/ when implementation is executed.

**Consumes:** All components and sanitized fixtures from Tasks 1–5.
**Produces:** Reproducible verification results, screenshots, performance measurements, and documented launch/replay usage.

- [ ] Write a failing integration test that starts the server with a temporary progress root and a makeClientFor function that throws if called. Append a run.start, two same-provider turns, nested child activity, acceptance failure, revision, approval, gate refusal, a new segment, and a successful shipping result. The observer must work without invoking that client factory.
- [ ] Run node --test tests/live-integration.test.mjs and confirm failure if any connection or state transition is missing. Complete integration until snapshots, SSE, and replay give the same recorded outcomes.
- [ ] Create a reproducible browser-check script with a fixture mode that explicitly labels synthetic activity and never calls a provider. Its output must include fixture identity, test timestamp, viewport, reduced-motion setting, and measured frame-time statistics. Use the available browser tooling at execution time; record unavailable browser/performance checks as unverified rather than passed.
- [ ] Run the feature checks and then the full suite:

~~~bash
node --test tests/live-state.test.mjs tests/live-producer.test.mjs tests/live-feed.test.mjs tests/live-routes.test.mjs tests/live-journey.test.mjs tests/live-scene.test.mjs tests/live-history.test.mjs tests/live-integration.test.mjs
node --test
node scripts/graph-check.mjs
~~~

- [ ] Capture actual rendered states: idle, working, correction requested, refused, shipped, disconnected, historical occupant, and replay. Capture desktop and 360 px layouts. Measure the 200-entity scene at 1600x900 and report p95 frame time; if above 16.7 ms, reduce trail density and retest once after the change.
- [ ] Verify that synthetic and real sources are explicitly labeled, no pulse indicates progress while disconnected, all evidence selections have literal states, graph times retain approximate labels, and the unconnected Babysitter is never shown as active.
- [ ] Verify the new launch command and document it only after success:

~~~bash
node bin/pantheon-view.mjs 7777 --runs-dir outputs/open-items
~~~

Then open http://127.0.0.1:7777/live. The /live route and --runs-dir flag are planned additions, not commands claimed to work at this plan's baseline.

- [ ] Document the four components, source registries, replay limits, existing network requirement for React, and observer-only release boundary. Commit the implementation and evidence references after the checks pass. A green unit suite without a rendered browser check is not the complete UI acceptance result.

**Reviewable result:** A working visual observer with explicit validation evidence and a usable launch command.

## Execution order and handoff

Execute Tasks 1–6 in order. Task 1 is the first useful deliverable and establishes the real recorded-state baseline. Task 2 adds precision without making legacy replay depend on new fields. Task 3 connects the backend. Tasks 4 and 5 give it the reference's visual language and interactions. Task 6 proves the integrated result.

Recommended execution method: native implementation by one owner, followed by a final independent review if that review method is authorized. The tasks share state and event interfaces; an automatic expansion into more agent roles is unnecessary. If the user chooses Pantheon-based execution, use scripts/tickets/README.md, operator-owned oracle tests, and one-file tickets only for modules that fit that contract. Do not pretend a visual design is accepted solely by a model verdict or a file-level unit test.

The plan covers the requested UI design. A control plane for pause/approve/cancel/reseat, the actual OpenAI Babysitter, sound, free-camera 3D, and an organizational role-absorption operation are separate follow-on work. Their absence is explicit in the interface.

## Plan self-review

- Design coverage: scene/layout and caption rules → Tasks 4–5; recorded truth and identities → Tasks 1–2; feed and origin policy → Task 3; governance/accountability → Tasks 1, 4, 5; journeys/reorganization → Tasks 1, 4, 5; build history → Task 5; accessibility and measured performance → Tasks 5–6.
- Review-focus coverage: multi-launch timing → Task 1; false success → Tasks 1/4; replacement/reconnect gaps → Task 3; duplicate/unknown child identity → Tasks 1/2; backward seek and hostile text → Tasks 4/5.
- Interface names match the shared interface block. Helper exports shippingOutcome, finishStatus, arcPoint, makeProgressEncoder, and encode_progress are defined in the owning tasks.
- Current infrastructure is distinguished from proposed routes and flags. Current drafts, runtime evidence, and user work are preserved.
- This document is an implementation proposal. Its test cases and launch command are future execution instructions, not evidence that the UI is already built.
