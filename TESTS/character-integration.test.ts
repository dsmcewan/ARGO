import test from 'node:test';
import type {TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {canonical,CHARACTER_PROFILE} from '../packages/contracts/src/index.ts';
import type {CharacterCommandBody,CharacterProfile,CharacterNarratorQuery,Principal} from '../packages/contracts/src/index.ts';
import {openLedger} from '../packages/ledger/src/index.ts';
import {projectKnowledge} from '../packages/lexi-bridge/src/index.ts';
import {createNarrator} from '../packages/argo-dm/src/index.ts';
import {genesis,keys,principal,proposal} from './fixtures.ts';

async function components(){
 try{
  const [authority,knowledge,presentation,agents,bridge]=await Promise.all([
   import('../packages/ledger/src/characters.ts'),import('../packages/lexi-bridge/src/characters.ts'),
   import('../packages/argo-dm/src/characters.ts'),import('../packages/interventions/src/characters.ts'),
   import('../packages/telos-bridge/src/characters.ts'),
  ]);
  return {...authority,...knowledge,...presentation,...agents,...bridge};
 }catch(error){
  if(error instanceof Error&&'code'in error&&error.code==='ERR_MODULE_NOT_FOUND')assert.fail('The character runtime components required by this integration are not implemented yet');
  throw error;
 }
}
const profile=(actor_id:string,nature:string,busy_until=10):CharacterProfile=>({actor_id,revision:1,
 nature:{description:nature,priorities:['finish current work']},activity:{description:'Mending the workshop tools',busy_until},
 speech_policy:{max_characters:180,minimum_interval:0}});

test('legacy persona entry point carries the common world-external onlooker policy',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'argo-character-legacy-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const seed=genesis(),ledger=await openLedger({directory,genesis:seed,privateKey:keys.privateKey}),snapshot=await ledger.snapshot();
 const view=projectKnowledge(snapshot,{schema_version:'1.0.0',scope:seed.scope,actor_id:'traveler',audience:'actor',party_id:null,as_of_sequence:0,as_of_world_time:10},principal('traveler'));
 const requests:unknown[]=[];
 const client={responses:{create:async(request:unknown)=>{requests.push(request);return {status:'completed',id:'legacy_reply',output:[{type:'message',content:[{type:'output_text',text:'A promising start. Those have happened before.'}]}]};}}};
 const narrator=createNarrator({scope:seed.scope,sessionId:'legacy_voice',candidates:[{vendor:'xai',model:'grok-4.7',pool:'offline'}],clientFor:()=>client,refreshView:async()=>view});
 for(const persona of ['The Chronicler','The Fates','Plain Guide'] as const){
  assert.equal(await narrator.narrate({view,persona,prompt:'Frame the scene.'}),'A promising start. Those have happened before.');
  assert.ok(JSON.stringify(requests.at(-1)).includes('ARGO onlooker profile 1.0.0.'),'Every existing persona receives the shared voice policy');
 }
 assert.equal((await ledger.events()).length,0);
});

async function world(t:TestContext,campaign='campaign'){
 const api=await components(),directory=await mkdtemp(join(tmpdir(),'argo-character-integration-'));
 t.after(()=>rm(directory,{recursive:true,force:true}));
 const seed=genesis();seed.scope.campaign_id=campaign;
 seed.actors.witness_a={...seed.actors.outsider!};seed.actors.witness_b={...seed.actors.outsider!};
 seed.parties.party!.push('witness_a');
 const auth=(actor:string,role:Principal['role']='player'):Principal=>({...principal(actor,role),scope:structuredClone(seed.scope)});
 const system=auth('system','system'),ledger=await openLedger({directory,genesis:seed,privateKey:keys.privateKey});
 let party=false,adjudications=0,counter=0;
 const authority=await api.createCharacterAuthority({ledger,systemPrincipal:system,authorizeWitnesses:async(request,snapshot,{signal})=>{
  signal.throwIfAborted();assert.equal(snapshot.genesis.scope.campaign_id,campaign);adjudications++;
  return {request_hash:request.request_hash,actor_ids:party?['witness_a']:['witness_a','witness_b'],party_id:party?'party':null};
 }});
 const bridge=api.createCharacterBridge({scope:seed.scope,transport:(command,who,call)=>authority.submit(command,who,call)});
 const views=api.createCharacterViews({scope:seed.scope,readProjection:call=>authority.readProjection(call)});
 const cursor=async()=>{const state=await ledger.snapshot();return {sequence:state.sequence,head:state.head,world_time:state.world_time};};
 const send=async(body:CharacterCommandBody,who:Principal=system)=>bridge.submit({version:CHARACTER_PROFILE,scope:seed.scope,request_id:`integration_${++counter}`,expected_cursor:await cursor(),body},who);
 const actorView=async(actor:string)=>views.actor({version:CHARACTER_PROFILE,scope:seed.scope,cursor:await cursor(),actor_id:actor},auth(actor,'npc'));
 const narratorQuery=async(actor_id='traveler',audience:'actor'|'party'='actor',limit=32):Promise<CharacterNarratorQuery>=>({version:CHARACTER_PROFILE,scope:seed.scope,cursor:await cursor(),traveler_id:'traveler',actor_id,audience,party_id:audience==='party'?'party':null,after_sequence:0,limit});
 await send({type:'configure',profile:profile('traveler','Curious and observant')});
 await send({type:'configure',profile:profile('witness_a','Values kept promises')});
 await send({type:'configure',profile:profile('witness_b','Protects scarce resources')});
 return {api,directory,seed,auth,system,ledger,authority,bridge,views,cursor,send,actorView,narratorQuery,
  setParty:(value:boolean)=>{party=value;},adjudications:()=>adjudications};
}

