import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const root=process.env.ARGO_SW_ROOT??'/workspace/ARGO/.board/shared-world-foundation/worktrees/SW-200-1-d8fbe5da6f';
const mod=async(path:string)=>import(pathToFileURL(`${root}/${path}`).href);
const {worldGenesis}=await mod('TESTS/shared-world-contract-fixtures.ts');
const {canonical,hash}=await mod('packages/contracts/src/index.ts');
const {assertWorldContract}=await mod('packages/contracts/src/shared-world.ts');
const {initialWorldState,resolveWorld,worldStateHash}=await mod('packages/ledger/src/world/rules.ts');
const {ownWorldGenesis,withWorldHead}=await mod('packages/ledger/src/world/rules/ownership.ts');
const {viewWorldActor}=await mod('packages/ledger/src/world/view.ts');
const {resolveMortalV3}=await mod('packages/ledger/src/mortal-v3/rules.ts');
const clone=(x:any)=>structuredClone(x);
function rawGenesis(){const g=worldGenesis();const a=clone(g.mortal.actors[1]);a.id='remote';a.name='remote';a.controller_id='auth_remote';a.location_id='ruin';g.mortal.actors.push(a);g.profiles.push({...clone(g.profiles[1]),actor_id:'remote'});return g;}
function fixture(edit=(g:any)=>{}){const raw=rawGenesis();edit(raw);const g=ownWorldGenesis(raw);return {g,s:initialWorldState(g)};}
function p(g:any,id='hero'){if(id==='host')return {scope:clone(g.mortal.scope),principal_id:g.mortal.referee_id,role:'referee',actor_id:null};const a=g.mortal.actors.find((x:any)=>x.id===id);return {scope:clone(g.mortal.scope),principal_id:a.controller_id,role:a.kind,actor_id:id};}
function c(s:any,action:any,id='hero',request=`ind_${s.cursor.sequence+1}`){return {version:s.version,scope:clone(s.scope),request_id:request,actor_id:id==='host'?null:id,expected:clone(s.cursor),causation_id:s.cursor.head,action};}
const note=(text='note')=>({type:'speak',text,audience:{kind:'self',addressed_actor_ids:[]},in_reply_to:null});
const offer=(id='offer',expiry=3000)=>({type:'offer_loan',offer_id:id,policy_id:'lamp_policy',item_id:'lamp',borrower_actor_id:'companion',return_location_id:'harbor',repair_cap_obols:5,expires_at:expiry});
const accept=(s:any,i=0)=>({type:'accept_loan',offer_id:s.offers[i].terms.offer_id,offer_hash:s.offers[i].offer_hash});
const mortal=(action:any)=>({type:'mortal',action});
const actor=(s:any,id='hero')=>s.physical.actors.find((a:any)=>a.id===id);
const item=(s:any,id='lamp')=>s.physical.items.find((a:any)=>a.id===id);
function resolve(g:any,s:any,a:any,id='hero',request?:string){const before=canonical(s);const r=resolveWorld(g,s,c(s,a,id,request),p(g,id));assert.equal(canonical(s),before);assertWorldContract('Resolution',r,g);assertWorldContract('State',r.state,g);assert.equal(r.state.cursor.sequence,s.cursor.sequence+1);assert.equal(r.state.memories.length,s.memories.length+1);assert.equal(r.memory,r.state.memories.at(-1));assert.ok(Object.isFrozen(r));return r;}
function next(g:any,s:any,a:any,id='hero',request?:string){const r=resolve(g,s,a,id,request);const out=withWorldHead(r.state,hash({test_only:true,previous:s.cursor.head,state_hash:worldStateHash(r.state),request:request??`ind_${r.state.cursor.sequence}`}));assertWorldContract('State',out,g);return out;}
function refused(g:any,s:any,a:any,id='hero',request?:string){const before=canonical(s),h=worldStateHash(s);assert.throws(()=>resolveWorld(g,s,c(s,a,id,request),p(g,id)));assert.equal(canonical(s),before);assert.equal(worldStateHash(s),h);}
function view(g:any,s:any,id='hero'){return viewWorldActor(g,s,{version:s.version,scope:clone(s.scope),actor_id:id,cursor:clone(s.cursor)},p(g,id));}

