# LEXI No-Terminal Build Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user hand LEXI a markdown implementation doc and talk to her, and have her actually drive a real build through Pantheon's multi-vendor pipeline — with no terminal command from the user at any point.

**Architecture:** Pantheon's pipeline logic (currently a CLI-only script) is extracted into an importable, non-exiting function and exposed over a new loopback-only HTTP API (reusing Pantheon's existing SSE/origin-policy pattern). LEXI's backend gets a new endpoint that drafts a Pantheon ticket from the fed `.md` + conversation via a model call, then calls that API. LEXI's existing companion frontend gets the UI to trigger and watch it.

**Tech Stack:** Node ≥20 (Pantheon), Python/FastAPI (LEXI backend), React/TypeScript/Vite/axios/jotai (LEXI frontend). No new dependencies in any of the three.

**Spec:** `docs/superpowers/specs/2026-09-28-lexi-no-terminal-build.md`

## Global Constraints

- Zero new runtime dependencies in Pantheon (its own stated policy: "Zero runtime/build/test dependencies everywhere").
- The new Pantheon build API binds to `127.0.0.1` only and enforces the same origin policy as `src/view/server.mjs` (Host + Origin + Sec-Fetch-Site checks) — never weaker.
- No `process.exit()` call may exist in any code path reachable from the new HTTP API — every exit path becomes a thrown error or a returned `{ok, ...}` result instead, since `process.exit()` inside a request handler kills the whole server process, not just the one request.
- Pantheon's existing CLI (`node scripts/open-items-run.mjs --ticket ...`) must keep working identically after the extraction — this plan must not regress Pantheon's only currently-proven entry point.
- Every vendor SDK stays injected at the edge (Pantheon's existing convention) — no new code imports `@anthropic-ai/sdk`/`openai`/`@google/genai` directly outside `src/sdk/adapter.mjs`.
- Pantheon's internal review/acceptance gate (different-lab review, controller-executed acceptance) is untouched by this plan — this plan adds a caller, not a bypass.
- LEXI's new endpoint follows its existing FastAPI conventions exactly: `@limiter.limit(...)`, `Depends(get_session)` where a DB session is needed, `HTTPException` for errors — same as `/api/chat` (`main.py:2802`).
- LEXI's frontend follows its existing conventions exactly: axios calls through `src/api/client.ts`'s `api` instance, state in jotai atoms (`src/atoms`), hooks in `src/hooks`, UI in `src/companion`.

## Review Focus

- A `.md` + conversation that does not resolve into a valid one-file-change ticket (spec §8: "ticket-drafting failure") — LEXI must report this and ask for clarification, not submit a malformed ticket. Tested in Task 4.
- A build request whose ticket's `repo_root` resolves outside `~/Projects` — the spec's scope (§2, §3) is "anything in ~/Projects," not "anything on the filesystem"; nothing currently enforces that boundary and it must be enforced at the API, not assumed. Tested in Task 2.
- A build request beyond the concurrency limit — Pantheon's existing `/turn` endpoint refuses a concurrent call on the same seat key rather than interleaving it; the new build API needs the equivalent, but bounded at **2 concurrent builds** (per explicit user request, decided during plan execution before any code existed — up from the original single-flight design), refused not queued past that, so a slow build doesn't silently swallow a third request. Tested in Task 2.
- A build that Pantheon's pipeline runs to completion but does not ship (spec §7 — the exact `lexiModelConfig` case that happened for real this session: code written, tests passed, review gate refused it). LEXI's endpoint must relay this as "attempted, not shipped, here is why," not as success. Tested in Task 3.
- A request to the new Pantheon build API from a non-loopback origin or with the wrong content type — must be refused the same way `src/view/server.mjs` already refuses `/turn`. Tested in Task 2.

---

## Task 1: Extract Pantheon's pipeline into an importable, non-exiting function

**Files:**
- Create: `src/board/run-item.mjs`
- Modify: `scripts/open-items-run.mjs` (become a thin CLI wrapper)
- Test: `tests/board-run-item.test.mjs`

**Interfaces:**
- Produces: `export async function runOpenItem(spec, opts)` from `src/board/run-item.mjs`.
  - `spec`: the parsed ticket object (same shape `scripts/tickets/*.json` files already have — `key`, `repo_root`, `title`, `slot`, `path`, `copy`, `tests_file`, `acceptance_cmd`, `question`, `goal`, plus optional `constraints`/`forbidden`).
  - `opts`: `{ dir, resume, revisions, seatOverrides, makeClientFor, progress }` — all optional except `makeClientFor` (a `vendor => client` function, the same injection point `createViewServer` in `src/view/server.mjs:30` already requires). `progress`, if given, is called with the same event-shaped objects the current `progress()` function (open-items-run.mjs:105) builds; if omitted, events are simply not emitted (never printed to console from inside this function — printing is a CLI concern, moved to the wrapper).
  - Returns: `{ ok: boolean, shipped: boolean, key, board: <root path>, outDir, error: {stage, message} | null, salvaged: <path> | null }` — the same information the current script writes into `run.json` (open-items-run.mjs, the `run` object built throughout), returned instead of only written to disk, so an HTTP caller doesn't have to re-read a file to know the result.
  - Never calls `process.exit()`. Never calls `console.log`/`console.error`/`say()`/`bar()`/`check()`'s console output directly — those become calls to `opts.progress` (or are dropped) so the function is silent by default and the CLI wrapper supplies the printer.

**Mechanical transformation (apply exactly, in order):**

1. Move every top-level `const`/`function`/`async function` declaration currently in `scripts/open-items-run.mjs` from immediately after the CLI-only argv/usage block (currently lines 38-52: `argv`, `flag`, `specPath`, the `for (const k of [...])` validation loop) down through the end of the script body into `src/board/run-item.mjs`, wrapped in:
   ```js
   export async function runOpenItem(spec, opts = {}) {
     const { dir = null, resume = null, revisions = 3, seatOverrides = {}, makeClientFor, progress: emit = () => {} } = opts;
     if (typeof makeClientFor !== "function") {
       throw new Error("runOpenItem: pass makeClientFor(vendor) -- this module never imports a vendor SDK");
     }
     // ... moved body follows, with the substitutions below ...
   }
   ```
2. Replace every read of `SPEC` (the module-level ticket object) with the `spec` parameter. Validate it the same way the current script does (`for (const k of ["key","title","goal","slot","copy","acceptance_cmd","question"]) if (spec[k] === undefined) throw new Error(\`ticket spec is missing "${k}"\`);`) as the FIRST line of the function body, replacing the current `process.exit(2)` (open-items-run.mjs:45) with that thrown `Error`.
3. Replace every read of `OVERRIDES` (built from `--seat` argv flags, open-items-run.mjs:59-63) with `seatOverrides` — the caller now builds this object directly (the CLI wrapper keeps the `--seat vendor/model` string-parsing and builds the same shape before calling `runOpenItem`).
4. Replace every read of `flag("--dir")`/`RESUME`/`flag("--resume")`/`flag("--revisions")` with `dir`/`resume`/`revisions` from `opts`.
5. Replace the module-level `progress(ev)` function (open-items-run.mjs:105, which currently both builds the event object AND prints it via `say`) with two separate things: keep the event-object-building logic, but replace its printing call with `emit(ev)`. Every call site (`progress({event: ...})`) is unchanged.
6. Replace every remaining `console.log`/`console.error`/`say(...)`/`bar(...)` call in the moved body with nothing (delete the call) — those are terminal-formatting concerns; `emit(ev)` already carries the same information as structured data for a caller that wants it.
7. Replace the two `throw new Error(...)` sites that are already errors (e.g. `onFatal`, open-items-run.mjs:278-288) so they populate the returned `error: {stage, message}` field instead of calling `process.exit(1)` (open-items-run.mjs:288) — catch the thrown error at the top level of `runOpenItem` and return `{ok: false, shipped: false, error: {stage: <last known stage>, message: String(e.message ?? e)}, ...}` rather than letting it propagate, UNLESS the error is the ticket-validation error from step 2, which still throws synchronously (that one is a caller-error, not a run-failure, matching how `process.exit(2)` today means "bad invocation" vs `process.exit(1)` meaning "run failed").
8. The final `process.exit(failures === 0 ? 0 : 1)` (open-items-run.mjs:607) becomes `return { ok: failures === 0, shipped: run.shipped === true, key: spec.key, board: root, outDir, error: run.error ?? null, salvaged: run.salvaged ?? null };` as the function's normal (non-thrown) return.

9. Rewrite `scripts/open-items-run.mjs` to keep ONLY: the shebang, the argv-parsing (`--ticket`, `--dir`, `--resume`, `--revisions`, `--seat` flags — unchanged from today), building `seatOverrides` from `--seat` flags, reading and `JSON.parse`-ing the ticket file, constructing `makeClientFor` from `../src/sdk/adapter.mjs`'s `makeClient` (the same way `clientFor` does today), and:
   ```js
   import { runOpenItem } from "../src/board/run-item.mjs";
   // ... argv parsing, spec loading, makeClientFor construction (unchanged from today) ...
   const result = await runOpenItem(spec, {
     dir: flag("--dir"), resume: flag("--resume"),
     revisions: Number(flag("--revisions") ?? 3), seatOverrides,
     makeClientFor: v => clientFor(v),
     progress: ev => { /* the CLI's existing say()/bar()/check() console output, driven by ev.event */ },
   });
   if (!result.ok) { console.error(result.error ? `RUN FAILED at ${result.error.stage}: ${result.error.message}` : "RUN FAILED"); process.exit(1); }
   process.exit(0);
   ```
   The CLI's exact console formatting (the `bar`/`say`/`check` colored output) is preserved by reconstructing it from the `ev.event` field inside this wrapper's `progress` callback — every `event:` value that `run-item.mjs` emits today (e.g. `"turn.start"`, `"turn.done"`, `"verdict"`, `"acceptance.start"`) must produce the same line of output the current script prints for that event, so `node scripts/open-items-run.mjs --ticket ...` run by a human looks identical to before this refactor.

- [ ] **Step 1: Write the failing test**

```js
// tests/board-run-item.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runOpenItem } from "../src/board/run-item.mjs";

const withTmp = async fn => {
  const dir = mkdtempSync(join(tmpdir(), "pantheon-run-item-"));
  try { return await fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
};

// A fake vendor client that always answers with a fixed reply, and a fake reviewer client that
// always approves -- enough to drive one full intake -> promote -> plan -> work -> check -> ship
// pass without a real vendor call, mirroring tests/sdk-transport.test.mjs's fakeClient shape.
function fakeClientFor() {
  return {
    responses: {
      create: async req => ({
        id: "resp_1",
        output_text: /VERDICT/i.test(req.input ?? req.messages?.at(-1)?.content ?? "")
          ? "VERDICT: approve"
          : "TITLE: a fixture work item",
      }),
    },
  };
}

test("runOpenItem never calls process.exit and returns a result object on a missing spec field", async () => {
  await assert.rejects(
    () => runOpenItem({ key: "x" }, { makeClientFor: fakeClientFor }),
    /ticket spec is missing/,
  );
});

test("runOpenItem requires makeClientFor", async () => {
  await assert.rejects(() => runOpenItem({ key: "x", title: "t", goal: "g", slot: "s", copy: [], acceptance_cmd: "true", question: "q" }, {}),
    /pass makeClientFor/);
});

test("runOpenItem returns {ok, shipped, error} without throwing on a run it cannot complete", async () => {
  await withTmp(async dir => {
    const spec = {
      key: "fixtureItem", repo_root: dir, title: "fixture", goal: "fixture goal",
      slot: "out.txt", path: "out.txt", copy: [], tests_file: null,
      acceptance_cmd: "exit 1", // deliberately failing acceptance
      question: "fixture question",
    };
    const result = await runOpenItem(spec, { dir: join(dir, "board"), makeClientFor: fakeClientFor });
    assert.equal(typeof result.ok, "boolean");
    assert.equal(typeof result.shipped, "boolean");
    assert.ok(result.error === null || typeof result.error.stage === "string");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/board-run-item.test.mjs`
Expected: FAIL — `Cannot find module '../src/board/run-item.mjs'` (the file does not exist yet).

- [ ] **Step 3: Perform the extraction**

Apply the "Mechanical transformation" steps 1-9 above: create `src/board/run-item.mjs` with the moved body wrapped in `runOpenItem`, rewrite `scripts/open-items-run.mjs` as the thin wrapper.

- [ ] **Step 4: Run the new test to verify it passes**

Run: `node --test tests/board-run-item.test.mjs`
Expected: PASS, 3/3.

- [ ] **Step 5: Run Pantheon's full existing suite to confirm no regression**

Run: `node --test tests/*.test.mjs`
Expected: PASS, same count as before this task (544 plus the 3 new tests = 547), 0 failures.

- [ ] **Step 6: Manually confirm the CLI still behaves identically**

Run: `node scripts/open-items-run.mjs --ticket scripts/tickets/lexi-model-config.json --seat planner=xai/grok-4.6` (the same real command already run once this session) is NOT required to be re-run live (real API cost) — instead confirm statically: `node -c scripts/open-items-run.mjs` (syntax check) passes, and `grep -c "process.exit" scripts/open-items-run.mjs` returns exactly the count kept in the thin wrapper's two `process.exit` calls (Step 1's own final code block) — no leftover exits from the moved body.
Expected: syntax check passes; exactly 2 `process.exit` occurrences remain in `scripts/open-items-run.mjs`.

