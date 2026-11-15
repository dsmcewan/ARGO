import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync, sign} from 'node:crypto';
import {ArgoError, canonical, hash, assertMortalContract} from '../packages/contracts/src/index.ts';
import type {MortalEvent, MortalReceipt, MortalReceiptTrust, MortalState} from '../packages/contracts/src/mortal-types.ts';
import {mortalGenesis, mortalPrincipal, mortalCommand, keys} from './mortal-fixtures.ts';

const moduleUrl = new URL('../packages/ledger/src/mortal/journal.ts', import.meta.url).href;
const candidate = await import(moduleUrl).catch((error: unknown) => {
 if ((error as NodeJS.ErrnoException).code === 'ERR_MODULE_NOT_FOUND') return {};
 throw error;
});
async function api() {
 for (const name of ['createMortalEvent', 'verifyMortalEvent', 'replayMortal', 'verifyMortalReceipt']) assert.equal(typeof candidate[name], 'function', `missing ${name}`);
 return candidate as typeof import('../packages/ledger/src/mortal/journal.ts');
}
const rejected = (error: unknown) => error instanceof ArgoError;
function resign(event: MortalEvent): MortalEvent {
 const {signature: _signature, hash: _hash, ...body} = event;
 const signed = {...body, signature: sign(null, Buffer.from(canonical(body)), keys.privateKey).toString('base64')};
 return {...signed, hash: hash(signed)};
}

test('journal binds complete genesis and derives signed replay and receipt from one admitted action', async () => {
 const j = await api(), g = mortalGenesis(), s = j.replayMortal(g, []), p = mortalPrincipal(g), c = mortalCommand(s, {type: 'wait', turns: 1});
 const before = structuredClone({g, s, p, c}), result = j.createMortalEvent(g, s, c, p, keys.privateKey);
 assert.deepEqual({g, s, p, c}, before);
 assert.equal(s.head, hash(g)); assert.equal(result.event.previous_hash, hash(g));
 assert.equal(result.event.genesis_hash, hash(g)); assert.equal(result.state.head, result.event.hash);
 assert.equal(result.state.sequence, 1); assert.equal(result.state.world_time, 600);
 assert.equal(result.state.actors[0]!.resources.rations, 1); assert.equal(result.state.actors[0]!.resources.water, 1);
 assert.equal(result.receipt.request_hash, hash({command: c, principal: p}));
 assert.equal(result.receipt.cursor.head, result.event.hash); assert.equal(result.receipt.genesis_hash, hash(g));
 assert.deepEqual(j.verifyMortalEvent(g, s, result.event), result.state);
 assert.deepEqual(j.replayMortal(g, [result.event]), result.state);
 const trust: MortalReceiptTrust = {scope: g.scope, genesis_hash: hash(g), authority_key_id: g.authority_key_id, authority_public_key: g.authority_public_key};
 j.verifyMortalReceipt(result.receipt, trust);
 assertMortalContract('Event', result.event); assertMortalContract('Receipt', result.receipt);
 result.event.command.action = {type: 'rest'}; result.state.actors[0]!.name = 'Changed'; result.receipt.effects[0] && (result.receipt.effects[0].kind = 'Changed');
 assert.deepEqual({g, s, p, c}, before);
});

test('journal replay checks each physical transition and every draw even when a mutated event is re-signed', async () => {
 const j = await api(), g = mortalGenesis(), s = j.replayMortal(g, []);
 const encounter = j.createMortalEvent(g, s, mortalCommand(s, {type: 'begin_encounter', encounter_id: 'fight', side_a: ['hero'], side_b: ['raider'], escape_allowed: true}, 'host'), mortalPrincipal(g, 'host'), keys.privateKey);
 assert.equal(encounter.event.draws.length, 1); assert.equal(encounter.event.draws[0]!.sides, 6);
 for (const mutate of [
  (e: MortalEvent) => {e.before_hash = '1'.repeat(64);},
  (e: MortalEvent) => {e.after_hash = '2'.repeat(64);},
  (e: MortalEvent) => {e.draws[0]!.value = e.draws[0]!.value === 1 ? 2 : 1;},
  (e: MortalEvent) => {e.draws[0]!.purpose = 'caller_controlled';},
  (e: MortalEvent) => {e.effects.push({kind: 'invented_reward', actor_id: 'hero', subject_id: null, amount: 5});},
  (e: MortalEvent) => {e.principal.principal_id = 'impostor';},
 ]) {const e = structuredClone(encounter.event); mutate(e); assert.throws(() => j.verifyMortalEvent(g, s, resign(e)), rejected);}
});

