# Authority and authenticated history — D01, D03, D04

Status: **proposal for semantic review, not an accepted ADR, frozen schema, implementation, or executed test result**. Source baseline: `41f2cb8568b53fac984e1114d7342eef540bb6d5`, read 2026-11-13. This contribution addresses R06, R12 and R13. Runtime and frozen contract files are unchanged. Proposed version names below are provisional; v1 bytes and historical signatures must remain readable without rewriting them.

## 1. Current guarantees and the three distinct gaps

| Source at baseline | What it actually guarantees |
| --- | --- |
| `packages/contracts/src/index.ts:13-42` | `canonical` admits null, booleans, strings, safe integers excluding negative zero, dense data arrays and plain data objects. Object keys are sorted by JavaScript UTF-16 ordering; string Unicode is not normalized. Accessors, symbols, unsafe keys, unsupported values and cycles fail. `hash(v)` is SHA-256 of UTF-8 `canonical(v)`, with no domain prefix. |
| `packages/ledger/src/mechanics.ts:86-87,112-128` | The Ed25519 signature covers canonical event data excluding top-level `hash` and `authority.signature`. The event hash covers canonical event data excluding only top-level `hash`, thus including the signature. Replay checks scope, ruleset, key identity, sequence, previous hash, signatures, causal parents, proposal uniqueness, authorization and RNG against the supplied genesis. `expectedHead`, when supplied, checks the terminal event hash. No genesis digest is in the signed event. |
| `packages/ledger/src/index.ts:36-65` | `openLedger` validates the supplied genesis and signing key, compares existing `genesis.json` bytes to the canonical supplied genesis, and repeats that comparison on reads. **This is an implemented protection.** A supplied/file mismatch is not the standalone import gap. |
| `packages/ledger/src/index.ts:70-111` | Submission authenticates the injected principal/scope, acquires the writer lock, replays current events, checks full-proposal idempotency and stable principal fields, validates, signs, appends and fsyncs the event, writes a derived snapshot, and returns an outcome. Exact retries return the old outcome without a new event. A timeout after append can leave a committed mutation. |
| `packages/ledger/src/index.ts:82-97`; `mechanics.ts:40-45,118-120` | `verifyReceipt` verifies **donor consent** for `record_consent`, with a five-second bound. The event records `hash(consent)`. Replay trusts that signed authority attestation; it does not rerun the external consent verifier. This is not an authority-outcome signature verifier. |
| `packages/telos-bridge/src/index.ts:7-14`; `mechanics.ts:130`; generated `Outcome` at `packages/contracts/src/generated.ts:35` | The bridge validates the outcome's shape and matches proposal ID, next sequence, world time, action type and causal/epistemic kind. Outcome has no full scope, full-proposal digest or authority signature. Its event hash alone does not authenticate a response. |
| `packages/ledger/src/index.ts:43-52,107-110` | Partial/noncanonical records fail; snapshot is derived and ignored as authority. Reads do not consult an independently trusted current head. A complete valid prefix can therefore omit a revocation. |

**D01 / R06:** a foreign outcome can match the limited v1 response fields. **D03 / R12:** unchanged signed history can replay under a changed, otherwise-valid untouched initial balance because the history does not commit to all genesis fields. **D04 / R13:** authentic genesis and valid signatures still do not establish that the supplied history is the newest committed prefix. A second local file cannot establish that freshness if it rolls back with the journal.

These findings and their deferred status are recorded in `REPAIRS/RESOLUTIONS.md`; `SYSTEM_ROADMAP.md:142-172,230,284` makes them separate decisions before W04. None requires treating the existing donor verifier or supplied/file genesis check as absent.

## 2. Shared proposed byte and trust contract

Retain `argo-json-v1` canonicalization as a **named, version-pinned codec**, including its rejection rules. Do not silently adopt `JSON.stringify`, Unicode normalization, floating-point numbers or a different map encoding. D02 must resolve identifier/map compatibility separately.

For the proposed v2 objects define exact bytes:

