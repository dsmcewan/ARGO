// A discussion among seats: several rounds, everyone reads what the others said.
//
// This is the most contaminating shape in the project, and it is built to measure that rather
// than to hide it. The operator already named the problem: "they pollute each others output and
// findings." A discussion does that deliberately — that is what a discussion IS — so the only
// honest version reports how much position movement was convergence.
//
// TWO DESIGN CHOICES THAT DECIDE WHETHER THE OUTPUT MEANS ANYTHING:
//
// 1. SIMULTANEOUS ROUNDS, not turn-taking. Within a round every seat sees the same transcript —
//    everything through round n-1 — and none sees its peers' round-n contributions. Sequential
//    turn-taking would let the first speaker of each round frame it for everyone after, so
//    "agreement" would partly be an artefact of who was asked first. Simultaneity does not remove
//    anchoring across rounds; it removes the ordering bias inside one.
//
// 2. POSITION MUST BE DECLARED, and movement must be owned. Each seat states a one-line position
//    every round and says whether it CHANGED and why. Without that, a discussion drifts toward
//    agreement and nobody can tell afterwards whether a seat was persuaded, hedged, or simply
//    echoed the loudest voice. Declared movement makes herding visible instead of invisible.
//
// What a discussion is good for: surfacing disagreement, finding an objection nobody had, seeing
// which position survives contact. What it is NOT good for: counting agreement as corroboration.
// Convergence here is evidence about the discussion, not about the world.

import { promptFor } from "../role/roles.mjs";

const clip = (s, n) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

// SELF-INTERESTED STANCES. Each seat argues that IT should be the one trusted, by name, and is
// told its own vendor and model. This is the most degenerate mode in the project and is included
// because it is revealing in exactly one way: it shows which arguments each model reaches for when
// the conclusion is fixed in its own favour, which is a decent proxy for the rhetorical moves it
// will make when it has a stake and nobody said so out loud.
//
// It has NO evidential value about anything, twice over — the stance is assigned AND the stance is
// self-serving. A seat "winning" here means its self-promotion was better argued. Read it for the
// moves, never for the conclusion.
export function selfInterestedStances(seats, facts = {}) {
  return Object.fromEntries(seats.map(seat => [seat,
    `YOU, the "${seat}" seat${facts[seat] ? ` (${facts[seat]})` : ""}, should be the seat whose answer wins ` +
    `whenever the seats disagree. Argue that the harness should defer to you specifically, over the ` +
    `others, and say what about you makes that the right call.`]));
}

// ASSIGNED STANCES. The first live run was vacuous because all four seats independently reached
// the same conclusion, so there was nothing to argue about. Assigning opposing positions fixes
// that structurally rather than by asking models to be disagreeable, which they comply with
// inconsistently.
//
// The cost is severe and must travel with the output: an assigned-stance discussion produces
// ARGUMENTS, not beliefs. Nothing a seat says under an assigned stance is evidence about what
// that model thinks, and a "winner" is evidence about which side has better available arguments,
// not about which is true. It is an argument mill — useful for finding the strongest case against
// a position you hold, useless as corroboration. `assigned: true` is set on every such run so a
// reader cannot lose that.
// PROMPTS ON THIS PATH GO THROUGH promptFor(), same reason as layered.mjs and orchestrate.mjs: the
// role table is the gate. The mapping here is finer than the other two because a discussion's context
// genuinely changes between rounds:
//
//   round 1, no stance   -> explorer  {ticket}
//        It has seen nobody. That IS the explorer condition, and routing it here makes the
//        independence-of-round-1 guarantee structural rather than a property of the loop's ordering.
//   round 1, with stance -> advocate  {ticket, hypothesis}
//        An assigned position is advocacy from the first word.
//   round >= 2           -> advocate  {ticket, hypothesis?, peer_output, own_history}
//        It must see peers to answer them, which no explorer may do.
//
// `advocate` carries advocacy:true, so promptFor flags this output as argument that must never be read
// as evidence. That is the correct label for a debate contribution and it is why convergence in this
// module is reported, never treated as agreement on the truth.
//
// On `peer_output` for the others' positions: in a discussion the PUBLISHED contribution is one
// POSITION line and one BECAUSE line per round -- a peer's output, not their session transcript. The
// token's warning is against handing over a peer's private history, which never happens here.
export const DISCUSS_ROLES = Object.freeze({ opening: "explorer", advocacy: "advocate" });

