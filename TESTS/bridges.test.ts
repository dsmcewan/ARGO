import {test} from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {createTelosBridge,createTelosMock} from '../packages/telos-bridge/src/index.ts';
import {createLexiBridge,createLexiMock} from '../packages/lexi-bridge/src/index.ts';
import {openLedger} from '../packages/ledger/src/index.ts';import {genesis,keys,principal,proposal,scope} from './fixtures.ts';
import type {KnowledgeQuery,Outcome} from '../packages/contracts/src/index.ts';
const query=(sequence:number,time=10):KnowledgeQuery=>({schema_version:'1.0.0',scope:structuredClone(scope),actor_id:'donor',audience:'actor',party_id:null,as_of_world_time:time,as_of_sequence:sequence});
async function fixture(fn:(ledger:Awaited<ReturnType<typeof openLedger>>)=>Promise<void>){const directory=await mkdtemp(join(tmpdir(),'argo-bridges-'));try{await fn(await openLedger({directory,genesis:genesis(),privateKey:keys.privateKey}));}finally{await rm(directory,{recursive:true,force:true});}}
test('bridge defaults are closed; scope and response contracts are checked before use',async()=>fixture(async l=>{
 const p=proposal(await l.snapshot(),{type:'move_item',item_id:'lamp',to_actor_id:null});
 await assert.rejects(createTelosBridge({scope}).submit(p,principal()),/configured/);
 let calls=0;const client=createTelosBridge({scope,transport:async()=>{calls++;return {forged:true};}});
 await assert.rejects(client.submit({...p,scope:{...scope,rights_lane:'open_license'}},principal()),/scope/i);assert.equal(calls,0);
 await assert.rejects(client.submit(p,principal()),/Outcome contract/);
 const good=await createTelosBridge({scope,transport:createTelosMock(l)}).submit(p,principal());assert.equal(good.sequence,1);assert.ok(Object.isFrozen(good));
 await assert.rejects(createTelosBridge({scope,transport:async()=>({...good,proposal_id:'foreign'})}).submit(p,principal()),/response/i);
}));
test('bridge deadlines leave the event loop responsive, propagate abort and do not retry writes',async()=>fixture(async l=>{
 let calls=0,aborted=false,ticks=0;const timer=setInterval(()=>ticks++,2);
 const client=createTelosBridge({scope,timeoutMs:30,transport:async(_p,_auth,{signal})=>{calls++;signal.addEventListener('abort',()=>aborted=true);return new Promise<Outcome>(()=>{});}});
 try{await assert.rejects(client.submit(proposal(await l.snapshot(),{type:'move_item',item_id:'lamp',to_actor_id:null}),principal()),/deadline/i);assert.equal(calls,1);assert.equal(aborted,true);assert.ok(ticks>1);}finally{clearInterval(timer);}
 const c=new AbortController();c.abort();await assert.rejects(client.submit(proposal(await l.snapshot(),{type:'move_item',item_id:'lamp',to_actor_id:null}),principal(),{signal:c.signal}),/cancel/i);assert.equal(calls,1);
}));
test('LEXI filters by explicit actor, party disclosure, acquisition timestamp and sequence',async()=>fixture(async l=>{
 const submit=async(claim_id:string,observers:string[],party_id:string|null,occurred_at=0)=>l.submit(proposal(await l.snapshot(),{type:'observe_claim',observation:{claim_id,channel:claim_id==='rumor'?'rumor':'belief',source_id:'donor',content:claim_id,observers,party_id,occurred_at}}),principal());
 await submit('solo',['donor'],null);await submit('shared',['donor','traveler'],'party');
 const client=createLexiBridge({scope,transport:createLexiMock(()=>l.snapshot())});
 assert.deepEqual((await client.query(query(2),principal())).claims.map(c=>c.observation.claim_id),['solo','shared']);
 assert.deepEqual((await client.query({...query(2),audience:'party',party_id:'party'},principal())).claims.map(c=>c.observation.claim_id),['shared']);
 await l.submit(proposal(await l.snapshot(),{type:'advance_time',to_time:20},'system'),principal('system','system'));await submit('rumor',['donor'],null,1);
 assert.deepEqual((await client.query(query(4,10),principal())).claims.map(c=>c.observation.claim_id),['solo','shared']);
 assert.deepEqual((await client.query(query(1),principal())).claims.map(c=>c.observation.claim_id),['solo']);
 await assert.rejects(client.query(query(5,20),principal()),/cursor|future/i);
 await assert.rejects(client.query(query(4,21),principal()),/future/i);
 await assert.rejects(client.query(query(4,20),principal('outsider')),/actor/i);
 await assert.rejects(client.query({...query(4,20),actor_id:'outsider',audience:'party',party_id:'party'},principal('outsider')),/party/i);
 const before=await client.query(query(4,20),principal());
 const malicious=createLexiBridge({scope,transport:async()=>({...before,scope:{...scope,world_id:'foreign'}})});
 await assert.rejects(malicious.query(query(4,20),principal()),/scope/i);
}));
