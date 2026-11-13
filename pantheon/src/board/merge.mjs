// Typed merge. The resolver is declared per slot class and never "a model summarises the thread".
//
//   ff / ours     linear work on one slot
//   union         evidence and isolated hypotheses -- carried by the merge commit's second parent,
//                 so nothing has to be chosen and nothing is lost
//   slot-wise     three-way per slot: whoever moved it since the base wins; both moved is a conflict
//   bound-review  an artifact slot moves only if a critique OF THAT CID approves, or a human does
//   record-split  a decision slot in conflict is recorded as a split, not awarded to a vendor
//
// THE HOLE THIS CLOSES, which a fast-forward would otherwise walk straight through: bound-review is
// evaluated on EVERY merge including a fast-forward. If linear history skipped the check, "an
// artifact moves only with an approving critique of that exact cid" would hold for merges and not
// for the common case, which is the one that ships.
import { parseRef } from "./refs.mjs";
import { treeSlots, putTree, putCommit, changedSlots, entriesOfKind } from "./dag.mjs";
import { shortCid } from "./canon.mjs";

import { POLICIES, DEFAULT_POLICY, policyFor } from "./policy.mjs";
export { POLICIES, DEFAULT_POLICY, policyFor };

export function ancestors(store, commitCid, { limit = 2000 } = {}) {
  const seen = new Map();                        // cid -> distance
  if (!commitCid) return seen;
  const queue = [[commitCid, 0]];
  while (queue.length && seen.size < limit) {
    const [cid, d] = queue.shift();
    if (seen.has(cid)) { if (seen.get(cid) > d) seen.set(cid, d); continue; }
    seen.set(cid, d);
    for (const p of store.get(cid).parents) queue.push([p, d + 1]);
  }
  return seen;
}

/**
 * All MAXIMAL common ancestors: the common ancestors that are not themselves ancestors of another
 * common ancestor. Ordered nearest-to-`a` first.
 *
 * Taking "nearest common ancestor by distance" is wrong and fails quietly. After a branch is merged
 * into the board and then extended, the board commit and the extension share two ancestors AT THE
 * SAME DISTANCE -- the merged branch tip and the older board head. Picking the older one makes the
 * three-way see both sides as having moved, so a clean take is reported as a conflict; picking it the
 * other way round could make a real conflict look like a clean take. Neither is a crash, which is why
 * this has to be computed rather than approximated.
 */
export function mergeBases(store, a, b) {
  if (!a || !b) return [];
  const A = ancestors(store, a), B = ancestors(store, b);
  const common = [...A.keys()].filter(c => B.has(c));
  if (common.length <= 1) return common;
  const dominated = new Set();
  for (const d of common) {
    for (const [anc] of ancestors(store, d)) if (anc !== d && common.includes(anc)) dominated.add(anc);
  }
  return common.filter(c => !dominated.has(c)).sort((x, y) => A.get(x) - A.get(y));
}

/** The base a three-way merge uses. null when the two histories are unrelated. */
export const mergeBase = (store, a, b) => mergeBases(store, a, b)[0] ?? null;

/**
 * Does an approving critique exist for exactly these bytes, from a different lab than the maker?
 *
 * The different-lab clause was missing here, and bound-review would have shipped on an approval from
 * the producer's own vendor -- the producer grading itself with an extra step. Law 7's REVIEW gate and
 * this policy now read the same rule, so they cannot disagree about what an ack is.
 *
 * `artifactEntry` must be the real entry, not a stub carrying only `links.bytes`: the maker's vendor
 * is what the clause is about, and a stub silently made the check unenforceable.
 */
export function approvalFor(store, fromCommit, artifactEntry) {
  const target = artifactEntry.links.bytes;
  const maker = artifactEntry.author?.vendor ?? null;
  const critiques = entriesOfKind(store, fromCommit, "critique")
    .filter(c => c.links.target === target);
  const approvals = critiques.filter(c => c.payload.verdict === "approve");
  const blocks = critiques.filter(c => c.payload.findings.some(f => f.severity === "block"));
  const crossLab = approvals.filter(c => c.author.vendor !== maker);
  const sameLab = approvals.filter(c => c.author.vendor === maker);
  return {
    ok: crossLab.length > 0 && blocks.length === 0,
    target, maker, approvals: crossLab.length, same_lab: sameLab.length,
    blocks: blocks.length, humans: crossLab.filter(c => c.author.vendor === "human").length,
    critiques: critiques.length,
    why: critiques.length === 0
      ? `no critique is bound to ${shortCid(target)}; a review of an earlier revision does not carry forward`
      : blocks.length ? `${blocks.length} blocking finding(s) against ${shortCid(target)}`
      : crossLab.length === 0 && sameLab.length
        ? `the only approval of ${shortCid(target)} is from ${maker}, the maker's own lab`
        : crossLab.length === 0 ? `${critiques.length} critique(s) of ${shortCid(target)}, none approving` : null,
  };
}

/**
 * Plan a merge of `from` into `into`. Pure: decides every slot and explains each one, and does not
 * touch refs. `apply` then writes the commit if nothing blocked.
 */
/**
 * `only` restricts a merge to a set of slot prefixes, and slots outside it are left as ours.
 *
 * This exists because of a smell the lifecycle driver exposed: a routine "carry the verdict" merge
 * moved the ARTIFACT too, the moment bound-review happened to be satisfiable, so the shipping ref
 * advanced without the controller ever deciding to integrate. The gate was not bypassed -- it was
 * satisfied early -- which is worse, because the log then shows a ship nobody scheduled. Collecting
 * verdicts and shipping code are different acts and a merge has to be able to say which one it is.
 */
