import { test } from "node:test";
import assert from "node:assert/strict";
import { refutePairs, assertNoSelfReview, overlapFactor, runSwarm, synthesizePrompt, explorePrompt,
  refutePrompt, SWARM_ROLES } from "../src/swarm/layered.mjs";

test("refute pairing is a derangement: no seat ever reviews itself", () => {
  for (const n of [2, 3, 4, 5, 9]) {
    const seats = Array.from({ length: n }, (_, i) => `s${i}`);
    const pairs = refutePairs(seats);
    assert.equal(pairs.length, n);
    assert.equal(assertNoSelfReview(pairs), true);
    assert.equal(new Set(pairs.map(p => p.target)).size, n, "every seat is reviewed exactly once");
  }
});

test("assertNoSelfReview refuses a pairing that would let a producer grade itself", () => {
  assert.throws(() => assertNoSelfReview([{ reviewer: "a", target: "a" }]), /self-review/);
});

// The metric this project got wrong once: sum/wall cannot distinguish parallel from sequential,
// because it is capped by sum/max. These cases pin the corrected behaviour.
test("efficiency distinguishes concurrent from serialized; concurrency alone does not", () => {
  // Four seats, very unequal, PERFECTLY concurrent: wall == slowest.
  const par = overlapFactor({ wallMs: 8000, durations: [8000, 2000, 2000, 2000] });
  assert.equal(par.efficiency, 1, "wall equal to the slowest seat is perfect concurrency");
  assert.ok(par.concurrency < 2, "yet sum/wall is only 1.75 — which is why it is not the verdict");

  // Same durations, fully SERIAL: wall == sum.
  const ser = overlapFactor({ wallMs: 14000, durations: [8000, 2000, 2000, 2000] });
  assert.ok(ser.efficiency < 0.6, `serialized must score low, got ${ser.efficiency}`);
  assert.equal(ser.concurrency, 1, "sum/wall is exactly 1 when serialized");
  assert.ok(par.efficiency > ser.efficiency, "the metric must separate the two cases");
});

test("overlapFactor reports the arithmetic it used, not just a verdict", () => {
  const r = overlapFactor({ wallMs: 100, durations: [100, 50] });
  assert.equal(r.idealMs, 100);
  assert.equal(r.serialMs, 150);
  assert.equal(overlapFactor({ wallMs: 0, durations: [] }).efficiency, 0, "no data must not report success");
});

// Independence: every layer-1 prompt must be identical and must not carry another seat's answer.
test("layer 1 prompts are identical across seats and carry no peer output", async () => {
  const seen = [];
  await runSwarm({
    // Not a judge test: consent explicitly so the new no-self-election rule does not refuse.
    question: "Q?", seats: ["a", "b", "c"], allowParticipantJudge: true,
    runSeat: async (seat, prompt, layer) => { seen.push({ seat, prompt, layer }); return { ok: true, text: `${seat}-answer`, ms: 10 }; },
  });
  const explore = seen.filter(s => s.layer === "explore");
  assert.equal(explore.length, 3);
  assert.equal(new Set(explore.map(e => e.prompt)).size, 1, "all seats must get the same question");
  for (const e of explore) {
    for (const other of ["a-answer", "b-answer", "c-answer"]) {
      assert.ok(!e.prompt.includes(other), "a layer-1 prompt must not contain any seat's answer");
    }
  }
});

test("layer 2 hands each reviewer its target's answer and never its own", async () => {
  const seen = [];
  await runSwarm({
    // Not a judge test: consent explicitly so the new no-self-election rule does not refuse.
    question: "Q?", seats: ["a", "b", "c"], allowParticipantJudge: true,
    runSeat: async (seat, prompt, layer) => { seen.push({ seat, prompt, layer }); return { ok: true, text: `${seat}-answer`, ms: 10 }; },
  });
  for (const r of seen.filter(s => s.layer === "refute")) {
    assert.ok(!r.prompt.includes(`${r.seat}-answer`), `${r.seat} was handed its own answer to review`);
    assert.ok(/-answer/.test(r.prompt), "a refutation must be given something concrete to attack");
  }
});

