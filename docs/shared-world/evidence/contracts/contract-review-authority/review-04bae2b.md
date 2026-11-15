# SW-100 authority contract review — initial candidate

**NOT READY for contract freeze/runtime release:** two reproducible nested/provenance binding defects remain. The architecture and declared transaction boundary are implementable; both findings are contained guard corrections. This is not a claim that any runtime exploit exists: no shared-world runtime is implemented yet.

Candidate: `04bae2b1f5ccb5f570ee76231efe3104b1309243`, contract worktree `/workspace/ARGO/.board/shared-world-contract/worktrees/SW-100-2-a51b1a9778`, parent `5fc58af1dffe8a2a5c464366cc9836242026c80e`. HEAD and clean status were checked before and after the test run. Review was read-only; only these external report/probe files were written. All seven changed files are new owned contract/schema/types/guard/test/fixture files; frozen earlier profiles and public exports are untouched. The four candidate FREEZE hashes match the immutable commit. See [machine-readable record](review-04bae2b.json) for exact source/evidence hashes.

## Evidence

The existing dedicated suite passed **20/20**: [log](contract-tests-04bae2b.log). Independent [portable probes](probes.mts) passed **6/9**, with three expected-refusal assertions reproducing the two findings below: [log](probes-04bae2b.log). Probes import the candidate's closed contract boundary and test fixtures, independently construct lifecycle and impression states, and mutate the supplied data. They exercise DTO guarantees; they do not pretend the constructed histories are signed committed runtime evidence.

Run from any directory:

```sh
ARGO_REVIEW_ROOT=/path/to/exact/candidate \
node --test --test-isolation=none /path/to/probes.mts
```

## C1 — supplied genesis is ignored for nested Resolution state

**Priority: P1 contract binding.** `packages/contracts/src/shared-world.ts:302` validates the resolution's state without genesis, then `:304` calls `bindGenesis('Resolution', ...)`. The latter has no Resolution branch (`:236` onward), and its top-level checks see neither `scope` nor `genesis_hash` because both are nested under `state`.

Reproduction 1: start with a valid offered state, change the physical hero's immutable `controller_id`, and wrap it as `{state,draws:[],effects:[],memory:lastMemory}`. `assertWorldContract('State', state, genesis)` correctly rejects it; `assertWorldContract('Resolution', result, genesis)` accepts it. Reproduction 2: change the complete scope/genesis and recompute the offer/memory identities so the foreign state is internally valid. State+genesis rejects it; Resolution+genesis again accepts it. Both failures are retained in probe tests 1 and 2.

This violates the advertised optional-genesis immutable binding and creates inconsistent producer/consumer boundaries: a reducer/journal lane using the natural Resolution+genesis check receives less protection than the corresponding State check. Bind the nested state with the same immutable checks when a genesis context is supplied; preserve passive validation and the latest-memory equality. No runtime trust/cache bypass is required.

## C2 — immutable profiles accept fabricated earlier impression nature

**Priority: P2 provenance binding.** `packages/contracts/src/shared-world.ts:144` rejects only future nature revisions; it compares nature content only when the impression revision equals the current profile revision. The actor-view counterpart at `:199` has the same permissive historical-revision logic.

Shared-world profiles have an immutable nature/revision and no action for updating nature. `CONTRACT.md` requires impressions to capture that immutable owner nature/revision. Nevertheless, a genesis with hero profile revision 3 permits an impression with revision 2 and arbitrary invented nature text. Probe 3 builds a valid acquired speech plus private impression, confirms the valid state, then changes only the impression's revision and nature; even `assertWorldContract('State', state, genesis)` accepts it.

Require exact profile revision and exact nature in this fresh profile's state and actor-view guards. Importing legacy historical-nature permissiveness without a historical revision registry fabricates provenance. Any future changing-nature feature needs a separately defined event/history binding.

## Strengths and passing independent checks

- The physical payload has no duplicate cursor/time/scope, and request/event/receipt domains are explicit. Memory and knowledge identities avoid enclosing-hash cycles. Exact request hashing binds the full command, cursor and principal while leaving authentication to the host.
- Loan policy, exact offer hash, lifetime status and obligations have explicit relations. Independent probes confirm policy revocation does not erase a durable offer, an expired offer no longer blocks a new one, and pickup can fulfill a dropped loan in one restrictive memory.
- Participant-only loan memory and the visible-memory omission of request/acquirer fields are coherent. The guard rejects unrelated recipients and raw host memory in actor views. Third-holder return redaction and travel endpoint suppression are explicit.
- Full-history NPC reply identity is independent of bounded view selection. Current reads, closure, immutable scene/catalog bindings, limits and post-dispatch ambiguity are documented rather than silently delegated to model behavior.
- Passive data guards reject behavior before traversal and account for encoded JSON bytes. The candidate correctly states that complete State validation is a cold boundary, that future trusted reuse must use exact private immutable object identities, and that accumulated-state hashing has history cost. No warm performance result is claimed here.

## Declined to judge

No reducer, signing/replay implementation, SQLite transaction, exact retry service, scoped projection constructor, model host or CLI exists in this candidate. This review does not establish current-prefix authenticity, derived witness correctness, actual caller authentication, cryptographic signature verification, atomic commits, live performance, external checkpoint persistence, production perception, paid-provider behavior or application acceptance. Valid shape is not verified state. Those are explicitly deferred runtime obligations, not additional findings against these guards.

The coordinator received both findings and is requesting contained fixes. Runtime remains held pending the fixed immutable candidate and independent rerun of the same probes.
