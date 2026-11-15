# Character profile API 1.0.0

Profile constant: `CHARACTER_PROFILE = 'character-memory/1.0.0'`. Reserved carrier prefix: `CHARACTER_CLAIM_PREFIX = 'argo_character_'`. The exported TypeScript grammar is `packages/contracts/src/character-types.ts`; `characters.schema.json` is the corresponding JSON grammar. Every object is closed to unknown fields. `Scope` is the frozen v1 full tenant/rights/workspace/campaign/world/branch scope.

## Contract helpers

- `assertCharacterContract<K extends keyof CharacterContractMap>(name: K, value: unknown): asserts value is CharacterContractMap[K]` validates JSON shape, passive canonical DTOs, full scope identity and locally decidable semantic relationships. It does not authenticate a principal, witness, provider, signature or current state.
- `assertCharacterPrincipal(value: unknown): asserts value is Principal` performs passive DTO inspection, frozen v1 Principal validation and complete scope-identity validation before consumers detach authentication input. It validates structure; the host still authenticates the identity.
- `characterRequestHash(command: CharacterCommand, principal: Principal): string` returns SHA256 of canonical `{command, principal:{principal_id,actor_id,role,scope}}`, after validating both and requiring identical scope. `confirmed_receipts` deliberately does not affect this identity.
- `characterProposalId(scope: Scope, requestId: string): string` returns `argo_character_` followed by SHA256 of canonical `{scope,request_id:requestId}`. The resulting ID is both carrier proposal ID and claim ID.
- `characterSchema` exposes the frozen in-process schema object.

## Commands and authoritative envelopes

`CharacterCursor = {sequence, head: string|null, world_time}`. Sequence and world time are safe nonnegative integers. Head is null exactly when sequence is zero; otherwise it is a lowercase SHA256.

`CharacterCommand = {version, scope, request_id, expected_cursor, body}`. `body.type` discriminates:

| Type | Remaining body fields |
| --- | --- |
| `configure` | `profile: CharacterProfile` |
| `speak` | `text`, `addressed_actor_ids: string[]` |
| `witness_action` | `record_id` (existing action hash) |
| `form_impression` | `subject_actor_id`, `evidence_ids: string[]`, `interpretation`, `previous_impression_id: string|null` |
| `set_activity` | `activity: CharacterActivity` |

The speak command has no speaker, source, role, observer or party override. Its speaker is the authenticated principal. `CharacterProfile = {actor_id,revision,nature,activity,speech_policy}`, where revision starts at1; `nature = {description,priorities:string[]}`; `activity = {description,busy_until}`; and `speech_policy = {max_characters,minimum_interval}`. Runtime admission—not the shape guard—enforces consecutive nature revisions, permissions, current life and cooldown.

`CharacterWitnessGrant = {request_hash,actor_ids:string[],party_id:string|null}`. The host callback request includes `request_hash` and the grant must echo that exact hash. For speech, stored grant max64 includes the automatically added living source actor; a host grant with64 other actors is refused rather than truncated. For witness_action, the historical source already owns its original acquisition; add living new witnesses without requiring a new acquisition for a now-dead source. The authority rejects unknown/ended new witnesses and invalid party disclosure; source party membership remains required. Grant bytes alone are not proof of legitimate perception.

`CharacterEnvelope = {version,scope,request_id,request_hash,requester:{principal_id,actor_id,role},body}`. Its body variants are:

| Type | Remaining body fields |
| --- | --- |
| `configure` | `profile` |
| `speak` | `actor_id`, `text`, `addressed_actor_ids`, `witnesses: CharacterWitnessGrant` |
| `witness_action` | `record_id`, `witnesses: CharacterWitnessGrant` |
| `form_impression` | `data: CharacterImpressionData` |
| `set_activity` | `actor_id`, `activity` |

`CharacterImpressionData = {owner_actor_id,subject_actor_id,evidence_ids,nature_revision,nature,interpretation,previous_impression_id}`. Envelope identity fields come from admission, not model input. Speech/activity actor and impression owner must match requester actor. Configure/witness-action requires a system requester; speech/impression/activity requires player or NPC. Every included grant hash equals the envelope request hash. Replay reconstructs the original command using the preceding outer cursor, then checks request hash and all permission/state invariants again. The configured carrier principal is stable for the profile lifetime: a reserved system carrier under a different service identity fails closed rather than being ignored; changing this identity requires explicit migration. Ordinary-user marker lookalikes grant no character authority.