test('independent physical oracle: physical-first and social-first share exact RNG, physical bytes, and time',()=>{
 const {g,s}=fixture();const begin={type:'begin_encounter',encounter_id:'battle',side_a:['hero'],side_b:['raider'],escape_allowed:true};
 for(const before of [s,next(g,s,note())]){
  const input={version:'mortal-rules/0.3.0',scope:before.scope,genesis_hash:hash(g.mortal),sequence:before.cursor.sequence,head:before.cursor.sequence?before.cursor.head:hash(g.mortal),world_time:before.cursor.world_time,...before.physical};
  const direct=resolveMortalV3(g.mortal,input,{version:input.version,scope:input.scope,request_id:'oracle',actor_id:null,expected:{sequence:input.sequence,head:input.head},causation_id:input.head,action:begin},p(g,'host'));
  const joined=resolve(g,before,mortal(begin),'host','oracle');const {actors,items,opportunities,stocks,encounter,rng_counter}=direct.state;
  assert.deepEqual(joined.state.physical,{actors,items,opportunities,stocks,encounter,rng_counter});assert.deepEqual(joined.draws,direct.draws);assert.deepEqual(joined.effects,direct.effects);assert.equal(joined.state.cursor.world_time,direct.state.world_time);
 }
 const physical=next(g,s,mortal({type:'wait',turns:1}));const social=next(g,physical,note());assert.deepEqual(social.physical,physical.physical);assert.equal(social.cursor.world_time,600);
});

test('complete command and principal binding, rejected IDs remain reusable, frozen bad inputs earn no trust',()=>{
 const {g,s}=fixture();const command=c(s,note()),principal=p(g);let attempts=0;
 for(const field of Object.keys(s.scope)){if(field==='rights_lane')continue;for(const side of ['command','principal']){const cc=clone(command),pp=clone(principal);(side==='command'?cc:pp).scope[field]+='_foreign';assert.throws(()=>resolveWorld(g,s,cc,pp));attempts++;}}
 for(const mutation of [(x:any)=>x.expected.sequence++,(x:any)=>x.expected.world_time++,(x:any)=>x.expected.head='e'.repeat(64),(x:any)=>x.causation_id='e'.repeat(64),(x:any)=>x.actor_id='companion']){const cc=clone(command);mutation(cc);assert.throws(()=>resolveWorld(g,s,cc,principal));attempts++;}
 for(const mutation of [(x:any)=>x.principal_id='other',(x:any)=>x.actor_id='companion',(x:any)=>x.role='npc',(x:any)=>{x.role='referee';x.actor_id=null;}]){const pp=clone(principal);mutation(pp);assert.throws(()=>resolveWorld(g,s,command,pp));attempts++;}
 const bad=clone(s);bad.profiles[0].nature.description='forged';Object.freeze(bad);assert.throws(()=>resolveWorld(g,bad,command,principal));
 assert.equal(next(g,s,note(),'hero',command.request_id).cursor.sequence,1);assert.ok(attempts>=21);
});

test('durable offer is narrowly lender-authorized; borrower cannot alter policy, item, terms, or role',()=>{
 const {g,s}=fixture();for(const a of [{...offer(),item_id:'spear'},{...offer(),repair_cap_obols:6},{...offer(),policy_id:'missing'},{...offer(),expires_at:0}])refused(g,s,a);
 refused(g,s,offer(),'companion');let offered=next(g,s,offer());refused(g,offered,accept(offered),'hero');refused(g,offered,{...accept(offered),offer_hash:'d'.repeat(64)},'companion');
 offered=next(g,offered,{type:'set_knowledge',knowledge_id:'lamp_policy',active:false},'host');const r=resolve(g,offered,accept(offered),'companion');
 assert.equal(r.memory.actor_id,'companion');assert.equal(r.effects[0].actor_id,'hero');assert.equal(item(r.state).owner_id,'companion');assert.equal(r.state.loans.length,1);assert.equal(r.draws.length,0);assert.equal(r.state.cursor.world_time,0);assert.equal(item(offered).owner_id,'hero');
});

test('actual post-offer capacity changes cause atomic refusal, same request can succeed after remedy',()=>{
 const {g,s}=fixture();let state=next(g,s,offer());state=next(g,state,mortal({type:'buy',stock_id:'food',units:5}),'companion');assert.equal(actor(state,'companion').resources.rations,7);
 refused(g,state,accept(state),'companion','capacity_retry');assert.equal(state.loans.length,0);assert.equal(state.offers[0].status,'open');assert.equal(item(state).owner_id,'hero');
 state=next(g,state,mortal({type:'give',to_actor_id:'raider',resource:'rations',units:1}),'companion');state=next(g,state,accept(state),'companion','capacity_retry');assert.equal(item(state).owner_id,'companion');assert.equal(state.loans.length,1);
});

