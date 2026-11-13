// Who sits where, and on what grounds.
//
// This file is the AGENT hierarchy: the strongest window on the plan, the Responses-API seat on the
// implementation, cheap independent pools on breadth and review, subagents under a seat. It stops
// where the board begins -- there is no `controller` entry, because scheduling is
// src/board/controller.mjs and a seat is never the thing that decides what runs next.
//
// ONE RULE THE HIERARCHY DOES NOT GIVE YOU FOR FREE: judgment does not climb it. A chain where each
// layer reviews the layer below puts a participant judge at every level, because the reviewer also
// wrote the assignment. That is the configuration that found nothing here on 2026-09-27, while
// cross-vendor review of a design the reviewers had NOT authored found two real defects. Work flows
// down the chain; review cuts across it, and `assertReviewCutsAcross` refuses the other arrangement.
//
// WHAT A SEATING IS ALLOWED TO BE JUSTIFIED BY. Every seat carries a `basis` from a closed set, and
// TASTE is a legal answer that must travel with the assignment. This project has measured continuity,
// quota independence and latency class, and has NOT measured which seat writes better code -- see
// UNMEASURED in src/route/router.mjs. A default seating is fine; a default seating whose grounds are
// invisible turns a preference into an apparent finding in every report downstream.
import { ROLES } from "./roles.mjs";
import { packOf, PROJECTION_FOR_ROLE } from "../board/project.mjs";
import { SEAT_FACTS, UNMEASURED, route, modelFor } from "../route/router.mjs";
import { modelId } from "../config/models.mjs";

/**
 * BASIS is a JUSTIFICATION LABEL for why a seat was chosen. It is never a surface.
 *
 * Two seats both labelled ISOLATION do not thereby share a checkout: reviewer reads `checker` (frozen
 * artifact bytes plus tests) and judge reads `synthesizer` (published peer objects plus tests). What
 * makes them one pool or two is the PROJECTION NAME, which is what contention.pack keys off -- never
 * this banner. A test pins that, because reading the banner as a surface is how one worktree ends up
 * holding two jobs with different titles.
 */
/**
 * A candidate names its model outright, or a tier to resolve from the router.
 *
 * The tier scheme is three wide (default/strong/strongest) and a lab's ladder is not obliged to fit
 * it -- Claude Fable is a fourth rung. So the seating table states the staffing directly and the
 * router's tiers remain a convenience rather than a ceiling on what can be seated.
 */
export const modelOf = (c, facts = SEAT_FACTS) =>
  c.model ?? modelFor(c.vendor, c.tier === "default" ? [] : [`${c.tier}_model`], facts);

/**
 * DIFFICULTY is the PRIMARY selector, and it is not the same thing as a fallback.
 *
 * Several models sit in one chair because the work varies. Which rung answers is chosen from the task,
 * not from a failure -- three separate operations that an ordered list glues into one:
 *
 *   DIFFICULTY  pick the rung from the task. The normal path. Nothing has gone wrong.
 *   WAIT        the hose refused WITH an interval. Same chair, same rung, later.
 *   RESEAT      the hose refused with no interval. Same chair, another lab.
 *
 * Conflating the first with the other two is how "a cheap model answered" gets read as "something
 * failed", and how a rate limit gets read as a reason to prefer a different model.
 */
export const DIFFICULTY = ["easy", "medium", "hard"];

/**
 * A BAND IS A FIT, NOT A TIER.
 *
 * `band` names the difficulty at which a model is the STRONGEST pick -- not its rank among its
 * siblings. The easy-band occupant is not the leftover that gets the scraps; on easy work it is the
 * better answer than the hard-band one, which arrives slower, dearer, and prone to reasoning past a
 * question that did not need it. Sonnet 5 holds the same 1M window as Fable and Opus; on a one-line
 * brief it is not the third-best planner, it is the right one.
 *
 * This corrects how these tables were first written. They were a RANK -- rank 0 best, then "second by
 * operator preference", "third", "cheapest of the three" -- with bands attached afterwards, so every
 * easy rung's own comment described it as a demotion. A rank and a router are different objects: a rank
 * says which model is better, a router says which model this work goes to. This project has measured
 * neither model's quality at any difficulty, and the band assignment is the operator's routing
 * judgment, so those rungs carry TASTE (a stated preference) rather than UNMEASURED (an untested
 * capability claim). Nothing here ranks the occupants, and no report should read it as ranking them.
 *
 * `selectFor` still resolves a missing band DOWNWARD, and that is not a quality claim either: the
 * nearest band is the nearest fit, and a tie breaks down because a too-easy seating underdelivers where
 * the review catches it, while a too-hard seating burns the pool silently and reports success.
 */

/**
 * EFFORT BEFORE MODEL-SWITCH.
 *
 * An effort dial is cheaper to turn than an occupant is to change, so escalating a step means raise
 * effort on the rung you are on and move up a rung only when the dial is at its top. Turning the dial
 * keeps the occupant, the pack and the lab.
 *
 * THERE IS NO SHARED LADDER. The value lists differ per lab and per MODEL
 * (docs/specs/2026-09-27-vendor-model-facts.md):
 *
 *   anthropic  output_config.effort  low medium high xhigh max        (five; no none/minimal)
 *   openai     reasoning.effort      none minimal low medium high xhigh max  (astra rejects `none`)
 *
 * A single hardcoded order across both was wrong and would have sent Anthropic an effort value it does
 * not accept. Every lookup now reads the lab's own recorded list, and a lab whose list is UNRECORDED
 * gets no effort escalation at all rather than a guessed one.
 */
export const EFFORT_STATE = { DEFAULT: "default", UNRECORDED: "unrecorded", UNSUPPORTED: "unsupported" };

/** The effort this model runs at, with WHY it is that value -- absent and unsupported are not the same. */
export function effortFor(vendor, model, facts = SEAT_FACTS) {
  const e = facts[vendor]?.effort;
  if (!e) return { value: null, state: EFFORT_STATE.UNRECORDED, why: `${vendor}'s effort parameter is not recorded` };
  if (e.unsupported?.[model]?.includes("*")) {
    return { value: null, state: EFFORT_STATE.UNSUPPORTED, why: `${model} does not accept ${e.param}` };
  }
  const d = e.default?.[model];
  return d
    ? { value: d, state: EFFORT_STATE.DEFAULT, why: `${model}'s documented default` }
    : { value: null, state: EFFORT_STATE.UNRECORDED, why: `${model}'s default is not recorded` };
}

