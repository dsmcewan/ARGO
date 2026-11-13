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
export function overlapFactor({ wallMs, durations }) {
  if (!durations.length || wallMs <= 0) return { concurrency: 0, efficiency: 0, idealMs: 0, serialMs: 0 };
  const serialMs = durations.reduce((a, b) => a + b, 0);
  const idealMs = Math.max(...durations);
  return {
    concurrency: serialMs / wallMs,
    efficiency: idealMs / wallMs,          // 1.0 = the layer cost only its slowest seat
    idealMs,
    serialMs,
  };
}

const clip = (s, n) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

export function explorePrompt(question) {
  return `${question}\n\nAnswer directly in at most four sentences. Do not hedge, do not list ` +
    `caveats, and do not restate the question. Commit to a position someone could disagree with.`;
}

export function refutePrompt({ target, answer }) {
  return `Below is an answer from a DIFFERENT model (${target}). It is not yours.\n\n` +
    `"${clip(answer, 1200)}"\n\n` +
    `Attack it. Name the strongest specific flaw: an assumption it smuggles in, a case where it ` +
    `is confidently wrong, or something load-bearing it omits. If it is right, say CORRECT and ` +
    `name what it still misses. Two sentences. Do not summarise it first.`;
}

// The synthesis prompt is where most swarms quietly fail: asked to "combine", a model averages
// the inputs into a consensus that no participant actually holds and that hides the one dissent
// worth acting on. So it is required to name the disagreement and to say who was refuted.
export function synthesizePrompt({ question, answers, refutations }) {
  const a = answers.map(r => `[${r.seat}] ${clip(r.text, 700)}`).join("\n\n");
  const r = refutations.map(x => `[${x.reviewer} attacking ${x.target}] ${clip(x.text, 500)}`).join("\n\n");
  return `Question: ${question}\n\n` +
    `Independent answers:\n\n${a}\n\nCross-refutations:\n\n${r}\n\n` +
    `Write the synthesis. Requirements, all mandatory:\n` +
    `1. State the answer you would actually act on.\n` +
    `2. Name the single strongest disagreement between these seats and say which side you take.\n` +
    `3. Name any answer a refutation successfully destroyed, and say so plainly.\n` +
    `Do not average them into a consensus none of them holds. Six sentences maximum.`;
}

// Run the swarm. `runSeat` is injected: this module performs no I/O and knows nothing about
// HTTP, SDKs or panes, so the layering can be tested without a network or a credential.
export async function runSwarm({ question, seats, runSeat, synthesizer, onLayer }) {
  if (!Array.isArray(seats) || seats.length < 2) throw new Error("runSwarm: need at least 2 seats");
  if (typeof runSeat !== "function") throw new Error("runSwarm: runSeat(seat, prompt, layer) required");
  const report = { question, seats, layers: {} };

  const timed = async (layer, jobs) => {
    const t0 = Date.now();
    // Promise.allSettled, not all: one vendor failing must not cancel the layer. A swarm that
    // loses four results because the fifth 429'd is worse than one that reports four and a gap.
    const settled = await Promise.allSettled(jobs.map(j => j.run()));
    const wallMs = Date.now() - t0;
    const results = settled.map((s, i) => ({
      ...jobs[i].meta,
      ok: s.status === "fulfilled" && s.value?.ok !== false,
      text: s.status === "fulfilled" ? (s.value?.text ?? "") : "",
      ms: s.status === "fulfilled" ? (s.value?.ms ?? 0) : 0,
      error: s.status === "rejected" ? String(s.reason?.message ?? s.reason)
        : (s.value?.ok === false ? String(s.value.why ?? "failed") : null),
    }));
    const layerReport = {
      wallMs,
      ...overlapFactor({ wallMs, durations: results.filter(r => r.ok).map(r => r.ms) }),
      ok: results.filter(r => r.ok).length,
      failed: results.filter(r => !r.ok).map(r => ({ seat: r.seat ?? r.reviewer, error: r.error })),
      results,
    };
    report.layers[layer] = layerReport;
    onLayer?.(layer, layerReport);
    return results;
  };

  // LAYER 1 — independent exploration. All launched before any completes.
  const answers = await timed("explore", seats.map(seat => ({
    meta: { seat },
    run: () => runSeat(seat, explorePrompt(question), "explore"),
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
    run: () => runSeat(p.reviewer, refutePrompt({ target: p.target, answer: bySeat[p.target].text }), "refute"),
  })));

  // LAYER 3 — synthesis by one seat, with dissent required.
  const synth = synthesizer ?? seats[0];
  const [synthesis] = await timed("synthesize", [{
    meta: { seat: synth },
    run: () => runSeat(synth,
      synthesizePrompt({
        question,
        answers: answers.filter(a => a.ok),
        refutations: refutations.filter(r => r.ok),
      }), "synthesize"),
  }]);

  report.synthesis = synthesis;
  report.totalMs = Object.values(report.layers).reduce((a, l) => a + l.wallMs, 0);
  return report;
}
