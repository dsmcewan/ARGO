#!/usr/bin/env node
// Validate and render the build-correction graph in docs/runs/graph/*.jsonl.
//
// WHY A CHECKER AND NOT JUST A DOCUMENT. A record of corrections is only worth reading if it cannot
// quietly rot: the whole point of this graph is that the next build trusts it. So every claim in it is
// anchored to something this script resolves — a commit that must exist in this repository, a path that
// must exist in the tree, an edge whose endpoints must both be nodes. A graph that cites a deleted file
// fails here instead of misleading someone in three weeks.
//
//   node scripts/graph-check.mjs                       validate; exit 1 on any hard failure
//   node scripts/graph-check.mjs --render > out.md     validate, then write the markdown
//
// HARD failures (exit 1): a duplicate id, an edge endpoint that is not a node, a commit hash git does
// not have, a repo-relative path that does not exist, an unparseable timestamp, a node in a phase that
// was never declared. SOFT findings (reported, exit 0): a `~`-prefixed path outside the repository that
// is gone — job logs and board directories are scratch, and their loss is expected rather than wrong.
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const REPO = join(import.meta.dirname, "..");
const DIR = join(REPO, "docs", "runs", "graph");
const RENDER = process.argv.includes("--render");

const files = existsSync(DIR) ? readdirSync(DIR).filter(f => f.endsWith(".jsonl")).sort() : [];
if (!files.length) { console.error(`graph-check: no .jsonl under ${DIR}`); process.exit(1); }

const recs = [];
for (const f of files) {
  readFileSync(join(DIR, f), "utf8").split("\n").forEach((line, i) => {
    if (!line.trim()) return;
    try { recs.push({ ...JSON.parse(line), _src: `${f}:${i + 1}` }); }
    catch (e) { hard(`${f}:${i + 1} is not valid JSON: ${e.message}`); }
  });
}

const hardFails = [], soft = [];
function hard(m) { hardFails.push(m); }

const nodes = recs.filter(r => r.t === "node");
const edges = recs.filter(r => r.t === "edge");
const phases = recs.filter(r => r.t === "phase");
const launches = recs.filter(r => r.t === "launch");
const metrics = recs.filter(r => r.t === "metrics");

// --- ids and edges -----------------------------------------------------------------------------
const byId = new Map();
for (const r of [...nodes, ...launches, ...phases, ...metrics]) {
  if (!r.id) { hard(`${r._src}: a ${r.t} record has no id`); continue; }
  if (byId.has(r.id)) hard(`${r._src}: duplicate id ${r.id} (also ${byId.get(r.id)._src})`);
  byId.set(r.id, r);
}
for (const e of edges) {
  for (const end of ["from", "to"]) {
    if (!byId.has(e[end])) hard(`${e._src}: edge ${end} "${e[end]}" resolves to no record`);
  }
}
const phaseIds = new Set(phases.map(p => p.id));
for (const n of nodes) if (n.phase && !phaseIds.has(n.phase)) hard(`${n._src}: node ${n.id} is in undeclared phase ${n.phase}`);

// --- timestamps --------------------------------------------------------------------------------
const stamped = [];
for (const n of [...nodes, ...launches]) {
  const at = n.at ?? n.start;
  if (!at) { hard(`${n._src}: ${n.id} has no timestamp`); continue; }
  const d = new Date(at);
  if (Number.isNaN(+d)) hard(`${n._src}: ${n.id} timestamp "${at}" does not parse`);
  else stamped.push({ ...n, _at: d });
}
stamped.sort((a, b) => a._at - b._at);

// --- commits must exist ------------------------------------------------------------------------
const commits = new Set(nodes.flatMap(n => n.landed_in ?? []).concat(launches.flatMap(l => l.landed_in ?? [])));
for (const c of commits) {
  try { execFileSync("git", ["-C", REPO, "cat-file", "-e", `${c}^{commit}`], { stdio: "ignore" }); }
  catch { hard(`commit ${c} is cited but this repository does not have it`); }
}

// --- cited paths -------------------------------------------------------------------------------
// A path is repo-relative (hard), `~`-prefixed or absolute (soft: scratch outside the tree), or a
// command line rather than a path (skipped: it names how to look, not a file).
for (const n of [...nodes, ...launches]) {
  for (const key of ["where", "evidence"]) {
    for (const p of n[key] ?? []) {
      if (/^(git|node|bash) /.test(p)) continue;
      if (p.startsWith("~") || p.startsWith("/")) {
        const abs = p.replace(/^~/, process.env.HOME ?? "~");
        if (!existsSync(abs)) soft.push(`${n.id}: external ${key} path is gone: ${p}`);
        continue;
      }
      if (!existsSync(join(REPO, p))) hard(`${n.id}: ${key} path does not exist in this repo: ${p}`);
    }
  }
}
// --- report ------------------------------------------------------------------------------------
const counts = nodes.reduce((a, n) => (a[n.kind] = (a[n.kind] ?? 0) + 1, a), {});
const actors = nodes.reduce((a, n) => (a[n.actor] = (a[n.actor] ?? 0) + 1, a), {});

if (!RENDER) {
  console.log(`graph-check: ${files.length} file(s), ${nodes.length} nodes, ${edges.length} edges, ${launches.length} launches, ${commits.size} commits cited`);
  console.log(`  kinds:  ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join("  ")}`);
  console.log(`  actors: ${Object.entries(actors).map(([k, v]) => `${k}=${v}`).join("  ")}`);
  for (const m of soft) console.log(`  SOFT  ${m}`);
  for (const m of hardFails) console.error(`  FAIL  ${m}`);
  console.log(hardFails.length ? `\n${hardFails.length} hard failure(s)` : `\nall citations resolve`);
  process.exit(hardFails.length ? 1 : 0);
}
if (hardFails.length) { for (const m of hardFails) console.error(`FAIL ${m}`); process.exit(1); }

