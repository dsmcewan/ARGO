# Startup and durable conversation

This continuation builds on the fresh shared-world profile. The startup optimization and durable conversation host have passed their separate source reviews. The explicit offline CLI and final integrated application acceptance are still in progress. No paid calls or deployment are enabled.

[Startup measurements](COLD_RESULTS.md) · [Turn contract](TURN_CONTRACT.md) · [Host source acceptance](SC-620_ACCEPTANCE.md) · [Implementation plan](PLAN.md) · [Checkpoint proposal](CHECKPOINT_BOOT_PROPOSAL.md)

## State and recovery

| Surface | Contents and authority |
| --- | --- |
| `world.sqlite` | Canonical signed commands, events, receipts and request identity. Only admitted world actions change physical or acquired knowledge state. |
| `turns.sqlite` | Private operational outbox for one configured player/NPC pair: exact pending commands, receipts, consumed generation attempts, cancellation and terminal outcomes. It cannot establish fictional truth. |
| Model context | Fresh actor-scoped scene facts, authored knowledge, received speech and private impressions. The model may propose speech or silence; it cannot commit it. |
| Player delivery | An exact committed reply selected again from the current player's permitted view. Cached model or outbox text is never a disclosure fallback. |

The host saves commands before dispatch and reconciles ambiguous acknowledgments using those exact commands. Closing detaches its wait on caller-owned ledger operations without pretending to roll back a possible commit. One canonical outbox coordinates generation attempts across handles and processes; losing an attempt's result produces uncertainty instead of automatic regeneration. Stable delivery IDs support consumer deduplication but do not promise exactly-once printing.

Dialogue preserves shared scene definitions while keeping individual impressions and acquired knowledge scoped. The model cache identity is stable across turns within the same world/player/NPC/policy binding and partitioned when that binding changes. No live cache-hit or character-quality claim follows from the injected response checks.

## Evidence and limits

The cold source `c4654d5` preserves existing state and signed-event hashes. At the measured 2,000-event speech history, verified opening improved from 74.37 to 13.88 seconds. Full replay at 2,002 events improved from 59.40 to 10.09 seconds. The under-ten-second opening target remains unmet. These are one-machine results with warm filesystem cache and injected responses, not live provider or cold-disk measurements.

The host source `0458268` has separate ordinary-process store and driver reviews. [Retained evidence](evidence/) preserves original failures, repairs, harness corrections and immutable source identities. Here independent review means another native Codex peer, not a person or different vendor. These are bounded verification results, not proof against arbitrary malicious code.

The actual source Board records remain distinct from application acceptance. SC-610 is VERIFYING; SC-620's manifest change was refused by protected policy, its one-attempt lease was retired through the public API, and its actual state is FAILED. CAS artifacts and independent source acceptance are retained; no Board MERGED state or controller trust promotion is fabricated.

Checkpoint boot remains a proposal requiring a new storage/trust contract. Current boot still verifies every event. Archiving alone cannot shrink the state's full memory history or supply an external rollback anchor. Fate/lifespan ports, historical-world migration, a general graph store/component bus, autonomous background play, UI/voice and live dialogue evaluation remain separate work.
