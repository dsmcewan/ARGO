# W01 source refresh and headless boundary evidence

Inspected ARGO `41f2cb8568b53fac984e1114d7342eef540bb6d5`. Generated 2026-11-13T17:53:43.548714+00:00. Read-only source review; no legacy execution, credential/database access or paid calls.

## Refreshed identities

| Repository | Retained tree-response reference | Independently resolved main commit | Canonical root tree | Source delta |
|---|---|---|---|---|
| dsmcewan/LEXI | `c190e245965447b369a33d928c4f09da33a68d67` | `c190e245965447b369a33d928c4f09da33a68d67` | `d19adc1935194fe5ba97efb1cdc2a01ba8e78abf` | 0 added / 0 removed / 0 changed; 533 entries |
| dsmcewan/TELOS | `52787e7ff73d109cf844f4bc2eb5d5cabd2a82f5` | `52787e7ff73d109cf844f4bc2eb5d5cabd2a82f5` | `8125e339eeeb0910d7c06db71afcbe9331b48b92` | 0 added / 0 removed / 0 changed; 1878 entries |
| dsmcewan/claude-config | `d418728bc58e6bbcb1d4457ee3c780d857f07a91` | `d418728bc58e6bbcb1d4457ee3c780d857f07a91` | `2d0babadfee8d899e09fc8f755b310bfda360b92` | 0 added / 0 removed / 0 changed; 190 entries |

The retained `*-tree.json` top-level `sha` is a Git Trees API request/response reference. Fresh `/git/commits/<sha>` responses identify those values as commits and name different canonical root trees. `/git/trees/<commit-ish>` echoes the commit-ish in its header. Reconstructing every root/subtree Git object from the retained and current recursive entries verifies identical canonical trees. Preserve the old catalog fields; add this new resolution rather than relabeling the old evidence as if it had independently verified commit kind.

## Selected verified upstream sources

Nine narrowly selected source files were fetched by immutable blob SHA to independently recheck byte identity and symbols; all nine SHA1 blob IDs and SHA256 values match the retained manifest. No source-content change was found.

- **dsmcewan/LEXI/lexi-dashboard/backend/db_config.py** — `get_db_connection` L27, `get_db_path` L49.
  Blob `32644785e1ebb49653296e02f51d304de315d55e`; SHA256 `3c102efc477b61a5e768ab1d39c06cfafd4f30a4bd6fc9ca2482d7a27e06b1fa`; 1438 bytes. get_db_connection selects SQLCipher when DB_ENCRYPTION_KEY is nonempty, plain sqlite3 otherwise; DB_PATH defaults to data/LEXI.db with LEXI_DB_PATH override. Source inspected only; neither env nor database opened.
- **dsmcewan/LEXI/lexi-dashboard/backend/db_session.py** — `get_session` L36, `execute_dynamic_sql` L42.
  Blob `f557fb0634c8b4c5f4122b977d99f73cb03fb0dd`; SHA256 `07cf9ef33f665d678b0a5b11f0e1a6eebe63d779cffb24072a61564af72dddf9`; 1999 bytes. get_session yields a SQLModel session; execute_dynamic_sql rewrites positional parameters. Database connection is module-level source behavior, not a performed operation.
- **dsmcewan/LEXI/lexi-dashboard/backend/models.py** — 25 SQLModel classes/table declarations (complete names and lines in JSON), including Timeline L4, CaseDocuments L26, OfwMessages/communications L284.
  Blob `84dc2079f9f834255b6ee4a2544bb308bd85aa21`; SHA256 `4e8e385aff0c6cc95fc1e572d21cbc28a0e0ab6a022197cba499bcbffbda6906`; 14478 bytes. 25 SQLModel table declarations for the forensic domain. This is not a live physical-schema census or evidence of gameplay per-actor fact/belief graphs.
- **dsmcewan/TELOS/build-gate/sign.mjs** — `canonicalize` L26, `signPacket` L30, `verifyPacket` L35, `secretFor` L48, `signMarketPacket` L59.
  Blob `d80fa823603050914aea5e9ecec63e54a8671ab0`; SHA256 `ca3b01d37ea733d24e6d607e812918b6cd197fa5d3bd4a69f8deac4044d73ad7`; 3269 bytes. canonicalize/signPacket/verifyPacket implement HMAC-SHA256 build-packet signing. This is not ARGO Ed25519 event signing or an authenticated gameplay Outcome receipt.