// --- render ------------------------------------------------------------------------------------
const meta = recs.find(r => r.t === "meta") ?? {};
const out = [];
const t = s => new Date(s).toISOString().slice(11, 19) + "Z";
const day = s => new Date(s).toISOString().slice(5, 10);
const inbound = id => edges.filter(e => e.to === id);
const outbound = id => edges.filter(e => e.from === id);

out.push(`# The ${meta.build} build: every correction, in order`, "");
out.push(`Validated by \`node scripts/graph-check.mjs\` — every commit hash resolves in this repository and every repo-relative path exists. Source: \`docs/runs/graph/*.jsonl\`. Clock: ${meta.clock ?? "UTC"}.`, "");
out.push(`**${nodes.length} nodes, ${edges.length} edges, ${launches.length} launches, ${meta.commits ?? "?"} commits.** Kinds: ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(", ")}.`, "");
if (meta.note) out.push(`> ${meta.note}`, "");

const M = metrics[0];
if (M) {
  out.push(`## ${M.title}`, "");
  out.push(`| measure | value |`, `|---|---|`);
  out.push(`| commits | ${M.commits.total} |`);
  out.push(`| corrective by subject | ${M.commits.corrective_by_subject} (${M.commits.pct}%) |`);
  out.push(`| launches | ${M.launches.total} (${M.launches.boards} boards, ${M.launches.resumed} resumed) |`);
  out.push(`| shipped | ${M.launches.shipped} |`);
  out.push(`| refused by the gates | ${M.launches.refused_by_gates} |`);
  out.push(`| died | ${M.launches.died} |`);
  out.push(`| launch wall clock | ${M.launch_wall_clock.span} |`);
  out.push(`| seconds in launches | ${M.launch_wall_clock.summed_launch_seconds} |`);
  out.push(`| of which shipped nothing | ${M.launch_wall_clock.unshipped_seconds} (${M.launch_wall_clock.pct_unshipped}%) |`);
  out.push(`| first ship / last ship | ${M.trend.first_ship_seconds}s / ${M.trend.last_ship_seconds}s (${M.trend.factor}x) |`, "");
  out.push(`**Method.** ${M.method}`, "");
  out.push(`**On the commit count.** ${M.commits.note}`, "");
  out.push(`**On the launches.** ${M.launches.note}`, "");
  out.push(`**On the trend.** ${M.trend.note}`, "");
  out.push(`**Repeats.** ${M.repeats.detail}`, "");
}

out.push(`## Launches`, "");
out.push(`| # | item | start | end | secs | outcome | forced by |`, `|---|---|---|---|---|---|---|`);
for (const l of launches) {
  const cause = l.cause ? `${l.cause} ${byId.get(l.cause)?.title ?? ""}`.slice(0, 60) : "";
  out.push(`| ${l.id} | ${l.item} | ${day(l.start)} ${t(l.start)} | ${t(l.end)} | ${l.seconds} | ${l.outcome} | ${cause} |`);
}
out.push("");

for (const p of phases) {
  const ns = stamped.filter(n => n.phase === p.id && n.t === "node");
  if (!ns.length) continue;
  out.push(`## ${p.id} · ${p.title}`, "");
  out.push(`${t(p.span[0])} to ${t(p.span[1])}.${p.summary ? ` ${p.summary}` : ""}`, "");
  for (const n of ns) {
    const badge = { ruling: "RULING", correction: "CORRECTION", defect: "DEFECT", revision: "REVISION", confirmation: "CONFIRMED" }[n.kind] ?? n.kind.toUpperCase();
    out.push(`### ${n.id} · ${t(n.at)}${n.at_precision === "approx" ? " (approx)" : ""} · ${badge} · ${n.actor}`, "");
    out.push(`**${n.title}**`, "");
    if (n.quote) out.push(`> ${n.quote}`, "");
    if (n.detail) out.push(n.detail, "");
    const rel = [];
    for (const e of outbound(n.id)) rel.push(`${e.rel} → ${e.to} (${byId.get(e.to)?.title ?? "?"})${e.note ? ` — ${e.note}` : ""}`);
    for (const e of inbound(n.id)) rel.push(`← ${e.from} ${e.rel} this (${byId.get(e.from)?.title ?? "?"})`);
    if (rel.length) out.push(...rel.map(r => `- ${r}`), "");
    const bits = [];
    if (n.landed_in?.length) bits.push(`landed in \`${n.landed_in.join("`, `")}\``);
    if (n.becomes) bits.push(`became \`${n.becomes}\``);
    if (n.where?.length) bits.push(`at ${n.where.map(w => `\`${w}\``).join(", ")}`);
    if (n.evidence?.length) bits.push(`evidence ${n.evidence.map(w => `\`${w}\``).join(", ")}`);
    if (n.status === "open") bits.push(`**still open**`);
    if (bits.length) out.push(bits.join(" · "), "");
    if (n.standing_rule) out.push(`**Rule for the next build:** ${n.standing_rule}`, "");
  }
}

const rules = nodes.filter(n => n.standing_rule);
out.push(`## The standing rules this build produced`, "");
out.push(`Read these first. Each one cost a launch, a retraction or a round.`, "");
for (const n of rules) out.push(`- **${n.title}** (${n.id}, ${n.actor}) — ${n.standing_rule}`);
out.push("");
const open = nodes.filter(n => n.status === "open");
if (open.length) {
  out.push(`## Open at the end of this build`, "");
  for (const n of open) out.push(`- **${n.id} ${n.title}** — ${n.detail ?? ""}`);
  out.push("");
}
process.stdout.write(out.join("\n") + "\n");
