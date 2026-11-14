import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const root=process.env.ARGO_REVIEW_ROOT!;
const api=await import(pathToFileURL(root+'/packages/contracts/src/shared-world.ts').href);
const {hash}=await import(pathToFileURL(root+'/packages/contracts/src/index.ts').href);
const f=await import(pathToFileURL(root+'/TESTS/shared-world-contract-fixtures.ts').href);
const rejected=(fn:()=>unknown)=>assert.throws(fn,(e:any)=>e.code==='INVALID_CONTRACT');
const memory=(s:any,id:string,actor_id:string|null,payload:any,acquired_by:string[],world_time=0)=>({record_id:hash({domain:'shared-world/0.1.0/memory',genesis_hash:s.genesis_hash,request_id:id,sequence:s.memories.length+1}),request_id:id,sequence:s.memories.length+1,world_time,actor_id,acquired_by,payload});
function append(s:any,row:any){s.memories.push(row);s.cursor={sequence:row.sequence,head:'d'.repeat(64),world_time:row.world_time};}
function impressionFixture(){
 const g=f.worldGenesis(),s=f.worldState();g.profiles[0].revision=3;s.profiles=structuredClone(g.profiles);s.genesis_hash=hash(g);s.cursor.head=s.genesis_hash;
 append(s,memory(s,'heard','companion',{type:'speak',text:'I can help.',audience:{kind:'whisper',addressed_actor_ids:['hero']},in_reply_to:null},['companion','hero']));
 const row=memory(s,'thought','hero',{type:'impress',subject_actor_id:'companion',interpretation:'Helpful.',impression_id:'a'.repeat(64)},['hero']);row.payload.impression_id=row.record_id;append(s,row);
 s.impressions.push({impression_id:row.record_id,owner_actor_id:'hero',subject_actor_id:'companion',evidence_ids:[s.memories[0].record_id],sequence:2,world_time:0,nature_revision:3,nature:structuredClone(g.profiles[0].nature),interpretation:'Helpful.',previous_impression_id:null});
 api.assertWorldContract('State',s,g);return {g,s};
}
test('genesis-bound Resolution rejects immutable controller mutation as State does',()=>{
 const g=f.worldGenesis(),s=f.worldOfferedState();s.physical.actors[0].controller_id='forged_controller';
 rejected(()=>api.assertWorldContract('State',s,g));
 rejected(()=>api.assertWorldContract('Resolution',{state:s,draws:[],effects:[],memory:s.memories.at(-1)},g));
});
test('genesis-bound Resolution rejects a completely foreign genesis/scope',()=>{
 const g=f.worldGenesis(),s=f.worldOfferedState();s.scope={...s.scope,world_id:'foreign'};s.genesis_hash='e'.repeat(64);
 s.offers[0].terms.genesis_hash=s.genesis_hash;s.offers[0].offer_hash=hash({domain:'shared-world/0.1.0/loan-offer',terms:s.offers[0].terms});
 s.memories[0].payload={type:'loan_offered',terms:s.offers[0].terms,offer_hash:s.offers[0].offer_hash};s.memories[0].record_id=hash({domain:'shared-world/0.1.0/memory',genesis_hash:s.genesis_hash,request_id:s.memories[0].request_id,sequence:1});
 api.assertWorldContract('State',s);rejected(()=>api.assertWorldContract('State',s,g));
 rejected(()=>api.assertWorldContract('Resolution',{state:s,draws:[],effects:[],memory:s.memories[0]},g));
});
test('impressions cannot invent an earlier nature revision in an immutable-profile world',()=>{
 const {g,s}=impressionFixture();s.impressions[0].nature_revision=2;s.impressions[0].nature={description:'Forged earlier personality.',priorities:['betray everyone']};
 rejected(()=>api.assertWorldContract('State',s,g));
});
test('revoking owner knowledge preserves a prior live durable offer',()=>{
 const g=f.worldGenesis(),s=f.worldOfferedState();const row=memory(s,'revoke',null,{type:'set_knowledge',knowledge_id:'lamp_policy',owner_actor_id:'hero',active:false},['hero']);append(s,row);s.knowledge=[{knowledge_id:'lamp_policy',origin:'event',sequence:2,world_time:0,active:false}];api.assertWorldContract('State',s,g);
});
test('an expired offer no longer blocks a new offer of the same item',()=>{
 const g=f.worldGenesis(),s=f.worldOfferedState();append(s,memory(s,'wait','hero',{type:'mortal',action:'wait',actor_ids:['hero'],item_ids:[],location_ids:['harbor']},['hero'],600));
 s.physical.actors[0].active_seconds=600;s.physical.actors[0].fed_until=86400;s.physical.actors[0].resources.rations--;s.physical.actors[0].resources.water--;
 const terms={...s.offers[0].terms,offer_id:'second_offer',issued_sequence:3,issued_at:600,expires_at:1200};const offer_hash=hash({domain:'shared-world/0.1.0/loan-offer',terms});append(s,memory(s,'second','hero',{type:'loan_offered',terms,offer_hash},['hero','companion'],600));s.offers.push({terms,offer_hash,status:'open',closed_sequence:null});api.assertWorldContract('State',s,g);
});
test('recovered custody via pickup can atomically fulfill a dropped loan',()=>{
 const g=f.worldGenesis(),s=f.worldAcceptedState();append(s,memory(s,'drop','companion',{type:'mortal',action:'transfer_item',actor_ids:['companion'],item_ids:['lamp'],location_ids:['harbor']},['companion','hero']));
 const item=s.physical.items.find((i:any)=>i.id==='lamp');item.owner_id=null;item.location_id='harbor';api.assertWorldContract('State',s,g);
 append(s,memory(s,'regain','hero',{type:'loan_returned',loan_id:'lamp_offer',offer_id:'lamp_offer',item_id:'lamp',lender_actor_id:'hero',borrower_actor_id:'companion',holder_actor_id:'hero',via_mortal:'pickup'},['hero','companion']));item.owner_id='hero';item.location_id=null;s.loans[0].status='returned';s.loans[0].returned_sequence=4;api.assertWorldContract('State',s,g);
});
test('request identity preserves same request ID while binding cursor and principal changes',()=>{
 const e=f.worldEvent(),first=api.worldRequestHash(e.command,e.principal);assert.equal(api.worldRequestHash(structuredClone(e.command),structuredClone(e.principal)),first);
 const c={...e.command,expected:{...e.command.expected,sequence:2,head:'c'.repeat(64)},causation_id:'c'.repeat(64)};assert.notEqual(api.worldRequestHash(c,e.principal),first);assert.notEqual(api.worldRequestHash(e.command,{...e.principal,principal_id:'other'}),first);
});
test('a shape-valid event principal still must bind the immutable controller when genesis is supplied',()=>{
 const e=f.worldEvent();e.principal.principal_id='forged';api.assertWorldContract('Event',e);rejected(()=>api.assertWorldContract('Event',e,f.worldGenesis()));
});
test('referee grants and loan memory cannot leak through request IDs or foreign acquirers',()=>{
 const s=f.worldOfferedState();s.memories[0].acquired_by.push('raider');rejected(()=>api.assertWorldContract('State',s,f.worldGenesis()));
 const v=f.worldView();v.memories=[f.worldMemory()];v.query.cursor={sequence:1,head:'a'.repeat(64),world_time:0};v.coverage={memory_total:1,memory_returned:1,impressions_total:0,impressions_returned:0,complete:true};rejected(()=>api.assertWorldContract('ActorView',v,f.worldGenesis()));
});
