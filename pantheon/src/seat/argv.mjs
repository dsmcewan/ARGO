// Declared capabilities per vendor, measured 2026-09-27 from each binary's own --help
// (evidence B3, K3) and cross-checked the same day against each vendor's published docs
// (evidence Q1-Q4: learn.chatgpt.com/docs/developer-commands, docs.x.ai/build/cli/headless-
// scripting, docs.x.ai/build/features/sessions, antigravity.google/docs/cli/headless). Declared here, VERIFIED by the conformance runner in Task 6 - a row in
// this table is a claim, not a fact, until executed. routing-matrix.json self-flagged most of
// its rows unverified for 61 days and nothing noticed (B10).
//
// prompt_flag is declared for EVERY vendor, null included, so that a null reads as a decision
// rather than an omission. Its absence from the plan's original table would have launched three
// of the four vendors interactively; they would then have been killed at the 300s timeout and
// reported as "hung", i.e. a missing flag presenting as a supervision bug. See the SDD ledger.
export const VENDORS = {
  claude: {
    cmd: "claude", resume_flag: "--resume", session_id_flag: "--session-id", cwd_flag: null,
    model_flag: "--model", effort_flag: "--effort", prompt_flag: "-p",
    resume: "native", stream_in: "ndjson", stream_out: "ndjson", attach: "native",
    auth: "oauth", sandbox: [], bypass_env: "PANTHEON_CLAUDE_BYPASS",
    bypass_flag: "--dangerously-skip-permissions",
    output: ["--output-format", "json"],
    stream_output: ["--output-format", "stream-json"],
  },
  codex: {
    cmd: "codex", resume_flag: "resume", session_id_flag: null, cwd_flag: "-C",
    model_flag: "-m", effort_flag: null, prompt_flag: null, // positional, after the subcommand
    resume: "native", stream_in: "unverified", stream_out: "ndjson", attach: "none",
    auth: "oauth",
    // Exemplary posture, carried over deliberately from the existing adapter (evidence B8).
    sandbox: ["--sandbox", "read-only", "--skip-git-repo-check"],
    bypass_env: "PANTHEON_CODEX_BYPASS",
    bypass_flag: "--dangerously-bypass-approvals-and-sandbox",
    // Docs: "Add --json to receive newline-delimited JSON events (one per state change)."
    // The resume subcommand also accepts --last (newest session in this cwd) and --all (search
    // every session). Pantheon resumes by explicit id instead: --last is a cwd-and-recency
    // proxy, which is defect C1's selection rule wearing a vendor's flag.
    output: ["--json"], stream_output: ["--json"], resume_selectors: ["--last", "--all"],
    subcommand: "exec",
  },
  grok: {
    cmd: "grok", resume_flag: "--resume", session_id_flag: "--session-id", cwd_flag: null,
    model_flag: null, effort_flag: "--effort", prompt_flag: "-p",
    resume: "native", stream_in: "none", stream_out: "ndjson", attach: "none",
    auth: "oauth", sandbox: [], bypass_env: "PANTHEON_GROK_BYPASS",
    bypass_flag: "--always-approve",
    // -p is documented as the short form of --single, and passing a prompt non-interactively is
    // itself what triggers headless mode. --output-format takes json | streaming-json; the
    // latter "emits incremental events as they arrive" and is what a live view consumes.
    output: ["--output-format", "streaming-json"],
    stream_output: ["--output-format", "streaming-json"],
    continue_flag: "-c",
    // Located 2026-09-27: ~/.grok/sessions/<percent-encoded-cwd>/<session-id>/. The transcript
    // is chat_history.jsonl; events.jsonl is a message-free lifecycle log. See locate.mjs.
    store: "~/.grok/sessions",
  },
  agy: {
    cmd: "agy", resume_flag: "--conversation", session_id_flag: null, cwd_flag: "--add-dir",
    model_flag: "--model", effort_flag: null, prompt_flag: "-p",
    resume: "native", stream_in: "ndjson", stream_out: "ndjson", attach: "none",
    auth: "oauth",
    // --mode plan does NOT enforce read-only (evidence F1, demonstrated by probe against the
    // real binary: a write-tool prompt created its target file in plan mode, with and without
    // the bypass flag). The only containment is --add-dir, supplied via cwd_flag. Do not
    // describe plan mode as a sandbox.
    sandbox: ["--mode", "plan"],
    bypass_env: "PANTHEON_AGY_BYPASS",
    bypass_flag: "--dangerously-skip-permissions",
    // --output-format takes text | json | stream-json. `json` returns ONE object at completion
    // (conversation_id, status, response, duration_seconds, num_turns, usage); `stream-json` is
    // the newline-delimited event form (init, step_update, result). A turn wants the single
    // object, so `output` keeps json -- but stream_out: "ndjson" above refers to stream-json,
    // and conflating the two is how a live view ends up waiting for a completed turn.
    output: ["--output-format", "json"],
    stream_output: ["--output-format", "stream-json"],
    continue_flag: "-c",
    // Store located 2026-09-27 by inspection, NOT documented by the vendor:
    // ~/.gemini/antigravity-cli/conversations/<conversation-id>.db, one SQLite db per
    // conversation. An observed path can move without notice; see locate.mjs.
    store: "~/.gemini/antigravity-cli/conversations",
  },
};

export function bypassFragment(vendor, env = {}) {
  const v = VENDORS[vendor];
  if (!v) throw new Error(`bypassFragment: unknown vendor "${vendor}"`);
  return env[v.bypass_env] === "1" ? [v.bypass_flag] : [];
}

export function buildArgv({ vendor, cwd, model, effort, resumeToken, sessionId, prompt, env = {} }) {
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
  // The prompt goes last, behind its vendor's print flag where one exists. Omitting the prompt
  // omits the flag too, so a fresh-launch argv never carries a dangling -p with nothing to print.
  if (prompt !== undefined && prompt !== null) {
    if (v.prompt_flag) args.push(v.prompt_flag);
    args.push(prompt);
  }
  return { cmd: v.cmd, args };
}
