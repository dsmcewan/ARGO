import { test } from "node:test";
import assert from "node:assert/strict";
import { createViewServer } from "../src/view/server.mjs";
import { publish } from "../src/board/dag.mjs";
import { existsSync } from "node:fs";
import { withBoard, seeded, seat } from "./board-helper.mjs";

/** Start the view against a board root and ask it one question. Always closed. */
async function ask(path, opts) {
  const srv = createViewServer({ makeClientFor: () => ({}), home: opts.home, ...opts });
  const addr = await srv.listen(0);
  try { return await fetch(`http://127.0.0.1:${addr.port}${path}`).then(r => r.json()); }
  finally {
    // fetch keeps the socket alive, so close() alone leaves a handle open and the test runner never
    // exits -- a hang that looks exactly like a failing assertion until you check for it.
    srv.server.closeAllConnections?.();
    srv.server.close();
  }
}

test("with no board configured the view says so rather than inventing one", async () => {
  const r = await ask("/board", { home: "/tmp" });
  assert.deepEqual(r, { board: null });
});

test("the view reports the shipping head and each seat's branch class", () => withBoard(async (board, root) => {
  const { ref } = await seeded(board);
  const w = seat("openai", "work", "openai-work");
  const x = seat("xai", "refute", "xai-refute");
  await board.refs.branch({ name: "refs/seat/openai-work/wip", from: ref, author: w });
  await board.refs.branch({ name: "refs/iso/xai/claim", from: ref, author: x });
  board.runtime.setOccupancy("openai-work", { status: "running", mode: "work", ref: "refs/seat/openai-work/wip" });
  board.runtime.setOccupancy("xai-refute", { status: "running", mode: "refute", ref: "refs/iso/xai/claim" });

  const { board: b } = await ask("/board", { home: root, boardRoot: root });
  assert.equal(b.ref, ref);
  assert.match(b.head, /^commit:[0-9a-f]{12}$/, "a short cid, long enough to be unambiguous on this board");
  assert.equal(b.status, "executing");
  // The pairing that makes a seat card mean something: which world, and shipping vs drafting vs fighting.
  assert.equal(b.seats["openai-work"].branch, "wip");
  assert.equal(b.seats["xai-refute"].branch, "iso");
  assert.equal(b.refs.find(r => r.name === ref).cls, "main");
}));

test("a boardRoot with no board is reported, and the view never tries to create one", async () => {
  // The view is a reader. Pointed at a directory that holds no board it must say so -- not mkdir an
  // object store, and not block the handler trying to.
  const r = await ask("/board", { home: "/tmp", boardRoot: "/tmp" });
  assert.ok(r.board, "it still answers");
  assert.match(r.board.error, /no board at \/tmp/);
  assert.equal(existsSync("/tmp/objects"), false, "and it created nothing");
});
