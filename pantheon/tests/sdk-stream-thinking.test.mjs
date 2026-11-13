// Human-authored oracle, written BEFORE the change and baselined failing.
//
// WHY THIS EXISTS. The operator watched a reviewer seat return a verdict after minutes of apparent
// silence and diagnosed the cause as the missing channel, not a slow model: "you lose everything with
// no understanding everytime it gets to the reviewer and it goes dark because theres no A2A"
// (2026-09-27). The stream WAS carrying material the whole time -- one xai review pushed roughly 124 KB
// of reasoning events -- and `src/sdk/stream.mjs` dropped every one of them on the floor, because its
// vocabulary has no event for "the model is thinking". So the overseer could only say nothing.
//
// The fix is an observation channel, not a behaviour change: a `thinking` event carrying BYTE COUNTS,
// never the reasoning text as reply text. Reasoning is not the answer and must never be accumulated
// into `text`; it is evidence that the seat is alive.
//
// RECOGNITION BY STRUCTURE, NOT BY ALLOW-LIST (the operator's standing rule on this machine). Vendors
// keep adding reasoning event names; a finite list silently skips its own complement. So the rule under
// test is: on the Responses surface, ANY event whose `type` contains "reasoning" or "thought" or
// "thinking" and carries a text-ish payload counts -- including a name this file's author never saw.
import test from "node:test";
import assert from "node:assert/strict";
import { streamTurn } from "../src/sdk/stream.mjs";

// --- fake vendors: async-iterable stubs shaped exactly like the three real streams -------------
const iter = events => ({ [Symbol.asyncIterator]: async function* () { for (const e of events) yield e; } });

const responsesClient = events => ({ responses: { create: async () => iter(events) } });
const genaiClient = chunks => ({ models: { generateContentStream: async () => iter(chunks) } });
const messagesClient = events => ({ messages: { create: async () => iter(events) } });

async function run(surface, client) {
  const seen = [];
  const res = await streamTurn({ client, surface, req: {}, seat: "s1", onEvent: e => seen.push(e) });
  return { res, seen, thinking: seen.filter(e => e.type === "thinking") };
}

test("responses: reasoning events surface as `thinking` with bytes, and never as reply text", async () => {
  const { res, thinking } = await run("responses", responsesClient([
    { type: "response.created", response: { id: "resp_1" } },
    { type: "response.reasoning_summary_text.delta", delta: "weighing the diff" },   // 17 bytes
    { type: "response.output_text.delta", delta: "VERDICT: approve" },
    { type: "response.completed", response: { id: "resp_1", output: [] } },
  ]));

  assert.equal(thinking.length, 1, "no `thinking` event was emitted for a reasoning delta");
  assert.equal(thinking[0].bytes, 17, "`thinking` must carry the byte count of the reasoning payload");
  assert.equal(thinking[0].text, undefined, "reasoning TEXT must not be carried on the event");
  assert.equal(res.text, "VERDICT: approve", "reasoning must never be accumulated into the reply text");
  assert.equal(res.thinking_bytes, 17, "streamTurn must total the reasoning bytes it saw");
  assert.equal(res.complete, true);
});

test("responses: an unseen reasoning event NAME still counts (structure, not an allow-list)", async () => {
  const { res, thinking } = await run("responses", responsesClient([
    { type: "response.created", response: { id: "r" } },
    { type: "response.reasoning_text.delta", delta: "abc" },              // 3
    { type: "response.thought_summary.delta", delta: "de" },              // 2, a name nobody has shipped yet
    { type: "response.output_text.delta", delta: "hi" },
    { type: "response.completed", response: { id: "r", output: [] } },
  ]));
  assert.equal(thinking.length, 2, "both reasoning-shaped events must be recognized by their shape");
  assert.equal(res.thinking_bytes, 5);
  assert.equal(res.text, "hi");
});

test("genai: Gemini thought parts count as thinking, not as text", async () => {
  const { res, thinking } = await run("genai", genaiClient([
    { candidates: [{ content: { parts: [{ text: "planning the check", thought: true }] } }] },  // 18
    { candidates: [{ content: { parts: [{ text: "done" }] } }] },
  ]));
  assert.equal(thinking.length, 1, "a part marked `thought: true` must emit a thinking event");
  assert.equal(thinking[0].bytes, 18);
  assert.equal(res.thinking_bytes, 18);
  assert.equal(res.text, "done", "a thought part must not become reply text");
});

test("messages: Anthropic thinking_delta counts as thinking, not as text", async () => {
  const { res, thinking } = await run("messages", messagesClient([
    { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "let me reproduce" } }, // 16
    { type: "content_block_delta", delta: { type: "text_delta", text: "ok" } },
    { type: "message_stop" },
  ]));
  assert.equal(thinking.length, 1);
  assert.equal(thinking[0].bytes, 16);
  assert.equal(res.thinking_bytes, 16);
  assert.equal(res.text, "ok");
});

test("a turn with no reasoning reports zero, and nothing else changes", async () => {
  const { res, thinking } = await run("messages", messagesClient([
    { type: "content_block_start", content_block: { type: "tool_use", name: "run_command" } },
    { type: "content_block_delta", delta: { type: "text_delta", text: "ran it" } },
    { type: "message_stop" },
  ]));
  assert.equal(thinking.length, 0);
  assert.equal(res.thinking_bytes, 0, "the field must exist and be 0, not undefined — a consumer reads it every turn");
  assert.deepEqual(res.tools, ["run_command"], "existing tool reporting must be untouched");
  assert.equal(res.text, "ran it");
  assert.equal(res.complete, true);
});
