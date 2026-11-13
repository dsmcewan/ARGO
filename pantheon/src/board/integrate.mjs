// Ship is a controller TRANSACTION, not a role.
//
// LAW 6 (negative): no chair ships. Every seated role, lead included, is refused.
// LAW 7 (positive): the controller ships, and only when every gate holds.
//
// They are one function, because that is what keeps them honest. Law 6 is the ACTOR gate of law 7,
// so there is no separate "ship" path that a chair could be granted later: refusing a chair and
// admitting the controller are the same code reading the same field.
//
// 6 WITHOUT 7 IS AN UNREACHABLE DONE. If the only rule is "every chair refuses", the suite has no
// green ship, and a suite with no green ship gets fixed by weakening 6 or by adding a "lead ships"
// exception -- which puts a chair back on the merge button. The exemption has to exist, be named, and
// be tested BOTH ways: one happy path that passes, and one refusal per gate that cannot.
//
// 7 WITHOUT 6 IS A CHAIR THAT GROWS A MERGE TOOL.
//
// Output is exactly one board commit, or a no-op refusal that leaves HEAD where it was. There is no
// partial ship.
import { treeSlots, changedSlots, putTree, putCommit, entriesOfKind } from "./dag.mjs";
import { planMerge, mergeBase, DEFAULT_POLICY } from "./merge.mjs";
import { boardState, boardStatus, acceptanceStatus } from "./controller.mjs";
import { parseRef } from "./refs.mjs";
import { authorClassOf, VENDORS } from "./schema.mjs";
import { shortCid } from "./canon.mjs";

/** Order matters only for which gate is reported as `refused`; every gate is evaluated. */
export const GATES = ["ACTOR", "TARGET", "TICKET", "GRAFT", "LEASE", "REVIEW", "TESTS", "MERGE"];

/**
 * The policy a law-7 ship merges under: bound-review is replaced by slot-wise for artifact slots.
 *
 * NOT a relaxation. In a ship, the REVIEW gate below IS bound-review, evaluated on the real artifact
 * entry with the different-lab clause. Leaving bound-review inside the merge as well made the outer
 * gate BLIND: the merge refused the artifact slot first, so `moving` came back empty and REVIEW
 * reported "nothing to ship" instead of "no ack is bound to these bytes". A gate whose input has
 * already been filtered by the thing it is checking cannot fail for the right reason.
 *
 * Ordinary merges keep DEFAULT_POLICY, where bound-review is the only gate there is.
 */
export const SHIP_POLICY = DEFAULT_POLICY.map(([prefix, policy]) =>
  [prefix, prefix === "artifact:" ? "slot-wise" : policy]);

/**
 * Is there an approving ack on exactly these bytes, from a different lab than the maker?
 *
 * The different-lab part is not decoration. An approval from the producer's own vendor is the
 * producer grading itself with an extra step, and `approvalFor` in merge.mjs did not check it -- so
 * bound-review would have shipped on a same-lab ack. Both gates now read this one rule.
 */
export function reviewAck(store, fromCommit, artifactEntry) {
  const target = artifactEntry?.links?.bytes;
  const maker = artifactEntry?.author?.vendor ?? null;
  if (!target) return { ok: false, why: "the artifact has no bytes link, so nothing can be bound to it" };
  const bound = entriesOfKind(store, fromCommit, "critique").filter(c => c.links.target === target);
  const blocks = bound.filter(c => c.payload.findings.some(f => f.severity === "block"));
  const approvals = bound.filter(c => c.payload.verdict === "approve");
  const sameLab = approvals.filter(c => c.author.vendor === maker);
  const crossLab = approvals.filter(c => c.author.vendor !== maker);
  return {
    ok: crossLab.length > 0 && blocks.length === 0,
    target, maker, bound: bound.length,
    acks: crossLab.map(c => ({ vendor: c.author.vendor, cid: c.cid })),
    same_lab: sameLab.map(c => c.author.vendor),
    blocks: blocks.length,
    why: blocks.length ? `${blocks.length} blocking finding(s) on ${shortCid(target)}`
      : crossLab.length ? null
      : sameLab.length ? `the only approval of ${shortCid(target)} is from ${sameLab[0].author.vendor}, the maker's own lab`
      : bound.length ? `${bound.length} critique(s) of ${shortCid(target)}, none approving`
      : `no ack is bound to ${shortCid(target)}; a review of another revision does not carry forward`,
  };
}

