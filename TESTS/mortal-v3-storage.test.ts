import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, readFile, readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Worker} from 'node:worker_threads';
import {DatabaseSync} from 'node:sqlite';
import {ArgoError, canonical, hash} from '../packages/contracts/src/index.ts';
import type {MortalV3Ledger} from '../packages/contracts/src/mortal-v3-types.ts';
import {v3Genesis, v3Principal, v3Command, keys, beginAction, recover, v3Actor} from './mortal-v3-helpers.ts';

const candidate = await import(new URL('../packages/ledger/src/mortal-v3/storage.ts', import.meta.url).href).catch((error: unknown) => {
 if ((error as NodeJS.ErrnoException).code === 'ERR_MODULE_NOT_FOUND') return {};
 throw error;
});
async function factory() {
 assert.equal(typeof candidate.openMortalV3Ledger, 'function', 'missing openMortalV3Ledger');
 return candidate.openMortalV3Ledger as typeof import('../packages/ledger/src/mortal-v3/storage.ts').openMortalV3Ledger;
}
const code = (expected: string) => (error: unknown) => error instanceof ArgoError && error.code === expected;
async function setup(t: test.TestContext) {
 const open = await factory(), directory = await mkdtemp(join(tmpdir(), 'argo-mortal-storage-')), path = join(directory, 'world.sqlite'), genesis = v3Genesis();
 const handles: MortalV3Ledger[] = [];
 t.after(async () => {await Promise.all(handles.map(handle => handle.close().catch(() => {}))); await rm(directory, {recursive: true, force: true});});
 const connect = async () => {const handle = await open({path, genesis, privateKey: keys.privateKey}); handles.push(handle); return handle;};
 return {open, directory, path, genesis, handles, connect};
}

test('SQLite commits replayable state and idempotency together, reopens, and pages host history', async t => {
 const f = await setup(t), l = await f.connect(), p = v3Principal(f.genesis), s = await l.snapshot();
 assert.equal(s.head, hash(f.genesis)); assert.deepEqual(await l.events(), []);
 const command = v3Command(s, {type: 'wait', turns: 1}), receipt = await l.submit(command, p);
 assert.deepEqual(await l.submit(command, p), receipt); assert.equal((await l.snapshot()).sequence, 1);
 const secondState = await l.snapshot(); await l.submit(v3Command(secondState, {type: 'wait', turns: 1}), p);
 assert.deepEqual((await l.events({after: 0, limit: 1})).map(e => e.sequence), [1]);
 assert.deepEqual((await l.events({after: 1, limit: 1})).map(e => e.sequence), [2]);
 assert.deepEqual(await l.events({after: 2, limit: 1000}), []);
 const last = await l.snapshot(); await l.close();
 const reopened = await f.connect(); assert.deepEqual(await reopened.snapshot(), last); assert.deepEqual(await reopened.submit(command, p), receipt);
 const j = await import('../packages/ledger/src/mortal-v3/journal.ts');
 assert.deepEqual(j.replayMortalV3(f.genesis, await reopened.events()), last);
 const db = new DatabaseSync(f.path); t.after(() => db.close());
 assert.equal(db.prepare('PRAGMA journal_mode').get()!.journal_mode, 'wal');
 assert.equal(db.prepare('SELECT count(*) AS total FROM mortal_v3_events').get()!.total, 2);
});

test('concurrent handles serialize conflicting actions and duplicate retry never spends twice', async t => {
 const f = await setup(t), a = await f.connect(), b = await f.connect(), s = await a.snapshot(), p = v3Principal(f.genesis);
 const command = v3Command(s, {type: 'wait', turns: 1}, 'hero', 'same');
 const receipts = await Promise.all([a.submit(command, p), b.submit(command, p)]);
 assert.deepEqual(receipts[0], receipts[1]); assert.equal((await b.snapshot()).world_time, 600);
 const next = await a.snapshot();
 const outcomes = await Promise.allSettled([a.submit(v3Command(next, {type: 'wait', turns: 1}, 'hero', 'left'), p), b.submit(v3Command(next, {type: 'wait', turns: 1}, 'hero', 'right'), p)]);
 assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
 assert.equal(outcomes.filter(result => result.status === 'rejected' && code('CONFLICT')(result.reason)).length, 1);
 assert.equal((await a.snapshot()).sequence, 2); assert.deepEqual(await a.snapshot(), await b.snapshot());
 await assert.rejects(a.submit({...command, action: {type: 'wait', turns: 2}}, p), code('CONFLICT'));
 await assert.rejects(a.submit(command, {...p, principal_id: 'impostor'}), code('CONFLICT'));
});

