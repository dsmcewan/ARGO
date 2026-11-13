import { test } from "node:test";
import assert from "node:assert/strict";
import { SEATING, INTAKE, TRANSPORTS, BASIS, NOT_SEATED, DEPTH_LIMIT, seatingPlan, seatingReport, reviewPlan,
  selectFor, escalate, effortLadder, effortFor, DIFFICULTY,
  assertReviewCutsAcross, assertFanOutIsOutside, subtreeCost, shouldFallThrough, candidatesFor,
  SeatingViolation, FanOutViolation } from "../src/role/seating.mjs";
import { ROLES, BOARD_KINDS, SESSION_KINDS, boardTokens } from "../src/role/roles.mjs";
import { packOf, PROJECTIONS, PROJECTION_FOR_ROLE, PRE_BOARD_ROLES, admits, ACK_KINDS } from "../src/board/project.mjs";
import { SEAT_FACTS, UNMEASURED } from "../src/route/router.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

test("the chain seats chain roles, INTAKE seats the pre-board role, and the controller is neither", () => {
  for (const role of Object.keys(SEATING)) {
    assert.ok(ROLES[role], `"${role}" is not a role`);
    assert.notEqual(ROLES[role].preBoard, true, `"${role}" runs before the board and belongs in INTAKE`);
  }
  for (const role of Object.keys(INTAKE)) assert.equal(ROLES[role].preBoard, true, `INTAKE seats "${role}", which is not pre-board`);
  assert.equal(SEATING.controller, undefined, "scheduling is code, not a seat");
  // Every role the harness can bind sits in exactly one table, or a plan naming it fails late.
  for (const role of Object.keys(ROLES)) {
    const inChain = Boolean(SEATING[role]), atIntake = Boolean(INTAKE[role]);
    assert.ok(inChain !== atIntake, `role "${role}" must be seated by exactly one table (chain=${inChain}, intake=${atIntake})`);
  }
});

test("the two stages cannot be seated from one table", () => {
  assert.match(seatingPlan({ roles: ["scout"] }).why, /runs before the board exists/);
  assert.match(seatingPlan({ roles: ["planner"], seating: INTAKE }).why, /cannot be seated from the INTAKE table/);
  const i = seatingPlan({ roles: ["scout"], seating: INTAKE });
  assert.equal(i.ok, true);
  assert.equal(i.assigned.scout.basis, "QUOTA", "scouting is breadth, so it is seated on pool independence");
});

// You do not put a swarm inside.
test("fan-out is refused inside the chain and refused when nested under a seat", () => {
  assert.equal(assertFanOutIsOutside({ stage: "intake", depth: 0, width: 3 }), true);
  assert.equal(assertFanOutIsOutside({ stage: "chain", depth: 0, width: 1 }), true, "one worker is not a fan-out");
  assert.throws(() => assertFanOutIsOutside({ stage: "chain", depth: 0, width: 3 }),
    /would share the assignment that primed them/);
  assert.throws(() => assertFanOutIsOutside({ stage: "intake", depth: 1, width: 3 }),
    /one lane however wide it looks/);
  assert.throws(() => assertFanOutIsOutside({ stage: "chain", width: 2 }), FanOutViolation);
});

test("a refused fan-out throws; it never returns something a caller can read as an empty queue", () => {
  // The failure mode this guards: a guard that returns [] on refusal is indistinguishable from
  // "nothing to fan out", so the caller proceeds with one worker and reports success.
  for (const bad of [{ stage: "chain", depth: 0, width: 4 }, { stage: "intake", depth: 1, width: 4 },
                     { stage: "intake", depth: 2, width: 2 }]) {
    let returned = "DID NOT THROW";
    try { returned = assertFanOutIsOutside(bad); } catch (e) { returned = e; }
    assert.ok(returned instanceof FanOutViolation,
      `${JSON.stringify(bad)} returned ${JSON.stringify(returned)} instead of throwing`);
  }
});

test("every seat declares a basis from the closed set, and TASTE travels with the plan", () => {
  for (const [role, candidates] of Object.entries(SEATING)) {
    for (const c of candidates) {
      assert.ok(BASIS[c.basis], `${role}/${c.vendor} has basis "${c.basis}", which is not declared`);
      assert.ok(c.why?.length > 20, `${role}/${c.vendor} must say why`);
      assert.ok(SEAT_FACTS[c.vendor], `${role} seats unknown vendor "${c.vendor}"`);
    }
  }
  // A preference is allowed. A preference presented as a finding is not, so the plan carries it out.
  const p = seatingPlan({ roles: ["planner", "implementer"] });
  assert.ok(Array.isArray(p.taste));
  assert.match(p.basis, /NOT on model quality/);
  assert.ok(p.unmeasured.some(u => /writes better code/.test(u)));
});

test("a full seating spreads across quota pools and names the contention it cannot avoid", () => {
  // NO LONGER FOUR INDEPENDENT POOLS, by operator decision 2026-09-29 ("Planners are Opus 4.6
  // through Agy... implementers will be Sonnet 4.6 through Agy as well"). Planner, implementer and
  // explorer's first rungs now all read agy_google -- deliberately, to avoid both the rationed
  // anthropic pool and openai's dead credits -- so three of four roles genuinely share one hose.
  // That is exactly the fact this test exists to name, not hide.
  const p = seatingPlan({ roles: ["planner", "implementer", "reviewer", "explorer"] });
  assert.equal(p.ok, true);
  assert.deepEqual(p.pools.sort(), ["agy_google", "xai"], "only two distinct pools now, not four");
  assert.match(p.contention.quota, /agy_google: planner, implementer, explorer \(3 roles, one hose\)/,
    "the counter must name the pool and all three roles sharing it");

  // Adding judge does NOT grow the contention: judge is still anthropic-seated and untouched by
  // today's change, so it lands on a pool nothing else in this set is using.
  const five = seatingPlan({ roles: ["planner", "implementer", "reviewer", "explorer", "judge"] });
  assert.match(five.contention.quota, /agy_google: planner, implementer, explorer \(3 roles, one hose\)/,
    "a fifth role landing on a fresh pool must not be reported as new contention");
  assert.equal(five.assigned.judge.vendor, "anthropic", "judge is unaffected by the planner/implementer reseat");
});

test("a seating falls through to the next candidate and says it did", () => {
  const p = seatingPlan({ roles: ["reviewer"], avoid: ["xai"] });
  assert.equal(p.ok, true);
  assert.notEqual(p.assigned.reviewer.vendor, "xai");
  assert.equal(p.assigned.reviewer.fallback, true);
  assert.ok(p.notes.some(n => /skipped xai/.test(n)));
});

test("a role with no available seat fails rather than seating something else", () => {
  const p = seatingPlan({ roles: ["explorer"], avoid: ["agy_google", "xai"] });
  assert.equal(p.ok, false);
  assert.match(p.why, /no seat available for role "explorer"/);
});

// --- the rule the hierarchy does not give you for free ---

