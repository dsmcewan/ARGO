# PC-001 progress

Plan: docs/superpowers/plans/2026-11-13-projection-contracts.md. Baseline d32da3b16b9f463a9a094445ab92da9748ebc568; baseline GitHub CI passed.

- Actual fresh board claim PC-001 created before implementation; one root writer, flat temporary-file contributors.
- Interface review replaced Iterable with bounded readonly tuple arrays and made genesis_world_time explicit.
- Ruling: v2 public cutoff withholds claims instead of relying only on downstream narration flags; stored knowledge and v1 unchanged.
- Ruling: JSON Schema is shape validation; standalone and contextual semantic guards remain executable code with explicit host-trust prerequisites.
- Independent oracle was staged before product integration; native RED confirmed the absent module.

- Task1 RED: native Node24 test import failed because projection-v2.ts did not exist, before schema/runtime integration. Log retained outside repo at /tmp/argo-pc-red.log.
- Task2 initial integration: TypeScript passes; native focused run 25/28. Two oracle fixtures were internally inconsistent (schema may enforce structural conditions; tail-reference hash must match fixture head). Freeze manifest is intentionally pending independent review. Existing negative refusal expectations remain unchanged.
- Added explicit known-tail hash/acquisition-clock checks and shared-sequence reference consistency; historical event authenticity remains a host obligation.
- Ruling: existing sandbox suppresses native child test events; use native test execution plus final network-isolated controller, retaining fail-closed checks.

- Corrected independent fixtures preserve every runtime rejection assertion. Focused native run now 27/28; only the deliberately absent freeze manifest fails. V1 contracts/generation checks pass.

- Independent schema/runtime review accepted exact schema and normative bytes; manifest SHA-256 3f45b293ab32829c6872cfc6221b77d8e66e81d3efa8faf1120f25d691504a28 copied unchanged and independently pinned in the new test.
- GREEN: all 28 focused tests pass, zero failures/skips/cancellations. Typecheck, v1 contracts and projection generator --check pass. No old v1 frozen or ledger/bridge files changed. Full controller acceptance still pending.

- PC-001 actually passed its pinned data gate and merged implementation commit 1231bc22d040454d43e41a305b553f77b45fff72 into the isolated staging branch. Audit valid; 11 accepted CAS artifacts rehashed. No main integration yet.
- Independent policy review approved exactly three added files; supervisor adopted immutable trusted commit 1231bc22d040454d43e41a305b553f77b45fff72 in a separate clean checkout. All previous protected files unchanged.

- Full independently trusted controller passed all ten checks for candidate 140b644c0bb86f45141f23b7f00788aeae04e389 under policy 1231bc22d040454d43e41a305b553f77b45fff72, and fast-forwarded main from d32da3b. Retained exact output and hash; no skipped checks or acceptance-policy changes.
- W03 local profile is accepted; D02/D05 migration/storage work remains partial. W05/W06 are ready for shared scaffolding, not a claim of persistent graph implementation.
- This final supervisor evidence snapshot precedes publication. Its subsequent exact commit must pass the same controller; remote push/CI results are reported against that final commit.
