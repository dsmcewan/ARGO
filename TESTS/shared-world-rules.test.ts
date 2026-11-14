import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ArgoError,canonical,hash} from '../packages/contracts/src/index.ts';
import {assertWorldContract} from '../packages/contracts/src/shared-world.ts';
import {initialWorldState,resolveWorld,worldStateHash} from '../packages/ledger/src/world/rules.ts';
import {ownWorldGenesis,withWorldHead} from '../packages/ledger/src/world/rules/ownership.ts';
import {genesis,principal,command,run,commit,start,speak,offer,accept,actor,item} from './shared-world-rules-helpers.ts';
const code=(c:string)=>(e:unknown)=>e instanceof ArgoError&&e.code===c;

test('initial shared identity is complete and owned; social-first actions use one clock and physical cursor',()=>{
 const g=genesis(),s=start(g);assert.equal(s.cursor.head,hash(g));assert.equal(s.genesis_hash,hash(g));assertWorldContract('State',s,g);assert.ok(Object.isFrozen(s.physical.actors[0]!.resources));
 const said=commit(g,s,speak());assert.equal(said.cursor.sequence,1);assert.equal(said.cursor.world_time,0);assert.equal(said.physical.rng_counter,0);
 const traveled=run(g,said,{type:'mortal',action:{type:'travel',route_id:'road'}});assert.equal(traveled.state.cursor.sequence,2);assert.equal(traveled.state.cursor.world_time,600);assert.equal(actor(traveled.state).active_seconds,600);assert.equal(actor(traveled.state,'companion').active_seconds,0);
 assert.equal(traveled.state.memories.length,2);assert.deepEqual(traveled.memory.payload,{type:'mortal',action:'travel',actor_ids:['hero'],item_ids:[],location_ids:[]});assertWorldContract('Resolution',traveled,g);
 assert.equal(s.cursor.sequence,0);assert.equal(g.mortal.actors[0]!.location_id,'harbor');
});
test('all direct actions bind controller, role, full scope and every cursor component',()=>{
 const g=genesis(),s=start(g),c=command(s,speak()),p=principal(g);const before=canonical({g,s,c,p});
 for(const bad of [{...p,principal_id:'impostor'},{...p,role:'npc' as const,actor_id:'hero'},{...p,actor_id:'companion',role:'player' as const}])assert.throws(()=>resolveWorld(g,s,c,bad),code('UNAUTHORIZED'));
 assert.throws(()=>resolveWorld(g,s,c,{...p,scope:{...p.scope,branch_id:'elsewhere'}}),code('SCOPE_DENIED'));
 for(const expected of [{...c.expected,world_time:1},{...c.expected,sequence:1},{...c.expected,head:'f'.repeat(64)}])assert.throws(()=>resolveWorld(g,s,{...c,expected,causation_id:expected.head},p),code('CONFLICT'));
 const next=commit(g,s,speak());assert.throws(()=>run(g,next,speak(),'hero',c.request_id),code('CONFLICT'));assert.equal(canonical({g,s,c,p}),before);
});
test('speech derives audience; remote, nonexistent and incapacitated addressees never acquire it',()=>{
 const g=genesis(),s=start(g),privateNote=run(g,s,{type:'speak',text:'Private',audience:{kind:'self',addressed_actor_ids:[]},in_reply_to:null});assert.deepEqual(privateNote.memory.acquired_by,['hero']);
 const whisper=run(g,s,speak());assert.deepEqual(whisper.memory.acquired_by,['hero','raider']);
 const room=run(g,s,{type:'speak',text:'Room',audience:{kind:'room',addressed_actor_ids:['raider']},in_reply_to:null});assert.deepEqual(room.memory.acquired_by,['hero','companion','raider','watcher']);assert.deepEqual(room.memory.payload.type==='speak'&&room.memory.payload.audience.addressed_actor_ids,['raider']);
 assert.throws(()=>run(g,s,speak('Secret',['remote'])),code('UNAUTHORIZED'));assert.throws(()=>run(g,s,speak('Secret',['missing'])));
 const later=structuredClone(commit(g,s,speak()));actor(later,'companion').hp=0;assert.throws(()=>run(g,later,speak('Hi',['companion'])),code('UNAUTHORIZED'));assert.throws(()=>run(g,later,speak(),'companion'),code('UNAUTHORIZED'));
});
test('NPC replies require acquired addressed inbound, standing/nonbusy/open state and full-history uniqueness',()=>{
 const g=genesis();let s=start(g);assert.throws(()=>run(g,s,speak('Yes',['hero']),'raider'),code('UNAUTHORIZED'));
 s=commit(g,s,speak());const inbound=s.memories[0]!.record_id,reply={type:'speak' as const,text:'Yes',audience:{kind:'whisper' as const,addressed_actor_ids:['hero']},in_reply_to:inbound};
 const busy=commit(g,s,{type:'set_activity',activity:{description:'Working',busy_until:600}},'raider');assert.throws(()=>run(g,busy,reply,'raider'),code('UNAUTHORIZED'));
 s=commit(g,s,reply,'raider');for(let i=0;i<40;i++)s=commit(g,s,{type:'speak',text:'Private',audience:{kind:'self',addressed_actor_ids:[]},in_reply_to:null});assert.throws(()=>run(g,s,reply,'raider'),code('CONFLICT'));
 const heard=commit(g,start(g),{type:'speak',text:'Overheard',audience:{kind:'room',addressed_actor_ids:[]},in_reply_to:null});assert.throws(()=>run(g,heard,{...reply,in_reply_to:heard.memories[0]!.record_id},'raider'),code('UNAUTHORIZED'));
});
test('impressions use previously acquired subject evidence and exact latest own predecessor',()=>{
 const g=genesis();let s=commit(g,start(g),speak('I will help',['hero']),'companion');const evidence=s.memories[0]!.record_id;
 const impression={type:'impress' as const,subject_actor_id:'companion',evidence_ids:[evidence],interpretation:'Helpful',previous_impression_id:null};const r=run(g,s,impression);assert.deepEqual(r.memory.acquired_by,['hero']);assert.equal(r.state.impressions[0]!.impression_id,r.memory.record_id);assert.deepEqual(r.state.impressions[0]!.nature,g.profiles[0]!.nature);
 s=commit(g,s,impression);assert.throws(()=>run(g,s,impression),code('CONFLICT'));assert.throws(()=>run(g,s,{...impression,subject_actor_id:'raider',previous_impression_id:null}),code('UNAUTHORIZED'));assert.throws(()=>run(g,s,impression,'watcher'),code('UNAUTHORIZED'));
 const revised=run(g,s,{...impression,previous_impression_id:s.impressions[0]!.impression_id});assert.equal(revised.state.impressions.length,2);assertWorldContract('State',revised.state,g);
});
test('loan offer and borrower acceptance commit one exact transfer/obligation, retaining borrower provenance',()=>{
 const g=genesis(),s=commit(g,start(g),offer()),r=run(g,s,accept(s),'companion');assert.equal(item(s).owner_id,'hero');assert.equal(item(r.state).owner_id,'companion');assert.equal(r.state.loans.length,1);assert.equal(r.state.offers[0]!.status,'accepted');assert.equal(r.state.cursor.sequence,2);assert.equal(r.state.cursor.world_time,0);assert.equal(r.memory.actor_id,'companion');assert.deepEqual(r.memory.acquired_by,['hero','companion']);assert.equal(r.effects[0]!.actor_id,'hero');assert.equal(r.effects[0]!.kind,'transfer_item');assert.equal(r.state.loans[0]!.loan_id,'lamp_offer');assertWorldContract('Resolution',r,g);
 const returned=run(g,r.state,{type:'return_loan',loan_id:'lamp_offer'},'companion');assert.equal(item(returned.state).owner_id,'hero');assert.equal(returned.state.loans[0]!.status,'returned');assert.equal(returned.state.cursor.world_time,0);
});
test('failed acceptance leaves no promise, custody, time or RNG changes',()=>{
 const g=genesis(),s=commit(g,start(g),offer()),before=canonical(s);
 assert.throws(()=>run(g,s,accept(s),'watcher'),code('UNAUTHORIZED'));assert.throws(()=>run(g,s,{type:'accept_loan',offer_id:'lamp_offer',offer_hash:'f'.repeat(64)},'companion'),code('CONFLICT'));
 const full=structuredClone(s);actor(full,'companion').resources.rations=9;actor(full,'companion').resources.water=2;actor(full,'companion').resources.oil=0;actor(full,'companion').resources.obols=1;actor(full,'companion').resources.ammo=0;
 assert.throws(()=>run(g,full,accept(full),'companion'),code('INVALID_ACTION'));assert.equal(item(full).owner_id,'hero');assert.equal(full.loans.length,0);
 const far=commit(g,s,{type:'mortal',action:{type:'travel',route_id:'road'}},'companion');assert.throws(()=>run(g,far,accept(far),'companion'));
 assert.equal(canonical(s),before);
});
test('offer lifecycle handles exact expiry, permanent IDs, withdrawal, knowledge revocation and custody loss',()=>{
 const g=genesis();let s=commit(g,start(g),offer());
 s=commit(g,s,{type:'set_knowledge',knowledge_id:'lamp_policy',active:false},'host');assert.equal(s.offers[0]!.status,'open');assert.equal(run(g,s,accept(s),'companion').state.loans.length,1);
 assert.throws(()=>run(g,s,offer('other')),code('UNAUTHORIZED'));
 let expired=commit(g,commit(g,start(g),offer()),{type:'mortal',action:{type:'wait',turns:1}},'remote');assert.throws(()=>run(g,expired,accept(expired),'companion'),code('CONFLICT'));
 expired=commit(g,expired,offer('replacement',1200));assert.equal(expired.offers.length,2);assert.throws(()=>run(g,expired,offer('lamp_offer',1200)),code('CONFLICT'));
 const withdrawn=commit(g,commit(g,start(g),offer()),{type:'withdraw_loan_offer',offer_id:'lamp_offer'});assert.throws(()=>run(g,withdrawn,accept(withdrawn),'companion'),code('CONFLICT'));
 let lost=commit(g,commit(g,start(g),offer()),{type:'mortal',action:{type:'transfer_item',item_id:'lamp',to_actor_id:null}});assert.equal(lost.offers[0]!.status,'withdrawn');lost=commit(g,lost,{type:'mortal',action:{type:'pickup',item_id:'lamp'}});assert.throws(()=>run(g,lost,accept(lost),'companion'),code('CONFLICT'));
});
test('borrowed items cannot be reoffered; third-party and recovered custody complete only the original loan',()=>{
 const g=genesis();const extra=structuredClone(g.knowledge_catalog.entries[0]!);extra.knowledge_id='borrower_policy';extra.owner_actor_id='companion';g.knowledge_catalog.entries.push(extra);g.initial_knowledge_ids.push(extra.knowledge_id);
 let s=commit(g,start(g),offer());s=commit(g,s,accept(s),'companion');assert.throws(()=>run(g,s,{...offer('reloan'),type:'offer_loan',policy_id:'borrower_policy',borrower_actor_id:'watcher'} as never,'companion'),code('CONFLICT'));
 s=commit(g,s,{type:'mortal',action:{type:'transfer_item',item_id:'lamp',to_actor_id:'watcher'}},'companion');assert.equal(s.loans[0]!.status,'open');
 const back=run(g,s,{type:'mortal',action:{type:'transfer_item',item_id:'lamp',to_actor_id:'hero'}},'watcher');assert.equal(back.state.loans[0]!.status,'returned');assert.equal(back.memory.payload.type,'loan_returned');assert.deepEqual(back.memory.acquired_by,['hero','companion','watcher']);
 let dropped=commit(g,s,{type:'mortal',action:{type:'transfer_item',item_id:'lamp',to_actor_id:null}},'watcher');dropped=commit(g,dropped,{type:'mortal',action:{type:'pickup',item_id:'lamp'}});assert.equal(dropped.loans[0]!.status,'returned');assert.equal(dropped.memories.at(-1)!.payload.type,'loan_returned');assertWorldContract('State',dropped,g);
});
test('encounter exclusions govern offer/acceptance and shared social events do not reset turn tokens',()=>{
 const g=genesis();let s=commit(g,start(g),offer());s=commit(g,s,{type:'mortal',action:{type:'begin_encounter',encounter_id:'fight',side_a:['hero'],side_b:['raider'],escape_allowed:true}},'host');const token=s.physical.encounter!.turn_started_sequence;
 assert.throws(()=>run(g,s,accept(s),'companion'),code('CONFLICT'));assert.throws(()=>run(g,s,offer('other')),code('CONFLICT'));
 s=commit(g,s,{type:'speak',text:'Remote note',audience:{kind:'self',addressed_actor_ids:[]},in_reply_to:null},'remote');assert.equal(s.physical.encounter!.turn_started_sequence,token);
 s=commit(g,s,{type:'mortal',action:{type:'wait',turns:1}},'remote');assert.equal(s.cursor.world_time,600);assert.equal(actor(s).active_seconds,0);
 s=commit(g,s,{type:'mortal',action:{type:'recover_encounter',encounter_id:'fight',turn_started_sequence:token,resolution:'close',reason:'host_timeout'}},'host');assert.equal(s.cursor.world_time,606);assert.equal(actor(s).active_seconds,6);assert.equal(s.physical.encounter,null);
});
test('knowledge changes and monotone closure retain actual commit provenance without reopening',()=>{
 const g=genesis();let s=start(g);assert.throws(()=>run(g,s,{type:'set_knowledge',knowledge_id:'lamp_policy',active:false},'hero'));
 s=commit(g,s,{type:'set_knowledge',knowledge_id:'lamp_policy',active:false},'host');assert.deepEqual(s.knowledge[0],{knowledge_id:'lamp_policy',origin:'event',sequence:1,world_time:0,active:false});assert.deepEqual(s.memories[0]!.acquired_by,['hero']);
 s=commit(g,s,speak());const inbound=s.memories.at(-1)!.record_id;s=commit(g,s,{type:'close_mythic_engagement'},'host');assert.equal(s.mythic_closed,true);assert.deepEqual(s.memories.at(-1)!.acquired_by,[]);
 assert.throws(()=>run(g,s,{type:'speak',text:'No',audience:{kind:'whisper',addressed_actor_ids:['hero']},in_reply_to:inbound},'raider'),code('UNAUTHORIZED'));
 s=commit(g,s,{type:'speak',text:'I leave',audience:{kind:'self',addressed_actor_ids:[]},in_reply_to:null});s=commit(g,s,{type:'mortal',action:{type:'travel',route_id:'road'}});assert.equal(s.mythic_closed,true);assertWorldContract('State',s,g);
});
test('owned caches never trust caller freezing, aliases, claimed hashes or mutated/foreign genesis',()=>{
 const raw=genesis(),g=ownWorldGenesis(raw),s=initialWorldState(g);assert.notEqual(raw,g);assert.ok(Object.isFrozen(g.profiles[0]!.nature));assert.equal(ownWorldGenesis(g),g);
 const h=worldStateHash(s);const next=commit(g,s,speak());const rebound=withWorldHead(next,'f'.repeat(64));assert.equal(worldStateHash(rebound),worldStateHash(next));assert.equal(rebound.memories,next.memories);
 assert.throws(()=>withWorldHead(Object.freeze(structuredClone(next)),'e'.repeat(64)),code('INVALID_CONTRACT'));
 assert.throws(()=>withWorldHead(next,'e'.repeat(64)+'\n'),code('INVALID_CONTRACT'));
 assert.throws(()=>withWorldHead(s,'e'.repeat(64)),code('INVALID_CONTRACT'));
 const forged=structuredClone(next);forged.physical.actors[0]!.controller_id='evil';assert.throws(()=>run(g,forged,speak()),code('INVALID_CONTRACT'));
 const wrong=structuredClone(raw);wrong.profiles[0]!.nature.description='Other';assert.throws(()=>run(wrong,next,speak()),code('INVALID_CONTRACT'));
 let hits=0;const bad=command(s,speak());Object.defineProperty(bad,'action',{enumerable:true,get(){hits++;throw Error();}});assert.throws(()=>resolveWorld(g,s,bad,principal(g)),code('INVALID_CONTRACT'));assert.equal(hits,0);assert.equal(worldStateHash(s),h);
 const left=commit(g,s,speak('Left')),right=commit(g,s,speak('Right'));assert.equal(left.memories[0]!.payload.type==='speak'&&left.memories[0]!.payload.text,'Left');assert.equal(right.memories[0]!.payload.type==='speak'&&right.memories[0]!.payload.text,'Right');assert.equal(s.memories.length,0);
});

