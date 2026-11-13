import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runOpenItem } from "../src/board/run-item.mjs";

const withTmp = async fn => {
  const dir = mkdtempSync(join(tmpdir(), "pantheon-run-item-"));
  try { return await fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
};

// A fake vendor client that always answers with a fixed reply, and a fake reviewer client that
// always approves -- enough to drive one full intake -> promote -> plan -> work -> check -> ship
// pass without a real vendor call, mirroring tests/sdk-transport.test.mjs's fakeClient shape.
function fakeClientFor() {
  const answer = req => /VERDICT/i.test(req.input ?? req.messages?.at(-1)?.content ?? "")
    ? "VERDICT: approve"
    : "TITLE: a fixture work item";
  // run-item observes every turn through the streaming path (src/sdk/stream.mjs), which asks the
  // client for `stream: true` and iterates typed Responses events. A fake that only answers the
  // blocking shape dies at intake with "stream is not async iterable" before any stage that a
  // test might want to reach. Same fixed reply, both shapes.
  const streamed = async function* (text) {
    yield { type: "response.created", response: { id: "resp_1" } };
    yield { type: "response.output_text.delta", delta: text };
    yield { type: "response.completed", response: { id: "resp_1", output_text: text, output: [] } };
  };
  // Which SDK shape a seat speaks is decided by the live seating table and the shared cooldown
  // store (~/.cache/pantheon), not by the test: the planner is an anthropic chair unless that
  // hose is on cooldown, in which case it falls to openai. A fake that only speaks Responses
  // passed while the hose happened to be shut and died at plan ("reading 'create'") once the
  // cooldown expired. The fake speaks both, so the fixture's fate does not depend on what some
  // other process did to a cache file an hour ago.
  const anthropicStreamed = async function* (text) {
    yield { type: "message_start", message: { id: "msg_1" } };
    yield { type: "content_block_delta", delta: { type: "text_delta", text } };
    yield { type: "message_stop" };
  };
  return {
    responses: {
      create: async req => req.stream ? streamed(answer(req)) : { id: "resp_1", output_text: answer(req) },
    },
    messages: {
      create: async req => req.stream ? anthropicStreamed(answer(req)) : { id: "msg_1", content: [{ type: "text", text: answer(req) }] },
    },
  };
}

// The property that matters, checked on the source itself rather than trusted: a process.exit()
// reachable from an HTTP request handler kills the whole server on one failed build. A bare
// `grep -c process.exit` does NOT check this -- it counts the comments that document the rule, and
// this module has four of those. Comments and strings are stripped first.
test("run-item.mjs contains no executable process.exit call (only comments about it)", () => {
  const src = readFileSync(fileURLToPath(new URL("../src/board/run-item.mjs", import.meta.url)), "utf8");
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, "")   // block comments
    .replace(/^\s*\/\/.*$/gm, "")       // whole-line // comments
    .replace(/([^:])\/\/.*$/gm, "$1")   // trailing // comments (":" guard keeps http:// in urls)
    .replace(/`(?:[^`\\]|\\.)*`/g, "``") // template literals
    .replace(/"(?:[^"\\]|\\.)*"/g, '""') // double-quoted strings
    .replace(/'(?:[^'\\]|\\.)*'/g, "''"); // single-quoted strings
  assert.equal(/process\s*\.\s*exit\s*\(/.test(code), false,
    "src/board/run-item.mjs must never call process.exit(): it runs inside a long-lived HTTP server");
});

// C4's other half. The server-side proof (tests/view-build-server.test.mjs) shows an AWAITED
// subprocess leaves the loop free; this is the half that keeps the pipeline from reintroducing a
// synchronous one. Both matter: a single spawnSync anywhere on the default build path pins the
// event loop for the whole subprocess, and the default path shells out twice (the acceptance
// command, and the Antigravity seat). Measured before the conversion: two 3-second builds took
// 6 seconds and /builds could not be answered for 3010ms of it.
test("run-item.mjs uses no synchronous spawn: one would pin the server's event loop", () => {
  const src = readFileSync(fileURLToPath(new URL("../src/board/run-item.mjs", import.meta.url)), "utf8");
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/([^:])\/\/.*$/gm, "$1")
    .replace(/`(?:[^`\\]|\\.)*`/g, "``")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''");
  assert.equal(/\bspawnSync\b|\bexecSync\b|\bexecFileSync\b/.test(code), false,
    "src/board/run-item.mjs must shell out asynchronously (src/board/spawn.mjs): it runs inside a server");
});