export const roleForTurn = ({ round, stance }) =>
  (stance || round > 1) ? DISCUSS_ROLES.advocacy : DISCUSS_ROLES.opening;

export function openingPrompt({ question, seat, stance }) {
  if (stance) {
    return promptFor(DISCUSS_ROLES.advocacy, { ticket: question, hypothesis: stance },
      `You are seat "${seat}" in an adversarial debate with other AI models. Round 1; you have not ` +
      `seen anyone else.\n\nYOU HAVE BEEN ASSIGNED THE POSITION IN [hypothesis] AND MUST DEFEND IT.\n\n` +
      `Argue it as its strongest advocate. Do not hedge, do not concede, do not note that the ` +
      `other side has merit. Find the best case for this position even if you would not choose it.\n\n` +
      `Reply in exactly this shape:\nPOSITION: <one line, your assigned position stated sharply>\n` +
      `BECAUSE: <the strongest two sentences you have for it>`);
  }
  return promptFor(DISCUSS_ROLES.opening, { ticket: question },
    `You are seat "${seat}" in a discussion with other AI models. This is round 1 and you have not ` +
    `seen anyone else yet.\n\n` +
    `Reply in exactly this shape:\nPOSITION: <one line, falsifiable, no hedging>\n` +
    `BECAUSE: <two sentences at most>\n\n` +
    `Take a position someone could disagree with. Do not survey possibilities.`);
}

export function roundPrompt({ question, seat, round, transcript, priorPosition, stance }) {
  const others = transcript
    .filter(t => t.seat !== seat)
    .map(t => `[round ${t.round}] ${t.seat} — POSITION: ${clip(t.position, 300)}${t.because ? `\n  BECAUSE: ${clip(t.because, 300)}` : ""}`)
    .join("\n\n");
  if (stance) {
    return promptFor(DISCUSS_ROLES.advocacy,
      { ticket: question, hypothesis: stance, peer_output: others },
      `Adversarial debate, round ${round}. Your assigned position is in [hypothesis] and you must ` +
      `keep defending it. What the others argued is in [peer_output].\n\n` +
      `Attack the strongest opposing argument directly and by name. Do not concede your position ` +
      `and do not look for common ground — someone else is paid to make their case, you are paid ` +
      `to break it.\n\n` +
      `Reply in exactly this shape:\n` +
      `POSITION: <one line, your assigned position>\n` +
      `DISAGREES: <seat names whose position contradicts yours, or "none">\n` +
      `CHANGED: no\n` +
      `BECAUSE: <name the seat and the specific argument you are demolishing, and how. Two sentences.>`);
  }
  return promptFor(DISCUSS_ROLES.advocacy,
    { ticket: question, peer_output: others, own_history: `Your position last round: ${clip(priorPosition, 300)}` },
    `Discussion round ${round}. Your own prior position is in [own_history]; what the others have ` +
    `said is in [peer_output].\n\n` +
    `Reply in exactly this shape:\n` +
    `POSITION: <one line — your position NOW>\n` +
    `DISAGREES: <comma-separated seat names whose position actually CONTRADICTS yours, or "none">\n` +
    `CHANGED: <yes or no>\n` +
    `BECAUSE: <if yes, which specific argument moved you and from whom; if no, the strongest ` +
    `point against you and why it fails. Two sentences at most.>\n\n` +
    // Both failure directions are named, because the prompt is where a discussion is usually lost.
    // RESTORED: rewriting this function through promptFor dropped these two sentences, and the test
    // that pins them is the only reason it was caught. They are the anti-agreeableness clause.
    `Do not converge to be agreeable and do not dig in to seem consistent. Change your mind only ` +
    `if an argument actually defeats yours, and say whose.`);
}

