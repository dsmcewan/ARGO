import { test } from "node:test";
import assert from "node:assert/strict";
import { boardState, boardStatus } from "../src/board/controller.mjs";
import { patternFor } from "../src/team/modes.mjs";
import { withBoard, seeded } from "./board-helper.mjs";

// THE DEFECT, 2026-09-27 re-review, rank 23. modes.mjs's "conveyor" pattern keyed on `state.ready > 0`,
// and boardStatus() emitted { status, why } and nothing else -- so against a REAL board the team layer
// could never pick the pattern it exists to pick. The status rungs now carry their counts, and this test
// runs the real status into the real pattern table instead of a hand-written state object.
test("a real executing board selects the conveyor pattern through boardStatus, not a hand-built state", () => withBoard(async board => {
  const { ref } = await seeded(board);
  const status = boardStatus({ store: board.store, state: boardState({ ...board, ref }) });
  assert.equal(status.status, "executing");
  assert.equal(status.ready, 1, "one ready item, counted by the status itself");
  assert.equal(status.active, 0);
  const p = patternFor(status);
  assert.equal(p.ok, true, p.why);
  assert.equal(p.pattern, "conveyor");
}));

test("the stuck rung carries counts too, so a caller never guesses at the shape", () => withBoard(async board => {
  const { ref } = await seeded(board);
  // boardStatus is pure over the state it is handed; block the one item in the real state and re-read.
  const state = boardState({ ...board, ref });
  state.items[0].state = "blocked";
  const s = boardStatus({ store: board.store, state });
  assert.equal(s.status, "stuck");
  assert.deepEqual([s.ready, s.active, s.unfinished], [0, 0, 1]);
  assert.equal(patternFor(s).pattern, "timeboxed_swarm");
}));
