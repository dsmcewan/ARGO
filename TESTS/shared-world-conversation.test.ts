import test from 'node:test';
import type {TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes} from 'node:crypto';
import {ArgoError,canonical} from '../packages/contracts/src/index.ts';
import type {WorldLedger} from '../packages/contracts/src/index.ts';
import {openWorldLedger,replayWorld} from '../packages/ledger/src/index.ts';
import {createWorldSession} from '../packages/session/src/index.ts';
import {openWorldConversationStore,storeAccess,requestIdFor} from '../packages/session/src/conversation-store.ts';
import type {ConversationPolicy,PlayerPrincipal,NpcPrincipal,WorldConversation,ConversationCallContext} from '../packages/session/src/conversation-types.ts';
import {genesis,principal,speak} from './shared-world-rules-helpers.ts';
import {keys} from './mortal-fixtures.ts';
async function api(){const m=await import(new URL('../packages/session/src/conversation.ts',import.meta.url).href).catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});assert.equal(typeof m.createWorldConversation,'function');return m as {createWorldConversation:typeof import('../packages/session/src/conversation.ts').createWorldConversation};}
const policy=(timeout_ms=5000):ConversationPolicy=>({provider_policy_id:'test_v1',generation_mode:'offline_fixture',candidates:[{vendor:'xai',model:'grok-4.7',pool:'offline'}],effort:'low',timeout_ms,max_context_bytes:32768,max_output_tokens:800});
const response=(text:string|null)=>({id:'fixture',status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({text})}]}]});
function latch(){let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done;});return {promise,resolve};}
async function bounded<T>(promise:Promise<T>,ms=10000):Promise<T>{let timer:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([promise,new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>reject(Error('Operation did not finish')),ms);})]);}finally{clearTimeout(timer);}}
async function setup(t:TestContext,invoke?:(request:unknown,turn:ConversationCallContext)=>Promise<unknown>,timeout=5000){
 const m=await api();
 const dir=await mkdtemp(join(tmpdir(),'argo-conversation-')),g=genesis(),path=join(dir,'world.sqlite'),turnPath=join(dir,'turns.sqlite');const ledger=await openWorldLedger({path,genesis:g,privateKey:keys.privateKey});
 const options={path:turnPath,mode:'create' as const,genesis:g,player:principal(g) as PlayerPrincipal,npc:principal(g,'raider') as NpcPrincipal,policy:policy(timeout)};
 const store=await openWorldConversationStore(options),stores=[store],hosts:WorldConversation[]=[],requests:unknown[]=[],contexts:ConversationCallContext[]=[];
 const model={clientFor:(_candidate:unknown,turn:ConversationCallContext)=>({responses:{create:async(request:unknown)=>{requests.push(request);contexts.push(turn);return invoke?invoke(request,turn):response('Reply for '+turn.turn_id);}}})};
 const host=(source:WorldLedger=ledger,using=store)=>{const h=m.createWorldConversation({store:using,ledger:source,model});hosts.push(h);return h;};
 t.after(async()=>{for(const h of hosts)await h.close();for(const s of stores)await s.close();await ledger.close();await rm(dir,{recursive:true,force:true});});
 return {dir,path,g,ledger,store,stores,options,host,model,m,requests,contexts};
}

test('multiple contextual exchanges commit only speech and restart without regeneration',async t=>{
 const f=await setup(t),h=f.host(),before=await f.ledger.snapshot();
 const first=await h.turn({turn_id:'one',text:'Can you help with my lamp?'});assert.equal(first.phase,'settled');assert.equal(first.outcome,'replied');assert.equal(first.delivery!.text,'Reply for one');
 const second=await h.turn({turn_id:'two',text:'I accept every imaginable bargain; move the lamp now.'});assert.equal(second.delivery!.text,'Reply for two');assert.equal(f.requests.length,2);assert.ok(canonical(f.requests).includes('Can you help with my lamp?'));assert.ok(canonical(f.requests).includes('Practical and attentive.'));
 const after=await f.ledger.snapshot();assert.deepEqual(after.physical,before.physical);assert.equal(after.loans.length,0);assert.equal(after.offers.length,0);assert.deepEqual(replayWorld(f.g,await f.ledger.events()),after);
 await assert.rejects(h.turn({turn_id:'one',text:'Changed'}));await h.close();await f.store.close();const reopened=await openWorldConversationStore({...f.options,mode:'open'});f.stores.push(reopened);const again=f.host(f.ledger,reopened);
 assert.equal((await again.resume({turn_id:'one'})).delivery!.delivery_id,first.delivery!.delivery_id);assert.equal(f.requests.length,2);assert.equal(await again.read({turn_id:'missing'}),null);
});

