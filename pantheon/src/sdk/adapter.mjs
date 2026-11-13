import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { streamTurn } from "./stream.mjs";
import { modelId } from "../config/models.mjs";
import { isFrontier, sendModelTurn } from "../../../packages/model-client/index.mjs";

// SDK transport. Replaces spawning a vendor CLI and then going to find the transcript it wrote.
//
// The whole class of defect this project kept hitting -- C1 mtime selection, C2 date-nesting, C3
// the lossy sanitizer, and the two silent zero-turn projectors found on 2026-09-27 -- existed
// because the conversation lived in a vendor-owned file we had to locate and parse. Here we hold
// the conversation. There is nothing to locate and nothing to parse.
//
// An adapter's ONLY job is to turn one exchange into a normalized result. It does not touch the
// seat store, does not hash anything, and does not decide what a resume means.

// A vendor's continuity handle. `previous_response_id` (OpenAI/xAI Responses) is server-side:
// we send the id, the vendor holds the history. That is a genuinely different trust position
// from the CLI path, where we could re-read the whole conversation ourselves, and the seat layer
// is where that difference is handled -- see chainOfExchanges in seat-sdk.mjs.
export const ADAPTERS = {
  openai: {
    base_url: null,                       // the SDK's own default
    key_env: "OPENAI_API_KEY",
    default_model: modelId("openai", "luna"),
    continuity: "server",
    continuity_modes: ["server", "replay"],
    // Responses API. Astra's tool calling REQUIRES Responses rather than Chat Completions
    // (developers.openai.com/api/docs/guides/latest-model), so Responses is the only surface
    // this adapter speaks; there is no Chat Completions fallback to silently degrade into.
    surface: "responses",
  },
  xai: {
    base_url: "https://api.x.ai/v1",
    key_env: "XAI_API_KEY",
    default_model: modelId("xai", "grok-4.6"),
    continuity: "server",
    continuity_modes: ["server", "replay"],
    // Same request shape, different host: docs.x.ai shows the OpenAI SDK pointed at this
    // base_url calling client.responses.create. Sharing the code path is the point -- but see
    // the conformance note below, because "OpenAI-compatible" is a claim, not a fact.
    surface: "responses",
  },
  // REPLAY continuity: no server-side conversation, so every turn resends the whole history.
  // The practical consequences are load-bearing and easy to miss, so they are stated here:
  //   - a local copy of the conversation TEXT is mandatory (see history.mjs)
  //   - cost grows with conversation length, because the prefix is re-sent each turn
  //   - there is no vendor id to resume by, so the seat's handle is locally minted and its
  //     provenance is `operator`, not `sdk` — it is our label, not the vendor's fact
  // RAW GEMINI over the public API, this entry's own client construction, OR the optional Antigravity SDK
  // Agent subprocess (scripts/agy-seat.py) -- both live under the vendor key "agy_google" now, having
  // previously been two separate vendor tokens ("google" and "agy").
  //
  // CORRECTED, against real evidence, not the operator's earlier recollection. A prior version of
  // this comment claimed "Antigravity's roster is Gemini, Opus 4.6 and GPT-OSS -- a multi-vendor
  // platform reached through one subscription" and kept the two vendor names apart on that basis.
  // Checked against antigravity.google/docs/sdk/overview/ (fetched live): "The SDK routes to
  // Google's Gemini models" (Gemini only) and "The SDK uses API key authentication... Gemini API
  // key" -- the SAME GEMINI_API_KEY this entry uses, not a separate subscription. Also confirmed
  // in this project's own AGY_SEAT.lanes.sdk.credential (src/role/seating.mjs): "GEMINI_API_KEY".
  // These two API-key transports use the same credential. The board can opt into the agy CLI with
  // cached OAuth, a separate auth and quota surface. Do not infer that a
  // board turn and this raw API adapter have interchangeable credentials from their vendor label.
  //
  // The PRIOR mistake this comment used to record stands as a lesson regardless of the correction
  // above: I once read Claude model names out of ~/.gemini/antigravity-cli/scratch/stats-cache.json
  // and concluded they were Antigravity's roster. A file's LOCATION is not proof of what wrote it --
  // scratch directories hold other tools' output -- and treating a path as provenance is the same
  // proxy-for-identity error this project has paid for more than once. Ask the operator, or check
  // the vendor's own docs; do not infer a roster from a cache file's parent directory.
  agy_google: {
    base_url: null,
    key_env: "GEMINI_API_KEY",
    default_model: modelId("google", "gemini-3.5-flash"),   // gemini-3-pro and gemini-3.1-pro both 404 here
    surface: "genai",
    continuity: "replay",
    continuity_modes: ["replay"],        // the Gemini API keeps no conversation to resume by id

  },
  anthropic: {
    base_url: null,
    key_env: "ANTHROPIC_API_KEY",
    // The cheap tier, not sonnet: any caller reaching this fallback did not name a model, and an
    // unspecified call should cost the least, not the flagship's price -- see
    // tests/adapter-cheap-default.test.mjs.
    // Raised from haiku on 2026-09-28 by operator decision. The comment above still holds in
    // spirit -- an unspecified call should not cost the flagship's price -- but the floor is now
    // sonnet rather than haiku, which is a deliberate trade of cost for a 1M window and live
    // effort control. tests/adapter-cheap-default.test.mjs pins that it is still not the flagship.
    default_model: modelId("anthropic", "sonnet"),
    surface: "messages",
    continuity: "replay",
    continuity_modes: ["replay"],        // the Messages API is stateless by design

    // This seat rides the Claude SUBSCRIPTION, not a metered platform key. They are different
    // credentials on different billing, and the difference is observable here: the metered key
    // on this machine returns 400 "credit balance is too low" while the subscription works.
    //
    // They are also different WIRE headers, which is the part that fails silently:
    //   apiKey    -> x-api-key                (metered platform key)
    //   authToken -> Authorization: Bearer    (OAuth access token)
    // Passing an OAuth token as `apiKey` puts it in the wrong header and fails as though the
    // credential were invalid — which reads like a bad token rather than a wrong mechanism.
    oauth: {
      file: ".claude/.credentials.json",
      path: ["claudeAiOauth", "accessToken"],
      beta: "oauth-2025-04-20",
    },
  },
};