```text
C(x)          = UTF8(argo-json-v1 canonical(x))
B(tag, x)     = UTF8(tag) || one 0x00 byte || C(x)
H(tag, x)     = lowercase_hex(SHA256(B(tag, x)))
Sig(tag, x,k) = canonical_base64(Ed25519.sign(k, B(tag, x)))
```

Use fixed protocol tags shown below, fixed Ed25519, and an exact versioned payload schema; reject unknown versions/algorithms and malformed encodings. A `Signed<P>` object is `{payload:P, signature:<base64>}`. The signature is outside `P`; the signer key ID and all semantic claims are inside `P`. Verify canonical base64 decoding to exactly 64 signature bytes. No signature or digest includes itself. These are new domains; **v1 event hashes/signatures retain their existing algorithm**.

Trusted configuration maps an authorized complete scope and stable `ledger_id` to bootstrap trust roots, the accepted genesis commitment, permitted authority keys and the chosen rollback mode. A key offered only inside the response/import bundle is not a trust root. A proposed key identifier can be `ed25519-` plus SHA-256 of canonical SPKI DER; verify the actual key against an independently provisioned registry, not merely that the advertised key ID matches a self-supplied key. Preserve original genesis PEM text when hashing existing genesis; DER normalization is for key identity, not a rewrite of signed/history input bytes.

Trust assumes an honest authority implementation and uncompromised authority keys. Signatures cannot establish honest game adjudication after signer compromise. External storage rollback is a different attacker capability, addressed only by the selected D04 mode. Bootstrap authorization, key custody/rotation and the actual owner of any independent witness remain production decisions under D07/operations.

## 3. D01 recommendation: separate authenticated outcome receipt

Recommend a new response envelope, leaving the frozen v1 `Outcome` as its presentation payload during migration:

```text
SubmitEnvelopeV2 = {ledger_id, genesis_digest, history_epoch, proposal: IntentProposalV1}

AuthorityOutcomeReceiptV2 = Signed<{
  schema_version: "2.0.0", receipt_kind: "authority-outcome",
  codec: "argo-json-v1", signer_key_id,
  scope: complete ScopeV1,
  ledger_id, genesis_digest, history_epoch,
  proposal_digest,                       // H("argo.intent-proposal.v2", full submitted proposal)
  submitter: {principal_id, actor_id, role},
  previous_event_hash,                   // submitted expected_head
  outcome: OutcomeV1                     // complete object, no omitted fields
}>
signature tag = "argo.authority-outcome.v2"
receipt identity = H("argo.authority-outcome-receipt.v2", complete Signed object)
```

The full proposal digest covers the inner frozen proposal, including schema/ruleset versions, every scope field, expected head/sequence, world time, causal-parent array, proxy grant and the complete action; the receipt signature also binds the submit envelope's ledger identity fields separately. Do not hash only action type or ID; do not reorder arrays while computing identity. `submitter` binds the stable authenticated subject; transient bearer credentials and `confirmed_receipts` are not echoed. Consent obligations remain enforced by the existing donor-consent path before committing.

Proposed bridge verification order:

1. Authenticate the caller and select the expected ledger/trust policy outside model output. Validate and detach the submitted proposal/principal once; retain that exact proposal for hashing and retries.
2. Validate/detach the returned receipt; resolve its signer through the already trusted scoped key registry and verify `Sig`. Never fetch an arbitrary response-supplied key URL.
3. Require exact equality of complete scope, registered ledger ID/genesis commitment/epoch, full-proposal digest and stable submitter fields. Check `outcome.proposal_id`, `outcome.sequence == proposal.expected_sequence + 1`, `previous_event_hash == proposal.expected_head`, world time, kind and action type as consistency checks. All outcome fields, including event hash and RNG commitment, are signed.
4. Enforce the selected D04 assurance before accepting a newly committed result. A stable receipt authenticates an historical commit; it does not by itself assert the current head or current proxy authority.
5. Return only the verified presentation outcome to narration. Do not expose the complete ledger event as the receipt: it can contain private RNG records and authority-only data. Receipt possession never grants event retrieval, knowledge access or permission for a later action.

