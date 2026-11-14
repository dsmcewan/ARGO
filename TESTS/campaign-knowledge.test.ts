import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ArgoError,canonical,hash,assertCharacterContract} from '../packages/contracts/src/index.ts';
import type {CharacterActorQuery,CharacterView} from '../packages/contracts/src/index.ts';
import type * as K from '../packages/contracts/src/dialogue-knowledge-types.ts';
import {assertAuthoredSourceBytes,assertKnowledgeViewBinding} from '../packages/contracts/src/dialogue-knowledge.ts';
import {createModelCharacterAgent} from '../packages/interventions/src/character-model.ts';
import type {DialogueSupplement} from '../packages/interventions/src/dialogue-types.ts';
import {dialoguePacket,validateDialogueSupplement} from '../packages/interventions/src/dialogue-context.ts';
import {buildCampaignDialogueSupplement} from '../scenarios/tempted-fates/campaign/dialogue.ts';
import type {CampaignPack} from '../scenarios/tempted-fates/campaign/types.ts';
import world from '../scenarios/tempted-fates/campaign/world.json' with {type:'json'};
import manifest from '../SYSTEMS/dialogue-knowledge-v1/authored-sources.json' with {type:'json'};
import {characterActorQuery,characterActorView} from './character-fixtures.ts';

interface API {
 campaignKnowledgeCatalog:K.AuthoredKnowledgeCatalog;
 campaignKnowledgeSourceManifest:K.AuthoredSourceManifest;
 campaignKnowledgeIdentity:K.TrustedKnowledgeIdentity;
 createCampaignKnowledgeActivation:(pack:CampaignPack,query:CharacterActorQuery,id:string,knowledgeIds:string[])=>K.AuthoredKnowledgeActivation;
 buildCampaignKnowledgeView:(pack:CampaignPack,read:K.AuthoredKnowledgeRead)=>K.AuthoredKnowledgeView|null;
 buildCampaignKnowledgeDialogueSupplement:(pack:CampaignPack,read:K.AuthoredKnowledgeRead,grant:{location_id:string|null})=>K.DialogueSupplementV2;
}
const implementation=await import('../scenarios/tempted-fates/campaign/knowledge/index.ts').catch(error=>{
 if(error.code==='ERR_MODULE_NOT_FOUND'&&String(error.message).includes('knowledge/index.ts'))return null;throw error;
});
function api():API{assert(implementation,'Campaign authored knowledge helpers must be implemented');return implementation as unknown as API;}
const invalid=(error:unknown)=>error instanceof ArgoError;
const strings=(value:unknown):string[]=>typeof value==='string'?[value]:value!==null&&typeof value==='object'?Object.values(value).flatMap(strings):[];
const pack=()=>structuredClone(world) as CampaignPack;
const query=(actor_id='melia'):CharacterActorQuery=>({...characterActorQuery(),actor_id});
const knowledgeId='melia_lamp_loan_offer';
function currentBinding(q=query()):K.AuthoredKnowledgeRead{
 const value=api(),activation=value.createCampaignKnowledgeActivation(pack(),q,'melia_initial_offer',[knowledgeId]);
 const disclosure:K.AuthoredKnowledgeDisclosure={version:'authored-knowledge-disclosure/1.0.0',query:structuredClone(q),catalog_hash:value.campaignKnowledgeIdentity.catalog_hash,source_manifest_hash:value.campaignKnowledgeIdentity.source_manifest_hash,activation_hash:hash(activation),knowledge_ids:[knowledgeId],basis:'host_current_entitlement_and_ancestor_membership'};
 return {version:'authored-knowledge-read/1.0.0',query:q,activation,disclosure};
}
function npcView():CharacterView{
 const view=characterActorView(),npc=pack().npcs.find(row=>row.id==='melia')!;
 view.query=query();view.profile={actor_id:'melia',revision:1,nature:npc.nature,activity:npc.activity,speech_policy:npc.speech_policy};
 view.experiences[0]!.text='What are your lamp loan terms?';view.experiences[0]!.addressed_actor_ids=['melia'];view.impressions=[];
 return view;
}
function response(text:string|null){return {id:'offline_knowledge',status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({text})}]}]};}
async function modelRig(options:{read?:(q:CharacterActorQuery)=>K.DialogueSupplementV2;invoke?:(request:Record<string,unknown>)=>Promise<unknown>;view?:CharacterView;count?:()=>Promise<number>}={}){
 const view=options.view??npcView(),binding=currentBinding(),requests:Record<string,unknown>[]=[];
 const agent=createModelCharacterAgent({scope:view.query.scope,actorId:view.query.actor_id,sessionId:'knowledge_offline',candidates:[{vendor:options.count?'openai':'xai',model:options.count?'gpt-6-astra':'grok-4.7',pool:'offline_knowledge'}],
  refreshContext:async()=>structuredClone(view),readSupplement:async q=>(options.read?options.read(q):api().buildCampaignKnowledgeDialogueSupplement(pack(),binding,{location_id:'l_harbor'})) as unknown as DialogueSupplement,
  clientFor:()=>({responses:{create:async(request:Record<string,unknown>)=>{requests.push(request);return options.invoke?options.invoke(request):response('The loan is free. Agree a return; supply the oil.');}}}),
  ...(options.count?{countTokensFor:()=>options.count}:{}),
 });
 return {view,binding,agent,requests};
}

