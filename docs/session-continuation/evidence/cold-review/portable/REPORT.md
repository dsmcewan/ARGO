# Portable compatibility evidence — READY

The parameterized derivative passed all **8/8** original ordinary-process checks on exact clean **c4654d52b1a08bdb4bfa18822d2cc74229d606b6** using the retained 512-event fixture. It also rejected **5/5** corrupted manifest identities before any compatibility check ran. No product source was edited, and no provider was invoked.

The derivative requires `--fixture` and `--fixture-manifest`. It pins manifest source `8e2104c6d466b8b2bee2d0b23d984d2e60a65e11`, validates fixture bytes/genesis/terminal state/event against the manifest, and retains the original generic canonical oracle verbatim. All eight check bodies match the original after normalizing only the two old terminal literals to their manifest references. `parameterization.diff` makes the changes reviewable.

All 12 original evidence files still match their prior SHA-256 identities. The retained fixture and manifest are unchanged. The run finished in 14.553 seconds overall; this is a correctness run, not a cold-open benchmark or native completion gate. The original report's account of earlier native-run limitations was preserved.

Candidate c4654d52b1a08bdb4bfa18822d2cc74229d606b6 and accepted integration 7c16c0d8709b0b53dba0ab36051c1fe0100bd35a have identical packages, tests, scripts, frozen systems, and scenario bytes. Their 13 changed paths are documentation/evidence under `docs/session-continuation/`, recorded in `verification.json` and `integration-docs-only.diff`. The integration checkout was not used as a moving test target.

See `README.md` for fresh-baseline fixture reproduction, `run-c4654d5/results.json` for all check details, and `negative-manifests/results.json` for refusal controls. Fresh signing keys produce new fixture and terminal hashes; supplying the new baseline manifest makes the experiment portable without claiming it recreates historical private bytes. Manifest consistency is verified; source provenance still depends on checking the exact clean baseline used to generate it.

- Original harness SHA-256: `5aa2ae736e6df6d932e969f42fe656321695691c069751875ff5140c3602f886`
- Portable harness SHA-256: `938c885383b9e7e5d97b27b9870095b419eaa58c4458429e42c4f11d05ee204f`
- Retained fixture SHA-256: `0253cd63832456400fae1ec8cd88ab0a1da22b3f61980b9c70727a839e32038c`
- Manifest SHA-256: `942fe0ed3d5aded4740b54d37c833b558cb8178c6f9cbd1192c0fc74583ea974`

Scoped verdict: **READY for public evidence integration**. No source or performance verdict is expanded by this packaging change.
