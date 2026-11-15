# NPC dialogue branch review

Reviewed base `6ff1218d4d77834b5c640909ad6da9efd87f688a` through `724485df8af12a625d4019c5003ed0cee54b4347`. Source review was read-only. The supervisor was adding documentation and one provider-coverage test concurrently; no reviewed runtime source had changed when these probes ran. All provider calls below were injected offline functions.

No Critical findings. Two Important findings and one Minor finding follow.

## Important 1: recheck freshness and cancellation after token counting

Location: `packages/interventions/src/character-model.ts:65` and `:67`; supporting existing client path `packages/model-client/client.mjs:20`–`:21`.

The adapter checks `unchanged()` before entering `sendModelTurn`. The client then awaits an injected or SDK token counter before calling `exchange`, without another freshness or abort/deadline gate. A room disclosure can be revoked, the cursor can move, or the ontology cutoff can arrive during this asynchronous step, yet the stale prompt is still sent for generation. The post-generation comparison suppresses the returned command but cannot prevent the stale disclosure or unnecessary generation. This affects normal first attempts as well as failover attempts.

Reproduction: the first case in `probes.mts` changes `view.ontology_blocked` inside an injected OpenAI token counter and returns a valid count. `respond` returns null, but the injected generation transport is called once after the cutoff. The second case holds counting beyond a 25 ms deadline, observes `UNAVAILABLE`, then releases the count: the generation transport is invoked after the adapter has already rejected. Its signal is aborted, so a well-behaved SDK can refuse this late call; the adapter currently relies on that SDK behavior instead of stopping the call itself.

Recommended correction: introduce a bounded pre-generation hook after all awaited preparation/counting, recheck the full view and supplement there, and enforce the signal and absolute deadline immediately before exchange. Preserve the existing post-generation check. Add tests for a cutoff and supplement change during counting, and for count completion after cancellation/deadline.

## Important 2: explicit small caps retain the Google continuation loop

Location: `packages/interventions/src/character-model.ts:67`–`:70`; policy handoff at `packages/model-client/request.mjs:87`; supporting existing loop at `packages/model-client/wire.mjs:83`–`:112`.

The new explicit policy preserves the numerical cap on one Google request, but it is not carried into the prepared request or wire policy. A Google `CONTINUATION` response therefore enters the existing long-decode loop and issues another generation request with the full cap, potentially up to 16 requests. The dialogue adapter sees one successful `sendModelTurn` call, although the required one-generation turn and per-pool attempt bound have been exceeded. Freshness is not checked between those continuation requests. The cap is also reissued on every hop rather than enforced as an aggregate allowance.

Reproduction: the third case in `probes.mts` supplies a Google `CONTINUATION` with the first JSON fragment, followed by a `STOP` with the remainder. With `maxOutputTokens:32`, two generation requests are sent, each carrying cap 32, and `respond` returns a speech proposal. This is an offline protocol test, not a claim that a live provider normally emits continuation at such a small cap.

Recommended correction: explicitly select single-generation behavior for dialogue, failing closed on continuation, while preserving long-decode behavior for existing harness callers. Test that no second transport call occurs and that partial JSON is never accepted.

## Minor 1: mixed refusal and unsupported tool output is accepted

Location: `packages/interventions/src/character-model.ts:72`; supporting normalized result logic `packages/model-client/wire.mjs:33`–`:39`.

The dialogue check accepts any complete response whose extracted JSON text is valid and whose normalized `tools` array is empty. The Responses normalizer only recognizes `function_call` and `custom_tool_call`; it drops refusal blocks and other tool output kinds. Consequently a completed response containing valid dialogue JSON plus a refusal block, or plus a built-in `web_search_call`, produces a speech proposal. This violates the new interface's rejection of refusal/tool responses. It does not demonstrate that the adapter executes a tool or that ordinary providers emit such mixed output without tools configured.

Reproduction: the last two cases of `probes.mts` inject these mixed Responses payloads; both return `body.type === 'speak'`.

Recommended correction: preserve or validate output kinds/refusal state before extracting dialogue text, and reject any refusal or unsupported non-text output in this restricted task. Include mixed-payload tests; pure tool output is already rejected because it lacks valid JSON text.

## Verification and scope

Reproduce all findings with:

```sh
node /workspace/reports/2026-11-14-argo-npc-dialogue/review/probes.mts
```

Targeted suites passed directly under Node 24.22.1: character adapter 16 tests (including the supervisor's additional provider test), campaign projection 15, signed-journal integration 1, and output-budget 7. These passing suites do not exercise the findings above. The supervisor owns the full immutable offline gate.

Actor/query/cursor binding, selected private impression provenance, frozen detached DTOs, accessor/proxy rejection, Unicode speech limits, UTF-8 context/response limits, unchanged-context suppression after generation, distinct-pool failover, no submitted commands during generation, replay without a second model call, and absence of campaign referee/private/variant/sample-speech fields were checked. No further material defects were established in those paths.

Deliberately outside this review: hostile host authentication and truthfulness (loaders are trusted capabilities), live model prose quality/provider availability, dynamic room occupancy/weather, mortal/character authority integration, deployed UI/session orchestration, and older audit findings or frozen schema changes. Prompt instructions cannot certify natural-language factual accuracy; this review makes no such claim. A suspected trailing-newline validation gap was probed and rejected by this runtime, so it is not a finding.
