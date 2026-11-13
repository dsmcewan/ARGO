import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadHistory, loadHistoryState, saveHistory, commitHistory } from "../src/sdk/history.mjs";
import { seatKey } from "../src/seat/identity.mjs";

// This file exists because history.mjs had no test of its own: nothing imported saveHistory or
// loadHistory anywhere in tests/, so the module holding the conversation text for two of four vendors
// was covered only indirectly, through suites that never wrote a pending tail.

const homes = [];
after(() => { for (const h of homes) fs.rmSync(h, { recursive: true, force: true }); });
const mkHome = () => { const h = fs.mkdtempSync(path.join(os.tmpdir(), "pantheon-hist-")); homes.push(h); return h; };
const SEAT = { vendor: "agy_google", purpose: "replay-test", cwd: "/repo" };
// Derived, never hardcoded: seatKey is a content hash of the seat identity, so a literal filename in a
// test is a guess that passes for the wrong reason the day the key changes.
const histFile = (home, seat = SEAT) => path.join(home, "history", `${seatKey(seat)}.json`);
const msgs = n => Array.from({ length: n }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `m${i}` }));

// EVIDENCE §U1, THE REPRO. This is the crash, not a description of it: history is written with the new
// tail, the process dies before saveSeat, and the next turn loads.
test("§U1: an exchange written to history but never acknowledged by the seat record is NOT replayed", () => {
  const home = mkHome();
  // Two committed messages from an earlier, complete turn.
  saveHistory(SEAT, msgs(2), { home });
  commitHistory(SEAT, { home });
  assert.equal(loadHistory(SEAT, { home }).length, 2, "precondition: two committed messages");

  // A turn now appends two more and PHASE ONE writes them as pending... then the process dies. No
  // saveSeat, no commitHistory.
  saveHistory(SEAT, msgs(4), { home, committed: 2 });

  const st = loadHistoryState(SEAT, { home });
  assert.equal(st.pending, true);
  assert.equal(st.dropped, 2);
  assert.equal(st.messages.length, 2, "the pending tail must not come back");
  assert.match(st.why, /never acknowledged by the seat record/);
  assert.match(st.why, /repeat a tool call/, "the reason must name the hazard, not just the mismatch");
  // The file still HOLDS them -- recovery is a read-time decision, so nothing is destroyed by a crash.
  const onDisk = JSON.parse(fs.readFileSync(histFile(home), "utf8"));
  assert.equal(onDisk.messages.length, 4, "the tail is dropped on load, never deleted from disk");
  assert.equal(onDisk.committed, 2);
});

// THE MUTATION CHECK. A test that cannot fail proves nothing, so: with the marker absent -- which is
// exactly what the old code wrote -- the same load returns the tail. If this assertion ever flips, the
// test above has stopped discriminating and is passing vacuously.
test("§U1 mutation check: without the commit marker the same tail IS returned", () => {
  const home = mkHome();
  saveHistory(SEAT, msgs(4), { home });            // no `committed` -> fully committed, the old behaviour
  const st = loadHistoryState(SEAT, { home });
  assert.equal(st.pending, false);
  assert.equal(st.dropped, 0);
  assert.equal(st.messages.length, 4, "this is the hazard: all four replay, including the unacknowledged two");
});

test("commitHistory moves the mark, and then the tail is real", () => {
  const home = mkHome();
  saveHistory(SEAT, msgs(4), { home, committed: 2 });
  assert.equal(loadHistory(SEAT, { home }).length, 2);
  const r = commitHistory(SEAT, { home });
  assert.equal(r.ok, true);
  assert.equal(r.committed, 4);
  assert.equal(loadHistory(SEAT, { home }).length, 4, "after phase two the whole conversation replays");
  // Idempotent: calling it again is a no-op that says so, because seat-sdk calls it unconditionally.
  assert.equal(commitHistory(SEAT, { home }).already, true);
});

test("commitHistory on a seat with no history file is not an error", () => {
  const r = commitHistory({ vendor: "openai", purpose: "server-mode", cwd: "/repo" }, { home: mkHome() });
  assert.equal(r.ok, false);
  assert.match(r.why, /no history file/);
});

// A file written before the marker existed must keep working. Treating a missing `committed` as 0 would
// silently discard every pre-existing conversation -- a data-loss bug introduced by a safety feature.
test("a legacy history with no marker replays in full, and is labelled legacy", () => {
  const home = mkHome();
  const dir = path.join(home, "history");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(histFile(home), JSON.stringify({ key: seatKey(SEAT), messages: msgs(3) }));
  const st = loadHistoryState(SEAT, { home });
  assert.equal(st.legacy, true);
  assert.equal(st.committed, 3);
  assert.equal(st.dropped, 0);
  assert.equal(st.messages.length, 3);
});

