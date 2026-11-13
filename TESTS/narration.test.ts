import {test} from 'node:test';import assert from 'node:assert/strict';
import {createNarrator} from '../packages/argo-dm/src/index.ts';
import {scope} from './fixtures.ts';import type {KnowledgeView} from '../packages/contracts/src/index.ts';
const view=():KnowledgeView=>({schema_version:'1.0.0',scope,actor_id:'donor',audience:'actor',party_id:null,as_of_world_time:10,as_of_sequence:0,claims:[],ontology_blocked:false,engagement_closed:false});
test('a cutoff arriving while the model thinks discards its prose before delivery',async()=>{
 let blocked=false,calls=0;const requests:unknown[]=[];
 const client={responses:{create:async(req:unknown)=>{requests.push(req);calls++;blocked=true;return {status:'completed',id:'r',output:[{type:'message',content:[{type:'output_text',text:'The hidden ontology is...'}]}]};}}};
 const narrator=createNarrator({scope,sessionId:'s',candidates:[{vendor:'xai',model:'grok-4.7',pool:'test'}],clientFor:()=>client,
  refreshView:async input=>({...input,ontology_blocked:blocked})});
 assert.equal(await narrator.narrate({view:view(),persona:'The Chronicler',prompt:'Tell the story'}),'');assert.equal(calls,1);
});
test('a normal narrator cannot run without an authenticated fresh-view source',async()=>{
 let calls=0;const narrator=createNarrator({scope,sessionId:'s',candidates:[{vendor:'xai',model:'grok-4.7',pool:'test'}],clientFor:()=>{calls++;throw Error('should not run');}});
 await assert.rejects(narrator.narrate({view:view(),persona:'Plain Guide',prompt:'story'}),/fresh|refresh/i);assert.equal(calls,0);
});
