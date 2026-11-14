import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {ArgoError,canonical,hash} from '../packages/contracts/src/index.ts';
import {assertWorldGenesis,assertWorldContract} from '../packages/contracts/src/shared-world.ts';
import type {WorldGenesis,WorldProfile} from '../packages/contracts/src/shared-world-types.ts';
import {assertAuthoredSourceBytes,assertKnowledgeCatalogIdentity} from '../packages/contracts/src/dialogue-knowledge.ts';
import {assertMortalV3Genesis} from '../packages/contracts/src/mortal-v3.ts';
import type {MortalV3Action,MortalV3State} from '../packages/contracts/src/mortal-v3-types.ts';
import {initialMortalV3State,resolveMortalV3} from '../packages/ledger/src/mortal-v3/rules.ts';
import {buildMortalV3Campaign} from '../scenarios/tempted-fates/runtime-v3.ts';
import {buildMortalCampaign} from '../scenarios/tempted-fates/runtime.ts';
import type {MortalCampaignOptions} from '../scenarios/tempted-fates/runtime.ts';
import type {CampaignPack} from '../scenarios/tempted-fates/campaign/types.ts';
import {campaignKnowledgeIdentity,campaignKnowledgeCatalog,campaignKnowledgeSourceManifest} from '../scenarios/tempted-fates/campaign/knowledge/index.ts';
import world from '../scenarios/tempted-fates/campaign/world.json' with {type:'json'};
import {keys,scope} from './fixtures.ts';

type Options=Omit<MortalCampaignOptions,'travelers'>&{environment:'day'|'night';starting_kit:'standard'|'borrowed_lamp';initial_knowledge_ids:string[];
 travelers:(MortalCampaignOptions['travelers'][number]&{nature:WorldProfile['nature'];presentation:WorldProfile['presentation'];max_speech_characters:number})[]};
type Manifest={adapter:'tempting-fates-shared/0.1.0';pack_hash:string;genesis_hash:string;mortal_genesis_hash:string;catalog_hash:string;source_manifest_hash:string;variant:Options['variant'];hp_mode:Options['hp_mode'];environment:Options['environment'];starting_kit:Options['starting_kit'];initial_knowledge_ids:string[]};
type Seed={genesis:WorldGenesis;manifest:Manifest};
const implementation=await import('../scenarios/tempted-fates/shared-world/seed.ts').catch(error=>{
 if(error.code==='ERR_MODULE_NOT_FOUND'&&String(error.message).includes('shared-world/seed.ts'))return null;throw error;
});
function build(pack:CampaignPack,options:Options):Seed{
 assert(implementation,'Fresh shared-world campaign seed must be implemented');
 return implementation.buildSharedWorldCampaign(pack,options);
}
const pack=()=>structuredClone(world) as CampaignPack;
const invalid=(error:unknown)=>error instanceof ArgoError;
function options():Options{return {scope:structuredClone(scope),seed:'ab'.repeat(32),authority_key_id:'shared_key',authority_public_key:keys.publicKey.export({type:'spki',format:'pem'}).toString(),referee_id:'referee',npc_controller_id:'npc_host',variant:'legend',hp_mode:'floor4',environment:'night',starting_kit:'borrowed_lamp',initial_knowledge_ids:['melia_lamp_loan_offer'],travelers:[{id:'hero',name:'The visitor',controller_id:'auth_hero',weapon:'spear',nature:{description:'Practical, wary and curious.',priorities:['return borrowed things','keep private counsel']},presentation:{occupation:'Traveler',wants:'Find a safe route through Kymene.',will_not:'Accept a hidden debt.'},max_speech_characters:1024}]};}
function mortalOptions(value:Options):MortalCampaignOptions{
 const {environment:_,starting_kit:__,initial_knowledge_ids:___,travelers,...rest}=value;
 return {...rest,travelers:travelers.map(({id,name,controller_id,weapon})=>({id,name,controller_id,weapon}))};
}
const strings=(value:unknown):string[]=>typeof value==='string'?[value]:value!==null&&typeof value==='object'?Object.values(value).flatMap(strings):[];

