import { test } from "node:test";
import assert from "node:assert/strict";
import { publish, treeSlots } from "../src/board/dag.mjs";
import { shipOnlySlots, policyFor } from "../src/board/policy.mjs";
import { withBoard, seeded, seat, CONTROLLER } from "./board-helper.mjs";

// Three findings from the 2026-09-27 re-review, all about the same shape: a refusal that existed in one
// place and could be walked around in another.
//   rank 2  publish() THREW BoardViolation on an ordinary seat mistake, taking the driver down.
//   rank 7  the lease fence fired only for callers polite enough to present a lease.
//   rank 8  merge() refused bound-review slots on a board ref; putCommit + refs.swap did not.

const maker = seat("openai", "work", "openai-1");
const other = seat("xai", "plan", "xai-plan");
const active = (board, resource) => board.runtime.leases()[resource]?.state === "active";

test("a schema violation from a seat is a typed refusal, not a crash", () => withBoard(async board => {
  const { ref } = await seeded(board);
  const wip = `refs/seat/${maker.seat_id}/wip`;
  await board.refs.branch({ name: wip, from: ref, author: maker });
  const before = board.refs.resolve(wip);
  let r;
  try {
    r = await publish({ ...board, ref: wip, author: maker, msg: "a seat trying to decide",
      entries: [{ kind: "decision", payload: { key: "ship", question: "ship?", options: ["yes", "no"] } }] });
  } catch (e) { assert.fail(`publish threw instead of refusing: ${e.message}`); }
  assert.equal(r.ok, false);
  assert.equal(typeof r.code, "string");
  assert.match(r.why, /decision/);
  assert.ok(Array.isArray(r.steps), "the refusal carries the steps taken so far, like every other refusal");
  assert.equal(board.refs.resolve(wip), before, "nothing moved");
}));

test("a seat writing a directly-leased slot without the lease is refused: fencing is not opt-in", () => withBoard(async board => {
  const { ref, itemKey } = await seeded(board);
  const resource = `item:${itemKey}`;
  const held = await board.runtime.acquire({ resource, holder: maker, ttlMs: 120_000 });
  assert.equal(held.lease.gen, 1);
  assert.ok(active(board, resource));

  const wip = `refs/seat/${other.seat_id}/wip`;
  await board.refs.branch({ name: wip, from: ref, author: other });
  const entry = { kind: "work_item", payload: { key: itemKey, title: "implement the fenced lease", state: "active", artifact_slots: ["artifact:src/seatLock.ts"], preferred_mode: "work" } };
  const r = await publish({ ...board, ref: wip, author: other, msg: "moving the item with no lease", entries: [entry] });
  assert.equal(r.ok, false, "must be refused");
  assert.equal(r.code, "LEASE_REQUIRED", r.why);
  assert.match(r.why, /held by openai-1 at gen 1/);

  // The gate was the lease, not the write: released, the same write goes through.
  await board.runtime.release({ resource, holder: maker, gen: 1 });
  const again = await publish({ ...board, ref: wip, author: other, msg: "same write, lease released", entries: [entry] });
  assert.equal(again.ok, true, again.why);
}));

test("a seat writing an artifact slot covered by a leased item without the lease is refused; the holder with it is not", () => withBoard(async board => {
  const { ref, itemKey, slot } = await seeded(board);
  const resource = `item:${itemKey}`;
  await board.runtime.acquire({ resource, holder: maker, ttlMs: 120_000 });

  const intruder = seat("xai", "work", "xai-1");
  const iwip = `refs/seat/${intruder.seat_id}/wip`;
  await board.refs.branch({ name: iwip, from: ref, author: intruder });
  const r = await publish({ ...board, ref: iwip, author: intruder, msg: "writing someone else's artifact",
    entries: [{ kind: "artifact", payload: { slot, path: slot, rev: 1 }, blob: "// intruder\n" }] });
  assert.equal(r.ok, false);
  assert.equal(r.code, "LEASE_REQUIRED", r.why);
  assert.match(r.why, new RegExp(`artifact:${slot.replaceAll(".", "\\.")} is listed by item:${itemKey}`));

  const mwip = `refs/seat/${maker.seat_id}/wip`;
  await board.refs.branch({ name: mwip, from: ref, author: maker });
  const ok = await publish({ ...board, ref: mwip, author: maker, lease: { resource, gen: 1 }, msg: "the holder, with its lease",
    entries: [{ kind: "artifact", payload: { slot, path: slot, rev: 1 }, blob: "// holder\n" }] });
  assert.equal(ok.ok, true, ok.why);
}));

