# Authoritative mortal RPG implementation

This local candidate extends the Tempting Fates campaign with a versioned physical authority and reproducible balance experiments. The owner explicitly authorized combat, exploration and resource implementation after the earlier content-only pass, and selected **dangerous encounters with viable retreat** as the balance target. No paid model calls are part of this work.

Start with [playable rules and campaign adaptations](../../CAMPAIGNS/Tempting_Fates/ENGINE_RULES.md), the frozen [wire/rules contract](../../SYSTEMS/mortal-v2/CONTRACT.md), and the [balance results](balance/RESULTS.md). The selected classic d8 health rule met the preregistered dangerous/retreat target on separate training and held-out seeds. All 29,000 study trials replayed, and all ten application gates passed at `bb7c838252f320548d47c6c433b0eb429afd8e70`. [Verification](verification.json) records the exact sources, independent data checks and acceptance limits.

## Components

| Component | Files and responsibility |
| --- | --- |
| Strict contracts | `packages/contracts/src/mortal-types.ts`, `mortal.ts`, `SYSTEMS/mortal-v2/`: closed JSON schemas, safe passive input validation, identity/reference/capacity rules. |
| Pure authority | `packages/ledger/src/mortal/rules.ts`: deterministic command validation, resource accounting, turn order, seeded draws and state reduction. |
| Signed history | `packages/ledger/src/mortal/journal.ts`: genesis-bound signed events and receipts; replay verifies decisions, hashes, identities and random records. |
| Durable writer | `storage.ts`, `storage-worker.ts`: asynchronous parent API, SQLite WAL transactions in a worker, atomic deduplication, incremental verified replay and bounded history pages. |
| Disclosure | `view.ts`: exact actor whitelist, matching scope/controller and participant-only encounter summaries. |
| Campaign initialization | `scenarios/tempted-fates/runtime.ts`: deterministic fresh-world genesis, explicit variant/HP rule and starting kit. |
| Balance experiment | `scenarios/tempted-fates/balance/`: real-resolver policies, disjoint seed partitions, censored-outcome accounting and retained statistical evidence. |

The mortal authority remains inside the ledger package's existing write boundary. Its storage format is additive; it does not reinterpret v1 events or put physical actions in epistemic claims. New worlds must select exactly one authority profile. Existing character, narrator and Fate engines are not automatically connected to this journal.

## Host integration

Use Node 24 and the repository's locked workspace dependencies. `buildMortalCampaign(pack, options)` returns `{genesis, manifest}`. Options require the complete tenant/rights/workspace/campaign/world/branch scope (the rules profile is versioned separately), a private 32-byte hexadecimal seed, an Ed25519 public signing key and key ID, referee/NPC controller identities, an explicit variant and HP rule, and one to six travelers with their authenticated controller IDs. Persist the immutable genesis and manifest once; do not regenerate a world to reroll outcomes.

```ts
import {MORTAL_PROFILE} from '@argo/contracts';
import {openMortalLedger, viewMortalActor} from '@argo/ledger';

// genesis comes from validated campaign initialization; signer is a host KeyObject.
const ledger = await openMortalLedger({path: databasePath, genesis, privateKey: signer});
try {
  const state = await ledger.snapshot();
  const view = viewMortalActor(genesis, state, authenticatedPrincipal);
  const command = {
    version: MORTAL_PROFILE, scope: genesis.scope,
    request_id: durableRequestId, actor_id: authenticatedPrincipal.actor_id,
    expected: view.cursor, causation_id: view.cursor.head,
    action: {type: 'travel', route_id: 'r_harbor_market'} as const,
  };
  const receipt = await ledger.submit(command, authenticatedPrincipal);
  // Keep the signed receipt host-side; publish only an authorized actor view.
} finally {
  await ledger.close();
}
```

This is a host integration sketch, not a supplied authentication service. The host must derive the principal from trusted session credentials; accepting an arbitrary caller's principal object is impersonation. Stale state is rejected. A retry uses the exact same request and principal and returns the original signed receipt. Changed content under the same request ID is rejected. Call `snapshot()` again for a new action; do not replace the cursor on a retry.

Snapshots, raw events, signed receipts and genesis are **host-only capabilities**. Receipts can include effects concerning other actors. The seed, full history, variant and signing key must never enter narration or another player's prompt. `viewMortalActor` returns only the actor's own stores/discoveries/items and allowed local encounter facts. Its input state must come from verified authority, not untrusted JSON supplied by a player.

## Durability and trust limits

SQLite uses WAL and full synchronous commits. `BEGIN IMMEDIATE` serializes admitted writes; the request, event and receipt commit atomically. Reads and cryptographic work execute in the worker rather than blocking the host event loop. Startup verifies history once and subsequent operations verify appended suffixes. The store has bounded queues/pages/replies, a five-second SQLite busy timeout and a one-million-event ceiling. Close every handle.

The host protects the database path and signing key. Live caches assume already verified rows remain append-only; they are not protection against a privileged process rewriting the database. Reopening verifies the retained history. To detect replacement with an older valid prefix, persist a trusted `{sequence, head}` outside the database and pass it as `expectedHead` on open. A checkpoint kept only beside the data is not an independent rollback anchor. No callback or provider request runs inside the writer transaction.

## Evidence and build status

`TESTS/mortal-*.test.ts` covers contracts, authority, conservation, rejection without side effects, random-label stability, 10,000 seeded proposal attempts, signed replay, atomic retry, concurrent writers, reopen and campaign integration. Independent native-agent reviews add ordinary-process adversarial probes and crash trials. These are separate instances using the available model, not cross-vendor certification or human approval.

The experiment runs entirely offline. It exercises the actual pure resolver twice per trial and checks identical transition/final digests. Journal/storage tests separately check signatures and persistence. Training selects from preregistered alternatives; held-out results evaluate the frozen choice and cannot silently retune it. Reports identify code/data hashes, seed partitions, trial counts and uncertainty. Simulation findings do not establish human enjoyment.

Blackboard tickets RP-100/200/300/400/900 record file ownership and candidate artifacts. Contracts were frozen before the parallel runtime lanes. This repository's current Board policy is data-only and cannot certify new application code or update its own trust root. It specifically refused RP-900's workspace manifest change with `Candidate changes pinned gate policy`; its lease was released and automatic dispatch remains off. Application tests ran from an immutable disposable checkout; passing them did not mark tickets MERGED or authorize deployment. The local candidate, main's unchanged identity and exact final Board state are retained in [verification](verification.json) and [Board snapshot](board-snapshot.json).

Next dependencies are an operator-controlled application acceptance policy, host authentication/key/checkpoint provisioning, human playtests, and a unified migration design before connecting the existing Fate/character/narrator features to mortal worlds. No UI, voice layer, world import or paid overnight run is implied.
