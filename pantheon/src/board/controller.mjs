// The controller: deterministic code over board predicates. Not a vendor, and not a seat.
//
// A DAG will happily accept a `discuss` commit if the controller allows the write, so policy lives
// here. The rule that matters most is the cheapest one to state:
//
//     NEVER SCHEDULE `discuss` WHILE A WORK ITEM IS READY.
//
// Mode scheduling is a function of status and ready work, never of which card on the grid is empty.
// An empty chair is not a reason to philosophise.
//
// ACCEPTANCE IS EXECUTED, NEVER ASSERTED. `integrate` does not fire because a seat said the tests
// pass; it fires when a repro entry records exit 0 AND cites the artifact entry it was run against.
// An acceptance result that does not name the revision it ran on is the same gate theater as an
// approval of rev 3 authorising rev 4 -- this project shipped that exact defect this morning and the
// board must not reintroduce it one layer up.
import { treeSlots, entriesOfKind } from "./dag.mjs";
import { approvalFor } from "./merge.mjs";
import { shortCid } from "./canon.mjs";
import { MODES } from "./schema.mjs";

/** Everything a trigger predicate is allowed to look at, computed once. */
export function boardState({ store, refs, runtime = null, ref }) {
  const commit = refs.resolve(ref);
  const slots = treeSlots(store, commit);
  const read = cid => ({ cid, ...store.get(cid) });
  const bySlot = Object.fromEntries(Object.entries(slots).map(([s, c]) => [s, read(c)]));

  const ticket = bySlot.ticket?.payload ?? null;
  const plan = bySlot.plan?.payload ?? null;
  const items = Object.entries(bySlot).filter(([s]) => s.startsWith("item:"))
    .map(([slot, e]) => ({ slot, cid: e.cid, links: e.links, ...e.payload }));
  const artifacts = Object.entries(bySlot).filter(([s]) => s.startsWith("artifact:"))
    .map(([slot, e]) => ({ slot, cid: e.cid, bytes: e.links.bytes, ...e.payload }));
  const decisions = Object.entries(bySlot).filter(([s]) => s.startsWith("decision:"))
    .map(([slot, e]) => ({ slot, cid: e.cid, ...e.payload }));
  const hypotheses = Object.entries(bySlot).filter(([s]) => s.startsWith("hypothesis:"))
    .map(([slot, e]) => ({ slot, cid: e.cid, visibility: e.visibility, author: e.author, ...e.payload }));
  const critiques = commit ? entriesOfKind(store, commit, "critique") : [];
  const evidence = commit ? ["repro", "search", "trace"].flatMap(k => entriesOfKind(store, commit, k)) : [];

  const isoRefs = refs.list().filter(r => r.name.startsWith("refs/iso/"));
  const wipRefs = refs.list().filter(r => r.name.startsWith("refs/seat/"));

  // An offer is a fork the controller is pointed at, not something that has landed. This is the only
  // way a review of unmerged work can be scheduled at all -- see the note on work_item.links.offer.
  const offers = items.filter(i => i.state === "offered_review" && i.offer_ref).map(i => {
    // A seat writes offer_ref. A malformed one used to throw out of parseRef and take the scheduler
    // down with it -- a seat crashing the controller by writing a bad string is not a failure mode
    // a controller gets to have. It is an offer that resolves to nothing, and says why.
    let at = null, parseWhy = null;
    try { at = refs.resolve(i.offer_ref); } catch (e) { parseWhy = String(e?.message ?? e); }
    const offered = (i.links?.offer ?? []).map(read);
    return {
      item: i.key, ref: i.offer_ref, commit: at,
      artifacts: offered.filter(e => e.kind === "artifact").map(e => ({ cid: e.cid, bytes: e.links.bytes, ...e.payload })),
      why: at ? null : `item ${i.key} offers ${i.offer_ref}, which resolves to nothing${parseWhy ? ` (${parseWhy})` : ""}`,
    };
  });

  return {
    ref, commit, slots, bySlot, ticket, plan, items, artifacts, critiques, decisions, hypotheses,
    evidence, isoRefs, wipRefs, offers,
    leases: runtime?.leases() ?? {},
    occupancy: runtime?.occupancy() ?? {},
    budget: runtime?.budget() ?? { declared: null, spent_turns: 0, exhausted: false },
  };
}

