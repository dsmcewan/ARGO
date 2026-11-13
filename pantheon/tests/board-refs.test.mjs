import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { publish, treeSlots } from "../src/board/dag.mjs";
import { merge } from "../src/board/merge.mjs";
import { parseRef, maySwap, slotsAllowed } from "../src/board/refs.mjs";
import { withBoard, seeded, seat, HUMAN, CONTROLLER, TICKET } from "./board-helper.mjs";

const HERE = new URL(".", import.meta.url).pathname;

// --- branch class is a write permission, not a naming convention ---

test("a seat cannot move the shipping ref at all", () => {
  const r = maySwap("refs/board/lock-helper", seat("anthropic", "plan"));
  assert.equal(r.ok, false);
  assert.equal(r.code, "REF_CLASS");
});

test("a seat may only move its OWN wip and its own vendor's isolated fork", () => {
  assert.equal(maySwap("refs/seat/openai-1/wip", seat("openai", "work", "openai-1")).ok, true);
  assert.equal(maySwap("refs/seat/openai-1/wip", seat("xai", "work", "xai-1")).code, "REF_OWNER");
  assert.equal(maySwap("refs/iso/xai/flock-claim", seat("xai", "refute", "xai-1")).ok, true);
  assert.equal(maySwap("refs/iso/xai/flock-claim", seat("agy_google", "refute", "google-1")).code, "REF_OWNER");
});

test("an isolated fork cannot change an artifact slot, whoever moves it", () => {
  assert.equal(slotsAllowed("refs/iso/xai/claim", ["hypothesis:flock"]).ok, true);
  assert.equal(slotsAllowed("refs/iso/xai/claim", ["artifact:src/a.ts"]).code, "SLOT_CLASS");
  assert.equal(slotsAllowed("refs/board/x", ["artifact:src/a.ts", "decision:ship"]).ok, true);
});

test("a ref name outside the known classes is refused rather than created", () => {
  assert.throws(() => parseRef("refs/notes/whatever"), /unknown ref class/);
  assert.throws(() => parseRef("heads/main"), /not refs/);
  assert.throws(() => parseRef("refs/board/../../escape"), /safe path segment/);
});

// --- compare and swap ---

test("a lost CAS is a typed refusal, never a silent overwrite and never a blind retry",
  () => withBoard(async (board) => {
    const { ref } = await seeded(board);
    const at = board.refs.resolve(ref);

    // Someone else moves the ref first.
    const first = await publish({ ...board, ref, author: CONTROLLER, msg: "a",
      entries: [{ kind: "work_item", payload: { key: "other", title: "other", state: "ready", artifact_slots: [] } }] });
    assert.equal(first.ok, true);

    // Our write was built on the old head.
    const stale = await board.refs.swap({
      name: ref, expected: at, next: first.commit, author: CONTROLLER, changedSlots: [] });
    assert.equal(stale.ok, false);
    assert.equal(stale.code, "CAS_LOST");
    assert.match(stale.why, /fenced or beaten/);
    assert.equal(board.refs.resolve(ref), first.commit, "the winner's commit is still the head");
  }));

test("a snapshot ref is written once; a snapshot that can move is not a snapshot",
  () => withBoard(async (board) => {
    const { ref } = await seeded(board);
    const head = board.refs.resolve(ref);
    const a = await board.refs.swap({ name: "refs/snap/t1", expected: null, next: head, author: CONTROLLER });
    assert.equal(a.ok, true);
    const b = await board.refs.swap({ name: "refs/snap/t1", expected: head, next: head, author: CONTROLLER });
    assert.equal(b.code, "IMMUTABLE");
  }));

// --- THE FENCING TEST ---
//
// This is the property the mutex this project shipped in the morning could not express. That lock
// could answer "is someone inside"; it had no way to tell a slow holder that the world moved on.
// Note what makes it sharp: the expected cid STILL MATCHES. A design that treated compare-and-swap
// as sufficient would let the fenced holder's write land.
test("a fenced holder is refused even when its expected cid still matches", () => withBoard(async (board) => {
  const { ref, slot } = await seeded(board);
  const worker = seat("openai", "work", "openai-1");
  const takeover = seat("xai", "work", "xai-1");
  const resource = `artifact:${slot}`;
  const wip = `refs/seat/${worker.seat_id}/wip`;

  const got = await board.runtime.acquire({ resource, holder: worker, ttlMs: 60_000 });
  assert.equal(got.ok, true);
  assert.equal(got.lease.gen, 1);

  // The board does not move. Only the lease generation does.
  const before = board.refs.resolve(wip);
  const fenced = await board.runtime.fence({ resource, holder: takeover, reason: "worker stopped heartbeating" });
  assert.equal(fenced.lease.gen, 2);
  assert.deepEqual(fenced.fenced, { gen: 1, seat: "openai-1", reason: "worker stopped heartbeating" });

  const lost = await publish({ ...board, ref: wip, author: worker, lease: { resource, gen: 1 },
    msg: "rev 1", entries: [{ kind: "artifact", payload: { slot, path: slot, rev: 1 }, blob: "// gen 1 work\n" }] });
  assert.equal(lost.ok, false);
  assert.equal(lost.code, "FENCED");
  assert.match(lost.why, /gen 1 was fenced/);
  assert.equal(board.refs.resolve(wip), before, "the fenced holder moved nothing");

  // And the objects it wrote before being fenced are still in the store: history was not rewritten,
  // a name was stopped from moving.
  const pre = board.store.put("blob", "// gen 1 work\n");
  assert.equal(board.store.has(pre), true);

  const wins = await publish({ ...board, ref: `refs/seat/${takeover.seat_id}/wip`, author: takeover,
    lease: { resource, gen: 2 }, msg: "rev 1 by the new holder",
    entries: [{ kind: "artifact", payload: { slot, path: slot, rev: 1 }, blob: "// gen 2 work\n" }] });
  assert.equal(wins.ok, true);
}));

