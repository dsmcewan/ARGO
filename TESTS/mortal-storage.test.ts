import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, readFile, readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Worker} from 'node:worker_threads';
import {DatabaseSync} from 'node:sqlite';
import {ArgoError, canonical, hash} from '../packages/contracts/src/index.ts';
import type {MortalLedger} from '../packages/contracts/src/mortal-types.ts';
import {mortalGenesis, mortalPrincipal, mortalCommand, keys} from './mortal-fixtures.ts';

const candidate = await import(new URL('../packages/ledger/src/mortal/storage.ts', import.meta.url).href).catch((error: unknown) => {
 if ((error as NodeJS.ErrnoException).code === 'ERR_MODULE_NOT_FOUND') return {};
 throw error;
});
async function factory() {
 assert.equal(typeof candidate.openMortalLedger, 'function', 'missing openMortalLedger');
 return candidate.openMortalLedger as typeof import('../packages/ledger/src/mortal/storage.ts').openMortalLedger;
}
const code = (expected: string) => (error: unknown) => error instanceof ArgoError && error.code === expected;
async function setup(t: test.TestContext) {
 const open = await factory(), directory = await mkdtemp(join(tmpdir(), 'argo-mortal-storage-')), path = join(directory, 'world.sqlite'), genesis = mortalGenesis();
 const handles: MortalLedger[] = [];
 t.after(async () => {await Promise.all(handles.map(handle => handle.close().catch(() => {}))); await rm(directory, {recursive: true, force: true});});
 const connect = async () => {const handle = await open({path, genesis, privateKey: keys.privateKey}); handles.push(handle); return handle;};
 return {open, directory, path, genesis, handles, connect};
}

test('SQLite commits replayable state and idempotency together, reopens, and pages host history', async t => {
 const f = await setup(t), l = await f.connect(), p = mortalPrincipal(f.genesis), s = await l.snapshot();
 assert.equal(s.head, hash(f.genesis)); assert.deepEqual(await l.events(), []);
 const command = mortalCommand(s, {type: 'wait', turns: 1}), receipt = await l.submit(command, p);
 assert.deepEqual(await l.submit(command, p), receipt); assert.equal((await l.snapshot()).sequence, 1);
 const secondState = await l.snapshot(); await l.submit(mortalCommand(secondState, {type: 'wait', turns: 1}), p);
 assert.deepEqual((await l.events({after: 0, limit: 1})).map(e => e.sequence), [1]);
 assert.deepEqual((await l.events({after: 1, limit: 1})).map(e => e.sequence), [2]);
 assert.deepEqual(await l.events({after: 2, limit: 1000}), []);
 const last = await l.snapshot(); await l.close();
 const reopened = await f.connect(); assert.deepEqual(await reopened.snapshot(), last); assert.deepEqual(await reopened.submit(command, p), receipt);
 const j = await import('../packages/ledger/src/mortal/journal.ts');
 assert.deepEqual(j.replayMortal(f.genesis, await reopened.events()), last);
 const db = new DatabaseSync(f.path); t.after(() => db.close());
 assert.equal(db.prepare('PRAGMA journal_mode').get()!.journal_mode, 'wal');
 assert.equal(db.prepare('SELECT count(*) AS total FROM mortal_events').get()!.total, 2);
});

test('concurrent handles serialize conflicting actions and duplicate retry never spends twice', async t => {
 const f = await setup(t), a = await f.connect(), b = await f.connect(), s = await a.snapshot(), p = mortalPrincipal(f.genesis);
 const command = mortalCommand(s, {type: 'wait', turns: 1}, 'hero', 'same');
 const receipts = await Promise.all([a.submit(command, p), b.submit(command, p)]);
 assert.deepEqual(receipts[0], receipts[1]); assert.equal((await b.snapshot()).world_time, 600);
 const next = await a.snapshot();
 const outcomes = await Promise.allSettled([a.submit(mortalCommand(next, {type: 'wait', turns: 1}, 'hero', 'left'), p), b.submit(mortalCommand(next, {type: 'wait', turns: 1}, 'hero', 'right'), p)]);
 assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
 assert.equal(outcomes.filter(result => result.status === 'rejected' && code('CONFLICT')(result.reason)).length, 1);
 assert.equal((await a.snapshot()).sequence, 2); assert.deepEqual(await a.snapshot(), await b.snapshot());
 await assert.rejects(a.submit({...command, action: {type: 'wait', turns: 2}}, p), code('CONFLICT'));
 await assert.rejects(a.submit(command, {...p, principal_id: 'impostor'}), code('CONFLICT'));
});

test('rejected command has no event/index/RNG effect and input mutation cannot alter queued work', async t => {
 const f = await setup(t), l = await f.connect(), initial = await l.snapshot(), p = mortalPrincipal(f.genesis);
 await assert.rejects(l.submit(mortalCommand(initial, {type: 'pickup', item_id: 'spear'}), p));
 assert.deepEqual(await l.snapshot(), initial); assert.deepEqual(await l.events(), []);
 const command = mortalCommand(initial, {type: 'wait', turns: 1}); const pending = l.submit(command, p);
 command.action = {type: 'wait', turns: 24}; p.principal_id = 'changed_after_call';
 await pending; assert.equal((await l.snapshot()).world_time, 600);
 const view = await l.snapshot(); view.actors[0]!.hp = -5;
 assert.equal((await l.snapshot()).actors[0]!.hp, 6);
});

