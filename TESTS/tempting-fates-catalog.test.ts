import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync, createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {ArgoError, assertContract, assertCharacterContract, canonical} from '../packages/contracts/src/index.ts';
import type {CampaignCatalog, CampaignPack, CampaignNpc, CampaignSeedOptions, Variant} from '../scenarios/tempted-fates/campaign/types.ts';
import * as implementation from '../scenarios/tempted-fates/campaign/catalog.ts';

function catalog(): CampaignCatalog {return implementation;}
const keys = generateKeyPairSync('ed25519');
const publicKey = keys.publicKey.export({format: 'pem', type: 'spki'}).toString();
const privateKey = keys.privateKey.export({format: 'pem', type: 'pkcs8'}).toString();
const invalid = (error: unknown) => error instanceof ArgoError && error.code === 'INVALID_CONTRACT';

// Independent content fixture: three sites, four actors, two distinct artifacts.
// It is deliberately smaller than the authored atlas and imports no world data.
function pack(): CampaignPack {
 const npc = (id: string, fate_role: CampaignNpc['fate_role']): CampaignNpc => ({
  id, name: `Name ${id}`, occupation: 'Keeping a workshop', location_id: fate_role === null ? 'quay' : 'loom',
  nature: {description: 'Practical and patient.', priorities: ['Finish repairs', 'Keep promises']},
  activity: {description: 'Mending a net.', busy_until: 30}, speech_policy: {max_characters: 80, minimum_interval: 10},
  age_years: 20, remaining_years: 40, fate_role, public_description: 'Occupied with work.',
  private_knowledge: [`PRIVATE_${id}`], wants: 'A quiet afternoon.', will_not: 'Invent a promise.', speech_example: 'Bring the net here.',
 });
 return {
  version: 'tempting-fates-pack/0.1.0', title: 'Tempting Fates', subtitle: 'The small coast',
  tone_note: 'A test of broken institutions.', adaptation_note: 'Original test material with a synthetic calendar.',
  public_intro: 'Your boat reaches the quay.', start_location_id: 'quay',
  calendar: {seconds_per_day: 86400, days_per_year: 360, exploration_turn_seconds: 600, combat_round_seconds: 6, watch_seconds: 14400},
  locations: [
   {id: 'quay', name: 'The Quay', mythic_influence: 'Hospitality', public_description: 'A net dries beside the boats.', referee_notes: 'PRIVATE_QUAY', occupant_ids: ['keeper'], route_ids: ['shore'], is_loom: false},
   {id: 'shrine', name: 'The Shrine', mythic_influence: 'Offerings', public_description: 'The stone steps are worn.', referee_notes: 'PRIVATE_SHRINE', occupant_ids: [], route_ids: ['shore', 'threshold'], is_loom: false},
   {id: 'loom', name: 'The Loom', mythic_influence: 'Fate', public_description: 'Three people work.', referee_notes: 'PRIVATE_LOOM', occupant_ids: ['clotho', 'lachesis', 'atropos'], route_ids: ['threshold'], is_loom: true},
  ],
  routes: [
   {id: 'shore', from: 'shrine', to: 'quay', travel_turns: 2, condition: 'Open in calm weather.', sign: 'Shells on a path.', access: 'ordinary'},
   {id: 'threshold', from: 'shrine', to: 'loom', travel_turns: 1, condition: 'A referee may offer an opening; never guaranteed.', sign: 'An unusual stillness.', access: 'conditional'},
  ],
  npcs: [npc('keeper', null), npc('clotho', 'clotho'), npc('lachesis', 'lachesis'), npc('atropos', 'atropos')],
  factions: [{id: 'workers', name: 'Quay Workers', members: ['keeper'], goal: 'Repair the crane.', resources: 3, clock: {name: 'Crane repair', segments: 4, progress: 1, advance_trigger: 'A watch of agreed labor.', completion: 'The crane works.', visible_sign: 'Fresh rope.', interruption: 'A missing part.'}, approaches: ['Offer a part', 'Ask the price']}],
  rumors: [{id: 'cup_story', speaker_id: 'keeper', location_id: 'quay', text: 'A cup is said to rest at the shrine.', lead_location_id: 'shrine', assessment: {genuine: 'partial', counterfeit: 'false', legend: 'outdated'}, referee_basis: 'PRIVATE_RUMOR_BASIS'}],
  items: [
   {id: 'rope', name: 'Rope', description: 'A useful coil.', custodian_id: 'keeper', slots: 1, variants: ['genuine', 'counterfeit', 'legend'], secret: false},
   {id: 'true_cup', name: 'Cup', description: 'PRIVATE_TRUE_CUP', custodian_id: null, slots: 1, variants: ['genuine'], secret: true},
   {id: 'fake_cup', name: 'Imitation', description: 'PRIVATE_FAKE_CUP', custodian_id: 'keeper', slots: 1, variants: ['counterfeit'], secret: true},
  ],
  encounters: [{id: 'broken_crane', location_id: 'quay', title: 'A broken crane', visible_situation: 'A load cannot be lifted.', participants: ['keeper'], approaches: ['Help', 'Ask', 'Leave'], if_ignored: 'The load waits.', costs: ['One watch of work'], clue: 'The rope is new.', exit: 'Take the shore path.'}],
  variants: [{id: 'genuine', referee_truth: 'PRIVATE_GENUINE', artifact_item_id: 'true_cup'}, {id: 'counterfeit', referee_truth: 'PRIVATE_COUNTERFEIT', artifact_item_id: 'fake_cup'}, {id: 'legend', referee_truth: 'PRIVATE_LEGEND', artifact_item_id: null}],
  starting_hooks: [{id: 'help_crane', title: 'Work at the quay', prompt: 'The keeper asks for a hand.', location_id: 'quay', possible_actions: ['Ask terms', 'Decline'], decline_consequence: 'The keeper asks someone else.'}],
 };
}
function options(variant: Variant = 'genuine'): CampaignSeedOptions {
 return {
  scope: {tenant_id: 'private_tenant', rights_lane: 'private_upload', workspace_id: 'coast', workspace_tenant_id: 'private_tenant:private_upload:coast', campaign_id: 'campaign_7', world_id: 'world_9', branch_id: 'branch_2'},
  privateSeed: '4f'.repeat(32), authorityKeyId: 'host_key', authorityPublicKey: publicKey, variant,
  travelers: [{actor_id: 'visitor_b', name: 'Second first', nature: {description: 'Curious.', priorities: ['Learn']}}, {actor_id: 'visitor_a', name: 'First second', nature: {description: 'Careful.', priorities: ['Return safely']}}],
 };
}