test("a reviewer may not share the producer's vendor", () => {
  assert.throws(() => assertReviewCutsAcross({ producer: { vendor: "openai" }, reviewer: { vendor: "openai" } }),
    SeatingViolation);
  assert.equal(assertReviewCutsAcross({ producer: { vendor: "openai" }, reviewer: { vendor: "xai" } }), true);
});

test("the seat that assigned the work may not also review it", () => {
  assert.throws(
    () => assertReviewCutsAcross({ assigner: { vendor: "anthropic" }, producer: { vendor: "openai" }, reviewer: { vendor: "anthropic" } }),
    /judgment cuts across the chain, it does not climb it/,
    "a layer reviewing the layer below is grading its own plan");
});

test("reviewPlan routes around both the producer and the assigner", () => {
  const [edge] = reviewPlan({ producers: ["openai"], assigner: "anthropic" });
  assert.ok(edge.reviewer);
  assert.notEqual(edge.reviewer, "openai");
  assert.notEqual(edge.reviewer, "anthropic");
  assert.match(edge.why, /the producer and the assigner/);
});

test("every producer gets a reviewer that is neither itself nor the planner", () => {
  const assigner = seatingPlan({ roles: ["planner"] }).assigned.planner.vendor;
  for (const edge of reviewPlan({ producers: Object.keys(SEAT_FACTS), assigner })) {
    // Including the assigner's OWN output: four independent vendors leave a clean reviewer for every
    // producer, which is the property that makes a four-seat hierarchy reviewable at all.
    assert.ok(edge.reviewer, `${edge.producer} unpaired: ${edge.why}`);
    assert.notEqual(edge.reviewer, edge.producer);
    assert.notEqual(edge.reviewer, assigner);
  }
});

// --- subagents ---

test("a tree under one vendor is one lane, not many", () => {
  const t = subtreeCost("openai", 3);
  assert.equal(t.lanes, 1);
  assert.equal(t.calls, 4);
  assert.match(t.why, /context isolation, not throughput/);
  // Four seats with three children each looks like twelve lanes and is four.
  const lanes = Object.keys(SEAT_FACTS).map(v => subtreeCost(v, 3).lanes).reduce((a, b) => a + b, 0);
  assert.equal(lanes, 4);
  assert.ok(DEPTH_LIMIT >= 1 && DEPTH_LIMIT <= 3, "the tree is bounded; an unbounded one is discovered as a bill");
});

test("Codex is a TRANSPORT of an existing vendor, not an unseatable one", () => {
  // Codex is OpenAI. The dispatcher tier is a missing transport for a seated vendor, not a missing
  // seat -- and the gap applies to all four vendors, every one of which has a CLI this repo does not
  // drive. Listing it as "not seated" would have described a vendor gap that does not exist.
  assert.equal(NOT_SEATED.codex, undefined);
  assert.equal(TRANSPORTS.sdk.implemented, true);
  assert.equal(TRANSPORTS.cli.implemented, false);
  assert.match(TRANSPORTS.cli.why, /Codex is the openai one/);
  assert.ok(SEAT_FACTS.openai, "the vendor itself is seated");
});

test("NOT_SEATED and SEATING cannot contradict each other", () => {
  // THE CONTRADICTION THIS EXISTS FOR, live on 2026-09-28 with a fully green suite: NOT_SEATED said
  // claude-fable-5-2 "has no adapter because it is not a seat", while SEATING.planner seated it as
  // the hard rung forty lines away. Nothing checked the two against each other, so both could be
  // asserted at once and the suite had no opinion.
  //
  // This replaces a test that named fable as permanently unseatable -- which was a FACT about one
  // model, and facts about models change by operator decision. The invariant does not: whatever is
  // declared unseatable must not also be seated.
  const contradictions = [];
  for (const [role, chairs] of [...Object.entries(SEATING), ...Object.entries(INTAKE)]) {
    for (const chair of chairs) {
      if (chair.model && NOT_SEATED[chair.model]) contradictions.push(`${role} seats ${chair.model}, which NOT_SEATED declares unseatable`);
      if (NOT_SEATED[chair.vendor]) contradictions.push(`${role} seats vendor ${chair.vendor}, which NOT_SEATED declares unseatable`);
    }
  }
  assert.deepEqual(contradictions, [], contradictions.join("\n  "));
  assert.equal(SEAT_FACTS.agy, undefined, "agy is a transport onto the google lab, never a SEAT_FACTS vendor of its own");
});

test("a 429 with no retry-after is fall-through-only; one with retry-after may be waited out", () => {
  // The subscription-path 429 observed live: no retry-after, no anthropic-ratelimit-*, message
  // "Error". Retrying the same seat is guessing, so same_vendor_viable must be false.
  const bare = shouldFallThrough({ status: 429, headers: new Headers({ "anthropic-workspace-id": "w" }) });
  assert.equal(bare.ok, true);
  assert.equal(bare.retry_after_s, null);
  assert.equal(bare.same_vendor_viable, false);
  assert.match(bare.why, /no interval to wait for/);

  const documented = shouldFallThrough({ status: 429, headers: new Headers({ "retry-after": "30" }) });
  assert.equal(documented.retry_after_s, 30);
  assert.equal(documented.same_vendor_viable, true);

  // The spend cap is a 429 with no retry-after BY DESIGN, and must not be read as the subscription case.
  const cap = shouldFallThrough({ status: 429, headers: new Headers(),
    error: { error: { details: { error_code: "enforced_spend_limit_reached" } } } });
  assert.equal(cap.same_vendor_viable, false);
  assert.match(cap.why, /spend cap/);

  // A 400 is the request's problem; the next vendor would refuse it too.
  const bad = shouldFallThrough({ status: 400, headers: new Headers() });
  assert.equal(bad.ok, false);
  assert.equal(shouldFallThrough({ status: 503, headers: new Headers() }).same_vendor_viable, true);
  assert.equal(shouldFallThrough({ code: "ECONNRESET" }).ok, true);
});

test("a CONTEXT basis must be backed by a recorded window that is actually the largest", () => {
  // The guard against the mistake this seating already made: claiming CONTEXT for a model whose window
  // is merely large, or unknown, while a tied-or-larger candidate sits below it in the same role.
  for (const [role, candidates] of Object.entries({ ...SEATING, ...INTAKE })) {
    const windows = candidates.map(c => {
      const f = SEAT_FACTS[c.vendor];
      const model = c.tier === "default" ? f.models.default : (f.models[c.tier] ?? f.models.default);
      return { ...c, model, window: f.windows?.[model] ?? null };
    });
    for (const c of windows.filter(x => x.basis === "CONTEXT")) {
      assert.ok(Number.isInteger(c.window),
        `${role}/${c.vendor} claims CONTEXT but no window is recorded for ${c.model}`);
      const bigger = windows.filter(o => Number.isInteger(o.window) && o.window > c.window);
      assert.deepEqual(bigger, [],
        `${role}/${c.vendor} claims CONTEXT at ${c.window} while ${bigger.map(b => `${b.model}=${b.window}`).join(", ")} is larger`);
      // A tie is fine and must be stated as one -- claiming to be "the largest" when tied is the
      // specific falsehood this test exists for.
      const tied = windows.filter(o => o !== c && o.window === c.window);
      if (tied.length) assert.doesNotMatch(c.why, /\bthe largest\b(?!,)/,
        `${role}/${c.vendor} is TIED with ${tied.map(t => t.model).join(", ")} but its reason claims to be the largest`);
    }
  }
});

