# Shared world 0.1.0

This contract defines the new `shared-world/0.1.0` authority for fresh ordinary mortal worlds. It combines one physical payload with actor memory, private impressions, authored knowledge and free item loans in one atomic history. It does not migrate, reinterpret or merge existing character, Fate, mortal or knowledge authorities. Historical schema bytes remain unchanged. Contract-only source does not implement a reducer, journal, storage, session or model adapter.

The exact closed data grammar is [world.schema.json](world.schema.json); public types are [shared-world-types.ts](../../packages/contracts/src/shared-world-types.ts). Imported physical, nature/activity and authored-knowledge definitions use references to the frozen mortal-v3, character-v1 and knowledge-v1 profiles. There is no second writable mortal database or character roster.

## Public contract boundary

The type module exports `WORLD_PROFILE`, `WorldGenesis`, `WorldPhysical`, `WorldState`, `WorldProfile`, `WorldScene`, `WorldCommand`, `WorldAction`, `WorldAudience`, `WorldPrincipal`, `WorldCursor`, `WorldQuery`, `WorldPhysicalView`, `WorldActorView`, `WorldMemory`, `WorldMemoryPayload`, `WorldVisibleMemory`, `WorldVisibleMemoryPayload`, `WorldImpression`, `WorldKnowledgeAcquisition`, `WorldLoanTerms`, `WorldLoanOffer`, `WorldLoan`, `WorldResolution`, `WorldEvent`, `WorldReceipt`, `WorldReceiptTrust`, `WorldLedger`, `WorldLedgerOptions` and `WorldContractMap`.

The helper module exports:

```ts
worldSchema; // deeply frozen schema
assertWorldData(value: unknown): void;
assertWorldContract<K extends keyof WorldContractMap>(
  name: K, value: unknown, genesis?: WorldGenesis
): asserts value is WorldContractMap[K];
assertWorldGenesis(value: unknown): asserts value is WorldGenesis;
worldRequestHash(command: unknown, principal: unknown): string;
```

ContractMap names are `Genesis`, `Physical`, `Profile`, `Principal`, `Cursor`, `Action`, `Command`, `State`, `Query`, `ActorView`, `Memory`, `Impression`, `LoanTerms`, `LoanOffer`, `Loan`, `KnowledgeAcquisition`, `Resolution`, `Event`, `Receipt` and `ReceiptTrust`. Validation refuses malformed data with `INVALID_CONTRACT`, does not coerce, evaluate getters or modify input, and does not authenticate callers. The optional genesis adds immutable reference checks, including the complete nested state of a Resolution, not proof that a state/query is the verified current prefix. Schema/signature validity alone is never authorization to deliver a view or acquire memory.

Passive inputs are plain JSON objects/arrays with enumerable data properties. Proxies (including revoked proxies), accessors, symbols, exotic prototypes, unsafe property names, hidden properties, cycles, sparse/decorated arrays, undefined, functions, noninteger/unsafe numbers and negative zero are rejected before traversal can execute their behavior. Maximum depth is 32, visits 500000 and actual canonical JSON UTF-8 bytes 16777216 per argument, including escaping, quotes, keys, primitive spelling and structural punctuation. Shared references without cycles are allowed and counted on each traversal. These limits are distinct from the worker's complete encoded-reply limit.

The full `State`/`Resolution` guard is a cold, untrusted DTO boundary: it validates the complete supplied history. Runtime code must not repeatedly apply that history scan to each verified warm transition. Rules/journal may reuse privately owned, deeply immutable verified genesis/state, indexes and hashes only for the exact registered object identity. Being frozen, having a known hash string, or resembling a trusted object does not confer trust. A changed, caller-owned, cloned or foreign DTO crosses full validation again. Input detachment and verification precede registration; no public brand or bypass parameter is added. Whole-state hashing remains proportional to accumulated state, and repeated cold-prefix hashing can be quadratic over history. This contract makes no linear cold replay claim; runtime acceptance must measure its supported warm-history bounds.

## One identity, scope and clock

`WorldGenesis` is `{version,mortal,environment,profiles,scenes,knowledge_catalog,source_manifest,initial_knowledge_ids}`. Its `mortal` field contains the complete valid mortal-v3 genesis: sole actor/controller identities, actor names, physical definitions, scope, referee, authority key, seed, pack and variant. All initial actors are standing and all original mortal initialization invariants apply. Actor and item IDs cannot overlap or duplicate; generated campaign IDs must pass the same check. Environment is explicit `day` or `night`.

