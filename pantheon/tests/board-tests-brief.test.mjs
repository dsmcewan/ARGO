// The checker's `tests` mount must be derived from the board, never typed by the caller.
//
// The defect (docs/reviews/2026-09-27-orchestration-rereview-addendum.md, "execution-to-review
// handoff"): scripts/live-ship.mjs executed the produced module and published its real exit into a
// repro, then built the reviewer's prompt with the fixed string "It was run as ${CMD} and exited 0."
// The probe recorded exit 1 in the repro beside "exited 0" in the reviewer's prompt. ship()'s TESTS
// gate read the record and refused, so the consequence was false context to cross-model review, not a
// shipped defect -- but a checker cannot open a MOUNT, so it had no way to know.
//
// These cases drive real board objects (seeded ticket, artifact on the maker's wip, a repro citing
// it) and assert on the brief that a reviewer prompt would carry. The first case IS the addendum's
// repro: with the old fixed string it fails; with a derived brief it passes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { publish, treeSlots } from "../src/board/dag.mjs";
import { boardState, acceptanceStatus, testsBrief } from "../src/board/controller.mjs";
import { promptFor } from "../src/role/roles.mjs";
import { withBoard, seeded, seat, TICKET, CONTROLLER } from "./board-helper.mjs";

const TEST_CMD = TICKET.acceptance[0].cmd;
const maker = seat("openai", "work", "openai-work");

/** A seeded board, an artifact on the maker's wip, and -- when `exit` is given -- a repro citing it. */
async function offered(board, { exit = null, output = "" } = {}) {
  const s = await seeded(board);
  const wip = `refs/seat/${maker.seat_id}/wip`;
  const b = await board.refs.branch({ name: wip, from: s.ref, author: maker });
  assert.equal(b.ok, true, b.why);
  const a = await publish({ ...board, ref: wip, author: maker, msg: "the change",
    entries: [{ kind: "artifact", payload: { slot: s.slot, path: s.slot, rev: 1 }, blob: "export const x = 1;\n" }] });
  assert.equal(a.ok, true, a.why);
  const artifactCid = treeSlots(board.store, a.commit)[`artifact:${s.slot}`];
  if (exit !== null) {
    // The CONTROLLER's run, not the maker's claim: a maker-authored exit 0 is shown in the brief but
    // does not make acceptance ok, so the control case below would read as a self-graded pass.
    const r = await publish({ ...board, ref: wip, author: CONTROLLER, msg: "the suite on rev 1",
      entries: [{ kind: "repro", payload: { cmd: TEST_CMD, exit }, blob: output || "(no output)",
        links: { derived_from: [artifactCid] } }] });
    assert.equal(r.ok, true, r.why);
  }
  const state = boardState({ ...board, ref: s.ref });
  return { ...s, wip, artifactCid, state, from: board.refs.resolve(wip) };
}

test("the addendum's repro: a recorded exit 1 is reported as exit 1, with its output, never as exited 0",
  () => withBoard(async (board) => {
    const o = await offered(board, { exit: 1, output: "Error: boom\n    at file:///worktree/fence-check.mjs:3:7\n" });
    const brief = testsBrief({ store: board.store, state: o.state, artifact: { cid: o.artifactCid }, from: o.from });

    assert.match(brief.text, /exited 1\b/, brief.text);
    assert.match(brief.text, /Error: boom/, "the failure output travels with the brief");
    // THE DEFECT, as an assertion: the old handoff was this exact string regardless of the record.
    assert.doesNotMatch(brief.text, /exited 0/, "a failed run must never be described as exited 0");
    assert.equal(brief.ok, false);
    assert.match(brief.text, new RegExp(`ACCEPTANCE: \`${TEST_CMD.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\` must exit 0`),
      "the brief carries what the ticket demanded, not only what happened");
  }));

test("control: a recorded exit 0 reads as exited 0 and the brief is ok", () => withBoard(async (board) => {
  const o = await offered(board, { exit: 0, output: "# tests 3\n# pass 3\n" });
  const brief = testsBrief({ store: board.store, state: o.state, artifact: { cid: o.artifactCid }, from: o.from });
  assert.match(brief.text, /exited 0\b/, brief.text);
  assert.match(brief.text, /# pass 3/);
  assert.equal(brief.ok, true, brief.text);
}));

test("no run recorded: the brief says so and claims no exit at all", () => withBoard(async (board) => {
  const o = await offered(board);
  const brief = testsBrief({ store: board.store, state: o.state, artifact: { cid: o.artifactCid }, from: o.from });
  assert.match(brief.text, /no run of/, brief.text);
  assert.doesNotMatch(brief.text, /exited \d/, "nothing ran, so nothing exited");
  assert.equal(brief.ok, false);
}));

test("acceptanceStatus rows now carry every citing run, failing ones included", () => withBoard(async (board) => {
  const o = await offered(board, { exit: 1, output: "boom\n" });
  const acc = acceptanceStatus({ store: board.store, state: o.state, artifact: { cid: o.artifactCid }, from: o.from });
  const row = acc.rows.find(r => r.type === "tests");
  assert.equal(row.ok, false);
  assert.equal(row.evidence, null, "`evidence` still names only a pass");
  assert.equal(row.runs.length, 1);
  assert.equal(row.runs[0].exit, 1);
  assert.ok(row.runs[0].excerpt, "the failing run's output blob is reachable from the row");
  assert.equal(board.store.getBlobText(row.runs[0].excerpt), "boom\n");
}));

test("a reviewer prompt built from the brief tells the reviewer what the record says", () => withBoard(async (board) => {
  const o = await offered(board, { exit: 1, output: "AssertionError: expected 1 to equal 2\n" });
  const brief = testsBrief({ store: board.store, state: o.state, artifact: { cid: o.artifactCid }, from: o.from });
  // The same call scripts/live-ship.mjs makes, with the brief in the `tests` slot the old string held.
  const p = promptFor("reviewer", { ticket: TICKET.goal, artifact: "export const x = 1;\n", tests: brief.text },
    "End your reply with a line reading exactly `VERDICT: approve` or `VERDICT: request_changes`.");
  assert.ok(!p.withheld.includes("tests"), "`tests` is a token the reviewer may hold");
  assert.match(p.prompt, /exited 1\b/);
  assert.match(p.prompt, /AssertionError: expected 1 to equal 2/);
  assert.doesNotMatch(p.prompt, /exited 0/);
}));

test("output is bounded and the bound is stated, so a brief cannot become a log", () => withBoard(async (board) => {
  const o = await offered(board, { exit: 1, output: "x".repeat(5000) });
  const brief = testsBrief({ store: board.store, state: o.state, artifact: { cid: o.artifactCid }, from: o.from, maxOutput: 1200 });
  assert.match(brief.text, /3800 more bytes not shown/, brief.text.slice(-200));
  assert.ok(brief.text.length < 1200 + 600, `brief is ${brief.text.length} bytes`);
}));