/** Values this model accepts, in order. Empty when unrecorded or unsupported. */
export function effortLadder(vendor, model, facts = SEAT_FACTS) {
  const e = facts[vendor]?.effort;
  if (!e?.values) return [];
  if (e.unsupported?.[model]?.includes("*")) return [];
  const banned = new Set(e.unsupported?.[model] ?? []);
  // Per-model support, because not every model that takes `max` takes `xhigh`.
  const allowed = e.supports?.[model] ?? e.values;
  return e.values.filter(v => allowed.includes(v) && !banned.has(v));
}

/** The next effort up, or null when the dial is at its top, unsupported, or unrecorded. */
export function raiseEffort(vendor, model, current, facts = SEAT_FACTS) {
  const ladder = effortLadder(vendor, model, facts);
  if (!ladder.length) return null;
  const from = current ?? effortFor(vendor, model, facts).value;
  const i = ladder.indexOf(from);
  if (i === -1) return null;                  // an unrecorded starting point cannot be stepped from
  return ladder[i + 1] ?? null;
}

export const BASIS = {
  // Published or measured facts about the seat.
  CONTEXT:    "the size of the window the role needs",
  CONTINUITY: "whether the vendor holds conversation state server-side",
  QUOTA:      "which subscription pool the seat spends from",
  SURFACE:    "an API-level capability the role requires",
  // Structural properties of the topology, not of the vendor.
  ISOLATION:  "the reviewer must not share a vendor with the producer",
  // Honest labels for everything else.
  TASTE:      "an operator preference, not a measurement",
  UNMEASURED: "a capability claim this project has not tested",
};

/**
 * Default seating, most-preferred first. `route()` still arbitrates, so a seat that is unavailable
 * or that would collide with an avoided vendor falls through to the next candidate.
 *
 * There is deliberately NO entry for the controller: it is code (src/board/controller.mjs).
 */
