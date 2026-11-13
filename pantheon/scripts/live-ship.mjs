#!/usr/bin/env node
// THE MISSING FACT: a real vendor seat writing a board entry, and the controller shipping it.
//
// Everything in tests/board-*.test.mjs uses canned producers. That proves the FUNCTION -- the gates
// fire, the projections withhold, the refusals refuse -- and it proves nothing about whether a real
// occupant can write through this thing without lying about projections, lineage or ship. This script
// is the smallest run that settles that, and it is deliberately not a trial:
//
//   one ticket, one board
//   the implementer writes through the impl projection
//   another lab acks the BYTES
//   the controller ships
//   scout orphans stay disjoint
//
// n=1. It answers "can a vendor seat write a board entry", not "does multi-seat beat single". The
// kill criterion for the second question stays on the wall untouched.
//
// Every model call here is real. Acceptance is EXECUTED: the implementer's bytes are written to disk
// and run, and the exit code is what the TESTS gate reads.
//
//   source ~/Projects/agentic-pipeline/sdk/keys-from-windows.sh
//   node scripts/live-ship.mjs [--dir <path>]
import OpenAI from "openai";
import { GoogleGenAI } from "@google/genai";
import Anthropic from "@anthropic-ai/sdk";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { runAcceptance } from "../src/board/acceptance.mjs";
import { readArtifact, writeArtifact } from "../src/board/artifact-files.mjs";
import { join } from "node:path";
import { homedir } from "node:os";
import { makeClient } from "../src/sdk/adapter.mjs";
import { sdkTurn } from "../src/sdk/seat-sdk.mjs";
import { openBoard } from "../src/board/index.mjs";
import { publish, treeSlots } from "../src/board/dag.mjs";
import { merge, ancestors, mergeBase } from "../src/board/merge.mjs";
import { ship } from "../src/board/integrate.mjs";
import { boardState, boardStatus, schedule, testsBrief } from "../src/board/controller.mjs";
import { project, PROJECTION_FOR_ROLE } from "../src/board/project.mjs";
import { seatingPlan, seatingReport, reviewPlan, assertReviewCutsAcross, assertFanOutIsOutside, INTAKE,
  candidatesFor, shouldFallThrough } from "../src/role/seating.mjs";
import { promptFor } from "../src/role/roles.mjs";
import { shortCid, cidOf } from "../src/board/canon.mjs";
import { modelId } from "../src/config/models.mjs";

const argv = process.argv.slice(2);
const flag = (n, d = null) => { const i = argv.indexOf(n); return i === -1 ? d : argv[i + 1]; };
const root = flag("--dir") ?? join(homedir(), ".pantheon", "boards", `live-${Date.now()}`);
mkdirSync(root, { recursive: true });
const worktree = join(root, "worktree");
mkdirSync(worktree, { recursive: true });
const home = join(root, "seats");              // isolated: never the operator's real seat store

const board = openBoard(root);
const HUMAN = { vendor: "human" };
const CONTROLLER = { vendor: "controller" };
const REF = "refs/board/fence-check";
const SLOT = "fence-check.mjs";
const ITEM = "fenceCheck";
const FILE = join(worktree, SLOT);
const CMD = `/usr/bin/node ${SLOT}`;
const sandboxProbe = await runAcceptance({ worktree, cmd: "true", timeout: 10_000 });
if (sandboxProbe.exit !== 0) throw new Error(`acceptance isolation preflight refused: ${sandboxProbe.out}`);
const CARRY = ["plan", "item:", "critique:"];   // a carry never ships code

const bar = s => console.log(`\n\x1b[1m${s}\x1b[0m`);
const say = (k, v) => console.log(`  ${String(k).padEnd(13)} ${v}`);
let failures = 0;
const check = (ok, line) => { if (!ok) failures++; console.log(`  ${ok ? "\x1b[32mok  \x1b[0m" : "\x1b[31mFAIL\x1b[0m"}  ${line}`); };
const clients = {};
const clientFor = v => (clients[v] ??= makeClient(v, { OpenAI, GoogleGenAI, Anthropic }));

