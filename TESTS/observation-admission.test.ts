import {test} from 'node:test';
import type {TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,sign} from 'node:crypto';
import fs,{readFile,mkdtemp,rm,writeFile,unlink} from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {canonical,hash} from '../packages/contracts/src/index.ts';
import type {IntentProposal,Principal,LedgerEvent} from '../packages/contracts/src/index.ts';
import {initialSnapshot,unsigned,eventHash,replay} from '../packages/ledger/src/mechanics.ts';
import {openLedger} from '../packages/ledger/src/index.ts';
import {projectKnowledge} from '../packages/lexi-bridge/src/index.ts';
import type {ObservationAdmissionRequest,ObservationWitnessGrant,ObservationWitnessVerifier} from '../packages/contracts/src/observation-admission.ts';
import {genesis,keys,principal,proposal} from './fixtures.ts';

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

function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return {promise,resolve};}
async function runtime(t:TestContext,verify?:ObservationWitnessVerifier){
 const directory=await mkdtemp(join(tmpdir(),'argo-observation-admission-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const seed=genesis(),options={directory,genesis:seed,privateKey:keys.privateKey,...(verify?{authorizeObservationWitnesses:verify}:{})};
 const ledger=await openLedger(options);return {directory,seed,ledger,options};
}

test('new raw source and recipient attacks fail without events while private self observations stay callback-free',async t=>{
 let calls=0;const f=await runtime(t,async r=>{calls++;return grant(r);});
 for(const source_id of ['traveler','invented_source']){
  const p=input();if(p.action.type==='observe_claim')p.action.observation.source_id=source_id;
  await assert.rejects(f.ledger.submit(p,principal()),unauthorized);
 }
 const noHost=await runtime(t);
 for(const p of [input(['outsider']),input(['donor','traveler'],'party'),input(['donor'],'party')])await assert.rejects(noHost.ledger.submit(p,principal()),unauthorized);
 assert.equal((await f.ledger.snapshot()).sequence,0);assert.equal((await noHost.ledger.events()).length,0);assert.equal(calls,0);
 const receipt=await f.ledger.submit(input(),principal());assert.equal(receipt.sequence,1);assert.equal(calls,0);
 const state=await f.ledger.snapshot();assert.equal(state.claims.length,1);assert.equal(state.rng_counter,0);
});

test('host witness runs outside the writer lock and grants only its exact visible acquisition',async t=>{
 const entered=deferred<ObservationAdmissionRequest>(),release=deferred<ObservationWitnessGrant>();let callbackSnapshot:any;
 const f=await runtime(t,async(r,s)=>{callbackSnapshot=s;entered.resolve(r);return release.promise;});
 const p=input(['donor','traveler'],'party'),pending=f.ledger.submit(p,principal()),r=await entered.promise;
 assert.ok(Object.isFrozen(r.proposal.action));assert.ok(Object.isFrozen(callbackSnapshot.actors));
 // This read must complete while the host verifier is still deliberately held.
 assert.equal((await f.ledger.snapshot()).sequence,0);
 release.resolve(grant(r));const receipt=await pending;assert.equal(receipt.sequence,1);
 const state=await f.ledger.snapshot(),query={schema_version:'1.0.0' as const,scope:f.seed.scope,actor_id:'traveler',audience:'party' as const,party_id:'party',as_of_sequence:1,as_of_world_time:10};
 assert.equal(projectKnowledge(state,query,principal('traveler')).claims.length,1);
 assert.equal(projectKnowledge(state,{...query,as_of_sequence:0},principal('traveler')).claims.length,0);
 assert.equal(projectKnowledge(state,{...query,actor_id:'outsider',audience:'actor',party_id:null},principal('outsider')).claims.length,0);
 const bytes=canonical(await f.ledger.events())+canonical(receipt);
 assert.equal(bytes.includes(r.request_hash),false);assert.equal(bytes.includes(r.attempt.attempt_id),false);
 assert.deepEqual(replay(f.seed,await f.ledger.events()),state);
});

test('a concurrent commit invalidates an outstanding witness grant without delivering its claim',async t=>{
 const entered=deferred<ObservationAdmissionRequest>(),release=deferred<ObservationWitnessGrant>();
 const f=await runtime(t,async r=>{entered.resolve(r);return release.promise;});
 const pending=f.ledger.submit(input(['outsider']),principal());const r=await entered.promise;
 await f.ledger.submit(proposal(await f.ledger.snapshot(),{type:'advance_time',to_time:20},'system'),principal('system','system'));
 release.resolve(grant(r));await assert.rejects(pending,{code:'CONFLICT'});
 const state=await f.ledger.snapshot();assert.equal(state.sequence,1);assert.equal(state.claims.length,0);
});

test('two handles reconcile identical witnessed submissions before demanding another grant',async t=>{
 const entered=deferred<void>(),release=deferred<void>();let calls=0;
 const f=await runtime(t,async r=>{if(++calls===2)entered.resolve();await release.promise;return grant(r);});
 const other=await openLedger(f.options),p=input(['outsider']);
 const first=f.ledger.submit(p,principal()),second=other.submit(p,principal());await entered.promise;release.resolve();
 const [a,b]=await Promise.all([first,second]);assert.deepEqual(a,b);assert.equal((await f.ledger.snapshot()).sequence,1);
 assert.deepEqual(await other.submit(p,principal()),a);assert.equal(calls,2);
});

test('cancelled host work cannot append when it resolves late and the linked signal is aborted',async t=>{
 const entered=deferred<{request:ObservationAdmissionRequest;signal:AbortSignal}>(),release=deferred<ObservationWitnessGrant>();
 const f=await runtime(t,async(r,_s,call)=>{entered.resolve({request:r,signal:call.signal});return release.promise;});
 const controller=new AbortController(),pending=f.ledger.submit(input(['outsider']),principal(),{signal:controller.signal});
 const {request:r,signal}=await entered.promise;controller.abort();await assert.rejects(pending,{code:'CANCELLED'});assert.equal(signal.aborted,true);
 release.resolve(grant(r));await new Promise<void>(resolve=>setImmediate(resolve));assert.equal((await f.ledger.snapshot()).sequence,0);
});

test('runtime refuses a changed grant, host denial and active grant data without appending',async t=>{
 const mutations=[(g:ObservationWitnessGrant)=>({...g,request_hash:'f'.repeat(64)}),(g:ObservationWitnessGrant)=>({...g,observers:['donor']}),(g:ObservationWitnessGrant)=>({...g,party_id:'party'}),(g:ObservationWitnessGrant)=>({...g,scope:{...g.scope,world_id:'other'}}),(g:ObservationWitnessGrant)=>({...g,deadline_ms:g.deadline_ms+1})];
 for(const mutate of mutations){const f=await runtime(t,async r=>mutate(grant(r)));await assert.rejects(f.ledger.submit(input(['outsider']),principal()),unauthorized);assert.equal((await f.ledger.events()).length,0);}
 const denied=await runtime(t,async()=>null);await assert.rejects(denied.ledger.submit(input(['outsider']),principal()),unauthorized);
 let touched=0;const active=await runtime(t,async r=>{const g=grant(r);Object.defineProperty(g,'observers',{enumerable:true,get(){touched++;return ['outsider'];}});return g;});
 await assert.rejects(active.ledger.submit(input(['outsider']),principal()),invalid);assert.equal(touched,0);
});

test('historical v1 source injection still replays and an exact authenticated retry needs no new witness',async t=>{
 let calls=0;const f=await runtime(t,async()=>{calls++;return null;}),p=input(['donor','outsider']);
 if(p.action.type==='observe_claim')p.action.observation.source_id='historical_external_source';
 const event:LedgerEvent={schema_version:'1.0.0',event_id:'event_1',scope:f.seed.scope,ruleset_version:f.seed.ruleset_version,sequence:1,previous_hash:null,hash:'0'.repeat(64),kind:'epistemic',proposal:p,authority:{kind:'telos',principal_id:'auth_donor',key_id:f.seed.authority_key_id,signature:'AA==',principal_actor_id:'donor',principal_role:'player',receipt_hash:null},rng:null};
 event.authority.signature=sign(null,Buffer.from(canonical(unsigned(event))),keys.privateKey).toString('base64');event.hash=eventHash(event);
 await writeFile(join(f.directory,'events.jsonl'),canonical(event)+'\n');
 const state=await f.ledger.snapshot();assert.equal(state.claims[0]!.observation.source_id,'historical_external_source');assert.deepEqual(replay(f.seed,[event]),state);
 const receipt=await f.ledger.submit(p,principal());assert.equal(receipt.event_hash,event.hash);assert.equal(calls,0);
 await assert.rejects(f.ledger.submit(p,{...principal(),principal_id:'other_auth'}),unauthorized);
 await assert.rejects(f.ledger.submit({...p,proposal_id:'new_request',expected_sequence:1,expected_head:event.hash},principal()),/Claim already recorded/);
 assert.equal((await f.ledger.events()).length,1);
});

test('witness deadline starts at submission and preflight waiting cannot renew its budget',async t=>{
 const entered=deferred<ObservationAdmissionRequest>(),release=deferred<ObservationWitnessGrant>();
 const f=await runtime(t,async r=>{entered.resolve(r);return release.promise;});
 const lock=join(f.directory,'writer.lock');await writeFile(lock,'{}');let clock=1000;t.mock.method(Date,'now',()=>clock);
 const pending=f.ledger.submit(input(['outsider']),principal());await new Promise<void>(resolve=>setImmediate(resolve));
 clock=2000;await unlink(lock);const r=await entered.promise;
 assert.equal(r.attempt.issued_at_ms,2000);assert.equal(r.attempt.deadline_ms,6000);
 clock=6000;release.resolve(grant(r));await assert.rejects(pending,{code:'EXPIRED'});assert.equal((await f.ledger.events()).length,0);
});

test('expiry during writer relock cannot append a previously valid witness grant',async t=>{
 const returned=deferred<void>();let clock=1000,directory='';t.mock.method(Date,'now',()=>clock);
 const f=await runtime(t,async r=>{await writeFile(join(directory,'writer.lock'),'{}');returned.resolve();return grant(r);});directory=f.directory;
 const rejected=assert.rejects(f.ledger.submit(input(['outsider']),principal()),error=>error!==null&&typeof error==='object'&&'code'in error&&['EXPIRED','UNAVAILABLE'].includes(String(error.code)));
 await returned.promise;await new Promise<void>(resolve=>setImmediate(resolve));
 clock=6000;await unlink(join(directory,'writer.lock'));await rejected;
 assert.equal((await f.ledger.snapshot()).sequence,0);
});

test('grant expiry immediately before journal writing fails without changing journal bytes',async t=>{
 let clock=1000,deadline=0;t.mock.method(Date,'now',()=>clock);
 const f=await runtime(t,async r=>{deadline=r.attempt.deadline_ms;return grant(r);});
 const original=fs.open,spy=t.mock.method(fs,'open',async(...args:Parameters<typeof fs.open>)=>{
  const file=await original(...args);if(args[0]===join(f.directory,'events.jsonl')&&args[1]==='a')clock=deadline;return file;
 });
 syncBuiltinESMExports();t.after(()=>{spy.mock.restore();syncBuiltinESMExports();});
 await assert.rejects(f.ledger.submit(input(['outsider']),principal()),{code:'EXPIRED'});
 assert.equal(await readFile(join(f.directory,'events.jsonl'),'utf8'),'');assert.equal((await f.ledger.snapshot()).sequence,0);
});

test('an uncooperative witness callback is bounded and receives an aborted signal at its deadline',{timeout:10000},async t=>{
 let signal:AbortSignal|undefined;const f=await runtime(t,async(_r,_s,call)=>{signal=call.signal;return new Promise(()=>{});});
 await assert.rejects(f.ledger.submit(input(['outsider']),principal()),{code:'UNAVAILABLE'});
 assert.equal(signal?.aborted,true);assert.equal((await f.ledger.events()).length,0);
});

test('cheap state checks reject invalid outward requests before witness work',async t=>{
 let calls=0;const f=await runtime(t,async r=>{calls++;return grant(r);});
 const future=input(['outsider']);if(future.action.type==='observe_claim')future.action.observation.occurred_at=11;
 const unknown=input(['unknown']);
 const outsideParty=input(['outsider'],'party');
 const stale={...input(['outsider']),expected_sequence:1,expected_head:'a'.repeat(64)};
 const orphan={...input(['outsider']),causal_parents:['a'.repeat(64)]};
 for(const p of [future,unknown,outsideParty,stale,orphan])await assert.rejects(f.ledger.submit(p,principal()));
 assert.equal(calls,0);assert.equal((await f.ledger.events()).length,0);
});

test('a valid legacy proxy grant cannot authorize a new observation even with a host verifier',async t=>{
 let calls=0;const f=await runtime(t,async r=>{calls++;return grant(r);});
 await f.ledger.submit(proposal(await f.ledger.snapshot(),{type:'grant_proxy',grant:{grant_id:'proxy_observe',grantor_id:'donor',grantee_id:'proxy',actions:['observe_claim'],resource_ids:['observation_1'],valid_from:10,expires_at:20,max_uses:1}}),principal());
 const state=await f.ledger.snapshot(),p={...input(['outsider']),expected_sequence:state.sequence,expected_head:state.head,causal_parents:[state.head!],proxy_grant_id:'proxy_observe'};
 await assert.rejects(f.ledger.submit(p,principal('proxy')),unauthorized);
 assert.equal(calls,0);const after=await f.ledger.snapshot();assert.equal(after.sequence,1);assert.equal(after.grants.proxy_observe!.uses,0);assert.equal(after.claims.length,0);
});

test('caller mutation and a retained host response cannot rewrite the authorized observation',async t=>{
 const entered=deferred<ObservationAdmissionRequest>(),release=deferred<ObservationWitnessGrant>(),returned=deferred<void>();let directory='';
 const f=await runtime(t,async r=>{entered.resolve(r);const response=await release.promise;await writeFile(join(directory,'writer.lock'),'{}');returned.resolve();return response;});directory=f.directory;
 const p=input(['outsider']),auth=principal(),pending=f.ledger.submit(p,auth),r=await entered.promise;
 const original=structuredClone(p);if(p.action.type==='observe_claim'){p.action.observation.content='Caller rewrite';p.action.observation.observers=['traveler'];}
 auth.actor_id='traveler';auth.confirmed_receipts.push('changed');
 const response=grant(r);release.resolve(response);await returned.promise;
 // The authority has captured the grant before waiting for its second lock.
 await new Promise<void>(resolve=>setImmediate(resolve));response.observers=['traveler'];response.request_hash='f'.repeat(64);
 await unlink(join(directory,'writer.lock'));await pending;
 assert.deepEqual((await f.ledger.events())[0]!.proposal,original);assert.equal(Object.isFrozen(response),false);
});

test('a changed verified journal prefix invalidates outstanding host authorization',async t=>{
 const entered=deferred<ObservationAdmissionRequest>(),release=deferred<ObservationWitnessGrant>();
 const f=await runtime(t,async r=>{entered.resolve(r);return release.promise;});
 await f.ledger.submit(proposal(await f.ledger.snapshot(),{type:'advance_time',to_time:20},'system'),principal('system','system'));
 const state=await f.ledger.snapshot(),p={...input(['outsider']),expected_sequence:state.sequence,expected_head:state.head,world_time:20,causal_parents:[state.head!]};
 const pending=f.ledger.submit(p,principal()),r=await entered.promise;await writeFile(join(f.directory,'events.jsonl'),'');
 release.resolve(grant(r));await assert.rejects(pending,{code:'CORRUPT_LEDGER'});assert.equal(await readFile(join(f.directory,'events.jsonl'),'utf8'),'');
});

test('cancellation at the awaited journal open prevents the observation append',async t=>{
 const controller=new AbortController(),f=await runtime(t,async r=>grant(r));
 const original=fs.open,spy=t.mock.method(fs,'open',async(...args:Parameters<typeof fs.open>)=>{
  const file=await original(...args);if(args[0]===join(f.directory,'events.jsonl')&&args[1]==='a')controller.abort();return file;
 });
 syncBuiltinESMExports();t.after(()=>{spy.mock.restore();syncBuiltinESMExports();});
 await assert.rejects(f.ledger.submit(input(['outsider']),principal(),{signal:controller.signal}),{code:'CANCELLED'});
 assert.equal(await readFile(join(f.directory,'events.jsonl'),'utf8'),'');assert.equal((await f.ledger.events()).length,0);
});
