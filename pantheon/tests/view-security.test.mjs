import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect } from "node:net";
import { createViewServer } from "../src/view/server.mjs";
import { reduceSeats } from "../src/view/bus.mjs";

// Every request here is a REAL HTTP request against a listening server, because the property under
// test is what the socket accepts, not what a function returns. The holes were found by an external
// review: the loopback bind was treated as sufficient, and a browser on this machine is on the
// loopback too.
const withServer = async fn => {
  const home = mkdtempSync(join(tmpdir(), "view-sec-"));
  const srv = createViewServer({ makeClientFor: () => ({}), home });
  const { port } = await srv.listen(0);
  try { return await fn(port, srv); }
  finally {
    // fetch() keeps its sockets alive, and server.close() waits for every connection to end -- so
    // without this the suite hangs forever on the first test. Found the slow way.
    srv.server.closeAllConnections();
    await new Promise(r => srv.server.close(r));
    rmSync(home, { recursive: true, force: true });
  }
};
const post = (port, body, headers = {}) => fetch(`http://127.0.0.1:${port}/turn`, {
  method: "POST", body, headers: { "content-type": "application/json", ...headers },
});
// fetch() silently DROPS a caller-supplied Host header (it is a forbidden header in the Fetch spec),
// so the first draft of the Host tests below sent the real host, got 200, and would have passed had
// the server done nothing at all. Every Host assertion goes over a raw socket.
const rawGet = (port, path, host) => raw(port, `GET ${path} HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`);
const status = out => Number(/^HTTP\/1\.1 (\d{3})/.exec(out)?.[1] ?? 0);
const raw = (port, bytes) => new Promise((resolve, reject) => {
  const sock = connect(port, "127.0.0.1", () => sock.write(bytes));
  let out = ""; sock.on("data", d => { out += d; }); sock.on("end", () => resolve(out)); sock.on("error", reject);
  setTimeout(() => { sock.destroy(); resolve(out); }, 1500);
});

test("a text/plain POST -- the form a cross-site page can send without preflight -- is refused", () =>
  withServer(async port => {
    const r = await post(port, JSON.stringify({ vendor: "openai", prompt: "spend" }), { "content-type": "text/plain" });
    assert.equal(r.status, 415);
    assert.match((await r.json()).error, /application\/json/);
  }));

test("a cross-origin Origin is refused even with the right content type", () =>
  withServer(async port => {
    const r = await post(port, JSON.stringify({ vendor: "openai", prompt: "spend" }), { origin: "http://evil.example" });
    assert.equal(r.status, 403);
    assert.match((await r.json()).error, /Origin/);
    const sfs = await post(port, JSON.stringify({ vendor: "openai", prompt: "x" }), { "sec-fetch-site": "cross-site" });
    assert.equal(sfs.status, 403);
  }));

test("DNS rebinding: a Host that is not this loopback address is refused on EVERY route, including /events", () =>
  withServer(async port => {
    for (const path of ["/events", "/board", "/seats", "/"]) {
      assert.equal(status(await rawGet(port, path, "attacker.example")), 403, path);
    }
    assert.equal(status(await rawGet(port, "/seats", `127.0.0.1:${port + 1}`)), 403, "right name, wrong port is still not this server");
    assert.equal(status(await rawGet(port, "/seats", "")), 403, "no Host at all is not this server either");
    // Mutation check: the same request with the right Host is served, so the 403s above are the policy
    // and not a broken test harness.
    assert.equal(status(await rawGet(port, "/seats", `127.0.0.1:${port}`)), 200);
  }));

test("the legitimate path still opens: same-origin JSON POST reaches the seat runner", () =>
  withServer(async port => {
    const r = await post(port, JSON.stringify({ vendor: "openai", prompt: "hello", label: "seat-1" }),
      { origin: `http://127.0.0.1:${port}`, "sec-fetch-site": "same-origin" });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.results[0].vendor, "openai");
    // The fake client cannot complete a turn, so ok is false -- but the request GOT THROUGH the
    // door, which is what this test is about. A 403/415 here would mean the policy blocks the UI.
    assert.equal(typeof body.results[0].ok, "boolean");
    for (const h of ["localhost", "[::1]", "LOCALHOST"]) {
      assert.equal(status(await rawGet(port, "/seats", `${h}:${port}`)), 200, `${h} is a loopback name too`);
    }
  }));

test("a malformed URL is a 400, not a crash, and the server answers the next request", () =>
  withServer(async port => {
    const out = await raw(port, `GET //[ HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`);
    assert.match(out, /^HTTP\/1\.1 400/);
    const after = await fetch(`http://127.0.0.1:${port}/seats`);
    assert.equal(after.status, 200, "still alive");
  }));

test("a client that drops the connection mid-body does not take the server down", () =>
  withServer(async port => {
    await new Promise(resolve => {
      const sock = connect(port, "127.0.0.1", () => {
        sock.write(`POST /turn HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nContent-Type: application/json\r\nContent-Length: 5000\r\n\r\n{"vendor":"openai","prompt":"`);
        setTimeout(() => { sock.destroy(); resolve(); }, 50);
      });
      sock.on("error", () => resolve());
    });
    await new Promise(r => setTimeout(r, 50));
    const after = await fetch(`http://127.0.0.1:${port}/seats`);
    assert.equal(after.status, 200, "still alive after an aborted body");
  }));

test("a label of __proto__ is refused at the door, and the reducer is safe without the door", () =>
  withServer(async port => {
    const before = Object.prototype.polluted;
    const r = await post(port, JSON.stringify({ vendor: "openai", prompt: "x", label: "__proto__" }));
    assert.equal(r.status, 400);
    // "constructor" and "prototype" pass an identifier regex, which is why they are refused by name.
    for (const bad of ["constructor", "prototype"]) {
      const r2 = await post(port, JSON.stringify({ vendor: "openai", prompt: "x", labels: { openai: bad } }));
      assert.equal(r2.status, 400, bad);
    }
    // The reducer on its own: a hostile seat name is just a key.
    const seats = reduceSeats([{ seat: "__proto__", type: "start", at: 1 }, { seat: "__proto__", type: "delta", text: "polluted", at: 2 }]);
    assert.equal(Object.getPrototypeOf(seats), null);
    assert.equal(seats["__proto__"].text, "polluted", "it is an ordinary entry");
    assert.equal(Object.prototype.polluted, before, "Object.prototype is untouched");
    assert.equal(({}).text, undefined);
  }));
