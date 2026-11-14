/** Pure shared authority. Only owned immutable identities enter the private caches. */
import {Buffer} from 'node:buffer';
import {assertWorldContract,assertWorldGenesis} from '../../../../contracts/src/shared-world.ts';
import {canonical,hash,fail} from '../../../../contracts/src/index.ts';
import {WORLD_PROFILE} from '../../../../contracts/src/shared-world-types.ts';
import type {WorldGenesis,WorldState,WorldCommand,WorldPrincipal,WorldResolution,WorldMemory,WorldMemoryPayload,WorldImpression,WorldLoanOffer,WorldLoan,WorldPhysical,WorldAction} from '../../../../contracts/src/shared-world-types.ts';
import type {MortalV3Action,MortalV3State,MortalV3Resolution} from '../../../../contracts/src/mortal-v3-types.ts';
import {initialMortalV3State,resolveMortalV3} from '../../mortal-v3/rules.ts';

const MAX_BYTES=16777216,MAX_NODES=500000,MAX_DEPTH=32;
type Size={bytes:number;nodes:number;depth:number};
type GenesisMeta={identity:string;mortalHash:string};
type LoanIndex={offers:Map<string,WorldLoanOffer>;openOffers:Map<string,WorldLoanOffer[]>;loans:Map<string,WorldLoan>;openLoans:Map<string,WorldLoan>};
type Index=LoanIndex&{records:Map<string,WorldMemory>;requests:Set<string>;replies:Set<string>;acquired:Map<string,readonly WorldMemory[]>;latest:Map<string,ReadonlyMap<string,WorldImpression>>};
type StateMeta={genesis:WorldGenesis;identity:string;index:Index;hash?:string};
const genesisCache=new WeakMap<WorldGenesis,GenesisMeta>(),stateCache=new WeakMap<WorldState,StateMeta>();
const sizes=new WeakMap<object,Size>();
const copy=<T>(value:T):T=>JSON.parse(canonical(value)) as T;
const encoded=(value:unknown)=>Buffer.byteLength(JSON.stringify(value));
/** Called only on detached validated DTOs or locally constructed data. Reuses
 * exact owned subtrees; Object.isFrozen supplied by a caller is never a brand. */
