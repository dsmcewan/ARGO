# Live View, Section Two — the stream, the replay, the camera

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. Tasks marked *ticket* run through `scripts/open-items-run.mjs` with the human-written oracle committed first (`scripts/tickets/README.md`); tasks marked *by hand* are done in-session and verified by the executed check named in the task.

**Goal:** Whatever the centre of the screen looks like (glass blocks today, cloaked figures if the showcase goes that way), the stream under it is flawless: a live tail of the runner's `progress.jsonl` that never shows a torn or half-decoded row, a historical replay that scrubs to any moment of any recorded run with the same renderer, and a still camera that is one transform for the drawing, the labels and the frame the post needs.

**Architecture:** The runner appends `progress.jsonl`. A byte-oriented tailer reads it from byte 0, holds partial lines as bytes, decodes only whole lines, and treats a replaced or shrunk file as a new generation. The server publishes rows on a bus with sequence numbers and streams them as SSE; the browser takes a snapshot at cursor N, then subscribes after N, and a gap or a restart makes it snapshot again. The browser store folds rows through the pure reducer in live mode; in replay it re-folds all rows up to a scene clock driven by anchors, so play, pause, speed and seek never jump. The renderer reads a state and a clock and nothing else. The camera is one `fitCamera` transform shared by both canvases and the DOM labels.

**Tech Stack:** Node 24, `node:test`, ES modules, no bundler. React 19.3.0 (exact) from `package.json`, mirrored into the page's import map by the server. No other dependency.

**Spec:** `docs/specs/2026-09-27-live-view-design.md`, §6 (states), §7 (data contract), §8 (architecture). This section is the data path; §3–§5 (the picture) is Section Three.

## Reconciliation with the uploaded "Dead Reckoning Section Two" plan (2026-09-28)

The uploaded plan and this one describe the same slice. Where it was stronger, this plan now says what it says. Where it disagrees with this repository, this plan says why.

**Adopted here, with tests:**
- A **byte-oriented tailer** that holds the torn tail as bytes and decodes only complete lines with fatal UTF-8 validation, so a multibyte character split across two reads is never corrupted (Task 1). My first draft decoded each chunk to a string; that was a defect and the new oracle catches it.
- **Replacement detection by inode**, not only by a shrink: a same-size rewrite through a rename is a new generation (Task 1).
- **Snapshot then subscribe after N**, with an explicit reset when N has left the buffer (Task 2). The bus already reports a gap; the store now acts on it.
- A **bounded slow-client queue** on every SSE route: writes that back up past 256 KiB close that client and leave the others alone (Task 2).
- A **selection generation** in the store, so a late response for a run the operator has left can never overwrite the run they selected (Task 3).
- An **anchor-based scene clock**, `sceneTime`, taken verbatim, so a speed change or a backward seek never jumps (Task 3).
- One **camera transform**, `fitCamera` / `worldToScreen` / `screenToWorld`, taken verbatim, with `null` for a zero-sized viewport and a device-pixel ratio capped at 2 (Task 5).
- A **capture manifest** for the post: a screenshot carries its mode (live, replay or fixture), its run, its clock and its view revision, and a replay can never call itself live (Task 6).

**Not adopted, and why:**
- The **retained capture store** (epochs, sealed captures, source digests, a 512 MiB budget). The runner's `progress.jsonl` is already append-only and already the retained record; the board's content-addressed store already holds every artifact and its hash. A second store of sanitized copies would be a second source of truth for the same bytes. Replay reads the file; a replaced file is a new generation in the feed, which is what the inode check is for.
- **React 18.3.1.** The user asked for the current React; `package.json` pins 19.3.0 and the server writes the import map from that pin.
- The **1280×720 world**. The composition is in 960×520 today; with one camera transform the world size is a constant, and changing it is a two-line edit in `glass.mjs` if the showcase wants 16:9.
- Its **file names** (`run-capture.mjs`, `live-routes.mjs`, `journey.mjs`, `live-app.mjs`, `scene-render.mjs`). Its parent documents were written into this repository by another session on 2026-09-28 (`docs/superpowers/specs/2026-09-27-dead-reckoning-ui-design.md`, `docs/superpowers/plans/2026-09-27-dead-reckoning-ui.md`, `docs/superpowers/plans/2026-09-28-dead-reckoning-ui-section-two.md`); they are that session's and are not edited here. The modules in this plan are the ones on disk or in Section One; if the two tracks merge, the contracts above are the shared part.

**Its evidence claims, checked:** the second segment of `outputs/open-items/streamThinking/progress.jsonl` begins at line 67 and ends at line 120 with `run.end` at 89.47 s; acceptance is at lines 83–84 with exit 0 and 525 passed; the ship record is at line 119 with `commit:1bbfe335f394`; one `subagent.start` in the segment. Its "112 subagents" caution stands: that number is the reference image's, not this run's, and no capture may relabel a synthetic load as this run.

## Global Constraints

- **Additive only.** No progress event or field renamed, removed or retyped. `tests/overseer-golden.test.mjs` (Section One) holds the overseer byte-identical.
- **Loopback only.** Every new route passes the same `originPolicy` as `/events` in `src/view/server.mjs`; names in `/runs/<name>` and `/ui/<name>` match `^(?!\.)[A-Za-z0-9_.-]+$`; a client never names a filesystem path.
- **The fold is the only fold.** Live, `/run`, and replay all use `src/view/ui/run-state.mjs`. No second parser in the browser.
- **The clock is one number.** Live: `elapsed_s` of the last row plus wall time since it arrived. Replay: `sceneTime(clock, now)`. Stalled: frozen at the last row. Nothing in the renderer reads `Date.now()`; the store's `now` is injected so tests can drive it.
- **One transform.** Both canvases and the label layer use the same `fitCamera` result; nothing applies a scale twice.
- **No conversation content** leaves the file: rows carry counts, names, paths and hashes.
- **A capture says what it is.** Every screenshot or recording for the post is accompanied by a manifest naming its mode, run, clock and view revision.
- Every ticketed task is accepted by `node --test` from the repository root; a seat never edits a test.

## Review Focus

