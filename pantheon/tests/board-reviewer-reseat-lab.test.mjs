// Human-authored oracle for ticket reviewerReseatLab ("an agy_google reviewer reseat cannot publish
// its own critique"). Written BEFORE the seat changes src/board/run-item.mjs; baselined failing
// against the code as it stood on 2026-09-28, which maps the reseated reviewer's vendor id through
// LAB() ("agy_google" -> "google") before using it as the critique's author.vendor -- an id the
// board's own VENDORS set does not recognise, so publish() always refuses it. This was observed for
// real that day: outputs/open-items/conformParallel/run.json, error.stage "check", error.message
// "critique publish: author.vendor must be one of anthropic|openai|agy_google|xai|human|controller".
//
// This drives a FULL runOpenItem pass end to end in a throwaway repo_root, so the property under
// test is the real one -- the run actually ships -- not a proxy on some inline helper's return
// value. The scripted-stream client is copied from tests/board-multi-slot.test.mjs's own
// scriptedClients(): it answers on all three real streaming surfaces (responses/messages/
// generateContentStream), which is what the pipeline actually calls (src/sdk/stream.mjs) -- a
// plain non-streaming fake throws "stream is not async iterable" the moment a real turn runs.
//
// The Antigravity OAuth CLI is stood in for by PANTHEON_AGY_CLI. The fake emits the same
// init/result NDJSON envelope the real headless CLI emits, so the board's identity and completed
// turn checks run before this oracle reaches the review-publication invariant.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const withTmp = async fn => {
  const dir = mkdtempSync(join(tmpdir(), "pantheon-reviewer-reseat-"));
  try { return await fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
};

// Copied verbatim from tests/board-multi-slot.test.mjs's scriptedClients(): every seat answers
// from a script keyed by what the prompt asks for, on all three real streaming surfaces.
function scriptedClients() {
  let n = 0;
  const answerFor = prompt => {
    if (/VERDICT/i.test(prompt)) return "looks right\n\nVERDICT: approve";
    if (/TITLE:/i.test(prompt)) return "TITLE: the fixture change";
    if (/RAN: nothing/i.test(prompt)) return "nothing known.\n\nRAN: nothing";
    const m = prompt.match(/Output ONLY the complete new contents of (\S+)/);
    return `// built: ${m ? m[1] : "unknown"}\nexport const ok = true;\n`;
  };
  return {
    makeClientFor: () => {
      const record = req => answerFor(String(req.input ?? req.messages?.at(-1)?.content ?? req.contents ?? ""));
      return {
        responses: {
          create: async req => {
            const text = record(req);
            const id = `resp_${++n}`;
            const response = { id, output_text: text, output: [{ type: "message", content: [{ type: "output_text", text }] }] };
            return { async *[Symbol.asyncIterator]() {
              yield { type: "response.created", response: { id } };
              yield { type: "response.output_text.delta", delta: text };
              yield { type: "response.completed", response };
            } };
          },
        },
        messages: {
          create: async req => {
            const text = record(req);
            return { async *[Symbol.asyncIterator]() {
              yield { type: "content_block_delta", delta: { type: "text_delta", text } };
              yield { type: "message_stop" };
            } };
          },
        },
        models: {
          generateContentStream: async req => {
            const text = record(req);
            return { async *[Symbol.asyncIterator]() { yield { text }; } };
          },
        },
      };
    },
  };
}

// A CLI result can have exit 0 while containing no answer (the live OAuth probe did exactly that
// on print timeout). This fake provides one observed turn and a verdict so publication is reached.
const FAKE_AGY = `#!/bin/sh
printf '%s\\n' '{"event":"init","conversation_id":"fixture-conversation","init":{"model":"fixture-model","agent":"pantheon-reviewer"}}' '{"event":"result","result":{"status":"SUCCESS","conversation_id":"fixture-conversation","num_turns":1,"response":"VERDICT: approve","usage":{"input_tokens":1,"output_tokens":1}}}'
`;

test("an operator reseat of the reviewer to agy_google ships: the critique publishes under agy_google, never the lab name \"google\"", async () => {
  await withTmp(async dir => {
    const fakeAgy = join(dir, "fake-agy-seat");
    writeFileSync(fakeAgy, FAKE_AGY, { mode: 0o755 });

    const savedAgyCli = process.env.PANTHEON_AGY_CLI;
    const savedTransport = process.env.PANTHEON_AGY_TRANSPORT;
    process.env.PANTHEON_AGY_CLI = fakeAgy;
    process.env.PANTHEON_AGY_TRANSPORT = "cli";
    try {
      const { runOpenItem } = await import(`../src/board/run-item.mjs?fixture=${Date.now()}`);
      const { makeClientFor } = scriptedClients();

      const spec = {
        key: "reviewerReseatFixture", repo_root: dir, title: "fixture", goal: "fixture goal",
        slot: "note.txt", path: "note.txt", copy: [], tests_file: null,
        acceptance_cmd: "true", // always exits 0: this test is about the reviewer path, not acceptance
        question: "fixture question",
      };
      const result = await runOpenItem(spec, {
        dir: join(dir, "board"),
        makeClientFor,
        scouts: ["xai"],   // the fake CLI is needed only for the reviewer in this fixture
        seatOverrides: {
          reviewer: { vendor: "agy_google", model: "fixture-model", rank: 0, pool: "agy_google", band: null, basis: "OPERATOR", why: "test reseat" },
          // Pinned off agy_google explicitly, 2026-09-29: SEATING.planner AND SEATING.implementer's
          // new top rungs (operator instruction) would otherwise also route through
          // PANTHEON_AGY_TRANSPORT=cli above and hit this test's fake CLI, which only knows how to
          // answer as pantheon-reviewer -- an identity mismatch unrelated to what this fixture
          // actually tests. anthropic/openai go through scriptedClients()'s generic SDK fake
          // instead, same as every other role here.
          planner: { vendor: "anthropic", model: "claude-fable-5-1", rank: 0, pool: "anthropic", band: null, basis: "OPERATOR", why: "keep this fixture scoped to the reviewer reseat" },
          implementer: { vendor: "openai", model: "gpt-6-astra", rank: 0, pool: "openai", band: null, basis: "OPERATOR", why: "keep this fixture scoped to the reviewer reseat" },
        },
      });

      assert.equal(result.error, null,
        `expected no error, got: ${JSON.stringify(result.error)} -- an agy_google reviewer reseat must not crash at publish`);
      assert.equal(result.ok, true, `expected ok:true, got ${JSON.stringify(result)}`);
      assert.equal(result.shipped, true,
        "the run must actually ship: publish() only succeeds when author.vendor is a legal board vendor id, " +
        "so shipped:true is proof the critique was NOT published under the lab name \"google\"");
    } finally {
      if (savedAgyCli === undefined) delete process.env.PANTHEON_AGY_CLI; else process.env.PANTHEON_AGY_CLI = savedAgyCli;
      if (savedTransport === undefined) delete process.env.PANTHEON_AGY_TRANSPORT; else process.env.PANTHEON_AGY_TRANSPORT = savedTransport;
    }
  });
});