/**
 * Did the ticket's machine-checkable acceptance actually pass, on THIS artifact revision?
 * Returns one row per criterion, each either executed-and-passed or explicitly not.
 */
export function acceptanceStatus({ store, state, artifact, from = undefined }) {
  if (!state.ticket) return { ok: false, rows: [], why: "no ticket" };
  // When judging an OFFER, the evidence lives on the offered branch, not on the shipping ref. Reading
  // only the shipping ref here would report "the tests were never run" for every candidate.
  const evidence = from === undefined ? state.evidence
    : ["repro", "search", "trace"].flatMap(k => entriesOfKind(store, from, k));
  const artifacts = from === undefined ? state.artifacts
    : Object.entries(treeSlots(store, from)).filter(([s]) => s.startsWith("artifact:"))
        .map(([slot, cid]) => { const e = store.get(cid); return { slot, cid, ...e.payload, author: e.author }; });
  const rows = state.ticket.acceptance.map(a => {
    if (a.type === "tests") {
      // A green run only counts if it CITES a revision in scope.
      //
      // The first version of this read `!artifact || cites(artifact)`, which fails OPEN: with no
      // artifact in scope -- the normal case while bound-review is still holding the candidate on a
      // branch -- every unbound repro of the right command satisfied the criterion. "The tests pass"
      // would have closed a ticket with nothing built. An empty target list now means not satisfied.
      const targets = artifact ? [artifact.cid] : artifacts.map(x => x.cid);
      const cites = e => (e.links.derived_from ?? []).some(d => targets.includes(d));
      const hits = evidence.filter(e => e.kind === "repro" && e.payload.cmd === a.cmd && cites(e));
      // INDEPENDENT of the maker. `repro.writers` includes "seat", so the seat that wrote the artifact
      // can write a repro citing it with exit 0 -- and "acceptance is executed, never asserted" then
      // holds only when some OTHER process ran the tests. A pass counts only when its author is the
      // controller or a different lab from the artifact's author; the maker's own green is recorded
      // and shown, and does not close the gate.
      const makerOf = t => artifacts.find(x => x.cid === t)?.author ?? artifact?.author ?? null;
      const independent = h => {
        const target = (h.links.derived_from ?? []).find(d => targets.includes(d));
        const maker = makerOf(target);
        if (!h.author) return false;
        if (h.author.mode === "controller" || h.author.vendor === "controller") return true;
        return !maker || h.author.vendor !== maker.vendor;
      };
      const pass = hits.find(h => h.payload.exit === 0 && independent(h));
      const selfPass = hits.find(h => h.payload.exit === 0 && !independent(h));
      const unbound = evidence.filter(e => e.kind === "repro" && e.payload.cmd === a.cmd && !cites(e));
      return {
        ...a, executed: hits.length > 0, ok: Boolean(pass), evidence: pass?.cid ?? null,
        // Every citing run, passing or not, with its output blob. `evidence` names only the pass;
        // a brief built for a checker has to be able to show the FAILURE, and its output.
        runs: hits.map(h => ({ cid: h.cid, exit: h.payload.exit, excerpt: h.links.excerpt ?? null })),
        why: pass ? `exit 0 recorded by ${shortCid(pass.cid)}, run against ${shortCid(pass.links.derived_from.find(d => targets.includes(d)))}`
          : selfPass ? `exit 0 recorded by ${shortCid(selfPass.cid)}, but by the artifact's own author (${selfPass.author?.vendor ?? "unknown"}); the maker's green does not close the gate`
          : hits.length ? `ran with exit ${hits[0].payload.exit}`
          : targets.length === 0 ? `nothing in scope for \`${a.cmd}\` to have run against`
          : unbound.length ? `${unbound.length} run(s) of \`${a.cmd}\` on the board, none of which cites ${artifact ? shortCid(artifact.cid) : "an artifact in scope"}; a pass that names no revision is a pass on nothing`
          : `no repro of \`${a.cmd}\` cites ${artifact ? shortCid(artifact.cid) : "an artifact in scope"}`,
      };
    }
    if (a.type === "file_exists") {
      const hit = artifacts.find(x => x.path === a.path);
      return { ...a, executed: true, ok: Boolean(hit), why: hit ? `bound at ${hit.slot}` : `no artifact binds ${a.path}` };
    }
    // human_ack: only a human-resolved decision satisfies it. A controller rule cannot ack on a
    // human's behalf, which is the entire content of the criterion.
    const ack = state.decisions.find(d => d.resolution?.type === "human");
    return { ...a, executed: Boolean(ack), ok: Boolean(ack), why: ack ? `acked by decision ${d_key(ack)}` : "awaiting a human acknowledgement" };
  });
  return { ok: rows.every(r => r.ok), rows, why: rows.filter(r => !r.ok).map(r => r.why).join("; ") || null };
}
const d_key = d => d.key ?? d.slot;