test('fresh shared seed binds one physical roster, exact owner profiles, authored rooms and pinned knowledge',()=>{
 const content=pack(),input=options(),result=build(content,input),g=result.genesis;
 assertWorldGenesis(g);assertMortalV3Genesis(g.mortal);assert.equal(g.version,'shared-world/0.1.0');assert.equal(g.mortal.version,'mortal-rules/0.3.0');
 assert.equal(g.mortal.world_time,0);assert.equal(g.environment,'night');assert.deepEqual(g.mortal.scope,input.scope);
 assert.deepEqual(g.profiles.map(p=>p.actor_id),g.mortal.actors.map(a=>a.id));
 for(const actor of g.mortal.actors){
  const profile=g.profiles.find(p=>p.actor_id===actor.id)!;assertWorldContract('Profile',profile);assert.equal(profile.revision,1);assert.equal(Object.hasOwn(profile,'name'),false);assert.equal(Object.hasOwn(profile,'minimum_interval'),false);
  const npc=content.npcs.find(n=>n.id===actor.id);
  if(npc){assert.deepEqual(profile.nature,npc.nature);assert.deepEqual(profile.activity,npc.activity);assert.equal(profile.max_speech_characters,npc.speech_policy.max_characters);assert.deepEqual(profile.presentation,{occupation:npc.occupation,wants:npc.wants,will_not:npc.will_not});}
 }
 const hero=g.profiles.find(p=>p.actor_id==='hero')!;assert.deepEqual(hero.nature,input.travelers[0]!.nature);assert.deepEqual(hero.presentation,input.travelers[0]!.presentation);assert.equal(hero.max_speech_characters,1024);assert.deepEqual(hero.activity,{description:'Following their own course.',busy_until:0});
 assert.deepEqual(g.scenes,g.mortal.locations.map(l=>({location_id:l.id,description:content.locations.find(row=>row.id===l.id)!.public_description})));
 assert.deepEqual(g.knowledge_catalog,campaignKnowledgeCatalog);assert.deepEqual(g.source_manifest,campaignKnowledgeSourceManifest);assert.deepEqual(g.initial_knowledge_ids,['melia_lamp_loan_offer']);
 assertKnowledgeCatalogIdentity(g.knowledge_catalog,g.source_manifest,campaignKnowledgeIdentity);
});

test('the exact source manifest verifies bundled documents and source identity stays in safe metadata',()=>{
 const input=options(),{genesis:g,manifest:m}=build(pack(),input);
 const paths=[...new Set(g.source_manifest.sources.map(row=>row.document_path))];
 assertAuthoredSourceBytes(g.source_manifest,paths.map(document_path=>({document_path,content:readFileSync(new URL('../'+document_path,import.meta.url),'utf8')})),campaignKnowledgeIdentity.source_manifest_hash);
 assert.deepEqual(Object.keys(m).sort(),['adapter','pack_hash','genesis_hash','mortal_genesis_hash','catalog_hash','source_manifest_hash','variant','hp_mode','environment','starting_kit','initial_knowledge_ids'].sort());
 assert.equal(m.adapter,'tempting-fates-shared/0.1.0');assert.equal(m.pack_hash,hash(world));assert.equal(m.genesis_hash,hash(g));assert.equal(m.mortal_genesis_hash,hash(g.mortal));assert.equal(m.catalog_hash,hash(g.knowledge_catalog));assert.equal(m.source_manifest_hash,hash(g.source_manifest));
 for(const key of ['variant','hp_mode','environment','starting_kit','initial_knowledge_ids'] as const)assert.deepEqual(m[key],input[key]);
 const metadata=JSON.stringify(m);for(const secret of [input.seed,input.authority_public_key,input.npc_controller_id,input.referee_id,input.travelers[0]!.controller_id,input.travelers[0]!.nature.description])assert.ok(!metadata.includes(secret));
});

