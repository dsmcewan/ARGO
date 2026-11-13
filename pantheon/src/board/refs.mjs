// Mutable names over an immutable store. This is the ONLY coarse lock in the design: hash the
// work, lease the name.
//
// A ref move is a compare-and-swap, and a lost CAS is returned as a typed failure rather than
// retried. "Retry with the new parent" is exactly the move that silently overwrites the commit
// that beat you -- the caller has to re-read, decide whether its work still applies, and say so.
//
// The fencing check runs INSIDE the ref lock. Checking the lease before taking the lock would race
// with the fence it exists to detect: a holder could verify at gen 3, block on the lock while gen 4
// is issued, and then swap the name it no longer owns.
//
// BRANCH CLASS IS A WRITE PERMISSION, not a naming convention. `discuss` landing on the shipping
// ref is a policy bug, so the policy is here, at the only place a name can move.
import { shipOnlySlots } from "./policy.mjs";
import { changedSlots as diffSlots, treeSlots } from "./dag.mjs";
import { authorClassOf } from "./schema.mjs";
import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync, appendFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { isCid, shortCid } from "./canon.mjs";
import { withSeatLock } from "../seat/lock.mjs";

const SEG = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Branch classes. `slots` is the set of board-view slots a commit on this ref may CHANGE:
 * a prefix list, checked against the diff between the old tree and the new one.
 */
export const REF_CLASSES = {
  // Shipping truth. A seat never moves it; it moves by a typed merge the controller performs.
  board:    { writers: ["controller", "human"], slots: "*", immutable: false },
  // A work branch. Whatever a seat legitimately produces before the controller collects it: an
  // artifact binding, its item's state, the plan a planner wrote, a reviewer's verdict, a claim.
  //
  // This list and the schema's `writers` are two INDEPENDENT gates and both are needed. This one
  // says which slots a branch may carry; the schema says who may author the entry. `decision:` is
  // here so a human can stage one on a branch -- and a seat still cannot author a decision, because
  // the schema refuses it whatever branch it is on.
  //
  // It started as ["artifact:", "item:"], which left a planner with nowhere to put a plan and a
  // reviewer nowhere to put a critique. The cost of getting that wrong is not a broken branch: it is
  // handing those seats the shipping ref, which is how "the controller is not a vendor" gets quietly
  // traded away for convenience.
  seat:     { writers: ["seat", "controller", "human"], slots: ["artifact:", "item:", "plan", "hypothesis:", "critique:", "decision:"], immutable: false },
  // A debate fork. Evidence and claims only, and it can never be the shipping ref.
  iso:      { writers: ["seat", "controller"], slots: ["hypothesis:"], immutable: false },
  item:     { writers: ["controller"], slots: ["item:"], immutable: false },
  artifact: { writers: ["controller"], slots: ["artifact:"], immutable: false },
  // A freeze for replay. Written once; a snapshot that can move is not a snapshot.
  snap:     { writers: ["controller", "human"], slots: "*", immutable: true },
};

export function parseRef(name) {
  const parts = String(name).split("/");
  if (parts.length < 3 || parts[0] !== "refs") throw new Error(`parseRef: "${name}" is not refs/<class>/<...>`);
  const cls = parts[1];
  if (!REF_CLASSES[cls]) throw new Error(`parseRef: unknown ref class "${cls}"; known: ${Object.keys(REF_CLASSES).join(", ")}`);
  for (const seg of parts.slice(1)) {
    if (!SEG.test(seg)) throw new Error(`parseRef: segment "${seg}" in "${name}" is not a safe path segment`);
  }
  return { name, cls, rest: parts.slice(2), spec: REF_CLASSES[cls] };
}

/** May this author move this name at all? Independent of what the commit contains. */
export function maySwap(name, author) {
  const { cls, spec, rest } = parseRef(name);
  const authorClass = author.vendor === "controller" || author.vendor === "human" ? author.vendor : "seat";
  if (!spec.writers.includes(authorClass)) {
    return { ok: false, code: "REF_CLASS", why: `a ${authorClass} may not move refs/${cls}/* (writers: ${spec.writers.join(", ")})` };
  }
  // A seat may only move ITS OWN wip or isolated branch. Otherwise "isolated" is a directory name
  // rather than an isolation boundary.
  if (authorClass === "seat" && cls === "seat" && rest[0] !== author.seat_id) {
    return { ok: false, code: "REF_OWNER", why: `${author.seat_id} may not move refs/seat/${rest[0]}/*` };
  }
  if (authorClass === "seat" && cls === "iso" && rest[0] !== author.vendor) {
    return { ok: false, code: "REF_OWNER", why: `vendor ${author.vendor} may not move refs/iso/${rest[0]}/*` };
  }
  return { ok: true };
}

/** Which slot changes this ref class permits. */
export function slotsAllowed(name, changedSlots) {
  const { cls, spec } = parseRef(name);
  if (spec.slots === "*") return { ok: true };
  const bad = changedSlots.filter(s => !spec.slots.some(p => s.startsWith(p)));
  if (bad.length) {
    return { ok: false, code: "SLOT_CLASS", why: `refs/${cls}/* may only change ${spec.slots.join(", ")} slots; this commit changes ${bad.join(", ")}` };
  }
  return { ok: true };
}

