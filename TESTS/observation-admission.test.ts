import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {canonical,hash} from '../packages/contracts/src/index.ts';
import type {IntentProposal,Principal} from '../packages/contracts/src/index.ts';
import {initialSnapshot} from '../packages/ledger/src/mechanics.ts';
import {genesis,principal,proposal} from './fixtures.ts';

const modulePath='../packages/contracts/src/observation-admission.ts';
const loaded=await import(modulePath).catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return {};throw error;});
const api:typeof import('../packages/contracts/src/observation-admission.ts')=loaded as typeof import('../packages/contracts/src/observation-admission.ts');
function available(){assert.equal(typeof api.createObservationAdmissionRequest,'function','Observation admission contract must be implemented');}
const attempt=()=>({attempt_id:'attempt_1',issued_at_ms:1000,deadline_ms:5000});
function input(observers=['donor'],party_id:string|null=null):IntentProposal{
 return proposal(initialSnapshot(genesis()),{type:'observe_claim',observation:{claim_id:'observation_1',channel:'rumor',source_id:'donor',content:'An attributed account.',observers,party_id,occurred_at:0}},'donor','observation_request');
}
function request(p=input(['donor','traveler'],'party'),auth:Principal=principal()){
 available();return api.createObservationAdmissionRequest(p,auth,attempt());
}
function grant(r=request()){
 if(r.proposal.action.type!=='observe_claim')throw Error('Observation fixture');
 const p=r.proposal,o=p.action.observation;
 return {version:r.version,request_hash:r.request_hash,attempt_id:r.attempt.attempt_id,deadline_ms:r.attempt.deadline_ms,scope:structuredClone(p.scope),cursor:{sequence:p.expected_sequence,head:p.expected_head,world_time:p.world_time},source_id:o.source_id,observers:[...o.observers],party_id:o.party_id};
}
const invalid={code:'INVALID_CONTRACT'},unauthorized={code:'UNAUTHORIZED'};

test('observation admission defaults to direct self-authorship and private acquisition',()=>{
 available();assert.equal(api.observationNeedsWitness(input(),principal()),false);
 assert.equal(api.observationNeedsWitness(input(['donor','traveler']),principal()),true);
 assert.equal(api.observationNeedsWitness(input(['donor'],'party'),principal()),true);
 const carrier=input(['system']);carrier.actor_id='system';if(carrier.action.type==='observe_claim')carrier.action.observation.source_id='system';
 assert.equal(api.observationNeedsWitness(carrier,principal('system','system')),false);
 for(const source of ['traveler','invented_source']){
  const p=input();if(p.action.type==='observe_claim')p.action.observation.source_id=source;
  assert.throws(()=>api.observationNeedsWitness(p,principal()),unauthorized);
 }
 assert.throws(()=>api.observationNeedsWitness({...input(),proxy_grant_id:'grant'},principal()),unauthorized);
 assert.throws(()=>api.observationNeedsWitness(input(),principal('traveler')),unauthorized);
 const clock=proposal(initialSnapshot(genesis()),{type:'advance_time',to_time:20},'system');
 assert.throws(()=>api.observationNeedsWitness(clock,principal('system','system')),invalid);
});

test('observation request identity binds complete proposal, authenticated principal and attempt window',()=>{
 const p=input(['donor','traveler'],'party'),auth=principal(),window=attempt();
 const r=request(p,auth);
 assert.equal(r.version,'observation-admission/1.0.0');
 assert.equal(r.request_hash,hash({domain:'observation-admission/1.0.0',proposal:p,principal:auth,attempt:window}));
 const changed=request(p,{...auth,confirmed_receipts:['receipt_1']});
 assert.notEqual(changed.request_hash,r.request_hash,'the complete supplied principal participates in this host authorization identity');
 const next=api.createObservationAdmissionRequest(p,auth,{...window,attempt_id:'attempt_2'});
 assert.notEqual(next.request_hash,r.request_hash);
 assert.notEqual(api.createObservationAdmissionRequest(p,auth,{...window,deadline_ms:4999}).request_hash,r.request_hash);
 const tampered=structuredClone(r);if(tampered.proposal.action.type==='observe_claim')tampered.proposal.action.observation.content='Changed.';
 assert.throws(()=>api.assertObservationAdmissionContract('ObservationAdmissionRequest',tampered),invalid);
});