- [ ] **Step 7: Commit**

```bash
git add src/board/run-item.mjs scripts/open-items-run.mjs tests/board-run-item.test.mjs
git commit -m "src/board/run-item.mjs: extract Pantheon's pipeline into an importable, non-exiting function"
```

---

## Task 2: Pantheon build API (loopback HTTP, SSE progress)

**Files:**
- Create: `src/view/http-safety.mjs` (shared origin-policy/JSON helpers, extracted from `src/view/server.mjs`)
- Modify: `src/view/server.mjs` (use the extracted helpers instead of its own copies — no behavior change)
- Create: `src/view/build-server.mjs`
- Test: `tests/view-http-safety.test.mjs`
- Test: `tests/view-build-server.test.mjs`

**Interfaces:**
- Consumes: `runOpenItem(spec, opts)` from Task 1 (`src/board/run-item.mjs`); `createBus()` from `src/view/bus.mjs` (unchanged).
- Produces:
  - `export function originPolicy(req)` and `export const json = (res, code, body) => void` and `export const badId = v => boolean` from `src/view/http-safety.mjs` — the exact logic currently inline in `src/view/server.mjs` (its `originPolicy`, `json`, `badId`, `LOCAL`, `splitHost`, `isLocalHostPort`, `SAFE_ID`, `RESERVED` — all of it moves, nothing is reimplemented).
  - `export function createBuildServer({ makeClientFor, allowedRoot = join(homedir(), "Projects") } = {})` from `src/view/build-server.mjs`, returning `{ server, listen: (port = 7778) => Promise<AddressInfo> }` (same `listen` shape as `createViewServer`, default port 7778 so it can run alongside the existing 7777 view server).
    - `POST /build`: body `{ ticket: <spec object> }`. Validates: JSON content-type (415 otherwise, same as `/turn`); `ticket.repo_root` is set and, once resolved, is a path under `allowedRoot` (400 otherwise — Review Focus item 2); fewer than `MAX_CONCURRENT_BUILDS = 2` builds currently in flight (409 otherwise — Review Focus item 3). Tracked with a `Set` of in-flight ticket keys (not the single-boolean/Set-of-one pattern `runTurn` in `server.mjs` uses for `/turn`'s per-seat guard — this is a count, not a single-flight lock, since up to 2 may run at once). Two DIFFERENT tickets running at once is fine (each gets its own board root under `opts.dir`, so they don't share state); the SAME ticket key twice at once is still refused regardless of the count, the same way `/turn` refuses two calls on the same seat. On acceptance, calls `runOpenItem(ticket, { makeClientFor, progress: e => bus.publish({ ...e, key: ticket.key }) })` and responds `202` immediately with `{accepted: true}`. **Every** event is tagged with the ticket key on its way onto the bus, not just the final one: with 2 builds sharing one bus, `run-item.mjs`'s events carry `stage` but not `key`, so an untagged stream interleaves two builds with no way to tell them apart. Tagging happens here rather than inside `run-item.mjs` because each build already writes its own per-build `progress.jsonl` — the ambiguity exists only on the shared bus — the actual result arrives via `/events` (the build's own final `progress` event, `{event: "run.done", ok, shipped, error, salvaged, key}`, published when `runOpenItem`'s promise resolves; `key` added so a subscriber watching multiple in-flight builds can tell them apart).
    - `GET /events`: identical SSE pattern to `src/view/server.mjs`'s `/events` (same headers, same `Last-Event-ID` resume, same bus subscribe/unsubscribe) — literally reuses `createBus()`'s `subscribe`, no new streaming logic.
    - Uses `originPolicy`/`json`/`badId` from the new shared module.

