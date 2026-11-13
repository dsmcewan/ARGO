import { test } from "node:test";
import assert from "node:assert/strict";
import { publish, treeSlots } from "../src/board/dag.mjs";
import { merge } from "../src/board/merge.mjs";
import { schedule, boardState, boardStatus, acceptanceStatus, validateTriggers, TRIGGERS } from "../src/board/controller.mjs";
import { withBoard, seeded, seat, HUMAN, CONTROLLER, TICKET } from "./board-helper.mjs";

const worker = seat("openai", "work", "openai-1");
const reviewer = seat("agy_google", "critique", "google-1");
const REF = "refs/board/lock-helper";
const TEST_CMD = TICKET.acceptance[0].cmd;

test("the trigger table is well formed", () => assert.deepEqual(validateTriggers(), { ok: true, problems: [] }));

test("the status ladder walks intake -> planning -> executing, each rung saying why",
  () => withBoard(async (board) => {
    const empty = boardStatus({ store: board.store, state: boardState({ ...board, ref: REF }) });
    assert.equal(empty.status, "intake");

    await publish({ ...board, ref: REF, author: HUMAN, msg: "ticket", entries: [{ kind: "ticket", payload: TICKET }] });
    const planning = boardStatus({ store: board.store, state: boardState({ ...board, ref: REF }) });
    assert.equal(planning.status, "planning");
    assert.match(planning.why, /no plan/);

    await seeded(board);
    const exec = schedule({ ...board, ref: REF });
    assert.equal(exec.status, "executing");
    assert.match(exec.status_why, /1 ready/);
  }));

test("an item whose dependency is unfinished is not ready, and a board with none is stuck",
  () => withBoard(async (board) => {
    await seeded(board);
    await publish({ ...board, ref: REF, author: CONTROLLER, msg: "add a dependent item",
      entries: [
        { kind: "work_item", payload: { key: "withSeatLock", title: "t", state: "blocked", block: { reason: "design unsettled" }, artifact_slots: [] } },
        { kind: "work_item", payload: { key: "wireItUp", title: "wire it up", state: "ready", depends_on: ["withSeatLock"], artifact_slots: [] } },
      ] });
    const s = schedule({ ...board, ref: REF });
    assert.equal(s.status, "stuck");
    assert.match(s.status_why, /withSeatLock=blocked \(design unsettled\)/);
    assert.equal(s.ready.some(r => r.ks === "work"), false, "a ready item with an unfinished dependency is not work");
  }));

// --- the rule that would have kept a 72-hour run on the lock helper ---

test("discuss is never a peer of work", () => withBoard(async (board) => {
  await seeded(board);
  const s = schedule({ ...board, ref: REF });
  assert.equal(s.ready.some(r => r.ks === "discuss"), false);
  assert.match(s.dropped.find(d => d.ks === "discuss").why, /1 work item\(s\) are ready \(withSeatLock\); discuss is never a peer of work/);
}));

test("a free seat is not a reason to discuss: during planning there is nothing to discuss either",
  () => withBoard(async (board) => {
    await publish({ ...board, ref: REF, author: HUMAN, msg: "ticket", entries: [{ kind: "ticket", payload: TICKET }] });
    const s = schedule({ ...board, ref: REF });
    assert.equal(s.status, "planning");
    assert.equal(s.ready.some(r => r.ks === "discuss"), false);
    assert.equal(s.ready.map(r => r.ks).join(), "plan");
  }));