- **dsmcewan/TELOS/build-gate/test-runner.mjs** — `runNodeTest` L28.
  Blob `60e7fbbdd32014d59f1dc29978471a91a970ae85`; SHA256 `f22b63600aa49785374e770079ddbe675f9cc6c1e587d2983e77382eb0799b2e`; 3052 bytes. runNodeTest checks command/cwd and has a deadline, returns bounded output tails. It buffers full output and tests exit code; source states advisory pre-flight, not controller certification. No filesystem/network isolation is established by this helper.
- **dsmcewan/TELOS/merkle-dag/vendor.mjs** — `canonicalize` L24, `sha256hex` L29, `maxConcurrency` L41, `resolveUnder` L58, `spawnCommand` L124.
  Blob `a0750c0e5ca1b098412d7dade16c4f7e0aff0d43`; SHA256 `082dc2b3f40e11637729e7a3503e19fc7fe0cc43310cb889c4e856eebb15e7ab`; 5527 bytes. canonicalize, sha256hex, maxConcurrency, resolveUnder and spawnCommand. Path guard checks existing components physically; these utilities do not supply gameplay scope or authorization.
- **dsmcewan/claude-config/workflows/layered-swarm.d/graph-watch.mjs** — `createWatcher` L37.
  Blob `8347d7d01b3565d8323889e74a4256e5300a3b2a`; SHA256 `bab2809fe379a40ab4bc14eb14f6b4a5c8dbacdd94017567800b9ff7cfa58f07`; 6476 bytes. createWatcher polls derived research context, emits contradiction/corroboration/revision/frontier/stale-pin observations and tracks pins; it is explicitly an observer, not gameplay authority or persistent event bus.
- **dsmcewan/claude-config/workflows/layered-swarm.d/research-graph.mjs** — `canonicalDomain` L54, `assertionsFor` L65, `ingestLenses` L96, `analyze` L112.
  Blob `b3b2b305eadc1f0490c52f228854848c83657b0f`; SHA256 `30a815cc7524f8aa936355e497a04f6af1d21297ad05d88026b9c9b9815890d9`; 11039 bytes. canonicalDomain/assertionsFor/ingestLenses/analyze aggregate research assertions, source citations and conflicts. Agreement/confidence is not authority to promote an NPC belief to canonical world truth.
- **dsmcewan/claude-config/workflows/layered-swarm.d/write-lanes.mjs** — `normPath` L21, `groupByTarget` L36, `serialLane` L49, `declaredOverlaps` L64, `taintedFindings` L95, `runDirConflicts` L106.
  Blob `b685bc92b67987b7db0d5d19860971ae0c4b4a00`; SHA256 `099b5589b6d483c7eadddebd2461388d68d65d361c2ca00d6e30ca021c0681f7`; 6949 bytes. groupByTarget/serialLane serialize same-target work; declaredOverlaps/taintedFindings reconcile reported writes and runDirConflicts detects collision. Reported paths are not proof of actual filesystem confinement.

## Current-to-target source gap matrix

