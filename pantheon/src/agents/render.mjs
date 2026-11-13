// Rendering one canonical agent definition into each runtime's on-disk format.
//
// THE FORMATS ARE NOT EQUIVALENT, and the differences were established by reading the files that
// actually exist on this machine rather than the published docs:
//
//   antigravity  .agents/agents/<name>/agent.md   YAML frontmatter, a real `tools:` LIST, a real
//                                                 sandbox policy. The only one of the three whose
//                                                 tool grants and execution policy genuinely bind.
//                                                 Read from Projects/pantheon/.agents/agents/*.
//   claude-code  .claude/agents/<name>.md         YAML frontmatter, `tools` as a CSV STRING, and a
//                                                 `model` that must name a Claude tier -- this
//                                                 runtime cannot run grok or gemini.
//   codex        .pantheon/codex-seats/<n>.json   NOT a runtime-discovered file -- Codex has no
//                                                 agent file format at all. The agent is the CALL:
//                                                 openai_codex thread_start() takes
//                                                 developer_instructions, sandbox and
//                                                 approval_mode. This renders that call's
//                                                 arguments for scripts/codex-seat.py to splat.
//                                                 (An earlier version of this renderer emitted an
//                                                 `agents/openai.yaml` interface card, copying the
//                                                 curated plugins. That was a dead end: the card
//                                                 holds a display name and one prompt string, and
//                                                 nothing would ever have loaded it as a role.)
//
// BECAUSE THEY ARE NOT EQUIVALENT, EVERY RENDER REPORTS WHAT IT DROPPED. `lost` is the same idea as
// contextFor()'s `withheld`: a conversion that quietly discards the reviewer's `different_vendor`
// requirement would turn the one routing rule this project has evidence for into a comment. A
// caller that wants to refuse a lossy install can read `lost` and do so.
import { VENDOR_TUNING } from "./store.mjs";

export const FORMATS = ["antigravity", "claude-code", "codex"];

// The tools an Antigravity chair gets, by role -- transcribed from the cards already on disk at
// .agents/agents/pantheon-{reviewer,scout,planner,fact-checker}/agent.md rather than invented.
const AGY_TOOLS = {
  base: ["view_file", "grep_search", "find_by_name", "list_dir"],
  reviewer: ["run_command", "invoke_subagent", "send_message"],
  scout: ["run_command", "search_web", "read_url_content", "send_message"],
  planner: ["send_message"],
  implementer: ["run_command", "send_message"],
  judge: ["send_message"],
  explorer: ["send_message"],
  advocate: ["send_message"],
};

// Claude Code tool names for the same capabilities. A card that listed Antigravity's names would
// grant nothing: the runtime does not know what `view_file` is.
const CC_TOOLS = {
  base: ["Read", "Grep", "Glob"],
  withShell: ["Bash"],
};

/** Which Claude tier a seat becomes when its own model cannot run in Claude Code. */
const CLAUDE_TIER_FOR_BAND = { hard: "opus", medium: "sonnet", easy: "haiku" };

/**
 * The card's name, which for Antigravity is a CONTRACT and not a label.
 *
 * scripts/agy-seat.py load_agent_card() opens exactly
 * `<repo>/.agents/agents/pantheon-<role>/agent.md`. A vendor-suffixed name parses perfectly and is
 * never opened -- proved on 2026-09-28 by running that loader against a generated card, which
 * raised FileNotFoundError on pantheon-reviewer/agent.md while the same bytes at the expected path
 * parsed clean. So antigravity gets the role name and nothing else.
 *
 * Claude Code discovers any `*.md` under `.claude/agents/`, so there the vendor stays in the name:
 * a ported xai reviewer and a native anthropic one are different cards and must not overwrite.
 */