Exactly one profile binds each physical actor. A profile contains `actor_id`, immutable `revision`, `nature`, `max_speech_characters` and private `presentation:{occupation,wants,will_not}`, plus mutable self activity. There is no legacy `minimum_interval` and no duplicated actor name. Exactly one scene `{location_id,description}` binds each physical location; the canonical name remains `mortal.locations[].name`. Knowledge catalog owners/items must exist, source references and pack/manifest identities must agree, and initial entry IDs must be unique, present and valid at time zero. Authored policy terms in this profile require zero fee and zero advance deposit. Hash identity does not prove an external document was honestly authored; source loading/entitlement remains a host duty.

`WorldState` is `{version,scope,genesis_hash,cursor,physical,profiles,memories,impressions,knowledge,offers,loans,mythic_closed}`. Its sole `WorldCursor` is `{sequence,head,world_time}`. `physical` contains only actors, items, opportunities, stocks, encounter and RNG counter. No physical cursor, version, scope or duplicate clock is stored. Scope includes all seven existing rights fields; there are no partial namespace defaults. Physical actor names/controllers/kinds/abilities/max HP, item definitions, scene/route identity and profile nature/presentation remain genesis-bound. Custody, HP/resources, activity, opportunity/stock counters and allowed encounter state change under the applicable reducer.

Standing means HP greater than zero. HP zero is unconscious; negative HP is dead. Neither can speak or consent. There is no separate life-status flag. Mortal actions preserve mortal-v3 capacity, location, active-time, resource, encounter, referee recovery, local exclusion and RNG rules. The embedded reducer uses the existing `mortal-rng/0.3.0` stream and one shared RNG counter. Internal reconstruction supplies the mortal genesis/head required at its initial projection; it never substitutes the mortal genesis for the external complete shared genesis. A social-first shared event must not break later mortal genesis binding.

Social actions cost zero simulated time while advancing sequence. Only admitted mortal work advances the shared clock; reads, model latency, restart and wall-clock time do not. Every accepted command produces exactly one event and one compound memory, including a private or undisclosed memory. State memory sequences are contiguous, request/record identities unique, times monotone, and the final memory time equals the cursor time. Failed transitions change nothing, including RNG, obligations and history.

## Commands and admission

`WorldCommand` requires `{version,scope,request_id,actor_id,expected,causation_id,action}`. Expected includes all three cursor fields; causation equals expected head. The authenticated direct principal must match immutable controller, role, actor and full scope. Referee actions have a null actor and the exact genesis referee identity; a direct actor cannot impersonate a referee or another actor. Model output, a stored policy, an addressed ID or a JSON principal is not a capability. Runtime must compare expected sequence/head/time against its verified current prefix before applying a new request.

| Action | Admission and result |
| --- | --- |
| `mortal` | One closed existing mortal-v3 action; begin/recover encounter retain referee-only admission. |
| `speak` | Nonblank text, explicit audience and nullable `in_reply_to`. Standing source is the authenticated actor. Source-specific character cap applies in addition to schema maximum. |
| `impress` | Private interpretation about another known actor, 1..32 previously acquired evidence record IDs, and the previous own impression ID or null. Capture the owner's exact immutable nature/revision, actual sequence/time and evidence; no earlier nature revision is authorized in this profile. Evidence must concern the subject; it cannot be invented or acquired by naming it. |
| `set_activity` | Changes only the acting owner's bounded activity/busy time and produces private memory. |
| `offer_loan` | Creates the explicit free loan offer described below using an active owner policy. |
| `withdraw_loan_offer` | Issuing lender explicitly withdraws an unaccepted offer; no arbitrary holder withdrawal or resurrection. |
| `accept_loan` | Named borrower accepts exact durable offer ID/hash; transfer and obligation commit together. |
| `return_loan` | Actual current holder returns the item to its colocated standing lender using the holder's own authority. |
| `set_knowledge` | Referee activates/revokes an existing genesis catalog ID at the actual commit sequence/time; no arbitrary text, source, owner or backdating. |
| `close_mythic_engagement` | Referee-only irreversible boundary. No reopening action exists. |

Speech audience is `{kind:'self',addressed_actor_ids:[]}`, `{kind:'whisper',addressed_actor_ids:[...]}` with 1..64 distinct addressees, or `{kind:'room',addressed_actor_ids:[...]}` with 0..64 distinct addressees. Author cannot address itself. The authority derives actual standing colocated recipients from the physical state; nonexistent/remote/nonstanding requested addressees cause refusal rather than becoming recipients. Self means self-private. Room witnesses and explicit addressees are distinct sets. No actor receives old private speech merely by arriving later.

