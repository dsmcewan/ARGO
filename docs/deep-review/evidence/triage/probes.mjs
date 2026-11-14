import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {join} from 'node:path';
import {initialMortalState,resolveMortal} from '/workspace/ARGO/packages/ledger/src/mortal/rules.ts';
import {mortalGenesis,mortalPrincipal,mortalCommand} from '/workspace/ARGO/TESTS/mortal-fixtures.ts';
import {genesis,keys,scope,principal,proposal} from '/workspace/ARGO/TESTS/fixtures.ts';
import {openLedger,createCharacterAuthority} from '@argo/ledger';
import {CHARACTER_PROFILE,canonical} from '@argo/contracts';
import {createCharacterViews,projectKnowledge} from '@argo/lexi-bridge';
import {buildCampaignSeed,buildCampaignDialogueSupplement} from '@argo/tempted-fates';
import {createModelCharacterAgent} from '@argo/interventions';
const scratch='/workspace/reports/2026-11-14-argo-deep-review/triage';
const report={revision:'0c24b32f947143c5b1095f702c878ed92888aa8d',node:process.version,network_calls:0};
const refusal=async f=>{try{await f();return {accepted:true};}catch(error){return {accepted:false,code:error.code,message:error.message};}};

// The fixture's separate traveler is at another location before combat opens.
const mg=mortalGenesis();mg.actors.find(a=>a.id==='companion').location_id='ruin';
let ms=initialMortalState(mg);
ms=resolveMortal(mg,ms,mortalCommand(ms,{type:'begin_encounter',encounter_id:'open',side_a:['hero'],side_b:['raider'],escape_allowed:true},'host'),mortalPrincipal(mg,'host')).state;
const active=ms.encounter.order[ms.encounter.turn],other=active==='hero'?'raider':'hero';
report.encounter={acting:active,world_time:ms.world_time,unrelated_location:ms.actors.find(a=>a.id==='companion').location_id};
for(const [name,id,action] of [
 ['remote_travel','companion',{type:'travel',route_id:'road'}],
 ['remote_wait','companion',{type:'wait',turns:1}],
 ['other_participant_retreat',other,{type:'retreat'}],
 ['referee_pass','host',{type:'pass'}],
 ['referee_end','host',{type:'end_encounter'}],
 ['referee_second_encounter','host',{type:'begin_encounter',encounter_id:'second',side_a:['hero'],side_b:['raider'],escape_allowed:true}],
])report.encounter[name]=await refusal(()=>resolveMortal(mg,ms,mortalCommand(ms,action,id),mortalPrincipal(mg,id)));
assert.equal(report.encounter.remote_travel.code,'CONFLICT');assert.equal(report.encounter.remote_wait.code,'CONFLICT');
assert.equal(report.encounter.referee_end.code,'INVALID_CONTRACT');
const closed=resolveMortal(mg,ms,mortalCommand(ms,{type:'retreat'},active),mortalPrincipal(mg,active)).state;
assert.equal(closed.encounter,null);report.encounter.current_actor_retreat={accepted:true,encounter:closed.encounter,world_time:closed.world_time};

// An actual signed v1 journal accepts observer selection without witness host approval.
const vg=genesis(),vl=await openLedger({directory:await mkdtemp(join(scratch,'claims-')),genesis:vg,privateKey:keys.privateKey});
const va=await createCharacterAuthority({ledger:vl,systemPrincipal:principal('system','system'),authorizeWitnesses:async request=>({request_hash:request.request_hash,actor_ids:[],party_id:null})});
await va.submit({version:CHARACTER_PROFILE,scope,request_id:'configure_victim',expected_cursor:(await va.readProjection()).cursor,body:{type:'configure',profile:{actor_id:'outsider',revision:1,nature:{description:'Careful.',priorities:['Know what happened']},activity:{description:'Waiting',busy_until:0},speech_policy:{max_characters:240,minimum_interval:0}}}},principal('system','system'));
for(const observation of [
 {claim_id:'private_delivery',channel:'belief',source_id:'donor',content:'ATTACKER_CHOSEN_PRIVATE_KNOWLEDGE',observers:['outsider'],party_id:null,occurred_at:0},
 {claim_id:'forged_source',channel:'external_account',source_id:'clotho',content:'FORGED_CLOTHO_SOURCE',observers:['donor','outsider'],party_id:null,occurred_at:0},
])await vl.submit(proposal(await vl.snapshot(),{type:'observe_claim',observation},'donor',observation.claim_id),principal('donor'));
const vs=await vl.snapshot(),vquery={schema_version:'1.0.0',scope,actor_id:'outsider',audience:'actor',party_id:null,as_of_sequence:vs.sequence,as_of_world_time:vs.world_time};
const victim=projectKnowledge(vs,vquery,principal('outsider')),vp=await va.readProjection();
const vv=await createCharacterViews({scope,readProjection:async()=>vp}).actor({version:CHARACTER_PROFILE,scope,cursor:vp.cursor,actor_id:'outsider'},principal('outsider'));
assert.equal(victim.claims.length,2);assert.equal(victim.claims[1].observation.source_id,'clotho');assert.equal(vv.experiences.length,0);
report.private_claims={accepted_claims:victim.claims.map(c=>({claim_id:c.observation.claim_id,source_id:c.observation.source_id,observers:c.observation.observers,party_id:c.observation.party_id,acquired_at:c.acquired_at})),actual_submitter:'donor',victim_in_submitter_party:false,character_experience_count:vv.experiences.length};

