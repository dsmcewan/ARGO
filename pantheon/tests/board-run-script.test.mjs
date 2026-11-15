// The README's no-model demo must run to completion. It once stopped at "offer it": the worker held a
// lease on item:withSeatLock but did not present it on the publish that moved that item, and the ref
// fence (correctly) refused the write. The suite stayed green because nothing executed the script.
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const script = new URL("../scripts/board-run.mjs", import.meta.url).pathname;

test("scripts/board-run.mjs drives the ticket from intake to a shipped, accepted item with no model in the loop", async () => {
  const { stdout } = await run(process.execPath, [script], { timeout: 60_000 });
  const plain = stdout.replace(/\x1b\[[0-9;]*m/g, "");
  assert.match(plain, /^offered for review\s+—/m, "the worker's offer must land");
  assert.match(plain, /^integrate\s+—\s+controller/m, "the controller must schedule integration");
  assert.match(plain, /^\s+shipped\s+artifact:src\/seat\/lock\.mjs/m, "ship() must pass every gate and land the artifact");
  assert.doesNotMatch(plain, /REFUSED at/, "no gate may refuse the canned, correct change");
  assert.match(plain, /^integrated\s+—\s+accepted/m, "the board must end accepted");
});
