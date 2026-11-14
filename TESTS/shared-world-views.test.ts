import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ArgoError,canonical} from '../packages/contracts/src/index.ts';
import {assertWorldContract} from '../packages/contracts/src/shared-world.ts';
import {viewWorldActor} from '../packages/ledger/src/world/view.ts';
import {genesis,principal,query,commit,run,start,speak,offer,accept,actor,item} from './shared-world-rules-helpers.ts';
const code=(c:string)=>(e:unknown)=>e instanceof ArgoError&&e.code===c;
const view=(g:ReturnType<typeof genesis>,s:ReturnType<typeof start>,id='hero')=>viewWorldActor(g,s,query(s,id),principal(g,id));

test('view binds exact full cursor/scope/controller and projects one physical identity and scene',()=>{
 const g=genesis(),s=start(g),v=view(g,s);assertWorldContract('ActorView',v,g);assert.equal(v.query.cursor.head,s.cursor.head);assert.equal(v.physical.self.id,'hero');assert.equal(v.scene.location_id,'harbor');assert.equal(v.scene.environment,'night');assert.equal(v.scene.occupants.some(a=>a.actor_id==='remote'),false);assert.equal('controller_id' in v.physical.self,false);assert.equal('seed' in v,false);assert.equal('offers' in v,false);assert.equal('request_id' in v,false);
 for(const a of v.scene.occupants)assert.deepEqual(Object.keys(a).sort(),['actor_id','condition','name']);
 assert.throws(()=>viewWorldActor(g,s,query(s),{...principal(g),principal_id:'fake'}),code('UNAUTHORIZED'));assert.throws(()=>viewWorldActor(g,s,query(s),principal(g,'companion')),code('UNAUTHORIZED'));assert.throws(()=>viewWorldActor(g,s,query(s),principal(g,'host')),code('UNAUTHORIZED'));
 assert.throws(()=>viewWorldActor(g,s,{...query(s),scope:{...s.scope,branch_id:'wrong'}},principal(g)),code('SCOPE_DENIED'));
 const moved=commit(g,s,{type:'mortal',action:{type:'travel',route_id:'road'}});assert.throws(()=>viewWorldActor(g,moved,query(s),principal(g)),code('CONFLICT'));assert.equal(view(g,moved).scene.location_id,'ruin');assert.equal(view(g,moved).physical.self.active_seconds,600);assert.ok(Object.isFrozen(v.physical.self.resources));
});
test('self-private and whispered knowledge never spreads through later arrival or room membership',()=>{
 const g=genesis();let s=commit(g,start(g),{type:'speak',text:'Private thought',audience:{kind:'self',addressed_actor_ids:[]},in_reply_to:null});s=commit(g,s,speak('Only raider hears'));
 assert.equal(view(g,s,'watcher').memories.length,0);assert.equal(view(g,s,'raider').memories.length,1);assert.equal(view(g,s).memories.length,2);
 s=commit(g,s,{type:'mortal',action:{type:'travel',route_id:'road'}},'remote');assert.equal(view(g,s,'remote').memories.some(r=>r.payload.type==='speak'),false);
 for(const memory of view(g,s).memories){assert.equal('request_id'in memory,false);assert.equal('acquired_by'in memory,false);}
});
test('latest 32 acquired memories retain complete counters and old NPC reply cannot be reset by pagination',()=>{
 const g=genesis();let s=commit(g,start(g),speak());const inbound=s.memories[0]!.record_id;s=commit(g,s,{type:'speak',text:'Understood',audience:{kind:'whisper',addressed_actor_ids:['hero']},in_reply_to:inbound},'raider');
 assert.deepEqual(view(g,s,'raider').replied_to,[inbound]);
 for(let i=0;i<35;i++)s=commit(g,s,{type:'speak',text:`Note ${i}`,audience:{kind:'room',addressed_actor_ids:[]},in_reply_to:null});
 const v=view(g,s,'raider');assert.equal(v.memories.length,32);assert.equal(v.coverage.memory_total,37);assert.equal(v.coverage.complete,false);assert.deepEqual(v.replied_to,[]);assert.equal(v.memories[0]!.sequence,6);
 assert.throws(()=>run(g,s,{type:'speak',text:'Again',audience:{kind:'whisper',addressed_actor_ids:['hero']},in_reply_to:inbound},'raider'),code('CONFLICT'));
});
test('owner-only current knowledge/source pins and private impressions use the same prefix',()=>{
 const g=genesis();let s=commit(g,start(g),speak('I help',['hero']),'companion');const inbound=s.memories[0]!.record_id;
 s=commit(g,s,{type:'impress',subject_actor_id:'companion',evidence_ids:[inbound],interpretation:'Helpful',previous_impression_id:null});let v=view(g,s);assert.equal(v.impressions.length,1);assert.equal(view(g,s,'companion').impressions.length,0);assert.equal(v.knowledge.length,1);assert.equal(v.source_definitions.length,1);assert.equal(view(g,s,'watcher').source_definitions.length,0);
 s=commit(g,s,{type:'impress',subject_actor_id:'companion',evidence_ids:[inbound],interpretation:'Still helpful',previous_impression_id:s.impressions[0]!.impression_id});v=view(g,s);assert.equal(v.coverage.impressions_total,1);assert.equal(v.impressions[0]!.interpretation,'Still helpful');
 s=commit(g,s,{type:'set_knowledge',knowledge_id:'lamp_policy',active:false},'host');v=view(g,s);assert.equal(v.knowledge.length,0);assert.equal(v.source_definitions.length,0);assert.equal(v.memories.at(-1)!.payload.type,'set_knowledge');assert.equal(view(g,s,'watcher').memories.some(r=>r.payload.type==='set_knowledge'),false);
});
test('loan memory stays with parties; distant withdrawal does not reveal live global status',()=>{
 const g=genesis();let s=commit(g,start(g),offer('lamp_offer',1200));assert.equal(view(g,s,'watcher').memories.length,0);assert.equal(view(g,s,'companion').memories[0]!.payload.type,'loan_offered');
 s=commit(g,s,{type:'mortal',action:{type:'travel',route_id:'road'}},'companion');s=commit(g,s,{type:'withdraw_loan_offer',offer_id:'lamp_offer'});const v=view(g,s,'companion');assert.equal(v.memories.some(r=>r.payload.type==='loan_withdrawn'),false);assert.equal('offers'in v,false);assert.equal(view(g,s).memories.at(-1)!.payload.type,'loan_withdrawn');
});
test('third-party return redacts loan/borrower identities and overrides room witness disclosure',()=>{
 const g=genesis();let s=commit(g,start(g),offer('lamp_offer',3000));s=commit(g,s,accept(s),'companion');s=commit(g,s,{type:'mortal',action:{type:'transfer_item',item_id:'lamp',to_actor_id:'watcher'}},'companion');s=commit(g,s,{type:'mortal',action:{type:'travel',route_id:'road'}},'companion');
 s=commit(g,s,{type:'mortal',action:{type:'transfer_item',item_id:'lamp',to_actor_id:'hero'}},'watcher');const memory=s.memories.at(-1)!;assert.deepEqual(memory.acquired_by,['hero','watcher']);assert.equal(view(g,s,'raider').memories.some(r=>r.record_id===memory.record_id),false);assert.equal(view(g,s,'companion').memories.some(r=>r.record_id===memory.record_id),false);
 assert.deepEqual(view(g,s,'watcher').memories.at(-1)!.payload,{type:'custody_returned',item_id:'lamp',from_actor_id:'watcher',to_actor_id:'hero'});assert.equal(view(g,s).memories.at(-1)!.payload.type,'loan_returned');assert.equal(item(s).owner_id,'hero');
});
test('travel records hide both endpoints from departure and arrival witnesses',()=>{
 const g=genesis(),s=commit(g,start(g),{type:'mortal',action:{type:'travel',route_id:'road'}}),record=s.memories[0]!;assert.ok(record.acquired_by.includes('watcher'));assert.ok(record.acquired_by.includes('remote'));
 for(const id of ['hero','watcher','remote']){const r=view(g,s,id).memories[0]!;assert.equal(r.payload.type,'mortal');if(r.payload.type==='mortal')assert.deepEqual(r.payload.location_ids,[]);assert.equal(canonical(r).includes('route_id'),false);}
});
test('closure clears all dialogue context/source definitions and reply markers but preserves physical view',()=>{
 const g=genesis();let s=commit(g,start(g),speak());s=commit(g,s,{type:'close_mythic_engagement'},'host');s=commit(g,s,{type:'speak',text:'Recorded after closure',audience:{kind:'self',addressed_actor_ids:[]},in_reply_to:null});
 for(const id of ['hero','companion','raider']){const v=view(g,s,id);assert.equal(v.mythic_closed,true);assert.deepEqual(v.memories,[]);assert.deepEqual(v.impressions,[]);assert.deepEqual(v.knowledge,[]);assert.deepEqual(v.source_definitions,[]);assert.deepEqual(v.replied_to,[]);assert.equal(v.physical.self.id,id);assert.equal(v.coverage.memory_returned,0);assertWorldContract('ActorView',v,g);}
});
test('scoped queries reject active inputs before getters execute and raw mutable snapshots cannot poison later views',()=>{
 const g=genesis(),s=commit(g,start(g),speak());let hits=0;const q=query(s);Object.defineProperty(q,'cursor',{enumerable:true,get(){hits++;throw Error();}});assert.throws(()=>viewWorldActor(g,s,q,principal(g)),code('INVALID_CONTRACT'));assert.equal(hits,0);
 const bad=structuredClone(s);bad.profiles[0]!.presentation.wants='Forged';assert.throws(()=>view(g,bad),code('INVALID_CONTRACT'));assert.equal(view(g,s).profile.presentation.wants,g.profiles[0]!.presentation.wants);
});

