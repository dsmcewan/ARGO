// Layered swarm across vendor seats.
//
//   layer 1  EXPLORE    every seat answers the question independently, concurrently
//   layer 2  REFUTE     every seat attacks a DIFFERENT seat's answer, concurrently
//   layer 3  SYNTHESIZE one seat reads all answers and all refutations
//
// Two properties make this worth more than one strong session, and both are checked rather than
// assumed:
//
// INDEPENDENCE. Layer 1 seats must not see each other's output. If they did, the later ones
// would anchor on the earlier and the "five views" would be one view with four echoes. They are
// launched together and none is told what the others said.
//
// NO SELF-REVIEW. Layer 2 pairs are derangements: no seat ever reviews itself. A producer
// grading its own output is the failure this shape exists to remove, and a round-robin shift by
// one guarantees it structurally instead of hoping the prompt discourages it.
//
// Parallelism is MEASURED. Each layer records its wall clock and the sum of its seats' own
// durations; the ratio is the speedup actually obtained. A swarm that quietly serialized would
// report a ratio near 1 and could not hide behind the word "parallel".

export const LAYERS = ["explore", "refute", "synthesize"];

// Rotate by one: seat i reviews seat i+1. With n >= 2 this is a derangement, so no seat is ever
// handed its own work. Returned explicitly so a caller can print the pairing and check it.
export function refutePairs(seats) {
  if (seats.length < 2) return [];
  return seats.map((reviewer, i) => ({ reviewer, target: seats[(i + 1) % seats.length] }));
}

export function assertNoSelfReview(pairs) {
  const self = pairs.filter(p => p.reviewer === p.target);
  if (self.length) throw new Error(`self-review in pairing: ${self.map(p => p.reviewer).join(", ")}`);
  return true;
}

// CORRECTED. `sum/wall` alone does NOT distinguish parallel from sequential, because it is
// bounded above by sum/max: four seats taking 8s, 2s, 2s, 2s report 1.75x at PERFECT
// parallelism. That metric measures how unequal the seats are, not whether they overlapped --
// a checker measuring a stand-in for the property it claims, which is the defect class this
// project keeps paying for.
//
// The discriminating comparison is wall clock against the SLOWEST seat:
//   wall ~= max(durations)  -> fully concurrent; the layer costs only its slowest member
//   wall ~= sum(durations)  -> serialized, whatever the code intended
// `efficiency` is 1.0 at perfect concurrency and ~1/n when fully serial, and is the number to
// read. `concurrency` (sum/wall) is kept because it says how many calls were in flight on
// average, which is useful and is NOT a parallelism verdict.
export function overlapFactor({ wallMs, durations = [], intervals = null, total = null, ok = null }) {
  // TWO SURVIVORSHIP FAULTS, both found by the 2026-09-27 re-review, both in this one function:
  //   1. it was fed only the OK seats' durations, so a layer where three of four seats failed at once
  //      reported efficiency 1.00 for the survivor -- "perfect concurrency" for a mostly-failed layer;
  //   2. max(duration)/wall cannot tell seats that genuinely ran at the same time from seats that were
  //      dispatched together and then served one after another by an internal queue -- both give 1.00.
  // Every seat's time counts now, failed or not, and when the caller supplies start/end INTERVALS the
  // overlap is computed from the union of what actually ran concurrently, which a serialised layer
  // cannot fake. `coverage` says how many seats produced anything; a partial layer says so in `caveat`.
  // Inconsistent timings (an end before its start, a wall shorter than its longest seat, ok > total) come
  // from a caller, never from timed(); they are clamped and NAMED rather than reported as a ratio above 1.
  if (intervals) intervals = intervals.map(i => ({ started: i.started, ended: Math.max(i.started, i.ended) }));
  const durs = intervals ? intervals.map(i => Math.max(0, i.ended - i.started)) : durations;
  if (!durs.length) {
    return { concurrency: 0, efficiency: 0, idealMs: 0, serialMs: 0, unionMs: 0, coverage: 0, caveat: "no measured seats" };
  }
  // A layer that completes inside one millisecond is not "nothing ran": two mocked seats did, one failed,
  // and the old `wallMs <= 0` early return reported coverage 0 for it (in-session probe, 2026-09-27). The
  // wall is measured as at least 1ms so every ratio stays finite and coverage is counted from the seats.
  wallMs = Math.max(1, wallMs);
  const serialMs = durs.reduce((a, b) => a + b, 0);
  const idealMs = Math.max(...durs);
  let unionMs = null;
  if (intervals) {
    let cur = null; unionMs = 0;
    for (const iv of [...intervals].sort((a, b) => a.started - b.started)) {
      if (!cur || iv.started > cur.ended) { if (cur) unionMs += cur.ended - cur.started; cur = { started: iv.started, ended: iv.ended }; }
      else cur.ended = Math.max(cur.ended, iv.ended);
    }
    if (cur) unionMs += cur.ended - cur.started;
  }
  const concurrency = unionMs ? serialMs / unionMs : serialMs / wallMs;   // mean simultaneous seats while anything ran
  const efficiency = Math.min(1, idealMs / wallMs);                        // 1.0 = the layer cost only its slowest seat
  const coverage = total ? Math.min(1, Math.max(0, (ok ?? total) / total)) : 1;
  const caveats = [];
  if (idealMs > wallMs) caveats.push(`wall ${wallMs}ms is shorter than the longest seat (${idealMs}ms): the timings disagree; efficiency clamped to 1`);
  if (total && (ok ?? total) > total) caveats.push(`ok (${ok}) exceeds total (${total}): coverage clamped to 1`);
  if (coverage < 1) caveats.push(`${total - ok} of ${total} seat(s) failed; their time is counted above, and efficiency over a partial layer is not evidence of parallel speedup`);
  if (intervals && intervals.length > 1 && concurrency < 1.5) caveats.push(`measured overlap ${concurrency.toFixed(2)}x: the seats ran largely one after another, whatever the dispatch looked like`);
  return { concurrency, efficiency, idealMs, serialMs, unionMs, coverage, caveat: caveats.length ? caveats.join("; ") : null };
}