// Continuity is now a TOGGLE for vendors that support both, not a fixed property.
//
// openai and xai can either let the vendor hold the conversation (previous_response_id) or hold
// it here and replay it. The docs are explicit that replay loses nothing, including reasoning:
// "all_turns has an effect only when the request has access to earlier response items. Use
// previous_response_id, attach the response to a conversation, or manually replay the complete
// response history." With store:false the vendor retains nothing and we hold everything.
//
// The trade is real in both directions, which is why it is a toggle and not a new default:
//   server  cheap  — one id per turn, no growing prefix; the vendor holds the words, so a reply
//                    cannot be read back locally and the audit trail is hashes only.
//   replay  costly — the whole prefix every turn (largely absorbed by prompt caching); every
//                    reply is on disk, auditable offline, and nothing is retained vendor-side.
//
// Precedence: explicit per-call > PANTHEON_CONTINUITY env > the vendor's default. A vendor that
// supports only one mode ignores a request for the other and SAYS so rather than silently
// running the mode it can do.
export function continuityMode(vendor, override, env = process.env) {
  const spec = ADAPTERS[vendor];
  if (!spec) throw new Error(`continuityMode: unknown vendor "${vendor}"`);
  const supported = spec.continuity_modes ?? [spec.continuity];
  const wanted = override ?? env.PANTHEON_CONTINUITY ?? spec.continuity;
  if (!supported.includes(wanted)) {
    return { mode: spec.continuity, requested: wanted, honoured: false,
      why: `${vendor} supports only ${supported.join("/")}; ran ${spec.continuity} instead` };
  }
  return { mode: wanted, requested: wanted, honoured: true, why: null };
}

