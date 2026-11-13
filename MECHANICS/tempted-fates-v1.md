# Tempted Fates ruleset 1.0.0

Normative source: `../SCENARIOS/Tempted_Fates.md`, with traceability in `../repo-audit/SCENARIO_REQUIREMENTS.md`. Ruleset ID `tempted-fates/1.0.0`. This is a deterministic integration seed, not a forced campaign script.

## Ruleset interface

`validate(proposal, principal, snapshot) -> void` rejects before mutation. `apply(snapshot, event) -> Snapshot` returns a new value with no I/O, wall-clock reads, model calls or unrecorded randomness. `replay(genesis, events, expectedHead?) -> Snapshot` verifies immutable identity, all signatures, chain/order, RNG and transition invariants before applying each event. Snapshot serialization is the `argo-json-v1` codec. The ledger's incremental snapshots must equal replay of each corresponding prefix byte-for-byte.

One tick is one second. Time balances, elapsed time, draw indexes and sequences are safe integers; overflow fails before append. Elapsing world time does not automatically debit lifespan or change age in this minimal ruleset. A later time model must version that behavior rather than silently changing old replay.

## Actions and authority

| Action | Required authority and deterministic effect |
| --- | --- |
| `advance_time` | Authenticated system principal; `to_time` strictly greater than current clock; update clock only |
| `move_item` | Current custodian is the proposal actor, directly authenticated or covered by a live proxy grant; recipient must exist or be null; destroyed items cannot move |
| `record_consent` | Authenticated living donor directly submits; confirmation ID must be in the gateway-verified receipt set; donor/recipient differ, recipient exists, units positive, expiry future, terms hash retained; never accept a narrator/proxy boolean as evidence |
| `revoke_consent` | Direct donor authentication, existing unused consent; record revocation |
| `transfer_time` | Donor or recipient directly submits an existing exact consent; donor remains alive, consent unexpired/unrevoked/unused, sufficient balance and no overflow; debit donor and credit recipient atomically and retain transaction record |
| `grant_proxy` | Direct grantor authentication; grantee exists, bounded resources/actions, nonempty half-open interval, positive max uses; proxy cannot delegate itself |
| `revoke_proxy` | Direct grantor authentication; effective immediately at this sequence |
| `observe_claim` | Authenticated actor or valid scoped proxy; observers exist, acquired time is commit time; party disclosure only within the declared party and observer membership; append epistemic record, never physical truth |
| `vanish_thread` | Authenticated system principal only, existing present thread; set absent and immediate exposition cutoff. Reserved for scenario fixtures/externally authorized rare events, with no production threshold, farming rule or automatic transfer trigger |
| `name_anomaly` | Only the independently authenticated Clotho actor; thread already absent; set engagement cutoff. This does not cause disappearance |
| `end_thread` | Only independently authenticated Atropos, present thread; set ended/alive false; no moral judgment and no power over an absent thread |
| `draw` | Authenticated system principal; derive and record one seeded draw. Public outcome carries only its blinded commitment; disclosure is a later authorized view concern |

Fate jurisdiction checks are explicit: Clotho concerns beginnings, Lachesis measure, Atropos endings. No sister inherits another's view or authority. Lachesis can inspect an authorized measure; she cannot donate someone else's time or supply consent. Fate proposal generation may return no proposal, and state writes always go through TELOS. An NPC/intervention principal cannot claim `system`, another actor's identity or another Fate's jurisdiction.

Consent and grants inherit the enclosing ledger scope. Consent authorization is bound to donor, recipient, amount, terms and confirmation receipt; the trusted gateway verifies the receipt against those exact fields. The foundation's receipt verifier is injected and defaults to denial. The schema is not proof of free choice. Proxies are limited to `move_item` and `observe_claim`; no proxy can authorize time gifts, consent or grant changes. Use counters increment on accepted actions only; revoked, expired, depleted, wrong-resource and wrong-grantee grants fail at commit. Refused actions append nothing.

## Randomness

Algorithm `hmac-sha256-u32-rejection-v1`. Seed is 32 private bytes in genesis, never a public room seed. For global draw index i and attempt j, HMAC-SHA256(seed, canonical({label,index:i,bound,attempt:j})); take the first unsigned big-endian 32-bit word. Reject words >= floor(2^32 / bound) * bound, otherwise value = word % bound. Bound is 1..2^31. Advance the draw index once per accepted draw, not per rejection sample.

Derive a private nonce as HMAC-SHA256(seed, canonical({purpose:'rng-commitment',index:i,label})). The public commitment is SHA-256(canonical({index:i,label,bound,value,nonce})). Replay recomputes values, nonces and commitments and rejects mismatches. Publishing a low-entropy value's unsalted hash would reveal hidden rolls by enumeration; the secret nonce prevents that. Neither rejected proposals nor narration consume randomness.

## Scenario boundary and required tests

Test Zero covers independent Fate jurisdictions; voluntary walking away/refusal; private solo claims not leaking into party context; hard acquisition cutoffs including equal-time sequence order; valid and refused donor transactions; retained custody; and deterministic replay. Gifts transfer measured time only: they do not rejuvenate, grant virtue, require a relationship, confer an achievement or promise happiness.

Disappearance and naming are separate causal commits. Disappearance blocks ontological exposition immediately for every persona and speaker. Naming by Clotho closes Fate engagement with the traveler. Ordinary work-related speech is still permitted. Queries against earlier timestamps, switching persona, asking a different sister and supplying adversarial explanatory prose must not reopen either boundary. Preserve consequences and gift records after the cutoff.

The integration fixture may establish a rare absent-thread condition through system authority. It must not introduce an automatic anomaly trigger into the runtime. The source's polished dialogue is illustrative; exact phrasing and seven-scene ordering are not required event sequences.
