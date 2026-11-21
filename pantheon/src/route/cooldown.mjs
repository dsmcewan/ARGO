// A refusal is evidence. This is where it survives the turn.
//
// THE PROBLEM. src/board/run-item.mjs builds `deadPools = new Set()` INSIDE each role turn. It is
// the right idea with no memory: the scouts cannot tell the planner what they just learned, and the
// next process starts blind. On 2026-09-28 that cost the same ten minutes twice over, in one
// user-visible build. LEXI's drafting leg spent 588 seconds discovering that the anthropic hose was
// shut, fell back to gpt-5.5, handed the ticket to pantheon -- and pantheon's planner then
// rediscovered the identical fact by spending its own calls against the same exhausted
// subscription. Two processes, one credential, no shared memory between them.
//
// WHY A POOL AND NOT A MODEL. The refusal that matters here carries no retry-after and no
// anthropic-ratelimit-* headers, which is a SUBSCRIPTION-side limit: it belongs to the credential,
// not to the model behind it. Recording it against claude-fable-5-1 would leave claude-opus-5-5
// looking available when it is exactly as shut, which is precisely how the planner ladder burned
// two rungs to learn one thing. SEAT_FACTS already names this: `quota_pool`.
//
// WHAT THIS IS NOT. It is not a rate limiter and it does not count calls. Counting requests would
// mean modelling every vendor's window, none of which they publish the same way, and being wrong
// about it silently. This records only what a vendor ACTUALLY said, and for how long to believe it.
//
// THREE PROPERTIES IT MUST HAVE, all of them tested:
//   FAIL OPEN     an unreadable or corrupt store means we know nothing, so nothing is shut. A
//                 broken cache must never be able to stop the pipeline.
//   PROBE, NEVER WALL  when a cooldown expires the pool is offered again, and that one call is the
//                 probe. A recovered pool is found immediately; a still-shut one escalates.
//   BOUNDED       intervals are capped and records go stale, so one bad write or a clock jump
//                 cannot hide a working vendor for a day.
//
// The file is shared with LEXI, which reads it to decide whether to spend its drafting call on the
// subscription at all. That makes the on-disk shape a contract, so writes are atomic: temp file,
// then rename.
//
// WRITERS SHARE A LOCK. Atomic rename stops a reader from seeing half a file. It does not stop two
// writers from each reading the old store, changing different pools, and the second rename
// discarding the first update. Every read-modify-write therefore holds `model-cooldowns.json.lock`
// (protocol v1, below). The JSON shape is unchanged, so readers and older writers still
// interoperate. An older unlocked writer can still overwrite a locked update until it adopts
// the same protocol.
//
// LOCK PROTOCOL v1 (any language can implement it with exclusive create, rename and link):
//   acquire  create the lock with O_CREAT|O_EXCL, mode 0600. Content is one JSON object
//            {"protocol":1,"pid":<int>,"host":<hostname>,"at":<epoch s>,"token":<unique string>}.
//   hold     re-read the store, change it, write temp + rename, all while holding the lock.
//   release  unlink the lock only if its content is still exactly what this writer created.
//   stale    a lock is stale when its host is this host and its pid is not alive, when it is
//            unparseable and older than LOCK_STALE_S by mtime, or when `at` is older than
//            LOCK_STALE_S. The critical section is a few small file operations, so a held
//            lock that old belongs to a hung or crashed writer.
//   break    rename the stale lock to a unique tombstone and re-read it. If the content differs,
//            a live writer took the lock in between: hard-link the tombstone back to the lock
//            name (link never overwrites) and do not enter. Otherwise unlink the tombstone and
//            retry the exclusive create.
//   budget   wait at most LOCK_WAIT_MS. If the lock is still held, skip the write. This is the
//            same best-effort result as any other failed write (FAIL OPEN). It loses one cache
//            update and does not block the caller.
// Residual risk: release and break each check content before unlinking. A writer that pauses
// for longer than LOCK_STALE_S between that check and the unlink can still disturb a lock taken
// in between. This store is an advisory cache, not world state; nothing else relies on this lock.

