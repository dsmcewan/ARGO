// Conversation history for REPLAY-continuity vendors.
//
// openai and xai keep the conversation server-side: we send previous_response_id and they hold
// the text. google and anthropic do not. Their continuity is replay — every turn resends the
// whole conversation — which means SOMETHING local has to hold the actual words.
//
// That collides head-on with the rule that seat records are content-free, and the collision is
// resolved by separation rather than by exception:
//
//   seats/<key>.json     identity, resume handle, chain. NEVER any text. Unchanged.
//   history/<key>.json   the conversation text, for vendors that require replay. Explicit.
//
// The seat store keeps refusing content, so nothing silently leaks into the record the rest of
// the system reads and logs. A file that holds prompts is named `history`, lives in its own
// directory, and is the only place that does — so "where is the conversation text" has exactly
// one answer instead of being a property you have to audit for.
//
// This is a real widening of what Pantheon stores, and the cost is stated rather than absorbed:
// two of four vendors now require a local copy of the conversation to continue it at all.
import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync, unlinkSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { seatKey, seatKeyAliases } from "../seat/identity.mjs";
import { pantheonHome } from "../seat/store.mjs";

const historyPath = (seat, home) => join(home, "history", `${seatKey(seat)}.json`);
const aliasHistoryPaths = (seat, home) => seatKeyAliases(seat).map(k => join(home, "history", `${k}.json`));

// A rename changes seatKey's hash, so the current key's file is missing for a seat whose
// conversation was recorded under a name this project used to call that vendor -- found by an
// independent review of the 2026-09-28 rename (a5fade49097a8c183), reproduced against real files
// already on this machine. READ-ONLY: nothing here ever writes under an alias, so the next
// ordinary save lands at the current key and the seat is healed from then on.
function resolveHistoryPath(seat, home) {
  const primary = historyPath(seat, home);
  if (existsSync(primary)) return { path: primary, legacy_vendor: undefined };
  for (const p of aliasHistoryPaths(seat, home)) {
    if (existsSync(p)) {
      try { return { path: p, legacy_vendor: JSON.parse(readFileSync(p, "utf8"))?.vendor }; }
      catch { return { path: p, legacy_vendor: undefined }; }
    }
  }
  return { path: primary, legacy_vendor: undefined };
}

// EVIDENCE §U1, THE REPLAY HAZARD, CLOSED HERE.
//
// History was written before the seat record, so a crash between the two left a file holding an
// exchange no seat record acknowledged. Next turn replayed it: harmless for text, NOT harmless for a
// non-idempotent tool call, which would run a second time inside a conversation that looked continuous.
//
// A REORDER DOES NOT FIX IT, which is why the fix is a marker. Saving the seat first and crashing
// leaves a record claiming a chain the history cannot produce, so the seat refuses to continue and the
// conversation is lost instead of duplicated. Both orders have a window; only a marker makes the pair
// recoverable.
//
// So the write is two-phase. `saveHistory(..., { committed })` records how many messages the seat
// record has actually acknowledged; anything past that is a PENDING TAIL. After saveSeat returns,
// `commitHistory` moves the mark to the end. A crash in between leaves the mark short, and the next
// load returns the committed prefix only — the pending tail is dropped, never replayed.
//
// Dropping is the correct recovery, not a compromise: the seat record never saw that exchange, so the
// truncated history is the state the rest of the system already believes in. Keeping the tail would
// mean replaying precisely the turn whose side effects are unknown.
// `acknowledged` is what the SEAT RECORD says it has seen. The marker in this file is written first and
// committed last, so there are two crash windows, not one:
//
//   crash after phase one, before saveSeat   -> marker short, seat record short: the tail is unacked;
//                                               DROP it (the original §U1 fix).
//   crash after saveSeat, before phase two   -> marker short, seat record LONG: the seat acknowledged
//                                               the tail, and dropping it would lose an exchange the
//                                               rest of the system already believes in. KEEP it.
//
// The second window was found by an external review of the first fix. The seat record is the
// authority: committed = max(marker, acknowledged), clamped to what is actually on disk.
export function loadHistoryState(seat, { home = pantheonHome(), acknowledged = null } = {}) {
  const { path: p, legacy_vendor } = resolveHistoryPath(seat, home);
  if (!existsSync(p)) return { messages: [], committed: 0, dropped: 0, pending: false };
  let h;
  try {
    h = JSON.parse(readFileSync(p, "utf8"));
  } catch (e) {
    // Fail closed, exactly as the seat store does. Treating a corrupt history as empty would
    // silently restart the conversation and then report the turn as a continuation.
    throw new Error(`corrupt history at ${p}: ${e.message}`);
  }
  const messages = Array.isArray(h?.messages) ? h.messages : [];
  // A file written before this marker existed has no `committed` field. Treating that as 0 would
  // discard every legacy history; treating it as the full length is what the old code did and is the
  // pre-existing behaviour, so it is kept and LABELLED rather than silently reinterpreted.
  const legacy = typeof h?.committed !== "number";
  const marker = legacy ? messages.length : Math.max(0, Math.min(h.committed, messages.length));
  const acked = Number.isInteger(acknowledged) ? Math.max(0, Math.min(acknowledged, messages.length)) : 0;
  const committed = Math.max(marker, acked);
  const dropped = messages.length - committed;
  const healed = acked > marker;
  return {
    messages: dropped > 0 ? messages.slice(0, committed) : messages,
    committed, dropped, legacy,
    // Set only when this load came from an alias path (seatKeyAliases), never from the current
    // vendor's own file -- a caller auditing a load can see it recovered pre-rename state.
    legacy_vendor,
    // The seat record vouched for messages the marker had not reached: the second crash window,
    // recovered in the keeping direction. Reported, because a caller auditing the file will see a
    // marker that disagrees with what was replayed.
    healed_from_seat: healed ? { marker, acknowledged: acked } : null,
    pending: dropped > 0,
    why: dropped > 0
      ? `dropped ${dropped} uncommitted message(s): written to history but never acknowledged by the ` +
        `seat record, so a crash landed between the two writes. Replaying them could repeat a tool call.`
      : null,
  };
}

