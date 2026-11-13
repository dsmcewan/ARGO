// The seat layer for SDK transport: hold the conversation, chain it, persist the resume handle.
//
// WHAT CHANGED, AND WHAT GOT WEAKER.
//
// On the CLI path, verifyExtends compared our recorded chain against the vendor's OWN transcript
// file, re-read from disk each turn. That is a strong check: it catches a conversation that
// silently restarted, because the evidence comes from the vendor rather than from us.
//
// With `previous_response_id` the vendor holds the history and we cannot re-read it. So the chain
// here proves something NARROWER, and this module must not pretend otherwise:
//
//   it proves OUR record is append-only and internally consistent
//   it does NOT prove the vendor's server-side conversation matches our record
//
// The compensating evidence is the response-id lineage. Every turn sends the id the vendor gave
// us last time; a vendor that no longer recognizes it fails the call instead of quietly starting
// a fresh conversation. That is a real check, but it is the VENDOR's check, not ours, and it is
// recorded as such. Claiming the CLI path's guarantee here would be the same category of error as
// calling a directory name an identity.
import { record, chainOf } from "../context/chain.mjs";
import { loadSeat, saveSeat } from "../seat/store.mjs";
import { seatKey } from "../seat/identity.mjs";
import { withSeatLock } from "../seat/lock.mjs";
import { pantheonHome } from "../seat/store.mjs";
import { sendTurn, continuityMode } from "./adapter.mjs";
import { loadHistory, saveHistory } from "./history.mjs";
import { createHash } from "node:crypto";
import { join } from "node:path";

const sha256 = s => createHash("sha256").update(s).digest("hex");

// Project one exchange into the same {role, sha, len, tools} turn shape the transcript
// projectors produce, so chain.mjs is reused unchanged rather than forked for this path.
// Content is hashed and discarded here exactly as it is there.
export function exchangeTurns({ prompt, result }) {
  const turns = [{ role: "user", sha: sha256(`text:${prompt}`), len: prompt.length, tools: [] }];
  // An assistant turn with no text but real tool calls is a turn. Requiring text would drop
  // tool-only turns from the chain, which is how the CLI-side projectors lost most of a
  // transcript before they were rewritten.
  if (result.text !== "" || result.tools.length > 0) {
    const unit = `text:${result.text}` + result.tools.map(t => `␟tool:${t}`).join("");
    turns.push({ role: "assistant", sha: sha256(unit), len: result.text.length, tools: result.tools });
  }
  return turns;
}

// Take one turn on a seat. Returns what happened; the caller decides how to report it.
export async function sdkTurn({
  vendor, purpose, cwd, prompt, model, client, home, extra, onEvent, label, continuity,
} = {}) {
  if (!vendor || !purpose || !cwd) throw new Error("sdkTurn: vendor, purpose and cwd are required");
  if (typeof prompt !== "string" || prompt === "") throw new Error("sdkTurn: prompt is required");

  const seat = { vendor, purpose, cwd };
  const opts = home ? { home } : undefined;

  // The whole read-modify-write is one critical section, INCLUDING the model call.
  //
  // Holding a lock across a network call is normally a smell. Here it is the requirement: the
  // thing being protected is a conversation, and two turns interleaved on one seat do not
  // produce a race to tidy up afterwards, they produce one chain containing two half
  // conversations. Serialising turns per seat IS the correct semantics, and the lock simply
  // makes it true across processes instead of only within the view server, whose in-memory
  // guard was single-process and keyed by vendor+purpose rather than by seatKey.
  //
  // Lock files live beside the seat records they guard, so an isolated PANTHEON_HOME (every
  // test, every live check) gets its own lock namespace for free.
  return withSeatLock(seatKey(seat), async () => {
    const held = loadSeat(seat, opts);

    // One decision, made once per turn and REPORTED, so a caller can never be left guessing
    // which mode actually ran. A request for a mode the vendor cannot do is honoured as far as
    // possible and flagged, not silently downgraded.
    const cm = continuityMode(vendor, continuity);
    const replay = cm.mode === "replay";
    const previousResponseId = replay ? null : (held?.token?.value ?? null);
    const history = replay ? loadHistory(seat, opts) : undefined;

    const result = await sendTurn({ client, vendor, model, prompt, previousResponseId, history, onEvent, label, continuity, extra });

    if (!result.usable_for_resume) {
      return {
        ok: false, resumed: result.resumed, result,
        why: result.why_unusable,
        seat: held ?? null, persisted: false,
      };
    }

    const prior = held?.exchanges ?? [];
    const next = [...prior, ...exchangeTurns({ prompt, result })];
    const chain = record(next);

    if (replay) saveHistory(seat, result.history, opts);

    const saved = saveSeat(seat, {
      // A replayed responses turn DOES return a real response id even though we do not resume by
      // it; recording it as `sdk` keeps the vendor's own fact rather than a minted label. Only a
      // vendor that issues no id at all gets the operator-minted handle.
      token: result.response_id
        ? { value: result.response_id, source: "sdk" }
        : { value: held?.token?.value ?? `replay-${seatKey(seat)}`, source: "operator" },
      chain,
      exchanges: next,
    }, opts);

    return {
      ok: true,
      resumed: result.resumed,
      result,
      seat: saved,
      persisted: true,
      turns_added: next.length - prior.length,
      chain,
      continuity: !result.resumed
        ? "fresh conversation; no continuity claimed"
        : replay
          ? "replayed the full local history; continuity is OURS to keep and the vendor holds nothing"
          : "vendor accepted previous_response_id; server-side continuity is the VENDOR's assertion, not ours",
      mode: cm.mode,
      // Surfaced on every turn: what was asked for, what ran, and why they differ.
      continuity_requested: cm.requested,
      continuity_honoured: cm.honoured,
      continuity_note: cm.why,
    };
  }, { dir: join(home ?? pantheonHome(), "locks") });
}

// Local consistency check for the SDK path. Deliberately NOT named verifyExtends: it answers a
// weaker question, and sharing the name would invite reading it as the same guarantee.
export function recordExtendsLocally(allTurns, recorded) {
  if (typeof recorded?.length !== "number" || typeof recorded?.head !== "string") {
    throw new Error("recordExtendsLocally: record needs head and length");
  }
  if (recorded.length === 0) return { ok: false, why: "recorded chain is empty; no baseline" };
  if (allTurns.length < recorded.length) return { ok: false, why: "shorter than recorded" };
  const live = chainOf(allTurns);
  if (live[recorded.length - 1] !== recorded.head) return { ok: false, why: "prefix hash mismatch" };
  return { ok: true, grew: allTurns.length - recorded.length };
}
