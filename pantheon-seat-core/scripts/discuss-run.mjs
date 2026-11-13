#!/usr/bin/env node
// Four seats hold an actual discussion, through the live view so it is watchable.
import { runDiscussion, selfInterestedStances } from "../src/swarm/discuss.mjs";

const base = process.env.PANTHEON_VIEW ?? "http://127.0.0.1:7777";
const question = process.argv[2] ??
  "A harness runs four vendors' models as seats. Should a disagreement between seats ever be " +
  "resolved by majority vote? Take a side.";
const ROUNDS = Number(process.env.ROUNDS ?? 3);
// --adversarial assigns opposing stances so the disagreement is structural. The first run showed
// that a shared question can simply fail to divide them.
const ADVERSARIAL = process.argv.includes("--adversarial");
// --selfish: every seat argues for its OWN authority. Degenerate by design; see the module note.
const SELFISH = process.argv.includes("--selfish");
const STANCES = {
  openai:    "A disagreement between seats SHOULD be resolved by majority vote — it is the only mechanism that scales without a human in the loop.",
  xai:       "Majority vote is indefensible here; the only sound resolution is to escalate to a human, always.",
  google:    "Neither: disagreement should be resolved by whichever seat can produce an EXECUTABLE proof, and if none can, the question should be discarded as unanswerable.",
  anthropic: "Disagreement should be resolved by weighting seats by their measured past accuracy on similar tasks — an earned-authority model, not one-seat-one-vote.",
};

const SEATS = {
  openai:    { vendor: "openai",    model: "gpt-6-luna" },
  xai:       { vendor: "xai",       model: "grok-4.6" },
  google:    { vendor: "google",    model: "gemini-3.5-flash" },
  anthropic: { vendor: "anthropic", model: "claude-haiku-4-5-20251001" },
};
const state = async () => (await (await fetch(`${base}/seats`)).json()).state;

// Each seat keeps ONE conversation for the whole discussion (purpose "discuss"), so its own prior
// turns are its context and the prompt only has to carry what the OTHERS said.
async function runSeat(seat, prompt, round) {
  const s = SEATS[seat];
  const label = `${seat} · discuss`;
  const t0 = Date.now();
  const r = await fetch(`${base}/turn`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ vendor: s.vendor, model: s.model, label, purpose: "discuss", prompt }),
  }).then(x => x.json());
  const ok = r?.results?.[0]?.ok === true;
  if (!ok) return { ok: false, why: r?.results?.[0]?.why ?? "failed", ms: Date.now() - t0 };
  return { ok: true, text: (await state())[label]?.text ?? "", ms: Date.now() - t0 };
}

console.log(`question: ${question}\nseats: ${Object.keys(SEATS).join(", ")}  rounds: ${ROUNDS}\n`);

const SELF_STANCES = SELFISH ? selfInterestedStances(Object.keys(SEATS),
  Object.fromEntries(Object.entries(SEATS).map(([k, v]) => [k, `${v.vendor}, model ${v.model}`]))) : null;

if (SELFISH) {
  console.log("SELF-INTERESTED: every seat argues for its OWN authority.");
  console.log("Output is self-promotion under an assigned stance. No evidential value, twice over.\n");
}
if (ADVERSARIAL) {
  console.log("ADVERSARIAL: stances assigned. Output is arguments, NOT beliefs.\n");
  for (const [s, st] of Object.entries(STANCES)) console.log(`  ${s.padEnd(10)} must defend: ${st.slice(0, 96)}`);
  console.log("");
}

const r = await runDiscussion({
  question, seats: Object.keys(SEATS), rounds: ROUNDS, runSeat,
  stances: SELFISH ? SELF_STANCES : ADVERSARIAL ? STANCES : undefined,
  onRound: (round, turns, conv) => {
    console.log(`--- round ${round} — mean position similarity ${conv.meanSimilarity.toFixed(2)}, ` +
      `${conv.changedCount} seat(s) changed their mind ---`);
    for (const t of turns) {
      if (!t.ok) { console.log(`  ${t.seat.padEnd(10)} FAILED ${String(t.error).slice(0, 90)}`); continue; }
      const dis = t.disagrees === null ? "" : t.disagrees.length ? `  vs:${t.disagrees.join("/")}` : "  vs:none";
      console.log(`  ${t.seat.padEnd(10)}${t.changed === true ? " [MOVED]" : t.changed === false ? "        " : " [?]    "} ${t.position.slice(0, 140)}${dis}`);
      if (t.because) console.log(`  ${" ".repeat(10)}         └ ${t.because.slice(0, 160)}`);
    }
    console.log("");
  },
});

console.log(`similarity trend: ${r.trend.map(t => t.meanSimilarity.toFixed(2)).join(" -> ")}`);
console.log(`who moved: ${r.movement.map(m => `r${m.round}:[${m.changed.join(",") || "none"}]`).join("  ")}`);
if (r.malformed.length) console.log(`malformed (kept anyway): ${r.malformed.join(", ")}`);
if (r.failed.length) console.log(`failed turns: ${JSON.stringify(r.failed)}`);
console.log(`\n${r.verdict}`);
console.log(`evidential value: ${r.evidentialValue}`);
