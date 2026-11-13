import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { locateStore } from "../src/context/locate.mjs";

function tmpHome() {
  return mkdtempSync(join(tmpdir(), "pantheon-locate-"));
}

test("C1: resolves by session id, not by mtime, when two transcripts share a project dir", () => {
  const home = tmpHome();
  const projDir = join(home, ".claude", "projects", "-repo-a");
  mkdirSync(projDir, { recursive: true });

  const rightId = "11111111-1111-1111-1111-111111111111";
  const wrongId = "22222222-2222-2222-2222-222222222222";
  const rightFile = join(projDir, `${rightId}.jsonl`);
  const wrongFile = join(projDir, `${wrongId}.jsonl`);

  // The wrong file is written FIRST, then given a LATER mtime, so a newest-by-mtime resolver
  // would hand back the wrong conversation. This is C1's regression test.
  writeFileSync(rightFile, JSON.stringify({ type: "user", message: { content: "mine" } }) + "\n");
  writeFileSync(wrongFile, JSON.stringify({ type: "user", message: { content: "someone else's" } }) + "\n");
  const now = Date.now() / 1000;
  utimesSync(rightFile, now - 1000, now - 1000);
  utimesSync(wrongFile, now, now); // newer

  const r = locateStore({ vendor: "claude", cwd: "/repo/a", home, sessionId: rightId });
  assert.equal(r.path, rightFile, "resolver must follow the session id, not the newer mtime");
  assert.equal(r.sessionId, rightId);
});

test("no sessionId supplied returns path:null with a reason, even though a file exists (mtime fallback is gone)", () => {
  const home = tmpHome();
  const projDir = join(home, ".claude", "projects", "-repo-a");
  mkdirSync(projDir, { recursive: true });
  writeFileSync(join(projDir, "33333333-3333-3333-3333-333333333333.jsonl"), "{}\n");

  const r = locateStore({ vendor: "claude", cwd: "/repo/a", home });
  assert.equal(r.path, null);
  assert.match(r.why, /no session id supplied/i);
  assert.equal(r.sessionId, null);
});

test("C2: date-nested codex store resolves by id via recursive walk and session_meta contents", () => {
  const home = tmpHome();
  const day = join(home, ".codex", "sessions", "2026", "09", "19");
  mkdirSync(day, { recursive: true });

  const targetId = "01a0cfc9-a12d-7801-804a-8c2340c995cf";
  const otherId = "01a0cfc9-a12d-7801-804a-000000000000";
  const targetFile = join(day, `rollout-2026-09-19T10-00-00-${targetId}.jsonl`);
  writeFileSync(targetFile,
    JSON.stringify({ type: "session_meta", payload: { session_id: targetId } }) + "\n" +
    JSON.stringify({ type: "response_item", payload: { role: "user", content: [] } }) + "\n");

  const r = locateStore({ vendor: "codex", cwd: "/repo/a", home, sessionId: targetId });
  assert.equal(r.path, targetFile);
  assert.equal(r.sessionId, targetId);

  // A file whose NAME contains the target id but whose session_meta names a DIFFERENT id must
  // not be matched — identity comes from contents, never from the filename.
  const decoyId = "44444444-4444-4444-4444-444444444444";
  const decoyFile = join(day, `rollout-2026-09-19T11-00-00-${targetId}-decoy.jsonl`);
  writeFileSync(decoyFile, JSON.stringify({ type: "session_meta", payload: { session_id: decoyId } }) + "\n");

  const r2 = locateStore({ vendor: "codex", cwd: "/repo/a", home, sessionId: decoyId });
  assert.equal(r2.path, decoyFile, "the decoy's own true id must still resolve, to its own file");

  const r3 = locateStore({ vendor: "codex", cwd: "/repo/a", home, sessionId: targetId });
  assert.equal(r3.path, targetFile, "a name collision with a different session_meta id must not steal the match");
});

test("C3: a cwd-derived directory name containing an encoded dot still resolves", () => {
  const home = tmpHome();
  // The vendor encodes both "/" and "." as "-": /home/x/.claude/worktrees/foo -> "-home-x--claude-worktrees-foo".
  const encoded = "-repo--claude-worktrees-foo";
  const projDir = join(home, ".claude", "projects", encoded);
  mkdirSync(projDir, { recursive: true });

  const id = "55555555-5555-5555-5555-555555555555";
  const file = join(projDir, `${id}.jsonl`);
  writeFileSync(file, "{}\n");

  const r = locateStore({ vendor: "claude", cwd: "/repo/.claude/worktrees/foo", home, sessionId: id });
  assert.equal(r.path, file, "the dot-encoded directory must be reachable, not skipped");
});

test("an unknown vendor returns a reason naming the vendor", () => {
  const home = tmpHome();
  const r = locateStore({ vendor: "nope", cwd: "/repo/a", home, sessionId: "x" });
  assert.equal(r.path, null);
  assert.match(r.why, /nope/);
});

