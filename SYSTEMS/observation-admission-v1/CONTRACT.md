# Observation admission 1.0.0

This additive contract defines transient host authorization for **new** v1 `observe_claim` submissions. It leaves the frozen v1 schema, generated types, signed event grammar, receipts and historical replay unchanged. The policy version is `observation-admission/1.0.0`; it is not a new persisted epistemic profile. Phase A supplies contracts and pure guards only. The ledger admission integration is a separate reviewed step.

## Default and host boundary

Every new observation requires `proposal.proxy_grant_id === null` and `observation.source_id === proposal.actor_id === authenticatedPrincipal.actor_id`. A witness grant cannot override these author constraints. A caller reporting somebody else's words authors their own attributed account; they cannot supply that other person as the authenticated source. `rumor` and `external_account` do not create exceptions. This profile refuses new proxy observation submissions. Historical proxy observations remain subject to their original rules.

The callback-free default is exactly `observers: [authenticatedPrincipal.actor_id]` with `party_id: null`. Any additional/different recipient or non-null party requires an exact trusted host grant. Recipient arrays are ordered request data: no silent reordering, union, truncation, or insertion of the source is permitted. This profile bounds recipients to 1–64 distinct v1 identifiers. The frozen historical Observation grammar remains unchanged.

Existing private character carriers satisfy the default through their self-source/self-observer, direct system actor shape. There is no broad system-role or reserved-prefix exemption. Character replay retains its own exact configured service identity, private outer shape, request identity and inner admission checks. Passing this admission guard does not validate an inner character envelope. Ordinary-user marker lookalikes gain no character authority.

The host authenticates Principal and supplies the verifier capability outside model JSON. Role labels, scope strings, the existence of an actor, party membership, addressed names, requested recipients and model text are not witness evidence. The verifier must use trusted perception/disclosure information. This profile neither implements a spatial perception engine nor promotes an account to canonical truth.

## Closed host DTOs

The JSON grammar is `observation-admission.schema.json`; TypeScript types and guards are in `packages/contracts/src/observation-admission.ts`. References to v1 types are compositional and do not change those definitions.

`ObservationProposal` is a frozen v1 IntentProposal restricted to `action.type: 'observe_claim'` and this profile's recipient bound. `ObservationAdmissionCursor = {sequence, head, world_time}` uses safe nonnegative integers; head is null exactly when sequence is zero, otherwise a lowercase SHA-256.

`ObservationAdmissionAttempt = {attempt_id, issued_at_ms, deadline_ms}`. IDs use the v1 ASCII identifier grammar. The trusted authority creates a fresh unpredictable attempt ID for every uncommitted verifier attempt; a UUID is suitable. Millisecond values are safe nonnegative host-clock integers. The half-open authorization window is `[issued_at_ms, deadline_ms)` and lasts 1–5000 milliseconds. These numbers are transient host scheduling data, not world time or an independently authenticated clock.

`ObservationAdmissionRequest` has exactly:

```ts
{
  version: 'observation-admission/1.0.0',
  proposal: ObservationProposal,
  principal: Principal,
  attempt: ObservationAdmissionAttempt,
  request_hash: string
}
```

`request_hash` is SHA-256 of canonical `{domain:'observation-admission/1.0.0', proposal, principal, attempt}`. It covers every proposal field, the **complete** authenticated Principal including `confirmed_receipts`, and the attempt ID/window. Full scope, content, source, claim/proposal identities, recipient order, party, causal parents, expected head/sequence and proposal world time are thereby bound. Request validation recomputes this hash; it never trusts the supplied digest alone.

`ObservationWitnessGrant` has exactly:

```ts
{
  version: 'observation-admission/1.0.0',
  request_hash: string,
  attempt_id: string,
  deadline_ms: number,
  scope: Scope,
  cursor: {sequence: number, head: string | null, world_time: number},
  source_id: string,
  observers: string[],
  party_id: string | null
}
```

All grant fields must match the request: `scope = proposal.scope`; cursor equals `{sequence: proposal.expected_sequence, head: proposal.expected_head, world_time: proposal.world_time}`; source, ordered observers and party equal the observation; request hash, attempt ID, version and deadline match exactly. A changed principal, namespace, request, recipient list, checkpoint or attempt cannot reuse a grant. Grants are host-returned DTOs, not accepted from the submitting caller. `null` refuses the attempt.

`ObservationWitnessVerifier = (request, snapshot, {signal}) => Promise<ObservationWitnessGrant | null>`. Request and preflight snapshot passed to this callback must be detached and deeply frozen. The full snapshot is a privileged host input; it must not be disclosed to a worker, public route, log or narrator. Callback response data is validated before it is cloned or trusted. A boolean approval or permissive recipient echo is not this contract.

## Pure API

