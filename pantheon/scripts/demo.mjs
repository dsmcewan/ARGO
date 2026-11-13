#!/usr/bin/env node
// Exercise every seat through a multi-turn sequence against a RUNNING view server, so the same
// run is visible in the browser and checkable here.
//
// The sequence is built so continuity cannot be faked. Turn 1 gives each seat a private fact.
// Turn 2 asks a question whose answer requires that fact and nothing else, so a seat that
// silently started a fresh conversation gets it wrong rather than getting it approximately
// right. Turn 3 asks all seats the same judgment question, which is where four seats are worth
// more than one -- their answers are supposed to differ.
const base = process.argv[2] ?? "http://127.0.0.1:7777";
const models = { anthropic: "claude-haiku-4-5-20251001" };

const post = async body => {
  const r = await fetch(`${base}/turn`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...body, models }),
  });
  return r.json();
};

const { seats: specs } = await (await fetch(`${base}/seats`)).json();
const seats = specs.map(s => s.vendor);
console.log(`seats: ${seats.join(", ")}\n`);

const state = async () => (await (await fetch(`${base}/seats`)).json()).state;
const show = (label, st) => {
  console.log(`\n--- ${label} ---`);
  for (const v of seats) {
    const s = st[v];
    if (!s) { console.log(`  ${v.padEnd(10)} (no events)`); continue; }
    const text = (s.text ?? "").replace(/\s+/g, " ").trim();
    console.log(`  ${v.padEnd(10)} ${s.status.padEnd(7)} turn ${s.turns}  ${s.error ? `ERROR ${s.error.slice(0, 80)}` : `"${text.slice(0, 96)}"`}`);
  }
};

// Each seat gets a DIFFERENT fact, so a seat answering from another seat's context would be
// visible rather than blending in.
const facts = Object.fromEntries(seats.map((v, i) => [v, `${["azure", "crimson", "ochre", "viridian"][i % 4]}-${1000 + i * 137}`]));

console.log("turn 1: give each seat a private fact");
for (const v of seats) {
  await post({ vendor: v, purpose: "demo", prompt: `Remember this token exactly: ${facts[v]}. Reply with only the word READY.` });
}
show("after turn 1", await state());

console.log("\nturn 2: a question only turn 1 can answer (continuity test)");
const r2 = await Promise.all(seats.map(v =>
  post({ vendor: v, purpose: "demo", prompt: "What token did I ask you to remember? Reply with only the token." })));
const st2 = await state();
show("after turn 2", st2);
let held = 0;
for (const v of seats) {
  const ok = (st2[v]?.text ?? "").toLowerCase().includes(facts[v].toLowerCase());
  const leaked = seats.some(o => o !== v && (st2[v]?.text ?? "").toLowerCase().includes(facts[o].toLowerCase()));
  if (ok) held++;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${v}: expected ${facts[v]}${leaked ? "  *** saw ANOTHER seat's token — seats are not isolated ***" : ""}`);
}
console.log(`continuity held on ${held}/${seats.length} seats`);

console.log("\nturn 3: same question to every seat — where four seats beat one");
await post({ seats, purpose: "demo",
  prompt: "In one sentence: what is the single biggest risk in running four different AI models as parallel 'seats' on one task? Be specific and do not hedge." });
const st3 = await state();
console.log("");
for (const v of seats) {
  const t = (st3[v]?.text ?? "").replace(/\s+/g, " ").trim();
  console.log(`  ${v}:\n    ${t.slice(0, 300)}\n`);
}

// Distinct answers are the point. If four seats return the same sentence, the fan-out bought
// nothing but cost, and that is worth seeing rather than assuming.
const answers = seats.map(v => (st3[v]?.text ?? "").trim()).filter(Boolean);
const distinct = new Set(answers.map(a => a.toLowerCase().replace(/[^a-z ]/g, "").slice(0, 120))).size;
console.log(`${distinct} distinct answer(s) from ${answers.length} seat(s)` +
  (distinct === answers.length ? " — the fan-out produced genuinely different views" : " — some seats agreed verbatim"));

// ---------------------------------------------------------------------------------------------
// Turn 4: cross-seat adversarial review. xai reviews openai, anthropic reviews google.
//
// This is the first thing in the demo that a single session cannot do: the reviewer is a
// genuinely different model with its own weights and its own conversation, so it is not grading
// its own work. The target's answer is passed as DATA and labelled as another model's, because a
// reviewer that mistakes the material for its own prior turn will defend it instead of attacking
// it.
//
// The prompt forbids bare agreement. "Looks good" from a reviewer that cannot be wrong is the
// failure mode this whole shape exists to avoid -- on 2026-09-22 a five-seat council cost $5.57
// to hand the asker's own framing back to him.
// ---------------------------------------------------------------------------------------------
const REVIEWS = [{ reviewer: "xai", target: "openai" }, { reviewer: "anthropic", target: "agy_google" }];

console.log("\nturn 4: cross-seat adversarial review");
const targetText = Object.fromEntries(seats.map(v => [v, (st3[v]?.text ?? "").replace(/\s+/g, " ").trim()]));

// Built by the role table, like every other prompt in this project: the target's answer is the ARTIFACT
// under review, and a reviewer holds artifacts. Hand-built here until the 2026-09-27 re-review noticed
// that a contextFor change would never have reached this script.
await Promise.all(REVIEWS.map(({ reviewer, target }) => post({
  vendor: reviewer, purpose: "demo",
  prompt: promptFor("reviewer",
    { artifact: `Below is an answer written by a DIFFERENT model (${target}), not by you. Do not defend it and do not restate it.\n\n` +
        `Its claim: "${targetText[target]}"` },
    `Attack it. Name the strongest specific flaw: an assumption it smuggles in, a case it fails, or a way it could be confidently wrong. ` +
    `If you judge it correct, say CORRECT and then name the most important thing it leaves out. ` +
    `Two sentences maximum. Do not begin by summarising the claim.`).prompt,
})));

const st4 = await state();
console.log("");
for (const { reviewer, target } of REVIEWS) {
  const t = (st4[reviewer]?.text ?? "").replace(/\s+/g, " ").trim();
  console.log(`  ${reviewer} -> ${target}:\n    ${t.slice(0, 420)}\n`);
}

// A reviewer that merely echoes its target has added nothing, so the overlap is measured rather
// than assumed. This is a crude lexical check and says so: it detects parroting, not agreement.
for (const { reviewer, target } of REVIEWS) {
  const rev = (st4[reviewer]?.text ?? "").toLowerCase();
  const tgt = (targetText[target] ?? "").toLowerCase();
  const tgtWords = [...new Set(tgt.split(/\W+/).filter(w => w.length > 6))];
  const echoed = tgtWords.filter(w => rev.includes(w)).length;
  const ratio = tgtWords.length ? echoed / tgtWords.length : 0;
  console.log(`  ${reviewer} reused ${echoed}/${tgtWords.length} of ${target}'s distinctive words ` +
    `(${(ratio * 100).toFixed(0)}%)${ratio > 0.6 ? " — high overlap, likely restating rather than reviewing" : ""}`);
}

