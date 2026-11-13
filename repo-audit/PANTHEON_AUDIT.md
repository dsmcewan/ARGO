# Pantheon source audit

Source received in ARGO commit `6f75c29c8e66df2c76996c33b763390807d62bda`. This is a read-only audit of the uploaded bytes, not a claim about the installed checkout or account availability. The previous access failure remains historical evidence, not an outstanding blocker.

## Coverage and identity

273 files verified against Git blobs: 221 in `pantheon/`, 52 in `pantheon-seat-core/`. All 107 runtime/support modules have one of the requested reuse classifications in [the module catalog](evidence/pantheon-modules.csv). Combined with the original inventory this covers 525 modules. [The manifest](evidence/pantheon-source-manifest.json) pins every uploaded file. [Imports](evidence/pantheon-imports.json), [exports](evidence/pantheon-exports.json), and [syntax checks](evidence/pantheon-syntax.json) are retained separately.

`pantheon/` is the active source target: it has the board, build API and cooldown modules named by LEXI. `pantheon-seat-core/` predates those surfaces and must not become a second independent ARGO router. Its literal NUL in `src/seat/lock.mjs` is inside valid JavaScript; all cataloged JavaScript/Python source passed parse-only checks. The two lexical missing-import candidates are `./lock.mjs` inside generated probe strings in `scripts/delegate-run.mjs`; each probe writes that file into a temporary directory before execution. They are not missing runtime imports. No missing relative runtime source dependency was established.

Package locks declare the three injected vendor SDKs. Optional Antigravity CLI/SDK, Python `openai_codex`, local account credentials and Linux Bubblewrap are deployment prerequisites, not source files supplied here. The November ARGO route must use explicit supported API transports and offline injected clients; it must not silently assume the optional CLI accepts new API model names.

## Exact LEXI-facing boundary

- `src/view/build-server.mjs:80`: `createBuildServer({makeClientFor, allowedRoot, run})`; default allowed root is `~/Projects`. `listen()` binds loopback, default port 7778. Origin/host filtering is in `http-safety.mjs`; this is not a remotely authenticated tenant API.
- `POST /build` accepts `{ticket, scouts?}`, checks JSON content type, bounds body length, requires `key, repo_root, question, title, goal` as nonblank strings, checks path containment, and checks optional scout vendor names. Same in-process ticket key or concurrency limit returns 409. Accepted work returns 202 with `{accepted, key, running, out_dir, run_json}`. The asynchronous run emits tagged events and releases its in-flight key in `finally`.
- `GET /builds` returns `{running, max}`. `GET /events` provides bounded-count SSE subscriptions with replay sequence IDs. Run results are local files, not an authenticated world-event API.
- **Admission mismatch:** `run-item.mjs:93–98` additionally requires `copy`, `acceptance_cmd` and either `slot` or `slots`. The HTTP admission code does not enforce all those requirements. The audited LEXI producer's stricter singular ticket includes them, so that specific producer is compatible; arbitrary HTTP clients can get 202 followed by immediate failure. Schema freeze must define separate build-ticket and game-intent types.
- `runOpenItem(spec, opts)` returns `{ok, shipped, key, board, outDir, error, salvaged}`. It injects `makeClientFor`, supports explicit resume, seat overrides, revisions and progress. It does not call `process.exit()`.

## Stages, isolation and deterministic gates

| Source surface | Observed contract | ARGO disposition |
| --- | --- | --- |
| `board/run-item.mjs` | intake → promote human ticket → plan → work → check → ship; multi-slot writes declare distinct paths | Wrap via Adapter; preserve these as build stages, never gameplay events |
| `board/project.mjs` | Role-specific board/CAS projections, withheld maker defense, own/leased artifacts and explicit evidence kinds | Wrap via Adapter; useful projection structure, not actor knowledge authorization |
| `board/canon.mjs`, `context/chain.mjs` | Sorted compact JSON/hash helpers and exchange chains | Expose As-Is on validated domains; ARGO freezes its own numeric/codec contract |
| `board/cas.mjs`, `dag.mjs`, `refs.mjs` | Content-addressed objects verified on read; branch/ref CAS under locks; immutable snapshot refs | Wrap via Adapter; identities are build artifacts, not immutable world identity |
| `board/runtime.mjs`, `seat/lock.mjs` | Lease table locking, holder/generation fences, expiry, heartbeat, intent/history recovery | Wrap via Adapter; validate corrupt state and use authority-owned locks for world writes |
| `board/integrate.mjs` | ACTOR, TARGET, TICKET, GRAFT, LEASE, REVIEW, TESTS, MERGE checks; CAS landing | Wrap via Adapter; current gate set is not the requested ARGO schema/typecheck/replay gate |
| `board/acceptance.mjs` | Async Bubblewrap launch, cleared environment, bounded timeout, no unsandboxed fallback | Wrap via Adapter; preserve failure when isolation unavailable |
| SDK edge and history | SDK constructors injected; local history/intent writes; replay retains Responses output items | Wrap via Adapter; add model capabilities, scope and terminal-status checks |
| Demo/live scripts and UI | Operator-specific CLI/server scripts and monitoring UI | Build Net-New for ARGO product/API flows |

