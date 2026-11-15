import test from 'node:test';
import type {TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,stat,chmod,symlink,readFile,writeFile,open} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {ArgoError,canonical} from '../packages/contracts/src/index.ts';
import {genesis,principal,command,speak} from './shared-world-rules-helpers.ts';
import {initialWorldState,createWorldEvent} from '../packages/ledger/src/index.ts';
import {keys} from './mortal-fixtures.ts';
import {randomBytes} from 'node:crypto';
import {Worker} from 'node:worker_threads';
import {spawn} from 'node:child_process';
import {initialRow} from '../packages/session/src/conversation-guards.ts';
import {hash} from '../packages/contracts/src/index.ts';
const moduleURL=new URL('../packages/session/src/conversation-store.ts',import.meta.url);
async function api(){const m=await import(moduleURL.href).catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});assert.equal(typeof m.openWorldConversationStore,'function');return m;}
const policy=()=>({provider_policy_id:'test_v1',generation_mode:'offline_fixture',candidates:[{vendor:'xai',model:'grok-4.7',pool:'offline'}],effort:'low',timeout_ms:1000,max_context_bytes:32768,max_output_tokens:800});
async function setup(t:TestContext){
 const dir=await mkdtemp(join(tmpdir(),'argo-turn-store-')),g=genesis(),path=join(dir,'turns.sqlite'),m=await api(),handles:any[]=[];
 const options={path,mode:'create',genesis:g,player:principal(g),npc:principal(g,'raider'),policy:policy()};
 const open=async(patch={})=>{const store=await m.openWorldConversationStore({...options,...patch});handles.push(store);return store;};
 t.after(async()=>{for(const h of handles)await h.close();await rm(dir,{recursive:true,force:true});});return {dir,path,g,m,options,open};
}
test('private outbox explicitly creates, binds, reopens and refuses replacements or wrong policy',async t=>{
 const f=await setup(t),store=await f.open();assert.equal((await stat(f.path)).mode&0o777,0o600);assert.ok(Object.isFrozen(store.binding));
 await assert.rejects(f.open());await store.close();await f.open({mode:'open'});await assert.rejects(f.open({mode:'open',policy:{...policy(),provider_policy_id:'changed'}}));
 await assert.rejects(f.open({mode:'open',path:join(f.dir,'missing.sqlite')}));assert.equal((await readFile(f.path)).includes(Buffer.from('PRIVATE KEY')),false);
});
test('two handles CAS one input and cannot mutate immutable text or replace a saved command',async t=>{
 const f=await setup(t),a=await f.open(),b=await f.open({mode:'open'}),x=f.m.storeAccess(a),y=f.m.storeAccess(b);
 const [first,same]=await Promise.all([x.insert({turn_id:'hello',text:'Hello'}),y.insert({turn_id:'hello',text:'Hello'})]);assert.deepEqual(first,same);
 await assert.rejects(y.insert({turn_id:'hello',text:'Different'}));
 const c=command(initialWorldState(f.g),speak('Hello',['raider']));c.request_id=f.m.requestIdFor(a.binding,'hello','input');
 const results=await Promise.all([x.advance('hello',first.revision,{type:'save_input',command:c}),y.advance('hello',first.revision,{type:'cancel'})]);
 assert.equal(results.filter(r=>r.changed).length,1);const row=await x.load('hello');assert.equal(row.revision,first.revision+1);
 assert.ok(['input_pending','settled'].includes(row.phase));
 await assert.rejects(x.advance('hello',row.revision,{type:'save_input',command:{...c,action:speak('Changed',['raider'])}}));
});
test('stored row corruption, foreign tables and unsafe filesystem capabilities fail closed',async t=>{
 const f=await setup(t),store=await f.open(),access=f.m.storeAccess(store);await access.insert({turn_id:'entry',text:'Hello'});
 const db=new DatabaseSync(f.path);db.exec("UPDATE conversation_turns SET row_json='{}' WHERE turn_id='entry'");db.close();await assert.rejects(access.load('entry'));await store.close();await assert.rejects(f.open({mode:'open'}));
 const foreign=join(f.dir,'foreign.sqlite'),other=new DatabaseSync(foreign);other.exec('CREATE TABLE foreign_data(value TEXT)');other.close();await chmod(foreign,0o600);const bytes=await readFile(foreign);await assert.rejects(f.open({mode:'open',path:foreign}));assert.deepEqual(await readFile(foreign),bytes);
 const alias=join(f.dir,'alias.sqlite');await symlink(f.path,alias);await assert.rejects(f.open({mode:'open',path:alias}));await chmod(f.dir,0o755);await assert.rejects(f.open({path:join(f.dir,'unsafe.sqlite')}));await chmod(f.dir,0o700);
});
test('active inputs and forged opaque capabilities are refused without executing getters',async t=>{
 const f=await setup(t);let reads=0;const bad=Object.defineProperty({...f.options},'policy',{enumerable:true,get(){reads++;return policy();}});
 await assert.rejects(f.m.openWorldConversationStore(bad));assert.equal(reads,0);
 assert.throws(()=>f.m.storeAccess(Object.freeze({binding:{},close:async()=>{}})));
 const store=await f.open(),access=f.m.storeAccess(store),input=Object.defineProperty({turn_id:'x'},'text',{enumerable:true,get(){reads++;return 'x';}});
 await assert.rejects(access.insert(input));assert.equal(reads,0);assert.equal(await access.load('missing'),null);
});