import { promptFor } from "../role/roles.mjs";

const clip = (s, n) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

// EVERY PROMPT ON THIS PATH IS BUILT BY promptFor(), and that is the fix for the gap this module
// shipped with. The context policy in src/role/roles.mjs was enforceABLE and not enforced here: these
// builders assembled their own strings, so the withholding that makes fan-out independent held only
// because each builder happened to pass the right things. Nothing refused a caller who passed more.
// Now the role table is the gate, each builder returns the `withheld` list as EVIDENCE that isolation
// happened rather than as a property of this file's shape, and the run report carries it.
//
// The three stages map onto three roles, and the token choices are deliberate:
//
//   explore   -> explorer  {ticket}                      the question IS the run's task statement
//   refute    -> reviewer  {ticket, artifact}             the peer's answer is the artifact judged
//   synthesize-> judge     {ticket, hypothesis, peer_defense}
//
// `peer_output` is NOT used for the answers even though judge admits it, because that token means a
// peer's PUBLISHED board objects -- ids, never their transcript. An independent answer is a stance, so
// it is a `hypothesis`; the attacks on those stances are the arguments attached to them, so they are
// `peer_defense`. Using peer_output for full text would quietly redefine a token the board relies on.
//
// The question travels as `ticket` rather than `question`: `question` is the PRE-BOARD token and only
// scout holds it, so widening explorer to accept it would let explorers run before intake -- exactly
// what the scout rule exists to prevent. A swarm question is the task statement for that run.
export const SWARM_ROLES = Object.freeze({ explore: "explorer", refute: "reviewer", synthesize: "judge" });

export function explorePrompt(question) {
  return promptFor(SWARM_ROLES.explore, { ticket: question },
    // The charter already says "commit to a position someone could disagree with", so this does not
    // repeat it -- promptFor prepends the charter, and a duplicated instruction reads as emphasis the
    // author did not intend.
    "Answer directly in at most four sentences. Do not hedge, do not list caveats, and do not " +
    "restate the question.");
}