/** One real turn on one real seat. Returns the text, or throws with the vendor's own words. */
async function turn({ vendor, purpose, model, prompt }) {
  const t0 = Date.now();
  const r = await sdkTurn({ vendor, purpose, cwd: worktree, prompt, model, client: clientFor(vendor), home });
  if (!r.ok) throw new Error(`${vendor}/${purpose}: ${r.why}`);
  const text = r.result.text ?? "";
  say("", `${vendor} · ${model} · ${((Date.now() - t0) / 1000).toFixed(1)}s · ${text.length} chars · id=${r.result.response_id?.slice(0, 18) ?? "(none)"}`);
  return text;
}

/**
 * Run a role's turn, walking the seating table's fallbacks on a TRANSPORT failure.
 *
 * The first live attempt died here: the planner is seated on anthropic, whose pool is the operator's
 * own subscription, and it returned 429 under exactly the load this script creates. The seating had a
 * fallback rank and nothing consulted it at runtime -- which made the ranks decoration. A 4xx that is
 * not 429 does NOT fall through: the next vendor would refuse the same bad request, and reporting
 * that as a fallback would hide a bug behind a rate limit.
 */
async function roleTurn({ role, purpose, prompt, avoid = [] }) {
  const candidates = candidatesFor(role, { avoid });
  if (!candidates.length) throw new Error(`no seated candidate for "${role}"`);
  const tried = [];
  const deadPools = new Set();
  for (const c of candidates) {
    // A candidate in a hose that just refused with no interval is a WAIT dressed as a reseat. The chair
    // does not change; only the body does, and not usefully while the hose is shut.
    if (deadPools.has(c.pool)) {
      say("skip", `${c.vendor}/${c.model} is on the ${c.pool} hose, which just refused with no ` +
        `retry-after — that is a wait, not a reseat`);
      tried.push(`${c.vendor}: skipped, ${c.pool} hose shut`);
      continue;
    }
    try {
      const text = await turn({ vendor: c.vendor, purpose, model: c.model, prompt });
      if (c.rank > 0) say("reseat", `the ${role} chair is unchanged; the occupant is now ${c.vendor}/${c.model}. Tried: ${tried.join("; ")}`);
      return { text, seat: c };
    } catch (err) {
      const f = shouldFallThrough(err);
      tried.push(`${c.vendor}: ${f.why}`);
      say(c.vendor, `\x1b[33m${f.why}\x1b[0m`);
      if (!f.ok) throw err;
      if (f.same_vendor_viable) {
        // Waiting IS the right move here, in the same chair with the same body. The vendor SDKs are
        // constructed with maxRetries: 0 precisely so this is the ONLY retry and the log is true about
        // how many calls happened: a hidden layer taking three attempts under a line that says one
        // breaks the latency and spend accounting as well as the wait/reseat decision itself.
        const waitS = f.retry_after_s ?? 2;
        say("wait", `${waitS}s, then the same seat again (the only retry; the SDK's own is off)`);
        await new Promise(r => setTimeout(r, Math.min(waitS, 60) * 1000));
        try { return { text: await turn({ vendor: c.vendor, purpose, model: c.model, prompt }), seat: c }; }
        catch (e2) { tried.push(`${c.vendor}: still ${shouldFallThrough(e2).why}`); deadPools.add(c.pool); continue; }
      }
      deadPools.add(c.pool);          // no interval to wait for: this hose is out for this turn
    }
  }
  throw new Error(`every seated candidate for "${role}" was unavailable: ${tried.join("; ")}`);
}

const strip = t => t.replace(/^\s*```[a-z]*\s*\n?/i, "").replace(/\n?```\s*$/, "").trim();

// ---------------------------------------------------------------- seating
const chain = seatingPlan({ roles: ["planner", "implementer", "reviewer"] });
if (!chain.ok) throw new Error(chain.why);
const intake = seatingPlan({ roles: ["scout"], seating: INTAKE });
bar("seating");
for (const r of seatingReport(chain)) console.log(`  ${r.line}`);
say("scout", `${intake.assigned.scout.vendor} · ${intake.assigned.scout.model} — outside the chain`);
say("board", root);

const QUESTION = "A file lock records a pid and a nonce so a dead owner's lock can be reclaimed. " +
  "What does that design still fail to prevent when the owner is alive but slow?";

