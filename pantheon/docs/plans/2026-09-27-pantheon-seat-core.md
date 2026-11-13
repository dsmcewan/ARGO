# Pantheon Seat Core — Implementation Plan (Plan 1 of 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Address a seat by stable identity, take a turn against a vendor CLI, resume that seat, and prove by hash chain that the conversation actually resumed rather than silently restarted.

**Architecture:** A seat is an identity record, not a process. Each turn is a short-lived `spawn` of a vendor CLI with a caller-supplied or stored session id. Before and after each turn, the vendor's own on-disk transcript is normalized to `(role, text-sha, tool-names)` and folded into a per-turn hash chain; resume is verified by checking the live transcript still *extends* the recorded chain. No tmux, no daemon, no database in this plan.

**Tech Stack:** Node 24 (`/usr/bin/node`), `node:test`, `node:crypto`, `node:child_process`. **Zero runtime dependencies.**

**Spec:** `docs/specs/2026-09-27-pantheon-design.md` (committed `9126b30`) — §3 core model, §4 capability table, §5 transport, §6.2 conversation hashing, §12 failure taxonomy. Evidence: `docs/specs/2026-09-27-evidence-base.md`.

## Global Constraints

- Node 24, native Linux `/usr/bin/node`. No transpiler, ESM only (`.mjs`).
- **Zero runtime dependencies.** Test-time too: `node --test` only.
- **No writes outside `$PANTHEON_HOME`** (default `~/.pantheon`) except paths the caller names. Never `~/.claude*`, `~/.codex*`, `~/.grok*`, `~/.gemini*`, `~/.tmux.conf`.
- **Read vendor stores read-only. Never write into a vendor's directory.**
- **No permission-bypass flag in any argv by default.** Bypass is opt-in per vendor via an explicit env var, never a bare literal. (Evidence F1–F2: `--mode plan` does **not** enforce read-only, and the bypass is not what enables writes.)
- **Never print conversation content** in logs, errors, or test output. Hashes, counts, roles and lengths only.
- Every capability is **declared then verified**. A declared capability that is not observed is a failure, never a warning (§4).
- Provenance rank on identity writes: `hook > scrape > operator > adoption`. A lower rank never clobbers a higher rank (O3).

## Review Focus

Five conditions the spec implies, that a naive reading of the tasks would leave untested, ordered by how likely they are to bite. Each has its test pinned to the owning task.

1. **A truncated final line in a vendor transcript.** JSONL written by a live process is routinely mid-line. A parser that throws loses the whole conversation; one that silently drops the partial line must still produce a stable hash. → Task 3.
2. **A resume token the vendor has pruned.** The thread is gone, resume produces a fresh conversation, and nothing printed "No conversation found" (O4 shows this is exactly how a false *resumed* happens). → Task 4 and Task 6.
3. **A seat `cwd` containing spaces or quotes.** Argv is built as an array, never a shell string; a path like `/home/x/my repo` must not split into two arguments. → Task 2.
4. **Two seats with the same `(vendor, purpose)` in different directories.** Every vendor's resume is directory-scoped (B, item 6b), so identity that ignores `cwd` silently merges two seats. → Task 1.
5. **A declared capability the installed CLI no longer has.** Vendors drop flags; `routing-matrix.json` self-flagged most rows unverified for 61 days and nothing noticed (B10). Conformance must fail closed on a missing flag. → Task 6.

---

### Task 1: Seat identity and provenance rank

**Files:**
- Create: `src/seat/identity.mjs`
- Test: `tests/seat-identity.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `seatKey({vendor, purpose, cwd}) -> string`, `RANK`, `rankOf(source) -> number`, `mergeIdentity(existing, incoming) -> {value, source, changed}`.

- [ ] **Step 1: Write the failing test**

```js
// tests/seat-identity.test.mjs
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/colchis/Projects/pantheon && node --test tests/seat-identity.test.mjs`
Expected: FAIL — `Cannot find module '../src/seat/identity.mjs'`

- [ ] **Step 3: Write minimal implementation**

```js
// src/seat/identity.mjs
// A seat is an identity, not a process. cwd is part of that identity because every vendor's
// resume is directory-scoped (evidence B item 6b) - dropping it silently merges two seats.
import { createHash } from "node:crypto";
import { resolve } from "node:path";

const REQUIRED = ["vendor", "purpose", "cwd"];

export function seatKey(seat) {
  for (const f of REQUIRED) {
    if (!seat?.[f]) throw new Error(`seatKey: missing required field "${f}"`);
  }
  // JSON canon: unambiguous under any path content, no delimiter to collide with.
  const canon = JSON.stringify([seat.vendor, seat.purpose, resolve(seat.cwd)]);
  return createHash("sha256").update(canon).digest("hex").slice(0, 16);
}

// Provenance rank, adopted from OpenRig's session-registry (evidence O3). Any fact assembled
// from signals of unequal trust needs this; seat identity is exactly such a fact.
export const RANK = { hook: 4, scrape: 3, operator: 2, adoption: 1 };

export function rankOf(source) {
  const r = RANK[source];
  if (r === undefined) throw new Error(`rankOf: unknown provenance "${source}"`);
  return r;
}

export function mergeIdentity(existing, incoming) {
  rankOf(incoming.source);
  if (!existing) return { ...incoming, changed: true };
  if (rankOf(incoming.source) < rankOf(existing.source)) {
    return { ...existing, changed: false };
  }
  return { ...incoming, changed: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/colchis/Projects/pantheon && node --test tests/seat-identity.test.mjs`
Expected: PASS, 8 tests.

- [ ] **Step 5: Run from a foreign cwd**

Run: `cd /tmp && node --test /home/colchis/Projects/pantheon/tests/seat-identity.test.mjs`
Expected: PASS. A suite that only passes in its own directory is partly testing the environment (evidence H1).

- [ ] **Step 6: Commit**

```bash
cd /home/colchis/Projects/pantheon
git add src/seat/identity.mjs tests/seat-identity.test.mjs
git commit -m "feat(seat): stable cwd-scoped identity with provenance-ranked writes"
```

---

### Task 2: Per-vendor argv construction

**Files:**
- Create: `src/seat/argv.mjs`
- Test: `tests/seat-argv.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `buildArgv({vendor, cwd, model?, effort?, resumeToken?, sessionId?, env?}) -> {cmd: string, args: string[]}`, `VENDORS` (the declared capability table), `bypassFragment(vendor, env) -> string[]`.

- [ ] **Step 1: Write the failing test**

```js
// tests/seat-argv.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildArgv, VENDORS, bypassFragment } from "../src/seat/argv.mjs";

const BYPASS = ["--dangerously-skip-permissions", "danger-full-access",
                "--dangerously-bypass-approvals-and-sandbox", "--always-approve", "--yolo"];

test("every declared vendor builds a fresh argv with no bypass flag", () => {
  for (const vendor of Object.keys(VENDORS)) {
    const { cmd, args } = buildArgv({ vendor, cwd: "/repo", sessionId: "11111111-1111-4111-8111-111111111111" });
    assert.equal(typeof cmd, "string");
    assert.ok(args.every(a => typeof a === "string"), `${vendor}: non-string in argv`);
    for (const b of BYPASS) {
      assert.ok(!args.includes(b), `${vendor}: argv must not carry ${b} by default`);
    }
  }
});

// Review Focus 3: argv is an array, so a path with spaces must remain ONE argument.
test("a cwd with spaces and quotes stays a single argument", () => {
  const cwd = `/home/x/my repo's "dir"`;
  for (const vendor of Object.keys(VENDORS)) {
    const { args } = buildArgv({ vendor, cwd, sessionId: "s" });
    if (VENDORS[vendor].cwd_flag) {
      const hits = args.filter(a => a === cwd);
      assert.equal(hits.length, 1, `${vendor}: cwd must appear exactly once, unsplit`);
      assert.equal(args[args.indexOf(VENDORS[vendor].cwd_flag) + 1], cwd,
        `${vendor}: cwd must be the single argument after its flag`);
    }
    assert.ok(!args.some(a => a !== cwd && a.includes("my repo")),
      `${vendor}: a fragment of the cwd leaked into another argument`);
  }
});