/**
 * The checker's `tests` mount, derived from BOTH things the TESTS gate itself reads: the ticket's
 * acceptance (what must run, and how it must exit) and the stored repro entries that cite this
 * artifact (what did run, how it exited, and what it printed). Never a string a caller typed.
 *
 * The defect this replaces: scripts/live-ship.mjs executed the module and published the real exit
 * into a repro, then built the reviewer's prompt from the fixed string "It was run as ${CMD} and
 * exited 0." A probe recorded exit 1 in the repro beside "exited 0" in the reviewer's prompt
 * (docs/reviews/2026-09-27-orchestration-rereview-addendum.md). The TESTS gate read the record and
 * refused, so the harm was false context to cross-model review -- the one input a checker cannot
 * verify from inside its projection, because `tests` is a MOUNT, not an entry it can open.
 *
 * `from` is the offer branch, exactly as ship() passes it: the repro lives beside the candidate, not
 * on the shipping ref. Output is bounded, and the bound is stated in the text; a brief is not a log.
 */
export function testsBrief({ store, state, artifact, from = undefined, maxOutput = 1200 }) {
  const acc = acceptanceStatus({ store, state, artifact, from });
  const lines = [];
  for (const r of acc.rows) {
    if (r.type === "tests") {
      lines.push(`ACCEPTANCE: \`${r.cmd}\` must exit 0.`);
      if (!r.runs?.length) {
        lines.push(`RECORDED: no run of \`${r.cmd}\` cites the artifact in scope (${r.why}). Nothing has been shown to pass.`);
        continue;
      }
      for (const run of r.runs) {
        const out = run.excerpt ? store.getBlobText(run.excerpt) : "";
        const clipped = out.length > maxOutput
          ? `${out.slice(0, maxOutput)}\n… (${out.length - maxOutput} more bytes not shown)`
          : out;
        lines.push(`RECORDED: repro ${shortCid(run.cid)} ran \`${r.cmd}\` and exited ${run.exit}.` +
          (clipped.trim() ? `\nOUTPUT:\n${clipped.trimEnd()}` : "\nOUTPUT: (none)"));
      }
      continue;
    }
    if (r.type === "file_exists") { lines.push(`ACCEPTANCE: ${r.path} must be bound. RECORDED: ${r.why}.`); continue; }
    lines.push(`ACCEPTANCE: a human must acknowledge — "${r.prompt}". RECORDED: ${r.why}.`);
  }
  return {
    text: lines.join("\n"), ok: acc.ok, rows: acc.rows,
    basis: "derived from the ticket's acceptance and the repro entries that cite this artifact; nothing here was asserted by the caller",
  };
}