test('legal attack after dialogue uses shared RNG and the same prefix exposes only safe HP conditions',()=>{
 const g=genesis();g.mortal.actors[0]!.abilities.strength=10;g.mortal.actors[2]!.abilities.strength=10;
 let s=commit(g,start(g),speak());s=commit(g,s,{type:'mortal',action:{type:'begin_encounter',encounter_id:'battle',side_a:['hero'],side_b:['raider'],escape_allowed:true}},'host');
 const acting=s.physical.encounter!.order[s.physical.encounter!.turn]!,target=acting==='hero'?'raider':'hero',weapon=acting==='hero'?'spear':'club',action={type:'mortal' as const,action:{type:'attack' as const,target_id:target,weapon_id:weapon}};
 const first=run(g,s,action,acting),again=run(g,s,action,acting);assert.deepEqual(first,again);assert.equal(first.draws[0]!.index,s.physical.rng_counter);assert.equal(first.draws[0]!.purpose,'attack');assert.ok(first.draws.some(d=>d.purpose==='weapon_damage'));assert.ok(actor(first.state,target).hp<actor(s,target).hp);assert.equal(first.state.cursor.sequence,s.cursor.sequence+1);
 const own=view(g,first.state,target);assert.equal(own.query.cursor.sequence,first.state.cursor.sequence);assert.equal(own.physical.self.hp,actor(first.state,target).hp);
 const other=view(g,first.state,'watcher'),seen=other.scene.occupants.find(a=>a.actor_id===target)!;assert.equal(seen.condition,actor(first.state,target).hp>0?'standing':actor(first.state,target).hp===0?'unconscious':'dead');assert.equal('hp'in seen,false);assert.equal('draws'in other,false);assertWorldContract('Resolution',first,g);
});
test('already nonstanding occupants cannot acquire later mechanics while an immediately struck actor retains its transition',()=>{
 const g=genesis();let s=commit(g,start(g),speak());const cold=structuredClone(s);actor(cold,'watcher').hp=-1;actor(cold,'companion').hp=0;
 s=commit(g,cold,{type:'mortal',action:{type:'wait',turns:1}});assert.equal(s.memories.at(-1)!.acquired_by.includes('watcher'),false);assert.equal(s.memories.at(-1)!.acquired_by.includes('companion'),false);
 // The actor standing before its own fatal needs assessment observes that
 // immediate transition, without giving already dead bystanders new memories.
 const dying=genesis();dying.mortal.actors[0]!.hp=1;dying.mortal.actors[0]!.resources.rations=0;dying.mortal.actors[0]!.resources.water=0;
 const death=commit(dying,start(dying),{type:'mortal',action:{type:'wait',turns:1}});assert.ok(actor(death).hp<0);assert.ok(death.memories[0]!.acquired_by.includes('hero'));
});
test('activation records actual acquisition while authored validity independently controls current disclosure',()=>{
 const g=genesis();g.knowledge_catalog.entries[0]!.validity={from_tick:600,until_tick:1200};g.initial_knowledge_ids=[];
 let s=commit(g,start(g),{type:'set_knowledge',knowledge_id:'lamp_policy',active:true},'host');assert.equal(view(g,s).knowledge.length,0);assert.equal(s.knowledge[0]!.sequence,1);assert.equal(s.knowledge[0]!.world_time,0);
 s=commit(g,s,{type:'mortal',action:{type:'wait',turns:1}},'remote');assert.equal(view(g,s).knowledge.length,1);s=commit(g,s,{type:'mortal',action:{type:'wait',turns:1}},'remote');assert.equal(view(g,s).knowledge.length,0);assert.equal(s.knowledge[0]!.sequence,1);
});

