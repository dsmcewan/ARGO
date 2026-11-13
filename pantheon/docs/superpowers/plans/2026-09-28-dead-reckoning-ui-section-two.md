# Dead Reckoning Section Two Implementation Plan

Prepared 2026-09-28 as a continuation of the 2026-09-27 parent plan.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for native implementation, or superpowers:subagent-driven-development if that execution method is selected. Steps use checkbox syntax for tracking. Read the linked design and parent plan before implementing.

**Goal:** Make live consumption, historical playback, and showcase framing agree on exactly which run, events, time, and scene the operator is seeing.

**Architecture:** Extend the parent plan's run feed with retained, sanitized captures and consistent snapshots. Feed the existing planned reducer into a browser store with separate live and playback state. Use one fixed 2D camera transform for SVG, Canvas, and selection coordinates.

**Tech Stack:** Node >=20, JavaScript ESM, React/React DOM 18.3.1, server-sent events, SVG, Canvas 2D, node:test. No new production dependency.

**Spec:** [Proposed UI design](../specs/2026-09-27-dead-reckoning-ui-design.md).
**Parent plan:** [Complete implementation plan](2026-09-27-dead-reckoning-ui.md).
**Relationship:** This is the detailed execution contract for parent Tasks 3–5 and the recording portion of Task 6. Parent Tasks 1–2 establish the normalized records, reducer, and producer identities first. This is not a second backend or an alternative renderer.

**Status:** Proposed implementation plan. Current checkout is 3837eda and still serves the existing seats view. The gallows view, file tailer, replay store, and camera below have not been implemented. Camera assumption: fixed cinematic framing with responsive scaling, as proposed while awaiting the optional preference answer. Full 3D orbit would require a separate design revision.

## Verified showcase source

The second segment of outputs/open-items/streamThinking/progress.jsonl records:

| Fact | Recorded evidence |
|---|---|
| Run start | line 67, 2026-09-28T01:18:54.591Z |
| Acceptance command | line 83, node --test |
| Acceptance result | line 84, exit 0, 525 passed and 0 failed |
| Acceptance stage interval | approximately 2.79 seconds between its start/done markers; not an independently measured assertion runtime |
| Shipping record | line 119, commit:1bbfe335f394 |
| Overall elapsed time | line 120, 89.47 seconds |
| Segment size | 54 progress records |
| Child starts present in this segment | 1; this does not establish comprehensive subagent coverage |
| Inspected file SHA-256 | 476c4f3299e9f709e94198dfed6468c5d8027e49252611b8a7b021d4bb577c2c |

These are retained log observations, not a new execution or independent acceptance certification. The screenshot's 112 subagents is illustrative and is not supported by this segment. The showcase may display a separately labeled synthetic 112-entity load test, but cannot relabel that as this real run.

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

Retained captures are derived artifacts, stored under an explicit captureDir outside watched roots. Never write to a source progress file. Never delete an old capture automatically. A capture budget failure is an explicit source pause, not permission to discard history or keep claiming a complete live feed.

## Review focus

1. A replacement file has the same name and size: physical identity and immutable capture generation must prevent history from changing underneath replay. Task 2.1.
2. An append arrives after snapshot creation but before SSE subscription, or a slow client exceeds the retained buffer: no silent loss and no double application. Task 2.2.
3. A user switches runs, rewinds, or changes speed while network responses arrive: late responses cannot overwrite the selected run or introduce future state. Task 2.3.
4. The canvas changes size or device-pixel ratio, or becomes zero-sized in a hidden pane: labels and click targets remain aligned, and rendering resumes without a crash. Task 2.4.
5. A screenshot or video freezes a replay frame while displaying live metrics: mode, source identity, and metric provenance must remain attached to the capture. Task 2.5.

## Fixed contracts

### Identity and timing

- sourceId: a server-registered local source; never a client-supplied file path.
- epoch: a physical source generation, not an authorization token. A restart may issue a new live epoch; retained sealed captures keep their own identity.
- runId: one logical run segment. A new run.start begins a new segment even inside the same file. Explicit producer run IDs take precedence; legacy IDs include the source identity and segment-start offset.
- cursor: an integer sequence within a particular run and epoch. Duplicate event IDs are retained as diagnostics, but applied to state once.
- SSE ID: epoch:cursor, parsed strictly; unsafe integers, negative cursors, or malformed epochs are rejected.
- timeMs: normalized presentation time relative to run start, nondecreasing in recorded order. Preserve original timestamps in provenance. Never compare a nested producer's local elapsed clock directly with its parent clock.

