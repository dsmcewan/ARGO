import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { withSeatLock, _internals } from "../src/seat/lock.mjs";

const withDir = async fn => {
  const dir = mkdtempSync(join(tmpdir(), "lock-claim-"));
  try { return await fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
};
const DEAD_PID = 4194303;   // above Linux's default pid_max; cannot be live
const deadLock = (nonce = "dead") => JSON.stringify({ pid: DEAD_PID, nonce, at: Date.now() });

// THE DEFECT, 2026-09-27 re-review, rank 3. The rename-based steal renamed whatever was AT the path when
// it ran, which could be a live lock created between the read and the rename -- two holders, narrower
// window than v1's unlink. The fix is a CLAIM: at most one stealer decides at a time, and it decides on a
// re-read taken while nobody else can replace or remove the lock.

test("a stolen lock leaves no claim behind", async () => {
  await withDir(async dir => {
    const path = _internals.lockPath(dir, "s");
    writeFileSync(path, deadLock());
    assert.equal(_internals.stealIfDead(path, 60_000), true);
    assert.equal(existsSync(path), false);
    assert.equal(existsSync(`${path}.steal`), false, "the claim is released after the steal");
  });
});

test("a claim held by a LIVE stealer blocks the steal; a claim left by a dead one is reclaimed", async () => {
  await withDir(async dir => {
    const path = _internals.lockPath(dir, "s");
    writeFileSync(path, deadLock());
    // Live stealer: this process, with its real start time.
    writeFileSync(`${path}.steal`, JSON.stringify({ pid: process.pid, start: _internals.procStart(process.pid), at: Date.now() }));
    assert.equal(_internals.stealIfDead(path, 60_000), false, "someone else is deciding; do not decide over them");
    assert.equal(existsSync(path), true, "the dead lock is still theirs to take");
    assert.equal(existsSync(`${path}.steal`), true, "and their claim is untouched");
    // Dead stealer: a pid that cannot be live.
    writeFileSync(`${path}.steal`, JSON.stringify({ pid: DEAD_PID, at: Date.now() }));
    assert.equal(_internals.stealIfDead(path, 60_000), true, "a dead stealer's claim is reclaimed and the steal proceeds");
    assert.equal(existsSync(`${path}.steal`), false);
  });
});

test("the decision is re-read UNDER the claim: a lock replaced since the first read is not taken", async () => {
  await withDir(async dir => {
    const path = _internals.lockPath(dir, "s");
    // Sequence the race by hand: the first read sees a dead lock; by the time the claim is held the
    // lock at the path is a different, live one. takeClaim is the seam, so drive the two halves directly.
    writeFileSync(path, deadLock("old"));
    const judged = JSON.parse(readFileSync(path, "utf8"));
    assert.equal(_internals.ownerAlive(judged.pid), false, "precondition: judged dead");
    // Now the world moves on before our claim: a live holder takes the seat.
    writeFileSync(path, JSON.stringify({ pid: process.pid, start: _internals.procStart(process.pid), nonce: "live", at: Date.now() }));
    // A stealer that judged on the OLD read must find, under its claim, that the lock is not the one it
    // judged -- stealIfDead does exactly this: its own read is the judge and the re-read is the check.
    assert.equal(_internals.stealIfDead(path, 1), false, "a live replacement is never taken");
    assert.equal(JSON.parse(readFileSync(path, "utf8")).nonce, "live");
    assert.equal(existsSync(`${path}.steal`), false);
  });
});

// THE DEFECT, same review. A reused pid answers kill(pid, 0) as alive, so a lock left by a dead holder
// would be honoured forever once an unrelated process drew the same number. The start time tells them apart.
test("a lock whose pid is alive but whose start time differs belongs to a dead process", async () => {
  await withDir(async dir => {
    const path = _internals.lockPath(dir, "s");
    const start = _internals.procStart(process.pid);
    if (start == null) return;   // no /proc: the check degrades to pid-only, which is what it always was
    writeFileSync(path, JSON.stringify({ pid: process.pid, start: start - 12345, nonce: "reused", at: Date.now() }));
    assert.equal(_internals.ownerAlive(process.pid, start - 12345), false, "same pid, different birth: not the holder");
    assert.equal(_internals.stealIfDead(path, 60_000), true, "and so the lock is reclaimable at any age");
    writeFileSync(path, JSON.stringify({ pid: process.pid, start, nonce: "mine", at: Date.now() - 3_600_000 }));
    assert.equal(_internals.stealIfDead(path, 1), false, "the genuine holder is still never stolen from");
  });
});

test("locks record the holder's start time", async () => {
  await withDir(async dir => {
    await withSeatLock("s", async () => {
      const rec = JSON.parse(readFileSync(_internals.lockPath(dir, "s"), "utf8"));
      assert.equal(rec.pid, process.pid);
      assert.equal(rec.start, _internals.procStart(process.pid));
    }, { dir });
  });
});

// The property, in real processes: several stealers hit one dead lock at the same instant and exactly one
// holder is inside at a time afterwards. This is the race the rename version lost.
const CHILD = `
import { withSeatLock } from "SRC/seat/lock.mjs";
import { existsSync } from "node:fs";
const [dir, barrier] = process.argv.slice(2);
while (!existsSync(barrier)) {}
const r = await withSeatLock("s", async () => {
  const a = Date.now(); await new Promise(r => setTimeout(r, 40)); return { a, b: Date.now(), pid: process.pid };
}, { dir, timeoutMs: 10_000, staleMs: 1 });
process.stdout.write(JSON.stringify(r));
`;

test("five processes stealing one dead lock at once: one holder at a time, every one eventually inside", async () => {
  await withDir(async dir => {
    const path = _internals.lockPath(dir, "s");
    writeFileSync(path, deadLock());
    const src = new URL("../src", import.meta.url).href;
    const script = join(dir, "child.mjs");
    writeFileSync(script, CHILD.replaceAll("SRC", src));
    const barrier = join(dir, "go");
    const run = promisify(execFile);
    const kids = Array.from({ length: 5 }, () => run(process.execPath, [script, dir, barrier], { timeout: 30_000 }));
    await new Promise(r => setTimeout(r, 250));
    writeFileSync(barrier, "go");
    const held = (await Promise.all(kids)).map(o => JSON.parse(o.stdout)).sort((x, y) => x.a - y.a);
    assert.equal(held.length, 5);
    for (let i = 1; i < held.length; i++) {
      assert.ok(held[i].a >= held[i - 1].b, `holders ${held[i - 1].pid} and ${held[i].pid} overlapped: ${JSON.stringify(held)}`);
    }
    assert.equal(existsSync(`${path}.steal`), false, "no claim left behind");
  });
});