// ---------------------------------------------------------------------------------------------
// Turns 5 and 6: two more tasks on two models this demo has not used.
//
// Run under a SEPARATE purpose ("demo-alt"). A seat is vendor+purpose+cwd, so switching model
// inside the existing "demo" seat would put two different models in one conversation and one
// hash chain — a seat is an identity, not a socket you swap parts through.
//
// The tasks are real. Task 5 hands a model the exact defect that shipped in this repo today, so
// its answer is checkable against a known ground truth instead of being graded on how confident
// it sounds. Task 6 asks for design work on the one adapter still missing.
// ---------------------------------------------------------------------------------------------
const ALT = [
  {
    vendor: "openai", model: "gpt-6-sol", label: "find the real defect",
    prompt:
      "This JavaScript builds an SDK client. On a machine where ANTHROPIC_API_KEY is set, it " +
      "authenticated with the WRONG credential and the call failed with 'credit balance is too low', " +
      "even though a valid OAuth token was found and passed. Name the bug in one sentence.\n\n" +
      "```js\n" +
      "const token = readOauthToken(spec, home);\n" +
      "if (token) {\n" +
      "  return new Anthropic({\n" +
      "    authToken: token,\n" +
      "    defaultHeaders: { 'anthropic-beta': 'oauth-2025-04-20' },\n" +
      "  });\n" +
      "}\n" +
      "return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });\n" +
      "```",
    // Ground truth: the SDK reads its key env var itself when apiKey is undefined, so the OAuth
    // client carried both credentials. Scored on whether the answer names that mechanism.
    expect: ["env", "environment", "apikey", "api key", "both", "x-api-key", "default"],
  },
  {
    vendor: "xai", model: "grok-4.20-multi-agent-0309", label: "design the missing adapter",
    prompt:
      "Design task, be concrete and brief. A Node harness drives AI 'seats' over vendor SDKs. Three " +
      "work: two keep conversation state server-side (send back a response id), one has no server " +
      "state so the harness replays local history each turn. The fourth vendor, Antigravity, exposes " +
      "Gemini, Opus 4.6 and GPT-OSS through ONE subscription, via a Python SDK or a CLI that emits " +
      "newline-delimited JSON events. Which integration would you choose for a Node harness, and name " +
      "the single biggest correctness risk it introduces. Four sentences maximum.",
  },
];

console.log("\nturns 5-6: two more tasks on two models not used above");
const altResults = await Promise.all(ALT.map(t =>
  post({ vendor: t.vendor, purpose: "demo-alt", prompt: t.prompt, models: { [t.vendor]: t.model } })));

const stAlt = await state();
console.log("");
for (const [i, t] of ALT.entries()) {
  const r = altResults[i]?.results?.[0];
  const text = (stAlt[t.vendor]?.text ?? "").replace(/\s+/g, " ").trim();
  console.log(`  ${t.vendor} @ ${t.model} — ${t.label}`);
  if (!r?.ok) { console.log(`    FAILED: ${String(r?.why ?? "unknown").slice(0, 180)}\n`); continue; }
  console.log(`    ${text.slice(0, 420)}`);
  // Only task 5 has a ground truth, so only task 5 is scored. Scoring task 6 on vocabulary
  // would be grading a design answer by keyword, which measures nothing.
  if (t.expect) {
    const hit = t.expect.filter(k => text.toLowerCase().includes(k));
    console.log(`    ${hit.length ? "ok  " : "MISS"}  named the mechanism: ${hit.length ? hit.join(", ") : "no — did not identify the env-var fallback"}`);
  }
  console.log("");
}