test('the bundled policy and source manifest match independently pinned campaign identity and source bytes',()=>{
 const value=api();assert.deepEqual(value.campaignKnowledgeSourceManifest,manifest);
 assert.equal(readFileSync(new URL('../scenarios/tempted-fates/campaign/knowledge/sources.json',import.meta.url),'utf8'),readFileSync(new URL('../SYSTEMS/dialogue-knowledge-v1/authored-sources.json',import.meta.url),'utf8'));
 assert.equal(value.campaignKnowledgeIdentity.pack_hash,hash(world));assert.equal(value.campaignKnowledgeIdentity.catalog_hash,hash(value.campaignKnowledgeCatalog));
 assert.equal(value.campaignKnowledgeIdentity.source_manifest_hash,hash(manifest));
 const paths=[...new Set(manifest.sources.map(row=>row.document_path))];
 assertAuthoredSourceBytes(value.campaignKnowledgeSourceManifest,paths.map(document_path=>({document_path,content:readFileSync(new URL('../'+document_path,import.meta.url),'utf8')})),value.campaignKnowledgeIdentity.source_manifest_hash);
 assert.throws(()=>{value.campaignKnowledgeCatalog.entries[0]!.terms.loan_fee_obols=10;},TypeError);
 assert.throws(()=>{value.campaignKnowledgeSourceManifest.sources[0]!.source_id='changed';},TypeError);
 assert.throws(()=>{value.campaignKnowledgeIdentity.catalog_hash='f'.repeat(64);},TypeError);
});

test('activation registers only selected owner policies at the exact host cursor without changing inputs',()=>{
 const value=api(),q=query(),content=pack(),before=canonical({content,q});
 const activation=value.createCampaignKnowledgeActivation(content,q,'registered_offer',[knowledgeId]);
 assert.deepEqual(activation.acquired_at,q.cursor);assert.deepEqual(activation.scope,q.scope);assert.equal(activation.owner_actor_id,'melia');assert.deepEqual(activation.knowledge_ids,[knowledgeId]);
 assert.equal(canonical({content,q}),before);assert.notEqual(activation.acquired_at,q.cursor);assert.throws(()=>{activation.acquired_at.world_time=0;},TypeError);
 for(const ids of [[],['missing'],[knowledgeId,knowledgeId]])assert.throws(()=>value.createCampaignKnowledgeActivation(pack(),q,'registration',ids),invalid);
 assert.throws(()=>value.createCampaignKnowledgeActivation(pack(),query('dion'),'registration',[knowledgeId]),invalid);
 const initial=query();initial.cursor={sequence:0,head:null,world_time:0};assert.deepEqual(value.createCampaignKnowledgeActivation(pack(),initial,'initial_offer',[knowledgeId]).acquired_at,initial.cursor);
});

