import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

// THE DEFECT, 2026-09-27 re-review, completeness critic. node:sqlite was imported at the top of two
// context modules, so every entrypoint that reached them -- bin/pantheon and its acceptance suite
// included -- failed to load on the Node 20 that package.json declared supported (30 failures on 20.20.2).
// Only the agy seat's SQLite store needs it; it now loads on first use. This runs the modules in a Node
// with the builtin DISABLED, which is the closest thing to Node 20 available on a Node 24 box.
const run = promisify(execFile);
const src = new URL("../src", import.meta.url).href;
const PROBE = `
const project = await import("${src}/context/project.mjs");
const locate = await import("${src}/context/locate.mjs");
let named = null;
try { project.projectAgyDb("/nonexistent.db"); } catch (e) { named = e.message; }
process.stdout.write(JSON.stringify({ loaded: Boolean(project.projectTranscript && locate), named }));
`;

test("the context modules load without node:sqlite, and the one function that needs it names the floor", async () => {
  const { stdout } = await run(process.execPath, ["--no-experimental-sqlite", "--input-type=module", "-e", PROBE], { timeout: 30_000 });
  const r = JSON.parse(stdout);
  assert.equal(r.loaded, true);
  assert.match(r.named, /node:sqlite is not available on v\d+.*Node >= 22\.5/);
});

test("with node:sqlite present the same import path still works", async () => {
  const { stdout } = await run(process.execPath, ["--input-type=module", "-e", PROBE], { timeout: 30_000 });
  const r = JSON.parse(stdout);
  assert.equal(r.loaded, true);
  assert.ok(r.named === null || !/not available/.test(r.named), `sqlite present: the error, if any, is about the path, got ${r.named}`);
});
