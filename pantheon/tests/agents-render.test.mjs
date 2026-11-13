import { test } from "node:test";
import assert from "node:assert/strict";
import { render, renderAll, FORMATS } from "../src/agents/render.mjs";
import { getAgent } from "../src/agents/store.mjs";
import { ROLES } from "../src/role/roles.mjs";

const reviewer = getAgent("reviewer@xai/grok-4.7");
const agyReviewer = getAgent("reviewer@agy_google/gemini-3.5-flash");
const implementer = getAgent("implementer@openai/gpt-6-astra");

test("every declared format renders every seat without throwing", () => {
  for (const fmt of FORMATS) {
    for (const a of [reviewer, agyReviewer, implementer]) {
      const out = render(a, fmt);
      assert.ok(out.content.length > 0, `${fmt} rendered ${a.id} as empty`);
      assert.ok(out.filename, `${fmt} gave ${a.id} no filename`);
    }
  }
});

test("an unknown format is refused rather than silently defaulting", () => {
  assert.throws(() => render(reviewer, "yaml-ish"), /unknown format/i);
});

// --- Antigravity: the one runtime here that actually reads agent cards ---

test("the antigravity filename is EXACTLY what agy-seat.py opens", () => {
  // scripts/agy-seat.py load_agent_card(): `repo / ".agents" / "agents" / f"pantheon-{role}" / "agent.md"`.
  // The name is the contract, not a label. A card at pantheon-reviewer-agy-google-gemini-3-5-flash
  // parses perfectly and is never found -- proven by running that loader against a generated card
  // on 2026-09-28 (FileNotFoundError on pantheon-reviewer/agent.md).
  for (const a of [agyReviewer, reviewer]) {
    assert.equal(render(a, "antigravity").filename, `.agents/agents/pantheon-${a.role}/agent.md`);
  }
});

test("two seats of one role are REFUSED for antigravity, not silently renamed", () => {
  // The consumer allows exactly one card per role. Renaming the second to keep both would put it
  // at a path nothing opens -- an install that reports success and changes nothing.
  assert.throws(() => renderAll([reviewer, agyReviewer], "antigravity"), /one card per role|collide/i);
});

test("antigravity renders .agents/agents/<name>/agent.md with real tools", () => {
  const out = render(agyReviewer, "antigravity");
  assert.match(out.filename, /^\.agents\/agents\/[a-z0-9-]+\/agent\.md$/);
  assert.match(out.content, /^---\n/, "the card opens with YAML frontmatter");
  assert.match(out.content, /\n  - run_command\n/, "a sandboxed shell is what makes a repro executable");
  assert.match(out.content, /commandExecutionPolicy: sandbox/);
});

test("an SDK seat rendered for antigravity carries NO tools and says why", () => {
  // Rendering a toolless seat with a tool list would promise a capability the seat does not have.
  const out = render(reviewer, "antigravity");
  assert.doesNotMatch(out.content, /run_command/, "an xai SDK seat cannot run anything");
  assert.ok(out.lost.some(l => /tool/i.test(l)),
    "dropping the tool list is a real loss and must be reported, not silently done");
});

// --- Claude Code ---

test("claude-code renders .claude/agents/<name>.md with tools as a CSV string", () => {
  const out = render(agyReviewer, "claude-code");
  assert.match(out.filename, /^\.claude\/agents\/[a-z0-9-]+\.md$/);
  // Claude Code's frontmatter takes `tools` as a comma-separated string, not a YAML list.
  assert.match(out.content, /\ntools: [A-Za-z]+(, [A-Za-z]+)+\n/);
  assert.doesNotMatch(out.content, /\ntools:\n  - /, "a YAML list here is the Antigravity shape");
});

test("claude-code maps a vendor model onto a Claude tier, and reports the substitution", () => {
  // A Claude Code agent card cannot run grok. The property is that the card must not CLAIM to --
  // in the `model:` field or in the one-line `description:` a picker shows. Naming the origin
  // inside an explicit port warning is the opposite of that claim, so the check is scoped to the
  // two fields that assert what this card is, not to the whole file. (First written as
  // `doesNotMatch(content, /grok/)`, which caught the real defect: the description read "seat on
  // xai/grok-4.7" above `model: opus`.)
  const out = render(reviewer, "claude-code");
  const model = out.content.match(/\nmodel: (.*)\n/)[1];
  const desc = out.content.match(/\ndescription: (.*)\n/)[1];
  assert.equal(model, "opus", "a hard-band seat ports to the opus tier");
  assert.doesNotMatch(desc, /grok|xai/,
    "the description states where this card RUNS; naming the foreign seat here reads as a claim");
  assert.ok(out.lost.some(l => /grok-4\.7/.test(l)),
    "the substitution is a loss of the cross-lab guarantee and must be named");
  assert.match(out.content, /Port warning/,
    "and the card itself must disclose the port, not only the install-time report");
  assert.match(out.content, /isolation this role requires is NOT in force/,
    "a reviewer card that quietly drops different_vendor is the worst thing this store could emit");
});

// --- Codex: the lossy one, and the reason that matters ---

