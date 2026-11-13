import { test } from "node:test";
import assert from "node:assert/strict";
import { publish, treeSlots } from "../src/board/dag.mjs";
import { merge } from "../src/board/merge.mjs";
import { ship } from "../src/board/integrate.mjs";
import { project, PROJECTIONS, PROJECTION_FOR_ROLE, PRE_BOARD_ROLES } from "../src/board/project.mjs";
import { ROLES } from "../src/role/roles.mjs";
import { withBoard, seeded, seat, HUMAN, CONTROLLER } from "./board-helper.mjs";

const worker = seat("openai", "work", "openai-1");
const reviewer = seat("agy_google", "critique", "google-1");
const debater = seat("xai", "refute", "xai-1");
const other = seat("anthropic", "refute", "anthropic-1");

/**
 * A board carrying one of everything, so a "withheld" assertion is never vacuous: each thing a
 * projection must NOT show is proven present on the board first.
 */
async function rich(board) {
  const { ref, slot } = await seeded(board);
  const wip = `refs/seat/${worker.seat_id}/wip`;
  await board.refs.branch({ name: wip, from: ref, author: worker });
  const a = await publish({ ...board, ref: wip, author: worker,
    msg: "MAKER DEFENSE: this lock is correct because I thought about it carefully",
    entries: [
      { kind: "artifact", payload: { slot, path: slot, rev: 1, summary: "withSeatLock" }, blob: "// the lock\n" },
      { kind: "work_item", payload: { key: "withSeatLock", title: "implement the fenced lease", state: "offered_review", offer_ref: wip, artifact_slots: [`artifact:${slot}`] } },
    ] });
  assert.equal(a.ok, true, a.why);
  const bytes = board.store.get(treeSlots(board.store, a.commit)[`artifact:${slot}`]).links.bytes;

  const rref = `refs/seat/${reviewer.seat_id}/wip`;
  await board.refs.branch({ name: rref, from: wip, author: reviewer });
  await publish({ ...board, ref: rref, author: reviewer, msg: "review",
    entries: [{ kind: "critique", payload: { target: { slot, rev: 1 }, verdict: "approve", findings: [{ severity: "nit", note: "name the nonce" }] }, links: { target: bytes } }] });
  await merge({ ...board, into: wip, from: rref, author: CONTROLLER });
  // The executed oracle is the CONTROLLER's run, not the maker's claim: a repro by the artifact's own
  // author no longer satisfies TESTS.
  const run = await publish({ ...board, ref: wip, author: CONTROLLER, msg: "ran the suite",
    entries: [{ kind: "repro", payload: { cmd: "node --test tests/board-refs.test.mjs", exit: 0 }, blob: "ok 14\n",
      links: { derived_from: [treeSlots(board.store, a.commit)[`artifact:${slot}`]] } }] });
  assert.equal(run.ok, true, run.why);
  // Only the ITEM and the verdict travel to the shipping ref. This used to be `allowPartial: true`,
  // trusting bound-review to hold the artifact back -- and once the approval was reachable, bound-review
  // was satisfied and the artifact WENT THROUGH, with no ACTOR, TESTS or LEASE gate. That was the back
  // door merge() has since closed (SHIP_ONLY). A carry is now scoped by declaration; the artifact reaches
  // the board only through ship().
  await merge({ ...board, into: ref, from: wip, author: CONTROLLER, only: ["item:", "critique:", "plan", "hypothesis:", "decision:"] });
  // ...and the ARTIFACT reaches the board the only way it now can. These projection tests need it on
  // the shipping ref, and it used to get there through merge()'s back door.
  const shipped = await ship({ ...board, ref, from: wip, actor: CONTROLLER });
  assert.equal(shipped.ok, true, `fixture must ship: ${shipped.refused} -- ${shipped.why}`);

  // Two isolated debate forks, each visible only to its own author.
  for (const s of [debater, other]) {
    const n = `refs/iso/${s.vendor}/claim`;
    await board.refs.branch({ name: n, from: ref, author: s });
    await publish({ ...board, ref: n, author: s, msg: `claim by ${s.vendor}`,
      entries: [{ kind: "hypothesis", payload: { key: `${s.vendor}-claim`, claim: `${s.vendor}: flock cannot express identity`, status: "open" }, visibility: "isolated" }] });
  }
  await publish({ ...board, ref, author: CONTROLLER, msg: "record the split",
    entries: [{ kind: "decision", payload: { key: "mutex", question: "lease or flock?", options: [{ id: "lease" }, { id: "flock" }], resolution: { type: "split", recorded: true }, judge: "controller" } }] });
  return { ref, slot, wip, bytes };
}