test('all day/night, kit and variant choices are explicit and deterministic without changing old initialization',()=>{
 for(const environment of ['day','night'] as const)for(const starting_kit of ['standard','borrowed_lamp'] as const)for(const variant of ['genuine','counterfeit','legend'] as const){
  const input={...options(),environment,starting_kit,variant},original=buildMortalV3Campaign(pack(),mortalOptions(input)),before=canonical(original),result=build(pack(),input);
  assert.equal(canonical(build(pack(),input)),canonical(result));assert.equal(canonical(original),before);
  const expected=structuredClone(original.genesis);for(const route of expected.routes)route.requires_light=environment==='night';
  if(starting_kit==='borrowed_lamp')expected.items=expected.items.filter(i=>i.id!=='hero_lamp');
  assert.deepEqual(result.genesis.mortal,expected);
  assert.equal(result.genesis.mortal.items.find(i=>i.id==='traveler_lamp')!.owner_id,'melia');assert.equal(result.genesis.mortal.items.some(i=>i.id==='hero_lamp'),starting_kit==='standard');assert.ok(result.genesis.mortal.items.some(i=>i.id==='hero_firekit'));
  assert.equal(result.genesis.mortal.actors.find(a=>a.id==='hero')!.resources.oil,6);assert.equal(result.genesis.mortal.actors.find(a=>a.id==='hero')!.hp>=4,true);
 }
});

test('borrowed-lamp kits omit only each traveler personal lamp and grant no loan or possession',()=>{
 const input=options();input.travelers.push({...structuredClone(input.travelers[0]!),id:'companion',name:'Second visitor',controller_id:'auth_companion',weapon:'sling'});
 const g=build(pack(),input).genesis;
 for(const actor of ['hero','companion']){assert.ok(!g.mortal.items.some(i=>i.id===actor+'_lamp'));assert.ok(g.mortal.items.some(i=>i.id===actor+'_firekit'));assert.ok(g.mortal.items.some(i=>i.id===actor+'_weapon'));}
 assert.equal(g.mortal.items.find(i=>i.id==='traveler_lamp')!.owner_id,'melia');assert.equal(Object.hasOwn(g,'loans'),false);assert.equal(Object.hasOwn(g,'offers'),false);
});

test('night initialization actually requires a held lamp and consumes oil under the unchanged mortal kernel',()=>{
 for(const environment of ['day','night'] as const){
  const input={...options(),environment},g=build(pack(),input).genesis.mortal;
  let state=initialMortalV3State(g);
  const act=(actor_id:string,action:MortalV3Action,current:MortalV3State)=>{
   const actor=g.actors.find(a=>a.id===actor_id)!;
   return resolveMortalV3(g,current,{version:'mortal-rules/0.3.0',scope:g.scope,request_id:'fixture_'+current.sequence,actor_id,expected:{sequence:current.sequence,head:current.head},causation_id:current.head,action},{scope:g.scope,principal_id:actor.controller_id,actor_id,role:actor.kind}).state;
  };
  const hero=state.actors.find(a=>a.id==='hero')!,route=g.routes.find(r=>r.from===hero.location_id||r.to===hero.location_id)!,before=canonical(state);
  if(environment==='night'){
   assert.throws(()=>act('hero',{type:'travel',route_id:route.id},state),invalid);assert.equal(canonical(state),before);
   state=act('melia',{type:'transfer_item',item_id:'traveler_lamp',to_actor_id:'hero'},state);
  }
  const after=act('hero',{type:'travel',route_id:route.id},state),traveler=after.actors.find(a=>a.id==='hero')!;
  assert.notEqual(traveler.location_id,hero.location_id);assert.equal(after.world_time,route.turns*600);
  assert.equal(traveler.resources.oil,environment==='night'?6-route.turns:6);
  assert.equal(g.items.find(i=>i.id==='traveler_lamp')!.owner_id,'melia','Pure resolution must not mutate genesis');
 }
});

