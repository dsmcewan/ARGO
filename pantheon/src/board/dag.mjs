// The write path: blobs -> entries -> tree -> commit -> ref swap.
//
// Two graphs share one store, and keeping them separate is the point:
//
//   LINEAGE  entry -> derived_from / supports / target.   "why this claim exists"
//   BOARD    commit -> parent commits + a tree of slots.  "what is true now"
//
// Git does exactly this as commit graph versus tree/blob graph. Seats read a CHECKOUT of a commit;
// the controller appends commits; a critique binds to a blob cid rather than to "the file". When a
// worker writes rev 4 that is a new blob, a new artifact entry, a new tree and a new commit -- the
// rev-3 critique is still in the store, just no longer in the tree. Stale is a ref problem, not a
// delete problem, so nothing is ever deleted to make room for a newer truth.
import { validateEntry, slotOf, KINDS, authorClassOf, BoardViolation } from "./schema.mjs";
import { isCid, shortCid, codecOf } from "./canon.mjs";

/** Put a blob and return its cid. Two seats writing the same patch produce one object. */
export const putBlob = (store, bytes) => store.put("blob", bytes);

/** Validate then put an entry. Returns { cid, slot }. */
export function putEntry(store, entry) {
  const node = { type: "entry", ...entry };
  const slot = validateEntry(node);
  return { cid: store.put("entry", node), slot };
}

export const putTree = (store, slots) => {
  for (const [name, cid] of Object.entries(slots)) {
    if (!isCid(cid) || codecOf(cid) !== "entry") throw new BoardViolation(`tree slot "${name}" must point at an entry, got ${cid}`, "TREE");
  }
  return store.put("tree", { type: "tree", slots });
};

export const putCommit = (store, { parents = [], tree, author, lease_gen = null, msg = "", records = [] }) => {
  if (!isCid(tree) || codecOf(tree) !== "tree") throw new BoardViolation(`commit.tree must be a tree cid, got ${tree}`, "COMMIT");
  for (const p of parents) if (!isCid(p) || codecOf(p) !== "commit") throw new BoardViolation(`commit.parents must be commit cids, got ${p}`, "COMMIT");
  if (!author?.vendor) throw new BoardViolation("commit.author is required", "COMMIT");
  const a = authorClassOf(author) === "seat"
    ? { vendor: author.vendor, seat_id: author.seat_id, mode: author.mode, occupancy_gen: author.occupancy_gen }
    : { vendor: author.vendor };
  for (const r of records) if (!isCid(r) || codecOf(r) !== "entry") throw new BoardViolation(`commit.records must be entry cids, got ${r}`, "COMMIT");
  // `records` is what this commit INTRODUCED, slotted or not. Without it an accumulative entry --
  // a repro, a search, a trace -- is written to the store and reachable from nothing: the tree only
  // holds heads, and evidence has no head by design. It would be in the CAS and invisible to every
  // projection, which is the worst of both (stored, uncitable).
  return store.put("commit", { type: "commit", parents, tree, author: a, lease_gen, msg, records });
};

/** Read a commit's slots, each resolved to its entry. This is the raw view; projections narrow it. */
export function checkout(store, commitCid) {
  if (commitCid === null) return { commit: null, cid: null, tree: null, slots: {} };
  const commit = store.get(commitCid);
  const tree = store.get(commit.tree);
  const slots = {};
  for (const [name, cid] of Object.entries(tree.slots)) slots[name] = { cid, ...store.get(cid) };
  return { commit, cid: commitCid, tree: commit.tree, slots };
}

export const treeSlots = (store, commitCid) =>
  (commitCid === null ? {} : store.get(store.get(commitCid).tree).slots);

/** Slots whose binding differs between two commits, including added and removed. */
export function changedSlots(store, fromCommit, toCommit) {
  const a = treeSlots(store, fromCommit), b = treeSlots(store, toCommit);
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(k => a[k] !== b[k]).sort();
}

/** Walk the commit chain back from a ref. Bounded: an unbounded walk is how a projection becomes
 *  the whole history. Returns newest first. */
export function history(store, commitCid, { limit = 500 } = {}) {
  const out = [];
  const queue = commitCid ? [commitCid] : [];
  const seen = new Set();
  while (queue.length && out.length < limit) {
    const cid = queue.shift();
    if (seen.has(cid)) continue;
    seen.add(cid);
    const c = store.get(cid);
    out.push({ cid, ...c });
    queue.push(...c.parents);
  }
  return { commits: out, truncated: queue.length > 0, limit };
}

/** Every entry ever bound to a slot, newest first, by walking the commit chain. */
export function slotHistory(store, commitCid, slot, opts = {}) {
  const seen = [];
  for (const c of history(store, commitCid, opts).commits) {
    const cid = store.get(c.tree).slots[slot];
    if (cid && seen[seen.length - 1]?.cid !== cid) seen.push({ cid, commit: c.cid, ...store.get(cid) });
  }
  return seen;
}

/**
 * Every entry of a kind reachable from a commit, whether or not it is currently a head.
 * A stale critique is still evidence about what a reviewer saw; it just no longer gates anything.
 */
export function entriesOfKind(store, commitCid, kind, opts = {}) {
  const out = new Map();
  for (const c of history(store, commitCid, opts).commits) {
    // Tree slots give current heads; records give everything each commit introduced, including the
    // accumulative kinds that have no head at all.
    for (const cid of [...Object.values(store.get(c.tree).slots), ...(c.records ?? [])]) {
      if (out.has(cid)) continue;
      const e = store.get(cid);
      if (e.kind === kind) out.set(cid, { cid, ...e });
    }
  }
  return [...out.values()];
}

