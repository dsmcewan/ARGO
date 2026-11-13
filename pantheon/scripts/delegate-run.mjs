#!/usr/bin/env node
// Claude orchestrates; codex writes the code; the HARNESS runs it.
//
// The target is a real open defect in this repo (evidence §U2): sdkTurn read-modify-writes the
// history and the seat record with no lock, so two processes race and clobber. That was found
// by a different model reviewing my design, and is now handed to a third to fix.
//
// The verifier is the whole point. It writes the produced code to a temp file, imports it, and
// runs a concurrency scenario that FAILS if the lock does not actually serialize. No model is
// asked whether the code is correct — a model asked that produces a confident paragraph either
// way. The exit condition is the assertion, and the orchestrator is shown the result and told
// it may not argue with it.
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runAcceptance } from "../src/board/acceptance.mjs";
import { runOrchestration } from "../src/swarm/orchestrate.mjs";

const base = process.env.PANTHEON_VIEW ?? "http://127.0.0.1:7777";
const SEATS = {
  anthropic: { vendor: "anthropic", model: "claude-haiku-4-5-20251001" },
  openai:    { vendor: "openai",    model: "gpt-6-sol" },
  xai:       { vendor: "xai",       model: "grok-4.6" },
};
const state = async () => (await (await fetch(`${base}/seats`)).json()).state;

async function runSeat(seat, prompt, stage) {
  const s = SEATS[seat];
  const label = `${seat} · ${stage}`;
  const t0 = Date.now();
  const r = await fetch(`${base}/turn`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ vendor: s.vendor, model: s.model, label, purpose: `deleg-${stage}`, prompt }),
  }).then(x => x.json());
  const ok = r?.results?.[0]?.ok === true;
  if (!ok) return { ok: false, text: "", why: r?.results?.[0]?.why ?? "failed", ms: Date.now() - t0 };
  return { ok: true, text: (await state())[label]?.text ?? "", ms: Date.now() - t0 };
}

// THE ORACLE. Runs the produced code against a concurrency scenario. Nothing here asks a model
// anything; a lock that does not serialize fails the assertion and that is the verdict.
export async function verify({ task, code }) {
  const dir = mkdtempSync(join(tmpdir(), "pantheon-verify-"));
  try {
    writeFileSync(join(dir, "lock.mjs"), code);
    writeFileSync(join(dir, "probe.mjs"), `
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const mod = await import("./lock.mjs");
const withLock = mod.withSeatLock ?? mod.default;
if (typeof withLock !== "function") { console.log("NO_EXPORT"); process.exit(3); }
const dir = mkdtempSync(join(tmpdir(), "lk-"));
// Critical section that DETECTS overlap: if two holders are inside at once, 'inside' exceeds 1.
let inside = 0, maxInside = 0, completed = 0;
const job = async () => withLock("seat-x", async () => {
  inside++; maxInside = Math.max(maxInside, inside);
  await new Promise(r => setTimeout(r, 25));   // hold it long enough for a racer to collide
  inside--; completed++;
}, { dir });
await Promise.all([job(), job(), job(), job()]);
rmSync(dir, { recursive: true, force: true });
console.log(JSON.stringify({ maxInside, completed }));
process.exit(maxInside === 1 && completed === 4 ? 0 : 1);
`);
    const syn = await runAcceptance({ worktree: dir, cmd: "/usr/bin/node --check lock.mjs", timeout: 20_000 });
    if (syn.exit !== 0) {
      return { ok: false, detail: `syntax error: ${syn.out.split("\n")[0].slice(0, 160)}` };
    }
    const r = await runAcceptance({ worktree: dir, cmd: "/usr/bin/node probe.mjs", timeout: 20_000 });
    const out = r.out.trim().split("\n").pop() ?? "";
    if (r.exit === 0) return { ok: true, detail: `serialized correctly under 4 concurrent holders — ${out}` };
    // NOT a failure. The orchestrator can legitimately assign a code task that is not a lock
    // implementation -- a test harness, a helper -- and judging it with the lock oracle
    // reported "did NOT serialize" for something that was never meant to. An oracle applied
    // outside its domain must abstain, not fail: a wrong FAIL is worse than no verdict,
    // because it looks like a finding.
    if (out === "NO_EXPORT") {
      return { ok: null, applicable: false,
        detail: "oracle does not apply: this task produced no withSeatLock export, so there is nothing for the concurrency probe to judge" };
    }
    return { ok: false, detail: `did NOT serialize (${out || r.out.split("\n")[0]}).slice(0,160)` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
const preflight = mkdtempSync(join(tmpdir(), "pantheon-delegate-preflight-"));
try {
  const r = await runAcceptance({ worktree: preflight, cmd: "true", timeout: 10_000 });
  if (r.exit !== 0) throw new Error(`acceptance isolation preflight refused: ${r.out}`);
} finally { rmSync(preflight, { recursive: true, force: true }); }

const GOAL =
  "Close a confirmed concurrency defect: two processes taking a turn on the same seat " +
  "read-modify-write the same files with no lock, so one silently overwrites the other. " +
  "We need an advisory inter-process lock keyed by seat.";

const CONTEXT =
  "Target API: `export async function withSeatLock(seatKey, fn, { dir })` — acquires an " +
  "advisory lock for seatKey inside `dir`, awaits fn(), and releases it even if fn throws. " +
  "It must work ACROSS processes (a file-based lock, e.g. exclusive create with 'wx'), must " +
  "queue rather than reject when contended, must not deadlock, and must use only node: builtins. " +
  "It will be verified by running four concurrent holders and asserting that at most one is " +
  "inside the critical section at a time and all four complete.";

console.log(`orchestrator: anthropic   workers: openai, xai\ngoal: ${GOAL}\n`);

const report = await runOrchestration({
  goal: GOAL, context: CONTEXT,
  orchestrator: "anthropic",
  workers: ["openai", "xai"],
  runSeat, verify,
  onStage: (stage, r) => {
    if (stage === "warn") return console.log(`WARN ${r.note}`);
    if (stage === "plan") {
      if (!r.ok) return console.log(`plan FAILED (${r.ms}ms): ${r.why}\n  raw: ${String(r.raw).slice(0, 200)}`);
      console.log(`plan ok (${r.ms}ms) — ${r.plan.tasks.length} task(s)`);
      for (const t of r.plan.tasks) console.log(`  ${t.id} -> ${t.assignee} [${t.kind}] ${t.instruction.slice(0, 110)}`);
      console.log(`  acceptance: ${r.plan.acceptance}`);
    }
    if (stage === "work") console.log(`\nwork ${r.ok}/${r.total} seats returned (${r.ms}ms, concurrent)`);
    if (stage === "verify") {
      for (const [id, v] of Object.entries(r.verdicts)) console.log(`  VERIFY ${id}: ${v.ok ? "PASS" : "FAIL"} — ${v.detail}`);
      if (r.unverified.length) console.log(`  unverified (no executable oracle): ${r.unverified.join(", ")}`);
    }
    if (stage === "integrate") console.log(`\n--- orchestrator's report ---\n${String(r.text).replace(/\s+/g, " ").trim().slice(0, 900)}`);
  },
});

const all = Object.values(report.stages.verify?.verdicts ?? {});
const passed = all.filter(v => v.ok === true).length;
const failed = all.filter(v => v.ok === false).length;
const abstained = all.filter(v => v.ok === null).length;
console.log(`\nverified-by-execution: ${passed} PASSED, ${failed} FAILED, ${abstained} oracle-not-applicable, ` +
  `${report.stages.verify?.unverified?.length ?? 0} with no oracle at all. Unproven is not failed.`);

}
