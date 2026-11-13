import { test } from "node:test";
import assert from "node:assert/strict";
import { seatKey, rankOf, mergeIdentity } from "../src/seat/identity.mjs";

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
