import test from 'node:test';
import assert from 'node:assert/strict';
import type {CharacterView} from '../packages/contracts/src/index.ts';
import type {Candidate} from '../packages/model-client/index.d.mts';
import type {CharacterModelOptions} from '../packages/interventions/src/character-model.ts';
import type {DialogueSupplement} from '../packages/interventions/src/dialogue-types.ts';
import {characterActorView} from './character-fixtures.ts';

async function factory(){
 const api=await import('../packages/interventions/src/index.ts');
 assert.equal(typeof api.createModelCharacterAgent,'function','The public model-backed character agent must be connected');
 return api.createModelCharacterAgent;
}
const seats:Candidate[]=[{vendor:'xai',model:'grok-4.7',pool:'offline_a'}];
function supplement(view:CharacterView):DialogueSupplement{return {version:'character-dialogue/0.1.0',query:structuredClone(view.query),source:{content_hash:'d'.repeat(64),revision:'test/1'},actor:{actor_id:view.query.actor_id,name:'Keeper',occupation:'Lamp repairer',wants:'Finish the repair',will_not:'Abandon a promise'},scene:{location_id:'workshop',name:'Workshop',description:'Stone walls, one window and a burning brazier.'}};}
function response(text:string|null){return {id:'offline',status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({text})}]}]};}
async function rig(overrides:Partial<CharacterModelOptions>={},invoke?:(request:Record<string,unknown>)=>Promise<unknown>){
 let view:CharacterView=characterActorView();const requests:Record<string,unknown>[]=[];
 const options:CharacterModelOptions={scope:view.query.scope,actorId:'witness',sessionId:'scene',candidates:seats,clientFor:()=>({responses:{create:async(request:Record<string,unknown>)=>{requests.push(request);return invoke?invoke(request):response('Put the lamp beside the window.');}}}),refreshContext:async()=>structuredClone(view),readSupplement:async()=>supplement(view),...overrides};
 return {agent:(await factory())(options),requests,get view(){return view;},setView:(next:CharacterView)=>{view=next;}};
}
const textOf=(r:Record<string,unknown>)=>JSON.stringify(r);

test('public model agent generates provider speech from addressed context without a dialogue template',async()=>{
 const r=await rig();const result=await r.agent.respond(r.view.query,r.view.experiences[0]!.record_id,'reply',{communicationGoal:'Acknowledge the returned lamp'});
 assert.equal(result?.body.type,'speak');if(result?.body.type!=='speak')assert.fail('Expected speech');
 assert.equal(result.body.text,'Put the lamp beside the window.');assert.deepEqual(result.body.addressed_actor_ids,['traveler']);assert.equal(r.requests.length,1);
 const request=r.requests[0]!,sent=textOf(request);
 for(const value of ['I returned the lamp.','A practical keeper of the workshop.','They kept their promise.','Finish the repair','Stone walls','Acknowledge the returned lamp'])assert.ok(sent.includes(value),value);
 assert.equal(sent.split('A practical keeper of the workshop.').length-1,1,'Nature is defined once, including impression history');
 assert.equal(sent.split('I returned the lamp.').length-1,1,'Incoming speech is included once');
 assert.equal(request.max_output_tokens,2048);assert.equal(request.store,false);assert.equal(request.tools,undefined);assert.equal(request.previous_response_id,undefined);
 assert.equal((request.input as unknown[]).length,1);assert.deepEqual(request.reasoning,{effort:'low'});
 const second=await rig({},async()=>response('Thank you. Set it down gently.'));
 const different=await second.agent.respond(second.view.query,second.view.experiences[0]!.record_id,'another');
 assert.equal(different?.body.type==='speak'&&different.body.text,'Thank you. Set it down gently.');
});

test('deterministic silence avoids provider and supplement calls',async()=>{
 for(const mutate of [(v:CharacterView)=>{v.alive=false;},(v:CharacterView)=>{v.ontology_blocked=true;},(v:CharacterView)=>{v.engagement_closed=true;v.ontology_blocked=true;},(v:CharacterView)=>{v.profile!.activity.busy_until=11;},(v:CharacterView)=>{v.last_spoke_at=10;},(v:CharacterView)=>{v.experiences[0]!.addressed_actor_ids=[];}]){
  let supplements=0;const r=await rig({readSupplement:async()=>{supplements++;return null;}});mutate(r.view);
  assert.equal(await r.agent.respond(r.view.query,r.view.experiences[0]!.record_id,'quiet'),null);assert.equal(r.requests.length,0);assert.equal(supplements,0);
 }
});