// ---------------------------------------------------------------- INTAKE (outside the chain)
// agy_google commented out 2026-09-29 (operator instruction); restore ["agy_google", "xai"] when the account is confirmed stable.
const SCOUTS = ["xai"]; // ["agy_google", "xai"]
assertFanOutIsOutside({ stage: "intake", depth: 0, width: SCOUTS.length });
bar(`intake — ${SCOUTS.length} scouts, depth 0, ${SCOUTS.length} independent pools`);
const scouts = [];
for (const vendor of SCOUTS) {
  const seat = { vendor, seat_id: `${vendor}-scout`, mode: "explore", occupancy_gen: 1 };
  const p = promptFor("scout", { question: QUESTION }, "Answer in at most three sentences.");
  const text = await turn({ vendor, purpose: "scout", model: intake.assigned.scout.vendor === vendor
    ? intake.assigned.scout.model : (vendor === "xai" ? modelId("xai", "grok-4.6") : modelId("google", "gemini-3.5-flash")), prompt: p.prompt });
  // `search` with an empty url list: this scout consulted no external source, only itself. Recorded
  // that way on purpose -- a model-only scout is a real limitation and it should be visible on the board.
  const r = await publish({ ...board, ref: `refs/iso/${vendor}/scout`, author: seat, msg: `scout ${vendor}`,
    entries: [{ kind: "search", payload: { query: QUESTION, urls: [] }, blob: text }] });
  if (!r.ok) throw new Error(`scout ${vendor} publish: ${r.why}`);
  scouts.push({ vendor, ref: `refs/iso/${vendor}/scout`, commit: r.commit, evidence: r.written[0].cid });
  say(vendor, `${shortCid(r.written[0].cid)} search on iso/${vendor}/scout (orphan: no board yet)`);
}
check(board.refs.resolve(REF) === null, "intake really precedes the board");

// ---------------------------------------------------------------- promote
bar("promote — the human writes the ticket, citing the scouts by cid");
const TICKET = {
  title: "a generation token the stale holder cannot forge",
  goal: `Write an ES module at ${SLOT} that exports accepts(heldGen, currentGen) returning true ONLY ` +
    `when the two are equal integers, and that self-tests on load: it must throw (non-zero exit) if ` +
    `accepts(1,2), accepts(2,1) or accepts("1",1) is true, or if accepts(3,3) is false.`,
  repo: "pantheon",
  constraints: ["ES module syntax", "no imports", "no dependencies"],
  forbidden: ["do not elect a vendor as judge"],
  acceptance: [{ type: "tests", cmd: CMD, expect: "exit0" }],
};
const t = await publish({ ...board, ref: REF, author: HUMAN, msg: "the ticket",
  entries: [{ kind: "ticket", links: { derived_from: scouts.map(s => s.evidence) }, payload: TICKET }] });
if (!t.ok) throw new Error(t.why);
say("head", shortCid(board.refs.resolve(REF)));
say("cites", scouts.map(s => shortCid(s.evidence)).join(", "));

// ---------------------------------------------------------------- plan
bar("plan");
const pl = chain.assigned.planner;
let plannerVendor = pl.vendor;
{
  const seat = { vendor: pl.vendor, seat_id: `${pl.vendor}-plan`, mode: "plan", occupancy_gen: 1 };
  const wip = `refs/seat/${seat.seat_id}/wip`;
  await board.refs.branch({ name: wip, from: REF, author: seat });
  const { slice, withheld } = project(board.store, board.refs.resolve(REF), PROJECTION_FOR_ROLE.planner);
  say("reads", Object.keys(slice.slots).join(", ") || "(nothing)");
  const p = promptFor("planner", { ticket: slice.slots.ticket.payload.goal },
    "Reply with exactly one line and nothing else: TITLE: <a one-line work item title>");
  const { text, seat: ran } = await roleTurn({ role: "planner", purpose: "plan", prompt: p.prompt });
  plannerVendor = ran.vendor;
  const m = text.match(/^\s*TITLE:\s*(.+)$/mi);
  if (!m) throw new Error(`planner did not answer in the required form; got: ${text.slice(0, 200)}`);
  const title = m[1].trim().slice(0, 120);
  say("title", title);
  const r = await publish({ ...board, ref: wip, author: seat, msg: "plan",
    entries: [
      { kind: "plan", payload: { steps: [{ item: ITEM, title }] } },
      { kind: "work_item", payload: { key: ITEM, title, state: "ready", artifact_slots: [`artifact:${SLOT}`], preferred_mode: "work" } },
    ] });
  if (!r.ok) throw new Error(`plan publish: ${r.why}`);
  const mg = await merge({ ...board, into: REF, from: wip, author: CONTROLLER, only: CARRY, msg: "adopt the plan" });
  if (!mg.ok) throw new Error(`adopt: ${mg.why}`);
}
const sched = schedule({ ...board, ref: REF });
say("status", `${sched.status} — ${sched.status_why}`);
say("ready", sched.ready.map(r => r.ks).join(", "));
check(sched.ready.some(r => r.ks === "work"), "the controller scheduled work from board state");
check(!sched.ready.some(r => r.ks === "discuss"), "and discuss is not a peer of work");