test('catalog accepts a complete small pack and reversed ordinary-route endpoints without changing it', () => {
 const api: CampaignCatalog = catalog(), value = pack(), before = structuredClone(value);
 api.assertCampaignPack(value);
 assert.deepEqual(value, before);
 const nullPrototype = Object.assign(Object.create(null), pack());
 Object.setPrototypeOf(nullPrototype.npcs[0].nature, null);
 api.assertCampaignPack(nullPrototype);
});

test('catalog validates closed grammar without coercing, removing fields, or supplying defaults', () => {
 const api: CampaignCatalog = catalog();
 for (const change of [
  (p: any) => {p.rng_seed = 'private';}, (p: any) => {p.npcs[0].consent = true;},
  (p: any) => {delete p.npcs[0].private_knowledge;}, (p: any) => {p.items[0].slots = '1';},
  (p: any) => {p.title = '';}, (p: any) => {p.title = '𐀀'.repeat(257);},
  (p: any) => {p.locations[0].id = 'constructor';}, (p: any) => {p.routes[0].id = '../road';},
  (p: any) => {p.calendar.days_per_year = 365;}, (p: any) => {p.npcs[0].nature.priorities = [];},
 ]) {
  const value = pack(); change(value); const before = structuredClone(value);
  assert.throws(() => api.assertCampaignPack(value), invalid); assert.deepEqual(value, before);
 }
 const unicode = pack(); unicode.title = '𐀀'.repeat(256); api.assertCampaignPack(unicode);
});