1. **A torn last line, mid-character.** The runner appends UTF-8; a read can end inside a multibyte character. The tailer holds bytes, not strings, and emits the row whole (Task 1's split-character test).
2. **The same path, a new file.** A rewrite through a rename keeps the size and changes the inode; a second run appended to the same file keeps the inode and grows. The first is a new generation (reset), the second is a fold restart at the last `run.start` (Task 1's rename test; Task 3's two-run test).
3. **The snapshot-to-stream race.** A row lands between `GET /run` and the SSE subscription. Subscribing `after` the snapshot's cursor delivers it exactly once; if the cursor has left the buffer the client gets a gap and snapshots again (Task 2's race test).
4. **A late response after a run switch.** The operator selects run A, then B; A's rows arrive last. B stays selected (Task 3's generation test).
5. **A zero-sized or resized stage.** A hidden pane gives a zero viewport; a resize changes the transform. Nothing draws with a null camera; labels and drawing move together (Task 5's round-trip and null tests, and its executed resize check).

## File Structure

| file | responsibility |
|---|---|
| `src/view/ui/run-feed.mjs` | `tailFile` (bytes, inode, bounded lines), `listRuns` (Task 1) |
| `src/view/server.mjs`, `src/view/live.html`, `bin/pantheon-view.mjs` | `/live`, `/ui/*`, `/run`, `/run/events?after=`, `/runs`, `/runs/<name>`; the slow-client queue; `--run` (Task 2) |
| `src/view/ui/run-state.mjs` (additions) | `reduceUntil(rows, t)`, `acceptSeq(last, incoming)` (Task 3) |
| `src/view/ui/replay-clock.mjs` | `sceneTime(clock, nowMs)` and the anchor helpers (Task 3) |
| `src/view/ui/store.js` | live and replay store; selection generation; playback (Task 3) |
| `src/view/ui/panels.js`, `app.js` | scrubber, play/pause/speed, `?replay=&t=&play=`, `statusWord` (Task 4) |
| `src/view/ui/camera.mjs`, `theme.css`, `stage.js` | `fitCamera` and friends; `?stage=1&size=WxH` (Task 5) |
| `scripts/lib/showcase-manifest.mjs`, `scripts/showcase-capture.mjs` | the manifest and the capture recipe (Task 6) |
| `tests/run-feed.test.mjs`, `tests/view-run.test.mjs`, `tests/replay.test.mjs`, `tests/replay-clock.test.mjs`, `tests/ui-status.test.mjs`, `tests/camera.test.mjs`, `tests/showcase-manifest.test.mjs` | oracles |

---

### Task 1: The tail — `run-feed.mjs`

*Ticket.* Depends on nothing in this section.

**Interfaces.** `tailFile(path, onRow, { intervalMs = 250, onReset, onBad }) → { close(), position() }`. Bytes are read from the current offset; complete lines (ending in `0x0a`) are decoded with fatal UTF-8 and parsed; the trailing partial line is held as bytes; a line over 1 MiB is skipped with a diagnostic; a shrink or an inode change resets the offset to 0 and calls `onReset({ why: "shrunk" | "replaced", size })`. `listRuns(dir) → [{ name, path, size, mtime }]` newest first, `[]` for a missing directory.

- [ ] **Step 1: Write the failing oracle**

```js
// file: tests/run-feed.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, utimesSync, renameSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tailFile, listRuns } from "../src/view/ui/run-feed.mjs";
const wait = ms => new Promise(r => setTimeout(r, ms));
const row = (i, extra = {}) => JSON.stringify({ at: "x", elapsed_s: i, stage: "s", event: "stage.start", ...extra }) + "\n";

test("existing rows are read from byte 0, appended rows arrive, and a torn line waits until it is whole", async () => {
  const f = join(mkdtempSync(join(tmpdir(), "feed-")), "progress.jsonl"); writeFileSync(f, row(0) + row(1));
  const got = [], bad = []; const feed = tailFile(f, r => got.push(r), { intervalMs: 50, onBad: b => bad.push(b) });
  try {
    await wait(150); assert.equal(got.length, 2, "the whole file first");
    appendFileSync(f, '{"at":"x","elapsed_s":2,"stage":"s","event":"stage.st');       // the runner is mid-write
    await wait(150); assert.equal(got.length, 2, "a torn line is held, not emitted"); assert.equal(bad.length, 0);
    appendFileSync(f, 'art"}\n' + row(3));
    await wait(200); assert.equal(got.length, 4); assert.equal(got[2].elapsed_s, 2);
    assert.equal(feed.position(), Buffer.byteLength(row(0) + row(1) + row(2) + row(3)));
  } finally { feed.close(); }
});
test("a read that ends inside a multibyte character does not corrupt the row", async () => {
  const f = join(mkdtempSync(join(tmpdir(), "feed-")), "progress.jsonl"); writeFileSync(f, "");
  const got = [], bad = []; const feed = tailFile(f, r => got.push(r), { intervalMs: 50, onBad: b => bad.push(b) });
  try {
    const line = Buffer.from(JSON.stringify({ at: "x", elapsed_s: 1, stage: "s", event: "turn.progress", detail: "12 chars so far ✓ réviseur" }) + "\n");
    const cut = line.indexOf(Buffer.from("✓")) + 1;                               // one byte into the three-byte check mark
    appendFileSync(f, line.subarray(0, cut)); await wait(150);
    assert.equal(got.length, 0); assert.equal(bad.length, 0, "a partial character is not a bad line");
    appendFileSync(f, line.subarray(cut)); await wait(150);
    assert.equal(got.length, 1); assert.equal(got[0].detail, "12 chars so far ✓ réviseur"); assert.equal(bad.length, 0);
  } finally { feed.close(); }
});
test("a shrunk file resets the feed; a same-size file swapped in by rename resets it too", async () => {
  const dir = mkdtempSync(join(tmpdir(), "feed-")), f = join(dir, "progress.jsonl"); writeFileSync(f, row(0) + row(1) + row(2));
  const got = [], resets = []; const feed = tailFile(f, r => got.push(r), { intervalMs: 50, onReset: r => resets.push(r) });
  try {
    await wait(150); assert.equal(got.length, 3);
    writeFileSync(f, row(0, { event: "run.start" }));                                    // shorter: a new run in the same path
    await wait(200); assert.deepEqual(resets.map(r => r.why), ["shrunk"]); assert.equal(got.length, 4); assert.equal(got[3].event, "run.start");
    const same = join(dir, "swap.jsonl"); writeFileSync(same, row(9, { event: "run.start" }));  // same byte length, different inode
    assert.equal(statSync(same).size, statSync(f).size); renameSync(same, f);
    await wait(200); assert.deepEqual(resets.map(r => r.why), ["shrunk", "replaced"]); assert.equal(got.at(-1).elapsed_s, 9);
  } finally { feed.close(); }
});
test("a file that does not exist yet is polled, not thrown on; a bad line is reported with its text; an oversized line is skipped", async () => {
  const f = join(mkdtempSync(join(tmpdir(), "feed-")), "progress.jsonl");
  const got = [], bad = []; const feed = tailFile(f, r => got.push(r), { intervalMs: 50, onBad: b => bad.push(b) });
  try {
    await wait(120); assert.equal(got.length, 0);
    writeFileSync(f, "not json\n" + row(0));
    await wait(200); assert.equal(got.length, 1); assert.equal(bad.length, 1); assert.equal(bad[0].line, "not json");
    appendFileSync(f, JSON.stringify({ at: "x", elapsed_s: 2, stage: "s", event: "x", detail: "y".repeat(1 << 20) }) + "\n" + row(3));
    await wait(300); assert.equal(got.at(-1).elapsed_s, 3); assert.match(bad.at(-1).why, /1 MiB/);
  } finally { feed.close(); }
});
test("listRuns finds directories holding a progress.jsonl, newest first, and ignores the rest", () => {
  const dir = mkdtempSync(join(tmpdir(), "runs-"));
  for (const n of ["older", "newer"]) { mkdirSync(join(dir, n)); writeFileSync(join(dir, n, "progress.jsonl"), row(0)); }
  mkdirSync(join(dir, "empty")); writeFileSync(join(dir, "stray.txt"), "x");
  const old = new Date(Date.now() - 60_000); utimesSync(join(dir, "older", "progress.jsonl"), old, old);
  const runs = listRuns(dir);
  assert.deepEqual(runs.map(r => r.name), ["newer", "older"]); assert.ok(runs[0].path.endsWith("progress.jsonl")); assert.ok(runs[0].size > 0);
  assert.deepEqual(listRuns(join(dir, "nope")), []);
});
```

Run: `node --test tests/run-feed.test.mjs` — Expected: import failure (the baseline).

- [ ] **Step 2: The reference module the oracle was written against**

```js
// file: src/view/ui/run-feed.mjs
// Tail a progress.jsonl the runner is appending to. Bytes in, whole lines out: the torn tail is held as
// bytes so a read that ends inside a multibyte character corrupts nothing; a line is decoded only when
// its newline has arrived, with fatal UTF-8. Reads start at byte 0 so a late-opened view sees the whole
// run. A shrink or a new inode is a new generation: the offset resets and the caller is told why.
// Polling is the ground truth and fs.watch only a hint: a watch on a file replaced under it goes quiet.
import { openSync, readSync, closeSync, statSync, watch, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const NL = 0x0a, MAX_LINE = 1 << 20;

export function tailFile(path, onRow, { intervalMs = 250, onReset = () => {}, onBad = () => {} } = {}) {
  let offset = 0, ino = null, partial = Buffer.alloc(0), closed = false, watcher = null, pumping = false;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const pump = () => {
    if (closed || pumping) return;
    pumping = true;
    try {
      let st; try { st = statSync(path); } catch { return; }                       // not there yet: keep polling
      const replaced = ino != null && st.ino !== ino, shrunk = st.size < offset;
      if (replaced || shrunk) { offset = 0; partial = Buffer.alloc(0); onReset({ why: replaced ? "replaced" : "shrunk", size: st.size }); }
      ino = st.ino;
      if (st.size === offset) return;
      const fd = openSync(path, "r"); let chunk;
      try { chunk = Buffer.alloc(st.size - offset); const n = readSync(fd, chunk, 0, chunk.length, offset); offset += n; chunk = chunk.subarray(0, n); }
      finally { closeSync(fd); }
      const buf = partial.length ? Buffer.concat([partial, chunk]) : chunk;
      let start = 0, nl;
      while ((nl = buf.indexOf(NL, start)) !== -1) {
        const line = buf.subarray(start, nl); start = nl + 1;
        if (line.length === 0) continue;
        if (line.length > MAX_LINE) { onBad({ line: `<${line.length} bytes>`, why: "a line over 1 MiB was skipped" }); continue; }
        let text; try { text = decoder.decode(line); } catch { onBad({ line: line.toString("latin1").slice(0, 80), why: "not valid UTF-8" }); continue; }
        if (!text.trim()) continue;
        try { onRow(JSON.parse(text)); } catch (e) { onBad({ line: text, why: e.message }); }
      }
      partial = Buffer.from(buf.subarray(start));                                   // the torn tail, possibly mid-character
    } finally { pumping = false; }
  };
  pump();
  const timer = setInterval(pump, intervalMs);
  try { watcher = watch(path, () => pump()); watcher.on("error", () => {}); } catch { /* polling covers it */ }
  return { close() { closed = true; clearInterval(timer); watcher?.close(); }, position: () => offset };
}

export function listRuns(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name, "progress.jsonl");
    let st; try { st = statSync(path); } catch { continue; }
    if (st.isFile()) out.push({ name, path, size: st.size, mtime: st.mtimeMs });
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}
```

- [ ] **Step 3: Ticket, launch, ship, commit.** `scripts/tickets/live-view-run-feed.json`: slot/path/source `src/view/ui/run-feed.mjs`, tests_file `tests/run-feed.test.mjs`, acceptance `node --test`, copy `["src","tests","scripts","bin","package.json",".agents"]`, goal = this task's Interfaces plus the module's header comment verbatim. Before launching, `node --test` must fail only in `tests/run-feed.test.mjs`.

```bash
git add tests/run-feed.test.mjs src/view/ui/run-feed.mjs scripts/tickets/live-view-run-feed.json
git commit -m "run-feed: a byte-oriented tail that holds torn lines, decodes whole ones, and resets on shrink or new inode"
```

---

### Task 2: The routes — snapshot, stream after a cursor, replay pages, the page

*By hand.* Refactors `/events` into a helper shared with `/run/events`, so the two streams cannot drift, and gives both a bounded slow-client queue.

**Interfaces.** `createViewServer({ …, runFile = process.env.PANTHEON_RUN ?? null, runsDir = process.env.PANTHEON_RUNS ?? join(cwd, "outputs", "open-items") })` returns `{ server, bus, runBus, runTurn, listen, close }`. `GET /run` → `{ file, cursor, state, stats }` where `cursor` is the bus sequence the state was folded through. `GET /run/events?after=<cursor>` (or `Last-Event-ID`) streams `{ type: "row", row }` and `{ type: "reset" }` messages with `id: <seq>`; a header and a query that disagree are a 400; a cursor that has left the buffer yields the bus's own `gap` message first. `GET /runs` and `GET /runs/<name>` as before. The subscriber cap is one counter across `/events` and `/run/events`.

- [ ] **Step 1: Write the failing test**

```js
// file: tests/view-run.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect } from "node:net";
import { createViewServer } from "../src/view/server.mjs";

const FIX = new URL("./fixtures/progress-streamThinking-shipped.jsonl", import.meta.url).pathname;
const get = (port, path, headers = {}) => fetch(`http://127.0.0.1:${port}${path}`, { headers });
const wait = ms => new Promise(r => setTimeout(r, ms));
// A raw request so the Host header can lie, which fetch() refuses to do (the rebinding case).
const rawGet = (port, path, host) => new Promise((resolve, reject) => {
  const sock = connect(port, "127.0.0.1"); let head = "";
  const t = setTimeout(() => { sock.destroy(); reject(new Error(`no response headers within 2s for ${path}`)); }, 2000);
  sock.on("connect", () => sock.write(`GET ${path} HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`));
  sock.on("data", d => { head += d.toString(); if (head.includes("\r\n\r\n")) { clearTimeout(t); resolve(Number(head.split(" ")[1])); sock.destroy(); } });
  sock.on("error", e => { clearTimeout(t); reject(e); });
});
const openSSE = async (port, path, headers) => { const res = await get(port, path, headers); const reader = res.body.getReader(), dec = new TextDecoder(); let buf = "";
  return { res, readUntil: async (pred, ms) => { const t0 = Date.now(); while (!pred(buf) && Date.now() - t0 < ms) { const { value, done } = await reader.read(); if (done) break; buf += dec.decode(value); } return pred(buf); }, text: () => buf, cancel: () => reader.cancel() }; };
function setup() {
  const home = mkdtempSync(join(tmpdir(), "view-run-")), runs = join(home, "runs");
  mkdirSync(join(runs, "streamThinking"), { recursive: true });
  const file = join(runs, "streamThinking", "progress.jsonl"); writeFileSync(file, readFileSync(FIX));
  return { home, runs, file };
}
const start = async opts => { const srv = createViewServer({ makeClientFor: () => ({}), ...opts }); const { port } = await srv.listen(0); return { srv, port }; };

test("GET /run folds the tailed file through a cursor: shipped, eight passes, the commit", async () => {
  const { home, runs, file } = setup(); const { srv, port } = await start({ home, runFile: file, runsDir: runs });
  try { await wait(300); const r = await (await get(port, "/run")).json();
    assert.equal(r.file, file); assert.equal(r.cursor, 54); assert.equal(r.state.status, "shipped"); assert.deepEqual(r.state.gates.map(g => g.state), Array(8).fill("pass")); assert.equal(r.state.ship.commit, "commit:1bbfe335f394");
  } finally { srv.close(); }
});
test("snapshot at N, a row lands, subscribe after N: the row arrives exactly once, with its id", async () => {
  const { home, runs, file } = setup(); const { srv, port } = await start({ home, runFile: file, runsDir: runs });
  try { await wait(300); const snap = await (await get(port, "/run")).json();
    appendFileSync(file, JSON.stringify({ at: "x", elapsed_s: 999, stage: "ship", event: "reseat", detail: "between-snapshot-and-subscribe" }) + "\n"); await wait(400);
    const s = await openSSE(port, `/run/events?after=${snap.cursor}`);
    assert.ok(await s.readUntil(b => b.includes("between-snapshot-and-subscribe"), 2000));
    assert.equal((s.text().match(/between-snapshot-and-subscribe/g) ?? []).length, 1); assert.ok(s.text().includes(`id: ${snap.cursor + 1}\n`)); assert.ok(!s.text().includes('"event":"run.start"'), "nothing before the cursor is replayed");
    appendFileSync(file, JSON.stringify({ at: "x", elapsed_s: 1000, stage: "ship", event: "reseat", detail: "appended-live" }) + "\n");
    assert.ok(await s.readUntil(b => b.includes("appended-live"), 1500), "a live append streams within a second"); await s.cancel();
  } finally { srv.close(); }
});
test("a cursor that has left the buffer yields a gap message first; a header and a query that disagree are a 400", async () => {
  const { home, runs, file } = setup(); const { srv, port } = await start({ home, runFile: file, runsDir: runs, runBufferCap: 10 });
  try { await wait(300);
    const s = await openSSE(port, "/run/events?after=1"); assert.ok(await s.readUntil(b => b.includes('"type":"gap"'), 2000), "rows 2..44 are gone; the client is told"); await s.cancel();
    assert.equal((await get(port, "/run/events?after=5", { "last-event-id": "6" })).status, 400);
  } finally { srv.close(); }
});
test("a slow client is closed at the queue limit and a healthy one keeps receiving; the cap counts both routes", async () => {
  const { home, runs, file } = setup(); const { srv, port } = await start({ home, runFile: file, runsDir: runs, sseQueueBytes: 4096 });
  try { await wait(300);
    const slow = await get(port, "/run/events?after=0");                               // never read
    const healthy = await openSSE(port, "/run/events?after=54");
    for (let i = 0; i < 40; i++) appendFileSync(file, JSON.stringify({ at: "x", elapsed_s: 2000 + i, stage: "ship", event: "reseat", detail: "x".repeat(400) }) + "\n");
    assert.ok(await healthy.readUntil(b => (b.match(/"event":"reseat"/g) ?? []).length >= 40, 4000), "the healthy client got everything");
    await wait(300); assert.equal(srv.stats().subscribers, 1, "the slow client was closed, the healthy one remains");
    await healthy.cancel(); slow.body.cancel();
  } finally { srv.close(); }
});
test("GET /runs lists recorded runs, GET /runs/<name> returns its rows, and names that could leave the directory are refused", async () => {
  const { home, runs } = setup(); const { srv, port } = await start({ home, runFile: null, runsDir: runs });
  try { const l = await (await get(port, "/runs")).json(); assert.deepEqual(l.runs.map(r => r.name), ["streamThinking"]);
    const r = await (await get(port, "/runs/streamThinking")).json(); assert.equal(r.rows.length, 54); assert.equal(r.rows[0].event, "run.start");
    for (const bad of ["/runs/%2e%2e", "/runs/.hidden", "/runs/nope", "/runs/a%2fb"]) assert.equal((await get(port, bad)).status, 404, bad);
    assert.equal((await (await get(port, "/run")).json()).state.status, "idle", "no file tailed: idle");
  } finally { srv.close(); }
});
test("GET /live carries an import map pinned to the installed react, and /ui/ serves only view modules", async () => {
  const { home, runs } = setup(); const { srv, port } = await start({ home, runFile: null, runsDir: runs });
  try { const html = await (await get(port, "/live")).text(); const v = JSON.parse(readFileSync(new URL("../node_modules/react/package.json", import.meta.url), "utf8")).version;
    assert.ok(html.includes(`"react": "https://esm.sh/react@${v}"`)); assert.ok(html.includes(`react-dom@${v}/client?external=react`)); assert.ok(!html.includes("__IMPORTMAP__"));
    assert.equal((await get(port, "/ui/run-state.mjs")).status, 200); assert.equal((await get(port, "/ui/run-state.mjs")).headers.get("content-type"), "text/javascript; charset=utf-8");
    for (const bad of ["/ui/%2e%2e/server.mjs", "/ui/.env", "/ui/nope.js", "/ui/a%2fb.js"]) assert.equal((await get(port, bad)).status, 404, bad);
  } finally { srv.close(); }
});
test("the Host policy of /events applies to every new route", async () => {
  const { home, runs, file } = setup(); const { srv, port } = await start({ home, runFile: file, runsDir: runs });
  try { for (const p of ["/run", "/run/events", "/runs", "/runs/streamThinking", "/live", "/ui/run-state.mjs"]) assert.equal(await rawGet(port, p, "evil.example"), 403, p); }
  finally { srv.close(); }
});
```

- [ ] **Step 2: The server** — at the top of `src/view/server.mjs`:

```js
import { reduceRun } from "./ui/run-state.mjs";
import { tailFile, listRuns } from "./ui/run-feed.mjs";
const LIVE = fileURLToPath(new URL("./live.html", import.meta.url));
const UI_DIR = fileURLToPath(new URL("./ui/", import.meta.url));
const REACT_PKG = fileURLToPath(new URL("../../node_modules/react/package.json", import.meta.url));
// A name that cannot leave its directory: no leading dot, no slash, no percent-encoding, nothing else.
const NAME_OK = /^(?!\.)[A-Za-z0-9_.-]+$/;
// The browser and the tests run the same React: the import map is written from the version npm installed.
function importMap() {
  let v; try { v = JSON.parse(readFileSync(REACT_PKG, "utf8")).version; } catch { throw new Error("react is not installed: run npm install"); }
  return JSON.stringify({ imports: { "react": `https://esm.sh/react@${v}`, "react-dom/client": `https://esm.sh/react-dom@${v}/client?external=react` } }, null, 2);
}
```

In the signature add `runFile = process.env.PANTHEON_RUN ?? null, runsDir = process.env.PANTHEON_RUNS ?? join(cwd, "outputs", "open-items"), runBufferCap = 5000, sseQueueBytes = 256 * 1024`. After `const bus = createBus();`:

```js
  // The run feed: the runner's progress.jsonl tailed onto its own bus, with the same seq and replay
  // semantics as the seats bus, so /run/events resumes after a cursor exactly as /events does.
  const runBus = createBus({ cap: runBufferCap });
  const feed = runFile
    ? tailFile(runFile, row => runBus.publish({ type: "row", at: Date.now(), row }), { onReset: r => runBus.publish({ type: "reset", at: Date.now(), why: r.why }) })
    : null;
```

Move the body of the `/events` route into `openStream(req, res, url, source)` (the subscriber cap, the headers, `flushHeaders`, the resume, the keep-alive ping, the close handler, and every existing comment), with two changes: the cursor comes from `Last-Event-ID` or `?after=` and a disagreement is a 400; and writes go through a bounded queue:

```js
  function openStream(req, res, url, source) {
    if (subscribers >= MAX_SUBSCRIBERS) {
      return json(res, 503, { error: `too many /events subscribers (${subscribers}/${MAX_SUBSCRIBERS}); close one before opening another` });
    }
    const header = req.headers["last-event-id"], query = url.searchParams.get("after");
    if (header != null && query != null && String(header) !== String(query)) return json(res, 400, { error: "Last-Event-ID and ?after= disagree; send one" });
    const from = Number(header ?? query ?? 0);
    if (!Number.isSafeInteger(from) || from < 0) return json(res, 400, { error: "a cursor is a non-negative safe integer" });
    subscribers++;
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive", "x-accel-buffering": "no" });
    res.flushHeaders();
    // A client that stops reading must not hold the process's memory hostage: past the queue limit it is
    // closed, and it recovers by taking a fresh snapshot. Every other subscriber is unaffected.
    let queued = 0, done = false;
    const finish = () => { if (done) return; done = true; subscribers--; clearInterval(keepAlive); unsubscribe(); try { res.destroy(); } catch { /* gone */ } };
    const send = e => {
      if (done) return;
      const chunk = `id: ${e.seq ?? 0}\ndata: ${JSON.stringify(e)}\n\n`;
      if (!res.write(chunk)) { queued += chunk.length; if (queued > sseQueueBytes) finish(); }
    };
    res.on("drain", () => { queued = 0; });
    const unsubscribe = source.subscribe(send, { from });
    const keepAlive = setInterval(() => { if (!done) res.write(": ping\n\n"); }, 15000);
    req.on("close", finish); res.on("error", finish);
  }
```

Routes, before `/board`:

```js
    if (req.method === "GET" && url.pathname === "/live") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(readFileSync(LIVE, "utf8").replace("__IMPORTMAP__", importMap()));
    }
    if (req.method === "GET" && url.pathname.startsWith("/ui/")) {
      const name = url.pathname.slice(4);
      if (!NAME_OK.test(name)) return json(res, 404, { error: "no such asset" });
      const file = join(UI_DIR, name);
      if (!existsSync(file)) return json(res, 404, { error: "no such asset" });
      res.writeHead(200, { "content-type": name.endsWith(".css") ? "text/css; charset=utf-8" : "text/javascript; charset=utf-8", "x-content-type-options": "nosniff" });
      return res.end(readFileSync(file));
    }
    if (req.method === "GET" && url.pathname === "/run") {
      const rows = runBus.snapshot(); const stats = runBus.stats();
      return json(res, 200, { file: runFile, cursor: stats.seq, state: reduceRun(rows.filter(e => e.type === "row").map(e => e.row)), stats });
    }
    if (req.method === "GET" && url.pathname === "/run/events") return openStream(req, res, url, runBus);
    if (req.method === "GET" && url.pathname === "/runs") {
      return json(res, 200, { dir: runsDir, runs: listRuns(runsDir).map(r => ({ name: r.name, size: r.size, mtime: r.mtime })) });
    }
    const runMatch = /^\/runs\/([^/]+)$/.exec(url.pathname);
    if (req.method === "GET" && runMatch) {
      const name = runMatch[1];
      if (!NAME_OK.test(name)) return json(res, 404, { error: "no such run" });
      const file = join(runsDir, name, "progress.jsonl");
      if (!existsSync(file)) return json(res, 404, { error: `no recorded run named ${name}` });
      const rows = [];
      for (const line of readFileSync(file, "utf8").split("\n")) { if (!line.trim()) continue; try { rows.push(JSON.parse(line)); } catch { /* a torn line is not a row */ } }
      return json(res, 200, { name, rows });
    }
