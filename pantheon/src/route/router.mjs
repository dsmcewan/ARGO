// Seat routing: given a task, choose which seat runs it, and say why.
//
// The temptation here is a quality ranking — "openai is best at code" — and this router refuses
// to carry one, because nothing in this project has measured that. The 2026-09-27 paired eval
// returned every task tied. A ranking invented in a table and then cited as a reason is worse
// than no router: it launders a guess into an apparent decision, and every downstream report
// inherits the false confidence.
//
// So routing here is driven only by facts that were established:
//
//   CONTINUITY   which seats hold conversation state server-side vs replay it locally. Measured,
//                and it decides whether a long conversation costs a growing prefix every turn.
//   QUOTA        each vendor has its own subscription, so fan-out ACROSS vendors runs on
//                independent limits while fan-out WITHIN one vendor contends on a single pool.
//                This is the strongest fact available and it drives the diversity rule.
//   LATENCY      measured per seat, recorded as an ORDER OF MAGNITUDE only. Exact figures move
//                with load and prompt, so storing them as precise numbers would be false
//                precision; "seconds" vs "tens of seconds" is what survives.
//   ISOLATION    a reviewer must not share a vendor with the thing it reviews. Structural, and
//                the one rule this session has direct evidence for: cross-vendor review of a
//                design found two real defects that same-author tests missed.
//
// Everything else a caller wants to weigh is passed in per call as `prefer`, so a policy choice
// stays visible at the call site instead of hardening into a table nobody re-examines.

import { modelId } from "../config/models.mjs";

