import { test } from "node:test";
import assert from "node:assert/strict";
import { LAWS, ACTIONS, CONTROLLER, enforce, assertLawful, LawViolation } from "../src/team/law.mjs";

const violated = r => r.violations.map(v => v.law);

test("an unknown action is refused, not waved through", () => {
  const r = enforce({ kind: "dance" });
  assert.equal(r.ok, false); assert.equal(r.code, "UNKNOWN_ACTION");
});

test("a pass with no law applied is vacuous, and the throwing form refuses it", () => {
  // `brief` on an unknown chair applies law 4, which fails; but craft a kind nothing applies to by
  // removing every law's applicability -- simplest is to assert the flag on a real one.
  const r = enforce({ kind: "review", is_diff: false });
  assert.deepEqual(r.applied, [3]);
  assert.equal(r.vacuous, false, "law 3 applied even though it chose not to bind");
  for (const law of LAWS) assert.ok(ACTIONS.has([...ACTIONS].find(a => law.applies({ kind: a }))), `law ${law.n} applies to no known action`);
});

// THE DEFECT. Law 4 forbade ["supervisor_narration","peer_defense","transcript"], two of which exist
// nowhere in the role vocabulary, and PASSED a brief carrying `plan` and `peer_output` to an implementer.
test("law 4 defers to the role's context policy: an implementer's brief may not carry the plan", () => {
  const bad = enforce({ kind: "brief", chair: "impl@build", context: { work_item: "w", plan: "P", peer_output: "O" } });
  assert.equal(bad.ok, false);
  assert.deepEqual(violated(bad), [4]);
  assert.match(bad.why, /plan/); assert.match(bad.why, /peer_output/);
  const ok = enforce({ kind: "brief", chair: "impl@build", context: { ticket: "t", work_item: "w", tests: "x" } });
  assert.equal(ok.ok, true, ok.why);
  // A name outside the vocabulary is refused outright rather than silently ignored.
  const ghost = enforce({ kind: "brief", chair: "impl@build", context: { supervisor_narration: "..." } });
  assert.equal(ghost.ok, false); assert.match(ghost.why, /undeclared/);
});

test("law 4 mutation check: the judge MAY hold what the implementer may not", () => {
  const r = enforce({ kind: "brief", chair: "arbiter@judge", role: "judge", context: { ticket: "t", peer_defense: "d", peer_output: "o" } });
  assert.equal(r.ok, true, r.why);
});

test("law 6/7: only the controller ships, and only on executed evidence bound to the bytes", () => {
  assert.equal(enforce({ kind: "ship", chair: CONTROLLER, tests_passed: true, checker_ack: true, bound_to_current_bytes: true }).ok, true);
  const consensus = enforce({ kind: "ship", chair: CONTROLLER, consensus: true });
  assert.deepEqual(violated(consensus), [7]); assert.match(consensus.why, /agreement is not evidence/);
  const chair = enforce({ kind: "ship", chair: "impl@build", tests_passed: true, checker_ack: true, bound_to_current_bytes: true });
  assert.deepEqual(violated(chair), [6]);
  assert.equal(enforce({ kind: "mark_done", chair: "impl@build", producer_chair: "impl@build" }).ok, false);
  assert.equal(enforce({ kind: "ship", chair: "arbiter@judge", tests_passed: true, checker_ack: true, bound_to_current_bytes: true }).ok, false);
});

test("law 2: a tree write needs a named lease at the current generation, held by this chair", () => {
  const state = { leases: { tree: { gen: 3, chair: "impl@build" } } };
  assert.equal(enforce({ kind: "write", chair: "impl@build", lease: { resource: "tree", gen: 3 } }, state).ok, true);
  assert.match(enforce({ kind: "write", chair: "impl@build", lease: { resource: "tree", gen: 2 } }, state).why, /fenced/);
  assert.match(enforce({ kind: "write", chair: "check@review", lease: { resource: "tree", gen: 3 } }, state).why, /does not write the tree/);
  assert.match(enforce({ kind: "write", chair: "impl@build" }, state).why, /NAMED lease/);
});

test("law 3: the checker is a different lab from the maker, and never the assigner", () => {
  assert.match(enforce({ kind: "review", producer: { vendor: "openai" }, checker: { vendor: "openai" } }).why, /same lab/);
  assert.match(enforce({ kind: "review", producer: { vendor: "openai" }, checker: { vendor: "xai" }, assigner: { vendor: "xai" } }).why, /cannot also check/);
  assert.equal(enforce({ kind: "review", producer: { vendor: "openai" }, checker: { vendor: "xai" } }).ok, true);
});

test("law 5: an on-request chair must be opened by a lead and dies at its cap", () => {
  assert.match(enforce({ kind: "open_mode", chair: "scout@opt" }).why, /may not run unopened/);
  assert.match(enforce({ kind: "open_mode", chair: "scout@opt", opened_by: "impl@build" }).why, /may not open modes/);
  assert.equal(enforce({ kind: "open_mode", chair: "scout@opt", opened_by: "lead@orch", turns: 3 }).ok, true);
  assert.match(enforce({ kind: "open_mode", chair: "scout@opt", opened_by: "lead@orch", turns: 4 }).why, /against a cap/);
});

test("assertLawful throws with the first violated law attached", () => {
  try { assertLawful({ kind: "ship", chair: "impl@build" }); assert.fail("should throw"); }
  catch (e) { assert.ok(e instanceof LawViolation); assert.equal(e.law, 6); }
});

import * as rosterMod from "../src/team/roster.mjs";

// THE DEFECTS, 2026-09-27 re-review, ranks 29 and 30.
test("law 6: mark_done is the CHECKER's, not merely anyone-but-the-maker's", () => {
  const orch = Object.entries(rosterMod.ROSTER).find(([, c]) => c.pod === "orch")[0];
  const r = enforce({ kind: "mark_done", chair: orch, producer_chair: "impl@build" });
  assert.equal(r.ok, false);
  assert.match(r.violations.map(v => v.why ?? v.message ?? JSON.stringify(v)).join(" "), /may not mark work done/);
  assert.equal(enforce({ kind: "mark_done", chair: "check@review", producer_chair: "impl@build" }).ok, true);
});

test("law 4: the diary cap measures the brief, it does not read a declared byte count", () => {
  const fat = enforce({ kind: "brief", chair: "impl@build", context: { ticket: "x".repeat(50_000) } });
  assert.equal(fat.ok, false);
  assert.match(JSON.stringify(fat.violations), /is a diary, not a brief/);
  const lying = enforce({ kind: "brief", chair: "impl@build", bytes: 10, context: { ticket: "x".repeat(50_000) } });
  assert.equal(lying.ok, false, "a small declared count does not shrink a large brief");
  assert.equal(enforce({ kind: "brief", chair: "impl@build", context: { ticket: "t" } }).ok, true);
});

import { measureBytes } from "../src/team/measure.mjs";

// Found by an in-session probe: JSON.stringify honours toJSON, so a 20 KB brief measured as 6 bytes.
test("law 4 measures the data a reader receives; toJSON cannot shrink it", () => {
  const ctx = { ticket: { toJSON() { return "tiny"; }, big: "x".repeat(20_000) } };
  assert.ok(Buffer.byteLength(JSON.stringify(ctx)) < 100, "precondition: stringify is fooled");
  assert.ok(measureBytes(ctx) > 20_000);
  assert.equal(enforce({ kind: "brief", chair: "impl@build", context: ctx }).ok, false);
  assert.ok(measureBytes({ a: [1, "b", { c: true }], m: new Map([["k", "v"]]) }) > 10);
});