// A marker past the end cannot mean "more committed than exist".
test("a marker beyond the message count is clamped rather than trusted", () => {
  const home = mkHome();
  const dir = path.join(home, "history");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(histFile(home), JSON.stringify({ messages: msgs(2), committed: 99 }));
  const st = loadHistoryState(SEAT, { home });
  assert.equal(st.committed, 2);
  assert.equal(st.dropped, 0);
});

test("a corrupt history fails closed rather than reading as an empty conversation", () => {
  const home = mkHome();
  const dir = path.join(home, "history");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(histFile(home), "{not json");
  assert.throws(() => loadHistoryState(SEAT, { home }), /corrupt history/);
  assert.throws(() => commitHistory(SEAT, { home }), /corrupt history/);
});

test("history files are owner-only, because they hold prompts", () => {
  const home = mkHome();
  const p = saveHistory(SEAT, msgs(2), { home });
  assert.equal(fs.statSync(p).mode & 0o777, 0o600);
  commitHistory(SEAT, { home });
  assert.equal(fs.statSync(p).mode & 0o777, 0o600, "phase two must not widen the mode");
});

// ---------------------------------------------------------------------------------------------
// THE WIRING, not just the module. history.mjs behaving correctly proves nothing about whether
// seat-sdk uses it, and "verify the whole consequential path" means the turn itself has to be the
// thing under test: accepted input -> phase one -> seat record -> phase two -> next turn's replay.

const outputReply = n => ({
  id: `resp_${n}`, output_text: `hi${n}`,
  // Replay refuses a reply with no output ITEMS, by design: the items carry the reasoning that makes
  // the next turn work, and keeping only the prose would look like a working replay while dropping it.
  output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: `hi${n}` }] }],
});
const fakeReplayClient = () => { let n = 0; return { responses: { create: async () => outputReply(++n) } }; };
const SDK_SEAT = { vendor: "openai", purpose: "u1-wiring", cwd: "/c" };

test("§U1 wiring: a completed turn leaves history fully committed", async () => {
  const { sdkTurn } = await import("../src/sdk/seat-sdk.mjs");
  const home = mkHome();
  const client = fakeReplayClient();
  const r = await sdkTurn({ ...SDK_SEAT, prompt: "one", client, home, continuity: "replay" });
  assert.equal(r.ok, true);
  assert.equal(r.history_rolled_back, null, "a clean turn rolls nothing back");
  const st = loadHistoryState(SDK_SEAT, { home });
  assert.equal(st.pending, false);
  assert.equal(st.committed, st.messages.length, "phase two ran: the mark is at the end");
  assert.equal(r.history_committed, st.committed, "and the turn reported it");
});

test("§U1 wiring: a crash-shaped pending tail is dropped by the NEXT turn, and reported", async () => {
  const { sdkTurn } = await import("../src/sdk/seat-sdk.mjs");
  const home = mkHome();
  const client = fakeReplayClient();
  await sdkTurn({ ...SDK_SEAT, prompt: "one", client, home, continuity: "replay" });
  const after1 = loadHistoryState(SDK_SEAT, { home });
  assert.equal(after1.messages.length, 2);

  // WINDOW ONE: crash after phase one, before saveSeat. The marker is short AND the seat record never
  // saw the tail. Simulated as exactly that state: rewind the marker and strip the seat's acknowledgement.
  const raw = JSON.parse(fs.readFileSync(histFile(home, SDK_SEAT), "utf8"));
  fs.writeFileSync(histFile(home, SDK_SEAT), JSON.stringify({ ...raw, committed: 0 }));
  const { loadSeat, saveSeat } = await import("../src/seat/store.mjs");
  const seatRec = loadSeat(SDK_SEAT, { home });
  const seatPath = path.join(home, "seats", `${seatKey(SDK_SEAT)}.json`);
  fs.writeFileSync(seatPath, JSON.stringify({ ...seatRec, history_len: 0 }));

  const r2 = await sdkTurn({ ...SDK_SEAT, prompt: "two", client, home, continuity: "replay" });
  assert.equal(r2.ok, true);
  assert.ok(r2.history_rolled_back, "the turn must REPORT that it discarded an unacknowledged exchange");
  assert.equal(r2.history_rolled_back.dropped, 2);
  assert.match(r2.history_rolled_back.why, /repeat a tool call/);
  const st = loadHistoryState(SDK_SEAT, { home });
  assert.equal(st.pending, false, "the new turn re-committed at its own length");
  assert.equal(st.messages.length, 2, "one prompt plus one reply, the dropped pair not carried forward");
  void saveSeat;
});