test('model silence and private impressions use their existing command forms',async()=>{
 const silent=await rig({},async()=>response(null));assert.equal(await silent.agent.respond(silent.view.query,silent.view.experiences[0]!.record_id,'silent'),null);
 const r=await rig({},async()=>response('They have earned a little patience.'));
 const cmd=await r.agent.impress(r.view.query,'traveler',[r.view.experiences[0]!.record_id],'impression');
 assert.equal(cmd?.body.type,'form_impression');if(cmd?.body.type!=='form_impression')assert.fail('Expected private impression');
 assert.equal(cmd.body.interpretation,'They have earned a little patience.');assert.equal(cmd.body.previous_impression_id,r.view.impressions[0]!.impression_id);
 assert.deepEqual(cmd.body.evidence_ids,[r.view.experiences[0]!.record_id]);assert.equal(r.requests.length,1);
});

test('same scene remains shared while actor goals and cache identities stay private',async()=>{
 const a=await rig();const bview=characterActorView();bview.query.actor_id='other';bview.profile.actor_id='other';bview.impressions=[];bview.experiences[0]!.addressed_actor_ids=['other'];
 const b=await rig({actorId:'other',refreshContext:async()=>bview,readSupplement:async()=>({...supplement(bview),actor:{actor_id:'other',name:'Other',occupation:'Guard',wants:'PRIVATE_OTHER_GOAL',will_not:'Break watch'}})});
 await a.agent.respond(a.view.query,a.view.experiences[0]!.record_id,'a');await b.agent.respond(bview.query,bview.experiences[0]!.record_id,'b');
 assert.ok(textOf(a.requests[0]!).includes('Stone walls'));assert.ok(textOf(b.requests[0]!).includes('Stone walls'));
 assert.ok(!textOf(a.requests[0]!).includes('PRIVATE_OTHER_GOAL'));assert.ok(textOf(b.requests[0]!).includes('PRIVATE_OTHER_GOAL'));
 assert.notEqual(a.requests[0]!.prompt_cache_key,b.requests[0]!.prompt_cache_key);
});

test('cross-actor and stale supplementary data fail before provider generation',async()=>{
 for(const mutate of [(s:DialogueSupplement)=>{s.actor!.actor_id='other';},(s:DialogueSupplement)=>{s.query.scope.world_id='other';},(s:DialogueSupplement)=>{s.query.cursor.sequence++;}]){
  const v=characterActorView(),s=supplement(v);mutate(s);const r=await rig({readSupplement:async()=>s});
  await assert.rejects(r.agent.respond(v.query,v.experiences[0]!.record_id,'forged'));assert.equal(r.requests.length,0);
 }
});

test('supplement getters, proxies and extra fields cannot inject prompt data',async()=>{
 let accessed=0;const v=characterActorView();const active=Object.defineProperty(supplement(v),'scene',{enumerable:true,get(){accessed++;return null;}});
 for(const value of [active,new Proxy(supplement(v),{}),{...supplement(v),private_knowledge:['SECRET']}]){
  const r=await rig({readSupplement:async()=>value as DialogueSupplement});await assert.rejects(r.agent.respond(v.query,v.experiences[0]!.record_id,'active'));assert.equal(r.requests.length,0);
 }
 assert.equal(accessed,0);
});

test('changed view or scene after generation suppresses a previously valid reply',async()=>{
 let r:Awaited<ReturnType<typeof rig>>;r=await rig({},async()=>{r.view.ontology_blocked=true;return response('This must never be released.');});
 assert.equal(await r.agent.respond(r.view.query,r.view.experiences[0]!.record_id,'changed'),null);
 let changed=false;const v=characterActorView();const scene=await rig({readSupplement:async()=>{const s=supplement(v);if(changed)s.source.content_hash='e'.repeat(64);return s;}},async()=>{changed=true;return response('Old scene');});
 assert.equal(await scene.agent.respond(v.query,v.experiences[0]!.record_id,'scene_changed'),null);
});

