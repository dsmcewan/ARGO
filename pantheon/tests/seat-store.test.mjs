import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { pantheonHome, loadSeat, saveSeat } from "../src/seat/store.mjs";
import { seatKey } from "../src/seat/identity.mjs";

const seat = { vendor: "claude", purpose: "owner", cwd: "/repo/a" };
const withHome = fn => {
  const home = mkdtempSync(join(tmpdir(), "pantheon-store-"));
  try { return fn(home); } finally { rmSync(home, { recursive: true, force: true }); }
};

test("pantheonHome honours PANTHEON_HOME and defaults under the user home", () => {
  assert.equal(pantheonHome({ PANTHEON_HOME: "/custom" }), "/custom");
  assert.equal(pantheonHome({}), join(homedir(), ".pantheon"));
});

test("an unknown seat loads as null, not as an empty record", () => {
  withHome(home => assert.equal(loadSeat(seat, { home }), null));
});

test("a saved seat round-trips and is keyed by seatKey", () => {
  withHome(home => {
    const w = saveSeat(seat, { token: { value: "tok-1", source: "operator" } }, { home });
    assert.match(w.key, /^[0-9a-f]{16}$/);
    assert.equal(w.key, seatKey(seat));
    const r = loadSeat(seat, { home });
    assert.equal(r.token.value, "tok-1");
    assert.equal(r.vendor, "claude");
  });
});

// The headline constraint of the whole project: nothing is written outside PANTHEON_HOME.
test("saving writes ONLY under the given home", () => {
  withHome(home => {
    saveSeat(seat, { token: { value: "t", source: "operator" } }, { home });
    const files = readdirSync(home, { recursive: true });
    assert.ok(files.length > 0, "something must have been written");
    for (const f of files) {
      assert.ok(!String(f).startsWith(".."), `escaped the home: ${f}`);
    }
    assert.ok(!existsSync(join(homedir(), ".pantheon", "seats", `${seatKey(seat)}.json`)),
      "must not have touched the real ~/.pantheon");
  });
});

test("a lower-rank token write never clobbers a higher-rank one", () => {
  withHome(home => {
    saveSeat(seat, { token: { value: "tok-hook", source: "hook" } }, { home });
    saveSeat(seat, { token: { value: "tok-scrape", source: "scrape" } }, { home });
    assert.equal(loadSeat(seat, { home }).token.value, "tok-hook",
      "provenance rank must survive a round-trip through the store");
  });
});

test("two seats differing only by cwd get separate records", () => {
  withHome(home => {
    saveSeat(seat, { token: { value: "a", source: "operator" } }, { home });
    saveSeat({ ...seat, cwd: "/repo/b" }, { token: { value: "b", source: "operator" } }, { home });
    assert.equal(loadSeat(seat, { home }).token.value, "a");
    assert.equal(loadSeat({ ...seat, cwd: "/repo/b" }, { home }).token.value, "b");
  });
});

test("a chain record round-trips unchanged", () => {
  withHome(home => {
    saveSeat(seat, { chain: { head: "abc", length: 3 } }, { home });
    assert.deepEqual(loadSeat(seat, { home }).chain, { head: "abc", length: 3 });
  });
});

test("a corrupt record file is refused rather than silently treated as absent", () => {
  withHome(home => {
    saveSeat(seat, { token: { value: "t", source: "operator" } }, { home });
    const f = join(home, "seats", readdirSync(join(home, "seats"))[0]);
    writeFileSync(f, "{not json");
    assert.throws(() => loadSeat(seat, { home }), /corrupt seat record/);
  });
});

// ---------------------------------------------------------------------------------------------
// Ruling (SDD ledger): an empty chain is not a baseline, so the store must refuse to persist one.
// If a zero-length chain could be saved, the next turn would load it and verifyExtends would
// reject every conversation -- or worse, an earlier build accepted it and verified anything. The
// refusal keeps the invalid state from ever reaching disk.
// ---------------------------------------------------------------------------------------------

test("the store refuses to persist a zero-length chain", () => {
  withHome(home => {
    assert.throws(() => saveSeat(seat, { chain: { head: "genesis", length: 0 } }, { home }),
      /empty chain/i,
      "an empty chain is not a baseline and must never reach disk");
  });
});

test("a refused empty-chain save leaves any existing record untouched", () => {
  withHome(home => {
    saveSeat(seat, { chain: { head: "abc", length: 3 }, token: { value: "t", source: "hook" } }, { home });
    assert.throws(() => saveSeat(seat, { chain: { head: "genesis", length: 0 } }, { home }));
    const r = loadSeat(seat, { home });
    assert.deepEqual(r.chain, { head: "abc", length: 3 }, "the good chain must survive the refusal");
    assert.equal(r.token.value, "t");
  });
});

test("a malformed chain shape is refused too", () => {
  withHome(home => {
    assert.throws(() => saveSeat(seat, { chain: { head: "abc" } }, { home }), /chain/i);
    assert.throws(() => saveSeat(seat, { chain: { length: 2 } }, { home }), /chain/i);
  });
});

test("saving is atomic: no .tmp file is left behind", () => {
  withHome(home => {
    saveSeat(seat, { token: { value: "t", source: "operator" } }, { home });
    const leftovers = readdirSync(join(home, "seats")).filter(f => f.includes(".tmp"));
    assert.deepEqual(leftovers, [], "a torn write would leave a corrupt record");
  });
});

test("an invalid provenance source is refused before anything is written", () => {
  withHome(home => {
    assert.throws(() => saveSeat(seat, { token: { value: "t", source: "invented" } }, { home }),
      /unknown provenance/);
    assert.equal(loadSeat(seat, { home }), null, "nothing should have been created");
  });
});

// Same class of defect as sdk-history.test.mjs's alias-fallback tests: seatKey hashes the vendor,
// so a rename orphans the seat record (resume handle, chain) the same way it orphans history.
test("a seat record saved under a vendor's pre-rename name is still found after the rename", () => {
  withHome(home => {
    const preRename = { vendor: "google", purpose: "scout", cwd: "/repo/a" };
    saveSeat(preRename, { token: { value: "tok-1", source: "operator" } }, { home });
    const postRename = { vendor: "agy_google", purpose: "scout", cwd: "/repo/a" };
    const rec = loadSeat(postRename, { home });
    assert.ok(rec, "the renamed vendor's seat must still find its resume handle");
    assert.equal(rec.token.value, "tok-1");
  });
});

test("no alias fallback fires for a vendor with no recorded rename", () => {
  withHome(home => assert.equal(loadSeat({ vendor: "claude", purpose: "owner", cwd: "/repo/a" }, { home }), null));
});