test("the planner's last resort is another lab, and it is unreachable while the hose is open", () => {
  // THE RUN THIS PINS. On 2026-09-28 a real build drafted its ticket on gpt-5.5, scouted on
  // gemini, reached the plan stage and died there: "every seated candidate for planner was
  // unavailable: anthropic: 429 with no retry-after ... anthropic hose shut". Nothing was wrong;
  // it was this table's documented trade -- one hose, nowhere to reseat, only somewhere to wait --
  // and the subscription it waits on is the same one the operator's own session spends.
  //
  // UPDATED 2026-09-29 TWICE. First: agy_google/claude-opus-4-6-thinking landed banded hard,
  // ahead of anthropic's own hard rung. Then, the same day, the operator corrected the shape:
  // "Sonnet will suffice at most of what it's given to plan, saving tokens on a lesser model. But
  // if it needs advice Opus can step in. Not everything needs to be routed through Opus." Sonnet
  // now leads the table (band easy, real default via array position) with Opus second (band hard,
  // the escalation) -- both still agy_google, both still ahead of the anthropic hose.
  assert.equal(selectFor("planner", { difficulty: "hard" }).vendor, "agy_google",
    "a hard plan escalates to Opus, live-validated 2026-09-29");
  assert.equal(selectFor("planner", { difficulty: "hard" }).model, "claude-opus-4-6-thinking");
  for (const difficulty of ["easy", "medium"]) {
    const s = selectFor("planner", { difficulty });
    assert.equal(s.vendor, "agy_google", `a ${difficulty} plan is the actual default: Sonnet via agy_google`);
    assert.equal(s.model, "claude-sonnet-4-6");
  }

  // What used to be "the last resort is another lab" is now "the FIRST resort is another lab":
  // agy_google is unavoidable's own vendor too, so avoiding it is what now reaches anthropic's
  // full ladder, exactly as avoiding anthropic used to reach openai.
  for (const difficulty of ["easy", "medium"]) {
    const s = selectFor("planner", { difficulty, avoid: ["agy_google"] });
    assert.equal(s.vendor, "anthropic", `a ${difficulty} plan without agy_google falls back to the operator's anthropic ladder`);
    assert.equal(s.model, "claude-opus-5-5");
  }
  const hardNoAgy = selectFor("planner", { difficulty: "hard", avoid: ["agy_google"] });
  assert.equal(hardNoAgy.vendor, "anthropic");
  assert.equal(hardNoAgy.model, "claude-fable-5-2");

  // And avoiding anthropic itself (the ORIGINAL scenario this test pins) no longer ends at openai:
  // agy_google is live, openai's credits are confirmed dead, and agy_google covers every difficulty
  // itself now (Sonnet for easy/medium, Opus for hard) once anthropic is out of the running.
  for (const difficulty of ["easy", "medium", "hard"]) {
    const shut = selectFor("planner", { difficulty, avoid: ["anthropic"] });
    assert.equal(shut.ok, true, "a shut anthropic hose must no longer end the run");
    assert.equal(shut.vendor, "agy_google");
    assert.equal(shut.model, difficulty === "hard" ? "claude-opus-4-6-thinking" : "claude-sonnet-4-6");
  }

  // The true last resort -- both anthropic AND agy_google unavailable -- is still openai, and it
  // is still reached only through cands[0], the same "if and when" design as before.
  const bothShut = selectFor("planner", { difficulty: "hard", avoid: ["anthropic", "agy_google"] });
  assert.equal(bothShut.ok, true, "both hoses shut must still not end the run");
  assert.equal(bothShut.vendor, "openai");
  assert.equal(bothShut.model, "gpt-6-sol");
  assert.equal(bothShut.exact, false, "it is a fallback, not a rung anyone asked for");
  assert.match(bothShut.why_rung, /no banded rung/);
});

test("difficulty picks the rung; the cheap rung is the answer to an easy task, not a failure", () => {
  // This test used to assert "the planner is seated on the cheapest model that satisfies its basis",
  // which was a cost rule standing in for a router. Several models sit in one chair because the WORK
  // varies, and neither rung is a fallback for the other.
  //
  // The planner ladder is TWO anthropic rungs by operator decision (2026-09-28: "Fable 5.1, Opus
  // 5.5 for planning"), so `medium` has no exact rung and resolves DOWN to easy. That is the
  // point, not a gap: the property worth pinning is that fable is reached only by asking for
  // `hard` on the anthropic ladder specifically, because falling UP to it would burn the dearest
  // seat on a brief whose whole output is one line.
  //
  // UPDATED 2026-09-29 TWICE: agy_google now leads this ladder for every difficulty -- Sonnet for
  // easy/medium (the operator's actual default, "Sonnet will suffice at most of what it's given to
  // plan"), Opus for hard (the escalation, "if it needs advice"). See "the planner's last resort is
  // another lab" for the full case. fable/opus-5-5 are still reachable, one avoid away from the top.
  assert.equal(selectFor("planner", { difficulty: "easy" }).model, "claude-sonnet-4-6");
  assert.equal(selectFor("planner", { difficulty: "medium" }).model, "claude-sonnet-4-6");
  assert.equal(selectFor("planner", { difficulty: "hard" }).model, "claude-opus-4-6-thinking");
  assert.equal(selectFor("planner", { difficulty: "easy", avoid: ["agy_google"] }).model, "claude-opus-5-5",
    "opus-5-5 is still easy/medium's answer on the anthropic ladder once agy_google is out of the running");
  assert.equal(selectFor("planner", { difficulty: "hard", avoid: ["agy_google"] }).model, "claude-fable-5-2",
    "fable is still hard's answer on the anthropic ladder once agy_google is out of the running");
  assert.notEqual(selectFor("planner", { difficulty: "medium" }).model, "claude-fable-5-2",
    "a medium plan must never fall UP onto the hard rung");
  assert.equal(selectFor("implementer", { difficulty: "easy" }).model, "gpt-6-luna");
  // UPDATED 2026-09-29, same reseat as planner above: hard now resolves to agy_google's new rung.
  assert.equal(selectFor("implementer", { difficulty: "hard" }).model, "claude-sonnet-4-6");
  assert.equal(selectFor("implementer", { difficulty: "hard", avoid: ["agy_google"] }).model, "gpt-6-astra",
    "astra is still hard's answer on the openai ladder once agy_google is out of the running");

  // Every rung holds a 1M window, so CONTEXT never ordered them and cost never did either.
  assert.equal(SEAT_FACTS.anthropic.windows["claude-sonnet-5"], SEAT_FACTS.anthropic.windows["claude-fable-5-2"]);
  // An unknown difficulty is refused by name rather than defaulted.
  assert.match(selectFor("planner", { difficulty: "trivial" }).why, /unknown difficulty/);
  // And a missing band falls DOWN, never up: quietly upgrading is how a cheap task lands on the dear rung.
  const thin = { planner: [{ vendor: "anthropic", model: "claude-sonnet-5", band: "easy", basis: "CONTEXT", why: "w".repeat(25) }] };
  const asked = selectFor("planner", { difficulty: "hard", seating: thin });
  assert.equal(asked.model, "claude-sonnet-5");
  assert.equal(asked.exact, false);
  assert.match(asked.why_rung, /rather than upgrading past what was asked/);
});