Do not put a response timestamp, current latest head or fresh network nonce in the stable receipt payload. Exact retries must retain the same proposal/commit identity. Persist the signed receipt or deterministically reconstruct it using the original recorded signing key; key rotation must retain verification material and a policy for serving previously signed receipts. A separately authenticated current-checkpoint response can carry freshness, without changing the original commit receipt.

**Alternatives:** authenticated transport plus an unsigned full-binding envelope can work when every caller trusts one pinned live endpoint, but offers no portable/offline receipt. Returning the full signed event reuses a current signature but leaks authority-only data; do not choose that as the public default. The separate signed envelope is recommended for remote reuse and exportable evidence, subject to bootstrap/key review.

**Retry/crash:** if append committed but the response was lost, resubmit the identical proposal ID **and identical full proposal**. Authenticate the retrying caller again; return the original receipt and do not reroll, append or reapply. Later revocation does not undo that historical commit, but an old receipt must never authorize another action. If a request changes action/recipient/scope while reusing the ID, reject it. Legacy v1 responses must not silently satisfy a v2-required caller; capability refusal is preferable to fabricated receipt fields. No v1 adapter may synthesize a signature from an event hash alone.

Retries retain their original submit-envelope identity across key/format migrations. Trusted configuration must retain authorized historical epoch/key mappings and idempotency records, or return explicit migration-required refusal; it must not silently retarget an old request to the new epoch and execute it again. Pending-commit treatment of independently expiring/revoked gateway credentials is a D07 policy input, not a reason to bypass current ledger grant/consent checks.

## 4. D03 recommendation: authenticated complete-genesis commitment

Recommend a private genesis commitment bundle and independently authenticated bootstrap manifest. This can wrap a frozen v1 genesis without altering its bytes:

```text
PrivateGenesisBundleV2 = {
  genesis_format: "argo-genesis/1.0.0", genesis: complete GenesisV1,
  commitment_nonce: <32 cryptographically random bytes, lowercase hex>
}
genesis_digest = H("argo.genesis.v2", PrivateGenesisBundleV2)

GenesisManifestV2 = Signed<{
  schema_version: "2.0.0", manifest_kind: "genesis",
  codec: "argo-json-v1", signer_key_id, ledger_id,
  scope: complete ScopeV1, genesis_digest, genesis_format,
  ruleset_version, history_format, history_epoch,
  authority_key_ids: [...], rollback_policy_id,
  predecessor: null | <explicit reviewed migration binding>
}>
signature tag = "argo.genesis-manifest.v2"
```

The commitment covers every initial actor/item field, parties, clock, seed, scope, ruleset and authority key—not a hand-selected subset. The nonce blinds a public commitment against guessing low-entropy private state; it is private alongside genesis, **not a freshness anchor**. Public clients may verify the manifest without receiving the seed/nonce/full genesis. Authorized import/rebuild workers receive the complete private bundle through a protected channel and recompute the digest. A hash is not encryption; do not export private genesis just because its digest is public.

The manifest signer must already be authorized to establish that scoped ledger. A self-signed manifest whose key is obtained from the same untrusted bundle proves only internal consistency. `ledger_id` is allocated/registered once at authorized bootstrap. Changing the ID, genesis, epoch or rollback policy is a migration requiring fresh trust authorization, not an importer's automatic escape from a mismatch.

For new signed history, propose `LedgerEventV2` with `ledger_id`, `genesis_digest` and `history_epoch` inside the unsigned event body, alongside the existing scope, ruleset, sequence, previous hash, proposal, authority identity and private RNG record. Sign that body with tag `argo.ledger-event.v2`; hash the complete signed body, excluding only top-level `hash`, with tag `argo.ledger-event-hash.v2`. At sequence zero the trusted manifest authenticates genesis even though the event head is null. A trusted expected terminal head then commits to that genesis for v2 history. These are identity guarantees, not freshness guarantees.

