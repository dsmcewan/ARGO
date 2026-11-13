import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBuildServer } from "../src/view/build-server.mjs";
import { spawnPromise } from "../src/board/spawn.mjs";

function fakeClientFor() {
  return { responses: { create: async () => ({ id: "r1", output_text: "TITLE: fixture" }) } };
}

// `allowedRoot` defaults to ~/Projects; the tests need a temp dir to be inside it, so each server
// is given the temp dir's own parent as its root. The boundary itself is tested separately, with
// a path that is outside whatever root the server was given.
async function withServer(allowedRoot, fn, run) {
  const { server, listen } = createBuildServer({ makeClientFor: fakeClientFor, allowedRoot, ...(run ? { run } : {}) });
  const addr = await listen(0); // 0 = OS-assigned free port, so tests never collide on 7778
  try { return await fn(`http://127.0.0.1:${addr.port}`); } finally { server.close(); }
}

// A pipeline that stays in flight until released. The REAL pipeline cannot test the concurrency
// guard: with no vendor credentials present it fails within milliseconds (the agy_google scout
// throws before any model call), emptying the in-flight set before a second request can collide.
function heldRunner() {
  const releases = [];
  const started = [];
  const run = async spec => {
    started.push(spec.key);
    await new Promise(r => releases.push(r));
    return { ok: true, shipped: false, key: spec.key, board: "/tmp/fixture", outDir: "/tmp/fixture", error: null, salvaged: null };
  };
  run.started = started;
  run.releaseAll = () => { for (const r of releases.splice(0)) r(); };
  return run;
}

function withTmp(fn) {
  const dir = mkdtempSync(join(tmpdir(), "pantheon-build-server-"));
  return Promise.resolve(fn(dir)).finally(() => rmSync(dir, { recursive: true, force: true }));
}

const ticketFor = (dir, key) => ({
  key, repo_root: dir, title: "t", goal: "g", slot: "out.txt", path: "out.txt",
  copy: [], acceptance_cmd: "sleep 1 && exit 1", question: "q",
});

const post = (base, ticket) => fetch(`${base}/build`, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ticket }),
});

test("POST /build with a repo_root outside allowedRoot is refused with 400", async () => {
  await withTmp(dir => withServer(dir, async base => {
    const res = await post(base, { ...ticketFor(dir, "x"), repo_root: "/etc" });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /repo_root/);
  }));
});

test("a repo_root that only string-prefixes allowedRoot is refused (/Projects-evil vs /Projects)", async () => {
  await withTmp(dir => withServer(dir, async base => {
    const res = await post(base, { ...ticketFor(dir, "x"), repo_root: `${dir}-evil` });
    assert.equal(res.status, 400);
  }));
});

test("POST /build from a non-loopback Origin is refused with 403", async () => {
  await withTmp(dir => withServer(dir, async base => {
    const res = await fetch(`${base}/build`, {
      method: "POST", headers: { "content-type": "application/json", origin: "http://attacker.example" },
      body: JSON.stringify({ ticket: ticketFor(dir, "x") }),
    });
    assert.equal(res.status, 403);
  }));
});

test("POST /build with a non-JSON content type is refused with 415", async () => {
  await withTmp(dir => withServer(dir, async base => {
    const res = await fetch(`${base}/build`, {
      method: "POST", headers: { "content-type": "text/plain" },
      body: JSON.stringify({ ticket: ticketFor(dir, "x") }),
    });
    assert.equal(res.status, 415);
  }));
});

// ---------------------------------------------------------------- containment
// Every one of these was an executed escape before the containment pass. The ticket used to be
// hand-written by the operator; it is now drafted by a model from a document another model wrote,
// so every path-shaped field is untrusted input, not just repo_root.

test("a ticket.key that escapes its directory is refused, not path-joined", async () => {
  await withTmp(dir => withServer(dir, async base => {
    const res = await post(base, { ...ticketFor(dir, "../../../../escaped-by-key"), key: "../../../../escaped-by-key" });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /ticket\.key/);
  }));
});