// ---------------------------------------------------------------- work (the missing fact)
bar("work — the implementer writes through the impl projection");
const im = chain.assigned.implementer;
const maker = { vendor: im.vendor, seat_id: `${im.vendor}-work`, mode: "work", occupancy_gen: 1 };
const wip = `refs/seat/${maker.seat_id}/wip`;
let artifactCid, bytes, code, recordedExit = null;
{
  await board.refs.branch({ name: wip, from: REF, author: maker });
  const lease = await board.runtime.acquire({ resource: `item:${ITEM}`, holder: maker, ttlMs: 300_000 });
  board.runtime.setOccupancy(maker.seat_id, { status: "running", mode: "work", ref: wip });
  say("lease", `item:${ITEM} gen ${lease.lease.gen}`);

  const { slice, withheld } = project(board.store, board.refs.resolve(REF), PROJECTION_FOR_ROLE.implementer,
    { reader: maker, item: ITEM });
  say("reads", Object.keys(slice.slots).join(", "));
  say("withheld", withheld.map(w => w.kind ?? w.slot).join(", ") || "(nothing)");
  check(!withheld.some(w => w.slot === "(commit message)") === false, "the maker's own defense is not in its brief");

  // `tests` is derived from the ticket's acceptance on the board, not typed here. Before any run
  // exists it says exactly that: what must run, and that nothing has been shown to pass yet.
  const implTests = testsBrief({ store: board.store, state: boardState({ ...board, ref: REF }), from: board.refs.resolve(wip) });
  const p = promptFor("implementer",
    { ticket: slice.slots.ticket.payload.goal, tests: implTests.text },
    "Output ONLY the module source. No prose, no markdown fence.");
  const made = await roleTurn({ role: "implementer", purpose: "work", prompt: p.prompt });
  code = strip(made.text);
  if (made.seat.vendor !== maker.vendor) throw new Error(
    `the implementer fell through to ${made.seat.vendor} but the seat identity is ${maker.vendor}: ` +
    `re-seating mid-run would mislabel who wrote the artifact, so this run stops rather than lie`);
  writeArtifact(worktree, SLOT, code.endsWith("\n") ? code : code + "\n");
  say("wrote", `${FILE} (${code.length} chars)`);

  const a = await publish({ ...board, ref: wip, author: maker, lease: { resource: `item:${ITEM}`, gen: lease.lease.gen },
    msg: "MAKER DEFENSE: this is correct, I checked it carefully",
    entries: [{ kind: "artifact", payload: { slot: SLOT, path: SLOT, rev: 1, summary: "generation equality gate" }, blob: readFileSync(FILE) }] });
  if (!a.ok) throw new Error(`artifact publish: ${a.why}`);
  artifactCid = treeSlots(board.store, a.commit)[`artifact:${SLOT}`];
  bytes = board.store.get(artifactCid).links.bytes;
  check(true, `a vendor seat wrote a board entry: ${shortCid(artifactCid)} by ${maker.vendor} (bytes ${shortCid(bytes)})`);

  // ACCEPTANCE IS EXECUTED. No model grades this.
  const accepted = await runAcceptance({ worktree, cmd: CMD, timeout: 20_000 });
  let { exit, out } = accepted;
  const actual = readArtifact(worktree, SLOT);
  if (actual === null || cidOf("blob", actual) !== bytes) { exit = 1; out += "\nArtifact changed during acceptance.\n"; }
  recordedExit = exit;
  say("ran", `${CMD} → exit ${exit}`);
  // Authored by the CONTROLLER: a maker's own green does not close the TESTS gate any more.
  const rp = await publish({ ...board, ref: wip, author: CONTROLLER, msg: `the suite on rev 1`,
    entries: [{ kind: "repro", payload: { cmd: CMD, exit, isolation: accepted.isolation }, blob: out || "(no output)", links: { derived_from: [artifactCid] } }] });
  if (!rp.ok) throw new Error(`repro publish: ${rp.why}`);

  // The offer moves item:<key>, which the maker itself holds, so it presents the lease: since fencing
  // stopped being opt-in (2026-09-27) an offer without it is refused LEASE_REQUIRED.
  const o = await publish({ ...board, ref: wip, author: maker, lease: { resource: `item:${ITEM}`, gen: lease.lease.gen }, msg: "offer it for review",
    entries: [{ kind: "work_item", links: { offer: [artifactCid] },
      payload: { key: ITEM, title: TICKET.title, state: "offered_review", offer_ref: wip, artifact_slots: [`artifact:${SLOT}`] } }] });
  if (!o.ok) throw new Error(`offer publish: ${o.why}`);
  await merge({ ...board, into: REF, from: wip, author: CONTROLLER, only: CARRY, msg: "carry the offer" });
  await board.runtime.release({ resource: `item:${ITEM}`, holder: maker, gen: lease.lease.gen });
  board.runtime.setOccupancy(maker.seat_id, { status: "done", mode: "work", ref: wip });
  check(board.runtime.leaseFor(`item:${ITEM}`).state === "released", "and released its lease");
  check(treeSlots(board.store, board.refs.resolve(REF))[`artifact:${SLOT}`] === undefined,
    "bound-review holds the code OFF the shipping ref until it is acked");
}

