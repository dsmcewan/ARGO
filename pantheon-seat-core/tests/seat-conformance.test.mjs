import { test } from "node:test";
import assert from "node:assert/strict";
import { conformVendor } from "../src/seat/conformance.mjs";
import { locateStore } from "../src/context/locate.mjs";

const helpWith = flags => async () => flags.join("\n");

// Review Focus 5: a vendor upgrade drops a flag we declared. Conformance must FAIL, not warn.
test("a declared resume flag missing from --help is a mismatch", async () => {
  const r = await conformVendor("claude", { helpFn: helpWith(["--session-id", "--output-format"]) });
  assert.ok(r.mismatches.some(m => m.includes("--resume")),
    "a declared capability that is not observed is a failure, never a warning");
});

test("a vendor whose help carries every declared flag conforms", async () => {
  const r = await conformVendor("claude", {
    helpFn: helpWith(["  -p, --print", "  --resume <id>", "  --session-id <uuid>",
                      "  --model <m>", "  --effort <e>", "  --output-format <f>"]),
  });
  assert.deepEqual(r.mismatches, []);
  assert.ok(r.checked > 0, "a conformance run that checked nothing is not a pass");
});

// The matcher must not accept a short flag because a LONGER flag happens to contain it.
test("a declared short flag is not satisfied by an unrelated longer flag", async () => {
  const r = await conformVendor("claude", {
    helpFn: helpWith(["  --print", "  --permission-mode <m>", "  --resume <id>",
                      "  --session-id <uuid>", "  --model <m>", "  --effort <e>",
                      "  --output-format <f>"]),
  });
  assert.ok(r.mismatches.some(m => m.includes("-p ") || m.includes("declares -p")),
    "-p must NOT be considered present just because --print and --permission-mode are");
});

test("listsFlag matches a flag as its own token, in the shapes real help text uses", async () => {
  const { listsFlag } = await import("../src/seat/conformance.mjs");
  for (const ok of ["  -p, --print", "-p <prompt>", "usage: x [-p] y", "  --resume=<id>",
                    "  --add-dir <dir>", "-p"]) {
    const flag = ok.includes("--resume") ? "--resume" : ok.includes("--add-dir") ? "--add-dir" : "-p";
    assert.ok(listsFlag(ok, flag), `should match ${flag} in ${JSON.stringify(ok)}`);
  }
  for (const no of ["--print", "--permission-mode", "--prompt-interactive", "keep-alive-ping"]) {
    assert.ok(!listsFlag(no, "-p"), `should NOT match -p in ${JSON.stringify(no)}`);
  }
});

test("conformance that could not run the binary reports that, not success", async () => {
  const r = await conformVendor("claude", { helpFn: async () => { throw new Error("ENOENT"); } });
  assert.ok(r.mismatches.some(m => /could not run|ENOENT/i.test(m)));
  assert.equal(r.checked, 0);
});

test("an unknown vendor throws", async () => {
  await assert.rejects(() => conformVendor("nope", { helpFn: helpWith([]) }), /unknown vendor/);
});

// A conformance runner that reports zero checks and zero mismatches would read as a pass while
// verifying nothing -- the vacuous-green failure this project has already been bitten by.
test("every declared vendor has at least one checkable flag", async () => {
  const { VENDORS } = await import("../src/seat/argv.mjs");
  for (const vendor of Object.keys(VENDORS)) {
    const r = await conformVendor(vendor, { helpFn: helpWith(["--resume", "--session-id",
      "--model", "--effort", "--output-format", "--conversation", "--add-dir"]) });
    assert.ok(r.checked > 0,
      `${vendor}: nothing to check means conformance can never fail for this vendor`);
  }
});

test("the prompt flag is among the flags conformance checks", async () => {
  // It was absent from the plan's table entirely, so it is exactly the kind of declaration that
  // must be verified against the binary rather than trusted.
  const r = await conformVendor("claude", {
    helpFn: helpWith(["--resume", "--session-id", "--model", "--effort", "--output-format"]),
  });
  assert.ok(r.mismatches.some(m => m.includes("-p")) || r.checkedFlags?.includes("-p"),
    "a declared prompt flag must be checked, not assumed");
});

test("locateStore never returns a path outside the vendor's own directory", () => {
  const r = locateStore({ vendor: "claude", cwd: "/repo/a", home: "/home/u" });
  if (r.path) assert.ok(r.path.startsWith("/home/u/.claude"), `escaped: ${r.path}`);
});

// Was: "grok/agy stores are unconfirmed". Both were located on 2026-09-27 (grok at
// ~/.grok/sessions/<pct-cwd>/<id>/chat_history.jsonl, agy at
// ~/.gemini/antigravity-cli/conversations/<id>.db), so the old assertion pinned a fact that has
// since changed. What must NOT change is that a miss states its reason: a bare null reads as
// "there is no conversation" when it means "I could not find one".
test("every vendor's miss names a reason rather than returning a bare null", () => {
  for (const v of ["claude", "codex", "grok", "agy"]) {
    const r = locateStore({ vendor: v, cwd: "/repo/a", home: "/home/u", sessionId: "absent-id" });
    assert.equal(r.path, null);
    assert.ok(r.why && r.why.length > 0, `${v} returned a null path with no reason`);
  }
});

test("locateStore on an unknown vendor names the vendor rather than returning a bare null", () => {
  const r = locateStore({ vendor: "nope", cwd: "/repo/a", home: "/home/u" });
  assert.equal(r.path, null);
  assert.match(r.why, /nope/, "the reason must identify what it could not resolve");
});

test("locateStore never throws on a missing home, it reports", () => {
  const r = locateStore({ vendor: "claude", cwd: "/repo/a", home: "/nonexistent-home-xyz" });
  assert.equal(r.path, null);
  assert.ok(typeof r.why === "string" && r.why.length > 0);
});
