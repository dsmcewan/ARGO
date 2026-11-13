// L7: everything that must NOT be hashed into a node.
//
// Leases, heartbeats, occupancy and spend are runtime chrome. Hash them into an entry and the same
// conversation forks every turn, because "you have 12% context left" changes the cid of a claim
// that did not change. They live here instead: a mutable side store, keyed by resource or by the
// commit cid they describe, reconstructable and never load-bearing for identity.
//
// The lease is the mutex. The DAG is history. Flock's mistake was trying to be both.
//
// What this adds over the mutex this project shipped this morning: a GENERATION. That lock could
// only answer "is someone inside"; it had no way to tell a returning slow holder that the world
// moved on. A fence bumps the generation, leaves the old holder's objects in the store untouched,
// and refuses any commit citing the dead gen. History is not rewritten -- a name is stopped from
// moving.
import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { withSeatLock } from "../seat/lock.mjs";

const HISTORY_CAP = 50;

function readJson(p, fallback) {
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return fallback; }
}
function writeJson(p, v) {
  mkdirSync(join(p, ".."), { recursive: true });
  const tmp = `${p}.tmp${process.pid}`;
  writeFileSync(tmp, JSON.stringify(v, null, 2));
  renameSync(tmp, p);
}

export function openRuntime(root) {
  const dir = join(root, "runtime");
  mkdirSync(dir, { recursive: true });
  const leasesPath = join(dir, "leases.json");
  const occPath = join(dir, "occupancy.json");
  const budgetPath = join(dir, "budget.json");
  const spendPath = join(dir, "spend.jsonl");
  const lockDir = join(dir, "locks");

  const load = () => readJson(leasesPath, {});
  const leaseFor = resource => load()[resource] ?? null;

  // Serialise the whole read-modify-write of the lease table. Only the table: the CAS needs no
  // coordination at all, because a content-addressed write cannot conflict with itself.
  const tx = fn => withSeatLock("leases", async () => {
    const table = load();
    const result = await fn(table);
    writeJson(leasesPath, table);
    return result;
  }, { dir: lockDir, timeoutMs: 30_000 });

  const expired = (lease, now) => Date.parse(lease.expires_at) <= now;

  // ONE LOCK DOMAIN. verify() below is an unlocked read, and acquire()/fence() serialise through tx()'s
  // lock -- so a ref swap that verified its lease and then wrote could land AFTER a fence that ran between
  // the two (2026-09-27 re-review, rank 11). refs.swap runs its decide-and-write under this, the same lock
  // tx() takes, so a fence and a landing cannot interleave. Lock order everywhere is ref -> leases.
  const locked = fn => withSeatLock("leases", fn, { dir: lockDir, timeoutMs: 30_000 });

  function acquire({ resource, holder, ttlMs = 120_000, at = null, now = Date.now() }) {
    if (!resource || !holder?.seat_id) throw new Error("acquire: resource and holder.seat_id are required");
    return tx(table => {
      const cur = table[resource];
      const iso = t => new Date(t).toISOString();
      const fresh = gen => ({
        resource, holder, gen, at,
        acquired_at: iso(now), expires_at: iso(now + ttlMs), last_heartbeat: iso(now),
        state: "active",
        history: [...(cur?.history ?? []), ...(cur ? [{ gen: cur.gen, seat: cur.holder.seat_id, state: cur.state, at: iso(now) }] : [])].slice(-HISTORY_CAP),
      });
      if (!cur || cur.state !== "active") { table[resource] = fresh((cur?.gen ?? 0) + 1); return { ok: true, lease: table[resource], fenced: null }; }
      if (cur.holder.seat_id === holder.seat_id) {
        // Same holder re-acquiring is a renewal, NOT a new generation. Bumping the gen here would
        // fence the holder's own in-flight commit.
        table[resource] = { ...cur, expires_at: iso(now + ttlMs), last_heartbeat: iso(now), at: at ?? cur.at };
        return { ok: true, lease: table[resource], fenced: null, renewed: true };
      }
      if (!expired(cur, now)) {
        return { ok: false, why: `held by ${cur.holder.seat_id} at gen ${cur.gen} until ${cur.expires_at}`, lease: cur };
      }
      // Expired and someone else wants it: fence. The old holder keeps every object it wrote.
      const dead = { gen: cur.gen, seat: cur.holder.seat_id };
      table[resource] = { ...fresh(cur.gen + 1), history: [...(cur.history ?? []), { gen: cur.gen, seat: cur.holder.seat_id, state: "fenced", at: iso(now) }].slice(-HISTORY_CAP) };
      return { ok: true, lease: table[resource], fenced: dead };
    });
  }

  /** Take a resource from a live holder. Deliberately explicit and deliberately loud. */
  function fence({ resource, holder, ttlMs = 120_000, reason, now = Date.now() }) {
    if (!reason) throw new Error("fence: a reason is required; an unexplained takeover is indistinguishable from a bug");
    return tx(table => {
      const cur = table[resource];
      const iso = t => new Date(t).toISOString();
      const gen = (cur?.gen ?? 0) + 1;
      table[resource] = {
        resource, holder, gen, at: cur?.at ?? null,
        acquired_at: iso(now), expires_at: iso(now + ttlMs), last_heartbeat: iso(now), state: "active",
        history: [...(cur?.history ?? []), ...(cur ? [{ gen: cur.gen, seat: cur.holder.seat_id, state: "fenced", at: iso(now), reason }] : [])].slice(-HISTORY_CAP),
      };
      return { ok: true, lease: table[resource], fenced: cur ? { gen: cur.gen, seat: cur.holder.seat_id, reason } : null };
    });
  }

  const renew = ({ resource, holder, gen, ttlMs = 120_000, now = Date.now() }) => tx(table => {
    const cur = table[resource];
    if (!cur || cur.state !== "active") return { ok: false, why: `no active lease on ${resource}` };
    if (cur.gen !== gen || cur.holder.seat_id !== holder.seat_id) return { ok: false, why: `lease on ${resource} is now gen ${cur.gen} held by ${cur.holder.seat_id}` };
    table[resource] = { ...cur, expires_at: new Date(now + ttlMs).toISOString(), last_heartbeat: new Date(now).toISOString() };
    return { ok: true, lease: table[resource] };
  });

  const release = ({ resource, holder, gen, now = Date.now() }) => tx(table => {
    const cur = table[resource];
    if (!cur) return { ok: false, why: `no lease on ${resource}` };
    // Releasing someone else's generation is how a slow holder frees the thief's critical section.
    if (cur.gen !== gen || cur.holder.seat_id !== holder.seat_id) return { ok: false, why: `lease on ${resource} is gen ${cur.gen} held by ${cur.holder.seat_id}; not yours to release` };
    table[resource] = { ...cur, state: "released", history: [...(cur.history ?? []), { gen: cur.gen, seat: cur.holder.seat_id, state: "released", at: new Date(now).toISOString() }].slice(-HISTORY_CAP) };
    return { ok: true };
  });

  /** The fencing check. Synchronous and pure over the table, so a ref swap can run it while it
   *  holds the ref lock -- checking before taking the lock would race with the fence itself. */
  function verify({ resource, seat_id, gen, now = Date.now() }) {
    const cur = load()[resource];
    if (!cur) return { ok: false, code: "NO_LEASE", why: `no lease exists on ${resource}` };
    if (cur.gen !== gen) {
      const f = (cur.history ?? []).find(h => h.gen === gen && h.state === "fenced");
      return { ok: false, code: "FENCED", why: `lease on ${resource} is at gen ${cur.gen}; your gen ${gen} was ${f ? `fenced at ${f.at}${f.reason ? ` (${f.reason})` : ""}` : "superseded"}` };
    }
    if (cur.holder.seat_id !== seat_id) return { ok: false, code: "WRONG_HOLDER", why: `lease gen ${gen} on ${resource} is held by ${cur.holder.seat_id}, not ${seat_id}` };
    if (cur.state !== "active") return { ok: false, code: "NOT_ACTIVE", why: `lease on ${resource} is ${cur.state}` };
    if (expired(cur, now)) return { ok: false, code: "EXPIRED", why: `lease on ${resource} expired at ${cur.expires_at}` };
    return { ok: true, lease: cur };
  }

  // --- occupancy: who is sitting where, and on which branch class ---
  const occupancy = () => readJson(occPath, {});
  const setOccupancy = (seat_id, patch) => {
    const all = occupancy();
    all[seat_id] = { ...(all[seat_id] ?? {}), seat_id, ...patch, at: new Date().toISOString() };
    writeJson(occPath, all);
    return all[seat_id];
  };

  // --- budget: declared limits here, SPEND DERIVED from the side log ---
  const setBudget = b => { writeJson(budgetPath, { ...b, declared_at: new Date().toISOString() }); return b; };
  const recordSpend = row => {
    if (!row.commit) throw new Error("recordSpend: every spend row is keyed by the commit cid it paid for");
    appendFileSync(spendPath, JSON.stringify({ at: new Date().toISOString(), ...row }) + "\n");
  };
  function budget() {
    const declared = readJson(budgetPath, null);
    const rows = existsSync(spendPath)
      ? readFileSync(spendPath, "utf8").split("\n").filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean)
      : [];
    // Derived, never stored. A stored counter is a second source of truth, and when it drifts it
    // drifts towards "still under budget".
    const spent_turns = rows.reduce((n, r) => n + (r.turns ?? 1), 0);
    const spent_usd = rows.reduce((n, r) => n + (r.usd ?? 0), 0);
    if (!declared) return { declared: null, spent_turns, spent_usd, exhausted: false, why: "no budget declared" };
    const exhausted = spent_turns >= declared.max_turns || (declared.max_usd !== undefined && spent_usd >= declared.max_usd);
    return { declared, spent_turns, spent_usd, exhausted, rows: rows.length,
      why: exhausted ? `budget exhausted: ${spent_turns}/${declared.max_turns} turns, ${spent_usd.toFixed(4)}/${declared.max_usd ?? "-"} usd` : null };
  }

  return { dir, leaseFor, leases: load, acquire, fence, renew, release, verify, locked,
    occupancy, setOccupancy, setBudget, recordSpend, budget };
}
