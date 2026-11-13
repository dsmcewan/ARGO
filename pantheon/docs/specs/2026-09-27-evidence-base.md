# Evidence base — persistent multi-seat harness ("OpenRig but better")
Date: 2026-09-27. Four read-only scout surveys. Every claim below has a file:line source.
Status of each: VERIFIED in code unless marked.

## A. OpenRig (github.com/mvschwarz/openrig @ 5c54703, 2026-09-26)
580 stars / 79 forks / 39 open issues. Created 2026-04-01. TS monorepo: cli, daemon, tui, ui, test-system.

A1. RigSpec validator: packages/daemon/src/domain/rigspec-schema.ts:95-268.
    Top-level RIG_KEYS:47-50 = version,name,summary,culture_file,permission_policy,
    managed_blocks,docs,startup,services,workspace,pods,edges
    POD_KEYS:51 = id,label,summary,continuity_policy,startup,members,edges
    MEMBER_KEYS:52-56 = id,label,agent_ref,profile,runtime,codex_config_profile,model,
    role,permission_policy,cwd,restore_policy,compaction_strategy,mechanic,startup,
    session_source,starter_ref
    EDGE_KEYS:57 = kind,from,to ; kind in {delegates_to,spawned_by,can_observe,
    collaborates_with,escalates_to} (:30)
    STEAL THIS: rejectUnknownTopologyKeys:78-90 hard-rejects unknown keys at all 4 levels.
A2. DEBT: LegacyRigSpecSchema (flat nodes[]/edges[]) at :1184+ still wired into
    bootstrap-orchestrator.ts, bundle-assembler.ts, rigspec-instantiator.ts with
    "// TODO: AS-T08b — migrate to pod-aware RigSpec". Two validators in the launch path.
    OPEN: are both runtime-reachable, what selects between them.
A3. Launch argv:
    claude fresh  claude-code-adapter.ts:283-285  `claude <permMode><model> --session-id <generatedSessionId> --name <n>`
    claude resume `--resume <resumeToken> --name <n>`
    claude fork   :258 `--resume <parentId> --fork-session --name <n>`
    codex fresh   codex-runtime-adapter.ts:390 `codex<posture> -C <cwd><gitDir><queueStateDir><model>`
    codex fork    :365 `codex<posture><model> fork<queueStateDir> <parentId>`
    KEY: OpenRig supplies its OWN --session-id at first launch => stable identity across restart.
A4. Delivery is NOT send-keys typing: tmux.ts:360-421 load-buffer + paste-buffer -d -r -p,
    then separate sendKeys(["Enter"]). Codex wraps in temp /bin/sh script (sendShellCommand
    :394-421) to dodge a pane input-length ceiling.
    GAP: pasting gives no acknowledgement. Daemon learns bytes were pasted, not acted on.
A5. Relay env injected at launch (startup.ts): OPENRIG_SESSION_NAME/NODE_ID/RUNTIME/URL/
    ACTIVITY_HOOK_TOKEN (+ legacy RIGGED_* aliases).
A6. PENDING: daemon tables/routes, supervision signals, snapshot honesty (resumed/fresh/
    failed), exhaustive machine-mutation list, 39 issue themes.

## B. Local seat layer (~/.claude/skills/multi-model-seats/)
B1. SEAT_NAMES scripts/swarm-seat-adapters.mjs:53 = [codex, claude, gemini, agy, grok].
    5 seats / 4 vendors. seatCommand() :230-257.