export function openRefs(root, { runtime = null, store = null, readOnly = false } = {}) {
  const base = join(root, "refs");
  if (!readOnly) mkdirSync(base, { recursive: true });
  const lockDir = join(root, "runtime", "locks");
  const logPath = join(root, "runtime", "refs.log");
  const refPath = name => { parseRef(name); return join(root, name); };

  const resolve = name => {
    const p = refPath(name);
    if (!existsSync(p)) return null;
    const cid = readFileSync(p, "utf8").trim();
    return isCid(cid) ? cid : null;
  };

  function list() {
    const out = [];
    const walk = dir => {
      if (!existsSync(dir)) return;
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else out.push({ name: p.slice(root.length + 1).split("\\").join("/"), cid: readFileSync(p, "utf8").trim() });
      }
    };
    walk(base);
    return out.filter(r => isCid(r.cid));
  }

  /**
   * Compare-and-swap a name. Returns { ok:false, code } on every refusal; never retries.
   * `lease` is { resource, gen } and is verified inside the critical section when supplied.
   */
  const swap = ({ name, expected = null, next, author, lease = null, changedSlots: claimed = [], msg = "", ship = false, from = null }) =>
    readOnly ? Promise.reject(new Error("refs.swap: this reader is read-only")) : withSeatLock(`ref ${name}`, async () => {
      const { spec } = parseRef(name);
      if (!isCid(next)) return { ok: false, code: "BAD_CID", why: `next "${next}" is not a cid` };
      const current = resolve(name);
      // THE CALLER'S LIST IS A CLAIM, NOT THE MEASUREMENT. Every check below -- slot class, SHIP_ONLY,
      // the lease fence -- keyed on `changedSlots` as the caller supplied it, so a raw caller passing []
      // landed an artifact on the shipping ref and a seat wrote past a lease with the same lie (found by
      // an in-session probe after the 2026-09-27 re-review, the day SHIP_ONLY moved to the ref). With the
      // store in hand the ref diffs the two commits itself; the caller's list only matters when there is
      // no store to check it against, which openBoard() never produces.
      // A NEW name created by branch() copies an existing head: it changes nothing relative to its source,
      // so the diff base is that source, not the empty tree. Any other creation (an orphan write) is diffed
      // against nothing, i.e. every slot it carries is a change -- which is what publish() always computed.
      const base = current ?? (from ? (isCid(from) ? from : resolve(from)) : null);
      const changedSlots = store ? diffSlots(store, base, next) : claimed;
      // ...and a board ref may be CREATED only from another board ref (or by ship()). Otherwise "branch the
      // shipping ref from my wip" is the SHIP_ONLY bypass with a diff of zero.
      if (spec === REF_CLASSES.board && current === null && from && !ship) {
        const srcSpec = typeof from === "string" && from.startsWith("refs/") ? parseRef(from).spec : null;
        if (srcSpec !== REF_CLASSES.board) {
          return { ok: false, code: "BOARD_FROM",
            why: `${name} cannot be created from ${from}: a board ref starts from another board ref or from ship(); ` +
              `pointing the shipping ref at a seat's head is landing that head without the gates.` };
        }
      }

      // A chain role must not grow an `iso/<lab>/scout` ref "for coverage". Checked without needing
      // to know anybody's role: intake PRECEDES the board, so a scout ref may only be created while
      // no board ref exists. Once there is a board commit, a second scout is either a chain role with
      // a projection (a different job) or a new intake on a new question -- not a swarm taped under
      // the implementer.
      if (/^refs\/iso\/[^/]+\/scout$/.test(name) && !resolve(name)) {
        const board = list().find(r => r.name.startsWith("refs/board/"));
        if (board) {
          return { ok: false, code: "SCOUT_AFTER_BOARD",
            why: `${name} cannot be created once ${board.name} exists: intake precedes the board. ` +
              `A second scout is a new intake on a new question, or a chain role with a projection -- ` +
              `not a fan-out nested under a seat.` };
        }
      }

      const perm = maySwap(name, author);
      if (!perm.ok) return perm;
      const slotPerm = slotsAllowed(name, changedSlots);
      if (!slotPerm.ok) return slotPerm;

      // SHIP-ONLY, ENFORCED AT THE REF. merge() refuses to land a bound-review slot on a board ref, but a
      // holder of the raw handles from openBoard() could call putCommit + swap directly and bypass that
      // refusal by construction. The 2026-09-27 re-review named it. So the ref itself refuses unless the
      // caller is ship(), which says so with `ship: true` -- an in-process flag, not a capability, but a
      // named and greppable one: every landing of reviewed work on the shipping ref goes through one
      // function or through a line that literally spells out that it is bypassing it.
      if (spec === REF_CLASSES.board && !ship) {
        const only = shipOnlySlots(changedSlots);
        if (only.length) {
          return { ok: false, code: "SHIP_ONLY",
            why: `${only.join(", ")} may not move onto ${name} except through ship(); this write did not come ` +
              `from it. Reviewed slots land on the shipping ref only through the transaction that runs every gate.` };
        }
      }

      const land = () => {
        // FENCING IS NOT OPT-IN. A seat that omitted \`lease\` used to write past an active lease with no
        // error at all -- the fence only fired for callers polite enough to present one. For the slots a
        // lease names directly (item:<key>, plan) the check needs no store: if an active lease covers the
        // slot, a seat writing it must present that lease or be refused. Artifact slots are covered by the
        // item that lists them, which needs the tree, so publish() enforces that half.
        if (runtime && authorClassOf(author) === "seat") {
          const table = runtime.leases(), now = Date.now();
          const active = r => { const l = table[r]; return l && l.state === "active" && Date.parse(l.expires_at) > now ? l : null; };
          // Artifact slots are covered by the item that lists them. Read from the tree being LANDED, so
          // a raw caller cannot route around publish() -- both halves of the fence live here now.
          const covered = new Map();
          if (store) {
            for (const [slot, cid] of Object.entries(treeSlots(store, next))) {
              if (!slot.startsWith("item:")) continue;
              const l = active(slot); if (!l) continue;
              for (const a of store.get(cid)?.payload?.artifact_slots ?? []) covered.set(a, { resource: slot, l });
            }
          }
          for (const slot of changedSlots) {
            const direct = active(slot);
            const via = covered.get(slot);
            if (!direct && !via) continue;
            const resource = direct ? slot : via.resource, l = direct ?? via.l;
            if (!lease || lease.resource !== resource) {
              return { ok: false, code: "LEASE_REQUIRED",
                why: `${slot} is ${direct ? "under" : `listed by ${resource}, which is under`} an active lease (held by ` +
                  `${l.holder?.seat_id ?? "?"} at gen ${l.gen}); a write that moves it must present that lease. ` +
                  `Omitting the lease is not a way around the fence.` };
            }
          }
        }

        if (spec.immutable && current) {
          return { ok: false, code: "IMMUTABLE", why: `${name} is a snapshot and already points at ${shortCid(current)}`, current };
        }
        if ((expected ?? null) !== current) {
          return { ok: false, code: "CAS_LOST",
            why: `${name} is at ${current ? shortCid(current) : "(unset)"}, not the ${expected ? shortCid(expected) : "(unset)"} this write was built on. ` +
              `You were fenced or beaten; re-read and decide whether the work still applies.`,
            current, expected };
        }
        if (lease) {
          if (!runtime) return { ok: false, code: "NO_RUNTIME", why: "a lease was supplied but this refs store has no runtime to verify it against" };
          const v = runtime.verify({ resource: lease.resource, seat_id: author.seat_id, gen: lease.gen });
          if (!v.ok) return { ok: false, code: v.code, why: v.why, current };
        }

        const p = refPath(name);
        mkdirSync(dirname(p), { recursive: true });
        const tmp = `${p}.tmp${process.pid}`;
        writeFileSync(tmp, next + "\n");
        renameSync(tmp, p);
        // A reflog is runtime chrome, so it lives outside the DAG and is never load-bearing: the
        // commit parents are the audit trail. This only answers "which names moved, when".
        try {
          appendFileSync(logPath, JSON.stringify({ at: new Date().toISOString(), name, from: current, to: next, by: author.seat_id ?? author.vendor, lease_gen: lease?.gen ?? null, msg }) + "\n");
        } catch { /* the swap already happened; a missing log line must not undo it */ }
        return { ok: true, name, from: current, to: next };
      };
      // ONE LOCK DOMAIN (2026-09-27 re-review, rank 11). runtime.verify() is an unlocked read and fence()
      // serialises through the runtime's own lock, so verify-then-write could land after a fence that ran
      // between the two. The lease reads, the CAS and the write now all happen under that same lock.
      // Order is always ref lock -> lease lock; nothing under the lease lock touches a ref.
      return runtime?.locked ? runtime.locked(async () => land()) : land();
    }, { dir: lockDir, timeoutMs: 30_000 });

  /**
   * Create a name pointing at another name's head: `git checkout -b wip main`.
   *
   * A branch that starts from nothing is an ORPHAN, and orphans have no common ancestor with the
   * board -- so every later merge is a two-unrelated-histories merge, a fast-forward can never be
   * recognised, and bound-review has no base to three-way against. A worker branch must descend
   * from the head it was reasoned about.
   */
  const branch = async ({ name, from, author }) => {
    const at = typeof from === "string" && from.startsWith("refs/") ? resolve(from) : from;
    if (!at) return { ok: false, code: "NO_BASE", why: `cannot branch ${name}: ${from} resolves to nothing` };
    const existing = resolve(name);
    if (existing) return { ok: true, name, cid: existing, existed: true };
    return { ...(await swap({ name, expected: null, next: at, author, msg: `branch from ${from}`, from })), cid: at };
  };

  const reflog = () => (existsSync(logPath)
    ? readFileSync(logPath, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l))
    : []);

  return { base, resolve, list, swap, branch, reflog, refPath };
}
