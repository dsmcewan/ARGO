// Seat-local memory. The actual team feature.
//
// A crew that forgets overnight is contractors. What makes a chair a job is that the next occupant
// knows what this chair decided, what it tried and abandoned, which files it may touch, and who sat
// here last. Bound to the CHAIR, never to a session id and never to a vendor -- the whole point is
// that it survives the reseat that kills the conversation.
//
// TWO RULES THAT ARE NOT DECORATION:
//
// 1. AN ABANDONED PATH WITHOUT ITS REASON IS THE ROT ITSELF. "We did not use a queue because the
//    writer set is not disjoint" compresses to "use a lock", and the next occupant re-proposes the
//    queue. So `abandoned` refuses an entry with no `why`: a dead end recorded without its reason is
//    worse than not recording it, because it looks like coverage.
//
// 2. THE BRIEF IS CAPPED AND THE CAP REFUSES. A restore brief beats a 40k-token diary; a cap that
//    silently truncates gives you the diary's cost and the brief's blind spots. Over the cap, the
//    write fails and names what to drop. Full transcripts are for the human, not the next occupant.
import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync } from "node:fs";
import { join } from "node:path";
import { chairKey, parseChair, ROSTER, PODS } from "./roster.mjs";
import { withSeatLock } from "../seat/lock.mjs";
import { measureBytes } from "./measure.mjs";

/** Bytes, not tokens: the thing being bounded is a file on disk. Roughly a page. */
export const BRIEF_CAP_BYTES = 4096;
const MAX_ITEMS = 12;

export class ContinuityViolation extends Error {}
const bad = m => { throw new ContinuityViolation(m); };

const chairPath = (home, key) => join(home, "chairs", `${key}.json`);

const blank = (address) => {
  const { pod } = parseChair(address);
  return { address, pod, decided: [], abandoned: [], files: [], occupants: [],
    // Counts of what trimming dropped, kept as NUMBERS on the record and not as marker objects inside
    // the lists. The marker form rendered in the brief as "- undefined" and reset its own count every
    // time the list was trimmed again.
    dropped: { decisions: 0, dead_ends: 0, occupancies: 0 },
    updated_at: null };
};

// A brief is memory for a chair that exists. Writing one for an address the roster does not know is
// memory for a seat nobody sits in -- and a shape that needs a new seat is a roster change a human
// makes, not something a caller conjures by naming it.
const knownChair = address => { if (!ROSTER[address]) bad(`"${address}" is not in the roster; a brief needs a chair that exists`); };

export function loadChair({ address, cwd, home }) {
  knownChair(address);
  const key = chairKey({ address, cwd });
  const p = chairPath(home, key);
  if (!existsSync(p)) return { key, ...blank(address) };
  let rec;
  try { rec = JSON.parse(readFileSync(p, "utf8")); }
  catch (e) {
    // Fail closed. A corrupt brief read as "empty" hands the next occupant a clean slate and tells
    // them nothing was ever tried here -- the most expensive possible lie.
    bad(`corrupt continuity brief at ${p}: ${e.message}`);
  }
  // Valid JSON is not a valid brief. The catch above only fired for unparseable bytes; a number, a string,
  // an array or `null` parsed fine, spread into the blank record, and loaded as a clean slate -- the exact
  // lie the catch exists to prevent (2026-09-27 re-review, rank 16).
  if (!rec || typeof rec !== "object" || Array.isArray(rec)) {
    bad(`corrupt continuity brief at ${p}: a brief is an object; this file holds ${Array.isArray(rec) ? "an array" : rec === null ? "null" : `a ${typeof rec}`}`);
  }
  // A record written before `dropped` existed gets the counters, so a legacy brief keeps loading.
  return { key, ...blank(address), ...rec, dropped: { ...blank(address).dropped, ...(rec.dropped ?? {}) } };
}

function saveChair(record, { home }) {
  const { key, ...body } = record;
  // Measured by walking the data, not by JSON.stringify: a `toJSON` on a decision could shrink the
  // measurement while the file written below still carried the bytes (same hole as law 4's).
  const bytes = Math.max(measureBytes(body), Buffer.byteLength(JSON.stringify({ ...body, updated_at: body.updated_at }, null, 2)));
  if (bytes > BRIEF_CAP_BYTES) {
    bad(`continuity brief for ${body.address} would be ${bytes} bytes, over the ${BRIEF_CAP_BYTES} cap. ` +
      `Drop the oldest decided/abandoned entries or shorten their text -- do NOT raise the cap: a brief ` +
      `that grows without bound is a diary, and the next occupant will skim it.`);
  }
  const dir = join(home, "chairs");
  mkdirSync(dir, { recursive: true });
  const p = chairPath(home, key), tmp = `${p}.tmp${process.pid}`;
  writeFileSync(tmp, JSON.stringify(body, null, 2));
  renameSync(tmp, p);
  return { key, ...body };
}

// Oldest out, and the record says so -- in a counter that ACCUMULATES, so the brief can print the true
// total rather than the size of the most recent cut.
const trim = (rec, field, counter) => {
  const list = rec[field];
  if (list.length <= MAX_ITEMS) return;
  rec.dropped[counter] += list.length - MAX_ITEMS;
  rec[field] = list.slice(-MAX_ITEMS);
};

