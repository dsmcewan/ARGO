import { test } from "node:test";
import assert from "node:assert/strict";
import { validateEntry, KINDS, MODE_WRITES, slotOf } from "../src/board/schema.mjs";
import { cidOf } from "../src/board/canon.mjs";
import { seat, HUMAN, CONTROLLER, TICKET } from "./board-helper.mjs";

const BLOB = cidOf("blob", "x");
const ENTRY = cidOf("entry", { type: "entry", kind: "z" });
const entry = (kind, payload, over = {}) => ({
  type: "entry", kind, level: KINDS[kind].level, payload,
  author: over.author ?? seat("openai", "work"), visibility: over.visibility ?? "board",
  links: over.links ?? {}, ...(over.confidence !== undefined ? { confidence: over.confidence } : {}),
});
const code = fn => { try { fn(); return "ACCEPTED"; } catch (e) { return e.code ?? e.constructor.name; } };

test("every kind declares its level, its writers, and whether it is slotted", () => {
  for (const [name, spec] of Object.entries(KINDS)) {
    assert.ok(Number.isInteger(spec.level) && spec.level >= 0 && spec.level <= 6, `${name} level`);
    assert.ok(Array.isArray(spec.writers) && spec.writers.length, `${name} writers`);
    assert.equal(typeof spec.slotted, "boolean", `${name} slotted`);
    if (spec.slotted) assert.equal(typeof spec.slot, "function", `${name} slot fn`);
  }
});

// --- rule 7: the controller is not a vendor ---

test("no mode can write a decision, and no seat is in decision.writers", () => {
  for (const [mode, kinds] of Object.entries(MODE_WRITES)) {
    assert.ok(!kinds.has("decision"), `${mode} must not be able to write a decision`);
  }
  assert.ok(!KINDS.decision.writers.includes("seat"));
  assert.equal(code(() => validateEntry(entry("decision",
    { key: "ship", question: "ship?", options: [{ id: "y" }, { id: "n" }], resolution: { type: "unanimous", option: "y" } },
    { author: seat("anthropic", "synthesize") }))), "JUDGE_IS_VENDOR");
});

test("a controller may write a decision, but never with a vendor as judge", () => {
  const ok = { key: "ship", question: "ship?", options: [{ id: "y" }, { id: "n" }], resolution: { type: "split", recorded: true } };
  assert.equal(slotOf("decision", ok, CONTROLLER), "decision:ship");
  assert.doesNotThrow(() => validateEntry(entry("decision", ok, { author: CONTROLLER })));
  assert.equal(code(() => validateEntry(entry("decision", { ...ok, judge: "anthropic" }, { author: CONTROLLER }))), "JUDGE_IS_VENDOR");
  assert.equal(code(() => validateEntry(entry("decision",
    { ...ok, resolution: { type: "unanimous", option: "maybe" } }, { author: CONTROLLER }))), "FIELD",
    "a resolution naming an option that is not on the ballot is not a resolution");
});

// --- mode is a capability, not a label ---

test("a discuss seat cannot write an artifact and a work seat cannot write a critique", () => {
  assert.equal(code(() => validateEntry(entry("artifact",
    { slot: "a.ts", path: "a.ts", rev: 1 }, { author: seat("openai", "discuss"), links: { bytes: BLOB } }))), "MODE");
  assert.equal(code(() => validateEntry(entry("critique",
    { target: { slot: "a.ts", rev: 1 }, verdict: "approve", findings: [] },
    { author: seat("openai", "work"), links: { target: BLOB } }))), "MODE");
});

test("an entry claiming a level its kind does not live on is refused", () => {
  const e = entry("hypothesis", { key: "k", claim: "c", status: "open" });
  assert.equal(code(() => validateEntry({ ...e, level: 4 })), "LEVEL");
});

// --- slotted vs accumulative ---

test("evidence is accumulative: it cannot supersede, because superseding would delete a fact", () => {
  assert.equal(code(() => validateEntry(entry("repro", { cmd: "npm test", exit: 1 },
    { links: { excerpt: BLOB, supersedes: [ENTRY] } }))), "SUPERSEDE");
  assert.doesNotThrow(() => validateEntry(entry("repro", { cmd: "npm test", exit: 1 }, { links: { excerpt: BLOB } })));
  assert.equal(slotOf("repro", { cmd: "x", exit: 0 }, seat("openai", "work")), null);
});

test("a critique's slot carries its author, so a second reviewer does not erase the first", () => {
  const p = { target: { slot: "src/a.ts", rev: 3 }, verdict: "request_changes", findings: [{ severity: "block", note: "no generation token" }] };
  assert.equal(slotOf("critique", p, seat("agy_google", "critique")), "critique:src/a.ts@agy_google");
  assert.notEqual(slotOf("critique", p, seat("xai", "critique")), slotOf("critique", p, seat("agy_google", "critique")));
});