test("a ticket.key with a path separator is refused", async () => {
  await withTmp(dir => withServer(dir, async base => {
    assert.equal((await post(base, { ...ticketFor(dir, "a"), key: "nested/key" })).status, 400);
  }));
});

test("copy[] entries that escape repo_root are refused", async () => {
  await withTmp(dir => withServer(dir, async base => {
    const res = await post(base, { ...ticketFor(dir, "a"), copy: ["../../outside/id_rsa"] });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /copy/);
  }));
});

test("attach[] entries that escape repo_root are refused -- their CONTENTS reach four vendor labs", async () => {
  await withTmp(dir => withServer(dir, async base => {
    const res = await post(base, { ...ticketFor(dir, "a"), attach: ["../../../.ssh/id_rsa"] });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /attach/);
  }));
});

test("source and tests_file that escape repo_root are refused", async () => {
  await withTmp(dir => withServer(dir, async base => {
    assert.equal((await post(base, { ...ticketFor(dir, "a"), source: "../../etc/passwd" })).status, 400);
    assert.equal((await post(base, { ...ticketFor(dir, "b"), tests_file: "../../etc/passwd" })).status, 400);
  }));
});

test("an absolute path in copy[] is refused too, not just a traversing relative one", async () => {
  await withTmp(dir => withServer(dir, async base => {
    assert.equal((await post(base, { ...ticketFor(dir, "a"), copy: ["/etc/passwd"] })).status, 400);
  }));
});

test("a relative repo_root is refused: the API and the pipeline would resolve it against different bases", async () => {
  await withTmp(dir => withServer(dir, async base => {
    const res = await post(base, { ...ticketFor(dir, "a"), repo_root: "../../secrets" });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /absolute/);
  }));
});

