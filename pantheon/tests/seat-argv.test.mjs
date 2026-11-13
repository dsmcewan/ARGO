import { test } from "node:test";
import assert from "node:assert/strict";
import { buildArgv, VENDORS, bypassFragment } from "../src/seat/argv.mjs";

const BYPASS = ["--dangerously-skip-permissions", "danger-full-access",
                "--dangerously-bypass-approvals-and-sandbox", "--always-approve", "--yolo"];

test("every declared vendor builds a fresh argv with no bypass flag", () => {
  for (const vendor of Object.keys(VENDORS)) {
    const { cmd, args } = buildArgv({ vendor, cwd: "/repo", sessionId: "11111111-1111-4111-8111-111111111111" });
    assert.equal(typeof cmd, "string");
    assert.ok(args.every(a => typeof a === "string"), `${vendor}: non-string in argv`);
    for (const b of BYPASS) {
      assert.ok(!args.includes(b), `${vendor}: argv must not carry ${b} by default`);
    }
  }
});

// Review Focus 3: argv is an array, so a path with spaces must remain ONE argument.
test("a cwd with spaces and quotes stays a single argument", () => {
  const cwd = `/home/x/my repo's "dir"`;
  for (const vendor of Object.keys(VENDORS)) {
    const { args } = buildArgv({ vendor, cwd, sessionId: "s" });
    if (VENDORS[vendor].cwd_flag) {
      const hits = args.filter(a => a === cwd);
      assert.equal(hits.length, 1, `${vendor}: cwd must appear exactly once, unsplit`);
      assert.equal(args[args.indexOf(VENDORS[vendor].cwd_flag) + 1], cwd,
        `${vendor}: cwd must be the single argument after its flag`);
    }
    assert.ok(!args.some(a => a !== cwd && a.includes("my repo")),
      `${vendor}: a fragment of the cwd leaked into another argument`);
  }
});

test("resume uses the vendor's own resume flag and carries the token", () => {
  const cases = {
    claude: ["--resume", "tok"],
    codex:  ["resume", "tok"],
    grok:   ["--resume", "tok"],
    agy:    ["--conversation", "tok"],
  };
  for (const [vendor, [flag, tok]] of Object.entries(cases)) {
    const { args } = buildArgv({ vendor, cwd: "/repo", resumeToken: tok });
    assert.ok(args.includes(flag), `${vendor}: expected ${flag}`);
    assert.ok(args.includes(tok), `${vendor}: expected the token in argv`);
  }
});

test("a fresh launch supplies our own session id where the vendor accepts one", () => {
  const { args } = buildArgv({ vendor: "claude", cwd: "/repo", sessionId: "abc" });
  assert.equal(args[args.indexOf("--session-id") + 1], "abc",
    "we mint the id so the seat has an address that survives restart");
});

test("resume and sessionId together is refused, not silently resolved", () => {
  assert.throws(() => buildArgv({ vendor: "claude", cwd: "/repo", sessionId: "a", resumeToken: "b" }),
    /both sessionId and resumeToken/);
});

test("an unknown vendor throws rather than producing a guess", () => {
  assert.throws(() => buildArgv({ vendor: "nope", cwd: "/repo" }), /unknown vendor/);
});

test("bypass is opt-in per vendor, exact-match on 1", () => {
  assert.deepEqual(bypassFragment("agy", {}), []);
  assert.deepEqual(bypassFragment("agy", { PANTHEON_AGY_BYPASS: "0" }), []);
  assert.deepEqual(bypassFragment("agy", { PANTHEON_AGY_BYPASS: "false" }), []);
  assert.deepEqual(bypassFragment("agy", { PANTHEON_AGY_BYPASS: "1" }), ["--dangerously-skip-permissions"]);
  assert.deepEqual(bypassFragment("claude", { PANTHEON_AGY_BYPASS: "1" }), [],
    "an agy opt-in must not arm another vendor");
});

test("the capability table declares every field the spec requires", () => {
  for (const [vendor, c] of Object.entries(VENDORS)) {
    for (const f of ["resume", "stream_in", "stream_out", "attach", "auth", "sandbox"]) {
      assert.ok(f in c, `${vendor}: capability table missing "${f}"`);
    }
    assert.equal(c.auth, "oauth", `${vendor}: every seat rides OAuth (evidence L1)`);
    assert.ok(Array.isArray(c.sandbox), `${vendor}: sandbox must be an explicit argv fragment`);
  }
});

// ---------------------------------------------------------------------------------------------
// Pre-flight ruling (see the SDD ledger): the plan's table omitted each vendor's print/headless
// flag and Task 5 appended the prompt as a bare trailing element. Without the flag, the three
// flag-based vendors launch INTERACTIVE, get killed at the 300s timeout, and are reported "hung"
// -- a missing flag presenting as a supervision bug. These tests pin the corrected contract.
// ---------------------------------------------------------------------------------------------

test("every vendor declares a prompt_flag key, even when its value is null", () => {
  for (const [vendor, c] of Object.entries(VENDORS)) {
    assert.ok("prompt_flag" in c,
      `${vendor}: prompt_flag must be declared explicitly, so a null is a decision and not an omission`);
  }
});

test("a prompt is placed after its vendor's print flag, last in argv", () => {
  for (const [vendor, c] of Object.entries(VENDORS)) {
    const { args } = buildArgv({ vendor, cwd: "/repo", prompt: "do the thing" });
    assert.equal(args.at(-1), "do the thing", `${vendor}: the prompt must be the final argument`);
    if (c.prompt_flag) {
      assert.equal(args.at(-2), c.prompt_flag,
        `${vendor}: the prompt must be immediately preceded by ${c.prompt_flag}`);
    }
  }
});

test("the vendor with a subcommand takes its prompt positionally, with no print flag", () => {
  assert.equal(VENDORS.codex.prompt_flag, null,
    "this vendor's prompt is positional after its subcommand");
  const { args } = buildArgv({ vendor: "codex", cwd: "/repo", prompt: "do the thing" });
  assert.equal(args.at(-1), "do the thing");
  assert.ok(!args.includes("-p"), "no print flag belongs in this vendor's argv");
  assert.equal(args[0], "exec", "the subcommand must still come first");
});

test("omitting the prompt omits the flag too -- no empty trailing argument", () => {
  for (const [vendor, c] of Object.entries(VENDORS)) {
    const { args } = buildArgv({ vendor, cwd: "/repo", sessionId: "s" });
    assert.ok(args.every(a => a !== ""), `${vendor}: empty string in argv`);
    if (c.prompt_flag) {
      assert.ok(!args.includes(c.prompt_flag),
        `${vendor}: the print flag must not appear when there is no prompt to print`);
    }
  }
});

test("a multi-word prompt stays a single argument", () => {
  const prompt = 'reply with "ONE" and nothing else';
  for (const vendor of Object.keys(VENDORS)) {
    const { args } = buildArgv({ vendor, cwd: "/repo", prompt });
    assert.equal(args.filter(a => a === prompt).length, 1,
      `${vendor}: the prompt must appear exactly once, unsplit`);
  }
});

test("the three flag-based vendors use -p, matching their real invocations", () => {
  for (const vendor of ["claude", "grok", "agy"]) {
    assert.equal(VENDORS[vendor].prompt_flag, "-p",
      `${vendor}: evidence B1 records this vendor's real invocation as -p <prompt>`);
  }
});
