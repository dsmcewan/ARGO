# Guarded provider runner — Phase 0 candidate

This directory is an **opt-in, offline-qualified candidate**, not an activation
of Pantheon-wide provider governance. Its purpose is to make one complete
transactional-spend boundary testable without silently claiming coverage of
other provider paths.

## Provenance

The broker, transport, fixture, and regression tests were carried from the
retained factory fixture commit `d203371a9f6ae9c64201a8962338dd4dabe0aa4c`,
whose Pantheon integration seams match accepted ARGO `a218ee3`. This candidate
narrows that adapter: `pantheon.mjs` accepts only OpenAI and Anthropic routes,
and `test_guarded-scope.mjs` proves excluded routes are refused before broker
or provider activity. No historical factory policy, service, credential, or
deployment code is adopted here.

## Guarded surface

`runAdmittedPantheonItem` and `createPantheonClientFactory` accept only
OpenAI and Anthropic SDK-shaped routes. They bind the task, execution, route,
model and credential reference; reserve before the injected physical attempt;
fence dispatch; settle measured usage; and retain ambiguous outcomes as held.
Exact count preflights use the same lifecycle as generation.

The adapter refuses xAI, AGY/Google, and unknown vendors before a client is
created. This is intentional: the accepted Pantheon AGY planner/implementer
lane uses an external CLI, which this adapter cannot account for at the
SDK-request boundary.

## Explicit exclusions

This candidate does **not** govern the existing raw-client entry points:

- `pantheon/scripts/open-items-run.mjs`
- `pantheon/bin/pantheon-build.mjs`
- `pantheon/bin/pantheon-view.mjs` and its view server
- `pantheon/scripts/view-check.mjs`
- `pantheon/scripts/live-ship.mjs`
- arbitrary direct imports of Pantheon SDK adapters

Those paths remain outside the candidate's claim. They must be brokered or
separately refused by an adopted, egress-complete policy before any global
transactional-spend assertion is valid.

## Offline verification

Run only against fixture routes:

```sh
python3 -B -m unittest discover -s factory/provider -p 'test_*.py' -q
node --test factory/provider/test_transport.mjs factory/provider/test_guarded-scope.mjs
```

No test in this directory should load a real credential, construct a production
route, or invoke a provider. Activation, funding, policy adoption, and TELOS
authorization are deliberately outside this candidate.
