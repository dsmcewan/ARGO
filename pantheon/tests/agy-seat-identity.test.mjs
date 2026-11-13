// Human-authored oracle for ticket agySeatIdentity ("the Antigravity seat never records what ran it").
// Written BEFORE the seat changes scripts/agy-seat.py; baselined failing against the script as it
// stood at 3837eda (no --identity flag, an unguarded module-level SDK import that exits 1 with a
// traceback on any interpreter lacking the SDK). It pins the shape a run reviewer needs: which
// interpreter and which SDK distribution/version executed the turn, attested from what is actually
// loaded, and answerable as a preflight without the SDK or a credential.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir, tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(REPO, "scripts", "agy-seat.py");
const SYSTEM_PYTHON = "/usr/bin/python3";
// The same default src/board/run-item.mjs dispatches with, so the venv case exercises the real seat.
const VENV_PYTHON = process.env.PANTHEON_AGY_PYTHON
  ?? join(homedir(), "Projects", "agentic-pipeline", "sdk", ".venv-antigravity", "bin", "python");

// No credential in the child: --identity must not need one, and a turn attempt must not find one.
const ENV = { ...process.env, GEMINI_API_KEY: "" };

function run(python, args, input = "") {
  return spawnSync(python, [SCRIPT, ...args], { encoding: "utf8", timeout: 30_000, env: ENV, input });
}
function lastJsonLine(stdout) {
  const line = String(stdout ?? "").trim().split("\n").filter(Boolean).pop();
  assert.ok(line, "no stdout line to parse");
  return JSON.parse(line);
}
function assertIdentityShape(id) {
  assert.match(id.python, /^\d+\.\d+\.\d+$/, "python must be X.Y.Z");
  assert.equal(typeof id.executable, "string");
  assert.ok(existsSync(id.executable), `executable must exist: ${id.executable}`);
  assert.equal(id.sdk.module, "google.antigravity");
  assert.ok(["installed", "absent"].includes(id.sdk.status), `unexpected status ${id.sdk.status}`);
  if (id.sdk.status === "absent") {
    assert.equal(typeof id.sdk.error, "string");
    assert.ok(id.sdk.error.length > 0, "absent must say why");
    assert.equal(id.sdk.version, null);
    assert.equal(id.sdk.distribution, null);
    assert.equal(id.sdk.path, null);
  } else {
    assert.equal("error" in id.sdk, false, "error key must be absent when installed");
    assert.equal(typeof id.sdk.version, "string");
    assert.ok(id.sdk.version.length > 0, "installed must carry a version");
    assert.equal(typeof id.sdk.path, "string");
    assert.ok(existsSync(id.sdk.path), `sdk path must exist: ${id.sdk.path}`);
    // distribution may be null only for an install no distribution owns (e.g. a bare sys.path drop-in)
    if (id.sdk.distribution !== null) assert.equal(typeof id.sdk.distribution, "string");
  }
}

let probesRun = 0;

test("--identity answers on the system interpreter: exit 0, one JSON line, no SDK or credential needed", () => {
  assert.ok(existsSync(SYSTEM_PYTHON), `${SYSTEM_PYTHON} is required by this oracle`);
  const r = run(SYSTEM_PYTHON, ["--identity"]);
  assert.equal(r.status, 0, `exit ${r.status}; stderr: ${(r.stderr ?? "").slice(-400)}`);
  const lines = r.stdout.trim().split("\n").filter(Boolean);
  assert.equal(lines.length, 1, "exactly one stdout line");
  const id = JSON.parse(lines[0]);
  assertIdentityShape(id);
  probesRun++;
});

test("--identity wins over every other argument and never requires them", () => {
  // No --role/--workspace/--brief/--out: argparse must not get a chance to reject the call.
  const r = run(SYSTEM_PYTHON, ["--model", "whatever", "--identity"]);
  assert.equal(r.status, 0, `exit ${r.status}; stderr: ${(r.stderr ?? "").slice(-400)}`);
  assertIdentityShape(lastJsonLine(r.stdout));
  probesRun++;
});

test("a turn attempted where the SDK is absent fails as one JSON line with exit 3 and the same runtime object", () => {
  const idr = run(SYSTEM_PYTHON, ["--identity"]);
  assert.equal(idr.status, 0);
  const id = lastJsonLine(idr.stdout);
  if (id.sdk.status !== "absent") {
    // A system interpreter that carries the SDK would proceed to a real turn; that is not this oracle's job.
    console.log("system interpreter has the SDK installed; SDK-absent path not exercised here");
    return;
  }
  const out = mkdtempSync(join(tmpdir(), "agy-identity-"));
  const r = run(SYSTEM_PYTHON, ["--role", "reviewer", "--workspace", REPO, "--repo", REPO, "--model", "x",
    "--brief", "-", "--out", out], "");
  assert.equal(r.status, 3, `expected the harness-error code; got ${r.status}; stderr tail: ${(r.stderr ?? "").slice(-400)}`);
  assert.doesNotMatch(r.stderr ?? "", /Traceback \(most recent call last\)/, "no traceback: the failure is a reported line");
  const res = lastJsonLine(r.stdout);
  assert.equal(res.ok, false);
  assert.equal(typeof res.error, "string");
  assert.ok(res.error.length > 0);
  assert.deepEqual(res.runtime, id, "the turn's runtime field is the same object --identity reports");
  probesRun++;
});

test("when the runner's venv interpreter exists, the installed identity names the SDK's version by file ownership", () => {
  if (!existsSync(VENV_PYTHON)) {
    console.log(`venv interpreter absent at ${VENV_PYTHON}; installed-SDK case not exercised on this machine`);
    return;
  }
  const r = run(VENV_PYTHON, ["--identity"]);
  assert.equal(r.status, 0, `exit ${r.status}; stderr: ${(r.stderr ?? "").slice(-400)}`);
  const id = lastJsonLine(r.stdout);
  assertIdentityShape(id);
  assert.equal(id.sdk.status, "installed", "the runner's venv must carry the SDK");
  assert.equal(typeof id.sdk.distribution, "string", "a pip-installed SDK has an owning distribution");
  assert.ok(id.sdk.path.startsWith(dirname(dirname(id.executable))) || id.sdk.path.includes("site-packages"),
    "the module path should live under the venv that answered");
  probesRun++;
});

test("the oracle actually probed something", () => {
  assert.ok(probesRun >= 2, `only ${probesRun} probe(s) reached an assertion; a suite that skips everything proves nothing`);
});