test('lender becoming nonstanding permanently invalidates open offers without distant disclosure',()=>{
 const g=genesis();g.mortal.actors[0]!.hp=1;g.mortal.actors[0]!.resources.rations=0;g.mortal.actors[0]!.resources.water=0;
 let s=commit(g,start(g),offer('lamp_offer',3000));s=commit(g,s,{type:'mortal',action:{type:'travel',route_id:'road'}},'companion');
 s=commit(g,s,{type:'mortal',action:{type:'wait',turns:1}});assert.ok(actor(s).hp<0);assert.equal(s.offers[0]!.status,'withdrawn');assert.equal(s.offers[0]!.closed_sequence,s.cursor.sequence);assert.equal(s.memories.at(-1)!.acquired_by.includes('companion'),false);assert.throws(()=>run(g,s,accept(s),'companion'));
});
test('prior immutable states and forks keep independent reply, acquired-memory and impression indexes',()=>{
 const g=ownWorldGenesis(genesis()),s=commit(g,start(g),speak()),inbound=s.memories[0]!.record_id;
 const reply={type:'speak' as const,text:'Yes',audience:{kind:'whisper' as const,addressed_actor_ids:['hero']},in_reply_to:inbound};
 const left=commit(g,s,reply,'raider','left_reply'),right=commit(g,s,reply,'raider','right_reply');assert.notEqual(left.memories[1]!.record_id,right.memories[1]!.record_id);assert.equal(s.memories.length,1);
 assert.throws(()=>run(g,left,reply,'raider'),code('CONFLICT'));assert.throws(()=>run(g,right,reply,'raider'),code('CONFLICT'));assert.equal(run(g,s,reply,'raider').state.memories.length,2);
 const clone=structuredClone(left);clone.memories[1]!.actor_id='hero';assert.throws(()=>run(g,clone,speak()),code('INVALID_CONTRACT'));assert.throws(()=>run(g,left,reply,'raider'),code('CONFLICT'));
});
test('aggregate encoded-byte bounds reject a warm growth attempt atomically rather than truncating history',()=>{
 const raw=genesis();raw.profiles[0]!.max_speech_characters=2048;const g=ownWorldGenesis(raw),initial=start(g),s=structuredClone(initial),text='🙂'.repeat(2048),limit=16777216;
 let bytes=Buffer.byteLength(JSON.stringify(s));
 // Construct a full schema-valid history just below the wire bound, then cross
 // it through a real transition. This is an untrusted cold input on purpose.
 while(true){const sequence=s.memories.length+1,request_id=`budget_${sequence}`,row={record_id:hash({domain:'shared-world/0.1.0/memory',genesis_hash:s.genesis_hash,request_id,sequence}),request_id,sequence,world_time:0,actor_id:'hero',acquired_by:['hero'],payload:{type:'speak' as const,text,audience:{kind:'self' as const,addressed_actor_ids:[] as []},in_reply_to:null}};const added=Buffer.byteLength(JSON.stringify(row))+1;if(bytes+added>limit-256)break;s.memories.push(row);bytes+=added;}
 s.cursor={sequence:s.memories.length,head:'a'.repeat(64),world_time:0};assertWorldContract('State',s,g);const before=s.memories.length;
 assert.throws(()=>run(g,s,{type:'speak',text,audience:{kind:'self',addressed_actor_ids:[]},in_reply_to:null}),code('INVALID_ACTION'));
 assert.equal(s.memories.length,before);assert.equal(s.cursor.sequence,before);assert.equal(initial.memories.length,0);
});

