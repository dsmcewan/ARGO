# SC-620 concrete API and durable-row proposal

Design only, 2026-11-14. Read `docs/session-continuation/DESIGN.md` including the 619f124 receipt clarification, PLAN.md, and recon-turn-risks.md. No product edits, tests, providers, Board actions or subagents. This proposal uses one fixed whisper pair and the six approved phases; coordinator review precedes implementation.

## Public TypeScript surface

```ts
// Imports are existing World*/Scope types; Candidate vendor/effort values must
// also pass existing model-client capability checks. No new world profile.
type ConversationCandidate = { vendor: Vendor; model: string; pool: string };
type ConversationPolicy = {
  provider_policy_id: string; // explicit operator version for injected behavior
  generation_mode: 'injected' | 'offline_fixture';
  candidates: ConversationCandidate[]; // ordered, 1..8, distinct pool IDs
  effort: string;
  timeout_ms: number;        // 1..60000; generation's total budget
  max_context_bytes: number;// 1024..131072
  max_output_tokens: number;// 1..8192, always explicit budget policy
};
type OpenConversationStoreOptions = {
  path: string;             // absolute, private SQLite filename, never a URI
  mode: 'create' | 'open';  // create is exclusive; open cannot create
  genesis: WorldGenesis;
  player: WorldPrincipal & { role:'player'; actor_id:string };
  npc: WorldPrincipal & { role:'npc'; actor_id:string };
  policy: ConversationPolicy;
};
interface WorldConversationStore {
  readonly binding: ConversationBinding; // detached/frozen, host-only metadata
  close(): Promise<void>;
}
function openWorldConversationStore(
  options: OpenConversationStoreOptions
): Promise<WorldConversationStore>;

type ConversationCallContext = {
  turn_id:string; attempt_id:string; binding_hash:string;
};
type ConversationModelInjection = {
  clientFor: (candidate: ConversationCandidate, turn: ConversationCallContext) => unknown;
  countTokensFor?: (candidate: ConversationCandidate, turn: ConversationCallContext) => TokenCounter | undefined;
  cooldown?: Cooldown;
};
type CreateConversationOptions = {
  store: WorldConversationStore;
  ledger: WorldLedger;
  model: ConversationModelInjection;
};
type TurnInput = { turn_id: string; text: string };
type TurnRef = { turn_id: string };
type WaitOptions = { signal?: AbortSignal }; // abort this wait, not durable work
interface WorldConversation {
  turn(input: TurnInput, wait?: WaitOptions): Promise<TurnResult>;
  resume(input: TurnRef, wait?: WaitOptions): Promise<TurnResult>;
  read(input: TurnRef, wait?: WaitOptions): Promise<TurnResult | null>;
  cancel(input: TurnRef, wait?: WaitOptions): Promise<TurnResult>;
  close(): Promise<void>;
}
function createWorldConversation(options: CreateConversationOptions): WorldConversation;
```

All policy fields above are required and resolved. There are no optional hidden model defaults to hash differently across restarts. Hardwired policy records `audience:'whisper'`, `max_attempts_per_pool:1`, `communication_goal:null`, and the existing world-dialogue profile version. Reject arbitrary Candidate `poolConfig` in this first host grammar; injected clients map fixed pool IDs to their trusted implementation. Adding serializable pool-specific policy later must version/hash it explicitly, not accept `unknown` configuration.

The store opener authenticates nothing by itself: the caller supplies already authenticated player/NPC principals, which must match immutable genesis controllers, roles and complete scope. It freezes those supplied values in a private parent-side capability. Its worker receives binding metadata, not the private seed or profiles. `createWorldConversation` accepts only a registered store capability returned by the opener (private WeakMap/brand, never Object.isFrozen). It internally creates the two sessions from those original supplied identities and constructs `createWorldModelAgent` with the stored policy and NPC session's current view. Thus deserialized rows never create authentication. This avoids repeating genesis/principals/policy in both public constructors while still comparing every database binding against supplied trusted inputs on open.

Callbacks, token counters and cooldown implementations are trusted injected capabilities. Their executable behavior is **not authenticated by a policy hash**. `provider_policy_id` is an explicit operator declaration, bound alongside canonical candidates/effort/budgets. The operator must change it when changing meaningful injected behavior; a hash cannot prove that the callback still implements its declared policy. No SDK/client discovery or credential lookup is introduced. No caller audience, goal, principal, raw command or provider option is accepted by `turn`. The injected client/counter factories receive immutable turn/attempt metadata as a second argument, so an offline CLI can select a turn-keyed response without a shared mutable current-turn variable. The host adapts these closures into the existing one-argument WorldModelOptions factories; callbacks that ignore the extra argument remain valid.