Player speech can begin with null inbound. NPC speech requires a non-null, previously acquired speech record from another actor that explicitly addressed the NPC, standing/nonbusy state and open mythic engagement. The authority consumes `(NPC actor ID, inbound record ID)` once across the **full memory history**, atomically with the response. Model/view history limits never reset that check. Quoting a speaker does not change the authenticated source. An NPC does not reply proactively, to its own speech or to an overheard but unaddressed room record. Generation is at most one proposed response to one inbound; it cannot create principals, offers, acceptances, witnesses, tools or mechanical commands.

Initial knowledge acquisition is `{knowledge_id,origin:'genesis',sequence:0,world_time:0,active:true}`. Dynamic rows record the latest event activation/revocation using origin `event`; the complete private memory preserves past changes. There is no enclosing genesis/event hash inside an acquisition that would create a circular identity. Revocation removes current model context, not already acquired historical speech, and does not withdraw a previously issued durable offer.

## Free loan lifecycle

`offer_loan` carries `offer_id,policy_id,item_id,borrower_actor_id,return_location_id,repair_cap_obols,expires_at`. New offer requires the currently active, time-valid authored policy of the actual lender for that item, standing colocated parties, lender custody, ordinary mortal item/capacity/encounter checks and future world-time expiry. Repair cap cannot exceed policy cap. Terms always contain zero loan fee, zero advance deposit, `repair_basis:'actual_damage_by_explicit_agreement'` and `oil_supplied_by:'borrower'`. No automatic repair charge, replacement purchase, compulsory service, oath, debt or punishment is authorized.

Stored `WorldLoanTerms` add complete genesis hash, lender identity and issued sequence/time. These immutable terms have a separate offer hash; mutable offer status is `open`, `withdrawn` or `accepted`, with null or positive `closed_sequence`. Offer IDs are permanently unique, including expired/withdrawn offers. A live offer is exactly `status==='open' && world_time<terms.expires_at`; expiration needs no extra event or automatic remote notification and no longer blocks a new offer. An item has at most one live offer or open loan.

Acceptance requires the stored exact hash and still-live offer, borrower identity, current standing parties, location, lender custody, capacity and encounter admission. Continued knowledge visibility is not required: a durable issued offer remains available after policy revocation. The outer authenticated command/principal remains the borrower. Only after checking the exact stored offer may the reducer construct a narrow internal mortal transfer from this lender to this borrower for this item using the immutable lender controller. That internal capability cannot escape the reducer or authorize any other action. Failure must leave both custody and promise unchanged.

`WorldLoan.loan_id===offer_id`; a loan binds the exact accepted offer/hash, item, original lender/borrower and acceptance sequence/time. Its status is `open` or `returned`, with null or later returned sequence. Physical `owner_id` means custody and does not erase the original lender/borrower. Temporary holders cannot reoffer a loaned item. Return checkpoint is an agreed location, not a prohibition on an earlier voluntary hand-back elsewhere; crossing it causes no automatic penalty or release.

After every accepted command, any still-open offer whose item leaves lender custody or whose lender becomes nonstanding is marked withdrawn at that same sequence, even if it had already expired. This invalidation is permanent; reacquisition/recovery cannot revive the offer. It is a lifecycle consequence of the same event, not a second memory or an automatic distant disclosure. An accepted offer is not withdrawn by its own acceptance transfer. Explicit withdrawal, custody loss or nonstanding can cancel an open offer; policy revocation alone cannot.

After every custody-changing action, including ordinary `transfer_item`, `pickup` and `loot`, regained custody by the original lender fulfills an open loan in that same event. Current holder can differ from the original borrower. Acceptance/return rows, offer lifecycle and their compound memory must agree; no orphaned or partially accepted obligation is valid. A returned item may subsequently move again without reopening the completed loan. Runtime replay, not a standalone shape guard, proves the full transition, standing/location/capacity checks and exact derived witness set.

## Memory and private projections

Raw host memory is `{record_id,request_id,sequence,world_time,actor_id,acquired_by,payload}`. Its closed payload never contains raw command, referee reason, rolls, HP/resource totals, private inventory/goals or hidden model context. Raw events may contain full commands/effects and are host-private.