/**
 * The seven-step write, as its own function so the steps are named in the result and a caller can
 * see exactly where a refusal happened.
 *
 *   1 hold the lease            5 CAS put (idempotent, content addressed)
 *   2 build nodes bottom-up     6 compare-and-swap the ref
 *   3 parents = [current ref]   7 on failure: report; never retry blindly
 *   4 cite the lease generation
 *
 * `entries` is a list of { kind, payload, links, visibility, blob } built in caller order; a `blob`
 * is put first and its cid injected as the kind's content link.
 */
export async function publish({ store, refs, runtime = null, ref, author, entries, lease = null, msg = "", budgetCheck = true, expect = undefined }) {
  const steps = [];
  const note = (step, detail) => { steps.push({ step, ...detail }); };

  // Step 1. A cap that drops work must be visible; a silent stop reads as "nothing to do".
  if (budgetCheck && runtime) {
    const b = runtime.budget();
    if (b.exhausted) return { ok: false, code: "BUDGET", why: b.why, budget: b, steps };
  }
  if (lease && runtime) {
    const v = runtime.verify({ resource: lease.resource, seat_id: author.seat_id, gen: lease.gen });
    // Checked here for a clear early error AND again inside the ref lock, where it is authoritative.
    if (!v.ok) return { ok: false, code: v.code, why: v.why, steps };
    note("lease", { resource: lease.resource, gen: lease.gen });
  }

  // Step 3. A caller that built its work against a known head says so, and the swap arbitrates.
  // Re-reading the ref here instead would be the "retry with the new parent" instinct: the tree gets
  // built from a fresh read while the WORK was reasoned about on the old one, so the write lands and
  // silently overwrites whatever it did not see.
  const before = expect !== undefined ? expect : refs.resolve(ref);
  const slots = { ...treeSlots(store, before) };
  const written = [];
  let tree, commit;

  // A REFUSAL, NOT A CRASH. Schema violations used to throw BoardViolation straight out of publish(),
  // and an ordinary seat mistake -- the wrong kind for its mode, a decision from a seat -- took the
  // whole driver process down, in a system whose own vocabulary is "refusals". The 2026-09-27
  // re-review reproduced it against board-run.mjs. Every BoardViolation raised while building this
  // write is now the typed { ok:false, code, why, steps } every other refusal is; anything else
  // still throws, because an unexpected exception is not a refusal and must not be dressed as one.
  try {
  for (const spec of entries) {                                        // step 2
    // Shape first. validateEntry() assumes an object with a payload; `null` or `{ kind }` alone reached
    // it and threw a TypeError -- a crash, not a refusal (in-session probe, 2026-09-27).
    if (!spec || typeof spec !== "object" || typeof spec.kind !== "string" || !spec.payload || typeof spec.payload !== "object") {
      throw new BoardViolation(`entry must be an object with a string kind and an object payload; got ${spec === null ? "null" : Array.isArray(spec) ? "an array" : typeof spec}${spec && typeof spec === "object" ? ` (kind=${JSON.stringify(spec.kind)}, payload=${spec.payload === undefined ? "missing" : typeof spec.payload})` : ""}`, "ENTRY");
    }
    const links = { ...(spec.links ?? {}) };
    if (spec.blob !== undefined) {
      const contentLink = { repro: "excerpt", search: "excerpt", trace: "log", artifact: "bytes", critique: "target" }[spec.kind];
      if (!contentLink) throw new BoardViolation(`kind "${spec.kind}" takes no blob`, "LINK");
      links[contentLink] = putBlob(store, spec.blob);
    }
    // Superseding is implicit and CHECKED: if this entry claims a slot that already has a head, it
    // must cite it. Otherwise a rev-4 write silently orphans rev 3 and the lineage goes quiet
    // exactly where a reader most needs it.
    const slot = slotOf(spec.kind, spec.payload, author);
    if (slot && slots[slot] && !(links.supersedes ?? []).includes(slots[slot])) {
      if (spec.supersede === false) {
        return { ok: false, code: "SUPERSEDE",
          why: `${slot} is already bound to ${shortCid(slots[slot])}; a new binding must cite what it replaces`, steps };
      }
      links.supersedes = [...(links.supersedes ?? []), slots[slot]];
    }
    const { cid } = putEntry(store, {                                  // step 5
      kind: spec.kind, level: KINDS[spec.kind].level, payload: spec.payload,
      links, author, visibility: spec.visibility ?? "board",
      ...(spec.confidence !== undefined ? { confidence: spec.confidence } : {}),
    });
    written.push({ cid, kind: spec.kind, slot });
    if (slot) slots[slot] = cid;
  }
  note("entries", { count: written.length });

  tree = putTree(store, slots);
  commit = putCommit(store, { parents: before ? [before] : [], tree, author,
    lease_gen: lease?.gen ?? null, msg, records: written.map(w => w.cid) });                        // step 4
  note("commit", { cid: commit });
  } catch (e) {
    if (e instanceof BoardViolation) return { ok: false, code: e.code ?? "SCHEMA", why: e.message, steps, written };
    throw e;
  }

  // The lease fence -- both halves, direct slots and artifact slots covered by a leased item -- runs in
  // refs.swap, which diffs the commits itself; a refusal from there comes back through the swap below.
  const changed = changedSlots(store, before, commit);
  const swap = await refs.swap({ name: ref, expected: before, next: commit, author, lease, changedSlots: changed, msg });  // step 6
  if (!swap.ok) return { ok: false, ...swap, commit, written, changed, steps };                                            // step 7

  if (runtime) {
    try { runtime.recordSpend({ commit, seat: author.seat_id ?? author.vendor, vendor: author.vendor, turns: 1 }); }
    catch { /* spend is a side log; losing a row must not undo a published commit */ }
  }
  return { ok: true, ref, from: before, commit, tree, written, changed, steps };
}
