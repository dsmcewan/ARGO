#!/usr/bin/env node
// Drive one ticket through the board, printing what the CONTROLLER decides at every step.
//
// No vendor is called. That is deliberate: the point of this script is that the schedule is a
// function of board state, so it must be reproducible without a model in the loop. Each knowledge
// source here is a canned producer standing in for a seat; swapping in `sdkTurn` changes who writes
// the entry and nothing about when it is scheduled.
//
//   node scripts/board-run.mjs [--dir <path>] [--verbose]
import { ship } from "../src/board/integrate.mjs";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openBoard } from "../src/board/index.mjs";
import { publish, treeSlots } from "../src/board/dag.mjs";
import { merge } from "../src/board/merge.mjs";
import { schedule, boardState } from "../src/board/controller.mjs";

// A carry merge collects what the controller needs in order to SCHEDULE: item states, verdicts,
// claims. It deliberately cannot move an artifact slot -- shipping is a separate, scheduled act.
const CARRY = ["plan", "item:", "critique:", "hypothesis:", "decision:"];
import { project, PROJECTION_FOR_ROLE } from "../src/board/project.mjs";
import { shortCid } from "../src/board/canon.mjs";
import { seatingPlan, seatingReport, reviewPlan, assertReviewCutsAcross, subtreeCost, DEPTH_LIMIT,
  INTAKE, assertFanOutIsOutside } from "../src/role/seating.mjs";
import { promptFor } from "../src/role/roles.mjs";

const argv = process.argv.slice(2);
const flag = (name, d = null) => { const i = argv.indexOf(name); return i === -1 ? d : (argv[i + 1] ?? true); };
const VERBOSE = argv.includes("--verbose");
const dir = flag("--dir") ?? mkdtempSync(join(tmpdir(), "pantheon-run-"));
const ephemeral = !flag("--dir");

const REF = "refs/board/fenced-lease";
const SLOT = "src/seat/lock.mjs";
const ITEM = "withSeatLock";
const TEST_CMD = "node --test tests/board-refs.test.mjs";

const board = openBoard(dir);
const HUMAN = { vendor: "human" };
const CONTROLLER = { vendor: "controller" };

// The agent hierarchy is resolved ONCE, up front, and printed with the grounds for every seat. Roles
// are bound to vendors here; nothing downstream re-decides, and the reviewer is chosen by derangement
// from the producer rather than by rank.
const plan = seatingPlan({ roles: ["planner", "implementer", "reviewer", "judge"] });
if (!plan.ok) throw new Error(`seating failed: ${plan.why}`);
const pick = role => plan.assigned[role];

const bar = s => console.log(`\n\x1b[1m${s}\x1b[0m`);
const say = (k, v) => console.log(`  ${k.padEnd(14)} ${v}`);

const intakePlan = seatingPlan({ roles: ["scout"], seating: INTAKE });
if (!intakePlan.ok) throw new Error(`intake seating failed: ${intakePlan.why}`);

bar("seating");
// ROLE, then PACK, then LAB, then STAFFING. Printing the model beside the role is how the model gets
// mistaken for the job -- and then a 429 reads as "this model cannot plan" instead of "this hose is shut".
for (const r of seatingReport(plan)) console.log(`  ${r.line}`);
say("pools", `${plan.pools.join(", ")}  —  ${plan.contention.quota ?? "independent quota"}`);
if (plan.taste.length) say("TASTE", plan.taste.join("; "));
say("subagents", `depth <= ${DEPTH_LIMIT}; ${subtreeCost(plan.assigned.implementer.vendor, 3).why}`);
say("basis", plan.basis);
say("intake", `scout ${intakePlan.assigned.scout.vendor} · ${intakePlan.assigned.scout.model} — OUTSIDE the chain`);

