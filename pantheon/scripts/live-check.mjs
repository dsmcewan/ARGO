#!/usr/bin/env node
// Live end-to-end proof of the SDK transport: two turns on a real seat, against a real vendor.
//
// This exists because 161 green unit tests prove only that the adapter behaves as its author
// expects against a fake. The property that matters -- that turn two actually CONTINUES turn one
// on the vendor's side -- can only be shown by asking the vendor something it could answer only
// from the first turn. That is the check here, and it is the whole point of the file.
//
// Usage: node scripts/live-check.mjs [vendor] [model]   (keys from the environment)
import OpenAI from "openai";
import { GoogleGenAI } from "@google/genai";
import Anthropic from "@anthropic-ai/sdk";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeClient, ADAPTERS, isReplay } from "../src/sdk/adapter.mjs";
import { sdkTurn, recordExtendsLocally } from "../src/sdk/seat-sdk.mjs";
import { loadSeat } from "../src/seat/store.mjs";

const vendor = process.argv[2] ?? "openai";
// Third arg may be a model or a continuity mode, so the same script can prove both modes.
const continuity = process.argv.includes("--replay") ? "replay"
  : process.argv.includes("--server") ? "server" : undefined;
const model = (process.argv[3] && !process.argv[3].startsWith("--")) ? process.argv[3] : ADAPTERS[vendor]?.default_model;
if (!ADAPTERS[vendor]) { console.error(`no adapter for "${vendor}"`); process.exit(2); }

// An isolated PANTHEON_HOME: a live check must not write into the operator's real seat store.
const home = mkdtempSync(join(tmpdir(), "pantheon-live-"));
const seat = { vendor, purpose: "live-check", cwd: process.cwd(), home };

// A secret the model can only know from turn one. If turn two answers it, the conversation
// genuinely continued server-side; if it does not, previous_response_id bought us nothing.
const SECRET = `plum-${Math.random().toString(36).slice(2, 8)}`;

let failed = false;
const say = (ok, line) => { if (!ok) failed = true; console.log(`${ok ? "ok  " : "FAIL"}  ${line}`); };

try {
  const client = makeClient(vendor, { OpenAI, GoogleGenAI, Anthropic });
  console.log(`vendor=${vendor} model=${model} continuity=${continuity ?? "(vendor default)"} host=${ADAPTERS[vendor].base_url ?? "(sdk default)"}`);

  const a = await sdkTurn({ ...seat, client, model, continuity,
    prompt: `Remember this codeword exactly: ${SECRET}. Reply with just the word OK.` });
  say(a.ok, `turn 1 ${a.ok ? "sent" : `refused: ${a.why}`} id=${a.result.response_id} resumed=${a.resumed}`);
  if (!a.ok) process.exit(1);
  say(a.resumed === false, "turn 1 correctly claimed no resume");

  const b = await sdkTurn({ ...seat, client, model, continuity,
    prompt: "What was the codeword? Reply with only the codeword." });
  say(b.ok, `turn 2 ${b.ok ? "sent" : `refused: ${b.why}`} id=${b.result.response_id} resumed=${b.resumed}`);
  if (!b.ok) process.exit(1);
  say(b.resumed === true, `turn 2 claimed a resume via ${b.mode === "replay" ? "replayed history" : "previous_response_id"}`);
  // Mode-aware. Asserting a server-continuity property at a replay vendor is a false failure --
  // the checker measuring the wrong property, which is the defect class this project keeps
  // finding in other people's gates and just reproduced in its own.
  const replay = b.mode === "replay";
  // Was "replay vendor returns no response id". That coupled the MODE to id presence, which was
  // only ever true of google/anthropic -- a replayed Responses turn does return an id, and the
  // assertion failed a correct run the moment openai gained a replay toggle. The real rule is
  // about distinct identity per turn, and it only applies where ids exist at all.
  if (a.result.response_id && b.result.response_id) {
    say(b.result.response_id !== a.result.response_id, "each turn got its own response id");
  } else {
    say(true, "this vendor issues no response id; continuity rests on the replayed history");
  }

  // THE check. Everything above could pass with no continuity at all.
  const recalled = b.result.text.toLowerCase().includes(SECRET.toLowerCase());
  say(recalled, `continuity: model ${recalled ? "RECALLED" : "did NOT recall"} the turn-1 codeword`);

  const stored = loadSeat({ vendor, purpose: "live-check", cwd: process.cwd() }, { home });
  // Provenance must match ORIGIN, not mode: `sdk` exactly when the vendor returned an id,
  // `operator` exactly when the handle was minted here. Asserting "replay means operator" was
  // testing an implementation accident and mislabelled a correct `sdk` as a failure.
  if (b.result.response_id) {
    say(stored.token.source === "sdk",
      `provenance ${stored.token.source} — the vendor issued the id, so it is a vendor fact`);
    say(stored.token.value === b.result.response_id, "seat holds the latest response id");
  } else {
    say(stored.token.source === "operator",
      `provenance ${stored.token.source} — no vendor id exists, so the handle is ours and says so`);
  }
  say(stored.exchanges.length === 4, `chain covers ${stored.exchanges.length} turns (expected 4)`);
  say(recordExtendsLocally(stored.exchanges, a.chain).ok, "turn-2 record extends the turn-1 chain");

  // No conversation text may reach disk.
  const blob = JSON.stringify(stored);
  say(!blob.includes(SECRET), "no conversation content in the persisted seat record");
  // A replay vendor MUST have kept the words somewhere, or the next turn silently restarts.
  // Checking only the seat record would pass a system that had lost the conversation entirely.
  say(b.continuity_honoured !== false, `continuity mode honoured: ran ${b.mode} (asked ${b.continuity_requested})`);
  if (replay) {
    const { loadHistory } = await import("../src/sdk/history.mjs");
    const h = loadHistory({ vendor, purpose: "live-check", cwd: process.cwd() }, { home });
    say(h.length >= 4, `history holds ${h.length} messages (replay continuity depends on it)`);
    say(JSON.stringify(h).includes(SECRET), "the codeword is in the history file, where replay needs it");
  }
} catch (e) {
  say(false, `threw: ${e.status ? `HTTP ${e.status} ` : ""}${e.message.slice(0, 200)}`);
} finally {
  rmSync(home, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