```

Return `{ server, bus, runBus, runTurn, listen, stats: () => ({ subscribers }), close: () => { feed?.close(); server.close(); } }`. `/run`'s `cursor` is `stats.seq` and the state is folded from the same snapshot, so the two cannot disagree; a snapshot folded from an evicted buffer is still the state through `seq`, because eviction drops the oldest rows only after the reducer has seen them on earlier snapshots is *not* true, so `/run` folds from `feed`'s own running state instead: keep `let live = emptyState(), reduceLive = createReducer()` next to the feed, advance them in the feed's `onRow` before publishing, and serve `live` from `/run`. That is the snapshot the uploaded plan calls "the fold of precisely the committed records through cursor", and it is why the test above asserts `cursor === 54`.

`src/view/live.html` and `bin/pantheon-view.mjs` are as in the first draft of this section (unchanged): the page shell with `__IMPORTMAP__`, and the launcher's `--run`, `--runs`, `--port` with the newest run as the default.

- [ ] **Step 3: Install the pin, run everything, commit**

```bash
npm install --save-exact react@19.3.0 react-dom@19.3.0
node --test          # green, including tests/view-events.test.mjs and tests/view-security.test.mjs on the refactored /events
git add src/view/server.mjs src/view/live.html bin/pantheon-view.mjs tests/view-run.test.mjs package.json package-lock.json
git commit -m "view server: /live, /ui, /run with a cursor, /run/events after a cursor with a bounded queue, /runs"
```

---

### Task 3: Replay is three pure functions — `reduceUntil`, `acceptSeq`, `sceneTime`

*Ticket* for `reduceUntil` and `acceptSeq` (one file: `src/view/ui/run-state.mjs`); `replay-clock.mjs` and the store by hand.

**Interfaces.**
- `reduceUntil(rows, t) → state`: folds from the last `run.start` in file order, admitting a row when it is that `run.start`, or its `elapsed_s ≤ t`, or it is a seat row (`SEAT_EVENTS`, or a `turn.*` row for a seat other than the active one) whose parent turn has already been admitted; the first runner row with `elapsed_s > t` ends the fold. `runs` counts every `run.start` in the file, so the state says "run 2 of 2".
- `acceptSeq(lastSeen, incoming) → "next" | "duplicate" | "restart"`: greater is next; less or equal by under 1000 is a duplicate (a replay overlap after reconnect); otherwise a restart (a new bus).
- `sceneTime({ anchorSceneMs, anchorRealMs, speed, playing, endTimeMs }, nowMs) → ms`, the uploaded plan's function verbatim: non-negative, bounded by the end, advancing only while playing.

- [ ] **Step 1: Write the failing oracles**

```js
// file: tests/replay.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { reduceUntil, reduceRun, acceptSeq } from "../src/view/ui/run-state.mjs";
const rows = name => readFileSync(new URL(`./fixtures/progress-streamThinking-${name}.jsonl`, import.meta.url), "utf8").trim().split("\n").map(l => JSON.parse(l));