test("discuss becomes eligible only when the board is stuck AND something is open",
  () => withBoard(async (board) => {
    await seeded(board);
    await publish({ ...board, ref: REF, author: CONTROLLER, msg: "block it",
      entries: [{ kind: "work_item", payload: { key: "withSeatLock", title: "t", state: "blocked", block: { reason: "is flock enough?" }, artifact_slots: [] } }] });
    const quiet = schedule({ ...board, ref: REF });
    assert.equal(quiet.status, "stuck");
    assert.equal(quiet.ready.some(r => r.ks === "discuss"), false, "stuck with no open question is not a reason to talk");

    // An isolated claim from an explorer gives it something to be stuck ABOUT.
    const iso = "refs/iso/xai/claim";
    await board.refs.branch({ name: iso, from: REF, author: seat("xai", "explore", "xai-1") });
    await publish({ ...board, ref: iso, author: seat("xai", "explore", "xai-1"), msg: "claim",
      entries: [{ kind: "hypothesis", payload: { key: "coarse", claim: "flock cannot express identity", status: "open" }, visibility: "isolated" }] });
    const m = await merge({ ...board, into: REF, from: iso, author: CONTROLLER });
    assert.equal(m.ok, true, m.why);
    const s = schedule({ ...board, ref: REF });
    assert.ok(s.ready.some(r => r.ks === "discuss"), JSON.stringify(s.dropped.find(d => d.ks === "discuss")));
    assert.ok(s.ready.some(r => r.ks === "refute"), "and the claim is worth refuting before it is discussed");
  }));

// --- acceptance is executed, never asserted ---

/**
 * Offer an artifact for review, the way the design actually works: the work happens on the seat's
 * own branch, and the item that offers it POINTS AT that branch. Two publishes, because the offer
 * cites the artifact entry and a node can only cite what already exists.
 */
async function offered(board, { approve = true, body = "// the lock\n" } = {}) {
  const { slot } = await seeded(board);
  const wip = `refs/seat/${worker.seat_id}/wip`;
  await board.refs.branch({ name: wip, from: REF, author: worker });
  const a = await publish({ ...board, ref: wip, author: worker, msg: "rev 1",
    entries: [{ kind: "artifact", payload: { slot, path: slot, rev: 1 }, blob: body }] });
  assert.equal(a.ok, true, a.why);
  const artifactCid = treeSlots(board.store, a.commit)[`artifact:${slot}`];
  const bytes = board.store.get(artifactCid).links.bytes;
  const o = await publish({ ...board, ref: wip, author: worker, msg: "offer it for review",
    entries: [{ kind: "work_item", links: { offer: [artifactCid] },
      payload: { key: "withSeatLock", title: "t", state: "offered_review", offer_ref: wip, artifact_slots: [`artifact:${slot}`] } }] });
  assert.equal(o.ok, true, o.why);
  if (approve) {
    const rref = `refs/seat/${reviewer.seat_id}/wip`;
    await board.refs.branch({ name: rref, from: wip, author: reviewer });
    await publish({ ...board, ref: rref, author: reviewer, msg: "review",
      entries: [{ kind: "critique", payload: { target: { slot, rev: 1 }, verdict: "approve", findings: [] }, links: { target: bytes } }] });
    const back = await merge({ ...board, into: wip, from: rref, author: CONTROLLER });
    assert.equal(back.ok, true, back.why);
  }
  // Only the ITEM and the verdict travel to the shipping ref. This used to be `allowPartial: true`,
  // trusting bound-review to hold the artifact back -- and once the approval was reachable, bound-review
  // was satisfied and the artifact WENT THROUGH, with no ACTOR, TESTS or LEASE gate. That was the back
  // door merge() has since closed (SHIP_ONLY). A carry is now scoped by declaration; the artifact reaches
  // the board only through ship().
  await merge({ ...board, into: REF, from: wip, author: CONTROLLER, only: ["item:", "critique:", "plan", "hypothesis:", "decision:"] });
  return { slot, wip, artifactCid, bytes };
}

test("integrate does not fire on an approval alone: the acceptance command must have been run",
  () => withBoard(async (board) => {
    const { slot } = await offered(board);
    const s = schedule({ ...board, ref: REF });
    assert.equal(s.ready.some(r => r.ks === "integrate"), false);
    assert.match(s.dropped.find(d => d.ks === "integrate").why, /predicate not satisfied/);
    const state = boardState({ ...board, ref: REF });
    // Board-level: nothing has SHIPPED, so nothing is in scope. This used to read "no repro of" because
    // the fixture's artifact leaked onto the shipping ref through merge()'s back door before any ship.
    const board_level = acceptanceStatus({ store: board.store, state });
    assert.equal(board_level.ok, false);
    assert.match(board_level.why, /nothing in scope/);
    // Offer-level, which is what the integrate trigger evaluates: the artifact is on the branch, and
    // no run cites it.
    const [offer] = state.offers;
    assert.ok(offer?.commit, "the fixture offered something");
    const acc = acceptanceStatus({ store: board.store, state, artifact: offer.artifacts[0], from: offer.commit });
    assert.equal(acc.ok, false);
    assert.match(acc.why, /no repro of/);
  }));

