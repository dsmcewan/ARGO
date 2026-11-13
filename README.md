# ARGO

ARGO is a planned living-world roleplaying system with deterministic action authority, actor-scoped knowledge, and narration that cannot directly change world truth.

This repository preserves the initial audit, requirements, scenario canon, and continuation record. It contains no ARGO runtime implementation yet.

## Current state

**Phase 1: audit in progress.** LEXI and TELOS source extraction is retained. Access to the actual Pantheon harness remains unresolved. The supplied Tempted Fates scenario is preserved byte-for-byte.

The required order is:

1. Complete read-only repository and harness extraction.
2. Freeze service schemas in `SYSTEMS/` and ruleset interfaces in `MECHANICS/`.
3. Patch and verify the harness's model capabilities, request builders and routing.
4. Build the ledger, replay, bridge mocks and canonical scenario foundation sequentially.

Parallel feature implementation follows completion of that spine. Saving this repository does not advance a phase gate.

## Start here

- [Project brief](ARGO_BRIEF.md)
- [Repository inventory](REPO_INVENTORY.md)
- [Tempted Fates source](SCENARIOS/Tempted_Fates.md)
- [Scenario requirements and canon boundary](repo-audit/SCENARIO_REQUIREMENTS.md)
- [November 2026 model API audit](repo-audit/MODEL_API_AUDIT.md)
- [Continuation instructions](repo-audit/RESUME_AUDIT.md)
- [Machine-readable phase status](repo-audit/AUDIT_STATUS.json)
- [Evidence catalogs](repo-audit/evidence/)

## Evidence and reproduction

The retained audit catalogs classify 418 source modules, extract 170 LEXI route declarations and 114 model classes, and record 567 verified Git blobs. They describe pinned source snapshots, not verified live services. See the inventory's coverage and limitations.

LEXI, TELOS and claude-config source copies are excluded from this repository. The source manifest and complete tree indexes preserve their identities. To regenerate the catalogs, restore the pinned files beneath `repo-audit/sources/<repo>/`, preserving symlinks, then run:

```sh
python3 repo-audit/extract_inventory.py
```

The extractor refuses missing or mismatched source before changing evidence. It does not import the applications, access their databases, start services or call models. Historical absolute paths in evidence identify the original audit environment; they are not portable checkout locations.

No license is granted by this archive. Source repositories and any later licensed campaign content retain their own rights and terms.