| Memory | Raw acquisition boundary | Visible content |
| --- | --- | --- |
| `speak` | Author; whisper addressees; or standing room occupants as applicable | Authenticated speaker, text, addressing and optional inbound ID. |
| `impress`, `set_activity` | Acting owner only | Private interpretation/activity; never delivered to subject or room. |
| `loan_offered` | Standing colocated lender and borrower | Immutable terms and exact offer hash. |
| `loan_withdrawn` | Lender; borrower only if standing and present | Offer identity and withdrawal; no distant update. |
| `loan_accepted` | Standing colocated lender and borrower | Accepted offer/hash, parties and item; no automatic payment. |
| `loan_returned` | Holder and lender; original borrower only if standing and present | Original parties may see full loan identity. A third-party holder sees the redaction below. |
| `mortal` | Relevant standing occupants before/after and present direct participants, deterministically derived | Whitelisted action name and involved actor/item/location IDs only. Travel has **empty `location_ids`** for all readers. |
| `set_knowledge` | Catalog owner only | Explicit content grant/revocation; not fabricated physical observation. |
| `close_mythic_engagement` | Nobody | No closing exposition. |

A mortal action fulfilling a loan produces **one restrictive loan-return memory**, whose recipient policy takes precedence over ordinary room witnesses. Do not union room witnesses with private loan participants. For a holder who is neither original lender nor borrower, project payload `{type:'custody_returned',item_id,from_actor_id:holder,to_actor_id:lender}`. Hide loan/offer IDs and original borrower. The raw record remains `loan_returned`; only actor projection uses `custody_returned`. Absence of a remote update must not be repaired by exposing global status tables. Travel witnesses cannot infer the other endpoint from the memory; the traveling actor sees its own current location through its physical view.

`WorldVisibleMemory` omits both `request_id` and `acquired_by`; opaque record IDs still support evidence/replies. `WorldActorView` requires `{version,genesis_hash,query,profile,physical,scene,memories,impressions,knowledge,knowledge_source,source_definitions,replied_to,coverage,mythic_closed}`. Query is `{version,scope,actor_id,cursor}` with complete current cursor. Physical view carries only the existing mortal-v3 own-actor view without duplicate version/scope/cursor/time. Scene carries its location/description/environment and public occupant `{actor_id,name,condition}` values; no foreign numerical HP, controllers, private profiles, seed, variant, full roster, inventory, stock or raw offer/loan tables is disclosed.

Projection is deterministic: select the latest at most 32 acquired visible memories in sequence order; select the latest own impression per subject, then the latest at most 32 such impressions in sequence order. Active, time-valid knowledge is owner-only and pinned to the exact genesis catalog/source identity. A genesis-origin acquisition must belong to the initial grant set at every projected prefix; later grants use event origin. Include exactly the source definitions needed by returned knowledge, once each. `replied_to` contains only returned addressed inbound record IDs already consumed by this NPC; the authority's separate full-history dedup remains complete. Coverage reports total eligible memory count and latest-per-subject impression count, returned counts and a truthful `complete` flag. Bounded returned context is not the complete archive.

The pure projection must reject an unscoped, wrong-actor, wrong-scope or mismatched cursor query and authenticate the reader. Historical projection is host-forensic only: it needs a verified historical state and its matching query. Player/NPC/session/model refresh APIs always load the latest ledger prefix. A caller cannot request a pre-revocation or pre-closure query to recover current withheld context. Current visibility/provenance and exact witness derivation cannot be proved from a detached ActorView alone; construction and delivery remain authenticated runtime duties.

Closure permanently suppresses all speech memory, impressions, knowledge, reply markers and source definitions in actor/model/narrator dialogue context; context arrays are empty and no closing record is exposed. NPC speech after closure is rejected. Player input and physical actions may still be recorded, without reopening engagement or becoming a new exposition channel. A model adapter must refresh before generation and before releasing output: cursor, location, life state, busy state, knowledge and closure changes suppress stale output. Generation has explicit bounds/cancellation and injected clients; no implicit paid call, automatic retry, repair model or recursive NPC loop is authorized.

## Noncircular hashes and signed artifacts

`hash` and `canonical` mean the existing canonical JSON SHA-256 helpers. Domain strings and preimages are exact:

| Identity | Preimage |
| --- | --- |
| Genesis/head at sequence zero | `hash(genesis)` of the complete shared genesis. |
| Request | `hash({domain:'shared-world/0.1.0/request',command,principal})`. `worldRequestHash` checks passive closed shapes and matching actor/role/scope, then computes it; it does not authenticate the controller. |
| Memory | `hash({domain:'shared-world/0.1.0/memory',genesis_hash,request_id,sequence})`. |
| Offer | `hash({domain:'shared-world/0.1.0/loan-offer',terms})`; excludes status/closed sequence. |
| State | `hash({domain:'shared-world/0.1.0/state',state:stateWithoutHead})`, where only `state.cursor.head` is omitted and all other fields remain. |
| Event signature bytes | UTF-8 `canonical({domain:'shared-world/0.1.0/event',event:body})`, where body omits `signature` and `hash`. |
| Event hash | `hash({...body,signature})`; signature is canonical Ed25519 base64. |
| Receipt signature bytes | UTF-8 `canonical({domain:'shared-world/0.1.0/receipt',receipt:body})`, where body omits `signature`. |

