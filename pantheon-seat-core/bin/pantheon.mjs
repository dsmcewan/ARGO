#!/usr/bin/env node
// Two things Plan 1 must prove: that the capability table is true, and that a resume resumed.
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { VENDORS } from "../src/seat/argv.mjs";
import { conformVendor } from "../src/seat/conformance.mjs";
import { locateStore } from "../src/context/locate.mjs";
import { projectTranscript, projectAgyDb } from "../src/context/project.mjs";
import { record, verifyExtends } from "../src/context/chain.mjs";
import { runTurn } from "../src/seat/turn.mjs";
import { loadSeat, saveSeat, pantheonHome } from "../src/seat/store.mjs";
// NOTE: VENDORS is imported once, above. A second import of the same binding is a SyntaxError
// that would fail this file at load, taking every verb with it.

const [verb, ...rest] = process.argv.slice(2);
const USAGE = [
  "usage: pantheon <verb>",
  "  conform",
  "  turn <vendor> <purpose> <cwd> <prompt...>",
  "  snapshot <vendor> <purpose> <cwd> [--session-id <id>]",
  "  verify-resume <vendor> <purpose> <cwd> <record.json> [--session-id <id>]",
  "",
  "exit codes: 0 ok/resumed  1 not-resumed  2 usage  3 unknown-vendor",
  "            4 identity-unresolvable  5 refused-stale-seat",
  "            6 bad-record  7 unreadable-transcript",
].join("\n");

// One code per failure class. A caller must be able to tell these apart without parsing prose,
// and it could not: an independent black-box suite found unknown-vendor colliding with bad-args on
// 2, and unknown-vendor colliding with unresolvable-identity on 3.
const EXIT = { OK: 0, NOT_RESUMED: 1, USAGE: 2, UNKNOWN_VENDOR: 3, NO_IDENTITY: 4, STALE_SEAT: 5,
  BAD_RECORD: 6, UNREADABLE: 7 };

// Reading a record used to throw and exit 1 -- the SAME code as a verified NOT RESUMED -- with a
// raw stack trace. A caller scripting this could not tell "this seat did not resume" from "I could
// not read your file", so a missing file read as an authoritative negative verdict. Found by an
// independent black-box suite. Fail closed with its own code and a controlled message instead.
function loadRecord(file) {
  let raw;
  try {
    raw = readFileSync(file, "utf8");
  } catch (e) {
    console.error(`cannot read record ${file}: ${e.code ?? e.message}`);
    process.exit(EXIT.BAD_RECORD);
  }
  let rec;
  try {
    rec = JSON.parse(raw);
  } catch (e) {
    console.error(`record ${file} is not valid JSON: ${e.message}`);
    process.exit(EXIT.BAD_RECORD);
  }
  if (typeof rec?.head !== "string" || typeof rec?.length !== "number") {
    console.error(`record ${file} is not a chain record: needs a string "head" and a numeric "length"`);
    process.exit(EXIT.BAD_RECORD);
  }
  return rec;
}

// A transcript we located can still be unreadable between the stat and the read.
function readTranscript(path) {
  try {
    return readFileSync(path, "utf8");
  } catch (e) {
    console.error(`cannot read transcript ${path}: ${e.code ?? e.message}`);
    process.exit(EXIT.UNREADABLE);
  }
}

// Not every vendor writes a text transcript. agy keeps one SQLite database per conversation, so
// reading its store as utf8 produces mojibake that parses to zero turns -- an empty projection,
// which is indistinguishable from an empty conversation and silently costs the seat its
// baseline. The locator reports the format; this is the single place that honours it, so no call
// site can forget. A new binary-store vendor fails here loudly instead of projecting to nothing.
function projectLocated(loc, vendor) {
  if (loc.format === "sqlite") {
    try {
      return projectAgyDb(loc.path);
    } catch (e) {
      console.error(`cannot read ${vendor} database ${loc.path}: ${e.message}`);
      process.exit(EXIT.UNREADABLE);
    }
  }
  return projectTranscript(readTranscript(loc.path), vendor);
}