`TurnResult` is a closed DTO: `{version,turn_id,phase,revision,cancel_requested,generation_mode,outcome,input_receipt,reply_receipt,delivery}`. `outcome` is null until settled, then a bounded enum below; receipts are null or verified WorldReceipts. `delivery` is null or `{delivery_id,record_id,speaker_id,text}` obtained from the PLAYER's fresh view. It never contains pending command text, NPC context, terminal diagnostic strings or a global event. A stable `delivery_id` is a domain hash of binding/turn/accepted reply record; output printing is not exactly once. Unknown `read` returns null; unknown resume/cancel fails. Reads do not advance phases or generate.

## Binding and durable row

`ConversationBinding` is closed passive data: `{version:'world-conversation/0.1.0',scope,genesis_hash,authority_key_id,authority_public_key,player,npc,policy,dialogue_profile,audience:'whisper',max_attempts_per_pool:1,communication_goal:null}`. `binding_hash = hash({domain:'world-conversation/0.1.0/binding',binding})` binds complete scope, full genesis identity, both full principals and the resolved serializable policy. Metadata JSON and hash must agree with the opener's independently constructed expected binding. Do not trust a database's claimed hash by itself. The CLI uses one canonical `turns.sqlite` path for its fixed pair/configuration, explicit create/open, and refuses a missing existing outbox or a changed policy binding; it never silently chooses a new file to bypass those refusals.

```ts
type Phase = 'accepted' | 'input_pending' | 'input_committed'
           | 'generating' | 'reply_pending' | 'settled';
type Attempt = {
  attempt_id:string; owner_id:string; query:WorldQuery;
  started_at_ms:number; deadline_at_ms:number;
};
type RejectionProof = {
  sequence:number; previous_hash:string; event_hash:string;
  request_id:string; request_hash:string;
};
type Terminal = {
  outcome:'replied'|'no_reply'|'cancelled'|'generation_uncertain'
         |'generation_failed'|'input_rejected'|'reply_rejected';
  reason:'completed'|'unavailable_context'|'adapter_null'|'cancelled'
        |'attempt_expired'|'attempt_failed'|'invalid_proposal'|'occupied_sequence';
  rejection_proof:RejectionProof|null;
};
type TurnRow = {
  version:'world-conversation/0.1.0'; binding_hash:string;
  turn_id:string; turn_key:string; input_hash:string; text:string;
  revision:number; phase:Phase; cancel_requested:boolean;
  created_at_ms:number; updated_at_ms:number;
  input_command:WorldCommand|null; input_receipt:WorldReceipt|null;
  inbound_record_id:string|null; attempt:Attempt|null;
  reply_command:WorldCommand|null; reply_receipt:WorldReceipt|null;
  terminal:Terminal|null;
};
```

Use a conservative 1..64 safe-ID grammar for new `turn_id`; text must be a nonblank string no longer than the fixed player's speech limit (never more than 2048 Unicode code points). `turn_key = hash({domain:'world-conversation/0.1.0/turn',binding_hash,turn_id})`; `input_hash` hashes binding/turn/exact text. Derive input and reply request IDs with distinct new host domains over the full binding identity and turn ID; use all 64 hex characters. The audience is fixed, so it cannot vary under the same input hash.

Memory IDs **retain the frozen world grammar**: `hash({domain:'shared-world/0.1.0/memory',genesis_hash,request_id,sequence})`. Derive inbound ID only from its verified receipt/command, and compare it with the acquired record. Do not invent a host memory-ID domain.

The six phases have closed invariants. Accepted has no commands/receipts/attempt. Input-pending requires exactly the saved input command but no receipt. Input-committed requires its receipt and matching inbound ID, no attempt. Generating adds one permanent attempt, no reply command. Reply-pending adds the exact reply command but no reply receipt. Settled has a terminal value with one consistent prefix of these fields: replied requires both receipts; no-reply requires input receipt; cancelled can occur before input or after a completed input/attempt; generation-uncertain/failed retain the attempt and input receipt without a reply command; rejected pending dispatches retain their exact command and occupied-sequence proof. No terminal row may contain an unresolved pending command except a proven rejection. Cancellation after a reply commit settles as replied with `cancel_requested:true`, accurately retaining the canonical fact while suppressing delivery.

