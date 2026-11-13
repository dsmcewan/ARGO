// Team law. Not personality prompts.
//
// "Checkers cannot ship. Makers cannot mark done. No vendor judges a fight it joined." That is law.
// "Be a thoughtful senior engineer" is a vibe, and a vibe cannot refuse an action.
//
// Each law reports whether it APPLIED as well as whether it passed, because a check that silently
// did not apply prints the same green as one that held -- and a suite whose cases all skip is the
// failure this project has already shipped once.
import { ROSTER, PODS, podOf } from "./roster.mjs";
import { measureBytes } from "./measure.mjs";
import { contextFor, CONTEXT_KINDS } from "../role/roles.mjs";

export class LawViolation extends Error {
  constructor(message, law) { super(message); this.law = law; }
}

/**
 * Actions the team can take. Anything not listed is not law-checked, and `enforce` says so rather
 * than returning a pass.
 */
export const ACTIONS = new Set(["assign", "write", "review", "brief", "open_mode", "mark_done", "ship"]);

/** The only actor permitted to integrate, and it is code rather than a seat. */
export const CONTROLLER = "controller";

export const LAWS = [
  {
    n: 1, name: "one lead per ticket",
    applies: a => a.kind === "assign",
    check: (a, s) => {
      const leads = (s.assignments ?? []).filter(x => ROSTER[x.chair]?.may_open_modes && x.ticket === a.ticket);
      if (!ROSTER[a.chair]) return `"${a.chair}" is not in the roster`;
      if (!ROSTER[a.chair].may_open_modes) return null;                    // not a lead assignment
      const others = leads.filter(x => x.chair !== a.chair);
      return others.length
        ? `ticket "${a.ticket}" already has a lead (${others.map(o => o.chair).join(", ")}); ` +
          `two leads means neither pulled the token`
        : null;
    },
  },
  {
    n: 2, name: "one writer of the tree, named lease",
    applies: a => a.kind === "write",
    check: (a, s) => {
      const pod = ROSTER[a.chair] ? podOf(a.chair) : null;
      if (!pod) return `"${a.chair}" is not in the roster`;
      if (!PODS[pod].writes_tree) return `${a.chair} is in the "${pod}" pod, which does not write the tree`;
      if (!a.lease?.resource || !Number.isInteger(a.lease?.gen)) {
        return `${a.chair} must hold a NAMED lease (resource + generation) to write; ` +
          `"whoever typed last" and a bare flock both fail to say who`;
      }
      const held = (s.leases ?? {})[a.lease.resource];
      if (!held) return `no lease exists on ${a.lease.resource}`;
      if (held.gen !== a.lease.gen) return `lease on ${a.lease.resource} is at gen ${held.gen}; gen ${a.lease.gen} was fenced`;
      if (held.chair && held.chair !== a.chair) return `lease gen ${a.lease.gen} on ${a.lease.resource} is held by ${held.chair}`;
      return null;
    },
  },
  {
    n: 3, name: "checker is a different lab than maker when the work is a diff",
    applies: a => a.kind === "review",
    check: a => {
      if (a.is_diff === false) return null;
      if (!a.producer?.vendor || !a.checker?.vendor) return "review needs a producer and a checker with vendors";
      if (a.producer.vendor === a.checker.vendor) {
        return `${a.checker.vendor} cannot check ${a.producer.vendor}'s diff: same lab. This is the one ` +
          `routing rule with direct evidence behind it here`;
      }
      if (a.assigner?.vendor && a.checker.vendor === a.assigner.vendor) {
        return `${a.checker.vendor} assigned this work and cannot also check it: judgment cuts across ` +
          `the chain, it does not climb it`;
      }
      return null;
    },
  },
  {
    n: 4, name: "specialists get the ticket and the files, not the lead's novel",
    applies: a => a.kind === "brief",
    check: a => {
      // THE ROLE TABLE IS THE LAW HERE, not a list of this file's own. The first version forbade
      // ["supervisor_narration", "peer_defense", "transcript"] -- two of which exist nowhere in the
      // role token vocabulary -- and so PASSED a brief carrying `plan` and `peer_output` to an
      // implementer, the exact thing rule 1 in roles.mjs exists to withhold. A law that checks names
      // nothing produces is green forever.
      const chair = ROSTER[a.chair];
      if (!chair) return `"${a.chair}" is not in the roster`;
      const role = a.role ?? chair.roles[0];
      if (!chair.roles.includes(role)) return `${a.chair} may not be briefed as "${role}"`;
      const keys = Object.keys(a.context ?? {});
      // Names outside the token vocabulary are refused outright, for the same reason contextFor
      // refuses them: an undeclared kind cannot be reasoned about, so it is not waved through.
      const undeclared = keys.filter(k => !CONTEXT_KINDS.has(k));
      if (undeclared.length) {
        return `a brief for ${a.chair} carries undeclared context ${undeclared.join(", ")}; only ` +
          `declared tokens may travel, and none of these is one`;
      }
      const { withheld } = contextFor(role, a.context ?? {});
      if (withheld.length) {
        return `a brief for ${a.chair} as ${role} carries ${withheld.join(", ")}, which that role may not ` +
          `hold: a fat brief makes the occupant restate the plan instead of contradicting it, and that ` +
          `reads as agreement`;
      }
      // Measured, not declared. Trusting a caller-supplied `bytes` is the same defect class shipClaim's
      // law-7 fix closed: a check that reads the claim instead of the thing (2026-09-27 re-review, rank 30).
      const measured = measureBytes(a.context ?? {});
      const bytes = Math.max(measured, typeof a.bytes === "number" ? a.bytes : 0);
      if (bytes > 8192) {
        return `a brief of ${bytes} bytes for ${a.chair} is a diary, not a brief`;
      }
      return null;
    },
  },
  {
    n: 5, name: "scout and explore are opt-in and die at a turn cap",
    applies: a => a.kind === "open_mode",
    check: a => {
      const chair = ROSTER[a.chair];
      if (!chair) return `"${a.chair}" is not in the roster`;
      if (!chair.on_request) return null;
      if (!a.opened_by) return `${a.chair} is on-request and may not run unopened; a standing debate seat ` +
        `will litigate for 72 hours because nobody has to ask it to stop`;
      if (!ROSTER[a.opened_by]?.may_open_modes) return `${a.opened_by} may not open modes`;
      const cap = chair.turn_cap;
      if (!Number.isInteger(cap)) return `${a.chair} is on-request but declares no turn cap`;
      if (Number.isInteger(a.turns) && a.turns > cap) return `${a.chair} has run ${a.turns} turns against a cap of ${cap}`;
      return null;
    },
  },
  {
    n: 6, name: "discuss and refute cannot ship and cannot elect a vendor",
    applies: a => a.kind === "ship" || a.kind === "mark_done",
    check: a => {
      // The controller is not a chair and not a vendor. It is the only thing that may ship, and law 7
      // is what gates it -- without this branch law 7 is unreachable, so the ship path would be
      // "checked" by a rule that can never run.
      if (a.chair === CONTROLLER) return null;
      const chair = ROSTER[a.chair];
      if (!chair) return `"${a.chair}" is not in the roster`;
      if (["opt", "judge"].includes(podOf(a.chair))) {
        return `${a.chair} is in the "${podOf(a.chair)}" pod and may not ${a.kind === "ship" ? "ship" : "mark work done"}`;
      }
      if (a.kind === "ship" && !chair.may_ship) {
        return `${a.chair} may not ship. Integration is the controller's, gated on tests plus a ` +
          `checker ack -- no chair holds the merge button`;
      }
      if (a.kind === "mark_done" && a.producer_chair === a.chair) {
        return `${a.chair} cannot mark its own work done: "done" on a work item is the maker's claim, ` +
          `and acceptance lives with the checker and the gate`;
      }
      // Not merely "not the maker": the CHECKER. The law's own rationale says acceptance lives with the
      // checker, and the check let any non-producer chair mark another's work done (2026-09-27 re-review,
      // rank 29). The review pod is where the checker projection sits.
      if (a.kind === "mark_done" && podOf(a.chair) !== "review") {
        return `${a.chair} is in the "${podOf(a.chair)}" pod and may not mark work done: acceptance lives with ` +
          `the checker (review pod) and the gate, not with whoever is not the maker`;
      }
      return null;
    },
  },
  {
    n: 7, name: "done is tests + checker ack + integrate, not consensus",
    applies: a => a.kind === "ship",
    check: a => {
      const missing = [];
      if (a.tests_passed !== true) missing.push("an executed test run that passed");
      if (a.checker_ack !== true) missing.push("a checker acknowledgement");
      if (a.bound_to_current_bytes !== true) missing.push("both of those bound to the CURRENT bytes");
      if (a.consensus === true && missing.length) {
        return `shipping on consensus with ${missing.join(", ")} missing: agreement is not evidence, ` +
          `and three seats agreeing on a prompt that contained the answer is not verification`;
      }
      return missing.length ? `cannot ship without ${missing.join(", ")}` : null;
    },
  },
];

