import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { withSeatLock, _internals } from "../src/seat/lock.mjs";

const LOCK_MODULE = fileURLToPath(new URL("../src/seat/lock.mjs", import.meta.url));
const withDir = async fn => {
  const dir = mkdtempSync(join(tmpdir(), "pantheon-lock-"));
  try { return await fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
};

// The property, stated as overlap detection rather than as timing. A counter incremented on
// entry and decremented on exit can only exceed 1 if two holders were inside at once, which is
// true regardless of how fast the machine is — a duration-based assertion would be flaky.
test("concurrent callers in one process never overlap", async () => {
  await withDir(async dir => {
    let inside = 0, maxInside = 0, done = 0;
    const job = () => withSeatLock("seat-a", async () => {
      inside++; maxInside = Math.max(maxInside, inside);
      await new Promise(r => setTimeout(r, 15));
      inside--; done++;
    }, { dir });
    await Promise.all([job(), job(), job(), job(), job()]);
    assert.equal(maxInside, 1, "two holders were inside the critical section at once");
    assert.equal(done, 5, "every caller must eventually run, not be rejected");
  });
});

// The defect this lock exists for is CROSS-process, so the in-process test above cannot prove
// it: the promise chain alone would pass that one. This spawns real processes.
test("concurrent callers in SEPARATE processes never overlap", async () => {
  await withDir(async dir => {
    const worker = join(dir, "worker.mjs");
    // Each process appends enter/exit markers to a shared log. Interleaved markers prove
    // overlap; strictly paired markers prove serialization.
    writeFileSync(worker, `
import { appendFileSync } from "node:fs";
import { withSeatLock } from ${JSON.stringify(LOCK_MODULE)};
const [, , dir, log, id] = process.argv;
await withSeatLock("shared-seat", async () => {
  appendFileSync(log, \`enter \${id}\\n\`);
  await new Promise(r => setTimeout(r, 120));
  appendFileSync(log, \`exit \${id}\\n\`);
}, { dir });
`);
    const log = join(dir, "log.txt");
    // spawnSync would serialize by construction and prove nothing, so all four are launched
    // before any is awaited.
    const { spawn } = await import("node:child_process");
    const running = ["a", "b", "c", "d"].map(id =>
      new Promise((resolve, reject) => {
        const p = spawn(process.execPath, [worker, dir, log, id], { stdio: "inherit" });
        p.on("exit", code => (code === 0 ? resolve(id) : reject(new Error(`${id} exited ${code}`))));
      }));
    await Promise.all(running);

    const lines = readFileSync(log, "utf8").trim().split("\n");
    assert.equal(lines.length, 8, `expected 4 enter/exit pairs, got:\n${lines.join("\n")}`);
    for (let i = 0; i < lines.length; i += 2) {
      const [ev1, id1] = lines[i].split(" ");
      const [ev2, id2] = lines[i + 1].split(" ");
      assert.equal(ev1, "enter");
      assert.equal(ev2, "exit");
      assert.equal(id1, id2, `process ${id1} was interrupted by ${id2} — the lock did not hold across processes`);
    }
  });
});

test("the lock is released when the body throws", async () => {
  await withDir(async dir => {
    await assert.rejects(() => withSeatLock("s", async () => { throw new Error("boom"); }, { dir }), /boom/);
    let ran = false;
    await withSeatLock("s", async () => { ran = true; }, { dir });
    assert.equal(ran, true, "a throw must not leave the seat locked forever");
    assert.deepEqual(readdirSync(dir).filter(f => f.endsWith(".lock")), [], "no lock file may survive");
  });
});

// One failed turn must not poison the per-key queue for every later turn in this process.
test("a rejected holder does not break the queue behind it", async () => {
  await withDir(async dir => {
    const bad = withSeatLock("s", async () => { throw new Error("first fails"); }, { dir });
    const good = withSeatLock("s", async () => "second ok", { dir });
    await assert.rejects(() => bad, /first fails/);
    assert.equal(await good, "second ok");
  });
});

test("different seats do not block each other", async () => {
  await withDir(async dir => {
    let bStarted = false;
    const a = withSeatLock("seat-a", async () => {
      await new Promise(r => setTimeout(r, 60));
      // b must have been able to start while a was still holding its own lock.
      assert.equal(bStarted, true, "a lock on one seat must not serialize a different seat");
    }, { dir });
    const b = withSeatLock("seat-b", async () => { bStarted = true; }, { dir });
    await Promise.all([a, b]);
  });
});

// A dead owner must be reclaimed, or one crash wedges that seat permanently.
test("a lock left by a dead process is reclaimed", async () => {
  await withDir(async dir => {
    const path = _internals.lockPath(dir, "s");
    // pid 2^22 is above Linux's default pid_max and cannot be live.
    writeFileSync(path, JSON.stringify({ pid: 4194303, nonce: "dead", at: Date.now() }));
    let ran = false;
    await withSeatLock("s", async () => { ran = true; }, { dir, timeoutMs: 3000 });
    assert.equal(ran, true, "a provably dead owner's lock must be reclaimable");
  });
});

// The regression that matters most: my first version stole from a LIVE owner once the lock
// aged past staleMs, which would hand a second process a seat mid-conversation.
test("a LIVE owner's lock is never stolen, however old it looks", async () => {
  await withDir(async dir => {
    const path = _internals.lockPath(dir, "s");
    // Held by THIS process, which is certainly alive, and dated far in the past.
    writeFileSync(path, JSON.stringify({ pid: process.pid, nonce: "mine", at: Date.now() - 3_600_000 }));
    assert.equal(_internals.stealIfDead(path, 1), false, "a live owner must not be stolen from at any age");
    assert.equal(existsSync(path), true);
    await assert.rejects(
      () => withSeatLock("s", async () => "never", { dir, timeoutMs: 250, staleMs: 1 }),
      /timed out/,
      "waiting must time out rather than silently stealing a live holder's lock");
  });
});

// An unreadable lock is the one case where age may decide, or a truncated file wedges the seat.
test("an unreadable lock file is reclaimed only after staleMs", async () => {
  await withDir(async dir => {
    const path = _internals.lockPath(dir, "s");
    writeFileSync(path, "{ truncated");
    assert.equal(_internals.stealIfDead(path, 60_000), false, "a fresh unreadable lock is not yet stale");
    assert.equal(_internals.stealIfDead(path, 0), true, "past staleMs it must be reclaimable");
  });
});

// After a steal, the original owner must not delete the new owner's lock.
test("release only removes a lock this holder still owns", async () => {
  await withDir(async dir => {
    const path = _internals.lockPath(dir, "s");
    writeFileSync(path, JSON.stringify({ pid: process.pid, nonce: "theirs", at: Date.now() }));
    assert.equal(_internals.releaseFileLock(path, "mine"), false, "must not release someone else's lock");
    assert.equal(existsSync(path), true);
    assert.equal(_internals.releaseFileLock(path, "theirs"), true);
  });
});

test("withSeatLock validates its arguments instead of locking nothing", async () => {
  await withDir(async dir => {
    await assert.rejects(() => withSeatLock("", async () => {}, { dir }), /seatKey is required/);
    await assert.rejects(() => withSeatLock("s", null, { dir }), /fn is required/);
    await assert.rejects(() => withSeatLock("s", async () => {}, {}), /dir is required/);
  });
});

test("a seat key with path separators cannot escape the lock directory", async () => {
  await withDir(async dir => {
    await withSeatLock("../../etc/passwd", async () => {}, { dir });
    const escaped = _internals.lockPath(dir, "../../etc/passwd");
    assert.ok(escaped.startsWith(dir), `lock path escaped its directory: ${escaped}`);
  });
});
