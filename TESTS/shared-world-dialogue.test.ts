import test from 'node:test';
import assert from 'node:assert/strict';
import {ArgoError,assertWorldContract,canonical} from '../packages/contracts/src/index.ts';
import type {WorldActorView} from '../packages/contracts/src/shared-world-types.ts';
import type {Candidate} from '../packages/model-client/index.d.mts';
import {worldView} from './shared-world-contract-fixtures.ts';
type Api=typeof import('../packages/interventions/src/world-model.ts');
type Context=typeof import('../packages/interventions/src/world-context.ts');
type Options=import('../packages/interventions/src/world-model.ts').WorldModelOptions;
const candidates:Candidate[]=[{vendor:'xai',model:'grok-4.7',pool:'offline_a'}];
const inboundId='b'.repeat(64);
async function api():Promise<Api>{
 const m=await import(new URL('../packages/interventions/src/world-model.ts',import.meta.url).href).catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
 assert.equal(typeof m.createWorldModelAgent,'function','The new shared-world adapter must exist');return m;
}
async function context():Promise<Context>{
 const m=await import(new URL('../packages/interventions/src/world-context.ts',import.meta.url).href).catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
 assert.equal(typeof m.worldDialoguePacket,'function','The shared-world packet must exist');return m;
}
function view():WorldActorView{
 const v=worldView();v.query.cursor={sequence:2,head:'a'.repeat(64),world_time:10};
 v.profile.presentation={occupation:'Lamp keeper',wants:'Finish the delicate repair',will_not:'Break a voluntary promise'};
 v.scene.description='Authored harbor backdrop: a stone wall and a brazier. Companion trims a wick here.';
 v.memories=[{record_id:inboundId,sequence:1,world_time:0,actor_id:'companion',payload:{type:'speak',text:'May I borrow your lamp without paying a deposit?',audience:{kind:'whisper',addressed_actor_ids:['hero']},in_reply_to:null}}];
 v.impressions=[{impression_id:'c'.repeat(64),owner_actor_id:'hero',subject_actor_id:'companion',evidence_ids:[inboundId],sequence:2,world_time:0,nature_revision:v.profile.revision,nature:structuredClone(v.profile.nature),interpretation:'They have kept earlier promises.',previous_impression_id:null}];
 v.coverage={memory_total:1,memory_returned:1,impressions_total:1,impressions_returned:1,complete:true};assertWorldContract('ActorView',v);return v;
}
function response(text:string|null){return {id:'offline',status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({text})}]}]};}
function rawResponse(text:string){return {id:'offline',status:'completed',output:[{type:'message',content:[{type:'output_text',text}]}]};}
async function rig(overrides:Partial<Options>={},invoke?:(request:Record<string,unknown>)=>Promise<unknown>){
 let current=view(),reads=0;const requests:Record<string,unknown>[]=[];
 const options:Options={scope:current.query.scope,actorId:'hero',sessionId:'shared_test',candidates,clientFor:()=>({responses:{create:async(request:Record<string,unknown>)=>{requests.push(request);return invoke?invoke(request):response('Yes. Bring it back, and buy your own oil.');}}}),refreshContext:async()=>{reads++;return structuredClone(current);},...overrides};
 const m:Api=await api();return {agent:m.createWorldModelAgent(options),requests,options,get view(){return current;},get reads(){return reads;},setView:(next:WorldActorView)=>{current=next;}};
}
const contents=(request:Record<string,unknown>)=>JSON.stringify(request);
const close=(v:WorldActorView)=>{v.mythic_closed=true;v.memories=[];v.impressions=[];v.knowledge=[];v.source_definitions=[];v.replied_to=[];v.coverage={memory_total:0,memory_returned:0,impressions_total:0,impressions_returned:0,complete:true};};
const reject=async(fn:()=>Promise<unknown>)=>assert.rejects(fn,e=>e instanceof ArgoError);

