// Human-authored oracle for ticket seatLockContentionRace ("two holders of one advisory seat lock
// overlap under contention"). Written BEFORE the seat changes src/seat/lock.mjs; baselined
// reproducibly failing (not deterministically -- see below) against the code as it stood on
// 2026-09-28.
//
// tests/seat-lock-claim.test.mjs already asserts this exact property with 5 racing processes, and
// has for a while; it almost never fails alone (0/26 runs measured across two separate sessions
// today) but was OBSERVED to fail during a real, CPU-loaded full-suite run that day (two holders
// overlapped by ~40ms; outputs/open-items/conformParallel/repro-rev1.txt). Raising the racer count
// makes the same race self-contained and reliably observable without needing external load:
// measured today, 40 processes racing one pre-seeded dead lock overlapped in roughly 4 of 5 runs
// (pids and exact overlapping windows recorded, e.g. two holders starting within 0-2ms of each
// other and running their full ~40ms critical sections concurrently -- not a boundary rounding
// error, a genuine double hold). This file does NOT replace tests/seat-lock-claim.test.mjs (do not
// edit that file); it adds a harsher version of the same property at higher contention so CI
// reliably catches what today's default level does not.
//
// This is a STOCHASTIC oracle, stated honestly: a single round is not deterministic, so the
// acceptance check below runs several independent rounds and requires INDEPENDENT VERIFICATION
// evidence for its own oracle -- rounds attempted and any raw failure need to be inspectable, not
// just a top-line pass/fail, because a silently-vanishing race is exactly the failure mode a weak
// check would produce here.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { _internals } from "../src/seat/lock.mjs";

const run = promisify(execFile);
const SRC = new URL("../src", import.meta.url).href;
const RACERS = 40;
const ROUNDS = 5;

const CHILD = `
import { withSeatLock } from "SRC/seat/lock.mjs";
import { existsSync } from "node:fs";
const [dir, barrier] = process.argv.slice(2);
while (!existsSync(barrier)) {}
const r = await withSeatLock("s", async () => {
  const a = Date.now(); await new Promise(r => setTimeout(r, 40)); return { a, b: Date.now(), pid: process.pid };
}, { dir, timeoutMs: 15_000, staleMs: 1 });
process.stdout.write(JSON.stringify(r));
`;

function deadLock() {
  // A pid that (almost certainly) does not exist and never will on this machine, so every racer
  // sees it as dead from the first read -- matching tests/seat-lock-claim.test.mjs's own deadLock().
  return JSON.stringify({ pid: 999999, start: null, nonce: "x0", at: Date.now() - 10_000 });
}

async function oneRound() {
  const dir = mkdtempSync(join(tmpdir(), "pantheon-lock-contention-"));
  try {
    const path = _internals.lockPath(dir, "s");
    writeFileSync(path, deadLock());
    const script = join(dir, "child.mjs");
    writeFileSync(script, CHILD.replaceAll("SRC", SRC));
    const barrier = join(dir, "go");
    const kids = Array.from({ length: RACERS }, () => run(process.execPath, [script, dir, barrier], { timeout: 30_000 }));
    await new Promise(r => setTimeout(r, 200));
    writeFileSync(barrier, "go");
    const held = (await Promise.all(kids)).map(o => JSON.parse(o.stdout)).sort((x, y) => x.a - y.a);
    assert.equal(held.length, RACERS, `all ${RACERS} racers must report; got ${held.length}`);
    for (let i = 1; i < held.length; i++) {
      if (held[i].a < held[i - 1].b) {
        return { overlap: true, pair: [held[i - 1], held[i]], all: held };
      }
    }
    return { overlap: false };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test(`${RACERS} processes racing one dead lock, ${ROUNDS} independent rounds: no round may show two holders overlapping`, async () => {
  const results = [];
  for (let i = 0; i < ROUNDS; i++) results.push(await oneRound());
  const overlaps = results.filter(r => r.overlap);
  assert.equal(overlaps.length, 0,
    `${overlaps.length} of ${ROUNDS} round(s) showed two holders inside the critical section at once ` +
    `(mutual exclusion violated): ${JSON.stringify(overlaps.map(o => o.pair))}. ` +
    "This is the same property tests/seat-lock-claim.test.mjs already checks at 5 racers; raising the " +
    "count to 40 makes the race self-contained and reliably observable in one invocation instead of " +
    "needing a loaded machine to hit by chance.");
});
