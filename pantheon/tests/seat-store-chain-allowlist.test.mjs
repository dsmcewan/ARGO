import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSeat, saveSeat } from "../src/seat/store.mjs";

// THE DEFECT, 2026-09-27 re-review, rank 10. validateChain checked the TYPES of head and length and said
// nothing about what else may ride along, so { head, length, transcript } persisted a transcript under the
// record that promises never to hold one. exchanges had an allowlist; chain now has the same.
const seat = { vendor: "claude", purpose: "owner", cwd: "/repo/a" };
const withHome = fn => { const home = mkdtempSync(join(tmpdir(), "chain-allow-")); try { return fn(home); } finally { rmSync(home, { recursive: true, force: true }); } };

test("a chain record carrying anything beyond head and length is refused", () => withHome(home => {
  assert.throws(() => saveSeat(seat, { chain: { head: "abc", length: 3, transcript: "user: hello" } }, { home }),
    /chain\.transcript is not part of a chain record/);
  assert.throws(() => saveSeat(seat, { chain: { head: "abc", length: 3, messages: [] } }, { home }), /chain\.messages/);
  assert.equal(loadSeat(seat, { home })?.chain ?? null, null, "a refused write leaves nothing behind");
}));

test("the two permitted fields still round-trip", () => withHome(home => {
  saveSeat(seat, { chain: { head: "abc", length: 3 } }, { home });
  assert.deepEqual(loadSeat(seat, { home }).chain, { head: "abc", length: 3 });
}));
