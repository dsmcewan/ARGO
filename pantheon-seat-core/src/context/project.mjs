// Normalize a vendor transcript to (role, chain-sha, length, tool-names) per turn. NOT raw
// bytes: these are vendor-internal files with no stability contract, so a cosmetic reformat must
// not invalidate every stored hash, while a content change still must (evidence P4b).
//
// Never return content. A projection that carries text ends up in a log line eventually. Every
// content block below (text, thinking, tool arguments, tool results) is folded into a sha256
// digest and never returned itself - only its hash, its length, and (for tools) its NAME move
// past this module.
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const sha256 = s => createHash("sha256").update(s).digest("hex");

// A separator that will not occur in ordinary text, so "ab" + "c" cannot be confused with
// "a" + "bc" once units are joined for hashing.
const UNIT_SEP = "␟";

// Turn a flatten-able string into text, the way a tool result or a plain string turn does.
function flattenText(v) {
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map(flattenText).join("");
  if (v && typeof v === "object") return v.text ?? "";
  return "";
}

// Reduce one message's content (a single string, a single block, or an array of blocks - the
// shape shared by claude/agy/grok transcripts) to an ordered list of hashable "units" plus the
// set of tool names invoked. Every recognized block type contributes something distinguishing:
//   - text: the text itself.
//   - thinking/reasoning: the model's interior deliberation is real per-turn state - two turns
//     that think differently before answering identically are NOT the same turn - so it
//     contributes too, folded straight into the digest and never surfaced as its own field.
//   - tool_use: name AND serialized arguments, so calling the same tool twice with different
//     arguments produces different hashes (root cause: it previously only hashed the name).
//   - tool_result: the result is conversation state the next turn reasons over; previously
//     dropped entirely, which is most of why real transcripts were undercounted.
//   - anything else unrecognized: folded in by its JSON form rather than silently discarded, so
//     an unfamiliar-but-real block still moves the hash instead of vanishing.
function blockUnits(content) {
  const parts = Array.isArray(content) ? content : [content];
  const units = [];
  const tools = [];
  for (const c of parts) {
    if (c == null || c === "") continue;
    if (typeof c === "string") { units.push(`text:${c}`); continue; }
    switch (c.type) {
      case "text":
      case "input_text":
      case "output_text":
        units.push(`text:${c.text ?? ""}`);
        break;
      case "thinking":
      case "reasoning":
        units.push(`thinking:${c.thinking ?? c.text ?? ""}:${c.signature ?? ""}`);
        break;
      case "tool_use":
        if (c.name) tools.push(c.name);
        units.push(`tool_use:${c.name ?? ""}:${JSON.stringify(c.input ?? {})}`);
        break;
      case "tool_result":
        units.push(`tool_result:${flattenText(c.content)}`);
        break;
      default:
        units.push(`other:${c.type ?? typeof c}:${JSON.stringify(c)}`);
    }
  }
  return { units, tools: [...new Set(tools)].sort() };
}

// Fold an ordered unit list into the triple the chain actually consumes. The join is one-way
// (sha256) so len/sha carry a signal, never the material.
function summarize(role, units, tools) {
  const joined = units.join(UNIT_SEP);
  return { role, sha: sha256(joined), len: joined.length, tools };
}

