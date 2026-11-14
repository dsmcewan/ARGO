# Review successor repairs

Three high-priority findings from the supplied review are repaired and verified on runtime candidate `e576fe0ad1c57ea71ec1aad2a48f0f7ed400ead1`, following the v1 replay repair already merged at baseline `7292ef7`.

| Finding | Implemented behavior | Compatibility boundary |
| --- | --- | --- |
| One encounter freezes the world | Mortal-v3 protects its roster and site while distant nonparticipants continue; authenticated referees can pass a stalled turn or close the encounter. | Explicit fresh-world profile; existing mortal-v2 worlds are unchanged and need a future anchored migration. |
| Melia cannot see her authored loan terms | A pinned, selected actor-knowledge catalog reaches the actual dialogue request, with source provenance and current-query disclosure. | Host-persisted activation is opt-in. Offer terms remain owner policy, not an accepted bargain or shared world fact. |
| New v1 claims impersonate sources and target other actors | Default self-authored, self-private admission; additional recipients require a bounded trusted host witness grant outside the writer lock. | Historical signed records still replay under old rules; transient grants do not add persisted witness proof. |

All **ten application gate groups passed** on the final immutable candidate in a disposable, read-only, network-isolated checkout. Three independent native peer reviews added 10 mortal, 15 knowledge and 12 observation probes. The observation reviewer found one cancellation mismatch; it was fixed, independently retested and followed by a fresh full gate. These are separate instances of the same model, not cross-vendor review or proof against every possible defect. See [verification.json](verification.json), [portable evidence](evidence/README.md) and the [contract freeze record](contract-record.json).

Use [USAGE.md](USAGE.md) for host interfaces and [NEXT.md](NEXT.md) for remaining dependencies. No paid model calls or deployment were performed. Character and mortal profiles still need a shared world contract; live dialogue quality remains unmeasured.

The [blackboard source records](source-submissions.json) retain DR-201/211/221 in **VERIFYING**, with 38 CAS artifacts. Its pinned data-only policy cannot certify these application changes, so full application acceptance and GitHub delivery are recorded separately. The old intake DAG and failed DR-190 policy submission are preserved; no SQL status or operational trust root was changed. [Design](../deep-review/design/sequence.md) and [plan](PLAN.md) record the contract-first, disjoint-worker sequence. Reviewed source commits remain reachable ancestors in the integration history.
