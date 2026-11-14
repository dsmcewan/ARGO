// Independent, offline runtime probes. Requires a clean, immutable candidate.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {sign} from 'node:crypto';
import fs from 'node:fs/promises';
import {mkdtemp,rm,readFile,writeFile,appendFile,mkdir,unlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {syncBuiltinESMExports} from 'node:module';
import {setTimeout as delay,setImmediate as immediate} from 'node:timers/promises';

const root=process.env.ARGO_REVIEW_ROOT,expected=process.env.ARGO_REVIEW_SHA;
assert.ok(root&&/^[0-9a-f]{40}$/.test(expected??''),'Set ARGO_REVIEW_ROOT and the immutable full ARGO_REVIEW_SHA');
const git=(...args)=>{
 try{return execFileSync('git',['-C',root,...args],{encoding:'utf8'}).trim();}
 catch(error){
  // The outer execution sandbox can report a child bookkeeping EPERM after
  // the read-only Git child actually completed. Require its explicit success.
  if(error.code==='EPERM'&&error.status===0&&error.signal===null&&typeof error.stdout==='string')return error.stdout.trim();
  throw error;
 }
};
assert.equal(git('rev-parse','HEAD'),expected,'Candidate identity changed');
assert.equal(git('status','--porcelain','--untracked-files=no'),'','Candidate has tracked modifications');
const load=path=>import(pathToFileURL(resolve(root,path)).href);
const {openLedger,replay}=await load('packages/ledger/src/index.ts');
const {canonical}=await load('packages/contracts/src/index.ts');
const {initialSnapshot,unsigned,eventHash,verifyEvent,outcome}=await load('packages/ledger/src/mechanics.ts');
const {genesis,keys,principal,proposal}=await load('TESTS/fixtures.ts');

const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
async function within(promise,label,milliseconds=2000){
 let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(`Review watchdog: ${label}`)),milliseconds);})]);}
 finally{clearTimeout(timer);}
}
const settle=promise=>promise.then(value=>({ok:true,value}),error=>({ok:false,error}));
const assertFailure=(result,codes)=>{assert.equal(result.ok,false,'Unexpected successful submission');if(codes)assert.ok(codes.includes(result.error.code),`Unexpected ${result.error.code}: ${result.error.message}`);};
const witness=r=>({version:r.version,request_hash:r.request_hash,attempt_id:r.attempt.attempt_id,deadline_ms:r.attempt.deadline_ms,
 scope:structuredClone(r.proposal.scope),cursor:{sequence:r.proposal.expected_sequence,head:r.proposal.expected_head,world_time:r.proposal.world_time},
 source_id:r.proposal.action.observation.source_id,observers:[...r.proposal.action.observation.observers],party_id:r.proposal.action.observation.party_id});
const observation=(state,id,observers=['donor','traveler'],more={})=>proposal(state,{type:'observe_claim',observation:{claim_id:`claim_${id}`,channel:'external_account',source_id:'donor',content:`Report ${id}.`,observers,party_id:null,occurred_at:state.world_time,...more}},'donor',id);
async function fixture(t,callback,seed=genesis(),extra={}){
 const directory=await mkdtemp(join(tmpdir(),'argo-independent-observation-'));
 t.after(()=>rm(directory,{recursive:true,force:true}));
 const options={directory,genesis:seed,privateKey:keys.privateKey,lockTimeoutMs:1000,...extra,...(callback?{authorizeObservationWitnesses:callback}:{})};
 const ledger=await openLedger(options);
 return {directory,seed,ledger,options,other:(callback=undefined)=>openLedger({...options,authorizeObservationWitnesses:callback})};
}
function watchRelock(t,path){
 const attempted=deferred(),realOpen=fs.open;let enabled=false;
 const spy=t.mock.method(fs,'open',async(...args)=>{if(enabled&&args[0]===path&&args[1]==='wx')attempted.resolve();return realOpen(...args);});
 syncBuiltinESMExports();
 const restore=()=>{spy.mock.restore();syncBuiltinESMExports();};t.after(restore);
 return {attempted,enable:()=>{enabled=true;},restore};
}
async function assertCacheMatchesReplay(f){
 const history=await f.ledger.events(),state=await f.ledger.snapshot();
 assert.equal(canonical(state),canonical(replay(f.seed,history)));
 const cold=await f.other();assert.equal(canonical(await cold.snapshot()),canonical(state));
 return {history,state};
}

