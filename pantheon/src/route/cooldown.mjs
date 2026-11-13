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

import { readFileSync, writeFileSync, renameSync, mkdirSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** First cooldown after a refusal that named no interval. */
export const COOLDOWN_BASE_S = 60;

/** Ceiling on the escalation. An hour of not looking is already a long time to be wrong for. */
export const COOLDOWN_CAP_S = 900;

/** Beyond this, a record is history rather than evidence about now. */
export const COOLDOWN_MAX_AGE_S = 6 * 3600;

export const COOLDOWN_FILE = "model-cooldowns.json";

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

/** Atomic: a reader in another process never sees a half-written store. */
function save(dir, pools) {
  const target = storePath(dir);
  const temp = `${target}.${process.pid}.tmp`;
  try {
    mkdirSync(dir ?? defaultDir(), { recursive: true });
    writeFileSync(temp, JSON.stringify({ version: 1, pools }, null, 2));
    renameSync(temp, target);
  } catch {
    // Best effort by design. Failing to WRITE the cache is not a reason to fail the call the
    // cache exists to save: the caller still has its own in-memory deadPools for this turn.
    try { unlinkSync(temp); } catch { /* the temp file may not exist; nothing to clean */ }
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
  const pools = load(dir);
  const streak = (pools[pool]?.streak ?? 0) + 1;
  const rec = { at: now, until: now + coolOffS({ streak, retryAfterS }), streak, why };
  pools[pool] = rec;
  save(dir, pools);
  return rec;
}

/**
 * Record that a pool answered. Clears the cooldown AND the streak.
 *
 * Clearing the streak matters: resuming an escalation from an hour ago would punish a pool for
 * history it has just disproved.
 */
export function recordSuccess(pool, { dir } = {}) {
  const pools = load(dir);
  if (!(pool in pools)) return;
  delete pools[pool];
  save(dir, pools);
}