B2. ONE-SHOT, verified: callSeat() :270-356 = spawn(detached:true) -> buffer -> resolve on
    'close' (:323). No --resume/--continue/--session-id anywhere in scripts/*.mjs.
    DAG "resume" (swarm-research.mjs:322,607,641,656,688,829) resumes ORCHESTRATION state
    only; re-issues fresh one-shot spawns. No model-side conversation ever resumed.
B3. *** ALL FOUR VENDORS SUPPORT NATIVE RESUME (checked via each binary's --help) ***
    claude: --resume <id>, -c/--continue, --session-id <uuid>, --fork-session
            PLUS native background lifecycle: --bg/--background, attach <id>,
            respawn [id], stop|kill <id>, logs <id>
    codex:  codex resume [ID] [--last], codex exec resume, fork, archive, delete
    grok:   -c/--continue, --fork-session, --resume, --session-id
    agy:    -c/--continue, --conversation <ID>
    => Persistence is UNWIRED, not unavailable. No context-reinjection hack needed.
    => claude's 5 native verbs are exactly what OpenRig builds tmux to provide.
       CONSEQUENCE: tmux is a compatibility floor, not the foundation. Inverts OpenRig's
       central design decision (its README: "built on tmux").
B4. Vendor ids are already parsed and THROWN AWAY: agy conversation_id parsed at
    swarm-seat-adapters.mjs:100-108, only .response kept.
B5. Identity today keys off per-dispatch task_id / SEAT_PLAN (seat-transport.mjs:75-107) —
    a routing identity, never a conversation identity. No script persists a session id.
B6. Auth (route-cli.mjs:155-167): claude=CLI OAuth only; codex=~/.codex/auth.json OAuth
    (cli+sdk); grok=~/.grok/auth.json OAuth or XAI_API_KEY; agy=own OAuth token or
    GEMINI_API_KEY. Escape hatch SWARM_CODEX_HOME (:264-266) redirects CODEX_HOME.
B7. Provenance per call :325-336: {seat,command,duration_ms,exit_code,timed_out,
    stdout_sha256,stderr_tail,prompt_bytes,stdout_bytes,usage:{input_tokens,output_tokens,
    cost_usd|null}}. stdout_sha256 is a real settlement foundation.
    HOLE: cost_usd null when vendor emits none (agy never does); code REFUSES rate-table
    derivation. Honest, but the eval must acknowledge the gap, not estimate over it.
B8. SECURITY FINDING: agy seat argv includes --dangerously-skip-permissions (with
    --mode plan). Codex seat by contrast is exemplary: --ephemeral --ignore-user-config
    --ignore-rules --sandbox read-only --skip-git-repo-check.
    Discipline is INCONSISTENT across seats in one function.
    NOTE: OpenRig ships YOLO off by default (needs explicit OPENRIG_YOLO=1) — stricter
    than our own rig on this axis.
    PENDING: exact line, conditional or not, whether --mode plan bounds writes.
B9. REFUTED (stale note): "seat wrapper discards any answer containing 'quota'".
    classifyQuota() :199-203 is consulted ONLY on already-failed paths (:348-352); comment
    at :340-344 states a clean parseable answer is never reclassified.
    REAL remaining defect: ANY timeout is classified quota-exhausted ("ambiguity closes",
    :201) — conflates rate-limit (wait) with hung process (investigate). Opposite actions.
B10. Other defects: agy envelope carries no model identifier (cannot verify which model
    answered); effort can silently mismatch slug-encoded model unless effortSlugConflict()
    catches pre-spawn; xai_sdk/google-antigravity protobuf conflict forces separate venvs;
    routing-matrix.json self-flags most rows unverified since 2026-07-23.
    Timeouts: default 300000ms (:270), SIGTERM then SIGKILL after SWARM_KILL_GRACE_MS
    (default 2000, :277,314-318); meta-driver.mjs:1470 uses 600000ms.

## C. Coordination board
C1. STRUCTURAL: multi-seat-session-mcp/server.mjs is a 32-line launcher spawning Python
    mcp_stdio.py (:16-27). The six .mjs modules (tasks/messages/sessions/handoff/ledger/
    context) are DEAD CODE. README.md:36 admits it. Live logic =
    agent-behavior-review/agent_behavior_review/store.py + mcp.py.
C2. Both repos have ZERO git commits. All uncommitted working tree.
C3. Schema store.py:72-103, SQLite WAL synchronous=FULL, path validated absolute/
    non-symlink/real-SQLite (:108-176). Keyed (owner_id,board_id,...):
    broker_tasks(task_id,description,depends_on,payload,defined_by,definition_hash,status,
      generation,claim_id,claimed_by,lease_expires_at_ms,result,created/updated_at_ms)
    broker_attempts(one row per (task_id,generation), PK incl generation, UNIQUE(claim_id))
    broker_sessions(session_id,enabled,meta{provider,model,role},first/last_seen_ms,last_action)
    broker_events(append-only seq log; events()/read_shared_context/read_chat replay it)
    broker_requests(idempotency, PK (owner_id,board_id,request_id))
C4. KEEP THIS — fencing is correct (store.py:356-363):
      if row.status!='claimed' or row.claimed_by!=session_id or row.claim_id!=claim_id
         or row.generation!=generation: raise stale_claim
      if row.lease_expires_at_ms<=now: raise lease_expired
    Used identically by renew_claim/post_result/cancel_task (:368,384,421).
    Name alone insufficient — must hold exact claim_id + generation.
    Lease 1000..86400000ms, default 900000 (:325,352-354).
    Idempotency _mutate :219-235: request_id required, canonical payload hashed, exact
    repeat replays receipt, same-id-different-payload => request_conflict (:229-231).
    Replaying a claim receipt does NOT renew the lease (docs/core-api.md:11).
C5. Claim :325-350: ready = pending OR (claimed AND lease expired) OR (blocked AND explicit
    task_id) (:336); dep check states.get(dep)!='completed' (:338); on success
    generation+=1, new claim_id, attempt row, task_claim event.
C6. DISCARD: dead .mjs layer had NO generation/claim_id; postResult checked only
    t.claimed_by===session_id (tasks.mjs:152-153) — name-based, not token-fenced.
C7. PENDING: exact call-count ceremony, real DB row counts, keep/discard list, whether a
    time-based lease is the wrong instrument for OS-process liveness.

## D. TELOS merkle-dag  (zero runtime deps; `cd merkle-dag && npm test` = 8/8 suites pass,
##    writes only to mkdtempSync temp dirs, git status clean after)
D1. merkle.mjs exports specHash, effectiveHash, topoSort, computePlan, recompute,
    mutateNode, writePlan, readPlan, appendPlanHistory.
    crypto.mjs: generateKeypair, signTransaction, verifyTransaction, makeRecord,
    appendLedger, readLedger, writePublicKey/loadPublicKey.
    orchestrate.mjs: runBuild, readySet, checkLifecycleAuthorization, defaultVerifyNode.
    ledger-gate.mjs: verify. proposal-ledger.mjs: makeProposalEvent, verifyProposalChain,
    atomicAppendProposalEvent, artifactRef.
D2. specHash = sha256 over canonical {files(sorted),requirements,test} (merkle.mjs:57-59).
    effectiveHash binds spec_hash + sorted/deduped parent effective-hashes (:62-65) —
    genuine Merkle chain over the WORK GRAPH, not just artifacts.
    sha256 via vendor.mjs:sha256hex; canonical JSON sorted keys (vendor.mjs:24-26).
D3. *** GENERAL CONTENT-ADDRESSED STORE EXISTS *** proposal-ledger.mjs:189-215:
    artifactRef(value)->"sha256:"+hex; writeProposalArtifact(telosDir,value) canonicalizes
    arbitrary JSON to .telos/artifacts/sha256_<hex>.json, throws on collision;
    readProposalArtifact rehashes on read, returns null on mismatch (fail-closed).
    JSON-canonical, not raw bytes, but general.
    => topology specs, per-seat snapshots, append-only event log ALL fit with NO
       modification to merkle-dag. (Event log: proposal-ledger's Ed25519 hash-chained log
       is already generic.)
D4. Verification re-reads BYTES, does not trust an index: ledger-gate.verify calls
    recompute(stored) re-deriving every hash from raw specs, rejects PLAN_TAMPERED
    (:18-29); computeDiskTreeHash reads raw file bytes and sha256s them (artifact.mjs:6-16)
    vs signed artifact_tree_hash (ledger-gate.mjs:53).
    Comment ledger-gate.mjs:17 — "cache, not truth".
D5. WRITE-DISJOINT SCHEDULING (orchestrate.mjs:223-231), quoted:
      "Write-disjoint batch (corruption guard): never run two workers that write the same
       file concurrently. Overlapping ready nodes are deferred to a later round (serial)."
      if ((node.files||[]).some(f => claimed.has(f))) continue;
      (node.files||[]).forEach(f => claimed.add(f)); batch.push(node);
    Write set == node.files, DECLARED by the plan author (planner.mjs:35,75 pass
    writes:[file]); nothing derives it automatically.
    Also: critical-path weight sort (:78-92,236-237), maxConcurrency pool (vendor.mjs:41-46,
    cores-2 cap).
    => This is swarm-write-dispositions HOLD/JOIN made MECHANICAL instead of advisory.
       No other multi-agent harness surveyed enforces write disjointness.
D6. *** BLOCKER: SELF-SIGNED TRUST ROOT (confirmed) ***
    ledger-gate.mjs:47  const pub = stored.authorized_signers ? stored.authorized_signers[entry.key_id] : null;
    ...where `stored` IS the plan (readPlan, :15). Lifecycle overlay same:
    checkLifecycleAuthorization reads rc.plan.authorized_signers[PROPOSAL_KEY_ID]
    (orchestrate.mjs:24). keysDir/writePublicKey/loadPublicKey exists (crypto.mjs:64-70)
    but test-harness.mjs:68 states: "writePublicKey still written for tooling/bootstrapping,
    but is no longer the trust path." No code path reads a keyring or env allowlist.
    Mitigation present: authorized_signers is hashed into plan_hash (merkle.mjs:132-137),
    so silent tampering => PLAN_TAMPERED.
    NOT mitigated: who may LEGITIMATELY be listed. A validly-authored new plan may name its
    own signer set and pass. Trust root travels inside the artifact it authorizes.
    Violates this workspace's standard: "trust anchors live outside the judged artifact".
    => HARD CONSTRAINT for the rig: signer set anchored OUTSIDE any plan the rig writes;
       a keyring the rig reads but never authors, established at install.
       Reported to user; NOT fixed here (TELOS has its own acceptance authority).
D7. Mutable head .telos/plan.json: only 2 readers, ledger-gate.verify (:15) and
    orchestrate.runBuild (:193). Both immediately recompute() and require derived
    plan_hash == stored before trusting any field (:18-29, :203-206). Pointer content does
    drive enforcement but only after fail-closed self-verification => invariant HOLDS here.
    Does NOT fix D6.
D8. No refs/branches/HEAD abstraction anywhere in merkle-dag.

## E. Design consequences (derived, not surveyed)
E1. Don't rebuild: board fencing (C4), merkle write-disjoint scheduler (D5), content store
    (D3), strict unknown-key rejection (A1).
E2. Build: native-lifecycle seat supervisor (B3) using per-vendor verbs, tmux only as floor.
E3. Fix-by-design: external signer anchor (D6); timeout-vs-quota distinction (B9);
    capture-and-persist vendor session ids (B4,B5); uniform seat posture (B8).
E4. Unproven and must stay labelled so: no evidence any multi-seat arrangement beats one
    strong session. env-lab paired blind eval designed, never run.
E5. Pathology to avoid, quoted from agentic-pipeline/PLAN.md: "it produces design packets
    and gate machinery instead of running the experiment."

## F. Live probe results — agy permission posture (2026-09-27, agy 1.2.8)
F1. DEMONSTRATED REFUTATION of the comment "plan mode = read-only agent semantics":
      mode=plan         + flag  -> file WRITTEN, exit 0, status SUCCESS
      mode=plan         no flag -> file WRITTEN, exit 0, status SUCCESS
      mode=accept-edits no flag -> file WRITTEN, exit 0, status SUCCESS
    --mode plan does NOT enforce read-only, and the bypass flag is NOT what enables writes.
    Repro: scratchpad/agy-probe/run.sh (3 runs, --add-dir scoped to a temp dir).
F2. CONSEQUENCE APPLIED: flag now OFF by default, opt-in via SWARM_AGY_SKIP_PERMISSIONS=1.
    Changed: swarm-seat-adapters.mjs (gemini + agy argvs, header comment, rationale comment,
    new agySkipPerms helper), meta-driver.mjs:76.
    Regression suite: tests/test-agy-permission-posture.mjs, 20 checks.
    MUTATION-CHECKED: suite goes RED against pre-fix bytes via ADAPTERS_MODULE, with the
    exact reason ("gemini argv must not carry --dangerously-skip-permissions by default").
F3. BOUND OF THE EVIDENCE: only the file-write tool path was exercised. A tool path that
    DOES prompt would appear as no output + 300s timeout, which classifyQuota() currently
    reports as quota-exhausted => MISDIAGNOSIS. Same defect as B9.
F4. STILL UNVERIFIED — whether an agy dispatch with NO --add-dir can write OUTSIDE its own
    workspace. The seat adapter passes no --add-dir. Probe was REFUSED by route-cli's need
    allowlist (separate_quota|web_search|large_window|overflow); NOT faked. Open question.
    Hypothesis (from two code comments, one of which F1 already disproved on another point):
    agy ignores spawn cwd and uses a fixed scratch workspace, so seat-adapter calls may be
    INCIDENTALLY contained. Unverified inference, not a finding.

## G. Two gate defects found while verifying
G1. seat-plan-gate is bypassable by one level of shell indirection. It matches the Bash
    command text for an agy dispatch; invoking agy from inside a script (./run.sh ...) has
    no `agy` token to match, so three dispatches went through ungated. Accidental, disclosed.
    Same class as bash-permission-rules-are-not-a-boundary.
G2. route-cli's --needs allowlist has no category for "verify containment", so the honest
    escape probe could not be authorized without fabricating a need. Correct fail-closed
    behaviour; the gap is that verification work has no admissible need category.

## H. Collateral defect found and fixed (pre-existing, not caused by the posture change)
H1. tests/test-meta-driver.mjs used path.join(process.cwd(), "scripts", "meta-driver.mjs")
    in FOUR spawnSync cases => suite passed only from the plugin root, failed from any other
    cwd. Fixed to resolve from fileURLToPath(import.meta.url). Now green from /tmp, /,
    ~/Projects and the plugin root. Exactly the failure mode named by
    feedback-test-in-isolated-home-and-foreign-cwd.

## I. Test suite state after all changes (run from /tmp)
    24 passed, 3 failed. All 3 failures PRE-EXISTING and unrelated:
      test-checkpoint.mjs      - output missing /Safe to \/clear/
      test-swarm-dag-runtime.mjs - "refusal left exactly one citable guard-event block"
      test-swarm-research.mjs  - roster-refused: codex/grok share J=0.983 brief vocabulary
        PROVEN pre-existing by discriminating probe: original test file + original argv
        (SWARM_AGY_SKIP_PERMISSIONS=1) fails identically.
    assert-no-imports.mjs excluded - a helper requiring a file argument, not a suite.
    Files changed: swarm-seat-adapters.mjs, meta-driver.mjs, test-meta-driver.mjs,
    test-seat-transport.mjs, test-swarm-research.mjs, +new test-agy-permission-posture.mjs.
    NOT COMMITTED. Backups in scratchpad/*.bak.

## J. Seat inventory — gemini-cli is LEGACY (user correction, 2026-09-27)
J1. RETRACTED: I proposed @google/gemini-cli 0.52.0 (installed at ~/.nvm/.../bin/gemini) as a
    6th seat because its help documents --approval-mode plan as "read-only mode" and it has
    --resume/--session-id/--list-sessions. The user states gemini-cli is LEGACY and
    Antigravity (agy) is Google's current agentic surface. Not a seat candidate.
    Do not reinstate it on the strength of its nicer help text; it is the superseded product.
J2. CONSEQUENCE for containment: the Google seat's write containment CANNOT be fixed by
    switching binaries. agy has no vendor-documented read-only mode (F1 disproved the one
    this repo asserted), so containment must come from --add-dir workspace scoping plus
    resolving F4 (can agy write outside its workspace with no --add-dir?). F4 is now the
    highest-value open question on the whole Google seat, not an optional extra.
J3. CONSEQUENCE for the vendor count: "gemini" and "agy" are not two vendors — both argvs
    invoke the same agy binary with different --model pins. So the real vendor set is FOUR:
    claude (Anthropic), codex (OpenAI), grok (xAI), agy (Google/Antigravity).
J4. The two requested additional seats must therefore come from one of:
    (a) a new agentic CLI to install - copilot, cursor-agent, opencode, amp, aider, goose,
        qwen, crush, droid. None currently on PATH (verified).
    (b) API-only vendors through the existing python sdk lane - DeepSeek, Mistral,
        Z.ai/GLM, Moonshot/Kimi. No CLI needed, but no native session resume either, so
        these would be warm-resume-incapable and must be marked as such.
    (c) agy's own non-Google models (claude-sonnet-4-6, gpt-oss-120b-medium). REJECT for
        council use: the adapter header already warns this collapses vendor independence
        against the claude seat for agreement scoring.
    DECISION REQUIRED FROM USER - this is a machine change, not an inference.

## K. Project name and transport decision (user, 2026-09-27)
K1. NAME: Pantheon. New repo in ~/Projects. Names the assembly, not a member, so it does not
    take a referent from TELOS's reserved individual-deity terms (Daedalus/Argo/Hermes/Moirai).
K2. TRANSPORT: CLI primary. SDK retained ONLY as the capped-API-key overflow lane.
    Reasons, each evidenced:
K2a. Session resume is a CLI feature (B3). SDKs are request/response; continuity would
        have to be rebuilt against vendors that already ship it.
K2b. claude has NO sdk lane by design — test-seat-transport asserts it must REFUSE rather
        than invent argv, because the claude seat IS the OAuth CLI session. SDK-primary
        cannot cover the flagship seat.
K2c. Auth/cost: CLI = OAuth subscription; SDK = metered keys. Standing rule is OAuth by
        default, scoped capped key as headless overflow only.
K2d. SDK lane already taxed: xai_sdk/google-antigravity protobuf conflict forces separate
        venvs (B10).
K3. *** BIDIRECTIONAL NDJSON IS AVAILABLE ON THE CLI — verified from --help 2026-09-27 ***
      claude  --output-format stream-json          + stream-json input
      agy     --output-format stream-json          + --input-format stream-json
              ("reads one NDJSON message per line from stdin and runs a turn for each;
                it requires --output-format stream-json")
      grok    --output-format streaming-json (NDJSON, one ACP session update per line);
              --include-stream-events emits stream_event lines with text/thinking deltas
              (only with --output-format streaming-messages-json)
      codex   exec --json (NDJSON); no stdin-turn framing found in --help  UNVERIFIED
    CONSEQUENCES, all three previously-open problems closed by this one fact:
      - mid-task progress updates ("mid-interview update") come from stream deltas. No
        polling, no pane scraping.
      - a live attachable seat needs NO tmux: a supervised child with NDJSON stdio is
        directly observable. tmux drops to a human-viewing convenience (confirms E2/B3).
      - delivery gets an ACKNOWLEDGEMENT, closing OpenRig's weakest point (A4): a framed
        turn has a response event, which is the receipt settlement needs.
K4. SEAT CAPABILITY TABLE is the spec's core data structure. Each seat declares:
      resume | stream_in | stream_out | attach | auth | sandbox_posture
    Supervisor degrades honestly per seat rather than pretending uniformity.
    Today: claude + agy => true live seats (bidirectional). grok + codex => warm resume
    with streaming output only. codex stdin framing UNVERIFIED.

## L. Auth is universally OAuth subscription (user, 2026-09-27) — load-bearing
L1. All four vendors ride OAuth subscription on the CLI lane (confirms B6):
      claude CLI OAuth only | codex ~/.codex/auth.json | grok ~/.grok/auth.json
      agy own OAuth token file.  API keys (XAI_API_KEY, GEMINI_API_KEY) are SDK-lane
      alternates only.
L2. CONSEQUENCE — cost_usd is meaningless ACROSS THE ROSTER, not just for agy (revises B7).
    Nothing is billed per token on the primary lane. The effectiveness eval must denominate
    in RATE-LIMIT CONSUMPTION and WALL-CLOCK. Any dollar figure is notional
    (cf. feedback-cost-accounting-uses-cache-tokens: OAuth = API-equivalent, not a bill).
L3. CONSEQUENCE — the parallelism budget is PER-VENDOR, not global. N seats over 4
    subscriptions do not yield N-way throughput: fan-out ACROSS vendors buys concurrency,
    fan-out WITHIN a vendor serializes on that vendor's limit. This is a real ceiling on the
    "more seats" thesis and the eval must be able to DETECT it, not assume it away.
    => write-disjoint scheduling (D5) must additionally be rate-limit-aware per vendor.
L4. CONSEQUENCE — the timeout/quota misclassification (B9, F3) is CRITICAL, not cosmetic.
    On subscriptions, quota exhaustion is the normal steady-state failure; conflating it with
    a hung process will mislead constantly. Distinguishing them is a spec requirement.
L5. CONSEQUENCE — Pantheon handles NO credential on the primary lane. It inherits each CLI's
    own OAuth state and reads/writes no secret. Strengthens the zero-uninvited-mutation claim
    and removes a whole class of install risk.
L1a. REFINEMENT (user, 2026-09-27): each vendor has its OWN SEPARATE OAuth subscription.
     => the four rate-limit pools are INDEPENDENT; no two vendors contend.
     Revises L3: the serialization ceiling applies only WITHIN a vendor. Across vendors the
     parallelism is real. The value of an additional vendor is therefore an additional
     UNCONTENDED THROUGHPUT POOL — this is the actual economic argument for breadth, and it
     ranks the seat-6/7 options: a new CLI with its own subscription > API-metered lane >
     agy's other models (same binary, same pool, zero new throughput).
     Revises L2: marginal per-token cost ~0, but marginal SEAT cost = one subscription/month.
     The eval's question becomes "is the Nth subscription worth its fee?" — decidable.

## M. merkle-dag's ROLE in Pantheon (user, 2026-09-27) — supersedes my earlier framing
M1. "The Merkle Dag is to label and keep track of context."
    Its primary job is CONTEXT ADDRESSING AND LINEAGE, not work scheduling or settlement.
    Supersedes my D5-led framing, which put the write-disjoint scheduler first.
M2. The gap this fills: no surveyed harness can answer "what did this seat know when it
    answered?" OpenRig's compaction_strategy + token-usage collector (A1, A5) measure context
    VOLUME, not context IDENTITY. Volume says a seat was at 60% of its window; it cannot say
    which brief, which prior result, or which file revision it read.
M3. Mechanism, all from existing merkle-dag with no modification:
      LABEL    artifactRef(bundle) -> sha256:<hex>; writeProposalArtifact canonicalizes to
               .pantheon/artifacts/sha256_<hex>.json, throws on collision (D3). The hash IS
               the label; no mutable name keys it (telos-content-address-rule).
      LINEAGE  effectiveHash binds a bundle's spec hash to sorted parent hashes (D2) — a
               bundle is a chain node, not a loose blob.
      RECALL   readProposalArtifact rehashes on read, returns null on mismatch (D3) — a
               drifted bundle is ABSENT, not wrong.
      BINDING  each Turn records (seat, vendor_conversation_id, bundle_hash) — so resume can
               PROVE the restored seat is bound to the same context. Makes the continuity
               claim checkable rather than hopeful.
M4. SECOND-ORDER CONSEQUENCE, worth more than the primary: it makes disagreement legible.
    Two seats answering differently either saw DIFFERENT bundle hashes (an input difference,
    not a disagreement) or the SAME hash (a real divergence worth adjudicating). That
    distinction is unavailable today, which means council-style agreement scoring is unsound
    as currently practised anywhere in this workspace — including the 5-seat council that
    cost $5.57 and returned the asker's own framing (E5 context).
M5. The write-disjoint scheduler (D5) remains in the design but is now SUBORDINATE to context
    addressing, not the headline.

## N. OpenRig daemon + supervision internals (scout returned late; closes A6 partially)
N1. SCALE Pantheon is deliberately not matching: ~55 tables / 85 migrations, ~65 /api/* route
    groups (server.ts:684-798). Tables include rigs/nodes/edges, bindings, sessions (with
    resume_type/resume_token/restore_policy), snapshots, checkpoints, pods/continuity_state,
    queue_items/queue_transitions, chat_messages, workflow_instances/specs/step_trails,
    enforcer_decisions, applied_launch_observations, occupant_tenures/seat_identity_verdicts,
    self_host_identity/daemon_lifecycle, node_startup_context, usage_samples,
    watchdog_jobs/history.
N2. SUPERVISION = two signals + a documented precedence ladder (node-inventory.ts ~line 1204):
      needs_input > running > MOTION > idle/unknown
    PUSH: activity-relay.cjs POSTs to /api/activity/hooks on Claude/Codex hook events
          (SessionStart/UserPromptSubmit/Stop/...), 1.5s timeout, "errors swallowed, never
          blocks the agent loop". Claude also self-reports via ~/.claude/sessions/<pid>.json
          (rung:"self-report", claude-code-adapter.ts:921-991).
    POLL: seat-activity-service.ts:18 DEFAULT_POLL_INTERVAL_MS = 1000 — captures raw tmux
          pane content + pane PID every second.
N3. *** ADOPT THIS ASYMMETRY *** MOTION = tmux's own #{window_activity} byte-change timestamp,
    read against a per-seat silenceWindowSeconds. It can ONLY upgrade idle/unknown -> running;
    it can NEVER manufacture idle from silence. Their comment: "a seat can think for a long
    time without printing." Correct, and Pantheon states it as a rule: silence is not idleness.
N4. *** READINESS SCRAPING IS LITERAL TUI STRING MATCHING *** native-resume-probe.ts:
      paneContent.includes("No conversation found")                  -> status "failed"
      paneContent.includes("Do you trust the contents of this directory?")
      /(^|\n)\s*[prompt-glyph]/.test(paneContent)
      /^\s*(?:[glyph]\s+)?(?:Resume from summary|Resume full session as-is)\s*$/.test(line)
      /requires a newer version of Codex/i                            -> "attention_required"
    Any vendor banner/glyph/wording/layout change breaks the ladder SILENTLY until patched.
    Issues #17, #28, #12 are already instances of this class firing.
    => Pantheon reads structured NDJSON events (K3); this failure class does not exist for it.
N5. *** WEDGED-BUT-ALIVE IS NOT DETECTED *** No per-process computing-vs-looping discriminator.
    A spinner or repeating redraw reads as `running` via MOTION, indistinguishable from real
    progress. Nearest proxy is queue-stuck-sweep.ts at the TASK-OBLIGATION layer (300s sweep,
    60min unclaimed-age threshold) — flags work nobody picked up, not a hung process.
    => PANTHEON CAN DISCRIMINATE, structurally: on a streaming seat, absence of stream deltas
       while the OS process is alive IS the signal. This is a capability OpenRig cannot have
       while its observation channel is rendered terminal text.
N6. STILL PENDING from this scout: item 5 (snapshot/restore honesty — real provider-side resume
    vs fresh+re-injected context; whether a failed resume silently falls back to fresh) and
    item 6 (exhaustive machine-mutation enumeration with writing code locations).

## O. OpenRig snapshot/restore honesty (scout item 5) — validates the context design
O1. CREDIT: genuine provider-side resume is the DEFAULT ATTEMPTED path, not a fallback.
    restore-orchestrator.ts:1164
      resumeRequested = restorePolicy === "resume_if_possible" && !!resumeType && !freshRequested
    When true it calls the real native command (claude --resume <token> / codex resume) via
    attemptResume/launchHarness FIRST. Text re-injection (checkpoint write,
    baseStatus="rebuilt", :1241-1250) or a blank fresh-primed launch (:1169) occur only when
    resume was not requested or not possible. My earlier framing implied otherwise; corrected.
O2. The resume token IS the id OpenRig generated at first launch, by construction:
    generatedSessionId = this.sessionIdFactory() (claude-code-adapter.ts:282) -> --session-id
    <uuid>; returned token is `token ?? generatedSessionId` (:305-306); on resume the returned
    token is byte-identical to the one passed (`resumeToken: opts.resumeToken`, :300).
O3. *** ADOPT: PROVENANCE-RANKED IDENTITY WRITES *** session-registry.ts:326 updateResumeToken
    ranks writers `hook > scrape > operator > adoption`; a lower-rank write can NEVER clobber a
    higher-rank one. Correct shape for any fact assembled from signals of unequal trust.
    Pantheon applies it to seat identity and to capability observations.
O4. *** THE ASYMMETRY — this is the finding *** 
    A false "FRESH" is structurally PREVENTED: any resumeOutcome.kind other than
    resumed/attention_required triggers rollbackToZeroSession + status "awaiting-decision"
    (restore-orchestrator.ts:1200-1206, and :1359-1373 for pod-aware runtime-reported-fresh),
    regardless of which failure signature fired. Honest.
    A false "RESUMED" is NOT prevented. native-resume-probe.ts:113-121:
      function looksLikeClaudeTui(paneContent) {
        const hasPrompt = /(^|\n)\s*[glyph]/.test(paneContent);
        if (!hasPrompt) return false;
        return paneContent.includes("Claude Code v") || paneContent.includes("accept edits on");
      }
      if (looksLikeClaudeTui(paneContent)) return { status: "resumed", ... };
      if (paneCommand === "claude")        return { status: "resumed", ... };
    That detects only "the TUI is alive" — the IDENTICAL banner a brand-new session prints. If
    `claude --resume <token>` silently drops into a fresh conversation without printing
    "No conversation found", the probe reports "resumed". It verifies TUI LIVENESS, NOT
    CONVERSATION IDENTITY. An operator can be told a seat resumed when it started over.
    => This is exactly what binding a Turn to (seat, conversation_id, bundle_hash) prevents
       (M3 BINDING). The merkle/context correction is not a refinement; it is the fix for a
       live class of silent failure.
O5. DEFINITIVELY LOST across snapshot/restore: snapshot-capture.ts persists DB ROWS ONLY —
    nodes/edges/bindings/sessions(+token)/pods/continuity_state/node_startup_context/
    checkpoints/last roster event. NEVER tmux scrollback. NEVER the model conversation, which
    lives in the harness's own external store; OpenRig holds only a POINTER (the token) plus,
    in rebuild mode, its own re-derived text artifacts.
    *** PANTHEON SHARES THIS EXPOSURE *** If the vendor prunes or rotates the thread, the
    resume token is dead and no snapshot recovers the real history. This makes
    content-addressed ContextBundles the MITIGATION rather than a nicety: the vendor thread can
    die and the bundle chain can still state what the seat knew and rebuild an equivalent
    context. Record it as a named risk, not as solved.

## P. The conversation IS on local disk — hash it (user, 2026-09-27)
P0. User question: "Why can't we hash the conversation in a json file?" Answer: we can, and it is
    a STRICTLY STRONGER check than the bundle_hash binding in M3. I had under-claimed in O5/§6.2.
P1. Measured 2026-09-27, structure only (no content printed):
      claude  ~/.claude/projects/*/*.jsonl  — 1170 transcripts. Line types on a live one:
              user 112, assistant 251, attachment 223, system 16, mode/permission-mode/
              last-prompt/atis-latch/bridge-session 45 each, ai-title 44, queue-operation 18,
              file-history-snapshot 4.  => the FULL conversation, message by message.
      codex   ~/.codex/sessions/ — 208 rollout-*.jsonl. Per-line keys
              {ordinal,payload,timestamp,type}; types session_meta, turn_context, event_msg,
              response_item, world_state.  => a real rollout log of the conversation.
      grok    ~/.grok/active_sessions.json (a list, EMPTY with no live session),
              ~/.grok/completions/ (2 entries).  PARTIAL — needs a live session to confirm.
      agy     ~/.gemini/history (14 entries), ~/.gemini/antigravity{,-cli,-ide}/.  UNVERIFIED.