export const SEATING = {
  // NOTE ON THE anthropic POOL, learned by hitting it: it is NOT independent of the operator. The
  // interactive session driving this harness runs on the same subscription, so a planner seated here
  // competes with the human's own turns and returns 429 under exactly the load the harness creates.
  // A live run on 2026-09-27 refused at the planner for that reason (request_id req_011CfU5GKZK...).
  // The QUOTA basis elsewhere means "its own subscription"; for anthropic it means "shared with whoever
  // is driving", which is a different fact and has to be said rather than discovered per run.
  planner: [
    // SONNET 4.6 VIA AGY IS THE ACTUAL DEFAULT, CORRECTED 2026-09-29. First landed with Opus 4.6 as
    // this rung (same day); the operator's own words, immediately after: "Sonnet will suffice at
    // most of what it's given to plan, saving tokens on a lesser model. But if it needs advice Opus
    // can step in. Not everything needs to be routed through Opus. That's what is being avoided."
    // Sonnet sits first -- candidatesFor/roleTurn's real dispatch is pure array order, so position,
    // not band, is what makes this the actual default -- and carries the cheap/usually-sufficient
    // band, mirroring how opus-5-5 (not fable) catches most requests on the anthropic ladder just
    // below: the dearer model comes SECOND in this file's own established convention, not first.
    // Same agy CLI OAuth quota as implementer's own top rung, independent of the anthropic pool this
    // session is rationing and of openai (confirmed dead). No env var needed: agyTurn forces the CLI
    // lane unconditionally for planner (the SDK lane has no --role planner at all, on any input).
    { vendor: "agy_google", model: "claude-sonnet-4-6", band: "easy", basis: "TASTE",
      why: "the operator's actual instruction: Sonnet handles most planning work, saving tokens " +
        "against a stronger rung most tasks don't need. Same charter as implementer's top rung, " +
        "different quota from anthropic below" },
    // OPUS 4.6 VIA AGY -- the escalation, reached when Sonnet's own rung is unavailable (this
    // ladder's only working notion of "needs advice": Pantheon has no mechanism for a model to flag
    // mid-turn that a harder rung should answer instead; a pin or an explicit seatOverride is the
    // operator's way to put a specific hard ticket straight on this rung instead of waiting for it).
    // Live-validated 2026-09-29: a real turn on claude-opus-4-6-thinking via
    // .agents/agents/pantheon-planner (correct reply, 0 tool calls), then a full ticket shipped
    // end to end with this seat as planner (validateAgyCliOpusSonnet1) -- both runs predate this
    // correction and used Opus as the top rung; the CLI path itself is unaffected by the reorder.
    { vendor: "agy_google", model: "claude-opus-4-6-thinking", band: "hard", basis: "TASTE",
      why: "the escalation the operator described -- 'if it needs advice, Opus can step in' -- kept " +
        "on the same agy_google quota as the Sonnet rung above rather than falling all the way to " +
        "the anthropic hose for what is still, deliberately, not the default" },
    // FABLE 5.1 -> OPUS 5.5, both anthropic. The operator named these two on 2026-09-28; this is a
    // stated preference, not a measurement, and nothing below ranks the occupants.
    //
    // WHY ONLY TWO RUNGS, AND WHY OPUS 5.5 CARRIES THE `easy` BAND. selectFor resolves a missing
    // band DOWNWARD to an easier one, and failing that takes cands[0]. With rungs at hard and
    // medium only, an `easy` planning request would find nothing below it and fall to cands[0] --
    // fable, the dearest seat in the table. Banding opus-5-5 `easy` instead makes BOTH easy and
    // medium land on it (medium finds no exact rung and falls to the easier one), leaving fable
    // for `hard` alone. That is this file's own stated principle applied: a too-easy seating
    // underdelivers where the review catches it, a too-hard one burns the pool silently and
    // reports success.
    //
    // CONSEQUENCE, unchanged and still the point of tagging pools: this ladder is ONE HOSE. A 429
    // with no retry-after leaves nowhere to reseat, only somewhere to wait. It trades a cross-lab
    // escape for keeping planning on one lab, and `wait_only` reports it.
    // BASIS CHANGED FROM CONTEXT TO TASTE on 2026-09-28, and a guard is why. CONTEXT means "the
    // largest recorded window in this role's pool", and that stopped being true the moment a
    // gpt-6 seat joined the planner: 1,050,000 against this rung's 1,000,000. The window is still
    // ample and still the reason this rung can hold the whole brief at once -- but "ample" is not
    // the claim CONTEXT makes, and the operator named these two seats as a preference anyway.
    // TASTE is what that is. The test caught this the same minute the seat was added.
    { vendor: "anthropic", model: modelId("anthropic", "fable"), band: "hard", basis: "TASTE",
      why: "a 1M window, which is what this role's brief actually needs -- it holds the ticket, the " +
        "constraints and the evidence at once. The operator's top rung for planning. OPERATIONAL " +
        "NOTE, from the model table: its default effort is `high` and its thinking is always on, so " +
        "it is the slowest and dearest rung -- worth knowing when the brief's entire output is one " +
        "line, which is why it holds `hard` alone rather than acting as the fallback" },
    { vendor: "anthropic", model: modelId("anthropic", "opus-5-5"), band: "easy", basis: "TASTE",
      why: "the operator's second planning seat, and deliberately banded `easy` so that every " +
        "planning request except an explicit `hard` one resolves here instead of falling up to " +
        "fable. The band is a routing label, not a quality claim: this is where a plan has real " +
        "structure to get right but is not contested. Quality is unmeasured on both rungs" },
    // THE HOSE NOW HAS AN END. The note above said a 429 with no retry-after leaves "nowhere to
    // reseat, only somewhere to wait" -- and on 2026-09-28 a real build proved what that costs: it
    // drafted on gpt-5.5, scouted on gemini, reached the plan stage and stopped dead, because the
    // subscription this ladder waits on is the SAME one the operator's session spends. Asking LEXI
    // to build something is most likely to happen exactly when that credential is busy.
    //
    // The operator's decision was to allow gpt-6-sol "if and when". NO BAND is how "if and when" is
    // enforced, and it is not decoration: selectFor reaches an unbanded seat only through
    // `cands[0]`, after `exact` and `below` have both failed. While either rung above is alive one
    // of them is banded and wins, so this chair is UNREACHABLE by construction rather than by
    // preference ordering. candidatesFor drops a whole vendor when it is avoided, so the shut hose
    // is what promotes this seat to cands[0].
    //
    // The cost is real and is the reason it sits last: the implementer ladder is entirely openai,
    // so a plan made here shares a lab with the hands that execute it. The reviewer is still
    // cross-lab -- assertReviewCutsAcross binds the maker/checker pair, not the planner -- so the
    // check that has evidence behind it survives. Planning and implementing on one lab does not.
    // BASIS IS QUOTA, and that is the measured fact that justifies this seat existing at all: it
    // draws on a different pool from the two rungs above. Not SURFACE -- the Responses API is why
    // openai holds the IMPLEMENTER chair, and it has nothing to do with why this one is here. Not
    // TASTE either: nobody prefers this seat, it is what is left when the hose is shut.
    { vendor: "openai", model: modelId("openai", "sol"), basis: "QUOTA",
      why: "the last resort when the anthropic hose is shut, which is a 429 carrying no " +
        "retry-after and no anthropic-ratelimit-* headers -- a subscription-side limit with no " +
        "interval to wait for. Deliberately unbanded so it is unreachable while either rung above " +
        "is available. gpt-6-sol rather than astra or luna because this is the middle of the " +
        "operator's openai ladder: a plan is structure, not a one-line edit and not the dearest " +
        "reasoning in the table. Quality here is unmeasured, like every other seat in this file" },
  ],
  implementer: [
    // SONNET 4.6 VIA AGY, operator instruction 2026-09-29: "The implementers will be Sonnet 4.6
    // through Agy as well." Same mechanism and same reasoning as the planner entry above: agy CLI
    // OAuth login, separate quota from both the rationed anthropic pool and openai below (confirmed
    // dead, HTTP 429 "no credits remaining", live-checked this session). No env var needed: agyTurn
    // forces the CLI lane unconditionally for implementer too (the SDK lane has no --role
    // implementer at all, on any input).
    // Live-validated 2026-09-29 twice: an isolated real turn on claude-sonnet-4-6 via
    // .agents/agents/pantheon-implementer -- exact NO_TOOLS text-only reply, the same contract
    // every other vendor's implementer runs under (see run-item.mjs's agyTurn), 0 tool calls --
    // then a full ticket shipped end to end with this seat as implementer AND with zero
    // seatOverrides at all, true default routing (validateAgyCliOpusSonnet1, validateAgyDefaultE2E1).
    { vendor: "agy_google", model: "claude-sonnet-4-6", band: "hard", basis: "TASTE",
      why: "the operator's stated top rung for implementing as of 2026-09-29, chosen specifically " +
        "to avoid both the rationed anthropic pool and openai's dead credits. Same charter, " +
        "different quota from the openai ladder below" },
    // ASTRA -> SOL -> LUNA, all openai. SURFACE justifies the LAB, not the rung: the Responses-API-only
    // constraint is recorded against the vendor, so it is why openai holds this chair and not why astra
    // outranks luna. That ordering is the operator's and is labelled as such.
    //
    // VENDOR GUIDANCE NOW CONTRADICTS THAT ORDER, recorded 2026-09-28 rather than acted on, because
    // the order is a stated operator preference and not this file's to overturn. OpenAI's subagent
    // documentation says of the same three models:
    //   sol   -- "Start here for demanding agents. It's strongest for ambiguous, multi-step work
    //            that needs planning, tool use, validation, and follow-through across a larger
    //            context."
    //   luna  -- "Use for fast, narrowly scoped agents handling clear, repeatable, or high-volume
    //            work."
    //   and for starting reasoning effort: "start with `medium` for GPT-6 Sol, `high` for GPT-6
    //   Luna, or `low` for GPT-6 Astra."
    // So the vendor puts SOL at the demanding end and starts ASTRA at low effort, which is the
    // reverse of the hard/medium/easy banding below. The banding was always labelled TASTE and
    // UNMEASURED, so nothing here was falsified -- but "unmeasured" is now "unmeasured and
    // contradicted", which is a different thing to leave unsaid.
    // Source: kb/openai-agent-docs/codex/agent-configuration-subagents.md:165-181.
    // To act on it, swap the astra and sol entries and re-band; the operator decides, not this file.
    { vendor: "openai", model: modelId("openai", "astra"), band: "hard", basis: "SURFACE",
      why: "openai is the seat whose Responses API this project has executed against, and tool calling " +
        "on this lab requires it. That fact is about the LAB; astra being first is the operator's ladder" },
    { vendor: "openai", model: modelId("openai", "sol"), band: "medium", basis: "TASTE",
      why: "same lab, same API surface, so SURFACE cannot order the rungs -- the split is by FIT: " +
        "an ordinary change against a known interface. Not a second choice" },
    { vendor: "openai", model: modelId("openai", "luna"), band: "easy", basis: "TASTE",
      why: "same lab and surface again, and the better seating for a small mechanical edit, which it " +
        "turns around faster. The operator's band assignment; no measurement of code quality here" },
  ],
  reviewer: [
    // GROK, and never the maker's lab. Those are two different statements and both are load-bearing:
    // ISOLATION says which lab may NOT sit here (whichever one produced the artifact) and is enforced
    // by ROLES.reviewer.needs `different_vendor`; the grok rungs say who sits here otherwise.
    { vendor: "xai", model: modelId("xai", "grok-4.7"), band: "hard", basis: "ISOLATION",
      why: "a different lab from the openai implementer, which is this role's hard requirement. Banded " +
        "hard: the seating for a contested diff, a security-relevant change, or anything whose defect " +
        "would survive a quick read. 500k window, same as 4.6" },
    { vendor: "xai", model: modelId("xai", "grok-4.6"), band: "medium", basis: "ISOLATION",
      why: "same lab, same 500k window, and the stronger pick for an ordinary diff -- a review turns on " +
        "reading the artifact closely, which it does without the slower rung's overhead. The one this " +
        "harness has actually called and had answer (2026-09-27)" },
    // The isolation tail: if the implementer is ever seated on xai, grok cannot review its own lab.
    // These are RESEATS, not lesser reviewers -- the chair has to have somewhere to go.
    { vendor: "agy_google", model: modelId("google", "gemini-3.5-flash"), band: "easy", basis: "ISOLATION",
      why: "the reseat when the implementer holds the xai lab; a reviewer may never share the maker's" },
    { vendor: "anthropic", tier: "default", basis: "ISOLATION",
      why: "last reseat, same reason: what disqualifies a reviewer is the lab it shares, never its size" },
  ],
  explorer: [
    // Models pinned by the operator 2026-09-28 ("subagents Gemini 3.8-High-Flash, Grok 4.7").
    // gemini-3.8-flash-high is the id exactly as `agy models` prints it -- Antigravity bakes the
    // effort into the model name, so "High" is part of the id and not a separate flag.
    { vendor: "agy_google", model: modelId("google", "gemini-3.8-flash-high"), basis: "QUOTA",
      why: "breadth wants independent pools, and google/xai spend from their own subscriptions, so " +
        "fan-out across them does not contend" },
    { vendor: "xai", model: modelId("xai", "grok-4.7"), basis: "QUOTA",
      why: "the second independent pool; two explorers here run genuinely concurrently" },
  ],
  advocate: [
    { vendor: "xai", model: modelId("xai", "grok-4.7"), basis: "QUOTA", why: "as above; an advocate's output is argument, never evidence" },
    { vendor: "agy_google", model: modelId("google", "gemini-3.8-flash-high"), basis: "QUOTA",
      why: "the second independent pool; an advocate's output is argument, never evidence" },
  ],
  judge: [
    { vendor: "anthropic", tier: "strong", basis: "ISOLATION",
      why: "must not have produced any of what it reads; the vendor is whichever one did not " +
        "participate, so this order is a starting point that assertJudgeEligible overrides" },
    { vendor: "openai", tier: "strong", basis: "ISOLATION",
      why: "same rule: eligible only when openai produced none of what is being judged" },
    { vendor: "agy_google", tier: "default", basis: "ISOLATION",
      why: "same rule; a cheap judge is acceptable because judging reads rather than produces" },
    { vendor: "xai", tier: "default", basis: "ISOLATION",
      why: "same rule; last resort, and if every vendor participated there is no clean judge at all" },
  ],
};

