# Tempting Fates campaign design

The owner requests an RPG built from existing RPG structures and Greek myths, and clarified the tone as dark tragic mythology: horror, hubris and divine punishment. This pass builds a playable campaign kit, structured referee content, deterministic rules tools, and an adapter to ARGO's existing custody/speech/consent substrate. It builds on character-runtime `9d0f0e7` in a separate branch. It does not claim a new authoritative combat/travel engine.

## Intent and choices

**Owner decisions:** build the RPG; Greek myth adaptation; dark tragic mythology; prioritize the playable kit, strict TypeScript/JSON world schemas and deterministic tools; do not expand authoritative ledger or character authority for exploration/combat/resources in this pass; design clean state schemas for Phase2 promotion; all-campaign observer-owned characters and world-external narrator remain controlling. Preserve the supplied Tempted Fates scenario's voluntary choices, uncertain relics, separate Fate jurisdictions and hard anomaly boundary.

**Working choices, not attributed to the owner:** display title Tempting Fates; a compact original tragic archipelago; Knave1e-derived mortal rules; a harbor/pointcrawl open table; bounded faction projects. The two clarification answers explicitly selected the tone and kit/tool scope. God-specific taboos and punishments remain attributed tabletop consequences, not a universal moral attribute.

## Approaches

1. A Knave1e-derived campaign kit with original Greek material fits the verified source bundle and keeps the existing authority intact. Selected for this pass by the implementer.
2. A tactical D&D SRD adapter adds substantial rule and state surface before the world is playable; retain for a later explicit adapter.
3. A complete new authoritative exploration/combat engine needs a new causal ruleset, vitals, resource transactions and subject-scoped cutoffs. It must not be improvised as sidecar state or by granting players Atropos's end_thread permission.

The direct build request authorizes this content/tool implementation using the established flat blackboard workflow. It does not approve publishing, paid runs, or operational controller-policy promotion.

## Deliverables

- A usable player guide, rules reference, character sheet, referee guide, atlas, encounters and short solo/party starts. Provide actual costs, choices, procedures, example turns and consequences rather than merely future implementation tickets.
- Eight locations including an off-map loom, eight working mortal NPCs plus the three Fates, three factions, twelve sourced rumors, three fixed relic variants, persistent item identities and several independent starting opportunities. These are original campaign additions, not extracted canon.
- An additive closed content schema and TypeScript types, frozen before parallel content/code work. Reference checks reject duplicate/dangling IDs, unreachable ordinary sites, incorrect Fate roles and guaranteed ordinary routes to the loom.
- Pure rules tools for Knave-derived ability generation, strict d20 checks, capacity, damage/rest previews, morale and bounded project arithmetic. Explicit dice enter as inputs. The tools never draw secretly or mutate a ledger.
- A host-only pack validator/seed builder producing valid v1 Genesis plus character profiles for the existing runtime. Separate a minimal public handout and rumor candidate cards from referee-only truth. A card is not knowledge delivery or consent.
- Real-ledger integration proves private speech, custody/replay, stable variants, and no automatic gift/anomaly from preview calculations.
- A separate typed/JSON tabletop state blueprint under docs/tempting-fates/phase2 remains explicitly non-authoritative and documents atomic state/action invariants required for future promotion.

## Rules and content boundaries

One coherent core: six abilities; lowest3d6 determines bonus, defense=bonus+10; checks and attacks exceed target, ties fail; capacity is Constitution defense; 0HP unconscious, negativeHP dead in tabletop rules. Automatic ARGO death is NOT implemented by this toolkit. No PC receives end_thread authority. HP, travel/supplies, combat and faction effects are recorded by a human referee for tabletop play until a reviewed causal-rules extension exists.

Use original mythic situations involving xenia, burial, oaths, harvest, craft and divine patronage. Do not copy commercial adventures, bestiaries, art or modern translations. Ancient motifs have variant traditions; label this as a new campaign continuity. No universal reputation/hubris/moral score. A charisma check never creates consent to a time gift.

Knave1e attribution must name Ben Milton/Questing Beast, link the source and CC BY4.0, identify adaptations and avoid endorsement. Source PDF and license hashes are pinned by the existing evidence bundle. No Knave2e grant is implied. West Marches/clocks are organizational inspiration with original procedures, not copied article/SRD text.

Freeze source scenario and existing v1/character/projection schemas. The current anomaly cutoff is world/branch-wide; keep it out of ordinary campaign triggers. No automatic anomaly threshold, exhaustive public artifact truth, retroactive knowledge, background catch-up, or fake live service is added.

## Acceptance

The kit must support character creation and an opening session from its own prose and tables. All seeded sites, speakers, items and leads resolve. Public handouts/cards omit truth assessments, private NPC knowledge, hidden variant and seed. Variant selection is explicit at world creation and never rerolled by retrieval. Rules boundary examples are literal expected outputs, not implementation-derived oracles. Full existing gates and separate code/content review run offline; record exact code and evidence. Board submissions remain VERIFYING pending independent application-policy acceptance.
