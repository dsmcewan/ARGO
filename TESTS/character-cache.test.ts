import {test} from 'node:test';
import type {TestContext} from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {syncBuiltinESMExports} from 'node:module';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openLedger} from '../packages/ledger/src/index.ts';
import type {Ledger} from '../packages/ledger/src/index.ts';
import {createCharacterAuthority,replayCharacters} from '../packages/ledger/src/characters.ts';
import {createCharacterViews} from '../packages/lexi-bridge/src/characters.ts';
import {CHARACTER_PROFILE} from '../packages/contracts/src/index.ts';
import type {CharacterCommand,CharacterCommandBody,CharacterProjection,CharacterWitnessGrant,LedgerEvent,Principal} from '../packages/contracts/src/index.ts';
import {genesis,keys,principal,proposal} from './fixtures.ts';
import {characterProfile} from './character-fixtures.ts';

const system=()=>principal('system','system');
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return {promise,resolve};}
async function journal(t:TestContext,prefix='cache_request'){
 const directory=await mkdtemp(join(tmpdir(),'argo-character-cache-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const seed=genesis(),ledger=await openLedger({directory,genesis:seed,privateKey:keys.privateKey});
 const authority=await createCharacterAuthority({ledger,systemPrincipal:system(),authorizeWitnesses:async request=>({request_hash:request.request_hash,actor_ids:['donor'],party_id:null})});
 let ids=0;
 const command=async(body:CharacterCommandBody,request_id=`${prefix}_${++ids}`):Promise<CharacterCommand>=>({version:CHARACTER_PROFILE,scope:seed.scope,request_id,expected_cursor:(await authority.readProjection()).cursor,body});
 const submit=async(body:CharacterCommandBody,auth:Principal=system())=>authority.submit(await command(body),auth);
 for(const actor of ['traveler','donor'])await submit({type:'configure',profile:characterProfile(actor)});
 return {seed,ledger,authority,command,submit};
}
// Keep the real signed journal and all host methods. Replacing only the event
// delivery boundary isolates character verification and controls adversarial
// histories that a structurally supplied Ledger can return.
function source(ledger:Ledger,events:()=>Promise<LedgerEvent[]>):Ledger{return {...ledger,events};}

test('unchanged character reads do no repeated signature work and an append verifies only its suffix',async t=>{
 const f=await journal(t);let events=await f.ledger.events();
 const authority=await createCharacterAuthority({ledger:source(f.ledger,async()=>structuredClone(events)),systemPrincipal:system()});
 let checks=0;const original=crypto.verify;
 const spy=t.mock.method(crypto,'verify',(...args:Parameters<typeof crypto.verify>)=>{checks++;return Reflect.apply(original,crypto,args);});
 syncBuiltinESMExports();t.after(()=>{spy.mock.restore();syncBuiltinESMExports();});
 const before=await authority.readProjection();assert.equal(checks,2);
 checks=0;assert.deepEqual(await authority.readProjection(),before);assert.equal(checks,0,'a verified unchanged prefix must not repeat signatures');
 await f.submit({type:'speak',text:'I kept my promise.',addressed_actor_ids:['donor']},principal('traveler'));
 events=await f.ledger.events();checks=0;
 const current=await authority.readProjection();assert.equal(checks,1,'only the newly appended carrier needs verification');
 assert.equal(current.cursor.sequence,3);assert.equal(current.records[0]!.experience.text,'I kept my promise.');
 assert.equal(before.records.length,0);assert.equal(before.cursor.sequence,2);
 assert.deepEqual(current,replayCharacters(f.seed,events,system()));
});

test('a warm character authority rejects rollback and a signed divergent observed prefix',async t=>{
 const f=await journal(t),original=await f.ledger.events();let events=original;
 const authority=await createCharacterAuthority({ledger:source(f.ledger,async()=>structuredClone(events)),systemPrincipal:system()});
 await authority.readProjection();events=original.slice(0,1);
 await assert.rejects(authority.readProjection(),{code:'CORRUPT_LEDGER'});
 const other=await journal(t,'divergent_request');
 events=await other.ledger.events();
 assert.doesNotThrow(()=>replayCharacters(f.seed,events,system()));
 await assert.rejects(authority.readProjection(),{code:'CORRUPT_LEDGER'});
 events=original;assert.equal((await authority.readProjection()).cursor.sequence,2);
});

test('changed cached carrier bytes fail even when the stored event hash is unchanged',async t=>{
 const f=await journal(t);let events=await f.ledger.events();
 const authority=await createCharacterAuthority({ledger:source(f.ledger,async()=>structuredClone(events)),systemPrincipal:system()});
 const before=await authority.readProjection(),changed=structuredClone(events);
 changed[0]!.authority.signature='AA==';events=changed;
 await assert.rejects(authority.readProjection(),{code:'CORRUPT_LEDGER'});
 events=await f.ledger.events();assert.deepEqual(await authority.readProjection(),before);
});

test('a bad later suffix cannot publish earlier carrier mutations or poison the cache',async t=>{
 const f=await journal(t),prefix=await f.ledger.events();let events=prefix;
 const authority=await createCharacterAuthority({ledger:source(f.ledger,async()=>structuredClone(events)),systemPrincipal:system()});
 const before=await authority.readProjection();
 await f.submit({type:'speak',text:'Only committed memory.',addressed_actor_ids:['donor']},principal('traveler'));
 await f.ledger.submit(proposal(await f.ledger.snapshot(),{type:'advance_time',to_time:12},'system'),system());
 const valid=await f.ledger.events();events=structuredClone(valid);events[3]!.authority.signature='AA==';
 await assert.rejects(authority.readProjection(),{code:'CORRUPT_LEDGER'});
 events=prefix;assert.deepEqual(await authority.readProjection(),before);
 events=valid;const after=await authority.readProjection();assert.equal(after.records.length,1);assert.equal(after.cursor.sequence,4);
 assert.deepEqual(after,replayCharacters(f.seed,valid,system()));assert.equal(before.records.length,0);
});

test('overlapping event loads cannot publish a later prefix ahead of an older in-flight read',async t=>{
 const f=await journal(t),prefix=await f.ledger.events();
 await f.submit({type:'speak',text:'A new memory.',addressed_actor_ids:[]},principal('traveler'));
 const next=await f.ledger.events(),started=deferred<void>(),release=deferred<LedgerEvent[]>();let calls=0;
 const authority=await createCharacterAuthority({ledger:source(f.ledger,async()=>{calls++;if(calls===1){started.resolve();return release.promise;}return structuredClone(next);}),systemPrincipal:system()});
 const first=authority.readProjection();await started.promise;const second=authority.readProjection();
 release.resolve(structuredClone(prefix));
 const [earlier,later]=await Promise.all([first,second]);assert.equal(earlier.cursor.sequence,2);assert.equal(later.cursor.sequence,3);
 assert.deepEqual(await authority.readProjection(),later);assert.equal(earlier.records.length,0);
});

test('witness freshness, cancellation and exact retries survive intervening cached reads',async t=>{
 const f=await journal(t),started=deferred<void>(),release=deferred<CharacterWitnessGrant>();let requestHash='';
 const authority=await createCharacterAuthority({ledger:f.ledger,systemPrincipal:system(),authorizeWitnesses:async request=>{requestHash=request.request_hash;started.resolve();return release.promise;}});
 const command=await f.command({type:'speak',text:'A stale speech.',addressed_actor_ids:['donor']});
 const pending=authority.submit(command,principal('traveler'));await started.promise;
 await f.ledger.submit(proposal(await f.ledger.snapshot(),{type:'advance_time',to_time:12},'system'),system());
 await authority.readProjection();release.resolve({request_hash:requestHash,actor_ids:['donor'],party_id:null});
 await assert.rejects(pending,{code:'CONFLICT'});assert.equal((await authority.readProjection()).records.length,0);
 const controller=new AbortController();controller.abort();await assert.rejects(authority.readProjection({signal:controller.signal}),{code:'CANCELLED'});
 const speech=await f.command({type:'speak',text:'A current speech.',addressed_actor_ids:['donor']});
 const receipt=await f.authority.submit(speech,principal('traveler'));await authority.readProjection();
 assert.deepEqual(await authority.submit(speech,principal('traveler')),receipt);
 assert.equal((await f.ledger.snapshot()).sequence,4);
});

test('incremental prefixes match cold replay without backdating same-tick acquisitions or profile revisions',async t=>{
 const f=await journal(t);
 const moved=await f.ledger.submit(proposal(await f.ledger.snapshot(),{type:'move_item',item_id:'lamp',to_actor_id:'traveler'},'donor'),principal('donor'));
 const witnesses=await createCharacterAuthority({ledger:f.ledger,systemPrincipal:system(),authorizeWitnesses:async request=>({request_hash:request.request_hash,actor_ids:['traveler'],party_id:null})});
 await witnesses.submit(await f.command({type:'witness_action',record_id:moved.event_hash}),system());
 await f.submit({type:'form_impression',subject_actor_id:'donor',evidence_ids:[moved.event_hash],interpretation:'They shared the lamp.',previous_impression_id:null},principal('traveler'));
 const profile=characterProfile('traveler');profile.revision=2;profile.nature.description='A changed outlook.';
 await f.submit({type:'configure',profile});
 await f.submit({type:'set_activity',activity:{description:'Resting',busy_until:12}},principal('traveler'));
 await f.ledger.submit(proposal(await f.ledger.snapshot(),{type:'vanish_thread',traveler_id:'traveler'},'system'),system());
 await f.ledger.submit(proposal(await f.ledger.snapshot(),{type:'name_anomaly',traveler_id:'traveler'},'clotho'),principal('clotho','npc'));
 const events=await f.ledger.events();let length=0;
 const authority=await createCharacterAuthority({ledger:source(f.ledger,async()=>structuredClone(events.slice(0,length))),systemPrincipal:system()});
 const retained:CharacterProjection[]=[];
 for(;length<=events.length;length++){
  const projection=await authority.readProjection();retained.push(projection);
  assert.deepEqual(projection,replayCharacters(f.seed,events.slice(0,length),system()));
  const views=createCharacterViews({scope:f.seed.scope,readProjection:async()=>projection});
  const query={version:CHARACTER_PROFILE,scope:f.seed.scope,cursor:projection.cursor,actor_id:'traveler'};
  const view=await views.actor(query,principal('traveler'));
  assert.equal(view.experiences.length,length<4?0:1,'witnessing at sequence 4 must not reveal the sequence 3 action sooner');
  assert.equal(view.profile?.revision??0,length===0?0:length<6?1:2);
  assert.equal(view.impressions.length,length<5?0:1);
  if(length>=5)assert.equal(view.impressions[0]!.data.nature_revision,1,'later nature does not rewrite historical impressions');
  assert.equal(view.ontology_blocked,length>=8);assert.equal(view.engagement_closed,length>=9);
 }
 assert.equal(retained[3]!.records[0]!.acquisitions.length,1);
 assert.equal(retained[4]!.records[0]!.acquisitions.length,2);
 assert.equal(retained[5]!.profiles[0]!.revision,1);
 assert.throws(()=>{retained[5]!.profiles[0]!.nature.description='Tamper';},TypeError);
});
