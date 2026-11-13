# Concurrent offline Mesh builds

`mesh_dispatch.py` adds bounded concurrent builds to the existing blackboard. Each ticket has its own lease, detached worktree, immutable candidate and trace scope. One author writes only its owned paths. Three read-only peer processes inspect that exact candidate and exchange complete findings through at least two host-controlled rounds. Their findings remain advisory; the worker stops at **VERIFYING**.

This adapts [TELOS PR #205](https://github.com/dsmcewan/TELOS/pull/205)'s scoped coordination pattern at pinned commit `acc61c2abcf3611d2b3f7c7b03d59d493316f292`. It does not merge that draft, share its JSONL store across processes or reuse its TELOS-specific gate as ARGO authority. The [interface](../docs/mesh-builds/INTERFACE.md), [source audit](../docs/mesh-builds/source-audit.md) and [verification](../docs/mesh-builds/verification.json) state the exact scope.

## Try two local builds

From ARGO's repository root, prepare a **new** disposable directory:

```sh
python3 docs/mesh-builds/demo.py /tmp/argo-mesh-demo
node pantheon/bin/pantheon-mesh.mjs --config /tmp/argo-mesh-demo/mesh-config.json
node pantheon/bin/pantheon-mesh.mjs --config /tmp/argo-mesh-demo/mesh-config.json --offline
python3 tools/board.py --repo /tmp/argo-mesh-demo render
```

The second command is a dry run. The third runs deterministic Python fixtures, with two author slots and three peers per active attempt. No vendor/model calls or credentials are used. The config file alone cannot enable execution. Linux Bubblewrap with usable namespaces, Git and Python3.11+ are required; missing isolation fails closed. Node is needed only for the Pantheon edge.

The Python entry point exposes the same supervisor directly:

```sh
python3 tools/mesh_dispatch.py --repo /path/to/build-repo --board-dir /path/to/board \
  --offline --seat-model gpt-6-astra --worker-id batch-1 \
  --parallel 2 --max-tickets 6 --mesh-rounds 2 \
  --command-json '["/usr/bin/python3","/workspace/author.py"]' \
  --peer-commands-json '[{"id":"critic","command":["/usr/bin/python3","/workspace/peer.py"]},{"id":"counterexample","command":["/usr/bin/python3","/workspace/peer.py"]},{"id":"reconciler","command":["/usr/bin/python3","/workspace/peer.py"]}]'
```

Use a reviewed immutable seed and commands that exist in its committed base. `--parallel` accepts1–8 and defaults1; `--max-tickets` bounds total claimed attempts, including retries. Capacity is reserved before claiming. A normal failed job does not cancel independent siblings. Held paths and unmerged dependencies remain ineligible; the dispatcher returns instead of polling forever or merging to unlock them. All peers may run the same fixture executable; distinct peer IDs are required, and model labels are not proof of a provider invocation.

## Coordination and authority

Peers receive complete prior-round traces and exact ticket/epoch/base/candidate/spec bindings in `/inputs/mesh.json`. Outputs must echo the executing peer's identity and context. The host validates all three responses before committing a complete round. This round barrier deliberately replaces the prototype's per-write retry: no peer can acknowledge unseen traces, and same-round responses become visible together. Dissent and superseded records remain in the audit. Structured state-change requests are refused; narrative strings are inert.

The parent receives the final trace only after closure. Completed means the bounded protocol finished; it says nothing about code correctness. There is no author rewrite inside peer rounds. A new candidate needs a new lease/attempt and new review bindings. Trace paths under `.board/mesh-traces/<scope>.jsonl` are host-owned advisory evidence, not accepted dependency CAS artifacts. Traces have no reopen/crash-replay API; incomplete or externally altered files are not completion evidence.

Python alone owns Board calls, heartbeats, Git construction and artifact submission. Bubblewrap hides the board, credentials, host Git metadata and network from authors and peers. Peers receive a separate read-only raw Git materialization, preserving export-ignored bytes and safe internal links. Existing Board path locks and CAS checks remain unchanged.

One repository-common `flock` excludes another Mesh supervisor, even through a different linked worktree/board directory. Use one Board ownership domain per shared target; legacy dispatchers and arbitrary external Git commands are not governed by this Mesh lock. Maximum worker groups is `3 × parallel`; this is not a CPU/RAM/PID/disk quota.

## Cancellation and acceptance

Author timeout and whole-Mesh timeout are separate. The latter covers snapshot preparation, all peer rounds and final lease renewal. SIGINT/SIGTERM cancel the batch, stop admission and drain worker groups plus in-flight Board operations before the normal supervisor lock release. A transaction already submitting may legitimately finish as VERIFYING; cancellation does not imply rollback. Check the ticket's actual state before retrying. The Node edge gives Python60 seconds to drain before forced termination, and uses a separate whole-batch deadline. That grace is a transport failure bound, not a proof that arbitrarily stalled storage completes within60 seconds. A hard crash requires Board/lease inspection; never treat it as success.

The dispatcher invokes no verify/review/merge commands. For data fixtures, the operator can run the existing Board gates. If two siblings were built from the same base, merging A makes B's old candidate stale. Claim B again from the new base, rebuild and reverify; do not reuse its old gate result or blindly cherry-pick. For ARGO application code, the separately trusted full application controller still owns main integration. Serialize integration through one supervisor. This addition does not implement the general D09/W14 external-application acceptance adapter.

Live provider execution remains off. A future authenticated provider broker and transactional quota admission require their own implementation and authorization; running Pantheon's paid HTTP pipeline inside a networkless worker is not a supported shortcut.
