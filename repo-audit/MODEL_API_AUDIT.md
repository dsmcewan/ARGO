# November 2026 model API audit

Read-only documentation and request-builder review, checked 2026-11-13. No inference request, pool rotation, billing test, or production configuration change occurred. Model existence/documented behavior is not evidence that the user's credentials can call it. Pantheon has since been supplied; see PANTHEON_AUDIT.md for exact Phase 3 patch locations. This document retains the provider research from Phase 1.

## Confirmed rules and material corrections

| Target | Official evidence | Consequence for the eventual patch |
| --- | --- | --- |
| `claude-fable-5-2` | [Migration guide](https://platform.claude.com/docs/en/models/fable-5-2/migration-guide), [model overview](https://platform.claude.com/docs/en/models/fable-5-2/overview) | Always-on adaptive thinking; omit legacy sampling controls, disabled/manual thinking, and forced `any`/named tool choices. Use supported effort, default `high`; requested architecture policy can select `xhigh`. Preserve response validation and supported conversation state. Model overview lists 1M context, 128K output, $8/$40 per million and $0.20 cache reads. |
| Claude compaction | [On-demand compaction](https://platform.claude.com/docs/en/build-with-claude/compaction-on-demand) | `compact-2026-09-04` is a real beta header, but sending the header alone does not implement compaction. The application requests summarization and retains the returned signed block unchanged for later requests. Check model support and keep system/tools consistent. |
| `gemini-4-carbon`, `gemini-4-argon` | [Gemini 4 guide](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/start/get-started-with-gemini-4) | Unified 1,048,576-token input+output budget; thinking consumes output. Direct non-streaming Carbon/Argon requests segment at 32,768, streaming at 65,536. Larger generations require continuation or an appropriate background transport. Current documented SDK floors: Python 2.34.0 / JS 2.32.0. Agent Platform continuation requires `v1beta1`. Therefore a raw non-streaming 65536 cap alone is incomplete. Also replace `thinking_budget`/`MINIMAL`, remove explicit cached-content references, and preserve thought signatures. Intro pricing/end date were not independently established in this pass. |
| `gpt-6-astra` | [Model documentation](https://developers.openai.com/api/docs/models/gpt-6-astra) | 1,050,000 context / 128,000 output. Listed $10 input, $1 cached input, $50 output per million. Above 272K input, input/cache rates double and output is 1.5x; not every rate doubles. Implement the requested conservative **input <250000** policy using provider-aware token counting over the complete request; character estimates are insufficient. Keep contract headers stable and first. |
| `grok-4.3` | [Retirement guide](https://docs.x.ai/developers/migration/may-15-retirement) | Use explicit model selection; documented retired reasoning/non-reasoning slugs redirect with different default effort. Avoid blanket prefix rewriting of every `grok-*` name. Listed 1M context and $1.25/$2.50 input/output per million. |
| `grok-4.7` | [Model page](https://docs.x.ai/developers/models/grok-4.7), [reasoning](https://docs.x.ai/developers/model-capabilities/text/reasoning), [caching](https://docs.x.ai/developers/advanced-api-usage/prompt-caching) | Model page lists 500K context, $2/$6 input/output, $0.50 cached input, and higher pricing beyond 200K. Exact threshold comparison/multiplier still needs pricing-table verification. Responses output reasoning items carry encrypted content: preserve complete items unchanged in the next input. Chat Completions has no equivalent ciphertext field. Use a stable provider cache/conversation identity scoped to tenant, campaign, rights lane and session. |
| `controller` | User requirement; local deterministic code | Not an API model. LLM verdicts cannot certify merges. Schema validation, typechecks, process checks and replay evidence must bind the candidate being merged. |

Token price is not an API throughput rate. RPM/TPM, subscriptions, API quotas, credentials and per-pool entitlements must be obtained from the actual harness/account configuration. The four Fable pools have not been observed here.

## Observed code sites

All references below are relative to the verified audit snapshots in `sources/`.

- `TELOS/connectors/ai-peer-mcp/server.mjs:478–496`: Anthropic body accepts temperature and forces the schema tool. Shape validation cannot justify an unsupported tool-choice parameter.
- `server.mjs:604–635`: OpenAI branches on GPT-5 families; GPT-6 falls through to the legacy token field. Explicit endpoint/model capabilities are required.
- `server.mjs:668–688`: Gemini thinking recognizes Gemini 3 only; default 2000 output budget is insufficient for the requested heavy reasoning/code-generation role.
- `server.mjs:548–578`: xAI path uses Chat Completions and 4.5-specific effort handling. Responses state retention is a distinct implementation obligation.
- `claude-config/skills/multi-model-seats/scripts/swarm-seat-adapters.mjs:208–227`: CLI adapter chooses names differently from HTTP APIs; Gemini uses Antigravity. Do not pass API IDs to a CLI without checking its actual roster.
- `LEXI/lexi-dashboard/backend/model_fallback.py`: propagates 400 and auth failures; switches only for rate limiting. Preserve that distinction when generalizing. Shared cooldown read-modify-write concurrency remains an audit target.
- Actual Pantheon builders and routing are now audited in PANTHEON_AUDIT.md. The above historical sites remain source findings; no patch has been applied during the audit.

## Acceptance cases to pin before changing builders

1. Parameterized request fixtures for every selected model, endpoint and effort: unsupported fields never reach the wire, caller objects remain unmodified, returned provider/model identity is retained.
2. HTTP 400, 401, 403 and invalid model ID are terminal configuration/request errors. No repeated identical request and no vendor substitution concealing the defect.
3. Temporary 429 honors retry-after and bounded attempts/deadlines; billing/quota exhaustion is distinguished by structured provider error where available. All pools unavailable returns an explicit exhausted result.
4. Provider failure never forwards another provider's encrypted reasoning or credentials. Model fallback is reconstructible from scoped application context and records the transition.
5. Carbon/Argon combined token guard, missing/repeated continuation token, partial/incomplete output, cancellation and continuation deadline. High thinking cannot silently turn truncated code into a passing build.
6. Astra token counts at 249999 and 250000, including tools and static headers; reject at the policy ceiling before generation. Missing trustworthy counts must not bypass the guard.
7. Grok multi-turn tool loop preserves encrypted item bytes and ordering; cache key stays stable within the same allowed scope and differs across tenants/rights lanes.
8. Compaction explicitly exercises summarize, signed block retention, next-turn continuation and unsupported capability behavior. A beta header assertion alone is not an integration test.
9. Multiple processes updating different cooldown pools cannot lose records; replaying an uncertain mutation is idempotent.
10. Async child runners bound output and terminate descendants on timeout/cancel. The event loop stays responsive under slow clients and hung processes.

The reusable multi-vendor package must expose request preparation, token/capability validation, async transport, normalized outcomes, and an injected routing policy. Narrator personas may select effort, but cannot bypass authorization, knowledge filtering or ledger commit rules. Packaging and integration remain pending the strict phase gates.