/** Every active lease that would still be held over what this ship touches. */
function heldLeases(runtime, resources, now = Date.now()) {
  if (!runtime) return [];
  const table = runtime.leases();
  return resources.filter(r => {
    const l = table[r];
    return l && l.state === "active" && Date.parse(l.expires_at) > now;
  }).map(r => ({ resource: r, holder: table[r].holder.seat_id, gen: table[r].gen }));
}

/**
 * The transaction. Returns one commit or one refusal; never a partial.
 *
 * `actor`   controller or human. A chair is refused here, which IS law 6.
 * `ref`     must be a board ref.
 * `from`    the branch offering the work. Must descend from the board head unless grafted.
 * `graft`   commits explicitly admitted as parents despite having no common ancestor. Scout cids stay
 *           LINEAGE -- cited by the ticket -- and never become ancestors by accident.
 */
export async function ship({
  store, refs, runtime = null, ref, from, actor, graft = [], table = SHIP_POLICY, now = Date.now(),
  dryRun = false,
}) {
  const gates = [];
  const gate = (name, ok, why, extra) => { gates.push({ gate: name, ok, why: ok ? null : why, ...extra }); return ok; };

  // --- ACTOR (law 6). Evaluated first and with no state read, so a chair's attempt cannot have a
  // side effect even in principle. ---
  const cls = authorClassOf(actor ?? {});
  gate("ACTOR", cls === "controller" || cls === "human",
    actor?.seat_id
      ? `"${actor.seat_id}" is a chair; ship is a controller transaction, not a role (law 6)`
      : `actor must be the controller or a human break-glass, got "${actor?.vendor}" (law 6)`,
    { actor_class: cls });
  // A human/controller carrying a seat id is a chair wearing the controller's coat.
  if (cls !== "seat" && actor?.seat_id) {
    gates[0].ok = false;
    gates[0].why = `actor claims vendor "${actor.vendor}" but carries seat_id "${actor.seat_id}": a chair wearing the controller's coat`;
  }

  // --- TARGET ---
  let cls_ref = null;
  try { cls_ref = parseRef(ref).cls; } catch (e) { /* reported below */ }
  gate("TARGET", cls_ref === "board",
    `integrate target must be a board ref, got ${cls_ref ? `refs/${cls_ref}/*` : `"${ref}"`}`, { ref_class: cls_ref });

  const head = (() => { try { return refs.resolve(ref); } catch { return null; } })();
  const fromCid = (() => { try { return refs.resolve(from); } catch { return null; } })();

  // --- TICKET: on the board, not intake, not a bare question ---
  let status = "intake", state = null;
  if (head) {
    state = boardState({ store, refs, runtime, ref });
    status = boardStatus({ store, state }).status;
  }
  gate("TICKET", Boolean(state?.ticket) && status !== "intake",
    state?.ticket ? `board status is ${status}` : "no ticket on the board", { status });

  // --- GRAFT: the source must descend from the board head, or be named explicitly ---
  const grafted = graft.includes(fromCid);
  const base = head && fromCid ? mergeBase(store, head, fromCid) : null;
  gate("GRAFT", Boolean(fromCid) && (base !== null || grafted),
    !fromCid ? `${from} resolves to nothing`
      : `${from} shares no ancestor with ${ref}: it is a separate root (a scout's orphan, most likely). ` +
        `Scout cids stay lineage; pass graft:["${fromCid}"] to make it an ancestor deliberately`,
    { base: base ? shortCid(base) : null, grafted });

  // --- THE CANDIDATE SET, computed ONCE from the trees ---
  //
  // Every later gate reads THIS. Not each other's survivors. The REVIEW blindness was exactly that
  // mistake: REVIEW consumed planMerge's already-bound set, so bound-review had filtered the evidence
  // and REVIEW could only grade the residue -- it said "nothing to ship" where the truth was "no ack
  // on these bytes". Same family as synthesize counting isolated refs: a predicate reading a
  // post-filtered view, then naming the empty set as a success-shaped failure.
  //
  // So: gates share RULES (approvalFor, acceptanceStatus) and never share leftovers. If a future gate
  // starts from another gate's output, the "nothing to ship" class is back, and the test below is what
  // notices.
  const ours = head ? treeSlots(store, head) : {};
  const theirs = fromCid ? treeSlots(store, fromCid) : {};
  const artifacts = Object.entries(theirs)
    .filter(([slot, cid]) => slot.startsWith("artifact:") && ours[slot] !== cid)
    .map(([slot, cid]) => ({ slot, cid, entry: store.get(cid) }));
  const candidates = artifacts.map(a => a.slot);

  // --- LEASE: clear. A ship while the maker still holds its lease races the maker. ---
  const resources = ["tree", ...artifacts.map(a => a.slot), ...(state?.items ?? []).map(i => i.slot)];
  const held = heldLeases(runtime, [...new Set(resources)], now);
  gate("LEASE", held.length === 0,
    `still leased: ${held.map(h => `${h.resource} by ${h.holder} gen ${h.gen}`).join(", ")}`, { held });

  // --- REVIEW: a cross-lab ack on the exact bytes ---
  const reviews = artifacts.map(a => ({ slot: a.slot, ...reviewAck(store, fromCid, a.entry) }));
  gate("REVIEW", artifacts.length > 0 && reviews.every(r => r.ok),
    artifacts.length === 0 ? "nothing to ship: no artifact slot would move"
      : reviews.filter(r => !r.ok).map(r => `${r.slot}: ${r.why}`).join(" | "),
    { reviews, evaluated: reviews.map(r => r.slot) });

  // --- TESTS: green, and bound to the revision being shipped ---
  const acceptance = artifacts.map(a => ({ slot: a.slot,
    ...(state ? acceptanceStatus({ store, state, artifact: { ...a.entry.payload, cid: a.cid, author: a.entry.author }, from: fromCid })
              : { ok: false, why: "no board" }) }));
  gate("TESTS", artifacts.length > 0 && acceptance.every(r => r.ok),
    artifacts.length === 0 ? "nothing to ship" : acceptance.filter(r => !r.ok).map(r => `${r.slot}: ${r.why}`).join(" | "),
    { acceptance, evaluated: acceptance.map(r => r.slot) });

  // --- MERGE: one commit or none. A slot both sides moved cannot be shipped by a transaction whose
  // output is a single commit, and silently keeping ours would be a partial ship reported as a ship. ---
  const plan = (head !== null || fromCid) ? planMerge({ store, into: head, from: fromCid, table }) : null;
  gate("MERGE", Boolean(plan) && plan.blocked.length === 0,
    plan ? plan.blocked.map(b => `${b.slot}: ${b.why}`).join(" | ") : "nothing to merge",
    { blocked: plan?.blocked.map(b => b.slot) ?? [], ambiguous_base: plan?.ambiguousBase ?? false,
      // planMerge recomputes from the same two trees, so this is the candidate set again and not
      // REVIEW's survivors. Stamped so the invariant is checkable rather than remembered.
      evaluated: (plan?.decisions ?? []).filter(d => candidates.includes(d.slot)).map(d => d.slot) });

  const failed = GATES.map(g => gates.find(x => x.gate === g)).filter(g => g && !g.ok);
  if (failed.length) {
    // A no-op refusal. Nothing has been put and no name has moved.
    return { ok: false, refused: failed[0].gate, failed: failed.map(f => f.gate), gates, candidates,
      why: failed.map(f => `${f.gate}: ${f.why}`).join(" | "), head, unchanged: true };
  }

  if (dryRun) return { ok: true, dryRun: true, gates, head, candidates, would_ship: artifacts.map(a => a.slot),
    acks: reviews.flatMap(r => r.acks) };

  // One commit. Parents are the board head, the source, and anything explicitly grafted -- nothing
  // else, so a scout orphan cannot become an ancestor by being reachable somewhere.
  const parents = [...new Set([head, fromCid, ...graft].filter(Boolean))];
  const tree = putTree(store, plan.slots);
  const commit = putCommit(store, { parents, tree, author: actor, lease_gen: null, records: [],
    msg: `ship ${from} into ${ref}: ${artifacts.map(a => a.slot).join(", ")}` });
  const changed = changedSlots(store, head, commit);
  // `ship: true` is what lets a bound-review slot land on a board ref; nothing else may say it.
  const swap = await refs.swap({ name: ref, expected: head, next: commit, author: actor, changedSlots: changed, msg: "ship", ship: true });
  if (!swap.ok) return { ok: false, refused: "CAS", gates, why: swap.why, head, unchanged: true };
  if (runtime) { try { runtime.recordSpend({ commit, seat: actor.vendor, vendor: actor.vendor, turns: 0 }); } catch { /* side log */ } }
  return { ok: true, commit, from: head, changed, gates, candidates, shipped: artifacts.map(a => a.slot),
    acks: reviews.flatMap(r => r.acks) };
}