// --- INTAKE: before the board exists. The only stage where fan-out belongs. ---
// agy_google commented out 2026-09-29 (operator instruction); restore ["agy_google", "xai"] when the account is confirmed stable.
const SCOUTS = ["xai"]; // ["agy_google", "xai"]
assertFanOutIsOutside({ stage: "intake", depth: 0, width: SCOUTS.length });
bar(`intake  —  ${SCOUTS.length} scouts, depth 0, ${SCOUTS.length} independent pools`);
const findings = [];
for (const vendor of SCOUTS) {
  const seat = { vendor, seat_id: `${vendor}-scout`, mode: "explore", occupancy_gen: 1 };
  const ref = `refs/iso/${vendor}/scout`;
  // An ORPHAN commit, necessarily: there is no board to branch from yet. That is precisely why a
  // scout's output enters the board as lineage (the ticket cites it) rather than as ancestry.
  const r = await publish({ ...board, ref, author: seat, msg: `scout ${vendor}`,
    entries: [{ kind: "repro", payload: { cmd: `node --test tests/seat-lock.test.mjs`, exit: 0 },
      blob: `${vendor} ran the existing lock suite: green, and none of its cases fences a live holder\n` }] });
  if (!r.ok) throw new Error(`scout ${vendor}: ${r.why}`);
  findings.push(r.written[0].cid);
  say(vendor, `${shortCid(r.written[0].cid)}  repro on ${ref.replace("refs/", "")} (orphan: no board yet)`);
}
try {
  assertFanOutIsOutside({ stage: "chain", depth: 0, width: 2 });
  say("WARNING", "a fan-out inside the chain was NOT refused");
} catch (e) { say("refused", e.message.split(":")[0] + " — breadth belongs before commitment"); }

function report(tag) {
  const s = schedule({ ...board, ref: REF });
  bar(`${tag}  —  ${s.status}`);
  say("head", s.short ?? "(unset)");
  say("why", s.status_why);
  for (const r of s.ready) {
    say("READY", `${r.ks} → ${r.mode}/${r.projection}  ${r.item ?? r.resource ?? ""}`);
    say("", `  ${r.why}`);
  }
  if (VERBOSE) for (const d of s.dropped) say("dropped", `${d.ks}: ${d.why}`);
  else {
    const blocked = s.dropped.filter(d => /^blocked:/.test(d.why));
    for (const d of blocked) say("BLOCKED", `${d.ks}: ${d.why.replace(/^blocked: /, "")}`);
  }
  for (const n of s.notes) say("NOTE", n);
  return s;
}

// --- L0: the human states the ticket. No seat may write one. ---
// The ticket CITES the scouts' evidence. That link is how pre-board work enters: the entries are
// orphans on isolated refs, and the ticket's lineage is what makes them reachable from the board.
const t = await publish({ ...board, ref: REF, author: HUMAN, msg: "the ticket",
  entries: [{ kind: "ticket", links: { derived_from: findings }, payload: {
    title: "replace the seat mutex with a fenced lease",
    goal: "a slow holder must not be able to write after being fenced",
    repo: "pantheon",
    constraints: ["zero runtime dependencies"],
    forbidden: ["do not elect a vendor as judge"],
    acceptance: [{ type: "tests", cmd: TEST_CMD, expect: "exit0" }],
  } }] });
if (!t.ok) throw new Error(t.why);
report("ticketed");

// --- L3: a planner seat, on its OWN branch. The controller adopts it. ---
{
  const planner = pick("planner");
  const seat = { vendor: planner.vendor, seat_id: `${planner.vendor}-plan`, mode: "plan", occupancy_gen: 1 };
  const wip = `refs/seat/${seat.seat_id}/wip`;
  await board.refs.branch({ name: wip, from: REF, author: seat });

  // What the planner is allowed to read, and the prompt built from exactly that.
  const { slice, withheld } = project(board.store, board.refs.resolve(REF), PROJECTION_FOR_ROLE.planner);
  const p = promptFor("planner", { ticket: slice.slots.ticket.payload.goal }, "plan the work");
  bar(`plan  —  ${planner.vendor} (${planner.model})`);
  say("reads", Object.keys(slice.slots).join(", "));
  say("withheld", withheld.map(w => w.slot).join(", ") || "(nothing)");
  if (VERBOSE) say("prompt", `${p.prompt.slice(0, 90)}…`);

  const r = await publish({ ...board, ref: wip, author: seat, msg: "plan",
    entries: [
      { kind: "plan", payload: { steps: [{ item: ITEM, title: "wrap the read-modify-write in a fenced lease" }] } },
      { kind: "work_item", payload: { key: ITEM, title: "wrap the read-modify-write in a fenced lease",
        state: "ready", artifact_slots: [`artifact:${SLOT}`], preferred_mode: "work" } },
    ] });
  if (!r.ok) throw new Error(r.why);
  const m = await merge({ ...board, into: REF, from: wip, author: CONTROLLER, msg: "adopt the plan" });
  if (!m.ok) throw new Error(m.why);
}
report("planned");

