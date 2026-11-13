// Orchestrator/worker delegation across heterogeneous seats.
//
// Different from the swarm in layered.mjs, and the difference is the point. There, every seat
// answers the SAME question and the value is disagreement. Here one seat PLANS and other seats
// EXECUTE, and the value is specialisation: the orchestrator never writes the code and the
// worker never decides what to build.
//
// The load-bearing design decision is that no model grades the code. A coding task has a
// deterministic oracle available -- run it -- and a review seat asked "is this correct?" will
// produce a confident paragraph either way. So `verify` is injected, runs OUTSIDE every model,
// and its exit code is the verdict. The orchestrator is then shown what actually happened and
// is explicitly forbidden from overruling it.
//
// This is the shape the 2026-09-27 paired eval could not test: it granted a solver the Agent
// tool and hoped it would delegate, and it never did. Here delegation is structural. Whether
// that beats one strong model at the same task is still unmeasured, and this module does not
// claim it does.

import { promptFor } from "../role/roles.mjs";

const fence = /```(?:json)?\s*([\s\S]*?)```/;

// Models wrap JSON in prose and fences however they like. Extract defensively, and when it
// cannot be parsed say so with the raw text attached rather than returning an empty plan that
// silently executes nothing.
export function parsePlan(text) {
  const raw = String(text ?? "");
  const candidate = (raw.match(fence)?.[1] ?? raw).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) {
    return { ok: false, why: "no JSON object found in the plan", raw: raw.slice(0, 400) };
  }
  let plan;
  try {
    plan = JSON.parse(candidate.slice(start, end + 1));
  } catch (e) {
    return { ok: false, why: `plan is not valid JSON: ${e.message}`, raw: candidate.slice(0, 400) };
  }
  if (!Array.isArray(plan.tasks) || plan.tasks.length === 0) {
    return { ok: false, why: "plan has no tasks[]", raw: JSON.stringify(plan).slice(0, 400) };
  }
  return { ok: true, plan };
}

// A plan that assigns work to a seat we do not have is a plan that cannot run. Caught before
// anything is dispatched, and reported as a planning failure rather than as a worker failure --
// blaming the worker for the orchestrator's mistake is how a bad planner looks competent.
export function validateAssignments(plan, workers) {
  const ids = new Set();
  for (const task of plan.tasks) {
    if (typeof task?.id !== "string" || !task.id.trim() || ids.has(task.id)) {
      return { ok: false, why: "each required task must have a unique non-empty id" };
    }
    ids.add(task.id);
    if (!["code", "analysis"].includes(task.kind) || typeof task.instruction !== "string" || !task.instruction.trim()) {
      return { ok: false, why: "each required task needs a supported kind and instruction" };
    }
  }
  const known = new Set(workers);
  const bad = plan.tasks.filter(t => !known.has(t.assignee));
  return bad.length
    ? { ok: false, why: `plan assigns work to unknown seat(s): ${[...new Set(bad.map(t => t.assignee))].join(", ")}` }
    : { ok: true };
}

// Both prompts are built by promptFor(), for the reason given at length in layered.mjs: the role table
// is the gate, so the withholding is enforced rather than a property of what these two functions
// happen to pass. The mapping is planner -> implementer, and the acceptance criteria travel inside the
// ticket because that is where the token says they live.
//
// THE PROPERTY THIS BUYS, and it is the one this module exists to protect: an implementer does not
// hold `plan`. A worker handed the orchestrator's framing restates it instead of contradicting it, and
// a restatement reads as agreement. Before this change that held because workerPrompt was only ever
// called with {instruction, kind}; now a caller who passes the plan has it withheld and said so.
// `integrate` is the orchestrator closing its own plan, so it is the planner again: the verifier's results
// reach it as the STATE OF THE WORK ITEMS (a work_item token), which is what they are -- not as repro
// evidence the planner may not hold. Routed through the table so a future contextFor change propagates
// here instead of leaving one hand-built prompt behind (2026-09-27 re-review, rank 20).
export const ORCHESTRATE_ROLES = Object.freeze({ plan: "planner", work: "implementer", integrate: "planner" });

export function planPrompt({ goal, workers, context }) {
  return promptFor(ORCHESTRATE_ROLES.plan,
    { ticket: context ? `${goal}\n\nContext you must respect:\n${context}` : goal },
    `You decide what work exists and who does it. You do not write code.\n\n` +
    `Available worker seats: ${workers.join(", ")}\n\n` +
    `Reply with ONLY a JSON object, no prose outside it:\n` +
    `{"tasks":[{"id":"t1","assignee":"<seat>","kind":"code"|"analysis","instruction":"<what that seat must produce, self-contained>"}],` +
    `"acceptance":"<how a machine, not a model, will decide this goal was met>"}\n\n` +
    `Rules: keep it to at most 3 tasks; each instruction must stand alone because the worker sees ` +
    `nothing else; and "acceptance" must name something executable, not a quality adjective.`);
}

export function workerPrompt({ instruction, kind }) {
  const task = kind === "code"
    ? "Reply with ONLY the code in a single ```javascript fence. No explanation before or after. " +
      "It must run under Node 20+ with no dependencies outside node: builtins."
    : "Be concrete and brief. At most six sentences.";
  return promptFor(ORCHESTRATE_ROLES.work, { work_item: instruction }, task);
}

export function extractCode(text) {
  const m = String(text ?? "").match(/```(?:javascript|js|mjs)?\s*([\s\S]*?)```/);
  return (m?.[1] ?? String(text ?? "")).trim();
}