export function parseTurn(text) {
  const raw = String(text ?? "");
  // Labels must be anchored to the START of a line. Matching them anywhere made the ordinary
  // word "because" in prose parse as a declared BECAUSE field, so an unformatted reply came back
  // looking half-structured -- the parser inventing a field the model never wrote.
  const pick = label => {
    const m = raw.match(new RegExp(
      `^[ \\t]*\\**[ \\t]*${label}[ \\t]*\\**[ \\t]*:[ \\t]*\\**[ \\t]*(.+?)` +
      `(?=\\n[ \\t]*\\**[ \\t]*(?:POSITION|CHANGED|BECAUSE)\\b|$)`, "ims"));
    return m ? m[1].replace(/\*+/g, "").trim() : null;
  };
  const position = pick("POSITION");
  const changed = pick("CHANGED");
  const disagrees = pick("DISAGREES");
  return {
    position: position ?? clip(raw, 400),
    because: pick("BECAUSE"),
    changed: changed ? /^y/i.test(changed.trim()) : null,
    // Declared, not inferred. Lexical similarity cannot tell "we agree" from "we phrased one
    // position four ways": the first live run scored 0.38 while all four seats held an identical
    // stance. Asking each seat who actually contradicts it is the only cheap signal that
    // separates a real disagreement from a unanimous room.
    disagrees: disagrees === null ? null
      : (/^\s*none\s*$/i.test(disagrees) ? [] : disagrees.split(/[,;]/).map(x => x.trim().toLowerCase()).filter(Boolean)),
    malformed: !position,
  };
}

// Convergence, measured on the declared positions rather than on vibes. Jaccard over content
// words is crude and says so: it detects seats restating one another, not genuine agreement
// between different formulations. Reported as a trend across rounds, because the trend is the
// signal — a discussion that starts spread and ends identical has herded.
// 4+ characters, because shorter tokens are overwhelmingly stopwords. The limitation is real and
// worth stating: this cannot see a difference carried only by short words, so it measures whether
// seats are RESTATING each other, never whether they agree in substance.
const words = s => new Set(String(s ?? "").toLowerCase().match(/[a-z]{4,}/g) ?? []);
export function similarity(a, b) {
  const A = words(a), B = words(b);
  if (!A.size || !B.size) return 0;
  let shared = 0;
  for (const w of A) if (B.has(w)) shared++;
  return shared / (A.size + B.size - shared);
}

export function convergence(turnsByRound) {
  return turnsByRound.map((turns, i) => {
    const ps = turns.filter(t => t.ok).map(t => t.position);
    const pairs = [];
    for (let a = 0; a < ps.length; a++) for (let b = a + 1; b < ps.length; b++) pairs.push(similarity(ps[a], ps[b]));
    const mean = pairs.length ? pairs.reduce((x, y) => x + y, 0) / pairs.length : 0;
    return {
      round: i + 1,
      meanSimilarity: mean,
      changedCount: turns.filter(t => t.changed === true).length,
      speakers: ps.length,
    };
  });
}