test("SHIP_ONLY is enforced at the ref: a raw swap of a bound-review slot onto a board ref is refused", () => withBoard(async board => {
  const { ref, itemKey, slot } = await seeded(board);
  await board.runtime.acquire({ resource: `item:${itemKey}`, holder: maker, ttlMs: 120_000 });
  const mwip = `refs/seat/${maker.seat_id}/wip`;
  await board.refs.branch({ name: mwip, from: ref, author: maker });
  const a = await publish({ ...board, ref: mwip, author: maker, lease: { resource: `item:${itemKey}`, gen: 1 }, msg: "rev 1",
    entries: [{ kind: "artifact", payload: { slot, path: slot, rev: 1 }, blob: "// rev1\n" }] });
  assert.equal(a.ok, true, a.why);
  assert.ok(treeSlots(board.store, a.commit)[`artifact:${slot}`]);

  const head = board.refs.resolve(ref);
  // The back door: the controller holds the raw handles and points the shipping ref straight at the
  // maker's commit, no ship(), no gates.
  const raw = await board.refs.swap({ name: ref, expected: head, next: a.commit, author: CONTROLLER,
    changedSlots: [`artifact:${slot}`], msg: "bypassing ship()" });
  assert.equal(raw.ok, false);
  assert.equal(raw.code, "SHIP_ONLY", raw.why);
  assert.equal(board.refs.resolve(ref), head, "the shipping ref did not move");

  // ship() says so, and is the only caller that may.
  const viaShip = await board.refs.swap({ name: ref, expected: head, next: a.commit, author: CONTROLLER,
    changedSlots: [`artifact:${slot}`], msg: "from ship()", ship: true });
  assert.notEqual(viaShip.code, "SHIP_ONLY", "the flag is what distinguishes the transaction that ran the gates");

  // Non-reviewed slots are unaffected: a controller may still move a plan directly.
  const plan = await board.refs.swap({ name: ref, expected: board.refs.resolve(ref), next: board.refs.resolve(ref), author: CONTROLLER,
    changedSlots: ["plan"], msg: "plan only" });
  assert.notEqual(plan.code, "SHIP_ONLY");
}));

test("the ship-only set is judged against the DEFAULT policy table, never a caller's", () => {
  assert.deepEqual(shipOnlySlots(["artifact:src/a.ts", "plan", "item:x", "critique:artifact:src/a.ts@xai", "decision:ship"]), ["artifact:src/a.ts"]);
  assert.equal(policyFor("artifact:src/a.ts", [["artifact:", "ours"]]), "ours", "a caller may reclassify for its own merge...");
  assert.deepEqual(shipOnlySlots(["artifact:src/a.ts"]), ["artifact:src/a.ts"], "...but not for the shipping ref");
});

// Found by an in-session probe the same day: every check in refs.swap keyed on the CALLER's changedSlots.
test("refs.swap measures the changed slots itself; a caller's changedSlots:[] lands nothing it should not", () => withBoard(async board => {
  const { ref, itemKey, slot } = await seeded(board);
  await board.runtime.acquire({ resource: `item:${itemKey}`, holder: maker, ttlMs: 120_000 });
  const mwip = `refs/seat/${maker.seat_id}/wip`;
  await board.refs.branch({ name: mwip, from: ref, author: maker });
  const a = await publish({ ...board, ref: mwip, author: maker, lease: { resource: `item:${itemKey}`, gen: 1 }, msg: "rev 1",
    entries: [{ kind: "artifact", payload: { slot, path: slot, rev: 1 }, blob: "// rev1\n" }] });
  assert.equal(a.ok, true, a.why);
  const head = board.refs.resolve(ref);
  const lie = await board.refs.swap({ name: ref, expected: head, next: a.commit, author: CONTROLLER, changedSlots: [], msg: "lying" });
  assert.equal(lie.ok, false);
  assert.equal(lie.code, "SHIP_ONLY", lie.why);
  assert.equal(board.refs.resolve(ref), head, "the shipping ref did not move");

  // A seat lying its way past the lease fence on its own wip.
  const intruder = seat("xai", "work", "xai-1");
  const iwip = `refs/seat/${intruder.seat_id}/wip`;
  await board.refs.branch({ name: iwip, from: ref, author: intruder });
  const lie2 = await board.refs.swap({ name: iwip, expected: board.refs.resolve(iwip), next: a.commit, author: intruder, changedSlots: [], msg: "lying seat" });
  assert.equal(lie2.ok, false);
  assert.equal(lie2.code, "LEASE_REQUIRED", lie2.why);
}));

test("an entry with no payload, or a null entry, is a typed refusal and not a TypeError", () => withBoard(async board => {
  const { ref } = await seeded(board);
  const wip = `refs/seat/${maker.seat_id}/wip`;
  await board.refs.branch({ name: wip, from: ref, author: maker });
  for (const entry of [null, { kind: "artifact" }, { payload: {} }, "artifact", [{ kind: "artifact", payload: {} }]]) {
    const r = await publish({ ...board, ref: wip, author: maker, msg: "bad shape", entries: [entry] });
    assert.equal(r.ok, false);
    assert.equal(r.code, "ENTRY", `${JSON.stringify(entry)} -> ${r.code}: ${r.why}`);
  }
}));

// In-session probe: with the ref diffing commits itself, "create the shipping ref by branching from my wip"
// would have a diff of zero. A board ref starts from a board ref or from ship().
test("a board ref cannot be created by branching from a seat's wip", () => withBoard(async board => {
  const { ref, itemKey, slot } = await seeded(board);
  await board.runtime.acquire({ resource: `item:${itemKey}`, holder: maker, ttlMs: 120_000 });
  const mwip = `refs/seat/${maker.seat_id}/wip`;
  await board.refs.branch({ name: mwip, from: ref, author: maker });
  const a = await publish({ ...board, ref: mwip, author: maker, lease: { resource: `item:${itemKey}`, gen: 1 }, msg: "rev 1",
    entries: [{ kind: "artifact", payload: { slot, path: slot, rev: 1 }, blob: "// rev1\n" }] });
  assert.equal(a.ok, true, a.why);
  const bad = await board.refs.branch({ name: "refs/board/side-door", from: mwip, author: CONTROLLER });
  assert.equal(bad.ok, false);
  assert.equal(bad.code, "BOARD_FROM", bad.why);
  assert.equal(board.refs.resolve("refs/board/side-door"), null);
  const fine = await board.refs.branch({ name: "refs/board/copy", from: ref, author: CONTROLLER });
  assert.equal(fine.ok, true, fine.why);
}));