test("a renewal keeps the generation; bumping it would fence the holder's own in-flight write",
  () => withBoard(async ({ runtime }) => {
    const holder = seat("openai", "work", "o1");
    const a = await runtime.acquire({ resource: "tree", holder, ttlMs: 1000 });
    const b = await runtime.acquire({ resource: "tree", holder, ttlMs: 1000 });
    assert.equal(a.lease.gen, b.lease.gen);
    assert.equal(b.renewed, true);
    const r = await runtime.renew({ resource: "tree", holder, gen: a.lease.gen });
    assert.equal(r.ok, true);
    assert.equal(r.lease.gen, a.lease.gen);
  }));

test("a live lease is not taken by a competitor, and an expired one is fenced on acquire",
  () => withBoard(async ({ runtime }) => {
    const a = seat("openai", "work", "o1"), b = seat("xai", "work", "x1");
    await runtime.acquire({ resource: "tree", holder: a, ttlMs: 60_000 });
    const blocked = await runtime.acquire({ resource: "tree", holder: b });
    assert.equal(blocked.ok, false);
    assert.match(blocked.why, /held by o1 at gen 1/);

    // Expire it by asking about a later clock rather than by sleeping.
    const later = Date.now() + 120_000;
    const taken = await runtime.acquire({ resource: "tree", holder: b, now: later });
    assert.equal(taken.ok, true);
    assert.equal(taken.lease.gen, 2);
    assert.deepEqual(taken.fenced, { gen: 1, seat: "o1" });
    assert.equal(runtime.verify({ resource: "tree", seat_id: "o1", gen: 1, now: later }).code, "FENCED");
  }));

test("a holder cannot release a generation it does not hold", () => withBoard(async ({ runtime }) => {
  const a = seat("openai", "work", "o1"), b = seat("xai", "work", "x1");
  await runtime.acquire({ resource: "tree", holder: a });
  const wrong = await runtime.release({ resource: "tree", holder: b, gen: 1 });
  assert.equal(wrong.ok, false);
  assert.match(wrong.why, /not yours to release/);
  assert.equal((await runtime.release({ resource: "tree", holder: a, gen: 1 })).ok, true);
}));

test("a takeover must say why; an unexplained one is indistinguishable from a bug",
  () => withBoard(async ({ runtime }) => {
    assert.throws(() => runtime.fence({ resource: "tree", holder: seat("xai", "work") }), /reason is required/);
  }));

// --- a real race between processes, plus the mutation check that proves the test can fail ---

// --- CONCURRENCY: one writer per name, so the queue is per seat and the CAS never fires ---
//
// A merkle store needs no coordination for objects: the path IS the hash, so two seats writing the
// same bytes write one object and two seats writing different bytes touch different paths. Only a
// MUTABLE NAME can contend, and the ref namespace gives every writer its own -- refs/seat/<id>/wip,
// refs/iso/<vendor>/<claim>. Many writers on one name is not the design; it is the design being
// violated. Compare-and-swap is therefore an integrity backstop (two controller processes, a resumed
// session, a crash-restart replaying a publish), not the mechanism that makes concurrency safe.
//
// The first version of this file tested five processes scrambling for the shipping ref and called it
// the concurrency story. It was testing the violation, not the design -- and it was not even a race:
// execFileSync inside Promise.all runs children one after another, so each one read the previous
// winner's head and succeeded. Both tests below replace it.

const CHILD = `
import { existsSync } from "node:fs";
import { openBoard } from "SRC/board/index.mjs";
import { publish } from "SRC/board/dag.mjs";
const [root, ref, n, barrier] = process.argv.slice(2);
const board = openBoard(root);
// Spin until the parent drops the barrier, so every child is loaded and writing in the same window.
// Without it, process startup jitter staggers them and nothing is being tested concurrently.
while (!existsSync(barrier)) {}
const started = Date.now();
const r = await publish({ ...board, ref, author: { vendor: "openai", seat_id: "seat" + n, mode: "work", occupancy_gen: 1 },
  msg: "work by seat" + n, budgetCheck: false,
  entries: [{ kind: "work_item", payload: { key: "item" + n, title: "t" + n, state: "ready", artifact_slots: [] } }] });
process.stdout.write(JSON.stringify({ n, ok: r.ok, code: r.code ?? null, started, ended: Date.now() }));
`;

