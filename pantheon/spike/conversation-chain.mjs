#!/usr/bin/env node
// SPIKE (2026-09-27) — proves the §6.2 conversation-hashing claim against real transcripts.
// Throwaway: establishes that the check is implementable and DISCRIMINATING. Not production code.
//
// Claim under test: hash a normalized per-turn projection of a conversation into a chain; a
// resumed conversation EXTENDS the recorded chain, a silently-fresh one does not. The check must
// fail positively on a different conversation — an oracle that always passes proves nothing.
//
// Prints hashes and counts ONLY. Never conversation content.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

// Normalized projection: (role, canonical text, tool-call names). Deliberately NOT raw bytes —
// vendor transcript formats have no stability contract, so cosmetic churn must not invalidate.
function projectClaude(path) {
  const turns = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    if (o.type !== "user" && o.type !== "assistant") continue;
    const msg = o.message ?? o;
    const content = Array.isArray(msg.content) ? msg.content : [msg.content];
    const text = content.map(c =>
      typeof c === "string" ? c : (c?.text ?? "")).join("").trim();
    const tools = content.filter(c => c?.type === "tool_use").map(c => c.name).sort();
    if (!text && tools.length === 0) continue;
    turns.push({ role: o.type, len: text.length, sha: sha(text), tools });
  }
  return turns;
}
const sha = v => createHash("sha256").update(typeof v === "string" ? v : JSON.stringify(v)).digest("hex");

// Chain: each link binds its turn projection to its predecessor. Gives prefix/extension for free.
function chain(turns) {
  const links = []; let prev = "genesis";
  for (const t of turns) {
    prev = sha({ prev, role: t.role, sha: t.sha, tools: t.tools });
    links.push(prev);
  }
  return links;
}
// THE CHECK: does `live` extend the chain recorded at teardown?
function extendsChain(liveLinks, recordedHead, recordedLen) {
  if (liveLinks.length < recordedLen) return { ok: false, why: "shorter than recorded" };
  if (liveLinks[recordedLen - 1] !== recordedHead) return { ok: false, why: "prefix hash mismatch" };
  return { ok: true, grew: liveLinks.length - recordedLen };
}

const [a, b] = process.argv.slice(2);
const A = projectClaude(a), B = projectClaude(b);
const cA = chain(A), cB = chain(B);
console.log(`transcript A: ${A.length} turns, head ${cA.at(-1)?.slice(0,16)}`);
console.log(`transcript B: ${B.length} turns, head ${cB.at(-1)?.slice(0,16)}`);

// Simulate teardown. The cut MUST be <= B.length, or the "silently-fresh" case is caught by the
// length shortcut and the prefix-hash comparison never runs — it would pass for the wrong reason.
// (Observed on the first run: B was 96 turns against a 112-turn cut. Assert the probe ran.)
const cut = Math.max(1, Math.min(Math.floor(A.length * 0.6), B.length));
const recordedHead = cA[cut - 1], recordedLen = cut;
console.log(`\nrecorded at teardown: turn ${recordedLen}, head ${recordedHead.slice(0,16)}`);

const cases = [
  ["genuine resume (same conversation, grew)", cA, true],
  // Must be caught by the HASH, not by being short: B is >= cut by construction above.
  ["silently-fresh restart (different conversation)", cB, false, "prefix hash mismatch"],
  ["truncated/pruned thread (prefix only)", cA.slice(0, cut - 1), false, "shorter than recorded"],
  ["tampered mid-conversation turn", (() => {
      const t = A.map((x, i) => i === cut - 2 ? { ...x, sha: sha("altered") } : x);
      return chain(t);
    })(), false, "prefix hash mismatch"],
];
let pass = 0, fail = 0, hashDiscriminated = 0;
for (const [name, live, expectOk, wantWhy] of cases) {
  const r = extendsChain(live, recordedHead, recordedLen);
  let ok = r.ok === expectOk;
  // Assert the probe ran: where a case is meant to be caught BY THE HASH, a length-based
  // rejection is not a pass. An oracle that cannot say why it rejected is not an oracle.
  if (wantWhy && r.why !== wantWhy) ok = false;
  if (r.why === "prefix hash mismatch") hashDiscriminated++;
  ok ? pass++ : fail++;
  const detail = r.why ? `(${r.why})` : `(grew ${r.grew})`;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}: ok=${r.ok} ${detail}` +
    (wantWhy ? ` [required why="${wantWhy}"]` : ""));
}
console.log(`\n${pass} passed, ${fail} failed`);
console.log(`cases discriminated by PREFIX HASH (not length): ${hashDiscriminated}`);
if (hashDiscriminated === 0) {
  console.log("VACUOUS: no case exercised the hash comparison — the check is unproven.");
  process.exit(3);
}
if (A.length === B.length && cA.at(-1) === cB.at(-1)) {
  console.log("INCONCLUSIVE: the two transcripts are identical — pick different files.");
  process.exit(2);
}
process.exit(fail ? 1 : 0);
