import { test } from "node:test";
import assert from "node:assert/strict";
import { publish, treeSlots, entriesOfKind } from "../src/board/dag.mjs";
import { merge, planMerge, policyFor, mergeBase, approvalFor, DEFAULT_POLICY } from "../src/board/merge.mjs";
import { withBoard, seeded, seat, HUMAN, CONTROLLER } from "./board-helper.mjs";

const worker = seat("openai", "work", "openai-1");
const reviewer = seat("agy_google", "critique", "google-1");

/** Put revision `rev` of the artifact on the worker's own branch. */
async function writeRev(board, { slot, rev, body, ref = "refs/board/lock-helper" }) {
  const wip = `refs/seat/${worker.seat_id}/wip`;
  // Branch from the head this work was reasoned about; an orphan branch has no base to three-way
  // against and could never be recognised as a fast-forward.
  await board.refs.branch({ name: wip, from: ref, author: worker });
  const r = await publish({ ...board, ref: wip, author: worker, msg: `rev ${rev}`,
    entries: [{ kind: "artifact", payload: { slot, path: slot, rev, summary: `revision ${rev}` }, blob: body }] });
  assert.equal(r.ok, true, r.why);
  const entry = board.store.get(treeSlots(board.store, r.commit)[`artifact:${slot}`]);
  return { wip, commit: r.commit, bytes: entry.links.bytes, entryCid: treeSlots(board.store, r.commit)[`artifact:${slot}`] };
}

async function review(board, { slot, rev, bytes, verdict, findings = [], author = reviewer, from = "refs/board/lock-helper" }) {
  const ref = `refs/seat/${author.seat_id}/wip`;
  await board.refs.branch({ name: ref, from, author });
  const r = await publish({ ...board, ref, author, msg: `review of rev ${rev}`,
    entries: [{ kind: "critique", payload: { target: { slot, rev }, verdict, findings }, links: { target: bytes } }] });
  assert.equal(r.ok, true, r.why);
  return r;
}

test("policy is declared per slot class, and an unclassified slot gets the strictest resolver", () => {
  assert.equal(policyFor("artifact:src/a.ts"), "bound-review");
  assert.equal(policyFor("decision:ship"), "record-split");
  assert.equal(policyFor("item:x"), "slot-wise");
  assert.equal(policyFor("ticket"), "ours");
  assert.equal(policyFor("something:nobody:classified"), "record-split",
    "a default of 'take theirs' would let an unclassified slot class move the shipping ref");
});

test("an artifact slot does not move without a critique bound to ITS bytes", () => withBoard(async (board) => {
  const { ref, slot } = await seeded(board);
  const { wip, bytes } = await writeRev(board, { slot, rev: 1, body: "// no review yet\n" });
  const m = await merge({ ...board, into: ref, from: wip, author: CONTROLLER });
  assert.equal(m.ok, false);
  assert.equal(m.code, "MERGE_BLOCKED");
  assert.match(m.why, /no critique is bound to/);
  assert.equal(treeSlots(board.store, board.refs.resolve(ref))[`artifact:${slot}`], undefined);
}));

test("an approving critique of exactly those bytes lets the slot move", () => withBoard(async (board) => {
  const { ref, slot } = await seeded(board);
  const { bytes } = await writeRev(board, { slot, rev: 1, body: "// reviewed\n" });
  await review(board, { slot, rev: 1, bytes, verdict: "approve", from: `refs/seat/${worker.seat_id}/wip` });

  // The reviewer's branch is merged first, so its critique is reachable from the source side.
  const wip = `refs/seat/${worker.seat_id}/wip`;
  const rm = await merge({ ...board, into: wip, from: `refs/seat/${reviewer.seat_id}/wip`, author: CONTROLLER });
  assert.equal(rm.ok, true, rm.why);
  // bound-review is SATISFIED: the plan would move the slot.
  const plan = planMerge({ store: board.store, into: board.refs.resolve(ref), from: board.refs.resolve(wip) });
  assert.equal(plan.ok, true, plan.why);
  assert.ok(plan.slots[`artifact:${slot}`], "the approved artifact is in the plan");
  // ...and satisfied is NECESSARY, not sufficient. merge() used to land this on the shipping ref with
  // nothing but the approval -- no ACTOR, TESTS or LEASE gate -- and the demo shipped through it.
  // That door is closed: a reviewed slot reaches refs/board/* only through ship().
  const m = await merge({ ...board, into: ref, from: wip, author: CONTROLLER });
  assert.equal(m.ok, false);
  assert.equal(m.code, "SHIP_ONLY");
  assert.match(m.why, /only through ship\(\)/);
  assert.equal(treeSlots(board.store, board.refs.resolve(ref))[`artifact:${slot}`], undefined, "and nothing moved");
}));

