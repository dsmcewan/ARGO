import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { sdkTurn } from "../src/sdk/seat-sdk.mjs";

// THE DEFECT, 2026-09-27 re-review, rank 6. history.mjs closes two crash windows around the two-phase
// write; the window BEFORE them was open: sendTurn completes -- the vendor may have executed a tool --
// and the process dies before the first byte reaches disk. Nothing then records that the exchange
// happened. It cannot be made atomic, so it is made visible: an intent record before the call, removed
// once the seat record is on disk, and a lingering one REFUSES the next turn until acknowledged.

const homes = [];
after(() => { for (const h of homes) fs.rmSync(h, { recursive: true, force: true }); });
const mkHome = () => { const h = fs.mkdtempSync(path.join(os.tmpdir(), "pantheon-intent-")); homes.push(h); return h; };
const SEAT = { vendor: "openai", purpose: "intent-test", cwd: "/c" };
const reply = n => ({ id: `resp_${n}`, output_text: `hi${n}`,
  output: [{ role: "assistant", type: "message", content: [{ type: "output_text", text: `hi${n}` }] }] });
const client = () => { let n = 0; const c = { calls: 0, responses: { create: async () => { c.calls++; return reply(++n); } } }; return c; };
const intents = home => fs.existsSync(path.join(home, "intents")) ? fs.readdirSync(path.join(home, "intents")) : [];

test("a completed turn leaves no intent behind", async () => {
  const home = mkHome();
  const r = await sdkTurn({ ...SEAT, prompt: "one", client: client(), home, continuity: "replay" });
  assert.equal(r.ok, true, r.why);
  assert.deepEqual(intents(home), []);
});

// THE REPRO: the vendor answers and the process dies before anything is written.
const DYING = `
import { sdkTurn } from "SRC/sdk/seat-sdk.mjs";
const [home] = process.argv.slice(2);
const client = { responses: { create: async () => { process.exit(0); } } };   // "answered", then dead
await sdkTurn({ vendor: "openai", purpose: "intent-test", cwd: "/c", prompt: "one", client, home, continuity: "replay" });
`;

test("a turn that died between the vendor acting and the first write is refused next time, until acknowledged", async () => {
  const home = mkHome();
  const src = new URL("../src", import.meta.url).href;
  const script = path.join(home, "dying.mjs");
  fs.writeFileSync(script, DYING.replaceAll("SRC", src));
  await promisify(execFile)(process.execPath, [script, home], { timeout: 30_000 });

  const left = intents(home);
  assert.equal(left.length, 1, "the dead turn's intent must still be on disk");
  const rec = JSON.parse(fs.readFileSync(path.join(home, "intents", left[0]), "utf8"));
  assert.ok(rec.prompt_sha && rec.started_at, "it names what was sent and when");
  assert.ok(!("prompt" in rec), "and never the prompt text itself");

  const c = client();
  const refused = await sdkTurn({ ...SEAT, prompt: "two", client: c, home, continuity: "replay" });
  assert.equal(refused.ok, false);
  assert.equal(refused.code, "UNRESOLVED_TURN");
  assert.equal(c.calls, 0, "refused BEFORE calling the vendor again: the side effects may already have happened once");
  assert.match(refused.why, /acknowledgeLost/);

  const ack = await sdkTurn({ ...SEAT, prompt: "two", client: c, home, continuity: "replay", acknowledgeLost: true });
  assert.equal(ack.ok, true, ack.why);
  assert.equal(c.calls, 1);
  assert.deepEqual(intents(home), [], "acknowledging and completing clears it");
});

test("a turn the vendor REFUSED clears its intent: the failure is reported, the intent is for the silent case", async () => {
  const home = mkHome();
  const failing = { responses: { create: async () => { throw new Error("429 quota"); } } };
  await assert.rejects(sdkTurn({ ...SEAT, prompt: "one", client: failing, home, continuity: "replay" }), /429/);
  assert.deepEqual(intents(home), []);
  const unusable = { responses: { create: async () => ({ id: null, output_text: "x", output: [] }) } };
  const r = await sdkTurn({ ...SEAT, prompt: "one", client: unusable, home, continuity: "replay" });
  assert.equal(r.ok, false);
  assert.deepEqual(intents(home), []);
});