test("resume uses the vendor's own resume flag and carries the token", () => {
  const cases = {
    claude: ["--resume", "tok"],
    codex:  ["resume", "tok"],
    grok:   ["--resume", "tok"],
    agy:    ["--conversation", "tok"],
  };
  for (const [vendor, [flag, tok]] of Object.entries(cases)) {
    const { args } = buildArgv({ vendor, cwd: "/repo", resumeToken: tok });
    assert.ok(args.includes(flag), `${vendor}: expected ${flag}`);
    assert.ok(args.includes(tok), `${vendor}: expected the token in argv`);
  }
});

test("a fresh launch supplies our own session id where the vendor accepts one", () => {
  const { args } = buildArgv({ vendor: "claude", cwd: "/repo", sessionId: "abc" });
  assert.equal(args[args.indexOf("--session-id") + 1], "abc",
    "we mint the id so the seat has an address that survives restart");
});

test("resume and sessionId together is refused, not silently resolved", () => {
  assert.throws(() => buildArgv({ vendor: "claude", cwd: "/repo", sessionId: "a", resumeToken: "b" }),
    /both sessionId and resumeToken/);
});

test("an unknown vendor throws rather than producing a guess", () => {
  assert.throws(() => buildArgv({ vendor: "nope", cwd: "/repo" }), /unknown vendor/);
});

test("bypass is opt-in per vendor, exact-match on 1", () => {
  assert.deepEqual(bypassFragment("agy", {}), []);
  assert.deepEqual(bypassFragment("agy", { PANTHEON_AGY_BYPASS: "0" }), []);
  assert.deepEqual(bypassFragment("agy", { PANTHEON_AGY_BYPASS: "false" }), []);
  assert.deepEqual(bypassFragment("agy", { PANTHEON_AGY_BYPASS: "1" }), ["--dangerously-skip-permissions"]);
  assert.deepEqual(bypassFragment("claude", { PANTHEON_AGY_BYPASS: "1" }), [],
    "an agy opt-in must not arm another vendor");
});

test("the capability table declares every field the spec requires", () => {
  for (const [vendor, c] of Object.entries(VENDORS)) {
    for (const f of ["resume", "stream_in", "stream_out", "attach", "auth", "sandbox"]) {
      assert.ok(f in c, `${vendor}: capability table missing "${f}"`);
    }
    assert.equal(c.auth, "oauth", `${vendor}: every seat rides OAuth (evidence L1)`);
    assert.ok(Array.isArray(c.sandbox), `${vendor}: sandbox must be an explicit argv fragment`);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/colchis/Projects/pantheon && node --test tests/seat-argv.test.mjs`
Expected: FAIL — `Cannot find module '../src/seat/argv.mjs'`

- [ ] **Step 3: Write minimal implementation**

```js
// src/seat/argv.mjs
// Declared capabilities per vendor, measured 2026-09-27 from each binary's own --help
// (evidence B3, K3). Declared here, VERIFIED by the conformance runner in Task 6 - a row in
// this table is a claim, not a fact, until executed. routing-matrix.json self-flagged most of
// its rows unverified for 61 days and nothing noticed (B10).
export const VENDORS = {
  claude: {
    cmd: "claude", resume_flag: "--resume", session_id_flag: "--session-id", cwd_flag: null,
    model_flag: "--model", effort_flag: "--effort",
    resume: "native", stream_in: "ndjson", stream_out: "ndjson", attach: "native",
    auth: "oauth", sandbox: [], bypass_env: "PANTHEON_CLAUDE_BYPASS",
    bypass_flag: "--dangerously-skip-permissions",
    output: ["--output-format", "json"],
  },
  codex: {
    cmd: "codex", resume_flag: "resume", session_id_flag: null, cwd_flag: "-C",
    model_flag: "-m", effort_flag: null,
    resume: "native", stream_in: "unverified", stream_out: "ndjson", attach: "none",
    auth: "oauth",
    // Exemplary posture, carried over deliberately from the existing adapter (evidence B8).
    sandbox: ["--sandbox", "read-only", "--skip-git-repo-check"],
    bypass_env: "PANTHEON_CODEX_BYPASS",
    bypass_flag: "--dangerously-bypass-approvals-and-sandbox",
    output: ["--json"], subcommand: "exec",
  },
  grok: {
    cmd: "grok", resume_flag: "--resume", session_id_flag: "--session-id", cwd_flag: null,
    model_flag: null, effort_flag: "--effort",
    resume: "native", stream_in: "none", stream_out: "ndjson", attach: "none",
    auth: "oauth", sandbox: [], bypass_env: "PANTHEON_GROK_BYPASS",
    bypass_flag: "--always-approve",
    output: ["--output-format", "streaming-json"],
  },
  agy: {
    cmd: "agy", resume_flag: "--conversation", session_id_flag: null, cwd_flag: "--add-dir",
    model_flag: "--model", effort_flag: null,
    resume: "native", stream_in: "ndjson", stream_out: "ndjson", attach: "none",
    auth: "oauth",
    // --mode plan does NOT enforce read-only (evidence F1, demonstrated by probe). The only
    // containment is --add-dir, supplied via cwd_flag. Do not describe plan mode as a sandbox.
    sandbox: ["--mode", "plan"],
    bypass_env: "PANTHEON_AGY_BYPASS",
    bypass_flag: "--dangerously-skip-permissions",
    output: ["--output-format", "json"],
  },
};

export function bypassFragment(vendor, env = {}) {
  const v = VENDORS[vendor];
  if (!v) throw new Error(`bypassFragment: unknown vendor "${vendor}"`);
  return env[v.bypass_env] === "1" ? [v.bypass_flag] : [];
}

export function buildArgv({ vendor, cwd, model, effort, resumeToken, sessionId, env = {} }) {
  const v = VENDORS[vendor];
  if (!v) throw new Error(`buildArgv: unknown vendor "${vendor}"`);
  if (!cwd) throw new Error("buildArgv: cwd is required");
  if (sessionId && resumeToken) {
    throw new Error("buildArgv: both sessionId and resumeToken given; a turn is either fresh or a resume");
  }
  const args = [];
  if (v.subcommand) args.push(v.subcommand);
  if (resumeToken) {
    args.push(v.resume_flag, resumeToken);
  } else if (sessionId && v.session_id_flag) {
    args.push(v.session_id_flag, sessionId);
  }
  if (v.cwd_flag) args.push(v.cwd_flag, cwd);       // array element: never shell-split
  if (model && v.model_flag) args.push(v.model_flag, model);
  if (effort && v.effort_flag) args.push(v.effort_flag, effort);
  args.push(...v.sandbox, ...bypassFragment(vendor, env), ...v.output);
  return { cmd: v.cmd, args };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/colchis/Projects/pantheon && node --test tests/seat-argv.test.mjs`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
cd /home/colchis/Projects/pantheon
git add src/seat/argv.mjs tests/seat-argv.test.mjs
git commit -m "feat(seat): declared capability table and per-vendor argv, bypass off by default"
```

---

### Task 3: Transcript projection

**Files:**
- Create: `src/context/project.mjs`
- Test: `tests/context-project.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `projectTranscript(text, vendor) -> Turn[]` where `Turn = {role, sha, len, tools}`; `PROJECTORS`.

- [ ] **Step 1: Write the failing test**

```js
// tests/context-project.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { projectTranscript } from "../src/context/project.mjs";

const L1 = JSON.stringify({ type: "user", message: { content: [{ type: "text", text: "hello" }] } });
const L2 = JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "hi" }, { type: "tool_use", name: "Bash" }] } });
const L3 = JSON.stringify({ type: "system", message: { content: "ignored" } });
const claudeLines = [L1, L2, L3].join("\n");