/**
 * Check an action against the law. Reports which laws applied, so a pass cannot be vacuous.
 */
export function enforce(action, state = {}) {
  if (!ACTIONS.has(action?.kind)) {
    return { ok: false, code: "UNKNOWN_ACTION", applied: [], violations: [],
      why: `"${action?.kind}" is not a law-checked action (known: ${[...ACTIONS].join(", ")}). ` +
        `An unrecognised action is refused, not waved through.` };
  }
  const applied = [], violations = [];
  for (const law of LAWS) {
    if (!law.applies(action)) continue;
    applied.push(law.n);
    const why = law.check(action, state);
    if (why) violations.push({ law: law.n, name: law.name, why });
  }
  return {
    ok: violations.length === 0,
    applied, violations,
    // A green with zero laws applied means nothing was checked.
    vacuous: applied.length === 0,
    why: violations.length ? violations.map(v => `law ${v.law} (${v.name}): ${v.why}`).join(" | ")
      : applied.length === 0 ? `no law applies to a "${action.kind}" in this state; nothing was checked` : null,
  };
}

/** Throwing form, for call sites that should not be able to continue. */
export function assertLawful(action, state = {}) {
  const r = enforce(action, state);
  if (!r.ok) throw new LawViolation(r.why, r.violations[0]?.law ?? null);
  if (r.vacuous) throw new LawViolation(`law check on "${action.kind}" applied no law; that is not a pass`, null);
  return r;
}
