# Shared headless world design

Approved milestone: one runnable offline Tempting Fates session in which dialogue, custody, exploration, combat and resources use the same actors and committed timeline. Baseline `3fd1e4d99eede6853f62b8078e5921183a9f048c`. The owner approved the four-step contract, authority, host and end-to-end plan on 2026-11-14. Detailed implementation choices below are the builder's decisions within that scope.

## Approach

Use a fresh `shared-world/0.1.0` authority and SQLite journal. Reuse the pure mortal-v3 reducer inside its transaction. Do not run the character-v1 and mortal-v3 writable stores side by side: a two-store coordinator cannot make a loan acceptance and custody transfer atomic. Rewriting old frozen profiles would reinterpret signed history; the successor instead leaves those profiles readable and unchanged. No automatic migration is included.

One authoritative sequence, head, world time, RNG counter and actor/item namespace govern the session. Mechanical state is stored once. An internal adapter reconstructs the mortal-v3 reducer input using the shared cursor; it does not create a second event, receipt, database or request namespace. The first internal mortal projection uses its own required genesis head; external shared history always starts at the hash of the complete shared genesis.

The initial shared campaign includes ordinary mortal actors and routes. Fate actors, the loom, lifespan and donor transactions are not imported into mortal combat. Their existing authority remains separate until a later explicit port. A monotone referee closure command suppresses mythic exposition/agent engagement; there is no reopening action or automatic anomaly trigger in this session.

## Contract and state

New schemas and types live in `SYSTEMS/shared-world-v1/` and `packages/contracts/src/shared-world{,-types}.ts`. Frozen legacy v1, character-v1, mortal-v2/v3 and knowledge-v1 definitions are unchanged. Schema validation is distinct from authentication, entitlement, signatures and replay.

`WorldGenesis` binds the complete mortal-v3 genesis, character profiles/presentations, authored scene descriptions, selected authored knowledge catalog/source manifest, initial knowledge activations and initial environment (day/night). Its hash is the first shared head and is bound into every signed event/receipt. The mortal roster supplies the only actor/controller identity mapping. Profiles have exactly one matching actor; scenes refer to existing locations. Catalog policies belong to existing actors/items and match the campaign pack/source identities.

`WorldState` contains one shared scope/cursor/time, a physical payload (actors, items, opportunities, stocks, encounter and RNG counter), profiles, memory records, impressions, active knowledge acquisitions, offers/loans and monotone boundaries. It does not store a second physical cursor or a duplicate character actor roster. Actor death/unconsciousness and location are derived from physical state. HP zero is unconscious, not dead, and cannot speak or consent.

New `WorldProfile` explicitly uses nature, activity, maximum speech characters and private presentation. Legacy `minimum_interval` is not silently reinterpreted: this version uses zero-duration conversation plus a bounded host response policy. Speaking advances the event sequence but not simulated elapsed time. Mortal actions advance the shared world clock under existing rules. NPC generation produces at most one response per inbound record; authority rejects a second response by the same NPC to that record. Busy or nonstanding NPCs cannot reply. This supports consecutive conversations without inventing sixty seconds of elapsed time for each line.

`WorldCommand` binds full scope, request ID, actor identity, exact expected cursor, causation and one action. `WorldPrincipal` is the existing direct player/NPC/referee identity grammar, authenticated by the host and matched to immutable controllers. No model JSON creates a principal, referee capability, witness or grant.

Actions:

- `mortal`: one existing mortal-v3 action, including referee encounter recovery.
- `speak`: bounded text, optional visible inbound record, and explicit self-private, addressed whisper or room audience. The authority derives recipients from standing actors at the source's actual location. Addressed IDs alone cannot reach a remote actor.
- `impress`: an actor's interpretation of acquired evidence about another actor. It remains private and references the nature used to form it. No shared reputation or objective sentiment is written.
- `set_activity`: the actor's own bounded activity description/busy time.
- `offer_loan`: a direct holder offers a free, deposit-free ordinary item loan to a particular colocated standing borrower, with explicit return location, actual agreed repair cap and world-time expiry. Offer policy and issued offer are distinct.
- `withdraw_loan_offer`: issuer withdrawal before acceptance.
- `accept_loan`: borrower explicitly accepts the exact durable offer hash. The same event records the promise and transfers custody using mortal validation; capacity, ownership, location, encounter restrictions or expiry failure leaves no promise or transfer.
- `return_loan`: current holder returns the item to the colocated lender. Loan completion and custody change are atomic. An ordinary validated transfer back to the lender also completes the loan. A loan records the original lender and borrower; physical `owner_id` means current custody and does not erase the lender's rights. There are no automatic repair charges, oaths, services, punishment or debt on refusal.
- `set_knowledge`: referee activation/revocation of selected genesis-catalog entries, acquired at the actual commit prefix. No backdating or arbitrary text injection. Initial grants are bound into genesis.
- `close_mythic_engagement`: referee-only irreversible boundary; no model can lift it.

An item may have at most one live loan/offer. Expired/withdrawn offers never authorize acceptance. A loaned item cannot be offered again by its temporary holder. An accepted record survives subsequent custody movement; only return to the original lender fulfills it. This is an explicit free-loan kernel, not general commerce or legal adjudication.