test('429 failover uses another pool and rechecks disclosure before that attempt',async()=>{
 const candidates=[...seats,{...seats[0]!,pool:'offline_b'}];let calls=0;const r=await rig({candidates},async()=>{if(++calls===1)throw Object.assign(new Error('quota'),{status:429});return response('A bounded alternate reply.');});
 const result=await r.agent.respond(r.view.query,r.view.experiences[0]!.record_id,'retry');assert.equal(result?.body.type==='speak'&&result.body.text,'A bounded alternate reply.');assert.equal(calls,2);
 let blocked:Awaited<ReturnType<typeof rig>>;blocked=await rig({candidates},async()=>{blocked.view.engagement_closed=true;throw Object.assign(new Error('quota'),{status:429});});
 assert.equal(await blocked.agent.respond(blocked.view.query,blocked.view.experiences[0]!.record_id,'blocked_retry'),null);assert.equal(blocked.requests.length,1);
});

test('malformed, incomplete, tool and oversized model responses never become speech',async()=>{
 const invalid=[{...response('x'),status:'incomplete'}, {id:'tool',status:'completed',output:[{type:'function_call',name:'mutate',call_id:'bad',arguments:'{}'}]}, {id:'plain',status:'completed',output:[{type:'message',content:[{type:'output_text',text:'Not JSON'}]}]}, response(''),response('x'.repeat(241)),response('x'.repeat(40000)),{id:'extra',status:'completed',output:[{type:'message',content:[{type:'output_text',text:'{"text":"Hi","authority":"system"}'}]}]}];
 for(const value of invalid){const r=await rig({},async()=>value);await assert.rejects(r.agent.respond(r.view.query,r.view.experiences[0]!.record_id,'invalid'));assert.equal(r.requests.length,1);}
});

test('UTF-8 input and Unicode speech budgets are enforced before release',async()=>{
 const r=await rig({maxContextBytes:2048});r.view.experiences[0]!.text='🙂'.repeat(600);
 await assert.rejects(r.agent.respond(r.view.query,r.view.experiences[0]!.record_id,'large'));assert.equal(r.requests.length,0);
 const emoji=await rig({},async()=>response('🙂🙂'));emoji.view.profile!.speech_policy.max_characters=2;
 assert.equal((await emoji.agent.respond(emoji.view.query,emoji.view.experiences[0]!.record_id,'unicode'))?.body.type,'speak');
});

test('nature revision conflicts are rejected without replacing historical interpretation',async()=>{
 const r=await rig();r.view.impressions[0]!.data.nature.description='A conflicting nature at the same revision';
 await assert.rejects(r.agent.respond(r.view.query,r.view.experiences[0]!.record_id,'nature'));assert.equal(r.requests.length,0);
});

test('historical nature is retained separately from the current personality revision',async()=>{
 const r=await rig();r.view.profile!.revision=2;r.view.profile!.nature={description:'Now distrustful after a broken promise.',priorities:['protect the workshop']};
 await r.agent.respond(r.view.query,r.view.experiences[0]!.record_id,'history');
 const sent=textOf(r.requests[0]!);assert.ok(sent.includes('Now distrustful after a broken promise.'));assert.ok(sent.includes('A practical keeper of the workshop.'));
 assert.equal(sent.split('A practical keeper of the workshop.').length-1,1);
});

test('non-retryable provider failures cannot create a 400 retry loop',async()=>{
 const r=await rig({candidates:[...seats,{...seats[0]!,pool:'other'}]},async()=>{throw Object.assign(new Error('bad parameter'),{status:400});});
 await assert.rejects(r.agent.respond(r.view.query,r.view.experiences[0]!.record_id,'bad_request'));assert.equal(r.requests.length,1);
});

test('the total deadline also bounds optional cooldown bookkeeping',async()=>{
 const r=await rig({timeoutMs:25,cooldown:{get:async()=>new Promise(()=>{}),success:async()=>{},refuse:async()=>{}}});
 await assert.rejects(r.agent.respond(r.view.query,r.view.experiences[0]!.record_id,'cooldown_hang'));assert.equal(r.requests.length,0);
});