The so-called worktree at `run-item.mjs:125–138` is a directory populated by `cpSync` from declared `copy` paths, **not a Git worktree or sparse checkout**. Board projections are logical filtered views. Multi-slot workers share this directory, although the controller writes distinct declared artifact paths. Do not claim filesystem isolation from a context projection. Multiple processes/servers using the same target ticket key can also share `outputs/open-items/<key>`; the HTTP `running` set protects only one server instance.

`ship()` checks cross-lab review acknowledgements and recorded controller acceptance results bound to artifact CIDs. Review remains an LLM veto/acknowledgement, and TESTS reads recorded acceptance evidence; shipping does not itself run JSON Schema validation, typechecks or a gameplay replay oracle. ARGO needs a deterministic candidate-bound controller gate. Review can be advisory; a model verdict cannot replace execution evidence.

## Async execution and state coordination

`board/spawn.mjs:29` is Promise-based `spawn`, so slow acceptance/CLI children do not synchronously block the event loop. The default capture limit is 64 MiB **measured as string length**, despite the byte-oriented comment. Timeout and overflow send SIGTERM only to the direct child; there is no AbortSignal, process-group termination or kill escalation. A child ignoring TERM or a descendant holding pipes open can prevent settlement indefinitely. Phase 3 needs byte-bounded capture, cancellation and bounded descendant cleanup.

Small synchronous file/CAS operations remain throughout board and seat storage; copying large directories and histories can block the HTTP loop. Do not describe the entire harness as non-blocking. The foundation's bridge I/O and durable ledger will use asynchronous APIs and bounded operations.

`route/cooldown.mjs` matches LEXI's `{version:1,pools:{pool:{at,until,streak,why}}}` shape, epoch seconds and `PANTHEON_COOLDOWN_DIR`. Base delay is 60s, exponential cap 900s, stale age 6h. A positive Retry-After is returned directly, so the cap is not universal. Files are atomically replaced, but read-modify-write has **no shared lock**: simultaneous writers can lose different pool updates. The same problem applies to LEXI's v1 writer. A new runtime must not claim cross-process coordination by renaming a file; use one writer or a shared transactional store/protocol. Keep legacy interoperability explicit.

## Model routing and breaking request rules

1. **Actual defaults differ from the requested lineup.** `config/models.json` still maps Fable to 5.1 and Google to older Flash variants. `role/seating.mjs` prefers Sonnet through Antigravity CLI for planner/implementer and records only vendor-level pools. No four distinct Fable credentials/pool identities are provided. Account state in September comments is not November account evidence.
2. **Unfiltered extras.** `sdk/adapter.mjs:264–319,346–359` spreads caller `extra` fields into unary/streaming bodies. There is no Fable 5.2 sampling/forced-tool guard, output budget normalization, effort validation or Astra input-token guard. Unary and streaming construction are duplicated despite the builder comment.
3. **Truncation misclassification.** Unary Anthropic/Gemini paths default to `complete:true` without checking stop/finish reason. Messages streaming treats `message_stop` as complete even after `max_tokens`; Gemini streaming manufactures completion when iteration ends. Truncated code can therefore be returned as a normal reply.
4. **Existing reasoning retention to preserve.** Responses replay appends the original `res.output` items, including encrypted reasoning, in both unary and streaming paths. Streaming fallback reconstructs text when terminal output is missing; strict frontier tool loops must fail closed instead. Provider-specific cache identity is absent, and `reasoning.context=all_turns` is emitted across both OpenAI and xAI without a model capability table.
5. **429 policy has a second-error hole.** `shouldFallThrough()` treats 400/401/403 as terminal on the first failure. `run-item.mjs:361–366` ignores `f2.ok` after the single retry and continues to another candidate even if the second error is 400/auth. Retry-After is capped to a 60s sleep then retried early if the provider requested longer. Implement one bounded reusable router for every attempt, preserving actual credential/pool identity.
6. **Fallback provenance is inconsistent.** A pinned implementer model is prepended to the first role candidate, not selected by its own vendor. Planner publication uses the initially selected seat even if another vendor completed the plan. Implementer/reviewer fallback across vendors then aborts to avoid mislabeled artifacts. Proper fallback must carry returned identity through artifacts and review-pair selection; never forward foreign encrypted history.
7. **Google transport bypass.** Every board `agy_google` turn goes through `agyTurn`, including forced CLI for planner/implementer, bypassing raw `sendTurn`. Updating the raw API builder alone does not update that execution path. The new explicit API model seats must route to raw Google transport; legacy CLI remains opt-in.
8. **No compaction lifecycle.** No summarize/request/retain-signed-block protocol is implemented. A beta header by itself cannot satisfy the multi-hour requirement. Use the documented provider protocol and test full state handoff.

The official API audit remains the source for current provider constraints. This source audit establishes patch locations and reproductions to encode as offline tests; it does not spend any model pools.

## Phase 1 completion and boundary

Source extraction, module classification and the missing harness contract audit are complete. Known implementation defects are Phase 3 work, not reasons to invent missing contracts. Phase 2 can now freeze ARGO's new domain boundaries. Installed optional CLI runtimes, account entitlements and live vendor availability remain unverified deployment facts. All later capability tests must use explicit deterministic fakes before any separately authorized live run.

Reproduce: `python3 repo-audit/extract_pantheon.py`. It reads the pinned commit, verifies each blob and parses source without execution. It rewrites only its own derived audit files; original LEXI/TELOS evidence remains unchanged.