Proposed `authenticatedReplay` verifies the trusted manifest, recomputes full genesis commitment, checks redundant scope/ruleset/key bindings, then verifies the selected event format and expected terminal checkpoint. Keep current `openLedger` supplied/file checks. Its supplied genesis must come from the authenticated bootstrap policy rather than being blindly taken from the import directory.

**Legacy compatibility:** retain original v1 events and hashes. An authorized migration attestation can bind the full private-genesis commitment, v1 terminal sequence/head and exact canonical journal bytes. Define the journal digest as SHA-256 of `UTF8("argo.legacy-journal.v1") || 0x00 || concat(UTF8(canonical(event) + "\n"))`; empty history contributes zero record bytes. The signer must verify an authoritative source before attesting. A new signature cannot prove that an already rolled-back legacy bundle was historically complete. Unattested v1 standalone replay remains useful for analysis but is labeled unanchored and cannot satisfy authenticated-import assurance.

Two migration implementations need review: (a) authenticated sidecar manifests around immutable v1 segments, or (b) an explicit v1-to-v2 transition record with predecessor commitment and continued sequence numbers. Do not rewrite old signatures, silently restart sequence zero, or invent an import manifest from whatever bytes happen to be present. A full ledger-format migration is preferable before long-term exports, but the sidecar route can deliver bounded compatibility sooner.

## 5. D04 alternatives and conditional recommended anchored protocol

The production choice is **unresolved**. Declare the chosen policy in trusted ledger configuration/manifest; request callers cannot downgrade it.

| Mode | Assurance and cost |
| --- | --- |
| `trusted_storage` | Current bounded assumption: the private journal and bootstrap inputs are not maliciously rolled back. Signatures detect edits/invalid chains, not removal of a complete valid suffix. Restore is privileged and quarantined until reconciled. No rollback-resistance claim. |
| `anchored_linearizable` | Recommended if detecting every acknowledged revocation rollback is required. An independently administered monotonic witness binds each committed sequence/head. Writes stop when that witness cannot be consulted/advanced. Extra latency and a new availability dependency are deliberate. |
| Batched witness / local sidecar | A batch leaves an explicit rollback window after the last witnessed commit. A sidecar, another database table, another Git ref, or a key/checkpoint restored with the journal is not independent. Neither satisfies the stronger per-commit guarantee. |

An independent witness means a distinct trusted rollback/control domain with separately controlled durable state and authorization. A different file path or service name is insufficient; common restore credentials or a common rollback mechanism defeat the claim. The authority process/key remain trusted. The witness detects rollback/fork relative to its retained state; it does not prove the signer obeyed gameplay rules or restore missing event bytes.

Proposed witness records are keyed by **stable registered ledger ID**, not by an attacker-selected epoch. Each point binds `{ledger_id, genesis_digest, history_epoch, sequence, event_hash}`. Initial sequence zero binds the authenticated genesis and null event head. Epoch changes require an authorized migration linked to the old terminal point; they never reset the witness's history silently.

For each ordinary advance the authority signs a `CommitLinkV2` payload containing those identity fields, `previous_event_hash`, next `sequence`, `event_hash` and `signer_key_id`, with tag `argo.commit-link.v2`. The witness authenticates the authorized signer and accepts only an exact next-sequence/previous-head CAS. Same point is idempotent; a conflicting point at an existing sequence is refused. The witness need not receive full proposals, private rolls or genesis. This trusts the authority's signed statement that its link matches its durable event.

Witness `ReadCurrent`/`Advance` responses use a separate trusted witness key and tag `argo.checkpoint-response.v2`; their signed payload includes the caller's fresh random `request_nonce`, ledger identity, current point and any requested historical commit point. The service provides a linearizable current read; signatures alone do not make an old checkpoint fresh. Never accept a cached old response with a different nonce. Retain authenticated per-sequence points or an explicitly specified inclusion-proof structure: a larger sequence alone is not proof that a particular receipt's event is an ancestor.