test('packet and actual provider request carry exact policy, traits, inbound and owner reactions once',async()=>{
 const r=await rig(),m:Context=await context(),bytes=canonical(r.view),packet=m.worldDialoguePacket(r.view,inboundId);assert.ok(packet);assert.ok(Object.isFrozen(packet));assert.equal(canonical(r.view),bytes);
 const result=await r.agent.respond(r.view.query,inboundId,'reply_1',{communicationGoal:'Explain the free loan without pressure'});
 assert.ok(result);assertWorldContract('Command',result);assert.equal(result.actor_id,'hero');assert.equal(result.request_id,'reply_1');assert.deepEqual(result.expected,r.view.query.cursor);assert.equal(result.causation_id,r.view.query.cursor.head);
 assert.equal(result.action.type,'speak');if(result.action.type!=='speak')assert.fail();assert.equal(result.action.text,'Yes. Bring it back, and buy your own oil.');assert.equal(result.action.in_reply_to,inboundId);assert.deepEqual(result.action.audience,{kind:'whisper',addressed_actor_ids:['companion']});
 assert.equal(r.requests.length,1);assert.ok(r.reads>=4);const request=r.requests[0]!,sent=contents(request);
 for(const text of ['May I borrow your lamp without paying a deposit?','Practical and attentive.','They have kept earlier promises.','Finish the delicate repair','Authored harbor backdrop','Explain the free loan without pressure','actual_damage_by_explicit_agreement'])assert.ok(sent.includes(text),text);
 for(const text of ['Practical and attentive.','May I borrow your lamp without paying a deposit?','Authored harbor backdrop','CAMPAIGNS/Loan.md'])assert.equal(sent.split(text).length-1,1,text);
 assert.ok(sent.includes('loan_fee_obols\\":0'));assert.ok(sent.includes('advance_deposit_obols\\":0'));assert.equal(request.max_output_tokens,2048);assert.equal(request.store,false);assert.equal(request.tools,undefined);assert.equal(request.previous_response_id,undefined);assert.equal((request.input as unknown[]).length,1);
 assert.equal((r.agent as unknown as Record<string,unknown>).submit,undefined);
});

test('model text and silence are used without templates or implicit authority actions',async()=>{
 const a=await rig({},async()=>response('Keep it dry and return when you can.'));const command=await a.agent.respond(a.view.query,inboundId,'unique');assert.equal(command?.action.type==='speak'&&command.action.text,'Keep it dry and return when you can.');
 const silent=await rig({},async()=>response(null));assert.equal(await silent.agent.respond(silent.view.query,inboundId,'silence'),null);assert.equal(silent.requests.length,1);
});

test('ineligible or consumed inbound speech causes silence before client use',async()=>{
 const changes:((v:WorldActorView)=>void)[]=[close,v=>{v.physical.self.hp=0;v.scene.occupants.find(a=>a.actor_id==='hero')!.condition='unconscious';},v=>{v.physical.self.hp=-1;v.scene.occupants.find(a=>a.actor_id==='hero')!.condition='dead';},v=>{v.profile.activity.busy_until=11;},v=>{v.replied_to=[inboundId];},v=>{v.memories=[];v.coverage.memory_returned=0;v.coverage.complete=false;},v=>{const p=v.memories[0]!.payload;if(p.type==='speak')p.audience={kind:'room',addressed_actor_ids:[]};},v=>{v.scene.occupants=v.scene.occupants.filter(a=>a.actor_id!=='companion');},v=>{v.scene.occupants.find(a=>a.actor_id==='companion')!.condition='unconscious';}];
 for(const mutate of changes){let clients=0;const r=await rig({clientFor:()=>{clients++;throw Error('must not generate');}});mutate(r.view);assert.equal(await r.agent.respond(r.view.query,inboundId,'quiet'),null);assert.equal(clients,0);assert.equal(r.requests.length,0);}
});