test("effort escalates before the rung does, on the LAB's own value list", () => {
  // No shared ladder: anthropic takes five values via output_config.effort, openai seven via
  // reasoning.effort, and astra rejects `none`. One hardcoded order across both would have sent
  // Anthropic a value it does not accept.
  assert.deepEqual(effortLadder("anthropic", "claude-sonnet-5"), ["low", "medium", "high", "xhigh", "max"]);
  assert.equal(effortLadder("openai", "gpt-6-astra").includes("none"), false, "astra rejects none");
  assert.deepEqual(effortLadder("anthropic", "claude-haiku-4-5-20251001"), [], "haiku accepts no effort at all");

  // Absent and unsupported are different answers.
  assert.equal(effortFor("anthropic", "claude-haiku-4-5-20251001").state, "unsupported");
  assert.equal(effortFor("openai", "gpt-6-astra").state, "unrecorded", "astra's default is not documented");
  assert.equal(effortFor("anthropic", "claude-opus-5").value, "high",
    "Opus 5 defaults to high; `medium` is Opus 5.5's default and attributing it here ran escalation a rung short");

  // The walk: dial to the top, then one rung, then dial again. Explicitly avoiding agy_google here,
  // 2026-09-29: this test is about anthropic's own effort ladder (every assertion above names
  // anthropic/openai specifically), and escalate()'s rung-change walks backward toward array index
  // 0 -- with Sonnet now AT index 0 (the operator's actual default, real dispatch reads array
  // position directly), starting the walk unavoided immediately reports "top rung, exhausted" with
  // zero steps, which is a real fact about this reporting-only mechanism (never consulted by
  // roleTurn's actual dispatch) but says nothing about the anthropic ladder this test exists to pin.
  const steps = [];
  let cur = selectFor("planner", { difficulty: "easy", avoid: ["agy_google"] });
  for (let n = 0; n < 6; n++) {
    const e = escalate("planner", cur);
    if (!e.ok) break;
    steps.push(`${e.kind}:${e.model}@${e.effort}`);
    cur = e;
  }
  assert.deepEqual(steps, [
    "effort:claude-opus-5-5@high", "effort:claude-opus-5-5@xhigh", "effort:claude-opus-5-5@max",
    "rung:claude-fable-5-2@high", "effort:claude-fable-5-2@xhigh", "effort:claude-fable-5-2@max",
  ], "effort first, rung second, and a rung change must not report itself as an effort change");
});

test("contention has three fields with three meanings, and they are not glued together", () => {
  // WAS planner+judge (both anthropic) until 2026-09-29's reseat moved planner to agy_google and
  // left judge on anthropic alone -- see the previous test. planner+implementer now demonstrates
  // the identical point (one QUOTA hose, two DIFFERENT checkouts), and is the more honest example
  // today since it is the pair the operator's own instruction put on one hose.
  const p = seatingPlan({ roles: ["planner", "implementer"] });
  assert.equal(p.ok, true);
  assert.equal(p.assigned.planner.vendor, p.assigned.implementer.vendor);
    // Named, and counted per pool: "1 role(s) share" was the count BEYOND the first in each pool, which
  // for two roles on one hose reads as one.
  assert.match(p.contention.quota, /agy_google: planner, implementer \(2 roles, one hose\)/,
    "the counter names the pool and both roles");
  assert.equal(p.contention.pack, null, "the checkout is not, which is what matters");
  assert.equal(p.contention.review, null, "and neither is the maker/checker lab");

  // The pool identity is the PROJECTION NAME: two roles on one checkout collide even across labs.
  const shared = seatingPlan({ roles: ["explorer", "advocate"],
    seating: { explorer: [{ vendor: "agy_google", tier: "default", basis: "QUOTA", why: "x".repeat(25) }],
               advocate: [{ vendor: "xai", tier: "default", basis: "QUOTA", why: "y".repeat(25) }] } });
  assert.equal(shared.ok, true);
  assert.notEqual(shared.assigned.explorer.vendor, shared.assigned.advocate.vendor, "different labs");
  assert.equal(shared.contention.pack, null,
    "and on the CURRENT tables they are on different checkouts, so no collision");
});

test("the same contractor in two chairs is legal; the same checkout in two chairs is not", () => {
  const seen = new Map();
  for (const role of Object.keys(ROLES)) {
    const p = packOf(role, ROLES);
    if (!p.pool) continue;
    const clash = seen.get(p.pool);
    assert.equal(clash, undefined, `roles "${clash}" and "${role}" both read "${p.pool}": two chairs, one mind`);
    seen.set(p.pool, role);
  }
  // And no two projections may admit an identical view, mounts and mutation bit included -- worker and
  // checker did, until the checker stopped reading the work item and its artifact became frozen.
  const byView = new Map();
  for (const [n, p] of Object.entries(PROJECTIONS)) {
    const v = JSON.stringify([[...p.slots].sort(), [...p.kinds].sort(), [...(p.mounts ?? [])].sort(),
      [...(p.writes ?? [])].sort(), p.artifact_access ?? null, p.commit_msg, p.isolated]);
    assert.equal(byView.get(v), undefined, `projections "${byView.get(v)}" and "${n}" admit an identical view`);
    byView.set(v, n);
  }
});

// THE INCLUSION LAW, both directions. Role is the INTENT set; projection is the DISK set. Each can
// pass its own tests while disagreeing with the other, which is the same family as REVIEW grading
// planMerge's leftovers -- two maps, neither master.
test("board(role.context) is a subset of what its projection admits", () => {
  for (const [role, spec] of Object.entries(ROLES)) {
    const projection = PROJECTION_FOR_ROLE[role];
    if (PRE_BOARD_ROLES.has(role)) { assert.equal(projection, undefined); continue; }
    assert.ok(projection, `chain role "${role}" has no projection`);
    const A = admits(projection);
    for (const token of boardTokens(spec.context)) {
      assert.ok(A.has(token),
        `role "${role}" asks for board token "${token}" but projection "${projection}" admits only ` +
        `${[...A].join(",")} -- REVIEW would have to reach it by a side channel`);
    }
  }
});

