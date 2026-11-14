import test from 'node:test';
import assert from 'node:assert/strict';
import {ArgoError,hash} from '../packages/contracts/src/index.ts';
import {assertWorldContract} from '../packages/contracts/src/shared-world.ts';
import type {WorldAction,WorldCommand,WorldEvent,WorldState} from '../packages/contracts/src/shared-world-types.ts';
import {initialWorldState,resolveWorld,worldStateHash} from '../packages/ledger/src/world/rules.ts';
import {ownWorldGenesis,withWorldHead} from '../packages/ledger/src/world/rules/ownership.ts';
import {createWorldEvent,replayWorld} from '../packages/ledger/src/world/journal.ts';
import {genesis,principal,command,commit,speak,offer,accept} from './shared-world-rules-helpers.ts';
import {keys} from './mortal-fixtures.ts';

const invalid=(error:unknown)=>error instanceof ArgoError&&error.code==='INVALID_CONTRACT';
function oracle(state:WorldState):string{
 const {head:_,...cursor}=state.cursor;
 return hash({domain:'shared-world/0.1.0/state',state:{...state,cursor}});
}
function descriptorReads<T>(watched:object[],operation:()=>T):{value:T;reads:number}{
 const original=Object.getOwnPropertyDescriptors,targets=new Set(watched);let reads=0;
 Object.getOwnPropertyDescriptors=((value:object)=>{if(targets.has(value))reads++;return original(value);}) as typeof Object.getOwnPropertyDescriptors;
 try{return {value:operation(),reads};}finally{Object.getOwnPropertyDescriptors=original;}
}

test('new owned state hashes reuse historical record encoding instead of inspecting old records again',()=>{
 const g=ownWorldGenesis(genesis());let state=initialWorldState(g);
 for(let n=0;n<24;n++)state=commit(g,state,speak(`Record ${n}: \"quoted\" \\ \n 雪 🙂`));
 const next=resolveWorld(g,state,command(state,speak('Another record')),principal(g)).state;
 const checked=descriptorReads(state.memories,()=>worldStateHash(next));
 assert.equal(checked.value,oracle(next));
 assert.equal(checked.reads,0,'Already owned historical records must not repeat canonical descriptor traversal');
});

test('private state encoding matches the unchanged canonical oracle through signed mixed transitions',()=>{
 const raw=genesis();raw.profiles[0]!.nature.description='Snow 雪, smile 🙂, lone surrogate \ud800, quote \" and slash \\.';
 const g=ownWorldGenesis(raw),events:WorldEvent[]=[];let state=initialWorldState(g);
 const append=(action:WorldAction,id='hero')=>{
  const before=state,created=createWorldEvent(g,state,command(state,action,id),principal(g,id),keys.privateKey);
  assert.equal(created.event.before_hash,oracle(before));assert.equal(created.event.after_hash,oracle(created.state));
  assert.equal(worldStateHash(created.state),oracle(created.state));assert.equal(worldStateHash(before),oracle(before));
  events.push(created.event);state=created.state;
 };
 assert.equal(worldStateHash(state),oracle(state));
 append(speak('Unicode 雪 🙂 \ud800 and controls \n\t\u0000, quote \" slash \\'));
 append({type:'speak',text:'A reply.',audience:{kind:'whisper',addressed_actor_ids:['hero']},in_reply_to:state.memories[0]!.record_id},'raider');
 append({type:'impress',subject_actor_id:'raider',evidence_ids:[state.memories[1]!.record_id],interpretation:'Attentive 🙂.',previous_impression_id:null});
 append({type:'set_activity',activity:{description:'Writing 雪.',busy_until:0}});
 append(offer());append(accept(state),'companion');append({type:'return_loan',loan_id:'lamp_offer'},'companion');
 append(offer('withdrawn_offer'));append({type:'withdraw_loan_offer',offer_id:'withdrawn_offer'});
 append({type:'mortal',action:{type:'wait',turns:1}});
 append({type:'set_knowledge',knowledge_id:'lamp_policy',active:false},'host');
 append({type:'close_mythic_engagement'},'host');
 assert.deepEqual(replayWorld(g,events),state);
 const reversed=Object.fromEntries(Object.entries(structuredClone(state)).reverse()) as WorldState;
 assert.equal(worldStateHash(reversed),oracle(state));
});