test("every board role maps to one projection, and the pre-board role maps to none", () => {
  for (const role of Object.keys(ROLES)) {
    if (PRE_BOARD_ROLES.has(role)) {
      assert.equal(PROJECTION_FOR_ROLE[role], undefined,
        `"${role}" runs before a board exists; giving it a projection would be a lie that reads as coverage`);
      assert.equal(ROLES[role].preBoard, true, `"${role}" must declare preBoard`);
      continue;
    }
    const p = PROJECTION_FOR_ROLE[role];
    assert.ok(p, `role "${role}" has no projection`);
    assert.ok(PROJECTIONS[p], `role "${role}" maps to unknown projection "${p}"`);
  }
  // And every pre-board role is a real role, so the set cannot drift into naming something absent.
  for (const role of PRE_BOARD_ROLES) assert.ok(ROLES[role], `PRE_BOARD_ROLES names unknown role "${role}"`);
});

test("the checker does not read the maker's defense", () => withBoard(async (board) => {
  const { ref } = await rich(board);
  const head = board.refs.resolve(ref);
  // Prove the fixture actually has one: an assertion about something absent from the board is vacuous.
  assert.match(board.store.get(board.store.get(head).parents[0]).msg + board.store.get(head).msg, /.+/);
  const { slice, withheld } = project(board.store, head, "checker", { reader: reviewer });
  assert.equal(slice.commit_msg, undefined);
  assert.ok(withheld.some(w => w.why === "the maker's defense of its own work"));
  assert.ok(slice.slots.ticket, "it still sees what it is judging against");
  assert.ok(slice.acceptance?.length, "and what done means");
}));

test("the checker reads no other reviewer's verdict, so a second checker stays independent",
  () => withBoard(async (board) => {
    const { ref, slot } = await rich(board);
    const head = board.refs.resolve(ref);
    assert.ok(treeSlots(board.store, head)[`critique:${slot}@agy_google`], "the fixture HAS a critique on the board");
    const { slice, withheld } = project(board.store, head, "checker", { reader: seat("xai", "critique", "xai-1") });
    assert.equal(Object.keys(slice.slots).some(s => s.startsWith("critique:")), false);
    assert.ok(withheld.some(w => w.kind === "critique" && /anchors this one/.test(w.why)));
    assert.ok(Object.keys(slice.slots).some(s => s.startsWith("artifact:")), "it does see the artifact");
  }));

test("the worker sees its own item and not the review, the debate, or the decision",
  () => withBoard(async (board) => {
    const { ref } = await rich(board);
    const head = board.refs.resolve(ref);
    const present = Object.keys(treeSlots(board.store, head));
    for (const p of ["critique:", "decision:"]) assert.ok(present.some(s => s.startsWith(p)), `fixture has a ${p} slot`);
    const { slice, withheld } = project(board.store, head, "worker", { reader: worker, item: "withSeatLock" });
    assert.ok(slice.slots["item:withSeatLock"]);
    for (const p of ["critique:", "decision:", "hypothesis:"]) {
      assert.equal(Object.keys(slice.slots).some(s => s.startsWith(p)), false, `worker must not see ${p}`);
    }
    assert.equal(slice.commit_msg, undefined);
    assert.ok(withheld.some(w => /turns review into negotiation/.test(w.why ?? "")));
  }));

test("a worker scoped to one item does not see another seat's item", () => withBoard(async (board) => {
  const { ref } = await rich(board);
  await publish({ ...board, ref, author: CONTROLLER, msg: "second item",
    entries: [{ kind: "work_item", payload: { key: "somebodyElse", title: "other work", state: "ready", artifact_slots: [] } }] });
  const head = board.refs.resolve(ref);
  assert.ok(treeSlots(board.store, head)["item:somebodyElse"], "the fixture has a second item");
  const { slice, withheld } = project(board.store, head, "worker", { reader: worker, item: "withSeatLock" });
  assert.equal(slice.slots["item:somebodyElse"], undefined);
  assert.ok(withheld.some(w => w.slot === "item:somebodyElse" && /scoped to withSeatLock/.test(w.why)));
}));