test('genesis metadata, key, seed and variant changes cannot inherit another signed history', async () => {
 const j = await api(), g = mortalGenesis(), s = j.replayMortal(g, []), event = j.createMortalEvent(g, s, mortalCommand(s, {type: 'wait', turns: 1}), mortalPrincipal(g), keys.privateKey).event;
 for (const change of [
  (value: typeof g) => {value.variant = 'genuine';}, (value: typeof g) => {value.seed = '01'.repeat(32);},
  (value: typeof g) => {value.pack_hash = '02'.repeat(32);}, (value: typeof g) => {value.scope.branch_id = 'other';},
  (value: typeof g) => {value.actors[0]!.name = 'Another name';}, (value: typeof g) => {value.authority_key_id = 'another_key';},
 ]) {const altered = structuredClone(g); change(altered); assert.throws(() => j.replayMortal(altered, [event]), rejected);}
 const wrong = generateKeyPairSync('ed25519');
 assert.throws(() => j.createMortalEvent(g, s, mortalCommand(s, {type: 'wait', turns: 1}), mortalPrincipal(g), wrong.privateKey), rejected);
});

test('whole replay rejects duplicate request IDs that pass isolated event verification', async () => {
 const j = await api(), g = mortalGenesis(), s = j.replayMortal(g, []);
 const first = j.createMortalEvent(g, s, mortalCommand(s, {type: 'wait', turns: 1}, 'hero', 'same_request'), mortalPrincipal(g), keys.privateKey);
 const second = j.createMortalEvent(g, first.state, mortalCommand(first.state, {type: 'wait', turns: 1}, 'hero', 'same_request'), mortalPrincipal(g), keys.privateKey);
 assert.equal(j.verifyMortalEvent(g, first.state, second.event).sequence, 2);
 assert.throws(() => j.replayMortal(g, [first.event, second.event]), rejected);
 assert.throws(() => j.replayMortal(g, [second.event, first.event]), rejected);
});

test('receipts verify from pinned public trust and refuse every signed identity/content mutation', async () => {
 const j = await api(), g = mortalGenesis(), s = j.replayMortal(g, []);
 const receipt = j.createMortalEvent(g, s, mortalCommand(s, {type: 'wait', turns: 1}), mortalPrincipal(g), keys.privateKey).receipt;
 const trust: MortalReceiptTrust = {scope: g.scope, genesis_hash: hash(g), authority_key_id: g.authority_key_id, authority_public_key: g.authority_public_key};
 j.verifyMortalReceipt(receipt, trust);
 for (const patch of [
  {genesis_hash: '1'.repeat(64)}, {authority_key_id: 'other'}, {request_id: 'other'}, {request_hash: '2'.repeat(64)},
  {state_hash: '3'.repeat(64)}, {scope: {...receipt.scope, world_id: 'elsewhere'}},
  {effects: [{kind: 'invented', actor_id: 'raider', subject_id: null, amount: 9}]},
 ]) assert.throws(() => j.verifyMortalReceipt({...receipt, ...patch}, trust), rejected);
 for (const patch of [{scope: {...trust.scope, branch_id: 'other'}}, {genesis_hash: '4'.repeat(64)}, {authority_key_id: 'other'}, {authority_public_key: keys.privateKey.export({type: 'pkcs8', format: 'pem'}).toString()}]) assert.throws(() => j.verifyMortalReceipt(receipt, {...trust, ...patch}), rejected);
 const other = generateKeyPairSync('ed25519').publicKey.export({type: 'spki', format: 'pem'}).toString();
 assert.throws(() => j.verifyMortalReceipt(receipt, {...trust, authority_public_key: other}), rejected);
});

test('journal DTO guards run before getters/proxies, and caller history is never mutated', async () => {
 const j = await api(), g = mortalGenesis(), s = j.replayMortal(g, []); let touched = 0;
 const c = mortalCommand(s, {type: 'wait', turns: 1});
 Object.defineProperty(c, 'action', {enumerable: true, get: () => {touched++; return {type: 'wait', turns: 1};}});
 assert.throws(() => j.createMortalEvent(g, s, c, mortalPrincipal(g), keys.privateKey), rejected);
 const trust = new Proxy({}, {ownKeys() {touched++; return [];}}) as MortalReceiptTrust;
 const result = j.createMortalEvent(g, s, mortalCommand(s, {type: 'wait', turns: 1}), mortalPrincipal(g), keys.privateKey);
 assert.throws(() => j.verifyMortalReceipt(result.receipt, trust), rejected);
 const proxied = new Proxy([result.event], {get() {touched++; return undefined;}});
 assert.throws(() => j.replayMortal(g, proxied), rejected);
 const sparse = new Array<MortalEvent>(2); sparse[1] = result.event;
 assert.throws(() => j.replayMortal(g, sparse), rejected);
 const bad = structuredClone(result.receipt); Object.defineProperty(bad, 'signature', {enumerable: true, get: () => {touched++; return result.receipt.signature;}});
 assert.throws(() => j.verifyMortalReceipt(bad, {scope: g.scope, genesis_hash: hash(g), authority_key_id: g.authority_key_id, authority_public_key: g.authority_public_key}), rejected);
 assert.equal(touched, 0);
});