test("a pass recorded against another revision is not a pass on this one", () => withBoard(async (board) => {
  const { slot, wip, artifactCid } = await offered(board);
  // A green run, but its lineage cites nothing -- so it names no revision.
  await publish({ ...board, ref: wip, author: CONTROLLER, msg: "tests pass (unbound)",
    entries: [{ kind: "repro", payload: { cmd: TEST_CMD, exit: 0 }, blob: "# tests 310\n# pass 310\n" }] });
  await merge({ ...board, into: REF, from: wip, author: CONTROLLER, allowPartial: true });
  const state = boardState({ ...board, ref: REF });
  const artifact = state.artifacts.find(a => a.slot === `artifact:${slot}`);
  const acc = acceptanceStatus({ store: board.store, state, artifact });
  assert.equal(acc.ok, false);
  assert.match(acc.why, /a pass that names no revision is a pass on nothing|nothing in scope/);
  assert.equal(schedule({ ...board, ref: REF }).ready.some(r => r.ks === "integrate"), false);
}));

test("integrate fires when the approval AND the green run both bind to the current bytes",
  () => withBoard(async (board) => {
    const { slot, wip, artifactCid } = await offered(board);
    await publish({ ...board, ref: wip, author: CONTROLLER, msg: "tests pass on this revision",
      entries: [{ kind: "repro", payload: { cmd: TEST_CMD, exit: 0 },
        blob: "# tests 310\n# pass 310\n", links: { derived_from: [artifactCid] } }] });
    await merge({ ...board, into: REF, from: wip, author: CONTROLLER, allowPartial: true });
    const s = schedule({ ...board, ref: REF });
    const hit = s.ready.find(r => r.ks === "integrate");
    assert.ok(hit, JSON.stringify(s.dropped.filter(d => d.ks === "integrate")));
    assert.match(hit.why, /1 approval\(s\).*acceptance executed and passing/);
  }));

test("a red run is not a pass, and the exit code is reported", () => withBoard(async (board) => {
  const { slot, wip, artifactCid } = await offered(board);
  await publish({ ...board, ref: wip, author: CONTROLLER, msg: "tests fail",
    entries: [{ kind: "repro", payload: { cmd: TEST_CMD, exit: 1 }, blob: "not ok 3\n", links: { derived_from: [artifactCid] } }] });
  // The red run lives on the offer branch and is judged there; the artifact does not reach the board.
  const state = boardState({ ...board, ref: REF });
  const [offer] = state.offers;
  const acc = acceptanceStatus({ store: board.store, state, artifact: offer.artifacts[0], from: offer.commit });
  assert.equal(acc.ok, false);
  assert.equal(acc.rows[0].executed, true, "it RAN; it just failed");
  assert.match(acc.why, /ran with exit 1/);
}));

