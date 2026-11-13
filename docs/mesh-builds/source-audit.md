# TELOS PR #205 trace-mesh source audit for ARGO

Prepared 2026-11-13, source retrieval completed at 18:48:29 UTC. Native Codex read-only source audit; no provider inference, worker deployment or external messages. No repository files changed. Eight individually fetched source/evidence files are retained only under `/tmp/argo-mesh-source/`, not copied into ARGO.

**Recommendation:** reuse the bounded trace-coordination pattern inside separately isolated build attempts. Keep ARGO's transactional board, lease fencing, owned worktrees, exact candidate gates and Git integration as the build authority. **Do not share this JSONL store between simultaneous builds or processes.** Its TELOS adapter admits proposal traces; it grants neither ARGO merge permission nor fictional-world authority.

## Source identity and status

- PR: https://github.com/dsmcewan/TELOS/pull/205
- Pinned head: `acc61c2abcf3611d2b3f7c7b03d59d493316f292`.
- PR metadata independently fetched through the GitHub connector: **open, draft, unmerged**, head exactly matches the requested commit. Base: `52787e7ff73d109cf844f4bc2eb5d5cabd2a82f5`. PR metadata retained in `/tmp/argo-mesh-source/pr-metadata.json`.
- All eight fetched UTF-8 contents were checked against their connector-reported **Git blob SHA-1**, then independently SHA-256 hashed. Full manifest: `/tmp/argo-mesh-source/source-metadata.json`. This verifies source identity, not runtime behavior or approval to merge the PR.
- ARGO integration observations refer to local baseline `140b644c0bb86f45141f23b7f00788aeae04e389`.

| Pinned TELOS path | Git blob SHA-1 | Content SHA-256 |
|---|---|---|
| `build-gate/trace-mesh/README.md` | `b84e2ef97fca1f86dc01ca5ce81105e0969edcab` | `3ca527cef37c4466276be4ddcd20d184ffabcaeead27547d5dda405f31d08c69` |
| `build-gate/trace-mesh/mutual-mesh.mjs` | `5eddd0d4a29325af9014cde76f91035b799be42e` | `e953f5e2a1cad14d3cffd04aba243bedc4c18318199e4ab6749a4282692d9b56` |
| `build-gate/trace-mesh/trace-store.mjs` | `15e6f914f017b4cba155a22954151ec969a111dc` | `dae2f94dd18836cdceecebbbbc7e24297c2f49cb51f46a17a06dc3643ab1a7c6` |
| `build-gate/trace-mesh/telos-gate.mjs` | `a1598d22cb61b944562112236bc9bfecd36cb4b9` | `b3ecb630fa23c7846399c0ae040315a80a9213583576cfda5756a0818c17343d` |
| `build-gate/scripts/test-trace-mesh.mjs` | `52fe9567307795dd7d202764ca57e70213bfcbaa` | `2b675e0203eb811084f33eddd29b32d530f3704de7209ce130618d8784ff9e06` |
| `build-gate/scripts/test-telos-trace-gate.mjs` | `9994767d8178b5c33d32e0cfc3feab352bbffbe4` | `aa1453fa75ec55a2d19172a150d3b5fe69ac3f5a7ba061195ae2624eeffbcb01` |
| `build-gate/scripts/test-live-trace-mesh.mjs` | `25aa5d04dc590d303d70a2e4b4b1858e95363405` | `be282e596d17bb5796941dbcc95bcb16550c3d0c21a5a267f05f34abead7f7ab` |
| `docs/runs/trace-mesh-first-slice/VERIFICATION.md` | `c8836601d606516bf31372562f72573a4d214885` | `f63d6b79a146b2da8d03b3f05b8233397166f3247669ad4c130d71d28c82adf7` |

Every TELOS locator below is relative to that pinned head, available at `https://github.com/dsmcewan/TELOS/blob/acc61c2abcf3611d2b3f7c7b03d59d493316f292/<path>#L<line>`.

## Exact coordination contracts

`deployMutualMesh({store,parentId,parentScope=null,scope,agents,criterion,lifetimeMs=5000,maxWrites=24,worldState=null})` requires three distinct callback agents and a host-owned `{id,check}` criterion. Lifetime is an integer 10..300000 ms. If `parentScope` exists, it first writes an outer-scope deployment `info` trace, then registers the child scope. Agents receive only scoped closures `read`, `write`, `escalate`, and polling `waitFor`. Their callbacks start through promises and run concurrently in **one JavaScript event loop**. After settlement or timeout the scope closes; the return contains scope, criterion ID, `completed|unresolved`, trace IDs, metrics and `settled|timed_out`. `completed` means all callbacks returned without the harness's error marker and `criterion.check(...) === true`; it is not a build certificate. [mutual-mesh.mjs:6–49]

`ScopedTraceStore({dir,gate,clock,monotonic})` requires a synchronous `gate.validateProposedStateChange` function even for a read-only experiment. `register` binds:

- scope: nonempty trimmed string, at most 180 JS characters;
- parent and exactly three distinct members: at most 100 characters each, parent excluded;
- criterion ID: at most 120 characters;
- finite future absolute expiry, and `maxWrites` in 1..1000 (store default32; harness default24).

The store rejects an already registered scope or an existing filename, derived as `sha256(scope)+'.jsonl'`. It does not reload an existing run. Actor names are trusted host/API identities, not authenticated network principals. [trace-store.mjs:14–38]

`read(scope,actor,{sinceVersion=0,includeSuperseded=false})` authorizes members or parent. Parent reads are blocked while active unless a real external escalation was accepted. Member reads set that member's seen watermark to the current trace count; returned rows filter version, supersession and expiry. `write(scope,author,...)` requires membership, live scope, remaining writes, a prior read and a seen watermark at least as high as the newest peer-authored trace. [trace-store.mjs:40–65]

The stored trace has `id,scope,author,type,payload,intensity,version,created_at,expires_at,supersedes,invariant_link,response_to`; type is one of `claim|contradiction|evidence|result|danger|info`. Payload must be a non-array object whose JSON encoding is at most4096 bytes. IDs are random UUIDs and versions are local consecutive trace counts. Referenced supersession/response IDs must already exist in that scope. Structured `payload.state_change` must pass the injected gate before append. Plain text never executes. JSONL append happens before the in-memory array update; monotonic timing is then added only to memory. [trace-store.mjs:50–78]

`escalateToGate` first persists a `danger` request trace, then calls the synchronous external receiver. A reply containing boolean `accepted` counts as a host-observed external reply; only `accepted:true` opens parent reads. Rejection or a thrown transport preserves the request trace. A peer's fabricated `danger` payload cannot update these host flags. Accepted receipt IDs and reply counters are returned/held in memory, **not durably recorded as a receipt event in this implementation**. [trace-store.mjs:102–118]

## TELOS authority is domain-specific

`makeTELOSInvariantGate({telosDir,lifecycleVerify,loadPlan,authorize,nowMs,onEscalation})` delegates to TELOS `readPlan` and `checkLifecycleAuthorization`. It accepts only `state_change.action === 'propose_node_delta'`, with matching `node:<node_id>` scope, node declaration, declared file, current plan hash and identical invariant link. File paths reject absolute paths, backslashes, NUL, empty/dot/traversal segments and `.telos`. It requires an injected lifecycle re-verifier and successful current authorization for the same plan hash. Success is explicitly `{ok:true,authorized_plan_hash,decision:'TRACE_ADMISSION_ONLY'}`. [telos-gate.mjs:6–46]

That adapter does not enforce ARGO ticket lease tokens, candidate SHAs, owned-path reservations or gameplay `Scope`. Its actor parameter is not used by the node-delta authorization function; peer membership is checked by the store. A TELOS build-plan signature is not an ARGO world-state or informed-consent credential. Reuse the **reverify-before-admission** pattern, not the TELOS certificate vocabulary as an ARGO authority shortcut.

External escalation defaults to `{accepted:false}` without `onEscalation`; exceptions also refuse. Neither adapter callback is awaited. Connecting an async board/service client directly would not produce the expected result; an ARGO adapter would need an explicitly reviewed asynchronous protocol and commit-time lease rechecks. [telos-gate.mjs:48–55; trace-store.mjs:69–71,114–118]

## Concurrency and durability limits relevant to simultaneous builds

1. **No shared transactional trace database.** Scope registration uses `existsSync`, local `Map` state and later `appendFileSync`; there is no exclusive create reservation, process lock, transaction, fencing epoch or cross-process version CAS. Two instances can both register before the first write, maintain incompatible watermarks/versions, then append into the same hashed filename. Even if individual append writes remain intact, the protocol is not transactional. Use a separate directory and store instance for each build attempt; never treat one shared JSONL location as coordination between builders. [trace-store.mjs:15,29–32,76–77]
2. **No recovery state machine.** Registration refuses old files; `readDisk` merely parses lines. There is no replay of membership/lease/seen/closed/escalated state, no fsync protocol, signed hash chain or partial-tail repair. Restart an interrupted attempt under a fresh identity and preserve its audit; do not call this durable exactly-once work. [trace-store.mjs:31–32,76,120–121]
3. **Cooperative timeout only.** Arbitrary callbacks cannot be forcibly stopped; a CPU-blocked event loop also delays the timeout. `criterion.check` and gate callbacks have no independent process deadline. Store time checks occur before gate invocation, with no second expiry check immediately before append; a slow synchronous gate can outlast the scope. ARGO process cancellation, monotonic lease deadline and resource controls must remain outside this harness. [mutual-mesh.mjs:26–48; trace-store.mjs:53–76]
4. **API separation, not confinement.** Narrow agent closures bind scope/actor, but raw store methods and filesystem access remain trusted-host capabilities. `readDisk` has no actor argument. Do not hand a model worker the store, audit directory, board DB or credentials and claim the parent embargo protects them. Host supervision may still monitor operational status and cancel work. [mutual-mesh.mjs:20–25; trace-store.mjs:80–81,121]
5. **Read acknowledgement is not proof of consumption.** `read` advances the seen watermark even if a caller supplies a cursor beyond the current version and receives no rows, or filters superseded/expired rows. An ARGO bridge should assemble and bind the actual supplied context; it cannot infer a model read or understood every trace from this watermark alone. [trace-store.mjs:44–48]
6. **Bounds and history views need a stricter integration schema.** The4096-byte cap covers `payload`, not the entire trace or optional metadata; `intensity`/`invariant_link` lack equivalent shape/size validation. Supersession may target any existing peer trace, and expiry still filters `includeSuperseded:true` final reads. Preserve full audit evidence independently of the visible working set, and do not let one peer's supersession become authority to erase a finding. These are gaps for an untrusted-worker integration, not claims that the reference promised an OS security boundary. [trace-store.mjs:57–65,74; mutual-mesh.mjs:47–48]