test("no ghost kinds: every kind a projection admits is claimed by a role that sits on it", () => {
  const rolesOn = {};
  for (const [role, p] of Object.entries(PROJECTION_FOR_ROLE)) (rolesOn[p] ??= []).push(role);
  for (const [projection, roles] of Object.entries(rolesOn)) {
    const claimed = new Set(roles.flatMap(r => ROLES[r].context));
    for (const kind of PROJECTIONS[projection].kinds) {
      assert.ok(claimed.has(kind),
        `projection "${projection}" admits "${kind}" but no role on it (${roles.join(",")}) asks for it`);
    }
  }
  // The controller's view has no role on it AT ALL, and that is deliberate.
  assert.equal(PROJECTIONS.supervisor.controller_only, true);
  assert.equal(Object.values(PROJECTION_FOR_ROLE).includes("supervisor"), false,
    "a seat pointed at the controller's checkout inherits the controller's reach");
});

test("session tokens are a separate universe and are never checked against a projection", () => {
  for (const [role, spec] of Object.entries(ROLES)) {
    for (const t of spec.session ?? []) {
      assert.ok(SESSION_KINDS.has(t), `${role} declares "${t}" as a session token but it is not one`);
      assert.equal(BOARD_KINDS.has(t), false, `"${t}" cannot be in both universes`);
    }
    for (const t of spec.context) assert.ok(BOARD_KINDS.has(t), `${role} context "${t}" is not a board token`);
  }
  // own_history only where a seat writes across turns; a checker keeps no defense diary.
  assert.deepEqual(Object.entries(ROLES).filter(([, s]) => (s.session ?? []).includes("own_history")).map(([r]) => r).sort(),
    ["advocate", "implementer", "planner"]);
  // peer_defense implies peer_output.
  for (const [role, s] of Object.entries(ROLES)) {
    if ((s.session ?? []).includes("peer_defense")) assert.ok(s.session.includes("peer_output"), role);
  }
  // the maker does not read the advocate thread
  assert.equal((ROLES.implementer.session ?? []).includes("peer_output"), false);
});

test("question and ticket never cohabit, and pre-board is exactly context ⊆ {question}", () => {
  for (const [role, spec] of Object.entries(ROLES)) {
    const has = t => spec.context.includes(t);
    assert.equal(has("question") && has("ticket"), false, `${role} holds both question and ticket`);
    const preBoard = spec.context.every(t => t === "question");
    assert.equal(PRE_BOARD_ROLES.has(role), preBoard, `${role}: preBoard flag and its token set disagree`);
  }
});

test("the mutation bit is what separates the maker's set from the checker's", () => {
  const impl = packOf("implementer", ROLES), rev = packOf("reviewer", ROLES);
  // They name almost the same surface, which is expected -- the isolation is not in the tokens.
  const shared = impl.board.filter(t => rev.board.includes(t));
  assert.deepEqual(shared.sort(), ["artifact", "repro", "tests", "ticket", "trace"]);
  // It is in the bit, and in what each may write.
  assert.equal(impl.artifact_access, "leased");
  assert.equal(rev.artifact_access, "frozen");
  assert.ok(impl.writes.includes("artifact"));
  assert.equal(rev.writes.includes("artifact"), false, "a checker that can edit the candidate is not a checker");
  assert.deepEqual(rev.session, [], "and keeps no diary");
});

test("what approvalFor hashes is a kind the checker can name", () => {
  // approvalFor compares critique.links.target against artifactEntry.links.bytes. If the checker could
  // not name `artifact`, the ack would have to bind by a side channel -- which is how REVIEW went blind.
  assert.ok(admits("checker").has("artifact"));
  assert.ok(ROLES.reviewer.context.includes("artifact"));
  assert.ok(ROLES.reviewer.context.includes("tests") && admits("checker").has("tests"),
    "tests is named on BOTH tables, as a mount rather than only on the role");
});

test("a post-board explorer cannot mint evidence, because that would be scouting", () => {
  const p = packOf("explorer", ROLES);
  assert.deepEqual(p.writes, []);
  for (const k of ["search", "repro", "trace"]) {
    assert.equal(admits("isolated_reader").has(k), false, `isolated_reader must not admit ${k}`);
  }
  assert.deepEqual(ROLES.explorer.produces_kinds, []);
});

test("REVIEW isolation compares the LAB, and a board entry carries no model to compare instead", async () => {
  const { KINDS } = await import("../src/board/schema.mjs");
  // Two anthropic model names on maker and checker must still be one lab. The author has no model
  // field at all, so a future change cannot quietly start comparing "opus-5" against "sonnet-5".
  const authorFields = ["vendor", "seat_id", "mode", "occupancy_gen"];
  assert.equal(authorFields.includes("model"), false, "author identity carries no model string");
  assert.equal(KINDS.critique.writers.includes("seat"), true);
  assert.equal(ROLES.reviewer.needs.includes("different_vendor"), true, "the reviewer's need is by VENDOR");
  assert.equal(ROLES.judge.needs.includes("different_vendor"), true);
});

// PRODUCE is a second map, and subset is about READ. This is the inclusion law for the other one:
// produce(role) ⊆ projection.writes, and writes ⊆ kinds ∪ ACK_KINDS.
test("every kind a role produces is writable on its projection", () => {
  for (const [role, spec] of Object.entries(ROLES)) {
    const projection = PROJECTION_FOR_ROLE[role];
    if (!projection) {
      // Pre-board produce lands on iso/* refs as lineage, never on a board projection.
      assert.equal(PRE_BOARD_ROLES.has(role), true, `${role} has no projection but is not pre-board`);
      continue;
    }
    const p = PROJECTIONS[projection];
    for (const kind of spec.produces_kinds) {
      assert.ok((p.writes ?? []).includes(kind),
        `role "${role}" produces "${kind}" but projection "${projection}" cannot write it`);
    }
    for (const kind of p.writes ?? []) {
      assert.ok(p.kinds.includes(kind) || ACK_KINDS.has(kind),
        `projection "${projection}" writes "${kind}" which it cannot read and which is not an ack`);
    }
  }
  // The ack exemption is real and used: the checker writes a critique it never reads.
  assert.ok(PROJECTIONS.checker.writes.includes("critique"));
  assert.equal(PROJECTIONS.checker.kinds.includes("critique"), false);
});

test("a produce map cannot let a seat author a decision, whatever it claims", () => {
  // DELIBERATE DEVIATION from the layout's produce map, which has judge -> decision. The schema gives
  // `decision` the writers ["controller","human"], so a judge producing one would break rule 7. The two
  // rules conflict and this is where the conflict is resolved: the judge produces a HYPOTHESIS (a
  // recommendation with the dissent preserved) and the controller turns it into the decision.
  assert.deepEqual(ROLES.judge.produces_kinds, ["hypothesis"]);
  for (const [role, spec] of Object.entries(ROLES)) {
    assert.equal(spec.produces_kinds.includes("decision"), false,
      `role "${role}" claims to produce a decision; no seat may author one`);
  }
  for (const p of Object.values(PROJECTIONS)) {
    if (p.controller_only) continue;
    assert.equal((p.writes ?? []).includes("decision"), false, "no seat projection may write a decision");
  }
});