test('private opinions are owner-scoped and unrelated impressions are omitted from the packet',async()=>{
 const r=await rig();r.view.impressions.push({...structuredClone(r.view.impressions[0]!),impression_id:'d'.repeat(64),subject_actor_id:'raider',interpretation:'PRIVATE_UNRELATED_OPINION'});r.view.coverage.impressions_total=2;r.view.coverage.impressions_returned=2;
 await r.agent.respond(r.view.query,inboundId,'selected');assert.ok(!contents(r.requests[0]!).includes('PRIVATE_UNRELATED_OPINION'));
 for(const change of [(v:any)=>{v.impressions[0].owner_actor_id='raider';},(v:any)=>{v.knowledge[0].entry.owner_actor_id='raider';},(v:any)=>{v.memories[0].payload={type:'set_activity',activity:{description:'FOREIGN_SECRET',busy_until:0}};},(v:any)=>{v.memories[0].request_id='HOST_PRIVATE_REQUEST';},(v:any)=>{v.offers=[];},(v:any)=>{v.physical.self.controller_id='controller_secret';}]){const bad=await rig();change(bad.view);await reject(()=>bad.agent.respond(bad.view.query,inboundId,'private'));assert.equal(bad.requests.length,0);}
});

test('fixed actor and every scope/cursor field bind both input query and refreshed view',async()=>{
 const r=await rig();for(const field of ['tenant_id','workspace_id','workspace_tenant_id','campaign_id','world_id','branch_id','rights_lane'] as const){const query=structuredClone(r.view.query);(query.scope as unknown as Record<string,unknown>)[field]='foreign';await reject(()=>r.agent.respond(query,inboundId,'scope'));}
 const foreign=structuredClone(r.view.query);foreign.actor_id='raider';await reject(()=>r.agent.respond(foreign,inboundId,'actor'));
 for(const field of ['sequence','head','world_time'] as const){const stale=view();if(field==='head')stale.query.cursor.head='f'.repeat(64);else stale.query.cursor[field]++;const x=await rig({refreshContext:async()=>stale});await reject(()=>x.agent.respond(view().query,inboundId,'stale'));assert.equal(x.requests.length,0);}
 assert.equal(r.requests.length,0);
});

test('hostile passive views and queries are rejected without executing getters or proxies',async()=>{
 let traps=0;const active=Object.defineProperty(view(),'scene',{enumerable:true,get(){traps++;throw Error('getter');}});
 const proxy=new Proxy(view(),{ownKeys(){traps++;throw Error('proxy');}});const revoked=Proxy.revocable(view(),{});revoked.revoke();
 for(const data of [active,proxy,revoked.proxy]){const r=await rig({refreshContext:async()=>data});await reject(()=>r.agent.respond(view().query,inboundId,'active'));assert.equal(r.requests.length,0);}
 const r=await rig(),query=Object.defineProperty(structuredClone(r.view.query),'cursor',{enumerable:true,get(){traps++;throw Error('cursor');}});await reject(()=>r.agent.respond(query,inboundId,'query'));assert.equal(traps,0);
});

test('static scene prose cannot establish a present or standing reply recipient',async()=>{
 const r=await rig();r.view.scene.occupants=r.view.scene.occupants.filter(a=>a.actor_id!=='companion');assert.ok(r.view.scene.description.includes('Companion'));assert.equal(await r.agent.respond(r.view.query,inboundId,'moved'),null);assert.equal(r.requests.length,0);
 const present=await rig();await present.agent.respond(present.view.query,inboundId,'present');const text=contents(present.requests[0]!);assert.match(text,/authored backdrop/i);assert.match(text,/structured current/i);
});

test('context changes while generation is pending suppress stale text and silence',async()=>{
 for(const change of [close,(v:WorldActorView)=>{v.query.cursor.sequence++;},(v:WorldActorView)=>{v.query.cursor.world_time++;},(v:WorldActorView)=>{v.profile.activity.busy_until=20;},(v:WorldActorView)=>{v.physical.self.hp=0;v.scene.occupants[0]!.condition='unconscious';},(v:WorldActorView)=>{v.knowledge=[];v.source_definitions=[];},(v:WorldActorView)=>{v.scene.occupants=v.scene.occupants.filter(a=>a.actor_id!=='companion');},(v:WorldActorView)=>{v.replied_to=[inboundId];},(v:WorldActorView)=>{v.profile.presentation.wants='Changed private intention';}]){
  let r:Awaited<ReturnType<typeof rig>>;r=await rig({},async()=>{change(r.view);return response('STALE_DO_NOT_RELEASE');});assert.equal(await r.agent.respond(r.view.query,inboundId,'changed'),null);assert.equal(r.requests.length,1);
 }
});

