// Advisory inter-process lock, keyed by seat. Closes evidence §U2.
//
// The defect: sdkTurn reads the seat record and the history, mutates both, and writes them back.
// Two processes doing that concurrently on one seat both read the old state and the second write
// wins — a lost update. Atomic rename makes each FILE consistent and does nothing about a lost
// update across a read-modify-write pair, which is why "the writes are atomic" was not a defence.
//
// Found by grok-4.20-multi-agent reviewing this project's own design; the working approach was
// then produced by gpt-6-sol under delegation and verified by execution (4 concurrent holders,
// maxInside 1). This implementation is written from that verified approach rather than pasted,
// because generated code that passes one probe is not the same as code whose failure modes have
// been thought about — specifically the three below, none of which that probe exercised.
//
// THREE HAZARDS A NAIVE FILE LOCK GETS WRONG:
//
// 1. A holder that dies leaves the lock file behind and every future turn on that seat blocks
//    forever. So the lock records its pid and is STOLEN when the owner is provably gone.
// 2. Stealing introduces its own bug: the original owner may still be alive and simply slow, and
//    would then delete the thief's lock on release. Each holder writes a random nonce and
//    releases only if the nonce on disk is still its own.
// 3. Two async callers in the SAME process would spin against each other through the filesystem,
//    and a nested call would deadlock against itself. An in-process queue per key serialises
//    those first, so the file lock only ever arbitrates BETWEEN processes.
import { mkdirSync, writeFileSync, readFileSync, unlinkSync, openSync, closeSync, fstatSync, linkSync } from "node:fs";
import { join, dirname } from "node:path";
import { randomBytes, createHash } from "node:crypto";

const DEFAULT_STALE_MS = 120_000;   // only ever applies to an UNREADABLE lock file
// A seat turn holds the lock across a model call, and a slow vendor turn here has been
// measured at 480s. A timeout shorter than a legitimate turn converts "someone else is working"
// into a spurious failure, so this is generous by design; it exists to break genuine deadlock,
// not to bound queueing.
const DEFAULT_TIMEOUT_MS = 600_000;

// One promise chain per key, per process. Keyed by dir+key so two different lock directories
// (tests, isolated homes) never serialise against each other.
const inProcess = new Map();

const lockPath = (dir, key) => join(dir, `${String(key).replace(/[^A-Za-z0-9._-]/g, "_")}.lock`);

// The kernel's start time for a pid, in clock ticks (Linux /proc; null elsewhere). A pid can be reused
// after its owner dies, and a reused pid answers kill(pid, 0) as alive -- so a lock left by a dead holder
// would be honoured forever if some unrelated process later drew the same number. Recording the start
// time at acquire and comparing it here tells the two apart. Best effort: without /proc the check
// degrades to the pid alone, which is what it always was.
function procStart(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const rest = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    const v = Number(rest[19]);                                   // field 22 overall; comm may contain spaces
    return Number.isFinite(v) ? v : null;
  } catch { return null; }
}

function ownerAlive(pid, start = null) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  let exists;
  try {
    process.kill(pid, 0);          // signal 0 tests existence without delivering anything
    exists = true;
  } catch (e) {
    // EPERM means it exists and belongs to someone else — alive, and not ours to steal.
    exists = e.code === "EPERM";
  }
  if (!exists) return false;
  // Same pid, different start time: the process that took the lock is gone and the number was reused.
  if (start != null) { const now = procStart(pid); if (now != null && now !== start) return false; }
  return true;
}

function readLock(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;                   // absent, truncated, or mid-write: treated as unknown owner
  }
}

// Exclusive creation must publish the OWNER as well as the pathname atomically.
//
// With open('wx') followed by write, A could create an empty lock and be descheduled.
// B could age that empty file past staleMs, take a claim, re-read it as empty and unlink
// it. A then wrote its now-unlinked fd and entered, while B created another lock and
// entered too. The same publication gap in .steal let B unlink A's still-empty claim,
// allowing two stealers to pass their final checks before either unlinked the lock.
//
// Prepare a private file, then hard-link it into place. link fails with EEXIST without
// replacing anything, and a successful publication is already complete and readable.
// The temporary file is on the same filesystem as the destination.
function publishExclusive(path, record) {
  const temporary = join(dirname(path), `.seat-lock-${process.pid}-${randomBytes(16).toString("hex")}.tmp`);
  const fd = openSync(temporary, "wx");
  try {
    try {
      writeFileSync(fd, JSON.stringify(record));
    } finally {
      closeSync(fd);
    }
    linkSync(temporary, path);
  } finally {
    try { unlinkSync(temporary); } catch { /* an unpublished private file cannot hold the lock */ }
  }
}