test('one-record growth also respects the structural node budget on warm owned transitions',()=>{
 const g=ownWorldGenesis(genesis()),s=structuredClone(start(g));
 const count=(value:unknown):number=>value!==null&&typeof value==='object'?1+Object.values(value).reduce<number>((sum,child)=>sum+count(child),0):1;
 let nodes=count(s);
 while(true){const sequence=s.memories.length+1,request_id=`nodes_${sequence}`,row={record_id:hash({domain:'shared-world/0.1.0/memory',genesis_hash:s.genesis_hash,request_id,sequence}),request_id,sequence,world_time:0,actor_id:'hero',acquired_by:['hero'],payload:{type:'speak' as const,text:'x',audience:{kind:'self' as const,addressed_actor_ids:[] as []},in_reply_to:null}};const added=count(row);if(nodes+added>499999)break;s.memories.push(row);nodes+=added;}
 s.cursor={sequence:s.memories.length,head:'a'.repeat(64),world_time:0};assert.ok(Buffer.byteLength(JSON.stringify(s))<16777216);assertWorldContract('State',s,g);
 const before=s.memories.length;assert.throws(()=>run(g,s,{type:'speak',text:'x',audience:{kind:'self',addressed_actor_ids:[]},in_reply_to:null}),code('INVALID_ACTION'));assert.equal(s.memories.length,before);
});
test('an early return elsewhere and lender corpse recovery fulfill the same original obligation',()=>{
 const g=genesis();let s=commit(g,start(g),offer('lamp_offer',3000));s=commit(g,s,accept(s),'companion');s=commit(g,s,{type:'mortal',action:{type:'travel',route_id:'road'}});s=commit(g,s,{type:'mortal',action:{type:'travel',route_id:'road'}},'companion');
 s=commit(g,s,{type:'return_loan',loan_id:'lamp_offer'},'companion');assert.equal(s.loans[0]!.status,'returned');assert.equal(actor(s).location_id,'ruin');assert.equal(item(s).owner_id,'hero');
 const death=genesis();death.mortal.actors[1]!.hp=1;death.mortal.actors[1]!.resources.rations=0;death.mortal.actors[1]!.resources.water=0;
 let gone=commit(death,start(death),offer('lamp_offer',3000));gone=commit(death,gone,accept(gone),'companion');gone=commit(death,gone,{type:'mortal',action:{type:'wait',turns:1}},'companion');assert.ok(actor(gone,'companion').hp<0);
 gone=commit(death,gone,{type:'mortal',action:{type:'loot',item_id:'lamp'}});assert.equal(gone.loans[0]!.status,'returned');assert.deepEqual(gone.memories.at(-1)!.acquired_by,['hero']);const returned=gone.memories.at(-1)!.payload;assert.equal(returned.type==='loan_returned'&&returned.via_mortal,'loot');assertWorldContract('State',gone,death);
});
