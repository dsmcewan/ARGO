#!/usr/bin/env node
// stdio transport for the Pantheon agent store MCP server.
//
// Thin on purpose: every decision lives in src/mcp/agents-server.mjs, which is a pure request ->
// response function and is tested as one. What is here and nowhere else is the framing -- line-
// delimited JSON on stdin/stdout -- and the rule that NOTHING but a JSON-RPC response may ever
// reach stdout. A stray console.log here corrupts the stream for the client; diagnostics go to
// stderr, which is why the error paths below write there.
//
// Register with Claude Code:
//   claude mcp add pantheon-agents -- /usr/bin/node <repo>/bin/pantheon-agents-mcp.mjs
// Register with Codex (~/.codex/config.toml):
//   [mcp_servers.pantheon-agents]
//   command = "/usr/bin/node"
//   args = ["<repo>/bin/pantheon-agents-mcp.mjs"]
import { createInterface } from "node:readline";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createAgentsServer } from "../src/mcp/agents-server.mjs";

// Where install_agents is permitted to write. Defaults to the workspace that holds this repo, so
// installing into a sibling project works, and nothing outside it does. Override deliberately.
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const allowedRoot = process.env.PANTHEON_AGENTS_ROOT || resolve(REPO, "..");

const server = createAgentsServer({ allowedRoot });
const out = line => process.stdout.write(line + "\n");

createInterface({ input: process.stdin, crlfDelay: Infinity }).on("line", async line => {
  const trimmed = line.trim();
  if (!trimmed) return;

  let req;
  try {
    req = JSON.parse(trimmed);
  } catch {
    // A parse error has no id to correlate, so it is reported with the null id JSON-RPC specifies
    // rather than dropped -- a silently ignored malformed frame looks like a hung server.
    out(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }));
    return;
  }

  try {
    const res = await server.handle(req);
    if (res) out(JSON.stringify(res));
  } catch (e) {
    process.stderr.write(`pantheon-agents: ${e?.stack ?? e}\n`);
    if (req?.id !== undefined && req?.id !== null) {
      out(JSON.stringify({ jsonrpc: "2.0", id: req.id, error: { code: -32603, message: String(e?.message ?? e) } }));
    }
  }
});

process.stdin.on("end", () => process.exit(0));
