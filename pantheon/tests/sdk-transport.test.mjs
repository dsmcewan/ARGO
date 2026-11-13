import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ADAPTERS, makeClient, sendTurn, normalize } from "../src/sdk/adapter.mjs";
import { sdkTurn, exchangeTurns, recordExtendsLocally } from "../src/sdk/seat-sdk.mjs";
import { loadSeat } from "../src/seat/store.mjs";
import { chainOf } from "../src/context/chain.mjs";

// MUST await fn. The previous version was `try { return fn(home) } finally { rmSync(...) }`,
// which for an async fn runs the cleanup as soon as the promise is CREATED -- so every async
// test here ran against a temp home that had already been deleted. It went unnoticed because
// nothing in those tests read a file back from disk after the first write; adding a lock, which
// must create a file in that directory, surfaced it immediately as ENOENT.
const withHome = async fn => {
  const home = mkdtempSync(join(tmpdir(), "pantheon-sdk-"));
  try { return await fn(home); } finally { rmSync(home, { recursive: true, force: true }); }
};

// A fake that RECORDS what it was asked, so a test can assert on the request the adapter built
// rather than only on the reply it got back. Assertions on the reply alone cannot tell a resume
// from a fresh call -- which is the single thing this transport must get right.
function fakeClient(replies) {
  const seen = [];
  let i = 0;
  return {
    seen,
    responses: {
      create: async req => { seen.push(req); return replies[i++] ?? replies.at(-1); },
    },
  };
}
const reply = (id, text, output) => ({ id, output_text: text, ...(output ? { output } : {}) });

test("the adapter table covers the Responses-shaped vendors with distinct hosts", () => {
  assert.equal(ADAPTERS.openai.surface, "responses");
  assert.equal(ADAPTERS.xai.surface, "responses");
  assert.equal(ADAPTERS.openai.base_url, null, "openai uses the SDK default host");
  assert.equal(ADAPTERS.xai.base_url, "https://api.x.ai/v1");
  assert.notEqual(ADAPTERS.openai.key_env, ADAPTERS.xai.key_env,
    "two vendors sharing one credential env var would silently send one's key to the other");
});

test("makeClient names the missing credential and never prints a value", () => {
  const OpenAI = function () {};
  assert.throws(() => makeClient("xai", { OpenAI, env: {} }), /XAI_API_KEY/);
  assert.throws(() => makeClient("nope", { OpenAI, apiKey: "k" }), /no SDK adapter/);
  // The value must not appear in the error even when one IS supplied elsewhere.
  try { makeClient("openai", { OpenAI, env: {} }); } catch (e) {
    assert.ok(!e.message.includes("secret"), "a credential value must never reach an error string");
  }
});

test("makeClient points xai at its own host and passes the key through", () => {
  const calls = [];
  const OpenAI = function (opts) { calls.push(opts); };
  makeClient("xai", { OpenAI, apiKey: "k-1" });
  assert.equal(calls[0].baseURL, "https://api.x.ai/v1");
  makeClient("openai", { OpenAI, apiKey: "k-2" });
  assert.equal(calls[1].baseURL, undefined, "openai must not be given an invented base URL");
});

// The resume contract, asserted on the REQUEST. A first turn must carry no
// previous_response_id; the second must carry exactly the id the first returned.
test("a fresh turn sends no previous_response_id and a resume sends the returned id", async () => {
  await withHome(async home => {
    const client = fakeClient([reply("resp_1", "one"), reply("resp_2", "two")]);
    const seat = { vendor: "openai", purpose: "owner", cwd: "/repo/a", client, home };

    const a = await sdkTurn({ ...seat, prompt: "first" });
    assert.equal(client.seen[0].previous_response_id, undefined, "a fresh turn must not claim a resume");
    assert.equal(a.resumed, false);

    const b = await sdkTurn({ ...seat, prompt: "second" });
    assert.equal(client.seen[1].previous_response_id, "resp_1",
      "the second turn must continue the conversation the first one created");
    assert.equal(b.resumed, true);
    assert.equal(loadSeat({ vendor: "openai", purpose: "owner", cwd: "/repo/a" }, { home }).token.value, "resp_2");
  });
});

test("the persisted token carries sdk provenance, which outranks scrape", async () => {
  await withHome(async home => {
    const client = fakeClient([reply("resp_1", "x")]);
    await sdkTurn({ vendor: "openai", purpose: "p", cwd: "/repo/a", prompt: "hi", client, home });
    const s = loadSeat({ vendor: "openai", purpose: "p", cwd: "/repo/a" }, { home });
    assert.equal(s.token.source, "sdk");
  });
});