test('real journal preserves two private interpretations of one witnessed action and replays every prefix',async t=>{
 const w=await world(t);
 await w.ledger.submit(proposal(await w.ledger.snapshot(),{type:'move_item',item_id:'lamp',to_actor_id:'traveler'},'donor','give_to_traveler'),w.auth('donor'));
 const action=await w.ledger.submit(proposal(await w.ledger.snapshot(),{type:'move_item',item_id:'lamp',to_actor_id:'witness_b'},'traveler','give_to_witness'),w.auth('traveler'));
 await w.send({type:'witness_action',record_id:action.event_hash});
 const opinions=[['witness_a','Values kept promises','They honored a commitment.'],['witness_b','Protects scarce resources','They part with useful things too readily.']] as const;
 for(const [actor,nature,interpretation] of opinions){
  const agent=w.api.createCharacterAgent({actorId:actor,interpret:async context=>{
   assert.equal(context.view.profile!.nature.description,nature);
   assert.equal(context.evidence[0]!.record_id,action.event_hash);
   return interpretation;
  },speak:async()=>null});
  const command=await agent.impress(await w.actorView(actor),'traveler',[action.event_hash],`impression_${actor}`);
  assert.ok(command);await w.bridge.submit(command,w.auth(actor,'npc'));
 }
 assert.equal((await w.actorView('witness_a')).impressions[0]!.data.interpretation,'They honored a commitment.');
 assert.equal((await w.actorView('witness_b')).impressions[0]!.data.interpretation,'They part with useful things too readily.');
 assert.equal((await w.actorView('traveler')).impressions.length,0);
 assert.equal((await w.actorView('outsider')).impressions.length,0);
 assert.equal((await w.actorView('outsider')).experiences.length,0);
 const snapshot=await w.ledger.snapshot();assert.equal(snapshot.items.lamp!.custodian_id,'witness_b');
 assert.equal(Object.hasOwn(snapshot.actors.traveler!,'reputation'),false);
 const ordinary=projectKnowledge(snapshot,{schema_version:'1.0.0',scope:w.seed.scope,actor_id:'traveler',audience:'actor',party_id:null,as_of_sequence:snapshot.sequence,as_of_world_time:snapshot.world_time},w.auth('traveler'));
 assert.deepEqual(ordinary.claims,[],'Private character carriers must not reach ordinary actor retrieval');
 const events=await w.ledger.events(),projected=await w.authority.readProjection();
 assert.equal(events.length,8);
 assert.equal(canonical(projected),canonical(w.api.replayCharacters(w.seed,events,w.system)));
 // Hand-derived from the three configurations, two custody actions, one witness
 // annotation and two distinct impressions above; not computed by the reducer.
 const expectedPrefixes=[[0,0,0],[1,0,0],[2,0,0],[3,0,0],[3,1,0],[3,2,0],[3,2,0],[3,2,1],[3,2,2]];
 const replayDirectory=await mkdtemp(join(tmpdir(),'argo-character-prefix-'));t.after(()=>rm(replayDirectory,{recursive:true,force:true}));
 const {writeFile}=await import('node:fs/promises');
 await writeFile(join(replayDirectory,'genesis.json'),canonical(w.seed)+'\n');
 for(let n=0;n<=events.length;n++){
  await writeFile(join(replayDirectory,'events.jsonl'),events.slice(0,n).map(event=>canonical(event)+'\n').join(''));
  const opened=await openLedger({directory:replayDirectory,genesis:w.seed,privateKey:keys.privateKey});
  const fresh=await w.api.createCharacterAuthority({ledger:opened,systemPrincipal:w.system});
  const prefix=await fresh.readProjection();
  assert.deepEqual([prefix.profiles.length,prefix.records.length,prefix.impressions.length],expectedPrefixes[n]);
  assert.equal(prefix.activation_sequence,n===0?null:1);
  assert.equal(prefix.cursor.head,n===0?null:events[n-1]!.hash);
  assert.equal(canonical(prefix),canonical(w.api.replayCharacters(w.seed,events.slice(0,n),w.system)));
 }
 const before=w.adjudications();const reopened=await openLedger({directory:w.directory,genesis:w.seed,privateKey:keys.privateKey});
 const resumed=await w.api.createCharacterAuthority({ledger:reopened,systemPrincipal:w.system});
 assert.equal(canonical(await resumed.readProjection()),canonical(projected));assert.equal(w.adjudications(),before);
});

