// Human-authored oracle for open item 2 ("agy has no adapter"). Written BEFORE the seat wrote the change,
// baselined failing against src/role/seating.mjs as it stood on 2026-09-27 (NOT_SEATED.agy present, no
// AGY_SEAT export). It pins the shape the docs and the runner rely on: the Antigravity seat is Google's
// lab, reachable on two lanes whose files exist in this repository.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as seating from "../src/role/seating.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");

test("agy is no longer NOT_SEATED: AGY_SEAT names two live lanes and their files exist", () => {
  assert.equal(seating.NOT_SEATED.agy, undefined, "NOT_SEATED.agy is still declared");
  // NOT_SEATED is empty as of 2026-09-28: its last entry claimed claude-fable-5-1 could not be
  // seated, which the operator's planner seating contradicted. This assertion used to require that
  // entry to survive; what actually matters here is agy's absence, which is checked above.
  const s = seating.AGY_SEAT;
  assert.ok(s && typeof s === "object", "AGY_SEAT export missing");
  assert.equal(s.lab, "google");
  assert.match(s.pool, /one (subscription|pool)/i, "the one-pool note must survive the move");

  assert.equal(s.lanes.sdk.script, "scripts/agy-seat.py");
  assert.ok(existsSync(join(REPO, s.lanes.sdk.script)), "sdk lane script must exist");
  assert.equal(s.lanes.sdk.venv, ".venv-antigravity");
  assert.equal(s.lanes.sdk.credential, "GEMINI_API_KEY");

  assert.equal(s.lanes.cli.cmd, "agy");
  assert.equal(s.lanes.cli.dir, ".agents/agents");
  // pantheon-planner and pantheon-implementer added 2026-09-29 -- see AGY_SEAT.lanes.cli.why for
  // why these two are forced onto this lane rather than merely opting in like the other three.
  assert.deepEqual([...s.lanes.cli.agents].sort(),
    ["pantheon-fact-checker", "pantheon-implementer", "pantheon-planner", "pantheon-reviewer", "pantheon-scout"]);
  for (const a of s.lanes.cli.agents) {
    assert.ok(existsSync(join(REPO, s.lanes.cli.dir, a, "agent.md")), `${a}: agent.md missing under ${s.lanes.cli.dir}`);
  }
});

test("the seat's tool posture is declared, and is read-only plus a shell", () => {
  const s = seating.AGY_SEAT;
  assert.deepEqual([...s.tools].sort(), ["find_file", "list_directory", "run_command", "search_directory", "view_file"]);
  assert.equal(s.writes, false, "the Antigravity seat never edits the artifact under review");
});