/** The committed prefix, which is the only part safe to replay. */
export function loadHistory(seat, opts = {}) {
  return loadHistoryState(seat, opts).messages;
}

export function saveHistory(seat, messages, { home = pantheonHome(), committed } = {}) {
  if (!Array.isArray(messages)) throw new Error("saveHistory: messages must be an array");
  // Default: fully committed. A caller doing the two-phase write passes the prior committed length,
  // and defaulting the other way would mark every ordinary write as pending and lose the tail.
  const mark = typeof committed === "number" ? Math.max(0, Math.min(committed, messages.length)) : messages.length;
  const dir = join(home, "history");
  mkdirSync(dir, { recursive: true });
  const p = historyPath(seat, home);
  const tmp = `${p}.tmp`;
  const body = JSON.stringify({
    key: seatKey(seat), vendor: seat.vendor, purpose: seat.purpose, cwd: seat.cwd,
    // Says what it is, in the file, for whoever finds it later.
    warning: "CONTAINS CONVERSATION TEXT — required for replay-continuity vendors. Seat records never do.",
    updated_at: new Date().toISOString(),
    // How many of these the seat record has acknowledged. Messages past this point are a pending tail
    // and are dropped on load -- see loadHistoryState.
    committed: mark,
    messages,
  }, null, 2);
  try {
    writeFileSync(tmp, body, { mode: 0o600 });   // owner-only: it holds prompts
    renameSync(tmp, p);
    try { chmodSync(p, 0o600); } catch { /* best effort on exotic filesystems */ }
  } catch (e) {
    try { if (existsSync(tmp)) unlinkSync(tmp); } catch { /* best effort */ }
    throw e;
  }
  return p;
}

/**
 * Phase two: the seat record is on disk, so the tail is now real. Moves the mark to the end.
 *
 * Idempotent, and a missing file is not an error -- a non-replay vendor never wrote one, and calling
 * this unconditionally after saveSeat is simpler to get right than calling it conditionally.
 */
export function commitHistory(seat, { home = pantheonHome() } = {}) {
  const p = historyPath(seat, home);
  if (!existsSync(p)) return { ok: false, why: "no history file for this seat", committed: 0 };
  let h;
  try {
    h = JSON.parse(readFileSync(p, "utf8"));
  } catch (e) {
    throw new Error(`corrupt history at ${p}: ${e.message}`);
  }
  const messages = Array.isArray(h?.messages) ? h.messages : [];
  if (h?.committed === messages.length) return { ok: true, committed: messages.length, already: true };
  // Same atomic write discipline as saveHistory: a torn commit marker would be worse than none.
  const tmp = `${p}.tmp`;
  const body = JSON.stringify({ ...h, committed: messages.length,
    committed_at: new Date().toISOString() }, null, 2);
  try {
    writeFileSync(tmp, body, { mode: 0o600 });
    renameSync(tmp, p);
    try { chmodSync(p, 0o600); } catch { /* best effort */ }
  } catch (e) {
    try { if (existsSync(tmp)) unlinkSync(tmp); } catch { /* best effort */ }
    throw e;
  }
  return { ok: true, committed: messages.length };
}