test('every collection rejects duplicate IDs and NPC/item reserved namespaces cannot collide', () => {
 const api: CampaignCatalog = catalog();
 for (const collection of ['locations', 'routes', 'npcs', 'factions', 'rumors', 'items', 'encounters', 'variants', 'starting_hooks'] as const) {
  const value = pack(); (value[collection] as Array<{id: string}>).push(structuredClone(value[collection][0]!));
  assert.throws(() => api.assertCampaignPack(value), invalid, collection);
 }
 for (const collection of ['npcs', 'items'] as const) for (const id of ['system', 'expedition', collection === 'items' ? 'keeper' : 'rope']) {
  const value = pack(); value[collection][0]!.id = id;
  assert.throws(() => api.assertCampaignPack(value), invalid, `${collection}:${id}`);
 }
 const value = pack(); value.variants[2]!.id = 'genuine'; assert.throws(() => api.assertCampaignPack(value), invalid);
});

test('route, occupant, faction, encounter, rumor, hook and item references must actually resolve', () => {
 const api: CampaignCatalog = catalog();
 for (const change of [
  (p: CampaignPack) => {p.start_location_id = 'missing';},
  (p: CampaignPack) => {p.routes[0]!.from = 'missing';},
  (p: CampaignPack) => {p.locations[0]!.route_ids.push('missing');},
  (p: CampaignPack) => {p.locations[0]!.occupant_ids.push('missing');},
  (p: CampaignPack) => {p.npcs[0]!.location_id = 'missing';},
  (p: CampaignPack) => {p.factions[0]!.members = ['missing'];},
  (p: CampaignPack) => {p.encounters[0]!.participants = ['missing'];},
  (p: CampaignPack) => {p.encounters[0]!.location_id = 'missing';},
  (p: CampaignPack) => {p.rumors[0]!.speaker_id = 'missing';},
  (p: CampaignPack) => {p.rumors[0]!.location_id = 'missing';},
  (p: CampaignPack) => {p.rumors[0]!.lead_location_id = 'missing';},
  (p: CampaignPack) => {p.starting_hooks[0]!.location_id = 'missing';},
  (p: CampaignPack) => {p.items[0]!.custodian_id = 'missing';},
  (p: CampaignPack) => {p.variants[0]!.artifact_item_id = 'missing';},
 ]) {const value = pack(); change(value); assert.throws(() => api.assertCampaignPack(value), invalid);}
});

test('ordinary atlas is connected, route memberships are reciprocal, and loom access stays conditional', () => {
 const api: CampaignCatalog = catalog();
 for (const change of [
  (p: CampaignPack) => {p.start_location_id = 'loom';},
  (p: CampaignPack) => {p.locations[2]!.is_loom = false;},
  (p: CampaignPack) => {p.locations[1]!.is_loom = true;},
  (p: CampaignPack) => {p.routes[0]!.to = 'shrine';},
  (p: CampaignPack) => {p.routes[0]!.access = 'conditional';},
  (p: CampaignPack) => {p.routes[1]!.access = 'ordinary';},
  (p: CampaignPack) => {p.locations[0]!.route_ids = [];},
  (p: CampaignPack) => {p.locations[2]!.route_ids.push('shore');},
 ]) {const value = pack(); change(value); assert.throws(() => api.assertCampaignPack(value), invalid);}
});

test('occupants occur at their declared site exactly once and Fate identity/role/location are fixed', () => {
 const api: CampaignCatalog = catalog();
 for (const change of [
  (p: CampaignPack) => {p.locations[0]!.occupant_ids = [];},
  (p: CampaignPack) => {p.locations[1]!.occupant_ids = ['keeper'];},
  (p: CampaignPack) => {p.npcs[0]!.location_id = 'shrine';},
  (p: CampaignPack) => {p.rumors[0]!.location_id = 'shrine';},
  (p: CampaignPack) => {p.npcs[1]!.fate_role = null;},
  (p: CampaignPack) => {p.npcs[1]!.fate_role = 'atropos';},
  (p: CampaignPack) => {p.npcs[0]!.fate_role = 'clotho';},
  (p: CampaignPack) => {p.npcs[1]!.id = 'other_clotho'; p.locations[2]!.occupant_ids[0] = 'other_clotho';},
  (p: CampaignPack) => {p.npcs[1]!.location_id = 'quay'; p.locations[2]!.occupant_ids.shift(); p.locations[0]!.occupant_ids.push('clotho');},
 ]) {const value = pack(); change(value); assert.throws(() => api.assertCampaignPack(value), invalid);}
});

