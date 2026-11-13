// The team is stable. The pattern is rented.
//
// A pattern is control flow for one job; the team is the addresses that stay put. So this maps board
// STATE to a pattern run through EXISTING chairs, and it never returns a new seat. If a shape needs a
// seat the roster does not have, that is a roster change a human makes, not something a scheduler
// invents mid-ticket.
//
// The rule worth the whole file: `refute`/`discuss` is a mode the lead may OPEN, not a roommate. A
// standing debate seat will litigate the same question for three days, because nothing in a standing
// seat's definition tells it to stop. On-request plus a turn cap is what tells it.
import { ROSTER, podOf } from "./roster.mjs";

export const PATTERNS = {
  conveyor:      "intake -> plan -> build -> review, straight through the standing chairs",
  delegate:      "the lead decomposes and hands out; impl builds, scout answers bounded questions",
  maker_checker: "one maker, one checker, forced into different labs",
  timeboxed_swarm: "breadth, opened deliberately, dying at a turn cap and handing back to the lead",
  isolated_debate: "forks that never share a transcript; the judge seat is empty or the human takes it",
};

/**
 * What the team does, given what the board says.
 *
 * `chairs` are addresses from the roster. `cap` is the turn cap where the shape is rented rather than
 * standing. `opened_by` names who has to ask, when someone does.
 */
export const RENTED = [
  {
    when: s => s.status === "planning",
    pattern: "delegate", chairs: ["lead@orch"], cap: null,
    why: "the decomposition is not known yet, so the lead owns it before anyone builds",
  },
  {
    when: s => s.status === "executing" && (s.ready ?? 0) > 0,
    pattern: "conveyor", chairs: ["lead@orch", "impl@build", "check@review"], cap: null,
    why: "the stages are known, so the work moves through the standing chairs without a new shape",
  },
  {
    when: s => s.status === "reviewing",
    pattern: "maker_checker", chairs: ["impl@build", "check@review"], cap: null,
    forced: "the checker must be a different lab from the maker",
    why: "a diff exists, and a diff is the case where cross-lab checking has evidence behind it here",
  },
  {
    when: s => s.status === "stuck",
    pattern: "timeboxed_swarm", chairs: ["scout@opt"], cap: ROSTER["scout@opt"].turn_cap,
    opened_by: "lead@orch",
    why: "the hierarchy has stopped moving, which is the one condition that justifies re-opening " +
      "breadth -- and it hands back to the lead at the cap rather than continuing",
  },
  {
    when: s => s.status === "split",
    pattern: "isolated_debate", chairs: ["scout@opt", "arbiter@judge"], cap: ROSTER["arbiter@judge"].turn_cap,
    opened_by: "lead@orch",
    forced: "the judge seat is empty unless a vendor that produced none of the forks can fill it; " +
      "otherwise the human takes it",
    why: "the question is a decision rather than a diff, so the forks must not share a transcript",
  },
];

export class ModeViolation extends Error {}

/**
 * Pick the rented pattern for a board state. Returns the chairs it runs through and what it cannot do.
 */
export function patternFor(state) {
  const hit = RENTED.find(r => r.when(state));
  if (!hit) {
    return { ok: false, why: `no rented pattern for status "${state?.status}"; the team does not improvise a shape` };
  }
  for (const c of hit.chairs) {
    if (!ROSTER[c]) throw new ModeViolation(`rented pattern "${hit.pattern}" names "${c}", which is not in the roster`);
  }
  const standing = hit.chairs.filter(c => !ROSTER[c].on_request);
  const opened = hit.chairs.filter(c => ROSTER[c].on_request);
  return {
    ok: true, pattern: hit.pattern, description: PATTERNS[hit.pattern],
    chairs: hit.chairs, standing, opened,
    cap: hit.cap, opened_by: hit.opened_by ?? null, forced: hit.forced ?? null, why: hit.why,
    // No chair in any rented pattern may ship: integration stays with the controller.
    may_ship: hit.chairs.filter(c => ROSTER[c].may_ship),
    basis: "the team is stable and the pattern is rented: these are existing chairs, and a shape that " +
      "needed a new seat would be a roster change a human makes",
  };
}

/** An on-request chair must have been opened by someone allowed to open modes. */
export function assertOpened({ chair, opened_by, turns = 0 }) {
  const c = ROSTER[chair];
  if (!c) throw new ModeViolation(`"${chair}" is not in the roster`);
  if (!c.on_request) return true;
  if (!opened_by) {
    throw new ModeViolation(
      `${chair} is on-request and was not opened. A standing debate seat litigates the same question ` +
      `for days because nothing in a standing seat tells it to stop; on-request plus a cap does.`);
  }
  if (!ROSTER[opened_by]?.may_open_modes) throw new ModeViolation(`${opened_by} may not open modes`);
  if (Number.isInteger(c.turn_cap) && turns > c.turn_cap) {
    throw new ModeViolation(`${chair} has run ${turns} turns against its cap of ${c.turn_cap}; hand back to ${opened_by}`);
  }
  return true;
}

/** Which chairs may be occupied at all, given the state. Everything else is an empty chair, on purpose. */
export function occupiedChairs(state) {
  const p = patternFor(state);
  const all = Object.keys(ROSTER);
  return {
    open: p.ok ? p.chairs : [],
    idle: all.filter(a => !(p.ok ? p.chairs : []).includes(a)),
    // An empty chair is not a reason to schedule anything.
    why: p.ok ? `${p.pattern}: ${p.why}` : p.why,
  };
}
