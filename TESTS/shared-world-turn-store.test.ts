import test from 'node:test';
import type {TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,stat,chmod,symlink,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {ArgoError,canonical} from '../packages/contracts/src/index.ts';
import {genesis,principal,command,speak} from './shared-world-rules-helpers.ts';
import {initialWorldState} from '../packages/ledger/src/index.ts';
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