// Facts, each labelled with how it is known. `unmeasured` fields exist so a caller asking for
// something we cannot justify gets told, instead of receiving a confident arbitrary answer.
export const SEAT_FACTS = {
  openai: {
    vendor: "openai", continuity: "server", quota_pool: "openai",
    latency_class: "seconds",                       // measured 2026-09-27
    models: { default: modelId("openai", "luna"), strong: modelId("openai", "sol"), strongest: modelId("openai", "astra") },
    // CORRECTED 2026-09-28 against the current GPT-6 guidance, which documents SIX levels:
    // "`low`, `medium`, `high`, `xhigh`, `max`, or `ultra`. Available levels depend on the model
    // and client." (config-file/config-reference.md, model_reasoning_effort; the subagents page
    // lists the same six with per-level advice.)
    //
    // Three corrections, and only one of them was the obvious one:
    //   - `minimal` is NOT a reasoning level. The only "minimal" in the current docs is `:minimal`,
    //     a filesystem PERMISSION token -- an unrelated string that reads like a match.
    //   - `none` is not in the documented list for these models either. It was carried alongside
    //     minimal and is dropped with it, which also retires the `unsupported` entry below.
    //   - `ultra` was MISSING, and that one cost something: raiseEffort() walks this array, so
    //     escalation topped out at `max` and could never reach the deepest level the models offer,
    //     while wasting two steps on levels they do not advertise.
    effort: { param: "reasoning.effort",
      values: ["low", "medium", "high", "xhigh", "max", "ultra"],
      default: { "gpt-6-sol": "medium", "gpt-6-luna": "medium" },
      // Astra's own default is UNRECORDED: the reasoning guide names Sol's and Luna's only.
      // `unsupported` is now empty: it recorded that astra rejects `none`, which is moot once
      // `none` is not an advertised level at all. Kept as a key so the shape stays uniform.
      unsupported: {} },
    // Recorded 2026-09-28 from the operator's capability table. Previously ABSENT entirely, so all
    // three implementer rungs reported a null window -- the ladder was routed on bands whose
    // context claim nothing backed. 1.05M, distinct from anthropic's 1M: close enough to have been
    // assumed equal, which is exactly why it is written down rather than inferred.
    windows: { "gpt-6-astra": 1_050_000, "gpt-6-sol": 1_050_000, "gpt-6-luna": 1_050_000 },
    // No `windows` map on purpose: the catalogue page lists names and descriptions only, so no seat may
    // claim a CONTEXT basis on this lab until the per-model figures are read.
    // Astra's tool calling requires the Responses API; documented, not inferred.
    notes: "Responses API only; no Chat Completions fallback",
  },
  xai: {
    vendor: "xai", continuity: "server", quota_pool: "xai",
    latency_class: "seconds",
    // CORRECTED 2026-09-28. This comment previously said the documented id was
    // "grok-4.20-multi-agent" and that the bare "grok-4.20-multi-agent" was the wrong one. It
    // is the other way round: docs.x.ai/developers/model-capabilities/text/multi-agent gives
    // `"grok-4.20-multi-agent"` verbatim, and the operator's working SDK code passes that. The note
    // was carried as a cautionary example of a wrong id shipping unnoticed, which made it a trap --
    // a reader following it would have "fixed" the correct id back to a broken one.
    // tests/sdk-transport.test.mjs had been using the bare name all along, so the config and the
    // transport test disagreed and nothing caught it.
    models: { default: modelId("xai", "grok-4.6"), strong: modelId("xai", "grok-4.20-multi-agent") },
    windows: { "grok-4.7": 500_000, "grok-4.6": 500_000, "grok-4.5": 500_000, "grok-4.3": 1_000_000,
      "grok-4.20-multi-agent": 1_000_000, "grok-build-0.1": 256_000 },
    notes: "OpenAI-compatible surface at its own host; conformance executed, not assumed",
  },
  agy_google: {
    vendor: "agy_google", continuity: "replay", quota_pool: "agy_google",
    latency_class: "seconds",
    models: { default: modelId("google", "gemini-3.5-flash") },
    // This row describes the raw Gemini API adapter, which still requires GEMINI_API_KEY.
    // The board can opt into the Antigravity CLI's cached OAuth login instead;
    // sharing a vendor identity does not make these credentials or quota pools interchangeable.
    // Recorded 2026-09-28 from the operator's capability table; previously absent. The exact figure
    // is 1,048,576 (2^20) rather than a rounded 1M, and it is written as the vendor states it.
    // gemini-3.5-flash: operator's capability table, 2026-09-28.
    // gemini-3.8-flash-high: INFERRED, NOT VERIFIED. The same table gives 3.5 Flash and 3.7 Flash
    // both 1,048,576, and 3.8 is the same family, so this is the family figure carried forward. No
    // source states it for 3.8 specifically and `agy models` prints names only. It is written down
    // rather than left absent because the seat is live and a null window routes silently, but a
    // reader should treat this one number as weaker than its neighbours and correct it on sight.
    // claude-opus-4-6-thinking / claude-sonnet-4-6: served through the agy CLI's OAuth login
    // (Antigravity's own Claude bridge, not the raw Gemini adapter above), added 2026-09-29 when
    // the operator moved Pantheon's planner and implementer onto them. INFERRED, NOT VERIFIED --
    // `agy models` prints names only, and no source states these two models' window through this
    // specific bridge. Carried forward from anthropic's own recorded figure for the same model
    // generation (SEAT_FACTS.anthropic.windows, all 1,000,000) on the same reasoning as
    // gemini-3.8-flash-high just above: a live, routed-on seat should not report a null window, but
    // this number is weaker than its measured neighbours and should be corrected on sight.
    windows: { "gemini-3.5-flash": 1_048_576, "gemini-3.8-flash-high": 1_048_576,
      "claude-opus-4-6-thinking": 1_000_000, "claude-sonnet-4-6": 1_000_000 },
    notes: "Raw Gemini API adapter requires GEMINI_API_KEY; board agent turns can opt into agy CLI OAuth. Replay: every raw-API turn resends history",
  },
  anthropic: {
    vendor: "anthropic", continuity: "replay", quota_pool: "anthropic",
    latency_class: "seconds",
    // DEFAULT RAISED FROM HAIKU TO SONNET, operator decision 2026-09-28 ("run of the mill prompts
    // at Haiku -- bump that up to Sonnet"). Two consequences worth knowing rather than discovering:
    //   - WINDOW: haiku holds 200K, sonnet-5 holds 1M. Ordinary anthropic work gains five times the
    //     context, which is the point.
    //   - EFFORT: `unsupported` below records haiku as supporting NO effort level ("*"), while
    //     sonnet-5 accepts low|medium|high|xhigh|max. Raising the default therefore turns effort
    //     from inert into live for every unspecified anthropic call, and raiseEffort() can now step
    //     where it previously had nowhere to go.
    // haiku stays registered and routable; it is simply no longer what an unspecified call gets.
    models: { default: modelId("anthropic", "sonnet"), strong: modelId("anthropic", "sonnet"), strongest: modelId("anthropic", "opus") },
    // Context windows, read off the published model table on 2026-09-27 rather than assumed. They are
    // here because a CONTEXT-basis seating claim has to be checkable: the seating asserted that opus's
    // window was "the largest seated here", and it is not -- sonnet-5 has the same 1M. A basis that
    // cannot be checked against a number is a preference with a measurement's name on it.
    // claude-opus-5-5 was added when it became the planner's normal rung (a4bc6a8). Seating a model
    // whose window is unrecorded is a silent gap, not a loud one: callers read
    // `f.windows?.[model] ?? null`, so the rung would have reported a null window while the ladder's
    // own comment claimed 1M. Operator-supplied capability table, 2026-09-28.
    windows: { "claude-haiku-4-5-20251001": 200_000, "claude-sonnet-5": 1_000_000,
      "claude-opus-5": 1_000_000, "claude-opus-5-5": 1_000_000, "claude-fable-5-1": 1_000_000 },
    // platform.claude.com/docs/en/build-with-claude/effort, read 2026-09-27. FIVE values, not seven:
    // the OpenAI list (none/minimal/...) does NOT apply here, and using one shared ladder for both labs
    // was wrong. The parameter is `output_config.effort`, not `effort`.
    //
    // Default is `high` on EVERY supporting model except Claude Opus 5.5, which is `medium`. An earlier
    // note here said claude-opus-5 defaults to medium -- that was Opus 5.5's default misattributed to
    // Opus 5, and it would have run every escalation one rung short.
    //
    // `supports` is per model because "not every model that supports max supports xhigh": Sonnet 4.6
    // takes max but not xhigh. Haiku 4.5 is absent from the supported-models list entirely.
    effort: {
      param: "output_config.effort",
      values: ["low", "medium", "high", "xhigh", "max"],
      default: { "claude-fable-5-1": "high", "claude-sonnet-5": "high", "claude-opus-5": "high",
        "claude-opus-5-5": "medium" },
      supports: {
        "claude-fable-5-1": ["low", "medium", "high", "xhigh", "max"],
        "claude-opus-5": ["low", "medium", "high", "xhigh", "max"],
        "claude-opus-5-5": ["low", "medium", "high", "xhigh", "max"],
        "claude-sonnet-5": ["low", "medium", "high", "xhigh", "max"],
      },
      unsupported: { "claude-haiku-4-5-20251001": ["*"] },
      // Setting effort to a model's default is identical to omitting it.
      // AND: changing TOP-LEVEL effort between requests invalidates the prompt cache. That bites hardest
      // on a REPLAY vendor -- this one -- which resends the whole prefix every turn and depends on
      // caching to absorb the cost. Per-message effort preserves the cache but is beta
      // (mid-conversation-output-config-2026-07-01) and only on fable-5-1, mythos-5-1, opus-5-5, opus-5.
      cache_note: "top-level effort changes invalidate the prompt cache; vary it across workloads, not " +
        "within a cached conversation. Replay continuity makes this expensive rather than merely wasteful",
      // The docs name `low` for "simpler tasks that need the best speed and lowest costs, such as
      // subagents" -- which is the vendor's own guidance for the depth>=1 case.
      subagent_hint: "low",
    },
    notes: "rides the subscription via OAuth; replay, so cost grows with conversation length",
  },
};

