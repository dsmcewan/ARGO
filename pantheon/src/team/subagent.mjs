// Subagents: disposable hands, not a second teammate.
//
// There are two different meanings of "shared" and conflating them is how a subagent stops being
// useful. A subagent shares the HOUSE, not the HEAD.
//
//   SHARED           the working tree, the tools, the credentials, and the PARENT'S LEASE. It writes
//                    under the lock its parent holds, into the same artifact.
//   NOT SHARED       the parent's transcript. It gets a written brief -- task, files, done check --
//                    and its own short context window, and it reports a result rather than a novel.
//   SHARED, BADLY    the whole conversation stuffed into the child. Then it is not a subagent, it is
//                    the parent talking to itself with extra tokens, and its critique dies the same
//                    way a shared-transcript debate does.
//
// The consequence is the useful part: because a subagent cannot fork the design and cannot take the
// gate, it is safe to give it the files. If you need an INDEPENDENT STORY of the ticket, that is not a
// subagent -- that is another chair with a different pack, `check@review` rather than a child of the
// maker.
import { ROSTER, PODS, podOf } from "./roster.mjs";
import { DEPTH_LIMIT } from "../role/seating.mjs";

export const SHARED = {
  tree: "the same working tree; a subagent's edits are its parent's edits",
  tools: "the parent's tool grants, unchanged",
  credentials: "the parent's credentials and therefore its quota pool",
  lease: "the PARENT'S lease. A subagent never takes one of its own -- that would make two writers of " +
    "one name, which is the thing the lease exists to prevent",
};

export const NOT_SHARED = {
  transcript: "the parent's conversation. A brief instead: task, files, done check",
  window: "its own short context window, which is what makes its read of the files independent",
  gate: "it cannot pass or fail a gate; a verdict needs a chair, not a child",
  story: "it has no independent account of the ticket, by design",
};

export class SubagentViolation extends Error {}
const bad = m => { throw new SubagentViolation(m); };

/**
 * Compose a subagent brief. Refuses every way the contract above gets broken.
 *
 * `parent` is an occupancy from roster.occupy() -- WITH `lease` and `files` supplied to occupy(), if the
 * child is to touch files. A bare occupancy carries neither, and this function refuses a file-bearing
 * child whose parent holds no lease; the earlier docstring implied any occupancy would do, and every
 * such call was refused with a message that did not say what was missing.
 */
export function subagentBrief({ parent, task, files = [], done_check, depth = 1, transcript, context = {} }) {
  if (!parent?.address) bad("subagentBrief: a subagent needs a parent occupancy");
  if (!ROSTER[parent.address]) bad(`"${parent.address}" is not in the roster`);
  if (!task) bad("subagentBrief: `task` is required — a child with no task is a second opinion, and that needs a chair");
  if (!done_check) {
    bad("subagentBrief: `done_check` is required. A subagent that cannot be told whether it finished " +
      "reports a novel, and the parent grades prose instead of a result");
  }
  if (transcript !== undefined) {
    bad("subagentBrief: the parent's transcript must not be passed. That is the bad sense of shared: " +
      "the child becomes the parent talking to itself with extra tokens, and its critique dies the same " +
      "way a shared-transcript debate does");
  }
  for (const k of ["supervisor_narration", "peer_defense"]) {
    if (k in context) bad(`subagentBrief: a brief may not carry ${k}`);
  }
  if (depth > DEPTH_LIMIT) {
    bad(`subagentBrief: depth ${depth} exceeds DEPTH_LIMIT ${DEPTH_LIMIT}. An unbounded tree is ` +
      `discovered as a bill, not as a design`);
  }

  const pod = podOf(parent.address);
  if (files.length) {
    if (!PODS[pod].writes_tree) {
      bad(`${parent.address} is in the "${pod}" pod, which does not write the tree, so its subagent has ` +
        `no files to be given`);
    }
    if (!parent.lease?.resource) {
      bad(`${parent.address} holds no lease; a subagent writes UNDER its parent's lease and there is ` +
        `none to write under. Pass \`lease\` (and \`files\`) to roster.occupy() so the occupancy carries them`);
    }
    const claimed = parent.files ?? null;
    if (claimed) {
      const outside = files.filter(f => !claimed.includes(f));
      if (outside.length) {
        bad(`subagent would touch ${outside.join(", ")}, outside what ${parent.address} claimed ` +
          `(${claimed.join(", ")}). A child cannot widen its parent's write set`);
      }
    }
  }

  return {
    parent: { address: parent.address, vendor: parent.vendor, gen: parent.gen },
    // Inherited, not acquired. Named so a reader can see the child is inside the parent's critical section.
    inherits: { lease: parent.lease ?? null, pool: parent.vendor, tree: parent.cwd },
    depth, task, files, done_check, context,
    reports: "a result: what it changed, what it ran, and the exit code. Not a narrative",
    may_not: Object.keys(NOT_SHARED),
    lanes: 0,
    why_lanes: `0 new lanes: this child spends from ${parent.vendor}'s pool, the same pool its parent ` +
      `spends from. Depth buys context isolation, not throughput`,
  };
}

/**
 * A subagent may not be the checker. Separate from the brief because it is the mistake most worth
 * naming: a maker's child reading the maker's diff is the maker grading itself with extra steps.
 */
// Word-bounded, because the first form matched substrings: "checkout the feature branch" and "compute
// the checksum" were refused as verdicts. This is a heuristic over a label and says so; it catches a
// purpose that NAMES a verdict, not one that hides it.
// Closed list, word-bounded. It missed the judge role's own charter verbs ("decide", "judge") until the
// 2026-09-27 re-review ran them through it; a verdict phrased as any of these is a verdict.
const VERDICT_WORDS = /\b(review|critique|check|verify|gate|approve|reject|judge|decide|grade|score|assess|evaluate|adjudicate|accept|sign[- ]?off|rule on)\b/i;

export function assertNotTheChecker({ parent, purpose }) {
  if (VERDICT_WORDS.test(String(purpose))) {
    bad(`a subagent of ${parent?.address ?? "a seat"} may not ${purpose}: a verdict needs a chair with ` +
      `its own pack, not a child sharing its parent's lease and pool. That is check@review, not a ` +
      `child of the maker`);
  }
  return true;
}
