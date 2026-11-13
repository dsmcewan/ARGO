# Tempted Fates: source-grounded requirements

Source supplied by the user: [Tempted_Fates.md](../SCENARIOS/Tempted_Fates.md). The retained copy is byte-identical to the attachment; provenance and SHA-256 are in [tempted-fates-source.json](evidence/tempted-fates-source.json).

This is Phase 1 requirements extraction for later architecture and Integration Test Zero. It does not freeze schemas, implement a ruleset, or advance the phase gate. Pantheon source remains unavailable.

## Canon boundary

The source's final interpretive boundary (line 383) distinguishes the core constraints from connective dialogue and the conditional example. Preserve the story laws and explicitly required knowledge/state behavior; do not turn the seven scenes, precise wording, punctuation, donor relationships, or an anomaly occurrence into a mandatory gameplay sequence. Foundational lines retain the author's voice without obliging every encounter to recite them.

The original task also requires actor acquisition-time cutoffs, rights-lane isolation, scoped proxy grants and deterministic replay. Those requirements remain in force; this scenario supplies examples, not a replacement for the system requirements.

## Independent Fate jurisdictions

| Agent | Permitted concern | Explicitly outside her authority | Source |
| --- | --- | --- | --- |
| Clotho | Beginnings, appearing threads, possible starts | Thread duration and the bearer's choices | Lines 26, 326, 340 |
| Lachesis | Length, allotment, order, accounting of time | How years should be used or who deserves them | Lines 27, 326, 340 |
| Atropos | The end of a thread | The story before the end, virtue, worth | Lines 28, 326, 340 |

Their knowledge does not confer authority over the traveler. They do not combine into an omniscient narrator, solicit gifts, impose quests, or issue moral verdicts. Natural dialogue can differ across runs while these boundaries hold. Existing TELOS build components with these names are not implementations of these fictional agents.

## Traceability for later Integration Test Zero

These are acceptance behaviors to implement after the earlier phase gates pass, not executed tests or frozen field names.

| ID | Requirement and source lines | Later verification behavior |
| --- | --- | --- |
| TF-01 | Voluntary encounter and open choice: 14–18, 149, 196, 320, 332 | Walking away, refusing a transfer, finding no relic or never meeting the Fates must remain valid outcomes. No hidden quest advancement or forced payment follows refusal. |
| TF-02 | Separate truth, history, accounts, rumor and beliefs: 324, 329, 336 | An external recording or rumor does not create a fact in this world. Actor-specific claims retain source/time/scope; unknown properties are not disclosed because the authority knows them. Apply the original task's temporal/party-isolation guards too. |
| TF-03 | Causal artifact history: 92, 325, 336 | A valid custody/movement/destruction event changes the relic's supported state. Consulting a guide causes no relocation. Similar world geometry does not imply shared item identity, custody or existence. |
| TF-04 | Independent bounded agents: 26–32, 326, 340 | Each Fate acts and speaks within her own responsibility. Asking one sister about another's concern cannot acquire the other's authority or a global knowledge view. |
| TF-05 | Honest living donor and explicit choice: 164–166, 196, 327, 338 | A purported gift without a living donor's informed, free choice is refused as an honest transfer. Narrator prose, proxy assertion or the recipient's preference cannot supply the donor's missing consent. Preserve the original task's scoped authority constraints. |
| TF-06 | Recorded transfer and resulting state: 327, 338 | Retain donor identity, what was offered, when, knowledge/conditions, informed choice, effective measure and resulting state changes. Commit validation precedes narration. No off-screen debit creates a twist. A rejected proposal causes no transfer. |
| TF-07 | Extra time does not imply rejuvenation or reward: 166, 178–192, 328 | A transfer alone cannot reset age, manufacture a new beginning, grant achievement or attach an automatic happiness/virtue judgment. |
| TF-08 | Anomaly is rare and contingent: 18, 242, 330 | A fixture may start from a canon-permitted anomalous state to test its consequences. That fixture must not install a guaranteed production trigger, a farmable transfer threshold or a promised discovery. |
| TF-09 | Post-naming engagement cutoff: 266–296, 331, 340 | Once Clotho has named the anomaly in the encounter, the Fates no longer acknowledge or explain the threadless traveler. Repeated questions, another sister or a persona switch cannot reopen engagement. Ordinary work-related speech remains permitted. |
| TF-10 | No explanatory epilogue or surrogate disclosure: 306, 310–312, 331 | Narrator/persona output and other speakers cannot conclusively explain the anomaly on the Fates' behalf. Do not leak the author-facing explanation into player context as a reward for reaching this state. |
| TF-11 | World and consequences persist: 304–306, 332, 346 | The world continues; prior gifts, choices and consequences remain recorded. Distress or the missing thread does not automatically restore donated time or declare the traveler evil, blessed, victorious or damned. |
| TF-12 | Authority owns state; narrative renders it: 338, plus original task | Independent Fate/NPC/intervention output remains untrusted. Prose cannot move relics, transfer time, create an anomaly or erase history. Epistemic observations and causal changes use their respective authorized commit paths. |

## Cutoff interpretation to carry into Phase 2

The original task requires no ontological exposition after the thread vanishes. The supplied source makes naming the anomaly an explicit point after which engagement ends, and shows the sisters continuing work-related utterances. Preserve both constraints: the production contract must not permit exposition during an assumed gap between disappearance and naming, nor interpret the cutoff as universal muteness.

The source does not define a machine event ordering between disappearance and naming. Phase 2 must specify that ordering and its authority without turning a narrator's arbitrary text into a world mutation. Phase 4 can then test prompts immediately before and after the committed boundary, including multiple events at the same world timestamp. This is a design obligation, not an already chosen schema.

“No one conclusively explains it on their behalf” also covers narrator personas and other agents. The author-facing core-paradox paragraph is design context; it is not permission to narrate an ontology after the cutoff.

## Decisions the source does not make

- No fixed relic name, location, existence, powers or public inventory is supplied.
- No anomaly probability, lifetime threshold, farming recipe or algorithm is supplied.
- Time units, rounding, transaction schema, consent evidence and ruleset-specific accounting remain mechanics decisions. Do not claim a boolean emitted by a model proves free informed consent.
- No guarantee of an immortal, youthful or happy recipient follows from the transfer or anomaly.
- No consent revocation/time-of-commit rule is defined here; integrate the original task's authority requirements during the contract phase.
- The example's family/love, regret, dialogue order and resulting absences are possible history, not events to force on every player.

The missing-scenario-source blocker is resolved. The strict dependency spine remains at Phase 1 until the actual Pantheon harness can be audited.