export function planMerge({ store, into, from, table = DEFAULT_POLICY, only = null }) {
  const bases = mergeBases(store, into, from);
  const base = bases[0] ?? null;
  const O = treeSlots(store, base), A = treeSlots(store, into), B = treeSlots(store, from);
  const names = [...new Set([...Object.keys(A), ...Object.keys(B)])].sort();
  const decisions = [];
  const slots = { ...A };

  for (const slot of names) {
    const a = A[slot], b = B[slot], o = O[slot];
    const policy = policyFor(slot, table);
    if (a === b) { decisions.push({ slot, policy, action: "unchanged" }); continue; }
    if (only && !only.some(p => slot === p || (p.endsWith(":") && slot.startsWith(p)))) {
      decisions.push({ slot, policy, action: "out-of-scope", why: `this merge carries ${only.join(", ")} only` });
      continue;
    }

    const take = () => {
      if (policy === "bound-review") {
        const entry = store.get(b);
        const ap = approvalFor(store, from, entry);
        if (!ap.ok) return { action: "blocked", why: `bound-review: ${ap.why}`, review: ap };
        return { action: "take-theirs", why: `bound-review satisfied: ${ap.approvals} approval(s) of ${shortCid(ap.target)}, 0 blocking`, review: ap };
      }
      if (policy === "record-split") {
        return { action: "blocked", why: `record-split: ${slot} differs and no vendor may be awarded it; the controller records a decision` };
      }
      return { action: "take-theirs", why: `${policy}: theirs moved since the base` };
    };

    if (b === undefined) { decisions.push({ slot, policy, action: "keep-ours", why: "not present on the incoming side" }); continue; }
    if (a === undefined || o === a) {
      const r = take();
      decisions.push({ slot, policy, ...r });
      if (r.action === "take-theirs") slots[slot] = b;
      continue;
    }
    if (o === b) { decisions.push({ slot, policy, action: "keep-ours", why: "ours moved since the base; theirs did not" }); continue; }
    // Both moved. Even bound-review does not silently pick a side here.
    decisions.push({ slot, policy, action: "conflict",
      why: `both sides moved ${slot} since ${base ? shortCid(base) : "(no common ancestor)"}: ours ${shortCid(a)}, theirs ${shortCid(b)}` });
  }

  const blocked = decisions.filter(d => d.action === "blocked" || d.action === "conflict");
  return {
    base, into, from, decisions, blocked,
    // More than one maximal base is a criss-cross history. The first is used and the fact is
    // reported, because a merge that silently picked one of several bases is not reviewable.
    bases, ambiguousBase: bases.length > 1,
    ok: blocked.length === 0,
    fastForward: base === into,
    slots,
    // Recorded on the merge itself so a reader does not have to recompute why a slot stayed put.
    why: blocked.length ? blocked.map(b => `${b.slot}: ${b.why}`).join(" | ") : null,
  };
}

/** Apply a plan: a real merge commit with BOTH parents, so union is structural rather than copied. */
export async function merge({ store, refs, runtime = null, into, from, author, msg = "", table = DEFAULT_POLICY, allowPartial = false, only = null }) {
  const intoCid = refs.resolve(into), fromCid = refs.resolve(from);
  if (!fromCid) return { ok: false, code: "NO_SOURCE", why: `${from} does not exist` };
  const plan = planMerge({ store, into: intoCid, from: fromCid, table, only });
  if (!plan.ok && !allowPartial) return { ok: false, code: "MERGE_BLOCKED", why: plan.why, plan };

  // THE BACK DOOR, CLOSED. merge() onto a board ref could move an artifact slot with nothing but
  // bound-review's cross-lab approval -- no ACTOR, no TESTS, no LEASE -- and the demo script shipped
  // through exactly this call. "One function is the right object": a slot whose movement requires
  // review is a slot only ship() may land on the shipping ref, and that is decided by the DEFAULT
  // policy table, not by whatever `table` the caller passed, or the caller could reclassify its way in.
  // Carry-merges of plan/item/critique slots stay legal; they are what the controller uses merge() for.
  let intoCls = null;
  try { intoCls = parseRef(into).cls; } catch { /* an unparseable name fails at swap */ }
  if (intoCls === "board") {
    const before = intoCid ? treeSlots(store, intoCid) : {};
    const shipOnly = Object.entries(plan.slots)
      .filter(([slot, cid]) => before[slot] !== cid && policyFor(slot, DEFAULT_POLICY) === "bound-review")
      .map(([slot]) => slot);
    if (shipOnly.length) {
      return { ok: false, code: "SHIP_ONLY", plan,
        why: `${shipOnly.join(", ")} may not move onto ${into} through merge(); a reviewed slot lands on the ` +
          `shipping ref only through ship(), which evaluates every gate. Use ship({ ref: "${into}", from: "${from}" })` };
    }
  }

  const tree = putTree(store, plan.slots);
  const parents = [...new Set([intoCid, fromCid].filter(Boolean))];
  // records is empty: a merge introduces no new entry, it only re-binds slots. Everything it brings
  // across is already reachable through the second parent.
  const commit = putCommit(store, { parents, tree, author, lease_gen: null, records: [],
    msg: msg || `merge ${from} into ${into}${plan.blocked.length ? ` (${plan.blocked.length} slot(s) withheld)` : ""}` });
  const changed = changedSlots(store, intoCid, commit);
  const swap = await refs.swap({ name: into, expected: intoCid, next: commit, author, changedSlots: changed, msg });
  if (!swap.ok) return { ok: false, ...swap, plan, commit };
  if (runtime) { try { runtime.recordSpend({ commit, seat: author.seat_id ?? author.vendor, vendor: author.vendor, turns: 0 }); } catch { /* side log */ } }
  return { ok: true, commit, plan, changed, withheld: plan.blocked, partial: !plan.ok };
}