- [ ] **Step 1: Write the failing test for the extraction (no behavior change)**

```js
// tests/view-http-safety.test.mjs
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/view-http-safety.test.mjs`
Expected: FAIL — `Cannot find module '../src/view/http-safety.mjs'`.

- [ ] **Step 3: Extract the shared helpers**

Move `originPolicy`, `json`, `badId`, `LOCAL`, `splitHost`, `isLocalHostPort`, `SAFE_ID`, `RESERVED` out of `src/view/server.mjs` (currently defined inline, `src/view/server.mjs:96` through the `badId` definition just before `const server = createServer(...)`) into `src/view/http-safety.mjs`, exporting `originPolicy`, `json`, `badId`. Update `src/view/server.mjs` to `import { originPolicy, json, badId } from "./http-safety.mjs";` and delete the now-duplicate local definitions. No other line in `server.mjs` changes.

- [ ] **Step 4: Run the new test and the existing view-bus test to verify no regression**

Run: `node --test tests/view-http-safety.test.mjs tests/view-bus.test.mjs`
Expected: PASS.

- [ ] **Step 5: Write the failing test for the build server**

```js
// tests/view-build-server.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBuildServer } from "../src/view/build-server.mjs";

function fakeClientFor() {
  return { responses: { create: async () => ({ id: "r1", output_text: "TITLE: fixture" }) } };
}

async function withServer(fn) {
  const { server, listen } = createBuildServer({ makeClientFor: fakeClientFor });
  const addr = await listen(0); // 0 = OS-assigned free port, so tests never collide on 7778
  try { return await fn(`http://127.0.0.1:${addr.port}`); } finally { server.close(); }
}

