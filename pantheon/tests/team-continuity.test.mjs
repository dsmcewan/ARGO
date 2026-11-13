import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { decided, abandoned, claimFiles, recordOccupancy, restoreBrief, loadChair, BRIEF_CAP_BYTES, ContinuityViolation } from "../src/team/continuity.mjs";

const homes = [];
after(() => { for (const h of homes) fs.rmSync(h, { recursive: true, force: true }); });
const mk = () => { const h = fs.mkdtempSync(path.join(os.tmpdir(), "chair-")); homes.push(h); return h; };
const at = (home, address = "impl@build") => ({ address, cwd: "/repo", home });

// THE DEFECT. Trimming inserted a {note} object into the list, which the brief rendered as "- undefined",
// and every further trim reset the count to the size of the latest cut.
test("trimming keeps an accumulating count, and the brief never prints 'undefined'", async () => {
  const c = at(mk());
  for (let i = 1; i <= 15; i++) await decided({ ...c, what: `d${i}`, why: `w${i}` });
  const b = restoreBrief(c);
  assert.ok(!b.text.includes("undefined"), b.text);
  assert.equal(b.record.decided.length, 12);
  assert.equal(b.record.dropped.decisions, 3, "cumulative, not the size of the last cut");
  assert.match(b.text, /3 older not shown/);
  assert.match(b.text, /d15/); assert.ok(!b.text.includes("- d1 "), "the oldest is gone");
});

test("a dead end without its reason is refused; with it, it is the first thing the next occupant reads", async () => {
  const c = at(mk());
  await assert.rejects(abandoned({ ...c, what: "use a queue" }), /needs its reason/);
  await abandoned({ ...c, what: "use a queue", why: "writer set is not disjoint" });
  assert.match(restoreBrief(c).text, /do not re-propose[\s\S]*use a queue — writer set is not disjoint/);
});

// THE DEFECT. A brief could be written for an address the roster does not know.
test("a brief needs a chair that exists", async () => {
  const c = at(mk(), "ghost@build");
  await assert.rejects(decided({ ...c, what: "x" }), /not in the roster/);
  assert.throws(() => loadChair(c), ContinuityViolation);
});

test("only a tree-writing pod may claim files", async () => {
  await assert.rejects(claimFiles({ ...at(mk(), "check@review"), files: ["a.mjs"] }), /does not write the tree/);
  const r = await claimFiles({ ...at(mk()), files: ["b.mjs", "a.mjs", "a.mjs"] });
  assert.deepEqual(r.files, ["a.mjs", "b.mjs"]);
});

test("the cap refuses rather than truncating, and names what to drop", async () => {
  const c = at(mk());
  const big = "x".repeat(BRIEF_CAP_BYTES);
  await assert.rejects(decided({ ...c, what: big }), /over the \d+ cap[\s\S]*do NOT raise the cap/);
  assert.equal(restoreBrief(c).record.decided.length, 0, "a refused write leaves nothing behind");
});

test("the brief is bound to the chair, not the occupant: it survives a reseat", async () => {
  const c = at(mk());
  await recordOccupancy({ ...c, vendor: "openai", gen: 1 });
  await decided({ ...c, what: "lock, not queue", why: "overlapping writers" });
  await recordOccupancy({ ...c, vendor: "anthropic", gen: 2 });
  const b = restoreBrief(c);
  assert.match(b.text, /LAST OCCUPIED BY anthropic \(gen 2\); held before by openai, anthropic/);
  assert.match(b.text, /lock, not queue/);
  assert.ok(!("transcript" in b.record), "no transcript, by construction");
});

test("a corrupt brief fails closed", async () => {
  const c = at(mk());
  await decided({ ...c, what: "d" });
  const p = path.join(c.home, "chairs", `${loadChair(c).key}.json`);
  fs.writeFileSync(p, "{nope");
  assert.throws(() => restoreBrief(c), /corrupt continuity brief/);
});

test("a legacy record with no `dropped` counters still loads", async () => {
  const c = at(mk());
  await decided({ ...c, what: "d" });
  const p = path.join(c.home, "chairs", `${loadChair(c).key}.json`);
  const raw = JSON.parse(fs.readFileSync(p, "utf8")); delete raw.dropped;
  fs.writeFileSync(p, JSON.stringify(raw));
  assert.deepEqual(loadChair(c).dropped, { decisions: 0, dead_ends: 0, occupancies: 0 });
});

// THE DEFECT, 2026-09-27 re-review. Every writer was a sync read-modify-write of one file, and three
// processes doing it at once lost half their writes: 3 x 20 decisions -> 30 kept, 30 gone. The atomic
// rename made each FILE consistent and did nothing for the pair of reads that raced. This is the repro,
// in real processes: the property is that nothing is lost -- kept + dropped must equal what was written.
const WRITER = `
import { decided } from "SRC/team/continuity.mjs";
import { existsSync } from "node:fs";
const [home, tag, barrier] = process.argv.slice(2);
while (!existsSync(barrier)) {}
for (let i = 0; i < 20; i++) await decided({ address: "impl@build", cwd: "/repo", home, what: tag + "-" + i, why: "w" });
process.stdout.write("done");
`;

test("three processes writing one chair at once lose nothing: kept + dropped == written", async () => {
  const home = mk();
  const src = new URL("../src", import.meta.url).href;
  const script = path.join(home, "writer.mjs");
  fs.writeFileSync(script, WRITER.replaceAll("SRC", src));
  const barrier = path.join(home, "go");
  const run = promisify(execFile);
  const kids = ["p", "q", "r"].map(tag => run(process.execPath, [script, home, tag, barrier], { timeout: 30_000 }));
  await new Promise(r => setTimeout(r, 200));      // let all three reach the barrier
  fs.writeFileSync(barrier, "go");
  const outs = await Promise.all(kids);
  assert.deepEqual(outs.map(o => o.stdout), ["done", "done", "done"]);
  const rec = loadChair({ address: "impl@build", cwd: "/repo", home });
  assert.equal(rec.decided.length + rec.dropped.decisions, 60,
    `every write must be accounted for: ${rec.decided.length} kept + ${rec.dropped.decisions} dropped`);
});

// THE DEFECT, 2026-09-27 re-review, rank 16. Only unparseable bytes failed closed; a number, a string, an
// array or null parsed fine, spread into the blank record, and loaded as a clean slate.
test("valid JSON that is not an object is a corrupt brief, not an empty one", async () => {
  const c = at(mk());
  await decided({ ...c, what: "d" });
  const p = path.join(c.home, "chairs", `${loadChair(c).key}.json`);
  for (const bad of ["42", '"a string"', "[1,2,3]", "null", "true"]) {
    fs.writeFileSync(p, bad);
    assert.throws(() => loadChair(c), ContinuityViolation, `payload ${bad} must fail closed`);
    assert.throws(() => restoreBrief(c), /corrupt continuity brief/, `payload ${bad} must not render as a brief`);
  }
});

// Found by an in-session probe: the same toJSON hole as law 4, on the brief's own cap.
test("the brief cap cannot be shrunk by a toJSON on the decision", async () => {
  const c = at(mk());
  const what = { toJSON() { return "tiny"; }, body: "x".repeat(BRIEF_CAP_BYTES) };
  await assert.rejects(decided({ ...c, what }), /over the \d+ cap/);
  assert.equal(restoreBrief(c).record.decided.length, 0);
});