// WINDOW TWO, found by an external review of the first fix: crash after saveSeat, before phase two.
// The marker is short but the SEAT RECORD acknowledged the tail. Dropping it here would LOSE an
// exchange the rest of the system already believes in -- the opposite failure from window one.
test("§U1 window two: a tail the seat record acknowledged is KEPT even though the marker is short", async () => {
  const { sdkTurn } = await import("../src/sdk/seat-sdk.mjs");
  const home = mkHome();
  const client = fakeReplayClient();
  await sdkTurn({ ...SDK_SEAT, prompt: "one", client, home, continuity: "replay" });
  // Rewind ONLY the marker: this is the state a crash between saveSeat and commitHistory leaves.
  const raw = JSON.parse(fs.readFileSync(histFile(home, SDK_SEAT), "utf8"));
  assert.equal(raw.committed, 2, "precondition: fully committed");
  fs.writeFileSync(histFile(home, SDK_SEAT), JSON.stringify({ ...raw, committed: 0 }));

  const { loadSeat } = await import("../src/seat/store.mjs");
  assert.equal(loadSeat(SDK_SEAT, { home }).history_len, 2, "the seat record acknowledged both messages");
  const st = loadHistoryState(SDK_SEAT, { home, acknowledged: 2 });
  assert.equal(st.dropped, 0, "nothing is dropped: the seat vouches for the tail");
  assert.deepEqual(st.healed_from_seat, { marker: 0, acknowledged: 2 });

  const r2 = await sdkTurn({ ...SDK_SEAT, prompt: "two", client, home, continuity: "replay" });
  assert.equal(r2.ok, true);
  assert.equal(r2.history_rolled_back, null, "no rollback: the acknowledged exchange survives");
  assert.deepEqual(r2.history_healed, { marker: 0, acknowledged: 2 });
  assert.equal(loadHistoryState(SDK_SEAT, { home }).messages.length, 4, "both turns replay");
});

// The mutation check for window two: WITHOUT the seat's acknowledgement the same file drops the tail.
test("§U1 window two mutation check: with no acknowledgement the same short marker drops the tail", async () => {
  const home = mkHome();
  saveHistory(SEAT, msgs(4), { home, committed: 2 });
  assert.equal(loadHistoryState(SEAT, { home }).dropped, 2);
  assert.equal(loadHistoryState(SEAT, { home, acknowledged: 4 }).dropped, 0);
  assert.equal(loadHistoryState(SEAT, { home, acknowledged: 99 }).committed, 4, "clamped to what exists");
});

// The a5fade49097a8c183 review's repro, as a regression test: a vendor rename changes seatKey's
// hash, so a history file saved under the OLD vendor name is invisible to a load under the new one
// unless the loader falls back to seatKeyAliases -- reproduced here with real files on a real temp
// home, the same mechanism the reviewer found against files already on this machine.
test("a history file saved under a vendor's pre-rename name is still found after the rename", () => {
  const home = mkHome();
  const preRename = { vendor: "google", purpose: "scout", cwd: "/repo" };
  saveHistory(preRename, msgs(2), { home });
  commitHistory(preRename, { home });

  const postRename = { vendor: "agy_google", purpose: "scout", cwd: "/repo" };
  assert.equal(loadHistory(postRename, { home }).length, 2,
    "the renamed vendor's seat must still see the conversation recorded under its old name");
  assert.equal(loadHistoryState(postRename, { home }).legacy_vendor, "google",
    "a caller auditing this load must be able to see it came from an aliased name, not the current one");
});

test("a save after a legacy-alias load writes under the CURRENT vendor name, healing the seat", () => {
  const home = mkHome();
  saveHistory({ vendor: "google", purpose: "scout", cwd: "/repo" }, msgs(2), { home });
  const postRename = { vendor: "agy_google", purpose: "scout", cwd: "/repo" };
  saveHistory(postRename, [...loadHistory(postRename, { home }), ...msgs(1)], { home });
  assert.equal(fs.existsSync(histFile(home, postRename)), true, "the current key now has its own file");
  assert.equal(loadHistoryState(postRename, { home }).legacy_vendor, undefined,
    "once the current key has a file, the alias fallback is no longer consulted");
});

test("no alias fallback fires for a vendor with no recorded rename", () => {
  const home = mkHome();
  assert.equal(loadHistory({ vendor: "openai", purpose: "work", cwd: "/repo" }, { home }).length, 0);
});
