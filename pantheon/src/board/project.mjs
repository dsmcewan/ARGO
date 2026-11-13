// Projections: same store, different root plus an allowlist. The schema trick from the board layer,
// implemented as merkle paths instead of a SELECT.
//
// This is where context topology stops being a convention. The same control graph over a different
// context graph produces an opposite system: fan-out with isolated context is independent evidence;
// the identical fan-out over one shared transcript is one answer in three accents. Both happened in
// this repo on 2026-09-27 -- cross-model review of a design nobody authored found two real defects,
// while a swarm with shared framing and a participant judge found nothing it had not been primed to
// find.
//
// THE FIELD THAT MATTERS MOST HERE IS commit.msg. It is the maker's defense: the place a producer
// explains why its patch is right. A checker that reads it is a checker that can be talked out of a
// finding, so the checker projection strips it and says so. In the entry world this was
// `peer_defense` (see src/role/roles.mjs); in the merkle world it is a commit message, and it needs
// blocking in both.
import { shortCid } from "./canon.mjs";
import { treeSlots, entriesOfKind, history } from "./dag.mjs";
import { EVIDENCE_KINDS, KINDS } from "./schema.mjs";

export const PROJECTIONS = {
  // `kinds` are board entry kinds the checkout admits. `mounts` are DERIVED reads that are not stored
  // entries -- `tests` is the ticket's acceptance, so a role asking for it must find it named here
  // rather than only in the role table. `writes` carries the MUTATION BIT: it is what stops the
  // implementer's and the reviewer's sets from being the same surface. Same tokens, different bit.
  planner: {
    slots: ["ticket", "plan", "item:"],
    kinds: ["ticket", "plan", "work_item"],
    mounts: [], writes: ["plan", "work_item"],
    commit_msg: false, isolated: "none",
    why_withheld: {
      artifact: "a planner that reads the code starts writing the code",
      critique: "verdicts are not inputs to planning",
      decision: "the controller's, and reading it invites arguing with it",
    },
  },
  worker: {
    slots: ["ticket", "item:", "artifact:"],
    kinds: ["ticket", "work_item", "artifact", "trace", "repro"],
    mounts: ["tests"],
    // READ-WRITE on the artifact, under a lease. This is the bit.
    writes: ["artifact", "trace", "repro", "work_item"],
    artifact_access: "leased",
    commit_msg: false, isolated: "own",
    why_withheld: {
      critique: "a worker acting on its own reviews turns review into negotiation",
      hypothesis: "sibling debate is not input to the work",
      decision: "the decision is the controller's, and reading it invites arguing with it",
      plan: "the supervisor's framing; a fat brief makes a worker restate the plan rather than contradict it",
    },
  },
  checker: {
    // Admits `artifact` because that is WHAT IT ACKS: approvalFor hashes links.bytes, so if the
    // checkout could not name the artifact, REVIEW would have to reach the bytes by a side channel --
    // which is exactly how it went blind once. Frozen, not leased: it reads the candidate, never edits it.
    slots: ["ticket", "artifact:"],
    kinds: ["ticket", "artifact", "trace", "repro"],
    mounts: ["tests"], writes: ["critique"],
    artifact_access: "frozen",
    commit_msg: false, isolated: "none",
    why_withheld: {
      work_item: "the assignment the maker was handed; judging the bytes against the ticket keeps the " +
        "review independent of the mandate",
      critique: "another reviewer's verdict anchors this one; independence is the point of a second checker",
      hypothesis: "the producer's reasoning about its own patch is what a checker must not read",
      plan: "as above, one layer out",
      decision: "a decision already taken tells the checker which answer is wanted",
    },
  },
  // Explorer's checkout. Deliberately thinner than the debater's: it may not MINT search or repro
  // objects, because SCOUT_AFTER_BOARD makes orphan evidence illegal once a board exists and a
  // post-board explorer that could write them would be a scout under a chain role's name.
  isolated_reader: {
    slots: ["ticket"], kinds: ["ticket"], mounts: [], writes: [],
    commit_msg: false, isolated: "own",
    why_withheld: {
      hypothesis: "a peer's stance is the whole thing this checkout exists to withhold",
      artifact: "a reader arguing about code it can read stops arguing about the question",
      search: "minting evidence after the board exists is scouting, and scouting is intake",
      repro: "as above", trace: "as above",
      work_item: "not this seat's work",
      critique: "a peer's verdict",
      decision: "the question is open; a provisional answer collapses the disagreement",
    },
  },
  isolated_debater: {
    slots: ["ticket", "hypothesis:"],
    kinds: ["ticket", "hypothesis", "repro", "search", "trace"],
    mounts: [], writes: ["hypothesis"],
    commit_msg: false, isolated: "own",
    why_withheld: {
      artifact: "a debater arguing about code it can read stops arguing about the question",
      critique: "a peer's verdict is withheld here",
      work_item: "not this seat's work",
      decision: "the question is open; a provisional answer collapses the disagreement",
      plan: "not this seat's concern",
    },
  },
  synthesizer: {
    // Sees the isolated forks -- that is what it is for, which is also why it may not be a participant.
    //
    // It admits `decision` because a recorded SPLIT is real context: it says the question is genuinely
    // open. But a decision on the question under synthesis is the answer, and reading it is the
    // anchoring this whole layer exists to prevent. So project() withholds `decision:<question>` when a
    // question is named, and admits every other decision. Scoped, not blanket, and not silent.
    slots: ["ticket", "hypothesis:", "decision:"],
    kinds: ["ticket", "hypothesis", "decision", "repro", "search", "trace"],
    mounts: ["tests"], writes: ["hypothesis"],
    commit_msg: false, isolated: "all",
    why_withheld: {
      artifact: "the synthesis is about the claims, not the code",
      critique: "verdicts on code are a different question",
      work_item: "not this seat's work", plan: "not this seat's concern",
    },
  },
  // THE CONTROLLER'S VIEW, and no role sits on it. boardState/schedule read the board this way; a seat
  // pointed here would inherit the controller's checkout, which is how the planner ended up able to
  // name artifacts, critiques and decisions its own role never asked for.
  supervisor: {
    controller_only: true,
    slots: ["ticket", "plan", "item:", "artifact:", "critique:", "decision:"],
    kinds: ["ticket", "plan", "work_item", "artifact", "critique", "decision"],
    mounts: ["tests"], writes: [],
    commit_msg: true, isolated: "none",
    why_withheld: { hypothesis: "raw debate; the controller schedules from states and verdicts" },
  },
};

