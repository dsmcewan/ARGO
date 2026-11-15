# Pantheon local changes

Changes made inside ARGO to the supplied Pantheon source (`pantheon/`). The pinned read-only audit
(`PANTHEON_AUDIT.md`) and its source manifest (`evidence/pantheon-source-manifest.json`) are not
rewritten. They keep describing the bytes as supplied in ARGO commit
`6f75c29c8e66df2c76996c33b763390807d62bda`. Each entry below records the pinned identity, the new
identity and the evidence for the change.

## PLC-001 — `scripts/board-run.mjs` offer publish presents its lease

**Date:** 2026-11-15. **Authorized by:** the repository owner, in session.

**Defect.** The README's no-model demo, `node scripts/board-run.mjs`, stopped at the worker's
"offer it" publish with:

> item:withSeatLock is under an active lease (held by agy_google-work at gen 1); a write that moves
> it must present that lease. Omitting the lease is not a way around the fence.

The worker acquires `item:withSeatLock`, then presents that lease on its artifact publish but not on
the next publish, which moves the same item to `offered_review`. The ref fence in
`src/board/refs.mjs` (`FENCING IS NOT OPT-IN`) refuses any seat write to a leased slot that does
not present the lease, so the refusal was correct and the script was wrong. Nothing in the suite
ran the script, so the suite stayed green. Both the script and `refs.mjs` were byte-identical to the
pinned manifest blobs when the defect was observed, so the defect came with the supplied source and
was not introduced by a later ARGO commit.

**Change.** That one `publish()` call now passes the lease the worker already holds,
`lease: { resource: \`item:${ITEM}\`, gen: lease.lease.gen }`, exactly as the artifact publish
above it does. No library code, fence, gate or invariant changed.

| path | pinned blob | new blob | new sha256 | bytes |
| --- | --- | --- | --- | --- |
| `pantheon/scripts/board-run.mjs` | `9f275cf9545ee0a3f6cbe5bd3654a926244691e4` | `a684dc0f2ef1310aaf856bd570e2665ab68052a3` | `ab2cb5cf8e4d304bb3ad6f2389a05fc0c641f6346bc3ace76d8ae4a88768eb65` | 14696 |
| `pantheon/tests/board-run-script.test.mjs` | (new file) | `a549c43f9e0293ba064fb8fae7c9e59427e0f8c3` | `c269a8996fddcf6919e1561c269c53286fd0bee49e6eb05312c2973ce6a82441` | 1333 |

**Evidence.** These runs were on ARGO base `a218ee3e659cbfaadfa9cacbdfaa5889b3753409`, Node
v22.23.4, with bubblewrap 0.9.0 present:

- The new regression test executes the script and requires the offer, integration, a successful
  ship of `artifact:src/seat/lock.mjs`, no `REFUSED at` line and a final `accepted` state. It failed
  before the change with the lease error above and passes after it.
- After the change the script exits 0. It goes intake → planning → executing → reviewing → accepted,
  and all eight ship gates (ACTOR TARGET TICKET GRAFT LEASE REVIEW TESTS MERGE) pass.
- `npm test` in `pantheon/`: 730 tests, 730 pass, 0 fail.

No vendor was called and no credentials were used.
