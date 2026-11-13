# Characters and narrator — recorded intent

Status: **intent, not implemented**. Applies to **all ARGO campaigns**, explicitly confirmed by the owner on 2026-11-13 after supplying the excerpt. Checked against code baseline `40f9476fad68b0c73bb63f2575c355c1103294a0`; the relevant narrator, LEXI and mechanics files are unchanged in local repair candidate `bfe295761a96f879d14d8e81a763df7078ece97c`.

## Supplied material and labels

[owner-excerpt.md](owner-excerpt.md) preserves the supplied text with a final newline. It identifies itself as the opening of Claude's third version. Only that opening was received. The rest of section 4, `abuse-fragments/`, and the original questions—including 6 and 7—were not supplied or found in the checked repository. Their existence is reported by the excerpt; their substance and claimed measurement have not been verified. This archive is not a reconstruction of the complete version 3.

Retain the owner's terminology: **Decided** means the owner said it; **Proposed** means Claude suggested it without an objection; **Open** means undecided. Lack of objection does not turn Proposed into Decided. The opening does not individually label its sentences, so this archive does not invent the missing decision history.

**Decided in this conversation:** the design applies to all ARGO campaigns. Exact clarification: “All ARGO campaigns.” This is a general presentation/character direction; it does not export Tempted Fates' specific mythology or anomaly mechanic into every campaign.

## Supplied intent

The traveler does not own a collection of everyone else's feelings about them. Each person who interacted with or witnessed the traveler holds an impression interpreted through that person's own nature. Characters continue their own lives and speak sparingly. The narrator is a tired, sarcastic onlooker, unreachable by anyone in the world, and the only narrative participant described as holding the full record of the traveler's words and actions.

The final sentence above distinguishes a narrative participant from the implementation's authority storage. That is a proposed technical reconciliation, not a claim that the owner approved a storage design. A durable authoritative ledger must continue to hold canonical events even if no character can read the whole record.

## Proposed mapping to the current system

| Concern | Existing implementation | Proposed direction; not implemented |
| --- | --- | --- |
| Individual impressions | [Actor-scoped LEXI claims](../../../packages/lexi-bridge/src/index.ts); no impression/personality model | Observer-owned impressions with evidence, acquisition time and that observer's interpretive context. The traveler is the subject, not the owner of everyone's impressions. Conflicting impressions need not conflict with canon. |
| Legitimate observation | [V1 observe_claim validation](../../../packages/ledger/src/mechanics.ts) permits the reviewed source/acquisition gap | Define authenticated recorder, asserted source and authorized acquisition before impressions depend on them. Being listed as an observer is not proof of presence or perception. A communicated impression may become another actor's sourced belief; no automatic sharing follows. |
| Sparse, occupied characters | Optional proposal subscribers can remain silent; no general schedules/attention model | Independent activity and selective speech; no invented numerical word limit, mandatory reaction, or quest pressure. |
| Narrator voice | [Three current persona labels and render adapter](../../../packages/argo-dm/src/index.ts) | Apply the stated voice across campaigns through a future defined presentation contract. Whether old personas remain, become modes, or are replaced is Open. |
| Narrator's full record | Narration currently receives an authorized view and outcome; ledger stores committed events, not all conversation | A separate read projection/archive could supply the traveler's bounded history. Completeness, retention and treatment of attempted/rejected actions and speech are Open. A full record need not reside in one model context or model-owned mutable memory. |
| Unreachable narrator | No narrator gameplay principal exists | Separate world-facing actions from player/interface controls. In-world characters cannot summon, bargain with, or grant authority to the narrator; exact treatment of player-facing controls remains Open. |

The proposed archive/read projection must define what the narrator may receive and what each audience may hear separately. Current party privacy, rights/tenant/branch isolation, and the Tempted Fates post-anomaly cutoff remain implemented constraints, not permissions superseded by a new tone. “Full record of what the traveler said and did” grants no inferred access to hidden RNG, consent evidence, other actors' private thoughts or other worlds. Any expanded read surface needs an explicit export/disclosure contract.

## Open details from this reconciliation

These are new unnumbered questions; they do not replace or renumber the missing original questions.

- What counts as “said and did”: committed actions, spoken dialogue, failed attempts, or a larger session transcript? Which sources establish completeness?
- How may full-record narration influence a private session versus a shared party audience? What explicit disclosure permits crossing that boundary?
- What persists about an observer's nature and impressions, and how do new experiences revise them without rewriting prior history?
- How does the narrator's singular voice relate to the existing selectable persona labels and player-facing controls?
- What does section 4 mean by the known abuse, and what does the measured fragment demonstrate? No behavior is inferred before that material is supplied.

## Dependencies before implementation

First restore the missing source sections and decide the open record/disclosure semantics. Version observation provenance/acquisition and lifecycle policy before relying on impressions; those remain open in the external-review follow-up. Define the shared contracts and archive/projection storage before parallel workers implement observer impressions, character activity and narration. Proposed acceptance examples: two observers form different impressions from the same event; an uninformed third character receives none; private history does not enter shared narration without authorization; character speech cannot command the narrator; and the existing Tempted Fates cutoff still suppresses exposition despite retained history.

These are proposed acceptance cases, not tests that have run. This ticket saves documentation only. It changes no runtime, frozen schema, trusted policy, prior repair candidate or public repository.
