/** Independent ordinary-process SC-610 compatibility checks. No source hooks. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
process.umask(0o077);
assert.equal(Object.hasOwn(process.env,'NODE_TEST_CONTEXT'),false,'Run outside node:test');
const args=process.argv.slice(2),arg=name=>args[args.indexOf(name)+1];
for(const flag of ['--repo','--candidate','--output','--fixture','--fixture-manifest'])assert.ok(args.includes(flag),`Required ${flag}`);
const root=resolve(arg('--repo')),candidate=arg('--candidate'),output=resolve(arg('--output'));
assert.match(candidate,/^[a-f0-9]{40}$/);
const fixturePath=resolve(arg('--fixture')),manifestPath=resolve(arg('--fixture-manifest'));
const manifestBytes=await readFile(manifestPath),fixtureManifest=JSON.parse(manifestBytes.toString('utf8'));
assert.equal(fixtureManifest.source,'8e2104c6d466b8b2bee2d0b23d984d2e60a65e11','Fixture manifest must identify the original baseline');
assert.equal(fixtureManifest.fixture_events,512);assert.deepEqual(fixtureManifest.fixture_schema,['genesis','events','expected_state']);
for(const key of ['fixture_sha256','genesis_hash','terminal_state_hash','terminal_event_hash'])assert.match(fixtureManifest[key],/^[a-f0-9]{64}$/);
const fixtureDigest=fixtureManifest.fixture_sha256;
const sha=b=>createHash('sha256').update(b).digest('hex'),mod=p=>import(pathToFileURL(join(root,p)).href);
const {canonical}=await mod('packages/contracts/src/index.ts');
const {assertWorldContract,assertWorldGenesis}=await mod('packages/contracts/src/shared-world.ts');
const {initialWorldState,resolveWorld,worldStateHash}=await mod('packages/ledger/src/world/rules.ts');
const {ownWorldGenesis,withWorldHead}=await mod('packages/ledger/src/world/rules/ownership.ts');
const {createWorldEvent,verifyWorldEvent,replayWorld}=await mod('packages/ledger/src/world/journal.ts');
const {genesis:fixtureGenesis,principal,command,offer,accept}=await mod('TESTS/shared-world-rules-helpers.ts');
const {keys}=await mod('TESTS/mortal-fixtures.ts');
const clone=x=>structuredClone(x),hash=x=>sha(canonical(x));
// The preflight pins this generic canonical module byte-for-byte to baseline.
// Deliberately detach before the oracle: no candidate ownership flag/cache can help.
function oracle(state){const raw=clone(state),{head,...cursor}=raw.cursor;return sha(canonical({domain:'shared-world/0.1.0/state',state:{...raw,cursor}}));}
function reordered(x){if(Array.isArray(x))return x.map(reordered);if(x&&typeof x==='object')return Object.fromEntries(Object.keys(x).reverse().map(k=>[k,reordered(x[k])]));return x;}
const note=(text='Independent compatibility note')=>({type:'speak',text,audience:{kind:'self',addressed_actor_ids:[]},in_reply_to:null});
const checks=[];async function check(name,fn){const start=performance.now();try{const details=await fn();checks.push({name,status:'pass',elapsed_ms:performance.now()-start,...(details?{details}:{})});console.log(`PASS ${name}`);}catch(error){checks.push({name,status:'fail',message:error?.message,stack:error?.stack});console.error(`FAIL ${name}: ${error?.message}`);}}
const bytes=await readFile(fixturePath);assert.equal(sha(bytes),fixtureDigest);const preserved=JSON.parse(bytes.toString('utf8'));
assert.equal(bytes.length,fixtureManifest.fixture_bytes);assert.deepEqual(Object.keys(preserved).sort(),['events','expected_state','genesis']);
assert.equal(hash(preserved.genesis),fixtureManifest.genesis_hash);assert.equal(preserved.expected_state.cursor.head,fixtureManifest.terminal_event_hash);
assert.equal(preserved.events.at(-1)?.hash,fixtureManifest.terminal_event_hash);assert.equal(oracle(preserved.expected_state),fixtureManifest.terminal_state_hash);
assert.equal(Buffer.byteLength(canonical(preserved.expected_state)),fixtureManifest.terminal_state_bytes);
assert.equal(preserved.events.length,512);let terminal,prefixStates=new Map();
await check('old 512-event signed fixture full replay exactly reproduces saved terminal state',()=>{
 const start=performance.now();terminal=replayWorld(preserved.genesis,preserved.events);const replay_ms=performance.now()-start;
 assert.equal(canonical(terminal),canonical(preserved.expected_state));assert.equal(worldStateHash(terminal),fixtureManifest.terminal_state_hash);assert.equal(terminal.cursor.head,fixtureManifest.terminal_event_hash);assert.equal(oracle(terminal),worldStateHash(terminal));
 return {fixture_sha256:fixtureDigest,events:512,replay_ms,terminal_hash:worldStateHash(terminal),limits:'One correctness replay timing, not a SQLite/provider or portable benchmark.'};
});
await check('every fixture prefix equals detached generic canonical oracle; selected raw and reordered hashes agree',()=>{
 const g=ownWorldGenesis(preserved.genesis),selected=new Set([0,1,2,3,31,32,127,128,255,256,511,512]);let state=initialWorldState(g),last=oracle(state);assert.equal(worldStateHash(state),last);prefixStates.set(0,state);
 for(let i=0;i<preserved.events.length;i++){const event=preserved.events[i];assert.equal(event.before_hash,last);state=verifyWorldEvent(g,state,event);last=oracle(state);assert.equal(last,event.after_hash,`generic prefix ${i+1}`);assert.equal(worldStateHash(state),last);if(selected.has(i+1)){prefixStates.set(i+1,state);assert.equal(worldStateHash(clone(state)),last);assert.equal(worldStateHash(reordered(state)),last);assert.equal(worldStateHash(withWorldHead(state,'f'.repeat(64))),last);}}
 assert.equal(canonical(state),canonical(preserved.expected_state));return {generic_prefixes:513,selected_raw_prefixes:[...selected]};
});
await check('signature failures at first and last old prefixes remain fatal without changing retained states',()=>{
 const g=ownWorldGenesis(preserved.genesis);for(const sequence of [1,512]){const state=prefixStates.get(sequence-1);assert.ok(state);const before=canonical(state),bad=clone(preserved.events[sequence-1]);bad.signature=Buffer.alloc(64).toString('base64');const {hash:ignored,...signed}=bad;bad.hash=hash(signed);assert.throws(()=>verifyWorldEvent(g,state,bad),e=>e.code==='CORRUPT_LEDGER');assert.equal(canonical(state),before);assert.equal(worldStateHash(state),oracle(state));}return {tampered_prefixes:[1,512]};
});
await check('old retained prefixes and divergent immutable forks never share mutable hash/index state',()=>{
 const g=ownWorldGenesis(preserved.genesis);for(const n of [1,32,256,512]){const state=prefixStates.get(n);assert.ok(state);const before=canonical(state),expected=oracle(state);const left=resolveWorld(g,state,command(state,note(`left ${n}`),'hero',`fork_left_${n}`),principal(g)),right=resolveWorld(g,state,command(state,note(`right ${n}`),'hero',`fork_right_${n}`),principal(g));
  assert.equal(worldStateHash(left.state),oracle(left.state));assert.equal(worldStateHash(right.state),oracle(right.state));assert.notEqual(worldStateHash(left.state),worldStateHash(right.state));assert.equal(canonical(state),before);assert.equal(worldStateHash(state),expected);assert.throws(()=>{left.state.memories.at(-1).payload.text='poison';});assert.equal(worldStateHash(right.state),oracle(right.state));}
 return {fork_prefixes:[1,32,256,512]};
});
await check('mixed signed Unicode, impression, loan, physical, encounter and closure trace preserves every digest',()=>{
 const raw=fixtureGenesis();raw.profiles[0].max_speech_characters=2048;raw.profiles[0].nature.description='Order, e\u0301, é, 😀';const g=ownWorldGenesis(raw),events=[];let s=initialWorldState(g),count=0;const tricky='Quote " slash \\ newline\n tab\t nul\u0000 emoji😀 combining e\u0301 plain é sep\u2028 lone\ud800';
 function step(action,id='hero'){const before=oracle(s),made=createWorldEvent(g,s,command(s,action,id,`mixed_${++count}`),principal(g,id),keys.privateKey);assert.equal(made.event.before_hash,before);assert.equal(made.event.after_hash,oracle(made.state));assert.equal(worldStateHash(made.state),oracle(made.state));assert.equal(worldStateHash(reordered(made.state)),oracle(made.state));assertWorldContract('State',made.state,g);events.push(made.event);s=made.state;}
 step({type:'speak',text:tricky,audience:{kind:'whisper',addressed_actor_ids:['companion']},in_reply_to:null});
 step({type:'speak',text:'I heard '+tricky,audience:{kind:'whisper',addressed_actor_ids:['hero']},in_reply_to:s.memories.at(-1).record_id},'companion');
 step({type:'impress',subject_actor_id:'companion',evidence_ids:[s.memories.at(-1).record_id],interpretation:tricky,previous_impression_id:null});
 step({type:'set_activity',activity:{description:tricky,busy_until:0}});step(offer('mixed_loan',3000));step({type:'set_knowledge',knowledge_id:'lamp_policy',active:false},'host');step(accept(s),'companion');
 step({type:'mortal',action:{type:'transfer_item',item_id:'lamp',to_actor_id:'watcher'}},'companion');step({type:'return_loan',loan_id:'mixed_loan'},'watcher');step({type:'set_knowledge',knowledge_id:'lamp_policy',active:true},'host');step({type:'mortal',action:{type:'wait',turns:1}});
 step({type:'mortal',action:{type:'begin_encounter',encounter_id:'mixed_fight',side_a:['hero'],side_b:['raider'],escape_allowed:true}},'host');step(note(tricky),'remote');step({type:'mortal',action:{type:'recover_encounter',encounter_id:'mixed_fight',turn_started_sequence:s.physical.encounter.turn_started_sequence,resolution:'close',reason:'compatibility'}},'host');step({type:'close_mythic_engagement'},'host');step(note(tricky));
 assert.deepEqual(replayWorld(g,events),s);return {events:events.length,all_prefix_hashes_match:true,unicode_includes_lone_surrogate:true};
});
await check('private command context binding matches every frozen contextual predicate and raw guard first',()=>{
 const g=ownWorldGenesis(fixtureGenesis()),s=initialWorldState(g),stale={sequence:17,head:'a'.repeat(64),world_time:600},cases=[];
 const mortal=[{type:'travel',route_id:'road'},{type:'explore',opportunity_id:'cache'},{type:'rest'},{type:'wait',turns:1},{type:'equip',item_id:'spear',equipped:true},{type:'transfer_item',item_id:'lamp',to_actor_id:'companion'},{type:'pickup',item_id:'lamp'},{type:'loot',item_id:'lamp'},{type:'give',to_actor_id:'companion',resource:'rations',units:1},{type:'buy',stock_id:'food',units:1},{type:'begin_encounter',encounter_id:'fight',side_a:['hero'],side_b:['raider'],escape_allowed:true},{type:'attack',target_id:'raider',weapon_id:'spear'},{type:'defend'},{type:'retreat'},{type:'pass'},{type:'recover_encounter',encounter_id:'fight',turn_started_sequence:1,resolution:'close',reason:'compatibility'}];
 const actions=[note(),{type:'impress',subject_actor_id:'companion',evidence_ids:['b'.repeat(64)],interpretation:'evidence',previous_impression_id:null},{type:'set_activity',activity:{description:'Idle',busy_until:0}},offer('matrix',3000),{type:'withdraw_loan_offer',offer_id:'matrix'},{type:'accept_loan',offer_id:'matrix',offer_hash:'b'.repeat(64)},{type:'return_loan',loan_id:'matrix'},{type:'set_knowledge',knowledge_id:'lamp_policy',active:true},{type:'close_mythic_engagement'},...mortal.map(action=>({type:'mortal',action}))];
 const isRef=a=>['set_knowledge','close_mythic_engagement'].includes(a.type)||a.type==='mortal'&&['begin_encounter','recover_encounter'].includes(a.action.type);
 function make(action,id){const c=command(s,action,id??(isRef(action)?'host':'hero'),`context_${cases.length}`);c.expected=clone(stale);c.causation_id=stale.head;return c;}
 for(const a of actions)cases.push({name:'positive_'+(a.type==='mortal'?a.action.type:a.type),c:make(a)});
 const original=make(note());for(const field of Object.keys(g.mortal.scope)){const c=clone(original);c.scope[field]=field==='rights_lane'?'homebrew':c.scope[field]+'_foreign';if(['tenant_id','rights_lane','workspace_id'].includes(field))c.scope.workspace_tenant_id=`${c.scope.tenant_id}:${c.scope.rights_lane}:${c.scope.workspace_id}`;cases.push({name:'scope_'+field,c});}
 const bad=(name,action,id)=>cases.push({name,c:make(action,id)});
 bad('unknown_actor',note(),'unknown_actor');bad('unknown_speech_addressee',{type:'speak',text:'hello',audience:{kind:'whisper',addressed_actor_ids:['missing']},in_reply_to:null});bad('unknown_impression_subject',{...actions[1],subject_actor_id:'missing'});
 for(const [name,change] of [['unknown_borrower',{borrower_actor_id:'missing'}],['unknown_item',{item_id:'missing'}],['unknown_checkpoint',{return_location_id:'missing'}],['unknown_policy',{policy_id:'missing'}],['wrong_policy_subject',{item_id:'spear'}],['cap_above_policy',{repair_cap_obols:6}]])bad(name,{...offer('invalid',3000),...change});
 bad('wrong_policy_owner',{...offer('invalid_owner',3000),borrower_actor_id:'hero'},'companion');bad('unknown_knowledge',{type:'set_knowledge',knowledge_id:'missing',active:true});
 bad('self_address',{type:'speak',text:'hello',audience:{kind:'whisper',addressed_actor_ids:['hero']},in_reply_to:null});bad('self_impression',{...actions[1],subject_actor_id:'hero'});bad('self_borrower',{...offer('self',3000),borrower_actor_id:'hero'});bad('expired_offer',{...offer('expired',600)});
 // Frozen contextual Command binding deliberately does not invent new mortal-reference rules.
 for(const a of [{type:'travel',route_id:'missing'},{type:'attack',target_id:'missing',weapon_id:'missing'},{type:'transfer_item',item_id:'missing',to_actor_id:'missing'}])bad('mortal_dynamic_'+a.type,{type:'mortal',action:a});
 let valid=0,invalid=0;const outcomes=[];
 for(const row of cases){let expected;try{assertWorldContract('Command',row.c,g);expected='CONFLICT';valid++;}catch(e){expected=e.code;assert.equal(expected,'INVALID_CONTRACT');invalid++;}const id=row.c.actor_id,pp=id===null?principal(g,'host'):g.mortal.actors.some(a=>a.id===id)?principal(g,id):{...principal(g),actor_id:id};let actual;try{resolveWorld(g,s,row.c,pp);actual='accepted';}catch(e){actual=e.code;}assert.equal(actual,expected,row.name);outcomes.push({name:row.name,expected,actual});}
 return {cases:cases.length,context_valid_reaches_stale_conflict:valid,raw_or_context_invalid:invalid,outcomes};
});
await check('caller freezing, aliases, forged state flags and hostile values cannot enter owned caches',()=>{
 const raw=fixtureGenesis(),g=ownWorldGenesis(raw),initial=initialWorldState(g);const r=resolveWorld(g,initial,command(initial,note()),principal(g));const s=r.state,original=oracle(s);assert.equal(worldStateHash(s),original);
 const frozen=Object.freeze(clone(s));assert.equal(worldStateHash(frozen),original);frozen.memories[0].payload.text='changed after shallow freeze';assert.notEqual(worldStateHash(frozen),original);assert.equal(worldStateHash(frozen),oracle(frozen));assert.equal(worldStateHash(s),original);
 const foreign=clone(raw);foreign.environment='day';assert.throws(()=>resolveWorld(foreign,s,command(s,note(),'hero','foreign'),principal(foreign)));
 const injected=clone(s);injected.physical.actors[0].controller_id='other';Object.freeze(injected);assert.throws(()=>resolveWorld(g,injected,command(s,note(),'hero','injected'),principal(g)));assert.throws(()=>withWorldHead(Object.freeze(clone(s)),'c'.repeat(64)));
 for(const value of [NaN,Infinity,-0,Number.MAX_SAFE_INTEGER+1]){const bad=clone(s);bad.cursor.world_time=value;assert.throws(()=>worldStateHash(bad));}
 for(const key of ['trusted','owned','state_hash']){const bad=clone(s);bad[key]=true;assert.throws(()=>worldStateHash(bad));}
 let hits=0;const bad=clone(s);Object.defineProperty(bad,'memories',{enumerable:true,get(){hits++;throw Error('getter');}});assert.throws(()=>worldStateHash(bad));const proxy=new Proxy(s,{get(){hits++;throw Error('proxy');},getPrototypeOf(){hits++;throw Error('prototype');}});assert.throws(()=>worldStateHash(proxy));const revoked=Proxy.revocable(s,{});revoked.revoke();assert.throws(()=>worldStateHash(revoked.proxy));assert.equal(hits,0);
 raw.profiles[0].nature.description='caller changed';assert.equal(worldStateHash(initial),oracle(initial));assert.throws(()=>resolveWorld(raw,s,command(s,note(),'hero','mutated_genesis'),principal(raw)));return {hostile_trap_calls:hits};
});
await check('aggregate byte refusal after tentative loan transfer leaves prior hash, custody and request reusable',()=>{
 const rawG=fixtureGenesis();rawG.profiles[0].max_speech_characters=2048;const g=ownWorldGenesis(rawG),initial=initialWorldState(g),offered=resolveWorld(g,initial,command(initial,offer('capacity',3000)),principal(g)).state,raw=clone(offered),target=16777216-1200;let size=Buffer.byteLength(JSON.stringify(raw));
 function row(text){const sequence=raw.memories.length+1,request_id=`capacity_${sequence}`;return {record_id:hash({domain:'shared-world/0.1.0/memory',genesis_hash:raw.genesis_hash,request_id,sequence}),request_id,sequence,world_time:0,actor_id:'hero',acquired_by:['hero'],payload:note(text)};}
 for(;;){const m=row('🙂'.repeat(2048)),cost=Buffer.byteLength(JSON.stringify(m))+1;if(size+cost>target)break;raw.memories.push(m);size+=cost;}
 const extra=target-size-Buffer.byteLength(JSON.stringify(row('')))-1;if(extra>=4)raw.memories.push(row('🙂'.repeat(Math.floor(extra/4))));raw.cursor={sequence:raw.memories.length,head:'a'.repeat(64),world_time:0};assertWorldContract('State',raw,g);
 const primed=resolveWorld(g,raw,command(raw,note('prime'),'hero','capacity_prime'),principal(g)).state,before=oracle(primed);assert.equal(worldStateHash(primed),before);
 assert.throws(()=>resolveWorld(g,primed,command(primed,accept(primed),'companion','capacity_retry'),principal(g,'companion')),e=>e.code==='INVALID_ACTION');assert.equal(worldStateHash(primed),before);assert.equal(primed.loans.length,0);assert.equal(primed.physical.items.find(i=>i.id==='lamp').owner_id,'hero');const short=resolveWorld(g,primed,command(primed,note('x'),'hero','capacity_retry'),principal(g));assert.equal(short.state.loans.length,0);assert.equal(worldStateHash(short.state),oracle(short.state));return {synthetic_host_history:true,not_signed_fixture_history:true};
});
const result={candidate,fixture_source:fixtureManifest.source,fixture_manifest_sha256:sha(manifestBytes),fixture_sha256:fixtureDigest,ordinary_process:true,node:process.version,paid_calls:0,checks,passed:checks.filter(x=>x.status==='pass').length,failed:checks.filter(x=>x.status==='fail').length,limits:['Source/frozen-file identity is enforced by the external launcher.','Generic oracle uses detached raw state and unchanged canonical serializer.','Synthetic capacity input proves guard/cache behavior, not signed-prefix authentication.','No SQLite reopen or long-runtime performance claim follows from these pure compatibility checks.']};
await writeFile(join(output,'results.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600});console.log(JSON.stringify({passed:result.passed,failed:result.failed}));if(result.failed)process.exitCode=1;