| Component | Implemented evidence | Missing or unsafe inference |
|---|---|---|
| LEXI legacy storage | Forensic SQLite/optional SQLCipher sessions and 25 declared tables. Sources: `LEXI:lexi-dashboard/backend/db_config.py:get_db_connection`, `LEXI:lexi-dashboard/backend/db_session.py:get_session`, `LEXI:lexi-dashboard/backend/models.py` | New scoped gameplay fact/belief projections, independent materializer cursor, entitlement-aware queries/caches, and migration/storage decision. Existing forensic campaigns are not gameplay campaigns. |
| TELOS legacy build primitives | HMAC build-packet helpers, physical path confinement helper and advisory process test runner. Sources: `TELOS:build-gate/sign.mjs:signPacket`, `TELOS:build-gate/test-runner.mjs:runNodeTest`, `TELOS:merkle-dag/vendor.mjs:resolveUnder` | Gameplay proposal/receipt protocol, authority identity and complete scope/proposal response binding; cannot substitute build HMAC packets for signed ARGO events. |
| claude-config research graph and lanes | Research evidence/conflict projection, observer notifications and same-target lane serialization. Sources: `claude-config:workflows/layered-swarm.d/research-graph.mjs:analyze`, `claude-config:workflows/layered-swarm.d/graph-watch.mjs:createWatcher`, `claude-config:workflows/layered-swarm.d/write-lanes.mjs:declaredOverlaps` | Actor acquisition time, rights scopes, authoritative causal vs epistemic commits, durable bus delivery semantics and independent filesystem proof. |
| ARGO authority and state | Signed deterministic file journal; causal/epistemic actions, consent/proxy state, exact head/sequence and replay. Sources: `packages/ledger/src/index.ts:openLedger`, `packages/ledger/src/mechanics.ts:replay`, `packages/contracts/src/generated.ts:Snapshot` | Versioned authenticated genesis/import and rollback assurance; identifier/map-domain compatibility; general ruleset progression and persistent projection read models. |
| ARGO knowledge | Injected asynchronous transport; mock reconstructs actor/party/time-filtered view from authority Snapshot per query. Sources: `packages/lexi-bridge/src/index.ts:createLexiBridge`, `packages/lexi-bridge/src/index.ts:projectKnowledge`, `packages/lexi-bridge/src/index.ts:createLexiMock` | Persistent gameplay graphs, a durable projection cursor, common-checkpoint multi-query contract, scoped retrieval/cache implementation ; finer encounter cutoffs would require explicit behavior review. |
| ARGO submission | Injected bounded submit transport and in-process authority delegation; absent transport returns UNAVAILABLE. Sources: `packages/telos-bridge/src/index.ts:createTelosBridge`, `packages/telos-bridge/src/index.ts:createTelosMock` | Deployment/authenticated gateway and versioned full-proposal/scope receipt binding. Shape checks alone do not authenticate the returned event. |
| ARGO narration and autonomy | Stateless narration, typed Action proposals, current cutoff refresh, bounded async-iterator proposal callbacks and independent optional Fates. Sources: `packages/argo-dm/src/index.ts:createNarrator`, `packages/argo-dm/src/index.ts:proposalFromAction`, `packages/interventions/src/index.ts:runSubscriber`, `scenarios/tempted-fates/index.ts:createFates` | Persistent component bus, idempotent duplicate/reorder handling, cancellation/restart recovery, off-screen scheduling and separate solo/raid session contracts. No general natural-language intent parser, production UI or voice. |
| ARGO build control | SQLite DAG/path leases/CAS, offline confined workers, pinned data validators and separately trusted full application merge controller. Sources: `tools/board.py:Board`, `tools/dispatch.py:Dispatcher`, `controller/merge.mjs`, `controller/acceptance-policy.mjs` | External application-oracle/board reconciliation adapter; semantic audit/synthesis/projection gates; capacity isolation and explicitly authorized future provider dispatch. Build control is not the gameplay ledger or message bus. |
| Active Pantheon/model client | Active adapters call shared model-client policy; separate content-addressed build DAG/ref/runtime stores and bounded process runner. Sources: `pantheon/src/sdk/adapter.mjs:sendTurn`, `pantheon/src/route/frontier.mjs:frontierCandidates`, `packages/model-client/client.mjs:sendModelTurn`, `pantheon/src/board/index.mjs:openBoard` | Gameplay projection contracts and bus cannot be inferred from build DAG or model history. Live vendor access, account capabilities and paid dispatch remain unverified/unauthorized. |

Active Pantheon is the tracked `pantheon/` subtree at `41f2cb8568b53fac984e1114d7342eef540bb6d5`, tree `18db382f71afda29c10a5b9f673dbe6a7ab5462b`. Against the retained manifest at `6f75c29c8e66df2c76996c33b763390807d62bda`, it has 8 added, 0 removed and 29 changed files. This is expected local harness repair history, not a new external Pantheon refresh. Full path lists and current source hashes are in JSON.

## Storage planes

- **gameplay ledger**: `genesis.json`, `events.jsonl`, `snapshot.json`, `writer.lock`. Signed events plus pinned supplied genesis; snapshot.json is derived cache; reads replay journal.
- **Python build board**: `board.db`, `BOARD.md`, `cas/<first2>/<full-sha256>`, `tickets/<id>.json`, `tickets/<id>.spec`, `worktrees/`, `gates/`, `merge.lock`. Build coordination only; WAL FULL transactions, revision CAS and epoch/token leases, accepted-only artifact handoff; local audit chain is not independent rollback proof.
- **retained active Pantheon build board**: `objects/<codec>/<first2>/<remaininghex>`, `refs/`, `runtime/leases.json`, `runtime/occupancy.json`, `runtime/budget.json`, `runtime/spend.jsonl`, `runtime/refs.log`. Separate build DAG/ref/runtime representation, not gameplay fact/belief projections.
- **shared model pool cooldowns**: `<sha256(pool)>.json`, `<sha256(pool)>.json.lock`. Provider-pool scheduling state, not gameplay state; active Retry-After is retained across older successful requests.