test('quiet characters and audience-safe narration use real stored speech without giving prose a writer',async t=>{
 const w=await world(t,'harbor_campaign');
 await w.send({type:'configure',profile:{...profile('witness_b','Protects scarce resources',100),revision:2}});
 const privateReceipt=await w.send({type:'speak',text:'PRIVATE_SOLO_MARKER: I hid the silver key.',addressed_actor_ids:['witness_b']},w.auth('traveler'));
 let speechCalls=0;
 const busy=w.api.createCharacterAgent({actorId:'witness_b',interpret:async()=>null,speak:async()=>{speechCalls++;return 'I must drop everything and offer a quest.';}});
 assert.equal(await busy.respond(await w.actorView('witness_b'),privateReceipt.event_hash,'busy_response'),null);
 assert.equal(speechCalls,0);
 w.setParty(true);
 await w.send({type:'speak',text:'PUBLIC_RAID_MARKER: We can meet at the gate.',addressed_actor_ids:['witness_a']},w.auth('traveler'));
 const requests:unknown[]=[];
 const client={responses:{create:async(request:unknown)=>{requests.push(request);return {status:'completed',id:'character_reply',output:[{type:'message',content:[{type:'output_text',text:'Another plan. At least this one has a meeting place.'}]}]};}}};
 const narrator=(viewer:string)=>w.api.createCharacterNarrator({scope:w.seed.scope,sessionId:'shared_session',candidates:[{vendor:'xai',model:'grok-4.7',pool:'offline'}],clientFor:()=>client,refreshContext:(query,call)=>w.views.narrator(query,w.auth(viewer),call)});
 const count=(await w.ledger.events()).length;
 const party=await narrator('witness_a').narrate({query:await w.narratorQuery('witness_a','party'),prompt:'Comment on the traveler.',persona:'The Chronicler'});
 assert.equal(party,'Another plan. At least this one has a meeting place.');
 assert.ok(JSON.stringify(requests[0]).includes('PUBLIC_RAID_MARKER'));
 assert.ok(!JSON.stringify(requests[0]).includes('PRIVATE_SOLO_MARKER'));
 await narrator('traveler').narrate({query:await w.narratorQuery(),prompt:'Recall my own words.'});
 assert.ok(JSON.stringify(requests[1]).includes('PRIVATE_SOLO_MARKER'));
 assert.equal((await w.ledger.events()).length,count,'Narrator output must not append speech, impressions or physical events');
 const page=await w.views.narrator(await w.narratorQuery('witness_a','party',1),w.auth('witness_a'));
 assert.equal(page.records.length,1);assert.equal(page.records[0]!.text,'PUBLIC_RAID_MARKER: We can meet at the gate.');
 assert.equal(page.next_after_sequence,null);
 assert.equal(page.coverage.captured_kinds.join(','),'speech,action');
});

test('a real post-anomaly commit during generation suppresses retained-history narration',async t=>{
 const w=await world(t);
 await w.send({type:'speak',text:'A final question about the thread.',addressed_actor_ids:['witness_a']},w.auth('traveler'));
 let calls=0;
 const client={responses:{create:async()=>{
  calls++;
  await w.ledger.submit(proposal(await w.ledger.snapshot(),{type:'vanish_thread',traveler_id:'traveler'},'system','cutoff_during_generation'),w.system);
  return {status:'completed',id:'stale_reply',output:[{type:'message',content:[{type:'output_text',text:'FORBIDDEN_ONTOLOGICAL_EXPOSITION'}]}]};
 }}};
 const narrator=w.api.createCharacterNarrator({scope:w.seed.scope,sessionId:'cutoff_session',candidates:[{vendor:'xai',model:'grok-4.7',pool:'offline'}],clientFor:()=>client,refreshContext:(query,call)=>w.views.narrator(query,w.auth('traveler'),call)});
 assert.equal(await narrator.narrate({query:await w.narratorQuery(),prompt:'Explain what vanished.'}),'');
 assert.equal(calls,1);
 const query=await w.narratorQuery();const current=await w.views.narrator(query,w.auth('traveler'));
 assert.equal(current.ontology_blocked,true);assert.deepEqual(current.records,[]);
 assert.ok((await w.authority.readProjection()).records.length>0,'Cutoff hides presentation without deleting durable history');
 assert.equal(await narrator.narrate({query,prompt:'Try another persona.',persona:'Plain Guide'}),'');
 assert.equal(calls,1);
});
