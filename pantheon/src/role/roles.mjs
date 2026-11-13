// Roles: specialization as data, independent of vendor.
//
// The project has had `vendor + purpose + cwd` as seat identity from the start, and used `purpose`
// as a namespace — "demo", "swarm-explore", "view". That wasted the axis that actually matters.
// A seat is a ROLE occupied by a VENDOR: the role says what the work is and what may be seen, the
// router says who does it. Models become workers you can reseat.
//
// THE PART THAT IS NOT DECORATION: contextPolicy.
//
// Same control graph plus a different context graph produces an opposite system. Fan-out with
// isolated context is independent evidence; the identical fan-out with a shared transcript is one
// answer in three accents. Tonight both happened here — cross-model review of a design nobody
// authored found two real defects, while a swarm with shared framing and a participant judge
// found nothing it had not been primed to find.
//
// So context is declared per role and ENFORCED by contextFor(), rather than living in whichever
// prompt string a caller happened to write. Violations become impossible instead of discouraged.

// Every context entry is a CAPABILITY TOKEN, and the tokens live in TWO UNIVERSES. Inclusion is only
// ever claimed inside one of them: `own_history ⊆ worker.kinds` is a type error, and treating it as a
// claim is how a pre-board role nearly got a projection and called it coverage.
//
// BOARD tokens name objects that can exist on a ref. They are checked against a projection's `kinds`
// (or its named `mounts`, for reads that are derived rather than stored).
export const BOARD_KINDS = new Set([
  "question",      // the raw ask, BEFORE anyone has turned it into a ticket. Pre-board; no projection.
  "ticket",        // the task statement, and the acceptance criteria inside it
  "plan",          // the planner's product
  "work_item",     // an assigned slice
  "artifact",      // candidate bytes
  "tests",         // the gate's acceptance -- a MOUNT derived from the ticket, not a stored entry
  "hypothesis",    // a stance. Not an exhibit.
  "repro", "search", "trace",   // evidence objects
  "decision",      // the controller's product
]);

// SESSION tokens are traces of THIS occupant and never live on a projection. They are orthogonal: two
// planners each with their own history are two diaries, not one pool.
export const SESSION_KINDS = new Set([
  "own_history",   // this seat's prior turns
  "peer_output",   // another seat's PUBLISHED board objects -- ids, never their transcript
  "peer_defense",  // the argument attached to a hypothesis
]);

export const CONTEXT_KINDS = new Set([...BOARD_KINDS, ...SESSION_KINDS]);
export const boardTokens = ctx => ctx.filter(k => BOARD_KINDS.has(k));
export const sessionTokens = ctx => ctx.filter(k => SESSION_KINDS.has(k));

