import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {ArgoError,hash} from '../packages/contracts/src/index.ts';
import {worldGenesis,worldState,worldCommand,worldOffer,worldMemory,worldOfferedState,worldAcceptedState,worldView,worldEvent,worldReceipt} from './shared-world-contract-fixtures.ts';
type Api=typeof import('../packages/contracts/src/shared-world.ts');
async function api():Promise<Api>{
 const result=await import(new URL('../packages/contracts/src/shared-world.ts',import.meta.url).href).catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return {};throw error;});
 assert.equal(typeof result.assertWorldContract,'function','The shared-world contract boundary must exist before runtime');return result;
}
function reject(fn:()=>void){assert.throws(fn,(error:unknown)=>error instanceof ArgoError&&error.code==='INVALID_CONTRACT');}
test('shared genesis validates one mortal roster and rejects cross-profile or duplicated physical authority',async()=>{
 const m:Api=await api();const g=worldGenesis();m.assertWorldGenesis(g);m.assertWorldContract('State',worldState());
 for(const patch of [{version:'mortal-rules/0.3.0'},{actors:g.mortal.actors},{cursor:{sequence:0,head:'a'.repeat(64),world_time:0}}])reject(()=>m.assertWorldGenesis({...g,...patch}));
 const bad=worldGenesis();bad.profiles[0]!.actor_id='missing';reject(()=>m.assertWorldGenesis(bad));
});
test('commands require a complete current cursor and closed actor/audience fields',async()=>{
 const m:Api=await api();const c=worldCommand();m.assertWorldContract('Command',c);
 for(const patch of [{expected:{sequence:0,head:c.expected.head}},{actor_id:null},{causation_id:'f'.repeat(64)},{source_id:'other'},{version:'character-memory/1.0.0'}])reject(()=>m.assertWorldContract('Command',{...c,...patch}));
});
test('genesis rejects mismatched profiles, scenes, identities and unbound authored policies',async()=>{
 const m:Api=await api();
 for(const mutate of [
  (g:any)=>g.profiles.push(g.profiles[0]),(g:any)=>g.profiles.pop(),(g:any)=>{g.profiles[0].presentation.name='Unrelated';},
  (g:any)=>g.scenes.pop(),(g:any)=>{g.scenes[0].location_id='missing';},(g:any)=>{g.mortal.items[0].id='hero';},
  (g:any)=>{g.knowledge_catalog.pack_hash='f'.repeat(64);},(g:any)=>{g.source_manifest.sources[0].document_sha256='f'.repeat(64);},
  (g:any)=>{g.knowledge_catalog.entries[0].owner_actor_id='missing';},(g:any)=>{g.knowledge_catalog.entries[0].subject_item_id='missing';},
  (g:any)=>{g.knowledge_catalog.entries[0].provenance.source_ids=['missing'];},(g:any)=>{g.initial_knowledge_ids=['missing'];},
  (g:any)=>{g.initial_knowledge_ids=['lamp_policy','lamp_policy'];},(g:any)=>{g.knowledge_catalog.entries[0].terms.loan_fee_obols=1;},
  (g:any)=>{g.knowledge_catalog.entries[0].terms.advance_deposit_obols=1;},(g:any)=>{g.knowledge_catalog.entries[0].validity.from_tick=1;},
 ]){const g=worldGenesis();mutate(g);reject(()=>m.assertWorldGenesis(g));}
});
test('every action has a closed structural grammar and referee actions cannot name an actor',async()=>{
 const m:Api=await api();
 const actions=[{type:'mortal',action:{type:'wait',turns:1}},{type:'speak',text:'Hello',audience:{kind:'room',addressed_actor_ids:[]},in_reply_to:null},{type:'impress',subject_actor_id:'companion',evidence_ids:['a'.repeat(64)],interpretation:'They seem patient.',previous_impression_id:null},{type:'set_activity',activity:{description:'Working',busy_until:2}},{type:'offer_loan',offer_id:'loan_offer',policy_id:'lamp_policy',item_id:'lamp',borrower_actor_id:'companion',return_location_id:'harbor',repair_cap_obols:5,expires_at:60},{type:'withdraw_loan_offer',offer_id:'loan_offer'},{type:'accept_loan',offer_id:'loan_offer',offer_hash:'a'.repeat(64)},{type:'return_loan',loan_id:'loan_offer'},{type:'set_knowledge',knowledge_id:'lamp_policy',active:false},{type:'close_mythic_engagement'},{type:'mortal',action:{type:'begin_encounter',encounter_id:'battle',side_a:['hero'],side_b:['raider'],escape_allowed:true}},{type:'mortal',action:{type:'recover_encounter',encounter_id:'battle',turn_started_sequence:1,resolution:'close',reason:'host_timeout'}}];
 for(const action of actions){const referee=['set_knowledge','close_mythic_engagement'].includes(action.type)||action.type==='mortal'&&['begin_encounter','recover_encounter'].includes(action.action!.type);const c={...worldCommand(),actor_id:referee?null:'hero',expected:{...worldCommand().expected,sequence:1},action};m.assertWorldContract('Action',action);m.assertWorldContract('Command',c);reject(()=>m.assertWorldContract('Command',{...c,actor_id:referee?'hero':null}));reject(()=>m.assertWorldContract('Action',{...action,extra:true}));}
});
test('speech distinguishes addressees from witnesses and rejects ambiguous or unbounded input',async()=>{
 const m:Api=await api();const c=worldCommand();
 for(const audience of [{kind:'self',addressed_actor_ids:[]},{kind:'whisper',addressed_actor_ids:['companion']},{kind:'room',addressed_actor_ids:[]},{kind:'room',addressed_actor_ids:['companion']}])m.assertWorldContract('Command',{...c,action:{type:'speak',text:'🙂'.repeat(2048),in_reply_to:null,audience}});
 for(const action of [{type:'speak',text:' ',in_reply_to:null,audience:{kind:'room',addressed_actor_ids:[]}},{type:'speak',text:'a'.repeat(2049),in_reply_to:null,audience:{kind:'room',addressed_actor_ids:[]}},{type:'speak',text:'Hi',in_reply_to:null,audience:{kind:'self',addressed_actor_ids:['hero']}},{type:'speak',text:'Hi',in_reply_to:null,audience:{kind:'whisper',addressed_actor_ids:[]}},{type:'speak',text:'Hi',in_reply_to:null,audience:{kind:'room',addressed_actor_ids:['hero']}}])reject(()=>m.assertWorldContract('Command',{...c,action}));
});
test('loan terms are free and immutable, hash-bound, timed and closed by explicit lifecycle',async()=>{
 const m:Api=await api();const offer=worldOffer();m.assertWorldContract('LoanOffer',offer);m.assertWorldContract('State',worldOfferedState());
 for(const mutate of [(o:any)=>{o.terms.loan_fee_obols=1;},(o:any)=>{o.terms.advance_deposit_obols=1;},(o:any)=>{o.terms.borrower_actor_id=o.terms.lender_actor_id;},(o:any)=>{o.terms.expires_at=0;},(o:any)=>{o.terms.repair_cap_obols=6;},(o:any)=>{o.offer_hash='f'.repeat(64);},(o:any)=>{o.closed_sequence=1;},(o:any)=>{o.status='accepted';}]){const bad=worldOffer();mutate(bad);reject(()=>m.assertWorldContract('LoanOffer',bad));}
 const c=worldCommand({type:'offer_loan',offer_id:'offer',policy_id:'lamp_policy',item_id:'lamp',borrower_actor_id:'hero',return_location_id:'harbor',repair_cap_obols:5,expires_at:60});reject(()=>m.assertWorldContract('Command',c));
});
test('state has one cursor and rejects invented memory identities, recipients and future acquisitions',async()=>{
 const m:Api=await api();const s=worldOfferedState();
 for(const mutate of [(x:any)=>{x.physical.cursor=x.cursor;},(x:any)=>{x.world_time=0;},(x:any)=>{x.physical.actors[0].controller_id='different';},(x:any)=>{x.memories[0].record_id='f'.repeat(64);},(x:any)=>{x.memories[0].acquired_by.push('raider');},(x:any)=>{x.memories[0].acquired_by=['hero'];},(x:any)=>{x.memories[0].world_time=1;},(x:any)=>{x.knowledge[0].sequence=2;},(x:any)=>{x.profiles[0].actor_id='missing';}]){const bad=structuredClone(s);mutate(bad);reject(()=>m.assertWorldContract('State',bad,worldGenesis()));}
 const zero=worldState();zero.physical.actors[0]!.hp=0;m.assertWorldContract('Physical',zero.physical);zero.physical.actors[0]!.hp=-1;m.assertWorldContract('Physical',zero.physical);
});
test('compound loan fulfillment uses only loan participants rather than room witness union',async()=>{
 const m:Api=await api();const record=worldMemory();record.payload={type:'loan_returned',loan_id:'lamp_offer',offer_id:'lamp_offer',item_id:'lamp',lender_actor_id:'hero',borrower_actor_id:'companion',holder_actor_id:'raider',via_mortal:'transfer_item'};record.actor_id='raider';record.acquired_by=['raider','hero'];m.assertWorldContract('Memory',record);
 reject(()=>m.assertWorldContract('Memory',{...record,acquired_by:['raider','hero','outsider']}));
 reject(()=>m.assertWorldContract('Memory',{...record,payload:{...record.payload,terms:worldOffer().terms}}));
});
test('private impression and activity records cannot disclose to the subject or room',async()=>{
 const m:Api=await api();const record=worldMemory();record.acquired_by=['hero'];record.payload={type:'impress',subject_actor_id:'companion',interpretation:'I trust them.',impression_id:record.record_id};m.assertWorldContract('Memory',record);
 reject(()=>m.assertWorldContract('Memory',{...record,acquired_by:['hero','companion']}));
 record.payload={type:'set_activity',activity:{description:'Private work',busy_until:10}};reject(()=>m.assertWorldContract('Memory',{...record,acquired_by:['hero','raider']}));
});
test('actor views bind one reader, own knowledge/inventory, explicit coverage and no raw authority',async()=>{
 const m:Api=await api();const v=worldView();m.assertWorldContract('ActorView',v,worldGenesis());m.assertWorldContract('Query',v.query);
 for(const mutate of [(x:any)=>{x.profile.actor_id='raider';},(x:any)=>{x.physical.self.id='raider';},(x:any)=>{x.physical.items.push(worldGenesis().mortal.items[1]);},(x:any)=>{x.knowledge[0].entry.owner_actor_id='raider';},(x:any)=>{x.knowledge[0].acquisition.active=false;},(x:any)=>{x.source_definitions=[];},(x:any)=>{x.query.cursor.world_time=-1;},(x:any)=>{x.coverage.memory_returned=1;},(x:any)=>{x.loans=[];},(x:any)=>{x.offers=[];},(x:any)=>{x.seed='ab'.repeat(32);},(x:any)=>{x.physical.cursor=x.query.cursor;},(x:any)=>{x.scene.location_id='ruin';}]){const bad=structuredClone(v);mutate(bad);reject(()=>m.assertWorldContract('ActorView',bad,worldGenesis()));}
 const record=worldMemory();reject(()=>m.assertWorldContract('ActorView',{...v,memories:[record]}));
});
test('signed artifacts bind full request identity, one memory and the shared genesis cursor',async()=>{
 const m:Api=await api();const e=worldEvent(),r=worldReceipt();m.assertWorldContract('Event',e,worldGenesis());m.assertWorldContract('Receipt',r);
 for(const mutate of [(x:any)=>{x.principal.scope.branch_id='other';},(x:any)=>{x.principal.actor_id='raider';},(x:any)=>{x.principal.role='npc';},(x:any)=>{x.sequence=2;},(x:any)=>{x.previous_hash='f'.repeat(64);},(x:any)=>{x.memory.actor_id='raider';},(x:any)=>{x.memory.payload.text='Other text';},(x:any)=>{x.memory.record_id='f'.repeat(64);},(x:any)=>{x.world_time=1;},(x:any)=>{x.signature='AA==';}]){const bad=structuredClone(e);mutate(bad);reject(()=>m.assertWorldContract('Event',bad,worldGenesis()));}
 reject(()=>m.assertWorldContract('Receipt',{...r,cursor:{...r.cursor,head:'f'.repeat(64)}}));
});
test('passive boundaries reject active values without evaluating getters or proxy traps',async()=>{
 const m:Api=await api();let hits=0;const g=worldGenesis();Object.defineProperty(g,'mortal',{enumerable:true,get(){hits++;throw Error('active');}});
 reject(()=>m.assertWorldGenesis(g));const proxy=new Proxy(worldGenesis(),{ownKeys(){hits++;throw Error('active');}});reject(()=>m.assertWorldGenesis(proxy));
 const revoked=Proxy.revocable(worldState(),{});revoked.revoke();reject(()=>m.assertWorldContract('State',revoked.proxy));
 for(const value of [{[Symbol('hidden')]:1},Object.assign(Object.create({hidden:true}),{visible:true}),{x:-0},{x:undefined},new Date(),[,,],Object.assign([1],{extra:2})])reject(()=>m.assertWorldData(value));
 const cycle:any={};cycle.self=cycle;reject(()=>m.assertWorldData(cycle));assert.equal(hits,0);
 const s=worldState(),bytes=JSON.stringify(s);m.assertWorldContract('State',s);assert.equal(JSON.stringify(s),bytes);assert.equal(Object.isFrozen(s),false);assert.ok(Object.isFrozen(m.worldSchema));
});