export const PROJECTORS = {
  claude(obj) {
    if (obj.type !== "user" && obj.type !== "assistant") return null;
    const { units, tools } = blockUnits((obj.message ?? obj).content);
    return units.length ? summarize(obj.type, units, tools) : null;
  },
  // Codex rollout lines are response_item envelopes whose payload carries its OWN type
  // (message / reasoning / custom_tool_call / custom_tool_call_output / function_call /
  // function_call_output - observed directly from ~/.codex/sessions/**/*.jsonl). The previous
  // projector only ever read payload.role/payload.content, which matches "message" but treats
  // every other payload type as textless-and-toolless, so it silently dropped reasoning steps
  // and 100% of tool calls/results - most of a real codex transcript.
  codex(obj) {
    if (obj.type !== "response_item") return null;
    const p = obj.payload ?? {};
    // A payload with no explicit "type" but a "content" field is a message (older/simplified
    // shape); real rollout files set payload.type explicitly.
    const ptype = p.type ?? ("content" in p ? "message" : undefined);
    switch (ptype) {
      case "message": {
        const { units, tools } = blockUnits(p.content);
        return units.length ? summarize(p.role ?? "assistant", units, tools) : null;
      }
      case "reasoning": {
        // Codex reasoning arrives pre-encrypted (encrypted_content) or as an opaque summary
        // array - there is nothing to leak - but it is real per-turn state and must still move
        // the hash, or two different reasoning steps collide.
        const sig = p.encrypted_content ?? JSON.stringify(p.summary ?? []);
        if (!sig) return null;
        return summarize("assistant", [`reasoning:${sig}`], []);
      }
      case "custom_tool_call":
      case "function_call": {
        const name = p.name ?? "";
        const args = ptype === "function_call" ? (p.arguments ?? "") : (p.input ?? "");
        return summarize("assistant", [`tool_call:${name}:${args}`], name ? [name] : []);
      }
      case "custom_tool_call_output":
      case "function_call_output": {
        const out = flattenText(p.output);
        return summarize("tool", [`tool_result:${out}`], []);
      }
      default:
        return null;
    }
  },
  // REWRITTEN against a real chat_history.jsonl (2026-09-27). The previous projector tested
  // `obj.type !== "text" && obj.role === undefined` and read obj.content/obj.data. Real grok
  // lines carry NO `role` key at all and never use type "text", so that guard returned null for
  // every line of every file: grok projected to zero turns, universally. It was written from a
  // guess because no grok transcript had been located yet, and nothing failed loudly because a
  // zero-turn projection is indistinguishable from an empty conversation.
  //
  // Observed line types, whole-file census of a 147-line transcript:
  //   system(1) user(3) reasoning(23) assistant(23) tool_result(97)
  grok(obj) {
    switch (obj.type) {
      case "system":
      case "user": {
        const { units, tools } = blockUnits(obj.content);
        return units.length ? summarize(obj.type, units, tools) : null;
      }
      case "assistant": {
        // content and tool_calls are SIBLING fields here, not nested blocks: an assistant turn
        // routinely carries prose plus calls. Hashing only content would collide two turns that
        // say the same thing and call different tools.
        const { units, tools } = blockUnits(obj.content);
        const calls = Array.isArray(obj.tool_calls) ? obj.tool_calls : [];
        for (const c of calls) {
          units.push(`tool_call:${c.name ?? ""}:${JSON.stringify(c.args ?? c.arguments ?? {})}`);
          if (c.name) tools.push(c.name);
        }
        return units.length ? summarize("assistant", units, [...new Set(tools)].sort()) : null;
      }
      case "reasoning": {
        // Encrypted like codex's: opaque, unleakable, and still real per-turn state.
        const sig = obj.encrypted_content ?? JSON.stringify(obj.summary ?? []);
        return sig ? summarize("assistant", [`reasoning:${sig}`], []) : null;
      }
      case "tool_result":
        return summarize("tool", [`tool_result:${flattenText(obj.content)}`], []);
      default:
        return null;
    }
  },
  // agy does NOT write a JSONL transcript. Its store is one SQLite database per conversation, so
  // this projector exists only to fail loudly: the old version accepted `obj.role` and would have
  // reported zero turns for a format it can never receive. Use projectAgyDb() instead.
  agy() {
    throw new Error("agy transcripts are SQLite, not JSONL — use projectAgyDb(path), not projectTranscript()");
  },
};

export function projectTranscript(text, vendor) {
  const project = PROJECTORS[vendor];
  if (!project) throw new Error(`projectTranscript: no projector for vendor "${vendor}"`);
  const turns = [];
  for (const line of String(text).split("\n")) {
    if (!line.trim()) continue;
    let obj;
    try { obj = JSON.parse(line); } catch { continue; } // torn line: skip, never fatal
    let p;
    try { p = project(obj); } catch { continue; }
    if (!p) continue;
    turns.push({ role: p.role, sha: p.sha, len: p.len, tools: p.tools });
  }
  return turns;
}

// agy conversation databases: ~/.gemini/antigravity-cli/conversations/<id>.db, table `steps`,
// one ordered row per step (idx, step_type, status, step_payload BLOB).
//
// The payload is an opaque binary blob, so this projection is DELIBERATELY WEAKER than the JSONL
// ones: it cannot name tools and it cannot separate text from thinking. What it can do is the
// one thing the chain actually requires — give each step a stable content digest in a fixed
// order, so a resumed conversation provably extends the recorded prefix. Saying that plainly
// matters more than a richer-looking projection that guessed at the blob's internals: `tools` is
// always empty here because the names are unreadable, NOT because no tools ran.
export function projectAgyDb(path, { sqlite = DatabaseSync } = {}) {
  const db = new sqlite(path, { readOnly: true });
  try {
    const rows = db.prepare("SELECT idx, step_type, step_payload FROM steps ORDER BY idx").all();
    return rows.map(r => {
      const buf = r.step_payload ?? Buffer.alloc(0);
      const h = createHash("sha256").update(`agy-step:${r.step_type}:`).update(buf).digest("hex");
      return { role: `step:${r.step_type}`, sha: h, len: buf.length, tools: [] };
    });
  } finally {
    db.close();
  }
}
