import { test } from "node:test";
import assert from "node:assert/strict";
import { seatKey, rankOf, mergeIdentity, seatKeyAliases } from "../src/seat/identity.mjs";

test("seatKey is stable and includes cwd", () => {
  const a = seatKey({ vendor: "claude", purpose: "owner", cwd: "/repo/a" });
  assert.equal(a, seatKey({ vendor: "claude", purpose: "owner", cwd: "/repo/a" }));
  assert.match(a, /^[0-9a-f]{16}$/);
});

// Review Focus 4: identity that ignores cwd merges two distinct seats.
test("same vendor+purpose in different cwd are DIFFERENT seats", () => {
  const a = seatKey({ vendor: "claude", purpose: "owner", cwd: "/repo/a" });
  const b = seatKey({ vendor: "claude", purpose: "owner", cwd: "/repo/b" });
  assert.notEqual(a, b, "resume is directory-scoped; cwd must be part of identity");
});

test("cwd is normalized so equivalent paths are one seat", () => {
  const a = seatKey({ vendor: "claude", purpose: "owner", cwd: "/repo/a/" });
  const b = seatKey({ vendor: "claude", purpose: "owner", cwd: "/repo/a/./" });
  assert.equal(a, b);
});

test("missing required field throws, never yields a key", () => {
  assert.throws(() => seatKey({ vendor: "claude", purpose: "owner" }), /cwd/);
  assert.throws(() => seatKey({ vendor: "claude", cwd: "/r" }), /purpose/);
});

test("rank order is hook > scrape > operator > adoption", () => {
  assert.ok(rankOf("hook") > rankOf("scrape"));
  assert.ok(rankOf("scrape") > rankOf("operator"));
  assert.ok(rankOf("operator") > rankOf("adoption"));
  assert.throws(() => rankOf("invented"), /unknown provenance/);
});

test("a lower-rank write never clobbers a higher-rank value", () => {
  const held = { value: "tok-hook", source: "hook" };
  const r = mergeIdentity(held, { value: "tok-scrape", source: "scrape" });
  assert.equal(r.value, "tok-hook");
  assert.equal(r.changed, false);
});

test("an equal-or-higher rank write wins and reports the change", () => {
  const held = { value: "tok-operator", source: "operator" };
  const up = mergeIdentity(held, { value: "tok-hook", source: "hook" });
  assert.equal(up.value, "tok-hook");
  assert.equal(up.changed, true);
  const same = mergeIdentity(held, { value: "tok-2", source: "operator" });
  assert.equal(same.value, "tok-2", "same rank is a legitimate update");
});

test("first write of any rank is accepted", () => {
  const r = mergeIdentity(undefined, { value: "t", source: "adoption" });
  assert.equal(r.value, "t");
  assert.equal(r.changed, true);
});

// A vendor rename (2026-09-28: "google"/"agy" -> "agy_google") changes seatKey's hash for every
// pre-existing seat, silently orphaning its history/seat-store file. seatKeyAliases lets a reader
// find state recorded under a name this project used to call that vendor.
test("seatKeyAliases returns the keys a renamed vendor's seat used to have", () => {
  const seat = { vendor: "agy_google", purpose: "scout", cwd: "/repo/a" };
  const aliases = seatKeyAliases(seat);
  assert.deepEqual(aliases, [
    seatKey({ vendor: "google", purpose: "scout", cwd: "/repo/a" }),
    seatKey({ vendor: "agy", purpose: "scout", cwd: "/repo/a" }),
  ]);
  assert.ok(!aliases.includes(seatKey(seat)), "aliases are the OLD keys, never the current one");
});

test("a vendor with no recorded rename has no aliases", () => {
  assert.deepEqual(seatKeyAliases({ vendor: "openai", purpose: "work", cwd: "/repo/a" }), []);
});