import {
  readFileSync, writeFileSync, renameSync, mkdirSync, unlinkSync, openSync, writeSync, closeSync,
  statSync, linkSync,
} from "node:fs";
import { homedir, hostname } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

/** First cooldown after a refusal that named no interval. */
export const COOLDOWN_BASE_S = 60;

/** Ceiling on the escalation. An hour of not looking is already a long time to be wrong for. */
export const COOLDOWN_CAP_S = 900;

/** Beyond this, a record is history rather than evidence about now. */
export const COOLDOWN_MAX_AGE_S = 6 * 3600;

export const COOLDOWN_FILE = "model-cooldowns.json";

/** Lock beside the store. Protocol v1 is described in the header. */
export const COOLDOWN_LOCK_FILE = `${COOLDOWN_FILE}.lock`;

/** How long a writer waits for another writer before skipping its write. Blocks the caller. */
export const LOCK_WAIT_MS = 250;

/** A lock held this long belongs to a crashed or hung writer. */
export const LOCK_STALE_S = 10;

/** Where the store lives when no directory is given. Overridable for tests and for LEXI. */
export function defaultDir() {
  return process.env.PANTHEON_COOLDOWN_DIR ?? join(homedir(), ".cache", "pantheon");
}

/**
 * How long to disbelieve a pool, in seconds.
 *
 * A vendor that says when to come back is obeyed exactly -- inventing a longer interval throws
 * away the only real information in the refusal. Otherwise the interval doubles per consecutive
 * refusal, capped: a pool that has refused twice running will not be ready on the same schedule as
 * one that refused once, and a pool that has refused nine times is not worth a tenth probe a
 * minute later.
 */
export function coolOffS({ streak = 1, retryAfterS = null } = {}) {
  if (Number.isFinite(retryAfterS) && retryAfterS > 0) return retryAfterS;
  return Math.min(COOLDOWN_BASE_S * (2 ** Math.max(0, streak - 1)), COOLDOWN_CAP_S);
}

function storePath(dir) {
  return join(dir ?? defaultDir(), COOLDOWN_FILE);
}

/** Every record on disk, or {} for any reason at all. Never throws: see FAIL OPEN above. */
function load(dir) {
  try {
    const raw = JSON.parse(readFileSync(storePath(dir), "utf8"));
    return raw && typeof raw === "object" && raw.pools && typeof raw.pools === "object"
      ? raw.pools : {};
  } catch {
    return {};
  }
}

