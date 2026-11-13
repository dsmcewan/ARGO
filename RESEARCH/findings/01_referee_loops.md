# Referee loops and session coordination

Status: **starter**. Baseline: `05a292c403442a24b8f420e8b851f41f0f581ce5`. Prepared as codex_starter; requested seat `grok-4.3`; actual vendor execution: none.

Proposed session state is separate from world truth. Ten minutes is a usability budget, not ten world minutes. Timers, silence and disconnects never imply an action, consent or world-clock advancement. Narrative, UI and voice implementation remain deferred behind headless gates.

## Sources

- **R1-S1** [D&D SRD 5.2.1](https://media.dndbeyond.com/compendium-images/srd/5.2/SRD_CC_v5.2.1.pdf) — 5.2.1, 2025-05-01; primary_page; accessed 2026-11-13. Locator: Printed pp.5–6 Rhythm of Play / Ability Checks; pp.186–187 Passive Perception / Search.
- **R1-S2** [Cairn SRD](https://cairnrpg.com/first-edition/cairn-srd/) — First edition; primary_page; accessed 2026-11-13. Locator: Principles for Wardens: Information, Difficulty, Danger, Choice; Teamwork.
- **R1-S3** [Blades Action Roll](https://bladesinthedark.com/action-roll) — Online SRD, revision unspecified; primary_page; accessed 2026-11-13. Locator: Roll trigger; goal, method, position, effect, outcomes.
- **R1-S4** [Blades Core System](https://bladesinthedark.com/core-system) — Online SRD, revision unspecified; primary_page; accessed 2026-11-13. Locator: Judgment calls; Game Structure.

## Findings

- **R1-C1 (documented)** D&D describes situation, character declarations and adjudicated results, with opportunities for each character outside combat. This supports tracking invitations, not a particular queue algorithm. Sources: R1-S1.
- **R1-C2 (documented)** Cairn emphasizes useful information, understandable danger and clarification. Blades separates the intended goal from a fictional method and risk/effect judgments. These are ruleset-specific practices, not universal rules. Sources: R1-S2, R1-S3.
- **R1-C3 (documented)** SRD 5.2.1 distinguishes passive awareness from the Search action. Do not infer a universal passive floor for every active check or give the narrator authority to reveal hidden information. Sources: R1-S1.

## Proposed mechanics and fields

### R1-P1: Explicit referee/session state machine

Compatibility: **new_workflow**. Targets: SYSTEMS, MECHANICS, TESTS. Sources: R1-S1, R1-S2, R1-S3, R1-S4.

| Field | Type | Visibility | Meaning |
|---|---|---|---|
| `session_revision` | nonnegative integer | session_only | CAS for transport coordination, never ledger head |
| `phase` | enum FRAME COLLECT CLARIFY ADJUDICATE SUBMIT PRESENT ROTATE PAUSED ESCALATED REFRAME | session_only | Explicit state transition |
| `response_status_by_actor` | scoped map: awaiting/submitted/explicit_pass/deferred | session_only | Missing response does not fabricate a pass |
| `confirmed_intent_hash` | digest | actor_scoped | Invalidate confirmation if material stakes change |

- FRAME -> COLLECT -> CLARIFY -> ADJUDICATE -> SUBMIT -> PRESENT -> ROTATE; complete intents may skip CLARIFY. Missing rules go to ESCALATED. Stale heads go to REFRAME.
- Pinned rule/exception -> supported campaign ruling -> designated operator adjudication. Unsupported mechanics remain paused; the model cannot invent an authority rule.
- Solo budget proposal: first minute frame, minutes1–3 clarify, minutes3–8 resolve supported actions, final2minutes checkpoint. Validate this schedule with users.
- Party windows invite each participant before another ordinary invitation to the same participant; preserve actual ruleset initiative. Deliver private cues separately.
- World state changes only through supported TELOS proposals; epistemic acquisition requires its authorized commit path.

## Deterministic benchmark specifications

### R1-B1: Private passive cue

Status: **proposed**.

**Given:** A alone satisfies a pinned perception rule and sensory condition.
**When:** The perception procedure grants an observation.
**Then:** Only A acquires the claim after the authorized commit. B and the party view remain unchanged.
**Oracle:** Compare authorized claim-ID sets; this ruleset procedure is future work.

### R1-B2: Deadline is not an action

Status: **proposed**.

**Given:** A has submitted; B,C,D await invitations.
**When:** A submits again and the soft session timer expires.
**Then:** B,C,D retain invitation priority. No automatic pass, consent, proposal or world-time advance.
**Oracle:** Session transition table plus unchanged ledger head/time.

### R1-B3: Stale confirmation and retry

Status: **proposed**.

**Given:** Two intents target head H.
**When:** First commits, second submits against H, first retries unchanged.
**Then:** Second is rejected as stale. First retry returns original outcome and adds no event. Future session reframe invalidates confirmation when stakes change.
**Oracle:** Existing authority/CAS test patterns plus proposed session state test.

## Limits and open questions

- What invitation policy works for mixed text/voice and accessibility needs? No usability study is claimed.
- Perception mechanics require the selected versioned ruleset; current Tempted Fates has no general Search action.
