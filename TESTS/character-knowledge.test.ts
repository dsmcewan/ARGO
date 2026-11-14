import test from 'node:test';
import assert from 'node:assert/strict';
import {assertCharacterContract, ArgoError} from '../packages/contracts/src/index.ts';
import type {CharacterActorQuery, CharacterNarratorQuery, CharacterProjection, CharacterMemoryRecord, CharacterImpression} from '../packages/contracts/src/index.ts';
import {createCharacterViews as factory} from '../packages/lexi-bridge/src/characters.ts';
import {CHARACTER_VERSION, characterScope, characterPrincipal, characterProfile} from './character-fixtures.ts';

const digest = (n: number) => n.toString(16).padStart(64, '0');
function record(sequence: number, actor_id: string, text: string, witnesses: Array<[string, number, string | null]> = []): CharacterMemoryRecord {
 return {experience: {record_id: digest(sequence), kind: 'speech', actor_id, principal_actor_id: actor_id, sequence, world_time: 10, text, action_type: null, addressed_actor_ids: []}, acquisitions: [{actor_id, sequence, world_time: 10, party_id: null}, ...witnesses.map(([actor_id, sequence, party_id]) => ({actor_id, sequence, world_time: 10, party_id}))]};
}
function impression(sequence: number, owner: string, subject: string, text: string, previous: number | null = null): CharacterImpression {
 return {impression_id: digest(sequence + 1000), sequence, world_time: 10, data: {owner_actor_id: owner, subject_actor_id: subject, evidence_ids: [digest(subject === 'merchant' ? 9 : 3)], nature_revision: previous === null ? 1 : 2, nature: characterProfile(owner).nature, interpretation: text, previous_impression_id: previous === null ? null : digest(previous + 1000)}};
}
function projection(): CharacterProjection {
 const p: CharacterProjection = {
  version: CHARACTER_VERSION, scope: characterScope(), cursor: {sequence: 20, head: digest(20), world_time: 20}, activation_sequence: 1,
  profiles: [characterProfile('traveler'), {...characterProfile('witness'), revision: 2}, characterProfile('merchant')],
  actors: ['traveler', 'witness', 'merchant', 'stranger'].map(actor_id => ({actor_id, alive: true})),
  parties: [{party_id: 'party', actor_ids: ['traveler', 'witness', 'merchant']}, {party_id: 'other_party', actor_ids: ['traveler', 'witness']}],
  records: [
   record(2, 'traveler', 'PRIVATE_SOLO'),
   record(3, 'traveler', 'PARTY_OLD', [['witness', 7, 'party'], ['merchant', 3, 'party']]),
   record(4, 'traveler', 'WITNESS_ONLY', [['witness', 4, null]]),
   record(5, 'witness', 'WORK_REPLY'),
   record(6, 'traveler', 'PARTY_VISIBLE', [['witness', 6, 'party']]),
   record(8, 'traveler', 'OTHER_PARTY', [['witness', 8, 'other_party']]),
   record(9, 'merchant', 'MERCHANT_WORDS', [['witness', 9, null]]),
   record(10, 'traveler', 'PARTY_VISIBLE_TWO', [['witness', 10, 'party']]),
  ],
  impressions: [impression(11, 'witness', 'traveler', 'They kept their promise.'), impression(12, 'merchant', 'traveler', 'They are dangerous.'), impression(13, 'witness', 'traveler', 'I am less sure now.', 11), impression(14, 'witness', 'merchant', 'The merchant is cautious.')],
  ontology_blocked: false, engagement_closed: false,
 };
 assertCharacterContract('CharacterProjection', p);
 return p;
}
function actorQuery(p: CharacterProjection, actor_id = 'witness'): CharacterActorQuery {
 return {version: CHARACTER_VERSION, scope: structuredClone(p.scope), cursor: structuredClone(p.cursor), actor_id};
}
function narratorQuery(p: CharacterProjection, party = false): CharacterNarratorQuery {
 return {...actorQuery(p, party ? 'witness' : 'traveler'), traveler_id: 'traveler', audience: party ? 'party' : 'actor', party_id: party ? 'party' : null, after_sequence: 0, limit: 32};
}
const reads = (p: CharacterProjection) => factory({scope: characterScope(), readProjection: async () => p});
const code = (expected: string) => (error: unknown) => error instanceof ArgoError && error.code === expected;
const texts = (rows: Array<{text: string}>) => rows.map(row => row.text);
function deferred<T>() {
 let resolve!: (value: T) => void;
 const promise = new Promise<T>(done => {resolve = done;});
 return {promise, resolve};
}

