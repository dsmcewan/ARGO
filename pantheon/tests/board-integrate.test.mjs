import { test } from "node:test";
import assert from "node:assert/strict";
import { publish, treeSlots } from "../src/board/dag.mjs";
import { merge, ancestors, mergeBase } from "../src/board/merge.mjs";
import { ship, shipClaim, mayShip, reviewAck, GATES } from "../src/board/integrate.mjs";
import { project, PROJECTION_FOR_ROLE } from "../src/board/project.mjs";
import { SEATING, INTAKE } from "../src/role/seating.mjs";
import { withBoard, seat, HUMAN, CONTROLLER, TICKET } from "./board-helper.mjs";

const REF = "refs/board/lock-helper";
const SLOT = "src/seat/lock.mjs";
const ITEM = "withSeatLock";
const TEST_CMD = TICKET.acceptance[0].cmd;

const maker = seat("openai", "work", "openai-work");
const planner = seat("anthropic", "plan", "anthropic-plan");

/**
 * Drive the objects to the point just before ship. Every step is real: orphan scout cids with no
 * board, a promoted ticket, work under a held-then-released lease, an ack from another lab bound to
 * the diff cid. Each `skip` removes exactly one gate's precondition.
 */
async function drive(board, skip = {}) {
  // --- intake: two orphan scout cids, and no board at all ---
  const scouts = [];
  for (const vendor of ["agy_google", "xai"]) {
    const s = seat(vendor, "explore", `${vendor}-scout`);
    const r = await publish({ ...board, ref: `refs/iso/${vendor}/scout`, author: s, msg: `scout ${vendor}`,
      entries: [{ kind: "repro", payload: { cmd: "node --test tests/seat-lock.test.mjs", exit: 0 },
        blob: `${vendor}: green, and nothing fences a live holder\n` }] });
    assert.equal(r.ok, true, r.why);
    scouts.push({ vendor, ref: `refs/iso/${vendor}/scout`, commit: r.commit, evidence: r.written[0].cid });
  }
  assert.equal(board.refs.resolve(REF), null, "intake really precedes the board");

  // --- promote: a ticket citing the scouts' evidence, then a plan. Still unshipped. ---
  if (!skip.ticket) {
    const t = await publish({ ...board, ref: REF, author: HUMAN, msg: "the ticket",
      entries: [{ kind: "ticket", links: { derived_from: scouts.map(s => s.evidence) }, payload: TICKET }] });
    assert.equal(t.ok, true, t.why);
  }
  const planRef = `refs/seat/${planner.seat_id}/wip`;
  if (!skip.ticket) await board.refs.branch({ name: planRef, from: REF, author: planner });
  const p = await publish({ ...board, ref: planRef, author: planner, msg: "plan",
    entries: [
      { kind: "plan", payload: { steps: [{ item: ITEM, title: "fence the lease" }] } },
      { kind: "work_item", payload: { key: ITEM, title: "fence the lease", state: "ready", artifact_slots: [`artifact:${SLOT}`] } },
    ] });
  assert.equal(p.ok, true, p.why);
  if (!skip.ticket) {
    const m = await merge({ ...board, into: REF, from: planRef, author: CONTROLLER, only: ["plan", "item:"] });
    assert.equal(m.ok, true, m.why);
  }
  const promoted = board.refs.resolve(REF);

  // --- work: the implementer's own projection, a lease held then released ---
  const wip = `refs/seat/${maker.seat_id}/wip`;
  await board.refs.branch({ name: wip, from: skip.ticket ? planRef : REF, author: maker });
  if (promoted) {
    const { slice, withheld } = project(board.store, promoted, PROJECTION_FOR_ROLE.implementer, { reader: maker, item: ITEM });
    assert.ok(slice.slots[`item:${ITEM}`], "the implementer sees its own item");
    assert.ok(withheld.some(w => w.slot === "(commit message)"), "and not the maker's defense");
  }
  const lease = await board.runtime.acquire({ resource: `item:${ITEM}`, holder: maker, ttlMs: 120_000 });
  assert.equal(lease.lease.gen, 1);

  const a = await publish({ ...board, ref: wip, author: maker, lease: { resource: `item:${ITEM}`, gen: 1 },
    msg: "MAKER DEFENSE: correct because I was careful",
    entries: [{ kind: "artifact", payload: { slot: SLOT, path: SLOT, rev: 1 }, blob: "// fenced\n" }] });
  assert.equal(a.ok, true, a.why);
  const artifactCid = treeSlots(board.store, a.commit)[`artifact:${SLOT}`];
  const bytes = board.store.get(artifactCid).links.bytes;

  if (!skip.tests) {
    // The CONTROLLER runs the suite and records the result. This fixture used to have the MAKER write
    // the passing repro, and the TESTS gate accepted it -- so "acceptance is executed, never asserted"
    // held only because nothing in the suite had the maker lie. A maker's own green is now recorded
    // and shown but does not close the gate; the executed oracle is the controller's (or another lab's).
    const r = await publish({ ...board, ref: wip, author: CONTROLLER, msg: "the suite on this revision",
      entries: [{ kind: "repro", payload: { cmd: TEST_CMD, exit: 0 }, blob: "# pass 346\n",
        links: { derived_from: [artifactCid] } }] });
    assert.equal(r.ok, true, r.why);
  }
  if (!skip.release) await board.runtime.release({ resource: `item:${ITEM}`, holder: maker, gen: 1 });

  // --- check: another lab, ack bound to the diff cid ---
  if (!skip.review) {
    const reviewer = seat(skip.sameLab ? "openai" : "xai", "critique", skip.sameLab ? "openai-critique" : "xai-critique");
    const rref = `refs/seat/${reviewer.seat_id}/wip`;
    await board.refs.branch({ name: rref, from: wip, author: reviewer });
    const { withheld } = project(board.store, board.refs.resolve(wip), PROJECTION_FOR_ROLE.reviewer, { reader: reviewer });
    assert.ok(withheld.some(w => w.slot === "(commit message)"), "the checker does not read the defense");
    const c = await publish({ ...board, ref: rref, author: reviewer, msg: "review",
      entries: [{ kind: "critique", links: { target: bytes },
        payload: { target: { slot: SLOT, rev: 1 }, verdict: "approve", findings: [{ severity: "nit", note: "name the gen" }] } }] });
    assert.equal(c.ok, true, c.why);
    const back = await merge({ ...board, into: wip, from: rref, author: CONTROLLER, only: ["critique:"] });
    assert.equal(back.ok, true, back.why);
  }

  const isoHeads = Object.fromEntries(board.refs.list().filter(r => r.name.startsWith("refs/iso/")).map(r => [r.name, r.cid]));
  return { scouts, promoted, wip, artifactCid, bytes, isoHeads, head: board.refs.resolve(REF) };
}