Attempt IDs and owner IDs are cryptographically random bounded identifiers, not user values. Query scope/actor bind the NPC; query sequence/time cannot precede the input receipt, and equal sequences must have equal heads. Deadline-start must equal the persisted policy timeout. The attempt tuple never changes or disappears, including after settlement/cancellation. Reply's exact expected cursor equals the attempt query; scope/NPC/request ID/inbound reference and sole player whisper audience must all match. All commands remain speak-only. Receipt checks bind scope/genesis/key/signature, command ID, `worldRequestHash(command,fixedPrincipal)`, next sequence, event/head and nondecreasing world time.

## SQLite and worker boundary

One canonical outbox file serves one binding. It is a separate SQLite application identity/user_version, never tables in world.sqlite. Tables:

- `conversation_meta(singleton PRIMARY KEY CHECK(singleton=1), format, binding_hash, binding_json)` with no-update/no-delete triggers.
- `conversation_turns(turn_key PRIMARY KEY, turn_id UNIQUE, input_hash, revision, phase, cancel_requested, inbound_record_id UNIQUE, row_bytes, row_hash, row_json)` as STRICT columns with phase/boolean/revision/size CHECKs; refuse deletion so attempt/silence tombstones cannot be silently pruned.

The nullable unique inbound ID suffices because the whole file has exactly one fixed NPC/world binding. Duplicate columns must exactly match decoded row JSON. `row_hash` detects accidental byte corruption, not adversarial rehashing. Startup verifies schema/application identity before mutating an existing file and iterates bounded rows through full validators. Reads and CAS transactions revalidate their selected rows; parent RPC replies are guarded again before use. No model or world-ledger callback occurs in a worker transaction.

Proposed hard bounds: 10000 turns, 128 KiB canonical row, 64 MiB summed logical row bytes, 64 outstanding RPCs, 1 MiB per request/reply. Enforce insert/update accounting inside BEGIN IMMEDIATE; refuse capacity without deleting records. These are operational limits, not frozen world limits. Create exclusively reserves a new regular 0600 file inside an existing owned 0700 directory; open requires it already exists. Check same-user ownership, symlinks, URI/memory paths, database/WAL/SHM permissions and foreign schema. Parent and worker exchange passive bounded DTOs only; the worker alone owns DatabaseSync/WAL/FULL and validates method/arguments. Publish updated rows only after COMMIT. Worker death yields unavailable/possibly-persisted outcome; callers re-read, not overwrite.

Do not export generic row writes to models or public consumers. The store is opaque; internal operations are `insertOrGet(input)`, `load(turnId)`, and `advance(turnId,expectedRevision,mutation)`. A closed mutation union supports save-input, confirm-input, claim-generation, save-reply, confirm-reply, settle and cancel. Worker loads/validates current row, checks exact revision, applies a legal transition, sets revision+1 itself, validates next row and commits. On CAS loss return the current validated row; a losing driver never submits its unsaved local command or invokes a model using a lost marker. Insert same input joins; same ID/different text conflicts. Cancellation is monotone and immutable input/command/receipt/attempt fields can never be replaced. Successful same-phase cancellation increments revision and fences every old generation continuation.

## Driver, deadlines and cancellation

One invocation advances a bounded number of the six phases; CAS loss reloads once or returns current status rather than spinning. In-process drivers for the same turn may coalesce. Separate handles/processes coordinate through the same file; separate files **cannot provide at-most-one generation** and are outside that guarantee. The CLI will pin the canonical outbox path.

`accepted -> input_pending` saves the exact prepared command before dispatch; cancellation winning beforehand prevents dispatch. Input/reply-pending means irrevocable dispatch intent even if the process died before sending. Resume reconciles saved exact bytes even after cancellation, then suppresses subsequent generation/delivery. Cancellation is a separate durable mutation, never a claim that committed speech was undone.

Only the CAS winner of input-committed -> generating constructs/invokes the adapter. Persist absolute start/deadline first. Pass an owner AbortController with a timer for the **remaining persisted deadline** to respond; the adapter's fresh timeout cannot extend this absolute limit. Its fresh-context callback also checks attempt ownership/current cancellation before returning the NPC view. Check persisted attempt, deadline and cancellation again when saving a result; worker rejects expired or fenced result CAS. Other handles see generating and do not call. After the deadline, an explicit resume may settle generation_uncertain but cannot claim another attempt. A process crash just before the provider call sacrifices availability honestly. No lease or PID reclamation authorizes regeneration.

