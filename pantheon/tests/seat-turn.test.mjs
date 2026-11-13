import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { classify, runTurn } from "../src/seat/turn.mjs";

// Spec §12: quota and hang share the "no output" signal on a non-streaming seat, but they call
// for OPPOSITE actions — wait vs investigate. Conflating them is the live defect in the existing
// stack this project replaces: it reports every timeout as quota-exhausted.
test("a timeout with no output at all is a hang, not quota", () => {
  assert.equal(classify({ timedOut: true, sawOutput: false, stderr: "" }), "hung");
});

test("a timeout AFTER deltas arrived is still a hang, not quota", () => {
  assert.equal(classify({ timedOut: true, sawOutput: true, stderr: "" }), "hung");
});

test("quota is claimed only when the vendor actually says so", () => {
  assert.equal(classify({ exitCode: 1, stderr: "429 rate limit exceeded, retry later" }), "quota_exhausted");
  assert.equal(classify({ exitCode: 1, stderr: "usage limit reached for your plan" }), "quota_exhausted");
});

test("a timeout is NEVER classified as quota even if the word appears", () => {
  const c = classify({ timedOut: true, sawOutput: false, stderr: "checking quota..." });
  assert.equal(c, "hung", "a timeout means investigate; quota means wait");
});

test("a clean exit is ok", () => {
  assert.equal(classify({ exitCode: 0, sawOutput: true, stderr: "" }), "ok");
});

test("a nonzero exit with no recognized signature is an explicit failure", () => {
  assert.equal(classify({ exitCode: 3, stderr: "segfault" }), "failed");
});

function fakeSpawn({ exit = 0, stdout = "", stderr = "", hang = false, capture } = {}) {
  return (cmd, args, opts) => {
    if (capture) capture.push({ cmd, args, opts });
    const cp = new EventEmitter();
    cp.stdout = new EventEmitter(); cp.stderr = new EventEmitter();
    cp.kill = () => { cp.killed = true; };
    if (!hang) setImmediate(() => {
      if (stdout) cp.stdout.emit("data", Buffer.from(stdout));
      if (stderr) cp.stderr.emit("data", Buffer.from(stderr));
      cp.emit("close", exit);
    });
    return cp;
  };
}

test("a successful turn returns provenance with a stdout hash and no content", async () => {
  const r = await runTurn({ vendor: "claude", cwd: "/repo", prompt: "hi", sessionId: "s",
    spawnFn: fakeSpawn({ stdout: '{"session_id":"tok-1","result":"done"}' }) });
  assert.equal(r.ok, true);
  assert.equal(r.outcome, "ok");
  assert.match(r.provenance.stdout_sha256, /^[0-9a-f]{64}$/);
  assert.equal(r.provenance.vendor_session_id, "tok-1", "the id must be CAPTURED, not discarded");
  assert.ok(!("stdout" in r.provenance), "provenance must not carry conversation content");
});

test("a hanging child is killed at the timeout and reported hung", async () => {
  const r = await runTurn({ vendor: "claude", cwd: "/repo", prompt: "hi", sessionId: "s",
    timeoutMs: 30, spawnFn: fakeSpawn({ hang: true }) });
  assert.equal(r.ok, false);
  assert.equal(r.outcome, "hung");
  assert.equal(r.provenance.timed_out, true);
});

test("a quota reply is not ok and is labelled quota_exhausted", async () => {
  const r = await runTurn({ vendor: "grok", cwd: "/repo", prompt: "hi",
    spawnFn: fakeSpawn({ exit: 1, stderr: "429 rate limit exceeded" }) });
  assert.equal(r.outcome, "quota_exhausted");
});

// ---------------------------------------------------------------------------------------------
// Pre-flight ruling, second half: the plan had runTurn append the prompt as a bare trailing argv
// element, which would have produced an argv with no print flag and launched three of four
// vendors interactive. runTurn must pass the prompt INTO buildArgv so each vendor's own
// prompt_flag placement applies. These tests pin that the spawned argv is the built argv.
// ---------------------------------------------------------------------------------------------

