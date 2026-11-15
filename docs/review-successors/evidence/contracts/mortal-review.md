# Phase A mortal-v3 independent contract review

**Verdict: READY — no blocking contract or guard findings at `800f36152b57183f0ad7d460355f513e8056941c`.** The mortal-v3 schema/API freeze is consistent with design `a366d8e88ac2ea48abf493ac792c1ebe3bb3faa9` and the coordinator-approved additive activity_lock. This approves the reviewed mortal contract bytes; the coordinator still owns combined Phase A acceptance and runtime release. It is not a claim that the future v3 reducer, store or public view implementation already exists or passes its runtime gate.

Reviewed six added files in `/workspace/ARGO/.board/review-successors/worktrees/DR-201-1-762d914ba9`: v3 CONTRACT/FREEZE/schema, types, semantic guard module and tests. HEAD remained the named commit and the worktree stayed clean throughout review. Main reference was `7292ef71c6c96f6bcdcc82f0e3740f5e3b4b885f`; v2 files were read for inheritance and compared unchanged.

## Findings

No unresolved blocker found. No source changes requested.

The meaningful schema diff from v2, after replacing only version/URI identities, is exactly the new recover_encounter action, required fixed encounter site and turn token, and required nullable activity_lock. The existing physical DTO shapes and bounds are preserved. The new public types match these additions; versioned Genesis/Command/State/Event/Receipt/ActorView reject v2 values. Unversioned Principal/common physical shapes are honestly described as structural rather than falsely advertised as version-discriminated.

## What was checked

- **Authority and recovery binding:** command guards require null actor for begin/recover, direct actor identity for ordinary action shape, positive turn token no later than expected sequence, and current causation binding. Event guards match null/referee provenance to begin/recover, bind nested scope/version/order, and keep actual genesis-referee authentication explicitly in the future runtime. No reason or host_timeout label becomes authority.
- **Prefix and turn semantics:** encounter state requires token within its recorded prefix, fixed site matching the complete roster, complete unique turn order, and an active selected actor. Sequence zero cannot contain an encounter. The normative contract sets the token on begin and each new logical turn—including a wrap to the same actor—and leaves it unchanged on remote commits. Stale ID/token, closure, ID reuse and concurrent normal-turn recovery behavior are specified.
- **Round/time behavior:** ordinary pass settlement and referee pass are aligned; interior turns do not charge time, wrap/end charges six seconds once, close charges the pending round once using recorded participants. The contract expressly covers immediate close and close immediately after a prior round wrap, escaped participants, prepaid needs/death assessments, terminal bounds and no refunds/healing/loot/relocation. Remote activity affects only its own active clocks; shared world time and shared RNG ordering are explicit.
- **Exclusion and public reads:** full roster/site exclusion includes escaped, unconscious and dead members and site nonparticipants. The activity_lock gives only the viewer's own encounter/site lock reason; it neither reveals a remote roster nor pretends to predict all future action availability. Guards bind lock location to self location and require a matching roster lock for any visible encounter. Existing participant summaries remain closed and omit other actors' numerical HP/resources, seeds, rolls and referee reason. Extra private fields and foreign inventory are rejected.
- **Passive data and identity:** schema and semantic guards reject proxies before traps, accessors, hidden/symbol/exotic/sparse/cyclic data, unsafe numbers and unsafe IDs, and preserve bounded traversal. Genesis guard retains initialized clocks/HP/resources, known references, equipment, key shape and capacity checks without mutating input.
- **Version/storage boundary:** new receipt/RNG domains and table names are explicit; v2/mixed database refusal occurs before mutation. Fresh genesis is not a continuation/migration. The future implementation must retain verified transaction refresh, request deduplication, worker isolation, full input detachment and external-checkpoint limits. Existing v2 source/behavior is not silently changed.

These guards check wire consistency, not cryptographic signatures, authenticated principals, actual current state or actual ownership/locking. That boundary is documented and reflected in tests. A view factory must derive activity_lock from verified state; a reducer/store must implement the normative round and exclusion rules. Their absence in Phase A is deliberate, not waived runtime acceptance.

## Verification and frozen bytes

On Node v24.22.1:

```sh
node --test --test-isolation=none TESTS/mortal-v3-contracts.test.ts TESTS/mortal-contracts.test.ts
npm run typecheck
```

**23 tests passed, 0 failed/cancelled/skipped; typecheck passed.** Logs: `mortal-phase-a-tests.log` and `mortal-phase-a-typecheck.log`. Tests independently compile/meta-validate v3 schema, verify deeply frozen exports, check invalid DTO boundaries, and recheck both v2 and v3 freeze files. The schema-difference inspection and v2 source diff also showed no unintended inherited-shape change or modified v2 frozen source.

The reviewed v3 freeze entries all match their actual SHA-256:

| File | SHA-256 |
| --- | --- |
| SYSTEMS/mortal-v3/CONTRACT.md | b8cb9fc2202cacba73eb26198f3a2a94f4c73a259f1120855476ef8eb35af591 |
| SYSTEMS/mortal-v3/mortal.schema.json | 8cc7d1b9f5894adf4c5f22e8efb8172d2f474ab6a944add8cbb7fc87def757e0 |
| packages/contracts/src/mortal-v3-types.ts | 9540819917dc0f58a92793c2dd69baee8c029f99099f681ca79e713e6d390699 |

Additional reviewed source identities: FREEZE.json `b6d1a54983666913fb0928f9f80c0d33f7cd6f802122f0f1ba0fec0bcdf87a04`; guard module `5e4c4dc2ffd220b30f4d3e4a93ec885e39fbd18a42b0845adb441bf962c5d3f7`; tests `2a50622d7cb73f28f28b63515bab7a195fd27473672bebf593e7fb6d408e33f1`.

## Runtime acceptance still required

The upcoming runtime review must exercise real remote actions without encounter mutation, all site/roster dependency routes, escaped/site activity-lock projection, exact referee authentication, stale-token races/retries, close/pass needs/death edge cases, resource/time/RNG conservation, signed replay and restart, version-mixing rejection before SQLite mutation, and public-field withholding. Contract tests do not substitute for these executions.

No repository edits, spawned workers, provider calls or runtime deployment were performed. This peer did not certify combined integration exports, the other two successor contract lanes, production identity/perception, migration, live model behavior or full application-gate completion. Coordinator-owned public exports and final combined freeze review remain separate integration checks.