/** Deterministic status ladder. First matching rung wins, and each rung says why. */
export function boardStatus({ store, state }) {
  // Rungs carry the counts a caller keys on. team/modes.mjs's "conveyor" pattern tests `ready > 0` and
  // nothing emitted it (2026-09-27 re-review, rank 23); a shape only this function knows is a shape the
  // next layer guesses at.
  const rung = (status, why, extra = {}) => ({ status, why, ...extra });
  if (!state.ticket) return rung("intake", "no ticket on the board");
  if (state.decisions.some(d => d.resolution?.type === "split")) return rung("split", "a decision recorded a split");
  if (!state.plan) return rung("planning", "a ticket with no plan");
  const live = state.items.filter(i => !["done", "cancelled"].includes(i.state));
  const acc = acceptanceStatus({ store, state });
  if (live.length === 0) {
    if (acc.ok) return rung("accepted", "every item done and acceptance executed and passing");
    if (acc.rows.some(r => r.type === "human_ack" && !r.ok)) return rung("awaiting_human", acc.why);
    return rung("reviewing", `all items done but acceptance is not satisfied: ${acc.why}`);
  }
  if (live.some(i => i.state === "offered_review")) return rung("reviewing", "work is offered for review");
  const ready = live.filter(i => i.state === "ready" && dependenciesMet(state, i));
  const active = live.filter(i => ["leased", "active", "changes_requested"].includes(i.state));
  if (ready.length === 0 && active.length === 0) {
    return rung("stuck", `${live.length} item(s) unfinished and none ready: ` +
      live.map(i => `${i.key}=${i.state}${i.block?.reason ? ` (${i.block.reason})` : ""}`).join(", "), { ready: 0, active: 0, unfinished: live.length });
  }
  return rung("executing", `${ready.length} ready, ${active.length} in flight`, { ready: ready.length, active: active.length });
}

export const dependenciesMet = (state, item) =>
  (item.depends_on ?? []).every(k => state.items.find(i => i.key === k)?.state === "done");

const leaseFree = (state, resource, now = Date.now()) => {
  const l = state.leases[resource];
  return !l || l.state !== "active" || Date.parse(l.expires_at) <= now;
};

/**
 * Knowledge sources. Each declares the predicate that makes it eligible, what it may lease, which
 * slots it may write, and which projection it reads. Priority is a static list: lower runs first.
 */
