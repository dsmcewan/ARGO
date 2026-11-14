import {createPublicKey} from 'node:crypto';
import {types as nodeTypes} from 'node:util';
import {Ajv2020} from 'ajv/dist/2020.js';
import {assertContract, assertCharacterContract, assertScope, fail, hash, schemaDefinition} from '@argo/contracts';
import type {Actor, CharacterProfile, Genesis} from '@argo/contracts';
import schema from './content.schema.json' with {type: 'json'};
import type {CampaignPack, CampaignSeed, CampaignSeedOptions, PlayerHandout, RumorCandidate} from './types.ts';

function invalid(message: string): never {return fail('INVALID_CONTRACT', message);}

function exactId(value: unknown): asserts value is string {
 // Keep identity checks explicit at semantic/map boundaries as well as in the
 // JSON grammar. IDs are never trimmed, case-folded or otherwise repaired.
 if (typeof value !== 'string' || /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.exec(value)?.[0] !== value || ['__proto__', 'prototype', 'constructor'].includes(value)) invalid('Invalid campaign identity');
}

// Inspect descriptors before reading caller properties. A proxy is rejected
// before even asking for its prototype/keys, including a revoked proxy. Count
// every traversal entry (also repeated aliases), not just distinct objects.
function passive(input: unknown): void {
 let entries = 0;
 const active = new Set<object>();
 const visit = (value: unknown, depth: number): void => {
  if (++entries > 100000 || depth > 32) invalid('Campaign DTO exceeds inspection bounds');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
   if (!Number.isSafeInteger(value) || Object.is(value, -0)) invalid('Campaign numbers must be safe integers');
   return;
  }
  if (typeof value !== 'object') invalid('Campaign DTO requires JSON data');
  if (nodeTypes.isProxy(value)) invalid('Campaign DTO cannot contain a proxy');
  if (active.has(value)) invalid('Campaign DTO cannot contain a cycle');
  const array = Array.isArray(value), prototype = Object.getPrototypeOf(value);
  if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) invalid('Campaign DTO requires plain objects and arrays');
  const keys = Reflect.ownKeys(value);
  if (keys.some(key => typeof key !== 'string')) invalid('Campaign DTO cannot contain symbols');
  if (entries + keys.length - (array ? 1 : 0) > 100000) invalid('Campaign DTO exceeds inspection bounds');
  active.add(value);
  try {
   if (array) {
    const length = Object.getOwnPropertyDescriptor(value, 'length');
    if (!length || !('value' in length) || !Number.isSafeInteger(length.value) || length.value < 0 || keys.length !== length.value + 1) invalid('Campaign arrays must be dense and undecorated');
    for (let i = 0; i < length.value; i++) {
     const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
     if (!descriptor?.enumerable || !('value' in descriptor)) invalid('Campaign array contains an active or missing entry');
     visit(descriptor.value, depth + 1);
    }
   } else {
    for (const key of keys) {
     const descriptor = Object.getOwnPropertyDescriptor(value, key);
     if (!descriptor?.enumerable || !('value' in descriptor)) invalid('Campaign DTO contains an active or hidden property');
     visit(descriptor.value, depth + 1);
    }
   }
  } finally {active.delete(value);}
 };
 visit(input, 0);
}