export const ROLES = {
  // Pre-board. `question` and `ticket` never cohabit: holding a ticket means intake is over.
  scout: {
    charter: "Find out what is actually true about this before anyone plans it. Report what you " +
      "ran and what it printed, not what you concluded.",
    context: ["question"],
    session: [],
    produces_kinds: ["search", "repro"],          // on iso/* refs, as lineage. Never on a board ref.
    produces: "evidence: commands run with their exit codes and output, and sources read. At most " +
      "a DRAFT ticket; never a plan, an artifact, a verdict or a decision",
    mayJudge: false, needs: [], preBoard: true,
  },

  planner: {
    charter: "Decide what work exists and who does it. You do not write the artifact.",
    context: ["ticket", "plan", "work_item"],
    session: ["own_history"],                     // it writes across turns, so it keeps a diary
    produces_kinds: ["plan", "work_item"],
    produces: "a plan: tasks with assignee, kind and a self-contained instruction, plus an " +
      "acceptance criterion a MACHINE can check",
    mayJudge: false, needs: [],
  },

  implementer: {
    charter: "Own the assigned artifact end to end. Fix adjacent defects within your assigned ownership when they prevent the ticket from working; preserve unrelated behavior.",
    // artifact here is READ-WRITE under a lease. That mutation bit is what distinguishes this set
    // from the reviewer's, which otherwise names almost the same tokens.
    context: ["ticket", "work_item", "artifact", "tests", "trace", "repro"],
    session: ["own_history"],
    produces_kinds: ["artifact", "trace", "repro", "work_item"],
    produces: "the artifact itself, no commentary",
    mayJudge: false, needs: [],
  },

  reviewer: {
    charter: "Attack the artifact. Name the strongest specific flaw with a case that breaks it. " +
      "Default to finding a problem; 'looks good' is only acceptable with the strongest counter " +
      "you could construct and why it fails.",
    // No `work_item`: judging the bytes against the ticket keeps the review independent of the
    // mandate. No session tokens at all -- a checker keeps no defense diary.
    context: ["ticket", "artifact", "tests", "trace", "repro"],
    session: [],
    produces_kinds: ["critique"],
    produces: "findings, each with a concrete failing case",
    mayJudge: false, needs: ["different_vendor"],
  },

  explorer: {
    charter: "Answer the question independently. Commit to a position someone could disagree with.",
    // {ticket} and nothing else. It may not MINT search or repro objects: SCOUT_AFTER_BOARD makes
    // orphan evidence illegal once a board exists, so a post-board explorer that could write them
    // would be a scout wearing a chain role's name.
    context: ["ticket"],
    session: [],
    produces_kinds: [],
    produces: "a falsifiable position with its reasoning, returned to the caller",
    mayJudge: false, needs: [],
  },

  judge: {
    charter: "Decide. Name the strongest disagreement, say which side you take, and name any " +
      "position a refutation destroyed. Do not average inputs into a consensus none of them holds.",
    // `decision` because a recorded SPLIT tells a synthesizer the question is genuinely open. The
    // decision ON the question under synthesis is withheld by project(), which is a scoped rule rather
    // than a blanket one.
    context: ["ticket", "tests", "hypothesis", "decision", "repro", "search", "trace"],
    session: ["peer_output", "peer_defense"],     // peer_defense implies peer_output
    produces_kinds: ["hypothesis"],               // a recommendation. The DECISION is the controller's.
    produces: "a recommendation with the dissent preserved, for the controller to resolve",
    mayJudge: true, needs: ["different_vendor"],
  },

  advocate: {
    charter: "Defend the assigned position as its strongest proponent. Do not concede.",
    context: ["ticket", "hypothesis", "repro", "search", "trace"],
    session: ["own_history", "peer_output"],
    produces_kinds: ["hypothesis"],
    produces: "argument for the assigned position",
    mayJudge: false, needs: [], advocacy: true,
  },
};

export class ContextViolation extends Error {}

/**
 * Filter what a role may see. The caller passes everything available; this returns only the
 * permitted slice and records what it withheld, so a brief cannot quietly grow.
 */
export function contextFor(role, available = {}) {
  const spec = ROLES[role];
  if (!spec) throw new ContextViolation(`unknown role "${role}"`);
  const permitted = [...spec.context, ...(spec.session ?? [])];
  const unknown = Object.keys(available).filter(k => !CONTEXT_KINDS.has(k));
  if (unknown.length) {
    // A context kind nobody declared cannot be reasoned about, so it is refused rather than
    // passed through on the assumption it is harmless.
    throw new ContextViolation(
      `undeclared context kind(s): ${unknown.join(", ")}. Add them to CONTEXT_KINDS deliberately.`);
  }
  const allowed = {}, withheld = [];
  for (const [k, v] of Object.entries(available)) {
    if (!permitted.includes(k)) { withheld.push(k); continue; }
    // A KEY-NAME filter is not a content filter. The first version stopped here, so
    //   contextFor("implementer", { ticket: { note: "hi", plan: THE_PLAN } })
    // handed the implementer the plan inside the ticket with withheld: [] -- the one mechanism this
    // project calls load-bearing for "independent evidence rather than one echo" had a one-level
    // bypass and no test. Found by the 2026-09-27 re-review. Permitted values are now walked: a
    // nested object key that names a context kind this role may not hold is a smuggle and is REFUSED,
    // not stripped -- a caller nesting withheld kinds is a bug to surface, not tidy up. Strings that
    // parse as JSON objects are walked too, since that is exactly how the repro smuggled it.
    // What this cannot police is free text that merely mentions a plan; that is the stated limit.
    const smuggled = smuggledKinds(v, permitted, k);
    if (smuggled.length) {
      throw new ContextViolation(
        `context "${k}" for ${role} carries withheld kind(s) nested inside it: ${smuggled.join(", ")}. ` +
        `A permitted key is not a carrier for kinds the role may not hold.`);
    }
    allowed[k] = v;
  }
  return { allowed, withheld, role };
}

