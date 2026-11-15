# Next dependencies after these repairs

The repaired runtime candidate is `e576fe0ad1c57ea71ec1aad2a48f0f7ed400ead1`; final application acceptance is recorded separately in verification.json. Source and reviewer commits are retained as ancestors, rather than cited as unreachable sandbox-only commits. The remaining fourteen findings behind the sign-in-only Claude artifact remain unseen.

| Dependency | What this pass provides | Still needed before claiming the target |
| --- | --- | --- |
| Existing mortal-v2 games | Explicit fresh-world v3 scheduler/recovery with separate signed history | An authenticated anchored continuation/import contract, old-writer shutdown and atomic cutover. Do not regenerate a campaign over live state. |
| Replayable witness provenance | Restrictive new v1 write admission, exact transient host grants | Persisted signed witness evidence, public receipt/view binding and an explicit quarantine/import policy for old forged claims. Historical v1 claims retain old disclosure rules. |
| Durable authored knowledge | Pinned catalog, source evidence and checked activation/disclosure interfaces | Host persistence, verified ancestry/entitlement, and later event-backed activation. A book-derived policy is not a fabricated observation event. |
| One shared game world | Scoped character/Fate and mortal APIs with explicit boundaries | Actor identity mapping, one causal clock/cursor and atomic cross-profile effects. Never double-commit a spoken bargain and physical transfer across independent stores. |
| Production host | Deterministic library APIs and offline mocked transport/provider tests | Authenticated sessions, durable service lifecycle, perception/entitlement/consent capabilities and operational restore rules. No game server was deployed. |
| Live dialogue quality | Exact authored terms in captured provider requests, private/shared context separation, freshness/cutoff and output-budget checks | Owner-authorized live evaluation; bounded format repair would require a separate contract. Paid model runs remain off. |

The older R06/R10/R12/R13 decisions in REPAIRS/RESOLUTIONS.md remain open. This pass does not claim to solve every defect from the earlier review or unseen report. In particular, signed v1 witness evidence and storage-operator rollback protection are not created by adding a callback or another local metadata file.

The intake DR-190 submission was refused because its old policy pinned cache-test blobs from before the final already-merged scaling repair. Its lease was released through `fail_claim` (FAILED at its one-attempt limit), with design evidence preserved. No trust root or SQL status was changed. The new DR-201/211/221 sources are submitted to VERIFYING with 38 CAS artifacts; their application acceptance is external to the Board's intentionally data-only gate. These are completed source deliveries, not live worker leases or model-approved Board merges.