// What a caller may ask for. Anything outside this set is rejected by name rather than silently
// ignored — a router that accepts an unknown requirement and routes anyway is lying about having
// honoured it.
export const KNOWN_NEEDS = new Set([
  "server_continuity",   // long conversation without resending the prefix each turn
  "replay_ok",           // caller accepts local replay
  "strong_model",        // the vendor's stronger tier, where one is declared
  "strongest_model",
  "independent_quota",   // must not share a pool with the seats named in `avoid`
  "different_vendor",    // must not be any vendor in `avoid`
]);

// Reasoning continuity is family-scoped, per OpenAI's docs: "Persisted reasoning can be reused
// only within the same model family... When you switch model families, the API omits incompatible
// reasoning." So re-routing a LIVE seat to a different family silently drops its reasoning
// continuity — the turn still succeeds and still looks continuous, which is why this needs to be
// a check rather than a note.
export const MODEL_FAMILY = {
  "gpt-6-luna": "gpt-6", "gpt-6-sol": "gpt-6", "gpt-6-astra": "gpt-6",
  "grok-4.6": "grok-4", "grok-4.20-multi-agent": "grok-4",
  "gemini-3.5-flash": "gemini-3",
  "claude-haiku-4-5-20251001": "claude-4-5", "claude-sonnet-5": "claude-5", "claude-opus-5": "claude-5",
};