/**
 * INTAKE sits OUTSIDE the chain.
 *
 * The chain presupposes a board, and a board presupposes a ticket. A scout runs before either exists:
 * its input is the raw question, its output is evidence, and that evidence enters the board as
 * LINEAGE -- the ticket cites it by cid -- not as a slot anybody merged.
 *
 * It is also the only stage where fan-out belongs. Breadth BEFORE commitment is independent framing,
 * which is what made cross-model review pay here. Breadth nested INSIDE a running hierarchy is the
 * same answer in three accents plus a bill: the workers share the assignment that primed them, and
 * the layer that fanned them out then grades the result. You do not put a swarm inside.
 */
export const INTAKE = {
  scout: [
    // agy_google commented out 2026-09-29: flapping between HTTP 402 (prepayment credits
    // depleted -- confirmed live, four independent methods: this SDK, a raw curl with no SDK
    // involved, the official gemini CLI, and this same SDK again) and one brief working window,
    // all inside a few hours. A scout failure kills the whole ticket at intake in under two
    // seconds -- see run-item.mjs's SCOUT_VENDORS default and the "scouts" override it accepts --
    // so an unreliable scout is worse than no scout. Restore this entry once the operator
    // confirms the account is stable, not merely that one live check passed.
    // { vendor: "agy_google", tier: "default", basis: "QUOTA",
    //   why: "scouting is breadth on an open question, so it wants the cheap independent pools; " +
    //     "agy_google and xai each spend from their own subscription and genuinely run at the same time" },
    // SIXTEEN SUBAGENTS. The operator seated this deliberately and the count is the point: the
    // model runs an internal team, so this one chair IS a fan-out. docs.x.ai names the id
    // "grok-4.20-multi-agent" verbatim and `agent_count` accepting 4 or 16 on the xAI SDK; on the
    // OpenAI-compatible surface this project uses, the equivalent control is `reasoning.effort`
    // (low|medium|high|xhigh), NOT agent_count -- so how 16 is requested through THIS transport is
    // still unverified.
    //
    // Two documented constraints ride with it: "The max_tokens parameter is not currently supported
    // by the multi-agent model variant", and no client-side or custom tools are supported. The
    // first is why run-item.mjs no longer caps a scout on this model -- see the note there.
    { vendor: "xai", model: modelId("xai", "grok-4.20-multi-agent"), basis: "QUOTA",
      why: "sixteen subagents in one chair: the second independent pool, and an internal team " +
        "rather than a single answer" },
    { vendor: "openai", tier: "default", basis: "QUOTA",
      why: "a third lane when the question is wide enough to want one" },
  ],
};

export class FanOutViolation extends Error {}

