# Local projection contract profile 2.0.0

This profile defines an opt-in read/projection boundary over verified v1 history. It is not ledger format v2, a persisted database, a component bus or a deployed LEXI service. The exact wire grammar is [projection-v2.schema.json](projection-v2.schema.json); TypeScript structure is generated from it. The review/freeze record names the accepted bytes. Existing v1 schema, codec, ledger, bridges and callers remain unchanged.

## Identity and encoding

Every query and record has the complete v1 Scope, including its exact rights-qualified workspace tenant identity. No wildcard, omitted actor, cross-tenant alias or inferred public lane is permitted. Scope fields are validated semantically as well as structurally. Identifier strings retain the v1 ASCII/length grammar. Identifier-keyed data uses sorted unique entry arrays, preserving `constructor`, `prototype` and `toString` as scalar IDs; `__proto__` remains outside the ID grammar. Object-property safety stays unchanged. Do not rename old IDs or rewrite signed history to adopt this profile.

The runtime rejects accessors, proxies, symbols, cycles, unsupported prototypes, sparse/decorated arrays, unsafe integers and negative zero. Its descriptor preflight bounds depth to32, nodes to50000, aggregate UTF-8 string/key bytes to8MiB, and arrays to4096 before canonicalization/cloning. These are conservative local contract limits, not throughput measurements or network transport limits. JSON Schema's per-node bounds do not establish these aggregate guarantees. Identifier encoding accepts a bounded data-tuple array; no arbitrary iterator is consumed.

## Trusted context and internal metadata

`ProjectionReadContext` supplies a verified `CommonCheckpoint`, independently authenticated current `ReadPolicy`, authenticated v1 `Principal`, and `genesis_world_time`. These are host inputs, never fields taken from a caller's query or a model response. Missing current policy fails unavailable. The helper verifies complete scopes, actor binding, explicit party permissions, checkpoint identity, prefix/time bounds and current-policy consistency. It does not authenticate a service, verify signatures, prove ancestry, detect rollback or make a stale provider response fresh.

The hosting service must authenticate the principal, resolve its current entitlements and anomaly state, verify checkpoint ancestry/genesis provenance and hold the release ordering required by D06/D07. It must not reuse an old policy merely because its sequence is large enough. D01/D03/D04 remain prerequisites for their respective remote-receipt/import/rollback assurances. No context object can certify those facts by its own shape.

`CommonCheckpoint` binds both plane cursors to exactly one scope, sequence, head and world time. Zero sequence requires a null head; positive sequence requires a hash. Both plane names must match their slots. Cursors also identify their projector version, store generation and logical digest. These are internal records. Public requests carry only an opaque checkpoint ID; public views expose neither plane digest nor full journal/genesis/seed/roll material.

## Temporal records and selectors

Canonical relation revisions have half-open valid-time and recorded-sequence intervals; finite ends must exceed starts. A genesis source belongs to recorded sequence zero and names the checkpoint's genesis reference. An event source names the revision's recorded-from sequence and a hash. Original valid intervals survive later corrections through recorded revisions; overwriting a sole valid_to would corrupt historical answers. This profile supplies no correction command or authority to edit history.

The canonical selector requires a system principal AND an explicit canonical-read grant. It selects both intervals at the requested valid tick and checkpoint prefix, refuses multiple simultaneously active revisions of one relation, and returns deterministic order. Later retained revisions may be present in input but cannot appear in an earlier view. Valid-time queries outside supported genesis/current coverage fail; an open-ended interval does not authorize predictions.

Epistemic claims and acquisitions are separate records. Each acquisition names exactly one knower and explicit party disclosure, where applicable. An occurrence timestamp describes the reported occurrence; acquisition describes committed knowledge. Acquisition cannot predate genesis or exceed the checkpoint. Its source sequence equals acquisition sequence. At the known checkpoint tail, source hashes must equal the head and acquisition time must equal that tail's world clock. All references sharing a supplied sequence must agree in hash. These locally decidable checks supplement, and never replace, the trusted projector's verification of actual signed-event linkage.

Actor selection filters by authenticated actor, acquisition tick AND sequence, and explicit authorized party disclosure. Party membership does not union private records. The earliest eligible acquisition is chosen deterministically for each claim after audience filtering; public claims sort by ID. Missing referenced claims, contradictory source identities and duplicate record identities fail. Source actor IDs, observer sets and private provenance are not included in the public payload.

## Current disclosure and v1 compatibility

A historical data prefix cannot select an old safety policy. Current `engagement_closed` implies `ontology_blocked`; either cutoff yields an empty public claim list in v2. The underlying records remain intact, and privileged internal history remains separate. This deliberately conservative release rule avoids classifying prose to decide whether hidden ontology can be exposed. Mechanical ruling receipts and approved presentation paths remain outside this claim surface.

This is stricter than the existing v1 view, which carries claims plus current cutoff flags for its narrator. V1 is unchanged and is not silently redirected to v2. `adaptV1KnowledgeQuery` maps `as_of_world_time` to acquisition cutoff and `as_of_sequence` to acquisition sequence, using explicit request/checkpoint IDs. It does not reinterpret either field as physical valid time, authenticate the caller, certify a checkpoint or backdate knowledge. V2 additionally refuses requests before the supplied supported genesis time; callers must explicitly opt into this coverage rule. A new state representation is derived data, not a new signature over old bytes.

## Validation and reliance

`assertProjectionContract` applies wire shape and standalone semantic invariants; schema-only Ajv validation is intentionally insufficient for interval ordering and contextual authority. Query guards add trusted-context checks. Reference selectors build detached, deeply frozen output from validated inputs; they never write any ledger, store or event queue.

These guards are the shared contracts for the first local projectors. W05/W06 must still implement verified journal consumption, source-to-row correspondence, row/cursor transactions, physical write isolation, retained read transactions and common-checkpoint publication. W07 must still execute the seeded10000-event rebuild/incremental proof. This profile's unit/negative tests do not establish those future storage or concurrency guarantees. A transport must also enforce its own bounded decoding and authenticated provider/release protocol before production reliance.
