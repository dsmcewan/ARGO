# Headless follow-up: storage, graphs and authority

## Actual baseline

| Component | Verified implementation / evidence | Implication |
|---|---|---|
| Audited LEXI | Python backend, SQLite at `data/LEXI.db`; SQLCipher when `DB_ENCRYPTION_KEY` is set. Static SQLModel/table/route extraction in `repo-audit/evidence/`; no verified deployed actor-belief graph. | Do not assume PostgreSQL, Neo4j, row-level tenant policies or an existing gameplay graph API. Source audit is not inspection of a live database. |
| ARGO | TypeScript, Node 24.22.1; signed append-only file ledger, canonical JSON snapshots/replay; asynchronous injected bridges and deterministic mocks. | Keep the working core in TypeScript. A graph index is a new projection capability, not an unannounced replacement for ledger authority. |
| Pantheon | JavaScript ESM; reusable vendor boundary in `packages/model-client`. | Python board/dispatcher code is orchestration, not a second rules engine. |
| Blackboard | New local stdlib Python/SQLite WAL coordinator. | `board.db` records build work, never fictional world truth. It is not LEXI's case database or ARGO's ledger. |

Evidence: `REPO_INVENTORY.md` LEXI route/storage section, `repo-audit/AUDIT_STATUS.json`, `ARGO_SYSTEM_BIBLE.md`, package manifests and existing tests at the baseline commit.

## Proposed graph contract — migration required

Use physically separate canonical and epistemic projection stores, each with one designated projector writer and a durable ledger cursor. SQLite files with explicit tables/adjacency indexes are a reasonable first implementation **proposal**, not a confirmed existing graph. Query callers receive a common projection checkpoint so independently advancing stores cannot silently mix prefixes. Never join LEXI's forensic case tables into a public campaign.

Canonical edges need `scope`, `edge_id`, subject/predicate/object references, `valid_from_tick`, exclusive `valid_to_tick`, `source_event_id`, causal references, and **recorded-from/to ledger sequence**. Valid-time intervals alone are not bitemporal: recorded sequence supplies the second, transaction-time axis. Prefer ledger sequence over wall-clock arrival for replay. A correction appends evidence and changes a new projection prefix; it does not rewrite old history.

Epistemic records need `claim_id`, `knower_id`, acquisition tick and sequence, provenance/event references, claim kind, source claim references, optional bounded confidence and explicit disclosure. Confidence describes a belief, not canonical truth. Rumor truth assessments belong to a separately authorized authority view and depend on evaluation time; `outdated` is not synonymous with `false`. Promises record speech or commitments; they do not prove performance or consent.

Keep `ScopedKGQuery` conceptually required to carry complete scope, authenticated viewer, requested valid time, ledger-prefix cutoff and projection checkpoint. Mandatory schema fields prevent missing context, **not forged context**: runtime authentication, entitlement and actor checks remain necessary. Never claim that a type system alone makes cross-tenant leakage impossible.

Map these concepts onto existing `Scope`, `KnowledgeQuery`, `IntentProposal`, `Observation`, `ClaimRecord`, `ProxyGrant`, causal/epistemic event envelopes and receipt provenance before introducing names. V1 `expected_head`/`expected_sequence`/`world_time` already provide causal preconditions. An `expected_state_hash` over a slice would be a new contract with explicit conflict semantics, not a renamed head hash.

## Single-writer boundaries

TELOS-authorized ledger append remains the only canonical mutation path. Canonical projector writes Plane A from events; LEXI's projector writes Plane B from committed observations. NPCs and interventions retain separate principals and scoped read surfaces; they emit optional proposals. Empty proposals and authority rejection before commit must have no canonical side effects. Cancellation or timeout after submission can race a successful commit; reconcile using the same proposal ID rather than assuming no mutation occurred. Transport sessions may be stateful; narration stays stateless regarding world truth.

Any secret disclosure, rumor transmission or promise becoming actor knowledge requires the authorized epistemic commit path. Delivery and observation need an explicit protocol: generating prose is not evidence the intended recipient heard it. Preserve idempotency across message retry and projection replay.

## Headless waves after the current baseline

1. Deep source/graph recon plus mechanics/license evidence; pin source commits and exact artifacts.
2. Propose versioned wire/graph schemas, authority rules and adversarial fixtures. Preserve v1 until a reviewed migration is accepted.
3. Implement ledger-compatible canonical and actor-scoped projectors. Run a deterministic generated workload of **10,000 events**, including custody contention, contradictory claims, explicit party disclosures and authorized clock jumps. Compare every sampled prefix with rebuilds and both graph hashes; retain generator seed and failing trace. This workload is planned, not already run.
4. Add bounded async pub/sub and headless mock agents, then test duplicate delivery, reordering, stale views, projector lag, lease loss, cancellation and solo/raid boundaries.

Persona prose, UI and voice wait behind these gates. Existing foundation adapters/scenario tests are preserved; their presence does not mean these additional graph/bus capabilities are implemented.

## Blackboard corrections to the supplied reference

- Seed definitions are insert-only and dependency order independent; validate missing dependencies/cycles before any mutation. Never `INSERT OR REPLACE` running tickets.
- Worker identity plus a fresh fencing token and unexpired lease are required for heartbeat, artifacts and submission. A reclaimed ticket gets a different worktree and token; its zombie cannot submit into the new attempt.
- Lock normalized path segments, not arbitrary strings. Reject absolute paths, traversal, aliases and reserved `.git`/`.board` ownership. Verification/review/recovery keep locks until resolved.
- Publish the bytes actually hashed, atomically; verify every CAS read. One blob may belong to many ticket attempts. Only accepted upstream output references are handed down.
- Capture trusted gate policy and immutable commit identity. Run bounded argv without a shell, confined outside the database transaction. A timeout/crash is an explicit recoverable state, not success.
- Cross-vendor review is stronger than unequal model names. Review may block a merge but cannot certify it. Actual integration needs target-head CAS, ownership checks, deterministic gate evidence and Git success.
- A hash chain detects altered history relative to a trusted checkpoint; it cannot prevent a local operator with database write access from rewriting the entire chain. Worker confinement and external checkpoint retention are distinct requirements.

The local CLI is an operator interface, not a network authentication service. Do not expose its database or supervisor commands to workers. Future provider adapters require separate credential isolation and explicit authorization; none is enabled here.
