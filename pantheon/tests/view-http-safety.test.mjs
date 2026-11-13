import { test } from "node:test";
import assert from "node:assert/strict";
import { originPolicy, badId } from "../src/view/http-safety.mjs";

test("originPolicy refuses a Host that is not this server's loopback address", () => {
  const req = { headers: { host: "attacker.example:7777" }, socket: { localPort: 7777 } };
  assert.match(originPolicy(req), /is not this server's loopback address/);
});

test("originPolicy allows a same-origin loopback request with no Origin header", () => {
  const req = { headers: { host: "127.0.0.1:7777" }, socket: { localPort: 7777 } };
  assert.equal(originPolicy(req), null);
});

test("badId refuses __proto__ and constructor as identifiers", () => {
  assert.equal(badId("__proto__"), true);
  assert.equal(badId("constructor"), true);
  assert.equal(badId("fine-id_1"), false);
});
