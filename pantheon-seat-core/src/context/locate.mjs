// Read-only location of a vendor's OWN transcript store. Never writes, never returns a path
// outside that vendor's directory. Two vendors' stores are UNCONFIRMED (evidence P1) and say so
// explicitly rather than returning a bare null, because a null with no reason reads as "there is
// no conversation" when it actually means "I do not know where to look".
//
// Resolution is by SESSION ID, never by mtime and never by a directory name derived from cwd.
// The prior newest-by-mtime approach handed callers a DIFFERENT session's transcript whenever two
// sessions shared a cwd-derived directory (measured: 13 colliding chain groups inside a single
// directory on this machine, largest collision 7 files) — a working false-RESUMED. Deriving the
// directory name from cwd was also lossy: the vendor encodes both "/" and "." as "-", so any
// project path containing a dot (every ".claude/worktrees/*" path, 13 on this machine) mapped to
// a directory the old sanitizer never produced. Scanning every project directory for the session
// id itself sidesteps both defects at once, following the pattern already running in production
// at ~/.claude/hooks/session-eval.mjs (claude: match by filename) and
// ~/.claude/hooks/spend-record.mjs (recursive walk; identity from file contents).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { DatabaseSync } from "node:sqlite";

// claude names each transcript file after its own session id, so identity IS the filename here —
// this is not a proxy check, the vendor's own naming convention. Scan every per-project directory
// rather than deriving one from cwd, so a dot-encoded project path is reachable like any other.
function locateClaudeById(home, sessionId) {
  const root = join(home, ".claude", "projects");
  if (!existsSync(root)) return { path: null, why: `no such directory: ${root}` };
  let dirs;
  try {
    dirs = readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name);
  } catch (e) {
    return { path: null, why: `cannot read ${root}: ${e.message}` };
  }
  for (const d of dirs) {
    const candidate = join(root, d, `${sessionId}.jsonl`);
    if (existsSync(candidate)) return { path: candidate, why: "matched by session id (this vendor names the file after it)" };
  }
  return { path: null, why: `session ${sessionId} not found for claude` };
}

function walkJsonl(dir, out) {
  let ents;
  try {
    ents = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of ents) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walkJsonl(p, out);
    else if (e.name.endsWith(".jsonl")) out.push(p);
  }
}

// Read the session id out of the file's own session_meta line. Deriving identity from the
// filename here would be the same proxy check relocated: this vendor's rollout filenames embed a
// uuid that need not match payload.session_id, so only the contents are trustworthy.
function sessionMetaId(file) {
  let raw;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return null;
  }
  for (const line of raw.split("\n")) {
    if (!line.trim() || line.indexOf("session_meta") === -1) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    if (o?.type === "session_meta" && o?.payload?.session_id) return o.payload.session_id;
  }
  return null;
}

// codex stores are date-nested (<home>/.codex/sessions/YYYY/MM/DD/rollout-...jsonl); readdirSync
// is not recursive, so the old code found 0 of 208 real files and reported "has no .jsonl" — a
// message that reads like absence of data rather than a shape bug. Walk recursively instead.
function locateCodexById(home, sessionId) {
  const root = join(home, ".codex", "sessions");
  if (!existsSync(root)) return { path: null, why: `no such directory: ${root}` };
  const files = [];
  walkJsonl(root, files);
  if (files.length === 0) return { path: null, why: `${root} has no .jsonl (recursive scan)` };
  for (const f of files) {
    if (sessionMetaId(f) === sessionId) {
      return { path: f, why: "matched by session_meta.payload.session_id (file contents, not filename)" };
    }
  }
  return { path: null, why: `session ${sessionId} not found for codex` };
}