test("projects only conversational turns, in order", () => {
  const t = projectTranscript(claudeLines, "claude");
  assert.equal(t.length, 2);
  assert.deepEqual(t.map(x => x.role), ["user", "assistant"]);
  assert.deepEqual(t[1].tools, ["Bash"]);
});

test("projection never carries content, only a hash and a length", () => {
  const t = projectTranscript(claudeLines, "claude");
  for (const turn of t) {
    assert.match(turn.sha, /^[0-9a-f]{64}$/);
    assert.equal(typeof turn.len, "number");
    assert.ok(!("text" in turn) && !("content" in turn),
      "a projection that carries text will end up in a log or an error message");
  }
});

// Review Focus 1: a live process leaves the last line half-written.
test("a truncated final line is dropped, and the prefix projects identically", () => {
  const whole = projectTranscript(claudeLines, "claude");
  const torn = projectTranscript(claudeLines + '\n{"type":"user","mess', "claude");
  assert.deepEqual(torn, whole, "a partial trailing line must not alter the projection");
});

test("a torn line in the MIDDLE is dropped without losing later turns", () => {
  const withHole = [L1, '{"type":"user","mess', L2].join("\n");
  const t = projectTranscript(withHole, "claude");
  assert.equal(t.length, 2, "unparseable lines are skipped, not fatal");
});

test("an empty or whitespace transcript yields an empty projection, not a throw", () => {
  assert.deepEqual(projectTranscript("", "claude"), []);
  assert.deepEqual(projectTranscript("\n \n", "claude"), []);
});

test("a turn with no text and no tools is not a turn", () => {
  const t = projectTranscript(JSON.stringify({ type: "assistant", message: { content: [] } }), "claude");
  assert.deepEqual(t, []);
});

test("codex rollout lines project from response_item", () => {
  const codex = [
    JSON.stringify({ type: "session_meta", payload: {} }),
    JSON.stringify({ type: "response_item", payload: { role: "assistant", content: [{ type: "text", text: "ok" }] } }),
  ].join("\n");
  const t = projectTranscript(codex, "codex");
  assert.equal(t.length, 1);
  assert.equal(t[0].role, "assistant");
});

test("an unknown vendor throws rather than projecting nothing and looking empty", () => {
  assert.throws(() => projectTranscript(claudeLines, "nope"), /no projector/);
});