// ---------------------------------------------------------------- check (other lab, on the bytes)
bar("check — another lab, acking the bytes");
{
  const pairing = reviewPlan({ producers: [maker.vendor], assigner: plannerVendor })[0];
  if (!pairing.reviewer) throw new Error(`no clean reviewer: ${pairing.why}`);
  assertReviewCutsAcross({ assigner: { vendor: plannerVendor }, producer: { vendor: maker.vendor }, reviewer: { vendor: pairing.reviewer } });
  say("edge", `${pairing.reviewer} reviews ${maker.vendor} — ${pairing.why}`);
  const seat = { vendor: pairing.reviewer, seat_id: `${pairing.reviewer}-critique`, mode: "critique", occupancy_gen: 1 };
  const rref = `refs/seat/${seat.seat_id}/wip`;
  await board.refs.branch({ name: rref, from: wip, author: seat });

  const { slice, withheld } = project(board.store, board.refs.resolve(wip), PROJECTION_FOR_ROLE.reviewer, { reader: seat });
  check(withheld.some(w => w.slot === "(commit message)"), "the checker cannot read the maker's defense");
  check(slice.commit_msg === undefined, "and it is absent from the brief, not merely unmentioned");
  // The `tests` mount is DERIVED from the board -- the ticket's acceptance plus the repro that cites
  // these bytes, with its exit and output -- never typed here. The line this replaces was the fixed
  // string "It was run as ${CMD} and exited 0.", which told the reviewer the suite passed on a run
  // whose repro had recorded exit 1 (docs/reviews/2026-09-27-orchestration-rereview-addendum.md).
  const reviewTests = testsBrief({ store: board.store, state: boardState({ ...board, ref: REF }),
    artifact: { cid: artifactCid }, from: board.refs.resolve(wip) });
  check(new RegExp(`exited ${recordedExit}\\b`).test(reviewTests.text),
    `the reviewer's tests brief says "exited ${recordedExit}", as the repro recorded`);
  check(!(recordedExit !== 0 && /exited 0\b/.test(reviewTests.text)),
    "and a failed run is never described to the reviewer as exited 0");
  const p = promptFor("reviewer",
    { ticket: slice.slots.ticket.payload.goal, artifact: code, tests: reviewTests.text },
    "End your reply with a line reading exactly `VERDICT: approve` or `VERDICT: request_changes`.");
  const text = await turn({ vendor: seat.vendor, purpose: "critique", model: pairing.model, prompt: p.prompt });
  const m = text.match(/^\s*VERDICT:\s*(approve|request_changes)\s*$/mi);
  if (!m) throw new Error(`reviewer did not give a parseable verdict; tail: ${text.slice(-200)}`);
  const verdict = m[1].toLowerCase();
  say("verdict", verdict);
  const findings = verdict === "approve" ? [] : [{ severity: "block", note: text.slice(0, 400) }];
  const c = await publish({ ...board, ref: rref, author: seat, msg: "review",
    entries: [{ kind: "critique", links: { target: bytes }, payload: { target: { slot: SLOT, rev: 1 }, verdict, findings } }] });
  if (!c.ok) throw new Error(`critique publish: ${c.why}`);
  const back = await merge({ ...board, into: wip, from: rref, author: CONTROLLER, only: ["critique:"], msg: "collect the verdict" });
  if (!back.ok) throw new Error(`collect: ${back.why}`);
  await merge({ ...board, into: REF, from: wip, author: CONTROLLER, only: CARRY, msg: "carry the verdict" });
}

