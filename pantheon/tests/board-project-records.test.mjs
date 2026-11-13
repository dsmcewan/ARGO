import { test } from "node:test";
import assert from "node:assert/strict";
import { publish, treeSlots } from "../src/board/dag.mjs";
import { project, PROJECTION_FOR_ROLE } from "../src/board/project.mjs";
import { withBoard, seeded, seat, CONTROLLER } from "./board-helper.mjs";

// STATE.md open item 6, written as the ACCEPTANCE ORACLE for a Pantheon run rather than as a test of
// code that exists: accumulative kinds (repro, search, trace) are slotted:false, never enter the tree,
// and so appeared in neither `slice.slots` nor `withheld[]`. A checkout that admits `repro` must carry
// it; one that does not must SAY it withheld it. Authored by the human before any seat saw the ticket,
// so the implementer's green is measured against an oracle it did not write.

const maker = seat("openai", "work", "openai-1");

test("accumulative records are admitted or withheld by kind, never invisible", () => withBoard(async board => {
  const { ref, itemKey, slot } = await seeded(board);
  const wip = `refs/seat/${maker.seat_id}/wip`;
  await board.refs.branch({ name: wip, from: ref, author: maker });
  await board.runtime.acquire({ resource: `item:${itemKey}`, holder: maker, ttlMs: 120_000 });
  const a = await publish({ ...board, ref: wip, author: maker, lease: { resource: `item:${itemKey}`, gen: 1 }, msg: "rev 1",
    entries: [{ kind: "artifact", payload: { slot, path: slot, rev: 1 }, blob: "// r1\n" }] });
  assert.equal(a.ok, true, a.why);
  const artifactCid = treeSlots(board.store, a.commit)[`artifact:${slot}`];
  const r = await publish({ ...board, ref: wip, author: CONTROLLER, msg: "the suite on rev 1",
    entries: [{ kind: "repro", payload: { cmd: "node --test", exit: 0 }, blob: "# pass\n", links: { derived_from: [artifactCid] } }] });
  assert.equal(r.ok, true, r.why);
  const reproCid = r.written[0].cid;
  const head = board.refs.resolve(wip);

  // The worker checkout admits `repro`: the record travels with it.
  const w = project(board.store, head, PROJECTION_FOR_ROLE.implementer, { reader: maker, item: itemKey });
  assert.ok(Array.isArray(w.slice.records), "slice.records is an array on a non-null commit");
  const hit = w.slice.records.find(x => x.cid === reproCid);
  assert.ok(hit, "the repro record is admitted to the worker checkout");
  assert.equal(hit.kind, "repro");
  assert.equal(hit.payload.exit, 0);
  assert.ok(!w.withheld.some(x => x.cid === reproCid), "and is not also listed as withheld");

  // The planner checkout does not admit `repro`: the record is withheld, and the withholding is visible.
  const p = project(board.store, head, PROJECTION_FOR_ROLE.planner);
  assert.ok(Array.isArray(p.slice.records));
  assert.ok(!p.slice.records.some(x => x.cid === reproCid), "the planner checkout does not carry it");
  const wh = p.withheld.find(x => x.cid === reproCid);
  assert.ok(wh, "the withholding is recorded, keyed by the record's cid");
  assert.equal(wh.kind, "repro");
  assert.match(String(wh.why), /repro/);
}));

test("slotted entries never appear in records, and an empty chain yields an empty array", () => withBoard(async board => {
  const { ref } = await seeded(board);
  const head = board.refs.resolve(ref);
  const p = project(board.store, head, PROJECTION_FOR_ROLE.planner);
  assert.deepEqual(p.slice.records, [], "ticket, plan and work_item are slotted: they are slots, not records");
  assert.ok(p.slice.slots.ticket && p.slice.slots.plan, "slotted handling is unchanged");
  const s = project(board.store, head, "supervisor");
  assert.deepEqual(s.slice.records, []);
  const none = project(board.store, null, PROJECTION_FOR_ROLE.planner);
  assert.ok(none.slice.records === undefined || Array.isArray(none.slice.records));
}));