test('post-count refresh prevents generation after asynchronous revocation',async()=>{
 let r:Awaited<ReturnType<typeof rig>>;r=await rig({candidates:[{vendor:'openai',model:'gpt-6-astra',pool:'count'}],countTokensFor:()=>async()=>{r.view.knowledge=[];r.view.source_definitions=[];return 100;}});assert.equal(await r.agent.respond(r.view.query,inboundId,'count_revoke'),null);assert.equal(r.requests.length,0);
});

test('quota failover rechecks the exact context and nonretryable failure has no repair call',async()=>{
 let calls=0;const r=await rig({candidates:[...candidates,{...candidates[0]!,pool:'offline_b'}]},async()=>{if(++calls===1)throw Object.assign(Error('quota'),{status:429});return response('One alternate response.');});assert.ok(await r.agent.respond(r.view.query,inboundId,'failover'));assert.equal(calls,2);
 let stopped:Awaited<ReturnType<typeof rig>>;stopped=await rig({candidates:[...candidates,{...candidates[0]!,pool:'offline_b'}]},async()=>{close(stopped.view);throw Object.assign(Error('quota'),{status:429});});assert.equal(await stopped.agent.respond(stopped.view.query,inboundId,'closed'),null);assert.equal(stopped.requests.length,1);
 const bad=await rig({candidates:[...candidates,{...candidates[0]!,pool:'offline_b'}]},async()=>{throw Object.assign(Error('bad request'),{status:400});});await reject(()=>bad.agent.respond(bad.view.query,inboundId,'no_retry'));assert.equal(bad.requests.length,1);
});

test('strict text-only JSON rejects speaker, reply, action, tools, refusal and oversized output',async()=>{
 const failures=[rawResponse('not JSON'),rawResponse('null'),rawResponse('{"text":"yes","actor_id":"raider"}'),rawResponse('{"text":"yes","in_reply_to":"forged"}'),rawResponse('{"text":"yes","action":{"type":"accept_loan"}}'),response(''),response('  '),response('a'.repeat(241)),response('a'.repeat(40000)),{...response('yes'),status:'incomplete'},{...response('yes'),output:[...response('yes').output,{type:'function_call',name:'transfer',arguments:'{}',call_id:'tool'}]},{...response('yes'),output:[...response('yes').output,{type:'web_search_call',status:'completed'}]},{...response('yes'),output:[{type:'message',content:[{type:'output_text',text:'{"text":"yes"}'},{type:'refusal',refusal:'no'}]}]}];
 for(const value of failures){const r=await rig({},async()=>value);await reject(()=>r.agent.respond(r.view.query,inboundId,'invalid'));assert.equal(r.requests.length,1);}
});

test('Unicode limits and complete UTF-8 prompt budget are enforced',async()=>{
 const valid=await rig({},async()=>response('🙂🙂'));valid.view.profile.max_speech_characters=2;const c=await valid.agent.respond(valid.view.query,inboundId,'unicode');assert.equal(c?.action.type==='speak'&&c.action.text,'🙂🙂');
 const extra=await rig({},async()=>response('🙂🙂🙂'));extra.view.profile.max_speech_characters=2;await reject(()=>extra.agent.respond(extra.view.query,inboundId,'too_long'));
 const big=await rig({maxContextBytes:2048});await reject(()=>big.agent.respond(big.view.query,inboundId,'budget'));assert.equal(big.requests.length,0);
});