test("a missing home returns a reason and never throws", () => {
  assert.doesNotThrow(() => {
    const r = locateStore({ vendor: "claude", cwd: "/repo/a", home: "/nonexistent-home-xyz", sessionId: "x" });
    assert.equal(r.path, null);
    assert.ok(typeof r.why === "string" && r.why.length > 0);
  });
});

test("an unreadable/absent vendor directory returns a reason and never throws (claude)", () => {
  const home = tmpHome(); // exists, but .claude/projects does not
  assert.doesNotThrow(() => {
    const r = locateStore({ vendor: "claude", cwd: "/repo/a", home, sessionId: "x" });
    assert.equal(r.path, null);
    assert.match(r.why, /no such directory/);
  });
});

test("an unreadable/absent vendor directory returns a reason and never throws (codex)", () => {
  const home = tmpHome(); // exists, but .codex/sessions does not
  assert.doesNotThrow(() => {
    const r = locateStore({ vendor: "codex", cwd: "/repo/a", home, sessionId: "x" });
    assert.equal(r.path, null);
    assert.match(r.why, /no such directory/);
  });
});

test("session id supplied but no matching file exists reports 'not found', never throws", () => {
  const home = tmpHome();
  mkdirSync(join(home, ".claude", "projects", "-repo-a"), { recursive: true });
  const r = locateStore({ vendor: "claude", cwd: "/repo/a", home, sessionId: "does-not-exist" });
  assert.equal(r.path, null);
  assert.match(r.why, /not found/);
  assert.equal(r.sessionId, "does-not-exist");
});

// grok: one directory per session inside a PERCENT-ENCODED cwd bucket. The bucket name is
// deliberately not derived from cwd -- doing so is defect C3 in a different encoding -- so this
// fixture uses a bucket name the resolver could never reconstruct, and resolution must still
// succeed purely by scanning for the id.
test("grok resolves by session id through an unreconstructable cwd bucket", () => {
  const home = tmpHome();
  const id = "01a0c9df-36ea-7ad3-b6c4-2579699459e3";
  const bucket = join(home, ".grok", "sessions", "%2Fsome%2Fpath%2Fthe.resolver%2Fcannot%2Fguess");
  const dir = join(bucket, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "chat_history.jsonl"), '{"type":"user","content":"hi"}\n');
  writeFileSync(join(dir, "summary.json"), JSON.stringify({ info: { id, cwd: "/anything" } }));
  const r = locateStore({ vendor: "grok", cwd: "/unrelated", home, sessionId: id });
  assert.equal(r.path, join(dir, "chat_history.jsonl"));
  assert.match(r.why, /summary\.json/, "the confirmation source must be named");
});

// events.jsonl is a lifecycle log with no messages in it. Pointing the chain at it yields an
// empty projection, the store then refuses the empty chain, and the seat silently never gets a
// baseline. The resolver must select chat_history.jsonl even when both files exist.
test("grok selects chat_history.jsonl, never the message-free events.jsonl", () => {
  const home = tmpHome();
  const id = "11111111-2222-3333-4444-555555555555";
  const dir = join(home, ".grok", "sessions", "%2Fx", id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "events.jsonl"), '{"type":"phase_changed","phase":"thinking"}\n');
  writeFileSync(join(dir, "chat_history.jsonl"), '{"type":"user","content":"hi"}\n');
  const r = locateStore({ vendor: "grok", cwd: "/x", home, sessionId: id });
  assert.ok(r.path.endsWith("chat_history.jsonl"), `selected the wrong file: ${r.path}`);
});

// A directory named for one session that declares a different id in its own summary.json is not
// that session. Trusting the name is the proxy check the codex resolver already refuses.
test("grok refuses a session directory whose summary.json declares a different id", () => {
  const home = tmpHome();
  const id = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  const dir = join(home, ".grok", "sessions", "%2Fx", id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "chat_history.jsonl"), '{"type":"user","content":"hi"}\n');
  writeFileSync(join(dir, "summary.json"), JSON.stringify({ info: { id: "a-totally-different-id" } }));
  const r = locateStore({ vendor: "grok", cwd: "/x", home, sessionId: id });
  assert.equal(r.path, null, "a mismatched declared id must not resolve");
});

test("agy reports its store as observed-not-documented when absent", () => {
  const r = locateStore({ vendor: "agy", cwd: "/x", home: tmpHome(), sessionId: "nope" });
  assert.equal(r.path, null);
  assert.match(r.why, /antigravity-cli|not found/i);
});

test("never returns a path outside the vendor's own directory", () => {
  const home = tmpHome();
  const projDir = join(home, ".claude", "projects", "-repo-a");
  mkdirSync(projDir, { recursive: true });
  const id = "66666666-6666-6666-6666-666666666666";
  const file = join(projDir, `${id}.jsonl`);
  writeFileSync(file, "{}\n");
  const r = locateStore({ vendor: "claude", cwd: "/repo/a", home, sessionId: id });
  assert.ok(r.path.startsWith(join(home, ".claude")), `escaped: ${r.path}`);
});