export const isReplay = (vendor, override, env) => continuityMode(vendor, override, env).mode === "replay";

// Build a client. The SDK constructor is injected so every test runs without a network, a key,
// or the package -- and so a fake cannot be mistaken for the real thing by accident: a test must
// pass its fake explicitly.
export function makeClient(vendor, opts = {}) {
  const { OpenAI, GoogleGenAI, Anthropic, apiKey, baseURL, env = process.env } = opts;
  const spec = ADAPTERS[vendor];
  if (!spec) throw new Error(`makeClient: no SDK adapter for vendor "${vendor}"`);
  const Ctor = { responses: OpenAI, genai: GoogleGenAI, messages: Anthropic }[spec.surface];
  if (!Ctor) throw new Error(`makeClient: pass the constructor for the ${spec.surface} surface (import it at the edge)`);
  const url = baseURL ?? spec.base_url;
  if (opts.poolConfig) {
    const pool = opts.poolConfig;
    if (pool.vendor !== vendor || !env[pool.credential_env]) throw new Error('Configured pool credential unavailable');
    if (pool.auth === 'oauth') {
      if (!spec.oauth) throw new Error('Configured OAuth pool is unsupported for this transport');
      return Object.assign(new Ctor({ apiKey: null, authToken: env[pool.credential_env], maxRetries: 0,
        defaultHeaders: { 'anthropic-beta': spec.oauth.beta }, ...(url ? { baseURL: url } : {}) }), {argoBetaHeaders:[spec.oauth.beta]});
    }
    return makeClient(vendor, { ...opts, poolConfig: null, apiKey: env[pool.credential_env], prefer: 'key' });
  }

  // Subscription OAuth first where the vendor supports it, because that is the credential the
  // operator actually pays for; the metered key is the fallback, not the default. `prefer` lets
  // a caller force either one, so which credential paid for a turn is a decision rather than
  // something discovered later from a bill.
  const prefer = opts.prefer ?? env.PANTHEON_CREDENTIAL_PREFER ?? "oauth";
  if (spec.oauth && prefer !== "key" && !apiKey) {
    const token = (vendor === "anthropic" && env.CLAUDE_CODE_OAUTH_TOKEN) || readOauthToken(spec.oauth, opts.home ?? homedir());
    if (token) {
      return Object.assign(new Ctor({
        // maxRetries: 0 because THIS HARNESS OWNS THE RETRY POLICY.
        //
        // The SDKs retry 429, 408, 409 and 5xx twice by default with exponential backoff. That is a
        // control layer underneath the seating's wait-vs-reseat decision, and it breaks three things at
        // once: shouldFallThrough judges the THIRD refusal as if it were the first, so a transient 429
        // gets two hidden waits instead of a reseat; the run log's call count is wrong, which makes the
        // latency and spend accounting wrong; and subtreeCost's "4 calls, 1 lane" understates by up to
        // 3x. One visible policy, in one place -- see roleTurn in scripts/live-ship.mjs.
        maxRetries: 0,
        authToken: token,                    // Authorization: Bearer — NOT x-api-key
        // apiKey: null is LOAD-BEARING, not tidiness. These SDKs read their key env var
        // themselves when apiKey is left undefined, so an OAuth client built on a machine that
        // also has ANTHROPIC_API_KEY set sends BOTH credentials and the metered one wins. That
        // failed as 400 "credit balance is too low" while this code believed it was on the
        // subscription — and it passed every earlier test only because those shells happened
        // not to have the key loaded. Choosing a credential means excluding the other one.
        apiKey: null,
        ...(spec.oauth.beta ? { defaultHeaders: { "anthropic-beta": spec.oauth.beta } } : {}),
        ...(url ? { baseURL: url } : {}),
      }), {argoBetaHeaders:spec.oauth.beta?[spec.oauth.beta]:[]});
    }
    if (prefer === "oauth-only") {
      throw new Error(`makeClient: ${vendor} has no subscription token at ~/${spec.oauth.file}`);
    }
  }

  const key = apiKey ?? env[spec.key_env];
  if (!key) {
    // Named, not printed. A missing credential must say WHICH one, and never show a value.
    throw new Error(`makeClient: ${vendor} needs ${spec.key_env} (or an explicit apiKey)`);
  }
  // The harness owns retry, so the vendor SDK must not quietly take several attempts where the log
  // says one -- same reason as the OAuth branch above. THE KNOB DIFFERS PER SDK, and passing the
  // wrong one is silently ignored: @google/genai has no `maxRetries`; it reads
  // `httpOptions.retryOptions.attempts` (default 5, counting the original request), so the google seat
  // retried 429/408/5xx four extra times while this comment claimed retries were off. Found by an
  // external review. `attempts: 1` is "no retries" per the SDK's own doc comment.
  if (spec.surface === "genai") {
    return new Ctor({ apiKey: key, httpOptions: { apiVersion: 'v1beta1', retryOptions: { attempts: 1 }, ...(url ? { baseUrl: url } : {}) } });
  }
  return new Ctor({ apiKey: key, maxRetries: 0, ...(url ? { baseURL: url } : {}) });
}