// A failing seat must cost its own result and nothing else.
test("one seat failing does not cancel the layer", async () => {
  const report = await runSwarm({
    question: "Q?", seats: ["a", "b", "c"],
    runSeat: async seat => {
      if (seat === "b") return { ok: false, why: "429 rate limited", ms: 5 };
      return { ok: true, text: `${seat}-answer`, ms: 10 };
    },
  });
  assert.equal(report.layers.explore.ok, 2);
  assert.deepEqual(report.layers.explore.failed.map(f => f.seat), ["b"]);
  // b produced nothing, so nobody is asked to attack an empty answer.
  assert.equal(report.skippedPairs.length, 1);
  assert.equal(report.skippedPairs[0].target, "b");
  assert.match(report.skippedPairs[0].why, /no answer to attack/);
});

test("a thrown error in one seat is captured, not propagated", async () => {
  const report = await runSwarm({
    question: "Q?", seats: ["a", "b"],
    runSeat: async seat => { if (seat === "a") throw new Error("socket closed"); return { ok: true, text: "b-answer", ms: 9 }; },
  });
  assert.equal(report.layers.explore.ok, 1);
  assert.match(report.layers.explore.failed[0].error, /socket closed/);
});

// The synthesis contract: averaging into a consensus nobody holds is the failure mode, so the
// prompt must demand dissent and attribution.
test("the synthesis prompt demands dissent and forbids averaging", () => {
  const { prompt } = synthesizePrompt({
    question: "Q?",
    answers: [{ seat: "a", text: "A" }, { seat: "b", text: "B" }],
    refutations: [{ reviewer: "a", target: "b", text: "R" }],
  });
  assert.match(prompt, /strongest disagreement/i);
  assert.match(prompt, /do not average/i);
  assert.match(prompt, /\[a\]/, "answers must be attributed to their seat");
  assert.match(prompt, /a attacking b/, "refutations must name attacker and target");
  // It reaches the judge through the role table, so the judge's charter travels with it.
  assert.match(prompt, /Produce:/, "promptFor builds it, so the role's output contract is present");
});

test("explore prompts push for a falsifiable position rather than a hedge", () => {
  assert.match(explorePrompt("Q?").prompt, /disagree with/i);
});

// THE ENFORCEMENT, not the intention. Until these prompts went through promptFor, isolation held
// because each builder happened to pass the right things; a caller passing more was not refused.
test("swarm prompts are built by the role table, so isolation is enforced and not merely intended", async () => {
  const { ROLES, contextFor } = await import("../src/role/roles.mjs");

  // Every stage names a real role, and the roles differ -- one role for all three stages would mean
  // one context policy, which is the shared-transcript failure with extra steps.
  for (const [stage, role] of Object.entries(SWARM_ROLES)) {
    assert.ok(ROLES[role], `stage ${stage} names unknown role "${role}"`);
  }
  assert.equal(new Set(Object.values(SWARM_ROLES)).size, 3, "three stages, three distinct roles");

  // An explorer must not be able to hold a peer's anything. This is the property the whole fan-out
  // rests on: layer 1 is independent evidence only while no explorer can see another's answer.
  const leaked = contextFor(SWARM_ROLES.explore, { ticket: "Q", peer_output: "what b said", peer_defense: "b's case" });
  assert.deepEqual(Object.keys(leaked.allowed), ["ticket"]);
  assert.deepEqual(leaked.withheld.sort(), ["peer_defense", "peer_output"]);

  // A refuter sees the bytes it attacks and NOT their author's defense of them.
  const rev = refutePrompt({ target: "b", answer: "THE-ANSWER", question: "Q" });
  assert.match(rev.prompt, /THE-ANSWER/, "it must see what it is attacking");
  assert.equal(ROLES[SWARM_ROLES.refute].context.includes("peer_defense"), false);

  // And the judge alone may hold both sides.
  assert.ok(ROLES[SWARM_ROLES.synthesize].mayJudge, "only a mayJudge role may synthesize");
  assert.ok((ROLES[SWARM_ROLES.synthesize].session ?? []).includes("peer_defense"));
});