## Epistemic projection and dialogue

Every accepted action produces one compound typed memory record with its sequence/time and deterministic witness acquisition. Speech source is always the authenticated actor. Shared room speech reaches standing occupants; an addressed whisper reaches only its declared standing colocated recipients; self-private notes reach only their author. Physical event descriptions disclose observable action identity, not hidden rolls, another actor's inventory totals, private policy or secret command fields. Observers are derived from the relevant before/after location and direct participants; new arrivals do not acquire earlier private records. Compound loan transactions remain one record/sequence rather than fabricated legacy events.

`WorldActorQuery` requires full rights scope, actor and exact cursor. The scoped view exposes the actor's profile, acquired bounded memory, owned impressions, active owner knowledge, own physical view and the current shared scene/public occupants. It never returns the raw state, seed, controller IDs, foreign inventories, private goals or hidden rolls. Historical inspection uses a verified historical state and matching query; a future or mismatched query is rejected. Memory coverage is explicit; bounded context is not a claim to contain the whole archive.

Shared scene descriptions and environment are stored once in genesis and projected by location. Opinions remain in owner impressions. Knowledge entries remain source-backed owner policies; they do not become accepted bargains merely because the model repeats them. Dynamic activation/revocation is now replayable in shared events. The new context grammar represents mortal action types honestly instead of relabeling them as legacy character speech.

The model adapter is proposal-only, uses the existing multi-vendor client, and receives only a scoped view with a byte budget. It checks current context before generation and afterward. Changed location, cursor, knowledge, life state or closure suppresses late output. Model output is only text or silence; it cannot offer/accept a loan or run a mechanical command. Strict response validation stays in force; no hidden paid retry or model-based repair is introduced. Tests inject provider responses. Live provider quality/latency is not claimed.

## Persistence and host

Use a new SQLite application/table identity with WAL, FULL synchronization, append-only event/metadata triggers and one transactional request-ID index. A worker thread owns blocking SQLite and cryptography. Verify the complete signed history at open and only unseen suffixes on warm reads. Bind events and receipts to full scope, complete genesis, full command/principal identity and deterministic before/after hashes. A stale concurrent writer loses without side effects; an exact retry returns the existing receipt, including after restart.

Store one signed compound event and its receipt in one database transaction. In-memory projection/cache publication follows COMMIT. Failed append, cancellation/worker loss or lost acknowledgment never imply a second application: callers reconcile with the exact same request. Never persist signing keys in the database or logs. External expected-prefix checkpoints detect rollback when supplied; a local checkpoint file is not independent rollback assurance. The host still trusts the storage operator to keep previously verified rows append-only during a handle's life.

Bounds: one million events, 128 outstanding worker requests, 16 MiB replies, history pages at most 1000; explicit bounded memory/offer/impression arrays in the schema. Capacity refusal must be atomic, never silently delete historical knowledge. No automatic background or recursive agent loop.

The library session host accepts an injected authenticated principal and structured action/text input, loads a fresh campaign, reads scoped views, submits to the single writer and saves/resumes. The local CLI is a trusted operator harness, not a remote authentication service. It supports structured JSON commands and an offline deterministic demo, creates private local key files with restrictive permissions, refuses replacing an existing world, and never loads paid clients implicitly. Narrator/actor output consumes scoped validated data; prose does not mutate authority.

## Campaign adapter and acceptance

Build from the existing pinned campaign. Validate generated actor/item IDs before output: default traveler `traveler` collides with authored `traveler_lamp`, so use an unambiguous demo identity. New explicit starting-kit option may omit the personal lamp for the borrowing demonstration. New explicit day/night initialization controls whether ordinary routes require carried light; night travel uses existing lamp/firekit/oil validation. The fresh adapter documents these choices without altering the frozen original campaign or measured rules.

Test Zero: initialize a night session with the borrowed-lamp kit; ask Melia her terms; capture an injected provider request containing her nature and exact source-backed policy; commit the chosen response; issue a structured lender offer; borrower explicitly accepts its hash; prove one atomic custody/promise event; travel away and return with deterministic oil/time changes; return the lamp and fulfill the promise; restart and replay to identical state/hash. Refusal must leave custody and resources unchanged.

Additional gates: schema closure/active-object rejection; cross-scope, forged principal/source, remote recipients and unseen-evidence rejection; byte-for-byte replay; altered genesis/event/receipt rejection; stale concurrent accepts and mechanical actions; capacity failure without half a loan; offer withdrawal/expiry; no loaned-item relending; no private solo-to-party leak; dead/unconscious/busy and post-closure dialogue; unchanged old profile tests; process responsiveness; restart, lost acknowledgment and external checkpoint behavior.

## Execution

Write and independently review/freeze the contract first. Then initialize disjoint blackboard lanes for rules/projection, journal/storage, context/host, and campaign/CLI. Runtime workers consume that immutable contract. Source tickets stop at VERIFYING under the current data-only board policy; external exact-candidate application gates and independent reviews certify integration, without fabricating Board MERGED state. Existing worktrees, source evidence and trusted controller policy remain intact. No new dependencies, paid calls or deployment.
