// Run Pantheon's own real pipeline on a ticket spec -- intake, promote, plan, work, check, ship --
// as an importable, non-exiting function. Extracted from scripts/open-items-run.mjs (now a thin
// CLI wrapper around this) so the CLI and a new HTTP build API (src/view/build-server.mjs) run the
// EXACT SAME logic instead of two copies drifting apart.
//
// Every vendor SDK is injected at the edge: this module imports no vendor package, matching
// src/view/server.mjs's own convention. `makeClientFor(vendor)` is required.
//
// NEVER calls process.exit(). A caller reachable from an HTTP request handler that called
// process.exit() would kill the whole server process on one failed build, not just that request --
// every exit path in the original script becomes either a thrown Error (a caller-error: a bad
// ticket or missing makeClientFor, checked before any work starts) or a value in the returned
// result object (a run-error: something failed after work started).
import { mkdirSync, writeFileSync, readFileSync, cpSync, existsSync, appendFileSync, statSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { sdkTurn } from "../sdk/seat-sdk.mjs";
import { openBoard } from "./index.mjs";
import { publish, treeSlots } from "./dag.mjs";
import { merge } from "./merge.mjs";
import { ship } from "./integrate.mjs";
import { boardState, boardStatus, schedule, testsBrief, acceptanceStatus } from "./controller.mjs";
import { project, PROJECTION_FOR_ROLE } from "./project.mjs";
import { seatingPlan, seatingReport, assertReviewCutsAcross, assertFanOutIsOutside, INTAKE,
  candidatesFor, shouldFallThrough, cooldownPoolFor } from "../role/seating.mjs";
import { shutPools, recordRefusal, recordSuccess } from "../route/cooldown.mjs";
import { promptFor } from "../role/roles.mjs";
import { shortCid, cidOf } from "./canon.mjs";
import { runAcceptance as isolatedAcceptance, ACCEPTANCE_ISOLATION } from "./acceptance.mjs";
import { artifactPath, readArtifact, writeArtifact } from "./artifact-files.mjs";
import { certifiedArtifacts } from "./artifacts.mjs";
import { resolveRepoRoot } from "../../scripts/lib/repo-root.mjs";
import { modelId } from "../config/models.mjs";
import { tokenCapFor } from "../agents/store.mjs";
import { ticketContainmentRefusal, normalizeSlots, isUnder } from "./ticket-safety.mjs";
import { spawnPromise } from "./spawn.mjs";
import { runAgyCliTurn } from "./agy-cli.mjs";

// This repo's own root (for Antigravity role-card discovery and PANTHEON_HEAD provenance) -- NOT the ticket's
// target repo. src/board/run-item.mjs -> src/board -> src -> repo root, so two levels up.
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

const CRITIQUE_SCHEMA = { type: "object", properties: {
  verdict: { type: "string", enum: ["approve", "request_changes"] },
  narrative: { type: "string", description: "what you ran and read, with commands, exit codes and path:line quotes" },
  findings: { type: "array", items: { type: "object", properties: { severity: { type: "string", enum: ["block", "should", "nit"] }, note: { type: "string" } }, required: ["severity", "note"] } },
}, required: ["verdict", "findings"] };

// NO TOOLS, SAID PLAINLY. The role charters ("report what you ran") were written for seats that can
// run things. An SDK seat cannot, and two xai models answered by narrating tool calls instead of
// answering (an 82k-char scout loop; a reviewer that ended with "let me read the implementation"
// and no verdict).
const NO_TOOLS = "You have NO tools in this seat: nothing you write executes and you cannot read files. " +
  "Everything you may rely on is in this message. Do not announce, narrate or simulate commands. ";

const strip = t => t.replace(/^\s*```[a-z]*\s*\n?/i, "").replace(/\n?```\s*$/, "").trim();
const isTimeout = e => e?.name === "APIConnectionTimeoutError" || /timed out|UND_ERR_HEADERS_TIMEOUT|ETIMEDOUT/i.test(String(e?.message ?? e));

/** An output cap in the vendor's own request shape; `extra` is { tokens } or undefined. */
const capFor = (vendor, extra) => extra?.tokens == null ? undefined
  : vendor === "agy_google" ? { config: { maxOutputTokens: extra.tokens } }
  : vendor === "anthropic" ? { max_tokens: extra.tokens }
  : { max_output_tokens: extra.tokens };

/**
 * Run one ticket through Pantheon's real pipeline. Returns a result object; never calls
 * process.exit(); never prints to the console (that is the CLI wrapper's job -- pass `progress` to
 * receive the same structured events the wrapper prints from).
 *
 * @param {object} spec - a ticket, same shape as scripts/tickets/*.json.
 * @param {object} opts
 * @param {string|null} [opts.dir] - board root to use (defaults to a fresh timestamped dir under ~/.pantheon/boards).
 * @param {string|null} [opts.resume] - a board root to resume from (skips intake/plan/work, reads their results from the board's refs).
 * @param {number} [opts.revisions=3] - max implementer revisions before the work stage stops and hands whatever it has to review.
 * @param {object} [opts.seatOverrides={}] - `{ [role]: { vendor, model, rank: 0, pool: vendor, band: null, basis: "OPERATOR", why } }`, a pre-built override map (the CLI wrapper builds this from `--seat role=vendor/model` flags; an HTTP caller builds it directly).
 * @param {(vendor: string) => object} opts.makeClientFor - required. Returns an SDK client for a vendor; this module never imports a vendor SDK itself.
 * @param {string[]} [opts.scouts] - the vendors that scout at intake (default xai only -- agy_google
 *   was dropped from the default 2026-09-29, see the SCOUT_VENDORS comment below). The only legal
 *   fan-out in the pipeline: depth 0, before commitment, across independent pools.
 * @param {(ev: object) => void} [opts.progress] - called with the same structured events written to progress.jsonl. Optional; omitted, events are simply not emitted anywhere but disk.
 * @returns {Promise<{ok: boolean, shipped: boolean, key: string, board: string, outDir: string, error: {stage: string, message: string}|null, salvaged: string|null}>}
 */
export async function runOpenItem(spec, opts = {}) {
  const { dir = null, resume = null, revisions = 3, seatOverrides = {}, makeClientFor, progress: emit = () => {},
          // agy_google commented out 2026-09-29 (operator: "Comment out agy_google"); same reason as the INTAKE
          // entry in src/role/seating.mjs -- a scout failure kills the ticket at intake. Restore
          // ["agy_google", "xai"] once the operator confirms the Gemini account is stable.
          scouts: SCOUT_VENDORS = ["xai"] /* ["agy_google", "xai"] */ } = opts;
  if (typeof makeClientFor !== "function") {
    throw new Error("runOpenItem: pass makeClientFor(vendor) -- this module never imports a vendor SDK");
  }
  for (const k of ["key", "title", "goal", "copy", "acceptance_cmd", "question"]) {
    if (spec[k] === undefined) throw new Error(`ticket spec is missing "${k}"`);
  }
  // A ticket names its file either singularly (`slot`, as every ticket written before this did) or
  // as a `slots` array, one entry per implementer. normalizeSlots below is what decides which.
  if (spec.slot === undefined && !Array.isArray(spec.slots)) throw new Error('ticket spec is missing "slot"');
  // Every path-shaped field is untrusted input here, not just at the HTTP door: this function is
  // an importable surface with three callers (the CLI, the build API, anything else that imports
  // it), and a ticket may have been drafted by a model rather than written by the operator. See
  // ticket-safety.mjs for the escapes this closes -- all of them were demonstrated by execution.
  const unsafe = ticketContainmentRefusal(spec);
  if (unsafe) throw new Error(`refusing this ticket: ${unsafe}`);
  // The files this ticket asks for, one per implementer. A singular slot/path ticket yields one
  // entry and behaves exactly as it always did; several entries mean several implementers, each
  // owning a DIFFERENT file, so none of them is grading or competing with another.
  const SLOTS = normalizeSlots(spec);
  const destinations = SLOTS.map(sl => resolve(sl.path));
  if (new Set(destinations).size !== destinations.length) throw new Error("duplicate artifact destination aliases");

  const REPO_ROOT = resolveRepoRoot(REPO, spec.repo_root);
  const OVERRIDES = seatOverrides;
  // WAS a synchronous refusal here for planner/implementer + agy_google unless
  // PANTHEON_AGY_TRANSPORT=cli was already set (scripts/agy-seat.py's --role choices are literally
  // ["reviewer", "scout", "fact-checker"] -- no "planner", no "implementer" -- so the SDK lane
  // genuinely cannot serve either role). REMOVED 2026-09-29, same day it was added: agyTurn below
  // now forces transport="cli" unconditionally for these two roles specifically, so the failure
  // mode this guard caught can no longer happen at all, on any input -- the fix moved from "refuse
  // the bad combination early" to "the bad combination is no longer constructible." A guard that
  // can never fire is not caution, it is a landmine for a future SEATING change that adds a role
  // this reasoning does not cover; removing it here rather than leaving it dark is the honest move.
  const RESUME = resume;
  const root = RESUME ?? dir ?? join(homedir(), ".pantheon", "boards", `open-${spec.key}-${Date.now()}`);
  const worktree = join(root, "worktree");
  mkdirSync(worktree, { recursive: true });
  const home = join(root, "seats");                 // isolated: never the operator's real seat store
  const outDir = join(REPO_ROOT, "outputs", "open-items", spec.key);
  mkdirSync(outDir, { recursive: true });

  if (!RESUME) for (const rel of spec.copy) cpSync(join(REPO_ROOT, rel), artifactPath(worktree, rel), {
    recursive: true, dereference: true,
    filter: (src, dest) => {
      if (!isUnder(REPO_ROOT, src)) throw new Error("copy contains a symlink outside the target repository");
      artifactPath(worktree, relative(worktree, dest));
      return true;
    },
  });

  const board = openBoard(root);
  const HUMAN = { vendor: "human" };
  const CONTROLLER = { vendor: "controller" };
  const REF = `refs/board/${spec.key}`;
  // The legacy singular names, derived from the normalized plan rather than the raw ticket, so a
  // `slots`-only ticket still has them. They mean "the first slot" and are what the resume branch
  // and the crash-salvage path use; multi-slot code paths use SLOTS/BUILT instead.
  const SLOT = SLOTS[0].slot;
  const PATH = SLOTS[0].path;
  const ITEM = spec.key;
  const FILE = join(worktree, PATH);
  const CMD = spec.acceptance_cmd;
  const CARRY = ["plan", "item:", "critique:"];    // a carry never ships code

  // Printing is a CLI concern; this function is silent on the console by design. `check`'s
  // failures-count IS real run state (it gates the final `ok`), so that stays -- only the console
  // line becomes a structured `check` event instead.
  let failures = 0;
  const bar = () => {};
  const say = () => {};
  const check = (ok, line) => { if (!ok) failures++; progress({ event: "check", ok, detail: line }); };
  const clients = {};
  const clientFor = v => (clients[v] ??= makeClientFor(v));
  const ticketCid = cidOf("entry", JSON.parse(JSON.stringify({ ...spec, repo_root: REPO_ROOT, slots: SLOTS })));
  const statePath = join(root, "run.json");
  let recordAllowed = false;
  const run = { format: 2, isolation: ACCEPTANCE_ISOLATION, ticket_cid: ticketCid, repo_root: REPO_ROOT,
    key: spec.key, started_at: new Date().toISOString(), board: root, reseats: OVERRIDES,
    turns: [], gates: null, shipped: false, artifacts: [], files: [] };
  const record = () => {
    if (!recordAllowed) return;
    const text = JSON.stringify(run, null, 2);
    // The board owns recovery. The output copy is only a convenience index shared by a ticket key.
    writeArtifact(root, "run.json", text);
    writeArtifact(REPO_ROOT, relative(REPO_ROOT, join(outDir, "run.json")), text);
  };
  function exportShipped() {
    run.artifacts = run.files.map(c => ({ slot: c.slot, path: c.path, cid: c.artifactCid, bytes: c.bytes,
      copied_to: artifactPath(REPO_ROOT, relative(REPO_ROOT, join(outDir, "artifact", c.path))) }));
    for (const art of certifiedArtifacts(run, { repoRoot: REPO_ROOT, outDir })) {
      writeArtifact(REPO_ROOT, relative(REPO_ROOT, art.copied_to), art.contents);
    }
    run.artifact = run.artifacts[0]; // compatibility for single-file consumers; the manifest is authoritative.
  }

  // PROGRESS IS A STREAM, NOT A REPORT. Every stage, every seat call, every executed result is
  // appended to progress.jsonl AND handed to the caller's `emit` (an HTTP caller publishes it on a
  // live bus; the CLI wrapper prints from it; neither is required -- an omitted `emit` just means
  // the disk trail is the only record).
  const T0 = Date.now();
  let stage = "start";
  function progress(ev) {
    const row = { at: new Date().toISOString(), elapsed_s: Math.round((Date.now() - T0) / 10) / 100, stage, ...ev };
    const line = JSON.stringify(row) + "\n";
    for (const f of [join(outDir, "progress.jsonl"), join(root, "progress.jsonl")]) { try { appendFileSync(f, line); } catch { /* emit below still carries it */ } }
    try { emit(row); } catch { /* one broken subscriber must not break the run */ }
  }
  const enter = (name, detail = "") => { stage = name; progress({ event: "stage.start", detail }); };

  // THE ANTIGRAVITY SEAT. The CLI's --agent lane consumes cached OAuth and emits NDJSON events.
  // Keep the SDK as default until a live OAuth turn produces an observed answer: the CLI can exit
  // zero with SUCCESS, zero turns and empty response on print timeout. Renaming an OAuth token
  // GEMINI_API_KEY cannot authenticate the SDK. PANTHEON_AGY_TRANSPORT=cli opts into the new lane.
  let agyN = 0;
  async function agyTurn({ purpose, model, prompt, timeoutS = Number(process.env.PANTHEON_AGY_TIMEOUT ?? 900) }) {
    const role = purpose === "critique" ? "reviewer" : purpose === "scout" ? "scout" : purpose === "plan" ? "planner"
      : purpose === "work" ? "implementer" : null;
    if (!role) throw new Error(`agy seat: no Antigravity agent is defined for purpose "${purpose}"`);
    // planner/implementer are CLI-ONLY, not merely CLI-preferred: agy-seat.py's own --role choices
    // are ["reviewer", "scout", "fact-checker"] -- there is no SDK-lane code path for either role,
    // ever, on any input. Discovered 2026-09-29 the hard way: SEATING.planner/implementer's new
    // agy_google top rungs are the DEFAULT table now, not an operator override, so the synchronous
    // OVERRIDES-only guards above never fire for them -- a real ticket with no special setup would
    // otherwise silently default to the SDK lane and die on a missing --role or a missing
    // GEMINI_API_KEY, exactly backwards from what today's seating change was for. Forcing CLI here,
    // unconditionally, for these two roles specifically, is the actual fix; PANTHEON_AGY_TRANSPORT
    // still governs scout/reviewer, which genuinely support both lanes.
    const transport = (role === "planner" || role === "implementer") ? "cli" : (process.env.PANTHEON_AGY_TRANSPORT ?? "sdk");
    const dir = join(outDir, "agy_google", `${purpose}-${++agyN}`); mkdirSync(dir, { recursive: true });
    // The implementer keeps its real NO_TOOLS prompt untouched: it is genuinely tool-less on every
    // transport (run-item.mjs applies its text reply to disk itself -- see the WORK stage above),
    // so appending a "you have tools" line here, true for the other three roles, would be a false
    // claim and would break the one property every vendor's implementer shares: reply is text, not
    // a tool call. pantheon-implementer/agent.md's own tools: [] enforces the same thing card-side.
    const brief = role === "implementer" ? prompt : prompt.split(NO_TOOLS).join("") +
      (role === "planner"
        ? `\n\nYou have tools in this seat. The workspace ${worktree} is the ticket's project tree, read-only at this stage -- no artifact exists yet. Answer exactly in the format your brief above asked for.`
        : role === "scout"
          ? `\n\nYou have read tools in this seat. The workspace ${worktree} is the ticket's project tree before implementation. Inspect the files you cite; no artifact exists yet.`
          : `\n\nYou have tools in this seat. The workspace ${worktree} is the tree under review, with the artifact already written into it. ` +
            "Run the acceptance command yourself and quote what it printed; open the files you cite. Hand the fact-checker subagent one direct check at a time.");
    writeFileSync(join(dir, "brief.txt"), brief);
    let schemaPath = null;
    if (role === "reviewer") {
      schemaPath = join(dir, "schema.json");
      writeFileSync(schemaPath, JSON.stringify(CRITIQUE_SCHEMA));
    }
    let res;
    if (transport === "cli") {
      const cli = process.env.PANTHEON_AGY_CLI ?? join(homedir(), ".local", "bin", "agy");
      if (cli.includes("/") && !existsSync(cli)) throw new Error(`agy seat: CLI absent at ${cli} (set PANTHEON_AGY_CLI)`);
      res = await runAgyCliTurn({ cli, repo: REPO, worktree, role, model, prompt: brief,
        timeoutS, schemaPath, onEvent: ev => progress({ seat: "agy_google", model, ...ev }) });
    } else if (transport === "sdk") {
      const python = process.env.PANTHEON_AGY_PYTHON ?? join(homedir(), "Projects", "agentic-pipeline", "sdk", ".venv-antigravity", "bin", "python");
      if (!existsSync(python)) throw new Error(`agy seat: venv python absent at ${python} (set PANTHEON_AGY_PYTHON)`);
      if (!process.env.GEMINI_API_KEY && !process.env.PANTHEON_AGY_VERTEX_PROJECT) throw new Error("agy seat: GEMINI_API_KEY is not in the environment (or set PANTHEON_AGY_VERTEX_PROJECT for Vertex ADC)");
      const args = [join(REPO, "scripts", "agy-seat.py"), "--role", role, "--workspace", worktree, "--repo", REPO,
        "--model", model, "--brief", join(dir, "brief.txt"), "--out", dir,
        "--progress", join(outDir, "progress.jsonl"),
        "--stage", purpose === "critique" ? "check" : purpose === "plan" ? "plan" : "intake",
        "--timeout", String(timeoutS)];
      if (schemaPath) args.push("--schema", schemaPath);
      const run = await spawnPromise(python, args, { env: process.env, timeout: (timeoutS + 60) * 1000 });
      const last = (run.stdout ?? "").trim().split("\n").filter(Boolean).pop();
      let out = null;
      try { out = last ? JSON.parse(last) : null; } catch { /* malformed vendor envelope */ }
      if (run.status !== 0 || !out?.ok) {
        const tail = (run.stderr ?? "").split("\n").filter(l => l && !l.startsWith("{")).slice(-3).join(" | ");
        throw new Error(`agy SDK seat exited ${run.status ?? run.signal}: ${out?.error ?? tail}`);
      }
      res = { text: existsSync(join(dir, "response.md")) ? readFileSync(join(dir, "response.md"), "utf8") : "",
        structured_output: out.structured_output ?? null, response_id: out.conversation_id ?? null,
        usage: out.usage ?? null, tool_calls: out.tool_calls ?? 0, subagent_calls: out.subagent_calls ?? 0 };
    } else {
      throw new Error(`agy seat: unknown PANTHEON_AGY_TRANSPORT "${transport}" (expected sdk or cli)`);
    }
    let text = res.text;
    const so = res.structured_output;
    if (so && typeof so === "object" && so.verdict) {
      const lines = (so.findings ?? []).map(f => `${f.severity}: ${f.note}`);
      text = [so.narrative ?? "", ...lines, text.trim(), `VERDICT: ${so.verdict}`].filter(Boolean).join("\n\n");
    }
    if (transport === "cli") {
      writeFileSync(join(dir, "response.md"), text);
      writeFileSync(join(dir, "result.json"), JSON.stringify({ ok: true, role, model,
        conversation_id: res.response_id, usage: res.usage, tool_calls: res.tool_calls,
        subagent_calls: res.subagent_calls }, null, 2));
    }
    return { text, response_id: res.response_id, usage: res.usage, tool_calls: res.tool_calls, subagent_calls: res.subagent_calls };
  }

  async function turn({ vendor, purpose, model, prompt, extra = undefined }) {
    const t0 = Date.now();
    progress({ event: "turn.start", seat: vendor, model, detail: `${purpose}, ${prompt.length} chars of prompt` });
    if (vendor === "agy_google") {
      let r;
      try { r = await agyTurn({ purpose, model, prompt }); }
      catch (e) { progress({ event: "turn.error", seat: vendor, model, detail: String(e?.message ?? e).slice(0, 200) }); throw e; }
      const ms = Date.now() - t0;
      run.turns.push({ vendor, model, purpose, ms, chars: r.text.length, prompt_chars: prompt.length, response_id: r.response_id, streamed: true,
        tool_calls: r.tool_calls, subagent_calls: r.subagent_calls, usage: r.usage });
      progress({ event: "turn.done", seat: vendor, model, ms, detail: `${r.text.length} chars, ${r.tool_calls} tool call(s), ${r.subagent_calls} subagent(s)` });
      return r.text;
    }
    // STREAMED. A non-streaming call on a long prompt sat past the fetch headers timeout while
    // grok-4.7 was still thinking; with a stream the headers arrive immediately and the deltas let
    // an overseer say "still writing: N chars" instead of nothing.
    let chars = 0, lastNote = Date.now();
    const onEvent = e => {
      if (e.type === "delta" && e.text) { chars += e.text.length; if (Date.now() - lastNote > 10_000) { lastNote = Date.now(); progress({ event: "turn.progress", seat: vendor, model, detail: `${chars} chars so far` }); } }
      else if (e.type === "error") progress({ event: "turn.error", seat: vendor, model, detail: e.text ?? "stream error" });
    };
    let r;
    try { r = await sdkTurn({ vendor, purpose, cwd: worktree, prompt, model, client: clientFor(vendor), home, onEvent, label: `${vendor}-${purpose}`, ...(extra ? { extra } : {}) }); }
    catch (e) { progress({ event: "turn.error", seat: vendor, model, detail: String(e?.message ?? e).slice(0, 200) }); throw e; }
    if (!r.ok) { progress({ event: "turn.error", seat: vendor, model, detail: r.why }); throw new Error(`${vendor}/${purpose}: ${r.why}`); }
    const text = r.result.text ?? "";
    const ms = Date.now() - t0;
    run.turns.push({ vendor, model, purpose, ms, chars: text.length, prompt_chars: prompt.length, response_id: r.result.response_id ?? null, streamed: r.result.streamed ?? false });
    progress({ event: "turn.done", seat: vendor, model, ms, detail: `${text.length} chars` });
    return text;
  }

  /** Walk the seating table's fallbacks on a TRANSPORT failure only. */
  async function roleTurn({ role, purpose, prompt, avoid = [], extra = undefined, pin = null }) {
    let candidates = OVERRIDES[role] ? [OVERRIDES[role]] : candidatesFor(role, { avoid });
    if (!candidates.length) throw new Error(`no seated candidate for "${role}"`);
    // A PINNED MODEL keeps the chair and its pack, and names the body in it -- the same thing a
    // --seat override does, but per call, so one ticket can put gpt-6-astra on one slot and
    // gpt-6-sol on another. The fallback ladder is preserved below the pin: if the pinned body
    // fails at the transport, the remaining rungs are still tried, because a pin is a preference
    // about which model does the work, not a demand that the run die if it is unavailable.
    if (pin) candidates = [{ ...candidates[0], model: pin, basis: "PINNED", why: `pinned per slot: ${pin}` }, ...candidates];
    // SEEDED FROM DISK. This set used to start empty on every role turn, so the knowledge that a
    // pool was shut died with the turn that paid for it: the scouts could not tell the planner, and
    // the next process started blind. On 2026-09-28 one build paid the same ten-minute discovery
    // twice -- once in LEXI's drafting leg, then again in this loop, against the same exhausted
    // subscription. A refusal is evidence; src/route/cooldown.mjs is where it survives.
    const remembered = shutPools();
    const tried = [], deadPools = new Set(remembered);
    for (const c of candidates) {
      const pool = cooldownPoolFor(c, process.env.PANTHEON_AGY_TRANSPORT ?? "sdk");
      if (deadPools.has(pool)) {
        // Saying WHICH kind of shut matters when reading a failed run: one of these cost a call to
        // learn, the other cost nothing because an earlier turn already paid for it.
        tried.push(`${c.vendor}: skipped, ${pool} hose shut` +
          (remembered.has(pool) ? " (remembered from an earlier refusal, not retried)" : ""));
        continue;
      }
      try {
        const text = await turn({ vendor: c.vendor, purpose, model: c.model, prompt, extra: capFor(c.vendor, extra) });
        recordSuccess(pool);   // one good answer ends the cooldown and the streak
        return { text, seat: c };
      } catch (err) {
        if (isTimeout(err)) {
          tried.push(`${c.vendor}/${c.model}: transport timeout`);
          progress({ event: "reseat", detail: `${c.vendor}/${c.model} timed out; trying the next ${role} candidate` });
          continue;
        }
        const f = shouldFallThrough(err);
        tried.push(`${c.vendor}: ${f.why}`);
        progress({ event: "reseat", detail: `${c.vendor}: ${f.why}` });
        if (!f.ok) throw err;
        if (f.same_vendor_viable) {
          const waitS = Math.min(f.retry_after_s ?? 2, 60);
          await new Promise(r => setTimeout(r, waitS * 1000));
          try {
            const text = await turn({ vendor: c.vendor, purpose, model: c.model, prompt, extra: capFor(c.vendor, extra) });
            recordSuccess(pool);
            return { text, seat: c };
          } catch (e2) {
            const f2 = shouldFallThrough(e2);
            tried.push(`${c.vendor}: still ${f2.why}`);
            deadPools.add(pool);
            recordRefusal(pool, { retryAfterS: f2.retry_after_s, why: f2.why });
            continue;
          }
        }
        deadPools.add(pool);
        // Only a REFUSAL is recorded, never a transport timeout: a timeout says the network was
        // slow, not that the credential is spent, and disbelieving a healthy pool for fifteen
        // minutes on that evidence would be the cache causing the outage it exists to avoid.
        recordRefusal(pool, { retryAfterS: f.retry_after_s, why: f.why });
      }
    }
    throw new Error(`every seated candidate for "${role}" was unavailable: ${tried.join("; ")}`);
  }

  /** The repository HEAD, read from the ref files (no version-control process). */
  function repoHead() {
    try {
      const h = readFileSync(join(REPO, ".git", "HEAD"), "utf8").trim();
      return h.startsWith("ref: ") ? readFileSync(join(REPO, ".git", h.slice(5)), "utf8").trim() : h;
    } catch { return ""; }
  }

  /** Execute the combined change in the mandatory boundary, then check the bytes it judged. */
  async function runAcceptance(crew) {
    const result = await isolatedAcceptance({ worktree, cmd: CMD, head: repoHead() });
    for (const c of crew) {
      const actual = readArtifact(worktree, c.sl.path);
      if (actual === null || cidOf("blob", actual) !== c.bytes) {
        result.exit = 1;
        result.out += `\nArtifact changed during acceptance: ${c.sl.path}; the recorded CAS bytes were not tested unchanged.\n`;
      }
    }
    return result;
  }

  // A CRASH IS RECORDED, NOT JUST THROWN. Whatever stage dies inside this run, the run record says
  // where and why, the latest artifact (if any) is copied out, and the caller's `progress` gets a
  // terminal line -- but nothing here ever calls process.exit(); a caller reachable from an HTTP
  // handler would take the whole server down on one failed build, not just this request.
  try {
    let previous = null;
    if (RESUME) {
      previous = JSON.parse(readFileSync(statePath, "utf8"));
      if (previous.format !== 2 || previous.isolation !== ACCEPTANCE_ISOLATION ||
          previous.ticket_cid !== ticketCid || resolve(previous.board) !== resolve(root)) {
        throw new Error("resume: ticket/spec differs or this is a legacy run without isolated recovery state");
      }
      Object.assign(run, previous, { error: null, salvaged: null, resumed_from: { board: root, previous_error: previous.error ?? null } });
    } else if (existsSync(statePath)) {
      throw new Error("board already has a run; use resume instead of overwriting recovery state");
    }
    recordAllowed = true;
    enter("isolation", "checking mandatory acceptance confinement before any vendor call");
    const probe = await isolatedAcceptance({ worktree, cmd: "true", head: repoHead(), timeout: 10_000 });
    if (probe.exit !== 0) throw new Error(`acceptance isolation preflight refused: ${probe.out}`);
    if (RESUME && run.shipped) {
      // Idempotent completion also repairs missing exports from the certified store, without seats.
      exportShipped(); record();
      progress({ event: "run.end", detail: "already shipped; certified exports restored" });
      return { ok: true, shipped: true, key: spec.key, board: root, outDir, error: null, salvaged: null };
    }
    if (!RESUME) run.files = SLOTS.map(sl => {
      const baseline = readArtifact(REPO_ROOT, sl.path);
      return { slot: sl.slot, path: sl.path, baseline: { exists: baseline !== null,
        bytes: board.store.put("blob", baseline ?? Buffer.alloc(0)) } };
    });
    // ---------------------------------------------------------------- seating
    const chain = seatingPlan({ roles: ["planner", "implementer", "reviewer"] });
    if (!chain.ok) throw new Error(chain.why);
    const intake = seatingPlan({ roles: ["scout"], seating: INTAKE });
    bar(`open item ${spec.key} — ${spec.title}`);
    progress({ event: "run.start", detail: `${spec.key}: ${spec.title} → ${SLOT}; acceptance: ${CMD}` });
    for (const r of seatingReport(chain)) say(r.line);

    let scouts = [], TICKET = null, plannerVendor = null, maker = null, wip = null;
    // One work item per slot. A single-slot ticket keeps the bare key it always had, so its board
    // refs, its run record and every existing test are untouched.
    const itemKeyFor = sl => (SLOTS.length === 1 ? ITEM : `${ITEM}-${sl.slot}`);
    let BUILT = null;
    let artifactCid = null, bytes = null, code = null, recordedExit = null, reproOut = "", rev = 0;
    run.revisions ??= [];
    let crew = null;
    // Reference material for the seats. `attach` is the explicit list. A markdown or text document
    // in `copy` is the same thing by another name: the ticket author put it there FOR the
    // implementer, and the implementer has no tools, so a document that is only in the worktree
    // was never read by anyone. (The round-1 membrane ticket carried its motion spec and its full
    // specification in `copy`; the seat saw neither.) Directories and code in `copy` stay where
    // they are -- they exist for the acceptance command, not the prompt. Bounded per file so a
    // stray large document cannot swallow the context.
    const ATTACH_MAX_BYTES = 200_000;
    const attachable = [...new Set([...(spec.attach ?? []), ...(spec.copy ?? []).filter(rel => /\.(md|txt)$/i.test(rel))])]
      .filter(rel => existsSync(join(REPO_ROOT, rel)) && statSync(join(REPO_ROOT, rel)).isFile());
    const attached = attachable.map(rel => {
      const body = readFileSync(join(REPO_ROOT, rel), "utf8");
      return `\n\n--- reference (read-only; do NOT output this file): ${rel} ---\n` +
        (body.length > ATTACH_MAX_BYTES ? `[${body.length} bytes: too large to attach; first ${ATTACH_MAX_BYTES} shown]\n${body.slice(0, ATTACH_MAX_BYTES)}` : body);
    }).join("");

    if (!RESUME) {
      // ---------------------------------------------------------------- INTAKE (outside the chain)
      // Breadth at intake, across vendors that spend from independent pools. Configurable because
      // this is the ONE place a fan-out is legal (depth 0, before commitment), so widening it is a
      // real option rather than a law to amend -- and because a run with no Antigravity venv needs
      // to be able to say so.
      const SCOUTS = SCOUT_VENDORS;
      assertFanOutIsOutside({ stage: "intake", depth: 0, width: SCOUTS.length });
      enter("intake", `${SCOUTS.length} scouts, independent pools`);
      scouts = [];
      for (const vendor of SCOUTS) {
        const seat = { vendor, seat_id: `${vendor}-scout`, mode: "explore", occupancy_gen: 1 };
        const p = promptFor("scout", { question: spec.question },
          NO_TOOLS + "Answer from what you already know in at most four sentences, name the concrete failure rather than a " +
          "category, and end with one line: `RAN: nothing`.");
        const model = intake.assigned.scout.vendor === vendor ? intake.assigned.scout.model : (vendor === "xai" ? modelId("xai", "grok-4.6") : modelId("google", "gemini-3.5-flash"));
        // The 700-token cap exists because grok-4.6 once answered this prompt with 82k characters.
        // It is WRONG for the multi-agent model and is skipped there, for two reasons that agree:
        // docs.x.ai says "The max_tokens parameter is not currently supported by the multi-agent
        // model variant", so the cap would be ignored or rejected rather than honoured; and the
        // model runs sixteen subagents whose whole output is a synthesis, so truncating it at 700
        // would pay for a research team and read four sentences of it.
        const cap = tokenCapFor("scout", model);
        const text = await turn({ vendor, purpose: "scout", model, prompt: p.prompt,
          extra: cap == null ? undefined : capFor(vendor, { tokens: cap }) });
        const r = await publish({ ...board, ref: `refs/iso/${vendor}/scout`, author: seat, msg: `scout ${vendor}`,
          entries: [{ kind: "search", payload: { query: spec.question, urls: [] }, blob: text }] });
        if (!r.ok) throw new Error(`scout ${vendor} publish: ${r.why}`);
        scouts.push({ vendor, ref: `refs/iso/${vendor}/scout`, commit: r.commit, evidence: r.written[0].cid, text });
      }
      writeFileSync(join(outDir, "scouts.md"), scouts.map(s => `## ${s.vendor}\n\n${s.text}\n`).join("\n"));
      check(board.refs.resolve(REF) === null, "intake really precedes the board");

      // ---------------------------------------------------------------- promote
      enter("promote", "the human's ticket, citing the scouts");
      TICKET = {
        title: spec.title, goal: spec.goal, repo: "pantheon",
        constraints: spec.constraints ?? [], forbidden: spec.forbidden ?? ["do not elect a vendor as judge"],
        acceptance: [{ type: "tests", cmd: CMD, expect: "exit0" }],
      };
      const t = await publish({ ...board, ref: REF, author: HUMAN, msg: "the ticket",
        entries: [{ kind: "ticket", links: { derived_from: scouts.map(s => s.evidence) }, payload: TICKET }] });
      if (!t.ok) throw new Error(t.why);

      // ---------------------------------------------------------------- plan
      enter("plan");
      const pl = OVERRIDES.planner ?? chain.assigned.planner;
      plannerVendor = pl.vendor;
      {
        const seat = { vendor: pl.vendor, seat_id: `${pl.vendor}-plan`, mode: "plan", occupancy_gen: 1 };
        const planWip = `refs/seat/${seat.seat_id}/wip`;
        await board.refs.branch({ name: planWip, from: REF, author: seat });
        const { slice } = project(board.store, board.refs.resolve(REF), PROJECTION_FOR_ROLE.planner);
        const p = promptFor("planner", { ticket: slice.slots.ticket.payload.goal },
          NO_TOOLS + "Reply with exactly one line and nothing else: TITLE: <a one-line work item title for the single change this ticket asks for>");
        const { text, seat: ran } = await roleTurn({ role: "planner", purpose: "plan", prompt: p.prompt });
        plannerVendor = ran.vendor;
        const m = text.match(/^\s*TITLE:\s*(.+)$/mi);
        if (!m) throw new Error(`planner did not answer in the required form; got: ${text.slice(0, 200)}`);
        const title = m[1].trim().slice(0, 120);
        const r = await publish({ ...board, ref: planWip, author: seat, msg: "plan",
          entries: [
            { kind: "plan", payload: { steps: SLOTS.map(sl => ({ item: itemKeyFor(sl), title })) } },
            // One work_item per slot. Each carries its own lease resource, so each implementer
            // publishes under its OWN identity -- which is what lets reviewAck check cross-lab
            // review per file rather than per ticket.
            ...SLOTS.map(sl => ({ kind: "work_item",
              payload: { key: itemKeyFor(sl), title: SLOTS.length === 1 ? title : `${title} — ${sl.slot}`,
                state: "ready", artifact_slots: [`artifact:${sl.slot}`], preferred_mode: "work" } })),
          ] });
        if (!r.ok) throw new Error(`plan publish: ${r.why}`);
        const mg = await merge({ ...board, into: REF, from: planWip, author: CONTROLLER, only: CARRY, msg: "adopt the plan" });
        if (!mg.ok) throw new Error(`adopt: ${mg.why}`);
      }
      const sched = schedule({ ...board, ref: REF });
      check(sched.ready.some(r => r.ks === "work"), "the controller scheduled work from board state");

      // ---------------------------------------------------------------- work
      enter("work", `up to ${revisions} revisions`);
      // ONE IMPLEMENTER PER SLOT, in parallel. They are not competing: each owns a different file,
      // holds its own lease, and publishes under its own seat identity. Which rung builds each slot
      // is decided per slot (the ticket's `model`, or a per-index --seat override, or the ladder),
      // so choosing between gpt-6-astra / gpt-6-sol / gpt-6-luna is a ticket-time decision rather
      // than a seating-table edit.
      crew = SLOTS.map((sl, i) => {
        const im = OVERRIDES[`implementer.${i}`] ?? OVERRIDES[`implementer.${sl.slot}`] ?? OVERRIDES.implementer ?? chain.assigned.implementer;
        const seat = { vendor: im.vendor, seat_id: SLOTS.length === 1 ? `${im.vendor}-work` : `${im.vendor}-work-${sl.slot}`,
                       mode: "work", occupancy_gen: 1 };
        return { sl, seat, itemKey: itemKeyFor(sl), wip: `refs/seat/${seat.seat_id}/wip`,
                 model: sl.model ?? im.model, file: join(worktree, sl.path),
                 artifactCid: null, bytes: null, code: null, lease: null,
                 baseline: run.files.find(f => f.slot === sl.slot).baseline };
      });
      // The old single-slot names still point at the first member, so the resume branch, the run
      // record and the check stage keep working unchanged for a one-file ticket.
      maker = crew[0].seat;
      wip = crew[0].wip;
      progress({ event: "crew", detail: crew.map(c => `${c.sl.slot}:${c.seat.vendor}/${c.model}`).join(", ") });
    } else {
      enter("resume", `from ${root}`);
      plannerVendor = run.planner_vendor;
      if (!plannerVendor || run.files.length !== SLOTS.length) throw new Error("resume: incomplete per-slot recovery state");
      TICKET = board.store.get(treeSlots(board.store, board.refs.resolve(REF)).ticket)?.payload;
      if (!TICKET) throw new Error("resume: no board ticket");
      crew = SLOTS.map(sl => {
        const saved = run.files.find(f => f.slot === sl.slot && f.path === sl.path);
        if (!saved?.artifactCid || !saved.seat || !saved.wip) throw new Error(`resume: incomplete artifact for ${sl.slot}`);
        const art = board.store.get(saved.artifactCid);
        if (treeSlots(board.store, board.refs.resolve(saved.wip))[`artifact:${sl.slot}`] !== saved.artifactCid ||
            art.links.bytes !== saved.bytes) throw new Error(`resume: artifact branch changed for ${sl.slot}`);
        const contents = board.store.get(saved.bytes);
        writeArtifact(worktree, sl.path, contents);
        return { sl, seat: saved.seat, itemKey: itemKeyFor(sl), wip: saved.wip,
          model: sl.model ?? (OVERRIDES.implementer ?? chain.assigned.implementer).model,
          file: join(worktree, sl.path), artifactCid: saved.artifactCid, bytes: saved.bytes,
          baseline: saved.baseline, code: contents.toString("utf8"), lease: null };
      });
      rev = Math.max(...run.files.map(f => f.rev));
      const exits = crew.map(c => {
        const status = acceptanceStatus({ store: board.store, state: boardState({ ...board, ref: REF }),
          artifact: { cid: c.artifactCid }, from: board.refs.resolve(c.wip) });
        const rows = status.rows.flatMap(r => r.runs ?? []);
        return rows.at(-1)?.exit ?? null;
      });
      recordedExit = exits.every(exit => exit === 0) ? 0 : 1;
      maker = crew[0].seat; wip = crew[0].wip;
      artifactCid = crew[0].artifactCid; bytes = crew[0].bytes; code = crew[0].code;
    }
    run.planner_vendor = plannerVendor;
    record();
    // A failed acceptance resumes at revision, retaining every slot and its original baseline.
    // A late review/ship failure can reuse its byte-bound passing controller result.
    if (!RESUME || recordedExit !== 0) {
    {
        for (const c of crew) {
          if (!board.refs.resolve(c.wip)) await board.refs.branch({ name: c.wip, from: REF, author: c.seat });
          const held = await board.runtime.acquire({ resource: `item:${c.itemKey}`, holder: c.seat, ttlMs: 1_800_000 });
          c.lease = { resource: `item:${c.itemKey}`, gen: held.lease.gen };
          board.runtime.setOccupancy(c.seat.seat_id, { status: "running", mode: "work", ref: c.wip });
        }

        const oracle = spec.tests_file ? readFileSync(join(REPO_ROOT, spec.tests_file), "utf8") : "";

        for (let attempt = 0; attempt < revisions; attempt++) {
          rev++;
          // FAN OUT THE WRITES. Every slot's implementer runs at the same time; none of them can
          // see another's output, which is the point -- they are building different files against
          // the same ticket, not reviewing each other.
          await Promise.all(crew.map(async c => {
            const { slice } = project(board.store, board.refs.resolve(REF), PROJECTION_FOR_ROLE.implementer, { reader: c.seat, item: c.itemKey });
            const implTests = testsBrief({ store: board.store, state: boardState({ ...board, ref: REF }), from: board.refs.resolve(c.wip),
              ...(c.artifactCid ? { artifact: { cid: c.artifactCid } } : {}), maxOutput: 8000 });
            // A ticket whose `path` already exists is an EDIT, and the implementer has no tools:
            // if the file is not in this prompt, it does not exist for the seat. This used to read
            // only `source`, a field LEXI's drafter never emits (its strict schema forbids extra
            // keys), so two rounds of a real ticket asked for an edit of an 86 KB shader and put a
            // heading with nothing under it in front of the seat -- which rewrote the file from a
            // summary (2 of 8 programs survived), then refused in 225 bytes. `source` still wins
            // when set; `path` is the default it should always have had.
            const currentPath = c.sl.source ?? c.sl.path;
            const current = currentPath ? (readArtifact(REPO_ROOT, currentPath)?.toString("utf8") ?? "") : "";
            const others = crew.length === 1 ? "" :
              `\n\nThis ticket is being built by ${crew.length} implementers at once, each owning ONE file. ` +
              `Yours is ${c.sl.path}. The others are writing: ${crew.filter(o => o !== c).map(o => o.sl.path).join(", ")}. ` +
              `Do not write their files and do not restate their work; the acceptance command runs once over all of them together.`;
            const p = promptFor("implementer",
              { ticket: c.sl.goal ?? slice.slots.ticket.payload.goal,
                work_item: `${c.itemKey}: ${slice.slots[`item:${c.itemKey}`]?.payload?.title ?? spec.title}`,
                artifact: rev === 1
                  ? `Current contents of ${c.sl.path}:\n\n${current}${attached}`
                  : `Your revision ${rev - 1} of ${c.sl.path}, which FAILED the executed acceptance shown under tests (fix it; do not start over):\n\n${c.code}${attached}`,
                tests: `${implTests.text}\n\n${oracle ? `The acceptance test file ${spec.tests_file}, verbatim (it runs as part of the command above):\n\n${oracle}` : ""}` },
              NO_TOOLS + `Output ONLY the complete new contents of ${c.sl.path}. No prose before or after, no markdown fence. ` +
              `Keep every existing export and every existing behaviour; the acceptance command must exit 0.` + others);
            writeFileSync(join(outDir, `implementer-prompt-${c.sl.slot}-rev${rev}.txt`), p.prompt);
            const made = await roleTurn({ role: "implementer", purpose: "work", prompt: p.prompt,
              ...(c.model ? { pin: c.model } : {}) });
            c.code = strip(made.text);
            if (made.seat.vendor !== c.seat.vendor) throw new Error(
              `the implementer for ${c.sl.slot} fell through to ${made.seat.vendor} but the seat identity is ${c.seat.vendor}: re-seating mid-run would mislabel who wrote the artifact`);
            writeArtifact(worktree, c.sl.path, c.code.endsWith("\n") ? c.code : c.code + "\n");
            progress({ event: "wrote", rev, slot: c.sl.slot, detail: `${c.sl.path} (${c.code.length} chars)` });

            const a = await publish({ ...board, ref: c.wip, author: c.seat, lease: c.lease,
              msg: `MAKER DEFENSE rev ${rev}: this is correct, I checked it carefully`,
              entries: [{ kind: "artifact", payload: { slot: c.sl.slot, path: c.sl.path, rev, summary: spec.title, baseline: c.baseline }, blob: readArtifact(worktree, c.sl.path) }] });
            if (!a.ok) throw new Error(`artifact publish (${c.sl.slot} rev ${rev}): ${a.why}`);
            c.artifactCid = treeSlots(board.store, a.commit)[`artifact:${c.sl.slot}`];
            c.bytes = board.store.get(c.artifactCid).links.bytes;
            run.files = crew.map(member => ({ slot: member.sl.slot, path: member.sl.path,
              baseline: member.baseline, seat: member.seat, wip: member.wip,
              artifactCid: member.artifactCid, bytes: member.bytes, rev }));
            record();
            check(true, `rev ${rev}: ${c.sl.slot} written by ${c.seat.vendor} (${shortCid(c.artifactCid)})`);
          }));

          // ACCEPTANCE RUNS ONCE, OVER THE WHOLE CHANGE. Running it per slot would have each
          // implementer graded against a tree the others were still writing into -- and a
          // multi-file change is only correct together.
          artifactCid = crew[0].artifactCid; bytes = crew[0].bytes; code = crew[0].code;
          progress({ event: "acceptance.start", rev, detail: CMD });
          const acc = await runAcceptance(crew);
          recordedExit = acc.exit; reproOut = acc.out;
          progress({ event: "acceptance.done", rev, exit: acc.exit, detail: (acc.out.match(/ℹ (?:pass|fail) \d+/g) ?? []).join(", ") });
          writeFileSync(join(outDir, `repro-rev${rev}.txt`), `$ ${CMD}\n(exit ${acc.exit})\n\n${acc.out}`);
          // The repro binds to EVERY artifact it judged: the TESTS gate checks each slot, and a
          // run that cited only one file would leave the others with no executed result.
          for (const c of crew) {
            const rp = await publish({ ...board, ref: c.wip, author: CONTROLLER, msg: `the suite on rev ${rev}`,
              entries: [{ kind: "repro", payload: { cmd: CMD, exit: acc.exit, isolation: acc.isolation }, blob: acc.out.slice(-20_000) || "(no output)", links: { derived_from: [c.artifactCid] } }] });
            if (!rp.ok) throw new Error(`repro publish (${c.sl.slot} rev ${rev}): ${rp.why}`);
          }
          run.revisions.push({ rev, exit: acc.exit, slots: crew.map(c => ({ slot: c.sl.slot, chars: c.code.length, artifact: c.artifactCid, bytes: c.bytes })) });
          record();
          if (acc.exit === 0) break;
          if (attempt + 1 < revisions) progress({ event: "revise", rev: rev + 1 });
        }

        for (const c of crew) {
          const o = await publish({ ...board, ref: c.wip, author: c.seat, lease: c.lease, msg: "offer it for review",
            entries: [{ kind: "work_item", links: { offer: [c.artifactCid] },
              payload: { key: c.itemKey, title: TICKET.title, state: "offered_review", offer_ref: c.wip, artifact_slots: [`artifact:${c.sl.slot}`] } }] });
          if (!o.ok) throw new Error(`offer publish (${c.sl.slot}): ${o.why}`);
          await merge({ ...board, into: REF, from: c.wip, author: CONTROLLER, only: CARRY, msg: "carry the offer" });
          await board.runtime.release({ resource: `item:${c.itemKey}`, holder: c.seat, gen: c.lease.gen });
          board.runtime.setOccupancy(c.seat.seat_id, { status: "done", mode: "work", ref: c.wip });
          check(treeSlots(board.store, board.refs.resolve(REF))[`artifact:${c.sl.slot}`] === undefined,
            `bound-review holds ${c.sl.slot} OFF the shipping ref until it is acked`);
        }
        BUILT = crew;
      }
    } else {
      BUILT = crew;
    }
    run.acceptance = { cmd: CMD, exit: recordedExit, revisions: rev, isolation: ACCEPTANCE_ISOLATION };
    record();

    // ---------------------------------------------------------------- check (other lab, on the bytes)
    enter("check", "another lab acks the bytes");
    let verdict = null, reviewText = "";
    {
      // EVERY artifact needs its own cross-lab ack: ship's REVIEW gate is reviews.every(r => r.ok)
      // over the moving artifact slots (src/board/integrate.mjs), so a multi-slot change with one
      // critique would be refused -- correctly. The pairing is computed per file, against THAT
      // file's maker, because "a different lab than the one that wrote it" is a per-file property.
      const toReview = BUILT ?? [{ sl: { slot: SLOT, path: PATH }, seat: maker, wip, artifactCid, bytes, code }];
      for (const built of toReview) {
      // WAS reviewPlan({producers, assigner})[0] here. Found 2026-09-29: reviewPlan picks from
      // Object.keys(SEAT_FACTS) -- every vendor that exists, not SEATING.reviewer's actual curated
      // table -- so it can name a vendor roleTurn below would never pick (roleTurn walks
      // candidatesFor("reviewer", {avoid}), a different, narrower list). The two independently
      // computed answers had no reason to agree, and didn't: this is what "the review fell through
      // to X but the critique seat is Y" was, every time it fired, including with no operator
      // override at all once agy_google became the default maker for both planner and implementer.
      // Fix: compute the pairing from the SAME lookup roleTurn actually uses, so they cannot diverge.
      const pairing = OVERRIDES.reviewer
        ? { reviewer: OVERRIDES.reviewer.vendor, why: `operator reseat: ${OVERRIDES.reviewer.vendor}/${OVERRIDES.reviewer.model}` }
        : (c => c ? { reviewer: c.vendor, why: `candidatesFor("reviewer"), first entry excluding the maker (${built.seat.vendor}) and planner (${plannerVendor})` }
                  : { reviewer: null, why: `no reviewer candidate left after avoiding ${built.seat.vendor}, ${plannerVendor}` }
          )(candidatesFor("reviewer", { avoid: [built.seat.vendor, plannerVendor] })[0]);
      if (!pairing.reviewer) throw new Error(`no clean reviewer: ${pairing.why}`);
      assertReviewCutsAcross({ assigner: { vendor: plannerVendor }, producer: { vendor: built.seat.vendor }, reviewer: { vendor: pairing.reviewer } });
      const seat = { vendor: pairing.reviewer, seat_id: toReview.length === 1 ? `${pairing.reviewer}-critique` : `${pairing.reviewer}-critique-${built.sl.slot}`, mode: "critique", occupancy_gen: 1 };
      const rref = `refs/seat/${seat.seat_id}/wip`;
      await board.refs.branch({ name: rref, from: built.wip, author: seat });
      const { slice, withheld } = project(board.store, board.refs.resolve(built.wip), PROJECTION_FOR_ROLE.reviewer, { reader: seat });
      check(withheld.some(w => w.slot === "(commit message)"), "the checker cannot read the maker's defense");
      const reviewTests = testsBrief({ store: board.store, state: boardState({ ...board, ref: REF }), artifact: { cid: built.artifactCid }, from: board.refs.resolve(built.wip) });
      check(new RegExp(`exited ${recordedExit}\\b`).test(reviewTests.text), `the reviewer's tests brief says "exited ${recordedExit}", as the repro recorded`);
      const p = promptFor("reviewer",
        { ticket: slice.slots.ticket.payload.goal, artifact: `New contents of ${built.sl.path} (revision ${rev}):\n\n${built.code}${attached}`, tests: reviewTests.text },
        NO_TOOLS + "The complete new file and the executed test result are above; judge from them. " +
        "Attack this change. Name the strongest specific flaw: a behaviour the ticket asked for that is missing, an existing " +
        "behaviour it broke, or a case the acceptance test does not cover that would fail. If the executed acceptance failed, " +
        "you must request changes. End your reply with a line reading exactly `VERDICT: approve` or `VERDICT: request_changes`.");
      const reviewed = await roleTurn({ role: "reviewer", purpose: "critique", prompt: p.prompt, avoid: [built.seat.vendor, plannerVendor], extra: { tokens: 4000 } });
      if (reviewed.seat.vendor !== seat.vendor) throw new Error(`the review fell through to ${reviewed.seat.vendor} but the critique seat is ${seat.vendor}; a mislabelled verdict is worse than none`);
      reviewText = reviewed.text;
      writeFileSync(join(outDir, toReview.length === 1 ? "review.md" : `review-${built.sl.slot}.md`), `# ${reviewed.seat.vendor} · ${reviewed.seat.model} reviewing ${built.seat.vendor} on ${built.sl.slot} (rev ${rev})\n\n${reviewText}\n`);
      let m = reviewText.match(/^\s*VERDICT:\s*(approve|request_changes)\s*$/mi);
      if (!m) {
        progress({ event: "reask", seat: seat.vendor, detail: "no VERDICT line; asking once more" });
        const again = await turn({ vendor: reviewed.seat.vendor, purpose: "critique", model: reviewed.seat.model, extra: capFor(reviewed.seat.vendor, { tokens: 800 }),
          prompt: NO_TOOLS + "Your previous reply ended without the required verdict. You cannot read anything further; the file and the " +
            "executed result were in the message before. Reply with ONE line, exactly `VERDICT: approve` or `VERDICT: request_changes`, " +
            "then at most three sentences naming the strongest specific flaw if you requested changes." });
        reviewText += `\n\n[re-asked]\n${again}`;
        m = again.match(/^\s*VERDICT:\s*(approve|request_changes)\s*$/mi);
      }
      verdict = m ? m[1].toLowerCase() : "request_changes";
      if (!m) progress({ event: "verdict", seat: seat.vendor, detail: "unparseable → request_changes" });
      progress({ event: "verdict", seat: seat.vendor, slot: built.sl.slot, detail: verdict });
      const findings = verdict === "approve" ? [] : [{ severity: "block", note: (m ? reviewText : `no parseable verdict after a re-ask; failing closed. Reviewer text: ${reviewText}`).slice(0, 400) }];
      const c = await publish({ ...board, ref: rref, author: seat, msg: "review",
        entries: [{ kind: "critique", links: { target: built.bytes }, payload: { target: { slot: built.sl.slot, rev }, verdict, findings } }] });
      if (!c.ok) throw new Error(`critique publish: ${c.why}`);
      const back = await merge({ ...board, into: built.wip, from: rref, author: CONTROLLER, only: ["critique:"], msg: "collect the verdict" });
      if (!back.ok) throw new Error(`collect: ${back.why}`);
      await merge({ ...board, into: REF, from: built.wip, author: CONTROLLER, only: CARRY, msg: "carry the verdict" });
      }
    }
    run.review = { verdict };
    record();

    // ---------------------------------------------------------------- ship (controller only)
    enter("ship", "the controller's transaction through every gate");
    const headBefore = board.refs.resolve(REF);
    // ship() is ONE transaction over the whole change, and its artifacts come from ONE ref. With
    // several slots the artifacts sit on several seat wips (CARRY never moves code, by design), so
    // the controller stages them onto a single ref first. Shipping per-wip instead would ship a
    // partial change -- some files gated, others not yet written -- which is exactly what a
    // transaction is supposed to prevent. A single-slot run ships straight from its own wip, as
    // it always has.
    let shipFrom = wip;
    if (BUILT && BUILT.length > 1) {
      shipFrom = "refs/seat/controller-stage/wip";
      await board.refs.branch({ name: shipFrom, from: REF, author: CONTROLLER });
      for (const c of BUILT) {
        const st = await merge({ ...board, into: shipFrom, from: c.wip, author: CONTROLLER,
          only: ["artifact:", "critique:", "item:", "plan"], msg: `stage ${c.sl.slot} for the ship transaction` });
        if (!st.ok) throw new Error(`stage ${c.sl.slot}: ${st.why}`);
      }
      progress({ event: "staged", detail: `${BUILT.length} slots staged onto ${shipFrom} for one ship transaction` });
    }
    const r = await ship({ ...board, ref: REF, from: shipFrom, actor: CONTROLLER });
    for (const g of r.gates) progress({ event: "gate", stage: g.gate, detail: g.ok ? "pass" : `REFUSE — ${g.why}` });
    progress({ event: "ship", detail: r.ok ? `shipped ${r.shipped.join(", ")} as ${shortCid(r.commit)}` : `refused: ${r.why}` });
    run.gates = r.gates; run.shipped = r.ok; run.ship_why = r.ok ? null : r.why;
    if (r.ok) run.certificate = { ref: REF, commit: r.commit };
    record(); // shipping is durable even if the following export fails; resume must not re-spend seats.
    if (r.ok) check(board.refs.resolve(REF) !== headBefore, `shipped ${r.shipped.join(", ")} as ${shortCid(r.commit)}`);
    else check(false, `ship refused: ${r.why}`);

    if (r.ok) exportShipped();
    else {
      run.artifacts = []; run.artifact = null;
      for (const c of crew) writeArtifact(REPO_ROOT,
        relative(REPO_ROOT, join(outDir, "artifact-latest", c.sl.path)), board.store.get(c.bytes));
    }
    const artifactOut = r.ok ? join(outDir, "artifact") : join(outDir, "artifact-latest");
    run.finished_at = new Date().toISOString();
    record();

    progress({ event: "run.end", detail: `acceptance exit ${recordedExit} after ${rev} revision(s); review ${verdict}; shipped=${r.ok}; ${failures} check(s) failed; artifact at ${artifactOut}` });

    const shipRefusalError = (!run.shipped && run.ship_why) ? { stage: "ship", message: run.ship_why } : null;
    return { ok: failures === 0, shipped: run.shipped === true, key: spec.key, board: root, outDir, error: run.error ?? shipRefusalError, salvaged: run.salvaged ?? null };
  } catch (e) {
    const msg = String(e?.message ?? e).slice(0, 400);
    try { progress({ event: "run.error", detail: msg }); } catch { /* nothing left to write with */ }
    try {
      run.error = { stage, message: msg, at: new Date().toISOString() };
      if (recordAllowed) for (const file of run.files ?? []) {
        if (!file.bytes) continue;
        const out = join(outDir, "artifact-latest", file.path);
        writeArtifact(REPO_ROOT, relative(REPO_ROOT, out), board.store.get(file.bytes));
        run.salvaged ??= out;
      }
      record();
    } catch { /* best effort */ }
    return { ok: false, shipped: run.shipped === true, key: spec.key, board: root, outDir, error: run.error ?? { stage, message: msg }, salvaged: run.salvaged ?? null };
  }
}
