# ARGO model client

Reusable ESM policy with injected SDK clients and no gameplay state. `sendModelTurn` builds a provider request, checks its token budget, bounds execution, preserves opaque reasoning, and refuses incomplete output. `routeCall` chooses explicit credential pools and returns the actual seat identity. Pantheon's default board profile is `argo`; `legacy` remains an explicit compatibility profile.

- Fable 5.2: rejected sampling/thinking/forced-tool fields removed; high effort, xhigh for architecture. Signed compaction uses `compact-2026-09-04`. The seat store acknowledges compacted history by immutable digest.
- Carbon/Argon: 65,536 minimum thinking-plus-output budget; 262,144 configured maximum. Pinned `@google/genai` 2.32.0 uses v1beta1 with wrapper-owned bounded continuation, repeated-checkpoint rejection, and preserved Retry-After headers, verified through the real HTTP serializer with an offline fetch. This is foreground SDK continuation, not an invented GenerateContent `background` parameter. Interactions background jobs are outside this package.
- Astra: provider input-token preflight includes instructions/tools/history and refuses input >=250,000. Static contract headers precede variable prompts. No heuristic is accepted as a count.
- Grok 4.3/4.7: scoped cache identity and unchanged encrypted reasoning/tool replay. No legacy retired slug appears in the default profile.
- Retry: every 400/auth failure is terminal, including after a 429. Numeric/date Retry-After is honored within a deadline; otherwise route to another available pool. SDK retries are disabled by Pantheon's factory. The v2 cooldown store serializes independent processes; legacy v1 Python stores are not claimed to share this protocol.

Configure `PANTHEON_POOLS_FILE` using `pools.example.json`; credential values live only in the named environment variables. Four names do not prove four independent subscriptions. Duplicate values are refused. Account availability and billing entitlements require an operator deployment check. No paid request was made during development.

Sources checked 2026-11-13: platform.claude.com model migration and compaction-on-demand documentation; Google Gemini 4 get-started documentation and pinned SDK; OpenAI Responses input-token-count reference; xAI Responses reasoning/cache documentation. Pricing is intentionally not an execution gate; provider prices and account terms can change.

Offline tests: `node --test packages/model-client/tests/*.test.mjs pantheon/tests/frontier-*.test.mjs pantheon/tests/google-long-decode.test.mjs pantheon/tests/compaction-history.test.mjs`. Process and Bubblewrap tests require Linux namespaces. Runtime Google SDK clients must install the exported `providerFetch` wrapper to retain HTTP retry metadata. Clients must supply complete scope and a session ID for cache isolation, use transport SDKs with built-in retries disabled, and check `usable_for_resume` before accepting generated code.