test('witness grants authorize only their exact scoped request, recipients and checkpoint',()=>{
 const r=request(),g=grant(r);api.assertObservationWitnessGrant(g,r,1000);
 for(const change of [
  {request_hash:'f'.repeat(64)},{attempt_id:'another_attempt'},{deadline_ms:4999},
  {scope:{...g.scope,world_id:'other'}},{cursor:{sequence:1,head:'a'.repeat(64),world_time:10}},
  {cursor:{...g.cursor,world_time:11}},{source_id:'traveler'},
  {observers:['traveler','donor']},{observers:['donor']},{party_id:null},
 ])assert.throws(()=>api.assertObservationWitnessGrant({...g,...change},r,1000),unauthorized);
 assert.throws(()=>api.assertObservationWitnessGrant({...g,scope:{...g.scope,workspace_tenant_id:'wrong'}},r,1000));
 const altered=input(['donor','traveler'],'party');altered.causal_parents=['a'.repeat(64)];
 assert.throws(()=>api.assertObservationWitnessGrant(g,request(altered),1000),unauthorized);
 const newer=input(['donor','traveler'],'party');newer.expected_sequence=1;newer.expected_head='a'.repeat(64);
 assert.throws(()=>api.assertObservationWitnessGrant(g,request(newer),1000),unauthorized);
});