const NEST_LIMIT = 8;

/** Paths of nested keys that name a context kind outside `permitted`. Bounded; a value nested past the
 *  limit is refused rather than inspected partially, because "too deep to check" must not read as clean. */
export function smuggledKinds(value, permitted, path = "", depth = 0) {
  if (depth > NEST_LIMIT) return [`${path} (nesting deeper than ${NEST_LIMIT}; refused rather than partially inspected)`];
  if (typeof value === "string") {
    const t = value.trim().replace(/^\uFEFF/, "");
    // `"` too: a JSON string whose content is itself JSON (double-encoded) parses to a string, and the
    // recursion then inspects that. The first version only looked at `{`/`[` and let that through.
    if (!(t.startsWith("{") || t.startsWith("[") || t.startsWith('"'))) return [];
    let parsed; try { parsed = JSON.parse(t); } catch { return []; }
    return smuggledKinds(parsed, permitted, `${path}(json)`, depth + 1);
  }
  if (Array.isArray(value)) return value.flatMap((x, i) => smuggledKinds(x, permitted, `${path}[${i}]`, depth + 1));
  // Map and Set are objects with no enumerable own keys; a Map keyed "plan" walked as {} was clean.
  if (value instanceof Map) return [...value.entries()].flatMap(([k, v]) => smuggledKinds({ [String(k)]: v }, permitted, path, depth));
  if (value instanceof Set) return [...value].flatMap((x, i) => smuggledKinds(x, permitted, `${path}{${i}}`, depth + 1));
  if (value && typeof value === "object") {
    const out = [];
    for (const [k, v] of Object.entries(value)) {
      // Kind names are matched after trimming and lower-casing: "Plan" and "plan " are the same carrier
      // with a different label. What this still cannot police is a renamed key ("the_theory"); that
      // is the same limit as free text, and the reason prompts are built from typed tokens.
      const norm = k.trim().toLowerCase();
      if (CONTEXT_KINDS.has(norm) && !permitted.includes(norm)) out.push(`${path}.${k}`);
      out.push(...smuggledKinds(v, permitted, `${path}.${k}`, depth + 1));
    }
    return out;
  }
  return [];
}

/**
 * Bind a role to a vendor seat. The purpose IS the role, so seat identity finally carries the
 * specialization instead of an ad-hoc label.
 */
export function bindSeat({ role, vendor, cwd, instance }) {
  if (!ROLES[role]) throw new ContextViolation(`unknown role "${role}"`);
  return {
    vendor, cwd,
    purpose: instance ? `${role}#${instance}` : role,
    role,
    label: `${vendor} · ${role}${instance ? `#${instance}` : ""}`,
  };
}

/**
 * Rule 5, as a check rather than a convention: a seat may not judge a contest it entered.
 */
export function assertJudgeEligible({ judge, participants }) {
  const spec = ROLES[judge.role];
  if (!spec?.mayJudge) throw new ContextViolation(`role "${judge.role}" is not permitted to judge`);
  const clash = participants.find(p => p.vendor === judge.vendor);
  if (clash) {
    throw new ContextViolation(
      `${judge.label} shares vendor "${judge.vendor}" with participant ${clash.label}; ` +
      `a vendor may not judge a fight it joined`);
  }
  return true;
}

/**
 * Render a role's prompt from its charter plus only its permitted context. One place where a
 * prompt is built, so the context policy cannot be bypassed by writing a longer string.
 */
export function promptFor(role, available = {}, task = "") {
  const spec = ROLES[role];
  const { allowed, withheld } = contextFor(role, available);
  const parts = [spec.charter];
  if (task) parts.push(`\nTask: ${task}`);
  for (const [k, v] of Object.entries(allowed)) {
    if (v == null || v === "") continue;
    parts.push(`\n[${k}]\n${typeof v === "string" ? v : JSON.stringify(v, null, 2)}`);
  }
  parts.push(`\nProduce: ${spec.produces}`);
  return { prompt: parts.join("\n"), withheld, advocacy: Boolean(spec.advocacy) };
}
