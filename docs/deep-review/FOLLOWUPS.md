# Review intake and remaining dependencies

Reviewed baseline: `0c24b32f947143c5b1095f702c878ed92888aa8d`. This records the four high findings and two limits pasted by the owner. The linked Claude artifact initially returned HTTP 403. The owner requested a retry; the page shell then returned 200, but its actual content bootstrap returned 401 (sign-in required). Its other fourteen ranked findings have not been inspected; see evidence/external-review-access.md.

| Item | Verified behavior | Dependency / next work |
| --- | --- | --- |
| 1. Repeated v1 replay | Each ledger call re-verifies/reduces all events; each character authority load replays again. | DR-100/DR-110 implement verified prefix caches without changing wire or action semantics. |
| 2. Global mortal encounter | Travel/wait outside the encounter fail while it remains open; current participant can progress, but absent turn owner has no timeout or referee close/pass action. | Version an encounter recovery/scoping contract; define authenticated referee intervention and replayable timeout policy. Current global lock is explicit in mortal-v2. |
| 3. Missing authored knowledge | Melia's goals and boundaries reach the model; her exact loan terms do not. Terms are authored in campaign signals and QUICKSTART. | Define curated actor-owned knowledge, acquisition/provenance and tenant disclosure; seed/project it without exposing referee secrets or variant truth. |
| 4. Legacy forged observations | A player can select unrelated private recipients and misattribute a source under v1 observe_claim. | Version observation authorization and acquisition semantics, with migration/replay rules. New CharacterView does not ingest these ordinary legacy claims. |
| Separate authority profiles | Mortal state and character/Fate speech remain separate journals and actor models. | Define identity mapping, one causal timeline and atomic cross-profile transactions before advertising one playable world. |
| No live dialogue validation | All provider tests are injected/offline. Fenced JSON and 241-character speech fail the specified grammar/budget; exact JSON with 240 passes. | Decide bounded format-repair behavior separately from authority; live quality/latency assessment remains blocked by the owner's no-paid-runs instruction. |

Deterministic passing tests establish the behaviors exercised, not deployment readiness or a measured live-model success rate. The dialogue integration is a library capability; a host must still provide authenticated readers, clients and disclosure decisions.

The present repair intentionally preserves existing frozen gameplay rules. It does not waive the global encounter policy, let a model disclose campaign secrets, accept forged knowledge or join the two authority profiles. The legacy observation problem remains open until its versioned contract repair.
