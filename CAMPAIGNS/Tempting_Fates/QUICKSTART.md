# First play: a lamp before departure

**Referee material.** Read aloud only passages marked **Tell the travelers**. Keep the atlas, rumor assessments and selected world variant to yourself. One referee and one to six players can begin here after character creation. The opening works without introducing a relic or the Fates.

## Set up in five minutes

1. Make travelers using RULES.md and the character sheet. For a quick start, choose a background and starting kit rather than shopping. Keep each traveler's own reason for visiting Kymene.
2. Note the current world date, possessions and where each traveler is. Begin at the harbor in daylight. No faction project has advanced because people logged in or because preparation took time.
3. Read the harbor entry in ATLAS.md. Put its obvious people and problems in view. Keep hidden explanations and the remaining atlas off the player handout.
4. Choose the campaign's referee-only variant once: genuine, counterfeit or legend. Record that choice and initial custody. Do not change it after someone hears a rumor, reads the book or makes a successful roll. This opening does not require the artifact to appear.
5. For a short session, use the lamp conversation below. For a party evening, offer the independent departures that follow. Ask the players what interests them; do not assign a required objective.

## Tell the travelers

> Kymene's quay smells of wet rope and hot clay. A ferry is being unloaded. Across the harbor, a repair gang has stopped beside a broken span. A clerk has pinned a fresh notice over two older notices, neither of which has been removed.
>
> At a potter's stall, Melia wipes a lamp clean, examines its wick, and sets it aside. “That one's promised for a funeral. The ordinary ones are on the shelf.” She returns to her work.

Describe what the travelers can actually see. Melia is working, not waiting to recruit heroes. If they ask about the promised lamp, she can explain that it must reach the burial workers before they depart. She would prefer a named person to take responsibility for returning it. She can still arrange another carrier if everyone declines.

**Optional narrator aside:** *The city has a notice for everything. Repairs remain a largely oral tradition.* This is an external aside, not a fourth NPC or a voice anyone can interrogate.

## A ten-minute solo visit

The real-world ten-minute budget helps frame a small scene; it does not advance the world clock by itself.

| Moment | Referee action | Traveler choices |
| --- | --- | --- |
| Frame | Give the quay's observable details and invite one intention. | Shop, ask about the funeral, inspect the crossing, find work, or leave. |
| Clarify | If the traveler offers to carry the lamp, state the loan: one lamp, its present condition, destination and expected return. | Accept those terms, negotiate, refuse, suggest another carrier. |
| Resolve | Ordinary conversation and taking an offered object need no check. A consequential deception or physical risk uses a declared check. | Explain a plan before rolling; hear foreseeable costs first. |
| Record | If Melia actually hands over the lamp, record custody and who witnessed it. Record any disclosed account separately from whether it is true. | Decide whether to tell anyone else what was learned. |
| Checkpoint | Stop at a safe place with current possessions, pending obligations and elapsed world time written down. | Continue next visit, return the lamp now, or end with no transaction. |

Do not roll to make Melia consent to a gift of life. This is a loan of an ordinary object, not a hidden time-transfer contract. If the traveler offers something she does not want, she may say no. If they promise to return it, record the actual promise rather than inventing extra terms.

A successful visit can end with a borrowed lamp, a conversation, a fair purchase or nothing at all. No assassination, theft or supernatural revelation needs to occur to make the scene count as play.

### One worked adjudication

A traveler notices that a jar is tipping toward the edge of Melia's table and tries to catch it before it falls. The referee establishes that there is still a chance to react, announces a Dexterity check against15, and explains that failure breaks the ordinary jar and draws Melia's attention. The traveler has Dexterity+2.

- A d20 result13 gives15: failure. The jar breaks; no retry can unbreak it.
- A result14 gives16: success. The jar is caught. That does not automatically make Melia trust the traveler with everything she owns.
- If the traveler had already been holding the jar, no uncertainty would remain and no check would be needed.

Melia can remember the event through her own nature. Another witness can form a different impression. Record neither as a world-wide reputation award. Nobody automatically knows what happened merely because they share a party with the traveler.

## A party's first expedition

Offer three pressures independently. Use the relevant atlas/encounter entries for exact conditions and routes.

| Opportunity | Immediate question | What refusal means |
| --- | --- | --- |
| The funeral lamp | Will anyone take responsibility for carrying and returning an ordinary possession? | Melia seeks another carrier; the party is not punished for declining. |
| Grain and a seal | Why do the stores and the announced account disagree? | The people already involved continue their dispute; a clock advances only if its stated trigger occurs. |
| The crossing | Can the damaged way be used, repaired or bypassed before a planned journey? | The travelers can take another route, spend time elsewhere or remain in town. |

These are situations with interested people, not three mandatory quests. Players may combine them, invent a different business or decide that a quiet day sounds sensible.

Before departure, invite every player once: where are they going, what are they carrying, and what will make them turn back? Identify a route and pay its declared time and supply costs. Follow the exploration procedure in RULES.md. Rotate spotlight at changes of location or when one person's action leaves others waiting; do not let the loudest player acquire everyone else's decisions.

At an obstacle, describe approaches rather than one hidden correct answer. A broken span can be inspected, crossed with preparation, repaired, bypassed by boat or abandoned. Announce risks. A fight has visible opponents, room to withdraw or negotiate, and no obligation to kill everything present.

Use no more than one fully developed site in a short first session. The atlas remains available; it does not need to be consumed in order. A longer evening can visit two sites if the travelers have the time and supplies.

## Rumors at the table

Introduce a rumor only when a specific speaker tells it or a specific record is read. Use the quoted claim and speaker from the pack. Do not announce the referee's true/partial/outdated/false assessment. A speaker may be confident and mistaken.

If the traveler asks about an object that extends life, let an appropriate speaker share what they know or say they do not know. A rumor can lead toward an investigation; it cannot summon a relic into existence. The Fates are not automatically at the next destination, and a clue never obligates the traveler to pursue it.

When one traveler learns something privately, ask whether and how they later share it. Record that later disclosure at its own time. Do not give the other players' characters the knowledge merely because their players heard the table conversation.

## End the session with a checkpoint

Record the current place and world time; each object's custodian; supplies actually spent; injuries and other referee-managed tabletop state; promises actually made; who acquired each new account; and any faction project whose explicit trigger occurred. A project without a trigger does not tick. An absent player supplies no action or consent.

Write the next possible intention as an invitation, not a prophecy. “We might take the ferry” leaves room to change plans. “Next session the gods force them into the palace” does not.

## Using the ARGO adapter

The automated integration test demonstrates the supported part of this opening with real signed storage: host-selected seed, character configuration, a rumor disclosed to one traveler, an actual item transfer, unchanged state after rules previews, and replay. See `TESTS/tempting-fates-integration.test.ts`.

The referee's tabletop health, journey, food and faction records are not silently reconciled into v1 authority. Keep a human-refereed campaign record distinct from an automated ARGO world until its causal rules adapter is implemented. The software must refuse unsupported state-changing mechanics rather than print prose claiming they committed.

The existing anomaly cutoff applies to the entire world/branch. Do not trigger disappearance as an ordinary campaign event in a shared populated world. The original rare encounter remains available as source material and an isolated integration scenario; narrower encounter cutoffs need a versioned service change.
