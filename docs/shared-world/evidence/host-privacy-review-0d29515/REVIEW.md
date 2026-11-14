# SW-510 independent host privacy and delivery review

Verdict: **READY for the trusted-local session/model delivery and CLI scope** at exact commit `0d295152d7ee8a7e9a2a97a7f470e8108c2b26b2`.

All 10 named source tests passed. All eight independent ordinary-process groups are covered by passing evidence: seven passed in the initial full probe run, and the remaining group passed after correcting a reviewer expectation and rerunning only that group. No product changes were needed. The exact five-file candidate stayed clean, and frozen contract hashes match. `final-results.json` explicitly maps each group to its execution evidence; original results are retained.

## Confirmed behavior

- Real actor sessions bind the fixed actor and all seven namespace fields. Melia cannot retrieve hero's self-private speech. Only Melia receives her selected authored loan policy, and old queries fail after the prefix advances. A hostile query is refused before reading the ledger.
- The immutable snapshot fast path does not bless a shallow-frozen copy. Six hostile received DTOs—root/nested getters, a proxy, altered immutable profile, foreign genesis identity and a hidden serialization accessor—are refused with zero caller traps. The real storage-owned snapshot remains unchanged. A revoked proxy returned by an async injected callback rejects during upstream JavaScript Promise assimilation before the session receives it; the corrected test verifies that native failure separately.
- A generated reply remains an uncommitted proposal. The actual injected string is preserved verbatim; no response template replaces it. Display ordering is recorded as `submit → verified receipt → current query → current view`. Only then is text returned as spoken. Physical state, custody, offers and loans remain unchanged by the speech.
- An authentic signed receipt for another request is refused by the session before any disclosure read, so `submitForDisplay` cannot release the proposed text from that acknowledgment.
- If a committed speech receipt is followed by closure before display, the result contains the valid receipt and `spoken:null`. A race between obtaining the current query and reading its view likewise releases only the receipt. Stale queries cannot recover closed context. Player speech may still commit after closure, but its display remains suppressed and context does not reopen.
- Model refresh through actual sessions observes committed revocation and closure. A change during generation suppresses pending text; a closed session starts no additional provider request. These are real signed SQLite commits through the session API, not direct edits to a view fixture.
- The ordinary CLI demo explicitly labels its provider as `injected_response_fixture` and `offline:true`. It prints only `demo_started`, one `committed` receipt, one `spoken` line and `demo_complete`. The seven-event run spends two oil turns and 1200 seconds, returns the lamp, and verifies replay/restart. Private seed, signing material, Melia's nature and raw policy catalog identifiers are absent from stdout.
- The captured hero query/view is actor-scoped, has no Melia knowledge grant or private nature, and exposes no raw genesis/offers/loans. Raw `snapshot`/`events` operations and identity overrides in input produce bounded error rows. The actual contextual model request stays in the private world file. The directory is 0700 and generated files 0600.

## Evidence and reproduction

`source-tests.log` records the 10 named passing tests (~77 seconds). `real-session-provider-request.json` captures the actual injected request. `display-order.json` and `display-races.json` record verified-release and suppression outcomes. `demo.stdout`, `query.stdout`, `view.stdout`, `closed-input.stdout` and their stderr files come from separate ordinary Node child processes with `NODE_TEST_CONTEXT` removed and regular-file descriptors for output. `cli-private-files-metadata.json` records permissions and sizes; private signing/genesis files from the disposable world were removed with that world, not copied into the report.

```sh
# Source suite, in checkout:
node --test --test-isolation=none TESTS/shared-world-session.test.ts
# Full portable independent suite, outside the test runner:
node --experimental-import-meta-resolve probes.mjs CHECKOUT_PATH 0d295152d7ee8a7e9a2a97a7f470e8108c2b26b2 OUTPUT_DIRECTORY
# The actual corrected targeted rerun used:
ARGO_REVIEW_GROUP='Owned snapshot fast path' node --experimental-import-meta-resolve probes.mjs CHECKOUT_PATH 0d295152d7ee8a7e9a2a97a7f470e8108c2b26b2 OUTPUT_DIRECTORY
```

The initial revoked-proxy expectation incorrectly required an `ArgoError`. Returning a revoked Proxy from an `async snapshot()` causes JavaScript to inspect its `then` property while resolving the returned Promise, producing `TypeError` before session validation. This is a trusted callback failure that remains fail-closed; it does not show that the session guard invoked a caller trap. The initial script/log/result and explanation are preserved under `initial-revoked-proxy-expectation/`. Only the affected group was rerun, in `corrected-raw-dto/`; no unrelated tests were repeated and no source file changed.

## Scope and remaining integration checks

The session constructor binds an already authenticated host-supplied principal. It is not remote authentication. The injected ledger is a trusted capability that must return the verified current prefix; schema validation alone cannot authenticate a fabricated but shape-valid historical snapshot. The private cache does not change that trust model.

`submitForDisplay` reads the submitting actor's capability and the CLI writes to the trusted local operator's stdout. This is not a multi-user transport or automatic recipient-delivery service. A later network/UI layer must authenticate each reader and apply its own scoped delivery. The explicit `--actor`/`--referee` flags select trusted local capabilities; input does not authenticate a remote user. A valid receipt alone is not disclosure authorization.

The only fixed dialogue text in this host is the explicitly marked offline demo response fixture. Normal CLI resume creates no model client and reads no provider credentials. Live model quality, remote deployment, interactive UI and narration of hidden canon are outside this pass. The parent is adding the declared scenario dependency and lockfile separately; final integration must verify package installation/export resolution there. This review checks this immutable source candidate and does not certify a later integration SHA or the pending benchmark.