/** Law 6, as a predicate a caller can ask before spending anything. */
export const mayShip = actor => {
  const cls = authorClassOf(actor ?? {});
  if (cls === "seat" || VENDORS.has(actor?.vendor)) return { ok: false, why: `${actor?.seat_id ?? actor?.vendor} is a chair; no chair ships (law 6)` };
  if (actor?.seat_id) return { ok: false, why: `actor carries seat_id "${actor.seat_id}": a chair wearing the controller's coat` };
  if (cls !== "controller" && cls !== "human") return { ok: false, why: `unknown actor class "${cls}"` };
  return { ok: true };
};

/**
 * Bridge to the declared law table in src/team/law.mjs.
 *
 * That table's law 7 takes `tests_passed`, `checker_ack` and `bound_to_current_bytes` as booleans the
 * CALLER supplies. A gate that reads a flag instead of the objects is the proxy-in-the-checker class:
 * it cannot fail when the caller is wrong or optimistic, and this workspace has shipped that before.
 *
 * So the flags are DERIVED here, from a read-only pass of the same gates that decide a real ship. The
 * declaration and the mechanism then cannot disagree, because there is only one place the facts come
 * from. Pass the result straight to `enforce` -- never hand-build the action.
 */
export async function shipClaim({ store, refs, runtime = null, ref, from, actor, graft = [], now = Date.now() }) {
  const dry = await ship({ store, refs, runtime, ref, from, actor, graft, now, dryRun: true });
  const g = name => dry.gates.find(x => x.gate === name);
  const review = g("REVIEW"), tests = g("TESTS");
  return {
    kind: "ship",
    chair: authorClassOf(actor) === "seat" ? actor.seat_id : actor.vendor,
    tests_passed: Boolean(tests?.ok),
    checker_ack: Boolean(review?.ok),
    // Both gates bind to the artifact's bytes cid, which is what "current" means here: a cid cannot
    // be stale, so there is no separate staleness flag to get wrong.
    bound_to_current_bytes: Boolean(tests?.ok && review?.ok),
    consensus: false,
    derived_from_board: true,
    gates: dry.gates,
    why: dry.ok ? null : dry.why,
  };
}