### Snapshot and subscription

Snapshot is { id, epoch, cursor, state, capturedThroughMs, connection }. Its state is the fold of precisely the committed public records through cursor. It is not reduced from only the last 2,000 buffered events.

The browser fetches a snapshot at cursor N, then subscribes after N. The feed registers the listener and drains its backlog as one ordered operation relative to publication. If N has fallen outside the buffer, it sends a reset with no progress-event ID; the browser obtains a fresh snapshot and subscribes again. A reconnect uses Last-Event-ID; an initial EventSource request uses an after query parameter. A conflicting header and query is a 400, not an arbitrary choice.

### Immutable replay boundary

Replay selection fixes { runId, epoch, throughCursor }. Pages come from the retained sanitized capture through that boundary. An unfinished live run can therefore be replayed as a prefix without changing beneath the scrubber. New live events continue updating a separate live store.

Captures append normalized public records in source order. Commit a batch to the capture before advancing the public snapshot cursor or publishing it. Seal metadata records the committed count, boundary, source digest, projection version, and capture digest. Capturing a file is not proof that the underlying producer's claims were correct.

### Limits for the first implementation

| Setting | Value and behavior |
|---|---|
| Source poll | 250 ms, with a watcher as a wakeup hint |
| Read chunk | 64 KiB; one serialized read loop per source |
| Maximum input line | 1 MiB; larger rows are skipped with a position diagnostic |
| Public record size | <=16 KiB; long optional display strings are truncated with a flag |
| Live replay buffer | 2,000 public records per selected run |
| Replay page | 1–500 records; default 500 |
| SSE subscribers | 64 total across old and new event routes |
| Slow-client queue | 256 records or 256 KiB, whichever comes first; disconnect and recover by snapshot |
| Transport heartbeat | 15 seconds, separate from run activity and with no progress cursor |
| No heartbeat warning | 45 seconds; mark transport stale without declaring the worker dead |
| Capture budget | 512 MiB per configured capture directory for this release; pause further ingestion at the limit and keep old evidence |
| Scene reference frame | 1280 x 720 logical units |
| Canvas pixel ratio | min(devicePixelRatio, 2), recomputed on resize/display changes |

These are configurable implementation defaults, not measured performance results. Progress is coalesced in state while retained records remain available for replay. Do not keep every raw text chunk in React state.

## Task 2.1: Tail into a stable retained capture

**Files:** Create src/view/run-capture.mjs, src/view/run-feed.mjs, tests/live-capture.test.mjs, tests/live-feed.test.mjs. Use parent progress-contract.mjs and run-state.mjs without changing their public field names.

**Interfaces:**

~~~js
createCaptureStore({ captureDir, maxBytes });
// -> appendBatch({ runId, epoch, records }), readPage(selection),
//    seal({ runId, epoch, throughCursor, sourceDigest }), close()

createRunFeed({ roots, captureDir, pollMs = 250, bufferCap = 2000,
  maxCaptureBytes = 512 * 1024 * 1024 });
// -> start(), listRuns(), snapshot(id), records(id, selection),
//    subscribe(id, { epoch, after }, listener), close()
~~~