test('artifact selection excludes the other variant artifact and every physical claimed artifact from legend', () => {
 const api: CampaignCatalog = catalog();
 for (const change of [
  (p: CampaignPack) => {p.variants[0]!.artifact_item_id = null;},
  (p: CampaignPack) => {p.variants[1]!.artifact_item_id = null;},
  (p: CampaignPack) => {p.variants[2]!.artifact_item_id = 'true_cup';},
  (p: CampaignPack) => {p.items[1]!.variants = ['counterfeit'];},
  (p: CampaignPack) => {p.items[1]!.variants.push('counterfeit');},
  (p: CampaignPack) => {p.items[1]!.variants.push('legend');},
  (p: CampaignPack) => {p.items[2]!.variants.push('legend');},
 ]) {const value = pack(); change(value); assert.throws(() => api.assertCampaignPack(value), invalid);}
 const shared = pack(); shared.items.pop(); shared.items[1]!.variants = ['genuine', 'counterfeit']; shared.variants[1]!.artifact_item_id = 'true_cup';
 api.assertCampaignPack(shared);
});

test('clock, arithmetic, speech-codepoint and safe-number limits reject malformed content', () => {
 const api: CampaignCatalog = catalog();
 for (const change of [
  (p: CampaignPack) => {p.factions[0]!.clock.progress = 5;},
  (p: CampaignPack) => {p.factions[0]!.resources = -1;},
  (p: CampaignPack) => {p.npcs[0]!.age_years = Number.MAX_SAFE_INTEGER;},
  (p: CampaignPack) => {p.routes[0]!.travel_turns = Number.MAX_SAFE_INTEGER;},
  (p: CampaignPack) => {p.npcs[0]!.speech_policy.max_characters = 2; p.npcs[0]!.speech_example = '𐀀𐀀𐀀';},
  ...[NaN, Infinity, -Infinity, -0, 1.5, Number.MAX_SAFE_INTEGER + 1].map(value => (p: CampaignPack) => {p.factions[0]!.resources = value;}),
 ]) {const value = pack(); change(value); assert.throws(() => api.assertCampaignPack(value), invalid);}
 const unicode = pack(); unicode.npcs[0]!.speech_policy.max_characters = 2; unicode.npcs[0]!.speech_example = '𐀀𐀀'; api.assertCampaignPack(unicode);
});

test('passive guard rejects proxies and getters before invoking any caller behavior', () => {
 const api: CampaignCatalog = catalog(); let touched = 0;
 const proxy = new Proxy(pack(), {get: () => {touched++; return undefined;}, ownKeys: () => {touched++; return [];}, getPrototypeOf: () => {touched++; return null;}});
 assert.throws(() => api.assertCampaignPack(proxy), invalid);
 const nested = pack(); nested.npcs[0]!.nature = new Proxy(nested.npcs[0]!.nature, {ownKeys: () => {touched++; return [];}});
 assert.throws(() => api.assertCampaignPack(nested), invalid);
 const accessor = pack(); Object.defineProperty(accessor, 'title', {enumerable: true, get: () => {touched++; return 'Title';}});
 assert.throws(() => api.assertCampaignPack(accessor), invalid);
 const auth = options(); Object.defineProperty(auth, 'privateSeed', {enumerable: true, get: () => {touched++; return '4f'.repeat(32);}});
 assert.throws(() => api.buildCampaignSeed(pack(), auth), invalid);
 const revoked = Proxy.revocable(options(), {}); revoked.revoke();
 assert.throws(() => api.buildCampaignSeed(pack(), revoked.proxy), invalid);
 assert.equal(touched, 0);
});