function own<T>(value:T):T{
 if(value===null||typeof value!=='object')return value;
 if(sizes.has(value))return value;
 const entries=Array.isArray(value)?value:Object.values(value);for(const child of entries)own(child);
 Object.freeze(value);measure(value);return value;
}
function measure(value:unknown):Size{
 if(value===null||typeof value!=='object')return {bytes:encoded(value),nodes:1,depth:0};
 const cached=sizes.get(value);if(cached)return cached;
 const array=Array.isArray(value),entries=Object.entries(value);let bytes=2+Math.max(0,entries.length-1),nodes=1,depth=0;
 for(const [key,child] of entries){const size=measure(child);bytes+=size.bytes+(array?0:encoded(key)+1);nodes+=size.nodes;depth=Math.max(depth,size.depth+1);}
 const size={bytes,nodes,depth};if(Object.isFrozen(value))sizes.set(value,size);return size;
}
function budget(value:unknown,reserve=0):void{const size=measure(value);if(size.bytes+reserve>MAX_BYTES||size.nodes>MAX_NODES||size.depth>MAX_DEPTH)fail('INVALID_ACTION','Shared world aggregate capacity reached');}
export function ownWorldGenesis(input:WorldGenesis):WorldGenesis{
 if(genesisCache.has(input))return input;
 assertWorldGenesis(input);const genesis=own(copy(input));genesisCache.set(genesis,{identity:hash(genesis),mortalHash:hash(genesis.mortal)});return genesis;
}
function loanIndexes(state:WorldState):LoanIndex{
 const offers=new Map(state.offers.map(o=>[o.terms.offer_id,o])),loans=new Map(state.loans.map(l=>[l.loan_id,l])),openLoans=new Map(state.loans.filter(l=>l.status==='open').map(l=>[l.item_id,l])),openOffers=new Map<string,WorldLoanOffer[]>();
 for(const offer of state.offers)if(offer.status==='open'){const rows=openOffers.get(offer.terms.item_id)??[];rows.push(offer);openOffers.set(offer.terms.item_id,rows);}
 return {offers,openOffers,loans,openLoans};
}
function indexes(state:WorldState):Index{
 const records=new Map<string,WorldMemory>(),requests=new Set<string>(),replies=new Set<string>(),acquired=new Map<string,WorldMemory[]>(),latest=new Map<string,Map<string,WorldImpression>>();
 for(const row of state.memories){records.set(row.record_id,row);requests.add(row.request_id);if(row.payload.type==='speak'&&row.payload.in_reply_to!==null)replies.add(`${row.actor_id}:${row.payload.in_reply_to}`);for(const id of row.acquired_by){const list=acquired.get(id)??[];list.push(row);acquired.set(id,list);}}
 for(const row of state.impressions){const map=latest.get(row.owner_actor_id)??new Map();map.set(row.subject_actor_id,row);latest.set(row.owner_actor_id,map);}
 for(const list of acquired.values())Object.freeze(list);return {records,requests,replies,acquired,latest,...loanIndexes(state)};
}
function extendIndex(prior:Index,before:WorldState,after:WorldState,memory:WorldMemory,impression?:WorldImpression):Index{
 const records=new Map(prior.records);records.set(memory.record_id,memory);const requests=new Set(prior.requests);requests.add(memory.request_id);
 let replies=prior.replies;if(memory.payload.type==='speak'&&memory.payload.in_reply_to!==null){replies=new Set(replies);replies.add(`${memory.actor_id}:${memory.payload.in_reply_to}`);}
 const acquired=new Map(prior.acquired);for(const id of memory.acquired_by)acquired.set(id,Object.freeze([...(acquired.get(id)??[]),memory]));
 let latest=prior.latest;if(impression){latest=new Map(latest);const rows=new Map(latest.get(impression.owner_actor_id));rows.set(impression.subject_actor_id,impression);latest.set(impression.owner_actor_id,rows);}
 const loans=before.offers===after.offers&&before.loans===after.loans?prior:loanIndexes(after);
 return {records,requests,replies,acquired,latest,offers:loans.offers,openOffers:loans.openOffers,loans:loans.loans,openLoans:loans.openLoans};
}
function boundState(g:WorldGenesis,input:WorldState):WorldState{
 const identity=genesisCache.get(g)!.identity,cached=stateCache.get(input);
 if(cached){if(cached.identity!==identity)fail('INVALID_CONTRACT','Shared state belongs to another genesis');return input;}
 assertWorldContract('State',input,g);const state=own(copy(input));budget(state,64);
 stateCache.set(state,{genesis:g,identity,index:indexes(state)});return state;
}
export function initialWorldState(input:WorldGenesis):WorldState{
 const g=ownWorldGenesis(input),identity=genesisCache.get(g)!.identity,m=initialMortalV3State(g.mortal);
 const state:WorldState={version:WORLD_PROFILE,scope:copy(g.mortal.scope),genesis_hash:identity,cursor:{sequence:0,head:identity,world_time:0},physical:physicalPayload(m),profiles:copy(g.profiles),memories:[],impressions:[],knowledge:g.initial_knowledge_ids.map(knowledge_id=>({knowledge_id,origin:'genesis',sequence:0,world_time:0,active:true})),offers:[],loans:[],mythic_closed:false};
 assertWorldContract('State',state,g);own(state);budget(state,64);stateCache.set(state,{genesis:g,identity,index:indexes(state)});return state;
}
export function worldStateHash(state:WorldState):string{
 const cached=stateCache.get(state);if(cached?.hash)return cached.hash;if(!cached)assertWorldContract('State',state);
 const {head:_,...cursor}=state.cursor;const digest=hash({domain:'shared-world/0.1.0/state',state:{...state,cursor}});if(cached)cached.hash=digest;return digest;
}
/** Journal-only head finalization; unregistered objects cannot confer trust. */
export function withWorldHead(state:WorldState,head:string):WorldState{
 const meta=stateCache.get(state);if(!meta)fail('INVALID_CONTRACT','Head finalization requires an owned shared state');
 if(typeof head!=='string'||head.length!==64||!/^[0-9a-f]{64}$/.test(head)||state.cursor.sequence===0&&head!==meta.identity)fail('INVALID_CONTRACT','Invalid shared event head');
 const digest=worldStateHash(state),next=own({...state,cursor:{...state.cursor,head}});budget(next,64);stateCache.set(next,{...meta,hash:digest});return next;
}
/** Read-only private interface: no mutable cache/index object escapes. */
export function readWorld(inputGenesis:WorldGenesis,inputState:WorldState){
 const genesis=ownWorldGenesis(inputGenesis),state=boundState(genesis,inputState),meta=stateCache.get(state)!;
 return Object.freeze({genesis,state,acquired:(id:string)=>meta.index.acquired.get(id)??Object.freeze([] as WorldMemory[]),latest:(id:string)=>Object.freeze([...(meta.index.latest.get(id)?.values()??[])]),replied:(id:string,record:string)=>meta.index.replies.has(`${id}:${record}`)});
}
function physicalPayload(s:MortalV3State):WorldPhysical{return {actors:s.actors,items:s.items,opportunities:s.opportunities,stocks:s.stocks,encounter:s.encounter,rng_counter:s.rng_counter};}
export function mortalProjection(g:WorldGenesis,s:WorldState):MortalV3State{
 const identity=genesisCache.get(g)?.mortalHash??hash(g.mortal);
 return {version:'mortal-rules/0.3.0',scope:s.scope,genesis_hash:identity,sequence:s.cursor.sequence,head:s.cursor.sequence===0?identity:s.cursor.head,world_time:s.cursor.world_time,...s.physical};
}
const findActor=(s:WorldState,id:string)=>{const a=s.physical.actors.find(a=>a.id===id);if(!a)fail('INVALID_ACTION','Unknown world actor');return a;};
const standing=(s:WorldState,id:string)=>{const a=findActor(s,id);if(a.hp<=0)fail('UNAUTHORIZED','World action requires a standing actor');return a;};
const ordered=(s:WorldState,ids:Iterable<string>)=>{const set=new Set(ids);return s.physical.actors.filter(a=>set.has(a.id)).map(a=>a.id);};
const present=(s:WorldState,id:string,location:string)=>{const a=findActor(s,id);return a.hp>0&&a.location_id===location;};
const isReferee=(action:WorldAction)=>action.type==='set_knowledge'||action.type==='close_mythic_engagement'||action.type==='mortal'&&['begin_encounter','recover_encounter'].includes(action.action.type);
function authorize(g:WorldGenesis,s:WorldState,c:WorldCommand,p:WorldPrincipal):void{
 if(canonical(c.scope)!==canonical(g.mortal.scope)||canonical(p.scope)!==canonical(g.mortal.scope))fail('SCOPE_DENIED','World command scope differs');
 if(canonical(c.expected)!==canonical(s.cursor)||c.causation_id!==s.cursor.head)fail('CONFLICT','Stale shared cursor');
 if(isReferee(c.action)){
  if(p.role!=='referee'||p.actor_id!==null||c.actor_id!==null||p.principal_id!==g.mortal.referee_id)fail('UNAUTHORIZED','Configured world referee required');
 }else{
  if(p.role==='referee'||p.actor_id!==c.actor_id||c.actor_id===null)fail('UNAUTHORIZED','Direct world actor required');
  const a=findActor(s,c.actor_id);if(a.controller_id!==p.principal_id||a.kind!==p.role)fail('UNAUTHORIZED','World actor controller differs');
  if(c.action.type!=='mortal')standing(s,a.id);
 }
}
function mechanical(g:WorldGenesis,s:WorldState,action:MortalV3Action,id:string|null,p:WorldPrincipal,request:string):MortalV3Resolution{
 const input=mortalProjection(g,s);return resolveMortalV3(g.mortal,input,{version:'mortal-rules/0.3.0',scope:s.scope,request_id:request,actor_id:id,expected:{sequence:input.sequence,head:input.head},causation_id:input.head,action},p);
}
function transfer(g:WorldGenesis,s:WorldState,itemId:string,from:string,to:string,request:string):MortalV3Resolution{
 const a=standing(s,from),recipient=standing(s,to);if(a.location_id!==recipient.location_id)fail('UNAUTHORIZED','Loan parties must be standing and colocated');
 return mechanical(g,s,{type:'transfer_item',item_id:itemId,to_actor_id:to},from,{scope:s.scope,principal_id:a.controller_id,role:a.kind,actor_id:a.id},request);
}
function mortalMemory(before:WorldState,after:WorldState,action:MortalV3Action,actorId:string|null):{payload:WorldMemoryPayload;recipients:string[]}{
 const ids=new Set<string>(),items=new Set<string>(),locations=new Set<string>();
 if(actorId!==null)ids.add(actorId);
 switch(action.type){
 case 'begin_encounter':for(const id of [...action.side_a,...action.side_b])ids.add(id);break;
 case 'recover_encounter':for(const id of before.physical.encounter!.order)ids.add(id);break;
 case 'attack':ids.add(action.target_id);items.add(action.weapon_id);break;
 case 'give':ids.add(action.to_actor_id);break;
 case 'transfer_item':items.add(action.item_id);if(action.to_actor_id!==null)ids.add(action.to_actor_id);break;
 case 'pickup':case 'loot':case 'equip':items.add(action.item_id);break;
 }
 // Physical admission already proves that referenced direct participants are
 // local. Only standing before/after observers acquire this transition; actors
 // nonstanding throughout cannot observe later actions merely by being named.
 for(const id of ids){locations.add(findActor(before,id).location_id);locations.add(findActor(after,id).location_id);}
 const recipients=before.physical.actors.filter(a=>{
  const current=findActor(after,a.id);
  return a.hp>0&&locations.has(a.location_id)||current.hp>0&&locations.has(current.location_id);
 }).map(a=>a.id);
 return {payload:{type:'mortal',action:action.type,actor_ids:ordered(before,ids),item_ids:[...items],location_ids:action.type==='travel'?[]:[...locations]},recipients};
}
function loanReturn(s:WorldState,loan:WorldLoan,holder:string,via:'transfer_item'|'pickup'|'loot'|null):{payload:WorldMemoryPayload;recipients:string[]}{
 const location=findActor(s,loan.lender_actor_id).location_id,ids=[holder,loan.lender_actor_id];if(present(s,loan.borrower_actor_id,location))ids.push(loan.borrower_actor_id);
 return {payload:{type:'loan_returned',loan_id:loan.loan_id,offer_id:loan.offer_id,item_id:loan.item_id,lender_actor_id:loan.lender_actor_id,borrower_actor_id:loan.borrower_actor_id,holder_actor_id:holder,via_mortal:via},recipients:ordered(s,ids)};
}
export function resolveWorld(inputGenesis:WorldGenesis,inputState:WorldState,inputCommand:WorldCommand,inputPrincipal:WorldPrincipal):WorldResolution{
 const g=ownWorldGenesis(inputGenesis),s=boundState(g,inputState),meta=stateCache.get(s)!;
 assertWorldContract('Command',inputCommand,g);assertWorldContract('Principal',inputPrincipal);const command=copy(inputCommand),principal=copy(inputPrincipal);
 authorize(g,s,command,principal);if(meta.index.requests.has(command.request_id))fail('CONFLICT','World request ID already exists');
 if(s.cursor.sequence>=1000000)fail('INVALID_ACTION','Shared history limit reached');
 const action=command.action,id=command.actor_id,sequence=s.cursor.sequence+1,recordId=hash({domain:'shared-world/0.1.0/memory',genesis_hash:s.genesis_hash,request_id:command.request_id,sequence});
 let next:WorldState={...s,cursor:{...s.cursor,sequence}},payload:WorldMemoryPayload,recipients:string[]=[],draws:WorldResolution['draws']=[],effects:WorldResolution['effects']=[],formed:WorldImpression|undefined;
 const applyMechanical=(r:MortalV3Resolution)=>{if(r.state.sequence!==sequence||r.state.world_time<s.cursor.world_time)fail('CORRUPT_LEDGER','Mortal projection advanced outside shared cursor');next={...next,physical:physicalPayload(r.state),cursor:{...next.cursor,world_time:r.state.world_time}};draws=r.draws;effects=r.effects;};
 switch(action.type){
 case 'speak':{
  const actor=standing(s,id!),profile=s.profiles.find(p=>p.actor_id===id)!;
  if([...action.text].length>profile.max_speech_characters)fail('INVALID_ACTION','Speech exceeds actor policy');
  for(const to of action.audience.addressed_actor_ids)if(!present(s,to,actor.location_id))fail('UNAUTHORIZED','Speech recipient must be standing and present');
  if(action.in_reply_to!==null){const inbound=meta.index.records.get(action.in_reply_to);if(!inbound||inbound.payload.type!=='speak'||inbound.actor_id===id||!inbound.acquired_by.includes(id!))fail('UNAUTHORIZED','Reply requires acquired inbound speech');
   if(actor.kind==='npc'){if(!(inbound.payload.audience.addressed_actor_ids as readonly string[]).includes(id!))fail('UNAUTHORIZED','NPC reply requires explicit addressing');if(meta.index.replies.has(`${id}:${action.in_reply_to}`))fail('CONFLICT','NPC already replied to this inbound record');}
  }
  if(actor.kind==='npc'&&(action.in_reply_to===null||profile.activity.busy_until>s.cursor.world_time||s.mythic_closed))fail('UNAUTHORIZED','NPC engagement is unavailable');
  recipients=action.audience.kind==='room'?s.physical.actors.filter(a=>a.hp>0&&a.location_id===actor.location_id).map(a=>a.id):ordered(s,[id!,...action.audience.addressed_actor_ids]);payload=action;break;
 }
 case 'impress':{
  for(const evidenceId of action.evidence_ids){const row=meta.index.records.get(evidenceId);if(!row||row.actor_id!==action.subject_actor_id||!row.acquired_by.includes(id!))fail('UNAUTHORIZED','Impression evidence must be acquired about its subject');}
  const previous=meta.index.latest.get(id!)?.get(action.subject_actor_id);if(action.previous_impression_id!==(previous?.impression_id??null))fail('CONFLICT','Impression predecessor is not current');
  const profile=s.profiles.find(p=>p.actor_id===id)!;
  formed={impression_id:recordId,owner_actor_id:id!,subject_actor_id:action.subject_actor_id,evidence_ids:action.evidence_ids,sequence,world_time:s.cursor.world_time,nature_revision:profile.revision,nature:profile.nature,interpretation:action.interpretation,previous_impression_id:action.previous_impression_id};
  assertWorldContract('Impression',formed,g);next.impressions=[...s.impressions,formed];payload={type:'impress',subject_actor_id:action.subject_actor_id,interpretation:action.interpretation,impression_id:recordId};recipients=[id!];break;
 }
 case 'set_activity':next.profiles=s.profiles.map(p=>p.actor_id===id?{...p,activity:action.activity}:p);payload=action;recipients=[id!];break;
 case 'offer_loan':{
  if(meta.index.offers.has(action.offer_id))fail('CONFLICT','Offer ID is permanently allocated');
  const policy=g.knowledge_catalog.entries.find(e=>e.knowledge_id===action.policy_id)!;const acquired=s.knowledge.find(k=>k.knowledge_id===action.policy_id);
  if(!acquired?.active||policy.validity.from_tick>s.cursor.world_time||policy.validity.until_tick!==null&&policy.validity.until_tick<=s.cursor.world_time)fail('UNAUTHORIZED','Loan policy is unavailable');
  if(meta.index.openLoans.has(action.item_id)||meta.index.openOffers.get(action.item_id)?.some(o=>o.terms.expires_at>s.cursor.world_time))fail('CONFLICT','Item already has a live loan or offer');
  // Preview only: the exact same mortal transfer checks apply at acceptance.
  transfer(g,s,action.item_id,id!,action.borrower_actor_id,command.request_id);
  const terms={genesis_hash:s.genesis_hash,offer_id:action.offer_id,policy_id:action.policy_id,item_id:action.item_id,lender_actor_id:id!,borrower_actor_id:action.borrower_actor_id,return_location_id:action.return_location_id,loan_fee_obols:0 as const,advance_deposit_obols:0 as const,repair_basis:'actual_damage_by_explicit_agreement' as const,repair_cap_obols:action.repair_cap_obols,oil_supplied_by:'borrower' as const,expires_at:action.expires_at,issued_sequence:sequence,issued_at:s.cursor.world_time};
  const offered:WorldLoanOffer={terms,offer_hash:hash({domain:'shared-world/0.1.0/loan-offer',terms}),status:'open',closed_sequence:null};assertWorldContract('LoanOffer',offered,g);next.offers=[...s.offers,offered];payload={type:'loan_offered',terms,offer_hash:offered.offer_hash};recipients=ordered(s,[id!,action.borrower_actor_id]);break;
 }
 case 'withdraw_loan_offer':{
  const offer=meta.index.offers.get(action.offer_id);if(!offer||offer.terms.lender_actor_id!==id)fail('UNAUTHORIZED','Only issuer can withdraw an offer');if(offer.status!=='open')fail('CONFLICT','Offer is already closed');
  next.offers=s.offers.map(o=>o===offer?{...o,status:'withdrawn',closed_sequence:sequence}:o);payload={type:'loan_withdrawn',offer_id:offer.terms.offer_id,lender_actor_id:id!,borrower_actor_id:offer.terms.borrower_actor_id};recipients=ordered(s,[id!,...(present(s,offer.terms.borrower_actor_id,findActor(s,id!).location_id)?[offer.terms.borrower_actor_id]:[])]);break;
 }
 case 'accept_loan':{
  const offer=meta.index.offers.get(action.offer_id);if(!offer||offer.offer_hash!==action.offer_hash||offer.status!=='open'||offer.terms.expires_at<=s.cursor.world_time)fail('CONFLICT','Loan offer is not current');
  const t=offer.terms;if(t.borrower_actor_id!==id)fail('UNAUTHORIZED','Only named borrower can accept');
  // This capability is derived only from the exact durable offer. The outer
  // command/principal and memory remain the borrower, never the lender.
  applyMechanical(transfer(g,s,t.item_id,t.lender_actor_id,t.borrower_actor_id,command.request_id));
  next.offers=s.offers.map(o=>o===offer?{...o,status:'accepted',closed_sequence:sequence}:o);
  const loan:WorldLoan={loan_id:t.offer_id,offer_id:t.offer_id,offer_hash:offer.offer_hash,item_id:t.item_id,lender_actor_id:t.lender_actor_id,borrower_actor_id:t.borrower_actor_id,accepted_sequence:sequence,accepted_at:s.cursor.world_time,status:'open',returned_sequence:null};next.loans=[...s.loans,loan];
  payload={type:'loan_accepted',loan_id:loan.loan_id,offer_id:loan.offer_id,offer_hash:loan.offer_hash,item_id:loan.item_id,lender_actor_id:loan.lender_actor_id,borrower_actor_id:loan.borrower_actor_id};recipients=ordered(s,[t.lender_actor_id,t.borrower_actor_id]);break;
 }
 case 'return_loan':{
  const loan=meta.index.loans.get(action.loan_id);if(!loan||loan.status!=='open')fail('CONFLICT','Loan is not open');
  applyMechanical(transfer(g,s,loan.item_id,id!,loan.lender_actor_id,command.request_id));next.loans=s.loans.map(l=>l===loan?{...l,status:'returned',returned_sequence:sequence}:l);({payload,recipients}=loanReturn(s,loan,id!,null));break;
 }
 case 'mortal':{
  applyMechanical(mechanical(g,s,action.action,id,principal,command.request_id));({payload,recipients}=mortalMemory(s,next,action.action,id));
  if(action.action.type==='transfer_item'||action.action.type==='pickup'||action.action.type==='loot'){
   const fulfilled=meta.index.openLoans.get(action.action.item_id);
   if(fulfilled&&next.physical.items.find(i=>i.id===fulfilled.item_id)?.owner_id===fulfilled.lender_actor_id){
    // Compound fulfillment requires a standing lender, as direct return does.
    // A refusal discards the detached mortal result before history/cache changes.
    standing(next,fulfilled.lender_actor_id);
    next.loans=s.loans.map(l=>l===fulfilled?{...l,status:'returned',returned_sequence:sequence}:l);({payload,recipients}=loanReturn(next,fulfilled,id!,action.action.type));
   }
  }break;
 }
 case 'set_knowledge':{
  const entry=g.knowledge_catalog.entries.find(e=>e.knowledge_id===action.knowledge_id)!;
  const acquired={knowledge_id:entry.knowledge_id,origin:'event' as const,sequence,world_time:s.cursor.world_time,active:action.active};next.knowledge=s.knowledge.some(k=>k.knowledge_id===entry.knowledge_id)?s.knowledge.map(k=>k.knowledge_id===entry.knowledge_id?acquired:k):[...s.knowledge,acquired];payload={type:'set_knowledge',knowledge_id:entry.knowledge_id,owner_actor_id:entry.owner_actor_id,active:action.active};recipients=[entry.owner_actor_id];break;
 }
 case 'close_mythic_engagement':next.mythic_closed=true;payload={type:'close_mythic_engagement'};break;
 }
 // Lifecycle consequences share this event, without inventing distant memories.
 if(next.offers.some(o=>o.status==='open'&&(next.physical.items.find(i=>i.id===o.terms.item_id)?.owner_id!==o.terms.lender_actor_id||findActor(next,o.terms.lender_actor_id).hp<=0)))next.offers=next.offers.map(o=>o.status==='open'&&(next.physical.items.find(i=>i.id===o.terms.item_id)?.owner_id!==o.terms.lender_actor_id||findActor(next,o.terms.lender_actor_id).hp<=0)?{...o,status:'withdrawn',closed_sequence:sequence}:o);
 if(next.offers.length>4096||next.loans.length>4096||next.impressions.length>65536||next.knowledge.length>64)fail('INVALID_ACTION','Shared collection capacity reached');
 const memory:WorldMemory={record_id:recordId,request_id:command.request_id,sequence,world_time:next.cursor.world_time,actor_id:id,acquired_by:recipients,payload};assertWorldContract('Memory',memory);
 next.memories=[...s.memories,memory];own(next);own(draws);own(effects);const resolution=own({state:next,draws,effects,memory});budget(next,64);budget(resolution);
 // No cache entry or prior index is mutated until the entire transition succeeds.
 stateCache.set(next,{genesis:g,identity:meta.identity,index:extendIndex(meta.index,s,next,memory,formed)});return resolution;
}
