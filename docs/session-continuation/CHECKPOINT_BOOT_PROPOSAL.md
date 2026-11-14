# Crystallization checkpoints

Status: recommendation in response to the owner's checkpoint question, 2026-11-14. **Not implemented or enabled by this continuation.** Current boot still verifies every event. This proposal requires a versioned storage/trust contract before code changes.

Use a successful durable commit as the trigger. Prefer an encounter transition from open to closed, an explicit expedition checkpoint, or a periodic threshold (initially 512 new events) for long conversations that may not advance world time. The projector must have reached exactly the chosen committed prefix. A scene description, narrator declaration or NPC agreement cannot trigger or certify authority.

Snapshotting at a coherent prefix does not require every asynchronous NPC/model call to stop. Those proposals retain their original expected cursor and may be rejected as stale. No database transaction may remain open across model work. A background checkpoint job can coalesce later requests while it seals one immutable prefix; it must not freeze unrelated players while waiting for an absent worker.

## What is sealed

- Complete genesis and rules/profile identity; exact sequence, world time and event-chain head.
- Canonical physical state, custody, loans/obligations, clocks, RNG seed/counter and deterministic projection state.
- Actor-scoped acquired knowledge, impressions and temporal provenance needed to reconstruct authorized views. An archive operation does not remove those semantics or convert beliefs into shared facts.
- Snapshot encoding/hash and signed authority attestation, plus immutable archive chunk identities and a request/receipt index that preserves old exact retries and duplicate rejection.
- A separately bound recovery position for the private conversation outbox. Pending commands and consumed-generation/silence markers remain recoverable; they do not become world truth merely because a checkpoint exists.

The current state format contains the full memory history, so an ordinary snapshot of it still grows with history. Compacting that memory into a retrieval index is another versioned change, with actor/time/scope and full-history deduplication obligations. Event archiving alone cannot silently prune it.

## Trust and atomic publication

A trusted deterministic verifier establishes that the snapshot equals the admitted prefix, then signs/seals its exact manifest. A signature certifies its issuer; by itself it does not prove correct derivation. The checkpoint verifier, its key custody and trusted code/rules identity therefore need explicit definition. An LLM proposal or mutable hash next to the database cannot approve a checkpoint.

Write and verify the snapshot and archive chunks first, durably publish their manifest, then update an independently retained monotone reference to the accepted checkpoint. Only after publication is confirmed may the hot store retire archived payloads. Preserve a recovery path for crashes between these steps. Archive events remain immutable, privately scoped and available for historical queries, audits and full reconstruction.

Fast boot verifies the external checkpoint reference, manifest, snapshot identity and scope; loads the attested state and retry indexes; and deterministically replays the suffix. A lost or divergent acknowledged prefix fails closed. Restoring an older database, snapshot and colocated metadata together is still undetectable without the independent latest-checkpoint reference. No silent fallback to an older world is safe recovery.

## Acceptance before enabling

Prove `full_replay(seed, all_events) == checkpoint_boot(snapshot_N, events_after_N)` for physical and epistemic state, all actor views, RNG and exact retries. Exercise archive corruption, missing chunks, foreign scopes, changed rules, stale checkpoints, reordered/duplicate suffixes, every publication crash boundary and old-request retries after archiving. Preserve player privacy after closure/revocation and interrupted conversation recovery. Measure restart time at several history sizes; keep an ordinary full-replay audit mode.

This is the recommended route to booting from crystallized state while preserving the earlier record. The current byte-compatible repair already reduced the measured 2,000-event verified open from 74.37 to 13.88 seconds; its under-ten-second target remains unmet, as recorded in [COLD_RESULTS.md](COLD_RESULTS.md).