test("the spawned argv is exactly what buildArgv produced, prompt included", async () => {
  const capture = [];
  await runTurn({ vendor: "claude", cwd: "/repo", prompt: "say ONE", sessionId: "s",
    spawnFn: fakeSpawn({ stdout: "{}", capture }) });
  const { args } = capture[0];
  assert.equal(args.at(-1), "say ONE", "the prompt must be the final argument");
  assert.equal(args.at(-2), "-p", "and must sit behind this vendor's print flag");
  assert.equal(args.filter(a => a === "say ONE").length, 1, "the prompt must appear exactly once");
});

test("the prompt is not appended a second time outside buildArgv", async () => {
  const capture = [];
  await runTurn({ vendor: "codex", cwd: "/repo", prompt: "say ONE",
    spawnFn: fakeSpawn({ stdout: "{}", capture }) });
  const { args } = capture[0];
  assert.equal(args.filter(a => a === "say ONE").length, 1,
    "a double-append would send the prompt twice and silently change the request");
  assert.equal(args[0], "exec", "the subcommand must still lead");
  assert.ok(!args.includes("-p"), "this vendor takes its prompt positionally");
});

test("a resume turn carries the token and never a minted session id", async () => {
  const capture = [];
  await runTurn({ vendor: "claude", cwd: "/repo", prompt: "next", resumeToken: "tok-9",
    spawnFn: fakeSpawn({ stdout: "{}", capture }) });
  const { args } = capture[0];
  assert.ok(args.includes("--resume") && args.includes("tok-9"));
  assert.ok(!args.includes("--session-id"), "a resume must not also mint a fresh id");
});

test("the child is spawned in the seat's cwd with stdin closed", async () => {
  const capture = [];
  await runTurn({ vendor: "claude", cwd: "/repo/x", prompt: "p", sessionId: "s",
    spawnFn: fakeSpawn({ stdout: "{}", capture }) });
  assert.equal(capture[0].opts.cwd, "/repo/x");
  assert.deepEqual(capture[0].opts.stdio, ["ignore", "pipe", "pipe"],
    "stdin is closed: a warm seat takes its whole turn from argv, and an open stdin would let a " +
    "vendor block waiting for input we never send");
});

test("a vendor id arriving as conversation_id is captured too", async () => {
  const r = await runTurn({ vendor: "agy", cwd: "/repo", prompt: "p",
    spawnFn: fakeSpawn({ stdout: '{"conversation_id":"conv-7","response":"ok"}' }) });
  assert.equal(r.provenance.vendor_session_id, "conv-7");
});

// Replaces a prior version of this test whose comment named a "store reader" that resolves a
// null id - no such component exists anywhere in this codebase. The real contract is
// session_id_source: when neither the vendor nor the caller supplied an id, the field says
// "none" explicitly, rather than leaving a bare null for some other layer to silently reinterpret.
test("no id anywhere and none supplied: session_id_source is \"none\", not a silent guess", async () => {
  const r = await runTurn({ vendor: "grok", cwd: "/repo", prompt: "p",
    spawnFn: fakeSpawn({ stdout: '{"type":"text"}\n{"type":"end"}' }) });
  assert.equal(r.provenance.vendor_session_id, null);
  assert.equal(r.provenance.session_id_source, "none",
    "neither the vendor nor the caller supplied an id - the field must say so explicitly");
  assert.equal(r.outcome, "ok");
});

// ---------------------------------------------------------------------------------------------
// NDJSON id capture: two of four vendors (grok --output-format streaming-json, codex --json)
// declare NDJSON, not a single envelope. A whole-stdout JSON.parse never finds an id on either,
// so nothing ever learned their conversation id and neither could ever be resumed.
// ---------------------------------------------------------------------------------------------

test("an id arriving several lines into an NDJSON stream is still found", async () => {
  const r = await runTurn({ vendor: "grok", cwd: "/repo", prompt: "p",
    spawnFn: fakeSpawn({ stdout: '{"type":"start"}\n{"session_id":"tok-42"}\n{"type":"end"}\n' }) });
  assert.equal(r.provenance.vendor_session_id, "tok-42",
    "the id must be found even though the FIRST line carries none");
  assert.equal(r.provenance.session_id_source, "vendor");
});

test("a torn final line in an NDJSON stream does not block an id found earlier", async () => {
  const r = await runTurn({ vendor: "codex", cwd: "/repo", prompt: "p",
    spawnFn: fakeSpawn({ stdout: '{"session_id":"tok-torn"}\n{"type":"delta","text":"partial' }) });
  assert.equal(r.provenance.vendor_session_id, "tok-torn",
    "a half-written last line is routine on a live stream and must never be fatal");
  assert.equal(r.outcome, "ok");
});

