// The standing org: chairs, pods, and what happens when you reseat the model.
//
// A pattern is control flow for one job. A crew is a cast list that dies with the run. A team is the
// thing still there when the ticket is gone: named seats, who may write, what each may see, and what
// the next occupant inherits. The agent sits in the chair; the chair keeps the job.
//
// THE DEFECT THIS FILE EXISTS TO FIX. `src/seat/identity.mjs` keys a seat on
// `vendor + purpose + cwd`. That is correct for a CONVERSATION -- a Claude thread cannot be handed to
// Gemini, so continuity of the dialogue has to be vendor-scoped. It is wrong for a CHAIR: hashing the
// occupant into the identity means reseating the model mints a brand new key, and everything bound to
// it is lost at exactly the moment the chair is supposed to keep the job. So there are two keys:
//
//   chairKey(name, pod, cwd)          the job. Survives reseating. Owns the continuity brief.
//   seatKey(vendor, purpose, cwd)     the conversation. Dies on reseating, necessarily.
//
// An occupancy is (chair, vendor, gen). `gen` increments when the occupant is replaced, which is what
// lets a fenced write be refused after a reseat.
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { ROLES } from "../role/roles.mjs";
import { PROJECTION_FOR_ROLE, PRE_BOARD_ROLES } from "../board/project.mjs";

/**
 * A pod is a CONTEXT DOMAIN, not a group of friends. Seats in a pod share what they may see.
 *
 * This is the boundary the critique-versus-adversary result was asking for: build sees code, review
 * sees the diff and the gate, orch sees the board. Adding seats does not create that boundary;
 * different visibility does.
 */
// A pod's `projection` is the CEILING -- the widest checkout any occupant of the pod may hold. The
// actual projection an occupant gets comes from its ROLE (PROJECTION_FOR_ROLE) and must sit inside the
// ceiling; a test asserts that inclusion for every chair. Two things this corrects:
//
//   orch was "supervisor". That projection is controller_only -- it is the controller's own view of the
//   board, and a chair sitting on it is a vendor holding the controller's eyes, which is the one thing
//   this whole design forbids. The lead is a PLANNER and sits on the planner projection.
//
//   opt was "isolated_debater" for a chair whose roles are scout, explorer and advocate. Only the
//   advocate belongs there: an explorer sits on isolated_reader (kinds [ticket], writes []), and a
//   scout is PRE-BOARD and has no projection at all -- it sits outside, which is the scout rule. So the
//   ceiling stays isolated_debater and each role gets its own.
export const PODS = {
  orch:   { projection: "planner",          writes_tree: false, sees: "the ticket, the plan and the work items -- never the controller's view" },
  build:  { projection: "worker",           writes_tree: true,  sees: "the repo and the failing test" },
  review: { projection: "checker",          writes_tree: false, sees: "the diff and the gate, never the maker's diary" },
  opt:    { projection: "isolated_debater", writes_tree: false, sees: "the question and its own fork" },
  judge:  { projection: "synthesizer",      writes_tree: false, sees: "the forks, which is why it may not have produced one" },
};

/**
 * The cross-vendor bench: four vendors as CAPACITY behind a few chairs, not as four teammates.
 *
 * `candidates` is who may occupy the chair, in order. `roles` is what the chair is allowed to be --
 * a chair that can be anything is a group chat with a job title.
 */
export const ROSTER = {
  "lead@orch": {
    pod: "orch", roles: ["planner"], candidates: ["anthropic", "openai"],
    charter: "owns the ticket and delegates. Does not write the tree and does not judge.",
    may_ship: false, may_open_modes: true,
  },
  "impl@build": {
    pod: "build", roles: ["implementer"], candidates: ["openai", "anthropic"],
    charter: "writes the change. Cannot mark its own work done.",
    may_ship: false, may_open_modes: false,
  },
  "check@review": {
    pod: "review", roles: ["reviewer"], candidates: ["xai", "agy_google", "anthropic", "openai"],
    charter: "fails the gate or passes it. Cannot merge.",
    may_ship: false, may_open_modes: false,
  },
  "scout@opt": {
    pod: "opt", roles: ["scout", "explorer", "advocate"], candidates: ["agy_google", "xai", "openai"],
    charter: "answers a bounded question in isolation, on request, and dies at a turn cap.",
    may_ship: false, may_open_modes: false, on_request: true, turn_cap: 3,
  },
  "arbiter@judge": {
    pod: "judge", roles: ["judge"], candidates: ["anthropic", "openai", "agy_google", "xai"],
    charter: "reads the forks and names the disagreement. Empty unless a decision is open.",
    may_ship: false, may_open_modes: false, on_request: true, turn_cap: 2,
  },
};

// Nothing in the roster may ship. Integration is the controller's, gated on tests plus a checker
// ack -- law 7. A chair with may_ship would be a vendor holding the merge button.
export const SHIPPING_CHAIRS = Object.entries(ROSTER).filter(([, c]) => c.may_ship).map(([n]) => n);