// One exchange. Returns a normalized shape the seat layer can hash without knowing the vendor.
//
// `previousResponseId` is the resume: passing it continues that conversation server-side.
// Passing nothing starts a fresh one. There is deliberately no third mode -- "continue the most
// recent" is the cwd-and-recency proxy that produced defect C1, and it is not reintroduced here
// just because a vendor offers it.
export async function sendTurn({
  client, vendor, model, prompt, previousResponseId, history, onEvent, label, continuity, extra = {},
  scope, sessionId, effort, architecture, contractHeader, signal, deadline,
}) {
  const spec = ADAPTERS[vendor];
  if (!spec) throw new Error(`sendTurn: no SDK adapter for vendor "${vendor}"`);
  if (!client) throw new Error("sendTurn: client is required");
  if (typeof prompt !== "string" || prompt === "") throw new Error("sendTurn: prompt is required");
  const { mode } = continuityMode(vendor, continuity);
  // The reusable client owns frontier policy on BOTH unary and streaming paths.
  if (isFrontier(model ?? spec.default_model)) {
    return sendModelTurn({ client, vendor, model: model ?? spec.default_model, prompt,
      previousResponseId, history, onEvent, continuity: mode, extra, scope, sessionId,
      effort, architecture, contractHeader, signal, deadline });
  }

  // Streaming is an OBSERVATION channel, not a second result format: streamTurn accumulates
  // into the same shape the non-streaming path returns, so the seat layer hashes one thing.
  if (onEvent) {
    const req = buildRequest({ spec, model, prompt, previousResponseId, history, extra, mode });
    // `label` names the pane these events belong to. It defaults to the vendor, so the base
    // row is unchanged, but a turn run on a different model under a different purpose can be
    // given its own identity instead of overwriting the vendor's pane with another model's
    // output -- two models writing one pane is a display that lies about who said what.
    const acc = await streamTurn({ client, surface: spec.surface, req, seat: label ?? vendor, onEvent });
    if (mode === "replay") {
      // EVERY OUTPUT ITEM, on this path too. The unary Responses replay below keeps res.output so the
      // reasoning items (encrypted_content) survive to the next turn; this streaming branch rebuilt the
      // history from accumulated TEXT, so a streamed replay turn -- which is every turn the live view
      // runs -- silently lost reasoning continuity while STATE.md said it was kept. The terminal event
      // carries the completed response; use its items when the surface has them.
      const items = spec.surface === "responses" && Array.isArray(acc.final?.output) && acc.final.output.length
        ? [...(history ?? []), { role: "user", content: prompt }, ...acc.final.output]
        : appendReplay({ spec, history: history ?? [], prompt, text: acc.text });
      return replayResult({
        vendor, text: acc.text, tools: acc.tools, resumed: (history ?? []).length > 0,
        history: items,
        complete: acc.complete, why_incomplete: acc.why_incomplete,
      });
    }
    return {
      vendor, response_id: acc.response_id, text: acc.text, tools: acc.tools,
      resumed: Boolean(previousResponseId), streamed: true,
      // Surfaced, not just consumed. It was only folded into usable_for_resume, which made
      // `complete !== false` unfalsifiable for any caller checking it -- a assertion that
      // cannot fail is not a check.
      complete: acc.complete,
      // A truncated stream must not be persisted as a complete exchange.
      usable_for_resume: Boolean(acc.response_id) && acc.complete,
      why_unusable: !acc.complete ? acc.why_incomplete
        : (acc.response_id ? null : "vendor returned no response id; the next turn cannot resume"),
      usage: null,
    };
  }

  // Responses surface in REPLAY mode: send the preserved history as input, keep nothing
  // server-side, and ask for all_turns so earlier reasoning items are rendered again.
  if (spec.surface === "responses" && mode === "replay") {
    const items = [...(history ?? []), { role: "user", content: prompt }];
    const res = await client.responses.create({
      model: model ?? spec.default_model,
      input: items,
      store: false,                       // nothing retained vendor-side
      reasoning: { context: "all_turns" },
      ...extra,
    });
    const n = normalize(res, vendor, (history ?? []).length > 0);
    return {
      ...n,
      // Preserve EVERY output item, not the text. The reasoning items carry encrypted_content and
      // are what make all_turns work on the next turn; keeping only prose would silently drop
      // reasoning continuity while still looking like a working replay.
      history: [...items, ...(res?.output ?? [])],
      usable_for_resume: Array.isArray(res?.output) && res.output.length > 0,
      why_unusable: Array.isArray(res?.output) && res.output.length > 0
        ? null
        : "vendor returned no output items; replay continuity would be broken on the next turn",
    };
  }

  if (spec.surface === "responses") {
    const res = await client.responses.create({
      model: model ?? spec.default_model,
      input: prompt,
      ...(previousResponseId ? { previous_response_id: previousResponseId } : {}),
      ...extra,
    });
    return normalize(res, vendor, Boolean(previousResponseId));
  }
  return sendReplayTurn({ client, vendor, spec, model, prompt, history, extra });
}