`CharacterReceipt = {version,scope,request_id,request_hash,event_id,event_hash,cursor,kind}`. `kind` is the command body's type; `cursor.head` equals event_hash and `event_id` is `event_<cursor.sequence>`. Receipts bind the complete submitted identity; a matching request ID alone is insufficient.

## Projection and reads

`CharacterExperience = {record_id,kind:'speech'|'action',actor_id,principal_actor_id,sequence,world_time,text,action_type:string|null,addressed_actor_ids}`. Speech has null action_type and matching actor/principal_actor. Action summaries have an eligible committed action type; system advance_time/draw bookkeeping is excluded. record_id is the source hash. Arrays of experiences are ordered by increasing source sequence and contain unique record IDs.

`CharacterAcquisition = {actor_id,sequence,world_time,party_id:string|null}`.
`CharacterMemoryRecord = {experience,acquisitions:CharacterAcquisition[]}`.
`CharacterImpression = {impression_id,sequence,world_time,data:CharacterImpressionData}`.

`CharacterProjection = {version,scope,cursor,activation_sequence:number|null,profiles:CharacterProfile[],actors:{actor_id,alive}[],parties:{party_id,actor_ids}[],records:CharacterMemoryRecord[],impressions:CharacterImpression[],ontology_blocked,engagement_closed}`. This is authority-only host data. Internal history arrays have no lifetime count cap. They remain subject to actual storage/memory availability and the ledger's documented replay costs. `activation_sequence` is set once; configure never resets activation, past speech, acquisitions or impression predecessor chains.

`CharacterActorQuery = {version,scope,cursor,actor_id}`.
`CharacterView = {query,profile:CharacterProfile|null,alive,last_spoke_at:number|null,impressions:CharacterImpression[],experiences:CharacterExperience[],ontology_blocked,engagement_closed}`. The profile and every impression belong to query.actor_id. Impressions contain the latest revision for each subject without silent subject truncation. Experiences contain at most the latest16 authorized records. Null profile means unconfigured; planners must decline until configured.

`CharacterNarratorQuery = {version,scope,cursor,traveler_id,actor_id,audience:'actor'|'party',party_id:string|null,after_sequence,limit}`. Actor audience requires actor_id=traveler_id and null party_id; party audience requires a non-null party ID and runtime membership/disclosure checks. after_sequence is between zero and current cursor.sequence. Limit is1..128.

`CharacterNarratorView = {query,records:CharacterExperience[],coverage:{activation_sequence:number|null,through_sequence,captured_kinds:['speech','action']},next_after_sequence:number|null,ontology_blocked,engagement_closed}`. records are the selected traveler's visible experiences after filtering, then pagination; each sequence exceeds after_sequence. through_sequence equals query.cursor.sequence. A non-null next_after_sequence equals the final visible record's sequence; no hidden-row total or hidden-only page is exposed. Public source sequence/cursor values reveal ordering and may contain gaps; the interface does not conceal all event existence or timing/count metadata. Cutoff pages contain no records or continuation. Coverage does not promise earlier chat/rejected attempts or authorize hidden record disclosure.

The combined `createCharacterViews` factory is privileged host wiring. NPCs receive only their actor DTO/read capability; the narrator receives only its scoped loader. Neither receives the combined host view object or full projection.

## Bounds and trust

Descriptions: nature4096 characters, priorities up to16 strings of256, activity2048. Speech text up to8192; configured speech budget1..8192. Interpretation4096; evidence1..64 distinct hashes; addressed actors and granted witnesses up to64 distinct IDs. These are Unicode code-point string bounds. Envelope canonical JSON must fit the frozen carrier's65536-character content limit. Requests/public DTOs and internal projections reject accessors, proxies, symbols, sparse/decorated arrays, cycles, exotic prototypes and unsafe integers before reading values. Structural nesting is bounded; this is not a transport-byte or historical record-count quota.

Schema/shape validation does not establish current eligibility or source provenance. The authority authenticates/revalidates at append, and replay validates inner semantics at every preceding prefix. Readers authenticate scope/viewer, require the current prefix and current cutoff, and filter acquisition before releasing data. An impression is never a canonical fact and is never automatically shared with its subject.