// The orchestrator's closing turn. It is shown the VERIFIER's result, not the worker's opinion
// of its own work, and is told it may not overrule it -- otherwise a model reading confident
// code talks itself past a failing test.
export function integrateBuilt({ goal, results, verdicts }) {
  const body = results.map(r => {
    const v = verdicts[r.id];
    return `[${r.id} — ${r.assignee} — ${r.kind}]\n` +
      (v ? `VERIFIER (ran outside every model, this is ground truth): ` +
           `${v.ok === true ? "PASS" : v.ok === false ? "FAIL" : "NOT APPLICABLE — no verdict"} — ${v.detail}\n` : "") +
      `output: ${String(r.text ?? "").slice(0, 900)}`;
  }).join("\n\n");
  return promptFor(ORCHESTRATE_ROLES.integrate, { ticket: goal, work_item: body },
    `Report, in at most six sentences: what is now done, what is NOT, and the single next action. ` +
    `Where a verifier ran, its result is final — you may not argue a FAIL into a pass, and you may ` +
    `not claim success for anything it did not check.`);
}

export function integratePrompt(args) { return integrateBuilt(args).prompt; }

export async function runOrchestration({
  goal, orchestrator, workers, runSeat, verify, context, onStage,
}) {
  if (!orchestrator) throw new Error("runOrchestration: orchestrator seat required");
  if (!Array.isArray(workers) || !workers.length) throw new Error("runOrchestration: workers required");
  if (workers.includes(orchestrator)) {
    // Not a hard error -- sometimes you want it -- but it removes the separation this shape
    // exists for, so it is surfaced rather than silently allowed.
    onStage?.("warn", { note: `orchestrator ${orchestrator} is also a worker; it will grade work it produced` });
  }
  const report = { goal, orchestrator, workers, stages: {} };

  // 1. PLAN
  const t0 = Date.now();
  const planBuilt = planPrompt({ goal, workers, context });
  const planned = await runSeat(orchestrator, planBuilt.prompt, "plan");
  const parsed = parsePlan(planned.text);
  report.stages.plan = { ms: Date.now() - t0, ok: parsed.ok, why: parsed.why, raw: planned.text };
  if (!parsed.ok) { onStage?.("plan", report.stages.plan); return report; }
  const valid = validateAssignments(parsed.plan, workers);
  if (!valid.ok) {
    report.stages.plan.ok = false;
    report.stages.plan.why = valid.why;
    onStage?.("plan", report.stages.plan);
    return report;
  }
  report.plan = parsed.plan;
  onStage?.("plan", { ...report.stages.plan, plan: parsed.plan });

  // 2. DISPATCH — workers run concurrently; each sees only its own instruction.
  const t1 = Date.now();
  const settled = await Promise.allSettled(parsed.plan.tasks.map(t =>
    runSeat(t.assignee, workerPrompt(t).prompt, "work").then(r => ({ ...t, ...r }))));
  const results = settled.map((s, i) => s.status === "fulfilled"
    ? s.value
    : { ...parsed.plan.tasks[i], ok: false, text: "", why: String(s.reason?.message ?? s.reason) });
  report.stages.work = {
    ms: Date.now() - t1,
    ok: results.filter(r => r.ok).length,
    total: results.length,
    results,
  };
  onStage?.("work", report.stages.work);

  // 3. VERIFY — outside every model. Only code tasks have a deterministic oracle; analysis
  // tasks are reported UNVERIFIED rather than assigned a made-up pass.
  // Task IDs are data, including "__proto__"; a prototype setter must not hide a failed oracle.
  const verdicts = Object.create(null);
  for (const r of results) {
    if (r.kind === "code" && r.ok && typeof verify === "function") {
      verdicts[r.id] = await verify({ task: r, code: extractCode(r.text) });
    }
  }
  // THE GATE. Previously the verdicts were computed, shown to the integrator, and then nothing
  // happened -- the run had no top-level outcome, so a FAIL was a paragraph rather than a result.
  // That is gate theater: a check that cannot stop anything. The oracle's verdict now decides the
  // run's `ok`, and no prose from the integrator can move it.
  const failed = Object.entries(verdicts).filter(([, v]) => v.ok === false).map(([id]) => id);
  const passed = Object.entries(verdicts).filter(([, v]) => v.ok === true).map(([id]) => id);
  const unverified = results.filter(r => verdicts[r.id]?.ok !== true && verdicts[r.id]?.ok !== false).map(r => r.id);
  report.stages.verify = { verdicts, unverified, failed, passed };
  report.gate = {
    // Every planned task is required. An absent worker/oracle is not a passing sibling.
    ok: results.every(r => r.ok === true) && unverified.length === 0 && failed.length === 0 && passed.length > 0,
    failed, passed, unverified,
    why: failed.length ? `oracle FAILED: ${failed.join(", ")}`
      : passed.length === 0 ? "no task was verified by an executable oracle, so nothing is proven"
      : unverified.length ? `required tasks remain unverified: ${unverified.join(", ")}`
      : `oracle passed: ${passed.join(", ")}`,
  };
  onStage?.("verify", report.stages.verify);

  // 4. INTEGRATE
  const t3 = Date.now();
  const integ = await runSeat(orchestrator, integratePrompt({ goal, results, verdicts }), "integrate");
  report.stages.integrate = { ms: Date.now() - t3, ok: integ.ok, text: integ.text };
  onStage?.("integrate", report.stages.integrate);
  // The run's outcome is the GATE's, not the integrator's. A model that talks past a failing
  // oracle must not be able to make the run look successful.
  report.ok = report.gate.ok;
  report.why = report.gate.why;
  return report;
}
