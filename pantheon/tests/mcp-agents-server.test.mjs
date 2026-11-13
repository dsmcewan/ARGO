import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { createAgentsServer } from "../src/mcp/agents-server.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const withTmp = async fn => {
  const dir = mkdtempSync(join(tmpdir(), "pantheon-mcp-"));
  try { return await fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
};

const srv = (allowedRoot = "/nonexistent") => createAgentsServer({ allowedRoot });
const call = (s, name, args = {}, id = 1) =>
  s.handle({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });
/** tools/call reports failure INSIDE the result (isError), not as a JSON-RPC error. */
const text = res => res.result.content[0].text;

// --- protocol ---

test("initialize answers with a protocol version and server identity", async () => {
  const res = await srv().handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
  assert.equal(res.jsonrpc, "2.0");
  assert.equal(res.id, 1);
  assert.ok(res.result.protocolVersion, "a client that gets no version cannot negotiate");
  assert.ok(res.result.serverInfo.name);
  assert.ok(res.result.capabilities.tools, "this server's whole surface is tools");
});

test("a notification (no id) gets no response at all", async () => {
  // JSON-RPC forbids replying to a notification. Answering `notifications/initialized` with a
  // result is the classic stdio-MCP handshake bug: the client sees an unsolicited message.
  assert.equal(await srv().handle({ jsonrpc: "2.0", method: "notifications/initialized" }), null);
});

test("an unknown method is a -32601, not a crash and not a silent null", async () => {
  const res = await srv().handle({ jsonrpc: "2.0", id: 7, method: "resources/list" });
  assert.equal(res.error.code, -32601);
  assert.equal(res.id, 7, "the error must carry the id the client can correlate");
});

