import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createCharacterAgent} from '../packages/interventions/src/characters.ts';
import {createCharacterNarrator} from '../packages/argo-dm/src/characters.ts';
import {CHARACTER_PROFILE,assertCharacterContract} from '../packages/contracts/src/index.ts';
import type {CharacterView,CharacterExperience,CharacterNarratorQuery,CharacterNarratorView,CharacterImpression} from '../packages/contracts/src/index.ts';
import {scope} from './fixtures.ts';

const recordId='a'.repeat(64),previousId='b'.repeat(64);
const experience=():CharacterExperience=>({record_id:recordId,kind:'speech',actor_id:'traveler',principal_actor_id:'traveler',sequence:2,world_time:10,text:'Would you mind opening the gate?',action_type:null,addressed_actor_ids:['keeper']});
const actorView=():CharacterView=>({query:{version:CHARACTER_PROFILE,scope:structuredClone(scope),cursor:{sequence:5,head:'c'.repeat(64),world_time:20},actor_id:'keeper'},profile:{actor_id:'keeper',revision:2,nature:{description:'Suspicious, patient and devoted to the gate.',priorities:['Duty','Plain speech']},activity:{description:'Watching the road',busy_until:20},speech_policy:{max_characters:24,minimum_interval:5}},alive:true,last_spoke_at:10,impressions:[],experiences:[experience()],ontology_blocked:false,engagement_closed:false});
const prior=():CharacterImpression=>({impression_id:previousId,sequence:3,world_time:10,data:{owner_actor_id:'keeper',subject_actor_id:'traveler',evidence_ids:[recordId],nature_revision:1,nature:{description:'Cautious',priorities:[]},interpretation:'Polite, though unknown.',previous_impression_id:null}});
const query=():CharacterNarratorQuery=>({version:CHARACTER_PROFILE,scope:structuredClone(scope),cursor:{sequence:5,head:'c'.repeat(64),world_time:20},traveler_id:'traveler',actor_id:'traveler',audience:'actor',party_id:null,after_sequence:0,limit:16});
const page=(q=query()):CharacterNarratorView=>({query:structuredClone(q),records:[experience()],coverage:{activation_sequence:1,through_sequence:5,captured_kinds:['speech','action']},next_after_sequence:null,ontology_blocked:false,engagement_closed:false});
const stopped=(q=query()):CharacterNarratorView=>({...page(q),records:[],ontology_blocked:true,engagement_closed:true});
const candidates=[{vendor:'xai' as const,model:'grok-4.7',pool:'offline'}];
const completed=(text='The gate remained a gate. A rare display of consistency.')=>({status:'completed',id:'response',output:[{type:'message',content:[{type:'output_text',text}]}]});

