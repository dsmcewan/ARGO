# ARGO

ARGO is a foundation for a living-world roleplaying system: signed deterministic action authority, actor-scoped knowledge, and stateless narration.

All four foundation phases are complete: source audit, frozen contracts, repaired Pantheon model boundary, and the sequential ledger/bridge/Tempted Fates spine. The earlier foundation repairs passed their deterministic gates. Twelve subsequent structural-review findings are repaired and independently verified; four contract/storage decisions remain blocked in [the repair record](REPAIRS/RESOLUTIONS.md). Verification is recorded in [BUILD_PROGRESS.md](BUILD_PROGRESS.md), [AUDIT_STATUS.json](repo-audit/AUDIT_STATUS.json), and [the verification record](repo-audit/evidence/foundation-verification.json).

```sh
npm ci --ignore-scripts
npm --prefix pantheon ci --ignore-scripts
npm run contracts
npm run typecheck
npm test
npm run gate
```

Use Node 24.22.1 and Linux Bubblewrap for process/isolation checks. The gate fails closed when namespaces are unavailable. All vendor tests use injected offline responses; no paid model run has been launched.

The monorepo's public package entry points are in each package manifest. [SYSTEMS/ARCHITECTURE.md](SYSTEMS/ARCHITECTURE.md), [ARGO_SYSTEM_BIBLE.md](ARGO_SYSTEM_BIBLE.md), and [OWNERSHIP.json](OWNERSHIP.json) define shared constraints. [The merge controller](controller/README.md) gates exact candidates with externally pinned test policy. Models do not certify merges.

LEXI/TELOS transports are injected and default to unavailable. Their deterministic mocks do not claim deployed gameplay endpoints. Production authentication, entitlement and informed-consent capture remain integration responsibilities. Queue/fork scheduling is reserved by the schema and explicitly unsupported in v1. Current anomaly cutoffs apply across one world/branch encounter; see [the seed notes](scenarios/tempted-fates/README.md).

## Start here

- [Connected character dialogue and scoped scene context](docs/npc-dialogue/README.md)
- [Character runtime, Tempting Fates campaign and mortal RPG release scope](docs/releases/2026-11-14-rpg-foundation.md)
- [Playable Tempting Fates campaign kit](CAMPAIGNS/Tempting_Fates/README.md)
- [Authoritative mortal rules and measured balance](docs/rpg-phase2/README.md)
- [Current system, target architecture, data and next dependencies](SYSTEM_ROADMAP.md)

- [Consolidated status, CI timeline and architecture](STATUS_AND_ARCHITECTURE.md)
- [Project brief](ARGO_BRIEF.md)
- [RPG research and offline blackboard](RESEARCH/README.md)
- [Concurrent Mesh builds through Pantheon](tools/MESH.md)
- [Repository inventory](REPO_INVENTORY.md)
- [Tempted Fates source](SCENARIOS/Tempted_Fates.md)
- [Scenario requirements and canon boundary](repo-audit/SCENARIO_REQUIREMENTS.md)
- [November 2026 model API audit](repo-audit/MODEL_API_AUDIT.md)
- [Continuation instructions](repo-audit/RESUME_AUDIT.md)
- [Machine-readable phase status](repo-audit/AUDIT_STATUS.json)
- [Evidence catalogs](repo-audit/evidence/)

## Evidence and reproduction

The retained audit catalogs classify 525 source modules, extract 170 LEXI route declarations and 114 class declarations (104 direct `BaseModel`/`SQLModel` subclasses and 10 other classes), and record 840 verified Git blobs, including the uploaded Pantheon folders. The [count clarification](repo-audit/evidence/class-count-clarification.json) supersedes the historical `model_classes` label without changing the pinned evidence. They describe pinned source snapshots, not verified live services. See the inventory's coverage and limitations.

LEXI, TELOS and claude-config source copies are excluded from this repository. The source manifest and complete tree indexes preserve their identities. To regenerate the catalogs, restore the pinned files beneath `repo-audit/sources/<repo>/`, preserving symlinks, then run:

```sh
python3 repo-audit/extract_inventory.py
```

The extractor refuses missing or mismatched source before changing evidence. It does not import the applications, access their databases, start services or call models. Historical absolute paths in evidence identify the original audit environment; they are not portable checkout locations.

No license is granted by this archive. Source repositories and any later licensed campaign content retain their own rights and terms.
