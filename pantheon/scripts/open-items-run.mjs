#!/usr/bin/env node
// Run Pantheon on one of its own open items, from a terminal.
//
//   source ~/Projects/agentic-pipeline/sdk/keys-from-windows.sh
//   node scripts/open-items-run.mjs --ticket scripts/tickets/<item>.json [--dir <root>]
//
// This is a THIN WRAPPER. The pipeline itself -- intake, promote, plan, work, check, ship -- lives
// in src/board/run-item.mjs as an importable, non-exiting function, so this CLI and the HTTP build
// API (src/view/build-server.mjs) run the exact same logic rather than two copies.
//
// What belongs here and nowhere else: argv parsing, the vendor SDK imports (injected into the
// pipeline at the edge), console output, process-level signal handling, and the exit code. A
// long-lived server calling runOpenItem() gets none of those, which is the point.
//
// What this does NOT do: it never writes into this repository. The shipped artifact is copied to
// outputs/open-items/<key>/ for a human to read and apply. The Eye accepts; the harness certifies.
import OpenAI from "openai";
import { GoogleGenAI } from "@google/genai";
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { makeClient } from "../src/sdk/adapter.mjs";
import { runOpenItem } from "../src/board/run-item.mjs";

const argv = process.argv.slice(2);
const flag = (n, d = null) => { const i = argv.indexOf(n); return i === -1 ? d : argv[i + 1]; };
const REPO = resolve(dirname(new URL(import.meta.url).pathname), "..");
const specPath = flag("--ticket");
if (!specPath) { console.error("usage: open-items-run.mjs --ticket <spec.json> [--dir <root>]"); process.exit(2); }
const SPEC = JSON.parse(readFileSync(resolve(REPO, specPath), "utf8"));

// OPERATOR RESEAT, declared. `--seat planner=agy_google/gemini-3.5-flash` puts a named body in a
// chair for this run only; the chair, its pack and its projection do not change, and the run record
// says who sat where. A reseat is the seating table's own answer to a hose with no retry-after.
const seatOverrides = Object.fromEntries(argv.flatMap((a, i) => a === "--seat" ? [argv[i + 1]] : []).map(spec => {
  const [role, vm] = spec.split("="); const [vendor, model] = (vm ?? "").split("/");
  if (!role || !vendor || !model) { console.error(`--seat expects <role>=<vendor>/<model>, got "${spec}"`); process.exit(2); }
  return [role, { vendor, model, rank: 0, pool: vendor, band: null, basis: "OPERATOR", why: "operator reseat for this run" }];
}));

const clients = {};
const clientFor = (v, { pool = v, poolConfig } = {}) => (clients[`${v}:${pool}`] ??= makeClient(v, { OpenAI, GoogleGenAI, Anthropic, poolConfig }));

const bar = s => console.log(`\n\x1b[1m${s}\x1b[0m`);
const say = (k, v) => console.log(`  ${String(k).padEnd(13)} ${v}`);

bar(`open item ${SPEC.key} — ${SPEC.title ?? ""}`);
say("ticket", specPath);
say("target", SPEC.slot);
say("accept", SPEC.acceptance_cmd);
for (const [role, o] of Object.entries(seatOverrides)) say("reseat", `${role} chair: occupant for this run is ${o.vendor}/${o.model} (operator override; the chair and its pack are unchanged)`);

// The CLI's console view, reconstructed from the pipeline's own structured event stream -- the same
// events that go to progress.jsonl and, for an HTTP caller, onto a live bus.
let lastStage = null;
function printEvent(ev) {
  if (ev.stage && ev.stage !== lastStage) { lastStage = ev.stage; bar(ev.stage); }
  switch (ev.event) {
    case "check": return console.log(`  ${ev.ok ? "\x1b[32mok  \x1b[0m" : "\x1b[31mFAIL\x1b[0m"}  ${ev.detail}`);
    case "turn.done": return say(ev.seat, `${ev.model} · ${((ev.ms ?? 0) / 1000).toFixed(1)}s · ${ev.detail}`);
    case "turn.error": return say(ev.seat, `\x1b[31m${ev.detail}\x1b[0m`);
    case "reseat": return say("reseat", `\x1b[33m${ev.detail}\x1b[0m`);
    case "gate": return say(ev.stage, ev.detail);
    case "run.error": return console.error(`\n\x1b[31mRUN FAILED at ${lastStage}: ${ev.detail}\x1b[0m`);
    case "stage.start": return ev.detail ? say("", ev.detail) : undefined;
    case "turn.start": return undefined;              // turn.done carries the useful line
    default: return ev.detail ? say(ev.event, ev.detail) : undefined;
  }
}

// A CRASH IS RECORDED, NOT JUST THROWN -- and in a short-lived CLI process, an operator's ^C should
// still stop it. A long-lived server must NOT register these per build (see run-item.mjs), which is
// exactly why they live here and not in the pipeline.
let fatalOnce = false;
const onFatal = e => {
  if (fatalOnce) return; fatalOnce = true;
  console.error(`\n\x1b[31mRUN STOPPED: ${String(e?.message ?? e).slice(0, 400)}\x1b[0m`);
  process.exit(1);
};
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => onFatal(new Error(`${sig}: stopped by the operator`)));

// OPTIONAL SCOUT OVERRIDE, same reason and shape as the HTTP build API's (src/view/build-server.mjs):
// intake's default fan-out spends two independent pools (agy_google + xai) unconditionally, so a
// depleted or cooling-down vendor account there is a hard run.error at the very first stage, not a
// tolerated partial failure -- there is no other way to route around a known-down default pool.
const scoutsFlag = flag("--scouts");
const scouts = scoutsFlag ? scoutsFlag.split(",").map(s => s.trim()).filter(Boolean) : undefined;
if (scouts) say("scouts", `operator override for this run: ${scouts.join(", ")} (default is agy_google + xai)`);

const result = await runOpenItem(SPEC, {
  dir: flag("--dir"),
  resume: flag("--resume"),
  revisions: Number(flag("--revisions") ?? 3),
  seatOverrides,
  makeClientFor: clientFor,
  progress: printEvent,
  ...(scouts ? { scouts } : {}),
});

bar("result");
say("shipped", String(result.shipped));
say("board", result.board);
say("run", `${result.outDir}/run.json`);
if (result.salvaged) say("salvaged", result.salvaged);
if (result.error) console.error(`\n\x1b[31mRUN FAILED at ${result.error.stage}: ${result.error.message}\x1b[0m\n(run.json and any artifact are under ${result.outDir})`);
console.log(`\n${result.ok ? "\x1b[32mALL CHECKS PASSED\x1b[0m" : "\x1b[31mCHECK(S) FAILED\x1b[0m"}`);
process.exit(result.ok ? 0 : 1);