// ONE WRITER PER CHAIR. Every writer below is a read-modify-write of one file, and three processes
// doing that at once lost half their writes (3 x 20 decisions -> 30 kept, 30 gone; reproduced during
// the 2026-09-27 re-review). The atomic rename made each FILE consistent and did nothing for the pair,
// exactly the §U2 lesson from the seat store. The same cross-process lock serialises it, keyed by the
// chair (not the occupant, since that is the point of a chair). Writers are therefore async now.
const chairTx = ({ address, cwd, home }, mutate) =>
  withSeatLock(`chair ${chairKey({ address, cwd })}`, async () => {
    const rec = loadChair({ address, cwd, home });
    mutate(rec);
    return saveChair(rec, { home });
  }, { dir: join(home, "chairs", ".locks") });

/** Record a decision this chair made. */
export async function decided({ address, cwd, home, what, why, at = new Date().toISOString() }) {
  if (!what) bad("decided: `what` is required");
  knownChair(address);
  return chairTx({ address, cwd, home }, rec => {
    rec.decided = [...rec.decided, { what, why: why ?? null, at }];
    trim(rec, "decided", "decisions");
    rec.updated_at = at;
  });
}

/** Record a path this chair tried and dropped. The reason is mandatory. */
export async function abandoned({ address, cwd, home, what, why, at = new Date().toISOString() }) {
  if (!what) bad("abandoned: `what` is required");
  if (!why) {
    bad(`abandoned: a dead end needs its reason. "${what}" with no why compresses to nothing, and the ` +
      `next occupant re-proposes it -- that is handoff compression, the failure this record exists to ` +
      `prevent.`);
  }
  knownChair(address);
  return chairTx({ address, cwd, home }, rec => {
    rec.abandoned = [...rec.abandoned, { what, why, at }];
    trim(rec, "abandoned", "dead_ends");
    rec.updated_at = at;
  });
}

/** Declare the files this chair may touch. Only a tree-writing pod may claim any. */
export async function claimFiles({ address, cwd, home, files }) {
  const { pod } = parseChair(address);
  if (!Array.isArray(files) || files.some(f => typeof f !== "string" || !f)) bad("claimFiles: files must be non-empty strings");
  if (files.length && !PODS[pod].writes_tree) {
    bad(`${address} is in the "${pod}" pod, which does not write the tree; it cannot claim files. ` +
      `Law 2: one writer of the tree.`);
  }
  knownChair(address);
  return chairTx({ address, cwd, home }, rec => {
    rec.files = [...new Set(files)].sort();
    rec.updated_at = new Date().toISOString();
  });
}

/** Record who sat here. This is what lets you avoid reseating the same prior when you wanted a check. */
export async function recordOccupancy({ address, cwd, home, vendor, gen, at = new Date().toISOString() }) {
  if (!vendor) bad("recordOccupancy: vendor is required");
  knownChair(address);
  return chairTx({ address, cwd, home }, rec => {
    rec.occupants = [...rec.occupants, { vendor, gen: gen ?? rec.occupants.length + 1, at }];
    trim(rec, "occupants", "occupancies");
    rec.updated_at = at;
  });
}

/**
 * What the next occupant reads before touching anything. Short by construction.
 *
 * It deliberately carries NO transcript and no narration from whoever sat here before: a brief is what
 * the chair knows, not what its last occupant felt about it.
 */
export function restoreBrief({ address, cwd, home }) {
  const rec = loadChair({ address, cwd, home });
  const chair = ROSTER[address];
  const priors = rec.occupants.filter(o => o.vendor);
  const lines = [
    `CHAIR ${address}  (pod: ${rec.pod} — ${PODS[rec.pod].sees})`,
    chair ? `CHARTER ${chair.charter}` : null,
    rec.files.length ? `FILES you may touch: ${rec.files.join(", ")}` : `FILES none claimed; this pod does not write the tree`,
    rec.decided.length ? `DECIDED${rec.dropped.decisions ? ` (${rec.dropped.decisions} older not shown)` : ""}\n${rec.decided.map(d => `  - ${d.what}${d.why ? ` — ${d.why}` : ""}`).join("\n")}` : null,
    rec.abandoned.length ? `ALREADY TRIED AND DROPPED (do not re-propose)${rec.dropped.dead_ends ? ` (${rec.dropped.dead_ends} older not shown)` : ""}\n${rec.abandoned.map(a => `  - ${a.what} — ${a.why}`).join("\n")}` : null,
    priors.length ? `LAST OCCUPIED BY ${priors[priors.length - 1].vendor} (gen ${priors[priors.length - 1].gen}); held before by ${[...new Set(priors.map(o => o.vendor))].join(", ")}` : null,
  ].filter(Boolean);
  const text = lines.join("\n");
  return {
    text, bytes: Buffer.byteLength(text), cap: BRIEF_CAP_BYTES,
    record: rec,
    // Stated so a caller cannot mistake this for the history.
    basis: "the chair's own memory, bound to the chair and not to any session or vendor. It carries no " +
      "transcript: full logs are for the human, not the next occupant.",
  };
}