test('grant lifetime is bounded and half-open, without manufacturing a new retry deadline',()=>{
 const r=request(),g=grant(r);api.assertObservationWitnessGrant(g,r,4999);
 for(const now of [999,5000,5001])assert.throws(()=>api.assertObservationWitnessGrant(g,r,now),{code:'EXPIRED'});
 for(const now of [-0,1.5,Infinity,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>api.assertObservationWitnessGrant(g,r,now),invalid);
 for(const window of [
  {...attempt(),deadline_ms:1000},{...attempt(),deadline_ms:999},
  {...attempt(),deadline_ms:6001},{...attempt(),issued_at_ms:-1},
  {...attempt(),issued_at_ms:-0},{...attempt(),attempt_id:''},
 ])assert.throws(()=>api.createObservationAdmissionRequest(input(),principal(),window),invalid);
 assert.equal(api.createObservationAdmissionRequest(input(),principal(),{...attempt(),deadline_ms:6000}).attempt.deadline_ms,6000);
});

test('admission DTOs are closed, bounded and keep cursor nullability consistent',()=>{
 const r=request(),g=grant(r);
 for(const [name,value] of [['ObservationAdmissionRequest',r],['ObservationWitnessGrant',g],['ObservationAdmissionAttempt',r.attempt],['ObservationAdmissionCursor',g.cursor]] as const){
  api.assertObservationAdmissionContract(name,value);
  for(const key of Object.keys(value)){
   const missing={...value} as Record<string,unknown>;delete missing[key];
   assert.throws(()=>api.assertObservationAdmissionContract(name,missing),invalid);
  }
  assert.throws(()=>api.assertObservationAdmissionContract(name,{...value,extra:true}),invalid);
 }
 for(const change of [{sequence:0,head:'a'.repeat(64)},{sequence:1,head:null},{sequence:1,head:'G'.repeat(64)}])assert.throws(()=>api.assertObservationAdmissionContract('ObservationAdmissionCursor',{...g.cursor,...change}),invalid);
 assert.throws(()=>api.assertObservationAdmissionContract('ObservationWitnessGrant',{...g,observers:['donor','donor']}),invalid);
 assert.throws(()=>api.assertObservationAdmissionContract('ObservationWitnessGrant',{...g,observers:[]}),invalid);
 assert.throws(()=>api.assertObservationAdmissionContract('ObservationWitnessGrant',{...g,observers:Array.from({length:65},(_,i)=>`actor_${i}`)}),invalid);
 assert.throws(()=>api.assertObservationAdmissionContract('ObservationWitnessGrant',{...g,version:'1.0.0'}),invalid);
});

test('observation contract guards reject active data without invoking accessors or proxy traps',()=>{
 available();let touched=0;
 const p=input();Object.defineProperty(p,'action',{enumerable:true,get(){touched++;throw Error('Accessor ran');}});
 assert.throws(()=>api.observationNeedsWitness(p,principal()),invalid);
 const proxy=new Proxy(principal(),{get(){touched++;throw Error('Proxy ran');},ownKeys(){touched++;throw Error('Proxy ran');}});
 assert.throws(()=>api.createObservationAdmissionRequest(input(),proxy,attempt()),invalid);
 const r=request(),g=grant(r);Object.defineProperty(g.observers,'0',{enumerable:true,get(){touched++;return 'donor';}});
 assert.throws(()=>api.assertObservationWitnessGrant(g,r,1000),invalid);
 const nested=request();const forged=structuredClone(nested) as any;forged.principal.scope=new Proxy(forged.principal.scope,{getPrototypeOf(){touched++;throw Error('Proxy ran');}});
 assert.throws(()=>api.assertObservationAdmissionContract('ObservationAdmissionRequest',forged),invalid);
 assert.equal(touched,0);
 const decorated=grant(r);Object.defineProperty(decorated.observers,'hidden',{value:true});assert.throws(()=>api.assertObservationWitnessGrant(decorated,r,1000),invalid);
 const circular:any={};circular.self=circular;assert.throws(()=>api.assertObservationAdmissionContract('ObservationWitnessGrant',circular),invalid);
 let deep:unknown=null;for(let i=0;i<40;i++)deep={nested:deep};assert.throws(()=>api.assertObservationAdmissionContract('ObservationWitnessGrant',deep),invalid);
});

test('created admission requests own frozen data without freezing caller objects or mutating grants',()=>{
 const p=input(['donor','traveler'],'party'),auth=principal(),window=attempt();available();
 const r=api.createObservationAdmissionRequest(p,auth,window),before=canonical(r);
 if(p.action.type==='observe_claim'){p.action.observation.content='Changed';p.action.observation.observers.push('outsider');}
 auth.principal_id='changed';window.attempt_id='changed';assert.equal(canonical(r),before);
 assert.ok(Object.isFrozen(r));assert.ok(Object.isFrozen(r.proposal.action));assert.ok(Object.isFrozen(r.principal.scope));
 assert.equal(Object.isFrozen(p),false);assert.equal(Object.isFrozen(auth),false);
 const g=grant(r),bytes=canonical(g);api.assertObservationWitnessGrant(g,r,1000);assert.equal(canonical(g),bytes);assert.equal(Object.isFrozen(g),false);
 assert.ok(Object.isFrozen(api.observationAdmissionSchema));
});

test('observation admission freeze pins the contract, schema and shared type/guard module',async()=>{
 const text=await readFile(new URL('../SYSTEMS/observation-admission-v1/FREEZE.json',import.meta.url),'utf8').catch(error=>{if(error.code==='ENOENT')return null;throw error;});
 assert.notEqual(text,null,'Observation admission requires its own explicit freeze manifest');
 const freeze=JSON.parse(text!) as {profile_version:string;files:Record<string,string>};
 assert.equal(freeze.profile_version,'observation-admission/1.0.0');
 assert.deepEqual(Object.keys(freeze.files).sort(),[
  'SYSTEMS/observation-admission-v1/CONTRACT.md',
  'SYSTEMS/observation-admission-v1/observation-admission.schema.json',
  'packages/contracts/src/observation-admission.ts',
 ]);
 for(const [path,digest] of Object.entries(freeze.files)){
  assert.match(digest,/^[0-9a-f]{64}$/);
  assert.equal(createHash('sha256').update(await readFile(new URL('../'+path,import.meta.url))).digest('hex'),digest,path);
 }
});
