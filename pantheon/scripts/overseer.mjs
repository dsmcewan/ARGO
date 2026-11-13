#!/usr/bin/env node
// The overseer: turns a run's progress events into plain-language lines a person can read while the
// run is happening, and SAYS SO when nothing is happening. A watcher that only fires on success is a
// watcher that is silent through a hang -- the 2026-09-27 live runs died three times (planner 429, an
// offer refused by the lease fence, a reviewer transport timeout) and the operator learned each one
// by asking "status?". This process answers before the question.
//
//   node scripts/overseer.mjs <progress.jsonl | outputs/open-items/<key>> [--stall 90] [--heartbeat 30]
//
// Every stdout line is one sentence. It exits when the run records run.end or run.error, or when the
// file has not changed for --giveup seconds (default 1800) -- and says which.
import { readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(n); return i === -1 ? d : Number(argv[i + 1]); };
let target = argv.find(a => !a.startsWith("--") && !/^\d+$/.test(a));
if (!target) { console.error("usage: overseer.mjs <progress.jsonl | run dir> [--stall S] [--heartbeat S] [--giveup S]"); process.exit(2); }
if (existsSync(target) && statSync(target).isDirectory()) target = join(target, "progress.jsonl");
const STALL = flag("--stall", 90), HEARTBEAT = flag("--heartbeat", 30), GIVEUP = flag("--giveup", 1800);

const fmt = s => s >= 60 ? `${Math.floor(s / 60)}m${String(Math.round(s % 60)).padStart(2, "0")}s` : `${Math.round(s)}s`;
const say = s => { process.stdout.write(s + "\n"); };

let seen = 0, lastChange = Date.now(), lastShown = Date.now(), lastEvent = null, done = false;
const current = { stage: "starting", seat: null, since: Date.now(), rev: null, writing: null };
// Streaming seats emit a progress event every few seconds. Printing each one is noise; printing none
// is silence. They are folded into the heartbeat: at most one "still writing: N chars" per interval.
let pendingProgress = null;

function describe(e) {
  const t = e.elapsed_s != null ? `[${fmt(e.elapsed_s)}]` : "";
  const who = e.seat ? `${e.seat}${e.model ? `/${e.model}` : ""}` : "";
  switch (e.event) {
    case "run.start": return `${t} run started: ${e.detail}`;
    case "stage.start": current.stage = e.stage; current.since = Date.now(); current.seat = null;
      return `${t} stage ${e.stage}${e.detail ? ` — ${e.detail}` : ""}`;
    case "turn.start": current.seat = who; current.since = Date.now();
      return `${t} ${who} is working on ${e.stage}${e.detail ? ` (${e.detail})` : ""}…`;
    case "turn.progress": current.writing = e.detail; pendingProgress = `${t} ${who} still writing: ${e.detail}`; return null;
    case "turn.done": current.seat = null; return `${t} ${who} answered in ${fmt(e.ms / 1000)} (${e.detail})`;
    case "turn.error": current.seat = null; return `${t} ${who} FAILED: ${e.detail}`;
    case "reseat": return `${t} reseat: ${e.detail}`;
    case "wait": return `${t} waiting ${e.detail}`;
    case "wrote": return `${t} rev ${e.rev}: the implementer wrote ${e.detail}`;
    case "acceptance.start": return `${t} controller is running the acceptance for rev ${e.rev}: ${e.detail}`;
    case "acceptance.done": return `${t} acceptance for rev ${e.rev} ${e.exit === 0 ? "PASSED" : `FAILED (exit ${e.exit})`}${e.detail ? ` — ${e.detail}` : ""}`;
    case "revise": return `${t} the executed failure goes back to the implementer as rev ${e.rev}`;
    case "verdict": return `${t} review verdict from ${who}: ${e.detail}`;
    case "gate": return `${t} gate ${e.stage}: ${e.detail}`;
    case "ship": return `${t} SHIP: ${e.detail}`;
    case "run.end": return `${t} run finished: ${e.detail}`;
    case "run.error": return `${t} RUN FAILED at ${e.stage}: ${e.detail}`;
    default: return `${t} ${e.stage ?? ""} ${e.event}${e.detail ? `: ${e.detail}` : ""}`;
  }
}

function tick() {
  if (existsSync(target)) {
    const lines = readFileSync(target, "utf8").split("\n").filter(Boolean);
    if (lines.length < seen) { seen = 0; say("progress file was replaced — a new run; starting over"); }
    if (lines.length > seen) {
      for (const l of lines.slice(seen)) {
        let e; try { e = JSON.parse(l); } catch { continue; }
        lastEvent = e; const line = describe(e);
        if (line) { say(line); lastShown = Date.now(); pendingProgress = null; }
        // A file that carries more than one run (a relaunch appending after an earlier run.end) is
        // one stream: a later run.start reopens the watch, so the terminal line that matters is the
        // LAST run's, not the first one this reader happened to see.
        if (e.event === "run.start") done = false;
        if (e.event === "run.end" || e.event === "run.error") done = true;
      }
      seen = lines.length; lastChange = Date.now();
    }
  }
  if (done) { process.exit(lastEvent?.event === "run.error" ? 1 : 0); }
  const quiet = (Date.now() - lastChange) / 1000;
  if (quiet >= GIVEUP) { say(`giving up: no progress recorded for ${fmt(quiet)}; the run is presumed dead (last: ${lastEvent?.event ?? "nothing"})`); process.exit(3); }
  if ((Date.now() - lastShown) / 1000 >= HEARTBEAT) {
    lastShown = Date.now();
    const on = current.seat ? `${current.seat} on ${current.stage}` : `stage ${current.stage}`;
    if (pendingProgress) { say(`${pendingProgress} (${fmt((Date.now() - current.since) / 1000)} on this turn)`); pendingProgress = null; }
    else say(quiet >= STALL
      ? `WARNING: no progress for ${fmt(quiet)} — ${on} may be hung (transport timeout, rate limit, or a model still thinking)`
      : `still going: ${on} for ${fmt((Date.now() - current.since) / 1000)}, ${seen} events so far`);
  }
}
if (!existsSync(target)) say(`waiting for ${target} to appear…`);
setInterval(tick, 1000);