/**
 * Roles that run BEFORE a board exists and therefore have no projection.
 *
 * A projection is a sparse checkout of a commit. At `intake` there is no commit, so a scout has
 * nothing to check out and mapping it to one would be a lie that reads as coverage. Its input comes
 * from outside the board; its output enters as LINEAGE -- the ticket cites the scout's evidence by
 * cid -- not as a slot anybody merged. Exempt from the inclusion law in BOTH directions.
 */
export const PRE_BOARD_ROLES = new Set(["scout"]);

/**
 * The PACK: everything a role's occupant may read, from both layers at once.
 *
 * Three things get glued together and must not be:
 *
 *   QUOTA   the subscription a seat spends from. Two seats on one pool hurt each other's latency.
 *           That is OPS -- a retry class on the adapter -- and it is what a 429 demonstrates.
 *   PACK    what the occupant may read. If two seats share it they are one mind however the role
 *           string differs, and THAT is the configuration that found nothing here.
 *   LAB     the vendor id `approvalFor` compares for review isolation. Maker and checker must differ
 *           by LAB, never merely by model name.
 *
 * Same contractor in two chairs is legal. Same pack in two chairs is the bug.
 */
export function packOf(role, roles) {
  const spec = roles[role];
  if (!spec) throw new Error(`packOf: unknown role "${role}"`);
  const projection = PROJECTION_FOR_ROLE[role] ?? null;
  const p = projection ? PROJECTIONS[projection] : null;
  return {
    role, projection,
    board: [...spec.context].sort(),
    session: [...(spec.session ?? [])].sort(),
    kinds: p ? [...p.kinds].sort() : [],
    mounts: p ? [...(p.mounts ?? [])].sort() : [],
    writes: p ? [...(p.writes ?? [])].sort() : [],
    artifact_access: p?.artifact_access ?? null,
    commit_msg: p?.commit_msg ?? false,
    isolated: p?.isolated ?? null,
    // The pool identity is the PROJECTION NAME. Two roles on one projection drink from one checkout,
    // whatever their instruction strings say and whichever labs occupy them. Session tokens are
    // deliberately excluded: two seats each with their own history are two diaries, not one pool.
    get pool() { return projection; },
  };
}