test('passive guard rejects exotic, cyclic, decorated, sparse, symbolic, hidden and oversized structures', () => {
 const api: CampaignCatalog = catalog();
 for (const change of [
  (p: any) => {p.title = new String('Title');},
  (p: any) => {Object.setPrototypeOf(p.npcs[0].nature, {description: 'Inherited'});},
  (p: any) => {p.public_intro = undefined;}, (p: any) => {p.loop = p;},
  (p: any) => {p.npcs[Symbol('secret')] = 'x';},
  (p: any) => {p.npcs.extra = 'x';}, (p: any) => {delete p.npcs[0];},
  (p: any) => {Object.defineProperty(p, 'title', {value: 'Hidden', enumerable: false});},
  (p: any) => {let value: any = p; for (let i = 0; i < 34; i++) value = value.deep = {};},
  (p: any) => {p.wide = Array.from({length: 100001}, () => null);},
 ]) {const value = pack(); change(value); assert.throws(() => api.assertCampaignPack(value), invalid);}
});

test('public handout and rumor candidate are exact minimal detached DTOs with no referee truth', () => {
 const api: CampaignCatalog = catalog(), value = pack();
 const handout = api.getPlayerHandout(value), rumor = api.getRumorCandidate(value, 'cup_story');
 assert.deepEqual(handout, {version: 'tempting-fates-pack/0.1.0', title: 'Tempting Fates', subtitle: 'The small coast', introduction: 'Your boat reaches the quay.', start: {id: 'quay', name: 'The Quay', description: 'A net dries beside the boats.'}, rules_profile: 'tempting-fates-rules/0.1.0'});
 assert.deepEqual(rumor, {id: 'cup_story', speaker_id: 'keeper', text: 'A cup is said to rest at the shrine.', lead_location_id: 'shrine'});
 assert.equal(JSON.stringify([handout, rumor]).includes('PRIVATE_'), false);
 value.locations[0]!.public_description = 'Changed after extraction.'; value.rumors[0]!.text = 'Changed rumor.';
 assert.equal(handout.start.description, 'A net dries beside the boats.'); assert.equal(rumor.text, 'A cup is said to rest at the shrine.');
 handout.start.name = 'Caller copy'; assert.equal(value.locations[0]!.name, 'The Quay');
 for (const id of ['missing', 'constructor', '../cup_story', '', 'cup_story\n']) assert.throws(() => api.getRumorCandidate(value, id), invalid);
 const bad = pack(); bad.variants[0]!.artifact_item_id = null;
 assert.throws(() => api.getPlayerHandout(bad), invalid); assert.throws(() => api.getRumorCandidate(bad, 'cup_story'), invalid);
});

test('seed has literal v1 defaults, exact caller scope, fixed Fate roles and traveler-only expedition', () => {
 const api: CampaignCatalog = catalog(), value = pack(), config = options(), result = api.buildCampaignSeed(value, config);
 assertContract('Genesis', result.genesis); result.profiles.forEach(profile => assertCharacterContract('CharacterProfile', profile));
 assert.deepEqual(Object.keys(result), ['genesis', 'profiles', 'manifest']);
 assert.equal(result.genesis.schema_version, '1.0.0'); assert.equal(result.genesis.ruleset_version, 'tempted-fates/1.0.0'); assert.equal(result.genesis.world_time, 0);
 assert.deepEqual(result.genesis.scope, config.scope); assert.equal(result.genesis.seed, config.privateSeed);
 assert.equal(result.genesis.authority_public_key, publicKey); assert.equal(result.genesis.authority_key_id, 'host_key');
 assert.deepEqual(Object.keys(result.genesis.actors), ['system', 'keeper', 'clotho', 'lachesis', 'atropos', 'visitor_b', 'visitor_a']);
 assert.deepEqual(result.genesis.actors.system, {alive: true, time_balance: 0, age_ticks: 0, fate_role: null, thread: 'present'});
 assert.deepEqual(result.genesis.actors.keeper, {alive: true, time_balance: 1244160000, age_ticks: 622080000, fate_role: null, thread: 'present'});
 assert.deepEqual(result.genesis.actors.visitor_b, {alive: true, time_balance: 1555200000, age_ticks: 777600000, fate_role: null, thread: 'present'});
 assert.deepEqual(result.genesis.parties, {expedition: ['visitor_b', 'visitor_a']});
 assert.deepEqual(['clotho', 'lachesis', 'atropos'].map(id => result.genesis.actors[id]!.fate_role), ['clotho', 'lachesis', 'atropos']);
 assert.deepEqual(result.profiles.map(profile => profile.actor_id), ['keeper', 'clotho', 'lachesis', 'atropos', 'visitor_b', 'visitor_a']);
 assert.deepEqual(result.profiles[0], {actor_id: 'keeper', revision: 1, nature: {description: 'Practical and patient.', priorities: ['Finish repairs', 'Keep promises']}, activity: {description: 'Mending a net.', busy_until: 30}, speech_policy: {max_characters: 80, minimum_interval: 10}});
 assert.deepEqual(result.profiles[4], {actor_id: 'visitor_b', revision: 1, nature: {description: 'Curious.', priorities: ['Learn']}, activity: {description: 'Following their own course.', busy_until: 0}, speech_policy: {max_characters: 2048, minimum_interval: 0}});
 assert.equal(JSON.stringify(result).includes('PRIVATE_'), false); assert.equal(JSON.stringify(result).includes('Name keeper'), false);
});