/** Atomic: a reader in another process never sees a half-written store. Call only under the lock. */
function save(dir, pools) {
  const target = storePath(dir);
  const temp = `${target}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temp, JSON.stringify({ version: 1, pools }, null, 2));
    renameSync(temp, target);
  } catch {
    // Best effort by design. Failing to WRITE the cache is not a reason to fail the call the
    // cache exists to save: the caller still has its own in-memory deadPools for this turn.
    try { unlinkSync(temp); } catch { /* the temp file may not exist; nothing to clean */ }
  }
}

const pause = new Int32Array(new SharedArrayBuffer(4));
const sleepMs = (ms) => Atomics.wait(pause, 0, 0, ms);

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === "EPERM"; }
}

function readLock(path) {
  try { return readFileSync(path, "utf8"); } catch { return null; }
}

/** Is the lock content `raw` (read from `path`) abandoned? Unknown means not stale. */
function isStale(raw, path, now) {
  let rec = null;
  try { rec = JSON.parse(raw); } catch { /* judged by mtime below */ }
  if (!rec || typeof rec !== "object" || !Number.isFinite(rec.at)) {
    try { return now - statSync(path).mtimeMs / 1000 > LOCK_STALE_S; } catch { return false; }
  }
  if (rec.host === hostname() && Number.isSafeInteger(rec.pid) && rec.pid > 0 && !pidAlive(rec.pid)) return true;
  return now - rec.at > LOCK_STALE_S;
}

/** Remove a stale lock without removing a live lock that replaced it. */
function breakLock(path, observed) {
  const tomb = `${path}.stale.${process.pid}.${randomUUID()}`;
  try { renameSync(path, tomb); } catch { return; }
  if (readLock(tomb) !== observed) {
    try { linkSync(tomb, path); } catch { /* another writer already holds the name */ }
  }
  try { unlinkSync(tomb); } catch { /* nothing to clean */ }
}

/**
 * Run `fn` while holding the store's writer lock, or skip it once the wait budget is spent.
 * @returns {boolean} whether `fn` ran
 */
function withLock(dir, fn, { waitMs = LOCK_WAIT_MS } = {}) {
  const root = dir ?? defaultDir();
  try { mkdirSync(root, { recursive: true }); } catch { return false; }
  const path = join(root, COOLDOWN_LOCK_FILE);
  const mine = JSON.stringify({ protocol: 1, pid: process.pid, host: hostname(), at: Date.now() / 1000, token: randomUUID() });
  const deadline = Date.now() + waitMs;
  for (;;) {
    let fd = null;
    try {
      fd = openSync(path, "wx", 0o600);
    } catch (error) {
      if (error.code !== "EEXIST") return false;
    }
    if (fd !== null) {
      let wrote = false;
      try { writeSync(fd, mine); wrote = true; } catch { /* released below */ }
      finally { closeSync(fd); }
      if (!wrote) { try { unlinkSync(path); } catch { /* nothing to clean */ } return false; }
      try { fn(); return true; } finally {
        if (readLock(path) === mine) { try { unlinkSync(path); } catch { /* already gone */ } }
      }
    }
    const held = readLock(path);
    if (held !== null && isStale(held, path, Date.now() / 1000)) { breakLock(path, held); continue; }
    if (Date.now() >= deadline) return false;
    sleepMs(2 + Math.floor(Math.random() * 4));
  }
}

/**
 * The pools that should not be spent on right now.
 *
 * @returns {Set<string>} pool names, ready to hand to candidatesFor's `avoid`.
 */
export function shutPools({ dir, now = Date.now() / 1000, maxAgeS = COOLDOWN_MAX_AGE_S } = {}) {
  const out = new Set();
  for (const [pool, rec] of Object.entries(load(dir))) {
    if (!rec || !Number.isFinite(rec.until) || !Number.isFinite(rec.at)) continue;
    if (now - rec.at > maxAgeS) continue;   // history, not evidence
    if (now < rec.until) out.add(pool);     // still inside the interval
  }
  return out;
}

/**
 * Record that a pool refused, and return the record written.
 *
 * @param {string} pool          the quota pool, from SEAT_FACTS[vendor].quota_pool
 * @param {number} [retryAfterS] the vendor's own interval, when it gave one
 */
export function recordRefusal(pool, { dir, now = Date.now() / 1000, retryAfterS = null, why = "" } = {}) {
  // The streak is read under the lock, so concurrent refusals escalate instead of colliding.
  let rec = null;
  const compute = (pools) => {
    const streak = (pools[pool]?.streak ?? 0) + 1;
    return { at: now, until: now + coolOffS({ streak, retryAfterS }), streak, why };
  };
  const ran = withLock(dir, () => {
    const pools = load(dir);
    rec = compute(pools);
    pools[pool] = rec;
    save(dir, pools);
  });
  // A skipped write still answers from the best evidence available. Only persistence is lost.
  return ran ? rec : compute(load(dir));
}

/**
 * Record that a pool answered. Clears the cooldown AND the streak.
 *
 * Clearing the streak matters: resuming an escalation from an hour ago would punish a pool for
 * history it has just disproved.
 */
export function recordSuccess(pool, { dir } = {}) {
  if (!(pool in load(dir))) return;
  withLock(dir, () => {
    const pools = load(dir);
    if (!(pool in pools)) return;
    delete pools[pool];
    save(dir, pools);
  });
}

/** Test seam: the lock helpers, so cross-process and stale-lock behaviour can be pinned. */
export const _lock = { withLock, isStale, breakLock };