test('persisted social records cannot become orphaned or contradict their current rows',async()=>{
 const m:Api=await api();const offered=worldOfferedState(),accepted=worldAcceptedState();m.assertWorldContract('State',accepted,worldGenesis());
 reject(()=>m.assertWorldContract('State',{...offered,offers:[]}));
 const wrong=structuredClone(accepted);if(wrong.memories[1]!.payload.type==='loan_accepted')wrong.memories[1]!.payload.item_id='sword';reject(()=>m.assertWorldContract('State',wrong));
 const missingReturn=structuredClone(accepted);missingReturn.loans[0]!.status='returned';missingReturn.loans[0]!.returned_sequence=3;missingReturn.cursor.sequence=3;
 const record={...worldMemory(),request_id:'request_3',sequence:3};record.record_id=hash({domain:'shared-world/0.1.0/memory',genesis_hash:accepted.genesis_hash,request_id:record.request_id,sequence:3});missingReturn.memories.push(record);reject(()=>m.assertWorldContract('State',missingReturn));
 const revoked=worldState();const revocation=worldMemory();revocation.actor_id=null;revocation.acquired_by=['hero'];revocation.payload={type:'set_knowledge',knowledge_id:'lamp_policy',owner_actor_id:'hero',active:false};revoked.cursor={sequence:1,head:'a'.repeat(64),world_time:0};revoked.memories.push(revocation);reject(()=>m.assertWorldContract('State',revoked));
});
test('travel hides both endpoints and third-party return holders receive only their custody facts',async()=>{
 const m:Api=await api();const record=worldMemory();record.payload={type:'mortal',action:'travel',actor_ids:['hero'],item_ids:[],location_ids:[]};m.assertWorldContract('Memory',record);
 reject(()=>m.assertWorldContract('Memory',{...record,payload:{...record.payload,location_ids:['harbor']}}));
 const view=worldView();view.query.cursor={sequence:1,head:'a'.repeat(64),world_time:0};view.coverage={memory_total:1,memory_returned:1,impressions_total:0,impressions_returned:0,complete:true};
 view.memories=[{record_id:record.record_id,sequence:1,world_time:0,actor_id:'hero',payload:{type:'custody_returned',item_id:'lamp',from_actor_id:'hero',to_actor_id:'companion'}}];m.assertWorldContract('ActorView',view);
 reject(()=>m.assertWorldContract('ActorView',{...view,memories:[{...view.memories[0],request_id:'private_request'}]}));
 reject(()=>m.assertWorldContract('ActorView',{...view,memories:[{...view.memories[0],acquired_by:['hero','companion']}]}));
 reject(()=>m.assertWorldContract('ActorView',{...view,memories:[{...view.memories[0],payload:{type:'loan_returned',loan_id:'private_loan',offer_id:'private_offer',item_id:'lamp',lender_actor_id:'companion',borrower_actor_id:'raider',holder_actor_id:'hero',via_mortal:null}}]}));
});
test('genesis-bound projections preserve physical and private authored identity',async()=>{
 const m:Api=await api();const g=worldGenesis();
 for(const mutate of [(s:any)=>{s.physical.opportunities[0].location_id='missing';},(s:any)=>{s.physical.stocks[0].price++;}]){const s=worldOfferedState();mutate(s);reject(()=>m.assertWorldContract('State',s,g));}
 for(const mutate of [(v:any)=>{v.profile.presentation.wants='Forged policy';},(v:any)=>{v.physical.self.name='Impostor';},(v:any)=>{v.physical.routes[0].requires_light=!v.physical.routes[0].requires_light;}]){const v=worldView();mutate(v);reject(()=>m.assertWorldContract('ActorView',v,g));}
 reject(()=>m.assertWorldContract('Command',{...worldCommand(),actor_id:'missing'},g));
});