// --- L4: the worker holds a lease on the item, writes to its own branch, offers the branch. ---
let offer;
{
  const w = pick("implementer");
  const seat = { vendor: w.vendor, seat_id: `${w.vendor}-work`, mode: "work", occupancy_gen: 1 };
  const wip = `refs/seat/${seat.seat_id}/wip`;
  await board.refs.branch({ name: wip, from: REF, author: seat });
  const lease = await board.runtime.acquire({ resource: `item:${ITEM}`, holder: seat, ttlMs: 120_000 });
  board.runtime.setOccupancy(seat.seat_id, { status: "running", mode: "work", branch: "wip", ref: wip });

  const { slice, withheld } = project(board.store, board.refs.resolve(REF), PROJECTION_FOR_ROLE.implementer, { reader: seat, item: ITEM });
  bar(`work  —  ${w.vendor} (${w.model})  lease gen ${lease.lease.gen}`);
  say("reads", Object.keys(slice.slots).join(", "));
  say("withheld", withheld.map(w2 => w2.kind ?? w2.slot).join(", ") || "(nothing)");

  const body = "export async function withSeatLock(key, fn, { gen }) { /* fenced */ }\n";
  const a = await publish({ ...board, ref: wip, author: seat, lease: { resource: `item:${ITEM}`, gen: lease.lease.gen },
    msg: "MAKER DEFENSE: this is correct because I was careful",
    entries: [{ kind: "artifact", payload: { slot: SLOT, path: SLOT, rev: 1, summary: "lease-scoped seat lock" }, blob: body }] });
  if (!a.ok) throw new Error(a.why);
  const artifactCid = treeSlots(board.store, a.commit)[`artifact:${SLOT}`];

  // The run that will have to satisfy acceptance, CITING the revision it ran against.
  // The CONTROLLER runs the suite. The maker's own green is recorded and shown but does not close the
  // TESTS gate -- otherwise "acceptance is executed, never asserted" holds only while no maker lies.
  await publish({ ...board, ref: wip, author: CONTROLLER, msg: "the suite on this revision",
    entries: [{ kind: "repro", payload: { cmd: TEST_CMD, exit: 0 }, blob: "# tests 14\n# pass 14\n",
      links: { derived_from: [artifactCid] } }] });

  const o = await publish({ ...board, ref: wip, author: seat, msg: "offer it",
    entries: [{ kind: "work_item", links: { offer: [artifactCid] },
      payload: { key: ITEM, title: "wrap the read-modify-write in a fenced lease", state: "offered_review",
        offer_ref: wip, artifact_slots: [`artifact:${SLOT}`] } }] });
  if (!o.ok) throw new Error(o.why);
  await merge({ ...board, into: REF, from: wip, author: CONTROLLER, msg: "carry the offer", only: CARRY });
  await board.runtime.release({ resource: `item:${ITEM}`, holder: seat, gen: lease.lease.gen });
  board.runtime.setOccupancy(seat.seat_id, { status: "done", mode: "work", branch: "wip", ref: wip });
  offer = { wip, vendor: w.vendor, artifactCid, bytes: board.store.get(artifactCid).links.bytes };
}
const offered = report("offered for review");

