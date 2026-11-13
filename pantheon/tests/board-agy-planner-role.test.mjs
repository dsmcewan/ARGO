// Human-authored oracle for ticket agyPlannerRoleRefusal, REWRITTEN 2026-09-29 -- the failure mode
// this file originally pinned ("an agy_google planner reseat burns a full intake before failing on
// an argparse error", 2026-09-28) can no longer happen at all: agyTurn in run-item.mjs now forces
// transport="cli" unconditionally for the planner and implementer roles specifically, because
// scripts/agy-seat.py's --role choices are literally ["reviewer", "scout", "fact-checker"] and the
// SDK lane can never serve either role, on any input. The synchronous refusal this file tested was
// removed the same day it was added, once the real fix (force CLI at the dispatch point, not refuse
// the bad combination after the fact) landed -- see run-item.mjs's own comment at that removal.
//
// What is actually worth pinning now: planner reaches the CLI lane BY DEFAULT, with no
// PANTHEON_AGY_TRANSPORT set at all, because SEATING.planner's own top rung is agy_google as of
// 2026-09-29 (operator instruction). A fake agy CLI stands in for the real OAuth process, same
// pattern as tests/board-reviewer-reseat-lab.test.mjs; a real network call here would be a test bug.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const withTmp = async fn => {
  const dir = mkdtempSync(join(tmpdir(), "pantheon-agy-planner-"));
  try { return await fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
};

// Same scripted-client shape as board-reviewer-reseat-lab.test.mjs / board-multi-slot.test.mjs:
// every non-agy_google seat answers from a script keyed by what the prompt asks for, on all three
// real streaming surfaces.
function scriptedClients() {
  const answerFor = prompt => {
    if (/VERDICT/i.test(prompt)) return "looks right\n\nVERDICT: approve";
    if (/TITLE:/i.test(prompt)) return "TITLE: the fixture change";
    if (/RAN: nothing/i.test(prompt)) return "nothing known.\n\nRAN: nothing";
    const m = prompt.match(/Output ONLY the complete new contents of (\S+)/);
    return `// built: ${m ? m[1] : "unknown"}\nexport const ok = true;\n`;
  };
  let n = 0;
  return {
    makeClientFor: () => {
      const record = req => answerFor(String(req.input ?? req.messages?.at(-1)?.content ?? req.contents ?? ""));
      return {
        responses: { inputTokens: {count: async () => ({input_tokens: 1000})}, create: async req => { const text = record(req); const id = `resp_${++n}`;
          return { async *[Symbol.asyncIterator]() {
            yield { type: "response.created", response: { id } };
            yield { type: "response.output_text.delta", delta: text };
            yield { type: "response.completed", response: { id, status: "completed", output_text: text, output: [{ type: "message", content: [{ type: "output_text", text }] }] } };
          } }; } },
        messages: { create: async req => { const text = record(req);
          return { async *[Symbol.asyncIterator]() {
            yield {type:"content_block_start",index:0,content_block:{type:"text",text:""}};
                yield { type: "content_block_delta", index:0, delta: { type: "text_delta", text } };
            yield {type:"message_delta",delta:{stop_reason:"end_turn"}};
                yield { type: "message_stop" };
          } }; } },
        models: { countTokens: async () => ({totalTokens:1000}), generateContentStream: async req => { const text = record(req);
          return { async *[Symbol.asyncIterator]() { yield {candidates:[{finishReason:"STOP",content:{parts:[{text}]}}]}; } }; } },
      };
    },
  };
}

// Answers as whichever pantheon-<agent> the launcher actually requested, TITLE-shaped for a
// planner turn -- a real CLI result can have exit 0 with no answer (observed on a live print
// timeout earlier this session), so this fake provides one genuine observed turn.
const FAKE_AGY = `#!/bin/sh
agent="fixture"
model="fixture"
for a in "$@"; do
  case "$prev" in --agent) agent="$a" ;; --model) model="$a" ;; esac
  prev="$a"
done
printf '{"event":"init","conversation_id":"fixture-conversation","init":{"model":"'"$model"'","agent":"'"$agent"'"}}\\n'
printf '{"event":"result","result":{"status":"SUCCESS","conversation_id":"fixture-conversation","num_turns":1,"response":"TITLE: the fixture change","usage":{"input_tokens":1,"output_tokens":1}}}\\n'
`;

