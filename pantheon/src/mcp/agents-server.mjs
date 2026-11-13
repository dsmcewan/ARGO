// An MCP server over Pantheon's agent store.
//
// WHAT THIS IS FOR, and the constraint that shaped it: NO RUNTIME LOADS AGENTS FROM MCP. Claude
// Code reads `.claude/agents/*.md`, `--agents` JSON, or a plugin; Antigravity reads
// `.agents/agents/<name>/agent.md`; Codex reads plugin-scoped `agents/openai.yaml`. MCP hands a
// running session TOOLS -- it never defines the session. So this server cannot be the place agents
// live for the runtimes; it is the place they are KEPT and RENDERED, and `install_agents` writes
// the result where each runtime already looks.
//
// Checked on this machine 2026-09-28: `~/.codex/agents/` does not exist, `~/.codex/config.toml` has
// no `[agents]` block, and no `agents.toml` exists anywhere under $HOME. The only Codex `agents/`
// directories are inside curated plugins and hold `openai.yaml` interface cards.
//
// TRANSPORT NOTE: the dispatch below is a pure async function from request to response (or null for
// a notification), so the protocol is testable without spawning anything. bin/pantheon-agents-mcp.mjs
// is the thin stdio wrapper.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { listAgents, getAgent } from "../agents/store.mjs";
import { render, renderAll, FORMATS } from "../agents/render.mjs";
import { isUnder } from "../board/ticket-safety.mjs";

const PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = { name: "pantheon-agents", version: "0.1.0" };

const TOOLS = [
  {
    name: "list_agents",
    description: "Every agent seat Pantheon routes to, as role@vendor/model, with the seating " +
      "table's own preference order, band and stated basis. Start here: the ids this returns are " +
      "what get_agent, render_agent and install_agents take.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_agent",
    description: "One seat's full definition: the charter verbatim from src/role/roles.mjs, the " +
      "board and session context it may hold, what it produces, its routing requirements " +
      "(different_vendor for reviewers), and the vendor/role tuning the pipeline actually applies.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "e.g. reviewer@xai/grok-4.7" } },
      required: ["id"], additionalProperties: false,
    },
  },
  {
    name: "render_agent",
    description: "Render one seat into a runtime's on-disk agent format WITHOUT writing it. " +
      "Returns the filename, the file content, and `lost` — every property of the definition that " +
      "format cannot carry. Read `lost`: no format here is lossless.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        format: { type: "string", enum: FORMATS, description: "antigravity | claude-code | codex" },
      },
      required: ["id", "format"], additionalProperties: false,
    },
  },
  {
    name: "install_agents",
    description: "Write rendered agent cards into a project so the runtime finds them. All-or-" +
      "nothing: if any id is unknown, nothing is written. The root must be inside this server's " +
      "allowed tree. Returns what was written and what each conversion lost.",
    inputSchema: {
      type: "object",
      properties: {
        ids: { type: "array", items: { type: "string" }, minItems: 1 },
        format: { type: "string", enum: FORMATS },
        root: { type: "string", description: "absolute path of the project to install into" },
      },
      required: ["ids", "format", "root"], additionalProperties: false,
    },
  },
];

const ok = text => ({ content: [{ type: "text", text }], isError: false });
const fail = text => ({ content: [{ type: "text", text }], isError: true });
const jsonOk = obj => ok(JSON.stringify(obj, null, 2));

/**
 * @param {object} o
 * @param {string} o.allowedRoot - install_agents may only write at or below this directory. There
 *   is no "unset means anywhere" mode: a server that can write anywhere is a remote file writer
 *   wearing an agent store's name.
 */