test('external trusted prefix detects rollback and divergent/mismatched genesis at reopen', async t => {
 const f = await setup(t), l = await f.connect(), s = await l.snapshot();
 const receipt = await l.submit(mortalCommand(s, {type: 'wait', turns: 1}), mortalPrincipal(f.genesis)); await l.close();
 const good = await f.open({path: f.path, genesis: f.genesis, privateKey: keys.privateKey, expectedHead: receipt.cursor}); f.handles.push(good); await good.close();
 await assert.rejects(f.open({path: f.path, genesis: f.genesis, privateKey: keys.privateKey, expectedHead: {...receipt.cursor, head: '1'.repeat(64)}}), code('CORRUPT_LEDGER'));
 await assert.rejects(f.open({path: f.path, genesis: {...f.genesis, variant: 'genuine'}, privateKey: keys.privateKey}), code('CORRUPT_LEDGER'));
 const db = new DatabaseSync(f.path);
 db.exec('DROP TRIGGER mortal_events_no_delete; DELETE FROM mortal_events;'); db.close();
 await assert.rejects(f.open({path: f.path, genesis: f.genesis, privateKey: keys.privateKey, expectedHead: receipt.cursor}), code('CORRUPT_LEDGER'));
});

test('a worker-held write lock never blocks the parent loop and termination releases the OS lock', async t => {
 const f = await setup(t), l = await f.connect(), initial = await l.snapshot();
 const blocker = new Worker(`const {parentPort,workerData}=require('node:worker_threads');const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(workerData);db.exec('BEGIN IMMEDIATE');parentPort.postMessage('locked');setInterval(()=>{},1000);`, {eval: true, workerData: f.path});
 t.after(async () => {await blocker.terminate();});
 await new Promise<void>((resolve, reject) => {blocker.once('message', () => resolve()); blocker.once('error', reject);});
 let beats = 0; const timer = setInterval(() => beats++, 5);
 const pending = l.submit(mortalCommand(initial, {type: 'wait', turns: 1}), mortalPrincipal(f.genesis));
 await new Promise(resolve => setTimeout(resolve, 100)); clearInterval(timer); assert.ok(beats >= 5, `parent timer ticked ${beats} times`);
 await blocker.terminate(); await pending;
 assert.equal((await l.snapshot()).sequence, 1); assert.equal((await readdir(f.directory)).some(name => name.endsWith('.lock')), false);
});

test('storage refuses corrupt event/index/receipt bytes on reopen and never persists private PEM', async t => {
 const f = await setup(t), l = await f.connect(), initial = await l.snapshot();
 await l.submit(mortalCommand(initial, {type: 'wait', turns: 1}), mortalPrincipal(f.genesis)); await l.close();
 for (const name of await readdir(f.directory)) {
  const bytes = await readFile(join(f.directory, name)); assert.equal(bytes.includes(Buffer.from('PRIVATE KEY')), false);
 }
 const db = new DatabaseSync(f.path); db.exec('DROP TRIGGER mortal_events_no_update; UPDATE mortal_events SET request_hash = lower(hex(zeroblob(32))) WHERE sequence=1;'); db.close();
 await assert.rejects(f.connect(), code('CORRUPT_LEDGER'));
});

test('cached history pages and retries rebind event bytes to their signed receipt hash', async t => {
 const f = await setup(t), l = await f.connect(), initial = await l.snapshot(), p = mortalPrincipal(f.genesis);
 const command = mortalCommand(initial, {type: 'wait', turns: 1});
 await l.submit(command, p); await l.events();
 const db = new DatabaseSync(f.path);
 const row = db.prepare('SELECT event_json FROM mortal_events WHERE sequence=1').get()!;
 const event = JSON.parse(row.event_json as string); event.before_hash = '1'.repeat(64);
 db.exec('DROP TRIGGER mortal_events_no_update;');
 db.prepare('UPDATE mortal_events SET event_json=? WHERE sequence=1').run(canonical(event)); db.close();
 // The cached head, SQL hash column, receipt signature and command remain
 // unchanged. A historical page must still refuse altered event body bytes.
 await assert.rejects(l.events({after: 0, limit: 1}), code('CORRUPT_LEDGER'));
 await assert.rejects(l.submit(command, p), code('CORRUPT_LEDGER'));
});

test('host API rejects active DTOs before cloning, bounds page requests, and closes idempotently', async t => {
 const f = await setup(t), l = await f.connect(), s = await l.snapshot(); let touched = 0;
 const command = mortalCommand(s, {type: 'wait', turns: 1}); Object.defineProperty(command, 'action', {enumerable: true, get: () => {touched++; return {type: 'wait', turns: 1};}});
 await assert.rejects(l.submit(command, mortalPrincipal(f.genesis)), code('INVALID_CONTRACT'));
 const proxy = new Proxy({after: 0, limit: 1}, {get() {touched++; return 0;}});
 await assert.rejects(l.events(proxy), code('INVALID_CONTRACT'));
 for (const options of [{after: -1, limit: 1}, {after: -0, limit: 1}, {after: 0, limit: 0}, {after: 0, limit: 1001}, {after: 0, limit: 1, hidden: true}]) await assert.rejects(l.events(options), code('INVALID_CONTRACT'));
 assert.equal(touched, 0); await l.close(); await l.close(); await assert.rejects(l.snapshot(), code('UNAVAILABLE'));
});
