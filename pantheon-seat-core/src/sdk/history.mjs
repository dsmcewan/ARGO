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
import { seatKey } from "../seat/identity.mjs";
import { pantheonHome } from "../seat/store.mjs";

const historyPath = (seat, home) => join(home, "history", `${seatKey(seat)}.json`);

export function loadHistory(seat, { home = pantheonHome() } = {}) {
  const p = historyPath(seat, home);
  if (!existsSync(p)) return [];
  try {
    const h = JSON.parse(readFileSync(p, "utf8"));
    return Array.isArray(h?.messages) ? h.messages : [];
  } catch (e) {
    // Fail closed, exactly as the seat store does. Treating a corrupt history as empty would
    // silently restart the conversation and then report the turn as a continuation.
    throw new Error(`corrupt history at ${p}: ${e.message}`);
  }
}

export function saveHistory(seat, messages, { home = pantheonHome() } = {}) {
  if (!Array.isArray(messages)) throw new Error("saveHistory: messages must be an array");
  const dir = join(home, "history");
  mkdirSync(dir, { recursive: true });
  const p = historyPath(seat, home);
  const tmp = `${p}.tmp`;
  const body = JSON.stringify({
    key: seatKey(seat), vendor: seat.vendor, purpose: seat.purpose, cwd: seat.cwd,
    // Says what it is, in the file, for whoever finds it later.
    warning: "CONTAINS CONVERSATION TEXT — required for replay-continuity vendors. Seat records never do.",
    updated_at: new Date().toISOString(),
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
