import { test } from "node:test";
import assert from "node:assert/strict";
import { planPrompt, workerPrompt, ORCHESTRATE_ROLES } from "../src/swarm/orchestrate.mjs";
import { ROLES, contextFor } from "../src/role/roles.mjs";

// This file exists because of a gap found while reviewing my own commit. b91615a claimed "the context
// policy is now enforced where work runs" and shipped dedicated tests for the layered and discuss
// paths -- but the orchestrate path had only indirect coverage, through three runOrchestration tests
// that live in tests/swarm-discuss.test.mjs. Indirect coverage proves the code runs; it does not
// assert the property the commit claimed.

test("the orchestrate stages name real, distinct roles", () => {
  for (const [stage, role] of Object.entries(ORCHESTRATE_ROLES)) {
    assert.ok(ROLES[role], `stage ${stage} names unknown role "${role}"`);
  }
  assert.notEqual(ORCHESTRATE_ROLES.plan, ORCHESTRATE_ROLES.work,
    "one role for planning and working would be one context policy for both");
});

// THE PROPERTY THE COMMIT CLAIMED, asserted rather than assumed. A worker handed the orchestrator's
// framing restates it instead of contradicting it, and a restatement reads as agreement.
test("an implementer cannot hold the plan, so a worker never receives the orchestrator's framing", () => {
  const { allowed, withheld } = contextFor(ORCHESTRATE_ROLES.work,
    { work_item: "your slice", plan: "MY-GRAND-THEORY" });
  assert.equal(allowed.plan, undefined);
  assert.ok(withheld.includes("plan"));
  assert.equal(allowed.work_item, "your slice", "it must still receive its own assignment");

  // And through the builder, which is what actually runs.
  const built = workerPrompt({ instruction: "write the thing", kind: "code" });
  assert.match(built.prompt, /write the thing/);
  assert.ok(!built.prompt.includes("MY-GRAND-THEORY"));
  assert.equal(ROLES[ORCHESTRATE_ROLES.work].context.includes("plan"), false,
    "the role table is the gate; if `plan` ever lands here the withholding above stops meaning anything");
});

test("the planner receives the goal and its constraints as one ticket", () => {
  const built = planPrompt({ goal: "SHIP-THE-THING", workers: ["w1", "w2"], context: "MUST-BE-ZERO-DEP" });
  assert.match(built.prompt, /SHIP-THE-THING/);
  assert.match(built.prompt, /MUST-BE-ZERO-DEP/, "constraints travel inside the ticket, where they live");
  assert.match(built.prompt, /w1, w2/, "it must know which seats it may assign to");
  assert.match(built.prompt, /not a quality adjective/, "acceptance must name something executable");
  assert.deepEqual(built.withheld, [], "nothing offered here should be refused");
});

// Both worker kinds must survive going through promptFor -- the code branch is the one whose output is
// parsed by extractCode, so a lost fence instruction breaks the execution oracle silently.
test("both worker kinds keep their output contract", () => {
  assert.match(workerPrompt({ instruction: "i", kind: "code" }).prompt, /ONLY the code in a single/);
  assert.match(workerPrompt({ instruction: "i", kind: "code" }).prompt, /node: builtins/);
  assert.match(workerPrompt({ instruction: "i", kind: "analysis" }).prompt, /concrete and brief/);
});

import * as orch from "../src/swarm/orchestrate.mjs";

// THE GAP, 2026-09-27 re-review, rank 20. integratePrompt was the one prompt built outside the role table,
// so a contextFor change would never have reached it.
test("the integrate prompt is built by the role table as the planner reading its items' state", () => {
  assert.equal(orch.ORCHESTRATE_ROLES.integrate, "planner");
  const args = { goal: "G", results: [{ id: "t1", assignee: "openai", kind: "code", text: "code" }], verdicts: { t1: { ok: false, detail: "exit 1" } } };
  const built = orch.integrateBuilt(args);
  assert.ok(Array.isArray(built.withheld), "it is a promptFor() product");
  assert.equal(orch.integratePrompt(args), built.prompt, "the string form is the same prompt");
  assert.match(built.prompt, /FAIL — exit 1/);
  assert.match(built.prompt, /may not argue a FAIL into a pass/);
});

test("fan-in refuses a required worker failure even when a sibling oracle passes", async () => {
  const r = await orch.runOrchestration({
    goal: "both tasks are required", orchestrator: "p", workers: ["a", "b"],
    runSeat: async (vendor, prompt, stage) => {
      if (stage === "plan") return { ok: true, text: JSON.stringify({ tasks: [
        { id: "a", assignee: "a", kind: "code", instruction: "first required task" },
        { id: "b", assignee: "b", kind: "code", instruction: "second required task" },
      ], acceptance: "both pass" }) };
      if (stage === "work" && vendor === "b") throw new Error("worker failed");
      return { ok: true, text: "code" };
    },
    verify: async () => ({ ok: true, detail: "one file passed" }),
  });
  assert.equal(r.ok, false);
  assert.deepEqual(r.gate.unverified, ["b"]);
});

test("fan-in refuses an unverified required analysis task beside a passing code task", async () => {
  const r = await orch.runOrchestration({
    goal: "both are required", orchestrator: "p", workers: ["a"],
    runSeat: async (vendor, prompt, stage) => ({ ok: true, text: stage === "plan"
      ? JSON.stringify({ tasks: [
          { id: "code", assignee: "a", kind: "code", instruction: "code" },
          { id: "analysis", assignee: "a", kind: "analysis", instruction: "analysis" },
        ], acceptance: "both done" }) : "answer" }),
    verify: async () => ({ ok: true, detail: "code passed" }),
  });
  assert.equal(r.ok, false);
});

test("duplicate task IDs cannot overwrite a failed oracle during fan-in", async () => {
  let checks=0;
  const r = await orch.runOrchestration({
    goal:"both files",orchestrator:"p",workers:["a"],
    runSeat:async(v,p,stage)=>({ok:true,text:stage==="plan"?JSON.stringify({tasks:[
      {id:"same",assignee:"a",kind:"code",instruction:"first"},
      {id:"same",assignee:"a",kind:"code",instruction:"second"}],acceptance:"both"}):"code"}),
    verify:async()=>({ok:++checks>1,detail:"first fails, second passes"}),
  });
  assert.equal(r.ok===true,false);
  assert.equal(r.stages.plan.ok,false,"ambiguous identities must be refused before work");
  assert.equal(checks,0);
});

test("prototype-shaped task IDs cannot hide a required failed verifier", async () => {
  let checks=0;
  const r=await orch.runOrchestration({
    goal:"both required",orchestrator:"p",workers:["a"],
    runSeat:async(v,p,stage)=>({ok:true,text:stage==="plan"?JSON.stringify({tasks:[
      {id:"__proto__",assignee:"a",kind:"code",instruction:"fails"},
      {id:"normal",assignee:"a",kind:"code",instruction:"passes"}],acceptance:"both"}):"code"}),
    verify:async()=>({ok:++checks===2,detail:"first fails"}),
  });
  assert.equal(checks,2);
  assert.equal(r.ok,false);
  assert.deepEqual(r.gate.failed,["__proto__"]);
});