export class RosterViolation extends Error {}
const bad = m => { throw new RosterViolation(m); };

export const parseChair = address => {
  const m = /^([a-z][a-z0-9-]*)@([a-z][a-z0-9-]*)$/.exec(String(address));
  if (!m) bad(`"${address}" is not a chair address (name@pod)`);
  const [, name, pod] = m;
  if (!PODS[pod]) bad(`"${address}" names unknown pod "${pod}" (known: ${Object.keys(PODS).join(", ")})`);
  return { address, name, pod };
};

/** The job's identity. Deliberately excludes the occupant. */
export function chairKey({ address, cwd }) {
  const { name, pod } = parseChair(address);
  if (!cwd) bad("chairKey: cwd is required; a chair is scoped to a working tree");
  return createHash("sha256").update(JSON.stringify([name, pod, resolve(cwd)])).digest("hex").slice(0, 16);
}

/**
 * Seat a vendor in a chair. Returns the occupancy, including whether this vendor has held the chair
 * before -- which matters when the next thing you want is a CHECK rather than more of the same prior.
 */
export function occupy({ address, vendor, cwd, role, history = [], lease, files }) {
  const chair = ROSTER[address] ?? bad(`"${address}" is not in the roster`);
  parseChair(address);
  if (!chair.candidates.includes(vendor)) {
    bad(`${vendor} is not a candidate for ${address} (candidates: ${chair.candidates.join(", ")})`);
  }
  if (role !== undefined && !chair.roles.includes(role)) {
    bad(`${address} may not take the role "${role}" (it may be: ${chair.roles.join(", ")}). ` +
      `A chair that can be anything is a group chat with a job title.`);
  }
  if (role !== undefined && !ROLES[role]) bad(`unknown role "${role}"`);
  const prior = history.filter(h => h.vendor === vendor);
  return {
    address, pod: chair.pod, vendor, cwd,
    key: chairKey({ address, cwd }),
    // The conversation is vendor-scoped and starts fresh on a reseat; the chair's memory does not.
    purpose: role ? `${chair.pod}/${role}` : chair.pod,
    role: role ?? chair.roles[0],
    gen: history.length + 1,
    reseated: history.length > 0,
    repeat_occupant: prior.length > 0,
    why_repeat_matters: prior.length > 0
      ? `${vendor} has held ${address} ${prior.length} time(s); if what you want next is a CHECK, ` +
        `reseating the same prior is not one`
      : null,
    // The ROLE's projection, inside the pod's ceiling. A pre-board role (scout) has none: it is outside
    // the board on purpose, and `null` here is that fact rather than a missing value.
    projection: projectionFor(role ?? chair.roles[0], chair.pod),
    ceiling: PODS[chair.pod].projection,
    pre_board: isPreBoard(role ?? chair.roles[0]),
    writes_tree: PODS[chair.pod].writes_tree,
    // Passed through when the caller has them, because subagentBrief needs both and an occupancy that
    // cannot carry them makes every file-bearing subagent unschedulable.
    lease: lease ?? null,
    files: files ?? null,
  };
}

const isPreBoard = role => PRE_BOARD_ROLES.has ? PRE_BOARD_ROLES.has(role) : PRE_BOARD_ROLES.includes(role);

/** The projection a role holds when seated in a pod: the role's own, or none for a pre-board role. */
export function projectionFor(role, pod) {
  if (isPreBoard(role)) return null;
  const own = PROJECTION_FOR_ROLE[role];
  if (!own) bad(`role "${role}" has no projection and is not pre-board; it cannot be seated in pod "${pod}"`);
  return own;
}

/**
 * Who to seat next. `avoidPriors` prefers a vendor that has NOT held this chair, which is the whole
 * point of recording who last occupied it.
 */
export function nextOccupant({ address, history = [], exclude = [], avoidPriors = false }) {
  const chair = ROSTER[address] ?? bad(`"${address}" is not in the roster`);
  const held = new Set(history.map(h => h.vendor));
  const pool = chair.candidates.filter(v => !exclude.includes(v));
  const fresh = pool.filter(v => !held.has(v));
  const pick = avoidPriors ? (fresh[0] ?? null) : (pool[0] ?? null);
  return {
    vendor: pick,
    fresh: avoidPriors ? fresh : pool,
    why: pick === null
      ? (avoidPriors && pool.length
          ? `every candidate for ${address} has held it before; a genuinely fresh prior is not available`
          : `no candidate for ${address} after excluding ${exclude.join(", ") || "nothing"}`)
      : avoidPriors && fresh.includes(pick) ? `${pick} has not held ${address} before` : `first available candidate`,
  };
}

/** The pod boundary, as a question a caller can actually ask. */
export const podOf = address => parseChair(address).pod;
export const sharesPod = (a, b) => podOf(a) === podOf(b);