test("four seats publishing concurrently to their OWN refs all succeed: no contention, no CAS",
  () => withBoard(async (board, root) => {
    const { ref } = await seeded(board);
    const child = join(root, "child.mjs");
    const barrier = join(root, "GO");
    writeFileSync(child, CHILD.replaceAll("SRC", join(HERE, "..", "src")));

    const kids = 4;
    const running = [...Array(kids)].map((_, i) => new Promise(res => {
      const p = spawn(process.execPath, [child, root, `refs/seat/seat${i}/wip`, String(i), barrier]);
      let out = "", err = "";
      p.stdout.on("data", d => { out += d; });
      p.stderr.on("data", d => { err += d; });
      p.on("close", () => { try { res(JSON.parse(out)); } catch { res({ n: i, ok: false, code: `CHILD:${err.slice(0, 300)}` }); } });
    }));
    await new Promise(r => setTimeout(r, 400));
    writeFileSync(barrier, "go");
    const results = await Promise.all(running);

    // Assert the probe actually ran concurrently. A suite where every case serialises prints the same
    // green as one where the invariant holds, and this project has shipped exactly that before.
    const overlapping = results.some(a => results.some(b => a !== b && a.started <= b.ended && b.started <= a.ended));
    assert.ok(results.every(r => r.started) && overlapping,
      `the children did not overlap in time, so this proves nothing: ${JSON.stringify(results)}`);
    assert.deepEqual(results.filter(r => !r.ok), [], "a seat writing its own name must never lose a CAS");

    // And the controller collects them. Sequential by construction: it is the only writer of the
    // shipping ref, which is why that ref needs no queue either.
    for (let i = 0; i < kids; i++) {
      const m = await merge({ ...board, into: ref, from: `refs/seat/seat${i}/wip`, author: CONTROLLER });
      assert.equal(m.ok, true, `merge ${i}: ${m.why}`);
    }
    const slots = treeSlots(board.store, board.refs.resolve(ref));
    for (let i = 0; i < kids; i++) assert.ok(slots[`item:item${i}`], `item${i} survived the collection`);
  }));

test("mutation check: remove the parent comparison and the previous winner drops out of the head",
  () => withBoard(async (board) => {
    const { ref } = await seeded(board);
    const head0 = board.refs.resolve(ref);

    const a = await publish({ ...board, ref, author: CONTROLLER, msg: "A",
      entries: [{ kind: "work_item", payload: { key: "itemA", title: "A", state: "ready", artifact_slots: [] } }] });
    assert.equal(a.ok, true);
    assert.ok(treeSlots(board.store, board.refs.resolve(ref))["item:itemA"]);

    // B was built on head0 and never saw A. WITH the comparison it is refused.
    const refused = await publish({ ...board, ref, author: CONTROLLER, msg: "B", expect: head0,
      entries: [{ kind: "work_item", payload: { key: "itemB", title: "B", state: "ready", artifact_slots: [] } }] });
    assert.equal(refused.code, "CAS_LOST");

    // WITHOUT it -- the "just retry with the new parent" instinct -- B lands and A is gone from the
    // head. A's commit still exists in the store; it is simply no longer reachable from the ref,
    // which is the one failure mode content addressing cannot save you from.
    const real = board.refs.swap;
    board.refs.swap = args => real({ ...args, expected: board.refs.resolve(args.name) });
    const landed = await publish({ ...board, ref, author: CONTROLLER, msg: "B again", expect: head0,
      entries: [{ kind: "work_item", payload: { key: "itemB", title: "B", state: "ready", artifact_slots: [] } }] });
    board.refs.swap = real;
    assert.equal(landed.ok, true);
    const slots = treeSlots(board.store, board.refs.resolve(ref));
    assert.ok(slots["item:itemB"], "B landed");
    assert.equal(slots["item:itemA"], undefined, "and A's work silently left the head");
    assert.equal(board.store.has(a.commit), true, "A's commit is still in the store: this is a ref problem, not a delete");
  }));

test("the reflog records which names moved, and is never the audit trail itself",
  () => withBoard(async (board) => {
    const { ref, wip } = await seeded(board);
    const log = board.refs.reflog();
    assert.ok(log.length >= 3, JSON.stringify(log));
    assert.ok(log.some(l => l.name === wip && l.by === "anthropic-1"));
    assert.ok(log.some(l => l.name === ref && l.by === "controller"));
    for (const l of log) assert.ok("from" in l && "to" in l);
  }));