export function safeName(agent, format = "claude-code") {
  const raw = format === "antigravity"
    ? `pantheon-${agent.role}`
    : `pantheon-${agent.role}-${agent.vendor}${agent.model ? `-${agent.model}` : ""}`;
  return raw.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/** A YAML double-quoted scalar: one line, inner quotes and backslashes escaped.
 *  A frontmatter description that keeps a newline is a card that fails to parse at load time. */
function yamlString(s) {
  const flat = String(s).replace(/\s+/g, " ").trim();
  return `"${flat.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** The one-line description every format wants, built from the parts every role has.
 *
 *  `seatLabel` overrides where this card actually runs. It exists because a Claude Code card runs on
 *  anthropic whatever the seat says, and a description reading "seat on xai/grok-4.7" above a
 *  `model: opus` line is a card that lies to anyone skimming the directory. The port is disclosed in
 *  the body and in `lost`; the one-line description states where it runs, not where it came from. */
function describe(agent, seatLabel = null) {
  const seat = seatLabel
    ?? (agent.model ? `${agent.vendor}/${agent.model}` : `${agent.vendor} (rung resolved at seat time)`);
  const iso = agent.needs.includes("different_vendor") && !seatLabel
    ? " Must not share a lab with the maker." : "";
  return `Pantheon's ${agent.role} seat on ${seat}. ${agent.charter}${iso}`;
}

/** The shared prose body: charter, what it may see, what it produces.
 *  `notes` are appended verbatim, for disclosures that belong in the card rather than only in `lost`. */
function body(agent, notes = []) {
  const lines = [
    "# System Prompt",
    "",
    `You are seated as Pantheon's \`${agent.role}\`. The charter, quoted from \`src/role/roles.mjs\`:`,
    "",
    ...agent.charter.split("\n").map(l => `> ${l}`),
    "",
    "# What you may see",
    "",
    `Board context: ${agent.context.join(", ") || "none"}.`,
    `Session context: ${agent.session.join(", ") || "none — you keep no diary."}`,
  ];
  if (agent.needs.includes("different_vendor")) {
    lines.push("", "You must not share a lab with whoever produced what you are judging. This is " +
      "enforced by `assertReviewCutsAcross`, not left to your discretion.");
  }
  if (agent.tuning.toolless) {
    lines.push("", "You have NO tools in this seat: nothing you write executes and you cannot read " +
      "files. Answer from what is in front of you.");
  }
  if (agent.tuning.tokens) {
    lines.push("", `Keep your answer under roughly ${agent.tuning.tokens} tokens; the seat is capped there.`);
  }
  lines.push("", "# Produce", "", agent.produces);
  for (const n of notes) lines.push("", n);
  return lines.join("\n");
}

function renderAntigravity(agent) {
  const lost = [];
  const toolless = agent.tuning.toolless;
  const tools = toolless ? [] : [...CC_TOOLS.base.map(() => null).filter(Boolean),
    ...AGY_TOOLS.base, ...(AGY_TOOLS[agent.role] ?? ["send_message"])];
  if (toolless) {
    lost.push(`tools: this is an SDK seat (${agent.vendor}), which has no tool access at all, so the ` +
      `card grants none — an Antigravity card with tools would promise a capability the seat lacks`);
  }
  if (agent.model && VENDOR_TUNING[agent.vendor]?.runtime !== "antigravity") {
    lost.push(`model: "${agent.model}" is a ${agent.vendor} model; this card uses \`model: inherit\` ` +
      `because Antigravity runs its own`);
  }

  const fm = [
    "---",
    `name: ${safeName(agent, "antigravity")}`,
    // NOT yamlString(): agy-seat.py parses frontmatter as `key, _, val = raw.partition(":")` and
    // never strips quotes, so a quoted value reaches the seat as the literal string `"..."`.
    // partition() splits on the first colon only, so an inner colon is safe; a newline is not,
    // hence the flatten. Observed by running that loader against a generated card, 2026-09-28.
    `description: ${String(describe(agent)).replace(/\s+/g, " ").trim()}`,
  ];
  if (tools.length) {
    fm.push("tools:", ...tools.map(t => `  - ${t}`));
  }
  fm.push(
    `mainAgent: ${agent.role !== "scout" ? "true" : "true"}`,
    `subagent: ${agent.mayJudge ? "false" : "true"}`,
    "model: inherit",
    `commandExecutionPolicy: ${tools.includes("run_command") ? "sandbox" : "deny"}`,
    "---",
    "",
  );
  return {
    filename: `.agents/agents/${safeName(agent, "antigravity")}/agent.md`,
    content: fm.join("\n") + body(agent) + "\n",
    lost,
  };
}

function renderClaudeCode(agent) {
  const lost = [];
  const tools = agent.tuning.toolless
    ? [...CC_TOOLS.base]
    : [...CC_TOOLS.base, ...CC_TOOLS.withShell];
  if (agent.tuning.toolless) {
    lost.push(`shell: this is a toolless ${agent.vendor} SDK seat, so the card grants read-only ` +
      `tools — a Claude Code agent always has some, which the original seat does not`);
  }

  // A Claude Code card runs on Claude. Naming the seat's real model -- in the `model:` field OR in
  // the description above it -- produces a card that reads as the foreign seat and silently runs on
  // something else. The port is disclosed in the body, where it is a warning rather than a claim.
  let model = "sonnet";
  const notes = [];
  if (agent.vendor === "anthropic") {
    model = agent.model?.includes("opus") ? "opus" : agent.model?.includes("haiku") ? "haiku" : "sonnet";
  } else {
    model = CLAUDE_TIER_FOR_BAND[agent.band] ?? "sonnet";
    lost.push(`model: "${agent.model ?? agent.vendor}" cannot run in Claude Code; substituted the ` +
      `"${model}" tier by band. The cross-lab isolation this seat exists for is NOT preserved by ` +
      `this card — it runs on anthropic like every other Claude Code agent`);
    notes.push("# Port warning\n\n" +
      `This card is a port. The seat it describes is a ${agent.vendor} one, which this runtime ` +
      `cannot run, so it executes on the ${model} tier instead.` +
      (agent.needs.includes("different_vendor")
        ? " That means the cross-lab isolation this role requires is NOT in force here: every " +
          "Claude Code agent shares one lab. Use the Pantheon pipeline, not this card, when the " +
          "isolation is the point."
        : ""));
  }

  const fm = [
    "---",
    `name: ${safeName(agent)}`,
    `description: ${yamlString(describe(agent, `Claude Code, ${model} tier`))}`,
    `tools: ${tools.join(", ")}`,
    `model: ${model}`,
    "---",
    "",
  ];
  return { filename: `.claude/agents/${safeName(agent)}.md`, content: fm.join("\n") + body(agent, notes) + "\n", lost };
}

/**
 * Codex is seated through the SDK CALL, not through a file.
 *
 * CORRECTION, 2026-09-28: an earlier version of this comment claimed Codex has no agent file
 * format at all. That was wrong, and wrong in an instructive way -- it generalised "absent on this
 * machine" into "does not exist". Codex DOES document standalone TOML custom agents under
 * `~/.codex/agents/` or `.codex/agents/`, requiring name/description/developer_instructions, with
 * optional model, model_reasoning_effort, sandbox_mode, mcp_servers and skills.config, plus
 * `[agents]` defaults in config.toml. Neither directory exists here, which is all the filesystem
 * search actually established.
 *
 * Pantheon still renders the CALL rather than that file, for a reason that survives the
 * correction: a custom agent file pins one model and one sandbox for a named agent a user
 * maintains, while a Pantheon seat is chosen per run by the seating table and must carry the
 * cross-lab rule. thread_start() takes those per call; a TOML file cannot.
 *
 * What DOES carry a role is `openai_codex.Codex.thread_start()`, whose signature takes
 * `developer_instructions`, `sandbox`, `approval_mode`, `model`, `cwd` and `ephemeral` (Python SDK
 * 0.158.0, version-matched to the npm CLI). So this renders the arguments for that call.
 *
 * The file is a seat spec under `.pantheon/`, not something a runtime scans for -- scripts/
 * codex-seat.py reads it. Writing it anywhere a runtime globs would invite the failure the
 * antigravity naming bug already caused: a file that parses and is never used.
 */
function renderCodexSeat(agent) {
  const lost = [];

  // Sandbox is the SDK's own enum: read-only | workspace-write | full-access. Only the seat whose
  // charter is "produce the artifact" gets to write; a reviewer with a writable sandbox holds the
  // one capability its charter forbids. full-access is never emitted -- nothing here needs to
  // escape the workspace, and a store that can hand out full-access is a liability.
  const sandbox = agent.role === "implementer" ? "workspace-write" : "read-only";

  if (sandbox === "workspace-write") {
    // Not a Pantheon rule -- Codex's own sandbox enforces it: "<writable_root>/.git is protected
    // as read-only... <writable_root>/.agents is protected as read-only... Protection is
    // recursive." A seat that cannot write .git cannot publish a board ref, and one that cannot
    // write .agents cannot install an agent card. Said here rather than discovered at run time.
    lost.push("write scope: Codex's workspace-write sandbox protects <root>/.git, <root>/.agents " +
      "and <root>/.codex as READ-ONLY, recursively. This seat cannot publish a board ref or " +
      "install an agent card; it can only write ordinary files in the worktree " +
      "(kb/openai-agent-docs/codex/agent-approvals-security.md)");
  }
  if (agent.tuning.tokens) {
    lost.push(`output cap of ${agent.tuning.tokens} tokens: thread_start() has no field for it ` +
      `(the pipeline applies it as "${agent.tuning.capShape}"). Enforce it at the caller`);
  }
  if (agent.needs.includes("different_vendor")) {
    lost.push("needs: different_vendor is a routing rule about WHO may occupy this seat. " +
      "thread_start() cannot enforce it; it travels below as pantheon.needs_different_vendor and " +
      "the caller must honour it, exactly as assertReviewCutsAcross does in-pipeline");
  }
  if (agent.model && agent.vendor !== "openai") {
    lost.push(`model: "${agent.model}" is a ${agent.vendor} model. Codex would need a matching ` +
      `model_provider; the id is recorded but not set, so the seat keeps Codex's own default`);
  }

  const spec = {
    // Exactly the thread_start() keyword arguments, named as the SDK names them, so the seat
    // script can splat this without a translation layer that could drift.
    developer_instructions: body(agent),
    sandbox,
    // deny_all, never auto_review. CORRECTED 2026-09-28: an earlier comment here claimed
    // auto_review lets a seat approve its own tool calls. It does not -- the docs say "eligible
    // approval requests are reviewed by Auto-review instead of surfacing to the user", which is a
    // separate reviewer, not self-approval. deny_all is still correct, for the real reason: an
    // unattended Pantheon run has no user to surface to, and approval belongs to ship()'s gates,
    // which re-read disk. Matches the documented CI posture, "--sandbox read-only
    // --ask-for-approval never". (kb/openai-agent-docs/codex/agent-approvals-security.md)
    approval_mode: "deny_all",
    // UNDOCUMENTED PARAMETER. `ephemeral` is in thread_start()'s signature (openai_codex 0.158.0
    // api.py:143) but no page in the mirrored docs explains what it does to a thread -- lifetime,
    // storage and persistence are all unstated. Emitted because a Pantheon seat IS one turn and
    // the board holds continuity, so the intent matches the name; flagged because a name is not a
    // specification. If a seat behaves oddly across turns, suspect this line first.
    ephemeral: true,
    ...(agent.model && agent.vendor === "openai" ? { model: agent.model } : {}),

    // Everything below is Pantheon's, not the SDK's, and is namespaced so the two never collide.
    pantheon: {
      id: agent.id,
      role: agent.role,
      vendor: agent.vendor,
      model: agent.model,
      needs_different_vendor: agent.needs.includes("different_vendor"),
      may_judge: agent.mayJudge,
      context: agent.context,
      session: agent.session,
      produces_kinds: agent.produces_kinds,
      token_cap: agent.tuning.tokens,
    },
  };
  return {
    filename: `.pantheon/codex-seats/${safeName(agent)}.json`,
    content: JSON.stringify(spec, null, 2) + "\n",
    lost,
  };
}

const RENDERERS = {
  antigravity: renderAntigravity,
  "claude-code": renderClaudeCode,
  codex: renderCodexSeat,
};

/**
 * @returns {{filename: string, content: string, lost: string[]}} `lost` names every property of the
 *   definition this format cannot carry. It is never empty for a lossy conversion, and a caller
 *   that installs without reading it has chosen to.
 */
export function render(agent, format) {
  const fn = RENDERERS[format];
  if (!fn) throw new Error(`unknown format "${format}": expected one of ${FORMATS.join(", ")}`);
  return fn(agent);
}

/**
 * Render a set for one install, refusing a filename collision instead of resolving it.
 *
 * Antigravity allows exactly ONE card per role (the loader opens `pantheon-<role>/agent.md` by
 * role alone), so two seats of the same role in one install are a genuine conflict. Renaming the
 * second to keep both would put it at a path nothing ever opens -- an install that reports success
 * and changes nothing, which is the failure mode this whole module is built to refuse. The caller
 * picks which seat holds the chair.
 */
export function renderAll(agents, format) {
  const out = [];
  const byFile = new Map();
  for (const a of agents) {
    const r = render(a, format);
    const prior = byFile.get(r.filename);
    if (prior) {
      throw new Error(
        `${format} allows one card per role: "${a.id}" and "${prior}" both render to ` +
        `${r.filename}, so they collide. Install one, or use a format that keeps them apart.`);
    }
    byFile.set(r.filename, a.id);
    out.push({ id: a.id, ...r });
  }
  return out;
}
