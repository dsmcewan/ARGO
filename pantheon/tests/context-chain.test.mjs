import { test } from "node:test";
import assert from "node:assert/strict";
import { chainOf, record, verifyExtends } from "../src/context/chain.mjs";

const turn = (role, sha, tools = []) => ({ role, sha, len: sha.length, tools });
const A = [turn("user", "a1"), turn("assistant", "a2"), turn("user", "a3"), turn("assistant", "a4")];
const B = [turn("user", "b1"), turn("assistant", "b2"), turn("user", "b3"), turn("assistant", "b4")];

test("a chain has one link per turn and each link depends on its predecessor", () => {
  const c = chainOf(A);
  assert.equal(c.length, A.length);
  const c2 = chainOf([turn("user", "a1"), turn("assistant", "CHANGED"), turn("user", "a3"), turn("assistant", "a4")]);
  assert.equal(c[0], c2[0], "links before the change are unaffected");
  assert.notEqual(c[1], c2[1]);
  assert.notEqual(c[3], c2[3], "a change propagates to every later link");
});

test("a genuine resume extends the recorded chain", () => {
  const r = record(A.slice(0, 2));
  const v = verifyExtends(A, r);
  assert.equal(v.ok, true);
  assert.equal(v.grew, 2);
});

// Review Focus 2: the thread was pruned and resume quietly produced a NEW conversation.
// This MUST be caught by the hash, not by length — so B is at least as long as the record.
test("a silently-fresh conversation fails on prefix hash mismatch, not on length", () => {
  const r = record(A.slice(0, 2));
  const v = verifyExtends(B, r);
  assert.equal(v.ok, false);
  assert.equal(v.why, "prefix hash mismatch",
    "if this says 'shorter than recorded' the hash comparison never ran and the check is vacuous");
});

test("a truncated thread fails as shorter than recorded", () => {
  const r = record(A);
  const v = verifyExtends(A.slice(0, 2), r);
  assert.equal(v.ok, false);
  assert.equal(v.why, "shorter than recorded");
});

test("a tampered middle turn fails on prefix hash mismatch", () => {
  const r = record(A);
  const tampered = A.map((t, i) => (i === 1 ? turn("assistant", "evil") : t));
  const v = verifyExtends(tampered, r);
  assert.equal(v.ok, false);
  assert.equal(v.why, "prefix hash mismatch");
});

test("a role swap with identical text is caught", () => {
  const r = record(A.slice(0, 2));
  const swapped = [turn("assistant", "a1"), turn("user", "a2"), ...A.slice(2)];
  assert.equal(verifyExtends(swapped, r).why, "prefix hash mismatch");
});

test("a changed tool list is caught", () => {
  const r = record([turn("assistant", "x", ["Read"])]);
  assert.equal(verifyExtends([turn("assistant", "x", ["Bash"])], r).why, "prefix hash mismatch");
});

test("a malformed record is refused rather than trusted", () => {
  assert.throws(() => verifyExtends(A, { head: "abc" }), /record\.length/);
  assert.throws(() => verifyExtends(A, { length: 2 }), /record\.head/);
});

// ---------------------------------------------------------------------------------------------
// Ruling (see the SDD ledger): the plan specified that an empty recorded chain verifies against
// itself with ok === true. That is a silent false-RESUMED — the exact failure this project exists
// to prevent. A transcript can legitimately project to zero turns, because the projector drops
// unparseable lines and turns carrying neither text nor tools; an empty baseline would then accept
// ANY conversation. Spec §6.2 requires the check to fail positively, so an empty record is not a
// baseline at all. These tests pin the corrected contract.
// ---------------------------------------------------------------------------------------------

test("an empty recorded chain is NOT a usable baseline", () => {
  const r = record([]);
  assert.equal(r.length, 0);
  const v = verifyExtends([], r);
  assert.equal(v.ok, false);
  assert.equal(v.why, "recorded chain is empty; no baseline to verify against");
});

test("an empty baseline does not silently accept an unrelated conversation", () => {
  const v = verifyExtends(B, record([]));
  assert.equal(v.ok, false,
    "an empty record must never verify a conversation it has no relationship to");
  assert.equal(v.why, "recorded chain is empty; no baseline to verify against");
});

test("a zero-turn projection cannot be laundered into a baseline via record()", () => {
  // The realistic path to this: a vendor transcript of only tool-results, or one in a format the
  // projector does not recognize. Both yield zero turns.
  for (const live of [[], A, B, A.slice(0, 1)]) {
    assert.equal(verifyExtends(live, record([])).ok, false,
      `an empty baseline accepted a ${live.length}-turn conversation`);
  }
});

test("record() still reports genesis for an empty projection, so callers can detect it", () => {
  const r = record([]);
  assert.equal(r.head, "genesis");
  assert.equal(r.length, 0,
    "the store layer refuses to persist this; the marker must stay inspectable rather than throw");
});
