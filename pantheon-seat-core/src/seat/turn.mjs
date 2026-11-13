// One turn = one short-lived spawn. A warm seat holds no process between turns, so nothing can
// wedge while idle and crash-safety is free.
import { spawn as nodeSpawn } from "node:child_process";
import { createHash } from "node:crypto";
import { buildArgv } from "./argv.mjs";

// stderr_tail is stored and logged like every other provenance field, so it must not carry the
// prompt either. It did: a vendor echoing the request on a failure path put the whole prompt into a
// recorded field, and the test certifying "no prompt anywhere in provenance" passed only because
// its fixture left stderr empty. This exact defect was found, fixed and regression-tested in a
// different codebase earlier the same day and left standing here -- and this task's own brief said
// "beyond the existing truncated stderr_tail", grandfathering it in the instructions.
//
// Redact, preserving the surrounding diagnostic: blanking stderr would destroy the text classify()
// reads to tell a quota refusal from a hang, trading one defect for another. Prompts under
// MIN_REDACT_LEN are left alone deliberately -- a global replace of a one- or two-character token
// would shred the diagnostic while protecting nothing.
const MIN_REDACT_LEN = 8;
export function redactPrompt(text, prompt) {
  if (!text || typeof prompt !== "string" || prompt.length < MIN_REDACT_LEN) return text ?? "";
  const marker = `<prompt:sha256:${createHash("sha256").update(prompt).digest("hex").slice(0, 12)}:${Buffer.byteLength(prompt)}B>`;
  return text.split(prompt).join(marker);
}

const QUOTA = /\b(429|rate[ _-]?limit|usage limit|quota exhausted|too many requests)\b/i;

// A timeout and a quota refusal call for OPPOSITE actions - investigate vs. wait - so a timeout
// is never reported as quota, however the stderr reads. The stack this replaces gets it backwards
// and labels every timeout quota-exhausted, which matters more here than it looks: on a
// subscription, quota exhaustion is the NORMAL steady-state failure, so the conflation misleads
// constantly rather than rarely.
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
  // The prompt goes THROUGH buildArgv so each vendor's own prompt_flag placement applies.
  // Appending it here instead would produce an argv with no print flag, launching three of the
  // four vendors interactive - they would then hit the timeout below and be reported "hung",
  // i.e. a missing flag presenting as a supervision bug.
  const { cmd, args } = buildArgv({ vendor, cwd, resumeToken, sessionId, prompt, env });
  const started = Date.now();
  // stdin is closed: a warm seat takes its whole turn from argv, and an open stdin would let a
  // vendor block waiting for input we never send.
  const child = spawnFn(cmd, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });

  let out = "", err = "", sawOutput = false, timedOut = false;
  child.stdout.on("data", d => { sawOutput = true; out += d; });
  child.stderr.on("data", d => { err += d; });

  const exitCode = await new Promise(resolve => {
    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill("SIGTERM"); } catch { /* already gone */ }
      resolve(null);
    }, timeoutMs);
    child.on("close", code => { clearTimeout(timer); resolve(code); });
    child.on("error", () => { clearTimeout(timer); resolve(null); });
  });

  const outcome = classify({ exitCode, timedOut, sawOutput, stderr: err });
  // The recorded command must NOT carry the prompt. Provenance is exactly what gets written to
  // the store, the event log and the live view, and a prompt is conversation content - so
  // joining the raw argv would leak it everywhere the constraint forbids. Keep the argv shape,
  // which is the actual diagnostic (which flags were used, in what order), and replace the
  // prompt with its hash and length. The stack this replaces records the raw join.
  const promptSha = createHash("sha256").update(prompt ?? "").digest("hex");
  const redacted = args.map(a =>
    (prompt !== undefined && prompt !== null && a === prompt)
      ? `<prompt:sha256:${promptSha.slice(0, 12)}:${Buffer.byteLength(prompt)}B>`
      : a);
  // Capture the vendor's own conversation id. Declared output shape differs by vendor: claude
  // and agy emit one JSON envelope, but grok and codex declare NDJSON (--output-format
  // streaming-json / --json), so a whole-stdout parse never sees an id on those two - it just
  // fails silently. Try the envelope first; when that fails, walk stdout line by line and take
  // the first id found on ANY line. A torn final line (a live stream cut off mid-write) must not
  // be fatal to the lines that parsed fine before it.
  const vendorId = extractVendorId(out);
  // The id we minted ourselves must survive even when the vendor tells us nothing - otherwise the
  // caller loses the address it just used to launch this turn. Record it unconditionally, then
  // fall back to it only when the vendor gave nothing; a vendor-confirmed id always wins so a
  // caller never mistakes our own guess for the vendor's confirmation.
  const supplied_session_id = sessionId ?? null;
  const vendor_session_id = vendorId ?? supplied_session_id;
  const session_id_source = vendorId ? "vendor" : (supplied_session_id ? "supplied" : "none");

  return {
    ok: outcome === "ok",
    outcome,
    provenance: {
      vendor, command: [cmd, ...redacted].join(" "), duration_ms: Date.now() - started,
      prompt_sha256: promptSha,
      exit_code: exitCode, timed_out: timedOut, saw_output: sawOutput,
      prompt_bytes: Buffer.byteLength(prompt ?? ""), stdout_bytes: Buffer.byteLength(out),
      stdout_sha256: createHash("sha256").update(out).digest("hex"),
      stderr_tail: redactPrompt(err, prompt).slice(-2000),
      vendor_session_id, supplied_session_id, session_id_source,
    },
  };
}

// Look for a conversation id at the top level of a parsed JSON value, or nested one level under
// session_meta/payload (shapes some vendors wrap their id in). Returns null for anything that
// isn't a plausible carrier - never throws on a non-object.
function idFromObj(o) {
  if (!o || typeof o !== "object") return null;
  return o.session_id ?? o.conversation_id ?? o.sessionId
    ?? idFromObj(o.session_meta) ?? idFromObj(o.payload) ?? null;
}

// A vendor's declared output is either a single JSON envelope or NDJSON (one JSON value per
// line). Try the envelope first since it's the common case; fall back to a line-by-line scan,
// skipping any line that fails to parse - a streaming lane's last line is routinely half-written
// when the process exits, and that must never throw.
function extractVendorId(out) {
  try {
    const found = idFromObj(JSON.parse(out));
    if (found) return found;
  } catch { /* not a single envelope: fall through to line-by-line */ }
  for (const line of out.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const found = idFromObj(JSON.parse(trimmed));
      if (found) return found;
    } catch { /* unparseable line: skip, never fatal */ }
  }
  return null;
}
