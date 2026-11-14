# Independent shared-world dialogue review

Candidate: `dfed2b980e73dc65f54b65f7db2468442117e415` at `/workspace/ARGO/.board/shared-world-foundation/worktrees/SW-400-1-87a18bad3b`.

**READY for scoped dialogue-adapter integration.** No blocking issue found. All48 named tests pass (23 dialogue plus25 contract);17 independent checks pass. Exact SHA and clean status checked before/after. Only the assigned two implementation files and dialogue test were added relative to frozen baseline `8ff20160fcd949a64e5e11c356d5de57d769983e`; freeze hashes match. No source edits, paid calls, nested agents or authority writes.

## Verified behavior

- Actual reusable-client request capture includes Melia's pinned policy terms, nature, current private presentation, focused received speech and her selected impression. Nature, incoming speech and shared backdrop definitions occur once. Source provenance remains selected and labelled as authored policy, not an accepted transaction. Another NPC's request carries no Melia policy or private presentation.
- Request bodies contain no full private pack, referee-truth prose, sample speeches, controller IDs, private seed, acquisition roster or host request IDs. Unrelated owned impressions are omitted. Third-holder custody-return payloads retain their redaction; raw full loan identity for an unrelated holder is refused before dispatch.
- Unaddressed overheard speech, consumed inbound IDs, absent/nonstanding interlocutors, nonstanding/busy NPCs and closure result in silence before obtaining the client. Static scene prose cannot establish a present recipient. The instructions explicitly give structured current occupants/custody/condition priority over authored initial-scene prose and distinguish owner opinions from shared facts.
- Full actor/rights scope and exact cursor bind the caller query and every refreshed view. Token-count barriers prevent dispatch after revocation, closure, cursor change or recipient departure. Generation-time and cooldown-success changes suppress the response. Cancellation during a suspended token count cannot start generation after cancellation resolves.
- Text/null output is used directly; no template substitution occurs. Additional speaker/reply/action fields, invalid JSON, excess text, tool output and invalid response completion fail. Commands retain caller-selected request ID and immutable actor/scope/expected cursor/inbound target; generated text cannot select an authoritative loan or mechanical action.
- All requests start with empty replay history and no previous response ID/tools. Response state is not carried into another call. Cache identity binds rights/world/branch, actor, genesis, authority profile and dialogue profile. An injected Google request preserves a700-token output cap; continuation is refused after one request.429 may use only explicitly configured alternate pools after rechecking context;400 does not retry or invoke a repair model.
- Context-byte bounds and passive query/view/call checks reject hostile objects without executing traps. Explicit LF, CR, U+2028 and U+2029 suffixes are rejected at both direct packet and model-command identity boundaries.

## Scope and limits

The independent fixture uses real pinned campaign profile/policy data in host-injected, contract-valid scoped views, plus injected provider responses. It does not establish that an actual ledger derives witnesses or authenticates those views. The `refreshContext` host must authenticate the fixed NPC and return the actual latest prefix. No isolated DTO/hash proves currentness. Concurrent uncommitted proposals still require the authority's full-history reply deduplication and optimistic cursor checks at commit.

Public facade integration, real shared-world witness acquisition, loan transitions, receipt-to-request binding, persistence, restart and replay remain later exact-candidate checks. Existing named tests include deadline/cancellation controls; no live latency, prose quality, factual fidelity or resistance to every quoted instruction is claimed. In particular, the static/current precedence instruction is present and recipient eligibility is enforced, but injected responses do not prove how a live model will phrase every scene detail.

## Evidence

- `tests.log`:48 named subtests,0 failures (`node --test --test-isolation=none TESTS/shared-world-dialogue.test.ts TESTS/shared-world-contracts.test.ts`).
- `probes.mjs`, `probe-results.json`, `probes.log`:17 independent checks,0 failures. Run `node probes.mjs <clean-checkout> dfed2b980e73dc65f54b65f7db2468442117e415 <output-dir>`.
- `melia-request.json`, `melia-packet.json`, `dion-request.json`: actual injected reusable-client requests and decoded context.
- `verification.json`: exact source/artifact SHA256s and review result.

Review-harness corrections are retained, not hidden: `probes.syntax-error.*` preserves an initial script syntax error before any probes executed; `*.before-error-match.*` preserves a scope check that correctly rejected with `SCOPE_DENIED` while the review matcher omitted that code; `*.before-newline-expectation.*` preserves a proposed newline-acceptance expectation that failed because the implementation already rejected it. The corrected probes explicitly verify rejection of actual line-separator code points. These were reviewer harness/expectation errors, not candidate defects; no candidate source was changed.