test("scrubbing the shipped run: the state at each second is the state the live fold had at that second", () => {
  const r = rows("shipped");
  assert.equal(reduceUntil(r, 10).stage, "intake");
  const at60 = reduceUntil(r, 60); assert.equal(at60.stage, "check"); assert.equal(at60.active?.seat, "agy"); assert.equal(at60.acceptance.pass, 525); assert.equal(at60.status, "live");
  const at40 = reduceUntil(r, 40); assert.equal(at40.stage, "work"); assert.equal(at40.active?.seat, "openai"); assert.equal(at40.subagents, 0, "the seat's nested rows are not admitted before their parent turn");
  const at79 = reduceUntil(r, 79); assert.equal(at79.subagents, 1, "the subagent that started 28.17 s into the review is admitted at 78.4 s");
  const end = reduceUntil(r, 1e9); assert.equal(end.status, "shipped"); assert.deepEqual(end, reduceRun(r));
});
test("a file with two runs scrubs within the last run and still knows it is the second", () => {
  const both = [...rows("refused"), ...rows("shipped")];
  const s = reduceUntil(both, 5.2);
  assert.equal(s.runs, 2); assert.equal(s.stage, "intake");
  assert.equal(s.trips[0].end, null, "at 5.2 s the shipped run's first scout (answered at 5.33) is still out; the refused run's (5.02) would have returned");
});
test("sequence acceptance: next, duplicate after a reconnect overlap, restart after a new bus", () => {
  assert.equal(acceptSeq(10, 11), "next"); assert.equal(acceptSeq(10, 10), "duplicate"); assert.equal(acceptSeq(10, 7), "duplicate");
  assert.equal(acceptSeq(5000, 1), "restart"); assert.equal(acceptSeq(0, 1), "next");
});
```

```js
// file: tests/replay-clock.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { sceneTime, seekTo, setPlaying, setSpeed } from "../src/view/ui/replay-clock.mjs";
const clock0 = { anchorSceneMs: 0, anchorRealMs: 1000, speed: 1, playing: false, endTimeMs: 89470 };
test("paused, time does not move; playing, it moves at speed; it never leaves [0, end]", () => {
  assert.equal(sceneTime(clock0, 5000), 0);
  const playing = setPlaying(clock0, true, 1000); assert.equal(sceneTime(playing, 3500), 2500);
  const fast = setSpeed(playing, 8, 3500); assert.equal(sceneTime(fast, 3500), 2500, "a speed change does not jump"); assert.equal(sceneTime(fast, 4500), 10500);
  assert.equal(sceneTime(fast, 1e9), 89470); assert.equal(sceneTime(seekTo(fast, -5, 4500), 4500), 0);
});
test("a backward seek while playing continues from the new point at the same speed", () => {
  const playing = setSpeed(setPlaying(clock0, true, 1000), 4, 1000);
  const sought = seekTo(playing, 20000, 2000); assert.equal(sceneTime(sought, 2000), 20000); assert.equal(sceneTime(sought, 3000), 24000);
});
```

- [ ] **Step 2: The reference additions to `run-state.mjs`**

```js
// Replay is the same fold with a gate on the clock. Seat rows carry the seat's own clock, so they are
// admitted by their parent turn, never by their small elapsed_s. The fold starts at the last run.start,
// with the run counter seeded so the state still says which run of the file this is.
export function reduceUntil(rows, t) {
  const lastStart = rows.reduce((i, r, k) => r.event === "run.start" ? k : i, -1);
  const before = rows.slice(0, Math.max(0, lastStart)).filter(r => r.event === "run.start").length;
  const reduce = createReducer();
  let s = { ...emptyState(), runs: before }, parentOpen = false;
  for (let k = Math.max(0, lastStart); k < rows.length; k++) {
    const r = rows[k];
    if (r.event === "run.start") { s = reduce(s, r); parentOpen = false; continue; }
    if (SEAT_EVENTS.has(r.event) || (/^turn\./.test(r.event) && s.active && r.seat !== s.active.seat)) { if (parentOpen) s = reduce(s, r); continue; }
    if (typeof r.elapsed_s === "number" && r.elapsed_s > t) break;
    s = reduce(s, r);
    parentOpen = s.active != null;
  }
  return s;
}
// After a reconnect the server replays from the cursor, so a repeat is a duplicate; after a server restart
// the bus counts from 1 again, so a large drop is a new feed and the store starts over.
export const acceptSeq = (lastSeen, incoming) => incoming > lastSeen ? "next" : lastSeen - incoming < 1000 ? "duplicate" : "restart";
```

```js
// file: src/view/ui/replay-clock.mjs
// The scene clock for replay, as anchors: a scene time and the real time it was true, a speed, and whether
// it is playing. Every change recomputes the current scene time first and re-anchors both together, so a
// speed change or a seek never jumps. Callers inject nowMs; nothing here reads a clock of its own.
export function sceneTime(clock, nowMs) {
  const delta = clock.playing ? Math.max(0, nowMs - clock.anchorRealMs) * clock.speed : 0;
  return Math.max(0, Math.min(clock.endTimeMs, clock.anchorSceneMs + delta));
}
const reanchor = (clock, nowMs, patch) => ({ ...clock, anchorSceneMs: sceneTime(clock, nowMs), anchorRealMs: nowMs, ...patch });
export const setPlaying = (clock, playing, nowMs) => reanchor(clock, nowMs, { playing });
export const setSpeed = (clock, speed, nowMs) => reanchor(clock, nowMs, { speed });
export const seekTo = (clock, sceneMs, nowMs) => ({ ...clock, anchorSceneMs: Math.max(0, Math.min(clock.endTimeMs, sceneMs)), anchorRealMs: nowMs });
```

- [ ] **Step 3: The store, by hand** — `src/view/ui/store.js`:

```js
// file: src/view/ui/store.js
// One store for live and replay. Live: a snapshot at cursor N, then rows after N over an EventSource, folded
// as they come; a gap or a restart snapshots again. Replay: all rows held, the state re-folded through the
// scene clock. A selection generation makes a late response for an abandoned run harmless.
import { useSyncExternalStore } from "react";
import { createReducer, emptyState, reduceUntil, acceptSeq } from "./run-state.mjs";
import { sceneTime, setPlaying, setSpeed, seekTo } from "./replay-clock.mjs";