test('character readers return only the owner profile and latest private impression per subject', async () => {
 const p = projection(), view = await reads(p).actor(actorQuery(p), characterPrincipal('witness'));
 assert.equal(view.profile?.actor_id, 'witness');
 assert.equal(view.profile?.revision, 2);
 assert.equal(view.last_spoke_at, 10, 'configuration does not reset speech history');
 assert.deepEqual(view.impressions.map(row => [row.data.subject_actor_id, row.data.interpretation]), [['merchant', 'The merchant is cautious.'], ['traveler', 'I am less sure now.']]);
 assert.deepEqual(texts(view.experiences), ['PARTY_OLD', 'WITNESS_ONLY', 'WORK_REPLY', 'PARTY_VISIBLE', 'OTHER_PARTY', 'MERCHANT_WORDS', 'PARTY_VISIBLE_TWO']);
 const subject = await reads(p).actor(actorQuery(p, 'traveler'), characterPrincipal());
 assert.deepEqual(subject.impressions, [], 'being the subject does not disclose an impression');
 const stranger = await reads(p).actor(actorQuery(p, 'stranger'), characterPrincipal('stranger'));
 assert.deepEqual(stranger.experiences, []);
 assert.equal(stranger.profile, null);
 assert.equal(JSON.stringify(view).includes('acquisitions'), false);
 assert.equal(JSON.stringify(view).includes('They are dangerous.'), false);
});

test('private narrator archive contains the traveler record without other actor speech or private impressions', async () => {
 const p = projection(), view = await reads(p).narrator(narratorQuery(p), characterPrincipal());
 assert.deepEqual(texts(view.records), ['PRIVATE_SOLO', 'PARTY_OLD', 'WITNESS_ONLY', 'PARTY_VISIBLE', 'OTHER_PARTY', 'PARTY_VISIBLE_TWO']);
 assert.deepEqual(view.coverage, {activation_sequence: 1, through_sequence: 20, captured_kinds: ['speech', 'action']});
 assert.equal(view.next_after_sequence, null);
 assert.deepEqual(Object.keys(view).sort(), ['coverage', 'engagement_closed', 'next_after_sequence', 'ontology_blocked', 'query', 'records']);
 assert.equal(JSON.stringify(view).includes('acquisitions'), false);
 assert.equal(JSON.stringify(view).includes('impressions'), false);
});

test('party narrator requires viewer acquisition in that party, filters before pagination, and reveals no hidden totals', async () => {
 const p = projection(), client = reads(p), q = {...narratorQuery(p, true), limit: 1};
 const first = await client.narrator(q, characterPrincipal('witness'));
 assert.deepEqual(texts(first.records), ['PARTY_OLD']);
 assert.equal(first.next_after_sequence, 3);
 const second = await client.narrator({...q, after_sequence: first.next_after_sequence!}, characterPrincipal('witness'));
 assert.deepEqual(texts(second.records), ['PARTY_VISIBLE']);
 assert.equal(second.next_after_sequence, 6);
 const third = await client.narrator({...q, after_sequence: second.next_after_sequence!}, characterPrincipal('witness'));
 assert.deepEqual(texts(third.records), ['PARTY_VISIBLE_TWO']);
 assert.equal(third.next_after_sequence, null);
 const after = await client.narrator({...q, after_sequence: 10}, characterPrincipal('witness'));
 assert.deepEqual(after.records, []);
 assert.equal(after.next_after_sequence, null);
 assert.deepEqual(Object.keys(first).sort(), Object.keys(after).sort());
 const all = await client.narrator({...q, limit: 128}, characterPrincipal('witness'));
 assert.deepEqual(texts(all.records), ['PARTY_OLD', 'PARTY_VISIBLE', 'PARTY_VISIBLE_TWO']);
});

