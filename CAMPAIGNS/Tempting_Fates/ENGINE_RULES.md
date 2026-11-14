# Tempting Fates: executable mortal rules

`mortal-rules/0.2.0` implements combat, travel, exploration, supplies, rest and custody for **new worlds**. It is the owner's authorized successor to the campaign kit's human-refereed physical rules. The original books and calculators remain a record of version 0.1; this file identifies the implemented adaptations. The frozen [contract](../../SYSTEMS/mortal-v2/CONTRACT.md) specifies exact adjudication order. The [implementation and evidence](../../docs/rpg-phase2/README.md) describe integration and measured balance.

The underlying mortal framework adapts **Knave 1.0 by Ben Milton / Questing Beast**, under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Retain the campaign's [source attribution and license boundaries](ATTRIBUTION.md). This executable version changes initiative, retreat, active-time supplies, container accounting and finite action procedures as described below; it adds no endorsement or repository-wide license.

## Playing the implemented loop

A host initializes one immutable campaign variant and supplies authenticated player/NPC identities. Players see their own inventory, resources and location plus admitted encounter facts. They submit structured actions; the authority validates ownership, scope, current state and costs before drawing dice. Accepted actions enter signed history and produce a new snapshot. Rejected actions spend no time, resources or randomness. Retrying the same authenticated request returns its original receipt rather than acting twice.

The host frames situations and declares encounters. It cannot use its referee role to take a player's combat turn. This release has an executable headless API, not a new interface or automatic narrator integration.

| Area | Implemented resolution |
| --- | --- |
| Character creation | Each ability bonus is the lowest of 3d6; starting HP is d8, with an explicit optional minimum of 4. Creation draws have a separate deterministic seed domain. The host selects the HP rule before genesis. |
| Travel | An adjacent declared route advances its stated ten-minute turns. Optional authored hazards and darkness are enforced. No teleporting between sites. |
| Exploration | An authored search uses d20 + ability against its target. A search may be attempted once per actor; forage may repeat against finite stock and time costs. Successful rewards must fit capacity. |
| Supplies | The first positive activity prepays a ration and water for one active day. Later active-day boundaries charge again. Missing food and missing water each inflict d4 damage. Another actor's waiting does not consume your supplies. |
| Light | A dark route or opportunity needs a held lamp, fire kit and one oil unit per ten-minute turn. Insufficient light refuses before time is spent. |
| Load | Capacity is Constitution + 10 slots. Items, rations and water take slots; oil, coins and ammunition use the contract's fixed stack sizes. Empty containers are abstracted in this version. |
| Trade and custody | Finite local stock costs real obols and credits the seller's treasury. Owned items/resources can be given locally; ground items can be picked up; dead actors' items can be looted. No automatic loot or shop reset. |
| Rest | Eight hours at a safe site, with food/water coverage and no encounter, heals d8 + Constitution up to maximum HP. One rest allowance per personal active day prevents repeated short rests. HP 0 can recover; negative HP cannot. |

## Combat and retreat

An encounter is a small abstract fight within weapon range. One initiative d6 chooses the first side; order then remains fixed. A legal attack needs the actor's turn, an owned equipped weapon and a standing opponent. Roll d20 + the weapon's ability bonus **strictly above** defense; a tie misses. A hit deals the weapon's d4, d6 or d8. Ranged attacks consume ammunition even when they miss. Defending gives +2 defense until the actor's next turn.

HP above 0 is standing, 0 is unconscious, and below 0 is dead. Incapacitated actors cannot attack, explore, trade or escape. The engine grants no plot armor or automatic resurrection.

When the host declared an available exit, retreat succeeds on the actor's own turn without a hidden roll or free enemy attack. Initiative can still expose the actor to a blow before that turn. Retreat removes that actor from the encounter and represents reaching nearby shelter **at the same site**; traveling elsewhere remains a separate action. A closed encounter has no escape action. No pursuit mechanic is silently added.

A completed round costs six seconds once, including a partial round that ends the encounter. Every participant from that round receives its activity cost, including someone who escaped during it. The encounter ends when one side has no standing unescaped participants. Other participants' resources, exact HP and private discoveries are not disclosed in the actor view.

## Campaign adaptation

The initializer preserves seven ordinary sites and nine ordinary routes, the genuine/counterfeit/legend variant, and existing mortal custody. It adds one starting weapon, lamp, fire kit, two rations, two water, six oil and twenty obols per traveler; a sling also receives twenty ammunition. Eight mortal NPCs receive a small ordinary stat block and working knife. These are versioned implementation choices, not claims about a published ruleset's exact balance.

The initializer adds finite harbor food/water stock, an olive-verge forage opportunity, and a quarry oil search. Ordinary routes currently have no automatically inferred hazard or darkness. Reaching the causeway is not crossing it. A host can author explicit hazards in a new validated genesis; prose alone cannot introduce one midway through play.

Clotho, Lachesis, Atropos and the loom are excluded from mortal combat. The existing Fate actions, voluntary donor transfers, anomaly cutoff, character impressions and narrator policy remain in their existing profile. They have **not** been migrated into this physical journal. Never run both writers against one world/branch. Combining them requires a separately frozen unified authority and migration contract.

## Balance and next playtests

The target is dangerous encounters with viable retreat. A preregistered experiment compares fight, immediate retreat and retreat when wounded, with starting-HP and armor alternatives, using the real resolver and separate training/held-out seeds. See the retained [balance protocol](../../docs/rpg-phase2/balance/PREREGISTRATION.md) and results linked from the implementation record. Numerical survival targets are the implementation team's operational definition, not a promise that every encounter is survivable.

The study uses fixed combat builds and explicit resource scenarios. It cannot establish campaign economy, player enjoyment, optimal tactics or all party sizes. Grid movement, pursuit, morale, grappling, spell systems, character advancement and simultaneous separate encounters are outside this profile. Human sessions should next test whether players recognize danger soon enough to retreat, whether supplies create interesting decisions, and whether the campaign's quiet mythic boundaries survive actual play.