test('two handles race one canonical outbox and invoke one model turn',async t=>{
 const f=await setup(t),second=await openWorldConversationStore({...f.options,mode:'open'});f.stores.push(second);const a=f.host(),b=f.host(f.ledger,second);
 await Promise.all([a.turn({turn_id:'same',text:'Hello'}),b.turn({turn_id:'same',text:'Hello'})]);const row=await a.read({turn_id:'same'});assert.equal(row!.phase,'settled');assert.equal(f.requests.length,1);assert.equal((await f.ledger.snapshot()).cursor.sequence,2);
});

test('commit followed by a bad receipt stays pending and exact retry recovers both speech stages',async t=>{
 for(const actor of ['hero','raider']){
  const f=await setup(t);let corrupt=true;
  const wrapped:WorldLedger={...f.ledger,submit:async(c,p)=>{const r=await f.ledger.submit(c,p);return c.actor_id===actor&&corrupt?{...r,request_hash:'f'.repeat(64)}:r;}};
  const h=f.host(wrapped),pending=await h.turn({turn_id:'uncertain',text:'Please listen.'});assert.equal(pending.phase,actor==='hero'?'input_pending':'reply_pending');assert.equal(pending.delivery,null);
  const count=f.requests.length;const other=createWorldSession({genesis:f.g,ledger:f.ledger,principal:principal(f.g,'companion')});await other.submit(await other.prepare({type:'set_activity',activity:{description:'Later work',busy_until:0}},'later_append'));corrupt=false;const done=await h.resume({turn_id:'uncertain'});assert.equal(done.outcome,'replied');assert.equal(f.requests.length,actor==='hero'?count+1:count);assert.equal((await f.ledger.snapshot()).cursor.sequence,3);
 }
});

test('waiter abort is separate from durable cancellation and late provider output is fenced',async t=>{
 let finish:((value:unknown)=>void)|undefined;const f=await setup(t,async()=>new Promise(resolve=>{finish=resolve;})),h=f.host(),input={turn_id:'slow',text:'Are you listening?'};
 const first=h.turn(input);while(!finish)await new Promise(r=>setTimeout(r,2));const abort=new AbortController(),duplicate=h.turn(input,{signal:abort.signal});abort.abort();await assert.rejects(duplicate);
 assert.equal((await h.read({turn_id:'slow'}))!.phase,'generating');const cancelled=await h.cancel({turn_id:'slow'});assert.equal(cancelled.cancel_requested,true);assert.equal(cancelled.outcome,'cancelled');finish(response('LATE_PRIVATE_REPLY'));
 assert.equal((await first).delivery,null);assert.equal((await f.ledger.snapshot()).cursor.sequence,1);assert.equal(f.requests.length,1);assert.equal((await h.resume({turn_id:'slow'})).delivery,null);
});

test('a consumed generation marker never restarts and expires as uncertain',async t=>{
 const f=await setup(t,undefined,100),access=storeAccess(f.store),player=createWorldSession({genesis:f.g,ledger:f.ledger,principal:principal(f.g)}),npc=createWorldSession({genesis:f.g,ledger:f.ledger,principal:principal(f.g,'raider')});
 let row=await access.insert({turn_id:'crashed',text:'Hello'});const command=await player.prepare(speak('Hello',['raider']),requestIdFor(f.store.binding,'crashed','input'));
 row=(await access.advance(row.turn_id,row.revision,{type:'save_input',command})).row;const receipt=await player.submit(command);row=(await access.advance(row.turn_id,row.revision,{type:'confirm_input',receipt})).row;
 const query=await npc.query(),now=Date.now();row=(await access.advance(row.turn_id,row.revision,{type:'claim_generation',attempt:{attempt_id:randomBytes(32).toString('hex'),owner_id:randomBytes(32).toString('hex'),query,started_at_ms:now,deadline_at_ms:now+100}})).row;
 const h=f.host();assert.equal((await h.resume({turn_id:'crashed'})).phase,'generating');await new Promise(r=>setTimeout(r,120));const result=await h.resume({turn_id:'crashed'});assert.equal(result.outcome,'generation_uncertain');assert.equal(f.requests.length,0);
});