Ledger Snapshot fields: `genesis`, `sequence`, `head`, `world_time`, `actors`, `items`, `claims`, `consents`, `grants`, `cutoffs`, `transfers`, `rng_counter`, `proposals`. Python board tables: `meta`, `tickets`, `dependencies`, `artifacts`, `audit`. None of the three histories should be described as the missing persistent gameplay fact/belief graph.

## Proposed fixture ideas (not executed)

- **HD-W01-ID-001** Given Retained tree-response sha equals a commit-ish; commit endpoint returns a distinct root tree. When Refresh source identity. Oracle: Keep original header, record independently resolved commit and canonical tree, compare path/mode/type/blob identities; do not report a code delta merely because the header differs from root tree.
- **HD-W01-KNOW-001** Given Actor A privately observes claim c at sequence9/world_time20 with occurred_at5; B shares a party but is not an observer. When A queries time10; B queries actor/party views at time20. Oracle: Neither query reveals c; occurrence backdating does not backdate acquisition and party membership alone does not disclose private claims.
- **HD-W01-CURSOR-001** Given Fact and belief projections are at different committed prefixes, and delivery includes duplicates/reordering. When Build one derived context for an agent. Oracle: Require a common authenticated cursor or refuse; no mixed-prefix snapshot, duplicate effect or fabricated advancement.
- **HD-W01-RECEIPT-001** Given A real foreign-scope outcome shares proposal ID, action kind, sequence and time with a local request. When Bridge receives it. Oracle: Reject using full scope/proposal identity and authority verification. Blocked on R06.
- **HD-W01-GENESIS-001** Given Signed history and expected head unchanged; an untouched genesis balance differs. When Import/replay from supplied genesis. Oracle: Reject under a reviewed genesis identity or authenticated import manifest. Blocked on R12.
- **HD-W01-ROLLBACK-001** Given Storage restores a valid prefix before proxy revocation. When A new delegated action is submitted. Oracle: Apply the explicitly chosen rollback/restore assurance; an independent monotonic checkpoint is required if rejection is promised. Blocked on R13.
- **HD-W01-CANON-001** Given Legacy HMAC build packet, ARGO Ed25519 event and values involving floats, -0, array order and reserved map keys. When Adapters attempt cross-protocol canonicalization/signing. Oracle: Require an explicit codec/protocol version; no equivalence inferred merely from both using sorted JSON. Blocked on R10.
- **HD-W01-PLANE-001** Given Research graph consensus and a build-board MERGED record mention a gameplay claim. When A gameplay query or authority proposal consumes these artifacts. Oracle: Treat them as external evidence/proposals; neither research agreement nor build status creates world truth.

## Limits and handoff

- This is source/provenance verification, not a rerun of legacy applications, live endpoints or production data schemas.
- The retained catalog header alone was insufficient to establish object kind; new Git commit metadata and reconstructed root-tree hashes establish the identities here.
- Historical baseline_commit remains null because the old artifact did not independently resolve kind; baseline_resolved_commit records the new verification without rewriting history.
- Only nine selected external source files were fetched (no full source repositories, case databases, keys or .env files).
- Historical Pantheon mirror remains provenance evidence; active Pantheon is the tracked ARGO subtree, not an independently refreshed upstream repository.
- Known deferred decisions R06/R10/R12/R13 remain unresolved; fixture ideas are proposed and were not executed.
- Current control-plane Python is trusted policy; same-process unittest receipts are not adversarial authentication.
- No new storage backend, service schema, licensed rules asset, runtime implementation or paid dispatch is authorized by this evidence packet.

Machine evidence: [source-evidence.json](source-evidence.json). Minimal commit/ref/resolution/delta records are retained in [evidence/source-refresh/](evidence/source-refresh/). The JSON contains exact Git blob hashes, SHA256, symbol lines, immutable source URLs, source deltas and the active ARGO/Pantheon gap matrix. Temporary capture paths are historical provenance, not portable inputs. Original complete tree catalogs remain the source of unchanged path/mode/blob entries; no selected legacy source file is copied into ARGO.

Raw-source coverage: the historical `repo-audit/sources/` copies are not present. Nine selected external files were fetched and verified into `/tmp`; the remaining retained manifest source bodies were deliberately not restored. Their current blob identities were compared through complete metadata trees, not newly semantically audited.
