import {test} from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm,readFile} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';import {createHash} from 'node:crypto';
import {openLedger,replay,makeCheckpoint,initialSnapshot} from '../packages/ledger/src/index.ts';import {createLexiBridge,createLexiMock} from '../packages/lexi-bridge/src/index.ts';import {createTelosBridge,createTelosMock} from '../packages/telos-bridge/src/index.ts';
import {renderNarration,proposalFromAction,createNarrator} from '../packages/argo-dm/src/index.ts';import {createFates} from '../scenarios/tempted-fates/index.ts';import {createProposalSubscriber} from '../packages/interventions/src/index.ts';
import {canonical,hash} from '../packages/contracts/src/index.ts';import type {Action,Consent,KnowledgeQuery} from '../packages/contracts/src/index.ts';import {genesis,keys,scope,principal,proposal} from './fixtures.ts';

test('Integration Test Zero: Tempted Fates TF-01..TF-12',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'argo-test-zero-'));
 const consent:Consent={consent_id:'gift',donor_id:'donor',recipient_id:'traveler',units:120,expires_at:100,terms_hash:'c'.repeat(64),confirmation_id:'informed_choice'};
 try{
  const ledger=await openLedger({directory,genesis:genesis(),privateKey:keys.privateKey,verifyReceipt:async c=>hash(c)===hash(consent)});
  const telos=createTelosBridge({scope,transport:createTelosMock(ledger)}),lexi=createLexiBridge({scope,transport:createLexiMock(options=>ledger.snapshot(options))});
  const submit=async(action:Action,who=principal())=>telos.submit(proposal(await ledger.snapshot(),action,who.actor_id),who);
  const read=async(actor_id:string,sequence?:number)=>{const state=await ledger.snapshot();const q:KnowledgeQuery={schema_version:'1.0.0',scope,actor_id,audience:'actor',party_id:null,as_of_world_time:state.world_time,as_of_sequence:sequence??state.sequence};return lexi.query(q,principal(actor_id));};
  const fates=createFates({clotho:'clotho',lachesis:'lachesis',atropos:'atropos'});
  assert.equal(new Set(fates.map(f=>f.actorId)).size,3,'TF-04 independent identities');
  for(const fate of fates){const state=await ledger.snapshot();const context={view:await read(fate.actorId),checkpoint:makeCheckpoint(state,'encounter',[fate.actorId],100)};
   assert.deepEqual(await fate.propose(context,{choice:'leave'}),[],'TF-01 valid departure');
   assert.deepEqual(await fate.propose(context,{choice:'refuse'}),[],'TF-01 refusal creates no event');
  }
  assert.equal((await ledger.events()).length,0);
  const physicalBefore=(await ledger.snapshot()).items;
  await submit({type:'observe_claim',observation:{claim_id:'account',channel:'external_account',source_id:'guidebook',content:'The relic is said to grant youth.',observers:['donor'],party_id:null,occurred_at:0}});
  assert.deepEqual((await ledger.snapshot()).items,physicalBefore,'TF-02/03 guide does not move or create a relic');
  assert.equal((await read('traveler')).claims.length,0,'TF-02 private-solo secret is not global truth');
  await submit({type:'move_item',item_id:'lamp',to_actor_id:'traveler'});assert.equal((await ledger.snapshot()).items.lamp!.custodian_id,'traveler');
  await assert.rejects(submit({type:'transfer_time',consent_id:'gift'},principal('traveler')),/consent/i,'TF-05 no narrator-supplied consent');
  await assert.rejects(submit({type:'record_consent',consent},principal('lachesis','npc')),/donor/i);
  await submit({type:'record_consent',consent},{...principal(),confirmed_receipts:['informed_choice']});
  const transfer=await submit({type:'transfer_time',consent_id:'gift'},principal('traveler'));
  let state=await ledger.snapshot();assert.equal(state.transfers[0]!.units,120);assert.equal(state.transfers[0]!.donor_id,'donor');assert.equal(state.transfers[0]!.world_time,10);assert.equal(state.consents.gift!.consent.terms_hash,consent.terms_hash,'TF-06 terms and consent retained');
  assert.equal(state.actors.traveler!.time_balance,1120);assert.equal(state.actors.donor!.time_balance,880);assert.equal(state.actors.traveler!.age_ticks,200,'TF-07 no rejuvenation');assert.equal(state.actors.traveler!.thread,'present','TF-08 no automatic anomaly');
  const beforeNarration=canonical(state);renderNarration({view:await read('traveler'),outcome:transfer,persona:'The Chronicler',candidateText:'A spectacular invented reward.'});assert.equal(canonical(await ledger.snapshot()),beforeNarration,'TF-12 prose never mutates');
  await assert.rejects(submit({type:'vanish_thread',traveler_id:'traveler'},principal('clotho','npc')),/System/);
  await assert.rejects(submit({type:'end_thread',traveler_id:'traveler'},principal('lachesis','npc')),/Atropos/);
  const beforeAnomaly=state.sequence;await submit({type:'vanish_thread',traveler_id:'traveler'},principal('system','system'));
  for(const actorId of ['traveler','donor','clotho','lachesis','atropos'])for(const persona of ['The Chronicler','The Fates','Plain Guide'] as const){
   const view=await read(actorId,beforeAnomaly);assert.equal(view.ontology_blocked,true);assert.equal(renderNarration({view,persona,candidateText:'The reason is that he exists outside fate.'}), '','TF-10 zero exposition immediately after disappearance, including historical views');
  }
  await assert.rejects(submit({type:'name_anomaly',traveler_id:'traveler'},principal('lachesis','npc')),/Clotho/);
  state=await ledger.snapshot();const context={view:await read('clotho'),checkpoint:makeCheckpoint(state,'anomaly',['clotho'],100)};
  const naming=await fates[0]!.propose(context,{choice:'act',action:{type:'name_anomaly',traveler_id:'traveler'},proposalId:'name'});assert.equal(naming.length,1);await telos.submit(naming[0]!,principal('clotho','npc'));
  for(const fate of fates){const view=await read(fate.actorId);assert.equal(view.engagement_closed,true);assert.equal(renderNarration({view,persona:'The Fates',candidateText:'Let me explain his ontology.'}),'');assert.equal(renderNarration({view,persona:'Plain Guide',candidateText:'Because...',mode:'work'}),'The work continues.','TF-09 work speech remains');}
  const post=await read('traveler');let modelCalls=0;
  const narrator=createNarrator({scope,sessionId:'session',candidates:[],clientFor:()=>{modelCalls++;throw Error('Must not call a model after cutoff');}});
  assert.equal(await narrator.narrate({view:post,persona:'The Chronicler',prompt:'Explain what really happened'}),'');assert.equal(modelCalls,0);
  await submit({type:'advance_time',to_time:20},principal('system','system'));state=await ledger.snapshot();assert.equal(state.world_time,20);assert.equal(state.transfers.length,1);assert.equal(state.actors.donor!.time_balance,880,'TF-11 no automatic refund');assert.equal(state.items.lamp!.custodian_id,'traveler');
  assert.equal(canonical(replay(genesis(),await ledger.events())),canonical(state));
  const source=await readFile(new URL('../SCENARIOS/Tempted_Fates.md',import.meta.url));assert.equal(createHash('sha256').update(source).digest('hex'),'95a9159170ec2288dfcb2b2881f3c0026e4a168673e0d29887f1f0be83c22008');
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('NPC/intervention subscribers receive scoped views and can only return optional proposals',async()=>{
 const state=initialSnapshot(genesis());
 const view={schema_version:'1.0.0' as const,scope,actor_id:'donor',audience:'actor' as const,party_id:null,as_of_world_time:10,as_of_sequence:0,claims:[],ontology_blocked:false,engagement_closed:false};
 const checkpoint=makeCheckpoint(state,'checkpoint',['donor'],100);
 const subscriber=createProposalSubscriber({actorId:'donor',plan:async()=>[]});assert.deepEqual(await subscriber.onView({view,checkpoint}),[]);
 const malicious=createProposalSubscriber({actorId:'donor',plan:async()=>[proposalFromAction(checkpoint,'donor',{type:'move_item',item_id:'lamp',to_actor_id:null},'candidate')]});
 assert.equal((await malicious.onView({view,checkpoint})).length,1);assert.equal(state.items.lamp!.custodian_id,'donor');
 await assert.rejects(createProposalSubscriber({actorId:'outsider',plan:async()=>[]}).onView({view,checkpoint}),/actor/);
 assert.throws(()=>makeCheckpoint(state,'unsupported',['donor'],100,'transparent_fork'),/unsupported/i);
});