test('expiry and permanent invalidation follow shared time including another actor wait',()=>{
 const {g,s}=fixture();let state=next(g,s,offer('old',600));state=next(g,state,mortal({type:'wait',turns:1}),'remote');assert.equal(state.cursor.world_time,600);refused(g,state,accept(state),'companion');
 state=next(g,state,offer('new',1200));state=next(g,state,mortal({type:'transfer_item',item_id:'lamp',to_actor_id:null}));assert.equal(state.offers[1].status,'withdrawn');state=next(g,state,mortal({type:'pickup',item_id:'lamp'}));refused(g,state,accept(state,1),'companion');refused(g,state,offer('new',1800));assert.equal(state.loans.length,0);
});

test('third-party possession, drop and pickup fulfill once; a later fresh loan remains independent',()=>{
 const {g,s}=fixture();let state=next(g,s,offer('first'));state=next(g,state,accept(state),'companion');state=next(g,state,mortal({type:'transfer_item',item_id:'lamp',to_actor_id:'raider'}),'companion');
 refused(g,state,{type:'return_loan',loan_id:'first'},'companion');state=next(g,state,mortal({type:'transfer_item',item_id:'lamp',to_actor_id:null}),'raider');state=next(g,state,mortal({type:'pickup',item_id:'lamp'}));assert.equal(state.loans[0].status,'returned');assert.equal(state.memories.filter((m:any)=>m.payload.type==='loan_returned').length,1);
 state=next(g,state,offer('second'));state=next(g,state,accept(state,1),'companion');refused(g,state,{type:'return_loan',loan_id:'first'},'companion');state=next(g,state,{type:'return_loan',loan_id:'second'},'companion');assert.equal(state.loans.length,2);assert.ok(state.loans.every((l:any)=>l.status==='returned'));assert.equal(state.cursor.world_time,0);assert.equal(state.physical.rng_counter,0);
});

test('social activity cannot reset combat token; stale and foreign recovery refuse without RNG/time changes',()=>{
 const {g,s}=fixture();let state=next(g,s,mortal({type:'begin_encounter',encounter_id:'battle',side_a:['hero'],side_b:['raider'],escape_allowed:true}),'host');const token=state.physical.encounter.turn_started_sequence,rng=state.physical.rng_counter;
 state=next(g,state,{type:'set_activity',activity:{description:'Watching',busy_until:900}});state=next(g,state,note(),'remote');state=next(g,state,mortal({type:'wait',turns:1}),'remote');assert.equal(state.physical.encounter.turn_started_sequence,token);assert.equal(actor(state).active_seconds,0);
 const recover={type:'recover_encounter',encounter_id:'battle',turn_started_sequence:token,resolution:'close',reason:'host_timeout'};refused(g,state,mortal({...recover,turn_started_sequence:token+1}),'host');refused(g,state,mortal(recover),'hero');
 state=next(g,state,mortal(recover),'host');assert.equal(state.cursor.world_time,606);assert.equal(actor(state).active_seconds,6);assert.equal(actor(state,'raider').active_seconds,6);assert.equal(state.physical.rng_counter,rng);assert.equal(state.physical.encounter,null);
});

test('deterministic replay of mixed pure transitions agrees across cold clones and owned states',()=>{
 const {g,s}=fixture();const history:any[]=[];let state=s;
 for(const [action,id] of [[note(),'hero'],[offer(),'hero'],[{type:'set_activity',activity:{description:'Ready',busy_until:0}},'companion'],[accept(next(g,next(g,s,note()),offer())),'companion'],[mortal({type:'wait',turns:1}),'remote'],[{type:'return_loan',loan_id:'offer'},'companion'],[{type:'close_mythic_engagement'},'host']] as any){const request=`mixed_${history.length}`;history.push({action,id,request});state=next(g,state,action,id,request);}
 let replay=initialWorldState(clone(g));for(const row of history)replay=next(clone(g),clone(replay),clone(row.action),row.id,row.request);assert.equal(canonical(replay),canonical(state));assert.equal(worldStateHash(replay),worldStateHash(state));assert.equal(worldStateHash(clone(state)),worldStateHash(state));
});