test("tools/list declares every tool with an inputSchema", async () => {
  const res = await srv().handle({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  const names = res.result.tools.map(t => t.name).sort();
  assert.deepEqual(names, ["get_agent", "install_agents", "list_agents", "render_agent"]);
  for (const t of res.result.tools) {
    assert.equal(t.inputSchema.type, "object", `${t.name} has no object inputSchema`);
    assert.ok(t.description?.length > 20, `${t.name}'s description will not help a model choose it`);
  }
});

// --- the tools ---

test("list_agents returns the real seats, not a sample", async () => {
  const res = await call(srv(), "list_agents");
  const data = JSON.parse(text(res));
  assert.ok(data.agents.length >= 15, `only ${data.agents.length} seats returned`);
  assert.ok(data.agents.some(a => a.id === "implementer@openai/gpt-6-astra"));
  assert.ok(data.agents.some(a => a.role === "scout"), "intake seats must be listed too");
});

test("get_agent returns the charter and the context policy", async () => {
  const data = JSON.parse(text(await call(srv(), "get_agent", { id: "reviewer@xai/grok-4.7" })));
  assert.match(data.charter, /Attack the artifact/);
  assert.deepEqual(data.context, ["ticket", "artifact", "tests", "trace", "repro"]);
  assert.ok(data.needs.includes("different_vendor"));
});

test("render_agent returns the file content AND what the format could not carry", async () => {
  const data = JSON.parse(text(await call(srv(), "render_agent",
    { id: "reviewer@xai/grok-4.7", format: "codex" })));
  // Codex has no agent file format, so the `codex` target renders the arguments for
  // openai_codex thread_start() instead. scripts/probe-codex-seat-contract.py checks those keys
  // against the installed SDK's real signature; this only checks the MCP envelope.
  assert.match(data.filename, /^\.pantheon\/codex-seats\/.+\.json$/);
  assert.ok(JSON.parse(data.content).developer_instructions.length > 0);
  assert.ok(data.lost.length > 0, "a lossy conversion that reports no loss is the dangerous case");
});

test("an unknown agent id is an isError result, not a thrown 500", async () => {
  // A model calling this tool with a wrong id must get a message it can act on, in-band.
  const res = await call(srv(), "get_agent", { id: "reviewer@nobody/x" });
  assert.equal(res.result.isError, true);
  assert.match(text(res), /unknown agent/i);
});

test("an unknown tool name is an isError result naming the tool", async () => {
  const res = await call(srv(), "delete_everything");
  assert.equal(res.result.isError, true);
  assert.match(text(res), /delete_everything/);
});

test("a missing required argument is refused with a usable message", async () => {
  const res = await call(srv(), "get_agent", {});
  assert.equal(res.result.isError, true);
  assert.match(text(res), /id/);
});

// --- install: the tool that writes to disk ---

test("install_agents writes the rendered card under the requested root", async () => {
  await withTmp(async dir => {
    const res = await call(srv(dir), "install_agents",
      { ids: ["reviewer@agy_google/gemini-3.5-flash"], format: "antigravity", root: dir });
    const data = JSON.parse(text(res));
    assert.equal(data.written.length, 1);
    const f = join(dir, data.written[0].filename);
    assert.ok(existsSync(f), `${data.written[0].filename} was reported written but is not on disk`);
    // The role name alone: agy-seat.py opens pantheon-<role>/agent.md, so a vendor suffix here
    // would write a card the consumer never finds.
    assert.equal(data.written[0].filename, ".agents/agents/pantheon-reviewer/agent.md");
    assert.match(readFileSync(f, "utf8"), /\nname: pantheon-reviewer\n/);
  });
});

test("install_agents surfaces per-agent loss rather than reporting a clean install", async () => {
  await withTmp(async dir => {
    const data = JSON.parse(text(await call(srv(dir), "install_agents",
      { ids: ["reviewer@xai/grok-4.7"], format: "claude-code", root: dir })));
    assert.ok(data.written[0].lost.length > 0,
      "installing a grok reviewer as a Claude Code card silently drops cross-lab isolation");
  });
});

test("install_agents refuses a root outside the allowed tree", async () => {
  await withTmp(async dir => {
    const allowed = join(dir, "allowed");
    mkdirSync(allowed, { recursive: true });
    const res = await call(srv(allowed), "install_agents",
      { ids: ["scout@xai"], format: "antigravity", root: join(dir, "elsewhere") });
    assert.equal(res.result.isError, true);
    assert.match(text(res), /outside/i);
    assert.ok(!existsSync(join(dir, "elsewhere")), "a refused install must not have created anything");
  });
});

test("install_agents refuses a traversal that would escape via ..", async () => {
  await withTmp(async dir => {
    const allowed = join(dir, "allowed");
    mkdirSync(allowed, { recursive: true });
    const res = await call(srv(allowed), "install_agents",
      { ids: ["scout@xai"], format: "antigravity", root: join(allowed, "..", "escaped") });
    assert.equal(res.result.isError, true);
    assert.ok(!existsSync(join(dir, "escaped")));
  });
});

test("install_agents writes NOTHING when any requested id is unknown", async () => {
  // A partial install leaves a directory half-populated with no record of which half.
  await withTmp(async dir => {
    const res = await call(srv(dir), "install_agents",
      { ids: ["scout@xai", "reviewer@nobody/x"], format: "antigravity", root: dir });
    assert.equal(res.result.isError, true);
    assert.ok(!existsSync(join(dir, ".agents")), "the valid card must not have been written either");
  });
});

// --- the real thing: a subprocess that actually speaks the protocol over stdio ---

test("the launcher answers a real initialize/tools-list handshake over stdio", async () => {
  const bin = join(HERE, "..", "bin", "pantheon-agents-mcp.mjs");
  const child = spawn(process.execPath, [bin], { stdio: ["pipe", "pipe", "pipe"] });
  const lines = [];
  let buf = "";
  child.stdout.on("data", d => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf("\n")) >= 0) { const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (l) lines.push(l); }
  });

  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }) + "\n");
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }) + "\n");

  const deadline = Date.now() + 10_000;
  while (lines.length < 2 && Date.now() < deadline) await new Promise(r => setTimeout(r, 50));
  child.stdin.end();
  child.kill();

  assert.ok(lines.length >= 2, `expected 2 responses, got ${lines.length}: ${lines.join(" | ")}`);
  const init = JSON.parse(lines[0]);
  assert.equal(init.id, 1);
  assert.ok(init.result.serverInfo.name);
  const list = JSON.parse(lines[1]);
  assert.equal(list.id, 2, "the notification must NOT have produced a line of its own");
  assert.ok(list.result.tools.length === 4);
});