// THE STALENESS TEST. An approval of rev 3 authorising rev 4 is the same gate theater this project
// shipped in its own swarm this morning; binding to a cid rather than a rev makes it impossible.
test("an approval of an earlier revision does not carry forward to the next one", () => withBoard(async (board) => {
  const { ref, slot } = await seeded(board);
  const three = await writeRev(board, { slot, rev: 3, body: "// rev 3\n" });
  await review(board, { slot, rev: 3, bytes: three.bytes, verdict: "approve", from: three.wip });
  await merge({ ...board, into: three.wip, from: `refs/seat/${reviewer.seat_id}/wip`, author: CONTROLLER });

  const head = board.refs.resolve(ref);
  const ok = planMerge({ store: board.store, into: head, from: board.refs.resolve(three.wip) });
  assert.equal(ok.ok, true, "rev 3 is approved on its own bytes");

  // rev 4 arrives. Same slot, same path, same reviewer verdict on record -- different bytes.
  const four = await writeRev(board, { slot, rev: 4, body: "// rev 4, unreviewed\n" });
  assert.notEqual(four.bytes, three.bytes);
  const blocked = planMerge({ store: board.store, into: head, from: board.refs.resolve(four.wip) });
  assert.equal(blocked.ok, false);
  assert.ok(blocked.blocked.some(b => /no critique is bound to/.test(b.why)));
  // Landing either onto the shipping ref is ship()'s transaction; merge() refuses both the same way.
  assert.equal((await merge({ ...board, into: ref, from: four.wip, author: CONTROLLER })).code, "MERGE_BLOCKED");
}));

test("a fast-forward does not bypass bound-review", () => withBoard(async (board) => {
  const { ref, slot } = await seeded(board);
  const { wip } = await writeRev(board, { slot, rev: 1, body: "// linear and unreviewed\n" });
  const plan = planMerge({ store: board.store, into: board.refs.resolve(ref), from: board.refs.resolve(wip) });
  assert.equal(plan.fastForward, true, "this IS a fast-forward: the board head is an ancestor of the branch");
  assert.equal(plan.ok, false, "and it is still blocked, because linear history is the case that ships");
  assert.ok(plan.blocked.some(b => b.slot === `artifact:${slot}`));
}));

test("a blocking finding blocks even alongside an approval from another vendor", () => withBoard(async (board) => {
  const { ref, slot } = await seeded(board);
  const { wip, bytes } = await writeRev(board, { slot, rev: 1, body: "// contested\n" });
  await review(board, { slot, rev: 1, bytes, verdict: "approve", from: wip });
  await review(board, { slot, rev: 1, bytes, verdict: "request_changes",
    findings: [{ severity: "block", loc: "lock.mjs:12", note: "no generation token; a slow holder still wins" }],
    author: seat("xai", "critique", "xai-1"), from: wip });
  for (const r of ["google-1", "xai-1"]) await merge({ ...board, into: wip, from: `refs/seat/${r}/wip`, author: CONTROLLER });

  const m = await merge({ ...board, into: ref, from: wip, author: CONTROLLER });
  assert.equal(m.ok, false);
  assert.match(m.why, /1 blocking finding/);

  const ap = approvalFor(board.store, board.refs.resolve(wip), { links: { bytes } });
  assert.equal(ap.critiques, 2);
  assert.equal(ap.approvals, 1);
  assert.equal(ap.blocks, 1);
  assert.equal(ap.ok, false, "one vendor approving does not outvote a demonstrated blocker");
}));

test("a decision slot in conflict is recorded as a split, never awarded to a vendor",
  () => withBoard(async (board) => {
    const { ref } = await seeded(board);
    const base = board.refs.resolve(ref);
    const opts = [{ id: "lease", label: "named lease" }, { id: "flock", label: "keep flock" }];
    const a = await publish({ ...board, ref, author: CONTROLLER, msg: "controller picks lease",
      entries: [{ kind: "decision", payload: { key: "mutex", question: "how do we serialise?", options: opts, resolution: { type: "controller_rule", rule: "prefer the fenced design", option: "lease" }, judge: "controller" } }] });
    assert.equal(a.ok, true);
    await board.refs.branch({ name: "refs/seat/human/wip", from: base, author: HUMAN });
    const other = await publish({ ...board, ref: "refs/seat/human/wip", author: HUMAN, msg: "human leans flock",
      entries: [{ kind: "decision", payload: { key: "mutex", question: "how do we serialise?", options: opts, resolution: { type: "human" }, judge: "human" } }] });
    assert.equal(other.ok, true);

    const m = await merge({ ...board, into: ref, from: "refs/seat/human/wip", author: CONTROLLER });
    assert.equal(m.ok, false);
    assert.match(m.why, /decision:mutex/);
    const head = board.store.get(treeSlots(board.store, board.refs.resolve(ref))["decision:mutex"]);
    assert.equal(head.payload.resolution.option, "lease", "neither side was silently overwritten");
  }));

