# Mortal recon: one shared headless world

Baseline: `3fd1e4d99eede6853f62b8078e5921183a9f048c` (`main`). Read-only source investigation; no repository modifications, database writes, provider/network calls or nested agents. In-memory reducer probes used the coordinator's dependency-installed `/workspace/ARGO/.worktrees/shared-world` checkout at the same baseline. Main itself lacks AJV, so the initial import there failed before execution. This report proposes a new contract; it does not claim unified authority already exists.

## Recommended seam

Reuse **`resolveMortalV3` as a pure subreducer** in one new versioned aggregate, signed journal, request index and SQLite transaction. Reuse initialization/capacity/scoped-view helpers. Do not open a mortal ledger beside the v1 character ledger, and do not combine two signed receipts as a substitute for atomicity. Keep existing frozen profiles/history untouched; initialize a fresh shared world.

| Exact source | Boundary |
| --- | --- |
| `packages/contracts/src/mortal-v3-types.ts` | Actor, item, genesis, state, command, principal, resolution, encounter and scoped-view types. |
| `packages/ledger/src/mortal-v3/rules.ts:32` `initialMortalV3State` | Validates fresh genesis. Initial sequence/time/RNG are zero; head and genesis_hash both equal hash(genesis). |
| `rules.ts:44` `bindState` | Full genesis/scope binding; immutable actor/item definitions and collection order preserved. No runtime actor/item creation. Sequence-zero state must exactly equal initialization. |
| `rules.ts:87` `resolveMortalV3` | Pure, no I/O/callback/clock/signing. Validates input, scope, current cursor/causation and actor/referee authorization. Returns state/draws/effects; increments sequence once; **does not update head**. |
| `rules.ts:75`, `:155`, `:164`, `:196`, `:209` | Light requirements; custody transfer; resource transfer; global/active time; oil burn. |
| `rules.ts:94`, `:210`, `:253`, `:268` | Encounter admission, next-turn selection, begin and recovery. Turn token equals resulting event sequence; unrelated actions leave it unchanged. |
| `packages/ledger/src/mortal-v3/journal.ts:42`, `:67`, `:84` | createMortalV3Event/verifyMortalV3Event/replayMortalV3 certify a standalone mortal journal. Reuse their pattern under a new shared domain, not an independently signed inner commit. |
| `packages/ledger/src/mortal-v3/storage.ts:24`; `storage-worker.ts:52`, `:65`, `:129` | Dedicated worker, incremental refresh, SQLite transaction and atomic event/request/receipt insertion. Existing mortal_v3 tables refuse foreign profiles. Copy the architecture into the new authority, not the live store. |
| `packages/ledger/src/mortal-v3/view.ts:5` `viewMortalV3Actor` | Direct-controller scoped projection of an already verified state; own stats/inventory, adjacent routes, limited encounter summary/activity_lock. |
| `scenarios/tempted-fates/runtime-v3.ts:9` `buildMortalV3Campaign` | Fresh authoring adapter; delegates roster/creation rolls to runtime.ts then validates distinct v3 genesis. Not migration. |

## Proposed physical integration types

These are new internal interfaces, not current exports:

```ts
type SharedCursor = {sequence: number; head: string; world_time: number};
// At zero, head = hash(shared genesis); subsequently the shared event hash.
type PhysicalSlice = Pick<MortalV3State,
  'actors' | 'items' | 'opportunities' | 'stocks' | 'encounter' | 'rng_counter'>;
type MortalBinding = {
  adapter: 'shared-mortal/0.1.0';
  genesis: MortalV3Genesis;       // immutable, host-only, pinned in shared genesis
  genesis_hash: string;          // exactly hash(genesis)
};
type AdmittedPhysicalInvocation = {
  request_id: string;
  actor_id: string | null;
  action: MortalV3Action;
  principal: MortalV3Principal;  // derived only after outer authorization
};
type PhysicalTransition = {
  physical: PhysicalSlice;
  elapsed_seconds: number;
  draws: MortalV3Draw[];
  effects: MortalV3Effect[];
};
function resolveSharedPhysical(
  binding: MortalBinding,
  before: {cursor: SharedCursor; physical: PhysicalSlice},
  admitted: AdmittedPhysicalInvocation,
): PhysicalTransition;
```

Persist no second mutable global sequence/head/world_time, custody map or physical liveness flag. Actor active_seconds/fed_until/next_rest_at are legitimate personal counters. Pin complete physical genesis, identity/controller joins, character profiles, authored overrides, authority/referee configuration and adapter version in the shared genesis. Scope, pack_hash, variant and overlapping actor/controller IDs must agree.

Adapter algorithm:

1. Outer authority validates/authenticates the complete shared command, exact shared cursor, full rights scope, request identity and any bargain/witness authority against its verified prefix. Caller JSON cannot supply an admitted invocation, physical snapshot, effective controller or patch.
2. Derive a temporary MortalV3State from the physical slice plus shared sequence/world_time. Bind version/genesis_hash to the immutable mortal genesis. For sequence zero use the **internal mortal genesis hash** as head (required by frozen validation); for positive sequence use the shared current head. The external shared cursor has already been checked; this translation is never a second accepted caller cursor.
3. Construct the internal mortal command with that derived cursor/causation and admitted action/principal. Call resolveMortalV3 once. Check output sequence = shared sequence + 1, head unchanged, and elapsed_seconds = output world_time minus previous shared world_time, nonnegative.
4. Extract only PhysicalSlice. Apply character/bargain effects in the same outer pure transition, increment shared sequence once, and advance shared time once by that delta. The shared journal signs/hashes the entire combined event/state and updates head once. Character-only events leave PhysicalSlice unchanged while advancing shared sequence. A later combat token therefore still names a real shared event.
5. Replay reconstructs the same derived input and authorization basis from the shared genesis and signed events, reruns every reducer, and checks full state/draw/effect hashes. No host callback, model or wall clock participates in replay.

Initially allow **zero or one physical action per shared event**. This supports free lamp transfer plus dialogue/loan records atomically. Arbitrary multi-step barter/batches need another explicit contract: calling the reducer twice increments its sequence twice and can produce invalid turn tokens under one outer event. Do not erase/reset those intermediate counters or invent extra shared events.

Probe result: after a simulated verified character-only prefix at sequence 1, a derived mortal state using its shared head accepted Melia's transfer_item(traveler_lamp -> hero). Result: sequence 2, unchanged head, world_time 0, lamp owner hero, capacity 11/14. This confirms the mechanical seam only, not new authentication or durable atomicity.

## Identity and character boundaries

`campaign/catalog.ts:211` buildCampaignSeed includes system, all pack NPCs and traveler actor_ids. `runtime.ts:38` filters out Fate NPCs and has no system actor. With one hero, the physical seed has nine actors; system/clotho/lachesis/atropos exist only on the character/Fate side. Mortal NPCs use npc_controller_id, and travelers have explicit controller_id. Current character eligibility does not independently enforce that same controller mapping.

Use identical IDs for overlap (melia/hero), one immutable controller registry, and explicitly nonphysical entries for Fates/system. Character profile IDs reference existing people; they do not create new physical actors. Never add fabricated HP, ordinary inventory or referee powers to Fates/system just to join arrays. If the session excludes Fate mechanics, state that limit. Ordinary HP death must not silently become a Fate thread/lifespan/anomaly transition.

Frozen character incompatibilities require a new projection/experience grammar or an explicitly limited adapter:

- `packages/contracts/src/characters.ts:45`: sequence zero iff head null. Mortal zero uses its genesis hash. A shared genesis-hash cursor therefore cannot be passed directly to v1 CharacterQuery at zero.
- `characters.ts:54`: experience source sequences must strictly increase. Speech and physical memories from one atomic event cannot both use the same source sequence in v1 projection. Use a new `(sequence, ordinal)` order/record identity or one explicit compound experience; do not create fake ledger sequences.
- `packages/contracts/src/character-types.ts:25`: action_type is restricted to old v1 custody/Fate actions; mortal travel/combat/resource actions are absent. Do not relabel all physical actions as move_item or speech.
- `packages/ledger/src/characters.ts:168` extendReplay verifies v1 events and private system observe_claim carriers; it is not a generic pure reducer for shared events. Reuse content and logic in a versioned projection, not type casts.
- `packages/lexi-bridge/src/characters.ts:9` createCharacterViews can read a trusted projection but validates the frozen grammar/exact cursor. A compatibility adapter must truthfully declare any omitted physical-event coverage. The shared view must come from one verified snapshot, not independently refreshed character and mortal sources.
- HP > 0 stands, HP = 0 is unconscious, HP < 0 is dead. Deriving alive = hp >= 0 is reasonable presentation but insufficient speech/bargain permission: character v1 only checks alive. Require standing for active mortal speech/acceptance; preserve rest at zero and no resurrection below zero. Nonphysical Fate policy stays separate.

## Lamp, custody and oil

`campaign/world.json:831` defines traveler_lamp, initially custodian melia, one slot, ordinary and present in all variants. It is distinct from secret measure_cup. Its name conveys no traveler custody. `runtime.ts:40–43` maps it to a tool/lamp with owner_id melia, null ground location, unequipped. Other pack items become loot. owner_id is mechanical possession; lender/title/return terms belong in bargain data, not a second writable custody map.

`runtime.ts:45–50` also adds NPC work knives and each PC's generated weapon/lamp/firekit. A hero has hero_lamp in addition to Melia's traveler_lamp. PCs start with two rations, two water, six oil units, twenty obols and sling ammo twenty (otherwise zero). NPC defaults include zero oil. Receiving Melia's lamp does not transfer oil.

