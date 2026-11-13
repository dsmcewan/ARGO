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

// Facts, each labelled with how it is known. `unmeasured` fields exist so a caller asking for
// something we cannot justify gets told, instead of receiving a confident arbitrary answer.
export const SEAT_FACTS = {
  openai: {
    vendor: "openai", continuity: "server", quota_pool: "openai",
    latency_class: "seconds",                       // measured 2026-09-27
    models: { default: "gpt-6-luna", strong: "gpt-6-sol", strongest: "gpt-6-astra" },
    // Astra's tool calling requires the Responses API; documented, not inferred.
    notes: "Responses API only; no Chat Completions fallback",
  },
  xai: {
    vendor: "xai", continuity: "server", quota_pool: "xai",
    latency_class: "seconds",
    models: { default: "grok-4.6", strong: "grok-4.20-multi-agent" },
    notes: "OpenAI-compatible surface at its own host; conformance executed, not assumed",
  },
  google: {
    vendor: "google", continuity: "replay", quota_pool: "google",
    latency_class: "seconds",
    models: { default: "gemini-3.5-flash" },
    notes: "raw Gemini API; NOT the agy seat. Replay: every turn resends the whole history",
  },
  anthropic: {
    vendor: "anthropic", continuity: "replay", quota_pool: "anthropic",
    latency_class: "seconds",
    models: { default: "claude-haiku-4-5-20251001", strong: "claude-sonnet-5", strongest: "claude-opus-5" },
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
