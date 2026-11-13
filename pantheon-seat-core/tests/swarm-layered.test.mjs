import { test } from "node:test";
import assert from "node:assert/strict";
import { refutePairs, assertNoSelfReview, overlapFactor, runSwarm, synthesizePrompt, explorePrompt } from "../src/swarm/layered.mjs";

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
    question: "Q?", seats: ["a", "b", "c"],
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
    question: "Q?", seats: ["a", "b", "c"],
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
  const p = synthesizePrompt({
    question: "Q?",
    answers: [{ seat: "a", text: "A" }, { seat: "b", text: "B" }],
    refutations: [{ reviewer: "a", target: "b", text: "R" }],
  });
  assert.match(p, /strongest disagreement/i);
  assert.match(p, /do not average/i);
  assert.match(p, /\[a\]/, "answers must be attributed to their seat");
  assert.match(p, /a attacking b/, "refutations must name attacker and target");
});

test("explore prompts push for a falsifiable position rather than a hedge", () => {
  assert.match(explorePrompt("Q?"), /disagree with/i);
});

test("runSwarm refuses a swarm too small to cross-review", async () => {
  await assert.rejects(() => runSwarm({ question: "Q", seats: ["only"], runSeat: async () => ({ ok: true }) }),
    /at least 2 seats/);
});
