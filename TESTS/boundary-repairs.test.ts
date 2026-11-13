import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {canonical,assertKnowledgeDisclosure} from '../packages/contracts/src/index.ts';
import type {ClaimRecord,EncounterCheckpoint,KnowledgeQuery,KnowledgeView,Snapshot} from '../packages/contracts/src/index.ts';
import {initialSnapshot,makeCheckpoint,openLedger} from '../packages/ledger/src/index.ts';
import {createLexiBridge,projectKnowledge} from '../packages/lexi-bridge/src/index.ts';
import {createTelosBridge,createTelosMock} from '../packages/telos-bridge/src/index.ts';
import {createProposalSubscriber,runSubscriber} from '../packages/interventions/src/index.ts';
import type {DerivedContext} from '../packages/interventions/src/index.ts';
import {genesis,keys,principal,proposal,scope} from './fixtures.ts';

function contextFor(state:Snapshot):DerivedContext{
 const query:KnowledgeQuery={schema_version:'1.0.0',scope:structuredClone(scope),actor_id:'donor',audience:'actor',party_id:null,as_of_world_time:state.world_time,as_of_sequence:state.sequence};
 return {view:projectKnowledge(state,query,principal()),checkpoint:makeCheckpoint(state,'boundary',['donor'],100)};
}

test('subscriber rejects invalid checkpoints before a handwritten proposal can commit',async t=>{
 for(const invalid of [
 {name:'already expired',changes:{expires_at:9},code:'EXPIRED'},
 {name:'at the half-open expiry',changes:{expires_at:10},code:'EXPIRED'},
 {name:'queue policy',changes:{policy:'queue'},code:'CAPABILITY_UNSUPPORTED'},
 {name:'transparent fork policy',changes:{policy:'transparent_fork'},code:'CAPABILITY_UNSUPPORTED'}
 ] as const){
  await t.test(invalid.name,async()=>{
  const directory=await mkdtemp(join(tmpdir(),'argo-boundary-'));
  try{
   const ledger=await openLedger({directory,genesis:genesis(),privateKey:keys.privateKey});
   const state=await ledger.snapshot(),context=contextFor(state);
   Object.assign(context.checkpoint,invalid.changes);
   let plans=0;
   // This planner intentionally bypasses proposalFromAction. The subscriber
   // must enforce checkpoint validity before any untrusted planning runs.
   const subscriber=createProposalSubscriber({actorId:'donor',plan:async()=>{
    plans++;return [proposal(state,{type:'move_item',item_id:'lamp',to_actor_id:'traveler'})];
   }});
   async function* updates(){yield context;}
   await assert.rejects(runSubscriber({updates:updates(),subscriber,principal:principal(),telos:createTelosBridge({scope,transport:createTelosMock(ledger)})}),{code:invalid.code});
   assert.equal(plans,0);
   assert.equal((await ledger.events()).length,0);
   assert.equal((await ledger.snapshot()).items.lamp!.custodian_id,'donor');
  }finally{await rm(directory,{recursive:true,force:true});}
  });
 }
});

test('subscriber binds handwritten proposal time to its checkpoint or advance action',async()=>{
 const state=initialSnapshot(genesis()),context=contextFor(state);
 for(const action of [{type:'move_item',item_id:'lamp',to_actor_id:'traveler'},{type:'advance_time',to_time:30}] as const){
  const wrong=proposal(state,action);
  wrong.world_time=action.type==='advance_time'?10:11;
  const subscriber=createProposalSubscriber({actorId:'donor',plan:async()=>[wrong]});
  await assert.rejects(subscriber.onView(context),{code:'UNAUTHORIZED'});
 }
});