// Replay surfaces. `history` is the prior conversation in the vendor's own message shape; the
// caller owns it and gets an updated copy back. Returning the new history rather than mutating
// the input keeps a failed turn from corrupting the caller's record.
async function sendReplayTurn({ client, vendor, spec, model, prompt, history = [], extra }) {
  const resumed = history.length > 0;
  if (spec.surface === "genai") {
    const contents = [...history, { role: "user", parts: [{ text: prompt }] }];
    const res = await client.models.generateContent({
      model: model ?? spec.default_model, contents, ...extra,
    });
    const text = typeof res?.text === "string" ? res.text : collectGenaiText(res);
    return replayResult({
      vendor, text, resumed,
      history: [...contents, { role: "model", parts: [{ text }] }],
    });
  }
  if (spec.surface === "messages") {
    const messages = [...history, { role: "user", content: prompt }];
    const res = await client.messages.create({
      model: model ?? spec.default_model,
      max_tokens: extra?.max_tokens ?? 1024,
      messages,
      ...extra,
    });
    const text = (res?.content ?? []).filter(b => b?.type === "text").map(b => b.text).join("");
    const tools = [...new Set((res?.content ?? []).filter(b => b?.type === "tool_use").map(b => b.name))].sort();
    return replayResult({
      vendor, text, tools, resumed,
      history: [...messages, { role: "assistant", content: res?.content ?? text }],
    });
  }
  throw new Error(`sendTurn: unhandled surface "${spec.surface}"`);
}

