// Human-authored oracle for ticket conformParallel ("conform sums four CLI startups against a fixed budget").
// Written BEFORE the seat changes bin/pantheon.mjs; baselined failing against the verb as it stood at
// 3837eda, which awaits each vendor's --help probe in turn. Four fake vendor binaries that each sleep
// two seconds make the difference unmistakable: sequential is over eight seconds, concurrent is about two.
// The fakes carry every flag src/seat/argv.mjs declares for their vendor, so the only variable is time.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { VENDORS } from "../src/seat/argv.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(REPO, "bin", "pantheon.mjs");
const ORDER = Object.keys(VENDORS);
const SYSTEM_PATH = "/usr/bin:/bin"; // for `sleep`; nothing real answers a vendor name here

// Help text that lists every declared flag as its own token, in the shapes real help uses.
function helpFor(vendor) {
  const v = VENDORS[vendor];
  const flags = [v.resume_flag, v.session_id_flag, v.model_flag, v.effort_flag, v.cwd_flag, v.prompt_flag]
    .filter(f => typeof f === "string");
  return ["Usage: " + vendor + " [options]", "", "Options:", ...flags.map(f => `  ${f} <value>   ${vendor} option`), ""].join("\n");
}

// A fake bin dir. `delays` maps vendor -> seconds to sleep; `omit` lists vendors that get NO executable
// (absent from PATH); `dropFlag` maps vendor -> a declared flag to leave out of its help.
function fakeBin({ delays = {}, omit = [], dropFlag = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "pantheon-conform-"));
  const bin = join(dir, "bin"); mkdirSync(bin);
  for (const vendor of ORDER) {
    if (omit.includes(vendor)) continue;
    let help = helpFor(vendor);
    if (dropFlag[vendor]) help = help.split("\n").filter(l => !l.trim().startsWith(dropFlag[vendor] + " ")).join("\n");
    const delay = delays[vendor] ?? 0;
    const script = `#!/bin/sh\n${delay ? `sleep ${delay}\n` : ""}cat <<'HELP'\n${help}\nHELP\n`;
    writeFileSync(join(bin, VENDORS[vendor].cmd), script, { mode: 0o755 });
  }
  return { dir, bin };
}

function conform(bin, { timeoutMs = 30_000 } = {}) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [CLI, "conform"], {
    cwd: REPO, encoding: "utf8", timeout: timeoutMs,
    env: { PATH: `${bin}:${SYSTEM_PATH}`, HOME: join(bin, "..", "home"), PANTHEON_HOME: join(bin, "..", "ph") },
  });
  return { status: r.status, signal: r.signal, stdout: r.stdout ?? "", stderr: r.stderr ?? "", ms: Date.now() - t0 };
}

function rowsOf(stdout) {
  return stdout.split("\n").filter(l => /^(OK|FAIL)\s/.test(l));
}
function vendorOf(row) { return row.split(/\s+/)[1]; }

test("four vendors that each take two seconds are probed together: exit 0 in under six seconds, rows in table order, each with its elapsed ms", () => {
  const { dir, bin } = fakeBin({ delays: { claude: 2, codex: 2, grok: 2, agy: 2 } });
  try {
    const r = conform(bin);
    assert.equal(r.status, 0, `exit ${r.status ?? r.signal}; stderr: ${r.stderr.slice(-400)}\nstdout: ${r.stdout}`);
    const rows = rowsOf(r.stdout);
    assert.deepEqual(rows.map(vendorOf), ORDER, `rows must follow the table order:\n${r.stdout}`);
    for (const row of rows) {
      assert.match(row, /^OK\s/, `every fake conforms: ${row}`);
      assert.match(row, /\(\d+ checked: /, `the checked segment survives: ${row}`);
      assert.match(row, /\b\d+ms\b/, `each row carries its probe's elapsed ms: ${row}`);
    }
    assert.ok(r.ms < 6000, `sequential probing would take 8s+; this took ${r.ms}ms`);
    assert.ok(r.ms >= 1900, `the fakes really slept: ${r.ms}ms`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("one slow vendor does not hold the report past its own time, and finishes-first does not reorder the rows", () => {
  // grok is the slow one; it would finish last. Rows must still print claude, codex, grok, agy.
  const { dir, bin } = fakeBin({ delays: { grok: 3 } });
  try {
    const r = conform(bin);
    assert.equal(r.status, 0, `exit ${r.status ?? r.signal}; stdout: ${r.stdout}`);
    assert.deepEqual(rowsOf(r.stdout).map(vendorOf), ORDER);
    assert.ok(r.ms < 6000 && r.ms >= 2900, `expected about three seconds, got ${r.ms}ms`);
    const grokRow = rowsOf(r.stdout).find(l => vendorOf(l) === "grok");
    const ms = Number(/(\d+)ms\b/.exec(grokRow)?.[1]);
    assert.ok(ms >= 2900, `grok's own row shows its 3s probe: ${grokRow}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a non-conforming vendor fails the verb with exit 1 and its FAIL row, while the other three rows still print OK", () => {
  const { dir, bin } = fakeBin({ dropFlag: { agy: VENDORS.agy.model_flag } });
  try {
    const r = conform(bin);
    assert.equal(r.status, 1, `exit ${r.status ?? r.signal}; stdout: ${r.stdout}`);
    const rows = rowsOf(r.stdout);
    assert.deepEqual(rows.map(vendorOf), ORDER);
    assert.match(rows.find(l => vendorOf(l) === "agy"), /^FAIL\s/);
    for (const v of ORDER.filter(v => v !== "agy")) assert.match(rows.find(l => vendorOf(l) === v), /^OK\s/);
    assert.match(r.stdout, new RegExp(`declares ${VENDORS.agy.model_flag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} but`), "the mismatch line survives");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a vendor absent from PATH is reported as FAIL without the verb throwing, and the others are still reported", () => {
  const { dir, bin } = fakeBin({ omit: ["codex"] });
  try {
    const r = conform(bin);
    assert.equal(r.status, 1, `exit ${r.status ?? r.signal}; stdout: ${r.stdout}\nstderr: ${r.stderr}`);
    assert.doesNotMatch(r.stderr, /Error:|at .*\.mjs:\d+/, "no uncaught error on stderr");
    const rows = rowsOf(r.stdout);
    assert.deepEqual(rows.map(vendorOf), ORDER);
    assert.match(rows.find(l => vendorOf(l) === "codex"), /^FAIL\s/);
    assert.match(r.stdout, /could not run "codex --help"/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