// Read the contents and identity from the same open file. Identity matters especially
// for unreadable locks: "both failed JSON parsing" does not mean "the same lock".
// Do not include ctime or link count: removing a publication's temporary hard link
// changes those without changing its identity or contents.
function lockSnapshot(path) {
  let fd;
  try {
    fd = openSync(path, "r");
    const raw = readFileSync(fd, "utf8");
    const stat = fstatSync(fd);
    let record = null;
    try { record = JSON.parse(raw); } catch { /* unknown owner */ }
    return {
      record,
      mtimeMs: stat.mtimeMs,
      identity: JSON.stringify([stat.dev, stat.ino, stat.size, stat.mtimeMs, raw]),
    };
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function maySteal(snapshot, staleMs) {
  if (!snapshot) return false;
  const owner = snapshot.record;
  if (owner && Number.isInteger(owner.pid)) {
    return !ownerAlive(owner.pid, owner.start);
  }
  return Date.now() - snapshot.mtimeMs >= staleMs;
}

// NEVER steal from a live owner, at any age.
//
// My first version stole once the lock aged past staleMs even when the pid was alive, reasoning
// that an old lock is a stuck lock. That is wrong here and would have broken the exact case this
// lock protects: a seat turn holds the lock across a model call that can legitimately run for
// minutes, so an age-based steal hands a second process the same seat mid-conversation and
// recreates the lost update it was added to prevent. Age is only the fallback for a lock whose
// owner CANNOT BE DETERMINED — an unreadable or truncated file — where refusing forever would
// wedge the seat permanently.
// THE STEAL IS A CLAIM, NOT A RENAME. Two versions of this got it wrong, and the second was found by the
// 2026-09-27 re-review a few hours after it shipped:
//
//   v1  read owner -> judge dead -> unlink -> create.        A and B both judge dead; B unlinks A's FRESH
//                                                            lock; two holders.
//   v2  read owner -> judge dead -> rename aside -> create.  Only one rename wins -- but it renames
//                                                            whatever is AT the path when it runs, which
//                                                            can be a live lock created between the read
//                                                            and the rename. Same two holders, narrower
//                                                            window.
//
// The fault in both is deciding on one read and acting on another. This version holds a CLAIM while it
// decides: `<lock>.steal` is published exclusively, so at most one stealer is inside at a time; under the
// claim the lock is re-read, and it is removed only if it is STILL the exact lock that was judged dead.
// Nobody else can replace the lock while it exists (exclusive publication fails on it) and nobody
// else can remove a dead owner's lock (they need the claim), so the re-read is authoritative.
// A stealer that dies holding the claim leaves a `.steal` with its pid in it; the same dead-owner
// rule reclaims that.
function takeClaim(claim) {
  try {
    publishExclusive(claim, {
      pid: process.pid,
      start: procStart(process.pid),
      nonce: randomBytes(16).toString("hex"),
      at: Date.now(),
    });
    return true;
  } catch (e) {
    if (e.code !== "EEXIST") return false;
  }

  const judged = lockSnapshot(claim);
  if (!maySteal(judged, DEFAULT_STALE_MS)) return false;

  // Reclaiming a dead claim needs exclusion too. Otherwise two reclaimers can read
  // the dead claim, and the slower unlink can delete the faster one's NEW live claim.
  // Use a recovery claim keyed by the exact dead incarnation, then re-verify under it.
  // A delayed reclaimer may recreate this recovery claim after cleanup, but its
  // identity check then rejects the replacement at `claim`.
  //
  // Recovery claims use this same protocol if their owner dies. Hashing keeps paths
  // bounded even through several such crashes. All contenders for one incarnation
  // derive the same name, including callers using different spellings of the directory.
  const digest = createHash("sha256").update(judged.identity).digest("hex");
  const recovery = join(dirname(claim), `.seat-claim-reap-${digest}`);
  if (!takeClaim(recovery)) return false;
  let removed = false;
  try {
    const now = lockSnapshot(claim);
    if (now && now.identity === judged.identity && maySteal(now, DEFAULT_STALE_MS)) {
      try {
        unlinkSync(claim);
        removed = true;
      } catch { /* absent or inaccessible; retry on the next acquisition attempt */ }
    }
  } finally {
    // Our fully published recovery claim has a live owner, so nobody may reclaim it.
    // Remove the dead parent BEFORE releasing this guard.
    try { unlinkSync(recovery); } catch { /* a dead owner can be reclaimed on a later attempt */ }
  }
  return removed ? takeClaim(claim) : false;
}

function stealIfDead(path, staleMs) {
  const judged = lockSnapshot(path);
  if (!maySteal(judged, staleMs)) return false;
  const claim = `${path}.steal`;
  if (!takeClaim(claim)) return false;
  try {
    const now = lockSnapshot(path);
    // Re-verify both identity and eligibility while holding the exclusive claim.
    // This includes rechecking age for an unknown owner, not just JSON parse failure.
    if (!now || now.identity !== judged.identity || !maySteal(now, staleMs)) return false;
    try { unlinkSync(path); } catch { return false; }
    return true;
  } finally {
    try { unlinkSync(claim); } catch { /* best effort; a stale claim is reclaimed by the next stealer */ }
  }
}

async function acquireFileLock(path, { staleMs, timeoutMs, nonce }) {
  const deadline = Date.now() + timeoutMs;
  let waitMs = 2;
  for (;;) {
    try {
      // Publish a complete owner record with an atomic, non-replacing test-and-set.
      publishExclusive(path, { pid: process.pid, start: procStart(process.pid), nonce, at: Date.now() });
      return true;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      if (Date.now() >= deadline) {
        const held = readLock(path);
        throw new Error(
          `withSeatLock: timed out after ${timeoutMs}ms waiting for ${path}` +
          (held ? ` (held by pid ${held.pid} since ${new Date(held.at).toISOString()})` : ""));
      }
      stealIfDead(path, staleMs);
      await new Promise(r => setTimeout(r, waitMs));
      waitMs = Math.min(waitMs * 2, 50);   // backoff, capped so a freed lock is taken promptly
    }
  }
}

function releaseFileLock(path, nonce) {
  // Only delete a lock we still own. After a steal, the file on disk belongs to someone else and
  // unlinking it would release THEIR critical section while they are inside it.
  const held = readLock(path);
  if (held && held.nonce !== nonce) return false;
  try { unlinkSync(path); return true; } catch { return false; }
}

/**
 * Run `fn` holding an advisory lock for `seatKey`. Releases on success and on throw.
 * Cross-process via an exclusive-create lock file; within a process, callers queue.
 */
export async function withSeatLock(seatKey, fn, {
  dir, staleMs = DEFAULT_STALE_MS, timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  if (!seatKey) throw new Error("withSeatLock: seatKey is required");
  if (typeof fn !== "function") throw new Error("withSeatLock: fn is required");
  if (!dir) throw new Error("withSeatLock: dir is required");
  mkdirSync(dir, { recursive: true });

  const path = lockPath(dir, seatKey);
  const chainKey = `${dir}\0${seatKey}`;
  const prior = inProcess.get(chainKey) ?? Promise.resolve();

  const run = prior.then(async () => {
    const nonce = randomBytes(8).toString("hex");
    await acquireFileLock(path, { staleMs, timeoutMs, nonce });
    try {
      return await fn();
    } finally {
      releaseFileLock(path, nonce);
    }
  });

  // The chain must not break on rejection, or one failed turn poisons every later turn on that
  // seat in this process. Swallow here only for the chain; `run` still rejects to the caller.
  inProcess.set(chainKey, run.then(() => {}, () => {}));
  return run;
}

export const _internals = { lockPath, ownerAlive, stealIfDead, releaseFileLock, takeClaim, procStart };