// A vendor that returns no id leaves us unable to resume. Persisting a null token would make the
// NEXT turn look fresh, erasing the fact that continuity was lost.
test("a response with no id is refused rather than persisted as a fresh conversation", async () => {
  await withHome(async home => {
    const client = fakeClient([{ output_text: "no id here" }]);
    const r = await sdkTurn({ vendor: "openai", purpose: "p", cwd: "/repo/a", prompt: "hi", client, home });
    assert.equal(r.ok, false);
    assert.equal(r.persisted, false);
    assert.match(r.why, /no response id/i);
    assert.equal(loadSeat({ vendor: "openai", purpose: "p", cwd: "/repo/a" }, { home }), null,
      "nothing may be written when the handle is unusable");
  });
});

test("the chain grows by exactly the turns of each exchange and stays prefix-verifiable", async () => {
  await withHome(async home => {
    const client = fakeClient([reply("r1", "a"), reply("r2", "b")]);
    const seat = { vendor: "openai", purpose: "p", cwd: "/repo/a", client, home };
    const a = await sdkTurn({ ...seat, prompt: "one" });
    assert.equal(a.chain.length, 2, "one exchange is a user turn plus an assistant turn");
    const b = await sdkTurn({ ...seat, prompt: "two" });
    assert.equal(b.chain.length, 4);
    const all = loadSeat({ vendor: "openai", purpose: "p", cwd: "/repo/a" }, { home }).exchanges;
    assert.equal(recordExtendsLocally(all, a.chain).ok, true, "the later record must extend the earlier");
    assert.equal(recordExtendsLocally(all, a.chain).grew, 2);
  });
});

test("a tool-only assistant turn is still a turn", () => {
  const withTools = exchangeTurns({ prompt: "p", result: { text: "", tools: ["read_file"], } });
  assert.equal(withTools.length, 2, "an assistant turn with tools but no prose must not be dropped");
  assert.deepEqual(withTools[1].tools, ["read_file"]);
  const empty = exchangeTurns({ prompt: "p", result: { text: "", tools: [] } });
  assert.equal(empty.length, 1, "a genuinely empty reply adds no assistant turn");
});

// Two exchanges with identical text but different tool calls are different exchanges. Hashing
// only the text would collide them -- the defect already fixed once in the CLI projectors.
test("same text with different tools produces different chain heads", () => {
  const a = exchangeTurns({ prompt: "p", result: { text: "same", tools: ["grep"] } });
  const b = exchangeTurns({ prompt: "p", result: { text: "same", tools: ["write"] } });
  assert.notEqual(chainOf(a).at(-1), chainOf(b).at(-1));
});

test("normalize reports a missing id instead of defaulting it away", () => {
  const good = normalize(reply("r1", "hi"), "openai", false);
  assert.equal(good.usable_for_resume, true);
  assert.equal(good.why_unusable, null);
  const bad = normalize({ output_text: "hi" }, "openai", false);
  assert.equal(bad.usable_for_resume, false);
  assert.match(bad.why_unusable, /cannot resume/);
});

test("text and tool names are read from output items when output_text is absent", () => {
  const res = {
    id: "r9",
    output: [
      { type: "message", content: [{ type: "output_text", text: "hello " }, { type: "output_text", text: "world" }] },
      { type: "function_call", name: "read_file" },
      { type: "function_call", name: "read_file" },
      { type: "custom_tool_call", name: "grep" },
    ],
  };
  const n = normalize(res, "openai", true);
  assert.equal(n.text, "hello world");
  assert.deepEqual(n.tools, ["grep", "read_file"], "tool names deduped and sorted");
});

// Content must never reach disk. The store is the last gate before persistence, so it is tested
// at that boundary rather than only at the projector.
test("the store refuses an exchange list carrying conversation text", async () => {
  await withHome(async home => {
    const { saveSeat } = await import("../src/seat/store.mjs");
    assert.throws(
      () => saveSeat({ vendor: "openai", purpose: "p", cwd: "/repo/a" },
        { exchanges: [{ role: "user", sha: "abc", len: 3, tools: [], text: "the actual prompt" }] },
        { home }),
      /unexpected field "text"/,
      "a turn carrying text must be refused at the only module that writes to disk");
  });
});

test("sendTurn requires a prompt and a client rather than sending an empty request", async () => {
  await assert.rejects(() => sendTurn({ client: fakeClient([reply("r", "")]), vendor: "openai", prompt: "" }),
    /prompt is required/);
  await assert.rejects(() => sendTurn({ vendor: "openai", prompt: "hi" }), /client is required/);
  await assert.rejects(() => sendTurn({ client: fakeClient([]), vendor: "nope", prompt: "hi" }), /no SDK adapter/);
});