- [ ] Write a failing capture-isolation test using two versions of one source path. Capture version A, replace the file with version B of equal length using a rename, then assert that A's sealed records and digest are unchanged and B has a new epoch. Also verify that source bytes were never written by the feed.
- [ ] Add a failing partial-UTF-8 test. Write all but the final bytes of a JSON line containing a multibyte role label; assert no record appears before the newline, then append the remainder and assert one correctly decoded record. Use temporary directories and the actual incremental reader.
- [ ] Run node --test tests/live-capture.test.mjs tests/live-feed.test.mjs and retain the expected initial failure.
- [ ] Implement a byte-oriented reader. Hold incomplete lines as bytes, find newline boundaries, and decode only complete lines with fatal UTF-8 validation. Drain an oversized row until its newline without retaining its full bytes. Preserve its source position as a diagnostic. Blank lines do not become events.
- [ ] Use one queued pump per source. Watcher and poll requests coalesce; they cannot run overlapping reads. Capture descriptor identity and source offset at admission. Detect replacement by descriptor identity, truncation by size, and same-size rewrites by content comparison when metadata changes. Verify saved boundary fingerprints before continuing a larger file. A detected rewrite starts a new epoch rather than appending to the old one.
- [ ] State the support boundary in the runbook: producers append within an epoch or replace the file for a new generation. Arbitrary concurrent in-place rewrites are unsupported; this is not a claim that fingerprints detect every possible mutation. At sealing, compare a full digest of the selected source prefix with the bytes observed during ingestion; mark source_changed and disqualify the capture as a faithful source snapshot if they disagree. Already retained public evidence remains inspectable.
- [ ] Persist normalized records before publishing them. The commit order is:

~~~js
await capture.appendBatch({ runId, epoch, records });
const next = reduceRun(committedRecords.concat(records), { runId });
publishCommitted({ runId, epoch, records, state: next });
~~~

This shows the ordering contract. The implementation should fold incrementally or checkpoint to avoid repeatedly concatenating an entire run; equality with the pure reducer remains the oracle. publishCommitted is local to run-feed.mjs and synchronously updates the snapshot, bounded ring, and listeners after successful capture persistence.

- [ ] If capture append/sync fails or the budget is exceeded, retain the previous snapshot cursor, mark source ingestion paused, and notify clients through a control event. Do not advance a committed cursor for a record that cannot be replayed. Do not silently delete captures to make room.
- [ ] Add tests for a file initially absent then created; three run starts in one file; split lines; malformed lines; source replacement; truncation; larger rewrite with changed boundary; capture-write failure; budget exhaustion; close/reopen; and captureDir inside a watched root being rejected.
- [ ] Run node --test tests/live-capture.test.mjs tests/live-feed.test.mjs tests/live-state.test.mjs. Commit only this task's implementation and tests after they pass.

**Result:** Source progress can be followed without mutating it, and the operator can return to a fixed, inspectable history even after the original source rotates.

## Task 2.2: Make the snapshot-to-stream handoff race-safe

**Files:** Create/extend src/view/live-routes.mjs, tests/live-routes.test.mjs, tests/live-transport.test.mjs. Modify src/view/server.mjs and bin/pantheon-view.mjs only at the integration points described in the parent plan.

**Consumes:** Task 2.1 feed. **Produces:** Consistent HTTP snapshots, paged replay, SSE data and control messages, and one shared subscriber budget.

- [ ] Write a failing test that obtains snapshot N, appends N+1 before subscribing, then subscribes after N and asserts N+1 is delivered once. Repeat with buffer eviction between the snapshot and subscription; assert an explicit reset followed by a current snapshot.
- [ ] Write a failing slow-reader test using the existing raw-socket technique from tests/view-events.test.mjs. Saturate the configured queue; the connection must close with bounded memory while another healthy subscriber continues receiving data.
- [ ] Run node --test tests/live-transport.test.mjs tests/live-routes.test.mjs before implementation.
- [ ] Implement a strict cursor parser:

~~~js
export function parseCursor(value) {
  const match = /^([A-Za-z0-9_-]{1,80}):(0|[1-9][0-9]*)$/.exec(String(value));
  if (!match) throw new TypeError('Malformed event cursor');
  const sequence = Number(match[2]);
  if (!Number.isSafeInteger(sequence)) throw new RangeError('Cursor exceeds safe integer range');
  return { epoch: match[1], cursor: sequence };
}
~~~

- [ ] Apply the current server origin/Host checks before dispatching all live routes. Replace route-local subscriber accounting with a shared acquire/release function used by both /events and /runs/:id/events. Release exactly once on close, error, and failed setup.
- [ ] Send SSE headers immediately. Data messages carry the committed epoch:cursor. Heartbeat, reset, and capture-paused are named control events and do not advance the event cursor. Queue writes after res.write returns false; resume on drain; close when the byte or record limit is exceeded. Clean up timers, listeners, and sockets on shutdown.
- [ ] Enforce replay selection: epoch and throughCursor are required; limit is bounded; a page cannot include a later event even if the live run has advanced. A request for a stale, unavailable generation returns 409 with an explicit reset action. Existing sealed captures remain readable by registered capture ID.
- [ ] Test reserved IDs, traversal, escaping symlinks, malformed cursors, contradictory header/query cursors, subscriber cap, disconnect cleanup, source reset, snapshot handoff, replay boundary, and raw prompt/tool-argument omission. Verify the observer path never calls makeClientFor.
- [ ] Run node --test tests/live-transport.test.mjs tests/live-routes.test.mjs tests/view-events.test.mjs tests/view-security.test.mjs. Commit after passing.

