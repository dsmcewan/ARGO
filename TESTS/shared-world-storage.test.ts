import {test} from 'node:test';
import type {TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Worker} from 'node:worker_threads';
import {DatabaseSync} from 'node:sqlite';
import {canonical,hash,ArgoError} from '../packages/contracts/src/index.ts';
import type {WorldLedger,WorldReceipt,WorldLedgerOptions} from '../packages/contracts/src/shared-world-types.ts';
import {replayWorld,createWorldEvent} from '../packages/ledger/src/world/journal.ts';
import {viewWorldActor} from '../packages/ledger/src/world/view.ts';
import {genesis,principal,command,speak,offer,accept} from './shared-world-rules-helpers.ts';
import {keys} from './mortal-fixtures.ts';

const source='../packages/ledger/src/world/storage.ts';
const loaded=await import(source).catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return {};throw error;});
const api:typeof import('../packages/ledger/src/world/storage.ts')=loaded as typeof import('../packages/ledger/src/world/storage.ts');
const code=(c:string)=>(e:unknown)=>e instanceof ArgoError&&e.code===c;
async function setup(t:TestContext){
 assert.equal(typeof api.openWorldLedger,'function','Shared storage must be implemented');
 const directory=await mkdtemp(join(tmpdir(),'argo-world-storage-')),path=join(directory,'world.sqlite'),g=genesis(),handles:WorldLedger[]=[];
 t.after(async()=>{await Promise.all(handles.map(h=>h.close().catch(()=>{})));await rm(directory,{recursive:true,force:true});});
 const connect=async(extra:Partial<WorldLedgerOptions>={})=>{const h=await api.openWorldLedger({path,genesis:g,privateKey:keys.privateKey,...extra});handles.push(h);return h;};
 return {directory,path,g,connect,handles};
}
function rowCount(path:string){const db=new DatabaseSync(path);try{return Number(db.prepare('SELECT count(*) AS n FROM shared_world_v1_events').get()!.n);}finally{db.close();}}

test('SQLite commits signed compound history and receipts together and resumes exact retries',async t=>{
 const f=await setup(t),a=await f.connect(),s=await a.snapshot();assert.equal(s.cursor.head,hash(f.g));assert.deepEqual(await a.events(),[]);
 const c=command(s,offer()),issued=await a.submit(c,principal(f.g));const offered=await a.snapshot();
 const taken=command(offered,accept(offered),'companion'),receipt=await a.submit(taken,principal(f.g,'companion')),state=await a.snapshot();
 assert.equal(state.physical.items.find(i=>i.id==='lamp')!.owner_id,'companion');assert.equal(state.loans.length,1);assert.equal(state.memories.at(-1)!.payload.type,'loan_accepted');assert.equal(rowCount(f.path),2);
 assert.deepEqual(await a.submit(c,principal(f.g)),issued);assert.deepEqual(await a.submit(taken,principal(f.g,'companion')),receipt);
 assert.deepEqual(replayWorld(f.g,await a.events()),state);assert.deepEqual((await a.events({after:1,limit:1})).map(e=>e.sequence),[2]);
 await a.close();const b=await f.connect();assert.deepEqual(await b.snapshot(),state);assert.deepEqual(await b.submit(taken,principal(f.g,'companion')),receipt);
 const db=new DatabaseSync(f.path);assert.equal(db.prepare('PRAGMA journal_mode').get()!.journal_mode,'wal');db.close();
 for(const name of await readdir(f.directory))assert.equal((await readFile(join(f.directory,name))).includes(Buffer.from('PRIVATE KEY')),false);
});

test('two handles serialize stale writers and identical accepts never transfer or acquire twice',async t=>{
 const f=await setup(t),a=await f.connect(),b=await f.connect();await a.submit(command(await a.snapshot(),offer()),principal(f.g));
 const s=await a.snapshot(),c=command(s,accept(s),'companion'),p=principal(f.g,'companion');const [x,y]=await Promise.all([a.submit(c,p),b.submit(c,p)]);assert.deepEqual(x,y);assert.equal(rowCount(f.path),2);
 const next=await b.snapshot(),outcomes=await Promise.allSettled([a.submit(command(next,speak(),'hero','left'),principal(f.g)),b.submit(command(next,speak(),'hero','right'),principal(f.g))]);
 assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);assert.equal(outcomes.filter(x=>x.status==='rejected'&&code('CONFLICT')(x.reason)).length,1);assert.equal(rowCount(f.path),3);
 await assert.rejects(a.submit({...c,action:{...c.action,type:'accept_loan',offer_id:'lamp_offer',offer_hash:'f'.repeat(64)}},p),code('CONFLICT'));
 await assert.rejects(a.submit(c,{...p,principal_id:'impostor'}),code('CONFLICT'));
 assert.deepEqual(await a.snapshot(),await b.snapshot());
});

