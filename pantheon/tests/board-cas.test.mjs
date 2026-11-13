import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { canonicalize, cidOf, isCid, shortCid, codecOf } from "../src/board/canon.mjs";
import { linksOf } from "../src/board/cas.mjs";
import { withBoard } from "./board-helper.mjs";

// --- canonicalization has to be INJECTIVE or a cid is not an identity ---

test("key order does not change the bytes", () => {
  assert.equal(canonicalize({ b: 1, a: [2, { d: 4, c: 3 }] }), canonicalize({ a: [2, { c: 3, d: 4 }] , b: 1 }));
});

test("the three ways a casual canonicalizer creates collisions are all refused", () => {
  // {a:undefined} vs {} -- a field deliberately cleared would hash equal to one never set.
  assert.throws(() => canonicalize({ a: undefined }), /undefined/);
  // NaN and Infinity both serialise to null through JSON.stringify.
  assert.throws(() => canonicalize({ a: NaN }), /not finite/);
  assert.throws(() => canonicalize({ a: Infinity }), /not finite/);
  // -0 and 0 print identically.
  assert.throws(() => canonicalize({ a: -0 }), /-0/);
  // and anything with no canonical form at all
  assert.throws(() => canonicalize({ a: () => 1 }), /no canonical form/);
  assert.throws(() => canonicalize({ a: 1n }), /no canonical form/);
});

test("the codec is bound into the digest, so relabelling a node is not free", () => {
  const a = cidOf("blob", "same bytes"), b = cidOf("entry", "same bytes");
  assert.notEqual(a.split(":")[1], b.split(":")[1]);
  assert.equal(codecOf(a), "blob");
  assert.ok(isCid(a) && !isCid("blob:nothex"));
  assert.equal(shortCid(a).length, "blob:".length + 12);
});

// --- the store ---

test("put is idempotent: two seats writing the same patch produce one object", () => withBoard(async ({ store }) => {
  const a = store.put("blob", "export const x = 1;\n");
  const b = store.put("blob", "export const x = 1;\n");
  assert.equal(a, b);
  assert.equal(store.count(), 1);
  assert.equal(store.getBlobText(a), "export const x = 1;\n");
}));

test("a node may not cite a cid that is not in the store, so a cycle cannot form", () => withBoard(async ({ store }) => {
  const ghost = cidOf("entry", { type: "entry", kind: "ticket", never: "written" });
  assert.throws(
    () => store.put("tree", { type: "tree", slots: { ticket: ghost } }),
    /not in the store/,
    "a fabricated citation must be refused on arrival, not by a walk someone remembers to run");
}));

test("an object edited in place no longer serves under its own name", () => withBoard(async ({ store, root }) => {
  const cid = store.put("entry", { type: "entry", kind: "x", payload: { a: 1 } });
  const [, hex] = cid.split(":");
  const p = join(root, "objects", "entry", hex.slice(0, 2), hex.slice(2));
  writeFileSync(p, JSON.stringify({ type: "entry", kind: "x", payload: { a: 2 } }));
  assert.throws(() => store.get(cid), /does not hash to its own name/,
    "otherwise every 'bound to a hash' claim downstream is false while still looking verified");
}));

test("linksOf finds cids wherever the schema puts them, not only in a links field", () => {
  const found = linksOf("entry", { a: cidOf("blob", "1"), b: { c: [cidOf("entry", "2")] }, d: "not a cid" });
  assert.equal(found.length, 2);
  assert.equal(linksOf("blob", Buffer.from("blob:deadbeef")).length, 0, "a blob's bytes are not links");
});

test("reachable is bounded, because an unbounded walk is how a projection becomes the whole history",
  () => withBoard(async ({ store }) => {
    let prev = null, first = null;
    for (let i = 0; i < 12; i++) {
      const links = prev ? { derived_from: [prev] } : {};
      prev = store.put("entry", { type: "entry", kind: "chain", payload: { i }, links });
      first ??= prev;
    }
    const all = store.reachable([prev]);
    assert.equal(all.cids.length, 12);
    assert.equal(all.truncated, false);
    const capped = store.reachable([prev], { limit: 5 });
    assert.equal(capped.cids.length, 5);
    assert.equal(capped.truncated, true, "truncation must be reported; a silent cap reads as complete coverage");
  }));