test('escaped roster members see their lock without the encounter and foreign private profiles remain absent',()=>{
 const g=genesis();g.profiles[2]!.presentation.wants='RAIDER_PRIVATE_SECRET';let s=commit(g,start(g),{type:'mortal',action:{type:'begin_encounter',encounter_id:'fight',side_a:['hero','companion'],side_b:['raider'],escape_allowed:true}},'host');
 while(s.physical.encounter!.order[s.physical.encounter!.turn]!=='hero'){const id=s.physical.encounter!.order[s.physical.encounter!.turn]!;s=commit(g,s,{type:'mortal',action:{type:'pass'}},id);}
 s=commit(g,s,{type:'mortal',action:{type:'retreat'}});const v=view(g,s);assert.equal(v.physical.encounter,null);assert.deepEqual(v.physical.activity_lock,{encounter_id:'fight',location_id:'harbor',reason:'roster'});assert.equal(canonical(v).includes('RAIDER_PRIVATE_SECRET'),false);assert.equal(view(g,s,'watcher').physical.activity_lock?.reason,'site');assert.equal(view(g,s,'remote').physical.activity_lock,null);
 const e=s.physical.encounter!;s=commit(g,s,{type:'mortal',action:{type:'recover_encounter',encounter_id:e.id,turn_started_sequence:e.turn_started_sequence,resolution:'close',reason:'private_host_reason'}},'host');assert.equal(view(g,s).physical.activity_lock,null);assert.equal(canonical(view(g,s)).includes('private_host_reason'),false);
});