// A run must be able to SHOW the refusals, not assert them. An absent report field and an empty one
// are different claims, and only one of them means anything was checked.
test("the run report carries what each layer withheld", async () => {
  const report = await runSwarm({
    question: "Q", seats: ["a", "b"], judgePool: ["j"],
    runSeat: async () => ({ ok: true, text: "answer", ms: 1 }),
  });
  assert.deepEqual(report.roles, SWARM_ROLES);
  for (const layer of ["explore", "refute", "synthesize"]) {
    assert.ok(Array.isArray(report.withheld[layer]), `layer ${layer} must report its withholding`);
  }
});

test("runSwarm refuses a swarm too small to cross-review", async () => {
  await assert.rejects(() => runSwarm({ question: "Q", seats: ["only"], runSeat: async () => ({ ok: true }) }),
    /at least 2 seats/);
});

// Rule: no seat judges a contest it entered. Was §V2 as an observation; now enforced.
test("a synthesizer that proposed is replaced by a seat that did not", async () => {
  const r = await runSwarm({
    question: "Q?", seats: ["a", "b"], judgePool: ["a", "b", "judge"],
    runSeat: async seat => ({ ok: true, text: `${seat}-answer`, ms: 5 }),
  });
  assert.equal(r.judge, "judge", "an uncompromised seat must be preferred over a participant");
  assert.equal(r.judgeCompromised, false);
  assert.match(r.judgeNote, /did not answer/);
});

test("with every seat proposing and no clean judge, it REFUSES rather than self-electing", async () => {
  await assert.rejects(
    () => runSwarm({ question: "Q?", seats: ["a", "b"], runSeat: async seat => ({ ok: true, text: `${seat}-a`, ms: 5 }) }),
    /would judge its own contest/,
    "the old default silently made seats[0] the judge of its own answer");
});

test("a participant judge is allowed only knowingly, and is stamped as compromised", async () => {
  const r = await runSwarm({
    question: "Q?", seats: ["a", "b"], synthesizer: "a", allowParticipantJudge: true,
    runSeat: async seat => ({ ok: true, text: `${seat}-answer`, ms: 5 }),
  });
  assert.equal(r.judge, "a");
  assert.equal(r.judgeCompromised, true);
  assert.match(r.judgeNote, /NOT an independent verdict/);
});

// A seat that failed to answer is not a participant, so it is eligible to judge.
test("a seat whose answer failed is still a clean judge", async () => {
  const r = await runSwarm({
    question: "Q?", seats: ["a", "b", "c"],
    runSeat: async seat => seat === "c"
      ? { ok: false, why: "429", ms: 1 }
      : { ok: true, text: `${seat}-answer`, ms: 5 },
  });
  assert.equal(r.judge, "c");
  assert.equal(r.judgeCompromised, false);
});

// THE GAP, 2026-09-27 re-review, rank 28. The mock keyed on seat only, so "failed everywhere" and "failed
// explore, then attacked a peer in refute" were the same case to the suite. They are not the same seat: the
// second one entered the contest and may not judge it.
test("a seat that failed to answer but then refuted is a participant, not a clean judge", async () => {
  const seen = [];
  const runSeat = async (seat, prompt, layer) => {
    seen.push({ seat, layer });
    if (seat === "c" && layer === "explore") return { ok: false, why: "429", ms: 1 };
    return { ok: true, text: `${seat}-${layer}`, ms: 5 };
  };
  await assert.rejects(runSwarm({ question: "Q?", seats: ["a", "b", "c"], runSeat }), /no uncompromised seat/);
  assert.ok(seen.some(s => s.seat === "c" && s.layer === "refute"), "the mixed case was actually exercised: c refuted");
  const knowing = await runSwarm({ question: "Q?", seats: ["a", "b", "c"], runSeat, allowParticipantJudge: true });
  assert.equal(knowing.judgeCompromised, true);
});