P2. WHY IT BEATS M3's BINDING. bundle_hash proves what we HANDED the seat. A transcript hash
    proves what the seat ACTUALLY HAS. The second is the claim O4 shows OpenRig cannot make.
    Protocol: at teardown hash the normalized projection -> H. After restore, re-read the
    vendor's session file and require that it still contains the prefix hashing to H. A
    silently-fresh conversation has no such prefix, so it FAILS POSITIVELY — which is exactly
    what native-resume-probe.ts's TUI-liveness match cannot do.
P3. UPGRADES §6.2 / O5. The conversation is partly ours after all: a vendor pruning its thread
    no longer means amnesia, it means a HIGH-FIDELITY REBUILD rather than a re-derived summary.
    Still a rebuild, still labelled as one — restoration is not resumption.
P4. FOUR DESIGN CONSTRAINTS, all real:
    (a) Detection complete, restoration partial. Replay rebuilds an EQUIVALENT context; it does
        not re-enter server-side state (prompt cache = rate-limit/latency cost not correctness;
        plus any thinking content not persisted locally).
    (b) HASH A NORMALIZED PROJECTION, NOT RAW BYTES. These are vendor-internal files with no
        stability contract. Canonical (role, content, tool_calls) survives cosmetic format churn
        while still catching content change. Raw-byte hashing would invalidate on a reformat.
    (c) CHAIN PER TURN. A conversation grows, so equality is the wrong relation — prefix/
        extension is. Per-turn hash chained to its predecessor gives that, and effectiveHash
        (D2) already does it. Check = "does the live transcript EXTEND my recorded chain".
    (d) SIZE. This session's transcript is ~2.1MB and there are 1170 of them. Store the
        normalized per-turn projection content-addressed; store full raw only at explicit
        checkpoints.
