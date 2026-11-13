import { test } from "node:test";
import assert from "node:assert/strict";
import { projectTranscript } from "../src/context/project.mjs";

const L1 = JSON.stringify({ type: "user", message: { content: [{ type: "text", text: "hello" }] } });
const L2 = JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "hi" }, { type: "tool_use", name: "Bash" }] } });
const L3 = JSON.stringify({ type: "system", message: { content: "ignored" } });
const claudeLines = [L1, L2, L3].join("\n");

test("projects only conversational turns, in order", () => {
  const t = projectTranscript(claudeLines, "claude");
  assert.equal(t.length, 2);
  assert.deepEqual(t.map(x => x.role), ["user", "assistant"]);
  assert.deepEqual(t[1].tools, ["Bash"]);
});

test("projection never carries content, only a hash and a length", () => {
  const t = projectTranscript(claudeLines, "claude");
  for (const turn of t) {
    assert.match(turn.sha, /^[0-9a-f]{64}$/);
    assert.equal(typeof turn.len, "number");
    assert.ok(!("text" in turn) && !("content" in turn),
      "a projection that carries text will end up in a log or an error message");
  }
});

// Review Focus 1: a live process leaves the last line half-written.
test("a truncated final line is dropped, and the prefix projects identically", () => {
  const whole = projectTranscript(claudeLines, "claude");
  const torn = projectTranscript(claudeLines + '\n{"type":"user","mess', "claude");
  assert.deepEqual(torn, whole, "a partial trailing line must not alter the projection");
});

test("a torn line in the MIDDLE is dropped without losing later turns", () => {
  const withHole = [L1, '{"type":"user","mess', L2].join("\n");
  const t = projectTranscript(withHole, "claude");
  assert.equal(t.length, 2, "unparseable lines are skipped, not fatal");
});

test("an empty or whitespace transcript yields an empty projection, not a throw", () => {
  assert.deepEqual(projectTranscript("", "claude"), []);
  assert.deepEqual(projectTranscript("\n \n", "claude"), []);
});

test("a turn with no text and no tools is not a turn", () => {
  const t = projectTranscript(JSON.stringify({ type: "assistant", message: { content: [] } }), "claude");
  assert.deepEqual(t, []);
});

test("codex rollout lines project from response_item", () => {
  const codex = [
    JSON.stringify({ type: "session_meta", payload: {} }),
    JSON.stringify({ type: "response_item", payload: { role: "assistant", content: [{ type: "text", text: "ok" }] } }),
  ].join("\n");
  const t = projectTranscript(codex, "codex");
  assert.equal(t.length, 1);
  assert.equal(t[0].role, "assistant");
});

test("an unknown vendor throws rather than projecting nothing and looking empty", () => {
  assert.throws(() => projectTranscript(claudeLines, "nope"), /no projector/);
});

test("tool names are sorted so ordering churn does not change the hash", () => {
  const a = projectTranscript(JSON.stringify({ type: "assistant", message: { content: [
    { type: "text", text: "x" }, { type: "tool_use", name: "B" }, { type: "tool_use", name: "A" }] } }), "claude");
  assert.deepEqual(a[0].tools, ["A", "B"]);
});

// Resolution defect regression tests (P2). ------------------------------------------------------

test("same tool name, different arguments, produces different hashes", () => {
  const line = args => JSON.stringify({ type: "assistant", message: { content: [
    { type: "tool_use", name: "Bash", input: args } ] } });
  const a = projectTranscript(line({ command: "ls -la" }), "claude");
  const b = projectTranscript(line({ command: "rm -rf /" }), "claude");
  assert.equal(a.length, 1);
  assert.equal(b.length, 1);
  assert.deepEqual(a[0].tools, ["Bash"]);
  assert.deepEqual(b[0].tools, ["Bash"]);
  assert.notEqual(a[0].sha, b[0].sha, "same tool name with different arguments must not collide");
});

