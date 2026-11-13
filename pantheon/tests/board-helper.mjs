import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openBoard } from "../src/board/index.mjs";
import { publish } from "../src/board/dag.mjs";
import { merge } from "../src/board/merge.mjs";

/**
 * Async-safe temp board. The sync form of this helper (try { return fn() } finally { rm })
 * removes the directory when an async fn's PROMISE is created, so every await in the test then
 * runs against a deleted tree -- a defect this project already paid for once.
 */
export async function withBoard(fn) {
  const root = mkdtempSync(join(tmpdir(), "pantheon-board-"));
  try { return await fn(openBoard(root), root); }
  finally { rmSync(root, { recursive: true, force: true }); }
}

export const HUMAN = { vendor: "human" };
export const CONTROLLER = { vendor: "controller" };
export const seat = (vendor, mode, id = `${vendor}-1`, gen = 1) =>
  ({ vendor, seat_id: id, mode, occupancy_gen: gen });

export const TICKET = {
  title: "lease the name, hash the work",
  goal: "replace the seat mutex with a fenced lease",
  repo: "pantheon",
  constraints: ["zero runtime dependencies"],
  forbidden: ["do not elect a vendor as judge"],
  acceptance: [{ type: "tests", cmd: "node --test tests/board-refs.test.mjs", expect: "exit0" }],
};

/**
 * A board with a ticket, a plan and one ready item.
 *
 * Note the shape: the human writes the ticket to the shipping ref, the PLANNER SEAT writes to its
 * own wip branch, and the CONTROLLER merges. A seat cannot move refs/board/* at all, which is the
 * point -- the first version of this helper had the planner publish straight to the shipping ref,
 * the swap was refused, and the board sat in "planning" while the test believed it had a plan.
 */
export async function seeded(board, { itemKey = "withSeatLock", slot = "src/seatLock.ts" } = {}) {
  const ref = "refs/board/lock-helper";
  const planner = seat("anthropic", "plan");
  const wip = `refs/seat/${planner.seat_id}/wip`;
  const t = await publish({ ...board, ref, author: HUMAN, msg: "ticket", entries: [{ kind: "ticket", payload: TICKET }] });
  if (!t.ok) throw new Error(`seeded: ticket publish refused: ${t.why}`);

  const p = await publish({ ...board, ref: wip, author: planner, msg: "plan the lease work",
    entries: [
      { kind: "plan", payload: { steps: [{ item: itemKey, title: "implement the fenced lease" }] } },
      { kind: "work_item", payload: { key: itemKey, title: "implement the fenced lease", state: "ready", artifact_slots: [`artifact:${slot}`], preferred_mode: "work" } },
    ] });
  if (!p.ok) throw new Error(`seeded: plan publish refused: ${p.why}`);

  const m = await merge({ ...board, into: ref, from: wip, author: CONTROLLER, msg: "adopt the plan" });
  if (!m.ok) throw new Error(`seeded: merge refused: ${m.why}`);
  return { ref, wip, itemKey, slot, planner };
}
