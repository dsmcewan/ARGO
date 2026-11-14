# Shared-world delivery record review

Candidate: `639d31b1414c21fa7516dc9d363ad35bae148afd` in `/workspace/ARGO/.worktrees/shared-world`.

Verdict: **Provenance and wiring checks pass; one minor documentation correction remains before delivery.** This is a bounded static/documentation review, not application acceptance. No tests, benchmarks, provider calls, Board writes, checkout edits or nested agents were used.

## Finding

**Minor — premature completed-measurement claim**, `docs/shared-world/NEXT.md:9` (related wording in `docs/shared-world/README.md:54`). NEXT says “The completed session measurement is retained separately” and describes both measurements, but this exact commit retains only the successful pre-session `120119c` measurement and static session-instrument review. The session run on `639d31b` was still in progress during this review. Replace this with pending language, or retain the successfully completed exact-source output and link it before delivery. Root acknowledged the finding and will correct it after the active run; no result from that running process is certified here.

## Verified records

- The initial checks observed clean `639d31b` before and after. During the final evidence refresh, root committed the anticipated documentation/evidence update as clean `83bc6c154cd0879f481185eb159cded8fa1e507d`; the script continued to read every reviewed source/document byte explicitly from `639d31b`. `verification.json` records that later observed checkout identity separately from the reviewed candidate. The successor diff contains only NEXT, README, the evidence index and completed measurement artifacts; no runtime changes. All six actual SQLite Board records were read with `mode=ro` and explicit safe columns: SW-100 attempt 2 and SW-200/300/400/500/510 attempt 1 remain **VERIFYING**, with `merged_commit = null`. Their submitted commit IDs match the portable evidence. No lease token or secret-bearing columns were queried or copied.
- All six submitted source commits and all ten final reviewer candidates are ancestors of the integration candidate. All **32** submitted artifacts match their source commits, Board artifact records and CAS bytes, and fall inside the corresponding ticket ownership. All **68** source-hash entries in the ten reviewer records match the historical commits they identify.
- Current runtime, test and frozen contract bytes match the submitted/reviewed bytes. The deliberate differences are contract `FREEZE.json` metadata at `15d49d3` (reviewed status, candidate/report references, unchanged four contract hashes), and `SEED.md:5` updated by the coordinator to name the now-published package export. Neither changes runtime. Historical source records correctly retain their original hashes.
- **130** relative Markdown links across the ten reviewed root/shared-world/CLI/seed/evidence documents resolve within the committed tree. External URLs and rendered fragment anchors were not checked.
- `docs/shared-world/PLAN.md:99-100` explicitly leaves the immutable full ten-group application gate and GitHub CI/merge/synchronization unchecked. README and the evidence index distinguish source reviews, application acceptance and GitHub delivery. No completed application gate or GitHub delivery is claimed here.
- Measurement source is byte-identical to static-reviewed `897a2e36caf82331a2f7816b3d781e95913ea4ba`: SHA-256 `0c42b92bbab5bba5a000c934883dc9a498f7e29f449f02012de8cd7ce063b780`. Changes since that commit are documentation/evidence only. Published initial timings agree with the retained `120119c` speech-workload measurement, subject to rounding and its stated single-machine/injected-client limitations.
- Narrow package wiring is consistent: root workspace includes the session package; session and scenario dependency maps match the lockfile; the session workspace link and public entry point exist; shared-world contracts, authority, model adapter and campaign seed are exported. Ownership retains `packages/ledger` as the shared-state writer, authority as the only writer lane, and session as non-writing.

## Evidence and limits

`check-records.py` performs the read-only path, ancestry, historical/current hash, Board metadata, CAS and wiring comparisons. `verification.json` retains detailed safe results; `check-records.log` summarizes them. The listed current artifact differences are explained above, not hash-integrity failures.

Authority/privacy behavior, performance, the complete application gate and GitHub results were deliberately not rerun or independently certified by this review. The separate source reviewers' verdicts and test counts were checked as records, not re-executed. Live Board state is a point-in-time observation; the report does not modify or relabel it as application approval.
