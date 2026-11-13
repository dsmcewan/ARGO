// Human-authored oracle, written BEFORE the loader and baselined failing.
//
// WHY THIS EXISTS. Model-ID strings were hardcoded in three places (src/sdk/adapter.mjs's
// default_model per vendor, src/role/seating.mjs's SEATING ladder, src/route/router.mjs's
// SEAT_FACTS.models) -- the exact spelling drifting between them is how the multi-agent grok id
// went wrong once already. NOTE, 2026-09-28: this comment previously named "-0309" as the correct
// form and the bare name as the error. It is the reverse (docs.x.ai names "grok-4.20-multi-agent"),
// and tests/sdk-transport.test.mjs had been using the bare name all along -- the config and a test
// disagreed for weeks and nothing caught it. This loader makes src/config/models.json the single source those
// three files read from, so a correction happens in one place.
import { test } from "node:test";
import assert from "node:assert/strict";
import { MODELS, modelId } from "../src/config/models.mjs";

test("loads all four vendors from models.json", () => {
  assert.deepEqual(Object.keys(MODELS).sort(), ["anthropic", "google", "openai", "xai"]);
});

test("modelId resolves a known vendor/name pair to its model string", () => {
  assert.equal(modelId("anthropic", "fable"), "claude-fable-5-1");
  assert.equal(modelId("anthropic", "sonnet"), "claude-sonnet-5");
  assert.equal(modelId("anthropic", "opus"), "claude-opus-5");
  assert.equal(modelId("anthropic", "haiku"), "claude-haiku-4-5-20251001");
  assert.equal(modelId("openai", "astra"), "gpt-6-astra");
  assert.equal(modelId("openai", "sol"), "gpt-6-sol");
  assert.equal(modelId("openai", "luna"), "gpt-6-luna");
  assert.equal(modelId("xai", "grok-4.7"), "grok-4.7");
  assert.equal(modelId("xai", "grok-4.20-multi-agent"), "grok-4.20-multi-agent");
  assert.equal(modelId("google", "gemini-3.5-flash"), "gemini-3.5-flash");
});

test("modelId throws by naming the unknown vendor, never silently returns undefined", () => {
  assert.throws(() => modelId("bogus-vendor", "sonnet"), /unknown vendor "bogus-vendor"/);
});

test("modelId throws by naming the unknown model key for a real vendor", () => {
  assert.throws(() => modelId("anthropic", "bogus-model"), /unknown model "bogus-model" for vendor "anthropic"/);
});