test("the CLI wrapper does still own its exit codes", () => {
  const src = readFileSync(fileURLToPath(new URL("../scripts/open-items-run.mjs", import.meta.url)), "utf8");
  assert.ok(/process\s*\.\s*exit\s*\(/.test(src),
    "scripts/open-items-run.mjs is a CLI: exiting with a status is its job, and moving that into the pipeline is the bug this pair of tests guards");
});

// CONTAINMENT AT THE PIPELINE, not only at the HTTP boundary. runOpenItem is an importable
// surface -- the CLI is one caller, the build API another, and anything else that imports it is a
// third. A ticket drafted by a model from a document another model wrote is untrusted input at
// every one of those doors, so the check belongs where the path-joins are.
test("runOpenItem refuses a ticket.key that would escape its own output directory", async () => {
  await withTmp(async dir => {
    const spec = {
      key: "../../../../escaped", repo_root: dir, title: "t", goal: "g", slot: "out.txt",
      path: "out.txt", copy: [], acceptance_cmd: "true", question: "q",
    };
    await assert.rejects(() => runOpenItem(spec, { dir: join(dir, "board"), makeClientFor: fakeClientFor }),
      /ticket\.key/);
  });
});

test("runOpenItem refuses copy[] and attach[] entries that escape repo_root", async () => {
  await withTmp(async dir => {
    const base = {
      key: "fixtureItem", repo_root: dir, title: "t", goal: "g", slot: "out.txt",
      path: "out.txt", copy: [], acceptance_cmd: "true", question: "q",
    };
    await assert.rejects(
      () => runOpenItem({ ...base, copy: ["../../outside/id_rsa"] }, { dir: join(dir, "b1"), makeClientFor: fakeClientFor }),
      /copy/);
    // attach is the worse variant: its CONTENTS are interpolated into the implementer and reviewer
    // prompts, both of which go over the wire to vendor APIs.
    await assert.rejects(
      () => runOpenItem({ ...base, attach: ["../../../.ssh/id_rsa"] }, { dir: join(dir, "b2"), makeClientFor: fakeClientFor }),
      /attach/);
  });
});

test("runOpenItem never calls process.exit and returns a result object on a missing spec field", async () => {
  await assert.rejects(
    () => runOpenItem({ key: "x" }, { makeClientFor: fakeClientFor }),
    /ticket spec is missing/,
  );
});

test("runOpenItem requires makeClientFor", async () => {
  await assert.rejects(() => runOpenItem({ key: "x", title: "t", goal: "g", slot: "s", copy: [], acceptance_cmd: "true", question: "q" }, {}),
    /pass makeClientFor/);
});

test("runOpenItem returns {ok, shipped, error} without throwing on a run it cannot complete", async () => {
  await withTmp(async dir => {
    const spec = {
      key: "fixtureItem", repo_root: dir, title: "fixture", goal: "fixture goal",
      slot: "out.txt", path: "out.txt", copy: [], tests_file: null,
      acceptance_cmd: "exit 1", // deliberately failing acceptance
      question: "fixture question",
    };
    // scouts/planner/implementer pinned off agy_google, 2026-09-29: this test's assertions only
    // check the RESULT SHAPE (ok/shipped/error are the right types), which a genuine agy_google CLI
    // success -- spending a real Antigravity call against the real OAuth session -- would also
    // satisfy. Found by measuring the whole suite's runtime jump from ~13s to ~2m10s after
    // SEATING.planner/implementer's new default rungs landed: this test (no override at all) was
    // silently making that real call, every run, with nothing in its assertions able to notice.
    const result = await runOpenItem(spec, { dir: join(dir, "board"), makeClientFor: fakeClientFor, scouts: ["xai"],
      seatOverrides: {
        planner: { vendor: "anthropic", model: "claude-fable-5-1", rank: 0, pool: "anthropic", band: null, basis: "OPERATOR", why: "keep this fixture on the fake SDK client" },
        implementer: { vendor: "openai", model: "gpt-6-astra", rank: 0, pool: "openai", band: null, basis: "OPERATOR", why: "keep this fixture on the fake SDK client" },
      } });
    assert.equal(typeof result.ok, "boolean");
    assert.equal(typeof result.shipped, "boolean");
    assert.ok(result.error === null || typeof result.error.stage === "string");
  });
});

// The implementer seat has no tools: whatever it does not receive in its prompt does not exist
// for it. On 2026-09-28 two rounds of a real ticket asked it to EDIT an 86 KB file, and the prompt's
// "Current contents of <path>:" was followed by nothing, because that section read a ticket field
// named `source` which LEXI's drafter never emits (its strict schema forbids extra keys). Round 1
// rewrote the file from a summary -- 2 of 8 programs survived; round 2 refused in 225 bytes:
// "The original shaders.ts ... still absent". The reference documents the author had placed in
// `copy` for exactly this seat were in the worktree it cannot read, and never in the prompt,
// because attachments read a different field (`attach`) that the drafter cannot emit either.
//
// The contract this pins: a ticket whose `path` already exists is an EDIT, and the implementer
// sees that file whether or not `source` is set; and a markdown document in `copy` reaches the
// prompt as a read-only reference whether or not `attach` is set.
test("an implementer editing an existing path sees its current contents, and copy[] documents, without `source` or `attach`", async () => {
  await withTmp(async dir => {
    writeFileSync(join(dir, "out.txt"), "ORIGINAL BODY LINE 1\nORIGINAL BODY LINE 2\n");
    writeFileSync(join(dir, "notes.md"), "# NOTES BODY\nthe motion vocabulary lives here\n");
    const spec = {
      key: "editItem", repo_root: dir, title: "edit an existing file", goal: "keep both lines",
      slot: "out.txt", path: "out.txt", copy: ["notes.md"], tests_file: null,
      acceptance_cmd: "true", question: "does the implementer see the file it edits?",
    };
    // scouts: the fake client speaks every vendor; the default agy_google scout needs a real key.
    // planner AND implementer: same reason, 2026-09-29 -- SEATING's new agy_google top rungs
    // (operator instruction) bypass makeClientFor entirely (agyTurn spawns its own process), so
    // this fake can never answer for either. Pinned to vendors the fake DOES speak.
    // The cooldown store is shared machine state that steers seating; point it at the temp dir so
    // this fixture cannot be steered by whatever another process recorded there.
    const savedCooldownDir = process.env.PANTHEON_COOLDOWN_DIR;
    process.env.PANTHEON_COOLDOWN_DIR = join(dir, "cooldowns");
    let result;
    try {
      result = await runOpenItem(spec, { dir: join(dir, "board"), makeClientFor: fakeClientFor, scouts: ["xai"],
        seatOverrides: {
          planner: { vendor: "anthropic", model: "claude-fable-5-1", rank: 0, pool: "anthropic", band: null, basis: "OPERATOR", why: "keep this fixture on the fake SDK client" },
          implementer: { vendor: "openai", model: "gpt-6-astra", rank: 0, pool: "openai", band: null, basis: "OPERATOR", why: "keep this fixture on the fake SDK client" },
        } });
    } finally {
      if (savedCooldownDir === undefined) delete process.env.PANTHEON_COOLDOWN_DIR; else process.env.PANTHEON_COOLDOWN_DIR = savedCooldownDir;
    }
    assert.equal(result.error, null, `the fixture must reach the work stage: ${JSON.stringify(result.error)}`);
    const prompt = readFileSync(join(dir, "outputs", "open-items", "editItem", "implementer-prompt-out.txt-rev1.txt"), "utf8");
    assert.match(prompt, /Current contents of out\.txt:\n\nORIGINAL BODY LINE 1\nORIGINAL BODY LINE 2/,
      "the file at `path` exists, so the implementer must be shown it -- `source` is optional, not the switch");
    assert.match(prompt, /reference \(read-only[^\n]*notes\.md[^\n]*\n# NOTES BODY/,
      "a markdown document in copy[] is a reference for a seat that cannot read the worktree");
  });
});