// snapshot and verify-resume are SEAT-scoped, not cwd-scoped. Resolution is by session id now, and
// the only place an id lives is the seat record -- so these verbs need the seat, exactly as `turn`
// does. Taking (vendor, cwd) alone made them unreachable from outside: the resolver refused every
// call for want of an id, and the core section 6.2 contract became externally untestable. An
// explicit --session-id is accepted too, for a conversation that has no seat record yet.
function resolveIdentity(vendor, purpose, cwd, explicitId) {
  if (explicitId) return { sessionId: explicitId, from: "--session-id" };
  const held = loadSeat({ vendor, purpose, cwd });
  if (held?.token?.value) return { sessionId: held.token.value, from: `seat ${held.key} (${held.token.source})` };
  return { sessionId: null, from: null,
    why: `no session id for seat ${vendor}/${purpose} at ${cwd}: take a turn first, or pass --session-id` };
}

function takeFlag(args, name) {
  const i = args.indexOf(name);
  if (i === -1) return { args, value: undefined };
  return { args: [...args.slice(0, i), ...args.slice(i + 2)], value: args[i + 1] };
}

if (verb === "conform") {
  let bad = 0;
  for (const vendor of Object.keys(VENDORS)) {
    const r = await conformVendor(vendor);
    if (r.mismatches.length) {
      bad++;
      console.log(`FAIL ${vendor} (${r.checked} checked: ${r.checkedFlags.join(" ")})`);
      for (const m of r.mismatches) console.log(`  ${m}`);
    } else {
      console.log(`OK   ${vendor} (${r.checked} checked: ${r.checkedFlags.join(" ")})`);
    }
  }
  process.exit(bad ? 1 : 0);
} else if (verb === "snapshot") {
  const { args, value: explicitId } = takeFlag(rest, "--session-id");
  const [vendor, purpose, cwd] = args;
  if (!vendor || !purpose || !cwd) { console.error(USAGE); process.exit(EXIT.USAGE); }
  if (!VENDORS[vendor]) { console.error(`unknown vendor "${vendor}"`); process.exit(EXIT.UNKNOWN_VENDOR); }
  const ident = resolveIdentity(vendor, purpose, cwd, explicitId);
  if (!ident.sessionId) { console.error(`cannot snapshot: ${ident.why}`); process.exit(EXIT.NO_IDENTITY); }
  const loc = locateStore({ vendor, cwd, sessionId: ident.sessionId });
  if (!loc.path) { console.error(`cannot snapshot: ${loc.why}`); process.exit(EXIT.NO_IDENTITY); }
  const snap = record(projectLocated(loc, vendor));
  // The record carries the id it was taken against. A chain without its identity is a pin stored
  // beside the content it pins -- the anti-pattern this project's own spec section 8 flags.
  console.log(JSON.stringify({ ...snap, vendor, session_id: ident.sessionId }));
} else if (verb === "verify-resume") {
  const { args, value: explicitId } = takeFlag(rest, "--session-id");
  const [vendor, purpose, cwd, recordJson] = args;
  if (!vendor || !purpose || !cwd || !recordJson) { console.error(USAGE); process.exit(EXIT.USAGE); }
  if (!VENDORS[vendor]) { console.error(`unknown vendor "${vendor}"`); process.exit(EXIT.UNKNOWN_VENDOR); }
  const rec = loadRecord(recordJson);
  const ident = resolveIdentity(vendor, purpose, cwd, explicitId ?? rec.session_id);
  if (!ident.sessionId) { console.error(`cannot verify: ${ident.why}`); process.exit(EXIT.NO_IDENTITY); }
  // A record taken against a different conversation is not evidence about this one.
  if (rec.session_id && rec.session_id !== ident.sessionId) {
    console.log(`NOT RESUMED  reason="record was taken against session ${rec.session_id}, seat holds ${ident.sessionId}"`);
    process.exit(EXIT.NOT_RESUMED);
  }
  const loc = locateStore({ vendor, cwd, sessionId: ident.sessionId });
  if (!loc.path) { console.error(`cannot verify: ${loc.why}`); process.exit(EXIT.NO_IDENTITY); }
  const live = projectLocated(loc, vendor);
  const v = verifyExtends(live, rec);
  console.log(`${v.ok ? "RESUMED" : "NOT RESUMED"}  turns=${live.length} recorded=${rec.length}` +
    (v.ok ? ` grew=${v.grew}` : ` reason="${v.why}"`));
  process.exit(v.ok ? EXIT.OK : EXIT.NOT_RESUMED);
} else if (verb === "turn") {
  const [vendor, purpose, cwd, ...promptParts] = rest;
  const prompt = promptParts.join(" ");
  if (!vendor || !purpose || !cwd || !prompt) { console.error(USAGE); process.exit(EXIT.USAGE); }
  if (!VENDORS[vendor]) { console.error(`unknown vendor "${vendor}"`); process.exit(EXIT.UNKNOWN_VENDOR); }

  const seat = { vendor, purpose, cwd };
  const held = loadSeat(seat);

  // Verify BEFORE the turn. If we hold a chain, the live transcript must still extend it: a seat
  // whose conversation silently restarted must not be quietly continued as though it had not.
  if (held?.chain) {
    // Resolve by the seat's OWN stored id. Passing no id here was the whole defect: it handed back
    // whichever session in a shared directory wrote last, which then "verified" as a resume.
    const loc = locateStore({ vendor, cwd, sessionId: held.token?.value });
    if (loc.path) {
      const live = projectLocated(loc, vendor);
      const v = verifyExtends(live, held.chain);
      if (!v.ok) {
        console.error(`refusing to continue seat ${held.key}: stored chain not extended (${v.why}).`);
        console.error(`The conversation this seat held is gone. Start a fresh purpose, or accept a rebuild.`);
        process.exit(EXIT.STALE_SEAT);
      }
      console.log(`verified  seat=${held.key} chain=${held.chain.length} live=${live.length} grew=${v.grew}`);
    } else {
      // Cannot verify is not the same as verified. Say so and continue, rather than implying a
      // check that never ran.
      console.log(`UNVERIFIED  seat=${held.key}: ${loc.why}`);
    }
  }

  const fresh = !held?.token;
  const r = await runTurn({
    vendor, cwd, prompt,
    resumeToken: held?.token?.value,
    sessionId: fresh && VENDORS[vendor].session_id_flag ? randomUUID() : undefined,
  });
  console.log(`${r.outcome}  ${r.provenance.duration_ms}ms  stdout=${r.provenance.stdout_bytes}B  ` +
    `sha=${r.provenance.stdout_sha256.slice(0, 12)}  ${fresh ? "fresh" : "resumed"}`);

  const patch = {};
  // Record the id with its REAL provenance. An id parsed from vendor output is scrape rank; one we
  // minted ourselves is operator rank and must not outrank a vendor-confirmed value later.
  if (r.provenance.vendor_session_id) {
    patch.token = { value: r.provenance.vendor_session_id,
      source: r.provenance.session_id_source === "vendor" ? "scrape" : "operator" };
  }
  // Snapshot against the id in force AFTER the turn: the vendor's if it gave one, else the id we
  // supplied. runTurn reports which, so this never mistakes our own guess for the vendor's answer.
  const idNow = r.provenance.vendor_session_id ?? null;
  const after = idNow ? locateStore({ vendor, cwd, sessionId: idNow })
                      : { path: null, why: "no session id after the turn; nothing to snapshot against" };
  if (after.path) {
    const snap = record(projectLocated(after, vendor));
    // A zero-turn projection is not a baseline. Skipping the save keeps the store's refusal from
    // being routed around -- but it is SAID, not silent: the previous version dropped it with a
    // comment claiming tidiness, and the next turn then skipped verification with no message.
    if (snap.length > 0) patch.chain = snap;
    else console.log(`chain NOT stored: transcript projects to 0 turns, which is not a baseline (${after.path})`);
  }
  if (Object.keys(patch).length) {
    const saved = saveSeat(seat, patch);
    console.log(`seat ${saved.key} token=${saved.token ? saved.token.source : "none"} ` +
      `chain=${saved.chain ? saved.chain.length : 0} turns  (${pantheonHome()})`);
  } else {
    console.log(`seat not updated: no vendor id and no usable transcript (${after.why})`);
  }
  process.exit(r.ok ? EXIT.OK : EXIT.NOT_RESUMED);
} else {
  console.error(USAGE);
  process.exit(EXIT.USAGE);
}