test('an append failure rolls back custody, obligation, memory and request identity as one unit',async t=>{
 const f=await setup(t),a=await f.connect();await a.submit(command(await a.snapshot(),offer()),principal(f.g));const before=await a.snapshot(),c=command(before,accept(before),'companion');
 const db=new DatabaseSync(f.path);t.after(()=>db.close());db.exec("CREATE TRIGGER reject_append BEFORE INSERT ON shared_world_v1_events BEGIN SELECT RAISE(ABORT,'injected append refusal'); END;");
 await assert.rejects(a.submit(c,principal(f.g,'companion')),code('UNAVAILABLE'));assert.deepEqual(await a.snapshot(),before);assert.equal(rowCount(f.path),1);
 db.exec('DROP TRIGGER reject_append');await a.submit(c,principal(f.g,'companion'));const after=await a.snapshot();assert.equal(after.loans.length,1);assert.equal(after.physical.items.find(i=>i.id==='lamp')!.owner_id,'companion');assert.equal(rowCount(f.path),2);
});

test('losing the worker after COMMIT before acknowledgment reconciles the same durable receipt',async t=>{
 const f=await setup(t),a=await f.connect(),c=command(await a.snapshot(),speak());let captured:WorldReceipt|undefined,termination:Promise<number>|undefined;
 const original=Worker.prototype.emit;
 const spy=t.mock.method(Worker.prototype,'emit',function(this:Worker,event:string|symbol,...args:any[]){
  const reply=args[0];if(event==='message'&&reply?.ok===true&&reply.value?.request_id===c.request_id&&reply.value?.signature){captured=structuredClone(reply.value);termination=this.terminate();return true;}
  return Reflect.apply(original,this,[event,...args]);
 });t.after(()=>spy.mock.restore());
 await assert.rejects(a.submit(c,principal(f.g)),code('UNAVAILABLE'));await termination;spy.mock.restore();assert.ok(captured);assert.equal(rowCount(f.path),1);
 const b=await f.connect();assert.deepEqual(await b.submit(c,principal(f.g)),captured);assert.equal((await b.snapshot()).memories.length,1);
});

test('unchanged verified worker prefixes reuse immutable owned snapshots and changed prefixes replace them',async t=>{
 const f=await setup(t),a=await f.connect(),before=await a.snapshot();assert.strictEqual(await a.snapshot(),before);assert.ok(Object.isFrozen(before.physical.actors[0]!.resources));
 assert.throws(()=>{before.memories.push({} as never);},TypeError);
 const b=await f.connect();await b.submit(command(before,speak()),principal(f.g));const next=await a.snapshot();assert.notStrictEqual(next,before);assert.strictEqual(await a.snapshot(),next);assert.equal(before.memories.length,0);
 const query={version:f.g.version,scope:f.g.mortal.scope,actor_id:'hero',cursor:next.cursor};assert.equal(viewWorldActor(f.g,next,query,principal(f.g)).memories.length,1);
 const forged=structuredClone(next);forged.memories[0]!.record_id='f'.repeat(64);assert.throws(()=>viewWorldActor(f.g,forged,query,principal(f.g)),code('INVALID_CONTRACT'));
});

