import { test } from "node:test";
import assert from "node:assert/strict";
import { RENTED, PATTERNS, patternFor, assertOpened, occupiedChairs, ModeViolation } from "../src/team/modes.mjs";
import { ROSTER } from "../src/team/roster.mjs";

test("every rented pattern names roster chairs and a described pattern", () => {
  for (const r of RENTED) {
    assert.ok(PATTERNS[r.pattern], `pattern "${r.pattern}" has no description`);
    for (const c of r.chairs) assert.ok(ROSTER[c], `"${c}" is not in the roster`);
    // On-request chairs in a rented shape need an opener and a cap; standing ones need neither.
    for (const c of r.chairs.filter(c => ROSTER[c].on_request)) {
      assert.ok(r.opened_by, `${r.pattern} rents ${c} without saying who opens it`);
      assert.ok(Number.isInteger(r.cap), `${r.pattern} rents ${c} without a cap`);
    }
  }
});

test("board status selects the shape; statuses with nothing to do get no shape rather than an invented one", () => {
  assert.equal(patternFor({ status: "planning" }).pattern, "delegate");
  assert.equal(patternFor({ status: "executing", ready: 2 }).pattern, "conveyor");
  assert.equal(patternFor({ status: "reviewing" }).pattern, "maker_checker");
  assert.equal(patternFor({ status: "stuck" }).pattern, "timeboxed_swarm");
  assert.equal(patternFor({ status: "split" }).pattern, "isolated_debate");
  for (const s of ["intake", "accepted", "done", "nonsense"]) {
    const r = patternFor({ status: s });
    assert.equal(r.ok, false, s); assert.match(r.why, /does not improvise/);
  }
});

test("no rented pattern hands any chair the merge button", () => {
  for (const r of RENTED) assert.deepEqual(patternFor({ status: r.when({ status: "planning" }) ? "planning" : null }).may_ship ?? [], []);
  for (const st of ["planning", "reviewing", "stuck", "split"]) assert.deepEqual(patternFor({ status: st }).may_ship, []);
});

test("an on-request chair must be opened by a lead, and its cap is enforced", () => {
  assert.throws(() => assertOpened({ chair: "scout@opt" }), /was not opened/);
  assert.throws(() => assertOpened({ chair: "scout@opt", opened_by: "impl@build" }), /may not open modes/);
  assert.equal(assertOpened({ chair: "scout@opt", opened_by: "lead@orch", turns: 3 }), true);
  assert.throws(() => assertOpened({ chair: "scout@opt", opened_by: "lead@orch", turns: 4 }), ModeViolation);
  assert.equal(assertOpened({ chair: "impl@build" }), true, "a standing chair needs no opener");
});

test("occupiedChairs leaves every chair outside the shape idle, on purpose", () => {
  const o = occupiedChairs({ status: "reviewing" });
  assert.deepEqual(o.open, ["impl@build", "check@review"]);
  assert.ok(o.idle.includes("lead@orch") && o.idle.includes("scout@opt") && o.idle.includes("arbiter@judge"));
  assert.deepEqual(occupiedChairs({ status: "accepted" }).open, []);
});
