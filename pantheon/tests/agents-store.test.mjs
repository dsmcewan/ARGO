import { test } from "node:test";
import assert from "node:assert/strict";
import { listAgents, getAgent, agentId, VENDOR_TUNING, ROLE_TUNING } from "../src/agents/store.mjs";
import { ROLES } from "../src/role/roles.mjs";

// The store's whole value is that it DERIVES from the tables that already decide these things --
// ROLES for what a seat may see, SEATING for who sits there, models.json for the id spelling. A
// store that carried its own copy would be a fourth place to correct a model id, which is the
// exact duplication src/config/models.mjs exists to have ended.

test("every listed agent names a role that actually exists in ROLES", () => {
  for (const a of listAgents()) {
    assert.ok(ROLES[a.role], `listed agent ${a.id} names role "${a.role}", which ROLES does not define`);
  }
});

test("the implementer ladder leads with agy_google, then the three openai rungs, in the seating table's order", () => {
  // agy_google/claude-sonnet-4-6 added 2026-09-29 (operator instruction: "The implementers will be
  // Sonnet 4.6 through Agy as well") -- see seating.mjs's implementer table for the full reasoning.
  const impl = listAgents().filter(a => a.role === "implementer");
  assert.deepEqual(impl.map(a => a.model), ["claude-sonnet-4-6", "gpt-6-astra", "gpt-6-sol", "gpt-6-luna"],
    "these are the rungs the ticket's per-slot model choice picks between");
  assert.equal(impl[0].vendor, "agy_google", "the operator's new top rung");
  assert.ok(impl.slice(1).every(a => a.vendor === "openai"), "SURFACE still seats the rest of this ladder on one lab");
});

test("scout is listed even though it sits OUTSIDE the board -- it comes from INTAKE, not SEATING", () => {
  const scouts = listAgents().filter(a => a.role === "scout");
  assert.ok(scouts.length >= 2, "intake wants at least two independent pools");
  // agy_google's INTAKE.scout entry is commented out (2026-09-29: flapping HTTP 402s made an
  // unreliable scout worse than no scout) -- see seating.mjs. Restore "agy_google" here in the same
  // change that restores that entry.
  assert.deepEqual([...new Set(scouts.map(s => s.vendor))].sort(), ["openai", "xai"]);
});

test("a tier-seated chair reports model null rather than inventing a spelling", () => {
  // SEATING.judge's anthropic entry carries `tier: "strong"`, not a model id: the rung is resolved
  // from router facts at seat time. Guessing one here would be a fourth copy of a model id.
  const judge = listAgents().find(a => a.role === "judge" && a.vendor === "anthropic");
  assert.equal(judge.model, null, "a tier-seated entry has no model id to report");
  assert.equal(judge.tier, "strong");
});

test("an agent id is role@vendor/model, and round-trips through getAgent", () => {
  assert.equal(agentId({ role: "reviewer", vendor: "xai", model: "grok-4.7" }), "reviewer@xai/grok-4.7");
  const a = getAgent("reviewer@xai/grok-4.7");
  assert.equal(a.role, "reviewer");
  assert.equal(a.vendor, "xai");
  assert.equal(a.model, "grok-4.7");
});

test("a tier-seated id round-trips without a model segment", () => {
  const a = getAgent("judge@anthropic");
  assert.equal(a.role, "judge");
  assert.equal(a.model, null);
});

test("getAgent carries the role's charter and context policy VERBATIM from ROLES", () => {
  const a = getAgent("reviewer@xai/grok-4.7");
  assert.equal(a.charter, ROLES.reviewer.charter, "a paraphrased charter is a second source of truth");
  assert.deepEqual(a.context, ROLES.reviewer.context);
  assert.deepEqual(a.session, ROLES.reviewer.session);
  assert.deepEqual(a.needs, ROLES.reviewer.needs);
});

test("getAgent refuses an unknown id rather than returning a hollow definition", () => {
  assert.throws(() => getAgent("implementer@nobody/gpt-9"), /unknown/i);
  assert.throws(() => getAgent("notarole@openai/gpt-6-sol"), /unknown/i);
});