test("a second revision on the branch makes the offer stale until it is reviewed again",
  () => withBoard(async (board) => {
    const { slot, wip, artifactCid } = await offered(board);
    await publish({ ...board, ref: wip, author: CONTROLLER, msg: "tests pass on rev 1",
      entries: [{ kind: "repro", payload: { cmd: TEST_CMD, exit: 0 }, blob: "ok\n", links: { derived_from: [artifactCid] } }] });
    await merge({ ...board, into: REF, from: wip, author: CONTROLLER, allowPartial: true });
    assert.ok(schedule({ ...board, ref: REF }).ready.some(r => r.ks === "integrate"), "rev 1 is integrable");

    // rev 2 lands on the branch. The approval and the green run both still describe rev 1.
    const two = await publish({ ...board, ref: wip, author: worker, msg: "rev 2, after the review",
      entries: [{ kind: "artifact", payload: { slot, path: slot, rev: 2 }, blob: "// changed after review\n" }] });
    assert.equal(two.ok, true, two.why);
    const rev2 = treeSlots(board.store, two.commit)[`artifact:${slot}`];
    await publish({ ...board, ref: wip, author: worker, msg: "re-offer",
      entries: [{ kind: "work_item", links: { offer: [rev2] },
        payload: { key: "withSeatLock", title: "t", state: "offered_review", offer_ref: wip, artifact_slots: [`artifact:${slot}`] } }] });
    await merge({ ...board, into: REF, from: wip, author: CONTROLLER, allowPartial: true });

    const s = schedule({ ...board, ref: REF });
    assert.equal(s.ready.some(r => r.ks === "integrate"), false, "rev 2 is not integrable on rev 1's approval");
    assert.ok(s.dropped.some(d => d.ks === "integrate"), JSON.stringify(s.dropped.filter(d => d.ks === "integrate")));
    const again = s.ready.find(r => r.ks === "critique");
    assert.ok(again, "and the controller asks for a review of the NEW bytes");
    assert.equal(again.target, board.store.get(rev2).links.bytes);
  }));

test("the critique trigger compares cids, not revision numbers", () => withBoard(async (board) => {
  const { slot, bytes } = await offered(board, { approve: false });
  const s = schedule({ ...board, ref: REF });
  const c = s.ready.find(r => r.ks === "critique");
  assert.ok(c, JSON.stringify(s.dropped.filter(d => d.ks === "critique")));
  assert.equal(c.target, bytes, "the candidate names the exact bytes needing review");
  assert.match(c.why, /has no critique bound to these bytes/);
}));

// --- caps and contention ---

test("a budget cap that drops coverage says so; it never reads as an empty queue",
  () => withBoard(async (board) => {
    await seeded(board);
    board.runtime.setBudget({ max_turns: 1 });
    const b = board.runtime.budget();
    assert.ok(b.spent_turns >= 1, "spend is derived from the side log, not stored on an entry");
    assert.equal(b.exhausted, true);

    const s = schedule({ ...board, ref: REF });
    assert.ok(s.notes.some(n => n.startsWith("BUDGET:")));
    assert.equal(s.ready.length, 0);
      // Name the triggers that SPEND. Asserting over every drop would pass vacuously, because discuss
    // is dropped for the ready-work reason and integrate for its own predicate.
    for (const ks of ["plan", "work", "critique", "explore", "refute", "synthesize"]) {
      const d = s.dropped.find(x => x.ks === ks);
      assert.match(d.why, /budget exhausted/, `${ks} must be dropped citing the budget`);
    }
  }));

test("max drops eligible work loudly rather than silently", () => withBoard(async (board) => {
  await seeded(board);
  await publish({ ...board, ref: REF, author: CONTROLLER, msg: "three items",
    entries: [1, 2, 3].map(i => ({ kind: "work_item", payload: { key: `i${i}`, title: `t${i}`, state: "ready", artifact_slots: [] } })) });
  const all = schedule({ ...board, ref: REF });
  assert.ok(all.ready.filter(r => r.ks === "work").length >= 3);
  const capped = schedule({ ...board, ref: REF, max: 2 });
  assert.equal(capped.ready.length, 2);
  assert.ok(capped.notes.some(n => n.startsWith("CAP:") && /reduced coverage/.test(n)));
}));

test("two scheduled invocations never claim the same resource", () => withBoard(async (board) => {
  await seeded(board);
  const dup = [
    ...TRIGGERS.filter(t => t.ks !== "work"),
    { ...TRIGGERS.find(t => t.ks === "work"), ks: "work" },
    { ...TRIGGERS.find(t => t.ks === "work"), ks: "work-twin", priority: 21 },
  ];
  const s = schedule({ ...board, ref: REF, triggers: dup });
  assert.equal(s.ready.filter(r => r.resource === "item:withSeatLock").length, 1);
  assert.ok(s.dropped.some(d => d.ks === "work-twin" && /already claims item:withSeatLock/.test(d.why)));
}));