test("codex renders a SEAT SPEC, because Codex has no agent file format at all", () => {
  // Established 2026-09-28 by exhausting the alternatives: no ~/.codex/agents/, no agents.toml,
  // no [agents] in any config.toml, and the published spec says AGENTS.md "does not define agents
  // or subagents". The agent IS the call -- openai_codex/api.py thread_start() takes
  // developer_instructions, sandbox and approval_mode as parameters. So this renders the arguments
  // for that call, not a file some runtime scans for.
  const out = render(reviewer, "codex");
  assert.match(out.filename, /^\.pantheon\/codex-seats\/[a-z0-9-]+\.json$/);
  const spec = JSON.parse(out.content);
  assert.equal(typeof spec.developer_instructions, "string");
  assert.ok(spec.developer_instructions.includes("Attack the artifact"),
    "the charter is what developer_instructions carries");
});

test("only the implementer gets a writable sandbox; every other seat is read-only", () => {
  // Sandbox values are the SDK's own enum: read-only | workspace-write | full-access.
  // The reviewer must never edit the artifact it judges, so a writable sandbox there would hand it
  // the one capability its charter forbids. full-access is never emitted by this store.
  assert.equal(JSON.parse(render(implementer, "codex").content).sandbox, "workspace-write");
  for (const a of [reviewer, agyReviewer]) {
    assert.equal(JSON.parse(render(a, "codex").content).sandbox, "read-only");
  }
});

test("approval_mode is always deny_all -- Pantheon's controller is the approver", () => {
  // auto_review is the SDK default and would let the seat approve its own tool calls mid-turn.
  // Approval here belongs to ship()'s gates, which re-read disk, not to the model being gated.
  for (const a of [reviewer, implementer]) {
    assert.equal(JSON.parse(render(a, "codex").content).approval_mode, "deny_all");
  }
});

test("the codex seat spec carries the cross-lab rule as data, not as prose only", () => {
  // The one routing rule with evidence behind it. thread_start cannot enforce it, so it travels as
  // a field the caller must honour AND is named in lost.
  const out = render(reviewer, "codex");
  assert.equal(JSON.parse(out.content).pantheon.needs_different_vendor, true);
  assert.ok(out.lost.some(l => /different_vendor/.test(l)));
});

test("codex reports losing the token cap -- thread_start has no field for it", () => {
  const out = render(reviewer, "codex");
  assert.doesNotMatch(out.content, /max_tokens|max_output_tokens/);
  assert.ok(out.lost.some(l => /4000/.test(l)));
});

// --- content fidelity, across formats ---

test("the charter reaches every format verbatim, never paraphrased", () => {
  for (const fmt of FORMATS) {
    const out = render(reviewer, fmt);
    const firstClause = ROLES.reviewer.charter.split(".")[0];
    assert.ok(out.content.includes(firstClause),
      `${fmt} lost or reworded the charter; a paraphrase is a second source of truth`);
  }
});

const TRICKY = { ...reviewer, charter: 'Attack it: say "no" when it is wrong.\nSecond line.' };

test("claude-code quotes and escapes the description -- a real YAML parser reads it", () => {
  const desc = render(TRICKY, "claude-code").content.match(/\ndescription: (.*)\n/)[1];
  assert.doesNotMatch(desc, /\n/, "a frontmatter description must stay on one line");
  assert.ok(desc.startsWith('"') && desc.endsWith('"'), "claude-code left the description unquoted");
  assert.doesNotMatch(desc.slice(1, -1), /(?<!\\)"/, "an inner quote must be escaped");
});

test("antigravity does NOT quote the description, because its loader keeps the quotes", () => {
  // agy-seat.py's frontmatter parser is `key, _, val = raw.partition(":")` with no unquoting, so a
  // quoted value arrives as the literal string `"Pantheon's reviewer seat..."`. Observed by running
  // that loader on 2026-09-28. Quoting here corrupts the value in the consumer.
  const desc = render(TRICKY, "antigravity").content.match(/\ndescription: (.*)\n/)[1];
  assert.doesNotMatch(desc, /\n/, "partition() on a multi-line value truncates at the newline");
  assert.ok(!desc.startsWith('"'),
    "a leading quote reaches agy-seat.py verbatim; its parser never strips one");
  // partition() splits on the FIRST colon only, so a colon inside the value is safe unquoted.
  assert.match(desc, /Attack it: say/, "the inner colon must survive, not be escaped away");
});

test("the rendered name is a safe filename, with no slash or dot from the model id", () => {
  // The id is `reviewer@xai/grok-4.7`: a slash that becomes a directory and a dot that becomes an
  // extension if either reaches the filename unfiltered.
  const out = render(reviewer, "claude-code");
  const base = out.filename.split("/").pop().replace(/\.md$/, "");
  assert.match(base, /^[a-z0-9-]+$/, `"${base}" is not a safe basename`);
  assert.ok(base.includes("reviewer") && base.includes("xai"),
    "the name must still identify which seat this is");
});

test("two different seats of the same role render to different filenames", () => {
  // Both are `reviewer`. A name derived from the role alone would have the agy card overwrite the
  // xai card on install -- one file, silently, with the wrong tools.
  assert.notEqual(render(reviewer, "claude-code").filename,
    render(agyReviewer, "claude-code").filename);
});
