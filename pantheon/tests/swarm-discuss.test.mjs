import { test } from "node:test";
import assert from "node:assert/strict";
import { runDiscussion, parseTurn, similarity, convergence, roundPrompt, openingPrompt , roleForTurn, DISCUSS_ROLES } from "../src/swarm/discuss.mjs";

const fake = (fn) => async (seat, prompt, round) => ({ ok: true, text: fn(seat, prompt, round), ms: 1 });

// The independence-within-round guarantee: no seat may see a peer's contribution from its OWN
// round. Without this, whoever is asked first frames the round for everyone after.
test("within a round, no seat sees another seat's contribution from that same round", async () => {
  const seen = [];
  await runDiscussion({
    question: "Q?", seats: ["a", "b", "c"], rounds: 2,
    runSeat: fake((seat, prompt, round) => {
      seen.push({ seat, round, prompt });
      return `POSITION: ${seat}-r${round}-unique\nCHANGED: no\nBECAUSE: x`;
    }),
  });
  for (const s of seen) {
    for (const other of ["a", "b", "c"]) {
      if (other === s.seat) continue;
      assert.ok(!s.prompt.includes(`${other}-r${s.round}-unique`),
        `${s.seat} saw ${other}'s round-${s.round} position inside round ${s.round}`);
    }
  }
  // But round 2 MUST see round 1, or it is not a discussion.
  const r2 = seen.filter(s => s.round === 2);
  assert.ok(r2.every(s => /r1-unique/.test(s.prompt)), "round 2 must carry round 1's positions");
});

test("round 1 carries no peer content at all", async () => {
  const seen = [];
  await runDiscussion({
    question: "Q?", seats: ["a", "b"], rounds: 1,
    runSeat: fake((seat, prompt) => { seen.push(prompt); return `POSITION: p-${seat}\nCHANGED: no`; }),
  });
  for (const p of seen) assert.ok(!p.includes("p-"), "an opening prompt must contain no peer positions");
  assert.equal(seen.length, 2);
});

test("a seat is shown its OWN prior position so movement is a real comparison", async () => {
  const seen = [];
  await runDiscussion({
    question: "Q?", seats: ["a", "b"], rounds: 2,
    runSeat: fake((seat, prompt, round) => { seen.push({ seat, round, prompt }); return `POSITION: ${seat}-said-${round}\nCHANGED: no`; }),
  });
  const a2 = seen.find(s => s.seat === "a" && s.round === 2);
  assert.match(a2.prompt, /a-said-1/, "a seat must see what it itself said last round");
});

test("parseTurn extracts the declared shape and flags a malformed reply without losing it", () => {
  const good = parseTurn("POSITION: majority vote is wrong\nCHANGED: yes\nBECAUSE: xai's point about correlated error");
  assert.equal(good.position, "majority vote is wrong");
  assert.equal(good.changed, true);
  assert.match(good.because, /correlated error/);
  assert.equal(good.malformed, false);

  const bolded = parseTurn("**POSITION:** vote is fine\n**CHANGED:** no");
  assert.equal(bolded.position, "vote is fine");
  assert.equal(bolded.changed, false);

  const loose = parseTurn("I think majority vote is a bad idea because models correlate.");
  assert.equal(loose.malformed, true);
  assert.match(loose.position, /bad idea/, "a contribution must not be discarded over formatting");
});

test("similarity is 1 for identical positions, 0 for disjoint ones", () => {
  assert.equal(similarity("correlated errors defeat voting", "correlated errors defeat voting"), 1);
  assert.equal(similarity("apples oranges pears", "trucks lorries vans"), 0);
  assert.ok(similarity("voting fails under correlated error", "correlated error breaks voting") > 0.4);
});

// Herding is the failure mode, so it must be detected, not narrated.
test("convergence is detected and reported as a property of the DISCUSSION", async () => {
  // Every seat ends up saying the same thing by round 3.
  const r = await runDiscussion({
    question: "Q?", seats: ["a", "b", "c"], rounds: 3,
    // Distinct VOCABULARY per seat, not distinct single letters: the metric drops tokens under
    // four characters, so differentiating seats with "a" and "b" made three different positions
    // score as identical. The fixture has to differ in words the metric can actually see.
    runSeat: fake((seat, _p, round) => round < 3
      ? `POSITION: ${{ a: "latency budgets dominate every scheduling decision",
                       b: "vendor pricing asymmetry governs which seat runs",
                       c: "prompt caching alters the arithmetic completely" }[seat]}\nCHANGED: no`
      : `POSITION: correlated error defeats majority voting completely\nCHANGED: yes\nBECAUSE: persuaded`),
  });
  assert.match(r.verdict, /CONVERGED/);
  assert.match(r.verdict, /not as independent agreement/, "the verdict must warn against reading it as corroboration");
  assert.ok(r.trend.at(-1).meanSimilarity > r.trend[0].meanSimilarity);
  assert.deepEqual(r.movement.at(-1).changed, ["a", "b", "c"]);
});