test('rejected command has no event/index/RNG effect and input mutation cannot alter queued work', async t => {
 const f = await setup(t), l = await f.connect(), initial = await l.snapshot(), p = v3Principal(f.genesis);
 await assert.rejects(l.submit(v3Command(initial, {type: 'pickup', item_id: 'spear'}), p));
 assert.deepEqual(await l.snapshot(), initial); assert.deepEqual(await l.events(), []);
 const command = v3Command(initial, {type: 'wait', turns: 1}); const pending = l.submit(command, p);
 command.action = {type: 'wait', turns: 24}; p.principal_id = 'changed_after_call';
 await pending; assert.equal((await l.snapshot()).world_time, 600);
 const view = await l.snapshot(); view.actors[0]!.hp = -5;
 assert.equal((await l.snapshot()).actors[0]!.hp, 6);
});

test('external trusted prefix detects rollback and divergent/mismatched genesis at reopen', async t => {
 const f = await setup(t), l = await f.connect(), s = await l.snapshot();
 const receipt = await l.submit(v3Command(s, {type: 'wait', turns: 1}), v3Principal(f.genesis)); await l.close();
 const good = await f.open({path: f.path, genesis: f.genesis, privateKey: keys.privateKey, expectedHead: receipt.cursor}); f.handles.push(good); await good.close();
 await assert.rejects(f.open({path: f.path, genesis: f.genesis, privateKey: keys.privateKey, expectedHead: {...receipt.cursor, head: '1'.repeat(64)}}), code('CORRUPT_LEDGER'));
 await assert.rejects(f.open({path: f.path, genesis: {...f.genesis, variant: 'genuine'}, privateKey: keys.privateKey}), code('CORRUPT_LEDGER'));
 const db = new DatabaseSync(f.path);
 db.exec('DROP TRIGGER mortal_v3_events_no_delete; DELETE FROM mortal_v3_events;'); db.close();
 await assert.rejects(f.open({path: f.path, genesis: f.genesis, privateKey: keys.privateKey, expectedHead: receipt.cursor}), code('CORRUPT_LEDGER'));
});

test('a worker-held write lock never blocks the parent loop and termination releases the OS lock', async t => {
 const f = await setup(t), l = await f.connect(), initial = await l.snapshot();
 const blocker = new Worker(`const {parentPort,workerData}=require('node:worker_threads');const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(workerData);db.exec('BEGIN IMMEDIATE');parentPort.postMessage('locked');setInterval(()=>{},1000);`, {eval: true, workerData: f.path});
 t.after(async () => {await blocker.terminate();});
 await new Promise<void>((resolve, reject) => {blocker.once('message', () => resolve()); blocker.once('error', reject);});
 let beats = 0; const timer = setInterval(() => beats++, 5);
 const pending = l.submit(v3Command(initial, {type: 'wait', turns: 1}), v3Principal(f.genesis));
 await new Promise(resolve => setTimeout(resolve, 100)); clearInterval(timer); assert.ok(beats >= 5, `parent timer ticked ${beats} times`);
 await blocker.terminate(); await pending;
 assert.equal((await l.snapshot()).sequence, 1); assert.equal((await readdir(f.directory)).some(name => name.endsWith('.lock')), false);
});

test('storage refuses corrupt event/index/receipt bytes on reopen and never persists private PEM', async t => {
 const f = await setup(t), l = await f.connect(), initial = await l.snapshot();
 await l.submit(v3Command(initial, {type: 'wait', turns: 1}), v3Principal(f.genesis)); await l.close();
 for (const name of await readdir(f.directory)) {
  const bytes = await readFile(join(f.directory, name)); assert.equal(bytes.includes(Buffer.from('PRIVATE KEY')), false);
 }
 const db = new DatabaseSync(f.path); db.exec('DROP TRIGGER mortal_v3_events_no_update; UPDATE mortal_v3_events SET request_hash = lower(hex(zeroblob(32))) WHERE sequence=1;'); db.close();
 await assert.rejects(f.connect(), code('CORRUPT_LEDGER'));
});

test('cached history pages and retries rebind event bytes to their signed receipt hash', async t => {
 const f = await setup(t), l = await f.connect(), initial = await l.snapshot(), p = v3Principal(f.genesis);
 const command = v3Command(initial, {type: 'wait', turns: 1});
 await l.submit(command, p); await l.events();
 const db = new DatabaseSync(f.path);
 const row = db.prepare('SELECT event_json FROM mortal_v3_events WHERE sequence=1').get()!;
 const event = JSON.parse(row.event_json as string); event.before_hash = '1'.repeat(64);
 db.exec('DROP TRIGGER mortal_v3_events_no_update;');
 db.prepare('UPDATE mortal_v3_events SET event_json=? WHERE sequence=1').run(canonical(event)); db.close();
 // The cached head, SQL hash column, receipt signature and command remain
 // unchanged. A historical page must still refuse altered event body bytes.
 await assert.rejects(l.events({after: 0, limit: 1}), code('CORRUPT_LEDGER'));
 await assert.rejects(l.submit(command, p), code('CORRUPT_LEDGER'));
});

