# Dependencies after the shared session

The current milestone supplies a fresh ordinary mortal world, signed persistence, fixed-principal sessions and a trusted local JSON-line CLI. Dialogue, acquired knowledge, custody, travel, combat and resources share one history. [Implementation and evidence](README.md) distinguish source verification, final application acceptance and GitHub delivery.

The next work depends on the goal. The following is a dependency map, not authorization for paid calls, deployment or additional feature work.

## Longer persistent sessions

First address measured cold startup. The initial signed-store measurement at `120119c` took 74.1 seconds to open a verified 2000-event history, despite a warm contextual reply and commit taking about 551 ms. The [completed session run at `639d31b`](evidence/session-measure-639d31b/measurement.json) measured 358 ms for the injected contextual reply and signed commit, 74.4 seconds for cold opening, and 59.4 seconds for exact full replay at 2002 events. Both runs use one machine, a speech workload and injected clients; they do not measure provider latency or a general graph workload.

Set a restart budget, profile cold verification, then improve it while retaining exact signed prefixes, state hashes, tamper rejection and lost-acknowledgment retry behavior. History-bearing state hashes still grow with the journal. A trusted persistent checkpoint or different history/hash representation needs its own contract review; skipping verification is not a valid performance repair. Privileged rollback detection still needs an external expected cursor.

## Conversational play

The model adapter is connected to real scoped context and returns the actual validated injected client response. The demo intentionally supplies one fixed offline response. `resume` accepts structured JSON commands; it does not run a general NPC response loop or parse arbitrary player prose into mechanical authority.

The next integration is a bounded host turn workflow: one eligible addressed inbound, at most one NPC response, cancellation/freshness checks, authority acceptance before display, and explicit structured consent for any physical transaction. It must preserve exact retries on restart and refuse stale or revoked context.

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
