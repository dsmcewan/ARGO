# Independent SC-620 host review preparation

Status: **prepared, not executed against implementation**. The public API oracle is committed `docs/session-continuation/TURN_CONTRACT.md` at `2d6203de1bf16870714a2f2f07facd1a3d559e5d`, SHA-256 `d4380e49c08d6b7f0435114bc2d50ab516aca6b56684ad6aec6fb3e4da80a2ee`. Only `node --check probes.mjs` has run. No acceptance verdict is issued before an immutable implementation candidate.

The script is an ordinary Node program using `assert`, real WorldLedger worker/SQLite instances, authenticated sessions, and injected response/counter callbacks. It does not use `node:test`, provider SDKs, live accounts, network, product writes or Board APIs. It requires an exact candidate SHA and checks clean identity before importing product modules and after the run. Private temporary worlds, synthetic keys and crash-fixture files are kept under `/tmp` and removed; reports retain no keys/world databases. The ordinary child crash control writes stdout/stderr to private regular files rather than relying on pipe reporting.

Run after the coordinator pins the immutable candidate and installs its offline dependencies:

```sh
NODE_NO_WARNINGS=1 node /workspace/reports/2026-11-14-argo-continuation/turn-review-host/probes.mjs \
  --root /absolute/immutable/candidate \
  --expected-sha FULL_40_CHARACTER_COMMIT \
  --report /workspace/reports/2026-11-14-argo-continuation/turn-review-host/results.json
```

`--only NAME_SUBSTRING` limits an explicitly justified follow-up. Preserve original failures and distinguish harness corrections from product changes. The script emits per-group status and a JSON record containing the exact candidate and its own hash. It is separate evidence from the full native ten-group gate; direct execution must not be relabeled as that gate.

Prepared 19 groups cover:

1. Actual contextual output, fixed identities, immutable callback metadata, exact duplicate/restart and durable command before dispatch.
2. Player COMMIT followed by malformed signed acknowledgment; exact recovery after another event.
3. NPC COMMIT followed by malformed signed acknowledgment; exact recovery without another model call.
4. Pending irrevocable input plus cancellation while the submit surface is unavailable.
5. Two independent store handles, one attempt, and duplicate waiter abort.
6. Cross-handle durable cancellation and an abort-ignoring late response.
7. Host close during generation, late-result fencing, caller-owned ledger and another handle remaining usable.
8. Absolute deadline, late provider response, repeated resume and immutable attempt.
9. Stale generation plus an unrelated real world writer while the provider is held.
10. Closure after NPC COMMIT but before receipt delivery.
11. Player's 32-record window evicts a reply still visible to the NPC: no NPC-view/outbox fallback.
12. Cancellation during an asynchronous player read: no late display.
13. Intentional null versus malformed/retargeting/tool model output: no physical authority.
14. Getter/proxy input refusal, caller detachment and forged store capability.
15. Missing or valid-but-different signed prefix: no cached delivery.
16. Actual child process killed after entering generation: permanent marker and no second invocation after restart.
17. Actual journal-only rollback while the outbox retains the signed reply.
18. A different signed event occupies a saved reply's exact next slot: proved rejection without rebase.
19. Cancellation while token counting ignores abort: no subsequent provider call.

The later source review will independently inspect lifecycle/fencing, prefix proof, disclosure and passive-input paths. Store schema/COMMIT/permission/capacity internals belong primarily to the separately assigned store reviewer. These probes read the contract-defined private row only to establish dispatch and attempt ordering; they do not fabricate host rows to bypass the public driver.