export async function runDiscussion({ question, seats, rounds = 3, runSeat, onRound, stances }) {
  if (!Array.isArray(seats) || seats.length < 2) throw new Error("runDiscussion: need at least 2 seats");
  if (typeof runSeat !== "function") throw new Error("runDiscussion: runSeat(seat, prompt, round) required");
  if (rounds < 1) throw new Error("runDiscussion: rounds must be >= 1");

  const withheldBy = {};          // per round: what the role table refused to pass
  const transcript = [];          // every contribution, in order
  const byRound = [];
  const latest = {};              // each seat's most recent declared position

  for (let round = 1; round <= rounds; round++) {
    // The transcript handed to this round is FROZEN before any of it runs, so no seat can see a
    // peer's contribution from the same round. This is the independence-within-round guarantee.
    const seen = [...transcript];
    const settled = await Promise.allSettled(seats.map(seat => {
      const stance = stances?.[seat];
      const built = round === 1
        ? openingPrompt({ question, seat, stance })
        : roundPrompt({ question, seat, round, transcript: seen, priorPosition: latest[seat], stance });
      withheldBy[round] ??= built.withheld;
      return runSeat(seat, built.prompt, round).then(r => ({ seat, ...r }));
    }));

    const turns = settled.map((s, i) => {
      const seat = seats[i];
      if (s.status !== "fulfilled" || s.value?.ok === false) {
        return { seat, round, ok: false,
          error: s.status === "rejected" ? String(s.reason?.message ?? s.reason) : String(s.value?.why ?? "failed") };
      }
      return { seat, round, ok: true, ms: s.value.ms, ...parseTurn(s.value.text) };
    });

    for (const t of turns) {
      if (!t.ok) continue;
      latest[t.seat] = t.position;
      transcript.push(t);
    }
    byRound.push(turns);
    onRound?.(round, turns, convergence(byRound).at(-1));
  }

  const trend = convergence(byRound);
  const first = trend[0]?.meanSimilarity ?? 0;
  const last = trend.at(-1)?.meanSimilarity ?? 0;

  // Was there a disagreement to discuss at all? Rounds after the first declare it, so a room that
  // agreed from the start is distinguishable from one that argued and held. Without this, both
  // report "nobody moved" and read identically — and the first live run was the vacuous kind.
  const laterRounds = byRound.slice(1).flat().filter(t => t.ok && t.disagrees !== null);
  const anyDisagreement = laterRounds.some(t => t.disagrees.length > 0);
  const vacuous = laterRounds.length > 0 && !anyDisagreement;

  const assigned = Boolean(stances && Object.keys(stances).length);
  return {
    // Travels with every result, because the whole meaning of the output changes.
    assigned,
    // Which role held each round's chair, and what the role table refused to pass. Round 1 without
    // assigned stances is an `explorer` and therefore cannot hold peer_output at all -- that is the
    // independence-of-round-1 guarantee stated as a refusal rather than as loop ordering.
    roles: DISCUSS_ROLES,
    withheld: withheldBy,
    evidentialValue: assigned
      ? "NONE about the question. Stances were assigned, so nothing here reports what any model " +
        "believes, and the stronger side shows which position has better available arguments — not " +
        "which is true. Use it to find the best case against your own view."
      : "Positions are the seats' own, but they read each other from round 2, so later agreement " +
        "is contaminated by design and is not corroboration.",
    vacuous: assigned ? false : vacuous,
    disagreementDeclared: anyDisagreement,
    question, seats, rounds, transcript, byRound, trend,
    // The headline, and deliberately not phrased as a result about the question.
    verdict: assigned
      ? (anyDisagreement
          ? "ARGUED — assigned stances held and clashed. Read the objections, not the outcome."
          : "ASSIGNED BUT NOT ENGAGED — stances were given yet no seat declared a contradiction, " +
            "which usually means the assignment was too weak or the seats accommodated each other.")
      : vacuous
      ? "NO DISCUSSION OCCURRED — every seat declared that no peer contradicts it. The seats agreed " +
        "from round 1, so later rounds were each arguing against a counterargument nobody made. " +
        "This is a fact about the QUESTION, not about the seats: it did not divide them."
      : last > first + 0.15
      ? "CONVERGED — positions grew more alike across rounds. Treat the endpoint as a product of the " +
        "discussion, not as independent agreement; the seats read each other by design."
      : last < first - 0.15
        ? "DIVERGED — positions grew further apart. Disagreement survived contact, which is the " +
          "outcome worth reading; the surviving objections are the useful output."
        : anyDisagreement
          ? "DEADLOCKED — a real disagreement was declared and nobody moved. The surviving positions " +
            "and the reasons each gave for rejecting the others are the output."
          : "STABLE — positions neither merged nor split, and no disagreement was declared either way.",
    movement: byRound.map((turns, i) => ({ round: i + 1, changed: turns.filter(t => t.changed === true).map(t => t.seat) })),
    malformed: byRound.flat().filter(t => t.ok && t.malformed).map(t => `${t.seat}@r${t.round}`),
    failed: byRound.flat().filter(t => !t.ok).map(t => ({ seat: t.seat, round: t.round, error: t.error })),
  };
}