test("surviving disagreement is reported as the useful outcome, not as failure", async () => {
  const r = await runDiscussion({
    question: "Q?", seats: ["a", "b"], rounds: 2,
    runSeat: fake((seat, _p, round) => round === 1
      ? `POSITION: majority voting fails under correlated model error\nCHANGED: no`
      : `POSITION: ${{ a: "majority voting fails under correlated model error",
                       b: "throughput scheduling beats every accuracy argument here" }[seat]}\nCHANGED: no`),
  });
  assert.match(r.verdict, /DIVERGED/);
  assert.match(r.verdict, /surviving objections are the useful output/);
});

test("stable positions are called stable, not spun as consensus", async () => {
  const r = await runDiscussion({
    question: "Q?", seats: ["a", "b"], rounds: 2,
    runSeat: fake(seat => `POSITION: ${{ a: "majority voting fails under correlated error",
                                        b: "throughput scheduling outranks accuracy concerns" }[seat]}\nCHANGED: no`),
  });
  assert.match(r.verdict, /STABLE/);
  assert.equal(r.movement.every(m => m.changed.length === 0), true);
});

test("one seat failing costs its own turn and the discussion continues", async () => {
  const r = await runDiscussion({
    question: "Q?", seats: ["a", "b", "c"], rounds: 2,
    runSeat: async (seat, _p, round) => seat === "b"
      ? { ok: false, why: "429 rate limited", ms: 1 }
      : { ok: true, text: `POSITION: ${seat}-r${round}\nCHANGED: no`, ms: 1 },
  });
  assert.equal(r.failed.length, 2, "b fails in both rounds and both are recorded");
  assert.equal(r.failed[0].seat, "b");
  assert.equal(r.byRound[1].filter(t => t.ok).length, 2, "the other two still spoke");
});

test("the prompt names both failure directions, agreeableness and stubbornness", () => {
  const { prompt } = roundPrompt({ question: "Q", seat: "a", round: 2, transcript: [], priorPosition: "x" });
  assert.match(prompt, /not converge to be agreeable/i);
  assert.match(prompt, /not dig in to seem consistent/i);
  assert.match(prompt, /say whose/i, "attribution of the persuading argument must be required");
  assert.match(openingPrompt({ question: "Q", seat: "a" }).prompt, /have not seen anyone else/);
});

// The independence of round 1 was guaranteed by the loop's ordering: `seen` is frozen before the
// round runs. That is still true, and it is now ALSO structural -- an unassigned round-1 seat is an
// explorer, and an explorer cannot hold a peer's anything, so the guarantee survives a future caller
// who passes a transcript into the opening prompt by mistake.
test("round 1 without an assigned stance is an explorer, so it cannot hold peer context at all", async () => {
  const { ROLES, contextFor } = await import("../src/role/roles.mjs");
  assert.equal(roleForTurn({ round: 1 }), DISCUSS_ROLES.opening);
  assert.equal(ROLES[DISCUSS_ROLES.opening].session.length, 0, "an explorer holds no session tokens");
  const leaked = contextFor(DISCUSS_ROLES.opening, { ticket: "Q", peer_output: "WHAT-B-SAID" });
  assert.equal(leaked.allowed.peer_output, undefined);
  assert.ok(leaked.withheld.includes("peer_output"));

  // An assigned stance is advocacy from word one, and round 2 is advocacy regardless.
  assert.equal(roleForTurn({ round: 1, stance: "X" }), DISCUSS_ROLES.advocacy);
  assert.equal(roleForTurn({ round: 2 }), DISCUSS_ROLES.advocacy);
  assert.equal(ROLES[DISCUSS_ROLES.advocacy].advocacy, true,
    "a debate contribution must be flagged as argument, never read as evidence");
  // And the advocate CAN see peers -- it has to answer them.
  const adv = roundPrompt({ question: "Q", seat: "a", round: 2, transcript: [{ seat: "b", round: 1, position: "P-OF-B" }], priorPosition: "x" });
  assert.match(adv.prompt, /P-OF-B/);
});

test("runDiscussion refuses a discussion too small or too short to be one", async () => {
  await assert.rejects(() => runDiscussion({ question: "Q", seats: ["solo"], rounds: 2, runSeat: fake(() => "x") }), /at least 2 seats/);
  await assert.rejects(() => runDiscussion({ question: "Q", seats: ["a", "b"], rounds: 0, runSeat: fake(() => "x") }), /rounds must be/);
});

// The first live run exposed this: four seats held an IDENTICAL stance from round 1, lexical
// similarity read 0.38 because they worded it differently, and the verdict said STABLE — which
// reads exactly like entrenched disagreement. Those are opposite situations.
test("a room that agreed from the start is reported as NO DISCUSSION, not as stable", async () => {
  const r = await runDiscussion({
    question: "Q?", seats: ["a", "b", "c"], rounds: 3,
    runSeat: fake(seat => `POSITION: ${seat} phrases the same underlying stance differently\nDISAGREES: none\nCHANGED: no`),
  });
  assert.equal(r.vacuous, true);
  assert.equal(r.disagreementDeclared, false);
  assert.match(r.verdict, /NO DISCUSSION OCCURRED/);
  assert.match(r.verdict, /fact about the QUESTION/, "the verdict must not blame the seats");
});