test('ordinary mortal roster excludes Fate identities, loom, lifespan authority and hidden campaign prose',()=>{
 const content=pack(),g=build(content,options()).genesis,actorIds=new Set(g.mortal.actors.map(a=>a.id));
 for(const fate of content.npcs.filter(n=>n.fate_role!==null))assert.ok(!actorIds.has(fate.id));
 for(const loom of content.locations.filter(l=>l.is_loom)){assert.ok(!g.mortal.locations.some(l=>l.id===loom.id));assert.ok(!g.scenes.some(s=>s.location_id===loom.id));}
 const text=strings(g);
 for(const npc of content.npcs)for(const secret of [...npc.private_knowledge,npc.speech_example])assert.ok(text.every(value=>!value.includes(secret)),secret);
 for(const location of content.locations)assert.ok(text.every(value=>!value.includes(location.referee_notes)));
 for(const variant of content.variants)assert.ok(text.every(value=>!value.includes(variant.referee_truth)));
 assert.equal(Object.hasOwn(g.mortal.actors[0]!,'time_balance'),false);assert.equal(Object.hasOwn(g.mortal.actors[0]!,'thread'),false);
});

test('empty initial grants withhold knowledge while unknown duplicate or foreign policies are refused',()=>{
 const input=options();input.initial_knowledge_ids=[];assert.deepEqual(build(pack(),input).genesis.initial_knowledge_ids,[]);
 for(const ids of [['unknown'],['melia_lamp_loan_offer','melia_lamp_loan_offer'],['dion_private_policy']]){const input=options();input.initial_knowledge_ids=ids;assert.throws(()=>build(pack(),input),invalid);}
 const extra:any=options();extra.knowledge_catalog=campaignKnowledgeCatalog;assert.throws(()=>build(pack(),extra),invalid);
});

test('changed authored pack or mismatched supplied source identities never become shared genesis',()=>{
 for(const mutate of [
  (p:CampaignPack)=>{p.npcs.find(n=>n.id==='melia')!.wants='Invent a debt.';},
  (p:CampaignPack)=>{p.locations[0]!.public_description='A different public scene.';},
  (p:CampaignPack)=>{p.npcs.find(n=>n.id==='melia')!.private_knowledge.push('A new secret');},
 ]){const content=pack();mutate(content);assert.throws(()=>build(content,options()),invalid);}
 for(const key of ['pack_hash','source_manifest','catalog_hash','world_time','mortal','snapshot']){const input:any=options();input[key]='attacker';assert.throws(()=>build(pack(),input),invalid);}
});

test('one safe ID namespace refuses authored/generated actor-item collisions before output',()=>{
 for(const starting_kit of ['standard','borrowed_lamp'] as const)for(const id of ['traveler','melia','melia_work_knife','traveler_lamp','hero\n','constructor','x'.repeat(64)]){
  const input=options();input.starting_kit=starting_kit;input.travelers[0]!.id=id;assert.throws(()=>build(pack(),input),invalid,id);
 }
 const colliding=options();colliding.travelers.push({...structuredClone(colliding.travelers[0]!),id:'hero_weapon',name:'Collision',controller_id:'another'});assert.throws(()=>build(pack(),colliding),invalid);
 const duplicate=options();duplicate.travelers.push(structuredClone(duplicate.travelers[0]!));assert.throws(()=>build(pack(),duplicate),invalid);
 const good=build(pack(),options()).genesis.mortal;const all=[...good.actors.map(a=>a.id),...good.items.map(i=>i.id)];assert.equal(new Set(all).size,all.length);
});

test('closed host options require explicit supported configuration and complete player profiles',()=>{
 for(const key of Object.keys(options())){const input:any=options();delete input[key];assert.throws(()=>build(pack(),input),invalid,key);}
 for(const mutate of [
  (v:any)=>{v.environment='dusk';},(v:any)=>{v.starting_kit='automatic';},(v:any)=>{v.variant='chosen';},(v:any)=>{v.hp_mode='immortal';},
  (v:any)=>{v.travelers[0].presentation.secret='private';},(v:any)=>{delete v.travelers[0].nature;},
  (v:any)=>{v.travelers[0].max_speech_characters=0;},(v:any)=>{v.travelers[0].max_speech_characters=2049;},
  (v:any)=>{v.travelers[0].nature.description=' ';},(v:any)=>{v.travelers[0].activity={description:'preloaded',busy_until:100};},
  (v:any)=>{v.scope.workspace_tenant_id='wrong';},(v:any)=>{v.scope.world_id='bad\n';},
  (v:any)=>{v.authority_public_key=keys.privateKey.export({type:'pkcs8',format:'pem'}).toString();},
 ]){const input=options();mutate(input);assert.throws(()=>build(pack(),input),invalid);}
});