export const TRIGGERS = [
  {
    ks: "plan", mode: "plan", projection: "supervisor", priority: 10,
    needs_lease: ["plan"], writes: ["plan", "item:*"],
    when: ({ state, status }) => (status === "planning" && leaseFree(state, "plan")
      ? [{ resource: "plan", why: "a ticket exists and no plan does" }] : []),
  },
  {
    ks: "work", mode: "work", projection: "worker", priority: 20,
    needs_lease: ["item:*"], writes: ["artifact:*", "item:*"],
    when: ({ state }) => state.items
      .filter(i => ["ready", "changes_requested"].includes(i.state) && dependenciesMet(state, i))
      .filter(i => leaseFree(state, i.slot))
      .map(i => ({ item: i.key, resource: i.slot, slots: i.artifact_slots,
        why: i.state === "changes_requested" ? "review requested changes" : "item is ready and its dependencies are done" })),
  },
  {
    ks: "critique", mode: "critique", projection: "checker", priority: 30,
    needs_lease: [], writes: ["critique:*"],
    // A critique is eligible when the OFFERED bytes have no critique bound to them. Comparing revs
    // would let a review of rev 3 satisfy rev 4; comparing cids cannot.
    when: ({ store, state }) => state.offers.flatMap(o => {
      if (!o.commit) return [];
      const seen = entriesOfKind(store, o.commit, "critique");
      return o.artifacts.filter(a => !seen.some(c => c.links.target === a.bytes))
        .map(a => ({ item: o.item, slot: `artifact:${a.slot}`, target: a.bytes, offer_ref: o.ref, avoid: [a.cid],
          why: `${a.slot} rev ${a.rev} (${shortCid(a.bytes)}) on ${o.ref} has no critique bound to these bytes` }));
    }),
  },
  {
    ks: "integrate", mode: "integrate", projection: "supervisor", priority: 40,
    needs_lease: ["tree"], writes: ["artifact:*", "item:*"],
    when: ({ store, state }) => state.offers.flatMap(o => {
      if (!o.commit) return [];
      return o.artifacts.map(a => {
        const ap = approvalFor(store, o.commit, store.get(a.cid));
        const acc = acceptanceStatus({ store, state, artifact: a, from: o.commit });
        if (!ap.ok) return { drop: `${a.slot}: ${ap.why}` };
        if (!acc.ok) return { drop: `${a.slot}: ${acc.why}` };
        return { item: o.item, slot: `artifact:${a.slot}`, resource: "tree", offer_ref: o.ref, merge_from: o.ref,
          why: `${ap.approvals} approval(s) of ${shortCid(a.bytes)}, 0 blocking, acceptance executed and passing` };
      });
    }).filter(c => !c.drop),
  },
  {
    ks: "explore", mode: "explore", projection: "isolated_debater", priority: 60,
    needs_lease: [], writes: ["hypothesis:*"], isolated: true,
    when: ({ state, status }) => (status === "stuck" && !state.budget.exhausted
      ? [{ why: "the board is stuck and the explore budget is not exhausted" }] : []),
  },
  {
    ks: "refute", mode: "refute", projection: "isolated_debater", priority: 70,
    needs_lease: [], writes: ["hypothesis:*", "critique:*"], isolated: true,
    when: ({ state }) => state.hypotheses.filter(h => h.status === "open")
      .map(h => ({ claim: h.key, why: `hypothesis ${h.key} is open and unrefuted` })),
  },
  {
    ks: "synthesize", mode: "synthesize", projection: "synthesizer", priority: 80,
    needs_lease: [], writes: ["hypothesis:*"],
    // Two isolated forks and no writer still inside one. Synthesising a fork mid-write reads a
    // half-finished position as a settled one.
    when: ({ store, state }) => {
      // Forks carrying a CLAIM, not merely forks. A scout's fork holds evidence and nothing contested,
      // and synthesising two evidence-only forks produces a summary of an argument nobody had --
      // which fired here the moment intake started using isolated refs.
      const contested = state.isoRefs.filter(r => {
        try { return Object.keys(treeSlots(store, r.cid)).some(s2 => s2.startsWith("hypothesis:")); }
        catch { return false; }
      });
      const writing = Object.values(state.occupancy).filter(o => o.status === "running" && o.branch === "iso").length;
      return contested.length >= 2 && writing === 0
        ? [{ forks: contested.map(r => r.name),
            why: `${contested.length} isolated fork(s) carry a claim and no isolated writer is still running` }]
        : [];
    },
  },
  {
    ks: "discuss", mode: "discuss", projection: "isolated_debater", priority: 99,
    needs_lease: [], writes: ["hypothesis:*"], isolated: true,
    // A free seat is not a reason. Discussion is scheduled when the board is genuinely stuck or has
    // recorded a split AND there is an open question to discuss -- never because the grid has an
    // empty chair. The first version of this predicate returned "a seat is free", which made discuss
    // eligible during PLANNING, and that is the whole failure mode in one line.
    when: ({ state, status }) => {
      if (!["stuck", "split"].includes(status)) return [];
      const open = state.decisions.filter(d => d.resolution?.type === "split");
      const claims = state.hypotheses.filter(h => h.status === "open");
      return open.length || claims.length
        ? [{ why: `board is ${status} with ${open.length} recorded split(s) and ${claims.length} open claim(s)` }]
        : [];
    },
    // The single rule that would have kept a 72-hour run on the lock helper.
    blocked_when: ({ state, status }) => {
      const ready = state.items.filter(i => i.state === "ready" && dependenciesMet(state, i));
      if (ready.length) return `${ready.length} work item(s) are ready (${ready.map(i => i.key).join(", ")}); discuss is never a peer of work`;
      if (status === "executing") return "the board is executing";
      return null;
    },
  },
];