export function createAgentsServer({ allowedRoot }) {
  if (typeof allowedRoot !== "string" || !allowedRoot) {
    throw new Error("createAgentsServer: allowedRoot is required");
  }

  const callTool = async (name, args = {}) => {
    switch (name) {
      case "list_agents":
        return jsonOk({ agents: listAgents() });

      case "get_agent": {
        if (typeof args.id !== "string" || !args.id) return fail(`get_agent needs an "id" (string); got ${JSON.stringify(args.id)}. Call list_agents for the set.`);
        try { return jsonOk(getAgent(args.id)); } catch (e) { return fail(e.message); }
      }

      case "render_agent": {
        if (typeof args.id !== "string" || !args.id) return fail(`render_agent needs an "id" (string).`);
        if (!FORMATS.includes(args.format)) return fail(`render_agent needs a "format" from: ${FORMATS.join(", ")}; got ${JSON.stringify(args.format)}.`);
        try { return jsonOk(render(getAgent(args.id), args.format)); } catch (e) { return fail(e.message); }
      }

      case "install_agents": {
        const { ids, format, root } = args;
        if (!Array.isArray(ids) || !ids.length) return fail(`install_agents needs a non-empty "ids" array.`);
        if (!FORMATS.includes(format)) return fail(`install_agents needs a "format" from: ${FORMATS.join(", ")}.`);
        if (typeof root !== "string" || !root) return fail(`install_agents needs an absolute "root".`);

        // Containment BEFORE anything is resolved or created. isUnder() realpaths both sides, so a
        // symlink inside the tree pointing out of it does not pass, and "/x-evil" does not pass
        // against "/x" the way a string prefix would.
        const target = resolve(root);
        if (!isUnder(allowedRoot, target)) {
          return fail(`install root "${root}" is outside this server's allowed tree (${allowedRoot}). Nothing was written.`);
        }

        // Render EVERYTHING first. An id that fails halfway through leaves a directory holding some
        // cards and no record of which -- worse than a clean refusal. renderAll also refuses a
        // filename collision, which for antigravity means two seats claiming one role's chair.
        let rendered;
        try { rendered = renderAll(ids.map(getAgent), format); }
        catch (e) { return fail(`${e.message} — nothing was written.`); }

        const written = [];
        for (const r of rendered) {
          const path = join(target, r.filename);
          // Each rendered filename is generated by safeName(), but it is joined onto a caller-
          // supplied root, so it is re-checked rather than trusted.
          if (!isUnder(allowedRoot, path)) return fail(`refusing to write outside the allowed tree: ${r.filename}`);
          mkdirSync(dirname(path), { recursive: true });
          writeFileSync(path, r.content, "utf8");
          written.push({ id: r.id, filename: r.filename, lost: r.lost });
        }
        return jsonOk({
          written, root: target, format,
          note: written.some(w => w.lost.length)
            ? "Some conversions were lossy. Read each entry's `lost` before relying on these cards."
            : "No loss reported for this format.",
        });
      }

      default:
        return fail(`unknown tool "${name}". Available: ${TOOLS.map(t => t.name).join(", ")}.`);
    }
  };

  return {
    /** @returns {Promise<object|null>} null for a notification, which JSON-RPC forbids answering. */
    async handle(req) {
      const isNotification = req?.id === undefined || req?.id === null;
      const reply = payload => (isNotification ? null : { jsonrpc: "2.0", id: req.id, ...payload });

      switch (req?.method) {
        case "initialize":
          return reply({
            result: {
              // Echo a version the client asked for when we know it; otherwise state ours and let
              // the client decide. Asserting the client's unknown version back at it is how a
              // handshake "succeeds" into a protocol neither side implements.
              protocolVersion: req.params?.protocolVersion === PROTOCOL_VERSION
                ? req.params.protocolVersion : PROTOCOL_VERSION,
              capabilities: { tools: { listChanged: false } },
              serverInfo: SERVER_INFO,
            },
          });

        case "notifications/initialized":
        case "notifications/cancelled":
          return null;

        case "ping":
          return reply({ result: {} });

        case "tools/list":
          return reply({ result: { tools: TOOLS } });

        case "tools/call": {
          const result = await callTool(req.params?.name, req.params?.arguments ?? {});
          return reply({ result });
        }

        default:
          return reply({ error: { code: -32601, message: `method not found: ${req?.method}` } });
      }
    },
  };
}