// --- links ---

test("a content-bearing kind must link its content; an unlinked claim is uncheckable", () => {
  assert.equal(code(() => validateEntry(entry("artifact", { slot: "a.ts", path: "a.ts", rev: 1 }))), "LINK");
  assert.equal(code(() => validateEntry(entry("trace", { test: "t" }))), "LINK");
  assert.equal(code(() => validateEntry(entry("repro", { cmd: "c", exit: 0 }))), "LINK");
});

test("a link must have the declared codec and a declared name", () => {
  assert.equal(code(() => validateEntry(entry("artifact", { slot: "a.ts", path: "a.ts", rev: 1 },
    { links: { bytes: ENTRY } }))), "LINK", "bytes must be a blob, not an entry");
  assert.equal(code(() => validateEntry(entry("artifact", { slot: "a.ts", path: "a.ts", rev: 1 },
    { links: { bytes: BLOB, sneaky: ENTRY } }))), "LINK", "an undeclared link would travel into contexts no rule reviewed");
  assert.equal(code(() => validateEntry(entry("hypothesis", { key: "k", claim: "c", status: "open" },
    { links: { supports: ENTRY } }))), "LINK", "supports is a list");
});

// --- nothing that churns the cid, and no second copy of a hash ---

test("an entry carries no timestamp, seq or id, because those churn or duplicate the cid", () => {
  for (const f of ["ts", "seq", "id", "at"]) {
    const e = entry("hypothesis", { key: "k", claim: "c", status: "open" });
    assert.equal(code(() => validateEntry({ ...e, [f]: "2026-09-27" })), "FIELD", `${f} must be refused`);
  }
});

test("an author is an identity, not a banner", () => {
  const e = entry("hypothesis", { key: "k", claim: "c", status: "open" },
    { author: { ...seat("openai", "discuss"), context_left: "12%" } });
  assert.equal(code(() => validateEntry(e)), "AUTHOR");
});

test("a hash stored beside the link it duplicates is refused, since the two can disagree", () => {
  assert.equal(code(() => validateEntry(entry("artifact",
    { slot: "a.ts", path: "a.ts", rev: 1, content_hash: "deadbeef" }, { links: { bytes: BLOB } }))), "DERIVED");
  assert.equal(code(() => validateEntry(entry("critique",
    { target: { slot: "a.ts", rev: 1, hash: "deadbeef" }, verdict: "abstain", findings: [] },
    { author: seat("agy_google", "critique"), links: { target: BLOB } }))), "DERIVED");
});

// --- payload rules that encode a lesson ---

test("a critique cannot approve while carrying a blocking finding", () => {
  assert.equal(code(() => validateEntry(entry("critique",
    { target: { slot: "a.ts", rev: 1 }, verdict: "approve", findings: [{ severity: "block", note: "races" }] },
    { author: seat("agy_google", "critique"), links: { target: BLOB } }))), "CONTRADICTION");
});

test("a ticket with no acceptance criterion is refused: nothing but an opinion could close it", () => {
  assert.equal(code(() => validateEntry(entry("ticket", { ...TICKET, acceptance: [] }, { author: HUMAN }))), "FIELD");
  assert.equal(code(() => validateEntry(entry("ticket", { ...TICKET, acceptance: [{ type: "vibes" }] }, { author: HUMAN }))), "FIELD");
  assert.doesNotThrow(() => validateEntry(entry("ticket", TICKET, { author: HUMAN })));
});

test("a blocked work item must say why", () => {
  const base = { key: "k", title: "t", artifact_slots: [] };
  assert.equal(code(() => validateEntry(entry("work_item", { ...base, state: "blocked" }, { author: CONTROLLER }))), "FIELD");
  assert.doesNotThrow(() => validateEntry(entry("work_item",
    { ...base, state: "blocked", block: { reason: "waiting on the lease design" } }, { author: CONTROLLER })));
});

test("a slot key cannot smuggle the delimiters the slot name is built from", () => {
  for (const k of ["a b", "a@b", "", "../escape".replace("..", ".."), "x".repeat(200)]) {
    assert.equal(code(() => validateEntry(entry("hypothesis", { key: k, claim: "c", status: "open" }))), "FIELD", `key "${k}"`);
  }
});

test("confidence is a number in 0..1 and is never a vote", () => {
  assert.doesNotThrow(() => validateEntry(entry("hypothesis", { key: "k", claim: "c", status: "open" }, { confidence: 0.4 })));
  assert.equal(code(() => validateEntry(entry("hypothesis", { key: "k", claim: "c", status: "open" }, { confidence: 4 }))), "FIELD");
});