An event binds version, full scope/genesis, resulting sequence/time, previous head, full command/principal, before/after state hashes, draws/effects, one memory, signature and hash. Social event time equals expected time; mortal replay determines physical elapsed time. Initial previous head equals the complete genesis hash. Replay recomputes the transition, all derived values, hash and signature; no model, callback or external clock participates. Compute memory identity and next state without enclosing event hash; compute after hash, sign/hash event, then assign cursor head. No hash cycle is introduced.

Receipt is `{version,scope,genesis_hash,authority_key_id,signature,request_id,request_hash,event_hash,cursor,state_hash}`. It contains **no effects**. Receipt verification pins externally trusted full scope, complete genesis and Ed25519 authority key/ID, validates signature and requires cursor head equal event hash. Actor sessions can receive this acknowledgment and a separately authorized scoped view. Neither a receipt nor any bare hash grants access to raw event/state or proves an arbitrary text was delivered.

## Future runtime interfaces and persistence obligations

The following implementation lanes consume this contract; they are not implemented by the contract module:

```ts
initialWorldState(genesis: WorldGenesis): WorldState;
resolveWorld(genesis: WorldGenesis, state: WorldState,
  command: WorldCommand, principal: WorldPrincipal): WorldResolution;
worldStateHash(state: WorldState): string;
viewWorldActor(genesis: WorldGenesis, state: WorldState,
  query: WorldQuery, principal: WorldPrincipal): WorldActorView;
createWorldEvent(genesis, state, command, principal, privateKey):
  {event: WorldEvent; state: WorldState; receipt: WorldReceipt};
verifyWorldEvent(genesis, state, event): WorldState;
replayWorld(genesis: WorldGenesis, events: WorldEvent[]): WorldState;
verifyWorldReceipt(receipt: WorldReceipt, trust: WorldReceiptTrust): void;
openWorldLedger(options: WorldLedgerOptions): Promise<WorldLedger>;
```

Options are `{path,genesis,privateKey,expectedHead?}`; privateKey is a host KeyObject, never JSON. Expected head includes sequence/head/world_time and pins an exact known prefix. Ledger methods are asynchronous `snapshot()`, `events({after,limit}?)`, `submit(command,principal)` and idempotent `close()`. Snapshot and events are host-only. There is no per-call storage signal or cancellation protocol. Session/model work can cancel before dispatch; once submit is dispatched, lost acknowledgment, timeout or worker loss is ambiguous. Reconcile the identical command/principal/request ID, not a replacement request.

The new SQLite profile must use a separate application/table identity, WAL/FULL durability, immutable genesis, append-only history and transactional unique request index. It must refuse foreign/mixed profiles before mutation. One transaction commits event, request identity and receipt; publish caches only after COMMIT. An exact duplicate returns the original receipt even after later commits/restart, but only for the same authenticated full request/principal. Reusing request ID with changed command/principal is refused; stale new requests change nothing. Verify complete history at open and only unseen committed suffixes on warm refresh. Never run models, host callbacks or schedulers while holding a writer transaction. Key material stays out of database/logs.

Maximum sequence is 1000000, world time 1000000000000, pending worker requests 128, complete encoded replies 16 MiB and history pages 1000 events. Schema bounds include 128 profiles/occupants, 256 scenes, 64 authored knowledge acquisitions, 4096 lifetime offers/loans, 65536 impression records, 1000000 memories and 32 returned memories/impressions. Speech is at most 2048 Unicode code points plus the actor's smaller profile cap; whisper/room addressees are at most 64. Aggregate passive/byte/reply limits can bind before collection maxima. Runtime preflights these limits atomically, including transport-envelope overhead so an accepted state remains snapshot-readable; it cannot silently truncate stored history to continue accepting commands. View bounds explicitly report coverage.

The host authenticates principal construction, controls delivery and keys, selects one writer profile per world/branch and supplies independent rollback checkpoints when required. Local storage remains trusted append-only during a verified handle's lifetime; a checkpoint stored beside the same database is not independent rollback assurance. This profile adds no HTTP authentication, deployment, remote service, live provider quality claim, automatic world migration or paid model execution.
