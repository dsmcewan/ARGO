# Edition-specific licensing and first ruleset kernel

Status: **starter**. Baseline: `05a292c403442a24b8f420e8b851f41f0f581ce5`. Prepared as codex_starter; requested seat `grok-4.3`; actual vendor execution: none.

Provisional recommendation: Knave first edition for a small CC BY 4.0 inventory/ability kernel; pin the actual licensed source and rule fixtures before implementation. Keep SRD5.2.1 as a later tactical adapter. The existing tempted-fates/1.0.0 remains unchanged. This is a source audit and engineering recommendation, not a blanket clearance of every asset or product.

## Sources

- **R4-S1** [Knave author storefront](https://questingbeast.itch.io/knave) — First edition, downloadable Knave1.0; primary_page; accessed 2026-11-13. Locator: Features: classless equipment roles, six abilities, CC BY4.0; Purchase file names.
- **R4-S2** [Cairn first-edition SRD](https://cairnrpg.com/first-edition/cairn-srd/) — First edition; primary_page; accessed 2026-11-13. Locator: License and Principles.
- **R4-S3** [Blades licensing](https://bladesinthedark.com/licensing) — Online SRD; attribution specifies CC BY3.0 Unported; primary_page; accessed 2026-11-13. Locator: Requirements, attribution, excluded setting/art/maps.
- **R4-S4** [D&D SRD release page](https://www.dndbeyond.com/srd) — SRD5.2.1, page updated2026-03-02; primary_page; accessed 2026-11-13. Locator: Download and Creative Commons FAQ.
- **R4-S5** [Publishing for Old-School Essentials](https://necroticgnome.com/pages/publishing-for-old-school-essentials) — Current2026 publisher guidance; primary_page; accessed 2026-11-13. Locator: Pre2026 copying/adapting; new2026 license; planned2027 CC SRD.
- **R4-S6** [Year Zero Free Tabletop License](https://freeleaguepublishing.com/wp-content/uploads/2023/11/Year-Zero-Engine-License-Agreement.pdf) — FTL1.0,2023; search_excerpt; accessed 2026-11-13. Locator: Search-indexed grant mentions printed/PDF/VTT forms; directPDF403.
- **R4-S7** [Knave Second Edition author storefront](https://questingbeast.itch.io/knave-second-edition) — Second edition; search_excerpt; accessed 2026-11-13. Locator: Separate product; no verified CC BY grant in this pass.

## Findings

- **R4-C1 (documented)** The author explicitly grants CC BY4.0 for Knave1.0 and describes a small classless, equipment-led six-ability toolkit. This grant is edition-specific. Full artifact bytes have not been acquired or hashed in this pass. Sources: R4-S1.
- **R4-C2 (documented)** Cairn text is CC BY-SA4.0, not plain CC BY. Commercial use and share-alike obligations must be assessed for adapted material; copying into a private upload lane does not remove license conditions. Sources: R4-S2.
- **R4-C3 (documented)** Blades SRD uses CC BY3.0 Unported with required credit. The setting, NPCs, artwork and maps outside the SRD are excluded; logo/trademark permissions are separate. Its adjudicative position/effect and consequences are not a tiny automatic three-result ruleset. Sources: R4-S3.
- **R4-C4 (documented)** D&D SRD5.2.1 is CC BY4.0; that does not license all Basic Rules, books, settings, artwork or brand use. Pin the specific SRD and required attribution. Sources: R4-S4.
- **R4-C5 (documented)** OSE is not established as a CC BY kernel: the publisher distinguishes pre2026 OGL material from a new2026 third-party license and describes a CC SRD as prospective for early2027. Availability of a compatibility logo is not blanket text permission. Sources: R4-S5.
- **R4-C6 (documented)** Year Zero uses a custom FTL, not CC BY. Retrieved excerpt specifies printed/PDF/VTT forms; full terms were inaccessible. Whether an autonomous AI runtime fits the grant remains unresolved. Do not treat Year Zero and Forged in the Dark as identical outcome systems. Sources: R4-S6.
- **R4-C7 (design_inference)** Do not transfer Knave1e’s CC BY grant to Knave2e. This pass has not authenticated a sufficient second-edition text/art reuse license. Sources: R4-S1, R4-S7.

## Proposed mechanics and fields

### R4-P1: Version-pinned Knave1e kernel and license manifest

Compatibility: **versioned_migration**. Targets: SYSTEMS, MECHANICS, TESTS. Sources: R4-S1, R4-S2, R4-S3, R4-S4, R4-S5, R4-S6.

| Field | Type | Visibility | Meaning |
|---|---|---|---|
| `ruleset_id` | versioned identifier | authority | New namespace separate from TemptedFates |
| `source_sha256` | digest | research_only | Hash actual reviewed rule artifact before encoding |
| `license_id` | exact license/version | research_only | Per-material legal provenance, not tenant entitlement |
| `attribution_text` | string | research_only | Credit creator/source/license and identify modifications |
| `rule_fixture_refs` | nonempty stable IDs | research_only | One deterministic example per selected procedure |

- First acquire/pin lawfully distributed Knave1e source; no purchase or bulk source redistribution occurred here.
- Implement a deliberately small supported subset: ability resolution, carried-item capacity, custody and explicit consequences. Refuse unimplemented combat/magic rather than inventing outcomes.
- Keep license provenance separate from runtime rights scope. Even open-license material must not merge tenant-private campaign context.
- SRD5.2.1 follows as an adapter with version-specific actions, initiative, resources and tests. No silent change to the existing ruleset version.
- If avoiding any artifact acquisition is essential, evaluate the accessible Blades SRD as a fallback, accepting its larger adjudication surface. Cairn is an option only with an explicit share-alike content strategy.

## Deterministic benchmark specifications

### R4-B1: Edition cannot inherit permission

Status: **proposed**.

**Given:** License record names Knave1e artifact hash.
**When:** Importer receives Knave2e or a different source hash.
**Then:** No automatic license approval or import.
**Oracle:** Exact artifact+edition+license match, not product-name similarity.

### R4-B2: Ruleset isolation

Status: **proposed**.

**Given:** World pins tempted-fates/1.0.0.
**When:** A Knave resolution payload is submitted without a migration.
**Then:** Unsupported action/ruleset is rejected. No canonical event is appended.
**Oracle:** Schema/authority rejection and event count.

### R4-B3: No unrestricted content grant

Status: **proposed**.

**Given:** Manifest licenses only SRD text.
**When:** Importer includes setting artwork, logo or unlicensed module.
**Then:** Each asset needs independent permission evidence. Unresolved assets remain excluded from shared retrieval.
**Oracle:** Manifest/material membership; future ingestion test.

## Limits and open questions

- Knave1e mechanics cannot be frozen from storefront summaries alone; obtain source bytes and exact rule fixtures first.
- YearZero full-license access and AI-runtime applicability remain unresolved.
- Recheck the actually published OSE2026 license; do not build on a promised2027 CC release.
