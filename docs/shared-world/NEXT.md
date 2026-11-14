# Dependencies after the shared session

The current milestone supplies a fresh ordinary mortal world, signed persistence, fixed-principal sessions and a trusted local JSON-line CLI. Dialogue, acquired knowledge, custody, travel, combat and resources share one history. [Implementation and evidence](README.md) distinguish source verification, final application acceptance and GitHub delivery.

The next work depends on the goal. The following is a dependency map, not authorization for paid calls, deployment or additional feature work.

## Longer persistent sessions

The first startup repair is accepted. The [cold-reconstruction result](../session-continuation/COLD_RESULTS.md) records a verified 2,000-event handle open improving from 74.37 to 13.88 seconds and full replay of 2,002 events from 59.40 to 10.09 seconds. Existing signatures, deterministic transitions and state hashes remain checked, and the under-ten-second cold-open target remains unmet. These one-machine campaign speech measurements used injected responses and warm OS file cache; they do not establish live-provider or cold-disk latency.

Further work must preserve that verification and exact retry/corruption protections. The owner-requested [crystallization checkpoint proposal](../session-continuation/CHECKPOINT_BOOT_PROPOSAL.md) describes a possible separately attested prefix plus suffix replay; it is not implemented or enabled. It requires a versioned trust/storage contract, crash-safe publication, preserved actor history and retry indexes, and an independently retained checkpoint reference. A colocated snapshot cannot establish rollback protection, and archiving events cannot silently prune the current state's complete memory history.

## Conversational play

The accepted [durable turn host and explicit offline CLI](../session-continuation/README.md) add conversation for one fixed player/NPC pair. The [exact application record](../session-continuation/evidence/full-gate-fe17291/gate-result.json) proves the integrated checks; the [CLI guide](../../scenarios/tempted-fates/shared-world/README.md) labels fixture responses `offline_fixture`. Saved commands and verified receipts support restart reconciliation, while uncertain generation is reported without automatic regeneration. This does not parse arbitrary prose into physical actions or establish live model quality.

The host saves exact commands before dispatch, reconciles ambiguous commits without rebasing, consumes at most one durable generation attempt per turn in the same outbox, and selects display text only from a fresh player-scoped committed memory. Cancellation can suppress later generation/delivery but cannot undo committed speech. A generation attempt lost before its result is saved becomes uncertain rather than being regenerated automatically. Bounded configured provider-pool failover is distinct from one durable generation attempt; exactly-once HTTP calls or terminal printing are not promised. Physical actions and loan consent remain separate structured authority commands.

Evaluate varied situations: change an NPC's wants or opinion, withhold/revoke its policy, move a speaker away, introduce a refusal, and close the mythic context. Offline injected clients can verify request differences and response preservation. Testing actual coherence and character quality requires a separately authorized, bounded live-provider evaluation. No paid run or automatic agent loop follows from this document.

## Keep the context model precise

Shared rooms and physical facts have one canonical definition. Current structured occupancy and custody override static backdrop text, which may describe initial occupants. Day/night is selected at initialization; evolving weather is not implemented here. Attributed speech is an observation, not established truth. An impression belongs to its owner. Source-backed policy knowledge is explicitly granted to that owner and remains subject to revocation and time bounds.

The actor view exposes bounded recent memory with coverage information; it does not promise unlimited recall. A future retrieval policy needs explicit actor/time/scope semantics. Cache or token savings must not turn agreement, hearsay or one person's preference into shared canon.

## Separate later ports

- **Fates and lifespan transactions:** versioned shared-world actions, distinct jurisdictions, informed voluntary donor authority and post-anomaly disengagement tests. The current closure flag is not the full Fate kernel.
- **Existing worlds and character histories:** explicit migration and identity/provenance reconciliation. There is no automatic store merge.
- **General graph stores and component bus:** projection checkpoints, deterministic replay, scoped reads, idempotent delivery and backpressure. The shared runtime is not an implementation of that whole roadmap.
- **Remote play:** authentication, entitlement, private-key operations, backups and rollback anchoring precede a public service. Local `--actor` selection is a trusted operator capability.
- **Narrator, UI and voice:** consume validated receipts and permitted context; they acquire no independent world writer. The full all-campaign narrator record still needs a reviewed shared-world port.

Maintenance boundaries remain in [OWNERSHIP.json](../../OWNERSHIP.json): contracts, authority, autonomy, session and scenario owners. Root exports/manifests and acceptance records remain coordinator work. The source Board's real VERIFYING statuses must not be rewritten as application approvals.