test('one roster produces explicit stable genuine, counterfeit and legend item selections', () => {
 const api: CampaignCatalog = catalog(), value = pack();
 const genuine = api.buildCampaignSeed(value, options('genuine'));
 const counterfeit = api.buildCampaignSeed(value, options('counterfeit'));
 const legend = api.buildCampaignSeed(value, options('legend'));
 assert.deepEqual(genuine.genesis.items, {rope: {custodian_id: 'keeper', destroyed: false}, true_cup: {custodian_id: null, destroyed: false}});
 assert.deepEqual(counterfeit.genesis.items, {rope: {custodian_id: 'keeper', destroyed: false}, fake_cup: {custodian_id: 'keeper', destroyed: false}});
 assert.deepEqual(legend.genesis.items, {rope: {custodian_id: 'keeper', destroyed: false}});
 assert.deepEqual(genuine.genesis.actors, counterfeit.genesis.actors); assert.deepEqual(legend.profiles, genuine.profiles);
 for (const variant of ['genuine', 'counterfeit', 'legend'] as const) assert.deepEqual(api.buildCampaignSeed(value, options(variant)), api.buildCampaignSeed(structuredClone(value), options(variant)));
 const digest = createHash('sha256').update(canonical(value)).digest('hex');
 assert.deepEqual(genuine.manifest, {pack_version: 'tempting-fates-pack/0.1.0', pack_hash: digest, variant: 'genuine'});
 assert.equal(genuine.manifest.pack_hash, legend.manifest.pack_hash);
 assert.equal(genuine.manifest.pack_hash === createHash('sha256').update(JSON.stringify(value, null, 2)).digest('hex'), false);
 assert.equal(Object.hasOwn(genuine.manifest, 'privateSeed'), false);
});

test('seed options reject unknown fields, invalid exact scope, seed, public key and unsupported variants', () => {
 const api: CampaignCatalog = catalog(), otherKey = generateKeyPairSync('ec', {namedCurve: 'prime256v1'}).publicKey.export({format: 'pem', type: 'spki'}).toString();
 for (const change of [
  (o: any) => {o.authorize = true;}, (o: any) => {delete o.variant;}, (o: any) => {o.variant = 'random';},
  (o: any) => {o.privateSeed = '4F'.repeat(32);}, (o: any) => {o.privateSeed = '4f'.repeat(31);},
  (o: any) => {o.scope.workspace_tenant_id = 'public:open_license:default';},
  (o: any) => {o.scope.rights_lane = 'everyone';}, (o: any) => {delete o.scope.branch_id;},
  (o: any) => {o.scope.unscoped = true;}, (o: any) => {o.authorityKeyId = 'constructor';},
  (o: any) => {o.authorityPublicKey = privateKey;}, (o: any) => {o.authorityPublicKey = publicKey + privateKey;},
  (o: any) => {o.authorityPublicKey = otherKey;}, (o: any) => {o.authorityPublicKey = 'not a key';},
 ]) {const o = options(); change(o); const before = structuredClone(o); assert.throws(() => api.buildCampaignSeed(pack(), o), invalid); assert.deepEqual(o, before);}
});