/**
 * Fan-out happens at intake, at depth 0, and nowhere else.
 *
 * `stage` is "intake" or "chain"; `depth` is how far under a seat the fan-out would sit.
 */
export function assertFanOutIsOutside({ stage, depth = 0, width = 1 }) {
  if (width <= 1) return true;                       // not a fan-out
  if (stage !== "intake") {
    throw new FanOutViolation(
      `a fan-out of ${width} cannot run inside the chain (stage "${stage}"): the workers would share ` +
      `the assignment that primed them and the layer that fanned them out would grade the result. ` +
      `Breadth belongs at intake, before commitment.`);
  }
  if (depth !== 0) {
    throw new FanOutViolation(
      `a fan-out of ${width} at depth ${depth} is nested under a seat, so it spends from that seat's ` +
      `pool and is one lane however wide it looks. Fan out at depth 0, across vendors.`);
  }
  return true;
}

/**
 * Seats named in the chain that this repo cannot fill. Listed so a plan that assumes them fails
 * loudly instead of silently seating something else.
 */
/**
 * Transport, not vendor.
 *
 * Codex is OpenAI. It is the openai seat reached through a CLI instead of the SDK, and the same is
 * true of every vendor here: each has a CLI with native resume, and Pantheon implements only the SDK
 * transport. So "Codex as the dispatcher tier" is not a missing vendor -- it is a missing transport
 * for a vendor that is already seated, and the gap applies to all four equally.
 *
 * It still matters which transport a seat ran on, because the seat identity, the credential and the
 * model differ: the openai SDK seat is gpt-6-* on `apiKey`, the Codex CLI seat is gpt-5.6-sol on
 * subscription OAuth. Reporting one as the other would mislabel the run, which is why `transport` is
 * recorded rather than assumed.
 */
export const TRANSPORTS = {
  sdk: { implemented: true, why: "the vendor SDKs; what every seat in this repo uses today" },
  cli: { implemented: false,
    why: "each vendor's CLI, all of which support native resume and none of which this repo drives. " +
      "Codex is the openai one (subscription OAuth, gpt-5.6-sol); Anthropic's first-party one is `ant` " +
      "(named in the CLI/SDK overview alongside the seven client SDKs); xai and google have their own" },
};

/** Named in the chain, and genuinely not a seat this harness can fill. */
/**
 * Models deliberately NOT given a chair, with the reason.
 *
 * EMPTIED 2026-09-28. Its only entry said claude-fable-5-1 was "a session tier used to design and
 * hand off, not a vendor this harness calls: it has no adapter because it is not a seat". That
 * stopped being true when the operator seated fable as the planner's hard rung, and the two
 * statements then sat forty lines apart in this file contradicting each other. The claim about the
 * adapter was the part that misled: adapters are per VENDOR, so fable routes through anthropic's
 * like every other Claude model -- there was never a missing adapter to be a reason.
 *
 * Nothing enforced this table, which is why a live contradiction survived a green suite. The test
 * "NOT_SEATED and SEATING cannot contradict each other" now does.
 */
export const NOT_SEATED = {};

/** `agy` is a transport name; for the lab laws (assertReviewCutsAcross), it is the google lab. */
export const AGY_SEAT = {
  lab: "google",
  pool: "The CLI OAuth models spend from one subscription pool. The SDK's GEMINI_API_KEY uses a separate API quota; neither credential nor cooldown is interchangeable.",
  tools: ["view_file", "list_directory", "search_directory", "find_file", "run_command"],
  writes: false,
  // "sdk" for scout/reviewer, which genuinely support both lanes and default to sdk unless
  // PANTHEON_AGY_TRANSPORT=cli is set. NOT true for planner/implementer as of 2026-09-29: agyTurn
  // in run-item.mjs forces them onto "cli" unconditionally, because agy-seat.py's --role choices
  // (["reviewer", "scout", "fact-checker"]) have no SDK-lane code path for either role at all.
  default_lane: "sdk",
  lanes: {
    sdk: {
      script: "scripts/agy-seat.py",
      venv: ".venv-antigravity",
      credential: "GEMINI_API_KEY",
      why: "The google-antigravity SDK Agent has read-only tools plus a shell, one bounded fact-checker subagent, a budget, and hooks that append every tool call and subagent start/finish to the run's progress.jsonl.",
    },
    cli: {
      cmd: "agy",
      credential: "cached OAuth session",
      dir: ".agents/agents",
      agents: ["pantheon-reviewer", "pantheon-scout", "pantheon-fact-checker", "pantheon-planner", "pantheon-implementer"],
      why: "The Antigravity CLI is configured to select these role cards with --agent and use its cached OAuth login. Cutover validated live 2026-09-29 for all five: scout/reviewer opt in via PANTHEON_AGY_TRANSPORT=cli, planner/implementer are forced onto it unconditionally (see the default_lane note above). Headless command execution needs scoped permissions.allow rules, and an empty timed-out response is not an accepted turn.",
    },
  },
};

/** One vendor identity can still have two unrelated quota authorities. */
export function cooldownPoolFor(seat, agyTransport = "sdk") {
  return seat.vendor === "agy_google" && agyTransport === "cli" ? "agy_cli_oauth" : seat.pool;
}

/**
 * A seat's subagents spend from that seat's pool.
 *
 * This is the part of "and then there's subagents" that is easy to get backwards. Cross-VENDOR
 * fan-out runs on independent subscriptions and genuinely parallelises. A tree of subagents under one
 * vendor does not: it is the same pool, so depth buys context isolation and buys no throughput. Worth
 * stating because a diagram showing four seats each with three children looks like twelve lanes and
 * is four.
 */
export function subtreeCost(vendor, children, facts = SEAT_FACTS) {
  const f = facts[vendor];
  if (!f) return { ok: false, why: `no facts recorded for "${vendor}"` };
  return {
    ok: true, pool: f.quota_pool, lanes: 1, calls: 1 + children,
    why: `${1 + children} call(s) on the ${f.pool ?? f.quota_pool} pool but 1 independent lane: ` +
      `depth under one vendor buys context isolation, not throughput`,
  };
}

/** Bound the tree. An unbounded one is discovered as a bill, not as a design. */
export const DEPTH_LIMIT = 2;

/**
 * A subagent writes INSIDE its parent: the parent's lease, the parent's projection, the parent's
 * produce set.
 *
 * `subtreeCost` already says four calls under Astra are one lane. This is the other half of that: extra
 * depth buys a smaller window for a sub-task, NOT four implementers. Without it, a subagent could mint
 * board kinds the implementer role never admitted -- so the role's produce set would describe the chair
 * and not what actually landed, and every inclusion law above would be true of the table and false of
 * the board.
 */