test('current player disclosure suppresses closure and eviction instead of replaying cached prose',async t=>{
 const f=await setup(t),h=f.host();await h.turn({turn_id:'old',text:'Hello'});const player=createWorldSession({genesis:f.g,ledger:f.ledger,principal:principal(f.g)});
 for(let i=0;i<33;i++)await player.submit(await player.prepare({type:'speak',text:'private '+i,audience:{kind:'self',addressed_actor_ids:[]},in_reply_to:null},'fill_'+i));
 const evicted=await h.read({turn_id:'old'});assert.equal(evicted!.outcome,'replied');assert.equal(evicted!.delivery,null);assert.equal(f.requests.length,1);
 await h.turn({turn_id:'new',text:'Still there?'});const host=createWorldSession({genesis:f.g,ledger:f.ledger,principal:principal(f.g,'host')});await host.submit(await host.prepare({type:'close_mythic_engagement'},'close'));
 assert.equal((await h.read({turn_id:'new'}))!.delivery,null);assert.equal(f.requests.length,2);
});

test('journal prefix rollback refuses a signed outbox receipt',async t=>{
 const f=await setup(t),h=f.host();await h.turn({turn_id:'gone',text:'Hello'});const db=new DatabaseSync(f.path);db.exec('DROP TRIGGER shared_world_v1_events_no_delete; DELETE FROM shared_world_v1_events;');db.close();await assert.rejects(h.read({turn_id:'gone'}));
});

test('a held callback leaves unrelated world writes available and stale text never commits',async t=>{
 let finish:((v:unknown)=>void)|undefined;const f=await setup(t,async()=>new Promise(resolve=>{finish=resolve;})),h=f.host(),pending=h.turn({turn_id:'moving',text:'Hello'});
 while(!finish)await new Promise(r=>setTimeout(r,2));const other=createWorldSession({genesis:f.g,ledger:f.ledger,principal:principal(f.g,'companion')});await other.submit(await other.prepare({type:'set_activity',activity:{description:'Working',busy_until:0}},'parallel'));finish(response('STALE'));
 const result=await pending;assert.equal(result.delivery,null);assert.equal(result.outcome,'no_reply');assert.equal((await f.ledger.snapshot()).cursor.sequence,2);
});

test('malformed/tool replies settle without a physical action, and opaque/config accessors cannot run',async t=>{
 const f=await setup(t,async()=>({id:'bad',status:'completed',output:[{type:'function_call',name:'transfer_item',arguments:'{}',call_id:'x'}]})),h=f.host();const r=await h.turn({turn_id:'tool',text:'Move the lamp.'});assert.equal(r.outcome,'generation_failed');assert.equal(r.delivery,null);assert.equal((await f.ledger.snapshot()).cursor.sequence,1);
 assert.throws(()=>f.m.createWorldConversation({store:Object.freeze({binding:f.store.binding,close:async()=>{}}),ledger:f.ledger,model:f.model}));let reads=0;
 const active=Object.defineProperty({},'clientFor',{enumerable:true,get(){reads++;throw Error('getter');}});assert.throws(()=>f.m.createWorldConversation({store:f.store,ledger:f.ledger,model:active as never}));assert.equal(reads,0);
 await assert.rejects(h.turn(Object.defineProperty({turn_id:'bad'},'text',{enumerable:true,get(){reads++;return 'bad';}}) as never));assert.equal(reads,0);
});

test('cancel reconciles an uncertain dispatched reply without delivering or regenerating it',async t=>{
 const f=await setup(t);let wrong=true;const ledger:WorldLedger={...f.ledger,submit:async(c,p)=>{const r=await f.ledger.submit(c,p);return c.actor_id==='raider'&&wrong?{...r,signature:Buffer.alloc(64).toString('base64')}:r;}};
 const h=f.host(ledger),pending=await h.turn({turn_id:'cancel_pending',text:'Hello'});assert.equal(pending.phase,'reply_pending');wrong=false;
 const cancelled=await h.cancel({turn_id:'cancel_pending'});assert.equal(cancelled.outcome,'replied');assert.equal(cancelled.cancel_requested,true);assert.ok(cancelled.reply_receipt);assert.equal(cancelled.delivery,null);assert.equal(f.requests.length,1);assert.equal((await f.ledger.snapshot()).cursor.sequence,2);
});