// ---------------------------------------------------------------- ship (controller only)
bar("ship — controller transaction");
const isoBefore = Object.fromEntries(board.refs.list().filter(r => r.name.startsWith("refs/iso/")).map(r => [r.name, r.cid]));
const headBefore = board.refs.resolve(REF);

for (const chairV of [maker.vendor, plannerVendor]) {
  const bad = await ship({ ...board, ref: REF, from: wip, actor: { vendor: chairV, seat_id: `${chairV}-x`, mode: "integrate", occupancy_gen: 1 } });
  check(bad.ok === false && bad.refused === "ACTOR", `law 6: ${chairV} refused at ACTOR — ${bad.why.split(":")[1]?.trim().slice(0, 60) ?? ""}`);
}
check(board.refs.resolve(REF) === headBefore, "and no chair moved the head");

const r = await ship({ ...board, ref: REF, from: wip, actor: CONTROLLER });
for (const g of r.gates) say(g.gate, g.ok ? "\x1b[32mpass\x1b[0m" : `\x1b[31mREFUSE\x1b[0m ${g.why}`);
check(r.ok, r.ok ? `shipped ${r.shipped.join(", ")} as ${shortCid(r.commit)}` : `ship refused: ${r.why}`);

bar("assertions");
if (r.ok) {
  const after = board.refs.resolve(REF);
  check(after !== headBefore, `board HEAD moved ${shortCid(headBefore)} → ${shortCid(after)}`);
  check(Boolean(treeSlots(board.store, after)[`artifact:${SLOT}`]), "the artifact is on the shipping ref");
  const commit = board.store.get(after);
  check(commit.author.vendor === "controller" && commit.author.seat_id === undefined,
    `no seat id in the ship actor (author=${JSON.stringify(commit.author)})`);
  const anc = ancestors(board.store, after);
  check(scouts.every(s => !anc.has(s.commit)), "scout orphans are NOT ancestors of the board");
  check(scouts.every(s => mergeBase(board.store, after, s.commit) === null), "the two histories stay disjoint");
  const ticket = board.store.get(treeSlots(board.store, after).ticket);
  check(scouts.every(s => ticket.links.derived_from.includes(s.evidence)), "but the ticket cites every scout by cid");
  const isoAfter = Object.fromEntries(board.refs.list().filter(x => x.name.startsWith("refs/iso/")).map(x => [x.name, x.cid]));
  check(JSON.stringify(isoAfter) === JSON.stringify(isoBefore), "iso/* unchanged");
  const st = boardStatus({ store: board.store, state: boardState({ ...board, ref: REF }) });
  say("status", `${st.status} — ${st.why}`);
}

bar("board");
const st = boardState({ ...board, ref: REF });
for (const [slot, e] of Object.entries(st.bySlot)) say(slot, `${shortCid(e.cid)} ${e.kind} by ${e.author.vendor}`);
say("objects", `${board.store.count()} in the store`);
say("refs", board.refs.list().map(x => `${x.name.replace("refs/", "")}`).join("  "));
say("dir", root);
console.log(`\n${failures === 0 ? "\x1b[32mALL CHECKS PASSED\x1b[0m" : `\x1b[31m${failures} CHECK(S) FAILED\x1b[0m`}`);
process.exit(failures === 0 ? 0 : 1);