// grok keeps one DIRECTORY per session, named for the session id, inside a bucket named for the
// PERCENT-ENCODED cwd (measured: ~/.grok/sessions/%2Fhome%2F.../<uuid>/, 2365 files on this
// machine). Deriving that bucket name from cwd would repeat defect C3 in a new encoding, so this
// scans the buckets for the id instead and never reconstructs the encoding.
//
// The transcript is chat_history.jsonl, NOT events.jsonl. events.jsonl is a lifecycle log
// (phase_changed / tool_started / permission_requested ...) carrying no messages at all: 798 of
// 798 lines in the sampled file project to zero turns. Pointing the chain at it would produce an
// empty projection, which the store then refuses, so the seat would never acquire a baseline and
// every resume would be UNVERIFIED — a silent continuity hole that looks like a store bug.
function locateGrokById(home, sessionId) {
  const root = join(home, ".grok", "sessions");
  if (!existsSync(root)) return { path: null, why: `no such directory: ${root}` };
  let buckets;
  try {
    buckets = readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name);
  } catch (e) {
    return { path: null, why: `cannot read ${root}: ${e.message}` };
  }
  for (const b of buckets) {
    const dir = join(root, b, sessionId);
    const transcript = join(dir, "chat_history.jsonl");
    if (!existsSync(transcript)) continue;
    // Confirm from the session's OWN summary.json that this directory is the session it is named
    // after. The directory name alone is the same proxy the codex resolver refuses to trust.
    const declared = grokSummaryId(join(dir, "summary.json"));
    if (declared && declared !== sessionId) continue;
    return { path: transcript,
      why: declared ? "matched by session id and confirmed against summary.json info.id"
                    : "matched by session directory name (summary.json absent or unreadable)" };
  }
  return { path: null, why: `session ${sessionId} not found for grok` };
}

function grokSummaryId(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"))?.info?.id ?? null;
  } catch {
    return null;
  }
}

// agy stores one SQLite database per conversation, named for the conversation id that
// `agy --conversation <id>` takes (measured: ~/.gemini/antigravity-cli/conversations/<uuid>.db).
// The vendor does not document this location — antigravity.google/docs/cli/headless/ states the
// id is returned in the JSON output and says nothing about persistence — so it is recorded here
// as an OBSERVED path on this machine, not a documented contract, and may move without notice.
//
// Identity is confirmed from the database's own trajectory_meta.cascade_id rather than from the
// filename, holding agy to the same standard as codex.
function locateAgyById(home, sessionId) {
  const root = join(home, ".gemini", "antigravity-cli", "conversations");
  if (!existsSync(root)) return { path: null, why: `no such directory: ${root} (observed path, not vendor-documented)` };
  const candidate = join(root, `${sessionId}.db`);
  if (!existsSync(candidate)) return { path: null, why: `session ${sessionId} not found for agy` };
  const declared = agyCascadeId(candidate);
  if (declared && declared !== sessionId) {
    return { path: null, why: `${candidate} declares cascade_id ${declared}, not ${sessionId}` };
  }
  return { path: candidate, format: "sqlite",
    why: declared ? "matched by conversation id and confirmed against trajectory_meta.cascade_id"
                  : "matched by filename (cascade_id unreadable)" };
}

function agyCascadeId(file) {
  try {
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      return db.prepare("SELECT cascade_id FROM trajectory_meta LIMIT 1").get()?.cascade_id ?? null;
    } finally {
      db.close();
    }
  } catch {
    return null;   // locked, corrupt, or a schema we do not recognize: say so by returning null
  }
}

const RESOLVERS = {
  claude: locateClaudeById,
  codex: locateCodexById,
  grok: locateGrokById,
  agy: locateAgyById,
};

export function locateStore({ vendor, cwd, home = homedir(), sessionId }) {
  const id = sessionId ?? null;

  if (!RESOLVERS[vendor]) {
    return { path: null, sessionId: id, why: `no store rule for vendor "${vendor}"` };
  }
  if (!existsSync(home)) {
    return { path: null, sessionId: id, why: `no such home: ${home}` };
  }
  if (!id) {
    // A first-ever turn has no session id to resolve by. Returning the newest file by mtime here
    // is exactly the C1 defect: it hands back whichever session in a shared directory happened to
    // write last, not the one the caller is actually resuming. So this reports and stops.
    return { path: null, sessionId: null,
      why: "no session id supplied; this is a first-ever turn, nothing to resolve by identity" };
  }

  const result = RESOLVERS[vendor](home, id);
  return { format: "jsonl", ...result, sessionId: id };
}