test("the schedule states its own basis, so pool spreading is never read as a capability claim",
  () => withBoard(async (board) => {
    await seeded(board);
    assert.match(schedule({ ...board, ref: REF }).basis, /no model chose the next speaker/);
  }));

test("the board says intake is not its to schedule, rather than reporting an empty queue",
  () => withBoard(async (board) => {
    const s = schedule({ ...board, ref: REF });
    assert.equal(s.status, "intake");
    assert.equal(s.ready.length, 0);
    assert.ok(s.notes.some(n => n.startsWith("INTAKE:") && /not the controller's to write/.test(n)),
      `silence here reads as "nothing to do": ${JSON.stringify(s.notes)}`);
  }));

test("synthesize needs forks that carry a CLAIM, not merely isolated refs",
  () => withBoard(async (board) => {
    await seeded(board);
    // Two scout forks: evidence only, nothing contested. Synthesising these produces a summary of an
    // argument nobody had -- and it fired the moment intake started using isolated refs.
    for (const vendor of ["agy_google", "xai"]) {
      const s = seat(vendor, "explore", `${vendor}-scout`);
      const ref = `refs/iso/${vendor}/probe`;   // not /scout: that leaf is reserved for intake
      const r = await publish({ ...board, ref, author: s, msg: "scouted",
        entries: [{ kind: "repro", payload: { cmd: "node --test", exit: 0 }, blob: `${vendor} looked\n` }] });
      assert.equal(r.ok, true, r.why);
    }
    const evidenceOnly = schedule({ ...board, ref: REF });
    assert.equal(evidenceOnly.ready.some(r => r.ks === "synthesize"), false);
    assert.equal(board.refs.list().filter(r => r.name.startsWith("refs/iso/")).length, 2,
      "and there really are two isolated forks, so this is not passing vacuously");

    // Now give each fork a position. Only then is there something to synthesise.
    for (const vendor of ["agy_google", "xai"]) {
      const s = seat(vendor, "refute", `${vendor}-scout`);
      await publish({ ...board, ref: `refs/iso/${vendor}/probe`, author: s, msg: "claim",
        entries: [{ kind: "hypothesis", visibility: "isolated",
          payload: { key: `${vendor}-claim`, claim: `${vendor} says the lease is the wrong primitive`, status: "open" } }] });
    }
    const contested = schedule({ ...board, ref: REF });
    const hit = contested.ready.find(r => r.ks === "synthesize");
    assert.ok(hit, JSON.stringify(contested.dropped.filter(d => d.ks === "synthesize")));
    assert.match(hit.why, /2 isolated fork\(s\) carry a claim/);
  }));

test("the hypothesis flag is on the fork OBJECT, never inferred from the commit message",
  () => withBoard(async (board) => {
    await seeded(board);
    // Two forks whose messages talk about hypotheses at length and whose trees carry none. Inferring
    // from text would fire synthesize on a commit titled "maybe".
    for (const vendor of ["agy_google", "xai"]) {
      const s = seat(vendor, "explore", `${vendor}-scout`);
      const r = await publish({ ...board, ref: `refs/iso/${vendor}/probe`, author: s,
        msg: "hypothesis: maybe the lease is the wrong primitive — claim, status: open, DISAGREES",
        entries: [{ kind: "repro", payload: { cmd: "node --test", exit: 0 }, blob: `${vendor} looked\n` }] });
      assert.equal(r.ok, true, r.why);
      assert.match(board.store.get(r.commit).msg, /hypothesis/, "the message really does say it");
      assert.equal(Object.keys(treeSlots(board.store, r.commit)).some(x => x.startsWith("hypothesis:")), false,
        "and the tree really does not carry one");
    }
    const s = schedule({ ...board, ref: REF });
    assert.equal(s.ready.some(r => r.ks === "synthesize"), false,
      "two exhibits are not two positions, whatever their commit messages say");
  }));