test('actor identity and all tenant/rights/world/branch scope fields bind before transport', async () => {
 const p = projection(); let calls = 0;
 const client = factory({scope: characterScope(), readProjection: async () => {calls++; return p;}});
 await assert.rejects(client.actor(actorQuery(p), characterPrincipal()), code('UNAUTHORIZED'));
 for (const key of ['tenant_id', 'rights_lane', 'workspace_id', 'workspace_tenant_id', 'campaign_id', 'world_id', 'branch_id'] as const) {
  const q = actorQuery(p), principal = characterPrincipal('witness');
  if (key === 'rights_lane') q.scope[key] = 'private_upload'; else q.scope[key] = 'other';
  if (['tenant_id', 'rights_lane', 'workspace_id'].includes(key)) q.scope.workspace_tenant_id = `${q.scope.tenant_id}:${q.scope.rights_lane}:${q.scope.workspace_id}`;
  await assert.rejects(client.actor(q, principal), code('SCOPE_DENIED'));
  const auth = characterPrincipal('witness'); auth.scope.world_id = 'elsewhere';
  await assert.rejects(client.actor(actorQuery(p), auth), code('SCOPE_DENIED'));
 }
 assert.equal(calls, 0);
});

test('source scope, current cursor, existing actors, and party membership are enforced', async () => {
 const p = projection();
 for (const change of [{sequence: 19}, {sequence: 21}, {head: digest(21)}, {world_time: 19}, {world_time: 21}]) {
  const q = actorQuery(p); Object.assign(q.cursor, change);
  await assert.rejects(reads(p).actor(q, characterPrincipal('witness')), code('CONFLICT'));
 }
 const wrongScope = projection(); wrongScope.scope.branch_id = 'another';
 await assert.rejects(reads(wrongScope).actor(actorQuery(p), characterPrincipal('witness')), code('SCOPE_DENIED'));
 await assert.rejects(reads(p).actor(actorQuery(p, 'missing'), characterPrincipal('missing')), code('UNAUTHORIZED'));
 await assert.rejects(reads(p).narrator({...narratorQuery(p, true), traveler_id: 'missing'}, characterPrincipal('witness')), code('UNAUTHORIZED'));
 for (const removed of ['traveler', 'witness']) {
  const changed = projection(); changed.parties[0]!.actor_ids = changed.parties[0]!.actor_ids.filter(actor => actor !== removed);
  await assert.rejects(reads(changed).narrator(narratorQuery(changed, true), characterPrincipal('witness')), code('UNAUTHORIZED'));
 }
 await assert.rejects(reads(p).narrator({...narratorQuery(p, true), party_id: 'absent'}, characterPrincipal('witness')), code('UNAUTHORIZED'));
 await assert.rejects(reads(p).narrator({...narratorQuery(p), actor_id: 'witness'}, characterPrincipal('witness')), code('INVALID_CONTRACT'));
});

test('same-tick acquisition never backdates knowledge to an earlier ledger prefix', async () => {
 const before = projection();
 before.cursor = {sequence: 6, head: digest(6), world_time: 10};
 before.records = before.records.filter(row => row.experience.sequence <= 6).map(row => ({...row, acquisitions: row.acquisitions.filter(a => a.sequence <= 6)}));
 before.impressions = [];
 const prior = await reads(before).narrator(narratorQuery(before, true), characterPrincipal('witness'));
 assert.deepEqual(texts(prior.records), ['PARTY_VISIBLE']);
 const after = structuredClone(before); after.cursor = {sequence: 7, head: digest(7), world_time: 10};
 after.records[1]!.acquisitions.push({actor_id: 'witness', sequence: 7, world_time: 10, party_id: 'party'});
 const current = await reads(after).narrator(narratorQuery(after, true), characterPrincipal('witness'));
 assert.deepEqual(texts(current.records), ['PARTY_OLD', 'PARTY_VISIBLE']);
 await assert.rejects(reads(after).narrator(narratorQuery(before, true), characterPrincipal('witness')), code('CONFLICT'));
});