export function refutePrompt({ target, answer, question }) {
  return promptFor(SWARM_ROLES.refute, { ticket: question, artifact: clip(answer, 1200) },
    `The [artifact] above is an answer from a DIFFERENT model (${target}). It is not yours. ` +
    "Attack it. Name the strongest specific flaw: an assumption it smuggles in, a case where it " +
    "is confidently wrong, or something load-bearing it omits. If it is right, say CORRECT and " +
    "name what it still misses. Two sentences. Do not summarise it first.");
}

// The synthesis prompt is where most swarms quietly fail: asked to "combine", a model averages
// the inputs into a consensus that no participant actually holds and that hides the one dissent
// worth acting on. So it is required to name the disagreement and to say who was refuted.
export function synthesizePrompt({ question, answers, refutations }) {
  const a = answers.map(r => `[${r.seat}] ${clip(r.text, 700)}`).join("\n\n");
  const r = refutations.map(x => `[${x.reviewer} attacking ${x.target}] ${clip(x.text, 500)}`).join("\n\n");
  return promptFor(SWARM_ROLES.synthesize, { ticket: question, hypothesis: a, peer_defense: r },
    "The [hypothesis] block holds independent answers; [peer_defense] holds the cross-refutations. " +
    "Write the synthesis. Requirements, all mandatory:\n" +
    "1. State the answer you would actually act on.\n" +
    "2. Name the single strongest disagreement between these seats and say which side you take.\n" +
    "3. Name any answer a refutation successfully destroyed, and say so plainly.\n" +
    "Do not average them into a consensus none of them holds. Six sentences maximum.");
}

