# Sources, changes and rights

The mortal rules in this campaign adapt **Knave, version 1.0 (first edition)**, created by **Ben Milton / Questing Beast**, under the **Creative Commons Attribution 4.0 International license (CC BY 4.0)**.

- Author/source: https://questingbeast.itch.io/knave
- Author release announcement: https://questingblog.com/knave-1-0/
- License: https://creativecommons.org/licenses/by/4.0/
- Legal code: https://creativecommons.org/licenses/by/4.0/legalcode
- Retained unmodified [first-edition PDF](../../docs/design/headless-2026-11-13/evidence/knave-1e/knave-1e.pdf), [license text](../../docs/design/headless-2026-11-13/evidence/knave-1e/CC-BY-4.0.txt), [source manifest](../../docs/design/headless-2026-11-13/evidence/knave-1e/manifest.json), and [grant evidence](../../docs/design/headless-2026-11-13/evidence/knave-1e/SOURCE-GRANTS.md).

| Retained artifact | SHA-256 |
| --- | --- |
| `knave-1e.pdf` | `fc2ff96175f6b60ddbbf02b6139a5da569752155948371613e201d21cf92bc78` |
| `CC-BY-4.0.txt` | `9ba9550ad48438d0836ddab3da480b3b69ffa0aac7b7878b5a0039e7ab429411` |

These hashes were checked against the actual retained files for this implementation on 2026-11-14. The 301,140-byte PDF came from the public redistribution mirror https://illusorysensorium.com/content/files/2024/06/Knave.pdf, with a byte-identical Internet Archive copy documented in the manifest. It is a corroborated mirror artifact, not a download authenticated by an author-published checksum. The upstream PDF and official license text remain unchanged.

## What was adapted

Knave supplies the six-ability structure; the lowest of three d6 for each bonus and defense ten higher; classless equipment-based play; strict d20 saves and attacks; advantage/disadvantage; Constitution-defense slots; ordinary d8 starting HP; the zero/unconscious and negative/dead distinction; d8+Con ordinary healing; and 2d6 morale. The source was read directly, including the creation, save/combat, morale and healing sections; this is not an inferred second-edition rules license.

The new rules text, tables and pure calculators identify these campaign choices and changes:

- Original dark tragic Greek-myth continuity and practical equipment names; fictional obol prices replace copper pricing. Starting possessions and money are a fixed finite allowance. Armor, weapons, bundle sizes, ranges, lamp/torch durations, optional mortal templates and signposted bounded divine-taboo examples are campaign choices, not taken from another Greek RPG or modern translation.
- Personal nature, priorities and observer-owned impressions replace random alignment and any universal moral/reputation attribute. The sheet does not combine what others think of a traveler.
- Exactly one starting d8, without Knave's suggested optional low-HP reroll. This release supports level one and does not include Knave's XP/level progression.
- Attacker-only combat rolls; no separate player-facing defense roll, critical-hit damage, item-quality deterioration, ideal-weapon bonus damage, or advantage-for-an-extra-stunt option. Original retreat, pursuit, carrying and fall procedures are stated expressly.
- Fixed six-second combat rounds, ten-minute exploration turns, four-hour watches and a 360-day year; original travel/foraging/supply limits and finite project arithmetic. These are game conventions, not claims about ancient calendars or Knave's exact timing rules.
- One ordinary healing opportunity per 24 hours after food, water and eight hours' safe rest. The separate Knave safe-haven full-heal benefit is omitted; negative HP cannot be healed by resting.
- No player spellbook, copied spell list, divine-boon engine, universal mythic canon or executable ritual subsystem. Oaths, persuasion and character creation never establish consent for a time gift.
- New closed data interfaces, passive-input validation and arithmetic bounds. The TypeScript functions are deterministic previews; neither dice fairness nor permission nor canonical state follows from their output.

## Other inspirations

The [sandbox/concurrency research](../../RESEARCH/findings/02_sandbox_concurrency.md) discusses Ben Robbins's [West Marches](https://arsludi.lamemage.com/index.php/78/grand-experiments-west-marches/). The [world-simulation research](../../RESEARCH/findings/03_world_simulation.md) discusses progress clocks, faction turns and finite simulation budgets; the [Blades in the Dark clock reference](https://bladesinthedark.com/progress-clocks) is one source. These informed the organizational ideas of checkpointed expeditions and visible finite projects. The procedures in this kit are newly written; no article, adventure or clock-rule passage is copied. Those citations do not grant a license to unrelated source text, brands or artwork.

Ancient mythic motifs have multiple traditions. This campaign is an original continuity, not a modern translator's text or a copy of another Greek-themed RPG. The user-supplied [Tempted Fates scenario](../../SCENARIOS/Tempted_Fates.md) retains its own authorship and controlling boundaries; its title and source file are preserved.

## License scope

The CC BY 4.0 notice preserves the rights and attribution attached to **Knave first-edition source material**. Retain the author, source and license references and identify these modifications when redistributing its adapted material. No endorsement by Ben Milton, Questing Beast or Creative Commons is claimed.

This notice does **not** license Knave second edition, grant trademark rights, or announce a blanket license for ARGO's software, original setting, character prose, user-supplied scenario, private uploads or other assets. Their owners and any existing applicable licenses retain control. No new repository-wide or setting-wide license is granted here, and the absence of such a grant does not remove the existing CC BY 4.0 rights in the Knave source.
