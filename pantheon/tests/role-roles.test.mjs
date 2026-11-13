import { test } from "node:test";
import assert from "node:assert/strict";
import { ROLES, CONTEXT_KINDS, contextFor, bindSeat, assertJudgeEligible, promptFor, ContextViolation } from "../src/role/roles.mjs";

// Rule 1: workers do not inherit the supervisor's monologue. A fat brief makes a worker restate
// the plan rather than contradict it, and that reads as agreement.
// Rule 1, in the lattice's vocabulary: the supervisor's framing is the `plan` token now, and the
// implementer does not hold it. Renaming the token did not change the invariant -- a fat brief makes a
// worker restate the plan rather than contradict it, and that reads as agreement.
test("an implementer never receives the planner's framing", async () => {
  const { allowed, withheld } = contextFor("implementer", {
    ticket: "fix the lock", artifact: "diff", tests: "t", plan: "here is my grand theory",
  });
  assert.equal(allowed.plan, undefined);
  assert.ok(withheld.includes("plan"));
  assert.equal(allowed.ticket, "fix the lock");
  // And it is absent from the projection too, not merely from the role table.
  const { admits } = await import("../src/board/project.mjs");
  assert.equal(admits("worker").has("plan"), false);
});

// Rule 2: checkers see the diff and the tests, not the maker's defense.
test("a reviewer never receives the producer's defense of its own work", () => {
  const { allowed, withheld } = contextFor("reviewer", {
    ticket: "t", artifact: "diff", tests: "tests", peer_defense: "why my code is great",
  });
  assert.equal(allowed.peer_defense, undefined);
  assert.ok(withheld.includes("peer_defense"));
  assert.equal(allowed.artifact, "diff", "it must still see the thing it is judging");
});

// Rule 3: an explorer's independence is the entire value of fan-out.
test("an explorer sees the ticket and nothing any peer said", () => {
  const { allowed, withheld } = contextFor("explorer", {
    ticket: "q", peer_output: "what everyone else thinks", own_history: "h",
  });
  assert.deepEqual(Object.keys(allowed), ["ticket"]);
  assert.ok(withheld.includes("peer_output"));
});

test("a judge may see peer output AND peer defense, because deciding needs both", () => {
  const { allowed } = contextFor("judge", { ticket: "q", peer_output: "answers", peer_defense: "arguments", tests: "t" });
  assert.equal(allowed.peer_output, "answers");
  assert.equal(allowed.peer_defense, "arguments");
});

// An undeclared context kind cannot be reasoned about, so it must not pass through silently.
test("an undeclared context kind is refused, not quietly forwarded", () => {
  assert.throws(() => contextFor("implementer", { ticket: "t", secret_backchannel: "psst" }),
    ContextViolation);
  assert.throws(() => contextFor("implementer", { ticket: "t", secret_backchannel: "psst" }),
    /undeclared context kind/);
});

test("every role declares only context kinds that exist", () => {
  for (const [name, spec] of Object.entries(ROLES)) {
    for (const k of spec.context) {
      assert.ok(CONTEXT_KINDS.has(k), `role ${name} declares unknown context kind "${k}"`);
    }
    assert.ok(spec.charter && spec.produces, `role ${name} must state a charter and an output`);
  }
});

// Rule 5, enforced rather than observed.
test("a vendor may not judge a contest it joined", () => {
  const participants = [bindSeat({ role: "explorer", vendor: "openai", cwd: "/r" }),
                        bindSeat({ role: "explorer", vendor: "xai", cwd: "/r" })];
  const compromised = bindSeat({ role: "judge", vendor: "openai", cwd: "/r" });
  assert.throws(() => assertJudgeEligible({ judge: compromised, participants }),
    /may not judge a fight it joined/);
  const clean = bindSeat({ role: "judge", vendor: "anthropic", cwd: "/r" });
  assert.equal(assertJudgeEligible({ judge: clean, participants }), true);
});

test("only a role marked mayJudge can be a judge at all", () => {
  const reviewer = bindSeat({ role: "reviewer", vendor: "anthropic", cwd: "/r" });
  assert.throws(() => assertJudgeEligible({ judge: reviewer, participants: [] }),
    /not permitted to judge/);
});

// The specialization now lives in seat identity rather than in an ad-hoc label.
test("binding a role to a vendor puts the role in the seat's purpose", () => {
  const s = bindSeat({ role: "implementer", vendor: "openai", cwd: "/repo" });
  assert.equal(s.purpose, "implementer");
  assert.equal(s.role, "implementer");
  assert.equal(s.label, "openai · implementer");
  const two = bindSeat({ role: "implementer", vendor: "openai", cwd: "/repo", instance: 2 });
  assert.equal(two.purpose, "implementer#2", "two implementers on one vendor are different seats");
  assert.notEqual(two.purpose, s.purpose);
});

test("a reviewer's routing need encodes cross-vendor isolation", () => {
  assert.ok(ROLES.reviewer.needs.includes("different_vendor"));
  assert.ok(ROLES.judge.needs.includes("different_vendor"));
});

// One place builds the prompt, so a longer string cannot smuggle withheld context in.
test("promptFor omits withheld context and reports what it withheld", () => {
  const { prompt, withheld } = promptFor("reviewer",
    { ticket: "t", artifact: "THE-DIFF", peer_defense: "MY-EXCUSE" }, "review this");
  assert.match(prompt, /THE-DIFF/);
  assert.ok(!prompt.includes("MY-EXCUSE"), "withheld context must not reach the prompt");
  assert.deepEqual(withheld, ["peer_defense"]);
  assert.match(prompt, /Attack the artifact/);
});

test("advocacy roles are flagged so their output is never read as evidence", () => {
  assert.equal(promptFor("advocate", { ticket: "t" }).advocacy, true);
  assert.equal(promptFor("explorer", { ticket: "t" }).advocacy, false);
});