test('owned immutable fork caches retain independent requests, evidence, replies, and digest',()=>{
 const {g,s}=fixture();const speech={type:'speak',text:'Question',audience:{kind:'whisper',addressed_actor_ids:['raider']},in_reply_to:null};const inbound=next(g,s,speech);const reply={type:'speak',text:'Answer',audience:{kind:'whisper',addressed_actor_ids:['hero']},in_reply_to:inbound.memories[0].record_id};
 const left=next(g,inbound,reply,'raider','shared_fork_request'),right=next(g,inbound,note('Different'),'hero','shared_fork_request');assert.notEqual(worldStateHash(left),worldStateHash(right));refused(g,left,reply,'raider');assert.doesNotThrow(()=>resolve(g,right,reply,'raider'));assert.equal(view(g,inbound,'raider').replied_to.length,0);assert.equal(view(g,left,'raider').replied_to.length,1);
 assert.throws(()=>{left.memories[1].payload.text='poison';});assert.throws(()=>{g.mortal.actors[0].controller_id='poison';});const copy=clone(left);copy.physical.actors[0].controller_id='poison';assert.throws(()=>resolve(g,copy,note()));assert.equal(view(g,left).physical.self.id,'hero');
 const foreign=clone(g);foreign.environment='day';assert.throws(()=>resolve(g,withWorldHead(left,'b'.repeat(64)),note(),'hero','shared_fork_request'));assert.throws(()=>resolve(foreign,left,note()));assert.throws(()=>withWorldHead(Object.freeze(clone(left)),'c'.repeat(64)));
});

test('full-history NPC reply dedup survives view windows, cold re-entry, and rejected attempts',()=>{
 const {g,s}=fixture();let state=next(g,s,{type:'speak',text:'Addressed',audience:{kind:'whisper',addressed_actor_ids:['raider']},in_reply_to:null});const reply={type:'speak',text:'Reply',audience:{kind:'whisper',addressed_actor_ids:['hero']},in_reply_to:state.memories[0].record_id};state=next(g,state,reply,'raider');for(let i=0;i<40;i++)state=next(g,state,{type:'speak',text:`room ${i}`,audience:{kind:'room',addressed_actor_ids:[]},in_reply_to:null});assert.equal(view(g,state,'raider').memories.length,32);refused(g,state,reply,'raider');refused(g,clone(state),reply,'raider');assert.equal(state.memories.length,42);
});

test('late aggregate loan refusal cannot leak custody, obligations, or reserved request into owned indexes',()=>{
 const {g,s}=fixture(g=>g.profiles[0].max_speech_characters=2048);const raw=clone(next(g,s,offer()));const target=16777216-1200;let bytes=Buffer.byteLength(JSON.stringify(raw));
 function row(text:string){const sequence=raw.memories.length+1,request_id=`aggregate_${sequence}`;return {record_id:hash({domain:'shared-world/0.1.0/memory',genesis_hash:raw.genesis_hash,request_id,sequence}),request_id,sequence,world_time:0,actor_id:'hero',acquired_by:['hero'],payload:note(text)};}
 const big='🙂'.repeat(2048);while(true){const r=row(big),cost=Buffer.byteLength(JSON.stringify(r))+1;if(bytes+cost>target)break;raw.memories.push(r);bytes+=cost;}
 const overhead=Buffer.byteLength(JSON.stringify(row('')))+1;const remaining=target-bytes-overhead;if(remaining>=4)raw.memories.push(row('🙂'.repeat(Math.floor(remaining/4))));raw.cursor={sequence:raw.memories.length,head:'a'.repeat(64),world_time:0};assertWorldContract('State',raw,g);
 // This history is explicitly shape-valid host input, not claimed signed history.
 const primed=next(g,raw,note('prime'),'hero','prime_capacity');const prior=canonical(primed);refused(g,primed,accept(primed),'companion','late_accept');assert.equal(item(primed).owner_id,'hero');assert.equal(primed.loans.length,0);assert.equal(primed.offers[0].status,'open');assert.equal(canonical(primed),prior);
 const short=resolve(g,primed,note('x'),'hero','late_accept');assert.equal(short.state.loans.length,0);assert.equal(short.state.offers[0].status,'open');assert.equal(item(short.state).owner_id,'hero');
});