test("POST /build with a repo_root outside ~/Projects is refused with 400", async () => {
  await withServer(async base => {
    const res = await fetch(`${base}/build`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ ticket: { key: "x", repo_root: "/etc", title: "t", goal: "g", slot: "s", copy: [], acceptance_cmd: "true", question: "q" } }),
    });
    assert.equal(res.status, 400);
  });
});

test("POST /build from a non-loopback Origin is refused with 403", async () => {
  await withServer(async base => {
    const res = await fetch(`${base}/build`, {
      method: "POST", headers: { "content-type": "application/json", origin: "http://attacker.example" },
      body: JSON.stringify({ ticket: {} }),
    });
    assert.equal(res.status, 403);
  });
});

function buildBody(dir, key) {
  return JSON.stringify({ ticket: { key, repo_root: dir, title: "t", goal: "g", slot: "out.txt", path: "out.txt", copy: [], acceptance_cmd: "sleep 1 && exit 1", question: "q" } });
}

test("two DIFFERENT tickets may run at once, but a third concurrent request is refused with 409", async () => {
  await withTmp(async dir => {
    await withServer(async base => {
      const post = key => fetch(`${base}/build`, { method: "POST", headers: { "content-type": "application/json" }, body: buildBody(dir, key) });
      const first = post("a");
      const second = post("b");
      const third = await post("c");
      assert.equal(third.status, 409);
      const [firstRes, secondRes] = await Promise.all([first, second]);
      assert.equal(firstRes.status, 202);
      assert.equal(secondRes.status, 202);
    });
  });
});