test("an isolated debater sees the ticket, its own claim, and nothing any peer said",
  () => withBoard(async (board) => {
    const { ref } = await rich(board);
    // Its own fork, which is where its claim lives.
    const own = board.refs.resolve(`refs/iso/${debater.vendor}/claim`);
    const { slice, withheld } = project(board.store, own, "isolated_debater", { reader: debater });
    assert.ok(slice.slots["hypothesis:xai-claim"], "its own isolated claim is visible to its author");

    // The other vendor's fork, read by this debater: present on that ref, withheld here.
    const theirs = board.refs.resolve(`refs/iso/${other.vendor}/claim`);
    assert.ok(treeSlots(board.store, theirs)["hypothesis:anthropic-claim"], "the fixture HAS the peer's claim");
    const peek = project(board.store, theirs, "isolated_debater", { reader: debater });
    assert.equal(peek.slice.slots["hypothesis:anthropic-claim"], undefined);
    assert.ok(peek.withheld.some(w => /another seat/.test(w.why)));
    // And no artifact, because a debater that can read the code stops arguing about the question.
    assert.equal(Object.keys(slice.slots).some(s => s.startsWith("artifact:")), false);
  }));

test("the supervisor reads states and verdicts, not raw debate", () => withBoard(async (board) => {
  const { ref, slot } = await rich(board);
  const head = board.refs.resolve(ref);
  const { slice, withheld } = project(board.store, head, "supervisor");
  assert.ok(slice.slots.plan && slice.slots["item:withSeatLock"]);
  assert.equal(slice.slots[`critique:${slot}@agy_google`].payload.verdict, "approve");
  assert.ok(slice.slots["decision:mutex"], "the supervisor does read decisions");
  assert.equal(typeof slice.commit_msg, "string", "and it is the one projection that reads commit messages");
  assert.equal(Object.keys(slice.slots).some(s => s.startsWith("hypothesis:")), false);
}));

test("the synthesizer is handed the forks, because nothing on the shipping ref links them",
  () => withBoard(async (board) => {
    const { ref } = await rich(board);
    const head = board.refs.resolve(ref);
    const isoCommits = Object.fromEntries(board.refs.list()
      .filter(r => r.name.startsWith("refs/iso/")).map(r => [r.name, r.cid]));
    assert.equal(Object.keys(isoCommits).length, 2);

    const blind = project(board.store, head, "synthesizer", {});
    assert.equal(blind.slice.isolated && Object.keys(blind.slice.isolated).length, 0,
      "reading only the shipping ref finds no forks at all: isolation is structural, not a filter");

    const { slice } = project(board.store, head, "synthesizer", { isoCommits });
    const claims = Object.values(slice.isolated).flatMap(f => Object.values(f))
      .filter(e => e.kind === "hypothesis").map(e => e.payload.claim);
    assert.equal(claims.length, 2, `expected one claim per fork, got ${JSON.stringify(claims)}`);
    assert.ok(claims.some(c => c.startsWith("xai:")) && claims.some(c => c.startsWith("anthropic:")));
    assert.equal(slice.commit_msg, undefined, "a synthesizer judges the claims, not the maker's prose");
  }));

test("an undeclared projection is refused rather than defaulting to everything", () => withBoard(async (board) => {
  const { ref } = await rich(board);
  assert.throws(() => project(board.store, board.refs.resolve(ref), "everything"), /unknown projection/);
}));

test("a synthesizer reads recorded splits, but never the decision on its own question", () => withBoard(async (board) => {
  const { ref } = await rich(board);
  // Two decisions: one on the question under synthesis, one on something else.
  await publish({ ...board, ref, author: CONTROLLER, msg: "two decisions",
    entries: [
      { kind: "decision", payload: { key: "mutex", question: "lease or flock?", options: [{ id: "a" }, { id: "b" }], resolution: { type: "unanimous", option: "a" }, judge: "controller" } },
      { kind: "decision", payload: { key: "naming", question: "what do we call it?", options: [{ id: "x" }, { id: "y" }], resolution: { type: "split", recorded: true }, judge: "controller" } },
    ] });
  const head = board.refs.resolve(ref);
  assert.ok(treeSlots(board.store, head)["decision:mutex"], "the fixture has the decision on the question");

  const open = project(board.store, head, "synthesizer", {});
  assert.ok(open.slice.slots["decision:mutex"], "with no question named, every decision is context");

  const scoped = project(board.store, head, "synthesizer", { question: "mutex" });
  assert.equal(scoped.slice.slots["decision:mutex"], undefined, "the answer to the question is withheld");
  assert.ok(scoped.slice.slots["decision:naming"], "a recorded split on another question still is context");
  assert.ok(scoped.withheld.some(w => /the answer to the question under synthesis/.test(w.why)));
}));