// Read a subscription token off disk. Returns null rather than throwing when absent, so the
// caller can fall back to a metered key. The value is returned to the SDK constructor and
// nowhere else: never logged, never put in an error string, never persisted.
function readOauthToken(spec, home) {
  try {
    const raw = JSON.parse(readFileSync(join(home, spec.file), "utf8"));
    const v = spec.path.reduce((o, k) => o?.[k], raw);
    return typeof v === "string" && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

// One request builder for both paths, so a streamed turn and a blocking turn cannot drift into
// sending different requests for the same inputs.
function buildRequest({ spec, model, prompt, previousResponseId, history, extra, mode }) {
  const m = model ?? spec.default_model;
  if (spec.surface === "responses") {
    if (mode === "replay") {
      return { model: m, input: [...(history ?? []), { role: "user", content: prompt }],
               store: false, reasoning: { context: "all_turns" }, ...extra };
    }
    return { model: m, input: prompt, ...(previousResponseId ? { previous_response_id: previousResponseId } : {}), ...extra };
  }
  if (spec.surface === "genai") {
    return { model: m, contents: [...(history ?? []), { role: "user", parts: [{ text: prompt }] }], ...extra };
  }
  return { model: m, max_tokens: extra?.max_tokens ?? 1024,
           messages: [...(history ?? []), { role: "user", content: prompt }], ...extra };
}

function appendReplay({ spec, history, prompt, text }) {
  if (spec.surface === "genai") {
    return [...history, { role: "user", parts: [{ text: prompt }] }, { role: "model", parts: [{ text }] }];
  }
  return [...history, { role: "user", content: prompt }, { role: "assistant", content: text }];
}

function collectGenaiText(res) {
  const parts = res?.candidates?.[0]?.content?.parts ?? [];
  return parts.map(p => (typeof p?.text === "string" ? p.text : "")).join("");
}

// A replay vendor returns no conversation id, so there is nothing to resume BY — continuity is
// the history we hold. `usable_for_resume` is therefore true whenever we captured a reply: the
// thing that must exist is the history, not an id. Saying otherwise would make every replay turn
// look like a continuity failure.
function replayResult({ vendor, text, tools = [], resumed, history, complete = true, why_incomplete = null }) {
  const ok = Array.isArray(history) && history.length > 0 && complete;
  return {
    vendor,
    response_id: null,
    text: text ?? "",
    tools,
    resumed,
    history,
    // Returned, not merely consumed. It was folded into usable_for_resume and then dropped,
    // so a caller asking "did this stream finish?" got undefined and any check on it was
    // unfalsifiable -- which a tightened stream-check caught immediately.
    complete,
    usable_for_resume: ok,
    why_unusable: ok ? null
      : (why_incomplete ?? "no history captured; the next turn would silently start a new conversation"),
    usage: null,
  };
}

// Normalize a Responses result. Every field is read defensively and its absence is REPORTED
// rather than defaulted: a missing response id means the next turn cannot resume, and silently
// substituting null would turn that into a fresh conversation wearing a resume's name.
export function normalize(res, vendor, wasResume) {
  const id = res?.id ?? null;
  const text = res?.output_text ?? collectText(res?.output);
  const tools = collectToolNames(res?.output);
  return {
    vendor,
    response_id: id,
    text: text ?? "",
    tools,
    resumed: wasResume,
    // Surfaced so a caller can refuse to continue rather than discover it a turn later.
    usable_for_resume: typeof id === "string" && id.length > 0,
    why_unusable: typeof id === "string" && id.length > 0
      ? null
      : "vendor returned no response id; the next turn cannot resume this conversation",
    usage: res?.usage ?? null,
  };
}

function collectText(output) {
  if (!Array.isArray(output)) return "";
  const parts = [];
  for (const item of output) {
    for (const c of item?.content ?? []) {
      if (typeof c?.text === "string") parts.push(c.text);
    }
  }
  return parts.join("");
}

// Tool names only -- never arguments, never results. The no-content rule that governs the
// transcript projectors governs this path too.
function collectToolNames(output) {
  if (!Array.isArray(output)) return [];
  const names = [];
  for (const item of output) {
    if (item?.type === "function_call" || item?.type === "custom_tool_call") {
      if (item.name) names.push(item.name);
    }
  }
  return [...new Set(names)].sort();
}