export function createRunStore({ now = () => performance.now() } = {}) {
  let reduce = createReducer(), state = emptyState(), finalState = emptyState(), rows = [], lastRowAt = null, lastSeq = 0;
  let mode = "live", conn = "connecting", es = null, snapshot = null, gen = 0;
  let clock = { anchorSceneMs: 0, anchorRealMs: 0, speed: 1, playing: false, endTimeMs: 0 };
  const subs = new Set();
  const maxElapsed = () => rows.reduce((m, r) => Math.max(m, r.elapsed_s ?? 0), 0);
  const publish = () => {
    snapshot = { state, finalState, rows: rows.length, lastRowAt, mode, conn, playing: clock.playing, speed: clock.speed, clock: sceneTime(clock, now()) / 1000, maxElapsed: maxElapsed(),
      board: state.board ? state.board.split("/").pop() : (state.ticket?.key ?? null) };
    for (const fn of subs) fn();
  };
  const push = row => { rows.push(row); state = reduce(state, row); finalState = state; lastRowAt = Date.now(); publish(); };
  const reset = () => { rows = []; state = emptyState(); finalState = state; reduce = createReducer(); lastRowAt = null; lastSeq = 0; publish(); };
  const takeSnapshot = async () => {
    const my = ++gen; const r = await fetch("/run"); if (my !== gen) return null; if (!r.ok) { conn = "error"; publish(); return null; }
    const snap = await r.json(); if (my !== gen) return null;
    reset(); for (const row of snap.stats ? [] : []) push(row);
    state = finalState = snap.state; rows = []; lastSeq = snap.cursor; lastRowAt = Date.now(); publish(); return snap.cursor;
  };
  const connect = async () => {
    mode = "live"; const cursor = await takeSnapshot(); if (cursor == null) return; const my = gen;
    es?.close(); es = new EventSource(`/run/events?after=${cursor}`);
    es.onopen = () => { if (my === gen) { conn = "open"; publish(); } };
    es.onerror = () => { if (my === gen) { conn = "reconnecting"; publish(); } };
    es.onmessage = ev => {
      if (my !== gen) return;
      let e; try { e = JSON.parse(ev.data); } catch { return; }
      if (e.type === "gap") { es.close(); connect(); return; }
      const seq = Number(ev.lastEventId) || 0, verdict = acceptSeq(lastSeq, seq);
      if (verdict === "duplicate") return;
      if (verdict === "restart") { es.close(); connect(); return; }
      lastSeq = seq;
      if (e.type === "row") push(e.row); else if (e.type === "reset") reset();
    };
  };
  const loadReplay = async name => {
    const my = ++gen; mode = "replay"; conn = "replay"; es?.close();
    const r = await fetch(`/runs/${encodeURIComponent(name)}`); if (my !== gen) return;
    if (!r.ok) { conn = "missing"; publish(); return; }
    rows = (await r.json()).rows; if (my !== gen) return;
    finalState = reduceUntil(rows, 1e12); clock = { ...clock, endTimeMs: maxElapsed() * 1000, playing: false }; seek(maxElapsed());
  };
  const refold = () => { state = reduceUntil(rows, sceneTime(clock, now()) / 1000); publish(); };
  const seek = seconds => { clock = seekTo(clock, seconds * 1000, now()); refold(); };
  const play = (on, speed = clock.speed) => { clock = setSpeed(setPlaying(clock, on, now()), speed, now()); refold(); };
  const tick = () => { if (mode === "replay" && clock.playing) { refold(); if (sceneTime(clock, now()) >= clock.endTimeMs) play(false); } };
  const clockNow = () => mode === "replay" ? sceneTime(clock, now()) / 1000 : state.status === "live" && lastRowAt ? state.elapsed_s + (Date.now() - lastRowAt) / 1000 : state.elapsed_s;
  publish();
  return { subscribe: fn => { subs.add(fn); return () => subs.delete(fn); }, getSnapshot: () => snapshot, push, reset, connect, loadReplay, seek, play, tick, clockNow, close: () => es?.close() };
}
export const useRunStore = store => useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
```

The app calls `store.tick()` ten times a second while playing (the panels refold at 10 Hz); the light canvas reads `store.clockNow()` every frame and draws `lights(finalState, t)`, which needs no refold because a light is visible only for trips that started before `t`. Delete the dead `for (const row of snap.stats ? [] : [])` line when writing the file; it is here only because the snapshot's rows are not needed: `/run` already carries the folded state.

- [ ] **Step 4: Ticket for the two functions, then commit**

`scripts/tickets/live-view-replay.json`: slot/path/source `src/view/ui/run-state.mjs`, tests_file `tests/replay.test.mjs`, goal = the `reduceUntil` and `acceptSeq` Interfaces verbatim plus "every existing export keeps its name and behaviour; `tests/run-state.test.mjs` stays green". Before launching, `node --test` must fail only in `tests/replay.test.mjs`.

```bash
git add tests/replay.test.mjs tests/replay-clock.test.mjs src/view/ui/run-state.mjs src/view/ui/replay-clock.mjs src/view/ui/store.js scripts/tickets/live-view-replay.json
git commit -m "replay: reduceUntil, acceptSeq, an anchored scene clock, and a store with a selection generation"
```

---

### Task 4: The scrubber, playback, deep links and the status word

*By hand.*

**Interfaces.** URL: `/live` (live), `/live?replay=<name>` (replay, at the end), `&t=62` (at 62 s), `&play=8` (playing at 8×). `statusWord({ mode, conn, status, quietS })` is pure and lives in `panels.js`.

- [ ] **Step 1: Write the failing test**

```js
// file: tests/ui-status.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { statusWord, Scrubber, clock } from "../src/view/ui/panels.js";
const h = React.createElement;
test("the status word follows mode, connection and quiet time", () => {
  assert.equal(statusWord({ mode: "live", conn: "open", status: "live", quietS: 3 }), "live");
  assert.equal(statusWord({ mode: "live", conn: "open", status: "live", quietS: 61 }), "stalled");
  assert.equal(statusWord({ mode: "live", conn: "reconnecting", status: "live", quietS: 3 }), "reconnecting");
  assert.equal(statusWord({ mode: "live", conn: "open", status: "shipped", quietS: 999 }), "shipped", "a finished run is never stalled");
  assert.equal(statusWord({ mode: "replay", conn: "replay", status: "shipped", quietS: 0 }), "replay");
  assert.equal(statusWord({ mode: "replay", conn: "missing", status: "idle", quietS: 0 }), "missing");
});
test("the scrubber is a labelled range with the clock as its value text, and its buttons say what they do", () => {
  const m = renderToStaticMarkup(h(Scrubber, { snap: { clock: 62, maxElapsed: 89.47, playing: false, speed: 1 }, onSeek: () => {}, onPlay: () => {} }));
  assert.ok(m.includes('type="range"')); assert.ok(m.includes(`aria-valuetext="${clock(62)}"`)); assert.ok(m.includes(">Play<")); assert.ok(m.includes("1:02 of 1:29"));
  assert.ok(renderToStaticMarkup(h(Scrubber, { snap: { clock: 62, maxElapsed: 89.47, playing: true, speed: 8 }, onSeek: () => {}, onPlay: () => {} })).includes(">Pause<"));
});
```

- [ ] **Step 2: In `panels.js`**

```js
export const STALL_S = 60;
export function statusWord({ mode, conn, status, quietS }) {
  if (mode === "replay") return conn === "missing" ? "missing" : "replay";
  if (conn === "reconnecting") return "reconnecting";
  return status === "live" && quietS >= STALL_S ? "stalled" : status;
}
export function Scrubber({ snap, onSeek, onPlay }) {
  const max = Math.ceil(snap.maxElapsed ?? 0), val = snap.clock ?? 0;
  return h("div", { className: "scrubber" },
    h("button", { type: "button", onClick: () => onPlay(!snap.playing, snap.speed) }, snap.playing ? "Pause" : "Play"),
    h("select", { "aria-label": "Speed", value: snap.speed, onChange: e => onPlay(snap.playing, Number(e.target.value)) }, [1, 2, 4, 8].map(s => h("option", { key: s, value: s }, `${s}×`))),
    h("label", { htmlFor: "scrub" }, "Replay"),
    h("input", { id: "scrub", type: "range", min: 0, max, step: 0.1, value: val, onChange: e => onSeek(Number(e.target.value)), "aria-valuetext": clock(val) }),
    h("span", null, `${clock(val)} of ${clock(max)}`));
}
```

In `app.js`: read `replay`, `t` and `play` from the URL; after `loadReplay` resolves, `if (t) store.seek(Number(t))` and `if (play) store.play(true, Number(play))`; while playing, call `store.tick()` from a 100 ms interval; render `h(Scrubber, { snap, onSeek: store.seek, onPlay: store.play })` in replay mode; compute `word` with `statusWord`; on every seek write the clock back with `history.replaceState` so the address bar is always a deep link to the frame on screen.

- [ ] **Step 3: Execute** — `node --test`, then open `/live?replay=streamThinking&t=62`: the header reads Replay 1:02, the caption is the reviewer's sentence, Tab reaches Play, then the speed, then the range; Right arrow moves 0.1 s; Play at 8× reaches 1:29 in about eleven seconds and stops. Commit.

```bash
git add src/view/ui/panels.js src/view/ui/app.js tests/ui-status.test.mjs
git commit -m "replay: scrubber, play at 1-8x, deep links with t=, and the status word as a pure function"
```

---

### Task 5: The camera — one transform for the drawing, the labels and the frame

*By hand.* The composition is drawn once in a 960×520 world; `fitCamera` decides where that world lands in the stage's content box, and both canvases and the DOM labels use the same result.

**Interfaces** (the uploaded plan's, verbatim): `fitCamera({ world, viewport, padding = 24 }) → { scale, tx, ty } | null`, `worldToScreen(p, c)`, `screenToWorld(p, c)`; world and viewport in CSS pixels. The canvases' backing size is the viewport times `min(devicePixelRatio, 2)`; one `setTransform(dpr * scale, 0, 0, dpr * scale, dpr * tx, dpr * ty)` combines both; labels are positioned with `worldToScreen` in CSS pixels. `/live?stage=1` hides both panels and the header; `&size=WxH` fixes the page to that size for a capture.

- [ ] **Step 1: Write the failing test**

```js
// file: tests/camera.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { fitCamera, worldToScreen, screenToWorld } from "../src/view/ui/camera.mjs";
const WORLD = { x: 0, y: 0, width: 960, height: 520 };
test("camera uses one invertible transform", () => {
  const camera = fitCamera({ world: { x: 0, y: 0, width: 1280, height: 720 }, viewport: { width: 960, height: 600 }, padding: 24 });
  const p = { x: 640, y: 360 }, screen = worldToScreen(p, camera), restored = screenToWorld(screen, camera);
  assert.ok(Math.abs(restored.x - p.x) < 1e-9); assert.ok(Math.abs(restored.y - p.y) < 1e-9);
  assert.equal(fitCamera({ world: { x: 0, y: 0, width: 1280, height: 720 }, viewport: { width: 0, height: 0 }, padding: 24 }), null);
});
test("the world is letterboxed, never stretched, and centred, in wide and in tall viewports", () => {
  const wide = fitCamera({ world: WORLD, viewport: { width: 1200, height: 627 }, padding: 24 });
  assert.ok(Math.abs(wide.scale - (627 - 48) / 520) < 1e-9, "height-bound in a 1200x627 frame");
  const tl = worldToScreen({ x: 0, y: 0 }, wide), br = worldToScreen({ x: 960, y: 520 }, wide);
  assert.ok(Math.abs((1200 - br.x) - tl.x) < 1e-9, "equal margins left and right"); assert.ok(Math.abs(tl.y - 24) < 1e-9);
  const tall = fitCamera({ world: WORLD, viewport: { width: 390, height: 800 }, padding: 12 });
  assert.ok(Math.abs(tall.scale - (390 - 24) / 960) < 1e-9, "width-bound on a phone");
  assert.throws(() => fitCamera({ world: { x: 0, y: 0, width: 0, height: 520 }, viewport: { width: 100, height: 100 } }), RangeError);
});
```

- [ ] **Step 2: `camera.mjs`** (verbatim from the uploaded plan)

```js
// file: src/view/ui/camera.mjs
// One transform for everything on the stage: the glass canvas, the light canvas and the DOM labels all ask
// this where a world point lands. A zero-sized viewport (a hidden pane) is null, and callers draw nothing.
export function fitCamera({ world, viewport, padding = 24 }) {
  const width = viewport.width - 2 * padding;
  const height = viewport.height - 2 * padding;
  if (width <= 0 || height <= 0) return null;
  if (world.width <= 0 || world.height <= 0) throw new RangeError("Invalid scene bounds");
  const scale = Math.min(width / world.width, height / world.height);
  return {
    scale,
    tx: (viewport.width - world.width * scale) / 2 - world.x * scale,
    ty: (viewport.height - world.height * scale) / 2 - world.y * scale,
  };
}
export const worldToScreen = (p, c) => ({ x: p.x * c.scale + c.tx, y: p.y * c.scale + c.ty });
export const screenToWorld = (p, c) => ({ x: (p.x - c.tx) / c.scale, y: (p.y - c.ty) / c.scale });
```

- [ ] **Step 3: Wire it** — in `stage.js`, `fit(cvs, ctx)` becomes: measure the wrapper's content box with a `ResizeObserver`, compute `camera = fitCamera({ world: { x: 0, y: 0, width: WIDTH, height: HEIGHT }, viewport, padding: viewport.width < 600 ? 12 : 24 })`, size both canvases to `viewport × min(devicePixelRatio, 2)`, and call `ctx.setTransform(dpr * camera.scale, 0, 0, dpr * camera.scale, dpr * camera.tx, dpr * camera.ty)`; skip drawing when the camera is null. `Labels` takes the camera and positions each label at `worldToScreen(labelAnchor(b), camera)` in pixels. In `theme.css`: `.glass-wrap{position:relative;width:100%;height:min(70vh, 62.5vw)}` (a 16:10-ish box the camera letterboxes into), `body.stage-only header, body.stage-only aside {display:none}`, `body.stage-only .frame{grid-template-columns:1fr;padding:0;height:100vh}`, `body.sized .frame{width:var(--size-w);height:var(--size-h);margin:0 auto;outline:1px solid var(--rule)}`. In `app.js`: `stage` and `size` from the URL set the body classes and the two custom properties.

- [ ] **Step 4: Executed checks, recorded in `STATE.md`**
  - `/live?replay=streamThinking&t=62&stage=1&size=1200x627` at a 1600×900 window: the frame is 1200×627, the world is letterboxed with equal dusk margins, no scrollbar; the screenshot is saved as `docs/design/2026-09-2x-live-view-post-1200x627.png` with its manifest (Task 6).
  - The same at `size=1080x1080`: width-bound, the timeline and caption under the picture, nothing clipped.
  - A 390-wide window without `stage`: the columns stack, the labels stay on their blocks (they moved with the same transform).
  - Hide the tab, resize the window, show it again: no exception in the console, the picture redraws at the new size.

- [ ] **Step 5: Commit**

```bash
node --test && git add src/view/ui/camera.mjs src/view/ui/stage.js src/view/ui/panels.js src/view/ui/theme.css src/view/ui/app.js tests/camera.test.mjs STATE.md
git commit -m "camera: one fitCamera transform for both canvases and the labels; stage-only and sized frames for capture"
```

---

### Task 6: The capture says what it is — the manifest, and the run that proves the stream

*By hand.*

**Interfaces.** `buildShowcaseManifest({ mode, run, cursor, t, viewRevision, viewport, camera, frameMs, source }) → manifest` and `validateShowcaseManifest(m) → { ok, problems }` in `scripts/lib/showcase-manifest.mjs`. `mode` is `live`, `replay` or `fixture`; `run` is the run key; `source` is `{ path, size, sha256 }` of the progress file the frame was folded from; `t` is required for `replay` and forbidden for `live`; `viewRevision` is the git commit of the view. A capture of a fixture stream may never claim `mode: "live"`, and no manifest carries a count that its source does not contain.

- [ ] **Step 1: Write the failing test**

```js
// file: tests/showcase-manifest.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildShowcaseManifest, validateShowcaseManifest } from "../scripts/lib/showcase-manifest.mjs";
const base = { mode: "replay", run: "streamThinking", cursor: 54, t: 62, viewRevision: "3837eda", viewport: { width: 1200, height: 627 }, camera: { scale: 1.11, tx: 66, ty: 24 }, frameMs: 1.4, source: { path: "outputs/open-items/streamThinking/progress.jsonl", size: 40000, sha256: "0".repeat(64) } };
test("a complete replay manifest validates; a replay that calls itself live does not; a live frame carries no t", () => {
  assert.deepEqual(validateShowcaseManifest(buildShowcaseManifest(base)), { ok: true, problems: [] });
  assert.ok(!validateShowcaseManifest(buildShowcaseManifest({ ...base, mode: "live" })).ok, "a frame with a scrubber time is not live");
  assert.ok(validateShowcaseManifest(buildShowcaseManifest({ ...base, mode: "live", t: undefined })).ok);
  assert.ok(!validateShowcaseManifest(buildShowcaseManifest({ ...base, mode: "fixture", claims: { subagents: 112 } })).ok, "a fixture cannot claim counts");
  assert.ok(!validateShowcaseManifest(buildShowcaseManifest({ ...base, source: { ...base.source, sha256: "abc" } })).ok, "a digest is 64 hex characters");
});
```

- [ ] **Step 2: The module**

```js
// file: scripts/lib/showcase-manifest.mjs
// A capture for the post says what it is. Nothing here certifies the run; it makes the frame's provenance
// explicit so nobody has to guess whether a screenshot was live, a replay, or a fixture stream.
const MODES = new Set(["live", "replay", "fixture"]);
export function buildShowcaseManifest(input) {
  const { mode, run, cursor, t, viewRevision, viewport, camera, frameMs, source, claims } = input;
  return { schemaVersion: 1, mode, run, cursor, t, viewRevision, viewport, camera, frameMs, source, claims: claims ?? null, capturedAt: new Date().toISOString() };
}
export function validateShowcaseManifest(m) {
  const problems = [];
  if (!MODES.has(m.mode)) problems.push(`mode must be one of ${[...MODES].join(", ")}`);
  if (typeof m.run !== "string" || !m.run) problems.push("run is required");
  if (!Number.isInteger(m.cursor) || m.cursor < 0) problems.push("cursor is a non-negative integer");
  if (m.mode === "live" && m.t != null) problems.push("a live frame has no scrubber time; call it a replay");
  if (m.mode === "replay" && !(typeof m.t === "number" && m.t >= 0)) problems.push("a replay names its time");
  if (m.mode === "fixture" && m.claims) problems.push("a fixture stream carries no claims about a real run");
  if (typeof m.viewRevision !== "string" || !/^[0-9a-f]{7,40}$/.test(m.viewRevision)) problems.push("viewRevision is a git commit");
  if (!m.viewport || !(m.viewport.width > 0) || !(m.viewport.height > 0)) problems.push("viewport is required");
  if (!m.camera || !(m.camera.scale > 0)) problems.push("camera is required");
  if (!(typeof m.frameMs === "number" && Number.isFinite(m.frameMs))) problems.push("frameMs is a finite number");
  if (!m.source || typeof m.source.path !== "string" || !Number.isInteger(m.source.size) || !/^[0-9a-f]{64}$/.test(m.source.sha256 ?? "")) problems.push("source needs path, size and a sha256");
  return { ok: problems.length === 0, problems };
}
```

- [ ] **Step 3: The capture recipe** — `scripts/showcase-capture.mjs` takes `--run <key> --t <s> --size WxH [--mode replay|live]`, computes the source's size and sha256, reads the view revision from `git rev-parse --short HEAD`, prints the URL to open (`/live?replay=<key>&t=<s>&stage=1&size=WxH`), and writes `docs/design/<date>-live-view-<key>-<t>s-<WxH>.manifest.json` next to where the operator saves the screenshot, after `validateShowcaseManifest` passes; `frameMs` is read from `window.__pantheonView.frameMs` and passed as `--frame-ms`. A manifest that fails validation is not written and the command exits 1.

- [ ] **Step 4: The stream under a real run.** Start the view on the runs directory (`PANTHEON_RUNS=outputs/open-items /usr/bin/node bin/pantheon-view.mjs 7777`), open `/live`, and launch the speed-run ticket per `scripts/tickets/README.md` (keys from the Windows environment, the seat-plan marker first). Watch: every overseer line in the terminal appears in the Turns list within a second; the status word never says Stalled while the terminal is moving. Kill and restart the view mid-run: the page reconnects, Reconnecting then Live, and no line is duplicated (the `acceptSeq` restart path and the snapshot-then-subscribe handoff, executed). When the run ends, `node scripts/check-progress.mjs outputs/open-items/streamThinking/progress.jsonl` exits 0 (and, once Section One's wiring has landed, so does `--expect-additive`). Record in `STATE.md`: the run key, the longest gap between a terminal line and its appearance on screen, and whether the reconnect duplicated anything.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/showcase-manifest.mjs scripts/showcase-capture.mjs tests/showcase-manifest.test.mjs STATE.md docs/design/*.manifest.json docs/design/*.png
git commit -m "showcase: every capture carries a manifest that says whether it was live, replay or fixture"
```