**Reproduced seed hazard:** PC ID `traveler` creates traveler_lamp, colliding with Melia's authored item. The builder fails INVALID_CONTRACT / Duplicate mortal item. The new seed interface must validate generated item IDs against authored and generated IDs, not only actor IDs. PC ID hero works.

Physical custody is an exclusive union: owned item with null ground location, or owner null with ground location and unequipped. transfer_item requires current ownership, living/co-located recipient and resulting capacity, and clears equipment. Drop uses the actor's current location; pickup requires a local ground item; loot requires a local dead owner. Bargains must run these exact checks, including encounter locks. Acceptance cannot override them.

Oil is remaining **exploration-turn fuel units**. rules.ts:75 requires an owned lamp plus firekit and at least the declared turns of fuel when requires_light. burn (:209) spends exactly turns for light-required travel/exploration, before needs/hazard outcome. No per-lamp tank, lamp-lit toggle, passive ambient/speech burn or automatic extra cost for carrying two lamps exists. Capacity counts ceil(oil / 18) slots (:23).

The tabletop price is one obol for one measure fueling six turns (RULES.md:59, QUICKSTART.md:21). buy prices each numeric resource unit: an oil stock priced at 1 would charge six obols for six fuel units. Do not mistake one measure for one turn of oil. The current builder has no oil stock.

`runtime.ts:55–57` sets every generated route/opportunity requires_light false and route hazard null. Opportunities are harbor_olive_verge (24-turn forage, finite ration reward) and quarry_oil_cache (one-turn search, finite six-oil reward); stocks sell only harbor rations/water. Probe: r_harbor_market travel takes one turn, world/hero active time become 600, and oil stays six. To demonstrate oil use, author a pinned light-required fresh-session route/opportunity; do not silently rewrite the frozen pack or imply ordinary daylight travel burns oil.

## Small atomic loan and time policy

The smallest useful compound operation is an explicit free-loan handover containing exactly one transfer_item plus its speech, witnessed memories and executed-bargain record in one commit. Pin offer identity/hash, lender, borrower, exact item, mutually accepted return checkpoint, zero deposit, borrower-supplied oil and actual-damage-only repair capped at five obols. Model prose is neither authoritative terms nor consent. Discussion or a promise does not transfer custody (world.json:909–913; QUICKSTART clarify/record rows).

For minimal new capability machinery, the final handover can be directly authenticated as lender and bind the borrower's recorded exact acceptance. If borrower acceptance itself triggers transfer, the prior lender offer must instead be an explicit exact, scoped, unrevoked transfer authorization. Constructing an NPC principal from controller_id alone is not consent. Record outer requester and delegation/acceptance basis in the signed event. Recheck current ownership, both actors, location, capacity, site/roster lock, terms and authorization at commit. Only then atomically mark executed, transfer custody and record memories; failure commits none. Pending acceptance is distinct from an executed loan. Refusal/expiry creates no debt, curse, forced service or transfer.

Keep v3 scheduling explicit: world_time sums serialized action durations; personal active_seconds controls needs/rest; remote action pauses encounter activity; one pending round costs exactly six seconds at wrap/close. Speech/offer/acceptance/handover may be explicitly zero duration. If substantial conversation costs 600 seconds, require an announced time-bearing action rather than a hidden duplicate charge. Character cooldowns/busy_until/acquisition timestamps read this same clock. Wall time/restarts never advance it.

Keep the single physical HMAC RNG domain/counter (rules.ts:185, mortal-rng/0.3.0). Physical draws follow shared event order; zero-draw character events do not consume it. Do not add controller dice. Broader Fate randomness needs a separate explicit domain decision.

## Contract and acceptance dependencies

Freeze shared aggregate/event/cursor, identity join, compound-memory ordering and authorization grammar before implementation. Then verify:

1. One fresh seed, collision-free IDs and pinned definitions; full and sampled-prefix combined replay equality.
2. One snapshot/cursor for all views. A character commit stales a physical intent and vice versa.
3. Atomic custody/bargain/memory commit, crash/restart and exact retries; concurrent accepts or owner changes cannot double-transfer.
4. Capacity, remote recipients, forged controllers/lender/referee, dead/unconscious actors, revoked offers and site/roster locks refuse without state/memory/RNG/time change.
5. Character-only events do not reset encounter token. Combat/recovery tokens use shared sequences and exact six-second settlement.
6. Explicit intended oil burn, provisions conservation and bounded scoped disclosure; no seed, others' private resources/HP, referee reasons or catalog secrets leak.
7. New worker/store retains async execution, transaction-level prefix refresh, atomic unique requests, detached inputs, WAL/FULL, bounded calls/pages/replies and signed restart replay. expectedHead remains a trusted ancestor checkpoint, not necessarily the latest head. External checkpoint persistence is needed for rollback assurance; a second file in the same rollback domain does not supply it.

The pure physical reuse seam is small. The principal remaining contract work is combined character record representation and replayable atomic authorization. Do not reinterpret old histories or retain two live writers for this new session.