export function assertSubagentProduce({ parentRole, kinds = [], depth = 1, lease = null, roles = ROLES }) {
  const spec = roles[parentRole];
  if (!spec) throw new FanOutViolation(`unknown parent role "${parentRole}"`);
  if (!Number.isInteger(depth) || depth < 1) throw new FanOutViolation("a subagent sits at depth >= 1");
  if (depth > DEPTH_LIMIT) {
    throw new FanOutViolation(`depth ${depth} exceeds DEPTH_LIMIT ${DEPTH_LIMIT}: an unbounded tree is ` +
      `discovered as a bill, not as a design`);
  }
  const outside = kinds.filter(k => !spec.produces_kinds.includes(k));
  if (outside.length) {
    throw new FanOutViolation(
      `a subagent of "${parentRole}" cannot produce ${outside.join(", ")}: the parent produces only ` +
      `${spec.produces_kinds.join(", ") || "nothing"}. A child that mints a kind the chair never ` +
      `admitted makes the role table describe the chair and not the board`);
  }
  if (kinds.length && !(lease?.resource && Number.isInteger(lease?.gen))) {
    throw new FanOutViolation(
      `a subagent of "${parentRole}" writes under the PARENT's lease; pass {resource, gen}. Its own ` +
      `lease would be a second writer of the same name`);
  }
  return { ok: true, depth, lanes: 1, under: lease?.resource ?? null,
    why: `depth ${depth} under ${parentRole}, writing ${kinds.join(",") || "nothing"} on the parent's ` +
      `lease gen ${lease?.gen ?? "-"}: one lane, one writer` };
}

/**
 * Is a vendor error worth falling through to the next seated candidate, and can the SAME vendor be
 * retried instead?
 *
 * A seating table that cannot survive a rate limit is a preference, not a plan: the fallback ranks
 * exist for the moment the first choice is unavailable, and until something consults them at RUNTIME
 * they are decoration. Only transport-level unavailability counts -- a 400 means the request was wrong
 * and the next vendor will refuse it too, so retrying it elsewhere would report a fallback where the
 * truth is a bug.
 *
 * THE 429 THAT CANNOT BE WAITED OUT. Anthropic's documented rate-limit 429 carries `retry-after` plus
 * `anthropic-ratelimit-*`, and its documented spend-cap 429 carries
 * `error.details.error_code = "enforced_spend_limit_reached"`. A live 429 on the SUBSCRIPTION path
 * (OAuth, `rateLimitTier: default_claude_max_20x`) on 2026-09-27 carried NEITHER: 17 response headers
 * and not one `anthropic-ratelimit-*`, no `retry-after`, `message: "Error"`, no `details`
 * (request_id req_011CfU5wmhGtFRr6jmnKSu72). So there is no interval to back off for, and a client
 * that retries the same seat is guessing. `same_vendor_viable` says which kind of failure this is:
 * with a retry-after, waiting is legitimate; without one, the only correct move is another vendor.
 */
