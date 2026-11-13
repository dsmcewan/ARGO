import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const root=resolve(process.argv[2]);
const load=path=>import(pathToFileURL(resolve(root,path)).href);
const {createCharacterViews}=await load('packages/lexi-bridge/src/characters.ts');
const {assertCharacterContract,ArgoError}=await load('packages/contracts/src/index.ts');
const {characterScope,characterPrincipal,characterProfile,CHARACTER_VERSION}=await load('TESTS/character-fixtures.ts');
const digest=n=>n.toString(16).padStart(64,'0');
let state=0xa031f27c, assertions=0;
function random(max){state^=state<<13;state^=state>>>17;state^=state<<5;return (state>>>0)%max;}
function eq(a,b){assert.deepEqual(a,b);assertions++;}
const code=expected=>error=>error instanceof ArgoError&&error.code===expected;
function query(p,actor='witness'){return {version:CHARACTER_VERSION,scope:structuredClone(p.scope),cursor:structuredClone(p.cursor),actor_id:actor};}
function narrator(p,limit=7){return {...query(p),traveler_id:'traveler',audience:'party',party_id:'party',after_sequence:0,limit};}
function base(){return {version:CHARACTER_VERSION,scope:characterScope(),cursor:{sequence:200,head:digest(200),world_time:20},activation_sequence:1,profiles:[characterProfile('witness')],actors:['traveler','witness','other','constructor','prototype'].map(actor_id=>({actor_id,alive:true})),parties:[{party_id:'party',actor_ids:['traveler','witness']},{party_id:'other_party',actor_ids:['traveler','witness']}],records:[],impressions:[],ontology_blocked:false,engagement_closed:false};}
function makeRecord(sequence,actor_id){return {experience:{record_id:digest(sequence),kind:'speech',actor_id,principal_actor_id:actor_id,sequence,world_time:10,text:`source_${sequence}`,action_type:null,addressed_actor_ids:[]},acquisitions:[{actor_id,sequence,world_time:10,party_id:null}]};}
for(let trial=0;trial<30;trial++){
 const p=base();
 for(let sequence=2;sequence<62;sequence++){
  const row=makeRecord(sequence,random(4)?'traveler':'other');
  for(let j=0;j<3;j++)if(random(2))row.acquisitions.push({actor_id:'witness',sequence:sequence+random(200-sequence),world_time:10+random(11),party_id:[null,'party','other_party'][j]});
  p.records.push(row);
 }
 assertCharacterContract('CharacterProjection',p);
 const readers=createCharacterViews({scope:p.scope,readProjection:async()=>p});
 const expected=p.records.filter(row=>row.experience.actor_id==='traveler'&&row.acquisitions.some(a=>a.actor_id==='witness'&&a.party_id==='party')).map(row=>row.experience.record_id);
 for(const limit of [1,7,128]){
  const q=narrator(p,limit),collected=[];
  for(let page=0;page<61;page++){
   const view=await readers.narrator(q,characterPrincipal('witness'));
   assert(!JSON.stringify(view).includes('acquisitions'));assertions++;
   collected.push(...view.records.map(row=>row.record_id));
   if(view.next_after_sequence===null)break;
   assert(view.records.length>0&&view.next_after_sequence>q.after_sequence);assertions++;
   q.after_sequence=view.next_after_sequence;
  }
  eq(collected,expected);
 }
 const learned=p.records.filter(row=>row.acquisitions.some(a=>a.actor_id==='witness')).map(row=>({record:row.experience,first:Math.min(...row.acquisitions.filter(a=>a.actor_id==='witness').map(a=>a.sequence))}));
 const expectedRecent=learned.sort((a,b)=>b.first-a.first||b.record.sequence-a.record.sequence).slice(0,16).map(row=>row.record.sequence).sort((a,b)=>a-b);
 eq((await readers.actor(query(p),characterPrincipal('witness'))).experiences.map(row=>row.sequence),expectedRecent);
 const own=await readers.narrator({...narrator(p),actor_id:'traveler',audience:'actor',party_id:null,limit:128},characterPrincipal());
 eq(own.records.map(row=>row.record_id),p.records.filter(row=>row.experience.actor_id==='traveler').map(row=>row.experience.record_id));
 p.ontology_blocked=true;
 eq((await readers.narrator(narrator(p),characterPrincipal('witness'))).records,[]);
}
const p=base();p.records=[makeRecord(2,'traveler')];
const mkImpression=(sequence,owner,subject,prior=null)=>({impression_id:digest(1000+sequence),sequence,world_time:10,data:{owner_actor_id:owner,subject_actor_id:subject,evidence_ids:[digest(2)],nature_revision:1,nature:characterProfile(owner).nature,interpretation:`belief_${sequence}`,previous_impression_id:prior}});
p.impressions=[mkImpression(90,'witness','traveler',digest(1020)),mkImpression(50,'other','traveler'),mkImpression(20,'witness','traveler'),mkImpression(60,'witness','constructor')];
const reader=createCharacterViews({scope:p.scope,readProjection:async()=>p});
eq((await reader.actor(query(p),characterPrincipal('witness'))).impressions.map(row=>row.sequence),[60,90]);
eq((await reader.actor(query(p,'traveler'),characterPrincipal())).impressions,[]);
for(const actor of ['constructor','prototype'])eq((await reader.actor(query(p,actor),characterPrincipal(actor))).experiences,[]);
for(const patch of [{head:digest(199)},{world_time:19},{sequence:199},{sequence:201}]){
 const q=query(p);Object.assign(q.cursor,patch);
 await assert.rejects(reader.actor(q,characterPrincipal('witness')),code('CONFLICT'));assertions++;
}
let trapCalls=0;
const proxied=new Proxy(p,{getPrototypeOf(){trapCalls++;throw new Error('trap');}});
const proxyReader=createCharacterViews({scope:p.scope,readProjection:async()=>proxied});
await assert.rejects(proxyReader.actor(query(p),characterPrincipal('witness')),code('INVALID_CONTRACT'));assertions++;
eq(trapCalls,0);
const future=structuredClone(p);future.records[0].acquisitions.push({actor_id:'other',sequence:201,world_time:10,party_id:null});
await assert.rejects(createCharacterViews({scope:p.scope,readProjection:async()=>future}).actor(query(p),characterPrincipal('witness')),code('INVALID_CONTRACT'));assertions++;
console.log(JSON.stringify({status:'pass',randomized_projections:30,assertions,seed:'0xa031f27c',cases:['party filtering and pagination across 1/7/128 limits','earliest acquisition recency despite repeated grants','complete private traveler archive','cutoff after source update','unordered owner impression history','prototype-like actor identifiers','exact cursor binding','proxy source rejection without trap execution','future hidden acquisition rejection']}));
