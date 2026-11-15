import {test} from 'node:test';
import {sign} from 'node:crypto';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openLedger,replay} from '../packages/ledger/src/index.ts';
import {unsigned,eventHash} from '../packages/ledger/src/mechanics.ts';
import {CHARACTER_PROFILE,characterProposalId,characterRequestHash,canonical} from '../packages/contracts/src/index.ts';
import type {CharacterCommand,CharacterCommandBody,CharacterEnvelope,CharacterProjection,CharacterReceipt,CharacterWitnessGrant,Principal} from '../packages/contracts/src/index.ts';
import {genesis,keys,principal,proposal} from './fixtures.ts';
import {characterProfile} from './character-fixtures.ts';
const authorityPath='../packages/ledger/src/characters.ts',bridgePath='../packages/telos-bridge/src/characters.ts';
const authority=await import(authorityPath).catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
const bridgeModule=await import(bridgePath).catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
let ids=0;
const system=()=>principal('system','system');
async function setup(t:any,options:any={}){
 const directory=await mkdtemp(join(tmpdir(),'argo-character-authority-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const seed=genesis(),ledger=await openLedger({directory,genesis:seed,privateKey:keys.privateKey});
 assert.equal(typeof authority.createCharacterAuthority,'function','Character authority factory is implemented');
 const grant=options.authorizeWitnesses??(async(request:any)=>({request_hash:request.request_hash,actor_ids:['donor','outsider'],party_id:null}));
 const service=await authority.createCharacterAuthority({ledger,systemPrincipal:system(),authorizeWitnesses:grant,...options});
 const command=async(body:CharacterCommandBody,request_id=`char_request_${++ids}`):Promise<CharacterCommand>=>({version:CHARACTER_PROFILE,scope:seed.scope,request_id,expected_cursor:(await service.readProjection()).cursor,body});
 const submit=async(body:CharacterCommandBody,auth=principal('traveler'),id?:string)=>service.submit(await command(body,id),auth);
 for(const actor of ['traveler','donor','outsider'])await submit({type:'configure',profile:characterProfile(actor)},system());
 return {directory,seed,ledger,service,command,submit};
}
const speech=(text='I returned the lamp.'):CharacterCommandBody=>({type:'speak',text,addressed_actor_ids:['donor']});
async function worldAction(f:any,action:any,actor='system',role:Principal['role']='system'){
 const snapshot=await f.ledger.snapshot();return f.ledger.submit(proposal(snapshot,action,actor),principal(actor,role));
}
async function forgedCarrier(f:any,command:CharacterCommand,requester:Principal,change:(body:any)=>void,writer=system()){
 assert.equal(command.body.type,'speak');if(command.body.type!=='speak')throw Error();
 const envelope:CharacterEnvelope={version:CHARACTER_PROFILE,scope:f.seed.scope,request_id:command.request_id,request_hash:characterRequestHash(command,requester),requester:{principal_id:requester.principal_id,actor_id:requester.actor_id,role:requester.role},body:{type:'speak',actor_id:requester.actor_id,text:command.body.text,addressed_actor_ids:command.body.addressed_actor_ids,witnesses:{request_hash:characterRequestHash(command,requester),actor_ids:[requester.actor_id],party_id:null}}};
 change(envelope);
 return writeCarrier(f,envelope,writer);
}
async function writeCarrier(f:any,envelope:CharacterEnvelope,writer=system(),observationPatch:Record<string,unknown>={}){
 const snapshot=await f.ledger.snapshot(),id=characterProposalId(f.seed.scope,envelope.request_id);
 return f.ledger.submit(proposal(snapshot,{type:'observe_claim',observation:{claim_id:id,channel:'belief',source_id:writer.actor_id,content:canonical(envelope),observers:[writer.actor_id],party_id:null,occurred_at:snapshot.world_time,...observationPatch}},writer.actor_id,id),writer);
}

test('character authority captures signed private speech and reopens the exact projection',async t=>{
 const f=await setup(t);const receipt=await f.submit(speech());
 const events=await f.ledger.events(),event=events.at(-1)!;
 assert.equal(event.proposal.action.type,'observe_claim');if(event.proposal.action.type!=='observe_claim')throw Error();
 assert.deepEqual(event.proposal.action.observation.observers,['system']);assert.equal(event.proposal.action.observation.party_id,null);
 const p:CharacterProjection=await f.service.readProjection();assert.equal(p.records.length,1);assert.equal(p.records[0]!.experience.text,'I returned the lamp.');
 assert.deepEqual(p.records[0]!.acquisitions.map(a=>a.actor_id),['traveler','donor','outsider']);
 assert.equal(receipt.event_hash,p.cursor.head);
 const reopened=await openLedger({directory:f.directory,genesis:f.seed,privateKey:keys.privateKey});
 const second=await authority.createCharacterAuthority({ledger:reopened,systemPrincipal:system()});
 assert.deepEqual(await second.readProjection(),p);
 for(let n=0;n<=events.length;n++){
  const prefix=authority.replayCharacters(f.seed,events.slice(0,n),system());assert.equal(prefix.cursor.sequence,n);
  assert.equal(prefix.records.length,n===events.length?1:0);
 }
});
test('speech rejects actor spoofing, missing adjudication and invalid witness grants without append',async t=>{
 const f=await setup(t);const before=(await f.ledger.events()).length;
 const c=await f.command(speech());await assert.rejects(f.service.submit({...c,body:{...c.body,actor_id:'clotho'}},principal('traveler')));
 const noHost=await authority.createCharacterAuthority({ledger:f.ledger,systemPrincipal:system()});await assert.rejects(noHost.submit(c,principal('traveler')),/adjudication|witness|configured/i);
 const bad=await authority.createCharacterAuthority({ledger:f.ledger,systemPrincipal:system(),authorizeWitnesses:async()=>({request_hash:'f'.repeat(64),actor_ids:['donor'],party_id:null})});
 await assert.rejects(bad.submit(c,principal('traveler')),/request|grant/i);
 const stranger=await authority.createCharacterAuthority({ledger:f.ledger,systemPrincipal:system(),authorizeWitnesses:async(r:any)=>({request_hash:r.request_hash,actor_ids:['missing'],party_id:null})});
 await assert.rejects(stranger.submit(c,principal('traveler')),/actor|witness/i);
 const party=await authority.createCharacterAuthority({ledger:f.ledger,systemPrincipal:system(),authorizeWitnesses:async(r:any)=>({request_hash:r.request_hash,actor_ids:['outsider'],party_id:'party'})});
 await assert.rejects(party.submit(c,principal('traveler')),/party|membership/i);
 assert.equal((await f.ledger.events()).length,before);
});
test('exact retries survive later state while altered requests and authenticated identities conflict',async t=>{
 let calls=0;const f=await setup(t,{authorizeWitnesses:async(r:any)=>{calls++;return {request_hash:r.request_hash,actor_ids:[],party_id:null};}});
 const c=await f.command(speech());const first=await f.service.submit(c,principal('traveler'));
 await worldAction(f,{type:'advance_time',to_time:12});
 assert.deepEqual(await f.service.submit(c,principal('traveler')),first);assert.equal(calls,1);
 await assert.rejects(f.service.submit({...c,body:speech('Different.')},principal('traveler')),/conflict|identity|retry/i);
 await assert.rejects(f.service.submit(c,{...principal('traveler'),principal_id:'other_auth'}),/conflict|identity|retry/i);
 assert.equal((await f.service.readProjection()).records.length,1);
});
test('two authorized observers retain different private impressions and unacquired evidence is refused',async t=>{
 const f=await setup(t);const spoken=await f.submit(speech());
 for(const [actor,text] of [['donor','They kept their promise.'],['outsider','They were showing off.']])await f.submit({type:'form_impression',subject_actor_id:'traveler',evidence_ids:[spoken.event_hash],interpretation:text!,previous_impression_id:null},principal(actor,'npc'));
 const p:CharacterProjection=await f.service.readProjection();
 assert.deepEqual(p.impressions.map(i=>[i.data.owner_actor_id,i.data.interpretation]),[['donor','They kept their promise.'],['outsider','They were showing off.']]);
 await f.submit({type:'configure',profile:characterProfile('proxy')},system());
 const before=(await f.ledger.events()).length;
 await assert.rejects(f.submit({type:'form_impression',subject_actor_id:'traveler',evidence_ids:[spoken.event_hash],interpretation:'I saw it.',previous_impression_id:null},principal('proxy','npc')),/acquir|evidence|witness/i);
 await assert.rejects(f.submit({type:'form_impression',subject_actor_id:'donor',evidence_ids:[spoken.event_hash],interpretation:'Wrong subject.',previous_impression_id:null},principal('donor','npc')),/subject|evidence/i);
 assert.equal((await f.ledger.events()).length,before);
});
test('nature reconfiguration preserves activation, speech cooldown and impression predecessor history',async t=>{
 const f=await setup(t);const spoken=await f.submit(speech());
 const first=await f.submit({type:'form_impression',subject_actor_id:'traveler',evidence_ids:[spoken.event_hash],interpretation:'Reliable.',previous_impression_id:null},principal('donor','npc'));
 const start=(await f.service.readProjection()).activation_sequence;
 const profile=characterProfile('traveler');profile.revision=2;profile.nature.description='Changed outlook';await f.submit({type:'configure',profile},system());
 await assert.rejects(f.submit(speech('Again.')),/cooldown|interval/i);
 const donor=characterProfile('donor');donor.revision=2;donor.nature.description='More wary';await f.submit({type:'configure',profile:donor},system());
 await assert.rejects(f.submit({type:'form_impression',subject_actor_id:'traveler',evidence_ids:[spoken.event_hash],interpretation:'Changed.',previous_impression_id:null},principal('donor','npc')),/predecessor|previous|revision/i);
 await f.submit({type:'form_impression',subject_actor_id:'traveler',evidence_ids:[spoken.event_hash],interpretation:'Reliable, with reservations.',previous_impression_id:first.event_hash},principal('donor','npc'));
 const p:CharacterProjection=await f.service.readProjection();assert.equal(p.activation_sequence,start);assert.equal(p.impressions.length,2);
 assert.equal(p.impressions[0]!.data.nature_revision,1);assert.equal(p.impressions[1]!.data.nature_revision,2);assert.equal(p.impressions[0]!.data.nature.description,'A practical keeper of the workshop.');
});
test('ended actors cannot speak or form new impressions while historical actions remain witnessable',async t=>{
 const f=await setup(t);const moved=await worldAction(f,{type:'move_item',item_id:'lamp',to_actor_id:'traveler'},'donor','player');
 await worldAction(f,{type:'end_thread',traveler_id:'donor'},'atropos','npc');
 const before=(await f.ledger.events()).length;
 await assert.rejects(f.submit(speech(),principal('donor','npc')),/living|ended|alive/i);
 await assert.rejects(f.submit({type:'form_impression',subject_actor_id:'donor',evidence_ids:[moved.event_hash],interpretation:'Still acting.',previous_impression_id:null},principal('donor','npc')),/living|ended|alive/i);
 assert.equal((await f.ledger.events()).length,before);
 const reader=await authority.createCharacterAuthority({ledger:f.ledger,systemPrincipal:system(),authorizeWitnesses:async(r:any)=>({request_hash:r.request_hash,actor_ids:['outsider'],party_id:null})});
 const annotation=await reader.submit(await f.command({type:'witness_action',record_id:moved.event_hash}),system());
 const p:CharacterProjection=await reader.readProjection();const record=p.records.find(r=>r.experience.record_id===moved.event_hash)!;
 assert.deepEqual(record.acquisitions.map(a=>a.actor_id),['donor','outsider']);assert.equal(record.acquisitions[1]!.sequence,annotation.cursor.sequence);
});
test('witness callback cannot append after a concurrent commit and never holds the ledger writer lock',async t=>{
 let release:(value:CharacterWitnessGrant)=>void=()=>{},started:()=>void=()=>{};const begun=new Promise<void>(r=>started=r);
 const f=await setup(t,{authorizeWitnesses:(r:any)=>{started();return new Promise(resolve=>{release=()=>resolve({request_hash:r.request_hash,actor_ids:['donor'],party_id:null});});}});
 const c=await f.command(speech());const pending=f.service.submit(c,principal('traveler'));await begun;
 assert.equal((await f.ledger.snapshot()).sequence,3);
 await worldAction(f,{type:'advance_time',to_time:11});release({request_hash:'',actor_ids:[],party_id:null});
 await assert.rejects(pending,/stale|cursor|checkpoint/i);assert.equal((await f.service.readProjection()).records.length,0);
});
test('cancelled and timed out witness adjudication cannot append when it settles late',async t=>{
 let finish:(grant:CharacterWitnessGrant)=>void=()=>{},request:any;const f=await setup(t,{timeoutMs:20,authorizeWitnesses:(r:any)=>{request=r;return new Promise(resolve=>finish=resolve);}});
 const c=await f.command(speech());await assert.rejects(f.service.submit(c,principal('traveler')),/deadline/i);
 finish({request_hash:request.request_hash,actor_ids:[],party_id:null});await new Promise(r=>setTimeout(r,5));assert.equal((await f.ledger.events()).length,3);
 const abort=new AbortController();let started:()=>void=()=>{};const begun=new Promise<void>(r=>started=r);
 const cancelled=await authority.createCharacterAuthority({ledger:f.ledger,systemPrincipal:system(),authorizeWitnesses:(r:any)=>{request=r;started();return new Promise(resolve=>finish=resolve);}});
 const pending=cancelled.submit(c,principal('traveler'),{signal:abort.signal});await begun;abort.abort();await assert.rejects(pending,/cancel/i);
 finish({request_hash:request.request_hash,actor_ids:[],party_id:null});await new Promise(r=>setTimeout(r,5));assert.equal((await f.ledger.events()).length,3);
});
test('callback DTO mutation and caller input mutation cannot rewrite accepted speech or authority snapshot',async t=>{
 let release:()=>void=()=>{},started:()=>void=()=>{};const begun=new Promise<void>(r=>started=r);
 const f=await setup(t,{authorizeWitnesses:async(r:any,s:any)=>{assert.throws(()=>{r.actor_id='clotho';});assert.throws(()=>{s.actors.traveler.alive=false;});started();await new Promise<void>(resolve=>release=resolve);return {request_hash:r.request_hash,actor_ids:[],party_id:null};}});
 const c=await f.command(speech());const auth=principal('traveler');const pending=f.service.submit(c,auth);await begun;
 (c.body as any).text='Changed after call';auth.actor_id='clotho';release();await pending;
 const p:CharacterProjection=await f.service.readProjection();assert.equal(p.records[0]!.experience.text,'I returned the lamp.');assert.equal(p.records[0]!.experience.actor_id,'traveler');
 assert.equal((await f.ledger.snapshot()).actors.traveler!.alive,true);
});
test('ordinary actor carrier lookalikes do not become trusted character records',async t=>{
 const f=await setup(t);const command=await f.command(speech('Forged!'),'forged_request');
 await forgedCarrier(f,command,principal('traveler'),()=>{},principal('outsider'));
 assert.equal((await f.service.readProjection()).records.length,0);
 await assert.rejects(f.service.submit(command,principal('traveler')),/conflict|reserved|collision/i);
});
test('system-authored invalid inner semantics and a changed carrier identity fail replay closed',async t=>{
 const f=await setup(t);const c=await f.command(speech('Forged!'));
 await forgedCarrier(f,c,principal('traveler'),envelope=>{envelope.body.witnesses.actor_ids.push('missing');});
 assert.throws(()=>authority.replayCharacters(f.seed,[] ,principal('outsider')),/system|authority/i);
 await assert.rejects(f.service.readProjection(),/carrier|actor|witness/i);
 const g=await setup(t);const changed={...system(),principal_id:'different_system_service'};
 const events=await g.ledger.events();assert.throws(()=>authority.replayCharacters(g.seed,events,changed),/identity|carrier|system/i);
});
test('signed inner request hashes are replay validated',async t=>{
 const f=await setup(t);const c=await f.command(speech('Forged!'));
 await forgedCarrier(f,c,principal('traveler'),envelope=>{envelope.request_hash='f'.repeat(64);envelope.body.witnesses.request_hash=envelope.request_hash;});
 await assert.rejects(f.service.readProjection(),/carrier|request|hash/i);
});
test('signed speech cannot bypass prior cooldown, death, party membership or outer private-carrier constraints',async t=>{
 for(const mode of ['cooldown','death','party','observers','source']){
  const f=await setup(t);
  if(mode==='cooldown')await f.submit(speech());
  if(mode==='death')await worldAction(f,{type:'end_thread',traveler_id:'traveler'},'atropos','npc');
  const c=await f.command(speech('Forged!'));
  if(mode==='observers'||mode==='source'){
   const p=principal('traveler'),envelope:CharacterEnvelope={version:CHARACTER_PROFILE,scope:c.scope,request_id:c.request_id,request_hash:characterRequestHash(c,p),requester:{principal_id:p.principal_id,actor_id:p.actor_id,role:p.role},body:{type:'speak',actor_id:'traveler',text:'Forged!',addressed_actor_ids:['donor'],witnesses:{request_hash:characterRequestHash(c,p),actor_ids:['traveler'],party_id:null}}};
   const patch=mode==='observers'?{observers:['system','outsider']}:{source_id:'clotho'};
   const before=await f.ledger.events();
   await assert.rejects(writeCarrier(f,envelope,system(),patch),/observation|witness|source|authoriz/i);
   assert.deepEqual(await f.ledger.events(),before,'new invalid delivery refuses before append');
   // Old signed v1 histories must still exercise the character replay guard.
   // Construct a historical record explicitly; never relax new admission.
   await writeCarrier(f,envelope);
   const history=await f.ledger.events(),last=history.at(-1)!;
   assert.equal(last.proposal.action.type,'observe_claim');
   if(last.proposal.action.type!=='observe_claim')throw Error('Missing carrier');
   Object.assign(last.proposal.action.observation,patch);
   last.authority.signature=sign(null,Buffer.from(canonical(unsigned(last))),keys.privateKey).toString('base64');
   last.hash=eventHash(last);
   assert.equal(replay(f.seed,history).sequence,history.length,'legacy rule/signature replay is preserved');
   assert.throws(()=>authority.replayCharacters(f.seed,history,system()),/carrier/i,mode);
   continue;
  }else await forgedCarrier(f,c,principal('traveler'),e=>{if(mode==='party'){e.body.witnesses.party_id='party';e.body.witnesses.actor_ids.push('outsider');}});
  await assert.rejects(f.service.readProjection(),/carrier/i,mode);
 }
});
test('validly hashed signed impressions cannot forge evidence, nature or predecessor state',async t=>{
 for(const mode of ['evidence','nature','predecessor']){
  const f=await setup(t);const speechReceipt=await f.submit(speech());
  let previous:string|null=null;
  if(mode==='predecessor'){const receipt=await f.submit({type:'form_impression',subject_actor_id:'traveler',evidence_ids:[speechReceipt.event_hash],interpretation:'Original.',previous_impression_id:null},principal('donor','npc'));previous=receipt.event_hash;}
  const p=principal(mode==='evidence'?'proxy':'donor','npc');
  if(mode==='evidence')await f.submit({type:'configure',profile:characterProfile('proxy')},system());
  const c=await f.command({type:'form_impression',subject_actor_id:'traveler',evidence_ids:[speechReceipt.event_hash],interpretation:'Forged judgment.',previous_impression_id:mode==='predecessor'?null:previous});
  const envelope:CharacterEnvelope={version:CHARACTER_PROFILE,scope:c.scope,request_id:c.request_id,request_hash:characterRequestHash(c,p),requester:{principal_id:p.principal_id,actor_id:p.actor_id,role:p.role},body:{type:'form_impression',data:{owner_actor_id:p.actor_id,subject_actor_id:'traveler',evidence_ids:[speechReceipt.event_hash],interpretation:'Forged judgment.',previous_impression_id:null,nature_revision:1,nature:characterProfile().nature}}};
  if(mode==='nature'&&envelope.body.type==='form_impression')envelope.body.data.nature.description='Invented personality';
  await writeCarrier(f,envelope);await assert.rejects(f.service.readProjection(),/carrier/i,mode);
 }
});
test('activity updates and profile revisions preserve observer histories and require the direct living actor',async t=>{
 const f=await setup(t);const before=await f.service.readProjection();
 await f.submit({type:'set_activity',activity:{description:'Mending the roof',busy_until:30}},principal('donor','npc'));
 const after:CharacterProjection=await f.service.readProjection();const donor=after.profiles.find(p=>p.actor_id==='donor')!;
 assert.equal(donor.activity.description,'Mending the roof');assert.equal(donor.revision,1);assert.deepEqual(donor.nature,before.profiles.find((p:any)=>p.actor_id==='donor').nature);
 await assert.rejects(f.submit({type:'set_activity',activity:{description:'Override',busy_until:30}},system()),/direct|player|NPC/i);
 await assert.rejects(f.submit({type:'configure',profile:characterProfile('donor')},system()),/revision/i);
 await assert.rejects(f.submit({type:'configure',profile:characterProfile('clotho')},{...system(),principal_id:'other_host'}),/system|identity/i);
 await worldAction(f,{type:'end_thread',traveler_id:'donor'},'atropos','npc');
 await assert.rejects(f.submit({type:'set_activity',activity:{description:'Continuing',busy_until:30}},principal('donor','npc')),/living/i);
});
test('a full witness grant cannot silently truncate the automatically added speaker',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'argo-character-witness-bound-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const seed=genesis(),ids=Array.from({length:64},(_,i)=>`observer_${i}`);
 for(const id of ids)seed.actors[id]=structuredClone(seed.actors.donor!);
 const ledger=await openLedger({directory,genesis:seed,privateKey:keys.privateKey});
 const service=await authority.createCharacterAuthority({ledger,systemPrincipal:system(),authorizeWitnesses:async(r:any)=>({request_hash:r.request_hash,actor_ids:ids,party_id:null})});
 const command=async(body:CharacterCommandBody):Promise<CharacterCommand>=>({version:CHARACTER_PROFILE,scope:seed.scope,request_id:`limit_${++idsCounter}`,expected_cursor:(await service.readProjection()).cursor,body});
 await service.submit(await command({type:'configure',profile:characterProfile('traveler')}),system());
 await assert.rejects(service.submit(await command(speech()),principal('traveler')),/grant|contract/i);assert.equal((await ledger.events()).length,1);
});
let idsCounter=0;
test('action history retains literal custody and subject details without consent or grant proofs',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'argo-character-summary-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const seed=genesis();seed.items.book={custodian_id:'donor',destroyed:false};
 const ledger=await openLedger({directory,genesis:seed,privateKey:keys.privateKey,verifyReceipt:async()=>true});
 const service=await authority.createCharacterAuthority({ledger,systemPrincipal:system()});
 await service.submit({version:CHARACTER_PROFILE,scope:seed.scope,request_id:'activate_summary',expected_cursor:(await service.readProjection()).cursor,body:{type:'configure',profile:characterProfile('donor')}},system());
 const f={ledger};
 await worldAction(f,{type:'move_item',item_id:'lamp',to_actor_id:'traveler'},'donor','player');
 await worldAction(f,{type:'move_item',item_id:'book',to_actor_id:'outsider'},'donor','player');
 const consent={consent_id:'private_consent',donor_id:'donor',recipient_id:'traveler',units:20,expires_at:40,terms_hash:'12'.repeat(32),confirmation_id:'private_receipt'};
 const snapshot=await ledger.snapshot();await ledger.submit(proposal(snapshot,{type:'record_consent',consent},'donor'),{...principal('donor'),confirmed_receipts:[consent.confirmation_id]});
 await worldAction(f,{type:'transfer_time',consent_id:consent.consent_id},'traveler','player');
 await worldAction(f,{type:'grant_proxy',grant:{grant_id:'private_grant',grantor_id:'donor',grantee_id:'proxy',actions:['move_item'],resource_ids:['private_resource'],valid_from:10,expires_at:30,max_uses:1}},'donor','player');
 await worldAction(f,{type:'end_thread',traveler_id:'outsider'},'atropos','npc');
 const projection:CharacterProjection=await service.readProjection();const texts=projection.records.map(r=>r.experience.text);
 assert.equal(texts[0],'Moved item "lamp" to actor "traveler".');assert.equal(texts[1],'Moved item "book" to actor "outsider".');
 assert.equal(texts[3],'Completed a transfer of 20 time units from actor "donor" to actor "traveler".');assert.equal(texts[5],'Ended the thread of actor "outsider".');
 const history=JSON.stringify(projection.records);
 for(const hidden of [consent.consent_id,consent.terms_hash,consent.confirmation_id,'private_grant','private_resource','nonce','signature','confirmed_by'])assert.ok(!history.includes(hidden),hidden);
});
test('a carrier using the service identity with a downgraded role fails closed',async t=>{
 const f=await setup(t),command=await f.command(speech('Forged!'));
 await forgedCarrier(f,command,principal('traveler'),()=>{},principal('system','player'));
 await assert.rejects(f.service.readProjection(),/carrier|system/i);
});
test('action summaries exclude hidden rolls and consent evidence, and witnesses acquire only at annotation time',async t=>{
 const f=await setup(t);await worldAction(f,{type:'draw',label:'SECRET_ROLL',bound:20,visibility:'authority',audience_id:null});
 const moved=await worldAction(f,{type:'move_item',item_id:'lamp',to_actor_id:'traveler'},'donor','player');
 const p:CharacterProjection=await f.service.readProjection();assert.equal(p.records.length,1);assert.equal(p.records[0]!.experience.action_type,'move_item');assert.deepEqual(p.records[0]!.acquisitions.map(a=>a.actor_id),['donor']);
 const json=JSON.stringify(p.records);assert.ok(!json.includes('SECRET_ROLL'));assert.ok(!json.includes(f.seed.seed));assert.ok(!json.includes('signature'));assert.ok(!json.includes('nonce'));
 const receipt=await f.submit({type:'witness_action',record_id:moved.event_hash},system());
 const after:CharacterProjection=await f.service.readProjection();assert.equal(after.records[0]!.acquisitions.at(-1)!.sequence,receipt.cursor.sequence);
});
test('speech budget counts Unicode code points and cutoff rejects speech without adjudication',async t=>{
 let calls=0;const f=await setup(t,{authorizeWitnesses:async(r:any)=>{calls++;return {request_hash:r.request_hash,actor_ids:[],party_id:null};}});
 const profile=characterProfile('traveler');profile.revision=2;profile.speech_policy.max_characters=2;await f.submit({type:'configure',profile},system());
 await f.submit(speech('🙂🙂'));await worldAction(f,{type:'advance_time',to_time:12});await assert.rejects(f.submit(speech('🙂🙂🙂')),/budget|length|characters/i);
 await worldAction(f,{type:'vanish_thread',traveler_id:'traveler'});await assert.rejects(f.submit(speech('Hi')),/cutoff|engagement|speech/i);assert.equal(calls,1);
});
test('concurrent exact speech requests commit once even if host grants differ',async t=>{
 let release:()=>void=()=>{},count=0;const barrier=new Promise<void>(r=>release=r);
 const f=await setup(t,{authorizeWitnesses:async(r:any)=>{const n=++count;if(n===2)release();await barrier;return {request_hash:r.request_hash,actor_ids:n===1?['donor']:['outsider'],party_id:null};}});
 const c=await f.command(speech());const results=await Promise.all([f.service.submit(c,principal('traveler')),f.service.submit(c,principal('traveler'))]);
 assert.deepEqual(results[0],results[1]);assert.equal((await f.ledger.events()).length,4);assert.equal((await f.service.readProjection()).records.length,1);
});
test('character bridge binds receipts to scope, request content, kind and exact committed cursor',async t=>{
 const f=await setup(t);assert.equal(typeof bridgeModule.createCharacterBridge,'function','Character bridge is implemented');
 const client=bridgeModule.createCharacterBridge({scope:f.seed.scope,transport:(c:CharacterCommand,p:Principal,o:any)=>f.service.submit(c,p,o)});
 const c=await f.command(speech());const receipt:CharacterReceipt=await client.submit(c,principal('traveler'));assert.equal(receipt.request_hash,characterRequestHash(c,principal('traveler')));
 for(const patch of [{scope:{...receipt.scope,branch_id:'wrong'}},{request_hash:'f'.repeat(64)},{kind:'set_activity'},{cursor:{...receipt.cursor,world_time:11}}]){
  const bad=bridgeModule.createCharacterBridge({scope:f.seed.scope,transport:async()=>({...receipt,...patch})});await assert.rejects(bad.submit(c,principal('traveler')),/scope|bind|receipt|request/i);
 }
});