test("a tool RESULT line contributes a turn, not just tool_use", () => {
  // This is the shape a live tool result actually arrives in: a "user" message whose content is
  // ONLY a tool_result block, no text and no tool_use - previously dropped as textless-and-toolless.
  const line = JSON.stringify({ type: "user", message: { content: [
    { type: "tool_result", tool_use_id: "t1", content: "total 4\ndrwxr-xr-x colchis" } ] } });
  const t = projectTranscript(line, "claude");
  assert.equal(t.length, 1, "a tool result is conversation state and must contribute a turn");
  assert.equal(t[0].role, "user");
  assert.ok(t[0].len > 0);
});

test("a thinking block contributes to the hash (interior deliberation is real per-turn state)", () => {
  // Decision: thinking/reasoning content is folded into the digest, never surfaced as text. Two
  // turns that say the same visible words after thinking differently are not the same turn, and
  // a projection that ignored thinking would let them collide.
  const withThought = JSON.stringify({ type: "assistant", message: { content: [
    { type: "thinking", thinking: "plan A: check the logs first" },
    { type: "text", text: "done" } ] } });
  const withDifferentThought = JSON.stringify({ type: "assistant", message: { content: [
    { type: "thinking", thinking: "plan B: just guess" },
    { type: "text", text: "done" } ] } });
  const a = projectTranscript(withThought, "claude");
  const b = projectTranscript(withDifferentThought, "claude");
  assert.notEqual(a[0].sha, b[0].sha, "different thinking content must change the hash");
});

test("a marked payload never appears anywhere in the projection output (hardest rule)", () => {
  const MARKER = "SECRET-MARKER-df91c2a7";
  const line = JSON.stringify({ type: "user", message: { content: [
    { type: "text", text: MARKER },
    { type: "tool_use", name: "Bash", input: { command: MARKER } },
    { type: "tool_result", content: MARKER },
    { type: "thinking", thinking: MARKER, signature: MARKER } ] } });
  const t = projectTranscript(line, "claude");
  assert.ok(!JSON.stringify(t).includes(MARKER),
    "a projection that carries content ends up in a log or an error message");
});

test("a torn final line on a real-shaped codex transcript is skipped without throwing", () => {
  const good = JSON.stringify({ type: "response_item", payload: { type: "message", role: "assistant",
    content: [{ type: "output_text", text: "ok" }] } });
  const torn = good + "\n" + '{"type":"response_item","payload":{"type":"custom_tool_';
  assert.doesNotThrow(() => projectTranscript(torn, "codex"));
  const t = projectTranscript(torn, "codex");
  assert.equal(t.length, 1, "the torn line contributes nothing, the good line still does");
});

test("a real-shaped codex fixture (message, reasoning, custom_tool_call, custom_tool_call_output) projects the expected turn count", () => {
  // Line shapes below are taken from actual ~/.codex/sessions/**/*.jsonl payloads, not guessed:
  // payload.type is one of message/reasoning/custom_tool_call/custom_tool_call_output/
  // function_call/function_call_output, and custom_tool_call_output.output is an array of
  // {type:"input_text", text} blocks.
  const lines = [
    { type: "session_meta", payload: {} },
    { type: "response_item", payload: { type: "message", role: "developer",
      content: [{ type: "input_text", text: "you are a coding agent" }] } },
    { type: "response_item", payload: { type: "reasoning", id: "rs_1", summary: [],
      encrypted_content: "gAAAAABopaque" } },
    { type: "response_item", payload: { type: "custom_tool_call", id: "ctc_1", status: "completed",
      call_id: "call_1", name: "exec", input: "ls -la" } },
    { type: "response_item", payload: { type: "custom_tool_call_output", call_id: "call_1",
      output: [{ type: "input_text", text: "Script completed\nWall time 0.1s\nOutput:\n" },
                { type: "input_text", text: "total 4\n" }] } },
    { type: "response_item", payload: { type: "message", role: "assistant",
      content: [{ type: "output_text", text: "done" }] } },
    { type: "event_msg", payload: {} },
  ].map(o => JSON.stringify(o)).join("\n");
  const t = projectTranscript(lines, "codex");
  assert.equal(t.length, 5, "message, reasoning, tool_call, tool_call_output, message - session_meta/event_msg excluded");
  assert.deepEqual(t.map(x => x.role), ["developer", "assistant", "assistant", "tool", "assistant"]);
  assert.deepEqual(t[2].tools, ["exec"]);
});
