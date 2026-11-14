# Model-backed character dialogue

`createModelCharacterAgent` now connects the character runtime to ARGO's shared provider router. The host supplies SDK clients and authenticated context readers; it no longer implements `speak` or `interpret` callbacks. Each successful speech/impression task uses one bounded generation turn, with optional alternate-pool failover. It returns an untrusted character command or silence. The existing character bridge validates and commits speech; replay never invokes a model.

The model receives the addressed utterance, character traits/priorities/activity, acquired experiences and the interlocutor's private impression. An optional communication goal states what the character might wish to express. The prompt asks it to interpret those inputs, choose what to communicate or withhold, and formulate its own wording. It contains no canned dialogue lines. Fixed strings in tests are provider fixtures, not the runtime's dialogue logic.

## Connecting an authenticated host

```ts
import {createModelCharacterAgent} from '@argo/interventions';
import {buildCampaignDialogueSupplement} from '@argo/tempted-fates';

// These are existing host-owned dependencies, not caller-supplied credentials:
// principal, scope, sessionId, views, bridge, pack, candidates, clientsByPool.
const agent = createModelCharacterAgent({
  scope, actorId: principal.actor_id, sessionId, candidates,
  clientFor: candidate => clientsByPool.get(candidate.pool),
  refreshContext: (query, call) => views.actor(query, principal, call),
  readSupplement: async (query, {signal}) => {
    // The host checks current disclosure for this principal, world and cursor.
    // A null room is valid. Never use the NPC's seed location as this grant.
    const location_id = await authorizedRoomFor(principal, query, signal);
    return buildCampaignDialogueSupplement(pack, query, {location_id});
  },
  timeoutMs: 10_000,
  maxOutputTokens: 2_048,
  effort: 'low',
});

// query must use the current character-authority cursor; recordId identifies an
// acquired utterance addressed to this actor. Reuse requestId only for a retry.
const command = await agent.respond(query, recordId, requestId, {
  signal,
  communicationGoal: 'Decline without breaking the relationship',
});
if (command) {
  const receipt = await bridge.submit(command, principal, {signal});
  // Deliver the accepted speech according to the host's witness/audience grant.
}
```

This sketch names host services explicitly; it is not a supplied login, geometry or SDK-credential service. A model-proposed goal never authenticates an actor or authorizes an action. Do not return raw provider deltas to a player before validation and commit. `impress(query, subjectActorId, evidenceIds, requestId, {signal})` similarly returns a private impression command; commit it and refresh the query before another command.

OpenAI/Google budget guards need trustworthy provider token counts. Supported SDK count surfaces are used automatically; otherwise provide `countTokensFor(candidate)`, returning the client's real counting function. Estimated character counts must not replace this check. Candidates must contain explicit pool identities. SDK clients are initialized by the host; importing or constructing the adapter makes no provider call.

## Shared facts and private interpretation

The [presentation contract](CONTRACT.md) keeps two separate supplement fields: explicitly disclosed authored scene facts, and the queried character's own name/occupation/wants/boundaries. The campaign helper excludes referee notes, private knowledge, sample speech, variants and other NPCs. The room grant is mandatory even when a campaign seed lists that NPC in a room: seed occupancy is not live perception.

A room may have stone walls, one window and a brazier. Whether it feels welcoming or oppressive belongs to each character. The adapter has no path from model output or agreement between observers into the room definition. Shared data is source-hashed and query-bound; each stateless model request still needs its authorized facts.

Current and historical nature revisions are defined once per packet; impressions reference them. Incoming speech occurs once and is selected by record ID. Only the current interlocutor/subject's impression is included, with omission counts and original evidence IDs. The reader's latest 16 acquired experiences remain the available memory window; this connection does not retrieve older promises from the archive automatically.

## Bounds and freshness

The default context limit is 32,768 UTF-8 bytes. Default generation allowance is 2,048 tokens, including reasoning where the provider counts it jointly; Unicode speech length is still enforced by the character profile. The opt-in shared-client `outputBudgetPolicy:'explicit'` preserves small Google caps. Existing build-harness callers retain their previous default long-decode behavior.

Busy, ended, unaddressed, unconfigured, under-cooldown or cutoff characters make no generation call. The full authorized view and supplement are checked before each attempt, again after asynchronous token counting and after generation; changed or unavailable context suppresses the command. Late counting cannot start a generation after the turn expires. A single deadline includes reads, counting, provider work and optional cooldown bookkeeping. There is one attempt per candidate pool, no Google continuation hops for explicit output budgets, no 400 retry loop, no tools, no carried conversation history and no exposed streaming. Cache identity includes the full world/tenant scope, actor and task. The legacy disk cooldown store is not enabled implicitly.

Responses must be exactly one JSON object with `text` containing nonempty bounded prose or null. Extra keys, malformed JSON, incomplete/tool responses and oversized output fail. These checks validate protocol, authority and disclosure; they do not prove semantic honesty or conversational quality from a live model.

## Verification and remaining work

Offline tests cover different private reactions to one scene, exact addressed input, historical nature, silence, stale suppression, failover, cancellation, token counting and explicit limits across four provider surfaces. A real signed-journal integration proves speech is committed through the authenticated bridge and replays without a model. The complete repository gate and its exact candidate identity are recorded in delivery evidence/CI.

The implementation is a callable headless library connection, not a deployed game or paid live-provider trial. No live latency or dialogue-quality claim follows from injected fixtures. Host authentication, SDK credentials, scene disclosure and delivery remain host integrations. Mortal worlds and the older character/Fate authority profiles remain separate; this change does not join them by actor name. Weather, dynamic scene state, archive relevance retrieval and a measured live dialogue benchmark remain later work.

Blackboard work is registered under `docs/npc-dialogue/seed.json` with separate owned paths. Its historical data-only policy cannot approve changes to existing package/test policy. Source submissions and any refusals remain distinct from application tests and owner-authorized GitHub integration; automatic dispatch and the operational trust root remain unchanged.