test('encoded owned prefixes and divergent forks remain immutable and independent',()=>{
 const g=ownWorldGenesis(genesis()),zero=initialWorldState(g),base=commit(g,zero,speak('Original'));
 const before=structuredClone(base),beforeHash=oracle(base),left=commit(g,base,speak('Left')),right=commit(g,base,speak('Right'));
 assert.notEqual(worldStateHash(left),worldStateHash(right));
 assert.equal(worldStateHash(left),oracle(left));assert.equal(worldStateHash(right),oracle(right));
 const headed=withWorldHead(left,'f'.repeat(64));assert.equal(worldStateHash(headed),oracle(left));
 assert.deepEqual(base,before);assert.equal(worldStateHash(base),beforeHash);assert.equal(zero.memories.length,0);
 assert.throws(()=>{left.memories[0]!.payload.type='close_mythic_engagement';},TypeError);
 assert.throws(()=>resolveWorld(g,base,command(base,speak('Far away',['remote'])),principal(g)));
 const afterFailure=commit(g,base,speak('Valid fork'));
 assert.equal(worldStateHash(afterFailure),oracle(afterFailure));assert.deepEqual(base,before);
});

test('caller clones, freezing and active inputs cannot confer encoding cache trust',()=>{
 const g=ownWorldGenesis(genesis()),state=commit(g,initialWorldState(g),speak('Saved')),digest=worldStateHash(state);
 const raw=structuredClone(state);if(raw.memories[0]!.payload.type==='speak')raw.memories[0]!.payload.text='Changed';
 assert.notEqual(worldStateHash(raw),digest);assert.equal(worldStateHash(raw),oracle(raw));assert.equal(worldStateHash(state),digest);
 const forged=structuredClone(state);forged.memories[0]!.sequence=2;Object.freeze(forged);assert.throws(()=>worldStateHash(forged),invalid);
 assert.throws(()=>withWorldHead(Object.freeze(structuredClone(state)),'e'.repeat(64)),invalid);
 let touched=0;const active=structuredClone(state);Object.defineProperty(active.memories[0]!,'payload',{enumerable:true,get(){touched++;throw Error('getter');}});
 assert.throws(()=>worldStateHash(active),invalid);
 const proxy=new Proxy(state,{get(){touched++;throw Error('proxy');},ownKeys(){touched++;throw Error('proxy');}});
 assert.throws(()=>worldStateHash(proxy),invalid);const revoked=Proxy.revocable(state,{});revoked.revoke();assert.throws(()=>worldStateHash(revoked.proxy),invalid);
 assert.equal(touched,0);assert.equal(worldStateHash(state),digest);
});

test('owned transition admission does not inspect immutable genesis again for every command',()=>{
 const g=ownWorldGenesis(genesis()),state=initialWorldState(g),c=command(state,speak()),p=principal(g);
 const checked=descriptorReads([g,g.mortal,g.knowledge_catalog,g.source_manifest],()=>resolveWorld(g,state,c,p));
 assert.equal(checked.value.state.memories[0]!.request_id,c.request_id);
 assert.equal(checked.reads,0,'Validated owned genesis must not repeat passive inspection or canonical hashing');
});