test('subscriber preserves supported live checkpoints and detached frozen proposals',async()=>{
 const state=initialSnapshot(genesis());
 for(const policy of ['serialize','reject'] as const satisfies readonly EncounterCheckpoint['policy'][]){
  const context=contextFor(state);context.checkpoint.policy=policy;
  const source=proposal(state,{type:'move_item',item_id:'lamp',to_actor_id:'traveler'});
  const subscriber=createProposalSubscriber({actorId:'donor',plan:async()=>[source]});
  const result=await subscriber.onView(context);
  source.actor_id='outsider';
  assert.equal(result[0]!.actor_id,'donor');
  assert.ok(Object.isFrozen(result));assert.ok(Object.isFrozen(result[0]!.action));
 }
});

function swappingArray<T>(before:T,after:T,onRead:()=>void):T[]{
 const values:T[]=[];
 Object.defineProperty(values,'0',{enumerable:true,get(){
  onRead();
  // Reproduce R05: validation sees safe bytes, a later native clone sees the
  // substituted value. A data-only boundary must reject without either read.
  return new Error().stack?.includes('structuredClone')?after:before;
 }});
 return values;
}

test('canonical rejects accessor array indices without invoking them',()=>{
 let reads=0;
 const values=swappingArray(1,2,()=>reads++);
 assert.throws(()=>canonical(values),{code:'INVALID_CONTRACT'});
 assert.equal(reads,0);
});

test('canonical rejects hidden array decorations and non-enumerable indices',()=>{
 const decorated=[1];Object.defineProperty(decorated,'hidden',{value:'not JSON data'});
 assert.throws(()=>canonical(decorated),{code:'INVALID_CONTRACT'});
 const hiddenIndex=[1];Object.defineProperty(hiddenIndex,'0',{value:1,enumerable:false});
 assert.throws(()=>canonical(hiddenIndex),{code:'INVALID_CONTRACT'});
 assert.equal(canonical(Object.freeze([1,{b:2,a:3}])),'[1,{"a":3,"b":2}]');
});

const query=():KnowledgeQuery=>({schema_version:'1.0.0',scope:structuredClone(scope),actor_id:'donor',audience:'actor',party_id:null,as_of_world_time:10,as_of_sequence:1});
const known=():ClaimRecord=>({observation:{claim_id:'known',channel:'rumor',source_id:'donor',content:'SAFE',observers:['donor'],party_id:null,occurred_at:10},acquired_at:10,sequence:1,event_id:'event_1'});

test('LEXI rejects the accessor claim substitution before reading private data',async()=>{
 const safe=known(),hidden=known();hidden.observation.content='FOREIGN_SECRET';hidden.observation.observers=['outsider'];
 let reads=0;
 const unsafe:KnowledgeView={...query(),claims:swappingArray(safe,hidden,()=>reads++),ontology_blocked:false,engagement_closed:false};
 const bridge=createLexiBridge({scope,transport:async()=>unsafe});
 await assert.rejects(bridge.query(query(),principal()),{code:'INVALID_CONTRACT'});
 assert.equal(reads,0);
});

test('LEXI returns a detached, authorized, deeply frozen view',async()=>{
 const source:KnowledgeView={...query(),claims:[known()],ontology_blocked:false,engagement_closed:false};
 const view=await createLexiBridge({scope,transport:async()=>source}).query(query(),principal());
 source.claims[0]!.observation.content='FOREIGN_SECRET';
 source.claims[0]!.observation.observers=['outsider'];
 assertKnowledgeDisclosure(view);
 assert.equal(view.claims[0]!.observation.content,'SAFE');
 assert.ok(Object.isFrozen(view.claims[0]!.observation.observers));
});

test('subscriber rejects accessor proposal entries before a clone can replace the actor',async()=>{
 const state=initialSnapshot(genesis()),context=contextFor(state);
 const safe=proposal(state,{type:'move_item',item_id:'lamp',to_actor_id:'traveler'}),foreign={...safe,actor_id:'outsider'};
 let reads=0;
 const subscriber=createProposalSubscriber({actorId:'donor',plan:async()=>swappingArray(safe,foreign,()=>reads++)});
 await assert.rejects(subscriber.onView(context),{code:'INVALID_CONTRACT'});
 assert.equal(reads,0);
});
