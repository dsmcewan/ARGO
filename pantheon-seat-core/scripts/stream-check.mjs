#!/usr/bin/env node
// Proves streaming actually STREAMS. The failure this guards against is a "streaming" path that
// buffers and emits everything at the end: it satisfies every shape assertion, produces the
// right final text, and is useless for a live view. So the check is temporal, not structural —
// it measures the gap between the first delta and the last, and fails if they arrive together.
import OpenAI from "openai";
import { GoogleGenAI } from "@google/genai";
import Anthropic from "@anthropic-ai/sdk";
import { makeClient, ADAPTERS, sendTurn } from "../src/sdk/adapter.mjs";

const vendor = process.argv[2] ?? "openai";
const model = process.argv[3] ?? ADAPTERS[vendor]?.default_model;
if (!ADAPTERS[vendor]) { console.error(`no adapter for "${vendor}"`); process.exit(2); }

let failed = false;
const say = (ok, line) => { if (!ok) failed = true; console.log(`${ok ? "ok  " : "FAIL"}  ${line}`); };

const events = [];
const t0 = Date.now();
try {
  const client = makeClient(vendor, { OpenAI, GoogleGenAI, Anthropic });
  const res = await sendTurn({
    client, vendor, model,
    prompt: "List the numbers 1 to 60, one per line, nothing else.",
    onEvent: e => events.push({ ...e, ms: Date.now() - t0 }),
  });

  const deltas = events.filter(e => e.type === "delta");
  say(events.some(e => e.type === "start"), "emitted a start event");
  say(deltas.length > 1, `emitted ${deltas.length} incremental deltas`);
  say(events.some(e => e.type === "done"), "emitted a terminal done event");
  say(res.text.length > 0, `accumulated ${res.text.length} chars`);

  // THE check: a buffered impostor delivers every delta in one tick. An absolute millisecond
  // floor is the WRONG oracle and produced a false failure on a 26-char reply that streamed
  // correctly in two chunks -- the checker measuring reply length, not buffering. What actually
  // distinguishes streaming is that deltas land at DISTINCT times across the generation.
  if (deltas.length > 1) {
    const spread = deltas.at(-1).ms - deltas[0].ms;
    const distinct = new Set(deltas.map(d => d.ms)).size;
    say(distinct > 1,
      `deltas landed at ${distinct} distinct timestamps over ${spread}ms (a buffered fake lands at 1)`);
    say(deltas.at(-1).ms >= deltas[0].ms, "deltas are ordered in time");
  }
  say(res.complete === true, `stream reported complete=${res.complete}`);
  if (ADAPTERS[vendor].continuity === "server") {
    say(Boolean(res.response_id), `captured response id for resume: ${Boolean(res.response_id)}`);
  }
  console.log(`    first delta at ${deltas[0]?.ms ?? "-"}ms, done at ${events.at(-1)?.ms}ms`);
} catch (e) {
  say(false, `threw: ${e.status ? `HTTP ${e.status} ` : ""}${String(e.message).slice(0, 160)}`);
}
process.exit(failed ? 1 : 0);