test('default admits only self-private data and reopening cannot enable outward delivery',async t=>{
 const f=await fixture(t);const before=await f.ledger.snapshot();
 await assert.rejects(f.ledger.submit(observation(before,'outward'),principal()));
 assert.equal((await f.ledger.events()).length,0);
 await f.ledger.submit(observation(before,'private',['donor']),principal());
 const reopened=await f.other();await assert.rejects(reopened.submit(observation(await reopened.snapshot(),'party',['donor'],{party_id:'party'}),principal()));
 assert.equal((await f.ledger.events()).length,1);await assertCacheMatchesReplay(f);
});

test('slow host does not hold writer lock; another handle advances and makes its grant stale',async t=>{
 const entered=deferred(),release=deferred();let calls=0;
 const f=await fixture(t,async(request,snapshot,{signal})=>{calls++;entered.resolve({request,snapshot,signal});return release.promise;});
 const other=await f.other();const p=observation(await f.ledger.snapshot(),'stale');
 const pending=settle(f.ledger.submit(p,principal()));const {request}=await within(entered.promise,'host entry');
 const current=await within(other.snapshot(),'another handle snapshot while host waits');
 await within(other.submit(proposal(current,{type:'move_item',item_id:'lamp',to_actor_id:'traveler'},'donor','other_move'),principal()),'another handle commit while host waits');
 // Warm the waiting handle's verification cache before it reacquires for admission.
 assert.equal((await f.ledger.snapshot()).sequence,1);
 release.resolve(witness(request));assertFailure(await within(pending,'stale request settlement'),['CONFLICT']);
 assert.equal(calls,1);const {history,state}=await assertCacheMatchesReplay(f);
 assert.equal(history.length,1);assert.equal(state.claims.length,0);assert.equal(state.items.lamp.custodian_id,'traveler');
});

test('caller cancellation wins against a host that ignores its signal, including its later reply',async t=>{
 const entered=deferred(),release=deferred();const controller=new AbortController();
 const f=await fixture(t,async(request,snapshot,{signal})=>{entered.resolve({request,signal});return release.promise;});
 const pending=settle(f.ledger.submit(observation(await f.ledger.snapshot(),'cancel'),principal(),{signal:controller.signal}));
 const {request,signal}=await within(entered.promise,'cancel host entry');controller.abort();
 assertFailure(await within(pending,'cancellation despite ignored host signal'),['CANCELLED']);assert.equal(signal.aborted,true);
 release.resolve(witness(request));await immediate();await immediate();
 assert.equal((await f.ledger.events()).length,0);await assertCacheMatchesReplay(f);
});

test('concurrent exact duplicate returns original receipt before stale-cursor checks and without another witness',async t=>{
 const entered=deferred(),release=deferred();let calls=0;
 const f=await fixture(t,async r=>{calls++;entered.resolve(r);return release.promise;});
 const other=await f.other(async r=>witness(r));const p=observation(await f.ledger.snapshot(),'same_request');
 const pending=settle(f.ledger.submit(p,principal()));const request=await within(entered.promise,'duplicate host entry');
 const receipt=await within(other.submit(p,principal()),'other handle exact commit');
 await other.submit(proposal(await other.snapshot(),{type:'advance_time',to_time:11},'system','later_clock'),principal('system','system'));
 assert.equal((await f.ledger.snapshot()).sequence,2); // Existing local cache must not obscure prior identity.
 release.resolve(witness(request));const result=await within(pending,'duplicate reconciliation');
 assert.equal(result.ok,true);assert.deepEqual(result.value,receipt);assert.equal(calls,1);
 assert.deepEqual(await f.ledger.submit(p,principal()),receipt);assert.equal(calls,1);
 const {history}=await assertCacheMatchesReplay(f);assert.equal(history.length,2);
});

test('legacy spoofed-source observation above the new recipient cap retries only with original authenticated identity',async t=>{
 const seed=genesis();for(let i=0;i<65;i++)seed.actors[`old_${i}`]=structuredClone(seed.actors.donor);
 let calls=0;const f=await fixture(t,async r=>{calls++;return witness(r);},seed);
 const state=initialSnapshot(seed),recipients=['donor',...Array.from({length:65},(_,i)=>`old_${i}`)];
 const p=observation(state,'legacy_request',recipients,{source_id:'unregistered_historical_source'}),auth=principal();
 // Construct a historical v1 signed fixture directly. No production compatibility bypass is enabled.
 const event={schema_version:'1.0.0',event_id:'event_1',scope:structuredClone(seed.scope),ruleset_version:seed.ruleset_version,
 sequence:1,previous_hash:null,hash:'0'.repeat(64),kind:'epistemic',proposal:p,
 authority:{kind:'telos',principal_id:auth.principal_id,key_id:seed.authority_key_id,signature:'AA==',principal_actor_id:auth.actor_id,principal_role:auth.role,receipt_hash:null},rng:null};
 event.authority.signature=sign(null,Buffer.from(canonical(unsigned(event))),keys.privateKey).toString('base64');event.hash=eventHash(event);
 verifyEvent(state,event,new Set());await appendFile(join(f.directory,'events.jsonl'),canonical(event)+'\n');
 assert.deepEqual(await f.ledger.submit(p,auth),outcome(event));assert.equal(calls,0);
 for(const changed of [{...auth,principal_id:'different_login'},{...auth,role:'npc'},{...auth,actor_id:'traveler'},{...auth,scope:{...auth.scope,branch_id:'other'}}])await assert.rejects(f.ledger.submit(p,changed));
 const altered=structuredClone(p);altered.action.observation.content='Altered same ID';await assert.rejects(f.ledger.submit(altered,auth),{code:'CONFLICT'});
 assert.equal(calls,0);assert.equal((await f.ledger.events()).length,1);await assertCacheMatchesReplay(f);
});