A waiter's AbortSignal only stops that caller's wait. A pre-aborted waiter can fail before starting any work; once accepted, waiter abort does not cancel another caller's durable turn or the shared driver's work. `cancel` persists intent; local owner generation is aborted promptly, cross-process late results are rejected by CAS even if the provider ignores abort. Never pass a duplicate waiter's signal directly as the shared model signal. A cancelled pending dispatch still requires reconciliation. `close()` on the host stops new work, aborts/fences its own generation and drains bounded local store work; it does not delete/cancel other handles' turns or close the caller-owned world ledger. Store close separately drains its worker RPCs. Call host.close then store.close; closing is not durable turn cancellation.

## Receipt/prefix reconciliation and disclosure

A saved receipt is not enough. Before trusting a row on resume/read (and before using its input receipt to generate), verify its pinned signature and exact command/principal binding, then use `ledger.events({after:receipt.cursor.sequence-1,limit:1})` on the already verified opened journal. Require the exact event sequence/hash/previous hash, command, principal, request hash, world time and after_hash/state_hash. Validate the event DTO and recompute hash over its signed body; verify its Ed25519 signature against the pinned public key and unchanged shared-world event domain. This small private transport-proof helper does not replace deterministic admission verification already performed by the real opened journal and must not introduce a new signing grammar. At most two such one-event lookups per row are needed. Missing/divergent acknowledged prefix is corruption/unavailable, never no-reply or a fresh turn. The real ledger verifies signed history/rows; the host does not replay complete history or expose fetched events. A caller-injected fake WorldLedger remains a trusted dependency, not an independently authenticated physical disk.

Once pending, **no thrown error code proves noncommit**. In particular UNAUTHORIZED/INVALID_CONTRACT can arise after canonical COMMIT when session receipt verification fails. Keep the exact pending command and report recoverable pending on any such ambiguity. A definite rejection is established only before dispatch intent or by a verified event occupying the command's expected next sequence with a different exact request, extending the expected head. Store that compact rejection proof and recheck its prefix on later reads. If the slot contains this command but its acknowledgment is malformed, remain pending until exact retry obtains a verified receipt; do not synthesize a receipt or generate again. A missing slot does not by itself prove a previously dispatched command was never committed.

For committed replies, load a fresh PLAYER query/view and match the expected frozen-grammar record ID, receipt sequence, NPC actor, exact text/whisper audience/inbound reference. Select text only from that record. Outbox text, model output and NPC view never become delivery fallbacks. Current cancellation, closure, absent/aged-out memory or a query/view race yields null delivery while retaining committed receipts. Do not require present colocation after the fact if the current projector still lawfully exposes the acquired record. `read` cannot regenerate or reset deadlines. Stable delivery IDs let the consumer deduplicate printing.

## Validation and test map

Use new host-only guards in packages/session, not modifications to frozen packages/contracts. Validate passive objects before property access (including constructor capability wrappers), enforce exact property sets/types/finite safe integers/dense arrays, then existing World guards, then binding and six-phase semantic invariants. Validate every database row both before and after CAS, every row read, and every RPC response. Check signatures in the store worker using public pinned trust; check actual journal prefix in the host where the ledger capability is available. No callback/code is serialized. Direct local edits that preserve all shapes/hashes but fabricate a silence marker are not authenticated by this outbox; trusted-local storage and both-store rollback/tombstone-loss limits must stay explicit rather than claiming all malicious rewrites are detectable.

Store tests cover create/open/refuse overwrite/foreign schema/private paths, invalid metadata and row JSON/duplicate columns/hash/phase/scope/request bindings, missing stores, capacity/COMMIT failure, two-handle/process CAS, immutable attempt/deadline and tombstones, plus worker death after COMMIT. Conversation tests cover each crash point, saved-input and saved-reply exact restart retries, commit-then-bad-receipt remaining pending, journal-only rollback/prefix divergence, same-ID conflict, held model plus unrelated writer, waiter abort versus durable cancel, deadline/ignored late output, provider null/error/malformed/tool response, proposal retargeting/physical-action refusal, player-only delivery after closure/eviction, and no loan/custody/resource changes from multiple contextual exchanges. Raw function mutation/getter/proxy inputs must not execute. Use injected providers only and label their results honestly.

Suggested implementation files: `packages/session/src/{conversation-types,conversation-guards,conversation-store,conversation-store-worker,conversation}.ts`, existing session index exports, and the two SC-620 test files. Session dependencies may add @argo/interventions and @argo/model-client for direct runtime/type imports; no cycle exists. Root owns lockfile. SC-630 CLI starts only after this API and source candidate are accepted.
