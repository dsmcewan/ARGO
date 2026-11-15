// The README's no-model demo must run to completion. It once stopped at "offer it": the worker held a
// lease on item:withSeatLock but did not present it on the publish that moved that item, and the ref
// fence (correctly) refused the write. The suite stayed green because nothing executed the script.
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const script = fileURLToPath(new URL("../scripts/board-run.mjs", import.meta.url));

test("scripts/board-run.mjs drives the ticket from intake to a shipped, accepted item with no model in the loop", async () => {
  // The test owns the board directory, so a failing run leaves nothing behind in the OS temp dir.
  const dir = mkdtempSync(join(tmpdir(), "pantheon-run-script-"));
  try {
    const { stdout } = await run(process.execPath, [script, "--dir", dir], { timeout: 60_000 });
    const plain = stdout.replace(/\x1b\[[0-9;]*m/g, "");
    assert.match(plain, /^offered for review\s+—/m, "the worker's offer must land");
    assert.match(plain, /^integrate\s+—\s+controller/m, "the controller must schedule integration");
    assert.match(plain, /^\s+shipped\s+artifact:src\/seat\/lock\.mjs/m, "ship() must pass every gate and land the artifact");
    assert.doesNotMatch(plain, /REFUSED at/, "no gate may refuse the canned, correct change");
    assert.match(plain, /^integrated\s+—\s+accepted/m, "the board must end accepted");

    // Reaching the end is not enough: releasing the lease first and offering with none also reaches it,
    // and lands an unfenced write. The offer must have moved the ref UNDER the worker's lease.
    const moves = readFileSync(join(dir, "runtime", "refs.log"), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    const offers = moves.filter(m => m.msg === "offer it");
    assert.equal(offers.length, 1, "exactly one offer is published");
    assert.equal(offers[0].lease_gen, 1, "the offer must present the lease the worker holds, not be published without one");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
