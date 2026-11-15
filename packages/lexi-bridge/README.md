# @argo/lexi-bridge

ARGO's knowledge-query boundary: `query(KnowledgeQuery, Principal, {signal}) -> Promise<KnowledgeView>`. The normative contract is `SYSTEMS/ARCHITECTURE.md`, "Knowledge and temporal policy".

**Name.** "LEXI" here is the name of this contract. It does not mean the existing LEXI repository, which is a forensic case-analysis application (see `REPO_INVENTORY.md`). That application exposes no route implementing this contract. Nothing in this package calls one of its routes.

## What the bridge guarantees, whichever transport is used

`createLexiBridge({scope, transport, timeoutMs})`:

- Refuses before any call when the query or principal has the wrong scope, the query names an actor other than the authenticated principal, or audience and party disagree.
- Without a transport, every query fails with `UNAVAILABLE`. There is no default endpoint.
- Bounds each call with a deadline and the caller's abort signal (`serviceCall`).
- Validates every response as a `KnowledgeView` for the same scope, actor, audience, party, sequence and world time. Every returned claim must be within the actor/party disclosure and the acquisition-time and sequence cutoffs. A transport that leaks is refused, not trusted.
- Returns a frozen deep copy.

## Transports

| Transport | Use |
| --- | --- |
| `createLexiMock(readSnapshot)` | In-process projection of the signed ledger snapshot (`projectKnowledge`). Deterministic tests and Test Zero. |
| `createLexiHttpTransport(options)` | HTTP client for a service that implements this contract. |

### HTTP transport

```ts
const transport = createLexiHttpTransport({
  endpoint: 'https://knowledge.internal.example/v1/knowledge/query',
  credentials: async (principal, {signal}) => gateway.tokenFor(principal, {signal}),
});
const lexi = createLexiBridge({scope, transport});
```

Wire contract:

- `POST <endpoint>`, `content-type: application/json`, body `{"schema_version":"1.0.0","query":<KnowledgeQuery>}` in canonical `argo-json-v1`.
- `authorization: Bearer <token>`. The token comes from the injected `credentials` provider: the gateway mints it for the authenticated principal, and the service must authorize it. The principal is **never** sent in the body. A body field naming an actor is a claim, not authentication.
- Success is `200` with `application/json` holding a `KnowledgeView`. The bridge then validates it as above.

Transport rules:

- HTTPS only. Plain HTTP needs `allowLoopbackHttp: true` and a loopback host. URLs that embed credentials or a fragment are refused.
- Redirects are refused (`redirect: 'error'`), and no ambient cookies are sent.
- Tokens must be 1–8192 visible ASCII characters. Anything else is refused before the request is sent.
- Responses are capped at `maxResponseBytes` (default 1 MiB, at most 16 MiB) while streaming, and must be strict UTF-8 JSON.
- Status mapping: 401/403 → `UNAUTHORIZED`; 409 → `CONFLICT` (projection behind the requested cursor); 400/422 → `INVALID_CONTRACT`; everything else, including network failure → `UNAVAILABLE`. Bodies of failed responses are discarded unread, so service error text never reaches callers.
- Queries are read-only. The bridge adds no retries of its own.

No deployed service implements this contract yet. Production use still needs that service, gateway token issuance, and entitlement checks, as the system bible describes.
