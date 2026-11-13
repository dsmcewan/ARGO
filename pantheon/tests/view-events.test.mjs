import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect } from "node:net";
import { createViewServer, MAX_SUBSCRIBERS } from "../src/view/server.mjs";

// THE DEFECT, 2026-09-27 re-review, rank 12. /events kept an unbounded subscriber set, and its headers sat
// in the socket buffer until the first event or the 15s ping -- so an idle bus looked like a dead server
// for 15 seconds, and 300 idle connections were 300 held responses with nothing to say they were too many.

const rawGet = (port, path) => new Promise((resolve, reject) => {
  const sock = connect(port, "127.0.0.1");
  let head = "";
  const t = setTimeout(() => { sock.destroy(); reject(new Error(`no response headers within 2s for ${path}`)); }, 2000);
  sock.on("connect", () => sock.write(`GET ${path} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n\r\n`));
  sock.on("data", d => { head += d.toString(); if (head.includes("\r\n\r\n")) { clearTimeout(t); resolve({ sock, status: Number(head.split(" ")[1]), head }); } });
  sock.on("error", e => { clearTimeout(t); reject(e); });
});

test("SSE headers arrive immediately on an idle bus, and the subscriber count is capped", async () => {
  const home = mkdtempSync(join(tmpdir(), "view-events-"));
  const srv = createViewServer({ makeClientFor: () => ({}), home });
  const { port } = await srv.listen(0);
  const open = [];
  try {
    const first = await rawGet(port, "/events");          // would have hung ~15s before the fix
    assert.equal(first.status, 200);
    assert.match(first.head, /text\/event-stream/);
    open.push(first.sock);
    for (let i = 1; i < MAX_SUBSCRIBERS; i++) open.push((await rawGet(port, "/events")).sock);
    const over = await rawGet(port, "/events");
    assert.equal(over.status, 503, "the one past the cap is refused, not queued");
    assert.match(over.head, /too many \/events subscribers/);
    over.sock.destroy();
    // Closing one frees a slot.
    open.pop().destroy();
    await new Promise(r => setTimeout(r, 100));
    const again = await rawGet(port, "/events");
    assert.equal(again.status, 200);
    open.push(again.sock);
  } finally {
    for (const s of open) s.destroy();
    srv.server.closeAllConnections?.();
    await new Promise(r => srv.server.close(() => r()));
    rmSync(home, { recursive: true, force: true });
  }
});
