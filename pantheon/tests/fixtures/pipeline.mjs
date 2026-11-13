
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { modelId } from "../../src/config/models.mjs";

export async function withPipeline(fn) {
  const repo = mkdtempSync(join(tmpdir(), "pantheon-lifecycle-"));
  const before = { cooldown: process.env.PANTHEON_COOLDOWN_DIR, cli: process.env.PANTHEON_AGY_CLI };
  process.env.PANTHEON_COOLDOWN_DIR = join(repo, "cooldowns");
  process.env.PANTHEON_AGY_CLI = "/nonexistent/offline-fixture";
  let n = 0;
  const calls = [];
  let implement = () => "export const ok = true;\n";
  const answer = (vendor, req) => {
    const prompt = String(req.input ?? req.messages?.at(-1)?.content ?? req.contents ?? "");
    calls.push({ vendor, prompt });
    if (/VERDICT/i.test(prompt)) return /exited 1\b/.test(prompt) ? "VERDICT: request_changes" : "VERDICT: approve";
    if (/TITLE:/i.test(prompt)) return "TITLE: fixture change";
    if (/RAN: nothing/i.test(prompt)) return "RAN: nothing";
    return implement(prompt);
  };
  const makeClientFor = vendor => ({
    responses: { create: async req => {
      const text = answer(vendor, req), id = `fixture_${++n}`;
      return { async *[Symbol.asyncIterator]() {
        yield { type: "response.created", response: { id } };
        yield { type: "response.output_text.delta", delta: text };
        yield { type: "response.completed", response: { id, output_text: text, output: [
          { type: "message", content: [{ type: "output_text", text }] }] } };
      } };
    } },
    messages: { create: async req => {
      const text = answer(vendor, req);
      return { async *[Symbol.asyncIterator]() {
        yield { type: "content_block_delta", delta: { type: "text_delta", text } };
        yield { type: "message_stop" };
      } };
    } },
  });
  const seat = (vendor, model) => ({ vendor, model, pool: vendor, rank: 0, basis: "OPERATOR", why: "offline fixture" });
  const opts = { dir: join(repo, "board"), makeClientFor, scouts: ["xai"], revisions: 1,
    seatOverrides: {
      planner: seat("anthropic", modelId("anthropic", "fable")),
      implementer: seat("openai", modelId("openai", "astra")),
      reviewer: seat("xai", modelId("xai", "grok-4.6")),
    } };
  try { return await fn({ repo, opts, calls, implement: fn => { implement = fn; } }); }
  finally {
    for (const [k, v] of [["PANTHEON_COOLDOWN_DIR", before.cooldown], ["PANTHEON_AGY_CLI", before.cli]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    rmSync(repo, { recursive: true, force: true });
  }
}