**Result:** Opening or reconnecting the view cannot silently omit the events between the snapshot and stream.

## Task 2.3: Keep live state separate from the playback clock

**Files:** Create src/view/ui/run-store.mjs, src/view/ui/replay-clock.mjs, tests/live-store.test.mjs, tests/live-replay-clock.test.mjs. Connect to the parent ui/journey.mjs and ui/live-app.mjs.

**Interfaces:**

~~~js
createRunStore({ fetchSnapshot, fetchPage, openEvents, now });
// -> selectRun(id), enterReplay({ throughCursor }), seek(timeMs),
//    setSpeed(speed), play(), pause(), returnToLive(),
//    getSnapshot(), subscribe(listener), close()

sceneTime({ anchorSceneMs, anchorRealMs, speed, playing, endTimeMs }, nowMs);
// -> nonnegative playback time bounded by the captured end
~~~

- [ ] Write a failing test with deferred requests: select run A, select B, resolve B, then resolve A. B must remain selected. Close A's event source and ignore any late A message using a monotonically increasing selection generation.
- [ ] Write a failing clock test for a speed change followed by backward seek. The time at the speed-change boundary must not jump. Define the clock function exactly:

~~~js
export function sceneTime(clock, nowMs) {
  const delta = clock.playing ? Math.max(0, nowMs - clock.anchorRealMs) * clock.speed : 0;
  return Math.max(0, Math.min(clock.endTimeMs, clock.anchorSceneMs + delta));
}
~~~

- [ ] Run node --test tests/live-store.test.mjs tests/live-replay-clock.test.mjs and confirm the failing cases before implementation.
- [ ] Store liveSnapshot/liveCursor independently of playbackRecords/playbackTime. entering replay fixes the current epoch and throughCursor. Fetch all needed pages through that boundary; missing pages show loading or a gap, never interpolated invented activity. New SSE records update live state and an unseen-event count, not playback state.
- [ ] On play, pause, speed change, or seek, first compute the current scene time, then reset both anchors together. Use performance.now through the injected now function; do not drive animations from Date.now. On a hidden tab, pause playback and resume only on operator action; live ingestion continues and return-to-live uses the latest snapshot.
- [ ] Call stateAt from an empty state or a valid earlier checkpoint on rewind. A selected entity that is in the future shows Not present at this time rather than its future details. The ending view of a failed run stays failed, and a turn completing never manufactures acceptance.
- [ ] Make return-to-live one atomic visible switch to the latest live snapshot and cursor. Clear the pending-events count; retain playback controls and source labels so the operator can deliberately return to history.
- [ ] Test late fetches, stale event sources, run switch mid-replay, speed changes, backward seek, replay at time zero/end, incoming ship while paused before shipping, hidden/visible transitions, reconnect during playback, and history-gap recovery. Assert that every retained cursor is applied at most once.
- [ ] Run node --test tests/live-store.test.mjs tests/live-replay-clock.test.mjs tests/live-journey.test.mjs tests/live-state.test.mjs. Commit after passing.

**Result:** A historical journey remains historically correct while the current run keeps progressing.

## Task 2.4: Lock the camera, drawing, and click targets together

**Files:** Create src/view/ui/camera.mjs and tests/live-camera.test.mjs. Modify planned ui/scene-render.mjs, ui/live-app.mjs, and ui/live.css.

**Assumption:** Fixed cinematic framing. The camera does not orbit and events do not pan the scene. Figures remain role anchors; agent wisps carry motion. At mobile size the panels stack and a readable role list supplements the scaled scene.

**Interfaces:** fitCamera({ world, viewport, padding }), worldToScreen(point, camera), screenToWorld(point, camera). world and viewport use CSS logical units, never physical canvas pixels.