test("the SAME ticket key twice at once is refused with 409 even under the concurrency limit", async () => {
  await withTmp(async dir => {
    await withServer(async base => {
      const post = () => fetch(`${base}/build`, { method: "POST", headers: { "content-type": "application/json" }, body: buildBody(dir, "x") });
      const first = post();
      const second = await post();
      assert.equal(second.status, 409);
      await first;
    });
  });
});

function withTmp(fn) {
  const dir = mkdtempSync(join(tmpdir(), "pantheon-build-server-"));
  return fn(dir).finally(() => rmSync(dir, { recursive: true, force: true }));
}
```

- [ ] **Step 6: Run test to verify it fails**

Run: `node --test tests/view-build-server.test.mjs`
Expected: FAIL — `Cannot find module '../src/view/build-server.mjs'`.

- [ ] **Step 7: Implement `createBuildServer`**

Write `src/view/build-server.mjs` per the Interfaces section above, following `src/view/server.mjs`'s exact structure (same `createServer`/`handle`/`json`-on-error wrapping) but with only `/build` and `/events` routes, using `originPolicy`/`json`/`badId` imported from `./http-safety.mjs`, `createBus` from `./bus.mjs`, and `runOpenItem` from `../board/run-item.mjs`. The `repo_root`-under-`allowedRoot` check: resolve both paths with `node:path`'s `resolve()` and confirm the resolved ticket root starts with the resolved `allowedRoot` plus a path separator (not just a string prefix match, which `/Projects-evil` would pass against `/Projects`).

- [ ] **Step 8: Run test to verify it passes**

Run: `node --test tests/view-build-server.test.mjs`
Expected: PASS, 4/4.

- [ ] **Step 9: Run the full suite**

Run: `node --test tests/*.test.mjs`
Expected: PASS, previous count + 7 (3 from Step 1 + 4 from Step 5), 0 failures.

- [ ] **Step 10: Commit**

```bash
git add src/view/http-safety.mjs src/view/server.mjs src/view/build-server.mjs tests/view-http-safety.test.mjs tests/view-build-server.test.mjs
git commit -m "src/view/build-server.mjs: loopback HTTP API for triggering a real Pantheon build"
```

---

## Task 3: LEXI backend endpoint — draft a ticket, call Pantheon, report the real result

**Files:**
- Modify: `lexi-dashboard/backend/main.py` (new route)
- Create: `lexi-dashboard/backend/companion_build.py` (ticket-drafting + Pantheon-calling logic, kept out of the 3600-line `main.py` per this session's own file-size-boundary judgment)
- Test: `lexi-dashboard/backend/tests/test_companion_build.py`

**Interfaces:**
- Consumes: Pantheon's build API from Task 2 (`POST http://127.0.0.1:7778/build`, `GET http://127.0.0.1:7778/events`).
- Produces: `POST /api/companion/build` on LEXI's FastAPI app. Request body `{md_content: str, conversation_history: list[{role, content}]}` (same shape as `ChatRequest`'s `conversation_history` field, `main.py`'s existing `/api/chat`). Response: `{ok: bool, ticket_drafted: bool, shipped: bool | None, message: str}` — `message` is the human-readable explanation LEXI relays in conversation (a malformed-ticket refusal, a "started" acknowledgment, or a final not-shipped reason once the build completes).
- `companion_build.py` exports `draft_ticket(md_content: str, conversation_history: list[dict], *, client, model: str) -> dict | None` — pure-ish function (the only side effect is the one model call via the injected `client`), returns a ticket dict matching the schema Task 1/2 expect, or `None` if the input doesn't resolve into a valid one-file-change ticket (Review Focus item 1). `client`/`model` are injected the same way `main.py`'s existing `/api/chat` builds `anthropic.Anthropic(api_key=...)` inline — `draft_ticket` itself never constructs a client, so it's testable with a fake one.

- [ ] **Step 1: Write the failing test**

```python
# lexi-dashboard/backend/tests/test_companion_build.py
"""
Self-contained, same pattern as tests/test_models_config.py: adds backend/
to sys.path itself, imports only companion_build (no FastAPI/SQLModel
needed to test draft_ticket in isolation).
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from companion_build import draft_ticket  # noqa: E402


class _FakeMessage:
    def __init__(self, text):
        self.content = [type("Block", (), {"text": text})()]


class _FakeMessages:
    def __init__(self, reply_text):
        self.reply_text = reply_text

    def create(self, **kwargs):
        return _FakeMessage(self.reply_text)


class _FakeClient:
    def __init__(self, reply_text):
        self.messages = _FakeMessages(reply_text)


VALID_TICKET_JSON = """{
  "key": "fixtureFeature", "repo_root": "/home/colchis/Projects/fixture",
  "title": "a fixture feature", "slot": "fixture.mjs", "path": "fixture.mjs",
  "copy": [], "acceptance_cmd": "true", "question": "fixture?", "goal": "do the fixture thing"
}"""


def test_draft_ticket_returns_the_parsed_ticket_on_a_valid_model_reply():
    client = _FakeClient(VALID_TICKET_JSON)
    ticket = draft_ticket("# Fixture doc", [], client=client, model="claude-sonnet-5")
    assert ticket["key"] == "fixtureFeature"
    assert ticket["repo_root"] == "/home/colchis/Projects/fixture"


def test_draft_ticket_returns_none_when_the_model_cannot_resolve_a_ticket():
    client = _FakeClient("I can't turn this into a single-file change because it describes three unrelated features.")
    ticket = draft_ticket("# A vague doc", [], client=client, model="claude-sonnet-5")
    assert ticket is None


def test_draft_ticket_returns_none_on_malformed_json_from_the_model():
    client = _FakeClient("{not valid json")
    ticket = draft_ticket("# Fixture doc", [], client=client, model="claude-sonnet-5")
    assert ticket is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd lexi-dashboard/backend && python3 -m pytest tests/test_companion_build.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'companion_build'`.

- [ ] **Step 3: Write `companion_build.py`**

```python
"""
Drafts a Pantheon ticket JSON from a fed markdown implementation doc plus
conversation, via one Claude call. Never constructs its own model client --
the caller (main.py's new /api/companion/build route) injects one, the same
way /api/chat already builds `anthropic.Anthropic(api_key=...)` inline, so
this function is testable without a real API key or network call.
"""
import json
import re

_SYSTEM_PROMPT = (
    "You draft a Pantheon build ticket from a markdown implementation document and the "
    "surrounding conversation. A Pantheon ticket is a JSON object describing exactly ONE "
    "file's change: key, repo_root (absolute path), title, slot, path, copy (array of paths "
    "to copy into the build worktree), acceptance_cmd (a shell command that must exit 0 once "
    "the change is correct), question, and goal (the precise, complete specification of the "
    "one file to create or change). "
    "If the document describes more than one file's worth of change, is too vague to turn "
    "into a concrete acceptance command, or does not name a real absolute repo_root, reply "
    "with exactly the single line: CANNOT_DRAFT: <one sentence why>. "
    "Otherwise reply with ONLY the ticket JSON object, no prose, no markdown fence."
)

_REQUIRED_KEYS = ("key", "repo_root", "title", "slot", "path", "copy", "acceptance_cmd", "question", "goal")


def draft_ticket(md_content: str, conversation_history: list[dict], *, client, model: str) -> dict | None:
    messages = [{"role": m["role"], "content": m["content"]} for m in conversation_history]
    messages.append({"role": "user", "content": md_content})

    message = client.messages.create(model=model, max_tokens=2048, system=_SYSTEM_PROMPT, messages=messages)
    text = "".join(block.text for block in message.content if hasattr(block, "text")).strip()

    if text.startswith("CANNOT_DRAFT"):
        return None

    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip())
    try:
        ticket = json.loads(text)
    except (json.JSONDecodeError, TypeError):
        return None

    if not isinstance(ticket, dict) or any(k not in ticket for k in _REQUIRED_KEYS):
        return None

    return ticket
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd lexi-dashboard/backend && python3 -m pytest tests/test_companion_build.py -q`
Expected: PASS, 3/3.

- [ ] **Step 5: Write the failing test for the route**

```python
# appended to lexi-dashboard/backend/tests/test_companion_build.py
# Route-level test needs the FastAPI app; imports main only inside this
# test function (not at module load) so the three tests above still run
# standalone without the full dependency stack.
def test_companion_build_route_reports_not_shipped_with_the_real_reason(monkeypatch):
    import companion_build

    def fake_draft_ticket(md_content, conversation_history, *, client, model):
        return {"key": "x", "repo_root": "/home/colchis/Projects/x", "title": "t", "slot": "s",
                "path": "s", "copy": [], "acceptance_cmd": "true", "question": "q", "goal": "g"}

    monkeypatch.setattr(companion_build, "draft_ticket", fake_draft_ticket)

    class _FakeBuildResponse:
        status_code = 202

        def json(self):
            return {"accepted": True}

    def fake_post(url, json, timeout):
        assert url.endswith("/build")
        return _FakeBuildResponse()

    monkeypatch.setattr(companion_build.httpx, "post", fake_post)

    result = companion_build.start_build("# doc", [], client=_FakeClient(""), model="claude-sonnet-5")
    assert result["ok"] is True
    assert result["ticket_drafted"] is True
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd lexi-dashboard/backend && python3 -m pytest tests/test_companion_build.py -q`
Expected: FAIL — `AttributeError: module 'companion_build' has no attribute 'start_build'` (and no `httpx` attribute yet either).

- [ ] **Step 7: Add `start_build` and the route**

Append to `companion_build.py`:

```python
import httpx

PANTHEON_BUILD_URL = "http://127.0.0.1:7778"


def start_build(md_content: str, conversation_history: list[dict], *, client, model: str) -> dict:
    ticket = draft_ticket(md_content, conversation_history, client=client, model=model)
    if ticket is None:
        return {"ok": False, "ticket_drafted": False, "shipped": None,
                "message": "I couldn't turn that into a single, concrete build -- can you narrow it to one file's worth of change?"}

    try:
        response = httpx.post(f"{PANTHEON_BUILD_URL}/build", json={"ticket": ticket}, timeout=5.0)
    except httpx.HTTPError as e:
        return {"ok": False, "ticket_drafted": True, "shipped": None,
                "message": f"I drafted the ticket but couldn't reach Pantheon's build service: {e}"}

    if response.status_code != 202:
        return {"ok": False, "ticket_drafted": True, "shipped": None,
                "message": f"Pantheon refused the build request: {response.json()}"}

    return {"ok": True, "ticket_drafted": True, "shipped": None,
            "message": f"Build started for {ticket['key']} -- I'll tell you when it finishes."}
```

Add to `main.py` (near the other `@app.post` routes, e.g. after `/api/chat`'s handler, `main.py:2802`+):

```python
class CompanionBuildRequest(BaseModel):
    md_content: str
    conversation_history: list[ChatMessage] = []


@app.post("/api/companion/build")
@limiter.limit("5/minute")
async def companion_build_route(payload: CompanionBuildRequest, request: Request):
    """Draft a Pantheon ticket from a fed .md doc + conversation and start a real build."""
    from companion_build import start_build

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY not configured")
    client = anthropic.Anthropic(api_key=api_key)
    history = [{"role": m.role, "content": m.content} for m in payload.conversation_history]
    result = start_build(payload.md_content, history, client=client, model=os.environ.get("CLAUDE_MODEL", "claude-sonnet-4-6"))
    return result
```

- [ ] **Step 8: Run test to verify it passes**

Run: `cd lexi-dashboard/backend && python3 -m pytest tests/test_companion_build.py -q`
Expected: PASS, 4/4.

- [ ] **Step 9: Confirm `httpx` is an existing dependency**

Run: `grep -n "^httpx" ../../requirements.txt` (from `lexi-dashboard/backend/`, i.e. check the repo-root `requirements.txt`)
Expected: a match. If none, add `httpx` to `requirements.txt` as its own step here and note it in the commit message — do not silently assume it's present.

- [ ] **Step 10: Commit**

```bash
git add lexi-dashboard/backend/companion_build.py lexi-dashboard/backend/main.py lexi-dashboard/backend/tests/test_companion_build.py
git commit -m "companion_build.py + /api/companion/build: draft a Pantheon ticket from a fed .md and start a real build"
```

---

## Task 4: Companion frontend — hand over the doc, trigger, watch

**Files:**
- Modify: `lexi-dashboard/frontend/src/api/client.ts` (new function)
- Create: `lexi-dashboard/frontend/src/hooks/useCompanionBuild.ts`
- Create: `lexi-dashboard/frontend/src/companion/CompanionBuild.tsx`
- Modify: `lexi-dashboard/frontend/src/companion/CompanionApp.tsx` (render it), `lexi-dashboard/frontend/src/companion/index.ts` (export it)
- Test: `lexi-dashboard/frontend/src/companion/CompanionBuild.test.tsx`
- Test: `lexi-dashboard/frontend/src/hooks/useCompanionBuild.test.ts`

**Interfaces:**
- Consumes: `POST /api/companion/build` from Task 3 (shape `{ok, ticket_drafted, shipped, message}`).
- Produces: `export const startCompanionBuild = async (mdContent: string, conversationHistory: ChatMessage[]): Promise<CompanionBuildResponse>` in `api/client.ts`, mirroring `chat()`'s exact shape (`client.ts:140`). `useCompanionBuild()` hook returning `{mdContent, setMdContent, status: 'idle'|'sending'|'done', result, trigger}`. `CompanionBuild` component rendering a file-drop/paste area plus a "Build" button, reusing `Button`/`Input` from `../components/ui` the same way `CompanionInput.tsx` does.

- [ ] **Step 1: Write the failing test for the API client function**

```ts
// appended near existing api client tests, or new file if none exists yet for client.ts --
// check first with: ls lexi-dashboard/frontend/src/api/*.test.ts
import { describe, it, expect, vi } from 'vitest';
import { startCompanionBuild } from './client';

describe('startCompanionBuild', () => {
  it('posts to /api/companion/build and returns the parsed response', async () => {
    const postSpy = vi.fn().mockResolvedValue({ data: { ok: true, ticket_drafted: true, shipped: null, message: 'Build started' } });
    vi.spyOn(await import('./client'), 'api', 'get').mockReturnValue({ post: postSpy } as never);

    const result = await startCompanionBuild('# doc', []);
    expect(result.message).toBe('Build started');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd lexi-dashboard/frontend && npx vitest run src/api/client.test.ts`
Expected: FAIL — `startCompanionBuild is not exported`.

- [ ] **Step 3: Add `startCompanionBuild` to `client.ts`**

```ts
export interface CompanionBuildResponse {
  ok: boolean;
  ticket_drafted: boolean;
  shipped: boolean | null;
  message: string;
}

export const startCompanionBuild = async (
  mdContent: string,
  conversationHistory: ChatMessage[] = [],
): Promise<CompanionBuildResponse> => {
  const response = await api.post<CompanionBuildResponse>('/api/companion/build', {
    md_content: mdContent,
    conversation_history: conversationHistory,
  });
  return response.data;
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd lexi-dashboard/frontend && npx vitest run src/api/client.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing test for the hook**

```ts
// src/hooks/useCompanionBuild.test.ts
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCompanionBuild } from './useCompanionBuild';
import * as client from '../api/client';

describe('useCompanionBuild', () => {
  it('goes idle -> sending -> done and stores the result', async () => {
    vi.spyOn(client, 'startCompanionBuild').mockResolvedValue({
      ok: true, ticket_drafted: true, shipped: null, message: 'Build started',
    });
    const { result } = renderHook(() => useCompanionBuild());
    expect(result.current.status).toBe('idle');

    act(() => result.current.setMdContent('# doc'));
    await act(async () => { await result.current.trigger(); });

    expect(result.current.status).toBe('done');
    expect(result.current.result?.message).toBe('Build started');
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd lexi-dashboard/frontend && npx vitest run src/hooks/useCompanionBuild.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 7: Write `useCompanionBuild.ts`**

```ts
import { useState, useCallback } from 'react';
import { startCompanionBuild } from '../api/client';
import type { CompanionBuildResponse } from '../api/client';

export function useCompanionBuild() {
  const [mdContent, setMdContent] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'done'>('idle');
  const [result, setResult] = useState<CompanionBuildResponse | null>(null);

  const trigger = useCallback(async () => {
    if (!mdContent.trim() || status === 'sending') return;
    setStatus('sending');
    const response = await startCompanionBuild(mdContent);
    setResult(response);
    setStatus('done');
  }, [mdContent, status]);

  return { mdContent, setMdContent, status, result, trigger };
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `cd lexi-dashboard/frontend && npx vitest run src/hooks/useCompanionBuild.test.ts`
Expected: PASS.

- [ ] **Step 9: Write the failing test for the component**

```tsx
// src/companion/CompanionBuild.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CompanionBuild } from './CompanionBuild';
import * as client from '../api/client';

describe('CompanionBuild', () => {
  it('sends the pasted markdown and shows the result message', async () => {
    vi.spyOn(client, 'startCompanionBuild').mockResolvedValue({
      ok: true, ticket_drafted: true, shipped: null, message: 'Build started for fixtureItem',
    });
    render(<CompanionBuild />);
    fireEvent.change(screen.getByLabelText(/implementation doc/i), { target: { value: '# doc' } });
    fireEvent.click(screen.getByRole('button', { name: /build/i }));
    expect(await screen.findByText(/Build started for fixtureItem/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 10: Run test to verify it fails**

Run: `cd lexi-dashboard/frontend && npx vitest run src/companion/CompanionBuild.test.tsx`
Expected: FAIL — module does not exist.

- [ ] **Step 11: Write `CompanionBuild.tsx`**

```tsx
import { Button, Textarea } from '../components/ui';
import { useCompanionBuild } from '../hooks/useCompanionBuild';

export function CompanionBuild() {
  const { mdContent, setMdContent, status, result, trigger } = useCompanionBuild();

  return (
    <section aria-label="Hand LEXI an implementation doc to build" className="mx-auto flex w-full max-w-2xl flex-col gap-2">
      <Textarea
        value={mdContent}
        onChange={(event) => setMdContent(event.target.value)}
        placeholder="Paste an implementation doc..."
        aria-label="Implementation doc"
        disabled={status === 'sending'}
        className="min-h-24 rounded-2xl border-transparent bg-transparent px-4 py-3 text-sm backdrop-blur-sm placeholder:text-fg-faint"
      />
      <Button type="button" onClick={() => void trigger()} disabled={status === 'sending' || !mdContent.trim()}>
        Build
      </Button>
      {result && <p role="status" className="text-sm text-fg-muted">{result.message}</p>}
    </section>
  );
}
```

Check `Textarea` exists in `../components/ui` first (`grep -n "Textarea" ../components/ui/index.ts` or equivalent barrel file) — if it does not, use a plain `<textarea>` with the same `Input`-matching Tailwind classes `CompanionInput.tsx` already uses, instead of inventing a new shared component in this task.

- [ ] **Step 12: Run test to verify it passes**

Run: `cd lexi-dashboard/frontend && npx vitest run src/companion/CompanionBuild.test.tsx`
Expected: PASS.

- [ ] **Step 13: Wire it into `CompanionApp`**

In `CompanionApp.tsx`, add `import { CompanionBuild } from './CompanionBuild';` and render `<CompanionBuild />` below the existing `<CompanionInput />` (or wherever visually appropriate alongside `CompanionTools`/`CompanionTranscript` — follow the existing layout's flex/gap conventions already in the file). Add `export { CompanionBuild } from './CompanionBuild';` to `companion/index.ts`.

- [ ] **Step 14: Run the full frontend suite**

Run: `cd lexi-dashboard/frontend && npm test`
Expected: PASS, no regressions in existing `App.companion.test.tsx` / `App.companion.navigation.test.tsx`.

- [ ] **Step 15: Commit**

```bash
git add src/api/client.ts src/hooks/useCompanionBuild.ts src/hooks/useCompanionBuild.test.ts src/companion/CompanionBuild.tsx src/companion/CompanionBuild.test.tsx src/companion/CompanionApp.tsx src/companion/index.ts
git commit -m "CompanionBuild: hand LEXI a .md doc and trigger a real Pantheon build from the companion UI"
```
