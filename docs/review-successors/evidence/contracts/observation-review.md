# Phase A observation admission contract review

**Disposition: no blocking or material findings in the reviewed Phase A contract.** No Critical, Important, or Minor defect was established. This approves the contract's readiness for runtime implementation; it does not establish that observation ingress is already protected.

Reviewed final commit: `d5f02ad419900050d59b32f521823cbca6ba513e`, comprising contract/helper/test source `9f0d6da84212b14887568f466b6ff7826fa6a7bd` plus the freeze manifest and its test. Worktree: `/workspace/ARGO/.board/review-successors/worktrees/DR-221-1-86fc19daba`. Design reference: `/workspace/ARGO/.worktrees/review-successors/docs/deep-review/design/sequence.md`, section C and the Phase A execution requirements. The review was read-only; no repository files, index, or refs were changed, no agents were delegated, and no paid/provider calls were made.

## Contract and helper assessment

- **Default and sender identity:** `observation-admission.ts:72`–`:75` enforces matching proposal/principal scope, direct actor identity, source equal to proposal actor, and a null proxy grant. `:95`–`:98` returns callback-free admission only for exactly one self observer and null party. Recipient-only outward delivery and self-only delivery with a party both require a witness. Channel names and system role confer no exception. Actor/source existence remains the explicit cheap runtime state check, rather than a false claim made by a stateless guard.
- **Complete request binding:** `:77`–`:88` hashes the full immutable proposal, the complete authenticated principal including confirmed receipts, and the attempt under the profile domain; request validation recomputes that hash. Handwritten types match the compositional schema. `:112`–`:117` compares grant hash, attempt, deadline, complete scope, sequence/head/world-time cursor, source, ordered observers, and party. The half-open lifetime and maximum five-second attempt window are explicit.
- **Passive and bounded data:** `:32`–`:64` rejects proxies before inspection, accessors, cycles, symbols, unsafe property names, unusual prototypes, sparse/decorated arrays, unsafe integers, and negative zero. The admission schema restricts observers to 1–64 distinct IDs and closes request/grant/cursor/attempt shapes. Created requests are detached and deeply frozen; input objects are not silently frozen. Grant validation intentionally does not detach caller data, and the contract expressly requires the runtime to validate and detach the callback result before retaining it across awaits.
- **Lock, retry, and cancellation semantics:** the CONTRACT's eight-stage algorithm matches the design. Existing authenticated committed retries precede the new author/witness policy on both lock acquisitions. Cheap state validation occurs before the verifier. One bounded verifier runs outside the writer lock using detached frozen request/snapshot data. Relocking uses the original remaining budget and revalidates durable state, source, proxy, party, exact grant, time, and cancellation before append. Same-head host revocation is explicitly outside the grant protocol: the host must make a single-attempt, bounded irrevocable grant or refuse.
- **Replay boundary:** the CONTRACT repeatedly states that the grant is transient and absent from signed v1 events and Outcomes. Old replay retains its original rules; old unsafe observations are not repaired or relabeled; exact historical retries remain acknowledgments. Existing private character carriers receive no blanket privilege exemption, and ordinary legacy claims do not enter CharacterView. These are accurately scoped containment claims.

## Verification

`node TESTS/observation-admission.test.ts` passed **8/8** tests under Node 24.22.1, including freeze verification. An additional **20 offline checks** passed for full-field request/hash substitution, principal and scope changes, another-recipient-only delivery, the 64/65 recipient boundary, revoked proxies, sparse and symbol-decorated data, byte/container limits, and a one-millisecond attempt at the maximum safe integer timestamp.

The freeze test independently recomputed the pinned SHA-256 values:

| Artifact | SHA-256 |
| --- | --- |
| `SYSTEMS/observation-admission-v1/CONTRACT.md` | `be3e8c8958d51da90dbcdf9572a25738aca0ddcf7edfb3fe85a99b4dad8f9053` |
| `SYSTEMS/observation-admission-v1/observation-admission.schema.json` | `4b25665019544c8aa118f1421ab82f01b10c740aa85689b4de5ba09acbf8cfb7` |
| `packages/contracts/src/observation-admission.ts` | `066ea4e430acfd9aeb7ac9f578a860aa6b47db4aa5eed7815d29cfe573c3cb02` |

The reviewed commits do not change frozen v1 schema/generated types, ledger ingress, or historical mechanics/replay. Public package exports remain coordinator-owned integration work, as planned. The coordinator reported typecheck passing; this review independently reran the contract suite rather than repeating that check.

## Required runtime evidence, not current findings

The subsequent implementation still needs adversarial tests showing the verifier does not hold the writer lock; reentrant/concurrent work can advance the ledger; a changed prefix or expired/cancelled grant cannot append; a late callback cannot resume abandoned work; exact concurrent/historical retries reconcile first without another verifier; and private character carriers/replay remain compatible. In particular, keep new recipient/author/admission limits after exact historical retry recognition so an old accepted proposal outside the new policy still receives its prior acknowledgment, as the contract requires.

No runtime concurrency, signature, durable append, deployment, perception, or caller-authentication guarantee was tested or inferred from these pure guards. Existing v1 receipt limitations, legacy-claim quarantine, persisted witness evidence, dynamic host-policy revocation, and broader epistemic-profile design remain deliberately outside this Phase A review.