test("the reviewer's cross-lab requirement travels with the definition", () => {
  const a = getAgent("reviewer@xai/grok-4.7");
  assert.ok(a.needs.includes("different_vendor"),
    "the one routing rule with evidence behind it must not be lost in the export");
});

// --- tunings: these are read off the pipeline, not invented ---

test("each vendor's token-cap SHAPE matches what run-item.mjs actually sends", () => {
  // src/board/run-item.mjs capFor(): agy_google -> config.maxOutputTokens, anthropic -> max_tokens,
  // everything else -> max_output_tokens. A renderer that emits the wrong key caps nothing.
  assert.equal(VENDOR_TUNING.agy_google.capShape, "config.maxOutputTokens");
  assert.equal(VENDOR_TUNING.anthropic.capShape, "max_tokens");
  assert.equal(VENDOR_TUNING.openai.capShape, "max_output_tokens");
  assert.equal(VENDOR_TUNING.xai.capShape, "max_output_tokens");
});

test("agy_google is the only vendor that is NOT toolless", () => {
  // Every SDK seat gets the NO_TOOLS preamble; the agy seat has it stripped because it runs in a
  // real agent runtime with real tools. That is the difference the store exists to record.
  assert.equal(VENDOR_TUNING.agy_google.toolless, false);
  for (const v of ["openai", "xai", "anthropic"]) {
    assert.equal(VENDOR_TUNING[v].toolless, true, `${v} seats have no tools and must be told so`);
  }
});

test("the scout's 700-token cap and the reviewer's 4000 are carried, with the re-ask", () => {
  assert.equal(ROLE_TUNING.scout.tokens, 700, "grok-4.6 once answered a scout prompt with 82k chars");
  assert.equal(ROLE_TUNING.reviewer.tokens, 4000);
  assert.equal(ROLE_TUNING.reviewer.reaskTokens, 800, "the verdict re-ask is a smaller second call");
});

test("a resolved agent merges its role tuning onto its vendor tuning", () => {
  // A capped scout: same role, a model with no exception.
  const scout = getAgent("scout@openai");
  assert.equal(scout.tuning.tokens, 700);
  assert.equal(scout.tuning.capShape, "max_output_tokens");
  assert.equal(scout.tuning.toolless, true);

  const impl = getAgent("implementer@openai/gpt-6-astra");
  assert.equal(impl.tuning.tokens, null, "the implementer writes a whole file; it is not capped");
});

test("the cap exception is per MODEL, not per role -- the store cannot diverge from the pipeline", () => {
  // This pair is the whole point. Both are scouts, so ROLE_TUNING says 700 for both; only one is
  // excepted. The defect this pins was live for minutes: run-item.mjs learned to skip the cap for
  // the multi-agent model while the store still reported 700, so a card rendered for that seat
  // would have told it to "keep your answer under roughly 700 tokens" -- an instruction the
  // pipeline no longer sends and which docs.x.ai says the model would not honour anyway.
  // Both now read tokenCapFor(), so they cannot disagree.
  assert.equal(getAgent("scout@xai/grok-4.20-multi-agent").tuning.tokens, null,
    "sixteen subagents producing a synthesis must not be truncated at four sentences");
  assert.equal(getAgent("scout@openai").tuning.tokens, 700,
    "the exception must not leak to other scout seats");
  assert.equal(ROLE_TUNING.scout.tokens, 700, "the role-level rule itself is unchanged");
});

test("the agy_google reviewer resolves toolless:false while the xai reviewer does not", () => {
  // Same role, two labs, opposite preambles -- this is the pair that proves the merge is real
  // rather than a role-level constant wearing a vendor's name.
  assert.equal(getAgent("reviewer@agy_google/gemini-3.5-flash").tuning.toolless, false);
  assert.equal(getAgent("reviewer@xai/grok-4.7").tuning.toolless, true);
});