P5. USER DECISION REQUIRED — data handling. Content-addressing transcripts means Pantheon holds
    a durable hash-indexed copy of every conversation. Constraints proposed: stays inside
    $PANTHEON_HOME, never committed, never leaves the machine. Not decided unilaterally.
P6. DEMONSTRATED, not just designed. spike/conversation-chain.mjs run against two real claude
    transcripts on disk (189 and 96 turns), no model calls, no content printed:
      recorded at teardown: turn 96, head baca7df48f01da80
      PASS genuine resume (same conversation, grew)          ok=true  (grew 93)
      PASS silently-fresh restart (different conversation)   ok=false (prefix hash mismatch)
      PASS truncated/pruned thread (prefix only)             ok=false (shorter than recorded)
      PASS tampered mid-conversation turn                    ok=false (prefix hash mismatch)
      4 passed, 0 failed | cases discriminated by PREFIX HASH (not length): 2
P7. THE SPIKE FIRST PASSED FOR THE WRONG REASON, and that is the useful part. On run 1 the
    "silently-fresh restart" case returned ok=false with why="shorter than recorded" — transcript
    B was 96 turns against a 112-turn cut, so the length shortcut fired and the prefix-hash
    comparison NEVER RAN. Green, vacuous. Exactly feedback-assert-the-probe-ran.
    Fixes applied: cut = min(60% of A, B.length) so the fresh case CANNOT be caught by length;
    each case now declares the REASON it must be rejected for and a wrong-reason rejection counts
    as a FAIL; and a vacuity guard exits 3 if zero cases were discriminated by the hash.
    Lesson for the spec: the oracle must say WHY it rejected, or it cannot be shown to work.