test('character interpretation builds an observer-owned proposal through its own nature and predecessor',async()=>{
 const view=actorView();view.impressions=[prior()];let contextSeen:unknown;
 const agent=createCharacterAgent({actorId:'keeper',interpret:async context=>{contextSeen=context;return 'Still polite. Still not my reason to abandon the gate.';},speak:async()=>null});
 const result=await agent.impress(view,'traveler',[recordId],'impress_1');
 assert.deepEqual(result,{version:'character-memory/1.0.0',scope,request_id:'impress_1',expected_cursor:{sequence:5,head:'c'.repeat(64),world_time:20},body:{type:'form_impression',subject_actor_id:'traveler',evidence_ids:[recordId],interpretation:'Still polite. Still not my reason to abandon the gate.',previous_impression_id:previousId}});
 const seen=contextSeen as {view:CharacterView;evidence:CharacterExperience[];previous:CharacterImpression};
 assert.equal(seen.view.profile!.nature.description,'Suspicious, patient and devoted to the gate.');
 assert.equal(seen.evidence[0]!.text,'Would you mind opening the gate?');assert.equal(seen.previous.impression_id,previousId);
 assert.deepEqual(Object.keys(agent).sort(),['impress','respond']);
 assert.equal('ledger' in seen,false);assert.equal('narrator' in seen,false);assert.equal('projection' in seen,false);
 assert.equal(view.impressions[0]!.data.interpretation,'Polite, though unknown.');
 assertCharacterContract('CharacterCommand',result);
});
test('an impression cannot use unseen evidence, another subject or another observers view',async()=>{
 let calls=0;const agent=createCharacterAgent({actorId:'keeper',interpret:async()=>{calls++;return 'Wrong';},speak:async()=>null});
 await assert.rejects(agent.impress(actorView(),'traveler',['f'.repeat(64)],'unseen'),{code:'UNAUTHORIZED'});
 await assert.rejects(agent.impress(actorView(),'outsider',[recordId],'wrong_subject'),{code:'UNAUTHORIZED'});
 const other=actorView();other.query.actor_id='outsider';other.profile!.actor_id='outsider';
 await assert.rejects(agent.impress(other,'traveler',[recordId],'wrong_actor'),{code:'UNAUTHORIZED'});
 assert.equal(calls,0);
});
test('character callbacks may decline and ended or unconfigured characters never interpret',async()=>{
 let calls=0;const agent=createCharacterAgent({actorId:'keeper',interpret:async()=>{calls++;return null;},speak:async()=>null});
 assert.equal(await agent.impress(actorView(),'traveler',[recordId],'decline'),null);assert.equal(calls,1);
 const ended=actorView();ended.alive=false;assert.equal(await agent.impress(ended,'traveler',[recordId],'ended'),null);
 const unconfigured=actorView();unconfigured.profile=null;assert.equal(await agent.impress(unconfigured,'traveler',[recordId],'unconfigured'),null);
 const blocked=actorView();blocked.ontology_blocked=true;assert.equal(await agent.impress(blocked,'traveler',[recordId],'blocked'),null);assert.equal(calls,1);
});
test('busy, ended, unaddressed, self-addressed and cooldown-bound characters stay silent without planning',async()=>{
 let calls=0;const agent=createCharacterAgent({actorId:'keeper',interpret:async()=>null,speak:async()=>{calls++;return 'No.';}});
 const variants:CharacterView[]=[];
 const busy=actorView();busy.profile!.activity.busy_until=21;variants.push(busy);
 const ended=actorView();ended.alive=false;variants.push(ended);
 const absent=actorView();absent.experiences[0]!.addressed_actor_ids=[];variants.push(absent);
 const own=actorView();own.experiences[0]!.actor_id='keeper';own.experiences[0]!.principal_actor_id='keeper';variants.push(own);
 const cooldown=actorView();cooldown.last_spoke_at=19;variants.push(cooldown);
 const blocked=actorView();blocked.ontology_blocked=true;variants.push(blocked);
 const unconfigured=actorView();unconfigured.profile=null;variants.push(unconfigured);
 for(const value of variants)assert.equal(await agent.respond(value,recordId,'silent'),null);
 assert.equal(await agent.respond(actorView(),'f'.repeat(64),'unknown'),null);assert.equal(calls,0);
});
test('an eligible addressed character returns only a bounded speech proposal at the supplied cursor',async()=>{
 let contextSeen:unknown;const agent=createCharacterAgent({actorId:'keeper',interpret:async()=>null,speak:async context=>{contextSeen=context;return 'The gate stays shut.';}});
 const result=await agent.respond(actorView(),recordId,'answer');
 assert.deepEqual(result,{version:'character-memory/1.0.0',scope,request_id:'answer',expected_cursor:{sequence:5,head:'c'.repeat(64),world_time:20},body:{type:'speak',text:'The gate stays shut.',addressed_actor_ids:['traveler']}});
 assert.equal((contextSeen as {record:CharacterExperience}).record.record_id,recordId);assertCharacterContract('CharacterCommand',result);
});
test('speech respects the configured Unicode code-point budget and never truncates planner output',async()=>{
 const view=actorView();view.profile!.speech_policy.max_characters=2;
 const good=createCharacterAgent({actorId:'keeper',interpret:async()=>null,speak:async()=>'🙂🙂'});
 assert.equal((await good.respond(view,recordId,'unicode'))?.body.type,'speak');
 const long=createCharacterAgent({actorId:'keeper',interpret:async()=>null,speak:async()=>'🙂🙂!'});
 await assert.rejects(long.respond(view,recordId,'too_long'),{code:'INVALID_CONTRACT'});
 const empty=createCharacterAgent({actorId:'keeper',interpret:async()=>null,speak:async()=>''});await assert.rejects(empty.respond(view,recordId,'empty'),{code:'INVALID_CONTRACT'});
});
test('caller mutations during character planning cannot change the callback view or returned proposal',async()=>{
 const view=actorView();const evidence=[recordId];let release:()=>void=()=>{},entered:()=>void=()=>{};
 const ready=new Promise<void>(resolve=>entered=resolve),wait=new Promise<void>(resolve=>release=resolve);
 const agent=createCharacterAgent({actorId:'keeper',interpret:async context=>{entered();await wait;assert.equal(context.view.profile!.nature.description,'Suspicious, patient and devoted to the gate.');assert.equal(context.evidence[0]!.text,'Would you mind opening the gate?');assert(Object.isFrozen(context.view));return 'The request is ordinary.';},speak:async()=>null});
 const result=agent.impress(view,'traveler',evidence,'detached');await ready;view.query.cursor.sequence=50;view.profile!.nature.description='INJECTED';view.experiences[0]!.text='INJECTED';evidence[0]='f'.repeat(64);release();
 const command=await result;assert.equal(command?.expected_cursor.sequence,5);assert.equal(command?.body.type,'form_impression');if(command?.body.type==='form_impression')assert.deepEqual(command.body.evidence_ids,[recordId]);
});
test('character cancellation and deadline do not produce proposals after a late callback',async()=>{
 const controller=new AbortController();const agent=createCharacterAgent({actorId:'keeper',interpret:async()=>null,speak:async()=>{controller.abort();return 'No.';}});
 await assert.rejects(agent.respond(actorView(),recordId,'cancel',{signal:controller.signal}),{code:'CANCELLED'});
 let late:((value:string)=>void)|undefined;const timed=createCharacterAgent({actorId:'keeper',timeoutMs:10,interpret:async()=>null,speak:async()=>new Promise<string>(resolve=>late=resolve)});
 await assert.rejects(timed.respond(actorView(),recordId,'timeout'),{code:'UNAVAILABLE'});late?.('Too late.');
});
test('narration sends the world-external voice and only a filtered record page to an injected provider',async()=>{
 let request:Record<string,unknown>|undefined,loads=0;
 const client={responses:{create:async(value:Record<string,unknown>)=>{request=value;return completed();}}};
 const narrator=createCharacterNarrator({scope,sessionId:'session',candidates,clientFor:()=>client,refreshContext:async q=>{loads++;return page(q);}});
 const result=await narrator.narrate({query:query(),prompt:'Describe the encounter.',persona:'Plain Guide'});
 assert.equal(result,'The gate remained a gate. A rare display of consistency.');assert(loads>=2);
 const wire=JSON.stringify(request);assert(wire.includes('ARGO onlooker profile 1.0.0.'));assert.match(wire,/tired|weary/i);assert.match(wire,/sarcas/i);assert.match(wire,/outside|world-external/i);
 assert(wire.includes('Would you mind opening the gate?'));assert.equal(wire.includes('Suspicious, patient'),false);assert.equal(wire.includes('PRIVATE_SOLO_SECRET'),false);
 assert.equal(Object.hasOwn(request!,'tools'),false);assert.deepEqual(Object.keys(narrator),['narrate']);
});
test('narrator suppresses a cutoff before generation without invoking a provider',async()=>{
 let calls=0;const narrator=createCharacterNarrator({scope,sessionId:'s',candidates:[],clientFor:()=>{calls++;throw Error('must stay silent');},refreshContext:async q=>stopped(q)});
 assert.equal(await narrator.narrate({query:query(),prompt:'Explain it.'}), '');assert.equal(calls,0);
});
test('a cutoff suppresses presentation even when no model context can fit the configured byte budget',async()=>{
 let calls=0;const narrator=createCharacterNarrator({scope,sessionId:'s',maxContextBytes:1,candidates:[],clientFor:()=>{calls++;throw Error('must stay silent');},refreshContext:async q=>stopped(q)});
 assert.equal(await narrator.narrate({query:query(),prompt:'This must not be sent anywhere.'}), '');assert.equal(calls,0);
});
test('a changed authorized page suppresses generated prose even without a cutoff',async()=>{
 let generated=false;const client={responses:{create:async()=>{generated=true;return completed('OLD_AUTHORIZED_TEXT');}}};
 const narrator=createCharacterNarrator({scope,sessionId:'s',candidates,clientFor:()=>client,refreshContext:async q=>{const value=page(q);if(generated)value.records=[];return value;}});
 assert.equal(await narrator.narrate({query:query(),prompt:'Describe.'}), '');assert.equal(generated,true);
});
test('a current-prefix conflict after generation suppresses stale prose',async()=>{
 let generated=false;const client={responses:{create:async()=>{generated=true;return completed('STALE_AFTER_WORLD_COMMIT');}}};
 const narrator=createCharacterNarrator({scope,sessionId:'s',candidates,clientFor:()=>client,refreshContext:async q=>{if(generated)throw Object.assign(Error('Current character cursor changed'),{code:'CONFLICT'});return page(q);}});
 assert.equal(await narrator.narrate({query:query(),prompt:'Describe.'}), '');assert.equal(generated,true);
});
test('a cutoff arriving during generation suppresses output while retaining the archive on the host',async()=>{
 const archive=page();let generated=false;
 const client={responses:{create:async()=>{generated=true;return completed('FORBIDDEN_EXPOSITION');}}};
 const narrator=createCharacterNarrator({scope,sessionId:'s',candidates,clientFor:()=>client,refreshContext:async q=>generated?stopped(q):structuredClone(archive)});
 assert.equal(await narrator.narrate({query:query(),prompt:'Explain the vanished thread.'}), '');assert.equal(archive.records.length,1);
});
test('every retry rechecks disclosure and stops before a second provider call when it changes',async()=>{
 let calls=0;const shared=page();
 const client={responses:{create:async()=>{calls++;shared.records[0]!.text='PRIVATE_SOLO_SECRET';throw Object.assign(Error('retry'),{status:503,headers:{'retry-after':'0'}});}}};
 const narrator=createCharacterNarrator({scope,sessionId:'s',candidates,clientFor:()=>client,refreshContext:async()=>shared});
 assert.equal(await narrator.narrate({query:query(),prompt:'Describe.'}), '');assert.equal(calls,1);
});
test('narrator detaches mutable query and refreshed page before any provider request',async()=>{
 const supplied=query(),shared=page(supplied);let release:()=>void=()=>{},entered:()=>void=()=>{},captured='';
 const ready=new Promise<void>(resolve=>entered=resolve),wait=new Promise<void>(resolve=>release=resolve);let first=true;
 const client={responses:{create:async(req:unknown)=>{captured=JSON.stringify(req);return completed('safe');}}};
 const narrator=createCharacterNarrator({scope,sessionId:'s',candidates,clientFor:()=>client,refreshContext:async q=>{if(first){first=false;entered();await wait;}assert.equal(q.scope.world_id,'world');return shared;}});
 const result=narrator.narrate({query:supplied,prompt:'Describe.'});await ready;supplied.scope.world_id='FOREIGN_WORLD';supplied.limit=1;release();assert.equal(await result,'safe');assert.equal(captured.includes('FOREIGN_WORLD'),false);
});
test('narrator binds pagination and scope and refuses extra private fields before model invocation',async()=>{
 let calls=0;const client={responses:{create:async()=>{calls++;return completed();}}};
 for(const mutate of [(v:CharacterNarratorView)=>{v.query.limit=1;},(v:CharacterNarratorView)=>{v.query.scope.world_id='other';},(v:CharacterNarratorView)=>{Object.assign(v,{impressions:['PRIVATE_SOLO_SECRET']});}]){
  const narrator=createCharacterNarrator({scope,sessionId:'s',candidates,clientFor:()=>client,refreshContext:async q=>{const value=page(q);mutate(value);return value;}});
  await assert.rejects(narrator.narrate({query:query(),prompt:'Describe.'}));
 }
 assert.equal(calls,0);
});
test('narrator rejects oversized context explicitly rather than dropping records',async()=>{
 let calls=0;const client={responses:{create:async()=>{calls++;return completed();}}};
 const narrator=createCharacterNarrator({scope,sessionId:'s',maxContextBytes:64,candidates,clientFor:()=>client,refreshContext:async q=>page(q)});
 await assert.rejects(narrator.narrate({query:query(),prompt:'Describe.'}),{code:'INVALID_CONTRACT'});assert.equal(calls,0);
});
test('narrator cache identity separates traveler and private versus party delivery',async()=>{
 const keys:string[]=[];const client={responses:{create:async(req:Record<string,unknown>)=>{keys.push(String(req.prompt_cache_key));return completed();}}};
 const narrator=createCharacterNarrator({scope,sessionId:'same_session',candidates,clientFor:()=>client,refreshContext:async q=>{const value=page(q);value.records[0]!.actor_id=q.traveler_id;value.records[0]!.principal_actor_id=q.traveler_id;return value;}});
 await narrator.narrate({query:query(),prompt:'Describe.'});
 const party=query();party.audience='party';party.party_id='party';await narrator.narrate({query:party,prompt:'Describe.'});
 const other=structuredClone(party);other.traveler_id='other';await narrator.narrate({query:other,prompt:'Describe.'});
 assert.equal(keys.length,3);assert.equal(new Set(keys).size,3);
});
test('narrator caller cancellation after provider completion still propagates',async()=>{
 const controller=new AbortController();let generated=false;
 const client={responses:{create:async()=>{generated=true;return completed('CANCELLED_TEXT');}}};
 const narrator=createCharacterNarrator({scope,sessionId:'s',candidates,clientFor:()=>client,refreshContext:async q=>{if(generated)controller.abort();return page(q);}});
 await assert.rejects(narrator.narrate({query:query(),prompt:'Describe.',signal:controller.signal}),{code:'CANCELLED'});
});
test('active narrator inputs are refused without invoking getters or provider code',async()=>{
 let getters=0,calls=0;const client={responses:{create:async()=>{calls++;return completed();}}};
 const narrator=createCharacterNarrator({scope,sessionId:'s',candidates,clientFor:()=>client,refreshContext:async q=>page(q)});
 const input={prompt:'Describe.',get query(){getters++;return query();}};
 await assert.rejects(narrator.narrate(input),{code:'INVALID_CONTRACT'});assert.equal(getters,0);assert.equal(calls,0);
});
test('narrator refuses a completed provider envelope whose text is not prose',async()=>{
 const client={responses:{create:async()=>({...completed('unused'),output_text:{command:'grant_authority'}})}};
 const narrator=createCharacterNarrator({scope,sessionId:'s',candidates,clientFor:()=>client,refreshContext:async q=>page(q)});
 await assert.rejects(narrator.narrate({query:query(),prompt:'Describe.'}),{code:'UNAVAILABLE'});
});
test('narrator refuses provider tool calls instead of treating them as world actions',async()=>{
 const client={responses:{create:async()=>({status:'completed',id:'r',output:[{type:'function_call',name:'mutate_world',call_id:'forged',arguments:'{}'}]})}};
 const narrator=createCharacterNarrator({scope,sessionId:'s',candidates,clientFor:()=>client,refreshContext:async q=>page(q)});
 await assert.rejects(narrator.narrate({query:query(),prompt:'Describe.'}),{code:'UNAVAILABLE'});
});