test("the default model is the vendor's own, and an explicit model wins", async () => {
  const client = fakeClient([reply("r1", "x")]);
  await sendTurn({ client, vendor: "xai", prompt: "hi" });
  assert.equal(client.seen[0].model, ADAPTERS.xai.default_model);
  await sendTurn({ client, vendor: "xai", prompt: "hi", model: "grok-4.20-multi-agent" });
  assert.equal(client.seen[1].model, "grok-4.20-multi-agent");
});

// ---------------------------------------------------------------------------------------------
// Regression: the OAuth client must EXCLUDE the metered key, not merely prefer OAuth.
//
// These SDKs read their own key env var when `apiKey` is left undefined. So on a machine that
// has ANTHROPIC_API_KEY set, an OAuth client was constructed carrying BOTH credentials, the
// metered one won on the wire, and the seat failed with 400 "credit balance is too low" while
// this code believed it was running on the subscription.
//
// It passed every earlier test because those shells did not happen to have the key loaded --
// the environment was doing the work the assertion was supposed to do. The fixture therefore
// SETS the key, which is the condition that reproduces it.
// ---------------------------------------------------------------------------------------------

test("an OAuth client is built with the metered key explicitly excluded", () => {
  const built = [];
  const Anthropic = function (opts) { built.push(opts); };
  const home = mkdtempSync(join(tmpdir(), "pantheon-oauth-"));
  try {
    mkdirSync(join(home, ".claude"), { recursive: true });
    writeFileSync(join(home, ".claude", ".credentials.json"),
      JSON.stringify({ claudeAiOauth: { accessToken: "tok-oauth", subscriptionType: "max" } }));

    makeClient("anthropic", { Anthropic, home, env: { ANTHROPIC_API_KEY: "sk-metered-key" } });

    assert.equal(built[0].authToken, "tok-oauth", "must authenticate with the subscription token");
    assert.equal(built[0].apiKey, null,
      "apiKey must be explicitly null: undefined lets the SDK read ANTHROPIC_API_KEY itself and send both");
    assert.equal(built[0].defaultHeaders?.["anthropic-beta"], "oauth-2025-04-20");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("with no OAuth token present it falls back to the metered key", () => {
  const built = [];
  const Anthropic = function (opts) { built.push(opts); };
  const home = mkdtempSync(join(tmpdir(), "pantheon-nooauth-"));
  try {
    makeClient("anthropic", { Anthropic, home, env: { ANTHROPIC_API_KEY: "sk-metered-key" } });
    assert.equal(built[0].apiKey, "sk-metered-key");
    assert.equal(built[0].authToken, undefined);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("prefer:'key' takes the metered key even when a subscription token exists", () => {
  const built = [];
  const Anthropic = function (opts) { built.push(opts); };
  const home = mkdtempSync(join(tmpdir(), "pantheon-prefkey-"));
  try {
    mkdirSync(join(home, ".claude"), { recursive: true });
    writeFileSync(join(home, ".claude", ".credentials.json"),
      JSON.stringify({ claudeAiOauth: { accessToken: "tok-oauth" } }));
    makeClient("anthropic", { Anthropic, home, prefer: "key", env: { ANTHROPIC_API_KEY: "sk-metered-key" } });
    assert.equal(built[0].apiKey, "sk-metered-key", "an explicit preference must be honoured");
    assert.equal(built[0].authToken, undefined);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------------------------
// Continuity toggle. The point of the toggle is a real trade, so both directions are pinned:
// server keeps the words at the vendor and the audit trail is hashes only; replay puts every
// reply on disk and retains nothing vendor-side.
// ---------------------------------------------------------------------------------------------

test("continuityMode precedence: explicit beats env beats the vendor default", async () => {
  const { continuityMode } = await import("../src/sdk/adapter.mjs");
  assert.equal(continuityMode("openai", undefined, {}).mode, "server", "vendor default");
  assert.equal(continuityMode("openai", undefined, { PANTHEON_CONTINUITY: "replay" }).mode, "replay", "env overrides default");
  assert.equal(continuityMode("openai", "server", { PANTHEON_CONTINUITY: "replay" }).mode, "server", "explicit overrides env");
});

// A vendor that cannot do the requested mode must SAY so, not quietly run the other one and let
// the caller believe its request was honoured.
test("a mode the vendor cannot do is flagged, not silently substituted", async () => {
  const { continuityMode } = await import("../src/sdk/adapter.mjs");
  const r = continuityMode("agy_google", "server", {});
  assert.equal(r.mode, "replay", "it runs what it can");
  assert.equal(r.honoured, false, "and reports that the request was NOT honoured");
  assert.match(r.why, /supports only replay/);
  const ok = continuityMode("anthropic", "replay", {});
  assert.equal(ok.honoured, true);
  assert.equal(ok.why, null);
});

test("replay on a Responses vendor sends the history and stores nothing vendor-side", async () => {
  const client = fakeClient([{ id: "r1", output_text: "hi", output: [{ type: "message", content: [{ type: "output_text", text: "hi" }] }] }]);
  await sendTurn({ client, vendor: "openai", prompt: "first", continuity: "replay" });
  const req = client.seen[0];
  assert.equal(req.store, false, "store:false — the vendor must retain nothing");
  assert.equal(req.reasoning.context, "all_turns", "earlier reasoning items must be rendered again");
  assert.ok(Array.isArray(req.input), "input must be the replayed item list, not a bare string");
  assert.equal(req.previous_response_id, undefined, "replay must not also resume by id");
});

// The subtlety that makes replay actually equivalent: keeping the TEXT is not enough, because
// reasoning items carry encrypted_content and are what make all_turns work next turn.
test("replay preserves every output item, not just the prose", async () => {
  const output = [
    { type: "reasoning", encrypted_content: "OPAQUE-BLOB", summary: [] },
    { type: "message", content: [{ type: "output_text", text: "answer" }] },
  ];
  const client = fakeClient([{ id: "r1", output_text: "answer", output }]);
  const r = await sendTurn({ client, vendor: "openai", prompt: "q", continuity: "replay" });
  const kept = JSON.stringify(r.history);
  assert.match(kept, /OPAQUE-BLOB/, "the encrypted reasoning item must survive into the history");
  assert.equal(r.history.length, 3, "the user item plus both output items");
});

test("a replayed turn with no output items is refused rather than breaking the next turn", async () => {
  const client = fakeClient([{ id: "r1", output_text: "", output: [] }]);
  const r = await sendTurn({ client, vendor: "openai", prompt: "q", continuity: "replay" });
  assert.equal(r.usable_for_resume, false);
  assert.match(r.why_unusable, /replay continuity would be broken/);
});

test("server mode still resumes by id and sends no history", async () => {
  const client = fakeClient([{ id: "r1", output_text: "one" }, { id: "r2", output_text: "two" }]);
  await sendTurn({ client, vendor: "openai", prompt: "a", continuity: "server" });
  await sendTurn({ client, vendor: "openai", prompt: "b", previousResponseId: "r1", continuity: "server" });
  assert.equal(client.seen[1].previous_response_id, "r1");
  assert.equal(client.seen[1].store, undefined, "server mode must not force store:false");
  assert.equal(typeof client.seen[1].input, "string", "server mode sends the prompt, not a history");
});

test("a turn reports which mode ran, what was asked, and whether it was honoured", async () => {
  await withHome(async home => {
    const client = fakeClient([{ id: "r1", output_text: "x", output: [{ type: "message", content: [{ type: "output_text", text: "x" }] }] }]);
    const r = await sdkTurn({ vendor: "openai", purpose: "p", cwd: "/repo/a", prompt: "hi", client, home, continuity: "replay" });
    assert.equal(r.mode, "replay");
    assert.equal(r.continuity_requested, "replay");
    assert.equal(r.continuity_honoured, true);
  });
});

test("every client is built with maxRetries: 0 — the harness owns the retry policy", () => {
  // The SDKs retry 429/408/409/5xx twice by default. That is a control layer UNDER the seating's
  // wait-vs-reseat decision: shouldFallThrough would judge the third refusal as if it were the first,
  // the run log's call count would be wrong (and with it latency and spend), and subtreeCost's
  // "4 calls, 1 lane" would understate by up to 3x.
  for (const vendor of ["openai", "xai", "agy_google", "anthropic"]) {
    const seen = {};
    const Fake = function (o) { Object.assign(seen, o ?? {}); };
    // makeClient takes ONE options object: constructors and credential together.
    makeClient(vendor, { OpenAI: Fake, GoogleGenAI: Fake, Anthropic: Fake,
      apiKey: "test-only-not-a-real-key", prefer: "key" });
    // THE KNOB DIFFERS PER SDK. @google/genai has no maxRetries at all -- it silently ignores the
    // option -- and reads httpOptions.retryOptions.attempts (default 5). Asserting maxRetries for
    // every vendor was asserting a field one of them never reads: green, and the google seat retried
    // four extra times. Found by an external review.
    if (vendor === "agy_google") {
      assert.equal(seen.maxRetries, undefined, "genai ignores maxRetries; passing it would be a false comfort");
      assert.equal(seen.httpOptions?.retryOptions?.attempts, 1, "genai: attempts=1 is 'no retries' per its own docs");
    } else {
      assert.equal(seen.maxRetries, 0, `${vendor} client must disable the SDK's own retries`);
    }
  }
});