/**
 * An ACK is not a board object you ship as work. A reviewer produces one, so `critique` is writable on
 * the checker without being one of the kinds it reads -- declared here rather than left as an implicit
 * hole in the produce law.
 */
export const ACK_KINDS = new Set(["critique"]);

/** What a projection can satisfy: its stored kinds plus its derived mounts. */
export const admits = projection => {
  const p = PROJECTIONS[projection];
  if (!p) throw new Error(`admits: unknown projection "${projection}"`);
  return new Set([...p.kinds, ...(p.mounts ?? [])]);
};

export const PROJECTION_FOR_ROLE = {
  planner: "planner", implementer: "worker", reviewer: "checker",
  explorer: "isolated_reader", advocate: "isolated_debater", judge: "synthesizer",
};

const matches = (slot, prefixes) => prefixes.some(p => slot === p || (p.endsWith(":") && slot.startsWith(p)));

/**
 * Read a sparse checkout.
 *
 * `reader` is the seat identity, used only to decide which isolated entries are its own.
 * `item` narrows the worker projection to one work item, since "this item" is the whole point of it.
 */
export function project(store, commitCid, projection, { reader = null, item = null, isoCommits = {}, question = null } = {}) {
  const spec = PROJECTIONS[projection];
  if (!spec) throw new Error(`project: unknown projection "${projection}"`);
  const slots = treeSlots(store, commitCid);
  const slice = { projection, root: commitCid ? shortCid(commitCid) : null, slots: {} };
  const withheld = [];

  for (const [slot, cid] of Object.entries(slots)) {
    const entry = store.get(cid);
    // The SUBSTANTIVE reason wins over the structural one. A projection withholds a critique both
    // because the slot class is out of scope and because reading a peer's verdict anchors this one;
    // reporting only the first tells a reader what the rule is and not why it exists, and this
    // `withheld` list is the only place the policy explains itself to whoever has to trust it.
    const reason = spec.why_withheld?.[entry.kind];
    if (!matches(slot, spec.slots) || !spec.kinds.includes(entry.kind)) {
      withheld.push({ slot, kind: entry.kind,
        why: reason ?? `${entry.kind} at "${slot}" is not in the ${projection} checkout` });
      continue;
    }
    if (entry.visibility === "isolated") {
      const own = reader && entry.author.seat_id === reader.seat_id;
      if (spec.isolated === "none" || (spec.isolated === "own" && !own)) {
        withheld.push({ slot, why: "isolated entry belonging to another seat" });
        continue;
      }
    }
    if (entry.visibility === "supervisor" && projection !== "supervisor") {
      withheld.push({ slot, why: "supervisor-only entry" });
      continue;
    }
    // The decision on the question being synthesised is the answer to it.
    if (question && slot === `decision:${question}`) {
      withheld.push({ slot, kind: entry.kind,
        why: `the decision on "${question}" is the answer to the question under synthesis` });
      continue;
    }
    if (item && slot.startsWith("item:") && slot !== `item:${item}`) {
      withheld.push({ slot, why: `another seat's work item (this checkout is scoped to ${item})` });
      continue;
    }
    slice.slots[slot] = { cid, kind: entry.kind, payload: entry.payload, author: entry.author, links: entry.links };
  }

  // Accumulative entries live in commit records rather than tree slots. Account for each cid once,
  // newest commit first, using the same kind ceiling and visibility policy as the slot checkout.
  if (commitCid != null) {
    slice.records = [];
    const seen = new Set();
    const { commits } = history(store, commitCid);
    for (const h of commits) {
      const commit = typeof h === "string" ? h : h.cid;
      for (const cid of store.get(commit).records ?? []) {
        if (seen.has(cid)) continue;
        seen.add(cid);
        const entry = store.get(cid);
        if (KINDS[entry.kind]?.slotted !== false) continue;
        const own = reader && entry.author.seat_id === reader.seat_id;
        const visible =
          (entry.visibility !== "isolated" ||
            spec.isolated === "all" || (spec.isolated === "own" && own)) &&
          (entry.visibility !== "supervisor" || projection === "supervisor");
        if (!spec.kinds.includes(entry.kind) || !visible) {
          withheld.push({
            slot: "(record)", cid, kind: entry.kind,
            why: spec.why_withheld?.[entry.kind] ??
              `${entry.kind} record is not admitted to the ${projection} checkout.`,
          });
          continue;
        }
        slice.records.push({
          cid, kind: entry.kind, payload: entry.payload,
          author: entry.author, links: entry.links, commit,
        });
      }
    }
  }

  // Prior BLOCK findings against EARLIER revisions of the same slot travel with a checker, so a
  // re-review knows what was already blocking. Verdicts on the CURRENT bytes never do -- that is the
  // anchoring this projection exists to prevent, and the distinction is the target cid.
  if (projection === "checker" && commitCid) {
    slice.prior_blocks = [];
    for (const slot of Object.keys(slice.slots).filter(s2 => s2.startsWith("artifact:"))) {
      const currentBytes = slice.slots[slot].links?.bytes;
      for (const c of entriesOfKind(store, commitCid, "critique")) {
        if (c.payload.target?.slot !== slot.replace("artifact:", "")) continue;
        if (c.links.target === currentBytes) continue;          // this revision: withheld
        for (const f of c.payload.findings.filter(f2 => f2.severity === "block")) {
          slice.prior_blocks.push({ slot, rev: c.payload.target.rev, loc: f.loc ?? null, note: f.note });
        }
      }
    }
  }

  if (spec.commit_msg && commitCid) slice.commit_msg = store.get(commitCid).msg;
  else if (commitCid) withheld.push({ slot: "(commit message)", why: "the maker's defense of its own work" });

  // The ticket's acceptance criteria travel with every projection that can see the ticket at all:
  // a seat that cannot see what "done" means can only be graded by an opinion.
  const ticket = slice.slots.ticket?.payload;
  if (ticket) slice.acceptance = ticket.acceptance;

  // Isolated forks are separate refs, so a synthesizer reaches them by being handed their commits
  // rather than by finding them on main. Nothing on main links them.
  if (spec.isolated === "all") {
    slice.isolated = {};
    for (const [name, cid] of Object.entries(isoCommits)) {
      // Same allowlist as the main checkout: a fork inherits the board head it branched from, so
      // without the kind filter the "forks" would also hand over a copy of the ticket per fork.
      slice.isolated[name] = Object.fromEntries(Object.entries(treeSlots(store, cid))
        .map(([s, c]) => [s, { cid: c, ...store.get(c) }])
        .filter(([s, e]) => matches(s, spec.slots) && spec.kinds.includes(e.kind) && e.kind !== "ticket"));
    }
  }
  return { slice, withheld };
}
