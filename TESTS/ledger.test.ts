import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm,appendFile,readFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {openLedger,replay} from '../packages/ledger/src/index.ts';
import {canonical,hash,assertContract} from '../packages/contracts/src/index.ts';
import {genesis,keys,principal,proposal} from './fixtures.ts';
const fixture=async(fn:(ledger:Awaited<ReturnType<typeof openLedger>>,directory:string)=>Promise<void>)=>{const directory=await mkdtemp(join(tmpdir(),'argo-ledger-'));try{await fn(await openLedger({directory,genesis:genesis(),privateKey:keys.privateKey}),directory);}finally{await rm(directory,{recursive:true,force:true});}};
test('every durable event prefix replays bit-for-bit, with signed causal/epistemic history and private RNG',async()=>fixture(async (ledger,directory)=>{
 const g=genesis();const snapshots=[];
 const actions=[{type:'move_item',item_id:'lamp',to_actor_id:'traveler'},{type:'observe_claim',observation:{claim_id:'claim',channel:'rumor',source_id:'donor',content:'A private rumor',observers:['donor'],party_id:null,occurred_at:0}},{type:'advance_time',to_time:20},{type:'draw',label:'hidden',bound:20,visibility:'authority',audience_id:null}] as const;
 for(const action of actions){const system=['advance_time','draw'].includes(action.type);const p=proposal(await ledger.snapshot(),structuredClone(action) as never,system?'system':'donor');const out=await ledger.submit(p,principal(p.actor_id,system?'system':'player'));assertContract('Outcome',out);assert.equal(JSON.stringify(out).includes('nonce'),false);snapshots.push((await readFile(join(directory,'snapshot.json'),'utf8')).trimEnd());}
 const events=await ledger.events();assert.equal(events[1]!.kind,'epistemic');
 for(let n=1;n<=events.length;n++)assert.equal(canonical(replay(g,events.slice(0,n))),snapshots[n-1]);
 const changed=structuredClone(events);changed[0]!.proposal.actor_id='outsider';assert.throws(()=>replay(g,changed),/signature|hash|corrupt/i);
 const badSeed=structuredClone(g);badSeed.seed='cd'.repeat(32);assert.throws(()=>replay(badSeed,events),/random|RNG|corrupt/i);
}));
test('exact retries are idempotent, changed IDs and stale concurrent heads cannot append',async()=>fixture(async(ledger,directory)=>{
 const state=await ledger.snapshot();const p=proposal(state,{type:'move_item',item_id:'lamp',to_actor_id:'traveler'});
 const first=await ledger.submit(p,principal());assert.deepEqual(await ledger.submit(p,principal()),first);
 await assert.rejects(ledger.submit({...p,action:{type:'move_item',item_id:'lamp',to_actor_id:'outsider'}},principal()),/idempotency|proposal/i);
 const second=await openLedger({directory,genesis:genesis(),privateKey:keys.privateKey});
 const current=await ledger.snapshot();const a=proposal(current,{type:'advance_time',to_time:30},'system'),b=proposal(current,{type:'advance_time',to_time:40},'system');
 const settled=await Promise.allSettled([ledger.submit(a,principal('system','system')),second.submit(b,principal('system','system'))]);assert.equal(settled.filter(r=>r.status==='fulfilled').length,1);
 assert.equal((await second.snapshot()).sequence,2);
}));
test('scope, causality and authority failures append nothing; partial tails fail closed',async()=>fixture(async(ledger,directory)=>{
 const p=proposal(await ledger.snapshot(),{type:'move_item',item_id:'lamp',to_actor_id:null});
 await assert.rejects(ledger.submit({...p,scope:{...p.scope,world_id:'elsewhere'}},principal()),/scope/i);
 await assert.rejects(ledger.submit({...p,causal_parents:['f'.repeat(64)]},principal()),/parent/i);
 await assert.rejects(ledger.submit(p,principal('outsider')),/actor|auth/i);
 assert.equal((await ledger.events()).length,0);
 await appendFile(join(directory,'events.jsonl'),'{"partial":');
 await assert.rejects(openLedger({directory,genesis:genesis(),privateKey:keys.privateKey}),/corrupt|partial/i);
}));
test('canonical codec rejects collisions, unsafe integers and prototype-sensitive keys',()=>{
 assert.equal(canonical({z:1,a:2}),'\u007b"a":2,"z":1}');
 for(const value of [NaN,Infinity,-0,1.2,Number.MAX_SAFE_INTEGER+1,undefined,[,1],JSON.parse('{"__proto__":1}')])assert.throws(()=>canonical(value));
 assert.notEqual(hash({a:'\u00e9'}),hash({a:'e\u0301'}));
 assert.throws(()=>assertContract('IntentProposal',{made_up:true}),/contract/i);
});