test("tool names are sorted so ordering churn does not change the hash", () => {
  const a = projectTranscript(JSON.stringify({ type: "assistant", message: { content: [
    { type: "text", text: "x" }, { type: "tool_use", name: "B" }, { type: "tool_use", name: "A" }] } }), "claude");
  assert.deepEqual(a[0].tools, ["A", "B"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/colchis/Projects/pantheon && node --test tests/context-project.test.mjs`
Expected: FAIL — `Cannot find module '../src/context/project.mjs'`

- [ ] **Step 3: Write minimal implementation**

```js
// src/context/project.mjs
// Normalize a vendor transcript to (role, text-sha, tool-names). NOT raw bytes: these are
// vendor-internal files with no stability contract, so a cosmetic reformat must not invalidate
// every stored hash, while a content change still must (evidence P4b).
//
// Never return content. A projection that carries text ends up in a log line eventually.
import { createHash } from "node:crypto";

const sha256 = s => createHash("sha256").update(s).digest("hex");

function textAndTools(content) {
  const parts = Array.isArray(content) ? content : [content];
  const text = parts.map(c => (typeof c === "string" ? c : (c?.text ?? ""))).join("").trim();
  const tools = parts.filter(c => c?.type === "tool_use" && c.name).map(c => c.name).sort();
  return { text, tools };
}

export const PROJECTORS = {
  claude(obj) {
    if (obj.type !== "user" && obj.type !== "assistant") return null;
    const { text, tools } = textAndTools((obj.message ?? obj).content);
    return { role: obj.type, text, tools };
  },
  codex(obj) {
    if (obj.type !== "response_item") return null;
    const p = obj.payload ?? {};
    const { text, tools } = textAndTools(p.content);
    return { role: p.role ?? "assistant", text, tools };
  },
  grok(obj) {
    if (obj.type !== "text" && obj.role === undefined) return null;
    const { text, tools } = textAndTools(obj.content ?? obj.data ?? "");
    return { role: obj.role ?? "assistant", text, tools };
  },
  agy(obj) {
    if (!obj.role) return null;
    const { text, tools } = textAndTools(obj.content ?? obj.text ?? "");
    return { role: obj.role, text, tools };
  },
};

export function projectTranscript(text, vendor) {
  const project = PROJECTORS[vendor];
  if (!project) throw new Error(`projectTranscript: no projector for vendor "${vendor}"`);
  const turns = [];
  for (const line of String(text).split("\n")) {
    if (!line.trim()) continue;
    let obj;
    try { obj = JSON.parse(line); } catch { continue; } // torn line: skip, never fatal
    let p;
    try { p = project(obj); } catch { continue; }
    if (!p) continue;
    if (!p.text && p.tools.length === 0) continue;
    turns.push({ role: p.role, sha: sha256(p.text), len: p.text.length, tools: p.tools });
  }
  return turns;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/colchis/Projects/pantheon && node --test tests/context-project.test.mjs`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
cd /home/colchis/Projects/pantheon
git add src/context/project.mjs tests/context-project.test.mjs
git commit -m "feat(context): vendor transcript projection, torn-line tolerant, content-free"
```

---

### Task 4: Conversation hash chain and the extension check

**Files:**
- Create: `src/context/chain.mjs`
- Test: `tests/context-chain.test.mjs`

**Interfaces:**
- Consumes: `Turn[]` from Task 3.
- Produces: `chainOf(turns) -> string[]`, `record(turns) -> {head, length}`, `verifyExtends(liveTurns, recorded) -> {ok, why, grew}`.

- [ ] **Step 1: Write the failing test**

```js
// tests/context-chain.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { chainOf, record, verifyExtends } from "../src/context/chain.mjs";

const turn = (role, sha, tools = []) => ({ role, sha, len: sha.length, tools });
const A = [turn("user", "a1"), turn("assistant", "a2"), turn("user", "a3"), turn("assistant", "a4")];
const B = [turn("user", "b1"), turn("assistant", "b2"), turn("user", "b3"), turn("assistant", "b4")];

test("a chain has one link per turn and each link depends on its predecessor", () => {
  const c = chainOf(A);
  assert.equal(c.length, A.length);
  const c2 = chainOf([turn("user", "a1"), turn("assistant", "CHANGED"), turn("user", "a3"), turn("assistant", "a4")]);
  assert.equal(c[0], c2[0], "links before the change are unaffected");
  assert.notEqual(c[1], c2[1]);
  assert.notEqual(c[3], c2[3], "a change propagates to every later link");
});

test("an empty conversation records a length of zero and verifies against itself", () => {
  const r = record([]);
  assert.equal(r.length, 0);
  assert.equal(verifyExtends([], r).ok, true);
});

test("a genuine resume extends the recorded chain", () => {
  const r = record(A.slice(0, 2));
  const v = verifyExtends(A, r);
  assert.equal(v.ok, true);
  assert.equal(v.grew, 2);
});

// Review Focus 2: the thread was pruned and resume quietly produced a NEW conversation.
// This MUST be caught by the hash, not by length - so B is at least as long as the record.
test("a silently-fresh conversation fails on prefix hash mismatch, not on length", () => {
  const r = record(A.slice(0, 2));
  const v = verifyExtends(B, r);
  assert.equal(v.ok, false);
  assert.equal(v.why, "prefix hash mismatch",
    "if this says 'shorter than recorded' the hash comparison never ran and the check is vacuous");
});

test("a truncated thread fails as shorter than recorded", () => {
  const r = record(A);
  const v = verifyExtends(A.slice(0, 2), r);
  assert.equal(v.ok, false);
  assert.equal(v.why, "shorter than recorded");
});

test("a tampered middle turn fails on prefix hash mismatch", () => {
  const r = record(A);
  const tampered = A.map((t, i) => (i === 1 ? turn("assistant", "evil") : t));
  const v = verifyExtends(tampered, r);
  assert.equal(v.ok, false);
  assert.equal(v.why, "prefix hash mismatch");
});

test("a role swap with identical text is caught", () => {
  const r = record(A.slice(0, 2));
  const swapped = [turn("assistant", "a1"), turn("user", "a2"), ...A.slice(2)];
  assert.equal(verifyExtends(swapped, r).why, "prefix hash mismatch");
});

test("a changed tool list is caught", () => {
  const r = record([turn("assistant", "x", ["Read"])]);
  assert.equal(verifyExtends([turn("assistant", "x", ["Bash"])], r).why, "prefix hash mismatch");
});

test("a malformed record is refused rather than trusted", () => {
  assert.throws(() => verifyExtends(A, { head: "abc" }), /record\.length/);
  assert.throws(() => verifyExtends(A, { length: 2 }), /record\.head/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/colchis/Projects/pantheon && node --test tests/context-chain.test.mjs`
Expected: FAIL — `Cannot find module '../src/context/chain.mjs'`

- [ ] **Step 3: Write minimal implementation**

```js
// src/context/chain.mjs
// A conversation grows, so equality is the wrong relation and prefix/extension is the right one.
// Each link binds its turn to its predecessor, which gives prefix checking and tamper-evidence
// together (evidence P4c). Mirrors merkle-dag's effectiveHash shape (D2).
import { createHash } from "node:crypto";

const link = (prev, t) => createHash("sha256")
  .update(JSON.stringify({ prev, role: t.role, sha: t.sha, tools: t.tools ?? [] }))
  .digest("hex");

export function chainOf(turns) {
  const links = [];
  let prev = "genesis";
  for (const t of turns) { prev = link(prev, t); links.push(prev); }
  return links;
}

export function record(turns) {
  const c = chainOf(turns);
  return { head: c.at(-1) ?? "genesis", length: c.length };
}

// The check. Returns WHY it rejected, because an oracle that cannot say why cannot be shown to
// work - the lesson from the spike, which first passed for the wrong reason (evidence P7).
export function verifyExtends(liveTurns, recorded) {
  if (typeof recorded?.length !== "number") throw new Error("verifyExtends: record.length required");
  if (typeof recorded?.head !== "string") throw new Error("verifyExtends: record.head required");
  if (recorded.length === 0) return { ok: true, grew: liveTurns.length };
  if (liveTurns.length < recorded.length) return { ok: false, why: "shorter than recorded" };
  const live = chainOf(liveTurns);
  if (live[recorded.length - 1] !== recorded.head) return { ok: false, why: "prefix hash mismatch" };
  return { ok: true, grew: liveTurns.length - recorded.length };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/colchis/Projects/pantheon && node --test tests/context-chain.test.mjs`
Expected: PASS, 9 tests.

- [ ] **Step 5: Prove the suite is not vacuous**

Run:
```bash
cd /home/colchis/Projects/pantheon
node --input-type=module -e '
import { verifyExtends, record } from "./src/context/chain.mjs";
const t = (r, s) => ({ role: r, sha: s, len: 2, tools: [] });
const A = [t("user","a1"), t("assistant","a2"), t("user","a3")];
const B = [t("user","b1"), t("assistant","b2"), t("user","b3")];
const why = verifyExtends(B, record(A.slice(0,2))).why;
console.log("fresh-conversation rejection reason:", why);
process.exit(why === "prefix hash mismatch" ? 0 : 1);'
```
Expected: prints `prefix hash mismatch`, exit 0. If it prints `shorter than recorded`, the length shortcut fired and the hash comparison never ran — fix the fixture lengths, do not accept the green.

- [ ] **Step 6: Commit**

```bash
cd /home/colchis/Projects/pantheon
git add src/context/chain.mjs tests/context-chain.test.mjs
git commit -m "feat(context): per-turn hash chain with reason-bearing extension check"
```

---

### Task 5: Warm-seat turn execution and failure classification

**Files:**
- Create: `src/seat/turn.mjs`
- Test: `tests/seat-turn.test.mjs`

**Interfaces:**
- Consumes: `buildArgv` (Task 2).
- Produces: `runTurn({vendor, cwd, prompt, resumeToken?, sessionId?, env?, timeoutMs?, spawnFn?}) -> Promise<{ok, outcome, provenance}>`, `classify({exitCode, timedOut, sawOutput, stderr}) -> string`.

- [ ] **Step 1: Write the failing test**

```js
// tests/seat-turn.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { classify, runTurn } from "../src/seat/turn.mjs";

// Spec §12: quota and hang share the "no output" signal on a non-streaming seat, but they call
// for OPPOSITE actions - wait vs investigate. Conflating them is the live defect in the current
// stack (evidence B9): it reports every timeout as quota-exhausted.
test("a timeout with no output at all is a hang, not quota", () => {
  assert.equal(classify({ timedOut: true, sawOutput: false, stderr: "" }), "hung");
});

test("a timeout AFTER deltas arrived is still a hang, not quota", () => {
  assert.equal(classify({ timedOut: true, sawOutput: true, stderr: "" }), "hung");
});

test("quota is claimed only when the vendor actually says so", () => {
  assert.equal(classify({ exitCode: 1, stderr: "429 rate limit exceeded, retry later" }), "quota_exhausted");
  assert.equal(classify({ exitCode: 1, stderr: "usage limit reached for your plan" }), "quota_exhausted");
});

test("a timeout is NEVER classified as quota even if the word appears", () => {
  const c = classify({ timedOut: true, sawOutput: false, stderr: "checking quota..." });
  assert.equal(c, "hung", "a timeout means investigate; quota means wait");
});

test("a clean exit is ok", () => {
  assert.equal(classify({ exitCode: 0, sawOutput: true, stderr: "" }), "ok");
});

test("a nonzero exit with no recognized signature is an explicit failure", () => {
  assert.equal(classify({ exitCode: 3, stderr: "segfault" }), "failed");
});

function fakeSpawn({ exit = 0, stdout = "", stderr = "", hang = false } = {}) {
  return () => {
    const cp = new EventEmitter();
    cp.stdout = new EventEmitter(); cp.stderr = new EventEmitter();
    cp.kill = () => { cp.killed = true; };
    if (!hang) setImmediate(() => {
      if (stdout) cp.stdout.emit("data", Buffer.from(stdout));
      if (stderr) cp.stderr.emit("data", Buffer.from(stderr));
      cp.emit("close", exit);
    });
    return cp;
  };
}

test("a successful turn returns provenance with a stdout hash and no content", async () => {
  const r = await runTurn({ vendor: "claude", cwd: "/repo", prompt: "hi", sessionId: "s",
    spawnFn: fakeSpawn({ stdout: '{"session_id":"tok-1","result":"done"}' }) });
  assert.equal(r.ok, true);
  assert.equal(r.outcome, "ok");
  assert.match(r.provenance.stdout_sha256, /^[0-9a-f]{64}$/);
  assert.equal(r.provenance.vendor_session_id, "tok-1", "the id must be CAPTURED, not discarded");
  assert.ok(!("stdout" in r.provenance), "provenance must not carry conversation content");
});

test("a hanging child is killed at the timeout and reported hung", async () => {
  const r = await runTurn({ vendor: "claude", cwd: "/repo", prompt: "hi", sessionId: "s",
    timeoutMs: 30, spawnFn: fakeSpawn({ hang: true }) });
  assert.equal(r.ok, false);
  assert.equal(r.outcome, "hung");
  assert.equal(r.provenance.timed_out, true);
});

test("a quota reply is not ok and is labelled quota_exhausted", async () => {
  const r = await runTurn({ vendor: "grok", cwd: "/repo", prompt: "hi",
    spawnFn: fakeSpawn({ exit: 1, stderr: "429 rate limit exceeded" }) });
  assert.equal(r.outcome, "quota_exhausted");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/colchis/Projects/pantheon && node --test tests/seat-turn.test.mjs`
Expected: FAIL — `Cannot find module '../src/seat/turn.mjs'`

- [ ] **Step 3: Write minimal implementation**

```js
// src/seat/turn.mjs
// One turn = one short-lived spawn. A warm seat holds no process between turns, so nothing can
// wedge while idle and crash-safety is free.
import { spawn as nodeSpawn } from "node:child_process";
import { createHash } from "node:crypto";
import { buildArgv } from "./argv.mjs";

const QUOTA = /\b(429|rate[ _-]?limit|usage limit|quota exhausted|too many requests)\b/i;

// A timeout and a quota refusal call for OPPOSITE actions - investigate vs. wait - so a timeout
// is never reported as quota, however the stderr reads. The current stack gets this backwards
// and labels every timeout quota-exhausted (evidence B9, L4).
export function classify({ exitCode, timedOut, sawOutput, stderr = "" }) {
  if (timedOut) return "hung";
  if (QUOTA.test(stderr)) return "quota_exhausted";
  if (exitCode === 0) return "ok";
  return "failed";
}

export async function runTurn({
  vendor, cwd, prompt, resumeToken, sessionId, env = process.env,
  timeoutMs = 300000, spawnFn = nodeSpawn,
}) {
  const { cmd, args } = buildArgv({ vendor, cwd, resumeToken, sessionId, env });
  const started = Date.now();
  const child = spawnFn(cmd, [...args, prompt], { cwd, env, stdio: ["ignore", "pipe", "pipe"] });

  let out = "", err = "", sawOutput = false, timedOut = false;
  child.stdout.on("data", d => { sawOutput = true; out += d; });
  child.stderr.on("data", d => { err += d; });

  const exitCode = await new Promise(resolve => {
    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill("SIGTERM"); } catch {}
      resolve(null);
    }, timeoutMs);
    child.on("close", code => { clearTimeout(timer); resolve(code); });
    child.on("error", () => { clearTimeout(timer); resolve(null); });
  });

  const outcome = classify({ exitCode, timedOut, sawOutput, stderr: err });
  // Capture the vendor's own conversation id. The current stack parses it and throws it away,
  // keeping only .response (evidence B4) - which is why no seat here has ever been resumed.
  let vendor_session_id = null;
  try {
    const j = JSON.parse(out);
    vendor_session_id = j.session_id ?? j.conversation_id ?? j.sessionId ?? null;
  } catch { /* streaming or non-JSON: resolved by the store reader in Task 6 */ }

  return {
    ok: outcome === "ok",
    outcome,
    provenance: {
      vendor, command: [cmd, ...args].join(" "), duration_ms: Date.now() - started,
      exit_code: exitCode, timed_out: timedOut, saw_output: sawOutput,
      prompt_bytes: Buffer.byteLength(prompt ?? ""), stdout_bytes: Buffer.byteLength(out),
      stdout_sha256: createHash("sha256").update(out).digest("hex"),
      stderr_tail: err.slice(-2000), vendor_session_id,
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/colchis/Projects/pantheon && node --test tests/seat-turn.test.mjs`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
cd /home/colchis/Projects/pantheon
git add src/seat/turn.mjs tests/seat-turn.test.mjs
git commit -m "feat(seat): warm-seat turn with timeout-vs-quota distinction and id capture"
```

---

### Task 6: Capability conformance and resume verification CLI

**Files:**
- Create: `src/seat/conformance.mjs`
- Create: `src/context/locate.mjs`
- Create: `bin/pantheon.mjs`
- Create: `package.json`
- Test: `tests/seat-conformance.test.mjs`

**Interfaces:**
- Consumes: `VENDORS` (Task 2), `projectTranscript` (Task 3), `record`/`verifyExtends` (Task 4).
- Produces: `conformVendor(vendor, {helpFn}) -> {vendor, checked, mismatches}`, `locateStore({vendor, cwd, home}) -> {path|null, why}`, CLI verbs `conform`, `snapshot`, `verify-resume`.

- [ ] **Step 1: Write the failing test**

```js
// tests/seat-conformance.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { conformVendor } from "../src/seat/conformance.mjs";
import { locateStore } from "../src/context/locate.mjs";

const helpWith = flags => async () => flags.join("\n");

// Review Focus 5: a vendor upgrade drops a flag we declared. Conformance must FAIL, not warn.
test("a declared resume flag missing from --help is a mismatch", async () => {
  const r = await conformVendor("claude", { helpFn: helpWith(["--session-id", "--output-format"]) });
  assert.ok(r.mismatches.some(m => m.includes("--resume")),
    "a declared capability that is not observed is a failure, never a warning");
});

test("a vendor whose help carries every declared flag conforms", async () => {
  const r = await conformVendor("claude", {
    helpFn: helpWith(["--resume", "--session-id", "--model", "--effort", "--output-format"]),
  });
  assert.deepEqual(r.mismatches, []);
  assert.ok(r.checked > 0, "a conformance run that checked nothing is not a pass");
});

test("conformance that could not run the binary reports that, not success", async () => {
  const r = await conformVendor("claude", { helpFn: async () => { throw new Error("ENOENT"); } });
  assert.ok(r.mismatches.some(m => /could not run|ENOENT/i.test(m)));
  assert.equal(r.checked, 0);
});

test("an unknown vendor throws", async () => {
  await assert.rejects(() => conformVendor("nope", { helpFn: helpWith([]) }), /unknown vendor/);
});

test("locateStore never returns a path outside the vendor's own directory", () => {
  const r = locateStore({ vendor: "claude", cwd: "/repo/a", home: "/home/u" });
  if (r.path) assert.ok(r.path.startsWith("/home/u/.claude"), `escaped: ${r.path}`);
});

test("locateStore reports an explicit reason when a vendor store is unconfirmed", () => {
  for (const v of ["grok", "agy"]) {
    const r = locateStore({ vendor: v, cwd: "/repo/a", home: "/home/u" });
    assert.equal(r.path, null);
    assert.match(r.why, /unconfirmed/i,
      "an unverified store must say so; silence would read as 'no conversation'");
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/colchis/Projects/pantheon && node --test tests/seat-conformance.test.mjs`
Expected: FAIL — `Cannot find module '../src/seat/conformance.mjs'`

- [ ] **Step 3: Write minimal implementation**

```js
// src/seat/conformance.mjs
// A row in the capability table is a CLAIM until executed. routing-matrix.json self-flagged most
// of its rows unverified for 61 days and nothing noticed (evidence B10), so conformance runs the
// vendor's own --help and fails closed on any declared flag it cannot find.
import { execFile } from "node:child_process";
import { VENDORS } from "./argv.mjs";

const defaultHelp = cmd => new Promise((res, rej) =>
  execFile(cmd, ["--help"], { timeout: 30000 }, (e, so, se) =>
    (e && !so && !se ? rej(e) : res(`${so}\n${se}`))));

export async function conformVendor(vendor, { helpFn } = {}) {
  const v = VENDORS[vendor];
  if (!v) throw new Error(`conformVendor: unknown vendor "${vendor}"`);
  let help;
  try {
    help = await (helpFn ? helpFn(v.cmd) : defaultHelp(v.cmd));
  } catch (e) {
    return { vendor, checked: 0, mismatches: [`could not run "${v.cmd} --help": ${e.message}`] };
  }
  const declared = [v.resume_flag, v.session_id_flag, v.model_flag, v.effort_flag, v.cwd_flag]
    .filter(f => f && f.startsWith("--"));
  const mismatches = [];
  for (const flag of declared) {
    if (!help.includes(flag)) mismatches.push(`declares ${flag} but ${v.cmd} --help does not list it`);
  }
  return { vendor, checked: declared.length, mismatches };
}
```

```js
// src/context/locate.mjs
// Read-only location of a vendor's OWN transcript store. Never writes. Never returns a path
// outside that vendor's directory. grok and agy stores are UNCONFIRMED (evidence P1) and say so
// rather than returning null and reading as "no conversation".
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";

function newestJsonl(dir, why) {
  if (!existsSync(dir)) return { path: null, why: `no such directory: ${dir}` };
  const files = readdirSync(dir).filter(f => f.endsWith(".jsonl")).map(f => join(dir, f));
  if (files.length === 0) return { path: null, why: `${dir} has no .jsonl` };
  files.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return { path: files[0], why };
}

export function locateStore({ vendor, cwd, home = homedir() }) {
  const abs = resolve(cwd);
  if (vendor === "claude") {
    return newestJsonl(join(home, ".claude", "projects", abs.replace(/\//g, "-")),
      "newest jsonl in the claude project dir");
  }
  if (vendor === "codex") {
    return newestJsonl(join(home, ".codex", "sessions"),
      "newest rollout; NOT cwd-scoped, confirm via session_meta before trusting");
  }
  if (vendor === "grok" || vendor === "agy") {
    return { path: null, why: `${vendor} transcript store is unconfirmed (evidence P1); continuity claims stay weaker` };
  }
  return { path: null, why: `no store rule for vendor "${vendor}"` };
}
```

```js
// bin/pantheon.mjs
#!/usr/bin/env node
// Two things Plan 1 must prove: that the capability table is true, and that a resume resumed.
import { readFileSync } from "node:fs";
import { VENDORS } from "../src/seat/argv.mjs";
import { conformVendor } from "../src/seat/conformance.mjs";
import { locateStore } from "../src/context/locate.mjs";
import { projectTranscript } from "../src/context/project.mjs";
import { record, verifyExtends } from "../src/context/chain.mjs";

const [verb, ...rest] = process.argv.slice(2);
const USAGE = "usage: pantheon conform | snapshot <vendor> <cwd> | verify-resume <vendor> <cwd> <record.json>";

if (verb === "conform") {
  let bad = 0;
  for (const vendor of Object.keys(VENDORS)) {
    const r = await conformVendor(vendor);
    if (r.mismatches.length) {
      bad++;
      console.log(`FAIL ${vendor} (${r.checked} checked)`);
      for (const m of r.mismatches) console.log(`  ${m}`);
    } else {
      console.log(`OK   ${vendor} (${r.checked} checked)`);
    }
  }
  process.exit(bad ? 1 : 0);
} else if (verb === "snapshot") {
  const [vendor, cwd] = rest;
  if (!vendor || !cwd) { console.error(USAGE); process.exit(2); }
  const loc = locateStore({ vendor, cwd });
  if (!loc.path) { console.error(`cannot snapshot: ${loc.why}`); process.exit(3); }
  console.log(JSON.stringify(record(projectTranscript(readFileSync(loc.path, "utf8"), vendor))));
} else if (verb === "verify-resume") {
  const [vendor, cwd, recordJson] = rest;
  if (!vendor || !cwd || !recordJson) { console.error(USAGE); process.exit(2); }
  const loc = locateStore({ vendor, cwd });
  if (!loc.path) { console.error(`cannot verify: ${loc.why}`); process.exit(3); }
  const live = projectTranscript(readFileSync(loc.path, "utf8"), vendor);
  const rec = JSON.parse(readFileSync(recordJson, "utf8"));
  const v = verifyExtends(live, rec);
  console.log(`${v.ok ? "RESUMED" : "NOT RESUMED"}  turns=${live.length} recorded=${rec.length}` +
    (v.ok ? ` grew=${v.grew}` : ` reason="${v.why}"`));
  process.exit(v.ok ? 0 : 1);
} else {
  console.error(USAGE);
  process.exit(2);
}
```

```json
{
  "name": "pantheon",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "bin": { "pantheon": "./bin/pantheon.mjs" },
  "scripts": { "test": "node --test tests/" },
  "engines": { "node": ">=20" }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/colchis/Projects/pantheon && node --test tests/seat-conformance.test.mjs`
Expected: PASS, 6 tests.

- [ ] **Step 5: Run the whole suite from a foreign cwd**

Run: `cd /tmp && node --test /home/colchis/Projects/pantheon/tests/`
Expected: all suites PASS. Any failure that appears only here is a cwd dependency — fix it; do not move the suite back to the repo root to make it green (evidence H1).

- [ ] **Step 6: Prove conformance against the real binaries**

Run: `cd /home/colchis/Projects/pantheon && node bin/pantheon.mjs conform`
Expected: one line per vendor. A `FAIL` here is a **real finding about vendor drift**, not a bug in this task — record the flag and the vendor version in the evidence base before changing the table.

- [ ] **Step 7: Prove the end-to-end resume check on a real transcript, both ways**

Run:
```bash
cd /home/colchis/Projects/pantheon
node bin/pantheon.mjs snapshot claude /home/colchis/Projects > /tmp/rec-projects.json
cat /tmp/rec-projects.json
node bin/pantheon.mjs verify-resume claude /home/colchis/Projects /tmp/rec-projects.json
```
Expected: `RESUMED turns=N recorded=N grew=0`, exit 0.

Then make it say no — snapshot a **different** directory's transcript and verify the first against it:
```bash
node bin/pantheon.mjs snapshot claude /home/colchis/Projects/pantheon > /tmp/rec-other.json
node bin/pantheon.mjs verify-resume claude /home/colchis/Projects /tmp/rec-other.json; echo "exit=$?"
```
Expected: `NOT RESUMED ... reason="prefix hash mismatch"`, exit 1. **A verifier that has never returned NOT RESUMED is unproven.** If it returns `shorter than recorded` instead, pick a longer counter-example so the hash does the work.

- [ ] **Step 8: Commit**

```bash
cd /home/colchis/Projects/pantheon
git add package.json bin/pantheon.mjs src/seat/conformance.mjs src/context/locate.mjs tests/seat-conformance.test.mjs
git commit -m "feat(seat): capability conformance and resume verification CLI"
```

---

### Task 7: Seat store and the end-to-end turn

This is the task that makes Tasks 1 and 5 load-bearing. Without it `seatKey`, `mergeIdentity` and `runTurn` exist but nothing calls them, and the plan's goal — address a seat, take a turn, prove the resume — is not reachable from the CLI.

**Files:**
- Create: `src/seat/store.mjs`
- Modify: `bin/pantheon.mjs` (add the `turn` verb; keep `conform`, `snapshot`, `verify-resume`)
- Test: `tests/seat-store.test.mjs`

**Interfaces:**
- Consumes: `seatKey`, `mergeIdentity` (Task 1); `runTurn` (Task 5); `record`, `verifyExtends` (Task 4); `locateStore` (Task 6); `projectTranscript` (Task 3).
- Produces: `pantheonHome(env) -> string`, `loadSeat(seat, {home}) -> SeatRecord|null`, `saveSeat(seat, patch, {home}) -> SeatRecord`, CLI verb `turn`.
- `SeatRecord = {key, vendor, purpose, cwd, token: {value, source}|null, chain: {head, length}|null, updated_at}`

- [ ] **Step 1: Write the failing test**

```js
// tests/seat-store.test.mjs
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/colchis/Projects/pantheon && node --test tests/seat-store.test.mjs`
Expected: FAIL — `Cannot find module '../src/seat/store.mjs'`

- [ ] **Step 3: Write minimal implementation**

```js
// src/seat/store.mjs
// Seat records live ONLY under $PANTHEON_HOME. This module is the single writer in Plan 1, which
// is what makes the zero-uninvited-mutation claim (spec §9) checkable rather than aspirational.
import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { seatKey, mergeIdentity } from "./identity.mjs";

export function pantheonHome(env = process.env) {
  return env.PANTHEON_HOME || join(homedir(), ".pantheon");
}

const seatPath = (seat, home) => join(home, "seats", `${seatKey(seat)}.json`);

export function loadSeat(seat, { home = pantheonHome() } = {}) {
  const p = seatPath(seat, home);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch (e) {
    // Fail closed. A corrupt record read as "absent" would silently start a fresh conversation
    // and then report it as a resume - the exact failure this project exists to prevent (O4).
    throw new Error(`corrupt seat record at ${p}: ${e.message}`);
  }
}

export function saveSeat(seat, patch, { home = pantheonHome() } = {}) {
  const existing = loadSeat(seat, { home });
  const next = {
    key: seatKey(seat),
    vendor: seat.vendor, purpose: seat.purpose, cwd: seat.cwd,
    token: existing?.token ?? null,
    chain: existing?.chain ?? null,
    updated_at: new Date().toISOString(),
  };
  if (patch.token) {
    const m = mergeIdentity(existing?.token ?? undefined, patch.token);
    next.token = { value: m.value, source: m.source };
  }
  if (patch.chain) next.chain = patch.chain;
  const p = seatPath(seat, home);
  mkdirSync(join(home, "seats"), { recursive: true });
  const tmp = `${p}.tmp`;                 // atomic: a torn record is a corrupt record
  writeFileSync(tmp, JSON.stringify(next, null, 2));
  renameSync(tmp, p);
  return next;
}
```

Then add the `turn` verb to `bin/pantheon.mjs`, alongside the existing verbs:

```js
// add to the imports at the top of bin/pantheon.mjs
import { randomUUID } from "node:crypto";
import { runTurn } from "../src/seat/turn.mjs";
import { loadSeat, saveSeat, pantheonHome } from "../src/seat/store.mjs";
import { VENDORS } from "../src/seat/argv.mjs";

// add this branch before the final else
} else if (verb === "turn") {
  const [vendor, purpose, cwd, ...promptParts] = rest;
  const prompt = promptParts.join(" ");
  if (!vendor || !purpose || !cwd || !prompt) {
    console.error("usage: pantheon turn <vendor> <purpose> <cwd> <prompt...>");
    process.exit(2);
  }
  const seat = { vendor, purpose, cwd };
  const held = loadSeat(seat);

  // Verify BEFORE the turn: if we hold a chain, the live transcript must still extend it.
  // A seat whose conversation silently restarted must not be quietly continued.
  if (held?.chain && VENDORS[vendor]) {
    const loc = locateStore({ vendor, cwd });
    if (loc.path) {
      const live = projectTranscript(readFileSync(loc.path, "utf8"), vendor);
      const v = verifyExtends(live, held.chain);
      if (!v.ok) {
        console.error(`refusing to continue: stored chain not extended (${v.why}). ` +
          `The conversation this seat held is gone. Re-run with a fresh purpose, or accept a rebuild.`);
        process.exit(4);
      }
    }
  }

  const fresh = !held?.token;
  const r = await runTurn({
    vendor, cwd, prompt,
    resumeToken: held?.token?.value,
    sessionId: fresh && VENDORS[vendor].session_id_flag ? randomUUID() : undefined,
  });
  console.log(`${r.outcome}  ${r.provenance.duration_ms}ms  stdout=${r.provenance.stdout_bytes}B  sha=${r.provenance.stdout_sha256.slice(0,12)}`);

  // Capture the id the vendor reported; scrape rank, since it came from parsed output.
  const patch = {};
  if (r.provenance.vendor_session_id) {
    patch.token = { value: r.provenance.vendor_session_id, source: "scrape" };
  }
  // Re-snapshot the conversation so the next turn can verify against it.
  const loc2 = locateStore({ vendor, cwd });
  if (loc2.path) {
    patch.chain = record(projectTranscript(readFileSync(loc2.path, "utf8"), vendor));
  }
  if (Object.keys(patch).length) {
    const saved = saveSeat(seat, patch);
    console.log(`seat ${saved.key} token=${saved.token ? saved.token.source : "none"} chain=${saved.chain ? saved.chain.length : 0} turns  (${pantheonHome()})`);
  } else {
    console.log(`seat not updated: no vendor id and no locatable transcript (${loc2.why})`);
  }
  process.exit(r.ok ? 0 : 1);
```

Update the `USAGE` string in the same file to include the new verb:

```js
const USAGE = "usage: pantheon conform | turn <vendor> <purpose> <cwd> <prompt...> | " +
              "snapshot <vendor> <cwd> | verify-resume <vendor> <cwd> <record.json>";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/colchis/Projects/pantheon && node --test tests/seat-store.test.mjs`
Expected: PASS, 8 tests.

- [ ] **Step 5: Prove nothing was written outside PANTHEON_HOME**

Run:
```bash
cd /home/colchis/Projects/pantheon
H=$(mktemp -d); BEFORE=$(mktemp)
find "$HOME" -maxdepth 2 -newermt '-1 second' -printf '%p\n' 2>/dev/null | sort > "$BEFORE"
PANTHEON_HOME="$H" node --test tests/seat-store.test.mjs >/dev/null 2>&1
find "$HOME" -maxdepth 2 \( -name '.pantheon' -o -name '.claude' -o -name '.codex' -o -name '.grok' -o -name '.gemini' \) \
  -newermt '-30 seconds' -printf 'TOUCHED: %p\n'
echo "(no TOUCHED lines above = the store stayed inside its home)"
rm -rf "$H" "$BEFORE"
```
Expected: no `TOUCHED:` lines. This is the acceptance check for spec §9 in miniature; the full audit arrives with the install plan.

- [ ] **Step 6: Take a real turn end to end**

Run — in a throwaway directory so no project is touched:
```bash
cd /home/colchis/Projects/pantheon
W=$(mktemp -d); export PANTHEON_HOME=$(mktemp -d)
node bin/pantheon.mjs turn claude scratch "$W" "Reply with exactly the word ONE and nothing else."
node bin/pantheon.mjs turn claude scratch "$W" "Reply with exactly the word TWO and nothing else."
cat "$PANTHEON_HOME"/seats/*.json
```
Expected: the first turn creates a seat record with a token and a chain; the second turn **resumes** it and the chain length grows. If the second turn exits 4 with `stored chain not extended`, the resume did not restore — that is the check working, and the reason string says which way it failed.

- [ ] **Step 7: Commit**

```bash
cd /home/colchis/Projects/pantheon
git add src/seat/store.mjs bin/pantheon.mjs tests/seat-store.test.mjs
git commit -m "feat(seat): PANTHEON_HOME-scoped seat store and end-to-end turn with pre-turn chain check"
```

---

## Deferred to later plans

Named so their absence is deliberate rather than an oversight:

- **Plan 2 — supervisor and fencing.** The turn loop that claims on the seat's behalf against the existing Python board core, so no model ever holds a `claim_id` or `generation` (§3.1). Depends on Task 5.
- **Plan 3 — scheduling and settlement.** Write-disjoint admission plus per-vendor rate-limit headroom (§7), and signed settlement with the keyring anchored **outside** any plan Pantheon writes (§8, evidence D6).
- **Plan 4 — live view and eval.** The React surface over the event log (§11), and the paired blind team-vs-single-session harness denominated in rate-limit consumption and wall-clock, not per-token dollars (§10, L2).
- **Live seats (bidirectional NDJSON).** Plan 1 ships warm seats only. `claude` and `agy` accept `--input-format stream-json` (K3); that path needs Plan 2's supervisor to be useful.
- **The two additional seat slots.** A data change to `VENDORS` plus a conformance run, pending the user's subscription decision (§13.3).
- **ContextBundle addressing via merkle-dag.** Plan 1 hashes the *conversation*; bundling the material we hand a seat (§6, M3) arrives with Plan 2, where there is a supervisor to assemble bundles.
