# ARGO handoff to Claude — 2026-11-14

The owner requested this catch-up after delivery. This document summarizes verified repository state; it does not authorize additional development or paid runs. No message has been sent to Claude automatically.

**Current baseline.** Read ARGO at `a218ee3e659cbfaadfa9cacbdfaa5889b3753409`, merged into `main` through [PR #6](https://github.com/dsmcewan/ARGO/pull/6). The local checkout at `/workspace/ARGO` is clean at that commit. Older reviews of `40f9476` and `0c24b32` remain historical evidence, not descriptions of this head. Do not assume all their findings disappeared: check each finding against its affected profile and current source.

**Delivery and evidence.** PR #6 merged at 19:05:10 UTC on November 14. The following GitHub runs succeeded:

| Verification | Identity | Evidence |
| --- | --- | --- |
| Complete local application gate | `fe172914c8b937b189f407d161b2ff71e0cdc531`, all 10 groups, 1017.394 seconds | [Committed gate record](https://github.com/dsmcewan/ARGO/blob/a218ee3e659cbfaadfa9cacbdfaa5889b3753409/docs/session-continuation/evidence/full-gate-fe17291/gate-result.json) |
| Branch CI | Final PR head `e3311bc08a8cebf0514b92c014be03eecb1f9cbb` | [Run 43628891377](https://github.com/dsmcewan/ARGO/actions/runs/43628891377) |
| PR CI | Same PR head; executed synthetic merge `e18f91e11c08fa5ec8046e84ec6a4e00bdf9bf31` | [Run 43628897326](https://github.com/dsmcewan/ARGO/actions/runs/43628897326) |
| Post-merge main CI | `a218ee3e659cbfaadfa9cacbdfaa5889b3753409`; completed successfully at 19:14:20 UTC | [Run 43630149363](https://github.com/dsmcewan/ARGO/actions/runs/43630149363) |

The final PR-head commit records documentation/evidence without changing the tested runtime, tests or gate from `fe17291`. The merged tree exactly equals the tested PR-head tree. Local main was synchronized, offline dependencies installed, and session/conversation/store/ledger/CLI public exports imported successfully. These are build and integration results, not deployment or proof against arbitrary malicious implementations.

**What can run now.** A fresh `shared-world/0.1.0` ordinary-mortal world joins speech, acquired knowledge, item custody, explicit loans, travel, combat and resources under one actor registry, world clock and signed SQLite history. The trusted-local CLI can initialize, resume and demonstrate this world. It is a headless local RPG substrate, not a completed hosted game or graphical application.

The earlier “no shared world” conclusion is superseded for this new profile. Historical v1, character and Fate/lifespan profiles remain separate; old worlds are not automatically migrated. The older `docs/review-successors/README.md` sentence saying the shared contract is still needed describes that milestone, not current head.

**What PR #6 added.**

- SC-610: private byte-compatible cold-reconstruction optimizations. Full signature, deterministic replay and hash checks remain. Measured verified opening at 2,000 events improved from 74.37 to 13.88 seconds; replay at 2,002 events improved from 59.40 to 10.09 seconds. The under-ten-second opening goal remains unmet. These are single-machine, warm-filesystem-cache observations with injected responses. They do not establish a dialogue speedup, cold-disk performance or improved asymptotic complexity.
- SC-620: `@argo/session` durable conversation host and worker-owned private SQLite outbox. `world.sqlite` remains canonical; `turns.sqlite` contains operational recovery state. Commands are saved before dispatch and retried exactly after ambiguous acknowledgments. One canonical outbox coordinates at most one durable generation attempt per turn. Losing its result yields `generation_uncertain`, never automatic regeneration. Cancellation cannot undo a possible canonical commit. Delivery is selected again from a fresh player-scoped committed view, never directly from cached model/outbox prose.
- SC-630: explicit `talk-init` and `talk` CLI modes with JSON-line `talk`, `continue`, `status` and `cancel` operations. They require a fixed player/NPC pair and bounded JSON fixture configuration, retain private files, and label outputs `offline_fixture`. No implicit provider discovery or calls occur. Output honors backpressure and failure.
- SC-640: a separately reviewed bounded gate-timeout adjustment after a preserved timeout failure. Foundation allowance is 18 minutes; whole-controller/external allowance is 20 minutes. All ten groups and their checks remain. No trust pin was moved or failing assertion removed to obtain acceptance.

**Dialogue and knowledge.** The reusable model adapter builds requests from character nature, current scoped scene facts, owner-authorized authored knowledge, received speech and private impressions. Production response construction is not template selection; the runnable offline CLI intentionally supplies fixed test replies. No live conversational-quality or cache-hit measurement has occurred.

Shared rooms and physical facts have canonical definitions. Each actor's liking, suspicion or belief remains their own. Agreement and hearsay do not establish shared truth. Current occupancy/custody overrides static backdrop. Actor memory views are bounded and report coverage; dynamic weather and unlimited historical recall are not implemented. Speech proposes speech or silence; it cannot accept a loan or perform physical actions, which require separate structured authority commands.

**Read these in order**, using this pinned commit if `main` later advances:

1. `AGENTS.md` and its required orientation files, then the latest-status paragraphs in `README.md`, `STATUS_AND_ARCHITECTURE.md` and `SYSTEM_ROADMAP.md`. Much of the older material is explicitly historical.
2. [Shared-world architecture and evidence](https://github.com/dsmcewan/ARGO/blob/a218ee3e659cbfaadfa9cacbdfaa5889b3753409/docs/shared-world/README.md) and `SYSTEMS/shared-world-v1/CONTRACT.md`.
3. [Continuation design](https://github.com/dsmcewan/ARGO/blob/a218ee3e659cbfaadfa9cacbdfaa5889b3753409/docs/session-continuation/DESIGN.md), then that directory's `README.md`, `TURN_CONTRACT.md`, `verification.json`, `COLD_RESULTS.md`, `SC-620_ACCEPTANCE.md` and `SC-630_ACCEPTANCE.md`.
4. [Actual CLI guide](https://github.com/dsmcewan/ARGO/blob/a218ee3e659cbfaadfa9cacbdfaa5889b3753409/scenarios/tempted-fates/shared-world/README.md).
5. [Next dependencies](https://github.com/dsmcewan/ARGO/blob/a218ee3e659cbfaadfa9cacbdfaa5889b3753409/docs/shared-world/NEXT.md) and [checkpoint proposal](https://github.com/dsmcewan/ARGO/blob/a218ee3e659cbfaadfa9cacbdfaa5889b3753409/docs/session-continuation/CHECKPOINT_BOOT_PROPOSAL.md).

Implementation entry points are `packages/ledger/src/world/`, `packages/session/src/`, the shared-world adapter in `packages/interventions/`, and `scenarios/tempted-fates/shared-world/`. Read their package exports before importing internals. Research/campaign source lives under `RESEARCH/`, `CAMPAIGNS/Tempting_Fates/` and `SCENARIOS/Tempted_Fates.md`; the campaign's voluntary choices, bounded Fate jurisdictions and post-anomaly disengagement remain binding.

**Optional offline reproduction.** Use Node 24.22.1 and an isolated checkout at the pinned commit. Install root dependencies with `npm ci --ignore-scripts`. Choose a new private world path whose parent exists, outside every source checkout:

```sh
node scenarios/tempted-fates/shared-world/cli.ts demo --dir /tmp/claude-argo-new-world
node scenarios/tempted-fates/shared-world/cli.ts resume --dir /tmp/claude-argo-new-world --actor hero
```

`demo` refuses an existing directory. It proves the labeled fixture conversation, a separate explicit lamp loan, travel/resource consumption, return, exact retry and signed restart/replay. Do not publish its private world directory, signing key, genesis, SQLite files or model-request capture. For durable conversations follow the CLI guide's fixture and `talk-init`/`talk` instructions. Full gate reproduction additionally needs Pantheon dependencies and Linux Bubblewrap; see the committed acceptance procedure rather than treating a shortened test command as equivalent.

**What remains.** Checkpoint boot is documented but unimplemented: current boot still verifies the full history. Recommended triggers are an actually committed encounter-close transition and a measured periodic-event threshold for long conversations. Implementation first requires a versioned trust/storage contract, exact snapshot cursor, crash-safe publication, preserved actor/retry/RNG history and independently retained rollback references. A colocated snapshot or signature alone cannot provide that guarantee; archiving events alone does not shrink the current full-memory state.

Other separate work includes shared-world Fate/lifespan and full-narrator ports, historical migration, general graph projections/component bus, autonomous background play, remote authentication/entitlement/key operations, UI/voice, and bounded live dialogue evaluation. Legacy v1 R06/R10/R12/R13 decisions remain in `REPAIRS/RESOLUTIONS.md`; newer profiles do not silently repair or migrate legacy histories. External vendor CLI readiness also remains unresolved; no installation or repair was performed from the owner's reported status check.

**Operational constraints.** Paid model runs remain off. Public repository delivery was explicitly authorized and is complete; that is not permission for a live deployment. Reviews were by independent native peers, not claimed cross-vendor reviewers. A source worker does not approve or merge its own work. Preserve original evidence and frozen contracts; use disjoint owned paths for subsequent work. Actual continuation Board states are SC-610/SC-630 `VERIFYING`, SC-620/SC-640 `FAILED` after protected-policy refusals and public lease retirement. Application acceptance is separately recorded. Never edit Board rows or call those tickets `MERGED`, and never move controller trust pins to bypass refusal.

**Suggested first response from Claude.** Confirm this exact baseline and the implementation/proposal distinction, summarize the outstanding dependencies, and identify any finding that still reproduces against current source. Do not automatically launch paid workers, modify archival evidence, or implement a new checkpoint/feature merely to catch up.