test("an operator reseat of the planner to agy_google reaches the CLI lane by default, no PANTHEON_AGY_TRANSPORT needed", async () => {
  await withTmp(async dir => {
    const fakeAgy = join(dir, "fake-agy-seat");
    writeFileSync(fakeAgy, FAKE_AGY, { mode: 0o755 });

    const savedAgyCli = process.env.PANTHEON_AGY_CLI;
    const savedTransport = process.env.PANTHEON_AGY_TRANSPORT;
    process.env.PANTHEON_AGY_CLI = fakeAgy;
    delete process.env.PANTHEON_AGY_TRANSPORT;   // the point: no opt-in env var set at all
    try {
      const { runOpenItem } = await import(`../src/board/run-item.mjs?fixture=${Date.now()}`);
      const { makeClientFor } = scriptedClients();
      const spec = {
        key: "agyPlannerFixture", repo_root: dir, title: "fixture", goal: "fixture goal",
        slot: "note.txt", path: "note.txt", copy: [], tests_file: null,
        acceptance_cmd: "true", question: "fixture question",
      };
      const result = await runOpenItem(spec, {
        dir: join(dir, "board"),
        makeClientFor,
        scouts: ["xai"],
        // No seatOverrides.planner at all: this proves the DEFAULT table (agy_google's new top
        // rung), not an operator override, is what reaches the fake CLI.
      });
      assert.equal(result.error, null,
        `expected no error, got: ${JSON.stringify(result.error)} -- planner must reach the CLI lane unconditionally`);
    } finally {
      if (savedAgyCli === undefined) delete process.env.PANTHEON_AGY_CLI; else process.env.PANTHEON_AGY_CLI = savedAgyCli;
      if (savedTransport === undefined) delete process.env.PANTHEON_AGY_TRANSPORT; else process.env.PANTHEON_AGY_TRANSPORT = savedTransport;
    }
  });
});

test("reviewer=agy_google still respects PANTHEON_AGY_TRANSPORT (defaults to SDK, unlike planner/implementer)", async () => {
  const savedTransport = process.env.PANTHEON_AGY_TRANSPORT;
  delete process.env.PANTHEON_AGY_TRANSPORT;
  try {
    await withTmp(async dir => {
      const spec = {
        key: "agyReviewerUnaffected", repo_root: dir, title: "fixture", goal: "fixture goal",
        slot: "note.txt", path: "note.txt", copy: [], tests_file: null,
        acceptance_cmd: "true", question: "fixture question",
      };
      // No real turn succeeds here (no GEMINI_API_KEY, no venv python) -- the point is WHICH
      // failure: an SDK-lane env/venv error proves reviewer still defaults to SDK, not CLI.
      // runOpenItem never throws (see tests/board-run-item.test.mjs's own pinned property, "never
      // calls process.exit and returns a result object") -- it resolves with an {ok, error} shape.
      const { runOpenItem } = await import(`../src/board/run-item.mjs?fixture=${Date.now()}`);
      const { makeClientFor } = scriptedClients();
      const result = await runOpenItem(spec, {
        dir: join(dir, "board"),
        makeClientFor,
        scouts: ["xai"],
        seatOverrides: {
          // Both pinned off agy_google: planner and implementer now default to it unconditionally
          // (agyTurn forces CLI for them), and with no PANTHEON_AGY_CLI fixture set here, an
          // unoverridden one would spawn the REAL agy binary against a real OAuth session -- a
          // live network call this unit test must never make. Only reviewer is under test.
          planner: { vendor: "anthropic", model: "claude-fable-5-1", rank: 0, pool: "anthropic", band: null, basis: "OPERATOR", why: "keep this fixture scoped to reviewer" },
          implementer: { vendor: "openai", model: "gpt-6-astra", rank: 0, pool: "openai", band: null, basis: "OPERATOR", why: "keep this fixture scoped to reviewer" },
          reviewer: { vendor: "agy_google", model: "gemini-3.7-flash", rank: 0, pool: "agy_google", band: null, basis: "OPERATOR", why: "test reseat" },
        },
      });
      const sawSdkLaneFailure = /GEMINI_API_KEY|venv python absent/i.test(result.error?.message ?? "");
      assert.equal(sawSdkLaneFailure, true,
        `reviewer=agy_google with no PANTHEON_AGY_TRANSPORT set must still attempt the SDK lane, unlike planner/implementer -- got: ${JSON.stringify(result.error)}`);
    });
  } finally {
    if (savedTransport === undefined) delete process.env.PANTHEON_AGY_TRANSPORT; else process.env.PANTHEON_AGY_TRANSPORT = savedTransport;
  }
});
