import { test } from "node:test";
import assert from "node:assert/strict";
import { publish } from "../src/board/dag.mjs";
import { withBoard, seeded, seat } from "./board-helper.mjs";

// THE DEFECT, 2026-09-27 re-review, rank 11. refs.swap verified its lease under the REF lock while
// acquire()/fence() serialised through the runtime's LEASE lock -- two domains, so a swap could verify,
// a fence could run, and the swap could still land. The decide-and-write now runs under the lease lock.

const sleep = ms => new Promise(r => setTimeout(r, ms));
const maker = seat("openai", "work", "openai-1");
const thief = seat("xai", "work", "xai-1");

test("a fence cannot run while the lease lock is held: the two operations share one domain", () => withBoard(async board => {
  await board.runtime.acquire({ resource: "item:x", holder: maker, ttlMs: 120_000 });
  let fenced = false, f;
  await board.runtime.locked(async () => {
    f = board.runtime.fence({ resource: "item:x", holder: thief, reason: "test" }).then(() => { fenced = true; });
    await sleep(200);
    assert.equal(fenced, false, "the fence must wait for the lock the swap holds");
  });
  await f;
  assert.equal(fenced, true, "and proceed once it is released");
}));

test("refs.swap takes the runtime's lease lock for its decision and write", () => withBoard(async board => {
  const { ref, itemKey, slot } = await seeded(board);
  const orig = board.runtime.locked;
  let taken = 0;
  board.runtime.locked = fn => { taken++; return orig(fn); };
  try {
    await board.runtime.acquire({ resource: `item:${itemKey}`, holder: maker, ttlMs: 120_000 });
    const wip = `refs/seat/${maker.seat_id}/wip`;
    await board.refs.branch({ name: wip, from: ref, author: maker });
    const before = taken;
    const r = await publish({ ...board, ref: wip, author: maker, lease: { resource: `item:${itemKey}`, gen: 1 }, msg: "rev 1",
      entries: [{ kind: "artifact", payload: { slot, path: slot, rev: 1 }, blob: "// under one lock\n" }] });
    assert.equal(r.ok, true, r.why);
    assert.ok(taken > before, "the swap that landed this commit ran under runtime.locked");
  } finally { board.runtime.locked = orig; }
}));

test("a lease fenced between verify and write cannot land: the stale gen is refused inside the lock", () => withBoard(async board => {
  const { ref, itemKey, slot } = await seeded(board);
  await board.runtime.acquire({ resource: `item:${itemKey}`, holder: maker, ttlMs: 120_000 });
  const wip = `refs/seat/${maker.seat_id}/wip`;
  await board.refs.branch({ name: wip, from: ref, author: maker });
  // Fence first, then attempt the write with the dead gen: with one lock domain there is no ordering of
  // these two under which the gen-1 write lands, so this is the only observable outcome.
  await board.runtime.fence({ resource: `item:${itemKey}`, holder: thief, reason: "took over" });
  const r = await publish({ ...board, ref: wip, author: maker, lease: { resource: `item:${itemKey}`, gen: 1 }, msg: "late",
    entries: [{ kind: "artifact", payload: { slot, path: slot, rev: 1 }, blob: "// too late\n" }] });
  assert.equal(r.ok, false);
  assert.equal(r.code, "FENCED", r.why);
}));
