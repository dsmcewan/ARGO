#!/usr/bin/env node
// End-to-end proof of the live view: start the server, subscribe to /events as a browser would,
// fire a real multi-seat turn, and verify deltas arrive OVER THE WIRE while the turn is still
// running. Checking only the final HTTP response would pass a server that buffered everything
// and delivered it at the end — which is the exact failure the view exists to remove, so the
// assertion is again temporal: at least one delta must reach the SSE client BEFORE /turn returns.
import OpenAI from "openai";
import { GoogleGenAI } from "@google/genai";
import Anthropic from "@anthropic-ai/sdk";
import { createViewServer } from "../src/view/server.mjs";
import { makeClient } from "../src/sdk/adapter.mjs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const seats = (process.argv[2] ?? "openai,anthropic").split(",");
const home = mkdtempSync(join(tmpdir(), "pantheon-view-"));
let failed = false;
const say = (ok, line) => { if (!ok) failed = true; console.log(`${ok ? "ok  " : "FAIL"}  ${line}`); };

const models = { anthropic: "claude-haiku-4-5-20251001" };
const cache = new Map();
const makeClientFor = v => {
  if (!cache.has(v)) cache.set(v, makeClient(v, { OpenAI, GoogleGenAI, Anthropic }));
  return cache.get(v);
};

const { listen, server } = createViewServer({ makeClientFor, home });
const addr = await listen(0);
const base = `http://127.0.0.1:${addr.port}`;

try {
  const page = await fetch(`${base}/`);
  say(page.ok, `GET / served the view (${page.status})`);
  const html = await page.text();
  say(html.includes("createRoot"), "page mounts a React root");

  const specs = await (await fetch(`${base}/seats`)).json();
  say(specs.seats.length >= 4, `GET /seats lists ${specs.seats.length} adapters`);

  // Subscribe exactly as the browser does, and timestamp arrivals.
  const received = [];
  const es = await fetch(`${base}/events`);
  const reader = es.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const pump = (async () => {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n\n")) !== -1) {
        const frame = buf.slice(0, i); buf = buf.slice(i + 2);
        const line = frame.split("\n").find(l => l.startsWith("data: "));
        if (line) received.push({ ...JSON.parse(line.slice(6)), ms: Date.now() });
      }
    }
  })();

  const t0 = Date.now();
  const turn = await fetch(`${base}/turn`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ seats, prompt: "List the numbers 1 to 40, one per line, nothing else.", models }),
  });
  const turnDoneAt = Date.now();
  const body = await turn.json();

  // Drain before asserting. /turn resolving means the LAST seat's HTTP call returned; the final
  // events for that turn can still be in the SSE pipe, and this check measured "2 start, 1 done"
  // purely because it stopped listening first. A checker that closes its own channel and then
  // reports a missing event is manufacturing the defect it claims to find.
  const wantDone = seats.length;
  const drainDeadline = Date.now() + 3000;
  while (received.filter(e => e.type === "done").length < wantDone && Date.now() < drainDeadline) {
    await new Promise(r => setTimeout(r, 50));
  }

  const deltas = received.filter(e => e.type === "delta");
  say(deltas.length > 0, `SSE delivered ${deltas.length} deltas`);
  // THE check.
  const early = deltas.filter(e => e.ms < turnDoneAt - 50);
  say(early.length > 0,
    `${early.length} delta(s) arrived BEFORE /turn returned (a buffering server delivers 0)`);

  const seatsSeen = new Set(received.filter(e => e.seat).map(e => e.seat));
  say(seatsSeen.size >= Math.min(2, seats.length),
    `events arrived from ${seatsSeen.size} seat(s): ${[...seatsSeen].join(", ")}`);

  // Concurrency, measured on the REQUEST lifecycle rather than on output timing.
  //
  // Third attempt, and the first two were both proxies for the same property:
  //   1. "deltas must interleave" -- fails at perfect concurrency when one seat finishes
  //      before the other starts emitting. Measures relative latency.
  //   2. "delta windows must overlap" -- same flaw in a different shape. Observed here:
  //      openai emitted for 308ms and google's first token arrived 1.1s later, so the windows
  //      were disjoint by 792ms with nothing serialized.
  //
  // Output timing cannot answer this, because a fast seat can legitimately finish before a slow
  // seat begins speaking. What settles it is whether the requests were IN FLIGHT together: each
  // seat emits `start` when its call begins and `done` when it ends, so if the LAST start
  // precedes the FIRST done, every seat was running at the same moment. Serialized execution
  // makes that impossible by construction.
  if (seats.length > 1 && seatsSeen.size > 1) {
    const starts = received.filter(e => e.type === "start" && e.seat);
    const dones = received.filter(e => e.type === "done" && e.seat);
    const lastStart = Math.max(...starts.map(e => e.ms));
    const firstDone = Math.min(...dones.map(e => e.ms));
    say(starts.length >= 2 && dones.length >= 2,
      `saw ${starts.length} start and ${dones.length} done events`);
    say(lastStart < firstDone,
      `all seats were in flight together: last start at +${lastStart - t0}ms preceded first done ` +
      `at +${firstDone - t0}ms (serialized execution makes this impossible)`);
  }

  say(received.every(e => typeof e.seq === "number"),
    "every event carries a seq, so a reconnect can resume without double-rendering");
  const seqs = received.filter(e => e.seq).map(e => e.seq);
  say(seqs.every((s, i) => i === 0 || s > seqs[i - 1]), "seq is strictly increasing");

  say(body.results?.every(r => r.ok), `all seats reported ok: ${JSON.stringify(body.results)}`);
  console.log(`    turn took ${turnDoneAt - t0}ms; first delta at +${deltas[0]?.ms - t0}ms`);

  reader.cancel().catch(() => {});
  await Promise.race([pump, new Promise(r => setTimeout(r, 100))]);
} catch (e) {
  say(false, `threw: ${String(e?.message ?? e).slice(0, 220)}`);
} finally {
  server.close();
  rmSync(home, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