const isoUnchanged = (board, before) => {
  const now = Object.fromEntries(board.refs.list().filter(r => r.name.startsWith("refs/iso/")).map(r => [r.name, r.cid]));
  assert.deepEqual(now, before, "iso/* must not move when the board ships");
};

// ---------------------------------------------------------------- LAW 7: the happy path

test("law 7: the controller ships once every gate holds, and nothing else moves", () => withBoard(async (board) => {
  const d = await drive(board);
  assert.ok(d.head, "promoted");
  const before = d.head;

  const r = await ship({ ...board, ref: REF, from: d.wip, actor: CONTROLLER });
  assert.equal(r.ok, true, r.why);
  assert.deepEqual(r.gates.filter(g => !g.ok), [], "every gate green");

  // board HEAD moved
  const after = board.refs.resolve(REF);
  assert.notEqual(after, before);
  assert.equal(after, r.commit);
  assert.ok(treeSlots(board.store, after)[`artifact:${SLOT}`], "the artifact is on the board");
  assert.deepEqual(r.shipped, [`artifact:${SLOT}`]);

  // iso/* unchanged
  isoUnchanged(board, d.isoHeads);

  // no seat id anywhere in the commit's actor
  const commit = board.store.get(r.commit);
  assert.equal(commit.author.vendor, "controller");
  assert.equal(commit.author.seat_id, undefined);
  assert.equal(JSON.stringify(commit.author).includes("openai"), false);

  // scout cids stayed LINEAGE: cited by the ticket, never an ancestor of the ship commit
  for (const s of d.scouts) {
    assert.equal(commit.parents.includes(s.commit), false, `${s.vendor}'s scout commit must not be a parent`);
    assert.ok(board.store.has(s.evidence), "its evidence is still in the store");
  }
  const ticket = board.store.get(treeSlots(board.store, after).ticket);
  for (const s of d.scouts) assert.ok(ticket.links.derived_from.includes(s.evidence), "the ticket cites it");

  // the ack is recorded, and it is from another lab
  assert.equal(r.acks.length, 1);
  assert.equal(r.acks[0].vendor, "xai");

  // and law 6 still refuses every chair, after a successful ship
  for (const vendor of ["openai", "anthropic", "agy_google", "xai"]) {
    const bad = await ship({ ...board, ref: REF, from: d.wip, actor: seat(vendor, "integrate", `${vendor}-x`) });
    assert.equal(bad.ok, false);
    assert.equal(bad.refused, "ACTOR");
    assert.equal(board.refs.resolve(REF), after, "a refused ship moves nothing");
  }
}));