---

## Self-review

**Coverage.** Spec §6 (states) → Task 4's `statusWord`, Task 3's reconnect and generation. §7 (contract) → the fold is reused, nothing parsed twice. §8 (feed, bus, SSE, store, replay) → Tasks 1–3. Camera (spec §4 "still camera", §9 responsive) → Task 5. Honest captures → Task 6. The executed proof of the stream → Task 6 step 4.

**Placeholders.** None. Task 2's `openStream` is described as a move of `src/view/server.mjs:194-220` at commit 3837eda with two changes stated in full. Task 3's store has one line marked for deletion in the text that introduces it.

**Type consistency.** `acceptSeq` returns the three strings the store switches on; `sceneTime`'s clock fields are the ones `setPlaying`, `setSpeed` and `seekTo` produce; `statusWord`'s inputs are the store snapshot's `mode`, `conn`, `state.status` and the app's `quietS`; `Scrubber` reads `snap.clock`, `snap.maxElapsed`, `snap.playing`, `snap.speed`; `fitCamera`'s result is what `stage.js` and `Labels` consume.

**Review Focus.** 1 → Task 1's split-character test; 2 → Task 1's rename test and Task 3's two-run test; 3 → Task 2's race test and gap test; 4 → Task 3's generation (executed in Task 6 step 4 by the restart); 5 → Task 5's null-camera and letterbox tests and its hidden-pane check.

**Proof status.** Task 1's module and oracle and Task 3's `reduceUntil`/`acceptSeq` and their oracle were extracted verbatim from this document into a scratch tree with the two recorded runs and run under `node --test`; the tail, replacement, torn-line, sequence and scrub tests pass; the two-run test in this revision replaces the earlier one whose expectation about the run counter was wrong.

**What this section does not decide.** The picture: whether the centre shows glass blocks or cloaked figures orbiting the work is Section Three, and nothing here changes when that decision changes, because the renderer reads a state and a clock and nothing else.