test('the selected view includes every exact ordinary loan term and only honest authored provenance',()=>{
 const value=api(),read=currentBinding(),view=value.buildCampaignKnowledgeView(pack(),read)!;
 assertKnowledgeViewBinding(view,value.campaignKnowledgeCatalog,value.campaignKnowledgeSourceManifest,value.campaignKnowledgeIdentity,read);
 assert.equal(view.claims.length,1);const offer=view.claims[0]!;assert.equal(offer.owner_actor_id,'melia');assert.equal(offer.kind,'offer_policy');assert.equal(offer.subject_item_id,'traveler_lamp');
 assert.deepEqual(offer.terms,{loan_fee_obols:0,advance_deposit_obols:0,replacement_value_obols:5,repair_basis:'actual_damage_by_explicit_agreement',repair_cap_obols:5,oil_supplied_by:'borrower',oil_price_obols:1,oil_duration_exploration_turns:6,return_checkpoint:'explicit_agreement_normally_next_harbor_return',compulsory_service:false,oath_required:false});
 assert.equal(offer.provenance.kind,'authored_actor_policy');assert.deepEqual(new Set(offer.provenance.source_ids),new Set(manifest.sources.map(row=>row.source_id)));
 assert.equal(Object.hasOwn(offer,'source_event_id'),false);assert.equal(Object.hasOwn(offer,'accepted'),false);
 assert.throws(()=>{view.claims[0]!.text='A new debt';},TypeError);
});

test('missing or empty host binding discloses no authored knowledge for any actor',()=>{
 for(const missing of ['both','activation','disclosure','selection']){
  const read=currentBinding();if(missing==='both'||missing==='activation')read.activation=null;if(missing==='both'||missing==='disclosure')read.disclosure=null;if(missing==='selection')read.disclosure!.knowledge_ids=[];
  assert.equal(api().buildCampaignKnowledgeView(pack(),read),null);
  const result=api().buildCampaignKnowledgeDialogueSupplement(pack(),read,{location_id:null});assert.equal(result.actor_knowledge,null);assert.equal(result.scene,null);
 }
 const read:K.AuthoredKnowledgeRead={version:'authored-knowledge-read/1.0.0',query:query('dion'),activation:null,disclosure:null};
 assert.equal(api().buildCampaignKnowledgeView(pack(),read),null);
 assert.equal(api().buildCampaignKnowledgeDialogueSupplement(pack(),read,{location_id:null}).actor!.actor_id,'dion');
});

test('persisted activation stays unchanged when a new exact grant selects an ancestor prefix',()=>{
 const read=currentBinding(),activation=canonical(read.activation),later=structuredClone(read.query);later.cursor={sequence:5,head:'d'.repeat(64),world_time:20};
 read.query=later;read.disclosure={...read.disclosure!,query:structuredClone(later)};
 const result=api().buildCampaignKnowledgeView(pack(),read)!;assert.equal(canonical(read.activation),activation);assert.equal(canonical(result.activation.acquired_at),canonical(query().cursor));
 assert.deepEqual(result.query,later);
});

test('wrong actor, full scope, cursor, catalog, manifest and activation hashes fail before projection',()=>{
 for(const change of [
  (r:K.AuthoredKnowledgeRead)=>{r.query.actor_id='dion';},
  (r:K.AuthoredKnowledgeRead)=>{r.query.scope.world_id='other';},
  (r:K.AuthoredKnowledgeRead)=>{r.query.scope.branch_id='other';},
  (r:K.AuthoredKnowledgeRead)=>{r.query.scope.rights_lane='private_upload';r.query.scope.workspace_tenant_id='tenant:private_upload:workspace';},
  (r:K.AuthoredKnowledgeRead)=>{r.disclosure!.query.cursor.world_time--;},
  (r:K.AuthoredKnowledgeRead)=>{r.disclosure!.catalog_hash='e'.repeat(64);},
  (r:K.AuthoredKnowledgeRead)=>{r.disclosure!.source_manifest_hash='e'.repeat(64);},
  (r:K.AuthoredKnowledgeRead)=>{r.disclosure!.activation_hash='e'.repeat(64);},
  (r:K.AuthoredKnowledgeRead)=>{r.disclosure!.knowledge_ids=['dion_secret'];},
  (r:K.AuthoredKnowledgeRead)=>{r.activation!.acquired_at.sequence++;r.disclosure!.activation_hash=hash(r.activation);},
  (r:K.AuthoredKnowledgeRead)=>{r.activation!.acquired_at.world_time++;r.disclosure!.activation_hash=hash(r.activation);},
 ]){const read=structuredClone(currentBinding());change(read);assert.throws(()=>api().buildCampaignKnowledgeView(pack(),read),invalid);}
});