test('travelers are bounded safe unique mortal identities with campaign-valid nature', () => {
 const api: CampaignCatalog = catalog();
 for (const change of [
  (o: CampaignSeedOptions) => {o.travelers = [];},
  (o: CampaignSeedOptions) => {o.travelers = Array.from({length: 7}, (_, i) => ({...o.travelers[0]!, actor_id: `traveler_${i}`}));},
  (o: CampaignSeedOptions) => {o.travelers[1]!.actor_id = 'visitor_b';},
  ...['system', 'expedition', 'keeper', 'clotho', 'rope', 'true_cup', 'fake_cup', 'prototype', '../actor'].map(id => (o: CampaignSeedOptions) => {o.travelers[0]!.actor_id = id;}),
  (o: CampaignSeedOptions) => {o.travelers[0]!.name = '';},
  (o: CampaignSeedOptions) => {o.travelers[0]!.name = '𐀀'.repeat(257);},
  (o: CampaignSeedOptions) => {o.travelers[0]!.nature.priorities = [];},
  (o: any) => {o.travelers[0].fate_role = 'atropos';},
 ]) {const o = options(); change(o); assert.throws(() => api.buildCampaignSeed(pack(), o), invalid);}
 const six = options(); six.travelers = Array.from({length: 6}, (_, i) => ({actor_id: `t_${i}`, name: `Traveler ${i}`, nature: {description: 'Restless.', priorities: ['Travel']}}));
 assert.equal(api.buildCampaignSeed(pack(), six).genesis.parties.expedition!.length, 6);
});

test('ASCII identifiers and private seed reject trailing line terminators without normalization', () => {
 const api: CampaignCatalog = catalog();
 const value = pack(); value.factions[0]!.id += '\n';
 assert.throws(() => api.assertCampaignPack(value), invalid);
 for (const change of [
  (o: CampaignSeedOptions) => {o.privateSeed += '\n';},
  (o: CampaignSeedOptions) => {o.authorityKeyId += '\n';},
  (o: CampaignSeedOptions) => {o.travelers[0]!.actor_id += '\n';},
  (o: CampaignSeedOptions) => {o.scope.world_id += '\n';},
 ]) {const o = options(); change(o); assert.throws(() => api.buildCampaignSeed(pack(), o), invalid);}
});

test('seed construction detaches nested inputs and never adds runtime knowledge, effects or display metadata', () => {
 const api: CampaignCatalog = catalog(), value = pack(), o = options(), packBefore = structuredClone(value), optionsBefore = structuredClone(o);
 const result = api.buildCampaignSeed(value, o);
 assert.deepEqual(value, packBefore); assert.deepEqual(o, optionsBefore);
 value.npcs[0]!.nature.priorities[0] = 'Input changed'; o.scope.world_id = 'other'; o.travelers[0]!.nature.description = 'Input changed';
 assert.equal(result.profiles[0]!.nature.priorities[0], 'Finish repairs'); assert.equal(result.genesis.scope.world_id, 'world_9'); assert.equal(result.profiles[4]!.nature.description, 'Curious.');
 result.profiles[1]!.activity.description = 'Output changed'; result.genesis.parties.expedition!.push('local_copy');
 assert.equal(value.npcs[1]!.activity.description, 'Mending a net.'); assert.equal(o.travelers.length, 2);
 assert.deepEqual(Object.keys(result.genesis).sort(), ['actors', 'authority_key_id', 'authority_public_key', 'items', 'parties', 'ruleset_version', 'schema_version', 'scope', 'seed', 'world_time']);
});

test('campaign construction leaves the existing causal and character schema freezes unchanged', () => {
 const api: CampaignCatalog = catalog();
 const files = ['SYSTEMS/argo-v1.schema.json', 'SYSTEMS/CONTRACT_FREEZE.json', 'SYSTEMS/characters-v1/characters.schema.json', 'SYSTEMS/characters-v1/FREEZE.json'];
 const before = files.map(path => readFileSync(new URL('../' + path, import.meta.url)));
 api.buildCampaignSeed(pack(), options());
 files.forEach((path, index) => assert.deepEqual(readFileSync(new URL('../' + path, import.meta.url)), before[index]));
});
