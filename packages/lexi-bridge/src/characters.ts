import {assertCharacterContract, assertCharacterPrincipal, assertScope, canonical, fail, freezeDto, requireScope, serviceCall} from '@argo/contracts';
import type {CharacterActorQuery, CharacterNarratorQuery, CharacterNarratorView, CharacterProjection, CharacterView, CharacterImpression, Principal, Scope, ServiceOptions} from '@argo/contracts';

/** Privileged host wiring: never hand this combined capability or its source
 * projection to a worker. Pass an actor DTO or a pre-scoped narrator loader.
 * readProjection must rebuild the current trusted authority prefix, not accept
 * a model-supplied projection. These readers validate and filter; they do not
 * authenticate the host's principal or verify ledger signatures themselves. */
export function createCharacterViews(options: {
 scope: Scope;
 readProjection: (call: {signal: AbortSignal}) => Promise<CharacterProjection>;
 timeoutMs?: number;
}) {
 assertScope(options.scope);
 const scope = freezeDto(structuredClone(options.scope));
 const readProjection = options.readProjection, timeoutMs = options.timeoutMs ?? 5000;
 if (typeof readProjection !== 'function') fail('INVALID_CONTRACT', 'A trusted character projection reader is required');
 if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) fail('INVALID_CONTRACT', 'Invalid character read deadline');

 function authorize<T extends CharacterActorQuery | CharacterNarratorQuery>(name: 'CharacterActorQuery' | 'CharacterNarratorQuery', input: T, auth: Principal): T {
  // Validate passive DTOs before cloning; an accessor/proxy must never execute
  // while copying authority input. Capture identity before the first await.
  assertCharacterContract(name, input);
  assertCharacterPrincipal(auth);
  const query = freezeDto(structuredClone(input)), principal = freezeDto(structuredClone(auth));
  requireScope(scope, query.scope); requireScope(scope, principal.scope);
  if (query.actor_id !== principal.actor_id) fail('UNAUTHORIZED', 'Character viewer does not match the authenticated actor');
  return query;
 }

 async function current(query: CharacterActorQuery, call: ServiceOptions): Promise<CharacterProjection> {
  const received = await serviceCall(signal => readProjection({signal}), timeoutMs, call);
  // Validate the entire authority projection before selecting public fields.
  // Hidden malformed rows cannot be quietly ignored by a narrow query.
  assertCharacterContract('CharacterProjection', received);
  const projection = freezeDto(structuredClone(received));
  requireScope(scope, projection.scope);
  if (canonical(query.cursor) !== canonical(projection.cursor)) fail('CONFLICT', 'Character query must use the current authority cursor');
  if (!projection.actors.some(actor => actor.actor_id === query.actor_id)) fail('UNAUTHORIZED', 'Unknown character viewer');
  return projection;
 }

 return Object.freeze({
  async actor(input: CharacterActorQuery, auth: Principal, call: ServiceOptions = {}): Promise<CharacterView> {
   const query = authorize('CharacterActorQuery', input, auth);
   const projection = await current(query, call);
   const latest = new Map<string, CharacterImpression>();
   for (const impression of projection.impressions) {
    if (impression.data.owner_actor_id !== query.actor_id) continue;
    const previous = latest.get(impression.data.subject_actor_id);
    if (!previous || impression.sequence > previous.sequence) latest.set(impression.data.subject_actor_id, impression);
   }
   // Recency means first acquisition, not source creation: a newly witnessed
   // old action enters current perception. Repeated grants do not refresh it.
   // Emit the selected records in source order as required by the wire grammar.
   const acquired = projection.records.flatMap(record => {
    let first = Infinity;
    for (const acquisition of record.acquisitions) {
     if (acquisition.actor_id === query.actor_id && acquisition.sequence <= query.cursor.sequence && acquisition.world_time <= query.cursor.world_time) first = Math.min(first, acquisition.sequence);
    }
    return Number.isFinite(first) ? [{record: record.experience, first}] : [];
   });
   const experiences = acquired.sort((a, b) => b.first - a.first || b.record.sequence - a.record.sequence)
    .slice(0, 16).map(row => row.record).sort((a, b) => a.sequence - b.sequence);
   let lastSpokeAt: number | null = null;
   for (const {experience} of projection.records) {
    if (experience.kind === 'speech' && experience.actor_id === query.actor_id) lastSpokeAt = Math.max(lastSpokeAt ?? 0, experience.world_time);
   }
   const view: CharacterView = {
    query, profile: projection.profiles.find(profile => profile.actor_id === query.actor_id) ?? null,
    alive: projection.actors.find(actor => actor.actor_id === query.actor_id)!.alive,
    last_spoke_at: lastSpokeAt,
    impressions: [...latest.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, value]) => value),
    experiences, ontology_blocked: projection.ontology_blocked, engagement_closed: projection.engagement_closed,
   };
   assertCharacterContract('CharacterView', view);
   return freezeDto(view);
  },

  async narrator(input: CharacterNarratorQuery, auth: Principal, call: ServiceOptions = {}): Promise<CharacterNarratorView> {
   const query = authorize('CharacterNarratorQuery', input, auth);
   const projection = await current(query, call);
   if (!projection.actors.some(actor => actor.actor_id === query.traveler_id)) fail('UNAUTHORIZED', 'Unknown narrator traveler');
   if (query.audience === 'party') {
    const party = projection.parties.find(party => party.party_id === query.party_id);
    if (!party?.actor_ids.includes(query.actor_id) || !party.actor_ids.includes(query.traveler_id)) fail('UNAUTHORIZED', 'Narrator viewer and traveler must belong to the current party');
   }
   const visible = projection.ontology_blocked || projection.engagement_closed ? [] : projection.records.filter(record =>
    record.experience.actor_id === query.traveler_id && record.experience.sequence > query.after_sequence &&
    (query.audience === 'actor' || record.acquisitions.some(acquisition =>
     acquisition.actor_id === query.actor_id && acquisition.party_id === query.party_id &&
     acquisition.sequence <= query.cursor.sequence && acquisition.world_time <= query.cursor.world_time)));
   // Filter before pagination. Hidden rows cannot create a continuation or an
   // empty intermediate page; source sequence gaps remain public API metadata.
   const records = visible.slice(0, query.limit).map(row => row.experience);
   const view: CharacterNarratorView = {
    query, records,
    coverage: {activation_sequence: projection.activation_sequence, through_sequence: projection.cursor.sequence, captured_kinds: ['speech', 'action']},
    next_after_sequence: visible.length > records.length ? records.at(-1)!.sequence : null,
    ontology_blocked: projection.ontology_blocked, engagement_closed: projection.engagement_closed,
   };
   assertCharacterContract('CharacterNarratorView', view);
   return freezeDto(view);
  },
 });
}