test('request identities use one closed domain and bind complete command and principal data',async()=>{
 const m:Api=await api();const e=worldEvent();assert.equal(typeof m.worldRequestHash,'function');
 assert.equal(m.worldRequestHash(e.command,e.principal),hash({domain:'shared-world/0.1.0/request',command:e.command,principal:e.principal}));
 assert.notEqual(m.worldRequestHash(e.command,{...e.principal,principal_id:'another_controller'}),m.worldRequestHash(e.command,e.principal));
 reject(()=>m.worldRequestHash({...e.command,source_actor_id:'raider'},e.principal));
 reject(()=>m.worldRequestHash(e.command,{...e.principal,actor_id:'raider'}));
 reject(()=>m.worldRequestHash(e.command,{...e.principal,scope:{...e.principal.scope,branch_id:'other'}}));
});
test('NPC replies consume addressed acquired inbound IDs across the full memory history',async()=>{
 const m:Api=await api();const s=worldState(),inbound=worldMemory();
 const reply={...inbound,request_id:'reply_1',sequence:2,actor_id:'raider',payload:{type:'speak' as const,text:'Yes.',audience:{kind:'whisper' as const,addressed_actor_ids:['hero']},in_reply_to:inbound.record_id}};
 reply.record_id=hash({domain:'shared-world/0.1.0/memory',genesis_hash:s.genesis_hash,request_id:reply.request_id,sequence:reply.sequence});s.memories=[inbound,reply];s.cursor={sequence:2,head:'a'.repeat(64),world_time:0};m.assertWorldContract('State',s);
 const repeated={...reply,request_id:'reply_2',sequence:3};repeated.record_id=hash({domain:'shared-world/0.1.0/memory',genesis_hash:s.genesis_hash,request_id:repeated.request_id,sequence:repeated.sequence});s.memories.push(repeated);s.cursor.sequence=3;reject(()=>m.assertWorldContract('State',s));
 const v=worldView();v.replied_to=[inbound.record_id];reject(()=>m.assertWorldContract('ActorView',v));
});
test('passive argument and projection budgets refuse excess without changing input',async()=>{
 const m:Api=await api();reject(()=>m.assertWorldData('🙂'.repeat(4194305)));const v=worldView();v.memories=Array.from({length:33},()=>({record_id:'a'.repeat(64),sequence:1,world_time:0,actor_id:'hero',payload:{type:'set_activity',activity:v.profile.activity}}));reject(()=>m.assertWorldContract('ActorView',v));
});
test('passive byte limits include JSON escaping, quotes, keys and container punctuation',async()=>{
 const m:Api=await api();m.assertWorldData('a'.repeat(16777214));
 reject(()=>m.assertWorldData('a'.repeat(16777215)));
 reject(()=>m.assertWorldData('\u0000'.repeat(2796203)));
 reject(()=>m.assertWorldData({x:'a'.repeat(16777209)}));
});
test('the freeze candidate pins exactly the new contract schema and type/guard bytes',async()=>{
 const file=await readFile(new URL('../SYSTEMS/shared-world-v1/FREEZE.json',import.meta.url),'utf8').catch(error=>{if(error.code==='ENOENT')return null;throw error;});assert.notEqual(file,null);
 const freeze=JSON.parse(file!) as {profile_version:string;files:Record<string,string>};assert.equal(freeze.profile_version,'shared-world/0.1.0');
 assert.deepEqual(Object.keys(freeze.files).sort(),['SYSTEMS/shared-world-v1/CONTRACT.md','SYSTEMS/shared-world-v1/world.schema.json','packages/contracts/src/shared-world-types.ts','packages/contracts/src/shared-world.ts']);
 for(const [path,digest] of Object.entries(freeze.files))assert.equal(createHash('sha256').update(await readFile(new URL('../'+path,import.meta.url))).digest('hex'),digest);
});