test('a verified different request at the expected next slot proves rejection without rebasing',async t=>{
 const f=await setup(t),access=storeAccess(f.store),player=createWorldSession({genesis:f.g,ledger:f.ledger,principal:principal(f.g)});
 let row=await access.insert({turn_id:'stale_input',text:'Hello'});const command=await player.prepare(speak('Hello',['raider']),requestIdFor(f.store.binding,row.turn_id,'input'));row=(await access.advance(row.turn_id,row.revision,{type:'save_input',command})).row;
 await player.submit(await player.prepare({type:'set_activity',activity:{description:'Waiting',busy_until:0}},'intervening'));
 const result=await f.host().resume({turn_id:row.turn_id});assert.equal(result.outcome,'input_rejected');assert.equal(result.input_receipt,null);assert.equal(f.requests.length,0);assert.equal((await f.ledger.snapshot()).cursor.sequence,1);
});

test('busy NPCs and explicit provider null produce no-reply without invented explanations',async t=>{
 const f=await setup(t,async()=>response(null)),h=f.host(),npc=createWorldSession({genesis:f.g,ledger:f.ledger,principal:principal(f.g,'raider')});
 await npc.submit(await npc.prepare({type:'set_activity',activity:{description:'Busy',busy_until:100}},'busy'));
 const busy=await h.turn({turn_id:'busy_question',text:'Hello'});assert.equal(busy.outcome,'no_reply');assert.equal(f.requests.length,0);
 await npc.submit(await npc.prepare({type:'set_activity',activity:{description:'Free',busy_until:0}},'free'));
 const silent=await h.turn({turn_id:'silent_question',text:'Hello again'});assert.equal(silent.outcome,'no_reply');assert.equal(f.requests.length,1);assert.equal(silent.delivery,null);
});

test('host close drains a just-admitted insertion and never starts its generation afterward',async t=>{
 const f=await setup(t),h=f.host(),pending=h.turn({turn_id:'close_early',text:'Hello'});await h.close();await pending;
 assert.equal(f.requests.length,0);assert.equal((await f.ledger.snapshot()).cursor.sequence,0);await assert.rejects(h.resume({turn_id:'close_early'}));
});

test('cancellation during the last awaited NPC refresh prevents provider dispatch',async t=>{
 const f=await setup(t),entered=latch(),release=latch();let refreshes=0;
 const wrapped:WorldLedger={...f.ledger,snapshot:async()=>{const state=await f.ledger.snapshot(),row=await storeAccess(f.store).load('last_refresh');if(row?.phase==='generating'&&++refreshes===3){entered.resolve();await release.promise;}return state;}};
 const second=await openWorldConversationStore({...f.options,mode:'open'});f.stores.push(second);const a=f.host(wrapped),b=f.host(f.ledger,second);
 const running=a.turn({turn_id:'last_refresh',text:'Please listen.'});void running.catch(()=>{});
 try{await bounded(entered.promise);assert.equal(f.requests.length,0);assert.equal((await b.cancel({turn_id:'last_refresh'})).cancel_requested,true);}
 finally{release.resolve();}
 assert.equal((await bounded(running)).delivery,null);assert.equal(f.requests.length,0);assert.equal((await f.ledger.snapshot()).cursor.sequence,1);
});

