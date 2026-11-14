# Session-based measurement runner review

**READY for the scoped static review. No blocking or correctness finding in the reviewed delta.**

Candidate: `897a2e36caf82331a2f7816b3d781e95913ea4ba`.
Comparison base: `120119c81c4e4562e5078b30f58390d364be13cb`.
Reviewed `docs/shared-world/measure-runtime.mjs`, the fixed-principal session call path and workspace/lock/ownership wiring. Source identity uses committed `git show` bytes; root's concurrent unrelated documentation edits are excluded. The reviewed paths were also checked unchanged against the candidate.

No repository edits, tests, benchmark, provider calls or subagents were used. This is not acceptance of the session/model/authority implementation and makes no execution or timing claim.

## Timing and call-path checks

- Runner lines60–61 construct one hero and one Melia session over the same writer. Session construction occurs outside the per-operation timing intervals; the aggregate host-workload event-loop histogram includes it, consistently with its existing broad attribution.
- Line76 measures `npcSession.view(currentQuery())`. The session checks actor/scope, obtains a fresh snapshot and calls the authenticated projection. The manual query does not bypass validation: `viewWorldActor` compares full scope/cursor and immutable direct principal. This interval now includes the session wrapper cost.
- Lines83/85 measure hero session submission and exact retries. `WorldSession.submit` validates the complete command, pins its captured principal, delegates to the single authority, verifies the signed receipt against pinned trust and checks exact request hash/identity. It intentionally does not refresh or rebase an old request before retry, preserving the authority's exact-retry-first behavior.
- Lines94–96 place `await npcSession.query()` inside dialogue timing, then generate and commit through `npcSession.submit`. The normal text path has five adapter refresh callbacks, each routed through `npcSession.view` (line92), plus the initial query acquisition. Session.query currently obtains an authenticated projection itself; that cost is included, not omitted. Final submit adds signed receipt verification inside the same interval.
- The model's returned actor/inbound/action cannot replace the session's pinned principal. The adapter remains proposal-only. The measured path uses the existing injected xAI client, not a live SDK; `modelCalls===1` is retained.
- No `session.prepare` latency is claimed: commands for the single measured hero append are authored explicitly, then admitted through session.submit. The output interface metadata accurately lists query/view/submit.
- Raw authority history filling remains at line70, and line127 explicitly identifies it. Host snapshots, cold handle opening, sibling suffix refresh, event collection and forensic replay remain underlying-authority measurements, not actor APIs. The phrase “measured actor reads” does not turn host snapshots into actor disclosures.
- These actor/session timings include more work than the earlier authority-only values. Preserve the new `interface` metadata when comparing results; do not silently present them as identical old measurements.

## Retained protocol and evidence checks

The change leaves alternating hero/Melia request IDs and memory hashes intact. Each even checkpoint N is followed by measured hero record N+1 and injected Melia reply N+2. Current-query acquisition sees the same latest cursor because this driver has no concurrent writer; the sibling only reads.

Cold sibling snapshots and post-dialogue snapshots still compare both full cursor and state hash. The measured single-event suffix snapshot still compares full receipt cursor and append receipt.state_hash outside its interval. Exact retries still compare the original complete receipt. The final forensic replay is still timed separately from the event-loop histogram, and full replay state is deep-equaled with the final writer snapshot.

Startup awaited Git checks still pin a clean HEAD before project imports (lines26–35); end checks still require the identical clean HEAD before recording results (lines117–120). The existing cold-handle/warmed-page-cache and whole-host-workload event-loop limitations remain accurate. These checks describe ordinary-process source provenance, not immutable filesystem isolation.

## Workspace and ownership spot check

- Root workspace globs already include `packages/*`, so no additional root workspace entry is necessary.
- `packages/session/package.json` exports `./src/index.ts` as `@argo/session` and declares its actual imports: `@argo/contracts` and `@argo/ledger`, both0.1.0. The session does not import model clients or storage internals directly.
- `package-lock.json` contains the linked `node_modules/@argo/session` entry and matching `packages/session` name/version/dependencies. The scenario manifest and its lock entry both declare `@argo/session:0.1.0`; the unrelated ajv reorder is only ordering.
- Ledger public exports reach world rules/view/journal/storage, including the session's `verifyWorldReceipt` and `viewWorldActor` imports. Intervention public exports reach the world adapter used by the instrument.
- `OWNERSHIP.json` adds the `session` lane for `packages/session/` with `writes_world_state:false`. This matches the implementation's delegation to the existing authoritative ledger; it adds no second journal or direct world-state writer. Existing authority ownership remains unchanged.

## Limits

This spot check does not certify npm installation, module-boundary enforcement, runtime races, session security, storage durability or numerical performance. No heavy checks were rerun during the benchmark window. Earlier instrument limitations still apply: one machine, limited sample counts, same-handle immediate retries, read-only sibling refresh, injected provider latency and no combat/resource load.

Exact source hashes are in `verification.json`.