const ajv = new Ajv2020({strict: true, allErrors: true, ownProperties: true, coerceTypes: false, useDefaults: false, removeAdditional: false});
ajv.addSchema(schemaDefinition);
const validatePack = ajv.compile<CampaignPack>(schema);
const definition = (name: string) => ({$ref: `${schema.$id}#/$defs/${name}`});
const validateId = ajv.compile(definition('Id'));
const validateHandout = ajv.compile<PlayerHandout>(definition('PlayerHandout'));
const validateRumor = ajv.compile<RumorCandidate>(definition('RumorCandidate'));
const validateOptions = ajv.compile<CampaignSeedOptions>({
 type: 'object', additionalProperties: false,
 required: ['scope', 'privateSeed', 'authorityKeyId', 'authorityPublicKey', 'variant', 'travelers'],
 properties: {
  scope: {$ref: `${schemaDefinition.$id}#/$defs/Scope`},
  privateSeed: {type: 'string', minLength: 64, maxLength: 64, pattern: '^[0-9a-f]{64}$'},
  authorityKeyId: definition('Id'), authorityPublicKey: {type: 'string', minLength: 1}, variant: definition('Variant'),
  travelers: {type: 'array', minItems: 1, maxItems: 6, items: {
   type: 'object', additionalProperties: false, required: ['actor_id', 'name', 'nature'],
   properties: {actor_id: definition('Id'), name: definition('Name'), nature: definition('Nature')},
  }},
 },
});

function index<T extends {id: string}>(rows: T[], label: string): Map<string, T> {
 const result = new Map<string, T>();
 for (const row of rows) {
  exactId(row.id);
  if (result.has(row.id)) invalid(`Duplicate ${label} ID`);
  result.set(row.id, row);
 }
 return result;
}
function reference<T>(rows: Map<string, T>, id: string, label: string): T {
 exactId(id);
 const value = rows.get(id);
 if (value === undefined) invalid(`Unknown ${label} reference`);
 return value;
}
function multiply(a: number, b: number): number {
 const value = a * b;
 if (!Number.isSafeInteger(value) || value < 0) invalid('Campaign time conversion exceeds safe integers');
 return value;
}

/** Validate referee content only. Loading a pack grants no knowledge, role,
 * perception, consent or world effect. Natural-language conditions remain
 * referee guidance, not executable authorization predicates. */