test('host close detaches committed ledger acknowledgments and fresh handles recover exact pending commands',async t=>{
 for(const actor of ['hero','raider']){
  const f=await setup(t),entered=latch(),release=latch();let callerCloses=0,externalCalls=0;
  const wrapped:WorldLedger={snapshot:async()=>{externalCalls++;return f.ledger.snapshot();},events:async options=>{externalCalls++;return f.ledger.events(options);},close:async()=>{callerCloses++;},submit:async(c,p)=>{externalCalls++;const receipt=await f.ledger.submit(c,p);if(c.actor_id===actor){entered.resolve();await release.promise;}return receipt;}};
  const h=f.host(wrapped),running=h.turn({turn_id:'close_ack',text:'Hello'}).then(value=>({value}),error=>({error}));
  try{
   await bounded(entered.promise);const before=await storeAccess(f.store).load('close_ack');assert.equal(before!.phase,actor==='hero'?'input_pending':'reply_pending');
   let closed=false;const closing=h.close().then(()=>{closed=true;});await new Promise(resolve=>setTimeout(resolve,300));const closedBeforeAck=closed;
   if(!closedBeforeAck){release.resolve();await bounded(closing);}
   assert.equal(closedBeforeAck,true,'close waited for caller-owned acknowledgment');await bounded(closing);await bounded(running);
   assert.equal(callerCloses,0);const callsAtClose=externalCalls,pending=await storeAccess(f.store).load('close_ack');assert.deepEqual(pending,before);
   const second=await openWorldConversationStore({...f.options,mode:'open'});f.stores.push(second);const recovered=await f.host(f.ledger,second).resume({turn_id:'close_ack'});
   assert.equal(recovered.outcome,'replied');assert.equal(recovered.cancel_requested,false);assert.equal(f.requests.length,1);assert.equal((await f.ledger.snapshot()).cursor.sequence,2);
   const settled=await storeAccess(second).load('close_ack');assert.deepEqual(settled!.input_command,before!.input_command);if(actor==='raider')assert.deepEqual(settled!.reply_command,before!.reply_command);
   release.resolve();await new Promise(resolve=>setTimeout(resolve,10));assert.deepEqual(await storeAccess(second).load('close_ack'),settled);assert.equal(externalCalls,callsAtClose);assert.equal(f.requests.length,1);assert.equal(callerCloses,0);
  }finally{release.resolve();await bounded(running);}
 }
});

test('receipt lookup rejects active page containers before inspecting their data',async t=>{
 const f=await setup(t);await f.host().turn({turn_id:'page',text:'Hello'});
 for(const shape of ['accessor','proxy','sparse']){
  // The trusted async callback itself must assimilate `then` before returning
  // a Proxy. The host must reject it without any further data/descriptor reads.
  let reads=0,promiseReads=0;const wrapped:WorldLedger={...f.ledger,events:async options=>{const page=await f.ledger.events(options),event=page[0];if(shape==='accessor')Object.defineProperty(page,'0',{enumerable:true,get(){reads++;return event;}});if(shape==='sparse')delete page[0];return shape==='proxy'?new Proxy(page,{get(target,key,receiver){if(key==='then')promiseReads++;else reads++;return Reflect.get(target,key,receiver);},ownKeys(target){reads++;return Reflect.ownKeys(target);},getOwnPropertyDescriptor(target,key){reads++;return Reflect.getOwnPropertyDescriptor(target,key);}}):page;}};
  const result=await f.host(wrapped).read({turn_id:'page'}).then(()=>null,error=>error);assert.equal(reads,0,shape+' ran active data behavior');assert.ok(promiseReads<=1,'host added Promise assimilation of a rejected Proxy');assert.ok(result instanceof ArgoError);assert.equal(result.code,'INVALID_CONTRACT');
 }
});

test('host wrappers preserve original ledger passive capability validation',async t=>{
 const f=await setup(t);let traps=0;const active=Object.defineProperty({...f.ledger},'submit',{get(){traps++;return f.ledger.submit;}});
 assert.throws(()=>f.host(active));assert.equal(traps,0);
 assert.throws(()=>f.host(new Proxy(f.ledger,{getOwnPropertyDescriptor(target,key){traps++;return Reflect.getOwnPropertyDescriptor(target,key);},get(target,key,receiver){traps++;return Reflect.get(target,key,receiver);}})));assert.equal(traps,0);
});

test('model cache identity is stable within a fixed conversation and isolated across policy bindings',async t=>{
 const f=await setup(t),h=f.host();await h.turn({turn_id:'cache_one',text:'Hello'});await h.turn({turn_id:'cache_two',text:'Tell me more.'});
 const requests=f.requests as {prompt_cache_key:string;previous_response_id?:string}[];assert.match(requests[0]!.prompt_cache_key,/^[a-f0-9]{64}$/);assert.equal(requests[1]!.prompt_cache_key,requests[0]!.prompt_cache_key);
 const second=await openWorldConversationStore({...f.options,path:join(f.dir,'other-policy.sqlite'),policy:{...f.options.policy,provider_policy_id:'test_v2'}});f.stores.push(second);
 await f.host(f.ledger,second).turn({turn_id:'cache_one',text:'A separate policy.'});assert.notEqual(requests[2]!.prompt_cache_key,requests[0]!.prompt_cache_key);assert.ok(requests.every(r=>r.previous_response_id===undefined));
});