- `OBSERVATION_ADMISSION_PROFILE` exposes the version constant.
- `observationAdmissionSchema` exposes the deeply frozen JSON schema.
- `assertObservationAdmissionContract(name, value)` validates the named Proposal, Cursor, Attempt, Request or Grant DTO. It checks closed shape, passive data, scope consistency, cursor/window invariants and request hash as appropriate. Request validation also enforces direct authorship and rejects proxies.
- `observationNeedsWitness(proposal, principal)` validates the restricted proposal and authenticated-principal shape/scope, enforces direct authorship/no proxy, and returns false only for the exact self-private default. It does not establish actor existence, current state or party membership.
- `observationRequestHash(proposal, principal, attempt)` validates those inputs and computes the published identity without mutating them.
- `createObservationAdmissionRequest(proposal, principal, attempt)` returns a detached, deeply frozen request. It does not create attempt IDs, read a clock, invoke a verifier or append an event.
- `assertObservationWitnessGrant(grant, request, nowMs)` validates both DTOs, checks every exact binding and the half-open lifetime using the supplied safe nonnegative host time. It authenticates neither the callback nor the perception being asserted. An otherwise valid grant outside its attempt window throws `EXPIRED`; binding/author failures throw `UNAUTHORIZED`; malformed DTOs throw `INVALID_CONTRACT` (scope consistency uses existing scope errors).

All entry points reject accessors, proxies, symbols, cycles, exotic prototypes, unsafe integers, negative zero and sparse/decorated arrays before reading active values. Transient DTO traversal is limited to 32 nesting levels, 8192 visited values/container entries, and 1 MiB aggregate UTF-8 string/key bytes. Existing v1 content bounds also apply. These are admission transport bounds, not historical journal limits. Validating a caller-owned grant does not freeze or mutate that object; the runtime must detach the validated response before retaining it across awaits.

## Runtime algorithm required by this contract

The runtime integration must perform these stages in order:

1. Validate and detach proposal/principal. Start the bounded operation budget at call entry; it covers preflight, verifier work and relocking. Honor the caller's cancellation signal throughout. An explicit outer deadline, where the caller provides one, further shortens the budget; no stage can extend it.
2. Under the writer lock, re-read/verify durable history. Look up an exact committed retry **first**, using the existing full-proposal and authenticated identity checks. A matching committed request returns its original receipt without witness work; an altered retry conflicts.
3. Still under the lock, run cheap v1 state validation and the new author/default guard. Unknown actors, stale expected cursor, invalid causal parents, invalid party membership and forbidden sources/proxies fail before host work. A self-private request can append under the same lock after cancellation/current-state checks.
4. For a request needing witnesses, capture the exact validated preflight snapshot and release the writer lock. Create a fresh attempt. `issued_at_ms` is taken at this stage; `deadline_ms` is no later than both the remaining original call deadline and 5000 ms after issuance. Exhausted budget fails closed. Pass the detached frozen request/snapshot and a linked AbortSignal to the verifier. Bound the actual wait independently of whether the callback honors cancellation; a late response never resumes an abandoned submission.
5. Treat a returned grant as a **single-attempt, irrevocable authorization until its specified deadline**, subject to caller cancellation and the exact ledger cursor/party checks. Host policy changes at an unchanged ledger head are not observable by this protocol. A host unable to make that bounded promise must return null. General dynamic revocation requires a future persisted/versioned policy token, not an undocumented callback recheck.
6. Validate and detach the response. Reacquire the writer lock within the same remaining budget and re-read durable history. Repeat the exact committed retry check first: a concurrent identical submission may already have committed. Return that recorded result according to existing reconciliation semantics without spending twice or needing a replacement grant. An already-cancelled call still fails closed according to normal call cancellation behavior; it may have committed concurrently and must be reconciled by retry.
7. If no retry exists, repeat synchronous current state, source, proxy and party checks, then validate the saved grant against the same immutable request and current time. The proposal's expected head/sequence/time must still equal the durable state. Cancellation, timeout, changed prefix, invalid membership or expired authorization means no append. **Never call the asynchronous verifier while holding the writer lock.**
8. Sign and durably append the original unchanged v1 proposal/event. No grant fields are inserted into content, `authority.receipt_hash`, Outcome, or public views. Preserve existing durable-append ambiguity and idempotent reconciliation behavior if cancellation or I/O failure races commit.

The verifier's timeout is part of the original caller budget, not a fresh five seconds after each lock wait or retry. Current party membership is a necessary deterministic admission check; it never substitutes for a host grant. No lifecycle rules beyond the existing v1 rules are silently introduced by this containment profile.

## Existing worlds, replay and disclosure

The runtime default applies to every **new** observation submitted by the upgraded authority, in new or existing worlds. Omission of a callback means self-private only, never legacy permissiveness. Reopening without an earlier verifier cannot authorize outward delivery. Old events are not rewritten, deleted, relabeled or retroactively subject to the new author/witness checks. Exact authenticated retries of old accepted observations still return their original acknowledgment.

Historical v1 `validate`, `verifyEvent` and `replay` remain unchanged. A v1 event does not contain this callback's grant, attempt window or policy version. Its signature/replay proves the original v1 rules and signed bytes, **not** this admission policy or physical perception. Keep that distinction in API documentation, test names and release claims. Mixed old/new writer processes require coordinated host deployment; this transient policy cannot establish which version authorized an imported or old-writer event.

V1 Outcome remains an acknowledgment with its existing cross-namespace/authentication limitations; it is not a signed witness certificate. LEXI keeps existing actor/party/acquisition-time/sequence checks and cutoff policy. Old unsafe observations are not quarantined by this change. Existing v1 views retain their old full Observation shape; no new public witness metadata is added. CharacterView does not begin ingesting ordinary legacy claims.

Persisted signed witness evidence, complete receipt identity, legacy claim quarantine/import, dynamic policy revocation and a full successor epistemic profile remain separate dependencies. No new multi-event carrier or activation protocol is introduced here.