test('a willing host cannot override source authorship or a valid proxy grant',async t=>{
 let calls=0;const f=await fixture(t,async r=>{calls++;return witness(r);});
 const state=await f.ledger.snapshot();
 for(const source_id of ['outsider','unknown_source'])await assert.rejects(f.ledger.submit(observation(state,`forged_${source_id}`,['donor','traveler'],{source_id}),principal()),{code:'UNAUTHORIZED'});
 await f.ledger.submit(proposal(state,{type:'grant_proxy',grant:{grant_id:'valid_proxy',grantor_id:'donor',grantee_id:'proxy',actions:['observe_claim'],resource_ids:['claim_proxy_observation'],valid_from:10,expires_at:20,max_uses:1}},'donor','proxy_setup'),principal());
 const p=observation(await f.ledger.snapshot(),'proxy_observation');p.proxy_grant_id='valid_proxy';
 await assert.rejects(f.ledger.submit(p,principal('proxy')),{code:'UNAUTHORIZED'});
 assert.equal(calls,0);assert.equal((await f.ledger.snapshot()).grants.valid_proxy.uses,0);assert.equal((await f.ledger.events()).length,1);
});

test('request/snapshot are frozen, caller edits cannot change a pending request, and returned grant is detached before relock',async t=>{
 let directory,grant,callbackSnapshot,callbackRequest;const entered=deferred(),release=deferred();let relock;
 const f=await fixture(t,async(request,snapshot)=>{
  callbackRequest=request;callbackSnapshot=snapshot;grant=witness(request);entered.resolve();await release.promise;
  await writeFile(join(directory,'writer.lock'),'review hold',{flag:'wx'});relock.enable();return grant;
 });directory=f.directory;
 await f.ledger.submit(observation(await f.ledger.snapshot(),'prior_private',['donor']),principal());
 const before=await f.ledger.snapshot(),p=observation(before,'immutable'),auth=principal(),original=structuredClone(p);
 relock=watchRelock(t,join(directory,'writer.lock'));
 const pending=settle(f.ledger.submit(p,auth));await within(entered.promise,'mutation host entry');
 for(const value of [callbackRequest,callbackRequest.proposal.action.observation,callbackRequest.principal.scope,callbackSnapshot,callbackSnapshot.genesis.actors,callbackSnapshot.claims[0].observation])assert.equal(Object.isFrozen(value),true);
 assert.throws(()=>{callbackSnapshot.actors.donor.alive=false;},TypeError);
 assert.throws(()=>{callbackRequest.proposal.action.observation.content='host rewrite';},TypeError);
 p.action.observation.content='caller rewrite';p.action.observation.observers=['outsider'];auth.actor_id='outsider';auth.scope.branch_id='elsewhere';
 release.resolve();await within(relock.attempted.promise,'validated grant reaches relock');
 grant.observers.push('outsider');grant.scope.branch_id='changed_after_return';grant.deadline_ms=0;
 await unlink(join(directory,'writer.lock'));const result=await within(pending,'detached grant settlement');relock.restore();
 assert.equal(result.ok,true,result.error?.message);const {history,state}=await assertCacheMatchesReplay(f);
 assert.deepEqual(history.at(-1).proposal,original);assert.equal(state.actors.donor.alive,true);assert.equal(state.claims.length,2);
 assert.equal(callbackSnapshot.sequence,before.sequence);assert.equal(callbackSnapshot.claims.length,1);
 history[0].proposal.action.observation.content='returned history mutation';state.claims[0].observation.content='returned snapshot mutation';
 assert.notEqual((await f.ledger.events())[0].proposal.action.observation.content,'returned history mutation');
 assert.notEqual((await f.ledger.snapshot()).claims[0].observation.content,'returned snapshot mutation');
});

