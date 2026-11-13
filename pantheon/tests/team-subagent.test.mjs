import { test } from "node:test";
import assert from "node:assert/strict";
import { subagentBrief, assertNotTheChecker, SHARED, NOT_SHARED, SubagentViolation } from "../src/team/subagent.mjs";
import { occupy } from "../src/team/roster.mjs";
import { DEPTH_LIMIT } from "../src/role/seating.mjs";

const parent = (extra = {}) => occupy({ address: "impl@build", vendor: "openai", cwd: "/r", role: "implementer",
  lease: { resource: "tree", gen: 1 }, files: ["a.mjs", "b.mjs"], ...extra });

test("a subagent shares the house and not the head: no transcript, no narration, no defense", () => {
  assert.throws(() => subagentBrief({ parent: parent(), task: "t", done_check: "d", transcript: [] }), /must not be passed/);
  assert.throws(() => subagentBrief({ parent: parent(), task: "t", done_check: "d", context: { peer_defense: "x" } }), /may not carry peer_defense/);
  const b = subagentBrief({ parent: parent(), task: "t", done_check: "tests pass", files: ["a.mjs"] });
  assert.deepEqual(b.inherits.lease, { resource: "tree", gen: 1 });
  assert.equal(b.lanes, 0, "depth buys isolation, not throughput");
  assert.deepEqual(b.may_not, Object.keys(NOT_SHARED));
  assert.ok(SHARED.lease.includes("PARENT'S"));
});

test("a child cannot widen its parent's write set, and a file-bearing child needs the parent's lease", () => {
  assert.throws(() => subagentBrief({ parent: parent(), task: "t", done_check: "d", files: ["c.mjs"] }), /outside what impl@build claimed/);
  // THE DOC DEFECT: a bare occupy() carries no lease, and the refusal now says what to pass.
  const bare = occupy({ address: "impl@build", vendor: "openai", cwd: "/r" });
  assert.throws(() => subagentBrief({ parent: bare, task: "t", done_check: "d", files: ["a.mjs"] }), /Pass `lease`/);
  // A child with no files needs no lease at all.
  assert.ok(subagentBrief({ parent: bare, task: "read and report", done_check: "a summary exists" }));
});

test("a non-writing pod's child gets no files, and depth is bounded", () => {
  const checker = occupy({ address: "check@review", vendor: "xai", cwd: "/r", lease: { resource: "tree", gen: 1 } });
  assert.throws(() => subagentBrief({ parent: checker, task: "t", done_check: "d", files: ["a.mjs"] }), /does not write the tree/);
  assert.throws(() => subagentBrief({ parent: parent(), task: "t", done_check: "d", depth: DEPTH_LIMIT + 1 }), /exceeds DEPTH_LIMIT/);
  assert.throws(() => subagentBrief({ parent: parent(), task: "t" }), /done_check/);
});

// THE DEFECT. The verdict-word check matched substrings: "checkout" and "checksum" were refused.
test("a subagent may not take a verdict, and the check is word-bounded", () => {
  for (const p of ["review the diff", "check the gate", "approve this", "verify the fix"]) {
    assert.throws(() => assertNotTheChecker({ parent: parent(), purpose: p }), SubagentViolation, p);
  }
  for (const p of ["checkout the feature branch", "compute the checksum", "gateway config", "unchecked exceptions"]) {
    assert.equal(assertNotTheChecker({ parent: parent(), purpose: p }), true, `"${p}" is not a verdict`);
  }
});

// THE DEFECT, 2026-09-27 re-review, rank 15. The closed verdict list missed the judge role's own charter
// verbs. "decide whether this diff passes" is a verdict by any reading, and it passed.
test("the judge's own verbs are verdicts too", () => {
  for (const p of ["decide whether this diff passes", "judge the two proposals", "grade the answer", "sign off on rev 3",
    "sign-off the release", "rule on the dispute", "assess the fix", "reject the weaker plan"]) {
    assert.throws(() => assertNotTheChecker({ parent: parent(), purpose: p }), SubagentViolation, p);
  }
  for (const p of ["list the undecided items", "collect the judgement-free facts", "grades.csv parser", "prejudge nothing"]) {
    assert.equal(assertNotTheChecker({ parent: parent(), purpose: p }), true, `"${p}" is not a verdict`);
  }
});