test('model-backed dialogue forwards bounded output and token counting across all four providers',async()=>{
 const candidates:Candidate[]=[{vendor:'anthropic',model:'claude-fable-5-2',pool:'offline'},{vendor:'agy_google',model:'gemini-4-carbon',pool:'offline'},{vendor:'openai',model:'gpt-6-astra',pool:'offline'},{vendor:'xai',model:'grok-4.7',pool:'offline'}];
 for(const candidate of candidates){
  let captured:Record<string,unknown>|undefined,counts=0;
  const payload=JSON.stringify({text:'The lamp can wait beside the bench.'});
  const capture=(request:Record<string,unknown>)=>{captured=request;};
  const client=candidate.vendor==='anthropic'?{messages:{create:async(request:Record<string,unknown>)=>{capture(request);return {stop_reason:'end_turn',content:[{type:'text',text:payload}]};}}}:
   candidate.vendor==='agy_google'?{models:{generateContent:async(request:Record<string,unknown>)=>{capture(request);return {candidates:[{finishReason:'STOP',content:{role:'model',parts:[{text:payload}]}}]};}}}:
   {responses:{create:async(request:Record<string,unknown>)=>{capture(request);return response('The lamp can wait beside the bench.');}}};
  const r=await rig({candidates:[candidate],clientFor:()=>client,maxOutputTokens:800,countTokensFor:seat=>{assert.equal(seat.vendor,candidate.vendor);return async()=>{counts++;return 100;};}});
  const cmd=await r.agent.respond(r.view.query,r.view.experiences[0]!.record_id,'provider');
  assert.equal(cmd?.body.type==='speak'&&cmd.body.text,'The lamp can wait beside the bench.');assert.ok(captured);
  const config=captured.config as Record<string,unknown>|undefined;
  assert.equal(captured.max_tokens??captured.max_output_tokens??config?.maxOutputTokens,800,candidate.vendor);
  assert.equal(counts,candidate.vendor==='openai'||candidate.vendor==='agy_google'?1:0);
 }
});

test('disclosure is rechecked after token counting before generation can start',async()=>{
 let r:Awaited<ReturnType<typeof rig>>;
 r=await rig({candidates:[{vendor:'openai',model:'gpt-6-astra',pool:'counting'}],countTokensFor:()=>async()=>{r.view.ontology_blocked=true;return 100;}});
 assert.equal(await r.agent.respond(r.view.query,r.view.experiences[0]!.record_id,'count_cutoff'),null);
 assert.equal(r.requests.length,0,'A token-count delay must not bypass renewed disclosure');
});

test('a late token count cannot invoke generation after the turn deadline',async()=>{
 let finish:((value:number)=>void)|undefined;
 const r=await rig({timeoutMs:25,candidates:[{vendor:'openai',model:'gpt-6-astra',pool:'late_count'}],countTokensFor:()=>()=>new Promise<number>(resolve=>{finish=resolve;})});
 await assert.rejects(r.agent.respond(r.view.query,r.view.experiences[0]!.record_id,'late_count'));
 assert.ok(finish);finish(100);await new Promise(resolve=>setTimeout(resolve,20));
 assert.equal(r.requests.length,0,'Expired async counting cannot start a provider side effect');
});

test('bounded dialogue refuses Google continuation instead of issuing another generation request',async()=>{
 let calls=0;
 const r=await rig({candidates:[{vendor:'agy_google',model:'gemini-4-carbon',pool:'continuation'}],countTokensFor:()=>async()=>100,
  clientFor:()=>({models:{generateContent:async()=>{calls++;return calls===1?{candidates:[{finishReason:'CONTINUATION',continuationToken:'next',content:{parts:[]}}]}:{candidates:[{finishReason:'STOP',content:{parts:[{text:'{"text":"A second generation request."}'}]}}]};}}})});
 await assert.rejects(r.agent.respond(r.view.query,r.view.experiences[0]!.record_id,'no_hops'));
 assert.equal(calls,1);
});

test('valid-looking prose mixed with refusal or built-in tool records is not dialogue',async()=>{
 const mixed=[{...response('Valid-looking reply'),output:[...response('Valid-looking reply').output,{type:'web_search_call',id:'unexpected_tool',status:'completed'}]},
  {...response('Valid-looking reply'),output:[{type:'message',content:[{type:'output_text',text:'{"text":"Valid-looking reply"}'},{type:'refusal',refusal:'Cannot comply'}]}]}];
 for(const value of mixed){const r=await rig({},async()=>value);await assert.rejects(r.agent.respond(r.view.query,r.view.experiences[0]!.record_id,'mixed'));}
});

test('cancellation and deadlines bound unresponsive provider work',async()=>{
 const r=await rig({timeoutMs:25},async()=>new Promise(()=>{}));await assert.rejects(r.agent.respond(r.view.query,r.view.experiences[0]!.record_id,'timeout'));
 const cancel=new AbortController();cancel.abort();const before=await rig();await assert.rejects(before.agent.respond(before.view.query,before.view.experiences[0]!.record_id,'cancel',{signal:cancel.signal}));assert.equal(before.requests.length,0);
});