## What the inspected tests establish

The source contains **23** trace-store/harness test cases and **13** TELOS adapter cases. They exercise scoped roles, stale watermarks, payload/type refusal, supersession history, write budget, parent embargo, spoofed escalation, request-before-receiver ordering, TELOS scope/file/plan checks and trace-only admission. The signed fixture builds an Ed25519 proposal decision and verifies a clean lifecycle versus an injected later hold. [test-trace-mesh.mjs:13–118; test-telos-trace-gate.mjs:20–125]

`test-live-trace-mesh.mjs` starts the live runner with an empty environment and asserts exit2, `BLOCKED_NO_LIVE_SEATS`, available0. I inspected that source but did **not** execute the live runner or fetch credentials. The pinned verification document reports Node22/24 passes and an earlier0/4-seat blocker; those are source-reported CI results, not runs reproduced by this audit. Its PR-body14-test count is an earlier description; inspected head has23.

The timing metric is the minimum observed contradiction-to-peer reply delay, not a latency distribution or inference benchmark. The correction ratio is based on same-scope result references; ordinary accepted writes already require member authors and local references, so a1/1 result does not prove better correction retention than another architecture. External escalation count means observed boolean replies, not accepted mutations or persisted proof after restart. No cost, quality or throughput advantage over serial review is established. [trace-store.mjs:82–98; README.md:42–50]

## Proposed ARGO/Pantheon integration boundary

These are recommendations, not implemented features:

- **Concurrency comes from independent board tickets.** Claim dependency-ready tickets with disjoint owned paths and separate worktrees. Bind each mesh scope to a host-generated batch/ticket/lease-epoch/attempt identity and keep its audit separate. The three peers are bounded analysts under that attempt, not three new owners of the same code paths. ARGO's SQLite `BEGIN IMMEDIATE`, lease checks and locked states remain authoritative. [ARGO tools/board.py:129,191–202,459–493]
- **Keep Pantheon's own semantics visible.** Its `runOpenItem` has an internal board/ref/ship pipeline; `shipped` is not automatically ARGO Git `MERGED`. `assertFanOutIsOutside` restricts pipeline fan-out to depth0 intake; `assertSubagentProduce` keeps children within the parent's lease/produce set and depth limit. Do not describe a nested three-peer experiment as three independent throughput lanes or bypass this policy silently. Any new mesh stage requires explicit integration review. [ARGO pantheon/src/board/run-item.mjs:68–93,434–435,754–779; pantheon/src/role/seating.mjs:390–403,480–534]
- **First evaluation stays offline/read-only.** Use deterministic callbacks or permitted local fixtures, with provider transports disabled. An independent parent-owned oracle can evaluate trace format and source-bound findings; it cannot certify candidate code by peer consensus. Preserve exact source, candidate, gate-policy and attempt identities in evidence. No claim that named provider seats ran.
- **One actual target integrator.** Export worker output through the existing confined dispatcher/CAS/commit path and separately trusted controller. Do not elevate mesh `completed`, a `result` trace, TELOS `TRACE_ADMISSION_ONLY`, or Pantheon internal ship status into ARGO acceptance. Simultaneous construction still requires serialized target-head CAS; a sibling moving the base requires fresh rebase/verification. [ARGO tools/README.md:49–80]
- **Do not bypass the application-adapter gap.** Current board data validators cannot run arbitrary Node/application code. The mesh is not the missing D09/W14 parent-process oracle adapter. Use the separately trusted controller where authorized, or design that adapter before claiming automatic application acceptance through the board.

Before any integration claim, use disposable deterministic tests for two simultaneous disjoint attempts, cross-scope isolation, overlapping-path refusal, lease-loss process cancellation, late trace/artifact refusal, full audit retention, crash/restart handling and sibling-head conflict/retest. Test the final external gate and real accepted CAS handoff separately from the reasoning loop. These tests have not been implemented or executed by this source audit.