export function assertCampaignPack(value: unknown): asserts value is CampaignPack {
 passive(value);
 if (!validatePack(value)) invalid('Invalid campaign content grammar');
 const locations = index(value.locations, 'location'), routes = index(value.routes, 'route'), npcs = index(value.npcs, 'NPC'), items = index(value.items, 'item');
 index(value.factions, 'faction'); index(value.rumors, 'rumor'); index(value.encounters, 'encounter'); index(value.starting_hooks, 'hook');
 const variants = index(value.variants, 'variant');
 if (variants.size !== 3 || !['genuine', 'counterfeit', 'legend'].every(id => variants.has(id))) invalid('Campaign requires exactly three fixed variants');
 const seedIds = new Set(['system', 'expedition']);
 for (const row of [...value.npcs, ...value.items]) {
  if (seedIds.has(row.id)) invalid('Campaign actor/item namespace collision');
  seedIds.add(row.id);
 }
 const start = reference(locations, value.start_location_id, 'start location');
 const looms = value.locations.filter(location => location.is_loom);
 if (start.is_loom || looms.length !== 1) invalid('Campaign requires a non-loom start and exactly one loom');
 const loom = looms[0]!;
 const adjacency = new Map(value.locations.map(location => [location.id, new Set<string>()]));
 const occupancy = new Map<string, number>();
 for (const location of value.locations) {
  for (const routeId of location.route_ids) {
   const route = reference(routes, routeId, 'route');
   if (location.id !== route.from && location.id !== route.to) invalid('Route is listed outside its endpoints');
  }
  for (const npcId of location.occupant_ids) {
   const npc = reference(npcs, npcId, 'occupant');
   if (npc.location_id !== location.id) invalid('NPC occupancy differs from its declared location');
   occupancy.set(npcId, (occupancy.get(npcId) ?? 0) + 1);
  }
 }
 for (const route of value.routes) {
  const from = reference(locations, route.from, 'route endpoint'), to = reference(locations, route.to, 'route endpoint');
  if (from.id === to.id || !from.route_ids.includes(route.id) || !to.route_ids.includes(route.id)) invalid('Route needs distinct reciprocal endpoints');
  multiply(route.travel_turns, value.calendar.exploration_turn_seconds);
  if (route.access === 'ordinary') {
   if (from.is_loom || to.is_loom) invalid('Ordinary routes cannot reach the loom');
   adjacency.get(from.id)!.add(to.id); adjacency.get(to.id)!.add(from.id);
  }
 }
 const reached = new Set<string>([start.id]), queue = [start.id];
 for (let i = 0; i < queue.length; i++) for (const next of adjacency.get(queue[i]!)!) {
  if (!reached.has(next)) {reached.add(next); queue.push(next);}
 }
 if (value.locations.some(location => !location.is_loom && !reached.has(location.id))) invalid('Ordinary campaign sites must be connected');
 const yearSeconds = multiply(value.calendar.seconds_per_day, value.calendar.days_per_year);
 for (const npc of value.npcs) {
  reference(locations, npc.location_id, 'NPC location');
  if (occupancy.get(npc.id) !== 1) invalid('NPC must occupy its declared location exactly once');
  if (npc.fate_role !== null && (npc.id !== npc.fate_role || npc.location_id !== loom.id)) invalid('Fate role, identity and loom location must agree');
  multiply(npc.age_years, yearSeconds); multiply(npc.remaining_years, yearSeconds);
  if ([...npc.speech_example].length > npc.speech_policy.max_characters) invalid('NPC speech example exceeds its code-point budget');
 }
 for (const role of ['clotho', 'lachesis', 'atropos'] as const) {
  if (npcs.get(role)?.fate_role !== role) invalid('Campaign requires each independent Fate exactly once');
 }
 for (const faction of value.factions) {
  for (const member of faction.members) reference(npcs, member, 'faction member');
  if (faction.clock.progress > faction.clock.segments) invalid('Faction clock progress exceeds its segments');
 }
 for (const rumor of value.rumors) {
  const speaker = reference(npcs, rumor.speaker_id, 'rumor speaker');
  reference(locations, rumor.location_id, 'rumor location'); reference(locations, rumor.lead_location_id, 'rumor lead');
  if (speaker.location_id !== rumor.location_id) invalid('Rumor speaker must be at its stated seed location');
 }
 for (const encounter of value.encounters) {
  reference(locations, encounter.location_id, 'encounter location');
  for (const participant of encounter.participants) reference(npcs, participant, 'encounter participant');
 }
 for (const hook of value.starting_hooks) reference(locations, hook.location_id, 'hook location');
 for (const item of value.items) if (item.custodian_id !== null) reference(npcs, item.custodian_id, 'item custodian');
 const artifacts = new Set<string>();
 for (const variant of value.variants) {
  if ((variant.id === 'legend') !== (variant.artifact_item_id === null)) invalid('Physical artifacts require an explicit non-legend variant');
  if (variant.artifact_item_id !== null) {
   const artifact = reference(items, variant.artifact_item_id, 'artifact');
   if (!artifact.variants.includes(variant.id)) invalid('Variant artifact is absent from that variant');
   artifacts.add(artifact.id);
  }
 }
 for (const artifactId of artifacts) for (const selected of items.get(artifactId)!.variants) {
  if (variants.get(selected)!.artifact_item_id !== artifactId) invalid('A physical claimed artifact leaks into another variant');
 }
}

export function getPlayerHandout(pack: CampaignPack): PlayerHandout {
 assertCampaignPack(pack);
 const start = pack.locations.find(location => location.id === pack.start_location_id)!;
 const result: PlayerHandout = {version: pack.version, title: pack.title, subtitle: pack.subtitle, introduction: pack.public_intro, start: {id: start.id, name: start.name, description: start.public_description}, rules_profile: 'tempting-fates-rules/0.1.0'};
 if (!validateHandout(result)) invalid('Invalid player handout');
 return result;
}

/** A possible speech proposal only: this does not authenticate its speaker,
 * choose witnesses, deliver knowledge or establish truth/consent. */
