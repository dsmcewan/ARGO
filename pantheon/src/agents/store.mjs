// The canonical (role × model) agent store.
//
// WHY THIS EXISTS. Three runtimes on this machine each look for agent definitions in a different
// place and a different format:
//
//   Antigravity    .agents/agents/<name>/agent.md   -- YAML frontmatter, real tools, real sandbox
//   Claude Code    .claude/agents/<name>.md         -- YAML frontmatter, tools as a CSV string
//   Codex          .codex/agents/<name>.toml        -- TOML, developer_instructions
//
// None of them can load an agent definition FROM an MCP server: MCP hands a session tools, it does
// not define the session. So a central store cannot be a place the runtimes read; it has to be a
// place that RENDERS, and something writes the result where each runtime already looks. That is the
// whole architecture, and it is why this file holds definitions rather than files.
//
// WHAT IS AND IS NOT DUPLICATED HERE. Nothing. Every field is read from the table that already
// decides it -- ROLES for the charter and the context policy, SEATING/INTAKE for who sits where,
// models.json for the id spelling. src/config/models.mjs exists because a second copy of a model id
// drifts from the first; a store that re-typed those would be the fourth copy and the same bug
// waiting. (The example this comment used to cite had the ids BACKWARDS -- see router.mjs; the
// duplication was real, the direction was not, which is its own argument for one source.) The only NEW knowledge in this file is the
// tuning table below, and that is transcribed from src/board/run-item.mjs with line references.
import { ROLES } from "../role/roles.mjs";
import { SEATING, INTAKE } from "../role/seating.mjs";

/**
 * Per-vendor facts a rendered agent has to carry, read off the pipeline rather than assumed.
 *
 * `capShape` is the request key that actually caps output for this vendor -- run-item.mjs capFor()
 * (src/board/run-item.mjs:57-60). Emitting the wrong key does not cap anything, it just adds an
 * ignored field, which is the failure mode that looks like success.
 *
 * `toolless` records whether the seat gets the NO_TOOLS preamble. Every SDK seat does; the agy seat
 * has it stripped (run-item.mjs:167) because it runs in a real agent runtime with real tools. Same
 * role on two labs therefore needs opposite preambles, which is precisely the thing a single
 * role-level prompt string cannot express.
 */
export const VENDOR_TUNING = {
  openai:     { capShape: "max_output_tokens",       toolless: true,  runtime: "sdk" },
  xai:        { capShape: "max_output_tokens",       toolless: true,  runtime: "sdk" },
  anthropic:  { capShape: "max_tokens",              toolless: true,  runtime: "sdk" },
  agy_google: { capShape: "config.maxOutputTokens",  toolless: false, runtime: "antigravity" },
};

/**
 * Per-role output caps, also transcribed from run-item.mjs.
 *
 * scout 700 (line 317): a scout answers in at most four sentences, and grok-4.6 once returned 82k
 * characters to that prompt. reviewer 4000 (line 538) with an 800-token re-ask (line 545) for when
 * the first reply ends without the required VERDICT line.
 *
 * A role absent from this table is deliberately uncapped -- the implementer emits a whole file, so
 * a cap on it would truncate the artifact.
 */
export const ROLE_TUNING = {
  scout:    { tokens: 700 },
  reviewer: { tokens: 4000, reaskTokens: 800 },
};

/**
 * Seats where a role's cap does NOT apply, keyed by role.
 *
 * A cap is a role-level rule with model-level exceptions, and the exception has to live beside the
 * rule or the two drift. This one was found drifting within minutes of being created: run-item.mjs
 * learned to skip the scout cap for the multi-agent model while this table still reported 700, so a
 * rendered card for that seat would have instructed it to "keep your answer under roughly 700
 * tokens" -- an instruction the pipeline no longer sends and the vendor would not honour.
 *
 * grok-4.20-multi-agent: docs.x.ai states "The max_tokens parameter is not currently supported by
 * the multi-agent model variant", and the model runs sixteen subagents whose output is a synthesis.
 * Capping it would pay for a research team and read four sentences.
 */
export const UNCAPPED = { scout: ["grok-4.20-multi-agent"] };

/** The output cap for a seat, or null when this role does not cap or this model is excepted.
 *  Imported by src/board/run-item.mjs so the pipeline and the store cannot disagree. */
export function tokenCapFor(role, model) {
  if (UNCAPPED[role]?.includes(model)) return null;
  return ROLE_TUNING[role]?.tokens ?? null;
}

/** `role@vendor/model`, or `role@vendor` when the rung is resolved at seat time. */
export function agentId({ role, vendor, model }) {
  return model ? `${role}@${vendor}/${model}` : `${role}@${vendor}`;
}

/**
 * Every seat this project actually routes to, in the seating table's own preference order.
 *
 * INTAKE is folded in alongside SEATING because a scout is a real occupiable seat even though it
 * sits outside the board -- listing only SEATING would hide the entire intake stage from anything
 * reading this store.
 */
export function listAgents({ seating = SEATING, intake = INTAKE } = {}) {
  const out = [];
  for (const [role, chairs] of [...Object.entries(seating), ...Object.entries(intake)]) {
    for (const chair of chairs) {
      out.push({
        id: agentId({ role, vendor: chair.vendor, model: chair.model ?? null }),
        role,
        vendor: chair.vendor,
        // A tier-seated chair names no model: the rung comes from router facts when the seat is
        // taken. Resolving it here would invent a spelling this file has no business owning.
        model: chair.model ?? null,
        tier: chair.tier ?? null,
        band: chair.band ?? null,
        basis: chair.basis,
        why: chair.why,
      });
    }
  }
  return out;
}

/**
 * One fully resolved definition: the role's charter and context policy verbatim from ROLES, the
 * seat's vendor and rung, and the merged tuning.
 *
 * @param {string} id - as produced by agentId()
 */
export function getAgent(id, opts = {}) {
  const listed = listAgents(opts).find(a => a.id === id);
  if (!listed) {
    throw new Error(`unknown agent "${id}": not a seat this project routes to. ` +
      `Call listAgents() for the set.`);
  }
  const spec = ROLES[listed.role];
  if (!spec) throw new Error(`unknown role "${listed.role}" for agent "${id}"`);

  const vendorTuning = VENDOR_TUNING[listed.vendor];
  if (!vendorTuning) {
    // A vendor in SEATING with no tuning entry would render an agent with no cap shape and no
    // preamble decision -- silently wrong rather than absent. Refuse instead.
    throw new Error(`no VENDOR_TUNING for vendor "${listed.vendor}" (agent "${id}"): ` +
      `add it alongside the adapter rather than rendering an untuned seat`);
  }

  return {
    ...listed,
    charter: spec.charter,
    produces: spec.produces,
    produces_kinds: spec.produces_kinds,
    context: spec.context,
    session: spec.session ?? [],
    needs: spec.needs ?? [],
    mayJudge: Boolean(spec.mayJudge),
    preBoard: Boolean(spec.preBoard),
    advocacy: Boolean(spec.advocacy),
    tuning: {
      ...vendorTuning,
      tokens: tokenCapFor(listed.role, listed.model),
      reaskTokens: ROLE_TUNING[listed.role]?.reaskTokens ?? null,
    },
  };
}
