# Pantheon local changes

Itemized record of changes made inside ARGO to the supplied Pantheon source (`pantheon/`), starting
with PLC-001. The pinned read-only audit (`PANTHEON_AUDIT.md`) and its source manifest
(`evidence/pantheon-source-manifest.json`) are not rewritten. They keep describing the bytes as
supplied in ARGO commit `6f75c29c8e66df2c76996c33b763390807d62bda`.

**This file is not the complete delta from the pinned source.** Before PLC-001, at ARGO
`a218ee3e659cbfaadfa9cacbdfaa5889b3753409`, the active `pantheon/` tree already differed from the
pinned manifest by 11 added and 29 changed files (0 removed) from earlier ARGO harness repairs.
Those earlier changes are recorded where they were made, not here:

- narrative: `BUILD_PROGRESS.md` and `STATUS_AND_ARCHITECTURE.md`
- machine record: `repo-audit/evidence/foundation-verification.json`
- an earlier delta snapshot (8 added, 29 changed at its commit):
  `docs/design/headless-2026-11-13/source-delta.md` and the `active_pantheon_delta` block in
  `docs/design/headless-2026-11-13/source-evidence.json`

Entries below record the pinned identity, the new identity and the evidence for each change.

## PLC-001 — `scripts/board-run.mjs` offer publish presents its lease

**Date:** 2026-11-15. **Authorized by:** the repository owner, in session.

**Defect.** The README's no-model demo, `node scripts/board-run.mjs`, stopped at the worker's
"offer it" publish with:

> item:withSeatLock is under an active lease (held by agy_google-work at gen 1); a write that moves
> it must present that lease. Omitting the lease is not a way around the fence.

The worker acquires `item:withSeatLock` and presents that lease on its artifact publish. Its next
seat-authored publish, which moves the same item to `offered_review`, did not present it. (A
controller publish sits between the two; the fence does not apply to the controller.) The ref fence
in `src/board/refs.mjs` (`FENCING IS NOT OPT-IN`) refuses any seat write to a leased slot that does
not present the lease, so the refusal was correct and the script was wrong. Nothing in the suite ran
the script, so the suite stayed green.

**Origin of the defect: what was and was not verified.** At `a218ee3`, the script and the whole
fence path (`src/board/refs.mjs`, `dag.mjs`, `runtime.mjs`, `schema.mjs`) were byte-identical to
their pinned manifest blobs. The missing lease is in the script's own text, so the defect is in the
supplied bytes. The pinned tree itself was not executed: this clone is shallow and cannot resolve
`6f75c29`, and the script's import closure includes modules ARGO changed later
(`src/role/roles.mjs`, `src/route/router.mjs`, `src/config/models.json`). The quoted error is
therefore what ARGO's tree at `a218ee3` printed. The seat name in it comes from those changed
modules.

**Change.** That one `publish()` call now passes the lease the worker already holds,
``lease: { resource: `item:${ITEM}`, gen: lease.lease.gen }``, exactly as the artifact publish
above it does. Pantheon's real pipeline makes the same offer the same way
(`src/board/run-item.mjs`: offer with the lease, carry merge, then release). No library code,
fence, gate or invariant changed.

| path | mode | pinned blob | pinned sha256 | pinned bytes | new blob | new sha256 | new bytes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `pantheon/scripts/board-run.mjs` | 100644 | `9f275cf9545ee0a3f6cbe5bd3654a926244691e4` | `c12a1938c533a82b526e3c3784db601981296fe9c86ccf09dc376e52080e859b` | 14637 | `a684dc0f2ef1310aaf856bd570e2665ab68052a3` | `ab2cb5cf8e4d304bb3ad6f2389a05fc0c641f6346bc3ace76d8ae4a88768eb65` | 14696 |
| `pantheon/tests/board-run-script.test.mjs` | 100644 | (new file) | | | `04c73068f4104f814a9e79dfc59710e6eccf6923` | `7753f5c24661da22e9aa23eaf73765222f8f51e2e8a924a481f3fc855e17f84a` | 2364 |

`pantheon/` subtree: `2031b51825efe07033248804b47c33ddea6e04ca` before (at `a218ee3`),
`c1bad8b82407b25f0b504b16fee5a80328aa5b8e` after. The test file was first committed in `bb38173`
as blob `a549c43f9e0293ba064fb8fae7c9e59427e0f8c3` and revised after independent review; the row
above is the revised file.

**Evidence.** These runs were on Node v22.23.4 with bubblewrap 0.9.0 present:

- The regression test runs the script in a board directory it owns and removes. It requires the
  offer, integration, a successful ship of `artifact:src/seat/lock.mjs`, no `REFUSED at` line and a
  final `accepted` state. It also reads the board's ref log and requires the "offer it" move to
  carry `lease_gen` 1.
- The test fails against the pinned script with the lease error above. It also fails against a
  wrong fix that releases the lease first and offers without one (`null !== 1`): that variant
  reaches `accepted` but lands an unfenced write. It passes against the change, including from a
  checkout path that contains a space.
- After the change the script exits 0. It goes intake → planning → executing → reviewing → accepted,
  and all eight ship gates (ACTOR TARGET TICKET GRAFT LEASE REVIEW TESTS MERGE) pass.
- `npm test` in `pantheon/`: 730 tests, 730 pass, 0 fail.
- CI: the ARGO deterministic gate passed on `bb38173` (the script change with the first version of
  the test).

No vendor was called and no credentials were used.

**Independent review.** Three reviewers, each given the code and not the author's conclusions,
checked the fix against the fence semantics, the test, and this record. The fix was approved. Their
findings on the test (it did not prove the offer was fenced, its script path broke on spaces, and a
failing run left a temp directory) and on this record (scope of the header, missing links, an
overstated origin claim, missing pinned hashes) are addressed in the revision described here.

**Observed and not changed.** The review also found three things in the demo script that predate
this change and are left as supplied:

- The lease is not released if the script throws between acquire and release (no `try/finally`).
  A crashed run with `--dir` leaves the lease active for 120 seconds.
- Running the script twice on the same `--dir` fails on the second run with a merge conflict on
  `item:withSeatLock`. Only a fresh directory is reliable.
- The seating block prints `xai` as the seated reviewer, while the critique is written by `openai`
  (`reviewPlan()` chooses from all seats, not from the seating plan). The review is still
  cross-lab. `run-item.mjs` documents and works around the same divergence.