test("a single JSON envelope still yields session_id_source \"vendor\" (unchanged behaviour)", async () => {
  const r = await runTurn({ vendor: "claude", cwd: "/repo", prompt: "p",
    spawnFn: fakeSpawn({ stdout: '{"session_id":"tok-1"}' }) });
  assert.equal(r.provenance.vendor_session_id, "tok-1");
  assert.equal(r.provenance.session_id_source, "vendor");
});

// ---------------------------------------------------------------------------------------------
// supplied_session_id / session_id_source: the id we mint ourselves (passed to buildArgv as
// sessionId) must survive even when the vendor tells us nothing - otherwise a caller loses the
// address it just used to launch the turn. But a vendor-confirmed id always outranks our own
// guess, the same provenance-rank shape this project already applies elsewhere.
// ---------------------------------------------------------------------------------------------

test("with no vendor id at all, the supplied id is reported and its source is marked", async () => {
  const r = await runTurn({ vendor: "grok", cwd: "/repo", prompt: "p", sessionId: "minted-1",
    spawnFn: fakeSpawn({ stdout: '{"type":"start"}\n{"type":"end"}\n' }) });
  assert.equal(r.provenance.vendor_session_id, "minted-1",
    "the id we minted must not be lost just because the vendor said nothing");
  assert.equal(r.provenance.session_id_source, "supplied");
  assert.equal(r.provenance.supplied_session_id, "minted-1");
});

test("a vendor id always wins over a merely supplied one, and both are recorded", async () => {
  const r = await runTurn({ vendor: "claude", cwd: "/repo", prompt: "p", sessionId: "minted-2",
    spawnFn: fakeSpawn({ stdout: '{"session_id":"vendor-9"}' }) });
  assert.equal(r.provenance.vendor_session_id, "vendor-9", "the vendor's own confirmation wins");
  assert.equal(r.provenance.session_id_source, "vendor");
  assert.equal(r.provenance.supplied_session_id, "minted-2",
    "the id we minted is still recorded so the divergence from the vendor's is visible, not lost");
});

// ---------------------------------------------------------------------------------------------
// Found while probing the implementation, not specified by the plan: provenance.command joined
// the raw argv, which contains the prompt. Provenance is what gets written to the store, the
// event log and the live view, so that leaked conversation content into all three — against the
// project's standing rule of hashes, counts, roles and lengths only. The argv SHAPE is the real
// diagnostic and is kept; the prompt is replaced by its hash and byte length.
// ---------------------------------------------------------------------------------------------

test("provenance never carries the prompt text, anywhere in the object", async () => {
  const secret = "SECRET-PROMPT-TEXT-do-not-log-me";
  const r = await runTurn({ vendor: "claude", cwd: "/repo", prompt: secret, sessionId: "s",
    spawnFn: fakeSpawn({ stdout: "{}" }) });
  const serialized = JSON.stringify(r.provenance);
  assert.ok(!serialized.includes(secret),
    `provenance leaked the prompt: ${serialized}`);
});

// The prior version of this leak assertion used a fixture with empty stderr, so stderr_tail was
// always "" and the assertion passed vacuously - it never actually exercised the field it claimed
// to check. Populate stderr with real (non-secret) content so the assertion means something.
test("provenance never carries the prompt text even when stderr is non-empty", async () => {
  const secret = "SECRET-PROMPT-STDERR-CHECK-do-not-log-me";
  const r = await runTurn({ vendor: "claude", cwd: "/repo", prompt: secret, sessionId: "s",
    spawnFn: fakeSpawn({ stdout: "{}", stderr: "warning: approaching context limit\n" }) });
  assert.ok(r.provenance.stderr_tail.length > 0,
    "the fixture must actually populate the field being asserted about");
  const serialized = JSON.stringify(r.provenance);
  assert.ok(!serialized.includes(secret), `provenance leaked the prompt: ${serialized}`);
});

