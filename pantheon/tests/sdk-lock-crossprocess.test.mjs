import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { loadSeat } from "../src/seat/store.mjs";
import { loadHistoryState } from "../src/sdk/history.mjs";

// The seat lock was proven as a module (tests/seat-lock.test.mjs: four real processes, one inside at a
// time) and never through sdkTurn itself -- so "sdkTurn is serialised per seat across processes" was an
// inference from two facts, not an observed one. This drives sdkTurn in two real processes on one seat.
//
// CHECKPOINTS, NOT TIMESTAMPS. The first version compared B's entry time with A's `ended`, stamped
// after sdkTurn returned -- i.e. after the lock was released. Under a loaded full suite A could be
// descheduled between release and that stamp, and B's lawful entry read as a 2 ms "overlap". The
// invariant is not about clocks: while A is inside the protected operation (read -> model call ->
// persist), B must not get in; and once B does, it must see what A committed. Both are tested by
// holding A at a checkpoint and by what B's model call receives.
//
// Signals are files in the seat home:
//   <me>-asked  written just before sdkTurn
//   <me>-in     written when the fake model call starts (inside the lock)
//   <me>-go     the model call waits for this before replying (only when the child is told to hold)
//   <me>-exited written as the last act of the process
const CHILD = `
import { sdkTurn } from "SRC/sdk/seat-sdk.mjs";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const [home, me, hold, exitDelayMs] = process.argv.slice(2);
const sig = name => join(home, me + "-" + name);
const sleep = ms => new Promise(r => setTimeout(r, ms));
let n = 0, sawInput = null;
const client = { responses: { create: async params => {
  n++;
  sawInput ??= JSON.stringify(params.input ?? null);
  writeFileSync(sig("in"), "");
  // Bounded: if the parent's assertion fails before releasing us, a held child must not hang the run.
  const t0 = Date.now();
  if (hold === "hold") while (!existsSync(sig("go"))) {
    if (Date.now() - t0 > 15000) { process.stderr.write("held past 15s, never released"); process.exit(3); }
    await sleep(5);
  }
  return { id: "resp_" + process.pid + "_" + n, output_text: "reply to " + me,
    output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "reply to " + me }] }] };
} } };
writeFileSync(sig("asked"), "");
const r = await sdkTurn({ vendor: "openai", purpose: "xproc", cwd: "/c", prompt: "from " + me, client, home, continuity: "replay" });
process.stdout.write(JSON.stringify({ ok: r.ok, why: r.why ?? null, sawInput }));
await sleep(Number(exitDelayMs));   // harmless scheduling delay AFTER the lock is released
writeFileSync(sig("exited"), "");
`;

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(path, what, ms = 10_000) {
  const t0 = Date.now();
  while (!existsSync(path)) {
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
    await sleep(5);
  }
}

function setup() {
  const home = mkdtempSync(join(tmpdir(), "xproc-"));
  const script = join(home, "child.mjs");
  writeFileSync(script, CHILD.replaceAll("SRC", new URL("../src", import.meta.url).href));
  const run = promisify(execFile);
  const spawnChild = (me, hold, exitDelayMs = 0) =>
    run(process.execPath, [script, home, me, hold, String(exitDelayMs)], { env: { ...process.env, PANTHEON_HOME: home } })
      .then(o => JSON.parse(o.stdout));
  return { home, sig: (me, name) => join(home, `${me}-${name}`), spawnChild };
}

function assertNothingLost(home) {
  const seat = { vendor: "openai", purpose: "xproc", cwd: "/c" };
  const rec = loadSeat(seat, { home });
  assert.equal(rec.exchanges.length, 4, "both turns' exchanges are in the seat record");
  assert.equal(rec.chain.length, 4);
  const hist = loadHistoryState(seat, { home, acknowledged: rec.history_len });
  assert.equal(hist.messages.length, 4, "both turns are in the replay history");
  assert.equal(hist.pending, false);
  assert.equal(rec.history_len, 4, "the seat acknowledged all four");
}

test("two processes taking turns on one seat through sdkTurn lose nothing and never overlap", async () => {
  const { home, sig, spawnChild } = setup();
  const kids = [];
  try {
    const a = spawnChild("alpha", "hold"); kids.push(a);
    await until(sig("alpha", "in"), "alpha to enter the protected operation");

    const b = spawnChild("beta", "nohold"); kids.push(b);
    await until(sig("beta", "asked"), "beta to ask for the seat");
    // Beta is now blocked on the lock, or wrongly inside. Give it far longer than an uncontended turn
    // needs (the probe that diagnosed the old flake saw ~15 ms from release to entry).
    await sleep(400);
    assert.equal(existsSync(sig("beta", "in")), false, "beta entered while alpha held the protected operation");

    writeFileSync(sig("alpha", "go"), "");
    const [ra, rb] = await Promise.all([a, b]);
    assert.equal(ra.ok, true, ra.why);
    assert.equal(rb.ok, true, rb.why);

    // Beta's read happened after alpha's persist: the history beta replayed already holds alpha's
    // committed exchange. This covers the read and persist halves that a held model call alone does not.
    assert.match(rb.sawInput, /reply to alpha/, "beta did not see alpha's committed history");
    assert.doesNotMatch(ra.sawInput, /reply to beta/, "alpha went first and saw nothing of beta");

    assertNothingLost(home);
  } finally {
    // Release any child still held at its checkpoint, and wait for it, so a failed assertion above
    // reports instead of leaving a process (and this run) waiting forever.
    try { writeFileSync(sig("alpha", "go"), ""); } catch { /* home already gone */ }
    await Promise.allSettled(kids);
    rmSync(home, { recursive: true, force: true });
  }
});

test("a delay after the lock is released is not an overlap", async () => {
  // The scenario the timestamp version misreported: alpha releases, then is slow to return and exit.
  // Beta must be let in during that window, and nothing in this test may call that a violation.
  const { home, sig, spawnChild } = setup();
  const kids = [];
  try {
    const a = spawnChild("alpha", "hold", 300); kids.push(a);
    await until(sig("alpha", "in"), "alpha to enter the protected operation");
    const b = spawnChild("beta", "nohold"); kids.push(b);
    await until(sig("beta", "asked"), "beta to ask for the seat");
    writeFileSync(sig("alpha", "go"), "");

    await until(sig("beta", "in"), "beta to enter after alpha released");
    assert.equal(existsSync(sig("alpha", "exited")), false,
      "precondition: beta entered while alpha's process was still alive, the window the old assertion misread");

    const [ra, rb] = await Promise.all([a, b]);
    assert.equal(ra.ok, true, ra.why);
    assert.equal(rb.ok, true, rb.why);
    assert.match(rb.sawInput, /reply to alpha/);
    assertNothingLost(home);
  } finally {
    // Release any child still held at its checkpoint, and wait for it, so a failed assertion above
    // reports instead of leaving a process (and this run) waiting forever.
    try { writeFileSync(sig("alpha", "go"), ""); } catch { /* home already gone */ }
    await Promise.allSettled(kids);
    rmSync(home, { recursive: true, force: true });
  }
});