// ---------------------------------------------------------------- LAW 6: no chair ships

test("law 6: every chair in every seating table is refused, lead included", () => withBoard(async (board) => {
  const d = await drive(board);
  const before = board.refs.resolve(REF);

  // Parameterised over the seating tables themselves, so a vendor added to a table is covered without
  // anybody remembering to add a case.
  const chairs = [];
  for (const [table, name] of [[SEATING, "chain"], [INTAKE, "intake"]]) {
    for (const [role, candidates] of Object.entries(table)) {
      for (const c of candidates) chairs.push({ table: name, role, vendor: c.vendor });
    }
  }
  assert.ok(chairs.length >= 10, `expected the tables to yield chairs, got ${chairs.length}`);
  assert.ok(chairs.some(c => c.role === "planner"), "including the lead");

  for (const chair of chairs) {
    const actor = seat(chair.vendor, chair.role === "scout" ? "explore" : "integrate", `${chair.vendor}-${chair.role}`);
    const r = await ship({ ...board, ref: REF, from: d.wip, actor });
    assert.equal(r.ok, false, `${chair.table}/${chair.role}/${chair.vendor} must not ship`);
    assert.equal(r.refused, "ACTOR", `${chair.vendor}: refused at ${r.refused}, not ACTOR`);
    assert.match(r.why, /no chair ships|not a role \(law 6\)|is a chair/);
    assert.equal(r.unchanged, true);
    assert.equal(board.refs.resolve(REF), before);
  }
}));

