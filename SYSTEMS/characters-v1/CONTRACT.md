# Character memory profile 1.0.0

Implementation profile for the owner's all-campaign character/narrator intent. This is additive to frozen gameplay v1 and the read-only projection-v2 profile. No prior event is reinterpreted as authenticated speech. The first transport uses the existing v1 signed ledger; a future ruleset adapter can carry the same character interfaces separately.

## Authority and storage

The profile uses private v1 `observe_claim` carriers with claim/proposal ID `argo_character_` plus SHA256 of `{scope,request_id}`. Carrier source and sole outer observer are the configured system actor; party is null. Canonical JSON content is a `CharacterEnvelope`. Only the exact configured system principal ID/actor/role, matching scope, outer observation shape, request identity and valid envelope qualify. User-authored lookalikes are ignored by this projector, not accepted as character events. Malformed system-authored reserved carriers fail closed. Ordinary LEXI actor views do not receive genuine carriers.

`createCharacterAuthority` accepts a host-owned ledger and authenticated system principal. Its public command boundary accepts authenticated player/NPC principals; configure and witness-action commands require the exact system identity. Constructor capabilities and authentication come from the host; JSON role labels are not authentication. No agent gets this system identity or writer handle.

Commands bind scope, request ID and exact expected cursor. `characterRequestHash` hashes `{command, principal:{principal_id,actor_id,role,scope}}`. Exact committed retries return the original receipt; changed request bytes or requester identity conflict. Host witness adjudication runs outside the ledger lock under a bounded service call, then current head/state is checked again by ledger admission. Scope/current-head/dead-actor failures append nothing. Speech and impressions require a living direct player/NPC; narrator is not a principal or addressable entity. Address IDs must name actual living actors, but cannot prove presence.

The host callback `authorizeWitnesses({kind,actor_id,record_id,text,addressed_actor_ids}, snapshot, call)` returns `CharacterWitnessGrant`. For speech `record_id` is null; for action it is a verified committed action hash. Witness identities must exist and be alive; the source actor is included automatically. A non-null party requires source and every witness to be members. The callback is required: omission is unavailable, not implicit global witnessing. It must adjudicate legitimate perception/disclosure from host scene data; this repo has no spatial perception engine. Callback input/output is detached and runtime validated. A model cannot set the witness list through a command.

## Durable meanings

`configure` installs an actor-owned profile with consecutive nature revision, activity and caller-chosen speech policy. Only the host system may configure. The first configuration activates capture at its ledger sequence. `set_activity` changes only the authenticated actor's activity without rewriting nature history.

`speak` records the actual authenticated speaker, exact accepted text, living addressed actors, adjudicated witnesses and explicit party disclosure. Arbitrary old claims and rejected input are not speech. Post-anomaly/cutoff speech is refused; the existing deterministic work/silence renderer remains separate.

All eligible committed causal actions by actors after activation become narrator records automatically. Their text is a deterministic whitelist description; seed, RNG result/nonce, consent terms/proofs/signatures and private grants never become narration text. System clock/RNG bookkeeping is not a traveler action. `witness_action` adds authenticated acquisition/disclosure for an existing action record; it cannot invent an action or arbitrary summary. Acquisitions carry both recording sequence and world tick. A later witness annotation never backdates knowledge.

`form_impression` records the authenticated observer's interpretation, subject, nonempty evidence hashes, current nature/revision, and prior impression ID. Every evidence item must be an acquired record about that subject at the current prefix. The prior ID must match the latest observer/subject revision (null for the first). Impressions are beliefs, never canonical facts. They are stored once; replay never asks a model to regenerate them. Different observers may disagree. No reputation map is attached to the traveler.

## Views and narration

Authority-only `CharacterProjection` contains verified source state, profiles, records and acquisitions, impressions, membership and current cutoff. It must not be sent to a worker. `createCharacterViews` obtains it from a trusted fresh host reader and checks scope/cursor/identity before selection. Current-prefix queries refuse stale or future cursors; historical replay is an explicit reducer operation, not a read bypass.

An actor view contains only that actor's profile, current life/activity, last accepted speech time, latest impression for each subject, and the latest16 acquired experiences. Every returned DTO is detached. It is not the complete narrator archive. A traveler cannot query another observer simply by being the impression's subject.

A narrator query binds traveler, authenticated viewer, full scope, current cursor, audience/party and pagination. Private actor audience requires viewer=traveler. Party audience requires both members and explicit viewer acquisition with that same party ID. Filter first, then paginate visible records; do not expose hidden-row totals or cursors. Page limits are1..128. Coverage identifies activation and current prefix; completeness means accepted speech and eligible committed actions since activation, never earlier chat or rejected attempts. Narrator pages contain no observer impressions, witness lists, authority proofs or hidden rolls.

The narrator adapter receives only a fresh audience-filtered page. It verifies scope/viewer/traveler/audience/party/cursor/page binding before invocation and again before delivery. Any changed authorized context or current cutoff discards generated prose. Private cache identities include tenant/rights/world/branch/viewer/audience/party/session and traveler. Incoming speech and prompt text are untrusted quoted data, not system instructions. Narration returns prose only and has no writer capability.

The voice is a world-external, tired, dry, sparingly sarcastic onlooker. Existing persona names remain compatible presentation hints; none grants an in-world narrator principal. Persona changes cannot reopen Tempted Fates' cutoff. This is not a live-model tone guarantee.

## Character behavior

The optional character agent interprets only its authorized evidence through its own recorded nature. Interpretation and speech callbacks may decline with null. It emits proposals, never commits. Busy, ended, cutoff, unaddressed or cooldown-bound characters return silence without calling the speech planner. An addressed record must actually list that actor; ambient text cannot forge a direct summons. The configured speech character budget is enforced; no universal literary word count is invented. The host refreshes state between separate impression/speech proposals.

## Limits and compatibility

This implementation does not supply missing section4/abuse fragments, a general world scheduler, a live identity service, a physical perception engine, a persistent external graph, UI/voice, or new causal rulesets. It does not repair old v1 source/lifecycle permission gaps globally. New-profile admission and projection enforce their own versioned semantics while old signed histories remain unchanged. Current ledger cold-replay and crash-recovery limits remain. Protected application-policy adoption is separate from regression verification.