Conditional commit protocol:

1. Under the existing world writer discipline, authenticate genesis and obtain a fresh witness point. Replay local signed bytes. If local history is behind or conflicts with the witness, quarantine it before processing a new action. One complete local next event beyond the witness is pending recovery, not a prefix on which new actions may execute.
2. Validate the proposal against the confirmed prefix. Construct one signed event and link; append the complete canonical event and fsync the journal. Abort checks before append retain their current meaning. After append, timeout/cancellation cannot promise non-commit.
3. CAS-advance the witness to the exact event. This is the externally confirmed commit point. Never advance before the event's fsync. A competing writer loses the CAS and must reconcile; local file locks alone do not serialize distinct hosts.
4. After verified witness confirmation, update derived caches and issue/return the authority outcome receipt. Only confirmed events feed authoritative projections or successful responses. Client timeout after step 2 leaves an uncertain operation; recovery uses the same event/proposal, never a newly generated draw or action.

| Interruption/state | Required behavior in anchored mode |
| --- | --- |
| Before durable append | No confirmed mutation; an exact retry may proceed after ordinary head validation. |
| Partial/torn local record | Fail closed and quarantine, preserving the current partial-tail behavior. Any repair/truncation tool needs a separately reviewed proof that no witnessed event is discarded. |
| Complete fsynced event; witness still at predecessor | Validate that exact pending next event and retry its CAS. Do not execute further actions or expose it as committed while the witness is unavailable. |
| Witness accepted; response lost | Fresh witness lookup of the exact sequence/head establishes success; finalize locally and return the original receipt without a second append. If the witness has advanced further, require the historical point/inclusion evidence. |
| Witness confirmed; snapshot/response missing | Rebuild caches from confirmed signed events and reconstruct/serve the original receipt. Snapshot remains derived. |
| Witness ahead; local bytes missing or older complete prefix restored | Refuse new actions, including proxy use. Recover verified missing bytes from a trusted backup/archive; a head hash alone cannot reconstruct them. |
| Equal sequence with different head/genesis; or unauthorized epoch reset | Fork/identity conflict; quarantine, never choose by timestamp or silently reset the witness. |
| Entire directory and local checkpoint rolled back | Fresh independent witness still detects the older prefix. If the witness was also rolled back by the same operation, the independence assumption was false and the stronger guarantee does not hold. |

In anchored mode, unavailable freshness also blocks operations requiring current revocation/presentation policy; an old verified view must not reopen cutoffs. Restricted diagnostic history is a separate authorized surface, not ordinary gameplay service. Recovery cannot simply delete an uncertain complete event to restore availability. If the witness retains only hashes, this design promises detection, not recovery/RPO-zero; protected event backups and private genesis/key recovery require explicit operations decisions.

## 6. Review decisions and implementation boundaries

Recommended direction is a separate signed receipt plus authenticated full-genesis manifest/new history binding. Recommend per-commit independent witnessing **only if** D04 selects rollback detection; until then accurately document the current trusted-storage assumption. Neither this proposal nor a local prototype selects a production witness or certifies independence.

Review must resolve: bootstrap/key registry ownership and rotation; receipt persistence and authenticated retry disclosure; exact v2 schemas/tags and D02 compatibility; legacy attestation authority and trustworthy migration source; private genesis/nonce/seed recovery; rollback mode and acceptable availability/RPO/RTO; witness ownership, current-read semantics, retention/inclusion proofs and epoch migration; multi-host writer fencing; operational quarantine/repair authority. W04 may implement only after those contracts are accepted. W11 must prove actual authenticated transport/key/restore operation later.

Negative cases are specified in [cases.json](cases.json). Every case is marked `not_executed`; none is claimed as a passing new gate. Existing source tests were inspected, not rerun for this design. This proposal changes no runtime, frozen schema, gameplay journal or deployment; its documentation ticket is tracked separately on the build board.
