#!/usr/bin/env node
// Run the layered swarm across real vendor seats, through the live view server so every layer
// is watchable, and report the parallelism actually achieved.
//
// The number that matters is `overlap` = sum(seat durations) / layer wall clock. A genuinely
// concurrent layer of n seats approaches n. A layer that fired sequentially lands at ~1.0 no
// matter what the code claims, which is the point of printing it.
import { runSwarm } from "../src/swarm/layered.mjs";

const base = process.env.PANTHEON_VIEW ?? "http://127.0.0.1:7777";
const question = process.argv[2] ??
  "A team runs four different vendors' models as parallel seats on the same engineering task. " +
  "Is the main value independent ERROR DETECTION, or parallel THROUGHPUT? Pick one and defend it.";

// Each swarm seat is a distinct pane and a distinct conversation, so layers do not overwrite one
// another and no seat's chain mixes layers from a different role.
const SEATS = [
  { seat: "openai",    vendor: "openai",    model: "gpt-6-luna" },
  { seat: "xai",       vendor: "xai",       model: "grok-4.6" },
  { seat: "google",    vendor: "google",    model: "gemini-3.5-flash" },
  { seat: "anthropic", vendor: "anthropic", model: "claude-haiku-4-5-20251001" },
];
const spec = Object.fromEntries(SEATS.map(s => [s.seat, s]));

const state = async () => (await (await fetch(`${base}/seats`)).json()).state;

// One seat turn. Returns its own duration so the layer can compute real overlap, and reads the
// produced text back from the server's reduced state rather than re-deriving it here.
async function runSeat(seat, prompt, layer) {
  const s = spec[seat];
  const label = `${seat} · swarm/${layer}`;
  const t0 = Date.now();
  const r = await fetch(`${base}/turn`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ vendor: s.vendor, model: s.model, label, purpose: `swarm-${layer}`, prompt }),
  }).then(x => x.json());
  const ms = Date.now() - t0;
  const ok = r?.results?.[0]?.ok === true;
  if (!ok) return { ok: false, why: r?.results?.[0]?.why ?? "failed", ms };
  const text = (await state())[label]?.text ?? "";
  return { ok: true, text, ms };
}

const bar = n => "█".repeat(Math.max(0, Math.round(n * 6)));

console.log(`question: ${question}\nseats: ${SEATS.map(s => s.seat).join(", ")}\n`);

const report = await runSwarm({
  question,
  seats: SEATS.map(s => s.seat),
  synthesizer: "openai",
  runSeat,
  onLayer: (layer, r) => {
    const n = r.results.length;
    // efficiency is the verdict: 1.0 means the layer cost only its slowest seat.
    const verdict = r.efficiency >= 0.85 ? "CONCURRENT" : r.efficiency >= 0.5 ? "partly overlapped" : "SERIALIZED";
    console.log(`layer ${layer.padEnd(11)} wall ${String(r.wallMs).padStart(6)}ms  ` +
      `slowest ${String(r.idealMs).padStart(6)}ms  serial-would-be ${String(r.serialMs).padStart(6)}ms  ` +
      `eff ${r.efficiency.toFixed(2)} ${bar(r.concurrency)} ${verdict}  ${r.ok}/${n} ok`);
    for (const f of r.failed) console.log(`    FAILED ${f.seat}: ${String(f.error).slice(0, 110)}`);
  },
});

console.log(`\npairing (must be a derangement — no seat reviews itself):`);
for (const p of report.pairs) console.log(`  ${p.reviewer} -> ${p.target}`);
for (const s of report.skippedPairs ?? []) console.log(`  SKIPPED ${s.reviewer} -> ${s.target}: ${s.why}`);

console.log(`\n--- layer 1: independent answers ---`);
for (const a of report.layers.explore.results.filter(r => r.ok)) {
  console.log(`\n  [${a.seat}] ${a.text.replace(/\s+/g, " ").trim().slice(0, 330)}`);
}
console.log(`\n--- layer 2: cross-refutations ---`);
for (const r of report.layers.refute.results.filter(x => x.ok)) {
  console.log(`\n  [${r.reviewer} -> ${r.target}] ${r.text.replace(/\s+/g, " ").trim().slice(0, 330)}`);
}
console.log(`\n--- layer 3: synthesis (${report.synthesis.seat}) ---\n`);
console.log(`  ${report.synthesis.text.replace(/\s+/g, " ").trim().slice(0, 1100)}`);

// The headline claim, with the arithmetic that supports it printed beside it.
const serial = Object.values(report.layers).reduce((a, l) => a + l.serialMs, 0);
const ideal = Object.values(report.layers).reduce((a, l) => a + l.idealMs, 0);
console.log(`\nwall ${report.totalMs}ms | sequential would be ${serial}ms | perfect concurrency floor ${ideal}ms`);
console.log(`speedup vs sequential ${(serial / report.totalMs).toFixed(2)}x; ` +
  `within ${(report.totalMs / ideal).toFixed(2)}x of the floor set by the slowest seat in each layer`);
console.log(`(the floor is what parallelism can buy: layers are ordered, so each still waits for its slowest member)`);