test('actor context keeps latest 16 first acquisitions; repeated grants do not refresh memory', async () => {
 const p = projection(); p.cursor = {sequence: 60, head: digest(60), world_time: 20}; p.impressions = [];
 p.records = Array.from({length: 21}, (_, i) => record(i + 2, 'traveler', `record_${i + 2}`, [['witness', i + 2 === 2 ? 40 : i + 2, null]]));
 p.records[1]!.acquisitions.push({actor_id: 'witness', sequence: 50, world_time: 10, party_id: 'party'});
 const view = await reads(p).actor(actorQuery(p), characterPrincipal('witness'));
 // Acquisition recency selects a newly learned old source; emission retains
 // increasing source sequence. A second disclosure is not a new perception.
 assert.deepEqual(view.experiences.map(row => row.sequence), [2, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22]);
 assert.equal(view.experiences.length, 16);
});

test('private impressions have no silent subject-count cap', async () => {
 const p = projection(); p.cursor = {sequence: 200, head: digest(200), world_time: 20}; p.impressions = [];
 for (let i = 0; i < 140; i++) {
  const subject = `subject_${i}`; p.actors.push({actor_id: subject, alive: true});
  p.impressions.push(impression(30 + i, 'witness', subject, `Impression of ${subject}`));
 }
 const view = await reads(p).actor(actorQuery(p), characterPrincipal('witness'));
 assert.equal(view.impressions.length, 140);
 assert.equal(new Set(view.impressions.map(row => row.data.subject_actor_id)).size, 140);
});

test('current ontology and engagement cutoffs suppress every narrator page and carry through actor views', async () => {
 for (const closed of [false, true]) {
  const p = projection(); p.ontology_blocked = true; p.engagement_closed = closed;
  for (const party of [false, true]) {
   const view = await reads(p).narrator(narratorQuery(p, party), characterPrincipal(party ? 'witness' : 'traveler'));
   assert.deepEqual(view.records, []); assert.equal(view.next_after_sequence, null);
   assert.equal(view.ontology_blocked, true); assert.equal(view.engagement_closed, closed);
  }
  const actor = await reads(p).actor(actorQuery(p), characterPrincipal('witness'));
  assert.equal(actor.ontology_blocked, true); assert.equal(actor.engagement_closed, closed);
 }
});

test('empty unconfigured source returns explicit absence, not fabricated character state', async () => {
 const p = projection(); p.cursor = {sequence: 0, head: null, world_time: 0}; p.activation_sequence = null;
 p.profiles = []; p.records = []; p.impressions = [];
 const actor = await reads(p).actor(actorQuery(p), characterPrincipal('witness'));
 assert.equal(actor.profile, null); assert.equal(actor.last_spoke_at, null);
 assert.deepEqual(actor.experiences, []); assert.deepEqual(actor.impressions, []);
 const narrator = await reads(p).narrator(narratorQuery(p), characterPrincipal());
 assert.deepEqual(narrator.records, []);
 assert.deepEqual(narrator.coverage, {activation_sequence: null, through_sequence: 0, captured_kinds: ['speech', 'action']});
});

test('query, principal, factory configuration, and output remain detached across await boundaries', async () => {
 const p = projection(), wait = deferred<CharacterProjection>(), scope = characterScope();
 const options = {scope, readProjection: async () => wait.promise};
 const client = factory(options), q = narratorQuery(p, true), principal = characterPrincipal('witness');
 const pending = client.narrator(q, principal);
 q.actor_id = 'traveler'; q.audience = 'actor'; q.party_id = null; q.scope.world_id = 'changed';
 principal.actor_id = 'traveler'; principal.scope.world_id = 'changed';
 scope.world_id = 'changed'; options.readProjection = async () => {throw new Error('must retain original reader');};
 wait.resolve(p);
 const view = await pending;
 assert.deepEqual(texts(view.records), ['PARTY_OLD', 'PARTY_VISIBLE', 'PARTY_VISIBLE_TWO']);
 assert.equal(view.query.actor_id, 'witness'); assert.equal(view.query.scope.world_id, 'world');
 p.records[1]!.experience.text = 'altered after return';
 assert.equal(view.records[0]!.text, 'PARTY_OLD');
 assert.equal(Object.isFrozen(view), true); assert.equal(Object.isFrozen(view.records), true); assert.equal(Object.isFrozen(view.query.scope), true);
 assert.throws(() => {view.records[0]!.text = 'tamper';}, TypeError);
 assert.equal(Object.isFrozen(p), false, 'never freeze trusted source aliases');
});

