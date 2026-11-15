Independent SC-620 store review preparation

Status: PREPARED, NOT EXECUTED. Await the coordinator's immutable source SHA before importing or testing the implementation. Preparation reads DESIGN.md, TURN_CONTRACT.md and PLAN.md only; it makes no source edits or acceptance claim.

Portable invocation after release:

    env -u NODE_TEST_CONTEXT node probes.mjs CHECKOUT_PATH IMMUTABLE_SHA OUTPUT_DIRECTORY

`probes.mjs` requires a clean exact checkout, imports public session/ledger APIs from that checkout and makes ephemeral private signed-world/outbox fixtures under the chosen output directory. `process-racer.mjs` is an ordinary child process for concurrent public-host claims. Temporary key files are mode 0600 under 0700 directories and removed after execution; evidence contains no private keys. Both scripts use injected offline provider fixtures, with no network/provider calls.

Prepared groups: exclusive create/missing open, permissions/symlink/unsafe sidecars, foreign schema and full binding mismatch, opaque capability/passive inputs, same-file two-handle CAS/cancellation, two-process generation ownership, permanent silence/attempt records, and external SQLite corruption controls. Any test fixture incompatibility must be identified separately from a source defect, corrected transparently, and preserved with its first-run logs.

Before release execution, statically map the exact candidate to the contract. In particular examine application/schema identity checks before existing-file mutation, transaction capacity accounting, row hash encoding and duplicate columns, exact six-phase invariants, immutable tuple preservation, attempt deadline/cancellation CAS, startup/read/RPC validation, 64 pending/1 MiB transport limits, worker failure/drain behavior, and COMMIT-before-publication. Tests of private RPC/crash seams will be added only after inspecting the real implementation; no unimplemented test-only authority hook is assumed. A held callback must leave an unrelated world writer/outbox transaction free.

External SQL mutation is a trusted-local corruption exercise. The outbox hash is not an authentication mechanism for an owner who can alter/re-hash all rows, and deleting both database histories or generation tombstones is not independently detectable rollback. The corruption draft captures and restores all trigger definitions around fixture edits to isolate row validation from missing-schema refusal. Its row-hash encoding must be confirmed against the actual source before execution; a wrong hash must not be misreported as proof of the deeper row-shape guard.

Independent scope: store/filesystem/worker/CAS/persistence. The peer privacy/driver review covers journal-prefix reconciliation and current player disclosure; overlap on public-host setup is intentional. Final source verdict must name exact SHA, commands, results, limitations and source hashes. Board source state, source review and full application acceptance remain separate.