test('changed pack content or attacker-supplied policies cannot replace bundled trusted identities',()=>{
 const content=pack();content.npcs.find(row=>row.id==='melia')!.private_knowledge.push('ATTACKER_SECRET');
 assert.throws(()=>api().buildCampaignKnowledgeView(content,currentBinding()),invalid);
 const read:any=currentBinding();read.catalog={...api().campaignKnowledgeCatalog,entries:[]};assert.throws(()=>api().buildCampaignKnowledgeView(pack(),read),invalid);
 assert.throws(()=>api().buildCampaignKnowledgeDialogueSupplement(pack(),currentBinding(),{location_id:'missing'}),invalid);
});

test('public helpers reject active objects before invoking getters or proxy traps',()=>{
 for(const slot of ['pack','read','query','knowledge_ids','room'] as const){
  let calls=0;const content=pack(),read=currentBinding(),q=query(),ids=[knowledgeId],room={location_id:null};
  const raw=slot==='pack'?content:slot==='read'?read:slot==='query'?q:slot==='knowledge_ids'?ids:room;
  const getter=structuredClone(raw),key=slot==='pack'?'version':slot==='read'?'activation':slot==='query'?'actor_id':slot==='knowledge_ids'?'0':'location_id';
  Object.defineProperty(getter,key,{enumerable:true,get(){calls++;throw Error('Active data');}});
  const revoked=Proxy.revocable(raw,{});revoked.revoke();
  for(const active of [getter,new Proxy(raw,{get(){calls++;throw Error('Proxy read');},ownKeys(){calls++;throw Error('Proxy inspected');}}),revoked.proxy]){
   assert.throws(()=>slot==='query'||slot==='knowledge_ids'?api().createCampaignKnowledgeActivation(content,slot==='query'?active as CharacterActorQuery:q,'active',slot==='knowledge_ids'?active as string[]:ids):api().buildCampaignKnowledgeDialogueSupplement(slot==='pack'?active as CampaignPack:content,slot==='read'?active as K.AuthoredKnowledgeRead:read,slot==='room'?active as {location_id:null}:room),invalid);
  }
  assert.equal(calls,0);
 }
});

test('supplement 0.2 separates offered policies from the explicitly disclosed room and preserves 0.1',()=>{
 const read=currentBinding(),old=buildCampaignDialogueSupplement(pack(),read.query,{location_id:'l_harbor'}),next=api().buildCampaignKnowledgeDialogueSupplement(pack(),read,{location_id:'l_harbor'});
 assert.equal(next.version,'character-dialogue/0.2.0');assert.deepEqual(next.scene,old.scene);assert.deepEqual(next.actor,old.actor);assert.equal(Object.hasOwn(next.scene!,'claims'),false);
 assert.deepEqual(validateDialogueSupplement(next,read.query),next);assert.deepEqual(validateDialogueSupplement(old,read.query),old);
 assert.throws(()=>validateDialogueSupplement({...old,actor_knowledge:next.actor_knowledge},read.query),invalid);
 const packet:any=dialoguePacket(npcView(),next as unknown as DialogueSupplement,'speech','traveler',['b'.repeat(64)],null);
 assert.equal(packet.version,'character-dialogue/0.2.0');assert.deepEqual(packet.supplement.actor_knowledge.claims,next.actor_knowledge!.claims);assert.equal(Object.hasOwn(packet.supplement.actor_knowledge,'query'),false);
 const oldPacket=dialoguePacket(npcView(),old,'speech','traveler',['b'.repeat(64)],null);assert.equal(oldPacket.version,'character-dialogue/0.1.0');assert.equal(Object.hasOwn(oldPacket.supplement!,'actor_knowledge'),false);
});

test('authored policy future and expiration are refused at the dialogue boundary',()=>{
 for(const validity of [{from_tick:11,until_tick:null},{from_tick:0,until_tick:10}]){
  const next=structuredClone(api().buildCampaignKnowledgeDialogueSupplement(pack(),currentBinding(),{location_id:null}));next.actor_knowledge!.claims[0]!.validity=validity;
  assert.throws(()=>validateDialogueSupplement(next,query()),invalid);
 }
});