test("tests is named on BOTH tables — as a mount, because it is derived and not a stored entry", () => {
  // DELIBERATE DEVIATION from the literal wording of lock 7 (`tests ∈ checker.kinds`): `tests` is the
  // ticket's acceptance, so listing it as a stored entry KIND would assert an object type the store does
  // not have. The layout's prose allows exactly this -- "name that mount in the projection. Do not leave
  // it only on the role" -- so it is in `mounts`, and admits() is kinds ∪ mounts.
  assert.equal(PROJECTIONS.checker.kinds.includes("tests"), false, "not a stored entry kind");
  assert.ok(PROJECTIONS.checker.mounts.includes("tests"), "but named on the projection");
  assert.ok(admits("checker").has("tests"), "and satisfiable through admits()");
  assert.ok(ROLES.reviewer.context.includes("tests"));
});

test("BASIS is a justification label, never a surface: two ISOLATION seats are two checkouts", () => {
  // reviewer and judge are both labelled ISOLATION. If that banner were a surface they would be one
  // pool with two job titles. What decides is the projection name, and contention.pack keys off that.
  const p = seatingPlan({ roles: ["implementer", "reviewer", "judge"] });
  assert.equal(p.assigned.reviewer.basis, "ISOLATION");
  assert.equal(p.assigned.judge.basis, "ISOLATION");
  assert.notEqual(PROJECTION_FOR_ROLE.reviewer, PROJECTION_FOR_ROLE.judge, "two trees, not one");
  assert.equal(p.contention.pack, null, "so sharing the banner is not sharing the checkout");

  // And what each actually opens is different: frozen bytes plus tests vs published peer objects.
  assert.ok(admits("checker").has("artifact") && !admits("checker").has("hypothesis"));
  assert.ok(admits("synthesizer").has("hypothesis") && !admits("synthesizer").has("artifact"));

  // The banner cannot become load-bearing by accident: no two roles that share a basis may share a
  // projection, because then the label and the surface would agree and nobody would notice which one
  // the code was reading.
  const byBasis = {};
  for (const [role, cands] of Object.entries(SEATING)) (byBasis[cands[0].basis] ??= []).push(role);
  for (const [basis, roles] of Object.entries(byBasis)) {
    const projections = roles.map(r => PROJECTION_FOR_ROLE[r]);
    assert.equal(new Set(projections).size, projections.length,
      `roles ${roles.join(",")} share basis "${basis}" AND a projection; the banner would look load-bearing`);
  }
});

test("REVIEW is safe on this map: the maker and the checker are different labs", () => {
  const p = seatingPlan({ roles: ["implementer", "reviewer"] });
  assert.notEqual(p.assigned.implementer.vendor, p.assigned.reviewer.vendor);
  assert.equal(p.contention.review, null);
  // And if they were the same lab, it would be reported as LAW rather than discovered at approvalFor.
  const same = seatingPlan({ roles: ["implementer", "reviewer"],
    seating: { implementer: [{ vendor: "xai", tier: "default", basis: "TASTE", why: "x".repeat(25) }],
               reviewer: SEATING.reviewer } });
  assert.match(same.contention.review, /same-lab ack/);
});