test('host API rejects active DTOs before cloning, bounds page requests, and closes idempotently', async t => {
 const f = await setup(t), l = await f.connect(), s = await l.snapshot(); let touched = 0;
 const command = v3Command(s, {type: 'wait', turns: 1}); Object.defineProperty(command, 'action', {enumerable: true, get: () => {touched++; return {type: 'wait', turns: 1};}});
 await assert.rejects(l.submit(command, v3Principal(f.genesis)), code('INVALID_CONTRACT'));
 const proxy = new Proxy({after: 0, limit: 1}, {get() {touched++; return 0;}});
 await assert.rejects(l.events(proxy), code('INVALID_CONTRACT'));
 for (const options of [{after: -1, limit: 1}, {after: -0, limit: 1}, {after: 0, limit: 0}, {after: 0, limit: 1001}, {after: 0, limit: 1, hidden: true}]) await assert.rejects(l.events(options), code('INVALID_CONTRACT'));
 assert.equal(touched, 0); await l.close(); await l.close(); await assert.rejects(l.snapshot(), code('UNAVAILABLE'));
});

test('recovery commits exact retries once across handles/restart and cannot borrow a refreshed cursor for an old turn',async t=>{
 const f=await setup(t),a=await f.connect(),b=await f.connect(),host=v3Principal(f.genesis,'host');
 let s=await a.snapshot();await a.submit(v3Command(s,beginAction(),'host'),host);s=await a.snapshot();
 const token=s.encounter!.turn_started_sequence,action=recover(s),old=v3Command(s,action,'host','old_cursor');
 await b.submit(v3Command(s,{type:'wait',turns:1},'remote'),v3Principal(f.genesis,'remote'));
 await assert.rejects(a.submit(old,host),code('CONFLICT'));s=await a.snapshot();assert.equal(s.encounter!.turn_started_sequence,token);
 const pass=v3Command(s,action,'host','host_pass');const receipts=await Promise.all([a.submit(pass,host),b.submit(pass,host)]);assert.deepEqual(receipts[0],receipts[1]);
 const passed=await b.snapshot();assert.equal(passed.sequence,3);assert.equal(passed.world_time,600);assert.equal(passed.encounter!.turn_started_sequence,3);
 await assert.rejects(a.submit(v3Command(passed,action,'host','stale_turn'),host),code('CONFLICT'));
 await assert.rejects(a.submit({...pass,action:{...action,reason:'different_reason'}},host),code('CONFLICT'));
 await assert.rejects(a.submit(pass,{...host,principal_id:'forged_host'}),code('CONFLICT'));
 const close=v3Command(passed,recover(passed,'close'),'host','host_close'),receipt=await b.submit(close,host),closed=await b.snapshot();
 assert.equal(closed.world_time,606);assert.equal(closed.encounter,null);assert.equal(v3Actor(closed).active_seconds,6);
 await a.close();await b.close();const reopened=await f.connect();assert.deepEqual(await reopened.submit(close,host),receipt);assert.deepEqual(await reopened.submit(pass,host),receipts[0]);assert.deepEqual(await reopened.snapshot(),closed);
 const events=await reopened.events();assert.deepEqual(events.map(e=>e.principal.role),['referee','player','referee','referee']);
 const api=await import('../packages/ledger/src/mortal-v3/index.ts');assert.deepEqual(api.replayMortalV3(f.genesis,events),closed);
 api.verifyMortalV3Receipt(receipt,{scope:f.genesis.scope,genesis_hash:hash(f.genesis),authority_key_id:f.genesis.authority_key_id,authority_public_key:f.genesis.authority_public_key});
});

test('ordinary turn racing referee recovery at the same cursor commits one transition and one settlement',async t=>{
 const f=await setup(t),a=await f.connect(),b=await f.connect(),host=v3Principal(f.genesis,'host');
 await a.submit(v3Command(await a.snapshot(),beginAction(),'host'),host);
 let s=await a.snapshot();await a.submit(v3Command(s,recover(s),'host'),host);s=await a.snapshot();
 const id=s.encounter!.order[s.encounter!.turn]!;
 const result=await Promise.allSettled([a.submit(v3Command(s,{type:'pass'},id,'actor_pass'),v3Principal(f.genesis,id)),b.submit(v3Command(s,recover(s),'host','recovery_pass'),host)]);
 assert.equal(result.filter(r=>r.status==='fulfilled').length,1);assert.equal(result.filter(r=>r.status==='rejected'&&code('CONFLICT')(r.reason)).length,1);
 const next=await a.snapshot();assert.equal(next.sequence,3);assert.equal(next.world_time,6);assert.equal(next.encounter!.round,2);assert.equal(next.encounter!.turn_started_sequence,3);
 assert.equal(v3Actor(next).active_seconds,6);assert.deepEqual(await b.snapshot(),next);assert.equal((await a.events()).length,3);
});