test('injected model request receives exact terms and selected provenance without private campaign context or state mutation',async()=>{
 const before=canonical(world),r=await modelRig(),viewBefore=canonical(r.view),result=await r.agent.respond(r.view.query,r.view.experiences[0]!.record_id,'loan_terms',{communicationGoal:'Explain the ordinary loan terms without pressuring a borrower.'});
 assert.equal(result?.body.type,'speak');assertCharacterContract('CharacterCommand',result);
 assert.equal(r.requests.length,1);const sent=JSON.stringify(r.requests[0]);
 const content=(r.requests[0]!.input as {role:string;content:string}[])[0]!.content;
 const packet=JSON.parse(content.slice(content.indexOf('\n\n')+2));
 assert.deepEqual(packet.supplement.actor_knowledge.claims[0].terms,api().campaignKnowledgeCatalog.entries[0]!.terms);
 assert.equal(packet.version,'character-dialogue/0.2.0');assert.equal(Object.hasOwn(packet.supplement.actor_knowledge,'query'),false);
 const contextStrings=strings(packet);
 for(const source of manifest.sources)assert.ok(sent.includes(source.excerpt_sha256));
 assert.ok(sent.includes('What are your lamp loan terms?'));assert.ok(sent.includes('Warm but exact about borrowed things.'));
 for(const npc of world.npcs)for(const secret of [...npc.private_knowledge,npc.speech_example])assert.ok(contextStrings.every(text=>!text.includes(secret)),secret);
 for(const room of world.locations)assert.ok(contextStrings.every(text=>!text.includes(room.referee_notes)));
 for(const variant of world.variants)assert.ok(contextStrings.every(text=>!text.includes(variant.referee_truth)));
 assert.ok(!sent.includes('dion'));assert.equal(canonical(world),before);assert.equal(canonical(r.view),viewBefore);
 assert.equal(r.requests[0]!.tools,undefined);assert.equal(Object.hasOwn(result!,'action'),false);
});

test('missing host binding produces no authored terms in a real model request',async()=>{
 const r=await modelRig({read:q=>api().buildCampaignKnowledgeDialogueSupplement(pack(),{version:'authored-knowledge-read/1.0.0',query:q,activation:null,disclosure:null},{location_id:null})});
 await r.agent.respond(r.view.query,r.view.experiences[0]!.record_id,'missing_terms');const sent=JSON.stringify(r.requests[0]);
 assert.equal(r.requests.length,1);assert.ok(!sent.includes('loan_fee_obols'));assert.ok(!sent.includes('quickstart_lamp_terms'));
});

test('late revocation or changed activation/content suppresses generated speech',async()=>{
 for(const change of ['revoke','activation','catalog','source']){
  let changed=false;const binding=currentBinding();
  const r=await modelRig({read:()=>{
   const value=structuredClone(binding);
   if(changed&&change==='revoke')value.disclosure=null;
   if(changed&&change==='activation'){value.activation!.activation_id='replacement_activation';value.disclosure!.activation_hash=hash(value.activation);}
   if(changed&&change==='catalog')value.disclosure!.catalog_hash='e'.repeat(64);
   if(changed&&change==='source')value.disclosure!.source_manifest_hash='e'.repeat(64);
   return api().buildCampaignKnowledgeDialogueSupplement(pack(),value,{location_id:null});
  },invoke:async()=>{changed=true;return response('An obsolete offer.');}});
  assert.equal(await r.agent.respond(r.view.query,r.view.experiences[0]!.record_id,'revoked'),null,change);assert.equal(r.requests.length,1);
 }
});

test('grant revocation during asynchronous token counting prevents the provider call',async()=>{
 let revoked=false;const binding=currentBinding(),r=await modelRig({read:()=>api().buildCampaignKnowledgeDialogueSupplement(pack(),{...binding,disclosure:revoked?null:binding.disclosure},{location_id:null}),count:async()=>{revoked=true;return 100;}});
 assert.equal(await r.agent.respond(r.view.query,r.view.experiences[0]!.record_id,'count_revoke'),null);assert.equal(r.requests.length,0);
});

test('dead, busy, unaddressed and post-anomaly characters stay silent before knowledge lookup',async()=>{
 for(const mutate of [(v:CharacterView)=>{v.alive=false;},(v:CharacterView)=>{v.profile!.activity.busy_until=11;},(v:CharacterView)=>{v.experiences[0]!.addressed_actor_ids=[];},(v:CharacterView)=>{v.ontology_blocked=true;},(v:CharacterView)=>{v.ontology_blocked=true;v.engagement_closed=true;}]){
  const view=npcView();mutate(view);let reads=0;const r=await modelRig({view,read:()=>{reads++;throw Error('Knowledge should not be loaded');}});
  assert.equal(await r.agent.respond(r.view.query,r.view.experiences[0]!.record_id,'silent'),null);assert.equal(reads,0);assert.equal(r.requests.length,0);
 }
});