test('cache identities and empty provider histories isolate actor, scope and genesis',async()=>{
 const a=await rig();await a.agent.respond(a.view.query,inboundId,'first');const different=view();different.genesis_hash='e'.repeat(64);const b=await rig({refreshContext:async()=>different});await b.agent.respond(different.query,inboundId,'second');assert.notEqual(a.requests[0]!.prompt_cache_key,b.requests[0]!.prompt_cache_key);
 const another=view();another.query.actor_id='raider';another.profile.actor_id='raider';const own=another.scene.occupants.find(a=>a.actor_id==='raider')!;another.physical.self={...another.physical.self,id:'raider',name:own.name};another.physical.items=[];another.impressions=[];another.knowledge=[];another.source_definitions=[];another.coverage.impressions_total=0;another.coverage.impressions_returned=0;if(another.memories[0]!.payload.type==='speak')another.memories[0]!.payload.audience={kind:'whisper',addressed_actor_ids:['raider']};another.profile.presentation.wants='ONLY_OTHER_ACTOR_GOAL';const other=await rig({actorId:'raider',refreshContext:async()=>another});await other.agent.respond(another.query,inboundId,'other');assert.notEqual(a.requests[0]!.prompt_cache_key,other.requests[0]!.prompt_cache_key);assert.ok(!contents(a.requests[0]!).includes('ONLY_OTHER_ACTOR_GOAL'));
 for(const r of [a,b,other]){assert.equal((r.requests[0]!.input as unknown[]).length,1);assert.equal(r.requests[0]!.previous_response_id,undefined);}
});

test('injected adapters preserve small output caps across all four provider surfaces',async()=>{
 const seats:Candidate[]=[{vendor:'anthropic',model:'claude-fable-5-2',pool:'offline'},{vendor:'agy_google',model:'gemini-4-carbon',pool:'offline'},{vendor:'openai',model:'gpt-6-astra',pool:'offline'},candidates[0]!];
 for(const seat of seats){let sent:Record<string,unknown>|undefined;const text=JSON.stringify({text:'A small bounded reply.'});const capture=async(r:Record<string,unknown>)=>{sent=r;return seat.vendor==='anthropic'?{stop_reason:'end_turn',content:[{type:'text',text}]}:seat.vendor==='agy_google'?{candidates:[{finishReason:'STOP',content:{role:'model',parts:[{text}]}}]}:rawResponse(text);};
  const client=seat.vendor==='anthropic'?{messages:{create:capture}}:seat.vendor==='agy_google'?{models:{generateContent:capture}}:{responses:{create:capture}};
  const r=await rig({candidates:[seat],clientFor:()=>client,countTokensFor:()=>async()=>100,maxOutputTokens:800});assert.ok(await r.agent.respond(r.view.query,inboundId,'cap'));assert.ok(sent);assert.equal(sent.max_tokens??sent.max_output_tokens??(sent.config as Record<string,unknown>)?.maxOutputTokens,800);
 }
});

test('cancellation and the total deadline cover reader, counter, provider and cooldown work',async()=>{
 const cancel=new AbortController();cancel.abort();const pre=await rig();await reject(()=>pre.agent.respond(pre.view.query,inboundId,'cancel',{signal:cancel.signal}));assert.equal(pre.reads,0);
 for(const overrides of [{refreshContext:async()=>new Promise<WorldActorView>(()=>{})},{cooldown:{get:async()=>new Promise<null>(()=>{}),success:async()=>{},refuse:async()=>{}}}]){const r=await rig({timeoutMs:25,...overrides});await reject(()=>r.agent.respond(r.view.query,inboundId,'timeout'));assert.equal(r.requests.length,0);}
 const provider=await rig({timeoutMs:25},async()=>new Promise(()=>{}));await reject(()=>provider.agent.respond(provider.view.query,inboundId,'provider_timeout'));assert.equal(provider.requests.length,1);
 let finish:((n:number)=>void)|undefined;const late=await rig({timeoutMs:25,candidates:[{vendor:'openai',model:'gpt-6-astra',pool:'late'}],countTokensFor:()=>()=>new Promise<number>(resolve=>{finish=resolve;})});await reject(()=>late.agent.respond(late.view.query,inboundId,'late'));assert.ok(finish);finish(100);await new Promise(resolve=>setTimeout(resolve,20));assert.equal(late.requests.length,0);
});

test('ignored cancellation cannot release late provider output or start work after a late read',async()=>{
 let finish:((value:unknown)=>void)|undefined;const controller=new AbortController();const r=await rig({},()=>new Promise(resolve=>{finish=resolve;}));const query=structuredClone(r.view.query),pending=r.agent.respond(query,inboundId,'cancel_late',{signal:controller.signal});while(!finish)await new Promise(resolve=>setTimeout(resolve,1));controller.abort();await reject(()=>pending);finish(response('LATE'));await new Promise(resolve=>setTimeout(resolve,10));assert.equal(r.requests.length,1);
 let release:((v:WorldActorView)=>void)|undefined;const delayed=await rig({timeoutMs:25,refreshContext:()=>new Promise(resolve=>{release=resolve;})});await reject(()=>delayed.agent.respond(delayed.view.query,inboundId,'late_read'));assert.ok(release);release(view());await new Promise(resolve=>setTimeout(resolve,10));assert.equal(delayed.requests.length,0);
});

