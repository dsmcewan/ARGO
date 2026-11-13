import { test } from "node:test";
import assert from "node:assert/strict";
import { sendTurn } from "../src/sdk/adapter.mjs";
import { streamTurn } from "../src/sdk/stream.mjs";

// THE DEFECT, 2026-09-27 re-review, rank 4. The unary Responses replay kept res.output so reasoning items
// survive to the next turn; the STREAMING replay branch rebuilt history from accumulated text, so every
// streamed turn -- which is every turn the live view runs -- dropped them while STATE.md said they were
// kept. The completed response rides on the terminal stream event; it has to reach the history.

const REASONING = { type: "reasoning", id: "rs_1", encrypted_content: "OPAQUE-BLOB", summary: [] };
const MESSAGE = { type: "message", id: "msg_1", role: "assistant", content: [{ type: "output_text", text: "hi there" }] };
const streamingClient = () => ({
  responses: {
    create: async req => {
      assert.equal(req.stream, true, "the streaming path must ask for a stream");
      return (async function* () {
        yield { type: "response.created", response: { id: "resp_1" } };
        yield { type: "response.output_text.delta", delta: "hi " };
        yield { type: "response.output_text.delta", delta: "there" };
        yield { type: "response.completed", response: { id: "resp_1", output: [REASONING, MESSAGE] } };
      })();
    },
  },
});

test("streamTurn returns the completed response, not only what it accumulated", async () => {
  const acc = await streamTurn({ client: streamingClient(), surface: "responses", req: { input: "x" }, seat: "t", onEvent: () => {} });
  assert.equal(acc.text, "hi there");
  assert.equal(acc.complete, true);
  assert.deepEqual(acc.final.output, [REASONING, MESSAGE]);
});

test("a streamed replay turn keeps every output item, reasoning included", async () => {
  const r = await sendTurn({ client: streamingClient(), vendor: "openai", prompt: "one", history: [], continuity: "replay", onEvent: () => {} });
  assert.equal(r.ok ?? true, true, r.why_unusable ?? "");
  assert.equal(r.text, "hi there");
  const kinds = r.history.map(m => m.type ?? m.role);
  assert.deepEqual(kinds, ["user", "reasoning", "message"], `history was ${JSON.stringify(kinds)}`);
  assert.equal(r.history[1].encrypted_content, "OPAQUE-BLOB", "the reasoning item must survive verbatim");
});

test("the streamed and unary replay paths produce the same history shape", async () => {
  const unary = { responses: { create: async () => ({ id: "resp_1", output_text: "hi there", output: [REASONING, MESSAGE] }) } };
  const a = await sendTurn({ client: unary, vendor: "openai", prompt: "one", history: [], continuity: "replay" });
  const b = await sendTurn({ client: streamingClient(), vendor: "openai", prompt: "one", history: [], continuity: "replay", onEvent: () => {} });
  assert.deepEqual(b.history, a.history, "one seat layer hashes one thing; the two paths must agree");
});

test("a stream that never completes is not persisted as a replayable exchange", async () => {
  const truncated = { responses: { create: async () => (async function* () {
    yield { type: "response.created", response: { id: "resp_1" } };
    yield { type: "response.output_text.delta", delta: "hi" };
  })() } };
  const r = await sendTurn({ client: truncated, vendor: "openai", prompt: "one", history: [], continuity: "replay", onEvent: () => {} });
  assert.equal(r.usable_for_resume, false);
});

// In-session probe: deltas and the completed response can disagree; the chain and the replay must not.
test("when deltas and the completed message disagree, the completed message is the text of record", async () => {
  const client = { responses: { create: async () => (async function* () {
    yield { type: "response.created", response: { id: "resp_1" } };
    yield { type: "response.output_text.delta", delta: "draft" };
    yield { type: "response.completed", response: { id: "resp_1", output: [{ type: "message", id: "m", role: "assistant", content: [{ type: "output_text", text: "final" }] }] } };
  })() } };
  const r = await sendTurn({ client, vendor: "openai", prompt: "q", history: [], continuity: "replay", onEvent: () => {} });
  assert.equal(r.text, "final");
  assert.equal(r.history[1].content[0].text, "final");
});
