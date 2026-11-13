# ARGO repository inventory

As of 2026-11-13. **Phase 1 is incomplete: Pantheon source is unavailable.** This is the canonical record of the read-only extraction completed so far. It is not a schema freeze, an implementation authorization record for TELOS, or proof of a deployed service's behavior. Phases 2–4 and parallel implementation lanes have not started.

## Source identity and coverage

| Repository | Pinned GitHub ref returned by the connector | Source files retained | Runtime/source modules cataloged |
| --- | --- | ---: | ---: |
| [LEXI](https://github.com/dsmcewan/LEXI) | `c190e245965447b369a33d928c4f09da33a68d67` | 288 | 239 |
| [TELOS](https://github.com/dsmcewan/TELOS) | `52787e7ff73d109cf844f4bc2eb5d5cabd2a82f5` | 137 | 117 |
| [claude-config](https://github.com/dsmcewan/claude-config) | `d418728bc58e6bbcb1d4457ee3c780d857f07a91` | 142 | 62 |
| Pantheon | Not accessible | 0 | Unknown |

567 retained source files match their Git blob hashes, including five symlinks restored from their actual Git blobs. Complete, non-truncated tree listings are retained. The original local source directories were audit snapshots, not Git worktrees or running deployments. This repository retains their derived evidence and pinned identities; copied LEXI, TELOS and claude-config source snapshots are excluded from this archive. No source repository was modified, no build was dispatched, and no vendor inference calls were made.

The [per-module inventory](repo-audit/evidence/module-inventory.csv) assigns all 418 source modules in the surveyed trees one of the three requested dispositions. Module means a tracked `.py`, `.mjs`, `.js`, `.ts`, `.tsx`, `.jsx`, `.sh`, `.ps1`, or `.tf` source outside documentation, memory, fixture, example, and test paths. Infrastructure and configuration source are included. Test and asset files are retained in the tree index, not counted as runtime modules. Every cataloged module has source available. Classification is a proposed ARGO reuse disposition, not a claim that every file received a semantic review; targeted findings below identify the inspected implementation boundaries.

Evidence:

- [Module inventory, JSON](repo-audit/evidence/module-inventory.json): path, classification, rationale, blob identity, coverage.
- [Source manifest](repo-audit/evidence/source-manifest.json): all retained source bytes and hash verification.
- [LEXI route declarations](repo-audit/evidence/lexi-routes.json): 170 static declarations, exact parameters/decorators, return annotations, and source lines.
- [LEXI model declarations](repo-audit/evidence/lexi-models.json): 114 classes, including 25 SQLModel table declarations, with field types/default expressions.
- [JavaScript exports](repo-audit/evidence/javascript-exports.json): 891 export declaration locations across retained source, including tests/support code; not all are public service APIs.
- [Missing-import candidates](repo-audit/evidence/missing-relative-imports.json): lexical scan; includes strings in tests and must not be treated as 46 confirmed missing production dependencies.
- [Extraction summary](repo-audit/evidence/extraction-summary.json) and [reproducible extractor](repo-audit/extract_inventory.py).

The extractor parses Python syntax without importing the application. Route declarations are not live OpenAPI. SQLModel declarations do not establish the complete physical database schema. No private database, case corpus, encryption key, or installed CLI credentials were accessed.

## Classification rules

- **Expose As-Is:** named existing utilities can retain their current contracts on validated inputs. This never grants a caller direct world-state mutation authority.
- **Wrap via Adapter:** reuse a concrete implementation through an explicit boundary that translates types and enforces ARGO scope, provenance, authorization, time, and error semantics.
- **Build Net-New:** the ARGO capability does not follow from the existing domain implementation. Existing forensic/product code remains intact; this label is not a deletion recommendation.

No existing LEXI route qualifies for direct exposure to a player or autonomous agent as an ARGO knowledge API.

## LEXI: extracted capabilities and deltas

| Existing boundary | Disposition | Evidence and required adaptation |
| --- | --- | --- |
| `core/config.py`, `core/logger.py` | Wrap via Adapter | Configuration/logging helpers; separate tenant service configuration and redact secrets/hidden game information. |
| `backend/db_config.py`, `db_session.py` | Wrap via Adapter | Central `data/LEXI.db`; SQLCipher when `DB_ENCRYPTION_KEY` is set, plain SQLite test path otherwise. Connection selection is not tenant isolation. |
| `backend/models.py`, migrations | Wrap via Adapter | Relational forensic records and translating SQL views. Add ARGO-owned schema and migration discipline; do not reinterpret live case tables as gameplay truth. |
| `backend/auth.py` | Build Net-New | `create_access_token()` sets `sub: "lexi"`; `require_auth()` returns `"lexi"`. One shared credential is not per-actor or per-campaign authorization. |
| `backend/main.py` read routes | Wrap via Adapter | `/api/messages`, `/api/messages/{message_id}`, `/api/timeline`, `/api/timeline/monthly`, temporal/profile routes. Their current query semantics do not enforce actor acquisition time. |
| Case documents and document-message links | Wrap via Adapter | Provenance links, excerpts, source dates, and document metadata are useful. Their claims/relationships are not canonical truth or observer-specific beliefs. |
| Court/event timelines, annotations, clusters, investigations, campaigns | Wrap via Adapter | Temporal organization and evidence aggregation can inform adapters; existing “campaign” means a forensic behavioral campaign, not an ARGO campaign namespace. |
| `prompt_builder.py`, chat, classification and methodology | Wrap via Adapter | Presentation/context machinery must consume only a prefiltered knowledge view. It cannot establish entitlement or facts by prompt instructions. |
| `companion_build.py`, `model_fallback.py`, `anthropic_credentials.py` | Wrap via Adapter | Existing Pantheon build bridge and shared quota-pool cooldown protocol; not a complete multi-vendor router. Preserve existing callers when extracting a reusable client. |
| Frontend source, voice/conversation UI | Build Net-New | Existing client calls and UI are forensic. ARGO gateway/personas/voice turn-taking need new domain contracts; selected transport helpers can be reconsidered individually. |
| Case analysis and migration scripts | Build Net-New | Do not run corpus-specific scripts against ARGO state. Historical test/support scripts are separately indexed. |
| `scripts/program/lib/canonical-json.mjs` | Wrap via Adapter | `canonicalJson()` sorts keys but emits pretty JSON plus a trailing newline; TELOS uses compact JSON. The codecs are not byte-identical. Choose one versioned ARGO codec later. |
| Docker/Terraform/development hooks | Wrap via Adapter | Deployment scaffolding only; no evidence it already separates ARGO rights lanes or tenants. |

### Concrete route and storage observations

`main.py:435` declares `GET /api/messages(limit=50, offset=0, sender=None, min_coercion=None, min_threat=None, session=Depends(get_session)) -> list[Message]`. It filters sender/scores, then sorts by `date_time DESC`; neither actor entitlement nor an acquisition cutoff participates in the query. `main.py:1121` declares `/api/hcp/temporal/timeline`, which selects periods by person and orders periods; this is not a historical knowledge query.

`main.py:227–238` mounts twelve imported routers without adding a prefix. The static catalog also includes routes in source modules that are not necessarily mounted. Mounting, auth dependency behavior, and live response shapes still require a deployment/OpenAPI check before any service is advertised as callable.

The 25 declared ORM tables are: `Timeline`, `timeline_annotations`, `case_documents`, `document_message_links`, `manipulation_campaigns`, `escalation_sequences`, `detected_campaigns`, `detected_incidents`, `incident_messages`, `campaign_incidents`, `deposition_sessions`, `deposition_traps`, `deposition_questions`, `question_evidence`, `deposition_evidence`, `narrative_clusters`, `cluster_elements`, `cluster_summary_history`, `third_party_authority`, `behavioral_patterns`, `hcp_temporal_tracking`, `hcp_profiles`, `communications`, `violation_analysis`, and `lexi_tactics`. Field-level declarations are in the linked model catalog. Other SQL-created objects exist outside these ORM classes; no complete physical-table claim is made.

`migrations/003_generic_schema_views.py` translates source-case names and column names into generic views, including `communications`, `violation_analysis`, `behavioral_patterns`, and `ext_THREADS`. Its INSTEAD OF triggers make some views writable. Generic labels are not access control, and a view is not necessarily a read-only boundary.

Required new capabilities:

1. Separate canonical fact records from actor beliefs, rumors, and external accounts; preserve claim provenance and uncertainty without silently promoting claims into truth.
2. Authorize every query against actor, tenant, campaign, world/branch, and rights lane. Party knowledge must not be a union of every member's private solo knowledge.
3. Track both event/world time and each observer's acquisition time. A historical view must enforce `acquired_at <= requested_world_time` as well as the relevant fact validity interval. Backdated claims cannot backdate an actor's knowledge.
4. Apply the same scope to caches, search, vector/graph retrieval, exports, summaries, and logs. A filtered final response cannot undo a secret already sent to a narrator.
5. Materialize epistemic ledger events idempotently, in ledger sequence, with a durable cursor. Speech observations require commits even if physical state does not change.

These are **Build Net-New** service capabilities. The surveyed relational model and read paths do not implement them. No implemented actor-belief graph was established by this audit; architecture plans in the repository are not evidence of deployed graph behavior.

## TELOS: extracted authority and ledger primitives

| Existing boundary | Disposition | Evidence and required adaptation |
| --- | --- | --- |
| `build-gate/sign.mjs` | Expose As-Is | Named `canonicalize`, `signPacket`, `verifyPacket` helpers retain build packet semantics; validate inputs and provision keys outside untrusted workers. |
| `merkle-dag/vendor.mjs` | Expose As-Is | Named `canonicalize`, `sha256hex`, `resolveUnder` helpers. Codec needs a validated JSON value domain; these helpers do not define game rules. |
| `build-gate/gate.mjs`, evidence/check registry, risk policy | Wrap via Adapter | `validateGate`/`validateRecords`, deterministic evidence rechecks, signed provenance, protected paths, adjudication. Map to ARGO authority explicitly; do not call council approval a game-action permission. |
| `build-gate/schemas.mjs` | Wrap via Adapter | Existing validator handles a small schema subset. It does not implement arbitrary JSON Schema; its `integer` branch only checks `typeof === "number"`. Do not use it unchanged as the ARGO contract gate. |
| `merkle-dag/crypto.mjs` | Wrap via Adapter | Ed25519 key/signature helpers plus single-writer settlement storage. Signed fields describe tasks/artifacts; they do not bind arbitrary world event fields. `readLedger` skips unparsable lines, unsuitable for authoritative game replay. |
| `merkle-dag/proposal-ledger.mjs` | Wrap via Adapter | Stronger starting point: signed whole-event bytes, parent hashes, strict read/verification, locked append with head reread. Its event stages and identities remain build-proposal specific. |
| `forge/operator.mjs` | Wrap via Adapter | Bounds, rulebook evaluation, strict signed hash chain, head sidecar, and halt-on-quota behavior. Not a seeded game RNG, proxy grant service, or consent oracle. |
| `build-gate/build-orchestrator.mjs`, teams, prompts | Wrap via Adapter | Workers own declared nodes; independent disk/test verification settles the ledger. Preserve the separation between implementation and certification. |
| `build-gate/test-runner.mjs` | Wrap via Adapter | Spawn-based Promise runner, timeout and captured result. Buffers stdout/stderr until completion and terminates only the immediate child on timeout; add bounded capture/process-tree cleanup before overnight use. |
| `merkle-dag/orchestrate.mjs`, planner, artifact, ledger-gate | Wrap via Adapter | Content-addressed build DAG, artifact verification and settlement. Not world-time scheduling or causal/epistemic replay. |
| `clotho/` | Wrap via Adapter | Source graph/thread ledger and queries (`threadsOf`, `blastRadius`, `why`, `reportGaps`). Build graph identities must not become fictional Fate jurisdiction by renaming. |
| `lachesis/`, `atropos/` | Wrap via Adapter | Dependency/risk measurement and recorded supersession verification. Neither supplies the Tempted Fates gameplay agents. |
| `breakout/`, `connectors/ai-peer-mcp/` | Wrap via Adapter | Seat routing, model request construction, parsing/provenance. Concrete API migration sites are listed below. |
| `ai-native-memory/`, workflow/governance support | Wrap via Adapter | Existing governance tooling can support the build; deployment paths and authority records must remain separate from game state. |
| `ai-forge/`, `saas-forge/`, `narcissus/flagship/`, `demo/`, Meta ads connector | Build Net-New | Separate existing products/examples; they are not ARGO domain implementations. |

`atomicAppendProposalEvent(telosDir, buildEvent, {publicJwk})` rereads and verifies the chain while holding an exclusive lock and supplies `(parentHash, sequence)` to `buildEvent`. This is an adapter candidate, not an event validator for arbitrary game data. Its synchronous lock/filesystem operations must not block ARGO's async request loop.

New action authority must bind proposals to authenticated principals and the current state/version, reject unknown operations, verify causal parents within the same world, enforce idempotency, and derive effects through a deterministic ruleset. A “validated” flag in model JSON is not authority.

**Build Net-New:** gameplay RNG with versioned deterministic algorithm and private draw records; observer-safe disclosure/commitment policy; scoped proxy grants with grantor, grantee, actions/resources, start/end time, revocation sequence, and use limits; donor-authenticated time-transfer consent; causal and epistemic event schemas; gameplay replay/snapshot equivalence; encounter checkpoint and conflict policy. All authority checks must occur again at commit, so revocation and concurrent state changes cannot be bypassed by an earlier validation result.

TELOS's governance records distinguish its implementation role “Argo” and build graph roles from autonomous services. The requested standalone ARGO game is a new domain and must not silently rewrite those registered meanings in TELOS.

## Harness: confirmed wiring and unavailable source

The first candidate was `claude-config`; source inspection identifies **Pantheon** as LEXI's connected build harness:

- `LEXI/lexi-dashboard/backend/companion_build.py:22–29`: loopback `http://127.0.0.1:7778`, references `src/view/build-server.mjs` and `src/board/run-item.mjs`.
- `start_build` posts `{"ticket": ticket}` to `/build` and expects HTTP 202. `build_status` reads `/builds` and a run record. These calls were inspected, not executed.
- The producer's ticket schema requires `key`, `repo_root`, `title`, `slot`, `path`, `copy`, `acceptance_cmd`, `question`, and `goal`; strings must be nonempty, `copy` is an array of strings, extra fields are forbidden. Pantheon's consumer validation remains unverified until its source is available.
- `model_fallback.py:92–104` names `pantheon/src/route/cooldown.mjs` and a shared `{version:1,pools:{pool:{at,until,streak,why}}}` cooldown record using epoch seconds and `PANTHEON_COOLDOWN_DIR`.
- `anthropic_credentials.py:35` references `pantheon/src/sdk/adapter.mjs`.
- `scripts/probe-pantheon-wire.py:17–27` names `/home/colchis/Projects/pantheon`; that checkout is not present in this environment. The probe was not run because it launches a build service.

`claude-config/README.md` explicitly describes an allowlisted configuration/recovery repository, not a snapshot of whole installed packages. Confirmed absent tracked dependencies include `skills/multi-model-seats/scripts/swarm-dag-hash.mjs`, `workflows/layered-swarm.d/registry-chain.mjs`, and `hooks/open-obligations.mjs`. The installed runtime may contain them; this snapshot does not.

| Harness surface inspected | Disposition | Finding |
| --- | --- | --- |
| Pantheon stage handoffs / sparse worktrees / four usage pools | Wrap via Adapter, provisional | No source available. Their correctness, API, pool ownership and failover ordering cannot be inferred from the LEXI producer. |
| `claude-config/hooks/worktree-create.mjs` | Wrap via Adapter | Selects a repository and creates ordinary Git worktrees synchronously. No sparse-checkout policy is implemented here. |
| `workflows/layered-swarm.d/write-lanes.mjs`, `write-sets.mjs` | Wrap via Adapter | Per-target serial lanes and overlap checking. Some workflow mirrors only record model-declared effects; that does not prove disk isolation. |
| `skills/multi-model-seats/scripts/swarm-seat-adapters.mjs` | Wrap via Adapter | Async spawn, process-group termination, deadline and output-cap machinery. Prompts still travel through argv; declared 131072-byte ceiling can bind before model context. Missing hash dependency prevents complete runtime validation here. |
| `records/routing-matrix.json` | Wrap via Adapter | Explicitly dated July with only partial September revalidation; not November capability evidence. |
| LEXI `model_fallback.py` | Wrap via Adapter | Specific 429-triggered two-leg drafting fallback; 400/auth failures propagate. Synchronous client/sleep semantics, although companion build is offloaded with `asyncio.to_thread` at its call site. It is not an async general router. |
| TELOS API request builders | Wrap via Adapter | Breaking model-family assumptions and forced Anthropic tool choice identified; see migration checklist. |

Cooldown storage deserves a concurrency audit: LEXI performs read-modify-write and atomic replacement. Replacement avoids partial JSON, but by itself does not prevent two processes from losing each other's pool updates. Pantheon's locking/coordination must be inspected before four pools or multiple build teams share this state.

## Phase 3 patch targets established during read-only audit

These are findings and acceptance targets, not applied patches. [MODEL_API_AUDIT.md](repo-audit/MODEL_API_AUDIT.md) records the official documentation and corrections to the requested settings.

1. `TELOS/connectors/ai-peer-mcp/server.mjs:478–496`: supplied temperature still reaches Anthropic; structured mode sets `tool_choice={type:"tool"}`. Fable 5.2 rejects the forced choice. Preserve structured validation without forced invocation; use supported output format where available or auto tool use plus fail-closed validation.
2. `server.mjs:604–635`: effort and completion-token behavior is gated on `gpt-5.6` / `gpt-5`; GPT-6 can reach the legacy `max_tokens` path. Move to an explicit capability/request schema and provider token counting before the requested <250K Astra guard.
3. `server.mjs:668–688`: Gemini thinking only matches `gemini-3`; output defaults to 2000. Carbon/Argon need combined input/output budgeting and actual continuation/streaming support, not only a larger number.
4. `server.mjs:548–578`: xAI effort handling targets 4.5 and uses Chat Completions. A Responses tool loop must retain encrypted reasoning items and use provider-specific cache identity. Do not reinterpret chat text as Responses state.
5. `swarm-seat-adapters.mjs:208–227`: CLI model selection is env-dependent and Gemini defaults to `gemini-3.1-pro-high`. API model IDs cannot be assumed valid Antigravity CLI IDs; inspect installed model metadata.
6. Pantheon router/SDK source is required to apply these changes to the actual overnight execution path, inspect 429 tables, separate rate limiting from permanent quota/auth errors, and prove bounded non-retrying HTTP 400 handling.

## Dependency gate and remaining inputs

| Phase | Status | Gate to advance |
| --- | --- | --- |
| 1. Audit/extraction | Partial; blocked on Pantheon | Inspect complete harness, consumer contracts and runtime/source closure; reconcile all unresolved inventory claims. |
| 2. SYSTEMS / MECHANICS freeze | Not started | Phase 1 complete. Freeze versioned schemas and ownership; no team-local inventions. |
| 3. Harness patch | Not started | Phase 2 frozen, actual harness available, offline request/400/429/process tests pass. |
| 4. Ledger foundation | Not started | Phase 3 passes. Sequential ledger/replay then bridge mocks and canonical scenario. |
| Parallel feature lanes | Not started | All four phases pass with deterministic controller evidence. |

Required next input: an accessible Pantheon repository URL or checkout. The user has now supplied `ARGO_Tempted_Fates.md`; a byte-identical copy is retained as [SCENARIOS/Tempted_Fates.md](SCENARIOS/Tempted_Fates.md), with [source identity](repo-audit/evidence/tempted-fates-source.json) and [requirement traceability](repo-audit/SCENARIO_REQUIREMENTS.md). The scenario-source blocker is resolved. Its interpretive boundary distinguishes core canon from optional connective dialogue; Integration Test Zero must preserve that distinction and the Fates' jurisdictional disengagement after the anomaly is named. No schemas or implementation phases have started.

No new approval is being requested. The hold follows the user's strict phase dependency order and missing source evidence, not a skill-imposed permission gate. [RESUME_AUDIT.md](repo-audit/RESUME_AUDIT.md) contains the bounded continuation instructions.