export function getRumorCandidate(pack: CampaignPack, rumorId: string): RumorCandidate {
 assertCampaignPack(pack); passive(rumorId);
 exactId(rumorId);
 if (!validateId(rumorId)) invalid('Invalid rumor identity');
 const rumor = pack.rumors.find(row => row.id === rumorId);
 if (!rumor) invalid('Unknown rumor');
 const result: RumorCandidate = {id: rumor.id, speaker_id: rumor.speaker_id, text: rumor.text, lead_location_id: rumor.lead_location_id};
 if (!validateRumor(result)) invalid('Invalid rumor candidate');
 return result;
}

/** Host-only deterministic initialization. No world is loaded automatically;
 * no I/O, randomness, authority append or character configuration occurs here. */
export function buildCampaignSeed(pack: CampaignPack, options: CampaignSeedOptions): CampaignSeed {
 assertCampaignPack(pack); passive(options);
 if (!validateOptions(options)) invalid('Invalid campaign seed options');
 try {assertScope(options.scope);} catch {invalid('Invalid campaign seed scope identity');}
 for (const id of [options.scope.tenant_id, options.scope.workspace_id, options.scope.campaign_id, options.scope.world_id, options.scope.branch_id, options.authorityKeyId]) exactId(id);
 // createPublicKey accepts private PEM as input and silently derives a public
 // key. Explicitly refuse private material, even appended after a public block.
 if (options.authorityPublicKey.includes('PRIVATE KEY')) invalid('Campaign seed accepts public key material only');
 try {
  const key = createPublicKey(options.authorityPublicKey);
  if (key.type !== 'public' || key.asymmetricKeyType !== 'ed25519') invalid('Campaign authority key must be Ed25519 public material');
 } catch {invalid('Invalid Ed25519 authority public key');}
 const ids = new Set(['system', 'expedition', ...pack.npcs.map(npc => npc.id), ...pack.items.map(item => item.id)]);
 for (const traveler of options.travelers) {
  exactId(traveler.actor_id);
  if (ids.has(traveler.actor_id)) invalid('Traveler identity collides with the campaign roster');
  ids.add(traveler.actor_id);
 }
 const yearSeconds = multiply(pack.calendar.seconds_per_day, pack.calendar.days_per_year);
 const actor = (age: number, remaining: number, fate_role: Actor['fate_role']): Actor => ({alive: true, time_balance: multiply(remaining, yearSeconds), age_ticks: multiply(age, yearSeconds), fate_role, thread: 'present'});
 const genesis: Genesis = {
  schema_version: '1.0.0', scope: structuredClone(options.scope), ruleset_version: 'tempted-fates/1.0.0', world_time: 0,
  seed: options.privateSeed, authority_key_id: options.authorityKeyId, authority_public_key: options.authorityPublicKey,
  actors: Object.fromEntries([
   ['system', actor(0, 0, null)],
   ...pack.npcs.map(npc => [npc.id, actor(npc.age_years, npc.remaining_years, npc.fate_role)] as const),
   ...options.travelers.map(traveler => [traveler.actor_id, actor(25, 50, null)] as const),
  ]),
  items: Object.fromEntries(pack.items.filter(item => item.variants.includes(options.variant)).map(item => [item.id, {custodian_id: item.custodian_id, destroyed: false}])),
  parties: {expedition: options.travelers.map(traveler => traveler.actor_id)},
 };
 const profiles: CharacterProfile[] = [
  ...pack.npcs.map(npc => ({actor_id: npc.id, revision: 1, nature: structuredClone(npc.nature), activity: structuredClone(npc.activity), speech_policy: structuredClone(npc.speech_policy)})),
  ...options.travelers.map(traveler => ({actor_id: traveler.actor_id, revision: 1, nature: structuredClone(traveler.nature), activity: {description: 'Following their own course.', busy_until: 0}, speech_policy: {max_characters: 2048, minimum_interval: 0}})),
 ];
 assertContract('Genesis', genesis);
 for (const profile of profiles) assertCharacterContract('CharacterProfile', profile);
 return {genesis, profiles, manifest: {pack_version: pack.version, pack_hash: hash(pack), variant: options.variant}};
}
