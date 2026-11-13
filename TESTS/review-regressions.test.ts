import {test} from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {initialSnapshot,openLedger} from '../packages/ledger/src/index.ts';import {projectKnowledge} from '../packages/lexi-bridge/src/index.ts';import {createNarrator} from '../packages/argo-dm/src/index.ts';import {genesis,keys,scope,principal,proposal} from './fixtures.ts';import type {KnowledgeView} from '../packages/contracts/src/index.ts';
const view=():KnowledgeView=>({schema_version:'1.0.0',scope:structuredClone(scope),actor_id:'donor',audience:'actor',party_id:null,as_of_world_time:10,as_of_sequence:0,claims:[],ontology_blocked:false,engagement_closed:false});
test('genesis cannot create an absent thread without a committed cutoff',()=>{const g=genesis();g.actors.traveler!.thread='absent';assert.throws(()=>initialSnapshot(g),/genesis|absent|cutoff/i);});
test('prototype names cannot impersonate real actors or custodians',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'argo-own-actor-'));try{
  const l=await openLedger({directory,genesis:genesis(),privateKey:keys.privateKey});
  for(const id of ['toString','constructor','hasOwnProperty'])await assert.rejects(l.submit(proposal(await l.snapshot(),{type:'move_item',item_id:'lamp',to_actor_id:id}),principal()),/actor/);
  const state=await l.snapshot();assert.equal(state.sequence,0);
  assert.throws(()=>projectKnowledge(state,{...view(),actor_id:'toString'} as never,principal('toString')),/contract|actor/);
 }finally{await rm(directory,{recursive:true,force:true});}
});
test('only the freshly authorized claims enter a model request',async()=>{
 const original=view(),safe=view();original.claims=[{observation:{claim_id:'secret',channel:'rumor',source_id:'outsider',content:'FOREIGN_SECRET',observers:['outsider'],party_id:null,occurred_at:0},acquired_at:20,sequence:99,event_id:'future'}];
 let captured='';const client={responses:{create:async(req:unknown)=>{captured=JSON.stringify(req);return {status:'completed',id:'r',output:[{type:'message',content:[{type:'output_text',text:'safe'}]}]};}}};
 const narrator=createNarrator({scope,sessionId:'s',candidates:[{vendor:'xai',model:'grok-4.7',pool:'test'}],clientFor:()=>client,refreshView:async()=>safe});
 await narrator.narrate({view:original,persona:'Plain Guide',prompt:'story'});assert.equal(captured.includes('FOREIGN_SECRET'),false);
});
test('caller mutations during refresh cannot reach vendor context',async()=>{
 const input=view();let release:()=>void=()=>{};const wait=new Promise<void>(resolve=>release=resolve);let entered:()=>void=()=>{};const ready=new Promise<void>(resolve=>entered=resolve);let refreshes=0,captured='';
 const client={responses:{create:async(req:unknown)=>{captured=JSON.stringify(req);return {status:'completed',id:'r',output:[{type:'message',content:[{type:'output_text',text:'safe'}]}]};}}};
 const narrator=createNarrator({scope,sessionId:'s',candidates:[{vendor:'xai',model:'grok-4.7',pool:'test'}],clientFor:()=>client,refreshView:async supplied=>{if(++refreshes===1){entered();await wait;}return supplied;}});
 const result=narrator.narrate({view:input,persona:'Plain Guide',prompt:'story'});await ready;input.scope.world_id='FOREIGN_WORLD';release();await result;
 assert.equal(captured.includes('FOREIGN_WORLD'),false);
});
test('mutating a shared refreshed view cannot change a retry context',async()=>{
 const shared=view();let calls=0,refreshes=0;const requests:string[]=[];
 const client={responses:{create:async(req:unknown)=>{
  requests.push(JSON.stringify(req));
  if(++calls===1){shared.scope.world_id='FOREIGN_WORLD';shared.claims=[{observation:{claim_id:'secret',channel:'rumor',source_id:'outsider',content:'FOREIGN_SECRET',observers:['outsider'],party_id:null,occurred_at:0},acquired_at:20,sequence:99,event_id:'future'}];throw Object.assign(Error('retry fixture'),{status:503,headers:{'retry-after':'0'}});}
  return {status:'completed',id:'r',output:[{type:'message',content:[{type:'output_text',text:'safe'}]}]};
 }}};
 const narrator=createNarrator({scope,sessionId:'s',candidates:[{vendor:'xai',model:'grok-4.7',pool:'test'}],clientFor:()=>client,refreshView:async()=>++refreshes===1?shared:view()});
 await narrator.narrate({view:view(),persona:'Plain Guide',prompt:'story'});assert.equal(calls,2);
 assert.equal(requests.some(request=>request.includes('FOREIGN_WORLD')||request.includes('FOREIGN_SECRET')),false);
});