test('command context admission matches the frozen oracle for every action and reference or policy failure',()=>{
 const g=ownWorldGenesis(genesis()),state=commit(g,initialWorldState(g),speak('Evidence'));
 const mortalActions:Extract<WorldAction,{type:'mortal'}>['action'][]=[
   {type:'travel',route_id:'road'},{type:'explore',opportunity_id:'forage'},{type:'rest'},{type:'wait',turns:1},
   {type:'equip',item_id:'spear',equipped:false},{type:'transfer_item',item_id:'lamp',to_actor_id:'companion'},
   {type:'pickup',item_id:'lamp'},{type:'loot',item_id:'lamp'},{type:'give',to_actor_id:'companion',resource:'obols',units:1},
   {type:'buy',stock_id:'food',units:1},{type:'begin_encounter',encounter_id:'fight',side_a:['hero'],side_b:['raider'],escape_allowed:true},
   {type:'attack',target_id:'raider',weapon_id:'spear'},{type:'defend'},{type:'retreat'},{type:'pass'},
   {type:'recover_encounter',encounter_id:'fight',turn_started_sequence:1,resolution:'pass',reason:'No response.'},
 ];
 const actions:WorldAction[]=[
  speak(),{type:'impress',subject_actor_id:'raider',evidence_ids:[state.memories[0]!.record_id],interpretation:'Patient.',previous_impression_id:null},
  {type:'set_activity',activity:{description:'Working.',busy_until:0}},offer(),{type:'withdraw_loan_offer',offer_id:'absent'},
  {type:'accept_loan',offer_id:'absent',offer_hash:'a'.repeat(64)},{type:'return_loan',loan_id:'absent'},
  {type:'set_knowledge',knowledge_id:'lamp_policy',active:true},{type:'close_mythic_engagement'},
  ...mortalActions.map(action=>({type:'mortal' as const,action})),
 ];
 const inputs:unknown[]=[];
 for(const action of actions){const host=action.type==='set_knowledge'||action.type==='close_mythic_engagement'||action.type==='mortal'&&['begin_encounter','recover_encounter'].includes(action.action.type);
  const c=command(state,action,host?'host':'hero');inputs.push(c,{...c,actor_id:'ghost'},{...c,scope:{...c.scope,world_id:'foreign'}},{...c,unexpected:true});
 }
 for(const action of [speak('Unknown addressee',['ghost']),{type:'impress',subject_actor_id:'ghost',evidence_ids:[state.memories[0]!.record_id],interpretation:'Unknown.',previous_impression_id:null}])inputs.push(command(state,action as WorldAction));
 const offered=offer() as Extract<WorldAction,{type:'offer_loan'}>;
 for(const patch of [{borrower_actor_id:'ghost'},{item_id:'missing'},{return_location_id:'missing'},{policy_id:'missing'},
  {item_id:'spear'},{repair_cap_obols:6},{repair_cap_obols:5},{repair_cap_obols:0}])inputs.push(command(state,{...offered,...patch}));
 inputs.push(command(state,offered,'companion'),command(state,offered,'raider'),command(state,{type:'set_knowledge',knowledge_id:'missing',active:false},'host'));
 for(const [i,input] of inputs.entries()){
  let expected=true;try{assertWorldContract('Command',input,g);}catch(error){assert.ok(invalid(error),`oracle ${i}`);expected=false;}
  let actual=true;const c=input as WorldCommand,p=principal(g,c.actor_id===null?'host':'hero');
  try{resolveWorld(g,state,c,p);}catch(error){assert.ok(error instanceof ArgoError,`context ${i} must fail with a domain error`);actual=error.code!=='INVALID_CONTRACT';}
  assert.equal(actual,expected,`context admission differs at case ${i}: ${JSON.stringify(input)}`);
 }
});

test('cached command context still rejects hostile DTOs and cannot be poisoned through raw genesis mutation',()=>{
 const raw=genesis(),g=ownWorldGenesis(raw),state=initialWorldState(g),p=principal(g);let touched=0;
 const getter=command(state,speak());Object.defineProperty(getter,'action',{enumerable:true,get(){touched++;throw Error('getter');}});
 const proxy=new Proxy(command(state,speak()),{ownKeys(){touched++;throw Error('proxy');}}),revoked=Proxy.revocable(command(state,speak()),{});revoked.revoke();
 const decorated=command(state,speak());Object.defineProperty(decorated,'extra',{value:true,enumerable:false});
 for(const input of [getter,proxy,revoked.proxy,decorated])assert.throws(()=>resolveWorld(g,state,input,p),invalid);
 raw.knowledge_catalog.entries[0]!.terms.repair_cap_obols=100;
 assert.throws(()=>resolveWorld(g,state,command(state,{...offer(),repair_cap_obols:6} as WorldAction),p),invalid);
 raw.mortal.actors[0]!.controller_id='changed';assert.equal(resolveWorld(g,state,command(state,speak()),p).state.cursor.sequence,1);
 assert.throws(()=>resolveWorld(raw,state,command(state,speak()),p),invalid);
 assert.equal(touched,0);assert.equal(worldStateHash(state),oracle(state));
});