test('forged referee and site-crossing actions create no journal, request index, RNG or time changes',async t=>{
 const f=await setup(t),l=await f.connect(),host=v3Principal(f.genesis,'host');await l.submit(v3Command(await l.snapshot(),beginAction(),'host'),host);
 const s=await l.snapshot(),c=v3Command(s,recover(s,'close'),'host','denied_recovery');
 await assert.rejects(l.submit(c,{...host,principal_id:'wrong'}),code('UNAUTHORIZED'));
 await assert.rejects(l.submit(c,v3Principal(f.genesis)),code('UNAUTHORIZED'));
 await assert.rejects(l.submit(v3Command(s,{type:'travel',route_id:'road'},'remote'),v3Principal(f.genesis,'remote')),code('CONFLICT'));
 assert.deepEqual(await l.snapshot(),s);assert.equal((await l.events()).length,1);
 const receipt=await l.submit(c,host);assert.equal(receipt.cursor.sequence,2);assert.equal((await l.snapshot()).world_time,6);
});

test('waiting turn survives restart and a valid ancestor checkpoint is accepted without being treated as latest',async t=>{
 const f=await setup(t),a=await f.connect(),host=v3Principal(f.genesis,'host');const start=await a.snapshot();
 const first=await a.submit(v3Command(start,beginAction(),'host'),host);let s=await a.snapshot();const action=recover(s,'close');
 await a.submit(v3Command(s,{type:'wait',turns:1},'remote'),v3Principal(f.genesis,'remote'));s=await a.snapshot();await a.close();
 const l=await f.open({path:f.path,genesis:f.genesis,privateKey:keys.privateKey,expectedHead:first.cursor});f.handles.push(l);
 assert.deepEqual(await l.snapshot(),s);assert.equal(s.encounter!.turn_started_sequence,first.cursor.sequence);
 await l.submit(v3Command(s,action,'host'),host);assert.equal((await l.snapshot()).world_time,606);
 await assert.rejects(f.open({path:f.path,genesis:f.genesis,privateKey:keys.privateKey,expectedHead:{sequence:4,head:'f'.repeat(64)}}),code('CORRUPT_LEDGER'));
 const zero=await f.open({path:f.path,genesis:f.genesis,privateKey:keys.privateKey,expectedHead:{sequence:0,head:hash(f.genesis)}});f.handles.push(zero);assert.equal((await zero.snapshot()).sequence,3);
});

test('v3 opening rejects v2 and mixed application databases without changing their bytes or journal mode',async t=>{
 const f=await setup(t),v2=await import('../packages/ledger/src/mortal/storage.ts'),fixtures=await import('./mortal-fixtures.ts'),old=fixtures.mortalGenesis();
 const l=await v2.openMortalLedger({path:f.path,genesis:old,privateKey:keys.privateKey});await l.submit(fixtures.mortalCommand(await l.snapshot(),{type:'wait',turns:1}),fixtures.mortalPrincipal(old));await l.close();
 let db=new DatabaseSync(f.path);db.exec('PRAGMA journal_mode=DELETE;');db.close();let before=await readFile(f.path);
 await assert.rejects(f.connect(),code('CORRUPT_LEDGER'));assert.deepEqual(await readFile(f.path),before);
 db=new DatabaseSync(f.path);assert.equal(db.prepare('PRAGMA journal_mode').get()!.journal_mode,'delete');db.exec('CREATE TABLE mortal_v3_meta(singleton INTEGER); CREATE TABLE mortal_v3_events(sequence INTEGER);');db.close();before=await readFile(f.path);
 await assert.rejects(f.connect(),code('CORRUPT_LEDGER'));assert.deepEqual(await readFile(f.path),before);
});

test('mismatched v3 genesis is refused before journal-mode, schema or metadata mutation',async t=>{
 const f=await setup(t),l=await f.connect();await l.close();let db=new DatabaseSync(f.path);db.exec('PRAGMA journal_mode=DELETE;');db.close();
 const before=await readFile(f.path);await assert.rejects(f.open({path:f.path,genesis:{...f.genesis,variant:'genuine'},privateKey:keys.privateKey}),code('CORRUPT_LEDGER'));
 assert.deepEqual(await readFile(f.path),before);db=new DatabaseSync(f.path);assert.equal(db.prepare('PRAGMA journal_mode').get()!.journal_mode,'delete');db.close();
});
