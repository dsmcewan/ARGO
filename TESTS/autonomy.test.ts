import {test} from 'node:test';import assert from 'node:assert/strict';
import {runSubscriber,createProposalSubscriber} from '../packages/interventions/src/index.ts';import {initialSnapshot,makeCheckpoint} from '../packages/ledger/src/index.ts';import {proposalFromAction} from '../packages/argo-dm/src/index.ts';import {genesis,scope,principal} from './fixtures.ts';
import type {KnowledgeView} from '../packages/contracts/src/index.ts';
test('independent NPC and intervention loops submit optional proposals only through their bridge',async()=>{
 const checkpoint=makeCheckpoint(initialSnapshot(genesis()),'cp',['donor'],100);const view:KnowledgeView={schema_version:'1.0.0',scope,actor_id:'donor',audience:'actor',party_id:null,as_of_world_time:10,as_of_sequence:0,claims:[],ontology_blocked:false,engagement_closed:false};
 let submits=0;const bridge={submit:async()=>{submits++;return {schema_version:'1.0.0' as const,proposal_id:'p',event_id:'event_1',event_hash:'a'.repeat(64),sequence:1,world_time:10,kind:'causal' as const,action_type:'move_item' as const,rng_commitment:null};}};
 async function* updates(){yield {view,checkpoint};}
 const npc=createProposalSubscriber({actorId:'donor',plan:async()=>[]});
 const intervention=createProposalSubscriber({actorId:'donor',plan:async context=>[proposalFromAction(context.checkpoint,'donor',{type:'move_item',item_id:'lamp',to_actor_id:null},'p')]});
 assert.deepEqual(await runSubscriber({updates:updates(),subscriber:npc,principal:principal(),telos:bridge}),[]);assert.equal(submits,0);
 assert.equal((await runSubscriber({updates:updates(),subscriber:intervention,principal:principal(),telos:bridge})).length,1);assert.equal(submits,1);
});
