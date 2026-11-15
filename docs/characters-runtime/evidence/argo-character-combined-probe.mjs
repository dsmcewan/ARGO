// Read-only product review. Creates and removes its own ledger directories only.
// ARGO_REVIEW_ROOT=/path/to/exact/0b827e1-checkout node --test /tmp/argo-character-combined-probe.mjs
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const root=process.env.ARGO_REVIEW_ROOT??'/workspace/ARGO/.worktrees/character-runtime';
const imp=path=>import(pathToFileURL(join(root,path)));
const {openLedger}=await imp('packages/ledger/src/index.ts');
const {createCharacterAuthority,replayCharacters}=await imp('packages/ledger/src/characters.ts');
const {createCharacterViews}=await imp('packages/lexi-bridge/src/characters.ts');
const {projectKnowledge}=await imp('packages/lexi-bridge/src/index.ts');
const {CHARACTER_PROFILE,characterRequestHash,characterProposalId,canonical}=await imp('packages/contracts/src/index.ts');
const {genesis,keys,principal,proposal}=await imp('TESTS/fixtures.ts');
const {characterProfile}=await imp('TESTS/character-fixtures.ts');
const system=()=>principal('system','system');
let counter=0;
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
async function fixture(t,authorizeWitnesses=async r=>({request_hash:r.request_hash,actor_ids:[],party_id:null})){
 const directory=await mkdtemp(join(tmpdir(),'argo-combined-independent-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const seed=genesis(),ledger=await openLedger({directory,genesis:seed,privateKey:keys.privateKey});
 const authority=await createCharacterAuthority({ledger,systemPrincipal:system(),authorizeWitnesses});
 const cmd=async(body,id=`independent_${++counter}`)=>({version:CHARACTER_PROFILE,scope:seed.scope,request_id:id,expected_cursor:(await authority.readProjection()).cursor,body});
 const submit=async(body,auth=principal('traveler'),id)=>authority.submit(await cmd(body,id),auth);
 for(const id of ['traveler','donor','outsider'])await submit({type:'configure',profile:characterProfile(id)},system());
 const world=async(action,id='system',role='system')=>ledger.submit(proposal(await ledger.snapshot(),action,id),principal(id,role));
 const carrier=async(command,auth,body)=>{
  const envelope={version:CHARACTER_PROFILE,scope:seed.scope,request_id:command.request_id,request_hash:characterRequestHash(command,auth),requester:{principal_id:auth.principal_id,actor_id:auth.actor_id,role:auth.role},body};
  const state=await ledger.snapshot(),id=characterProposalId(seed.scope,envelope.request_id);
  return ledger.submit(proposal(state,{type:'observe_claim',observation:{claim_id:id,channel:'belief',source_id:'system',content:canonical(envelope),observers:['system'],party_id:null,occurred_at:state.world_time}},'system',id),system());
 };
 return {seed,ledger,authority,cmd,submit,world,carrier};
}
const speech=text=>({type:'speak',text,addressed_actor_ids:['donor']});

test('independent: signed configure with a different service requester fails replay, although its legacy signature is valid',async t=>{
 const f=await fixture(t),profile={...characterProfile('traveler'),revision:2};
 const command=await f.cmd({type:'configure',profile});
 await f.carrier(command,{...system(),principal_id:'other_service'},command.body);
 assert.equal((await f.ledger.events()).length,4);
 await assert.rejects(f.authority.readProjection(),e=>e.code==='CORRUPT_LEDGER'&&/configured system identity/.test(e.message));
});

test('independent: a signed speech request bound to an older cursor fails inner replay',async t=>{
 const f=await fixture(t),command=await f.cmd(speech('Stale claim'));
 await f.world({type:'advance_time',to_time:11});
 const hash=characterRequestHash(command,principal('traveler'));
 await f.carrier(command,principal('traveler'),{...command.body,actor_id:'traveler',witnesses:{request_hash:hash,actor_ids:['traveler'],party_id:null}});
 assert.equal((await f.ledger.events()).length,5);
 await assert.rejects(f.authority.readProjection(),e=>e.code==='CORRUPT_LEDGER'&&/request hash/.test(e.message));
});

test('independent: same request ID with different authenticated identities races to one commit; loser conflicts',async t=>{
 const begun=deferred(),release=deferred();let calls=0;
 const f=await fixture(t,async r=>{if(++calls===2)begun.resolve();await release.promise;return {request_hash:r.request_hash,actor_ids:['donor'],party_id:null};});
 const command=await f.cmd(speech('Identity race'),'same_request');
 const a=f.authority.submit(command,principal('traveler'));
 const b=f.authority.submit(command,{...principal('traveler'),principal_id:'different_authentication'});
 const settled=Promise.allSettled([a,b]);await begun.promise;release.resolve();const results=await settled;
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 assert.equal(results.filter(r=>r.status==='rejected'&&r.reason.code==='CONFLICT').length,1);
 assert.equal((await f.ledger.events()).length,4);
 assert.equal((await f.authority.readProjection()).records.length,1);
});

test('independent: pending grants cannot cross a live nature revision; old exact retry after death returns original receipt only',async t=>{
 const begun=deferred(),release=deferred();let delayed=true;
 const f=await fixture(t,async r=>{if(delayed){begun.resolve();await release.promise;}return {request_hash:r.request_hash,actor_ids:[],party_id:null};});
 const command=await f.cmd(speech('Pending'));
 const pending=f.authority.submit(command,principal('traveler'));const settled=Promise.allSettled([pending]);await begun.promise;
 const profile={...characterProfile('traveler'),revision:2,nature:{description:'Revised nature',priorities:[]}};
 await f.submit({type:'configure',profile},system());release.resolve();
 const [result]=await settled;assert.equal(result.status,'rejected');assert.equal(result.reason.code,'CONFLICT');assert.equal((await f.authority.readProjection()).records.length,0);
 delayed=false;const accepted=await f.cmd(speech('Accepted'));const receipt=await f.authority.submit(accepted,principal('traveler'));
 await f.world({type:'end_thread',traveler_id:'traveler'},'atropos','npc');
 const before=(await f.ledger.events()).length;
 assert.deepEqual(await f.authority.submit(accepted,principal('traveler')),receipt);
 assert.equal((await f.ledger.events()).length,before);
 await assert.rejects(f.submit(speech('New speech')),e=>e.code==='UNAUTHORIZED');
});

test('independent: source-spoofed legacy beliefs stay outside the character archive, and genuine carriers stay private',async t=>{
 const f=await fixture(t),state=await f.ledger.snapshot();
 await f.ledger.submit(proposal(state,{type:'observe_claim',observation:{claim_id:'outsider_lookalike',channel:'belief',source_id:'traveler',content:'pretend genuine speech',observers:['outsider','donor'],party_id:null,occurred_at:state.world_time}},'outsider'),principal('outsider'));
 const spoken=await f.submit(speech('Actual authenticated speech'));
 const projection=await f.authority.readProjection();assert.equal(projection.records.length,1);assert.equal(projection.records[0].experience.record_id,spoken.event_hash);
 const snapshot=await f.ledger.snapshot();
 for(const actor of ['traveler','donor','outsider']){
  const view=projectKnowledge(snapshot,{schema_version:'1.0.0',scope:f.seed.scope,actor_id:actor,audience:'actor',party_id:null,as_of_sequence:snapshot.sequence,as_of_world_time:snapshot.world_time},principal(actor));
  assert.equal(view.claims.some(row=>row.observation.claim_id.startsWith('argo_character_')),false);
 }
 const readers=createCharacterViews({scope:f.seed.scope,readProjection:()=>f.authority.readProjection()});
 const donor=await readers.actor({version:CHARACTER_PROFILE,scope:f.seed.scope,cursor:projection.cursor,actor_id:'donor'},principal('donor'));
 assert.equal(donor.experiences.length,0); // Addressing never proves perception.
});

test('independent: proxy custody preserves source and operator, grant bodies remain outside archive, and every prefix replays',async t=>{
 const f=await fixture(t);
 await f.world({type:'grant_proxy',grant:{grant_id:'secret_grant_id',grantor_id:'donor',grantee_id:'proxy',actions:['move_item'],resource_ids:['lamp'],valid_from:10,expires_at:30,max_uses:1}},'donor','player');
 const p=proposal(await f.ledger.snapshot(),{type:'move_item',item_id:'lamp',to_actor_id:'traveler'},'donor');p.proxy_grant_id='secret_grant_id';
 await f.ledger.submit(p,principal('proxy'));
 const events=await f.ledger.events(),projection=await f.authority.readProjection();
 const moved=projection.records.at(-1).experience;
 assert.equal(moved.actor_id,'donor');assert.equal(moved.principal_actor_id,'proxy');assert.equal(moved.text,'Moved item "lamp" to actor "traveler".');
 assert.equal(JSON.stringify(projection.records).includes('secret_grant_id'),false);
 for(let n=0;n<=events.length;n++)assert.equal(replayCharacters(f.seed,events.slice(0,n),system()).cursor.sequence,n);
 assert.throws(()=>{projection.records[0].experience.text='mutated';},TypeError);
 assert.deepEqual(await f.authority.readProjection(),projection);
});