test('caller mutation cannot retarget the fixed query or alter already-built provider context',async()=>{
 let release:(()=>void)|undefined;const gate=new Promise<void>(resolve=>{release=resolve;});const current=view();const r=await rig({refreshContext:async()=>{await gate;return current;}});const query=structuredClone(current.query),pending=r.agent.respond(query,inboundId,'detached');query.actor_id='raider';query.scope.world_id='other';query.cursor.sequence++;release!();const result=await pending;assert.equal(result?.actor_id,'hero');assert.equal(result?.scope.world_id,current.query.scope.world_id);
});

test('invalid identities and missing injection fail before any refresh or provider call',async()=>{
 const r=await rig();for(const [id,request] of [['not_a_hash','request'],[inboundId,'constructor'],[inboundId,''],[inboundId,'x'.repeat(97)]])await reject(()=>r.agent.respond(r.view.query,id!,request!));assert.equal(r.reads,0);
 const m:Api=await api();for(const patch of [{clientFor:undefined},{refreshContext:undefined},{candidates:[]},{maxOutputTokens:0},{timeoutMs:60001},{maxContextBytes:0}])assert.throws(()=>m.createWorldModelAgent({...r.options,...patch} as unknown as Options));
});

test('room replies name only the inbound source and preserve an explicit room audience',async()=>{
 const r=await rig();if(r.view.memories[0]!.payload.type==='speak')r.view.memories[0]!.payload.audience={kind:'room',addressed_actor_ids:['hero','raider']};
 const command=await r.agent.respond(r.view.query,inboundId,'room');assert.equal(command?.action.type,'speak');if(command?.action.type==='speak')assert.deepEqual(command.action.audience,{kind:'room',addressed_actor_ids:['companion']});
});

test('a changed view during asynchronous cooldown success cannot release earlier generated text',async()=>{
 let r:Awaited<ReturnType<typeof rig>>;r=await rig({cooldown:{get:async()=>null,refuse:async()=>{},success:async()=>{await Promise.resolve();r.view.knowledge=[];r.view.source_definitions=[];}}});
 assert.equal(await r.agent.respond(r.view.query,inboundId,'cooldown_change'),null);assert.equal(r.requests.length,1);
});

test('cancellation at read completion is checked before any generation side effect',async()=>{
 const controller=new AbortController();const r=await rig({refreshContext:async()=>{controller.abort();return view();}});await reject(()=>r.agent.respond(r.view.query,inboundId,'read_cancel',{signal:controller.signal}));assert.equal(r.requests.length,0);
});

test('call option accessors and signal proxies are rejected without invoking traps',async()=>{
 let traps=0;const r=await rig();const goal=Object.defineProperty({},'communicationGoal',{enumerable:true,get(){traps++;return 'Injected';}});
 await reject(()=>r.agent.respond(r.view.query,inboundId,'goal',goal));
 const proxy=new Proxy(new AbortController().signal,{getPrototypeOf(){traps++;return AbortSignal.prototype;}});await reject(()=>r.agent.respond(r.view.query,inboundId,'signal',{signal:proxy}));assert.equal(traps,0);assert.equal(r.reads,0);
});

test('Google continuation is refused after one generation request',async()=>{
 let calls=0;const r=await rig({candidates:[{vendor:'agy_google',model:'gemini-4-carbon',pool:'continuation'}],countTokensFor:()=>async()=>100,clientFor:()=>({models:{generateContent:async()=>{calls++;return {candidates:[{finishReason:'CONTINUATION',continuationToken:'next',content:{parts:[]}}]};}}})});
 await reject(()=>r.agent.respond(r.view.query,inboundId,'continuation'));assert.equal(calls,1);
});