- [ ] Write a failing round-trip test and hidden-pane test:

~~~js
test('camera uses one invertible transform', () => {
  const camera = fitCamera({
    world: { x: 0, y: 0, width: 1280, height: 720 },
    viewport: { width: 960, height: 600 }, padding: 24
  });
  const p = { x: 640, y: 360 };
  const screen = worldToScreen(p, camera);
  const restored = screenToWorld(screen, camera);
  assert.ok(Math.abs(restored.x - p.x) < 1e-9);
  assert.ok(Math.abs(restored.y - p.y) < 1e-9);
  assert.equal(fitCamera({
    world: { x: 0, y: 0, width: 1280, height: 720 },
    viewport: { width: 0, height: 0 }, padding: 24
  }), null);
});
~~~

- [ ] Run node --test tests/live-camera.test.mjs and record the expected initial failure.
- [ ] Implement the projection without independent per-layer offsets:

~~~js
export function fitCamera({ world, viewport, padding = 24 }) {
  const width = viewport.width - 2 * padding;
  const height = viewport.height - 2 * padding;
  if (width <= 0 || height <= 0) return null;
  if (world.width <= 0 || world.height <= 0) throw new RangeError('Invalid scene bounds');
  const scale = Math.min(width / world.width, height / world.height);
  return {
    scale,
    tx: (viewport.width - world.width * scale) / 2 - world.x * scale,
    ty: (viewport.height - world.height * scale) / 2 - world.y * scale
  };
}

export const worldToScreen = (p, c) => ({ x: p.x * c.scale + c.tx, y: p.y * c.scale + c.ty });
export const screenToWorld = (p, c) => ({ x: (p.x - c.tx) / c.scale, y: (p.y - c.ty) / c.scale });
~~~

Callers skip drawing/hit-testing when the camera is null. Validate finite numeric inputs at the component boundary. World bounds include the whole gallows, intended trails, and scene labels, so fitting cannot crop meaningful content accidentally.

- [ ] Apply the same scale/translation to the SVG root group, the Canvas transform, and DOM overlay anchors. Canvas backing dimensions are CSS dimensions multiplied by the capped device-pixel ratio. A single setTransform call combines DPR and camera; never apply the scale twice.
- [ ] Use each assigned object's scene-space center as the Aether-style attraction point for its wisp, as specified in parent Task 4. Keep target resolution and motion in world units; apply the camera only when drawing. Verify after resize and replay seek that the wisp remains attracted to its own current object, rather than the cursor or a stale screen coordinate.
- [ ] Use ResizeObserver to recompute the stage's content-box camera. Re-evaluate DPR on window/display changes. Pointer coordinates first subtract the stage bounding rectangle, then pass through screenToWorld. Scene hit-testing is performed in world units; DOM focus controls share the same projected anchors.
- [ ] Use 24 CSS px framing padding on desktop and 12 px on narrow screens. Keep badges and inspector text at readable CSS sizes independently of scene scale. Small visual targets have 44 px DOM focus/click regions; if these overlap at narrow widths, the accompanying role list is the unambiguous interaction route.
- [ ] Capture at 1920x1080 with all three columns visible. The camera fits the actual center panel, not the entire window. Opening the inspector replaces its contents without moving the stage; an event never shifts the frame. At reduced motion, apply the same final state without travel.
- [ ] Test corner containment, nonzero world origin, letterboxing, tall and narrow containers, resize after a hidden pane, capped DPR, point round-trips, and hit targets before/after resize. In browser checks, verify keyboard focus and selection at 100% and 200% zoom.
- [ ] Run node --test tests/live-camera.test.mjs tests/live-scene.test.mjs; perform the viewport and zoom checks and retain screenshots. Commit the camera integration after passing.

**Result:** The scene remains composed and selectable throughout the showcase, including after resizing or moving between displays.

## Task 2.5: Produce a reproducible showcase capture

**Files:** Create scripts/live-showcase-check.mjs, tests/live-showcase.test.mjs, and docs/runbooks/dead-reckoning-showcase.md. Extend the parent's planned scripts/live-view-check.mjs by importing shared verification helpers rather than duplicating them.

**Consumes:** A registered source or sealed capture, view build identity, viewport/camera configuration, and runtime measurements. **Produces:** A capture manifest and verification artifacts; this task does not publish to LinkedIn.

