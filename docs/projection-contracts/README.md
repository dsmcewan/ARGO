# Projection/query contracts — PC-001

This packet implements the additive `projection/2.0.0` local contract profile described by the [normative contract](../../SYSTEMS/proposals/headless-v2/CONTRACT.md). It provides closed JSON Schemas, generated TypeScript types, context-bound query guards, pure reference selectors and executable adversarial tests. It does not create a persistent graph, expose a service or migrate the signed v1 journal.

## What downstream builders can use

| Surface | Purpose |
| --- | --- |
| `assertProjectionContract` / `projectionSchema` | Runtime shape plus standalone invariants, or explicitly shape-only Ajv validation |
| `validateActorQuery` / `validateCanonicalQuery` | Bind requests to the exact checkpoint, authenticated host principal and current host policy |
| `buildActorView` | Select explicit actor acquisitions and party disclosures; strip private provenance; withhold claim text at current cutoffs |
| `selectCanonicalRelations` | Select valid-time/recorded-prefix relation revisions for privileged canonical readers |
| `adaptV1KnowledgeQuery` | Preserve v1 acquisition tick/sequence meaning in an explicit v2 request |
| `encodeIdEntries` | Preserve allowed ID strings using sorted unique data entries without unsafe object keys |

Exports are additive through `@argo/contracts`; generated type names start with `Projection`. Existing v1 callers and frozen bytes remain unchanged. See [INTERFACE.md](INTERFACE.md) for signatures and host requirements. V2's empty-claims cutoff and supported-genesis lower bound are explicit opt-in differences; no existing query is silently redirected.

## Evidence and execution

The [independent tests](../../TESTS/projection-contracts.test.ts) use real Ajv schemas and runtime functions. They cover missing/extra fields, bad IDs/intervals, foreign rights/actors/parties, mixed prefixes, delayed acquisition, private provenance, current cutoffs, historical revisions, malformed/accessor/proxy DTOs, bounded input and immutable output. They also enforce generated types and a separately pinned freeze-manifest digest plus its file hashes.

The earlier 111-case design catalog remains a future acceptance map. This packet executes its own named tests; it does not claim that all 111 cases, the 10000-event workload, crash-safe database publication or the general build adapter now pass.

```sh
python3 scripts/generate-projection-types.py --check
node --test TESTS/projection-contracts.test.ts
npm run contracts
npm run typecheck
npm run gate
```

Node24 native test IPC and Bubblewrap are required in the supported execution environment. Offline dependency versions are unchanged. Main integration uses the separately trusted controller and all ten existing check groups, including the expanded foundation suite.

## Trusted inputs and remaining work

The pure module consumes a host-provided authenticated principal, current policy and verified checkpoint/source rows. It checks consistency; it does not manufacture authentication, prove history ancestry or make a cached policy current. D01/D03/D04/D06/D07 retain their respective receipt, import, rollback, delivery and production-provider obligations. Projectors must verify actual source-event correspondence and physical write ownership; type fields alone cannot grant those capabilities.

W05/W06 can implement the initial canonical and epistemic projectors against this local profile after its freeze and application gate pass. They must retain the two-plane/single-writer design, transactional row/cursor updates, source validation and deterministic rebuilds. W07 supplies shared-checkpoint storage/recovery and scaled replay proof. No new licensed rules kernel is required for those local tests.

## Coordination and trust policy

[PC-001](PC-001.md) and its [immutable seed](seed.json) hold the sole root write scope in `.board/projection-contracts/`. Peer contributions are flat and isolated in temporary files; they do not possess leases or approve merges. The board's pinned Python gate verifies data structure and old freeze integrity, then integrates only the staging branch. Its MERGED state must not be advertised as a general application acceptance adapter or D09 completion.

The new test, fixture and generator files extend the controller's protected oracle inventory. They require independent policy review and supervisor adoption in a separate immutable trusted checkout. Main remains gated by the actual full application controller. [Progress](progress.md), [verification](verification.json) and [board state](BOARD.md) retain the distinct evidence. No SQL state editing, invented cross-vendor verdict, paid model call or deployment is involved.
