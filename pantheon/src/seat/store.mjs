// Seat records live ONLY under $PANTHEON_HOME. This module is the single writer in Plan 1, which
// is what makes the zero-uninvited-mutation claim (spec §9) checkable rather than aspirational.
import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { seatKey, seatKeyAliases, mergeIdentity, rankOf } from "./identity.mjs";

export function pantheonHome(env = process.env) {
  return env.PANTHEON_HOME || join(homedir(), ".pantheon");
}

const seatPath = (seat, home) => join(home, "seats", `${seatKey(seat)}.json`);

// Same rename hazard as src/sdk/history.mjs's resolveHistoryPath, and the same fix: read-only, an
// ordinary saveSeat after this always lands at the current key, healing the seat from then on.
function resolveSeatPath(seat, home) {
  const primary = seatPath(seat, home);
  if (existsSync(primary)) return primary;
  for (const k of seatKeyAliases(seat)) {
    const p = join(home, "seats", `${k}.json`);
    if (existsSync(p)) return p;
  }
  return primary;
}

export function loadSeat(seat, { home = pantheonHome() } = {}) {
  const p = resolveSeatPath(seat, home);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch (e) {
    // Fail closed. A corrupt record read as "absent" would silently start a fresh conversation
    // and then report it as a resume - the exact failure this project exists to prevent.
    throw new Error(`corrupt seat record at ${p}: ${e.message}`);
  }
}

// An empty chain is not a baseline (see verifyExtends), so it must never reach disk. Validating
// here rather than at read time means the invalid state cannot exist, instead of existing and
// being rejected later by every caller that remembers to check.
function validateChain(chain) {
  // AN ALLOWLIST, like exchanges has. The two checks below said what head and length must be and nothing
  // about what else may ride along -- so { head, length, transcript: "..." } persisted the transcript to
  // disk under the record that promises never to hold one. Found by the 2026-09-27 re-review.
  for (const k of Object.keys(chain)) {
    if (!["head", "length"].includes(k)) {
      throw new Error(`saveSeat: chain.${k} is not part of a chain record; only head and length may be persisted. ` +
        `Content does not enter a seat record by any field.`);
    }
  }
  if (typeof chain.head !== "string") throw new Error("saveSeat: chain.head must be a string");
  if (typeof chain.length !== "number") throw new Error("saveSeat: chain.length must be a number");
  if (chain.length === 0) {
    throw new Error("saveSeat: refusing to persist an empty chain; an empty chain is not a baseline");
  }
}

// Refuse to persist anything carrying conversation text. The projectors guarantee content never
// leaves them; this is the second gate, at the only module that writes to disk, so a future
// caller assembling turns by hand cannot quietly put a prompt in a seat record.
function validateExchanges(list) {
  if (!Array.isArray(list)) throw new Error("saveSeat: exchanges must be an array");
  if (list.length === 0) throw new Error("saveSeat: refusing to persist an empty exchange list");
  const allowed = new Set(["role", "sha", "len", "tools"]);
  for (const [i, t] of list.entries()) {
    for (const k of Object.keys(t)) {
      if (!allowed.has(k)) throw new Error(`saveSeat: exchanges[${i}] has unexpected field "${k}"; only role/sha/len/tools may be persisted`);
    }
    if (typeof t.sha !== "string") throw new Error(`saveSeat: exchanges[${i}].sha must be a string`);
    if (typeof t.role !== "string") throw new Error(`saveSeat: exchanges[${i}].role must be a string`);
  }
}

export function saveSeat(seat, patch, { home = pantheonHome() } = {}) {
  // Validate everything BEFORE touching disk, so a refusal leaves any existing record intact.
  if (patch.token) rankOf(patch.token.source);
  if (patch.chain) validateChain(patch.chain);
  if (patch.exchanges) validateExchanges(patch.exchanges);
  if (patch.history_len !== undefined && !(Number.isInteger(patch.history_len) && patch.history_len >= 0)) {
    throw new Error("saveSeat: history_len must be a non-negative integer");
  }
  if(patch.history_generation!==undefined&&!/^[a-f0-9]{64}$/.test(patch.history_generation))throw new Error('Invalid history generation digest');

  const existing = loadSeat(seat, { home });
  const next = {
    key: seatKey(seat),
    vendor: seat.vendor, purpose: seat.purpose, cwd: seat.cwd,
    token: existing?.token ?? null,
    chain: existing?.chain ?? null,
    // SDK transport holds the conversation, so the seat must carry the projected turn list the
    // chain is computed over -- there is no vendor file to re-read it from. Content-free by
    // construction: these are the same {role, sha, len, tools} records the projectors emit.
    exchanges: existing?.exchanges ?? null,
    // How many replay-history messages this record has ACKNOWLEDGED. The history file carries its own
    // commit mark, but that mark is written after this record, so a crash between the two leaves the
    // mark short of the truth. This number is the truth: the seat saw the tail, so the tail is real.
    history_len: existing?.history_len ?? null,
    ...(existing?.history_generation?{history_generation:existing.history_generation}:{}),
    updated_at: new Date().toISOString(),
  };
  if (patch.token) {
    const m = mergeIdentity(existing?.token ?? undefined, patch.token);
    next.token = { value: m.value, source: m.source };
  }
  if (patch.chain) next.chain = patch.chain;
  if (patch.exchanges) next.exchanges = patch.exchanges;
  if (patch.history_len !== undefined) next.history_len = patch.history_len;
  if (patch.history_generation !== undefined) next.history_generation = patch.history_generation;

  const p = seatPath(seat, home);
  mkdirSync(join(home, "seats"), { recursive: true });
  const tmp = `${p}.tmp`;                 // atomic: a torn record is a corrupt record
  try {
    writeFileSync(tmp, JSON.stringify(next, null, 2));
    renameSync(tmp, p);
  } catch (e) {
    try { if (existsSync(tmp)) unlinkSync(tmp); } catch { /* best effort */ }
    throw e;
  }
  return next;
}