test("a subagent writes inside the parent: its lease, its produce set, bounded depth", async () => {
  const { assertSubagentProduce } = await import("../src/role/seating.mjs");
  const lease = { resource: "item:withSeatLock", gen: 1 };

  // Legal: a child of the implementer producing what the implementer produces, on the parent's lease.
  const ok = assertSubagentProduce({ parentRole: "implementer", kinds: ["repro"], depth: 1, lease });
  assert.equal(ok.lanes, 1, "extra depth is a smaller window for a sub-task, not a second lane");
  assert.match(ok.why, /one lane, one writer/);

  // A kind the parent never admitted. This is the hole: four calls under Astra minting board kinds the
  // implementer role does not produce would make every inclusion law true of the table and false of
  // the board.
  assert.throws(() => assertSubagentProduce({ parentRole: "implementer", kinds: ["critique"], depth: 1, lease }),
    /cannot produce critique/);
  assert.throws(() => assertSubagentProduce({ parentRole: "implementer", kinds: ["hypothesis"], depth: 1, lease }),
    /describe the chair and not the board/);
  // An explorer produces nothing, so a child of one may write nothing.
  assert.throws(() => assertSubagentProduce({ parentRole: "explorer", kinds: ["search"], depth: 1, lease }),
    /produces only nothing/);

  // Its own lease would be a second writer of the same name.
  assert.throws(() => assertSubagentProduce({ parentRole: "implementer", kinds: ["artifact"], depth: 1 }),
    /under the PARENT's lease/);

  // Bounded.
  assert.throws(() => assertSubagentProduce({ parentRole: "implementer", kinds: ["repro"], depth: 3, lease }),
    /exceeds DEPTH_LIMIT/);
  assert.throws(() => assertSubagentProduce({ parentRole: "implementer", kinds: [], depth: 0, lease }),
    /depth >= 1/);

  // And the lane arithmetic agrees with subtreeCost: depth under one vendor buys isolation, not throughput.
  assert.equal(subtreeCost("openai", 3).lanes, 1);
});

// The precedence, asserted rather than left to whoever writes the next print statement.
test("the report leads with role and pack; the model is labelled staffing and comes last", () => {
  const rows = seatingReport(seatingPlan({ roles: ["planner", "implementer", "reviewer", "judge"] }));
  for (const r of rows) {
    assert.ok(r.role && r.pack && r.lab && r.staffing, JSON.stringify(r));
    // Order in the rendered line is the claim: a table that prints the model beside the role invites
    // reading the model AS the role, and then a 429 says "this model cannot plan".
    assert.ok(r.line.indexOf(r.role) < r.line.indexOf("pack="), "role before pack");
    assert.ok(r.line.indexOf("pack=") < r.line.indexOf("lab="), "pack before lab");
    assert.ok(r.line.indexOf("lab=") < r.line.indexOf("staffing="), "lab before staffing");
    assert.match(r.line, /staffing=/, "and the model is named as staffing, not as the seat");
  }
  // Same model, two roles, two packs: legal, and the report shows it as two chairs. Constructed rather
  // than read off the default plan, which used to happen to seat Sonnet twice -- an incidental fact, and
  // a test resting on one proves the property only until the ladder changes.
  const twice = seatingReport(seatingPlan({ roles: ["planner", "judge"],
    seating: { planner: [{ vendor: "anthropic", model: "claude-sonnet-5", basis: "CONTEXT", why: "w".repeat(25) }],
               judge: [{ vendor: "anthropic", model: "claude-sonnet-5", basis: "ISOLATION", why: "w".repeat(25) }] } }));
  assert.equal(twice[0].staffing, twice[1].staffing, "one contractor");
  assert.notEqual(twice[0].pack, twice[1].pack, "two desks");
  assert.notEqual(twice[0].role, twice[1].role, "two jobs");
});

test("the specified ladders are single-hose, so they can only be waited out", () => {
  // Planner: Fable -> Opus -> Sonnet. Implementer: Astra -> Sol -> Luna. Both ladders are inside one
  // lab, which is the operator's staffing choice and has a consequence worth asserting rather than
  // discovering: there is NO reseat. Every rung shares the hose, so a 429 with no retry-after can only
  // be waited out, and `wait_only` says so.
  // THE PLANNER IS NO LONGER SINGLE-HOSE, by operator decision on 2026-09-28 after a real build
  // died at the plan stage on a 429 with no retry-after. Its first two rungs still share a hose;
  // what changed is that the ladder no longer ENDS there.
  //
  // UPDATED 2026-09-29 TWICE: two agy_google rungs now lead the table, not one -- Sonnet (the
  // operator's actual default: "Sonnet will suffice at most of what it's given to plan") then Opus
  // (the escalation: "if it needs advice, Opus can step in"). Both share agy_google's pool, so this
  // is still three DISTINCT pools despite five total rungs: agy_google (the new lead, two rungs),
  // the anthropic hose behind it, and openai as the still-unreachable-while-anything-above-is-alive
  // last resort.
  //
  // THE IMPLEMENTER IS NO LONGER SINGLE-HOSE EITHER, same day, same reason: "The implementers will
  // be Sonnet 4.6 through Agy as well." Its openai ladder (Astra -> Sol -> Luna) is untouched and
  // still shares one hose among themselves -- what changed is a second pool now leads it.
  const planner = candidatesFor("planner");
  assert.deepEqual(planner.map(c => c.model),
    ["claude-sonnet-4-6", "claude-opus-4-6-thinking", "claude-fable-5-2", "claude-opus-5-5", "gpt-6-sol"]);
  assert.equal(new Set(planner.map(c => c.pool)).size, 3, "three pools: agy_google (two rungs), the anthropic hose, and the way out");
  assert.equal(planner[0].basis, "TASTE", "the operator's stated default rung, named as a preference, not a measurement");
  assert.equal(planner[1].basis, "TASTE", "the escalation rung, same reasoning");
  assert.equal(planner[0].pool, planner[1].pool, "Sonnet and Opus share agy_google's one pool");
  // The escape must genuinely be a different pool from the HOSE (the anthropic rungs, planner[2]
  // onward) -- not merely from planner[0]/[1], which are agy_google's own pool and would make every
  // other rung look like "an escape" by that narrower comparison.
  const plannerHose = planner[2].pool;
  assert.notEqual(planner.at(-1).pool, plannerHose,
    "the last resort must not draw on the pool that just refused");
  assert.equal(planner.at(-1).band, undefined,
    "no band is how 'if and when' is enforced: selectFor reaches an unbanded seat only via cands[0]");

  const implementer = candidatesFor("implementer");
  assert.deepEqual(implementer.map(c => c.model),
    ["claude-sonnet-4-6", "gpt-6-astra", "gpt-6-sol", "gpt-6-luna"]);
  assert.equal(new Set(implementer.map(c => c.pool)).size, 2, "two pools: agy_google leading, then the openai hose");
  assert.equal(implementer[0].basis, "TASTE", "the operator's stated top rung for implementing, same reasoning as planner's");

  // The property, which is NOT that the lower rungs are worse: it is that no rung may claim a MEASURED
  // basis it does not have. All three hold 1M, so CONTEXT cannot separate them, and the band each one
  // carries is the operator's routing judgment -- so those rungs must sit on one of the two honest
  // non-measurement labels. Asserting the category rather than the exact string is deliberate: this test
  // once pinned "UNMEASURED" and the word "rank", which is how the tables came to read as a ranking of
  // the models instead of a map from difficulty to fit.
  const MEASURED = ["CONTEXT", "CONTINUITY", "QUOTA", "SURFACE"];
  const HONEST = ["TASTE", "UNMEASURED"];
  // slice(2): both agy_google rungs (Sonnet, Opus) are the operator's own TASTE pick, not the
  // cross-pool escape this loop is checking -- that escape is gpt-6-sol alone, reached only past
  // the anthropic hose starting at planner[2].
  for (const c of planner.slice(2)) {
    if (c.pool !== plannerHose) {
      // The cross-pool seat is the one place a MEASURED basis is earned rather than borrowed:
      // being on another quota pool is a checkable fact, and it is the entire reason the seat
      // exists. Anything else here would be a measurement it does not have.
      assert.equal(c.basis, "QUOTA",
        `${c.model} sits on a different pool, and that -- not taste, not surface -- is why it is here`);
      continue;
    }
    assert.ok(HONEST.includes(c.basis),
      `${c.model} is the operator's pick for the ${c.band} band, so its basis must be one of ` +
      `${HONEST.join("/")} -- got ${c.basis}`);
    assert.ok(!MEASURED.includes(c.basis), `${c.model} must not claim a measured basis`);
  }

  // Same shape for implementer: agy_google leads (TASTE, the operator's pick), the openai hose
  // (astra/sol/luna) follows and keeps its original SURFACE-then-honest structure unchanged.
  const implHose = implementer[1].pool;
  assert.equal(implementer[1].basis, "SURFACE", "the Responses-API constraint is about the LAB, unchanged");
  for (const c of implementer.slice(2)) {
    assert.equal(c.pool, implHose, "astra/sol/luna all still share the one openai hose");
    assert.ok(HONEST.includes(c.basis), "the rungs are banded by fit, never by a measurement");
    assert.ok(!MEASURED.includes(c.basis), `${c.model} must not claim a measured basis`);
  }

  const p = seatingPlan({ roles: ["planner", "implementer", "reviewer"] });
  // BOTH planner and implementer have now DROPPED OUT of wait_only, 2026-09-29, same reseat: each
  // ladder gained a cross-pool rung, so neither is single-hose anymore -- and reviewer's own ladder
  // already had more than one pool before today. With nothing left in this role set to report,
  // wait_only collapses to null entirely rather than an empty-of-these-names string. Nothing in
  // seatingPlan was edited to make this happen -- it reports the ladders whose every rung shares a
  // pool, and none of these three stayed being one. That is the check that the escape is real
  // rather than described: if the new seats were cosmetic, this field would still name them.
  assert.equal(p.wait_only, null, "no role in this set has a single-pool ladder anymore");

  // And the rule the runtime applies to that: no interval means nothing to wait FOR, so the whole
  // ladder is out for the turn rather than tried rung by rung.
  const shut = shouldFallThrough({ status: 429, headers: new Headers() });
  assert.equal(shut.same_vendor_viable, false);
  assert.equal(shut.retry_after_s, null);
  for (const c of planner) assert.ok(c.pool, "every candidate carries its pool so runtime can tell wait from reseat");
});

test("suitability is a preference and never a law: no role table forbids a lab from a job", () => {
  // "Gemini cannot review" or "Astra cannot plan" is not a thing this project knows. Every lab appears
  // as a candidate for more than one job, and the only relational requirement is by vendor.
  const jobsPerLab = {};
  for (const [role, cands] of Object.entries({ ...SEATING, ...INTAKE })) {
    for (const c of cands) (jobsPerLab[c.vendor] ??= new Set()).add(role);
  }
  for (const [lab, jobs] of Object.entries(jobsPerLab)) {
    assert.ok(jobs.size >= 2, `${lab} appears for only ${[...jobs]} -- that reads as a capability law`);
  }
  assert.ok(UNMEASURED.some(u => /writes better code/.test(u)));
  assert.deepEqual(ROLES.reviewer.needs, ["different_vendor"], "the only law is relational, by vendor");
});

test("a band is a fit, not a tier: every difficulty routes to its own occupant", () => {
  // The distinction this pins: a RANK would answer every difficulty with its best model and degrade
  // only under pressure; a ROUTER answers each difficulty with a different one. Asking
  // easy/medium/hard must produce three distinct occupants, each reporting an EXACT rung rather
  // than a fall -- so no difficulty is being served by a neighbour's seating.
  //
  // PLANNER IS EXEMPT, by operator decision rather than by defect (2026-09-28: "Fable 5.1, Opus 5.5
  // for planning"). Two named models cannot fill three bands, so planner@medium deliberately falls
  // to the easy rung. The property that replaces this one for planner is asserted where the rungs
  // are checked directly: fable is reachable only by asking for `hard`, never by falling up. The
  // exemption is named here rather than silently dropped, because a role quietly leaving this loop
  // is exactly how a routing regression would hide.
  for (const role of ["implementer", "reviewer"]) {
    const picked = DIFFICULTY.map(d => {
      const r = selectFor(role, { difficulty: d });
      assert.equal(r.ok, true, `${role}@${d}`);
      assert.equal(r.exact, true, `${role}@${d} fell to ${r.band} instead of having its own rung`);
      assert.equal(r.band, d, `${role}@${d} answered with the ${r.band} rung`);
      return r.model;
    });
    assert.equal(new Set(picked).size, DIFFICULTY.length,
      `${role} answered ${picked.join("/")} -- a band that repeats is a rank wearing band labels`);
  }

  // And the corollary, which is the part that was wrong before: the easy rung is not a demotion, so its
  // basis must not be a measurement -- nothing here measured quality at any difficulty.
  for (const role of ["planner", "implementer"]) {
    const easy = selectFor(role, { difficulty: "easy" });
    assert.ok(["TASTE", "UNMEASURED"].includes(easy.basis),
      `${role}'s easy rung claims ${easy.basis}, which asserts a measurement this project does not have`);
  }

  // NO PROSE MATCHER HERE, and that omission is the finding. The first draft of this test also grepped
  // each rung's `why` for /\b(second|third) (by|choice)\b/ to catch rank language -- and it fired on
  // "Not a second choice", a rung DENYING the ranking. A regex over prose cannot tell an assertion from
  // its denial, so as a gate it forbids discussing the very thing it guards, and as evidence it is a
  // stand-in for the property rather than the property. The structural assertions above are the check:
  // three difficulties, three distinct occupants, each an exact rung, none claiming a measured basis.
});

// THE DEFECT, 2026-09-27 re-review, rank 27. For a role with no banded rungs, escalate() read the declared
// array position as a difficulty rank and confidently went "up a rung" -- the module's own invariant says a
// band is a fit, not a tier, and an unbanded table has no up.
test("escalate() refuses to invent a rung for a role with no banded rungs; the effort dial still turns", () => {
  let cur = selectFor("explorer");
  assert.match(cur.why_rung, /no banded rung; took rank 0/);
  const kinds = [];
  for (let n = 0; n < 8; n++) {
    const e = escalate("explorer", cur);
    if (!e.ok) { assert.match(e.why, /no banded rungs/); assert.match(e.why, /a band is a fit, not a tier/); break; }
    kinds.push(e.kind); cur = e;
  }
  assert.ok(!kinds.includes("rung"), `no rung step may be fabricated from array order; steps were ${kinds.join(",")}`);
});

// A duplicate top-level key in a JS object literal is not a syntax error -- it silently keeps only
// the LAST one, discarding the first as dead code no runtime check can see (Object.keys(SEATING)
// already has one "advocate", whichever block wrote it last). This project has hit exactly this bug
// twice: a "judge:" duplicate (fixed in commit a7cfcb4, per its own commit message) and an
// "advocate:" duplicate (found by an independent code-quality review, precision-coder, after a0a0e81
// edited the vendor string inside BOTH copies without noticing). A runtime test on the parsed object
// cannot catch a THIRD recurrence -- by the time SEATING exists, the duplicate is already gone. This
// reads the source text instead.
test("SEATING has no duplicate top-level role keys in its source text", () => {
  const src = readFileSync(fileURLToPath(new URL("../src/role/seating.mjs", import.meta.url)), "utf8");
  const start = src.indexOf("export const SEATING = {");
  assert.ok(start !== -1, "SEATING export not found");
  const end = src.indexOf("\n};", start);
  assert.ok(end !== -1, "SEATING export's closing brace not found");
  const body = src.slice(start, end);
  const keys = [...body.matchAll(/^  ([a-zA-Z_][\w]*): \[/gm)].map(m => m[1]);
  assert.ok(keys.length > 0, "no top-level role keys matched -- the pattern may need updating");
  const seen = new Set();
  const dupes = keys.filter(k => (seen.has(k) ? true : (seen.add(k), false)));
  assert.deepEqual(dupes, [], `duplicate SEATING key(s) ${dupes.join(", ")} -- only the last one is live; the rest are silently discarded dead code`);
});

test("every seated model has a recorded context window", () => {
  // THE GAP THIS CLOSES, and it is a real one from 2026-09-28: claude-opus-5-5 was promoted to the
  // planner's normal rung while SEAT_FACTS had no window for it, and the entire openai implementer
  // ladder had none at all. Nothing failed, because every caller reads `f.windows?.[model] ?? null`
  // -- so a seated model with no recorded window reports `null` and routes anyway, while the
  // ladder's own comment claims "a 1M window, which is what this role's brief actually needs".
  //
  // A window is a ROUTING fact here, not decoration: CONTEXT is a declared basis, and a rung whose
  // window is unknown cannot honestly carry it. So the check is on the seating table rather than on
  // a fixed list of ids -- seat a new model tomorrow and this fails until its facts are written.
  const missing = [];
  for (const [role, chairs] of [...Object.entries(SEATING), ...Object.entries(INTAKE)]) {
    for (const chair of chairs) {
      if (!chair.model) continue;            // a tier-seated chair resolves its rung at seat time
      const facts = SEAT_FACTS[chair.vendor];
      if (facts?.windows?.[chair.model] === undefined) missing.push(`${role} -> ${chair.vendor}/${chair.model}`);
    }
  }
  assert.deepEqual(missing, [],
    `seated with no recorded context window:\n  ${missing.join("\n  ")}\n` +
    "Add it to SEAT_FACTS[vendor].windows with its source, or the rung routes on a claim nothing backs.");
});