test('actor output owns detached nested profiles and impressions', async () => {
 const p = projection(), view = await reads(p).actor(actorQuery(p), characterPrincipal('witness'));
 p.profiles[1]!.nature.description = 'altered source';
 p.impressions[2]!.data.interpretation = 'altered source';
 assert.equal(view.profile?.nature.description, 'A practical keeper of the workshop.');
 assert.equal(view.impressions.find(row => row.data.subject_actor_id === 'traveler')!.data.interpretation, 'I am less sure now.');
 assert.equal(Object.isFrozen(view.impressions[0]!.data.nature.priorities), true);
 assert.throws(() => {view.profile!.activity.busy_until = 1000;}, TypeError);
});

test('passive guards reject active query/principal/source DTOs and validate the entire projection', async () => {
 const p = projection(); let touched = 0, called = 0;
 const client = factory({scope: characterScope(), readProjection: async () => {called++; return p;}});
 const q = actorQuery(p); Object.defineProperty(q, 'actor_id', {get: () => {touched++; return 'witness';}, enumerable: true});
 await assert.rejects(client.actor(q, characterPrincipal('witness')), code('INVALID_CONTRACT'));
 const auth = characterPrincipal('witness'); Object.defineProperty(auth, 'role', {get: () => {touched++; return 'player';}, enumerable: true});
 await assert.rejects(client.actor(actorQuery(p), auth), code('INVALID_CONTRACT'));
 const proxied = new Proxy(characterPrincipal('witness'), {get: () => {touched++; return undefined;}});
 await assert.rejects(client.actor(actorQuery(p), proxied), code('INVALID_CONTRACT'));
 assert.equal(called, 0); assert.equal(touched, 0);
 const active = projection(); Object.defineProperty(active.records[0]!.experience, 'text', {get: () => {touched++; return 'SECRET';}, enumerable: true});
 await assert.rejects(reads(active).actor(actorQuery(p), characterPrincipal('witness')), code('INVALID_CONTRACT'));
 assert.equal(touched, 0);
 const invalid = projection(); invalid.records[0]!.acquisitions[0]!.sequence = 99;
 await assert.rejects(reads(invalid).actor(actorQuery(p), characterPrincipal('stranger')), error => code('UNAUTHORIZED')(error));
 await assert.rejects(reads(invalid).actor(actorQuery(p), characterPrincipal('witness')), code('INVALID_CONTRACT'));
});

test('bounded read transport supports cancellation without accepting a late projection', async () => {
 const p = projection(), wait = deferred<CharacterProjection>(), invoked = deferred<AbortSignal>();
 const client = factory({scope: characterScope(), readProjection: async ({signal}) => {invoked.resolve(signal); return wait.promise;}, timeoutMs: 1000});
 const controller = new AbortController(), pending = client.actor(actorQuery(p), characterPrincipal('witness'), {signal: controller.signal});
 const signal = await invoked.promise; controller.abort();
 await assert.rejects(pending, code('CANCELLED')); assert.equal(signal.aborted, true); wait.resolve(p);
 let timedSignal: AbortSignal | undefined;
 const timeout = factory({scope: characterScope(), timeoutMs: 10, readProjection: async ({signal}) => {timedSignal = signal; return new Promise(() => {});}});
 await assert.rejects(timeout.actor(actorQuery(p), characterPrincipal('witness')), code('UNAVAILABLE'));
 assert.equal(timedSignal?.aborted, true);
 let calls = 0;
 const cancelled = factory({scope: characterScope(), readProjection: async () => {calls++; return p;}});
 await assert.rejects(cancelled.actor(actorQuery(p), characterPrincipal('witness'), {signal: AbortSignal.abort()}), code('CANCELLED'));
 assert.equal(calls, 0);
});