test('pack/options/owned profiles reject getters and active or revoked proxies without executing them',()=>{
 for(const slot of ['pack','options','traveler','nature','presentation','knowledge'] as const){
  const content=pack(),input=options();let hits=0;
  const raw=slot==='pack'?content:slot==='options'?input:slot==='traveler'?input.travelers[0]!:slot==='nature'?input.travelers[0]!.nature:slot==='presentation'?input.travelers[0]!.presentation:input.initial_knowledge_ids;
  const key=slot==='pack'?'title':slot==='options'?'environment':slot==='traveler'?'name':slot==='nature'?'description':slot==='presentation'?'wants':'0';
  const getter=structuredClone(raw);Object.defineProperty(getter,key,{enumerable:true,get(){hits++;throw Error('Getter executed');}});
  const revoked=Proxy.revocable(raw,{});revoked.revoke();
  for(const active of [getter,new Proxy(raw,{get(){hits++;throw Error('Proxy read');},ownKeys(){hits++;throw Error('Proxy inspected');}}),revoked.proxy]){
   const q=options(),p=pack();if(slot==='traveler')q.travelers[0]=active as Options['travelers'][number];if(slot==='nature')q.travelers[0]!.nature=active as WorldProfile['nature'];if(slot==='presentation')q.travelers[0]!.presentation=active as WorldProfile['presentation'];if(slot==='knowledge')q.initial_knowledge_ids=active as string[];
   assert.throws(()=>build(slot==='pack'?active as CampaignPack:p,slot==='options'?active as Options:q),invalid);
  }
  assert.equal(hits,0);
 }
});

test('returned seed is detached/frozen and source factories, pack, options and old profiles are unchanged',()=>{
 const content=pack(),input=options(),before=canonical({content,input}),base=mortalOptions(input);
 const old=canonical(buildMortalCampaign(content,base)),old3=canonical(buildMortalV3Campaign(content,base));
 const result=build(content,input);assert.equal(canonical({content,input}),before);assert.equal(canonical(buildMortalCampaign(content,base)),old);assert.equal(canonical(buildMortalV3Campaign(content,base)),old3);
 assert.throws(()=>{result.genesis.environment='day';},TypeError);assert.throws(()=>{result.genesis.profiles[0]!.nature.priorities.push('New priority');},TypeError);assert.throws(()=>{result.manifest.initial_knowledge_ids.push('new');},TypeError);
 input.travelers[0]!.nature.description='Changed after creation';input.initial_knowledge_ids=[];content.npcs[0]!.wants='Changed source';
 assert.equal(result.genesis.profiles.find(p=>p.actor_id==='hero')!.nature.description,'Practical, wary and curious.');assert.deepEqual(result.genesis.initial_knowledge_ids,['melia_lamp_loan_offer']);
 for(const path of ['scenarios/tempted-fates/campaign/FREEZE.json','SYSTEMS/shared-world-v1/FREEZE.json','SYSTEMS/mortal-v3/FREEZE.json','SYSTEMS/characters-v1/FREEZE.json','SYSTEMS/dialogue-knowledge-v1/FREEZE.json']){
  const freeze=JSON.parse(readFileSync(new URL('../'+path,import.meta.url),'utf8')) as {files:Record<string,string>};
  for(const [file,wanted] of Object.entries(freeze.files))assert.equal(createHash('sha256').update(readFileSync(new URL('../'+file,import.meta.url))).digest('hex'),wanted,file);
 }
});