test("a symlinked repo_root pointing outside allowedRoot is refused", async () => {
  await withTmp(async dir => {
    const outside = mkdtempSync(join(tmpdir(), "pantheon-outside-"));
    const link = join(dir, "innocent-project");
    try {
      symlinkSync(outside, link);
      await withServer(dir, async base => {
        const res = await post(base, { ...ticketFor(dir, "a"), repo_root: link });
        assert.equal(res.status, 400);
      });
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

// A caller that polls for the outcome (LEXI does) has to know where run.json will be, and must not
// reimplement the path formula -- that is how two copies drift. The 202 carries it.
test("the 202 tells the caller where run.json will be written", async () => {
  const run = heldRunner();
  await withTmp(dir => withServer(dir, async base => {
    const res = await post(base, ticketFor(dir, "wheresMyRun"));
    assert.equal(res.status, 202);
    const body = await res.json();
    assert.equal(body.out_dir, join(dir, "outputs", "open-items", "wheresMyRun"));
    assert.equal(body.run_json, join(dir, "outputs", "open-items", "wheresMyRun", "run.json"));
    run.releaseAll();
  }, run));
});

test("the legitimate ticket the other tests use is still accepted", async () => {
  const run = heldRunner();
  await withTmp(dir => withServer(dir, async base => {
    assert.equal((await post(base, ticketFor(dir, "stillFine"))).status, 202);
    run.releaseAll();
  }, run));
});

test("two DIFFERENT tickets may run at once, but a third concurrent request is refused with 409", async () => {
  const run = heldRunner();
  await withTmp(dir => withServer(dir, async base => {
    assert.equal((await post(base, ticketFor(dir, "a"))).status, 202);
    assert.equal((await post(base, ticketFor(dir, "b"))).status, 202);
    const third = await post(base, ticketFor(dir, "c"));
    assert.equal(third.status, 409);
    assert.match((await third.json()).error, /2 build/);
    assert.deepEqual(run.started, ["a", "b"], "the refused third build must never have started");
    run.releaseAll();
  }, run));
});

test("a slot freed by a finished build is usable again", async () => {
  const run = heldRunner();
  await withTmp(dir => withServer(dir, async base => {
    assert.equal((await post(base, ticketFor(dir, "a"))).status, 202);
    assert.equal((await post(base, ticketFor(dir, "b"))).status, 202);
    assert.equal((await post(base, ticketFor(dir, "c"))).status, 409);
    run.releaseAll();
    await new Promise(r => setTimeout(r, 50));   // let the finally{} drain the in-flight set
    assert.equal((await post(base, ticketFor(dir, "c"))).status, 202);
    run.releaseAll();
  }, run));
});

test("the SAME ticket key twice at once is refused with 409 even under the concurrency limit", async () => {
  const run = heldRunner();
  await withTmp(dir => withServer(dir, async base => {
    assert.equal((await post(base, ticketFor(dir, "x"))).status, 202);
    const second = await post(base, ticketFor(dir, "x"));
    assert.equal(second.status, 409);
    assert.match((await second.json()).error, /already running/);
    assert.deepEqual(run.started, ["x"], "the duplicate must never have started a second run");
    run.releaseAll();
  }, run));
});

// C4: "2 concurrent builds" has to mean concurrent. The pipeline shells out (an acceptance command,
// the Antigravity seat), and while those ran under spawnSync they blocked the single-threaded
// server: two 3s builds took 6s and NOTHING was answered in between -- not /builds, not the SSE
// stream that is the whole point of the progress design, and not LEXI's own 10s-timeout POST,
// which would report "couldn't reach Pantheon" while Pantheon sat there mid-build.
test("the server keeps answering while a build shells out -- spawn must not block the loop", async () => {
  // A runner that shells out the way the real pipeline does, via the same helper.
  const run = async () => {
    await spawnPromise("sh", ["-c", "sleep 0.6"], {});
    return { ok: true, shipped: false, key: "x", board: "/tmp/f", outDir: "/tmp/f", error: null, salvaged: null };
  };
  await withTmp(dir => withServer(dir, async base => {
    const started = Date.now();
    assert.equal((await post(base, ticketFor(dir, "slow"))).status, 202);

    // While that build is shelling out, the server must still answer.
    const probe = Date.now();
    const res = await fetch(`${base}/builds`);
    const probeMs = Date.now() - probe;
    assert.equal(res.status, 200);
    assert.deepEqual((await res.json()).running, ["slow"], "the in-flight build should be visible WHILE it runs");
    assert.ok(probeMs < 300, `/builds answered in ${probeMs}ms; a blocked loop would make it wait out the subprocess`);
    assert.ok(Date.now() - started < 600, "the probe returned before the subprocess finished");
  }, run));
});

test("two builds that shell out overlap in wall-clock rather than running end to end", async () => {
  const run = async () => {
    await spawnPromise("sh", ["-c", "sleep 0.6"], {});
    return { ok: true, shipped: false, key: "x", board: "/tmp/f", outDir: "/tmp/f", error: null, salvaged: null };
  };
  await withTmp(dir => withServer(dir, async base => {
    const started = Date.now();
    await Promise.all([post(base, ticketFor(dir, "a")), post(base, ticketFor(dir, "b"))]);
    // Wait for both to drain.
    while ((await (await fetch(`${base}/builds`)).json()).running.length > 0) {
      await new Promise(r => setTimeout(r, 20));
    }
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 1000, `two 600ms builds took ${elapsed}ms; serial execution would need ~1200ms`);
  }, run));
});

test("every event on the shared bus carries the ticket key, so two builds can be told apart", async () => {
  await withTmp(dir => withServer(dir, async base => {
    const events = [];
    const ac = new AbortController();
    const streamed = fetch(`${base}/events`, { signal: ac.signal }).then(async res => {
      for await (const chunk of res.body) {
        for (const line of Buffer.from(chunk).toString("utf8").split("\n")) {
          if (line.startsWith("data: ")) { try { events.push(JSON.parse(line.slice(6))); } catch { /* ping */ } }
        }
      }
    }).catch(() => { /* aborted */ });

    await post(base, ticketFor(dir, "tagged"));
    await new Promise(r => setTimeout(r, 300));
    ac.abort();
    await streamed;

    assert.ok(events.length > 0, "the build published at least one event");
    const untagged = events.filter(e => e.key !== "tagged");
    assert.deepEqual(untagged, [], "every event must carry key: a shared bus with two builds is otherwise unreadable");
  }));
});