test("the recorded command keeps the argv shape and redacts only the prompt", async () => {
  const r = await runTurn({ vendor: "claude", cwd: "/repo", prompt: "say ONE", sessionId: "sid-1",
    spawnFn: fakeSpawn({ stdout: "{}" }) });
  const c = r.provenance.command;
  assert.ok(c.startsWith("claude "), "the binary must still be visible");
  assert.ok(c.includes("--session-id sid-1"), "flags and their values stay legible for diagnosis");
  assert.ok(c.includes("--output-format json"));
  assert.ok(c.includes("-p "), "the print flag must remain visible — its absence was a real bug");
  assert.match(c, /<prompt:sha256:[0-9a-f]{12}:7B>/,
    "the prompt is replaced by its hash and byte length, not merely removed");
});

test("prompt_sha256 is recorded so a turn can be tied to its prompt without storing it", async () => {
  const a = await runTurn({ vendor: "claude", cwd: "/repo", prompt: "same", sessionId: "s",
    spawnFn: fakeSpawn({ stdout: "{}" }) });
  const b = await runTurn({ vendor: "claude", cwd: "/repo", prompt: "same", sessionId: "s",
    spawnFn: fakeSpawn({ stdout: "{}" }) });
  const c = await runTurn({ vendor: "claude", cwd: "/repo", prompt: "different", sessionId: "s",
    spawnFn: fakeSpawn({ stdout: "{}" }) });
  assert.match(a.provenance.prompt_sha256, /^[0-9a-f]{64}$/);
  assert.equal(a.provenance.prompt_sha256, b.provenance.prompt_sha256);
  assert.notEqual(a.provenance.prompt_sha256, c.provenance.prompt_sha256);
});

test("an absent prompt does not produce a redaction marker or a bogus hash", async () => {
  const r = await runTurn({ vendor: "claude", cwd: "/repo", sessionId: "s",
    spawnFn: fakeSpawn({ stdout: "{}" }) });
  assert.ok(!r.provenance.command.includes("<prompt:"), "nothing to redact, so no marker");
  assert.equal(r.provenance.prompt_bytes, 0);
});

// ---------------------------------------------------------------------------------------------
// The leak that survived its own fix. The earlier "provenance never carries the prompt text"
// assertion passed while stderr_tail carried the whole prompt, because its fixture set only
// stdout. The controller then fixed this exact defect in a DIFFERENT codebase and left it standing
// here — and the brief for this task explicitly said "beyond the existing truncated stderr_tail",
// grandfathering it in the instructions. Every case below populates stderr.
// ---------------------------------------------------------------------------------------------

test("stderr_tail does not carry the prompt", async () => {
  const secret = "SECRET-CANARY-analyse-the-quarterly-filings";
  const r = await runTurn({ vendor: "claude", cwd: "/repo", prompt: secret, sessionId: "s",
    spawnFn: fakeSpawn({ stdout: "{}", stderr: `fatal: upstream rejected while handling prompt: ${secret}\n` }) });
  assert.ok(r.provenance.stderr_tail.length > 0,
    "the fixture must actually populate stderr, or every assertion below is vacuous");
  assert.ok(!r.provenance.stderr_tail.includes(secret), `stderr_tail leaked: ${r.provenance.stderr_tail}`);
  assert.ok(!JSON.stringify(r.provenance).includes(secret), "no field of provenance may carry it");
  assert.ok(r.provenance.stderr_tail.includes("upstream rejected"),
    "the diagnostic must survive: the failure taxonomy reads this text to tell quota from a hang");
  assert.match(r.provenance.stderr_tail, /<prompt:sha256:[0-9a-f]{12}:\d+B>/);
});

test("a quota signature survives redaction", async () => {
  const secret = "SECRET-CANARY-analyse-the-quarterly-filings";
  const r = await runTurn({ vendor: "grok", cwd: "/repo", prompt: secret,
    spawnFn: fakeSpawn({ exit: 1, stderr: `429 rate limit exceeded handling prompt: ${secret}\n` }) });
  assert.equal(r.outcome, "quota_exhausted", "classification must still see its signature");
  assert.ok(!r.provenance.stderr_tail.includes(secret));
});

test("a short prompt is not redacted, by design", async () => {
  const r = await runTurn({ vendor: "claude", cwd: "/repo", prompt: "q", sessionId: "s",
    spawnFn: fakeSpawn({ stdout: "{}", stderr: "queue quota q\n" }) });
  assert.equal(r.provenance.stderr_tail.trim(), "queue quota q",
    "a global replace of a 1-char token would shred the diagnostic and protect nothing");
});