- [ ] Write a failing manifest test: a replay cannot declare mode=live, a synthetic load fixture cannot claim real subagent counts, and metrics cannot reference a different run/epoch than the scene. Export buildShowcaseManifest(input) and validateShowcaseManifest(manifest) in scripts/lib/showcase-manifest.mjs for these tests.
- [ ] Run node --test tests/live-showcase.test.mjs and confirm the initial failures before implementing manifest validation.
- [ ] Record this manifest shape with explicit values rather than inferred marketing labels:

~~~js
export function buildShowcaseManifest(input) {
  const { mode, sourceKind, selection, capture, viewRevision,
    viewport, cameraMode, speed, metrics, receipts, capturedAt, frameStats } = input;
  return {
    schemaVersion: 1, mode, sourceKind,
    runId: selection.runId, epoch: selection.epoch,
    throughCursor: selection.throughCursor,
    sourceDigest: capture.sourceDigest, captureDigest: capture.digest,
    viewRevision, viewport, cameraMode, speed, metrics, receipts,
    capturedAt, frameStats, claimsStatus: 'requires-source-validation'
  };
}
~~~

Pass actual registered IDs, committed cursor, view digest, source/capture digests, receipt references, capture timestamp, and measured frame statistics. validateShowcaseManifest must require these fields, validate mode/source compatibility and finite metrics, and verify that every metric receipt belongs to the selected run/epoch at or before throughCursor. Then check receipt values against the selected capture. Only that completed source check can set claimsStatus to source-validated; schema shape alone cannot. This status does not become acceptance authority.

- [ ] Add a deterministic fixture-stream mode that appends captured public records according to their normalized times to an isolated temporary source. Watermark it Fixture playback. A stream delivered over SSE is still playback if its source is recorded. A truly live run and a synthetic density test have separate explicit modes.
- [ ] Rehearse one record-backed journey showing intake, plan, work, acceptance, review, gates, and shipping. Also show refusal/revision from the earlier failed segment and a deliberate viewer disconnect. Retain a labeled frame for each state. Use the real recorded benchmark only with its correct segment selected.
- [ ] Verify normal and reduced-motion behavior, frame timing, no duplicate wisps after reconnect, inspector evidence matching selection, and no future result after backward seek. Measure at 1920x1080 and report hardware/browser details with p50/p95 frame time. The parent 16.7 ms p95 target remains a target until measured.
- [ ] Run all Section Two tests and then the existing full suite. Record actual commands, exit codes, view revision, source hashes, and artifacts. Preserve failures as evidence rather than replacing them with a successful final headline.
- [ ] Write the runbook using only commands verified against the implementation. Include selecting the source, sealing a capture, replay speed, fixed camera preset, disconnect recovery, and what each visible metric means. No automatic publishing step is included.
- [ ] Commit the runbook, script, manifest validator, and test code after the checks pass. Keep generated capture artifacts in the selected output directory with explicit references.

**Result:** The Halloween showcase can demonstrate working behavior and quote traceable numbers without confusing live operation, replay, and synthetic density.

## Completion checks

- [ ] Replaying a sealed generation still works after source rotation.
- [ ] Snapshot-to-SSE handoff loses zero known events in the race tests and applies duplicates once.
- [ ] Backpressure disconnects only the slow client and permits snapshot recovery.
- [ ] Rewinding while live data arrives never shows future shipping, occupants, or evidence.
- [ ] One transform aligns scene geometry, trails, labels, and selection at every tested viewport.
- [ ] The showcase clearly displays its source mode and all quoted metrics resolve to the selected run.
- [ ] Current-source claims, implemented behavior, and measured performance are separately recorded.

## Self-review and execution boundary

Coverage: capture identity and source rotation → 2.1; no-gap delivery and slow clients → 2.2; historical timing and asynchronous selection → 2.3; responsive camera and selection → 2.4; record-backed showcase → 2.5. These tasks elaborate the existing observer scope and introduce no model control or approval authority.

Implementation recommendation: one owner executes these tasks sequentially, because the capture, cursor, and replay contracts are shared. The user's plan request authorizes this document; it does not certify that the proposed UI is already working. Camera remains fixed as a stated default unless the user selects another option.