test('external checkpoints bind sequence, hash and world time while allowing a committed ancestor',async t=>{
 const f=await setup(t),a=await f.connect();const first=await a.submit(command(await a.snapshot(),speak()),principal(f.g));
 await a.submit(command(await a.snapshot(),{type:'mortal',action:{type:'wait',turns:1}}),principal(f.g));await a.close();
 const b=await f.connect({expectedHead:first.cursor});assert.equal((await b.snapshot()).cursor.sequence,2);await b.close();
 for(const expectedHead of [{...first.cursor,head:'f'.repeat(64)},{...first.cursor,world_time:1},{sequence:0,head:hash(f.g),world_time:1}])await assert.rejects(f.connect({expectedHead}),code('CORRUPT_LEDGER'));
 const db=new DatabaseSync(f.path);db.exec('DROP TRIGGER shared_world_v1_events_no_delete; DELETE FROM shared_world_v1_events;');db.close();await assert.rejects(f.connect({expectedHead:first.cursor}),code('CORRUPT_LEDGER'));
});

test('warm prefix pages and retries rebind tampered bytes, while reopening replays every row',async t=>{
 const f=await setup(t),a=await f.connect(),c=command(await a.snapshot(),speak());await a.submit(c,principal(f.g));
 const db=new DatabaseSync(f.path),row=db.prepare('SELECT event_json FROM shared_world_v1_events WHERE sequence=1').get()!,event=JSON.parse(row.event_json as string);event.before_hash='f'.repeat(64);
 db.exec('DROP TRIGGER shared_world_v1_events_no_update');db.prepare('UPDATE shared_world_v1_events SET event_json=? WHERE sequence=1').run(canonical(event));db.close();
 await assert.rejects(a.events(),code('CORRUPT_LEDGER'));await assert.rejects(a.submit(c,principal(f.g)),code('CORRUPT_LEDGER'));await a.close();await assert.rejects(f.connect(),code('CORRUPT_LEDGER'));
});

test('cached handle refuses a removed acknowledged prefix and corrupt receipt or request-index bindings',async t=>{
 for(const sql of ["UPDATE shared_world_v1_events SET request_hash=lower(hex(zeroblob(32))) WHERE sequence=1","UPDATE shared_world_v1_events SET receipt_json='{}' WHERE sequence=1",'DELETE FROM shared_world_v1_events']){
  const f=await setup(t),a=await f.connect();await a.submit(command(await a.snapshot(),speak()),principal(f.g));
  const db=new DatabaseSync(f.path);db.exec('DROP TRIGGER shared_world_v1_events_no_update; DROP TRIGGER shared_world_v1_events_no_delete; '+sql);db.close();
  await assert.rejects(sql.startsWith('DELETE')?a.snapshot():a.events(),code('CORRUPT_LEDGER'));await a.close();await assert.rejects(f.connect({expectedHead:{sequence:1,head:'a'.repeat(64),world_time:0}}),code('CORRUPT_LEDGER'));
 }
});

test('a failed multi-event suffix cannot publish partial state or poison the warm snapshot cache',async t=>{
 const f=await setup(t),a=await f.connect();await a.submit(command(await a.snapshot(),speak()),principal(f.g));const before=await a.snapshot();
 const good=createWorldEvent(f.g,before,command(before,speak(),'hero','suffix_good'),principal(f.g),keys.privateKey),bad=createWorldEvent(f.g,good.state,command(good.state,speak(),'hero','suffix_bad'),principal(f.g),keys.privateKey);
 const db=new DatabaseSync(f.path);t.after(()=>db.close());const insert=db.prepare('INSERT INTO shared_world_v1_events(sequence,event_hash,request_id,request_hash,event_json,receipt_json) VALUES(?,?,?,?,?,?)');
 for(const created of [good,bad])insert.run(created.event.sequence,created.event.hash,created.event.command.request_id,created.receipt.request_hash,created===bad?'{}':canonical(created.event),canonical(created.receipt));
 await assert.rejects(a.snapshot(),code('CORRUPT_LEDGER'));db.exec('DROP TRIGGER shared_world_v1_events_no_delete; DELETE FROM shared_world_v1_events WHERE sequence>1;');
 assert.strictEqual(await a.snapshot(),before);assert.equal((await a.events()).length,1);
 await a.submit(command(before,speak(),'hero','after_failed_suffix'),principal(f.g));assert.equal((await a.snapshot()).cursor.sequence,2);
});