test('grant expiry during relocking cannot gain a fresh admission window',async t=>{
 let clock=1000,directory,request;const returned=deferred();let relock;
 const f=await fixture(t,async r=>{request=r;await writeFile(join(directory,'writer.lock'),'review hold',{flag:'wx'});relock.enable();returned.resolve();return witness(r);});directory=f.directory;
 const p=observation(await f.ledger.snapshot(),'relock_expiry');
 t.mock.method(Date,'now',()=>clock);relock=watchRelock(t,join(directory,'writer.lock'));
 const pending=settle(f.ledger.submit(p,principal()));await within(returned.promise,'expiry host return');await within(relock.attempted.promise,'expiry relock wait');
 assert.ok(request.attempt.deadline_ms>clock);clock=request.attempt.deadline_ms;
 await unlink(join(directory,'writer.lock'));assertFailure(await within(pending,'expired relock settlement'),['EXPIRED','UNAVAILABLE']);relock.restore();
 assert.equal((await f.ledger.events()).length,0);await assertCacheMatchesReplay(f);
});

test('post-append derived-snapshot failure preserves verified prefix and retry skips witness work',async t=>{
 let calls=0;const f=await fixture(t,async r=>{calls++;return witness(r);});const p=observation(await f.ledger.snapshot(),'durable_observation');
 await mkdir(join(f.directory,'snapshot.json'));await assert.rejects(f.ledger.submit(p,principal()));
 const bytes=await readFile(join(f.directory,'events.jsonl'));assert.ok(bytes.length>0);assert.equal((await f.ledger.events()).length,1);assert.equal(calls,1);
 await writeFile(join(f.directory,'events.jsonl'),'');await assert.rejects(f.ledger.submit(p,principal()),{code:'CORRUPT_LEDGER'});
 await writeFile(join(f.directory,'events.jsonl'),bytes);await rm(join(f.directory,'snapshot.json'),{recursive:true});
 const receipt=await f.ledger.submit(p,principal());assert.equal(receipt.sequence,1);assert.equal(calls,1);
 await assertCacheMatchesReplay(f);
});

test('preflight, verifier work, and relock all consume the original five-second window',async t=>{
 let clock=1000;const entered=deferred(),release=deferred();
 const f=await fixture(t,async r=>{entered.resolve(r);return release.promise;},genesis(),{lockTimeoutMs:10000});
 const p=observation(await f.ledger.snapshot(),'combined_budget'),path=join(f.directory,'writer.lock');
 await writeFile(path,'preflight hold',{flag:'wx'});t.mock.method(Date,'now',()=>clock);
 const pending=settle(f.ledger.submit(p,principal()));await immediate();clock=3000;await unlink(path);
 const request=await within(entered.promise,'host after preflight wait');
 assert.equal(request.attempt.issued_at_ms,3000);assert.equal(request.attempt.deadline_ms,6000,'Preflight delay must not renew the budget');
 await writeFile(path,'relock hold',{flag:'wx'});const relock=watchRelock(t,path);relock.enable();
 clock=5500;release.resolve(witness(request));await within(relock.attempted.promise,'remaining-budget relock');
 clock=6000;await unlink(path);assertFailure(await within(pending,'combined budget expiry'),['EXPIRED','UNAVAILABLE']);relock.restore();
 assert.equal((await f.ledger.events()).length,0);
});

test('cancellation during the second durable read is checked before returning an exact concurrent retry',async t=>{
 const entered=deferred(),release=deferred(),controller=new AbortController();
 const f=await fixture(t,async r=>{entered.resolve(r);return release.promise;});
 const other=await f.other(async r=>witness(r)),p=observation(await f.ledger.snapshot(),'cancelled_retry');
 const pending=settle(f.ledger.submit(p,principal(),{signal:controller.signal}));const request=await within(entered.promise,'retry cancellation host entry');
 await other.submit(p,principal());
 const realRead=fs.readFile;let injected=false;
 const spy=t.mock.method(fs,'readFile',async(...args)=>{
  const result=await realRead(...args);
  if(!injected&&args[0]===join(f.directory,'events.jsonl')){injected=true;controller.abort();}
  return result;
 });syncBuiltinESMExports();t.after(()=>{spy.mock.restore();syncBuiltinESMExports();});
 release.resolve(witness(request));const result=await within(pending,'cancellation at retry read');
 spy.mock.restore();syncBuiltinESMExports();assert.equal(injected,true);assert.equal(controller.signal.aborted,true);
 assertFailure(result,['CANCELLED']);assert.equal((await f.ledger.events()).length,1);
});

test('review target remained immutable through the probe run',()=>{
 assert.equal(git('rev-parse','HEAD'),expected);assert.equal(git('status','--porcelain','--untracked-files=no'),'');
});