test('open mode is captured before awaits and directory symlink aliases are refused',async t=>{
 const f=await setup(t),empty=join(f.dir,'empty.sqlite');await writeFile(empty,'',{mode:0o600});const options={...f.options,path:empty,mode:'open'};
 const opening=f.m.openWorldConversationStore(options);options.mode='create';await assert.rejects(opening);assert.equal((await stat(empty)).size,0);
 const alias=join(f.dir,'parent_alias');await symlink(f.dir,alias);await assert.rejects(f.open({path:join(alias,'aliased.sqlite')}));
});

test('literal sqlite_ internal names do not hide a foreign sqliteX table',async t=>{
 const f=await setup(t),store=await f.open();await store.close();const db=new DatabaseSync(f.path);db.exec('CREATE TABLE sqliteXforeign(secret TEXT)');db.close();
 await assert.rejects(f.open({mode:'open'}));
});

test('close drains all 64 accepted RPCs before terminating its worker',async t=>{
 const f=await setup(t),store=await f.open(),access=f.m.storeAccess(store);const writes=Array.from({length:64},(_,i)=>access.insert({turn_id:'queued_'+i,text:'Hello'}));
 const closing=store.close();const rows=await Promise.all(writes);await closing;assert.equal(rows.length,64);
 const reopened=await f.open({mode:'open'});assert.equal((await f.m.storeAccess(reopened).load('queued_63')).text,'Hello');
});

test('oversized stored JSON is refused and a consumed attempt cannot publish silence after deadline',async t=>{
 const f=await setup(t),store=await f.open(),access=f.m.storeAccess(store);let row=await access.insert({turn_id:'deadline',text:'Hello'});
 const state=initialWorldState(f.g),c=command(state,speak('Hello',['raider']));c.request_id=f.m.requestIdFor(store.binding,'deadline','input');
 row=(await access.advance(row.turn_id,row.revision,{type:'save_input',command:c})).row;
 const committed=createWorldEvent(f.g,state,c,principal(f.g),keys.privateKey);row=(await access.advance(row.turn_id,row.revision,{type:'confirm_input',receipt:committed.receipt})).row;
 const now=Date.now(),attempt={attempt_id:randomBytes(32).toString('hex'),owner_id:randomBytes(32).toString('hex'),query:{version:f.g.version,scope:f.g.mortal.scope,actor_id:'raider',cursor:committed.receipt.cursor},started_at_ms:now,deadline_at_ms:now+1000};
 row=(await access.advance(row.turn_id,row.revision,{type:'claim_generation',attempt})).row;await new Promise(r=>setTimeout(r,Math.max(0,attempt.deadline_at_ms-Date.now()+5)));
 await assert.rejects(access.advance(row.turn_id,row.revision,{type:'settle',terminal:{outcome:'no_reply',reason:'adapter_null',rejection_proof:null}}));
 const ended=await access.advance(row.turn_id,row.revision,{type:'settle',terminal:{outcome:'generation_uncertain',reason:'attempt_expired',rejection_proof:null}});assert.deepEqual(ended.row.attempt,attempt);
 const db=new DatabaseSync(f.path);db.prepare('UPDATE conversation_turns SET row_json=? WHERE turn_id=?').run(JSON.stringify({text:'x'.repeat(262144)}),row.turn_id);db.close();await assert.rejects(access.load(row.turn_id));
});