/**
 * Is it safe to move a live seat from one model to another mid-conversation?
 * Same family: reasoning carries. Different family: it is dropped, silently.
 */
export function familyChange(fromModel, toModel) {
  const a = MODEL_FAMILY[fromModel], b = MODEL_FAMILY[toModel];
  if (fromModel === toModel) return { safe: true, why: "same model" };
  if (!a || !b) {
    return { safe: false, unknown: true,
      why: `family unknown for ${!a ? fromModel : toModel}; treat a switch as unsafe rather than assume` };
  }
  return a === b
    ? { safe: true, why: `same family (${a}); persisted reasoning carries` }
    : { safe: false, why: `${a} -> ${b} crosses model families; the API omits incompatible reasoning, ` +
        `so the seat loses its reasoning continuity while still appearing continuous` };
}

export const UNMEASURED = Object.freeze([
  "which seat writes better code",
  "which seat reasons better",
  "which seat is cheaper per useful result",
]);

const has = (seat, need, facts = SEAT_FACTS) => {
  const f = facts[seat];
  switch (need) {
    case "server_continuity": return f.continuity === "server";
    case "replay_ok": return true;
    case "strong_model": return Boolean(f.models.strong ?? f.models.strongest);
    case "strongest_model": return Boolean(f.models.strongest);
    default: return true;   // relational needs are handled against `avoid`, not per-seat
  }
};

/**
 * Choose seats for one task.
 *
 * Returns every candidate with the reason it was kept or dropped, not just the winner. A router
 * that returns only its pick cannot be audited, and the reason is the part a human needs when the
 * routing turns out wrong.
 */