test("law 6: a chair wearing the controller's coat is still a chair", () => withBoard(async (board) => {
  const d = await drive(board);
  const r = await ship({ ...board, ref: REF, from: d.wip, actor: { vendor: "controller", seat_id: "openai-work" } });
  assert.equal(r.ok, false);
  assert.equal(r.refused, "ACTOR");
  assert.match(r.why, /wearing the controller's coat/);
  assert.equal(mayShip({ vendor: "controller", seat_id: "x" }).ok, false);
  assert.equal(mayShip(CONTROLLER).ok, true);
  assert.equal(mayShip(HUMAN).ok, true, "a human break-glass may ship");
  assert.equal(mayShip(maker).ok, false);
}));

// ---------------------------------------------------------------- LAW 7 fails closed, one gate at a time

test("law 7: TARGET — a board ship cannot land on an iso ref", () => withBoard(async (board) => {
  const d = await drive(board);
  const target = d.scouts[0].ref;
  const before = board.refs.resolve(target);
  const r = await ship({ ...board, ref: target, from: d.wip, actor: CONTROLLER });
  assert.equal(r.ok, false);
  assert.equal(r.failed.includes("TARGET"), true, r.why);
  assert.equal(board.refs.resolve(target), before);
}));

test("law 7: TICKET — nothing ships from a board with no ticket", () => withBoard(async (board) => {
  const d = await drive(board, { ticket: true });
  assert.equal(board.refs.resolve(REF), null, "there is no board");
  const r = await ship({ ...board, ref: REF, from: d.wip, actor: CONTROLLER });
  assert.equal(r.ok, false);
  assert.equal(r.failed.includes("TICKET"), true, r.why);
  assert.equal(board.refs.resolve(REF), null, "and still none");
}));

test("law 7: LEASE — a ship while the maker still holds its lease races the maker", () => withBoard(async (board) => {
  const d = await drive(board, { release: true });
  const before = board.refs.resolve(REF);
  const r = await ship({ ...board, ref: REF, from: d.wip, actor: CONTROLLER });
  assert.equal(r.ok, false);
  assert.equal(r.refused, "LEASE", r.why);
  assert.match(r.why, /item:withSeatLock by openai-work gen 1/);
  assert.equal(board.refs.resolve(REF), before);

  // Release it and the same call succeeds: the gate was the lease, not the work.
  await board.runtime.release({ resource: `item:${ITEM}`, holder: maker, gen: 1 });
  const ok = await ship({ ...board, ref: REF, from: d.wip, actor: CONTROLLER });
  assert.equal(ok.ok, true, ok.why);
}));

test("law 7: REVIEW — no ack at all", () => withBoard(async (board) => {
  const d = await drive(board, { review: true });
  const before = board.refs.resolve(REF);
  const r = await ship({ ...board, ref: REF, from: d.wip, actor: CONTROLLER });
  assert.equal(r.ok, false);
  assert.equal(r.refused, "REVIEW", r.why);
  assert.match(r.why, /no ack is bound to/);
  assert.equal(board.refs.resolve(REF), before);
}));

test("law 7: REVIEW — an ack from the maker's own lab is not an ack", () => withBoard(async (board) => {
  const d = await drive(board, { sameLab: true });
  const before = board.refs.resolve(REF);
  const r = await ship({ ...board, ref: REF, from: d.wip, actor: CONTROLLER });
  assert.equal(r.ok, false);
  assert.equal(r.refused, "REVIEW", r.why);
  assert.match(r.why, /the maker's own lab/);
  assert.equal(board.refs.resolve(REF), before);

  // And the ack really exists -- this is a different-lab refusal, not a missing-ack one.
  const entry = board.store.get(d.artifactCid);
  const ack = reviewAck(board.store, board.refs.resolve(d.wip), entry);
  assert.equal(ack.bound, 1, "there IS a critique bound to these bytes");
  assert.deepEqual(ack.same_lab, ["openai"]);
  assert.deepEqual(ack.acks, []);
}));

test("law 7: TESTS — green on another revision is not green on this one", () => withBoard(async (board) => {
  const d = await drive(board, { tests: true });
  const before = board.refs.resolve(REF);
  const r = await ship({ ...board, ref: REF, from: d.wip, actor: CONTROLLER });
  assert.equal(r.ok, false);
  assert.equal(r.refused, "TESTS", r.why);
  assert.equal(board.refs.resolve(REF), before);
}));

test("law 7: GRAFT — a scout orphan is lineage, and becomes an ancestor only on purpose",
  () => withBoard(async (board) => {
    const d = await drive(board);
    const orphan = d.scouts[0].commit;
    const before = board.refs.resolve(REF);

    const refused = await ship({ ...board, ref: REF, from: d.scouts[0].ref, actor: CONTROLLER });
    assert.equal(refused.ok, false);
    assert.equal(refused.failed.includes("GRAFT"), true, refused.why);
    assert.match(refused.why, /shares no ancestor|Scout cids stay lineage/);
    assert.equal(board.refs.resolve(REF), before);

    // Naming it clears GRAFT. The other gates still apply, which is the point: graft admits an
    // ancestor, it does not admit unreviewed work.
    const grafted = await ship({ ...board, ref: REF, from: d.scouts[0].ref, actor: CONTROLLER, graft: [orphan] });
    assert.equal(grafted.ok, false, "graft is not a bypass");
    assert.equal(grafted.failed.includes("GRAFT"), false, "but GRAFT itself is satisfied");
    assert.equal(grafted.refused, "REVIEW", grafted.why);
    assert.equal(board.refs.resolve(REF), before);
  }));

test("every declared gate is actually evaluated on every call", () => withBoard(async (board) => {
  const d = await drive(board);
  const r = await ship({ ...board, ref: REF, from: d.wip, actor: CONTROLLER });
  // A gate that is declared and never evaluated is a gate that cannot fail.
  assert.deepEqual(r.gates.map(g => g.gate).sort(), [...GATES].sort());
  for (const g of GATES) assert.equal(typeof r.gates.find(x => x.gate === g).ok, "boolean");
}));

test("a ship built on a stale head is refused by the CAS, not retried", () => withBoard(async (board) => {
  const d = await drive(board);
  const stale = board.refs.resolve(REF);
  // Someone else moves the board first.
  await publish({ ...board, ref: REF, author: CONTROLLER, msg: "an unrelated item",
    entries: [{ kind: "work_item", payload: { key: "other", title: "other", state: "ready", artifact_slots: [] } }] });
  const moved = board.refs.resolve(REF);
  assert.notEqual(moved, stale);

  const r = await ship({ ...board, ref: REF, from: d.wip, actor: CONTROLLER, expected: stale });
  // ship resolves the head itself, so this one succeeds -- and the assertion worth making is that it
  // parented from the CURRENT head rather than the one the work was reasoned about.
  assert.equal(r.ok, true, r.why);
  assert.equal(board.store.get(r.commit).parents.includes(moved), true);
}));

// --- edges named as worth a test ---

test("a chain role cannot grow an iso/*/scout ref once the board exists", () => withBoard(async (board) => {
  const d = await drive(board);
  assert.ok(board.refs.resolve(REF), "the board exists now");
  // Checked without knowing anybody's role: intake PRECEDES the board.
  for (const actor of [maker, planner, CONTROLLER, HUMAN]) {
    const r = await board.refs.swap({ name: "refs/iso/openai/scout", expected: null,
      next: board.refs.resolve(d.wip), author: actor });
    assert.equal(r.ok, false, `${actor.seat_id ?? actor.vendor} must not open a scout ref after the board`);
    assert.equal(r.code, "SCOUT_AFTER_BOARD");
    assert.match(r.why, /intake precedes the board/);
  }
  assert.equal(board.refs.resolve("refs/iso/openai/scout"), null);
  // The forks opened at intake are untouched and still resolvable.
  for (const s of d.scouts) assert.equal(board.refs.resolve(s.ref), s.commit);
}));

test("citing a scout cid does not parent that commit onto the board", () => withBoard(async (board) => {
  const d = await drive(board);
  const r = await ship({ ...board, ref: REF, from: d.wip, actor: CONTROLLER });
  assert.equal(r.ok, true, r.why);

  // Walk the board's whole ancestry, not just the immediate parents: citation must not become
  // ancestry anywhere up the chain.
  const anc = ancestors(board.store, r.commit);
  for (const s of d.scouts) {
    assert.equal(anc.has(s.commit), false, `${s.vendor}'s orphan must not be an ancestor of the board`);
    // but it IS cited, and still readable
    const ticket = board.store.get(treeSlots(board.store, r.commit).ticket);
    assert.ok(ticket.links.derived_from.includes(s.evidence));
    assert.equal(board.store.get(s.evidence).kind, "repro");
  }
  // Graft is the only way it becomes ancestry, and it is a separate, explicit act.
  assert.equal(mergeBase(board.store, r.commit, d.scouts[0].commit), null,
    "the two histories share no ancestor: lineage is a link, ancestry is a parent");
}));

test("the declared law table gets DERIVED facts, never caller-supplied booleans", () => withBoard(async (board) => {
  const { LAWS, enforce } = await import("../src/team/law.mjs");
  const law7 = LAWS.find(l => l.n === 7);
  assert.ok(law7, "law 7 is declared in src/team/law.mjs");

  // The hazard: law 7 reads flags. A caller can simply assert them.
  const lie = law7.check({ kind: "ship", chair: "controller", tests_passed: true, checker_ack: true, bound_to_current_bytes: true });
  assert.equal(lie, null, "a hand-built action passes the declared law with no board involved at all");

  // shipClaim derives the same three from the store, so the declaration cannot be told a story.
  const d = await drive(board, { review: true });
  const claim = await shipClaim({ ...board, ref: REF, from: d.wip, actor: CONTROLLER });
  assert.equal(claim.derived_from_board, true);
  assert.equal(claim.checker_ack, false, "there is no ack, and the claim says so");
  assert.equal(law7.check(claim) !== null, true, "so the declared law refuses it");
  assert.match(law7.check(claim), /checker acknowledgement/);
}));

test("with the ack present, the derived claim satisfies the declaration and the mechanism together",
  () => withBoard(async (board) => {
    const { LAWS } = await import("../src/team/law.mjs");
    const law7 = LAWS.find(l => l.n === 7);
    const d = await drive(board);
    const claim = await shipClaim({ ...board, ref: REF, from: d.wip, actor: CONTROLLER });
    assert.equal(claim.tests_passed, true);
    assert.equal(claim.checker_ack, true);
    assert.equal(law7.check(claim), null, "the declaration is satisfied by derived facts");

    // The dry run goes FIRST and moves nothing. Run after a real ship it would report a refusal --
    // there would be nothing left to move -- which is a true answer to a different question.
    const at = board.refs.resolve(REF);
    const dry = await ship({ ...board, ref: REF, from: d.wip, actor: CONTROLLER, dryRun: true });
    assert.equal(dry.dryRun, true);
    assert.deepEqual(dry.would_ship, [`artifact:${SLOT}`]);
    assert.equal(board.refs.resolve(REF), at, "a dry run moves nothing");

    const real = await ship({ ...board, ref: REF, from: d.wip, actor: CONTROLLER });
    assert.equal(real.ok, true, real.why);
    assert.notEqual(board.refs.resolve(REF), at, "and the real one does");
  }));

test("every candidate-reading gate evaluates the SAME set: gates share rules, not leftovers",
  () => withBoard(async (board) => {
    const d = await drive(board);
    const r = await ship({ ...board, ref: REF, from: d.wip, actor: CONTROLLER, dryRun: true });
    assert.deepEqual(r.candidates, [`artifact:${SLOT}`]);
    // This is the regression guard for the REVIEW blindness. If a future gate starts from another
    // gate's survivors instead of the candidate set, its `evaluated` shrinks and this fails.
    for (const name of ["REVIEW", "TESTS", "MERGE"]) {
      const g = r.gates.find(x => x.gate === name);
      assert.deepEqual(g.evaluated, r.candidates,
        `${name} evaluated ${JSON.stringify(g.evaluated)} but the candidate set is ${JSON.stringify(r.candidates)}`);
    }
  }));

test("with no ack, REVIEW names the missing ack — it does not report an empty plate",
  () => withBoard(async (board) => {
    const d = await drive(board, { review: true });
    const r = await ship({ ...board, ref: REF, from: d.wip, actor: CONTROLLER, dryRun: true });
    // The candidate is still a candidate. The old bug made it disappear before REVIEW could see it.
    assert.deepEqual(r.candidates, [`artifact:${SLOT}`]);
    const review = r.gates.find(g => g.gate === "REVIEW");
    assert.deepEqual(review.evaluated, r.candidates, "REVIEW saw the candidate");
    assert.equal(review.ok, false);
    assert.match(review.why, /no ack is bound to/);
    assert.doesNotMatch(review.why, /nothing to ship/,
      "an unreviewed candidate is a missing ack, not an empty set");
  }));


// THE FINDING, as a case: a maker that writes its own passing repro does not close the TESTS gate.
test("the maker's own green run does not satisfy TESTS; an independent run does", () => withBoard(async (board) => {
  const d = await drive(board, { tests: true });   // drive(board, skip): no controller-run repro
  const artifactCid = treeSlots(board.store, board.refs.resolve(d.wip))[`artifact:${SLOT}`];
  // The maker publishes a passing run citing its own artifact.
  const maker = seat("openai", "work", "openai-work");   // the same identity drive() gave the artifact
  const own = await publish({ ...board, ref: d.wip, author: maker, msg: "I ran it, it passes",
    entries: [{ kind: "repro", payload: { cmd: TEST_CMD, exit: 0 }, blob: "# pass\n", links: { derived_from: [artifactCid] } }] });
  assert.equal(own.ok, true, own.why);
  const refused = await ship({ ...board, ref: REF, from: d.wip, actor: CONTROLLER });
  assert.equal(refused.ok, false);
  assert.equal(refused.refused, "TESTS");
  assert.match(refused.why, /artifact's own author/);
  // A checker from another lab runs it: that is the executed oracle.
  const checker = seat("xai", "critique", "xai-runs-it");
  const cref = `refs/seat/${checker.seat_id}/wip`;
  await board.refs.branch({ name: cref, from: d.wip, author: checker });
  const indep = await publish({ ...board, ref: cref, author: checker, msg: "ran the suite",
    entries: [{ kind: "repro", payload: { cmd: TEST_CMD, exit: 0 }, blob: "# pass\n", links: { derived_from: [artifactCid] } }] });
  assert.equal(indep.ok, true, indep.why);
  const back = await merge({ ...board, into: d.wip, from: cref, author: CONTROLLER, only: ["critique:"] });
  assert.equal(back.ok, true, back.why);
  const shipped = await ship({ ...board, ref: REF, from: d.wip, actor: CONTROLLER });
  assert.equal(shipped.ok, true, shipped.why);
}));