export function shouldFallThrough(err) {
  const status = err?.status ?? err?.response?.status ?? null;
  const code = err?.code ?? err?.cause?.code ?? null;
  const header = n => { try { return err?.headers?.get?.(n) ?? null; } catch { return null; } };
  const retryAfter = Number(header("retry-after"));
  const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null;
  const spendCap = (err?.error?.error?.details?.error_code ?? null) === "enforced_spend_limit_reached";

  if (status === 429) {
    return {
      ok: true, retry_after_s: wait, same_vendor_viable: wait !== null && !spendCap,
      why: spendCap ? "spend cap reached (429, no retry-after by design)"
        : wait !== null ? `rate limited (429, retry-after ${wait}s)`
        : "429 with no retry-after and no anthropic-ratelimit-* headers: a subscription-side limit, " +
          "not the documented API rate limit, and there is no interval to wait for",
    };
  }
  if (Number.isInteger(status) && status >= 500) {
    return { ok: true, retry_after_s: wait, same_vendor_viable: true, why: `vendor error (${status})` };
  }
  if (["ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "UND_ERR_CONNECT_TIMEOUT"].includes(code)) {
    return { ok: true, retry_after_s: null, same_vendor_viable: true, why: `transport (${code})` };
  }
  return { ok: false, retry_after_s: null, same_vendor_viable: false,
    why: status ? `status ${status} is the request's problem, not the vendor's` : "not a transport failure" };
}

/**
 * The seated candidates for a role, in order, each tagged with the QUOTA POOL it spends from.
 *
 * The pool tag is what separates two different operations that an ordered list glues together:
 *
 *   WAIT    the next candidate is in the SAME hose. That is not a different seat and not a different
 *           hose -- it is the same body in the same chair, later. On a 429 that carries no retry-after
 *           there is no interval to wait for, so reaching for it buys nothing.
 *   RESEAT  the next candidate is in ANOTHER hose. The chair is still `planner`; the occupant changed.
 *
 * The planner's rank 1 is a second anthropic tier ON PURPOSE -- it is a legitimate alternative
 * occupant, labelled UNMEASURED -- but it must never be reached BY a rate limit, because a rate limit
 * is not a reason to prefer a different model. Runtime decides which operation it is; the table just
 * states who could sit there.
 */
export function candidatesFor(role, { seating = SEATING, facts = SEAT_FACTS, avoid = [] } = {}) {
  const table = ROLES[role]?.preBoard ? INTAKE : seating;
  return (table[role] ?? []).filter(c => !avoid.includes(c.vendor)).map((c, rank) => ({
    ...c, rank, pool: facts[c.vendor].quota_pool, model: modelOf(c, facts),
  }));
}

/**
 * The report, in the order that matters. ROLE first, then the PACK it opens, then the LAB (and only
 * REVIEW cares), and the MODEL last and labelled as staffing.
 *
 * This exists because a seating table that prints `claude-sonnet-5` in the same column as `planner`
 * invites collapsing the model into the role -- and then a 429 reads as "Opus cannot plan" and a
 * fallback reads as "change the job". It is the same chair; you swapped the body. Formatting it once,
 * here, means every driver prints the precedence rather than re-deciding it.
 */
export function seatingReport(plan, { roles = ROLES } = {}) {
  return Object.entries(plan.assigned).map(([role, a]) => ({
    role,                                     // 1. the job: instruction, produce, may-write
    pack: PROJECTION_FOR_ROLE[role] ?? "(none: pre-board)",   // 2. what exists on disk for this chair
    produces: roles[role].produces_kinds,
    lab: a.vendor,                            // 3. matters for REVIEW isolation, and there only
    staffing: a.model,                        // 4. who is answering. Replaceable without renaming the seat.
    basis: a.basis,
    line: `${role.padEnd(12)} pack=${(PROJECTION_FOR_ROLE[role] ?? "-").padEnd(17)} ` +
      `lab=${a.vendor.padEnd(10)} staffing=${a.model}  [${a.basis}]`,
  }));
}

/**
 * Resolve a seating for a set of roles, reporting the basis of every choice and the roles that fell
 * through to a later candidate.
 */
/**
 * Pick the rung for a difficulty, and say what effort it runs at.
 *
 * A ladder with no band for the asked difficulty falls to the nearest one BELOW it and says so --
 * never silently above, because quietly upgrading is how a cheap task ends up on the dear rung.
 */
export function selectFor(role, { difficulty = "medium", facts = SEAT_FACTS, seating = SEATING, avoid = [] } = {}) {
  const cands = candidatesFor(role, { facts, seating, avoid });
  if (!cands.length) return { ok: false, why: `no seated candidate for "${role}"` };
  const want = DIFFICULTY.indexOf(difficulty);
  if (want === -1) return { ok: false, why: `unknown difficulty "${difficulty}"; known: ${DIFFICULTY.join(", ")}` };

  const banded = cands.filter(c => c.band).map(c => ({ ...c, at: DIFFICULTY.indexOf(c.band) }));
  const exact = banded.find(c => c.at === want);
  const below = banded.filter(c => c.at < want).sort((a, b) => b.at - a.at)[0];
  const chosen = exact ?? below ?? cands[0];
  return {
    ok: true, role, difficulty, ...chosen,
    effort: effortFor(chosen.vendor, chosen.model, facts).value,
    effort_state: effortFor(chosen.vendor, chosen.model, facts),
    exact: Boolean(exact),
    why_rung: exact ? `${chosen.model} is the ${difficulty} rung`
      : below ? `no ${difficulty} rung; fell to ${chosen.band} rather than upgrading past what was asked`
      : `no banded rung; took rank 0`,
  };
}

/**
 * One step harder. Effort first, rung second.
 */
export function escalate(role, current, { facts = SEAT_FACTS, seating = SEATING } = {}) {
  const up = raiseEffort(current.vendor, current.model, current.effort, facts);
  if (up) {
    // Spread FIRST, then the fields this step sets -- the other order let a previous step's `kind`
    // overwrite this one's, so a rung change kept reporting itself as an effort change.
    return { ...current, ok: true, kind: "effort", effort: up,
      why: `effort ${current.effort ?? "(default)"} -> ${up} on ${current.model}: the dial is cheaper to ` +
        `turn than the occupant is to change, and it keeps the lab and the pack` };
  }
  const cands = candidatesFor(role, { facts, seating });
  // A BAND IS A FIT, NOT A TIER -- and a role with no bands has no ladder. Falling back to declared-array
  // position fabricated a confident "up a rung" for explorer/advocate/judge/scout out of the order someone
  // typed the table in (2026-09-27 re-review, rank 27). selectFor says "no banded rung; took rank 0" for
  // these; escalate says the matching thing: there is no up.
  if (!cands.some(c => c.band)) {
    return { ok: false, why: `${role} has no banded rungs, so there is no "up": the declared order is not a difficulty ` +
      `scale (a band is a fit, not a tier). ${current.model}'s effort dial is at its top; reseat deliberately or stop.` };
  }
  const here = cands.findIndex(c => c.model === current.model);
  const next = cands.slice(0, here).reverse().find(c => c.band) ?? cands[here - 1];
  if (!next) return { ok: false, why: `${current.model} is the top rung and its effort dial is exhausted` };
  return { ...next, ok: true, kind: "rung", effort: effortFor(next.vendor, next.model, facts).value,
    why: `${current.model}'s effort dial is at its top, so up a rung to ${next.model}` };
}

export function seatingPlan({ roles, avoid = [], facts = SEAT_FACTS, seating = SEATING, difficulty = null } = {}) {
  const assigned = {}, notes = [], usedPools = new Set(), rolesByPool = {};
  const intake = seating === INTAKE;
  for (const role of roles) {
    if (!ROLES[role]) return { ok: false, why: `unknown role "${role}"` };
    // The two stages must not be seated from one table. A pre-board role in the chain's seating would
    // be given a projection it cannot have; a chain role at intake would be handed a board that does
    // not exist yet.
    if (Boolean(ROLES[role].preBoard) !== intake) {
      return { ok: false, why: intake
        ? `"${role}" is a chain role and cannot be seated from the INTAKE table`
        : `"${role}" runs before the board exists; seat it from INTAKE, not from the chain` };
    }
    const declared = seating[role];
    if (!declared) return { ok: false, why: `no seating declared for role "${role}"` };
    // `avoid` here means UNAVAILABLE, which is not what it means to the router: there, avoid is
    // relational to a declared need, so a role that states no need (an explorer states none) would
    // have been seated on a vendor the caller had excluded. Filter first, then let route() arbitrate.
    const candidates = declared.filter(c => !avoid.includes(c.vendor));
    for (const c of declared.filter(c => avoid.includes(c.vendor))) {
      notes.push(`${role}: skipped ${c.vendor} -- excluded by the caller`);
    }

    // The role's own `needs` are part of the requirement, not decoration: a reviewer declares
    // different_vendor and the router enforces it.
    const needs = [...(ROLES[role].needs ?? [])];
    let chosen = null;
    if (difficulty) {
      const sel = selectFor(role, { difficulty, facts, seating, avoid });
      if (sel.ok) {
        const r = route({ needs, avoid, count: 1, seats: [sel.vendor], facts });
        if (r.ok) { assigned[role] = { role, ...sel, fallback: sel.rank > 0 }; usedPools.add(facts[sel.vendor].quota_pool); (rolesByPool[facts[sel.vendor].quota_pool] ??= []).push(role); continue; }
        notes.push(`${role}: ${difficulty} rung ${sel.vendor} unavailable -- ${r.why}`);
      }
    }
    for (const c of candidates) {
      const r = route({ needs, avoid, count: 1, seats: [c.vendor], facts });
      if (!r.ok) { notes.push(`${role}: skipped ${c.vendor} -- ${r.why}`); continue; }
      // Measured against the DECLARED order: after filtering, the survivor is always index 0, which
      // would report every fallback as a first choice.
      const rank = declared.findIndex(d => d.vendor === c.vendor);
      chosen = { role, ...c, model: modelOf(c, facts), fallback: rank > 0, rank };
      break;
    }
    if (!chosen) return { ok: false, why: `no seat available for role "${role}"`, notes };
    assigned[role] = chosen;
    usedPools.add(facts[chosen.vendor].quota_pool);
    (rolesByPool[facts[chosen.vendor].quota_pool] ??= []).push(role);
  }

  const taste = Object.values(assigned).filter(a => a.basis === "TASTE" || a.basis === "UNMEASURED");

  // TWO POOLS, REPORTED SEPARATELY, because conflating them is how a 429 gets mistaken for an
  // epistemic problem and a shared context pack gets mistaken for an ops one.
  //
  // quota_contention is OPS: two seats spending from one subscription slow each other down. It is a
  // retry class on the adapter and never a reason to merge two chairs onto one occupant.
  // pack_collision is LAW: two seated roles whose occupants may read exactly the same thing are one
  // mind, however different the role strings are. This field used to be called `contention` and
  // carried only the quota meaning, while being quoted as though it said something epistemic.
  // The pool identity is the PROJECTION NAME, not a hash of the pack. Explorer and advocate on one
  // debater checkout are one pool even if one is Grok and the other Gemini; planner and implementer on
  // supervisor-vs-worker are not, even when both are Claude.
  const packs = Object.keys(assigned).map(r => packOf(r, ROLES)).filter(p => p.pool);
  const collisions = [];
  for (let i = 0; i < packs.length; i++) {
    for (let j = i + 1; j < packs.length; j++) {
      if (packs[i].pool === packs[j].pool) collisions.push([packs[i].role, packs[j].role, packs[i].pool]);
    }
  }
  // A role whose whole ladder sits in one hose can only WAIT, never reseat. Reported rather than
  // discovered when a 429 ends the run at that seat.
  const waitOnly = Object.keys(assigned).filter(role => {
    const pools = new Set(candidatesFor(role, { facts, seating }).map(c => c.pool));
    return pools.size === 1;
  });

  const labs = {};
  for (const [role, a] of Object.entries(assigned)) (labs[a.vendor] ??= []).push(role);
  const reviewClash = labs[assigned.reviewer?.vendor]?.includes("implementer") ? assigned.reviewer.vendor : null;

  return {
    ok: true, assigned, notes,
    pools: [...usedPools],
    contention: {
      // OPS. A retry class on the adapter; never a reason to merge two chairs onto one occupant.
      //
      // Counts ROLES PER POOL and names them. It used to report "1 role(s) share a quota pool" for two
      // roles on anthropic -- the arithmetic of "count minus distinct pools", which is the number of
      // roles BEYOND the first in each pool, not the number contending. That counter is the kind of
      // thing that gets quoted later, so it says which pool and which roles.
      quota: Object.entries(rolesByPool).filter(([, rs]) => rs.length > 1).length
        ? Object.entries(rolesByPool).filter(([, rs]) => rs.length > 1)
            .map(([pool, rs]) => `${pool}: ${rs.join(", ")} (${rs.length} roles, one hose)`).join("; ")
        : null,
      // LAW. Two seats drinking from one checkout are one mind, whatever the instruction strings say.
      pack: collisions.length
        ? collisions.map(([a, b, pool]) => `${a} and ${b} both read "${pool}": one checkout, two chairs`).join("; ")
        : null,
      // LAW. Maker and checker must differ by LAB, never merely by model name.
      review: reviewClash ? `implementer and reviewer are both ${reviewClash}: same-lab ack` : null,
    },
    // Carried on the plan so a downstream report cannot present a preference as a finding.
    taste: taste.map(t => `${t.role}=${t.vendor}/${t.model} (${t.basis}: ${BASIS[t.basis]})`),
    // Not a contention field: nothing is contending. It is a property of the ladder.
    wait_only: waitOnly.length
      ? waitOnly.map(r => `${r}: every rung is on one hose, so a 429 with no retry-after can only be waited out`).join("; ")
      : null,
    unmeasured: UNMEASURED,
    basis: "seated on window size, API surface, quota-pool independence and producer/reviewer " +
      "isolation. NOT on model quality, which this project has not measured.",
  };
}

export class SeatingViolation extends Error {}

/**
 * Judgment does not climb the chain.
 *
 * Refuses a review edge whose reviewer is the seat that assigned the work, or that shares its vendor.
 * A reviewer reading work it commissioned is grading its own plan; a reviewer sharing the producer's
 * vendor is the derangement rule broken.
 */
export function assertReviewCutsAcross({ assigner, producer, reviewer }) {
  if (!reviewer?.vendor || !producer?.vendor) throw new SeatingViolation("assertReviewCutsAcross: producer and reviewer are required");
  if (reviewer.vendor === producer.vendor) {
    throw new SeatingViolation(
      `${reviewer.vendor} cannot review ${producer.vendor}: a reviewer must not share the producer's vendor`);
  }
  if (assigner && reviewer.vendor === assigner.vendor) {
    throw new SeatingViolation(
      `${reviewer.vendor} assigned this work and cannot also review it: judgment cuts across the ` +
      `chain, it does not climb it -- a layer reviewing the layer below is grading its own plan`);
  }
  return true;
}

/** Pair producers with reviewers so no edge climbs the chain. Reports any producer it cannot pair. */
export function reviewPlan({ producers, assigner = null, facts = SEAT_FACTS }) {
  const pool = Object.keys(facts);
  return producers.map(producer => {
    const avoid = [producer, ...(assigner ? [assigner] : [])];
    const r = route({ needs: ["different_vendor"], avoid, count: 1, seats: pool, facts });
    if (!r.ok) return { producer, reviewer: null, why: r.why };
    const reviewer = r.picked[0];
    assertReviewCutsAcross({ assigner: assigner ? { vendor: assigner } : null, producer: { vendor: producer }, reviewer: { vendor: reviewer } });
    return { producer, reviewer, model: r.models[reviewer],
      why: assigner ? `different vendor from both the producer and the assigner (${assigner})` : "different vendor from the producer" };
  });
}
