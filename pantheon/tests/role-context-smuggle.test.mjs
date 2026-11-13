import { test } from "node:test";
import assert from "node:assert/strict";
import { contextFor, smuggledKinds, ContextViolation, ROLES } from "../src/role/roles.mjs";

// THE DEFECT, 2026-09-27 re-review, rank 1. contextFor filtered on KEY NAMES: `plan` at the top level was
// withheld from the implementer, `ticket: { plan }` was handed over with withheld: [] and no error. The
// mechanism this project calls load-bearing for "independent evidence rather than one echo" had a one-
// level bypass. These are the repros the review attached, turned into the regression.

const IMPL_MAY_NOT = [...Object.keys(ROLES)].length && ["plan", "decision", "hypothesis", "peer_output"];

test("a withheld kind nested inside a permitted key is REFUSED, not stripped and not passed", () => {
  for (const kind of IMPL_MAY_NOT) {
    assert.ok(!ROLES.implementer.context.includes(kind) && !ROLES.implementer.session.includes(kind), `precondition: ${kind} is withheld`);
    assert.throws(
      () => contextFor("implementer", { ticket: { note: "fix the lock", [kind]: "THE SMUGGLED CONTENT" } }),
      e => e instanceof ContextViolation && e.message.includes(`.${kind}`) && /nested inside/.test(e.message),
      `ticket.${kind} must be refused`);
  }
});

test("a JSON-encoded string is walked too, since that is exactly how the repro smuggled it", () => {
  const payload = JSON.stringify({ summary: "x", plan: "here is my grand theory" });
  assert.throws(() => contextFor("implementer", { ticket: payload }), /\(json\)\.plan/);
  // ...and inside an array, at depth.
  assert.throws(() => contextFor("implementer", { ticket: { items: [{ meta: { decision: "ship it" } }] } }), /items\[0\]\.meta\.decision/);
});

test("nesting past the inspection bound is refused rather than partially inspected", () => {
  let v = "leaf";
  for (let i = 0; i < 12; i++) v = { deeper: v };
  assert.throws(() => contextFor("implementer", { ticket: v }), /nesting deeper than/);
});

test("permitted kinds nested under permitted keys pass; keys that are not context kinds are not policed", () => {
  const { allowed, withheld } = contextFor("implementer", {
    ticket: { title: "t", tests: "node --test", repro: "run x", plan_summary: "not a kind name" },
    plan: "withheld at the top level as before",
  });
  assert.deepEqual(withheld, ["plan"]);
  assert.equal(allowed.ticket.tests, "node --test");
});

test("free text that merely MENTIONS a withheld kind passes: the stated limit, not a gap", () => {
  const { allowed } = contextFor("implementer", { ticket: "see the plan: replace the mutex with a lease. decision: none yet." });
  assert.match(allowed.ticket, /see the plan/);
});

test("smuggledKinds reports the path of every offending key", () => {
  const paths = smuggledKinds({ a: { plan: 1 }, b: [{ decision: 2 }], c: JSON.stringify({ hypothesis: 3 }) }, ["ticket"], "ticket");
  assert.deepEqual(paths.sort(), ["ticket.a.plan", "ticket.b[0].decision", "ticket.c(json).hypothesis"]);
  assert.deepEqual(smuggledKinds({ a: { tests: 1 } }, ["ticket", "tests"], "ticket"), []);
});

// Found by an in-session probe right after the fix landed: three ways past the first version.
test("key-name variants, double-encoded JSON and Map values are carriers too", () => {
  assert.throws(() => contextFor("implementer", { ticket: { Plan: "x" } }), /\.Plan/);
  assert.throws(() => contextFor("implementer", { ticket: { "plan ": "x" } }), /plan/);
  assert.throws(() => contextFor("implementer", { ticket: JSON.stringify(JSON.stringify({ plan: "x" })) }), /\(json\)\(json\)\.plan/);
  assert.throws(() => contextFor("implementer", { ticket: new Map([["plan", "x"]]) }), /\.plan/);
  assert.throws(() => contextFor("implementer", { ticket: new Set([{ decision: "x" }]) }), /\{0\}\.decision/);
  // A cyclic value terminates at the bound instead of hanging.
  const a = { note: "x" }; a.self = a;
  assert.throws(() => contextFor("implementer", { ticket: a }), /nesting deeper than/);
});