test('foreign databases and mismatched genesis are refused before changing existing database bytes',async t=>{
 const f=await setup(t),db=new DatabaseSync(f.path);db.exec('PRAGMA journal_mode=DELETE; CREATE TABLE mortal_v3_meta(value TEXT); INSERT INTO mortal_v3_meta VALUES (\'foreign\');');db.close();const before=await readFile(f.path);
 await assert.rejects(f.connect(),code('CORRUPT_LEDGER'));assert.deepEqual(await readFile(f.path),before);
 const other=await setup(t),a=await other.connect();await a.close();const bytes=await readFile(other.path);await assert.rejects(other.connect({genesis:{...other.g,environment:'day'}}),code('CORRUPT_LEDGER'));assert.deepEqual(await readFile(other.path),bytes);
});

test('raw inputs are validated before cloning and queued caller mutations cannot rewrite work',async t=>{
 const f=await setup(t),a=await f.connect(),s=await a.snapshot();let touched=0;
 const c=command(s,speak());Object.defineProperty(c,'action',{enumerable:true,get(){touched++;return speak();}});await assert.rejects(a.submit(c,principal(f.g)),code('INVALID_CONTRACT'));
 const page=new Proxy({after:0,limit:1},{get(){touched++;throw Error('proxy');}});await assert.rejects(a.events(page),code('INVALID_CONTRACT'));
 for(const page of [{after:-1,limit:1},{after:0,limit:1001},{after:0,limit:0}])await assert.rejects(a.events(page),code('INVALID_CONTRACT'));
 const active={path:f.path,genesis:f.g,privateKey:keys.privateKey};Object.defineProperty(active,'genesis',{enumerable:true,get(){touched++;return f.g;}});await assert.rejects(api.openWorldLedger(active),code('INVALID_CONTRACT'));assert.equal(touched,0);
 const oversized=command(s,{type:'speak',text:'x'.repeat(16*1024*1024),audience:{kind:'self',addressed_actor_ids:[]},in_reply_to:null});await assert.rejects(a.submit(oversized,principal(f.g)),code('INVALID_CONTRACT'));assert.equal(rowCount(f.path),0);assert.strictEqual(await a.snapshot(),s);
 const good=command(s,speak()),p=principal(f.g),pending=a.submit(good,p);good.action={type:'mortal',action:{type:'wait',turns:24}};p.principal_id='altered';await pending;assert.equal((await a.snapshot()).cursor.world_time,0);
 await a.close();await a.close();await assert.rejects(a.snapshot(),code('UNAVAILABLE'));
});

test('complete reply bounds include RPC metadata and escaped UTF-8 bytes',()=>{
 assert.equal(typeof api.assertWorldReplyFits,'function','Private transport budget helper must be implemented');
 const limit=16*1024*1024,overhead=Buffer.byteLength(JSON.stringify({id:Number.MAX_SAFE_INTEGER,ok:true,value:''}));
 api.assertWorldReplyFits('x'.repeat(limit-overhead));assert.throws(()=>api.assertWorldReplyFits('x'.repeat(limit-overhead+1)),code('INVALID_ACTION'));
 assert.throws(()=>api.assertWorldReplyFits('\0'.repeat(Math.floor(limit/6))),code('INVALID_ACTION'));
});

test('SQLite lock waits leave the parent responsive, queued calls are bounded and close drains them',async t=>{
 const f=await setup(t),a=await f.connect(),c=command(await a.snapshot(),speak());
 const blocker=new Worker(`const {parentPort,workerData}=require('node:worker_threads');const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(workerData);db.exec('BEGIN IMMEDIATE');parentPort.postMessage('locked');setInterval(()=>{},1000);`,{eval:true,workerData:f.path});t.after(()=>blocker.terminate());
 await new Promise<void>((resolve,reject)=>{blocker.once('message',()=>resolve());blocker.once('error',reject);});
 let beats=0;const timer=setInterval(()=>beats++,5);const admitted=Array.from({length:128},()=>a.submit(c,principal(f.g)));
 await assert.rejects(a.submit(c,principal(f.g)),code('UNAVAILABLE'));const closing=a.close();await assert.rejects(a.snapshot(),code('UNAVAILABLE'));
 await new Promise(resolve=>setTimeout(resolve,70));clearInterval(timer);assert.ok(beats>=3);await blocker.terminate();const receipts=await Promise.all(admitted);await closing;
 assert.ok(receipts.every(r=>canonical(r)===canonical(receipts[0])));assert.equal(rowCount(f.path),1);
});