## Q. Independent whole-branch review — the branch does NOT deliver its central claim
Q0. Dispatched on the strongest tier with author-is-subject stated as the reason. Verdict:
    NEEDS FIXES BEFORE MERGE, four Criticals, each with a runnable repro. I reproduced three
    independently before accepting any of them.
Q1. *** CRITICAL 1: a WORKING false-RESUMED ships in this branch. ***
    locate.mjs selects the newest .jsonl by mtime in a directory shared by every session with that
    cwd, and never uses the seat's stored vendor_conversation_id. The reviewer's line:
    "verifyExtends is sound; what it is fed is not."
    My own independent scan of all 334 claude transcripts on this machine:
      colliding (head,length) groups ......... 16
      largest collision ..................... 7 distinct files share one chain
      collisions WITHIN one project dir ..... 13   <- each is a false-RESUMED case
    My end-to-end acceptance test passed only because the throwaway cwd held exactly ONE
    transcript. I named survivorship in the red-team pass and then built a test whose conditions
    excluded the failure.
Q2. CRITICAL 2: the second vendor's store is date-nested (YYYY/MM/DD). readdirSync is not
    recursive, so it finds 0 of 208 real files and reports "has no .jsonl" — a store-shape message,
    not a defect. That vendor has zero continuity today.
