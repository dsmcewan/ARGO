# Shared headless world

Implementation in progress from baseline `3fd1e4d`. The owner approved a single headless session connecting dialogue, custody, exploration, combat and resources. No paid model calls or deployment are authorized by this milestone.

[Design](DESIGN.md) · [Implementation plan](PLAN.md) · [Independent design review](evidence/recon/design-review.md)

Contract source `186e052` passed 25 author tests and 29 unchanged independent probes across two native reviewers. Metadata-only commit `15d49d3` freezes the four source hashes. SW-100 is submitted as VERIFYING on the source Board; application/runtime acceptance remains separate.

The shared authority will use one signed journal and actor namespace, reusing the pure mortal-v3 reducer. Historical profiles remain unchanged. The first session covers ordinary mortal play; Fate jurisdictions and lifespan transactions need a later explicit shared-world port.

| Stage | Ticket | Release condition |
| --- | --- | --- |
| Contracts | SW-100 | Independently reviewed schema/type/guard freeze |
| Pure authority and views | SW-200 | Frozen contract, deterministic action/projection tests |
| Scoped model adapter | SW-400 | Frozen contract, injected request/privacy/freshness checks |
| Fresh campaign seed | SW-500 | Frozen contract, source/identity/starting-kit checks |
| Signed journal and worker | SW-300 | Integrated pure authority, replay/atomicity/concurrency checks |
| Session host and CLI | SW-510 | Integrated storage and campaign seed, end-to-end lamp session |

Each stage uses an immutable source batch and disjoint leases. New batches are initialized only after their prerequisite commits are integrated; the data-only Board cannot unlock application dependencies by pretending they passed its validator. Source tickets stop at VERIFYING. Independent application acceptance, GitHub delivery and any future Board policy migration are recorded separately.

The deterministic demonstration will ask Melia's terms, accept a particular free-loan offer, travel at night using lamp oil, return the lamp, then resume and replay exactly. Generated dialogue is tested through an injected model response; prose alone cannot create a bargain or transfer.
