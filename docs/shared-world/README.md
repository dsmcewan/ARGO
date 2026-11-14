# One shared headless world

The new `shared-world/0.1.0` profile connects ordinary mortal dialogue, knowledge, item custody, explicit loans, travel, combat and resources to one actor registry, world clock and signed SQLite history. It starts fresh worlds; historical profiles and their frozen contracts remain unchanged. This milestone has no paid model calls, deployment, UI or automatic background agents.

**Local acceptance:** all ten groups passed at `dcfc4d9` in a read-only, network-isolated clone. [Verification record](verification.json) · [Complete gate](evidence/full-gate-dcfc4d9/gate-result.json) · [GitHub delivery](https://github.com/dsmcewan/ARGO/pulls?q=is%3Apr+head%3Aargo%2Fshared-world)

[Run the CLI](../../scenarios/tempted-fates/shared-world/README.md) · [Design](DESIGN.md) · [Frozen contract](../../SYSTEMS/shared-world-v1/CONTRACT.md) · [Plan](PLAN.md) · [Next dependencies](NEXT.md)

## Run a session

After `npm ci --ignore-scripts`, using Node 24.22.1:

```sh
node scenarios/tempted-fates/shared-world/cli.ts demo --dir /tmp/my-new-argo-world
node scenarios/tempted-fates/shared-world/cli.ts resume --dir /tmp/my-new-argo-world --actor hero
```

Choose a new directory outside the checkout. The demonstration commits seven events: addressed speech, an injected contextual reply, a separate loan offer, explicit acceptance, two night travel actions, and return of the lamp. It proves that conversation creates no loan, travel consumes two oil turns and 1200 seconds, an old exact acceptance retry cannot duplicate the transaction, and reopening/full replay reconstructs the same world. The CLI guide explains fresh custom initialization and JSON-line commands.

The demonstration's model response is a labeled offline fixture. The reusable model adapter actually builds a request from the character's nature, current scene, owner-authorized knowledge, received speech and private impressions; it does not select production dialogue from templates. It requires an injected client, permits speech or silence only, refreshes context around generation, and has no writer. This establishes request construction and safe integration, not live dialogue quality.

## Data and authority

| Surface | Responsibility |
| --- | --- |
| `@argo/contracts` shared-world types and guards | Closed, bounded DTOs; full rights scope, exact cursor and complete genesis identity. Authentication remains the host's responsibility. |
| `@argo/ledger` pure world rules and scoped projector | One authority for physical actions and knowledge acquisition; current actor views; shared scene facts distinct from private beliefs/impressions. |
| `@argo/ledger` signed SQLite worker | Atomic command, physical/epistemic result, request index and receipt; exact retries; concurrent writer preconditions; unseen-suffix verification for warm handles. |
| `@argo/session` | Fixed authenticated principal; current query/view; structured command preparation; signed receipt bound to the exact submitted request. |
| `@argo/interventions` shared-world model adapter | Bounded actor-specific context and an optional speech proposal; no canonical writes or implicit provider. |
| `scenarios/tempted-fates/shared-world/` | Source-pinned mortal seed, selected owner policy catalog, private initialization/resume and the offline demonstration. |

A room or environment is canonical shared state. Whether a character likes it belongs to that actor's impression, never a shared fact inferred from agreement. Owner knowledge is explicitly granted from a source-pinned catalog; arbitrary campaign secrets do not become everyone's context. Actor views bound their recent memory and report coverage rather than silently promising full-history recall. The full journal remains authority-private.

A loan policy is not an offer; an offer is not acceptance. The borrower must accept an exact offer hash. Promise and custody commit together, and failed or repeated commands cannot create partial obligations. NPC speech is attributed to its authenticated actor; addressed observers must be valid present recipients. Generated text is displayed only after an accepted exact-request receipt and a fresh permitted view.

## Verification and source identity

The exact source histories are retained through integration merges, not replaced with a single synthetic commit:

| Ticket | Final source | Verification |
| --- | --- | --- |
| SW-100 contracts | `186e052` (freeze metadata `15d49d3`) | 25 author tests; two independent contract suites, 29 probes; frozen source hashes. |
| SW-200 pure rules/views | `2c0c1c8` | 31 source tests; 25 independent probes. Review found an unconscious lender receiving return knowledge; repaired and unchanged probes rerun. |
| SW-400 model context | `dfed2b9` | 23 source tests; 17 independent probes including four injected vendor request formats. |
| SW-500 campaign seed | `31e8c42` | 12 source tests; 11 independent groups covering 24 seed combinations. |
| SW-300 journal/store | `2a2f02f` | 18 source tests; two independent suites, 20 groups, including actual COMMIT failure, writer races, lost acknowledgment and signed replay. |
| SW-510 session/CLI | `0d29515` | 10 source tests; two independent reviews, 16 probe groups, including ordinary-process CLI runs. |

Here “independent” means a separate native Codex reviewer, not a person or another vendor. These checks exercise ordinary-process controls as well as test-runner paths; they are bounded evidence, not proof against arbitrary malicious code. [Evidence index](evidence/README.md) preserves probes, failures, repairs, commands and hashes. Full application-gate identity is recorded above; exact-head GitHub checks and merge status are recorded in the delivery PR. The first integrated run at `83bc6c1` passed eight groups but timed out in the foundation group; [the failed run](evidence/full-gate-83bc6c1/failure.json) remains incomplete acceptance. The separate SW-520 Board ticket records [a bounded foundation-only timeout adjustment](GATE_BUDGET.md) at `0c4b102`, independently checked without removing tests or changing trust pins. Its submission was refused by the Board’s protected-policy check. The claim was released through `fail_claim` to actual READY and that batch is operationally retired; [its source/CAS record](evidence/SW-520-source-record.json) preserves the refusal. The subsequent full external gate passed all ten groups at `dcfc4d9`, preserving the six runtime source records and this policy-refusal record.

All six runtime source tickets use the actual blackboard, leases, disjoint worktrees and CAS. They stop at **VERIFYING** because the existing Board accepts data validators, not application changes. The application gate and reviewed GitHub merge are separate acceptance records; no Board MERGED status is fabricated.

## Performance and limits

The [first ordinary-process measurement](evidence/runtime-measure-120119c/measurement.json), at clean commit `120119c`, measured the signed store plus actual campaign model context before the session wrapper. At 2000 events the injected contextual reply and commit took **551 ms**, a single append **80 ms**, and a fresh verified handle **74.1 s**. Full replay of 2002 events took **69.5 s**. Those are one-machine observations, not service guarantees or provider latency. The [completed session measurement](evidence/session-measure-639d31b/measurement.json) at clean `639d31b` includes fixed-principal query/view/submit, five refreshed context reads and exact signed-receipt verification. At 2000 events its injected reply and commit took **358 ms**, a single append **119 ms**, and cold opening **74.4 s**. Full replay of 2002 events took **59.4 s** and exactly matched the saved state. Each checkpoint has one dialogue sample; variation between these runs does not isolate a performance effect of the wrapper.

Warm storage verifies only new suffixes and reuses privately registered immutable snapshots. History-bearing state hashes still grow with history; cold full replay remains expensive. The bounded DTO/RPC size limits apply to complete canonical state rather than silently truncating it. Snapshot caching does not supply an independent rollback anchor: a trusted external expected cursor is required to detect privileged history rollback.

The CLI is a trusted local operator tool. Its private directory contains the seed, signing key, controller identities and private world state. Selecting `--actor` or `--referee` is not remote authentication. Production authentication, entitlement, key custody, backup/recovery, live model behavior and hosting remain separate work.

The new profile covers ordinary mortals. Fate jurisdictions, lifespan gifts, the full narrator record and old character-state migrations still require explicit reviewed ports. The shared closure flag suppresses dialogue without ending physical play; it does not implement the whole Fate/anomaly kernel. General graph stores, component buses, voice and autonomous world simulation are not supplied by this milestone.