test('worker loss after an outbox COMMIT reopens the identical durable input',async t=>{
 const f=await setup(t),store=await f.open(),access=f.m.storeAccess(store);let termination:Promise<number>|undefined;const original=Worker.prototype.emit;
 const spy=t.mock.method(Worker.prototype,'emit',function(this:Worker,event:string|symbol,...args:any[]){const r=args[0];if(event==='message'&&r?.ok&&r.value?.turn_id==='lost'){termination=this.terminate();return true;}return Reflect.apply(original,this,[event,...args]);});
 try{await assert.rejects(access.insert({turn_id:'lost',text:'Preserve this exact input'}));await termination;}finally{spy.mock.restore();}
 const reopened=await f.open({mode:'open'});assert.equal((await f.m.storeAccess(reopened).load('lost')).text,'Preserve this exact input');
});

test('the record limit refuses a new turn without deleting old tombstones',async t=>{
 const f=await setup(t),store=await f.open(),db=new DatabaseSync(f.path),insert=db.prepare('INSERT INTO conversation_turns VALUES(?,?,?,?,?,?,?,?,?,?)');
 db.exec('BEGIN');for(let i=0;i<10000;i++){const r=initialRow(store.binding,{turn_id:'limit_'+i,text:'Hello'},1),text=canonical(r);insert.run(r.turn_key,r.turn_id,r.input_hash,r.revision,r.phase,0,null,Buffer.byteLength(text),hash(r),text);}db.exec('COMMIT');db.close();
 await assert.rejects(f.m.storeAccess(store).insert({turn_id:'overflow',text:'No'}));assert.equal((await f.m.storeAccess(store).load('limit_9999')).text,'Hello');
});

test('separate ordinary processes share one revision fence in the same outbox',async t=>{
 const f=await setup(t),store=await f.open();await f.m.storeAccess(store).insert({turn_id:'race',text:'Hello'});
 const config=join(f.dir,'config.json');await writeFile(config,JSON.stringify({...f.options,mode:'open'}),{mode:0o600});
 const script=`import {readFile,writeFile,open} from 'node:fs/promises';import {openWorldConversationStore,storeAccess} from ${JSON.stringify(moduleURL.href)};const [config,result]=process.argv.slice(2);const store=await openWorldConversationStore(JSON.parse(await readFile(config,'utf8')));try{const r=await storeAccess(store).advance('race',0,{type:'cancel'});await writeFile(result,JSON.stringify({changed:r.changed}),{mode:0o600,flag:'wx'});}finally{await store.close();}`;
 const scriptPath=join(f.dir,'claim.mjs');await writeFile(scriptPath,script,{mode:0o600});
 async function child(name:string){const result=join(f.dir,name),errors=join(f.dir,name+'.stderr'),err=await open(errors,'wx',0o600),env={...process.env};delete env.NODE_TEST_CONTEXT;let status:number|null;try{status=await new Promise<number|null>((resolve,reject)=>{const p=spawn(process.execPath,[scriptPath,config,result],{stdio:['ignore','ignore',err.fd],env});const timer=setTimeout(()=>p.kill('SIGKILL'),30000);p.once('error',reject);p.once('close',code=>{clearTimeout(timer);resolve(code);});});}finally{await err.close();}assert.equal(status,0,await readFile(errors,'utf8'));return JSON.parse(await readFile(result,'utf8'));}
 const results=await Promise.all([child('a.json'),child('b.json')]);assert.equal(results.filter(r=>r.changed).length,1);assert.equal((await f.m.storeAccess(store).load('race')).cancel_requested,true);
});
