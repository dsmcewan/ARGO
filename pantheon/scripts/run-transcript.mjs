#!/usr/bin/env node
// Build a transcript of the seat runs from their own progress streams.
//
// The runs already record themselves: `scripts/open-items-run.mjs` appends one JSON line per stage,
// seat turn, executed result, refusal, gate and terminal state to `outputs/open-items/<key>/progress.jsonl`,
// and writes `run.json` beside it. This reads those back and prints markdown. It is a READER: it
// invents nothing, and every number it shows came off disk.
//
// A progress file can hold SEVERAL launches against one key (a relaunch appends), so the file is split
// on `run.start` and each launch is reported separately with its own outcome. That is deliberate: the
// launches that failed are the ones worth reading, and a transcript that showed only the last one would
// be a success report rather than a record.
//
//   node scripts/run-transcript.mjs [--dir outputs/open-items] [--title "..."] > docs/runs/<date>.md
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(n); return i === -1 ? d : argv[i + 1]; };
const ROOT = flag("--dir", "outputs/open-items");
const TITLE = flag("--title", "Seat run transcript");

const fmt = s => s == null ? "" : (s >= 60 ? `${Math.floor(s / 60)}m${String(Math.round(s % 60)).padStart(2, "0")}s` : `${(+s).toFixed(1)}s`);
const lines = f => existsSync(f) ? readFileSync(f, "utf8").split("\n").filter(Boolean).flatMap(l => { try { return [JSON.parse(l)] } catch { return [] } }) : [];

// One launch = run.start .. (run.end | run.error | the next run.start).
function launches(events) {
  const out = [];
  for (const e of events) {
    if (e.event === "run.start" || out.length === 0) out.push([]);
    out[out.length - 1].push(e);
  }
  return out.filter(l => l.length);
}

function describe(e) {
  const t = e.elapsed_s != null ? fmt(e.elapsed_s) : "";
  const who = e.seat ? `${e.seat}${e.model ? `/${e.model}` : ""}` : "";
  switch (e.event) {
    case "run.start": return [t, "start", e.detail];
    case "stage.start": return [t, `stage ${e.stage}`, e.detail ?? ""];
    case "turn.start": return [t, `${who} →`, `${e.stage}${e.detail ? `, ${e.detail}` : ""}`];
    case "turn.done": return [t, `${who} ✓`, `${fmt(e.ms / 1000)} — ${e.detail}`];
    case "turn.error": return [t, `${who} ✗`, e.detail];
    case "reseat": return [t, "reseat", e.detail];
    case "wrote": return [t, `rev ${e.rev} written`, e.detail];
    case "acceptance.start": return [t, `acceptance rev ${e.rev}`, e.detail];
    case "acceptance.done": return [t, `acceptance rev ${e.rev}`, e.exit === 0 ? `PASSED — ${e.detail ?? ""}` : `FAILED exit ${e.exit} — ${e.detail ?? ""}`];
    case "revise": return [t, "revise", `executed failure returned as rev ${e.rev}`];
    case "reask": return [t, "re-ask", e.detail];
    case "verdict": return [t, "verdict", e.detail];
    case "gate": return [t, `gate ${e.stage}`, e.detail];
    case "ship": return [t, "SHIP", e.detail];
    case "resumed": return [t, "resumed", e.detail];
    case "run.end": return [t, "end", e.detail];
    case "run.error": return [t, "FAILED", e.detail];
    default: return null;   // tool/subagent/heartbeat chatter: counted, not transcribed
  }
}

const keys = existsSync(ROOT) ? readdirSync(ROOT, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name).sort() : [];
const summary = [];
const bodies = [];

for (const key of keys) {
  const dir = join(ROOT, key);
  const evs = lines(join(dir, "progress.jsonl"));
  if (!evs.length) continue;
  let run = null;
  try { run = JSON.parse(readFileSync(join(dir, "run.json"), "utf8")); } catch { /* a run that died early may have none */ }
  const ls = launches(evs);
  bodies.push(`\n## ${key}\n`);
  if (run?.key) {
    const seats = Object.entries(run.reseats ?? {}).map(([r, o]) => `${r}=${o.vendor}/${o.model}`).join(", ");
    bodies.push(`Board \`${run.board ?? "?"}\`. Acceptance \`${run.acceptance?.cmd ?? "?"}\`.${seats ? ` Declared reseats: ${seats}.` : ""}\n`);
  }
  ls.forEach((l, i) => {
    const last = l[l.length - 1];
    const tools = l.filter(e => e.event === "tool.start").length;
    const subs = l.filter(e => e.event === "subagent.start").length;
    const outcome = last.event === "run.end" ? "shipped or completed" : last.event === "run.error" ? `died: ${last.detail}` : "no terminal event recorded";
    const shipped = l.find(e => e.event === "ship")?.detail ?? null;
    summary.push({ key, launch: i + 1, secs: last.elapsed_s, outcome: shipped ?? outcome, tools, subs });
    bodies.push(`\n### launch ${i + 1} of ${ls.length} — ${fmt(last.elapsed_s)}${tools ? `, ${tools} seat tool call(s), ${subs} subagent invocation(s)` : ""}\n`);
    bodies.push("| at | what | detail |");
    bodies.push("|---|---|---|");
    for (const e of l) {
      const d = describe(e);
      if (d) bodies.push(`| ${d[0]} | ${d[1]} | ${String(d[2] ?? "").replace(/\|/g, "\\|").slice(0, 220)} |`);
    }
  });
}

const out = [];
out.push(`# ${TITLE}`, "");
out.push(`Generated by \`scripts/run-transcript.mjs\` from \`${ROOT}/*/progress.jsonl\` — the runs' own records, not a retelling.`, "");
out.push(`**${summary.length} launches across ${keys.length} items.**`, "");
out.push("| item | launch | wall clock | outcome |");
out.push("|---|---|---|---|");
for (const s of summary) out.push(`| ${s.key} | ${s.launch} | ${fmt(s.secs)} | ${String(s.outcome).replace(/\|/g, "\\|").slice(0, 150)} |`);
out.push(...bodies);
process.stdout.write(out.join("\n") + "\n");
