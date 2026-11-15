import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const root=process.argv[2]??'/tmp/argo-independent-review-e5';
const {openLedger}=await import(root+'/packages/ledger/src/index.ts');
const {createCharacterAuthority,replayCharacters}=await import(root+'/packages/ledger/src/characters.ts');
const {genesis,keys,principal,proposal}=await import(root+'/TESTS/fixtures.ts');
const {characterProfile}=await import(root+'/TESTS/character-fixtures.ts');
const {canonical,CHARACTER_PROFILE,characterRequestHash,characterProposalId}=await import('/workspace/ARGO/.worktrees/deep-review-repair/packages/contracts/src/index.ts');
const system=principal('system','system');
async function fixture(fn){const directory=await mkdtemp(join(tmpdir(),'argo-independent-extra-'));try{const seed=genesis(),ledger=await openLedger({directory,genesis:seed,privateKey:keys.privateKey});await fn({directory,seed,ledger});}finally{await rm(directory,{recursive:true,force:true});}}
async function command(seed,authority,id,body){return {version:CHARACTER_PROFILE,scope:seed.scope,request_id:id,expected_cursor:(await authority.readProjection()).cursor,body};}
await fixture(async f=>{
 let events=[];const source={...f.ledger,events:async()=>events};
 const authority=await createCharacterAuthority({ledger:source,systemPrincipal:system});
 const c=await command(f.seed,authority,'own_ack',{type:'configure',profile:characterProfile('traveler')});
 const receipt=await authority.submit(c,system);
 await assert.rejects(authority.readProjection(),{code:'CORRUPT_LEDGER'});events=await f.ledger.events();const projection=await authority.readProjection();assert.equal(projection.cursor.sequence,receipt.cursor.sequence);
 console.log(JSON.stringify({probe:'character_acknowledged_append_rollback_injected_source',result:'rollback rejected; real history restores service',acknowledged_sequence:receipt.cursor.sequence,observed_sequence:projection.cursor.sequence}));
});
await fixture(async f=>{
 const writer=await createCharacterAuthority({ledger:f.ledger,systemPrincipal:system});
 await writer.submit(await command(f.seed,writer,'config',{type:'configure',profile:characterProfile('traveler')}),system);
 let events=await f.ledger.events();
 const authority=await createCharacterAuthority({ledger:{...f.ledger,events:async()=>events},systemPrincipal:system});
 const before=await authority.readProjection(),original=structuredClone(events);
 events[0].proposal.action.observation.content='mutated after delivery';
 assert.equal(before.profiles[0].nature.description,characterProfile('traveler').nature.description);
 await assert.rejects(authority.readProjection(),{code:'CORRUPT_LEDGER'});
 events=original;assert.deepEqual(await authority.readProjection(),before);
 console.log(JSON.stringify({probe:'mutable_injected_event_objects',result:'prior projection detached; next read rejects mutation; restoration recovers'}));
 await writer.submit(await command(f.seed,writer,'activity',{type:'set_activity',activity:{description:'NEW SUFFIX ACTIVITY',busy_until:13}}),principal('traveler'));
 const state=await f.ledger.snapshot(),profile=characterProfile('traveler');profile.revision=3;
 const c={version:CHARACTER_PROFILE,scope:f.seed.scope,request_id:'invalid_profile_revision',expected_cursor:{sequence:state.sequence,head:state.head,world_time:state.world_time},body:{type:'configure',profile}};
 const request_hash=characterRequestHash(c,system),id=characterProposalId(f.seed.scope,c.request_id);
 const envelope={version:CHARACTER_PROFILE,scope:f.seed.scope,request_id:c.request_id,request_hash,requester:{principal_id:system.principal_id,actor_id:system.actor_id,role:system.role},body:c.body};
 await f.ledger.submit(proposal(state,{type:'observe_claim',observation:{claim_id:id,channel:'belief',source_id:'system',content:canonical(envelope),observers:['system'],party_id:null,occurred_at:state.world_time}},'system',id),system);
 events=await f.ledger.events();await assert.rejects(authority.readProjection(),{code:'CORRUPT_LEDGER'});
 events=original;assert.deepEqual(await authority.readProjection(),before);
 assert.equal(before.profiles[0].activity.description,characterProfile('traveler').activity.description);
 console.log(JSON.stringify({probe:'signed_bad_carrier_after_valid_mutating_suffix',result:'rejected atomically; previous projection and cache preserved'}));
});
