// Human-authored oracle, written BEFORE the fix and baselined failing.
//
// WHY THIS EXISTS. sendTurn() falls back to ADAPTERS[vendor].default_model whenever a caller
// omits `model` (src/sdk/adapter.mjs: `model: model ?? spec.default_model`). Every call this
// project's own seating pipeline makes already names an explicit model, so that fallback is only
// ever reached by a call that DIDN'T specify one -- exactly the case the operator wants routed to
// the cheapest tier, not to whatever the vendor's flagship happens to be. Before this fix,
// anthropic's default_model was pinned to sonnet (an actual working tier, just not the cheap one)
// while every other vendor's default_model already was its cheapest recorded tier.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ADAPTERS } from "../src/sdk/adapter.mjs";
import { modelId } from "../src/config/models.mjs";

test("an unspecified anthropic call falls back to sonnet -- deliberately NOT the cheapest", () => {
  // POLICY CHANGED 2026-09-28 by operator decision: ordinary anthropic work was landing on haiku
  // and now lands on sonnet. This test previously asserted the opposite and was named for it
  // ("...falls back to haiku, the cheap tier -- not sonnet").
  //
  // anthropic is now the ONE vendor whose default is not its cheapest rung, and that is a
  // deliberate trade rather than an oversight: haiku holds 200K against sonnet-5's 1M, and
  // SEAT_FACTS records haiku as supporting NO effort level at all, so an unspecified call on haiku
  // could never be escalated by effort. What this file protects is unchanged -- an unspecified
  // call must not cost the FLAGSHIP's price -- so that is what is asserted now, rather than
  // "cheapest", which is no longer the rule for this vendor.
  assert.equal(ADAPTERS.anthropic.default_model, modelId("anthropic", "sonnet"));
  assert.notEqual(ADAPTERS.anthropic.default_model, modelId("anthropic", "opus"),
    "an unspecified call must never land on the flagship");
  assert.notEqual(ADAPTERS.anthropic.default_model, modelId("anthropic", "fable"),
    "nor on the dearest planning rung");
});

test("every vendor's default_model is already its cheapest recorded tier", () => {
  assert.equal(ADAPTERS.openai.default_model, modelId("openai", "luna"));
  assert.equal(ADAPTERS.xai.default_model, modelId("xai", "grok-4.6"));
  assert.equal(ADAPTERS.agy_google.default_model, modelId("google", "gemini-3.5-flash"));
});
