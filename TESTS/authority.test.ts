import {test} from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';import {fork} from 'node:child_process';import {fileURLToPath} from 'node:url';import {sign} from 'node:crypto';
import {openLedger,replay} from '../packages/ledger/src/index.ts';import {unsigned,eventHash} from '../packages/ledger/src/mechanics.ts';
import {canonical,hash} from '../packages/contracts/src/index.ts';import type {Consent,Action,Principal} from '../packages/contracts/src/index.ts';
import {genesis,keys,principal,proposal} from './fixtures.ts';
async function fixture(fn:(l:Awaited<ReturnType<typeof openLedger>>,dir:string,receipt:Consent)=>Promise<void>){
 const dir=await mkdtemp(join(tmpdir(),'argo-authority-'));const receipt:Consent={consent_id:'gift',donor_id:'donor',recipient_id:'traveler',units:120,expires_at:40,terms_hash:'a'.repeat(64),confirmation_id:'receipt'};
 try{await fn(await openLedger({directory:dir,genesis:genesis(),privateKey:keys.privateKey,verifyReceipt:async c=>hash(c)===hash(receipt)}),dir,receipt);}finally{await rm(dir,{recursive:true,force:true});}
}
test('only an exactly verified direct living donor authorizes a gift; no age reset or anomaly is produced',async()=>fixture(async(l,dir,receipt)=>{
 const auth={...principal(),confirmed_receipts:['receipt']};let state=await l.snapshot();
 await assert.rejects(l.submit(proposal(state,{type:'record_consent',consent:{...receipt,units:121}}),auth),/receipt/i);
 await assert.rejects(l.submit(proposal(state,{type:'record_consent',consent:receipt}),principal('lachesis','npc')),/Direct actor|donor/i);
 await l.submit(proposal(state,{type:'record_consent',consent:receipt}),auth);state=await l.snapshot();
 await l.submit(proposal(state,{type:'transfer_time',consent_id:'gift'},'traveler'),principal('traveler'));
 state=await l.snapshot();assert.equal(state.actors.donor!.time_balance,880);assert.equal(state.actors.traveler!.time_balance,1120);assert.equal(state.actors.traveler!.age_ticks,200);assert.equal(state.actors.traveler!.thread,'present');assert.equal(state.transfers.length,1);
 assert.equal(state.items.lamp!.custodian_id,'donor');assert.deepEqual(state.cutoffs,{});
 assert.equal((await l.events())[0]!.authority.receipt_hash,hash(receipt));
 assert.equal(canonical(replay(genesis(),await l.events())),(await readFile(join(dir,'snapshot.json'),'utf8')).trimEnd());
 await assert.rejects(l.submit(proposal(state,{type:'transfer_time',consent_id:'gift'}),principal()),/spent/);
}));
test('revoked and half-open expired consent are rechecked at commit; refusal appends nothing',async()=>{
 for(const mode of ['revoke','expire'])await fixture(async(l,_dir,receipt)=>{
  const act=async(a:Action,who=principal())=>l.submit(proposal(await l.snapshot(),a,who.actor_id),who);
  await act({type:'record_consent',consent:receipt},{...principal(),confirmed_receipts:['receipt']});
  const stale=proposal(await l.snapshot(),{type:'transfer_time',consent_id:'gift'});
  await act(mode==='revoke'?{type:'revoke_consent',consent_id:'gift'}:{type:'advance_time',to_time:40},mode==='revoke'?principal():principal('system','system'));
  await assert.rejects(l.submit(stale,principal()),/checkpoint/i);
  const count=(await l.events()).length;await assert.rejects(act({type:'transfer_time',consent_id:'gift'}),/revoked|expired/i);assert.equal((await l.events()).length,count);
 });
});
test('proxy grants enforce grantee, action, resource, use count, revocation and expiry at commit',async()=>{
 for(const mode of ['valid','revoked','expired','uses','resource','grantee','gift'])await fixture(async(l)=>{
  const grant={grant_id:'grant',grantor_id:'donor',grantee_id:'proxy',actions:['move_item' as const,'observe_claim' as const],resource_ids:['lamp'],valid_from:10,expires_at:20,max_uses:1};
  const act=async(a:Action,who:Principal=principal())=>l.submit(proposal(await l.snapshot(),a,who.actor_id),who);
  await act({type:'grant_proxy',grant});
  if(mode==='revoked')await act({type:'revoke_proxy',grant_id:'grant'});
  if(mode==='expired')await act({type:'advance_time',to_time:20},principal('system','system'));
  const proxied=async()=>{
   const a:Action=mode==='gift'?{type:'transfer_time',consent_id:'unknown'}:mode==='resource'?{type:'observe_claim',observation:{claim_id:'outside',channel:'belief',source_id:'donor',content:'x',observers:['donor'],party_id:null,occurred_at:10}}:{type:'move_item',item_id:'lamp',to_actor_id:'donor'};
   return l.submit({...proposal(await l.snapshot(),a),proxy_grant_id:'grant'},principal(mode==='grantee'?'outsider':'proxy'));
  };
  if(mode==='valid'||mode==='uses'){await proxied();assert.equal((await l.snapshot()).grants.grant!.uses,1);if(mode==='uses')await assert.rejects(proxied(),/uses denied/);}
  else await assert.rejects(proxied(),/grant|Proxy/i);
 });
});
test('a correctly rehashed and re-signed forged RNG record still fails deterministic replay',async()=>fixture(async l=>{
 await l.submit(proposal(await l.snapshot(),{type:'draw',label:'hidden',bound:20,visibility:'authority',audience_id:null},'system'),principal('system','system'));
 const events=await l.events(),e=events[0]!;e.rng!.value=(e.rng!.value+1)%20;e.authority.signature=sign(null,Buffer.from(canonical(unsigned(e))),keys.privateKey).toString('base64');e.hash=eventHash(e);
 assert.throws(()=>replay(genesis(),events),/RNG/);
}));
test('independent processes contend on the same checkpoint and commit exactly once',async()=>fixture(async(l,dir)=>{
 const p=proposal(await l.snapshot(),{type:'advance_time',to_time:30},'system');
 await writeFile(join(dir,'worker.json'),JSON.stringify({genesis:genesis(),privateKey:keys.privateKey.export({format:'pem',type:'pkcs8'}).toString(),proposal:p,principal:principal('system','system')}),{mode:0o600});
 const children=[0,1].map(index=>fork(fileURLToPath(new URL('./ledger-worker.ts',import.meta.url)),[dir,String(index)],{stdio:['ignore','ignore','pipe','ipc']}));
 try{
  await Promise.all(children.map(child=>new Promise<void>((resolve,reject)=>{child.once('message',message=>message==='ready'?resolve():reject(Error(String(message))));child.once('error',reject);child.once('exit',code=>{if(code)reject(Error(`worker exit ${code}`));});})));
  const results=children.map(child=>new Promise<string>((resolve,reject)=>{child.once('message',message=>resolve(String(message)));child.once('error',reject);}));
  for(const child of children)child.send('go');
  const values=await Promise.all(results);assert.equal(values.filter(v=>v==='committed').length,1);assert.ok(values.some(v=>/checkpoint/i.test(v)));
  assert.equal((await l.events()).length,1);
 }finally{for(const child of children)if(child.exitCode===null)child.kill('SIGKILL');}
}));
test('an abandoned writer lock is not stolen and a different genesis cannot reopen the ledger',async()=>fixture(async(l,dir)=>{
 await assert.rejects(openLedger({directory:dir,genesis:{...genesis(),seed:'ff'.repeat(32)},privateKey:keys.privateKey}),/genesis/);
 await writeFile(join(dir,'writer.lock'),'{"pid":999999}');
 await assert.rejects(openLedger({directory:dir,genesis:genesis(),privateKey:keys.privateKey,lockTimeoutMs:20}),/lock unavailable/);
 assert.match(await readFile(join(dir,'writer.lock'),'utf8'),/999999/);
}));