// Run the swarm. `runSeat` is injected: this module performs no I/O and knows nothing about
// HTTP, SDKs or panes, so the layering can be tested without a network or a credential.
// Rule: no seat judges a contest it entered. This was evidence §V2 as an observation and is now
// enforced. `synthesizer ?? seats[0]` made SELF-ELECTION the default -- the judge was always a
// proposer, and on the live run it ruled against the consensus it had joined, which reads well and
// proves nothing.
//
// With every seat proposing there IS no clean judge, so the honest options are to bring one in or
// to stamp the result. Passing a participant now requires saying so, and the report carries
// `judgeCompromised` either way.
export async function runSwarm({
  question, seats, runSeat, synthesizer, onLayer, judgePool, allowParticipantJudge = false,
}) {
  if (!Array.isArray(seats) || seats.length < 2) throw new Error("runSwarm: need at least 2 seats");
  if (typeof runSeat !== "function") throw new Error("runSwarm: runSeat(seat, prompt, layer) required");
  const report = { question, seats, layers: {} };

  const timed = async (layer, jobs) => {
    const t0 = Date.now();
    // Promise.allSettled, not all: one vendor failing must not cancel the layer. A swarm that
    // loses four results because the fifth 429'd is worse than one that reports four and a gap.
    // Every job is timed HERE, start and end, whether it succeeds or not -- the seat's own `ms` is kept
    // as what it reported, but the overlap measurement below uses these intervals, which a failed seat
    // has too and an internally-serialised runSeat cannot fake.
    const timedJobs = jobs.map(j => async () => {
      const started = Date.now();
      try { return { value: await j.run(), started, ended: Date.now() }; }
      catch (reason) { throw Object.assign(new Error(String(reason?.message ?? reason)), { started, ended: Date.now(), reason }); }
    });
    const settled = await Promise.allSettled(timedJobs.map(f => f()));
    const wallMs = Date.now() - t0;
    const results = settled.map((s, i) => {
      const v = s.status === "fulfilled" ? s.value.value : null;
      const started = s.status === "fulfilled" ? s.value.started : s.reason?.started ?? t0;
      const ended = s.status === "fulfilled" ? s.value.ended : s.reason?.ended ?? Date.now();
      return {
        ...jobs[i].meta,
        ok: s.status === "fulfilled" && v?.ok !== false,
        text: s.status === "fulfilled" ? (v?.text ?? "") : "",
        ms: s.status === "fulfilled" ? (v?.ms ?? (ended - started)) : (ended - started),
        started, ended,
        error: s.status === "rejected" ? String(s.reason?.reason?.message ?? s.reason?.message ?? s.reason)
          : (v?.ok === false ? String(v.why ?? "failed") : null),
      };
    });
    const layerReport = {
      wallMs,
      ...overlapFactor({ wallMs, intervals: results.map(r => ({ started: r.started, ended: r.ended })),
        total: results.length, ok: results.filter(r => r.ok).length }),
      ok: results.filter(r => r.ok).length,
      failed: results.filter(r => !r.ok).map(r => ({ seat: r.seat ?? r.reviewer, error: r.error })),
      results,
    };
    report.layers[layer] = layerReport;
    onLayer?.(layer, layerReport);
    return results;
  };

  // LAYER 1 — independent exploration. All launched before any completes.
  const withheldBy = {};
  const built = (layer, b) => { withheldBy[layer] = b.withheld; return b.prompt; };
  const answers = await timed("explore", seats.map(seat => ({
    meta: { seat },
    run: () => runSeat(seat, built("explore", explorePrompt(question)), "explore"),
  })));

  // LAYER 2 — cross-refutation over a derangement.
  const pairs = refutePairs(seats);
  assertNoSelfReview(pairs);
  report.pairs = pairs;
  const bySeat = Object.fromEntries(answers.map(a => [a.seat, a]));
  // Only refute targets that actually produced something. Attacking an empty answer yields a
  // confident critique of nothing, which reads like a finding and is noise.
  const live = pairs.filter(p => bySeat[p.target]?.ok && bySeat[p.target].text.trim());
  report.skippedPairs = pairs.filter(p => !live.includes(p))
    .map(p => ({ ...p, why: `target ${p.target} produced no answer to attack` }));
  const refutations = await timed("refute", live.map(p => ({
    meta: p,
    run: () => runSeat(p.reviewer,
      built("refute", refutePrompt({ target: p.target, answer: bySeat[p.target].text, question })), "refute"),
  })));

  // LAYER 3 — synthesis by one seat, with dissent required.
  //
  // Prefer a judge that did not propose. `judgePool` is how a caller supplies one; failing that,
  // any seat that produced no answer is still uncompromised. Only then fall back to a participant,
  // and only with explicit consent.
  // PARTICIPATED means proposed OR refuted. The first version counted only proposers, so a seat that
  // failed layer 1 (no answer) and then attacked a peer in layer 2 was "clean" and could judge the
  // very contest it had just fought in. Refuting is joining the fight.
  const proposed = new Set([
    ...answers.filter(a => a.ok).map(a => a.seat),
    ...refutations.filter(r => r.ok).map(r => r.reviewer),
  ]);
  const clean = (judgePool ?? seats).filter(s2 => !proposed.has(s2));
  let synth = synthesizer ?? clean[0] ?? seats[0];
  let judgeCompromised = proposed.has(synth);
  if (judgeCompromised && !allowParticipantJudge) {
    if (clean.length) {
      synth = clean[0];
      judgeCompromised = false;
    } else {
      throw new Error(
        `runSwarm: synthesizer "${synth}" proposed an answer, so it would judge its own contest, and ` +
        `no uncompromised seat is available. Supply judgePool with a seat that did not answer, or ` +
        `pass allowParticipantJudge:true to accept a compromised judge knowingly.`);
    }
  }
  report.judge = synth;
  report.judgeCompromised = judgeCompromised;
  report.judgeNote = judgeCompromised
    ? `${synth} both answered and judged; its synthesis is advocacy-adjacent and is NOT an independent verdict`
    : `${synth} did not answer, so the synthesis is at least not self-grading`;
  const [synthesis] = await timed("synthesize", [{
    meta: { seat: synth },
    run: () => runSeat(synth,
      built("synthesize", synthesizePrompt({
        question,
        answers: answers.filter(a => a.ok),
        refutations: refutations.filter(r => r.ok),
      })), "synthesize"),
  }]);

  report.synthesis = synthesis;
  // What the policy REFUSED to pass, per layer. A run that claims independent fan-out should be able
  // to show the refusals rather than assert them; an empty list means nothing was offered that the
  // role could not hold, which is different from nothing having been checked.
  report.withheld = withheldBy;
  report.roles = SWARM_ROLES;
  report.totalMs = Object.values(report.layers).reduce((a, l) => a + l.wallMs, 0);
  return report;
}
