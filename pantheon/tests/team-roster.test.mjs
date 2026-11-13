import { test } from "node:test";
import assert from "node:assert/strict";
import { PODS, ROSTER, SHIPPING_CHAIRS, occupy, nextOccupant, chairKey, parseChair, projectionFor, RosterViolation } from "../src/team/roster.mjs";
import { PROJECTIONS, PROJECTION_FOR_ROLE, PRE_BOARD_ROLES, admits } from "../src/board/project.mjs";
import { seatKey } from "../src/seat/identity.mjs";

const isPre = r => (PRE_BOARD_ROLES.has ? PRE_BOARD_ROLES.has(r) : PRE_BOARD_ROLES.includes(r));

// THE DEFECT THIS SUITE WAS WRITTEN FOR. lead@orch sat on "supervisor", which is controller_only: the
// controller's own view of the board. A chair on it is a vendor holding the controller's eyes.
test("no pod ceiling is a controller-only projection", () => {
  for (const [pod, p] of Object.entries(PODS)) {
    assert.ok(PROJECTIONS[p.projection], `pod ${pod} names unknown projection "${p.projection}"`);
    assert.notEqual(PROJECTIONS[p.projection].controller_only, true,
      `pod ${pod} sits on "${p.projection}", which is the controller's and no chair's`);
  }
});

// Inclusion, asserted the way the pack lattice asserts it: every role a chair may take must resolve to
// a projection whose admitted kinds sit inside the pod's ceiling. A pre-board role has none, by rule.
test("every chair role's projection sits inside its pod's ceiling, and a scout has none", () => {
  let checked = 0;   // a loop whose bodies never run prints "all pass" while testing nothing
  for (const [addr, c] of Object.entries(ROSTER)) {
    const ceiling = admits(PODS[c.pod].projection);
    for (const role of c.roles) {
      const own = projectionFor(role, c.pod);
      if (isPre(role)) { assert.equal(own, null, `${addr}/${role} is pre-board and must have no projection`); checked++; continue; }
      assert.equal(own, PROJECTION_FOR_ROLE[role]);
      for (const k of admits(own)) { assert.ok(ceiling.has(k), `${addr}/${role}: "${own}" admits ${k}, outside pod ${c.pod}'s ceiling`); checked++; }
    }
  }
  assert.ok(checked >= 10, `the inclusion check must actually run; it ran ${checked} assertions`);
});

test("occupy() reports the ROLE's projection, not the pod's, and marks a scout as outside", () => {
  const lead = occupy({ address: "lead@orch", vendor: "anthropic", cwd: "/r", role: "planner" });
  assert.equal(lead.projection, "planner");
  assert.equal(lead.ceiling, "planner");
  const sc = occupy({ address: "scout@opt", vendor: "agy_google", cwd: "/r", role: "scout" });
  assert.equal(sc.projection, null);
  assert.equal(sc.pre_board, true);
  const ex = occupy({ address: "scout@opt", vendor: "agy_google", cwd: "/r", role: "explorer" });
  assert.equal(ex.projection, "isolated_reader", "an explorer reads; it does not debate");
  assert.equal(ex.ceiling, "isolated_debater");
});

test("nothing in the roster may ship", () => {
  assert.deepEqual(SHIPPING_CHAIRS, []);
  for (const c of Object.values(ROSTER)) assert.equal(c.may_ship, false);
});

test("a chair key survives a reseat; a seat key does not", () => {
  const a = occupy({ address: "impl@build", vendor: "openai", cwd: "/r" });
  const b = occupy({ address: "impl@build", vendor: "anthropic", cwd: "/r", history: [{ vendor: "openai" }] });
  assert.equal(a.key, b.key, "the job's identity excludes the occupant");
  assert.notEqual(seatKey({ vendor: a.vendor, purpose: a.purpose, cwd: a.cwd }),
                  seatKey({ vendor: b.vendor, purpose: b.purpose, cwd: b.cwd }), "the conversation dies on reseat");
  assert.equal(b.gen, 2); assert.equal(b.reseated, true); assert.equal(b.repeat_occupant, false);
});

test("occupy refuses a non-candidate vendor and a role the chair may not take", () => {
  assert.throws(() => occupy({ address: "impl@build", vendor: "xai", cwd: "/r" }), RosterViolation);
  assert.throws(() => occupy({ address: "impl@build", vendor: "openai", cwd: "/r", role: "judge" }), /may not take the role/);
  assert.throws(() => occupy({ address: "nobody@build", vendor: "openai", cwd: "/r" }), /not in the roster/);
  assert.throws(() => parseChair("impl@nopod"), /unknown pod/);
  assert.throws(() => chairKey({ address: "impl@build" }), /cwd is required/);
});

test("occupy carries lease and files through, because subagentBrief needs both", () => {
  const o = occupy({ address: "impl@build", vendor: "openai", cwd: "/r", lease: { resource: "tree", gen: 1 }, files: ["a.mjs"] });
  assert.deepEqual(o.lease, { resource: "tree", gen: 1 });
  assert.deepEqual(o.files, ["a.mjs"]);
  assert.equal(occupy({ address: "impl@build", vendor: "openai", cwd: "/r" }).lease, null);
});

test("nextOccupant with avoidPriors prefers a vendor that has not held the chair, and says when none exists", () => {
  const h = [{ vendor: "xai" }];
  assert.equal(nextOccupant({ address: "check@review", history: h, avoidPriors: true }).vendor, "agy_google");
  const all = ["xai", "agy_google", "anthropic", "openai"].map(vendor => ({ vendor }));
  const r = nextOccupant({ address: "check@review", history: all, avoidPriors: true });
  assert.equal(r.vendor, null);
  assert.match(r.why, /has held it before/);
});