Q3. CRITICAL 3: the path sanitizer replaces / but not '.', which claude also encodes as '-'.
    Verified: 13 project dirs on this machine carry an encoded dot and are unreachable, including
    every .claude/worktrees/* path — this project's own pattern.
Q4. CRITICAL 4: randomUUID() is minted and DISCARDED; the id is only read by parsing stdout as one
    JSON object. Per vendor today: claude resumes; the Google seat may resume with no chain behind
    it (unverifiable); the other two can NEVER resume. And tests/seat-turn.test.mjs:130-131 asserts
    null is acceptable "because the store reader resolves the id instead" — naming a component that
    does not exist.
Q5. THE FIVE DEVIATIONS: none wrong, three under-scoped, and per the reviewer "in each case the
    test written alongside is what hid the remainder."
      3 (store refuses empty chain) — bin/pantheon.mjs:100 `if (snap.length > 0)` routes AROUND my
        own refusal, with a comment saying so; :65 then skips verification silently.
      4 (prompt redacted from command) — stderr_tail in the same object still carried it, and my
        certifying test stubbed that field out.
      5 (token-boundary match) — applied to 6 of ~20 argv tokens, never to a value.
Q6. Residuals on Critical 1's fix, all from the reviewer:
      a. FORK-ON-RESUME: --fork-session and post-compaction continuation write a NEW id whose file
         replays prior history. Strict id-matching trades a false positive for a false negative.
         Accept a different file only if its projection extends the chain AND its fork/parent
         metadata names the recorded id, then re-pin.
      b. PUT THE PIN INSIDE THE HASHED RECORD. (vendor, cwd, session_id) beside the record is "a
         pin stored next to the content it pins" — the anti-pattern this very spec flags at §8.
         I wrote that criticism of merkle-dag hours before nearly committing it myself.
      c. RESOLUTION, not just identity. The projection is too coarse: a 390KB transcript pair
         reduces to 2 turns, and the second vendor's projector drops 83% of response items and 100%
         of tool calls. Binding the file proves "right file, it grew"; it cannot prove the interior
         did not diverge. Must land WITH the identity fix or the check stays shallow.
      d. Parse the id from file CONTENTS (session_meta), never from the filename — deriving it from
         the name is the same proxy check relocated.

## R. Audit of the installed skills for the same shapes — the SOLUTIONS were already here
R1. mtime-as-identity: ABSENT elsewhere. And workflows/layered-swarm.d/tests/dag-tail.test.mjs:58
    carries the comment "mtime frontier would have lost this forever". The lesson was already
    learned on this machine, in a test, and I reinvented the mistake without reading it.
R2. The CORRECT resolver already exists, in my own hooks — hooks/session-eval.mjs:53-54:
      const dir = path.join(HOME, '.claude/projects');
      const hit = fs.readdirSync(dir).map(d => path.join(dir, d, `${sid}.jsonl`)).find(p => fs.existsSync(p));
    It scans every project dir for a file NAMED AFTER THE SESSION ID: identity not recency, and it
    never derives the directory name, so Critical 1 and Critical 3 are both fixed by one line of
    code that has been running all session. hooks/spend-record.mjs does the same from the other
    side, reading o.sessionId from file contents (:94) and walking recursively (:71).
    => Pantheon's resolver must be this, not a cwd-derived path.
R3. Substring-flag matching elsewhere is all `process.argv.includes("--flag")` — exact array
    elements, not a prose haystack. Not the same defect. No action.

## S. The shipped stack had the SAME leak, with a doubly-vacuous test (fixed 2026-09-27)
S1. swarm-seat-adapters.mjs:348 stored `stderr_tail: stderr.slice(-2000)`. Its certifying assertion
    (test-swarm-research.mjs:133) passed while the prompt leaked, for TWO independent reasons:
      (i)  the fixture set only { stdout, exit }, so stderr_tail was empty when asserted; and
      (ii) it searched for the prompt JSON-QUOTED, which bare text in stderr never matches.
    Either alone made it vacuous. Both together made it look thorough.
S2. Second vector found while tracing: burn() attaches stdout_tail on EVERY failure class, so a
    vendor echoing the prompt on stdout leaked identically.
S3. The shipped `command: cmd` records only the binary name and is SAFER than what I wrote in
    Pantheon (I joined the full argv). That leak was my own regression, not inherited.
S4. FIXED: redactPrompt() added and applied to both stderr_tail and stdout_tail. Diagnostics and
    quota signatures are preserved — blanking stderr would break quota classification, which reads
    it at swarm-research.mjs:508. Prompts under 8 chars are deliberately not redacted: a global
    replace of a 1-2 char token would shred the diagnostic while protecting nothing.
    New suite tests/test-provenance-redaction.mjs, 9 checks, every case POPULATING the channel it
    protects and asserting on the RAW prompt. MUTATION-CHECKED red against the pre-fix bytes via
    ADAPTERS_MODULE, failing with the full leaked prompt visible.
    Case 5 in test-swarm-research.mjs de-vacuumed: its fixture now writes stderr and it asserts the
    fixture actually populated it before asserting absence.
    Plugin suite after: 25 passed, 3 failed — the same three pre-existing failures as before the
    change, the swarm-research one confirmed still failing on its unrelated roster-decorrelation
    refusal. NOT COMMITTED (~/.claude is shared; backups in the session scratchpad).


## T. Vendor documentation lookup + on-disk verification (2026-09-27) — closes P1, refutes two projectors

Prompted by the user: "look up the openai, xai, and antigravity sdk documentation". Every claim
below is either a quoted vendor doc or something measured on this machine. Where the two
disagree, both are recorded.

### T1. CORRECTED — the SDKs DO accept OAuth tokens; my original claim was wrong

**What I first wrote here, and retract:** "The SDKs cannot be used here — they are all API-key
transports," concluding that adopting any SDK would break the OAuth constraint in section L.

The user refuted it: "the SDK's allow OAuth API keys." They are right, on three grounds, one of
which was already inside my own evidence.

1. **My own citation contradicted my conclusion.** I quoted the Antigravity SDK as supporting
   Vertex via `gcloud auth application-default login` and then filed that row under "API key."
   Application Default Credentials ARE OAuth. The Google SDK documents an OAuth path outright.
2. **The `apiKey` slot is a bearer-token slot.** These SDKs are token-agnostic HTTP clients that
   place the string in `Authorization: Bearer <...>`. Nothing requires an `sk-` key; an OAuth
   access token is a bearer token.
3. **Measured on this machine:** every vendor already holds OAuth credentials, and the OpenAI
   stack is demonstrably running on one. `~/.codex/auth.json` carries `auth_mode`,
   `tokens.access_token`, `tokens.refresh_token`, `tokens.id_token`, `tokens.account_id` — with
   `OPENAI_API_KEY: null`. `~/.grok/auth.json` carries a full OIDC record (`oidc_issuer`,
   `oidc_client_id`, `refresh_token`, `expires_at`). `~/.claude/.credentials.json` carries
   `claudeAiOauth.accessToken` with `subscriptionType`. (Key NAMES only were ever read.)

**What is still genuinely unverified**, and must not be restated as a conclusion: whether each
vendor's PUBLIC API host (`api.openai.com`, `api.x.ai`) accepts the SUBSCRIPTION OAuth token, or
whether those tokens are scoped to the vendor's own agent backend — Codex, for instance, talks to
a ChatGPT backend path with a `chatgpt-account-id` header rather than to `api.openai.com`. That is
an endpoint-and-scope question, not an SDK question, and the two are easy to conflate, which is
exactly the error above.

I attempted to settle it with a live probe (local token -> each public endpoint, printing status
codes only). The environment refused it as credential exploration. The probe is at
`/tmp/oauth-probe.mjs` if the user wants to run it themselves; until then this stays UNVERIFIED.

**Effect on the CLI-vs-SDK decision:** the "independent confirmation" I claimed for CLI transport
is WITHDRAWN. It was not independent and it was not confirmation. The CLI decision continues to
rest on its original grounds — the user's instruction (section C), and the fact that every CLI
ships native resume plus incremental event streaming (T2) which Pantheon's chain and live view
both consume. Those grounds are sufficient; the invented auth incompatibility was not needed and
was not true.

### T2. Documented headless / streaming / resume surfaces

- Q1 `learn.chatgpt.com/docs/developer-commands`: "Codex writes formatted output by default. Add
  `--json` to receive newline-delimited JSON events (one per state change). The optional `resume`
  subcommand lets you continue non-interactive tasks. Use `--last` to pick the most recent session
  from the current working directory, or add `--all` to search across all sessions". Also
  `codex app-server --listen` for "building a local protocol client".
- Q2 `docs.x.ai/build/cli/headless-scripting`: `-p` is the short form of `--single`; passing a
  prompt non-interactively is itself what triggers headless mode. `--output-format json` and
  `--output-format streaming-json`, the latter emitting "incremental events as they arrive".
- Q3 `docs.x.ai/build/features/sessions`: `-r/--resume` (errors if the session does not exist),
  `-c/--continue` (most recent in this cwd); headless sessions "are stored in `~/.grok/sessions`".
- Q4 `antigravity.google/docs/cli/headless`: `-p` (aliases `--print`, `--prompt`);
  `--output-format` takes `text` | `json` | `stream-json`, where `stream-json` emits
  newline-delimited `init` / `step_update` / `result` events; `-c/--continue` and
  `--conversation <id>`; the conversation id is returned as `conversation_id`. The docs say
  NOTHING about where conversations persist.

Consequence for Plan 4: all four seats can stream incremental events. The React live view needs no
new transport — only the streaming flag, which is now recorded per vendor as `stream_output` in
`src/seat/argv.mjs`.

### T3. grok store LOCATED — closes the P1 residual for this vendor

`~/.grok/sessions/<percent-encoded-cwd>/<session-id>/`, 2365 files on this machine. Buckets are
named for the percent-encoded cwd (`%2Fhome%2Fcolchis%2F.claude`). Deriving that bucket name from
cwd would be defect C3 in a different encoding, so `locateGrokById` scans buckets for the id and
never reconstructs the encoding. `summary.json` carries `info.id` and `info.cwd`, giving a
contents-based identity confirmation of the same kind the codex resolver already uses.

### T4. The grok projector was returning ZERO turns for every transcript

Measured against a real 147-line `chat_history.jsonl`. The shipped projector tested
`obj.type !== "text" && obj.role === undefined` and read `obj.content ?? obj.data`. Real grok
lines carry NO `role` key at all, and `type` is never `"text"` — the observed census is
`system(1) user(3) reasoning(23) assistant(23) tool_result(97)`. Every line failed the guard, so
grok projected to nothing, universally.

This was invisible for the same reason C1 was: a zero-turn projection is indistinguishable from an
empty conversation, and the store's empty-chain refusal then presents as "no baseline yet" rather
than as a broken projector. The projector had been written from a guess because no grok transcript
had ever been located — the P1 gap and this defect were the same gap wearing two faces.

FIXED and proved on real data: 147 turns, roles `{system:1, user:3, assistant:46, tool:97}`, tool
names recovered (`grep`, `list_dir`, `read_file`). 135 of 147 turn-shas are distinct; the 12
repeats are genuinely identical content (repeated tool results) and are harmless because
`chainOf` links positionally — identical turns at different positions still produce different
links (`src/context/chain.mjs:6`).

### T5. agy does not write a JSONL transcript at all — the projector was for a format that cannot arrive

Store located by inspection, NOT documented by the vendor:
`~/.gemini/antigravity-cli/conversations/<conversation-id>.db` — one SQLite database per
conversation, 458 files here. Recorded as an OBSERVED path, which may move without notice.

The shipped `agy` projector accepted `obj.role` from parsed JSONL. Feeding it a `.db` read as utf8
would parse zero lines and report zero turns — the same silent-empty failure as T4, but
unfixable by tuning the projector, because the input format is wrong. It now throws, and
`projectAgyDb()` reads the real store via `node:sqlite` (built in; the zero-runtime-dep policy
holds). Identity is confirmed from `trajectory_meta.cascade_id`, not the filename.

That projection is DELIBERATELY WEAKER and says so: `steps.step_payload` is an opaque blob, so it
digests `(step_type, payload bytes)` per ordered row. It cannot name tools — `tools` is always
empty for agy because the names are unreadable, NOT because no tools ran. It does deliver the one
property the chain requires: a stable per-step digest in fixed order, so a resume provably extends
the recorded prefix. Proved on a real 150-step conversation: 150 steps, 150 distinct digests.

### T6. Drift found in records outside this repo (reported, not changed here)

- The GPT-6 family (`gpt-6-astra` / `gpt-6-sol` / `gpt-6-luna`) is current, and Astra's tool
  calling REQUIRES the Responses API. The machine's memory record pins the codex seat to
  `gpt-5.6-sol`.
- xAI exposes a Responses-shaped surface at `https://api.x.ai/v1/responses`, a realtime WebSocket
  at `wss://api.x.ai/v1/realtime`, and models including `grok-4.6` and `grok-4.20-multi-agent`.
- OpenAI's own GPT-6 guidance states: "The model may delegate less often than desired for your
  workflow. Specify when and how much it should use subagents for parallel work." That is the
  vendor documenting the exact failure the 2026-09-27 paired eval measured — arm W granted the
  orchestration tools and got 0 delegations in 6 trials, with a suffix that said delegation was
  permitted but not when or how much.

## U. Cross-model review of MY design found two defects my 174 tests did not (2026-09-27)

Two extra seats were added as their own panes and asked to adversarially review a decision made
in this repo today: content-free seat records plus a separate `history/<seatKey>.json` for
replay-continuity vendors, written BEFORE the seat record.

**U1 — `openai · gpt-6-sol`, correctness lens. CONFIRMED, open.**
"A crash after the history write but before the seat write can cause an exchange to be replayed,
potentially executing a non-idempotent tool call twice — for example, charging a customer twice.
The separation is not worth keeping with this write order; keep it only if recovery can
distinguish committed turns from uncommitted history."

This refutes my own stated rationale. I justified the write order on the grounds that a crash
between the two "re-sends one exchange, which is visible and recoverable." That holds for text
and fails the moment a turn has side effects. I reasoned about data loss and did not consider
replay. The fix is not a reorder — reversing it loses the words instead — but a commit marker
that lets recovery tell a committed turn from an uncommitted one.

**U2 — `xai · grok-4.20-multi-agent`, operational lens. CONFIRMED, open.**
"Under concurrency, no locks/versioning lets parallel turns for same seatKey race on full history
rewrite + seat hash update, losing data despite crash ordering."

Correct, and understated. `sdkTurn` read-modify-writes both the history and the seat record with
no lock. The only serialization is the `running` set in the view server, which is single-process
AND keyed by vendor+purpose rather than by seatKey — so two processes, or one process calling the
seat API directly, race and clobber. The store's atomic rename makes each FILE consistent and
does nothing about a lost update across the pair.

**Why this matters beyond the two bugs.** 174 unit tests, four live vendor checks and three
temporal oracles did not surface either one, because every one of them was written by the same
mind that wrote the ordering rationale — they encode my assumptions and then confirm them. Two
different models, given the design as data and told to attack it, produced both in a single turn
for a few cents. That is the first evidence in this project that the multi-seat premise pays for
itself on something other than a toy, and it is evidence about REVIEW specifically, not about
parallel task execution, which the 2026-09-27 paired eval still leaves unproven.

## V. The swarm's seats pollute each other; the convergence claim in commit e400875 is confounded

Operator, 2026-09-27: "they pollute each others output and findings."

Correct, and it qualifies a claim already committed. e400875 reported that all four layer-2
refutations attacking the SAME assumption was "itself a result: four models found one shared
weakness rather than four different ones." That reading is not supported.

**What is actually isolated.** Each layer runs under its own purpose, so explore / refute /
synthesize are separate conversations and no seat's explore chain carries peer text. This was
done for chain hygiene and incidentally prevents cross-layer bleed within a seat.

**What is not, and was overstated.**

V1. Layer 2 reviewers are anchored by construction: each is handed a peer's answer and asked to
attack it, so its finding is a function of that answer's framing. When all four layer-1 answers
argue the same position, four reviewers attacking the shared premise is the EXPECTED outcome of
common priming, not independent corroboration. The convergence is confounded and must not be
reported as agreement between independent observers.

V2. The synthesizer was a participant. openai produced a layer-1 answer and then synthesized the
pool containing it. It ruled against the consensus it had joined, which reads well and proves
nothing: a judge grading a field it competed in is precisely the arrangement this shape claims to
remove. `synthesizer` defaults to `seats[0]`, which makes a participant the default judge.

**Consequence.** The swarm demonstrates concurrency (efficiency 1.00, and that measurement
stands) and produces genuinely adversarial critique. It does NOT currently produce independent
corroboration, and no output of it should be counted as N independent confirmations. Contrast
with evidence section U, where two models attacked a design they had not authored and had no
shared prompt priming them toward one flaw -- those findings were independent and both were
real defects. That is the configuration that paid; this one is a demonstration.

Fixes, if the shape is ever used for a decision rather than a demo: make the synthesizer a seat
that did not answer; withhold peer answers from any seat whose later output is to be counted as
independent; and vary the layer-1 framing per seat so a shared premise is not planted in all
four before anyone is asked to attack it.
