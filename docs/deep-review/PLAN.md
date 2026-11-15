# V1 incremental verification repair

Source: owner-supplied review of `0c24b32` on 2026-11-14. Only the pasted summary is available initially; eighteen findings are reported but only four high findings and two limits were supplied. Never label the unseen findings verified.

1. Reproduce full-history work on repeated ledger and character calls; retain baseline timing.
2. DR-100: keep a per-handle verified journal prefix. Read bytes under the existing lock, require the entire prefix unchanged, verify/reduce only new events. Do not trust snapshot.json. No storage-format or frozen-contract change.
3. DR-110: incrementally project character envelopes from a verified prefix, with detached results and suffix failure/concurrency protection. Preserve standalone replay as the cold oracle.
4. Exercise corruption, multi-handle append, retry, replay and caller-mutation regressions; benchmark cold and warm behavior separately.
5. Independent native-peer review, complete offline gates, explicit implementation and evidence identities. No paid provider test or game-server claim.

The other findings require separately versioned encounter, authored-knowledge disclosure and legacy observation contracts. This repair does not join the mortal and character authority profiles. Earlier CR/ND/RP boards retain historical VERIFYING records for code already integrated into main; no lease is stolen or status rewritten. The new board records this successor batch with precise ownership.