// Real campaign/profile/witness path and a completely injected provider capture.
const pack=JSON.parse(await readFile('/workspace/ARGO/scenarios/tempted-fates/campaign/world.json','utf8'));
const cs=buildCampaignSeed(pack,{scope,privateSeed:'ab'.repeat(32),authorityKeyId:'triage',authorityPublicKey:keys.publicKey.export({format:'pem',type:'spki'}).toString(),variant:'legend',travelers:[{actor_id:'traveler',name:'Traveler',nature:{description:'Asks about loan terms.',priorities:['Return borrowed property']}}]});
const cl=await openLedger({directory:await mkdtemp(join(scratch,'dialogue-')),genesis:cs.genesis,privateKey:keys.privateKey});
const ca=await createCharacterAuthority({ledger:cl,systemPrincipal:principal('system','system'),authorizeWitnesses:async request=>({request_hash:request.request_hash,actor_ids:['traveler','melia'],party_id:null})});
let serial=0;
const send=async(body,auth=principal('system','system'))=>ca.submit({version:CHARACTER_PROFILE,scope,request_id:`setup_${++serial}`,expected_cursor:(await ca.readProjection()).cursor,body},auth);
for(const profile of cs.profiles.filter(p=>['traveler','melia'].includes(p.actor_id)))await send({type:'configure',profile});
await send({type:'speak',text:'What does borrowing your lamp cost, and when must I return it?',addressed_actor_ids:['melia']},principal('traveler'));
const cp=await ca.readProjection(),cq={version:CHARACTER_PROFILE,scope,cursor:cp.cursor,actor_id:'melia'},incoming=cp.records.at(-1).experience.record_id;
const cv=createCharacterViews({scope,readProjection:call=>ca.readProjection(call)});
const requests=[];let output='{"text":null}';
const agent=createModelCharacterAgent({scope,actorId:'melia',sessionId:'offline_triage',candidates:[{vendor:'xai',model:'grok-4.7',pool:'offline_stub'}],refreshContext:(q,call)=>cv.actor(q,principal('melia','npc'),call),readSupplement:async q=>buildCampaignDialogueSupplement(pack,q,{location_id:'l_harbor'}),clientFor:()=>({responses:{create:async request=>{requests.push(request);return {id:'stub',status:'completed',output:[{type:'message',content:[{type:'output_text',text:output}]}]};}}})});
assert.equal(await agent.respond(cq,incoming,'silent'),null);
const serialized=JSON.stringify(requests[0]);
report.dialogue_context={has_wants:serialized.includes(pack.npcs.find(n=>n.id==='melia').wants),has_will_not:serialized.includes(pack.npcs.find(n=>n.id==='melia').will_not),has_ordinary_lamp:serialized.includes('ordinary clay lamp'),has_five_obol_terms:serialized.includes('5-obol'),has_explicit_return_checkpoint:serialized.includes('next agreed harbor return'),has_private_knowledge:pack.npcs.find(n=>n.id==='melia').private_knowledge.map(text=>serialized.includes(text)),experience_count:(await cv.actor(cq,principal('melia','npc'))).experiences.length};
assert.equal(report.dialogue_context.has_wants,true);assert.equal(report.dialogue_context.has_five_obol_terms,false);assert.equal(report.dialogue_context.has_explicit_return_checkpoint,false);
await writeFile(join(scratch,'captured-model-request.json'),JSON.stringify(requests[0],null,2)+'\n');
output='```json\n{"text":"The lamp is ordinary."}\n```';
report.fenced_json=await refusal(()=>agent.respond(cq,incoming,'fenced'));
output=JSON.stringify({text:'x'.repeat(241)});
report.speech_241=await refusal(()=>agent.respond(cq,incoming,'overlength'));
output=JSON.stringify({text:'x'.repeat(240)});
const accepted=await agent.respond(cq,incoming,'at_limit');
report.speech_240={accepted:accepted?.body.type==='speak',characters:[...accepted.body.text].length};
assert.equal(report.fenced_json.code,'INVALID_CONTRACT');assert.equal(report.speech_241.code,'INVALID_CONTRACT');assert.equal(report.speech_240.accepted,true);
report.dialogue_provider_calls=requests.length;report.no_generated_speech_committed=(await cl.events()).length===3;
await writeFile(join(scratch,'results.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