/**
 * What should run now. Returns every candidate with the reason it was kept or dropped -- the reason
 * is the part a human needs when the scheduling turns out wrong, and a scheduler that returns only
 * its picks cannot be audited.
 */
export function schedule({ store, refs, runtime = null, ref, triggers = TRIGGERS, max = Infinity, now = Date.now() }) {
  const state = boardState({ store, refs, runtime, ref });
  const { status, why: statusWhy } = boardStatus({ store, state });
  const ctx = { store, refs, runtime, state, status, now };

  const ready = [], dropped = [], notes = [];

  if (status === "intake") {
    // The board cannot schedule its own intake, and silence here would read as "nothing to do".
    // A scout runs OUTSIDE the chain (src/role/seating.mjs INTAKE): its input is the raw question,
    // its output is evidence, and a human or the controller turns that evidence into a ticket. The
    // evidence arrives as LINEAGE -- the ticket cites it by cid -- not as a slot anybody merged.
    notes.push("INTAKE: no ticket on the board, and a ticket is not the controller's to write. " +
      "Scout outside the chain, then have a human or the controller write a ticket citing its evidence.");
  }

  if (state.budget.exhausted) {
    // Silent truncation reads as "covered everything".
    notes.push(`BUDGET: ${state.budget.why} -- only integrate and human-facing work would be scheduled`);
  }

  for (const t of [...triggers].sort((a, b) => a.priority - b.priority)) {
    const block = t.blocked_when?.(ctx);
    if (block) { dropped.push({ ks: t.ks, why: `blocked: ${block}` }); continue; }
    if (state.budget.exhausted && !["integrate"].includes(t.ks)) {
      dropped.push({ ks: t.ks, why: `blocked: ${state.budget.why}` });
      continue;
    }
    let candidates;
    try { candidates = t.when(ctx) ?? []; }
    catch (e) { dropped.push({ ks: t.ks, why: `predicate threw: ${e.message}` }); continue; }
    if (candidates.length === 0) { dropped.push({ ks: t.ks, why: "predicate not satisfied" }); continue; }
    for (const c of candidates) {
      ready.push({ ks: t.ks, mode: t.mode, projection: t.projection, priority: t.priority,
        needs_lease: t.needs_lease, writes: t.writes, isolated: Boolean(t.isolated), ...c });
    }
  }

  // Two ready invocations that would lease the same resource cannot both run: one writer of a name
  // at a time. Dropping the later one here, loudly, beats letting both start and having the second
  // discover it at the ref swap.
  const claimed = new Set(), final = [];
  for (const r of ready) {
    if (r.resource && claimed.has(r.resource)) {
      dropped.push({ ks: r.ks, ...r, why: `another scheduled invocation already claims ${r.resource}` });
      continue;
    }
    if (final.length >= max) {
      notes.push(`CAP: ${ready.length - final.length} eligible invocation(s) dropped by max=${max}; this is reduced coverage, not an empty queue`);
      dropped.push({ ks: r.ks, ...r, why: `dropped by max=${max}` });
      continue;
    }
    if (r.resource) claimed.add(r.resource);
    final.push(r);
  }

  return {
    ref, commit: state.commit, short: state.commit ? shortCid(state.commit) : null,
    status, status_why: statusWhy,
    ready: final, dropped, notes,
    budget: state.budget,
    basis: "scheduled from board predicates by deterministic code; no model chose the next speaker",
  };
}

/** Sanity check for a hand-written trigger table. */
export function validateTriggers(triggers = TRIGGERS) {
  const problems = [];
  for (const t of triggers) {
    if (!MODES.has(t.mode)) problems.push(`${t.ks}: unknown mode "${t.mode}"`);
    if (typeof t.when !== "function") problems.push(`${t.ks}: no predicate`);
    if (!Number.isFinite(t.priority)) problems.push(`${t.ks}: no priority`);
  }
  const seen = new Set();
  for (const t of triggers) { if (seen.has(t.ks)) problems.push(`duplicate ks "${t.ks}"`); seen.add(t.ks); }
  return { ok: problems.length === 0, problems };
}