// --- L5: the reviewer is a different vendor by construction, and never reads the defense. ---
{
  const cand = offered.ready.find(r => r.ks === "critique");
  // The review edge must cut ACROSS the chain: not the producer, and not the seat that assigned the
  // work. A layer reviewing the layer below is grading its own plan.
  const pairing = reviewPlan({ producers: [offer.vendor], assigner: plan.assigned.planner.vendor })[0];
  if (!pairing.reviewer) throw new Error(`no clean reviewer: ${pairing.why}`);
  assertReviewCutsAcross({ assigner: { vendor: plan.assigned.planner.vendor },
    producer: { vendor: offer.vendor }, reviewer: { vendor: pairing.reviewer } });
  const seat = { vendor: pairing.reviewer, seat_id: `${pairing.reviewer}-critique`, mode: "critique", occupancy_gen: 1 };
  const rref = `refs/seat/${seat.seat_id}/wip`;
  await board.refs.branch({ name: rref, from: offer.wip, author: seat });

  const { slice, withheld } = project(board.store, board.refs.resolve(offer.wip), PROJECTION_FOR_ROLE.reviewer, { reader: seat });
  bar(`critique  —  ${pairing.reviewer} reviews ${offer.vendor} (planner ${plan.assigned.planner.vendor} excluded)`);
  say("why", pairing.why);
  say("target", shortCid(cand.target));
  say("reads", Object.keys(slice.slots).join(", "));
  say("withheld", withheld.map(w => w.why).slice(0, 3).join(" / "));

  const r = await publish({ ...board, ref: rref, author: seat, msg: "review",
    entries: [{ kind: "critique", links: { target: offer.bytes },
      payload: { target: { slot: SLOT, rev: 1 }, verdict: "approve",
        findings: [{ severity: "nit", loc: `${SLOT}:1`, note: "name the generation in the error text" }] } }] });
  if (!r.ok) throw new Error(r.why);
  const back = await merge({ ...board, into: offer.wip, from: rref, author: CONTROLLER, msg: "collect the verdict" });
  if (!back.ok) throw new Error(back.why);
  await merge({ ...board, into: REF, from: offer.wip, author: CONTROLLER, msg: "carry the verdict", only: CARRY });
}
const reviewed = report("reviewed");

// --- L6/integrate: the controller merges, and bound-review is what lets the slot move. ---
{
  const cand = reviewed.ready.find(r => r.ks === "integrate");
  if (!cand) { console.log("\nintegrate was not scheduled; nothing further to do."); }
  else {
    bar("integrate  —  controller");
    say("why", cand.why);
    // Through ship(), never merge(). merge() onto the shipping ref was a second door that needed only a
    // cross-lab approval -- no ACTOR, TESTS or LEASE gate -- and this script used to walk through it.
    // It now refuses that (code SHIP_ONLY), and this is the transaction that evaluates all eight gates.
    const m = await ship({ ...board, ref: REF, from: cand.merge_from, actor: CONTROLLER });
    say("gates", m.gates.map(g => `${g.gate}${g.ok ? "" : "✗"}`).join(" "));
    say("shipped", m.ok ? `${(m.changed ?? []).join(", ")}` : `REFUSED at ${m.refused}: ${m.why}`);
    if (m.ok) {
      await publish({ ...board, ref: REF, author: CONTROLLER, msg: "close the item",
        entries: [{ kind: "work_item", payload: { key: ITEM, title: "wrap the read-modify-write in a fenced lease", state: "done", artifact_slots: [`artifact:${SLOT}`] } }] });
    }
  }
}
const done = report("integrated");

bar("board");
const st = boardState({ ...board, ref: REF });
for (const [slot, e] of Object.entries(st.bySlot)) say(slot, `${shortCid(e.cid)}  ${e.kind}${e.visibility === "isolated" ? " (isolated)" : ""}`);
say("objects", `${board.store.count()} in the store`);
say("refs", board.refs.list().map(r => `${r.name.replace("refs/", "")}=${shortCid(r.cid).split(":")[1]}`).join("  "));
say("budget", `${st.budget.spent_turns} turn(s) recorded, derived from the side log`);
if (ephemeral) { rmSync(dir, { recursive: true, force: true }); say("dir", "(temporary, removed)"); }
else say("dir", dir);