test("union is structural: a merge commit keeps both parents, so evidence from both sides survives",
  () => withBoard(async (board) => {
    const { ref, slot } = await seeded(board);
    const a = seat("xai", "explore", "xai-1"), b = seat("agy_google", "explore", "google-1");
    for (const s of [a, b]) {
      await board.refs.branch({ name: `refs/iso/${s.vendor}/claim`, from: ref, author: s });
      const r = await publish({ ...board, ref: `refs/iso/${s.vendor}/claim`, author: s, visibility: "isolated",
        msg: `claim by ${s.vendor}`,
        entries: [{ kind: "hypothesis", payload: { key: `${s.vendor}-claim`, claim: `${s.vendor} thinks flock is too coarse`, status: "open" }, visibility: "isolated" },
                  { kind: "repro", payload: { cmd: `node probe-${s.vendor}.mjs`, exit: 1 }, blob: `probe output from ${s.vendor}\n` }] });
      assert.equal(r.ok, true, r.why);
    }
    // Both forks merge into one collection point; neither loses its evidence.
    const coll = "refs/iso/xai/collected";
    await board.refs.branch({ name: coll, from: "refs/iso/xai/claim", author: CONTROLLER });
    const m = await merge({ ...board, into: coll, from: "refs/iso/agy_google/claim", author: CONTROLLER });
    assert.equal(m.ok, true, m.why);
    assert.equal(board.store.get(m.commit).parents.length, 2, "a merge commit names both parents");
    const repros = entriesOfKind(board.store, m.commit, "repro");
    assert.equal(repros.length, 2, "evidence unions without anybody choosing");
    const slots = treeSlots(board.store, m.commit);
    assert.ok(slots["hypothesis:xai-claim"] && slots["hypothesis:agy_google-claim"], "different claims are different slots");
  }));

test("mergeBase finds the nearest common ancestor, and unrelated histories have none",
  () => withBoard(async (board) => {
    const { ref } = await seeded(board);
    const base = board.refs.resolve(ref);
    await board.refs.branch({ name: "refs/seat/a/wip", from: base, author: seat("openai", "work", "a") });
    await board.refs.branch({ name: "refs/seat/b/wip", from: base, author: seat("xai", "work", "b") });
    const a = await publish({ ...board, ref: "refs/seat/a/wip", author: seat("openai", "work", "a"), msg: "a",
      entries: [{ kind: "work_item", payload: { key: "ia", title: "a", state: "ready", artifact_slots: [] } }] });
    const b = await publish({ ...board, ref: "refs/seat/b/wip", author: seat("xai", "work", "b"), msg: "b",
      entries: [{ kind: "work_item", payload: { key: "ib", title: "b", state: "ready", artifact_slots: [] } }] });
    assert.equal(mergeBase(board.store, a.commit, b.commit), base);
    const orphan = await publish({ ...board, ref: "refs/seat/c/wip", author: seat("agy_google", "work", "c"), expect: null, msg: "c",
      entries: [{ kind: "work_item", payload: { key: "ic", title: "c", state: "ready", artifact_slots: [] } }] });
    assert.equal(mergeBase(board.store, a.commit, orphan.commit), null);
  }));

test("a carry merge cannot ship code: shipping is a separate, scheduled act", () => withBoard(async (board) => {
  const { ref, slot } = await seeded(board);
  const { wip, bytes } = await writeRev(board, { slot, rev: 1, body: "// approved\n" });
  await review(board, { slot, rev: 1, bytes, verdict: "approve", from: wip });
  await merge({ ...board, into: wip, from: `refs/seat/${reviewer.seat_id}/wip`, author: CONTROLLER });

  // bound-review IS satisfiable at this point. A scoped carry must still leave the artifact alone,
  // or the shipping ref advances without the controller deciding to integrate.
  const carry = await merge({ ...board, into: ref, from: wip, author: CONTROLLER,
    only: ["item:", "critique:", "plan"] });
  assert.equal(carry.ok, true, carry.why);
  assert.ok(carry.changed.some(s => s.startsWith("critique:")), "the verdict was collected");
  assert.equal(treeSlots(board.store, board.refs.resolve(ref))[`artifact:${slot}`], undefined,
    "and the code did not ship");
  assert.ok(carry.plan.decisions.some(d => d.action === "out-of-scope" && d.slot === `artifact:${slot}`));

  // The un-scoped merge used to be "the scheduled integrate". It is not one: it evaluated nothing but
  // bound-review. It is now refused, and integrate is ship() -- exercised in board-integrate.test.mjs.
  const door = await merge({ ...board, into: ref, from: wip, author: CONTROLLER });
  assert.equal(door.ok, false);
  assert.equal(door.code, "SHIP_ONLY");
  assert.equal(treeSlots(board.store, board.refs.resolve(ref))[`artifact:${slot}`], undefined, "still not shipped");
}));