export function route({
  needs = [], avoid = [], count = 1, facts = SEAT_FACTS, seats = Object.keys(facts),
} = {}) {
  // Dedupe first. A seat named twice is one seat, and letting a duplicate through inflated the
  // eligible count while the pick loop skipped it -- so `route` could return FEWER seats than
  // asked for and still report ok:true. Found by a test that expected pool contention and got a
  // short list instead.
  seats = [...new Set(seats)];
  const unknown = needs.filter(n => !KNOWN_NEEDS.has(n));
  if (unknown.length) {
    return {
      ok: false,
      why: `unknown need(s): ${unknown.join(", ")}. Known: ${[...KNOWN_NEEDS].join(", ")}. ` +
        `Deliberately not supported, because this project has not measured: ${UNMEASURED.join("; ")}.`,
      unknown,
    };
  }
  const avoidVendors = new Set(avoid.map(s => facts[s]?.vendor ?? s));
  const avoidPools = new Set(avoid.map(s => facts[s]?.quota_pool).filter(Boolean));

  const considered = seats.map(seat => {
    const f = facts[seat];
    if (!f) return { seat, kept: false, reason: "no facts recorded for this seat" };
    const missing = needs.filter(n => !has(seat, n, facts));
    if (missing.length) return { seat, kept: false, reason: `lacks ${missing.join(", ")}` };
    if (needs.includes("different_vendor") && avoidVendors.has(f.vendor)) {
      return { seat, kept: false, reason: `same vendor as an avoided seat (${f.vendor})` };
    }
    if (needs.includes("independent_quota") && avoidPools.has(f.quota_pool)) {
      return { seat, kept: false, reason: `shares the ${f.quota_pool} quota pool, so it would contend` };
    }
    return { seat, kept: true, reason: `satisfies ${needs.length ? needs.join(", ") : "no stated requirement"}` };
  });

  const eligible = considered.filter(c => c.kept).map(c => c.seat);
  if (eligible.length < count) {
    return {
      ok: false,
      why: `asked for ${count} seat(s), only ${eligible.length} eligible`,
      considered,
    };
  }

  // Among equally eligible seats, spread across quota pools first. That is the one preference
  // with evidence behind it: independent subscriptions mean cross-vendor fan-out does not
  // contend, so picking two seats from one pool throws away the parallelism the breadth bought.
  // Order within a pool is the caller's input order — NOT a quality judgement.
  const picked = [];
  const usedPools = new Set();
  for (const seat of eligible) {
    const pool = facts[seat].quota_pool;
    if (!usedPools.has(pool)) { picked.push(seat); usedPools.add(pool); }
    if (picked.length === count) break;
  }
  for (const seat of eligible) {
    if (picked.length === count) break;
    if (!picked.includes(seat)) picked.push(seat);   // pools exhausted: contention is now explicit
  }

  // Belt and braces: never report success with fewer seats than requested. The duplicate bug
  // above produced exactly that, and a caller fanning out over a short list would quietly run
  // less work than it asked for.
  if (picked.length !== count) {
    return { ok: false, why: `resolved only ${picked.length} of ${count} requested seat(s)`, considered };
  }

  return {
    ok: true,
    picked,
    models: Object.fromEntries(picked.map(s => [s, modelFor(s, needs, facts)])),
    considered,
    // Stated on every route, so a caller cannot mistake pool-spreading for a capability claim.
    basis: "routed on continuity, quota-pool independence and stated needs. NOT on model quality, " +
      "which this project has not measured (see UNMEASURED).",
    contention: picked.length > usedPools.size
      ? `${picked.length - usedPools.size} pick(s) share a quota pool and will contend`
      : null,
  };
}

export function modelFor(seat, needs = [], facts = SEAT_FACTS) {
  const m = facts[seat].models;
  if (needs.includes("strongest_model")) return m.strongest ?? m.strong ?? m.default;
  if (needs.includes("strong_model")) return m.strong ?? m.default;
  return m.default;
}

/**
 * Pair producers with reviewers so that no reviewer shares a vendor with what it reviews.
 * This is the routing rule with direct evidence behind it (evidence §U): cross-vendor review of
 * a design found two real defects that the author's own tests missed.
 */
export function routeReview(producers, seats = Object.keys(SEAT_FACTS), facts = SEAT_FACTS) {
  return producers.map(producer => {
    const r = route({ needs: ["different_vendor"], avoid: [producer], count: 1, seats, facts });
    return r.ok
      ? { producer, reviewer: r.picked[0], model: r.models[r.picked[0]], why: "different vendor from the producer" }
      : { producer, reviewer: null, why: r.why };
  });
}