test("a real disagreement nobody resolves is DEADLOCKED, which is a usable outcome", async () => {
  const r = await runDiscussion({
    question: "Q?", seats: ["a", "b"], rounds: 2,
    runSeat: fake(seat => `POSITION: ${seat === "a" ? "voting fails under correlated error" : "throughput outranks accuracy"}\nDISAGREES: ${seat === "a" ? "b" : "a"}\nCHANGED: no`),
  });
  assert.equal(r.vacuous, false);
  assert.equal(r.disagreementDeclared, true);
  assert.match(r.verdict, /DEADLOCKED/);
  assert.match(r.verdict, /surviving positions/);
});

test("DISAGREES parses a list, 'none', and its absence as three different states", () => {
  assert.deepEqual(parseTurn("POSITION: p\nDISAGREES: xai, google\nCHANGED: no").disagrees, ["xai", "google"]);
  assert.deepEqual(parseTurn("POSITION: p\nDISAGREES: none\nCHANGED: no").disagrees, []);
  assert.equal(parseTurn("POSITION: p\nCHANGED: no").disagrees, null, "absent must be null, not an empty list");
});

test("self-interested stances name the seat and its model, and are assigned", async () => {
  const { selfInterestedStances } = await import("../src/swarm/discuss.mjs");
  const st = selfInterestedStances(["openai", "xai"], { openai: "openai, model gpt-6-luna" });
  assert.match(st.openai, /YOU, the "openai" seat/);
  assert.match(st.openai, /gpt-6-luna/, "the seat must know what it is arguing on behalf of");
  assert.match(st.openai, /defer to you specifically/);
  assert.ok(!/gpt-6-luna/.test(st.xai), "a seat must not be told another seat's model");
});

test("an assigned run reports NO evidential value about the question", async () => {
  const r = await runDiscussion({
    question: "Q?", seats: ["a", "b"], rounds: 2,
    stances: { a: "defend X", b: "defend Y" },
    runSeat: fake(seat => `POSITION: ${seat} defends its assignment\nDISAGREES: ${seat === "a" ? "b" : "a"}\nCHANGED: no`),
  });
  assert.equal(r.assigned, true);
  assert.match(r.evidentialValue, /NONE about the question/);
  assert.match(r.verdict, /ARGUED/);
  assert.equal(r.vacuous, false, "an assigned run is never reported as vacuous — it was forced, not unanimous");
});

// Gate theater: a check that cannot stop anything is not a check. The orchestration run's
// outcome must be the ORACLE's, not the integrator's prose.
test("a FAILED oracle fails the whole run, whatever the integrator says", async () => {
  const { runOrchestration } = await import("../src/swarm/orchestrate.mjs");
  const r = await runOrchestration({
    goal: "G", orchestrator: "boss", workers: ["w"],
    runSeat: async (seat, _p, stage) => stage === "plan"
      ? { ok: true, text: '{"tasks":[{"id":"t1","assignee":"w","kind":"code","instruction":"do it"}],"acceptance":"run it"}', ms: 1 }
      : { ok: true, text: "everything is completely fine and shipped", ms: 1 },
    verify: async () => ({ ok: false, detail: "the probe failed" }),
  });
  assert.equal(r.ok, false, "the integrator claimed success; the oracle said no, and the oracle decides");
  assert.match(r.why, /oracle FAILED: t1/);
  assert.deepEqual(r.gate.failed, ["t1"]);
});

test("a run where nothing was verified is not reported as a pass", async () => {
  const { runOrchestration } = await import("../src/swarm/orchestrate.mjs");
  const r = await runOrchestration({
    goal: "G", orchestrator: "boss", workers: ["w"],
    runSeat: async (seat, _p, stage) => stage === "plan"
      ? { ok: true, text: '{"tasks":[{"id":"t1","assignee":"w","kind":"analysis","instruction":"think"}],"acceptance":"x"}', ms: 1 }
      : { ok: true, text: "a confident essay", ms: 1 },
    verify: async () => ({ ok: true, detail: "never called for analysis" }),
  });
  assert.equal(r.ok, false);
  assert.match(r.why, /nothing is proven/);
});

test("an oracle abstention is neither a pass nor a fail", async () => {
  const { runOrchestration } = await import("../src/swarm/orchestrate.mjs");
  const r = await runOrchestration({
    goal: "G", orchestrator: "boss", workers: ["w"],
    runSeat: async (seat, _p, stage) => stage === "plan"
      ? { ok: true, text: '{"tasks":[{"id":"t1","assignee":"w","kind":"code","instruction":"do it"}],"acceptance":"x"}', ms: 1 }
      : { ok: true, text: "code", ms: 1 },
    verify: async () => ({ ok: null, detail: "oracle does not apply" }),
  });
  assert.deepEqual(r.gate.failed, []);
  assert.deepEqual(r.gate.passed, []);
  assert.equal(r.ok, false, "an abstention proves nothing, so it cannot pass the gate");
});
