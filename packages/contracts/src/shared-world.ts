/** Passive shape/binding guards. Authentication, transitions and signatures remain authority duties. */
import {types as nodeTypes} from 'node:util';
import {Buffer} from 'node:buffer';
import {createPublicKey} from 'node:crypto';
import {Ajv2020} from 'ajv/dist/2020.js';
import legacy from '../../../SYSTEMS/argo-v1.schema.json' with {type:'json'};
import characters from '../../../SYSTEMS/characters-v1/characters.schema.json' with {type:'json'};
import mortal from '../../../SYSTEMS/mortal-v3/mortal.schema.json' with {type:'json'};
import knowledgeSchema from '../../../SYSTEMS/dialogue-knowledge-v1/knowledge.schema.json' with {type:'json'};
import definition from '../../../SYSTEMS/shared-world-v1/world.schema.json' with {type:'json'};
import {assertScope,canonical,fail,hash,freezeDto} from './index.ts';
import {assertMortalV3Contract,assertMortalV3Genesis} from './mortal-v3.ts';
import {assertAuthoredKnowledgeContract,assertKnowledgeCatalogIdentity} from './dialogue-knowledge.ts';
import type {Scope} from './generated.ts';
import type {WorldContractMap,WorldGenesis,WorldState,WorldProfile,WorldCommand,WorldAction,WorldMemory,WorldVisibleMemory,WorldImpression,WorldLoanTerms,WorldLoanOffer,WorldLoan,WorldKnowledgeAcquisition,WorldCursor,WorldActorView,WorldEvent,WorldPhysical} from './shared-world-types.ts';

function invalid(message:string):never{return fail('INVALID_CONTRACT',message);}
export const worldSchema=freezeDto(definition);
const ajv=new Ajv2020({strict:true,allErrors:true});
for(const schema of [legacy,characters,mortal,knowledgeSchema,worldSchema])ajv.addSchema(schema);
const validators=new Map(Object.keys(worldSchema.$defs).map(name=>[name,ajv.compile({$ref:worldSchema.$id+'#/$defs/'+name})]));

/** Complete argument budget: 16 MiB canonical JSON UTF-8 bytes, 500000 values, depth 32. */
export function assertWorldData(input:unknown):void{
 const active=new Set<object>();let entries=0,bytes=0;
 const count=(size:number)=>{bytes+=size;if(bytes>16777216)invalid('World data exceeds its encoded byte budget');};
 const encoded=(value:string|number|boolean|null)=>count(Buffer.byteLength(JSON.stringify(value)));
 const visit=(value:unknown,depth:number):void=>{
  if(++entries>500000||depth>32)invalid('World data exceeds its structural budget');
  if(value===null||typeof value==='boolean'||typeof value==='string'){encoded(value);return;}
  if(typeof value==='number'){if(!Number.isSafeInteger(value)||Object.is(value,-0))invalid('World numbers require canonical safe integers');encoded(value);return;}
  if(typeof value!=='object'||nodeTypes.isProxy(value))invalid('World data requires passive JSON');
  if(active.has(value))invalid('World data contains a cycle');
  const array=Array.isArray(value),prototype=Object.getPrototypeOf(value);
  if(array?prototype!==Array.prototype:prototype!==Object.prototype&&prototype!==null)invalid('World data requires plain containers');
  const keys=Reflect.ownKeys(value);if(keys.length>500000-entries||keys.some(key=>typeof key!=='string'))invalid('World data contains symbols or too many keys');
  const descriptors=Object.getOwnPropertyDescriptors(value);active.add(value);count(2);
  try{
   if(array){const length=descriptors.length;if(!length||!('value'in length)||keys.length!==length.value+1)invalid('World arrays must be dense');
    count(Math.max(0,length.value-1));
    for(let i=0;i<length.value;i++){const d=descriptors[String(i)];if(!d?.enumerable||!('value'in d))invalid('World array contains an accessor');visit(d.value,depth+1);}
   }else{count(keys.length+Math.max(0,keys.length-1));for(const key of keys as string[]){const d=descriptors[key];encoded(key);if(['__proto__','prototype','constructor'].includes(key)||!d?.enumerable||!('value'in d))invalid('World data contains an unsafe property');visit(d.value,depth+1);}}
  }finally{active.delete(value);}
 };visit(input,0);
}
function same(a:unknown,b:unknown,message:string):void{if(canonical(a)!==canonical(b))invalid(message);}
function unique(ids:readonly string[],label:string):Set<string>{const set=new Set(ids);if(set.size!==ids.length)invalid('Duplicate world '+label);return set;}
function known(ids:Set<string>,id:string,label:string):void{if(!ids.has(id))invalid('Unknown world '+label);}
function scope(value:Scope):void{
 try{assertScope(value);}catch{invalid('Invalid world rights scope');}
 for(const key of ['tenant_id','workspace_id','campaign_id','world_id','branch_id'] as const)if(!validators.get('Id')!(value[key]))invalid('Unsafe world namespace');
}
function signature(value:string):void{const bytes=Buffer.from(value,'base64');if(bytes.length!==64||bytes.toString('base64')!==value)invalid('World signature requires canonical Ed25519 bytes');}
function publicKey(value:string):void{
 if(!/^-----BEGIN PUBLIC KEY-----\r?\n[A-Za-z0-9+/=\r\n]+-----END PUBLIC KEY-----$/.test(value.trim()))invalid('World trust requires public PEM only');
 try{const key=createPublicKey(value);if(key.type!=='public'||key.asymmetricKeyType!=='ed25519')invalid('World trust requires Ed25519');}catch{invalid('Invalid world public key');}
}
function within(sequence:number,time:number,cursor:WorldCursor):void{if(sequence>cursor.sequence||time>cursor.world_time)invalid('World provenance exceeds its prefix');}
function profile(value:WorldProfile):void{if(!value.nature.description.trim()||!value.activity.description.trim()||value.nature.priorities.some(p=>!p.trim()))invalid('World profile text is empty');}
function profiles(values:WorldProfile[],actorIds:Set<string>):void{
 const ids=unique(values.map(p=>p.actor_id),'profile');if(ids.size!==actorIds.size)invalid('World requires exactly one profile per actor');
 for(const row of values){known(actorIds,row.actor_id,'profile actor');profile(row);}
}
function genesis(value:WorldGenesis):void{
 assertMortalV3Genesis(value.mortal);const m=value.mortal,actorIds=new Set(m.actors.map(a=>a.id)),itemIds=new Set(m.items.map(i=>i.id)),locations=new Set(m.locations.map(l=>l.id));
 profiles(value.profiles,actorIds);const scenes=unique(value.scenes.map(s=>s.location_id),'scene');if(scenes.size!==locations.size)invalid('World requires one authored scene per location');for(const scene of value.scenes)known(locations,scene.location_id,'scene location');
 assertKnowledgeCatalogIdentity(value.knowledge_catalog,value.source_manifest,{pack_hash:m.pack_hash,catalog_hash:hash(value.knowledge_catalog),source_manifest_hash:hash(value.source_manifest)});
 for(const row of value.knowledge_catalog.entries){known(actorIds,row.owner_actor_id,'policy owner');known(itemIds,row.subject_item_id,'policy item');if(row.terms.loan_fee_obols!==0||row.terms.advance_deposit_obols!==0)invalid('World supports free deposit-free policies only');}
 const entries=new Map(value.knowledge_catalog.entries.map(e=>[e.knowledge_id,e]));
 for(const id of value.initial_knowledge_ids){const row=entries.get(id);if(!row||row.validity.from_tick>m.world_time||row.validity.until_tick!==null&&row.validity.until_tick<=m.world_time)invalid('Initial world knowledge is missing or outside validity');}
}
function referee(action:WorldAction):boolean{return action.type==='set_knowledge'||action.type==='close_mythic_engagement'||action.type==='mortal'&&['begin_encounter','recover_encounter'].includes(action.action.type);}
function command(value:WorldCommand):void{
 scope(value.scope);if(value.causation_id!==value.expected.head)invalid('World causation must bind the exact expected head');
 if(referee(value.action)!==(value.actor_id===null))invalid('World action has the wrong direct/referee actor shape');
 const a=value.action;
 if(a.type==='mortal')assertMortalV3Contract('Command',{version:'mortal-rules/0.3.0',scope:value.scope,request_id:value.request_id,actor_id:value.actor_id,expected:{sequence:value.expected.sequence,head:value.expected.head},causation_id:value.causation_id,action:a.action});
 if(a.type==='speak'&&(a.audience.addressed_actor_ids as readonly string[]).includes(value.actor_id!))invalid('Speech addressees must exclude its author');
 if(a.type==='impress'&&a.subject_actor_id===value.actor_id)invalid('An impression must concern another actor');
 if(a.type==='offer_loan'&&(a.borrower_actor_id===value.actor_id||a.expires_at<=value.expected.world_time))invalid('Loan offer requires another borrower and future expiry');
}
function loanTerms(value:WorldLoanTerms):void{if(value.lender_actor_id===value.borrower_actor_id||value.expires_at<=value.issued_at)invalid('Loan offer parties or lifetime disagree');}
function offer(value:WorldLoanOffer):void{
 loanTerms(value.terms);if(value.offer_hash!==hash({domain:'shared-world/0.1.0/loan-offer',terms:value.terms}))invalid('Loan offer differs from its immutable hash');
 if((value.status==='open')!==(value.closed_sequence===null)||value.closed_sequence!==null&&value.closed_sequence<=value.terms.issued_sequence)invalid('Loan offer lifecycle is inconsistent');
}
function loan(value:WorldLoan):void{
 if(value.loan_id!==value.offer_id||value.lender_actor_id===value.borrower_actor_id||(value.status==='open')!==(value.returned_sequence===null)||value.returned_sequence!==null&&value.returned_sequence<=value.accepted_sequence)invalid('Loan lifecycle or parties are inconsistent');
}
function acquisition(value:WorldKnowledgeAcquisition):void{
 if(value.origin==='genesis'?(value.sequence!==0||value.world_time!==0||!value.active):value.sequence===0)invalid('Knowledge origin differs from its acquisition prefix');
}
function impression(value:WorldImpression):void{if(value.owner_actor_id===value.subject_actor_id||value.impression_id===value.previous_impression_id)invalid('Impression identity or predecessor is invalid');}
function memoryIdentity(value:WorldMemory,genesisHash:string):void{
 if(value.record_id!==hash({domain:'shared-world/0.1.0/memory',genesis_hash:genesisHash,request_id:value.request_id,sequence:value.sequence}))invalid('World memory identity differs from its genesis/request/sequence');
}
function memory(value:WorldMemory):void{
 const p=value.payload,actor=value.actor_id,recipients=new Set(value.acquired_by);
 const restricted=(required:string[],allowed=required)=>{for(const id of new Set(required))if(!recipients.has(id))invalid('Memory is missing a required participant');for(const id of recipients)if(!allowed.includes(id))invalid('Memory exceeds its private participant boundary');};
 const direct=()=>{if(actor===null)invalid('Memory requires a direct actor');return actor;};
 switch(p.type){
 case 'speak':{
  const speaker=direct();if((p.audience.addressed_actor_ids as readonly string[]).includes(speaker)||p.in_reply_to===value.record_id)invalid('Speech addressing or reply identity is invalid');
  if(p.audience.kind==='self')restricted([speaker]);else if(p.audience.kind==='whisper')restricted([speaker,...p.audience.addressed_actor_ids]);else for(const id of [speaker,...p.audience.addressed_actor_ids])if(!recipients.has(id))invalid('Room speech omits its author or addressee');break;
 }
 case 'impress':if(p.impression_id!==value.record_id||p.subject_actor_id===direct())invalid('Private impression memory identity differs');restricted([direct()]);break;
 case 'set_activity':restricted([direct()]);break;
 case 'loan_offered':loanTerms(p.terms);if(p.offer_hash!==hash({domain:'shared-world/0.1.0/loan-offer',terms:p.terms})||actor!==p.terms.lender_actor_id||p.terms.issued_sequence!==value.sequence||p.terms.issued_at!==value.world_time)invalid('Offered memory differs from issued terms');restricted([p.terms.lender_actor_id,p.terms.borrower_actor_id]);break;
 case 'loan_withdrawn':if(actor!==p.lender_actor_id||p.lender_actor_id===p.borrower_actor_id)invalid('Withdrawal requires its lender');restricted([p.lender_actor_id],[p.lender_actor_id,p.borrower_actor_id]);break;
 case 'loan_accepted':if(actor!==p.borrower_actor_id||p.loan_id!==p.offer_id||p.lender_actor_id===p.borrower_actor_id)invalid('Loan acceptance requires its borrower');restricted([p.lender_actor_id,p.borrower_actor_id]);break;
 case 'loan_returned':if(actor!==p.holder_actor_id||p.loan_id!==p.offer_id||p.lender_actor_id===p.borrower_actor_id)invalid('Loan return requires its actual holder');restricted([p.holder_actor_id,p.lender_actor_id],[p.holder_actor_id,p.lender_actor_id,p.borrower_actor_id]);break;
 case 'mortal':if(['begin_encounter','recover_encounter'].includes(p.action)!==(actor===null)||p.action==='travel'&&p.location_ids.length)invalid('Mortal memory requester or travel disclosure differs');break;
 case 'set_knowledge':if(actor!==null)invalid('Knowledge memory requires referee provenance');restricted([p.owner_actor_id]);break;
 case 'close_mythic_engagement':if(actor!==null)invalid('Closure memory requires referee provenance');restricted([]);break;
 }
}
function physical(value:WorldPhysical,cursor:WorldCursor={sequence:1000000,head:'a'.repeat(64),world_time:1000000000000},namespace:Scope={tenant_id:'t',workspace_id:'w',workspace_tenant_id:'t:homebrew:w',rights_lane:'homebrew',campaign_id:'c',world_id:'v',branch_id:'b'},genesisHash='a'.repeat(64)):void{
 assertMortalV3Contract('State',{version:'mortal-rules/0.3.0',scope:namespace,genesis_hash:genesisHash,sequence:cursor.sequence,head:cursor.head,world_time:cursor.world_time,...value});
}
function state(value:WorldState):void{
 scope(value.scope);physical(value.physical,value.cursor,value.scope,value.genesis_hash);
 const actors=new Map(value.physical.actors.map(a=>[a.id,a])),actorIds=new Set(actors.keys()),items=new Map(value.physical.items.map(i=>[i.id,i]));profiles(value.profiles,actorIds);
 if(value.memories.length!==value.cursor.sequence)invalid('World state requires one memory for every accepted sequence');
 unique(value.memories.map(r=>r.record_id),'memory');unique(value.memories.map(r=>r.request_id),'memory request');
 const records=new Map<string,WorldMemory>(),replies=new Set<string>();let priorTime=0;
 for(const [i,row] of value.memories.entries()){
  memory(row);memoryIdentity(row,value.genesis_hash);if(row.sequence!==i+1||row.world_time<priorTime)invalid('World memories require contiguous sequence and monotone time');within(row.sequence,row.world_time,value.cursor);priorTime=row.world_time;
  if(row.actor_id!==null)known(actorIds,row.actor_id,'memory author');for(const id of row.acquired_by)known(actorIds,id,'memory acquirer');
  const p=row.payload;
  if(p.type==='speak'){
   const speaker=actors.get(row.actor_id!)!,own=value.profiles.find(x=>x.actor_id===row.actor_id)!;
   if([...p.text].length>own.max_speech_characters||speaker.kind==='npc'&&p.in_reply_to===null)invalid('Speech exceeds its profile or lacks NPC inbound provenance');
   if(p.in_reply_to!==null){const inbound=records.get(p.in_reply_to);if(!inbound||inbound.payload.type!=='speak'||inbound.actor_id===row.actor_id||!inbound.acquired_by.includes(row.actor_id!))invalid('Reply references unacquired inbound speech');
    if(speaker.kind==='npc'){const key=row.actor_id+':'+p.in_reply_to;if(!(inbound.payload.audience.addressed_actor_ids as readonly string[]).includes(row.actor_id!)||replies.has(key))invalid('NPC reply must address one unconsumed inbound record');replies.add(key);}
   }
  }
  if(p.type==='mortal'){for(const id of p.actor_ids)known(actorIds,id,'physical memory participant');for(const id of p.item_ids)if(!items.has(id))invalid('Unknown physical memory item');}
  records.set(row.record_id,row);
 }
 if(value.memories.length&&priorTime!==value.cursor.world_time)invalid('Latest world memory must match current world time');
 unique(value.impressions.map(r=>r.impression_id),'impression');const impressions=new Map<string,WorldImpression>();
 for(const row of value.impressions){impression(row);within(row.sequence,row.world_time,value.cursor);known(actorIds,row.owner_actor_id,'impression owner');known(actorIds,row.subject_actor_id,'impression subject');
  const record=records.get(row.impression_id);if(!record||record.actor_id!==row.owner_actor_id||record.sequence!==row.sequence||record.world_time!==row.world_time||record.payload.type!=='impress'||record.payload.subject_actor_id!==row.subject_actor_id||record.payload.interpretation!==row.interpretation)invalid('Impression differs from its private memory');
  const owner=value.profiles.find(p=>p.actor_id===row.owner_actor_id)!;if(row.nature_revision>owner.revision||row.nature_revision===owner.revision&&canonical(row.nature)!==canonical(owner.nature))invalid('Impression nature revision disagrees');
  for(const id of row.evidence_ids){const evidence=records.get(id);if(!evidence||evidence.sequence>=row.sequence||evidence.actor_id!==row.subject_actor_id||!evidence.acquired_by.includes(row.owner_actor_id))invalid('Impression evidence is not previously acquired about its subject');}
  if(row.previous_impression_id!==null){const previous=impressions.get(row.previous_impression_id);if(!previous||previous.owner_actor_id!==row.owner_actor_id||previous.subject_actor_id!==row.subject_actor_id||previous.sequence>=row.sequence)invalid('Impression predecessor differs');}impressions.set(row.impression_id,row);
 }
 for(const row of value.memories)if(row.payload.type==='impress'&&!impressions.has(row.record_id))invalid('Private impression memory lacks its state row');
 unique(value.knowledge.map(k=>k.knowledge_id),'knowledge');for(const row of value.knowledge){acquisition(row);within(row.sequence,row.world_time,value.cursor);if(row.origin==='event'){const record=value.memories[row.sequence-1];if(!record||record.world_time!==row.world_time||record.payload.type!=='set_knowledge'||record.payload.knowledge_id!==row.knowledge_id||record.payload.active!==row.active)invalid('Knowledge acquisition differs from its committed activation');}}
 const knowledge=new Map(value.knowledge.map(k=>[k.knowledge_id,k])),latestGrants=new Map<string,WorldMemory>(),latestActivities=new Map<string,WorldMemory>();
 for(const r of value.memories){if(r.payload.type==='set_knowledge')latestGrants.set(r.payload.knowledge_id,r);if(r.payload.type==='set_activity')latestActivities.set(r.actor_id!,r);}
 for(const [id,r] of latestGrants){const k=knowledge.get(id);if(!k||k.origin!=='event'||k.sequence!==r.sequence)invalid('Current knowledge omits its latest committed change');}
 for(const [id,r] of latestActivities)if(r.payload.type==='set_activity')same(value.profiles.find(p=>p.actor_id===id)!.activity,r.payload.activity,'Current activity differs from latest private change');
 const offers=new Map(value.offers.map(o=>[o.terms.offer_id,o]));if(offers.size!==value.offers.length)invalid('Duplicate world offer');unique(value.loans.map(l=>l.loan_id),'loan');const liveItems=new Set<string>();
 for(const row of value.offers){offer(row);const t=row.terms;if(t.genesis_hash!==value.genesis_hash)invalid('Offer belongs to another world');within(t.issued_sequence,t.issued_at,value.cursor);known(actorIds,t.lender_actor_id,'lender');known(actorIds,t.borrower_actor_id,'borrower');const item=items.get(t.item_id);if(!item)invalid('Unknown offered item');
  const issued=value.memories[t.issued_sequence-1];if(issued?.payload.type!=='loan_offered'||issued.payload.offer_hash!==row.offer_hash)invalid('Offer lacks its issued memory');
  if(row.closed_sequence!==null&&row.closed_sequence>value.cursor.sequence)invalid('Offer closes after current prefix');
  if(row.status==='open'){if(item.owner_id!==t.lender_actor_id||actors.get(t.lender_actor_id)!.hp<=0)invalid('Open offer survived custody loss or lender incapacity');if(t.expires_at>value.cursor.world_time){if(liveItems.has(t.item_id))invalid('Item has multiple live offers');liveItems.add(t.item_id);}}
 }
 const accepted=new Set<string>();for(const row of value.loans){loan(row);const o=offers.get(row.offer_id);if(!o||o.status!=='accepted'||o.offer_hash!==row.offer_hash||o.closed_sequence!==row.accepted_sequence)invalid('Loan lacks exact accepted offer');const t=o.terms;
  if(row.item_id!==t.item_id||row.lender_actor_id!==t.lender_actor_id||row.borrower_actor_id!==t.borrower_actor_id||row.accepted_at<t.issued_at||row.accepted_at>=t.expires_at)invalid('Loan differs from its offered terms');within(row.accepted_sequence,row.accepted_at,value.cursor);accepted.add(row.offer_id);
  const record=value.memories[row.accepted_sequence-1];if(record?.payload.type!=='loan_accepted'||record.payload.offer_hash!==row.offer_hash||record.world_time!==row.accepted_at)invalid('Loan lacks its acceptance memory');
  if(row.returned_sequence!==null){const returned=value.memories[row.returned_sequence-1];if(!returned||returned.payload.type!=='loan_returned'||returned.payload.loan_id!==row.loan_id)invalid('Loan return lacks its committed fulfillment');}
  if(row.status==='open'){if(liveItems.has(row.item_id)||items.get(row.item_id)?.owner_id===row.lender_actor_id)invalid('Open loan was reoffered or not fulfilled on lender custody');liveItems.add(row.item_id);}
 }
 for(const row of value.offers)if(row.status==='accepted'&&!accepted.has(row.terms.offer_id))invalid('Accepted offer lacks its atomic loan');
 const loans=new Map(value.loans.map(l=>[l.loan_id,l]));
 for(const record of value.memories){const p=record.payload;
  if(p.type==='loan_offered'){const o=offers.get(p.terms.offer_id);if(!o||o.offer_hash!==p.offer_hash||o.terms.issued_sequence!==record.sequence)invalid('Issued offer memory lacks its unique stored offer');}
  if(p.type==='loan_withdrawn'){const o=offers.get(p.offer_id);if(!o||o.status!=='withdrawn'||o.closed_sequence!==record.sequence||o.terms.lender_actor_id!==p.lender_actor_id||o.terms.borrower_actor_id!==p.borrower_actor_id)invalid('Withdrawal differs from its stored offer');}
  if(p.type==='loan_accepted'||p.type==='loan_returned'){const l=loans.get(p.loan_id);if(!l||l.offer_id!==p.offer_id||l.item_id!==p.item_id||l.lender_actor_id!==p.lender_actor_id||l.borrower_actor_id!==p.borrower_actor_id)invalid('Loan memory differs from its stored obligation');
   if(p.type==='loan_accepted'?(l.accepted_sequence!==record.sequence||l.offer_hash!==p.offer_hash):(l.status!=='returned'||l.returned_sequence!==record.sequence))invalid('Loan memory differs from its lifecycle');
  }
 }
 const closed=value.memories.some(r=>r.payload.type==='close_mythic_engagement');if(value.mythic_closed!==closed)invalid('World closure differs from committed boundary');
 if(value.cursor.sequence===0&&(value.offers.length||value.loans.length||value.impressions.length||value.knowledge.some(k=>k.origin!=='genesis')))invalid('Initial shared state contains later history');
}
function visibleMemory(row:WorldVisibleMemory,owner:string):void{
 const p=row.payload;
 if((p.type==='impress'||p.type==='set_activity'||p.type==='speak'&&p.audience.kind==='self')&&row.actor_id!==owner)invalid('Visible memory exposes another private owner');
 if(p.type==='speak'&&p.audience.kind==='whisper'&&row.actor_id!==owner&&!p.audience.addressed_actor_ids.includes(owner))invalid('Visible whisper does not include its reader');
 if(p.type==='loan_offered'){loanTerms(p.terms);if(![p.terms.lender_actor_id,p.terms.borrower_actor_id].includes(owner)||p.offer_hash!==hash({domain:'shared-world/0.1.0/loan-offer',terms:p.terms}))invalid('Visible loan offer exceeds its parties or identity');}
 if(['loan_withdrawn','loan_accepted','loan_returned'].includes(p.type)&&'lender_actor_id'in p&&![p.lender_actor_id,p.borrower_actor_id].includes(owner))invalid('Visible loan identity exceeds its original parties');
 if(p.type==='custody_returned'&&(owner!==p.from_actor_id||row.actor_id!==p.from_actor_id||p.from_actor_id===p.to_actor_id))invalid('Redacted custody return does not bind its holder');
 if(p.type==='set_knowledge'&&p.owner_actor_id!==owner)invalid('Visible knowledge grant belongs to another actor');
 if(p.type==='close_mythic_engagement'||p.type==='mortal'&&p.action==='travel'&&p.location_ids.length)invalid('Visible memory discloses a hidden boundary or travel endpoint');
}
function actorView(value:WorldActorView):void{
 const q=value.query,actor=q.actor_id;scope(q.scope);profile(value.profile);
 if(value.profile.actor_id!==actor||value.physical.self.id!==actor)invalid('World view does not bind its actor');
 if(q.cursor.sequence===0&&q.cursor.head!==value.genesis_hash)invalid('Initial view cursor differs from genesis');
 assertMortalV3Contract('ActorView',{version:'mortal-rules/0.3.0',scope:q.scope,cursor:{sequence:q.cursor.sequence,head:q.cursor.head},world_time:q.cursor.world_time,...value.physical});
 if(value.scene.location_id!==value.physical.self.location_id)invalid('Shared scene differs from current physical location');
 const occupants=unique(value.scene.occupants.map(o=>o.actor_id),'visible occupant'),self=value.scene.occupants.find(o=>o.actor_id===actor);
 known(occupants,actor,'self occupant');if(self!.name!==value.physical.self.name||self!.condition!==(value.physical.self.hp>0?'standing':value.physical.self.hp===0?'unconscious':'dead'))invalid('Visible self condition differs from physical state');
 const ids=unique(value.memories.map(r=>r.record_id),'visible memory');let sequence=0,time=0;
 for(const row of value.memories){within(row.sequence,row.world_time,q.cursor);if(row.sequence<=sequence||row.world_time<time)invalid('Visible memories require ordered provenance');sequence=row.sequence;time=row.world_time;visibleMemory(row,actor);}
 unique(value.impressions.map(r=>r.impression_id),'visible impression');unique(value.impressions.map(r=>r.subject_actor_id),'latest visible impression subject');
 for(const row of value.impressions){impression(row);within(row.sequence,row.world_time,q.cursor);if(row.owner_actor_id!==actor||row.nature_revision>value.profile.revision)invalid('Visible impression exposes another owner or future nature');if(row.nature_revision===value.profile.revision)same(row.nature,value.profile.nature,'Visible impression conflicts with its nature revision');}
 for(const id of value.replied_to){known(ids,id,'consumed inbound record');const row=value.memories.find(r=>r.record_id===id)!;if(row.payload.type!=='speak'||row.actor_id===actor||!(row.payload.audience.addressed_actor_ids as readonly string[]).includes(actor))invalid('Reply marker is not returned addressed inbound speech');}
 unique(value.knowledge.map(row=>row.entry.knowledge_id),'visible knowledge');const sources=unique(value.source_definitions.map(s=>s.source_id),'visible source'),usedSources=new Set<string>();
 for(const source of value.source_definitions)assertAuthoredKnowledgeContract('AuthoredKnowledgeSource',source);
 for(const row of value.knowledge){assertAuthoredKnowledgeContract('AuthoredKnowledgeEntry',row.entry);acquisition(row.acquisition);within(row.acquisition.sequence,row.acquisition.world_time,q.cursor);
  const e=row.entry;if(e.owner_actor_id!==actor||row.acquisition.knowledge_id!==e.knowledge_id||!row.acquisition.active||e.validity.from_tick>q.cursor.world_time||e.validity.until_tick!==null&&e.validity.until_tick<=q.cursor.world_time)invalid('Visible policy is foreign, inactive or outside validity');
  for(const id of e.provenance.source_ids){known(sources,id,'visible source');usedSources.add(id);}
 }
 if(usedSources.size!==sources.size)invalid('Visible sources include unrelated private metadata');
 const c=value.coverage;if(c.memory_returned!==value.memories.length||c.impressions_returned!==value.impressions.length||c.memory_total<c.memory_returned||c.impressions_total<c.impressions_returned||c.complete!==(c.memory_total===c.memory_returned&&c.impressions_total===c.impressions_returned))invalid('World view coverage misstates its selection');
 if(value.mythic_closed&&(value.memories.length||value.impressions.length||value.knowledge.length||value.replied_to.length))invalid('Closed world view must suppress dialogue context');
}
function event(value:WorldEvent):void{
 scope(value.scope);command(value.command);assertMortalV3Contract('Principal',value.principal);same(value.scope,value.command.scope,'World event command scope differs');same(value.scope,value.principal.scope,'World event principal scope differs');
 const c=value.command,a=c.action,p=value.memory.payload;
 if(value.sequence!==c.expected.sequence+1||value.previous_hash!==c.expected.head||value.world_time<c.expected.world_time||a.type!=='mortal'&&value.world_time!==c.expected.world_time)invalid('World event cursor/time differs from its command');
 if(value.sequence===1&&value.previous_hash!==value.genesis_hash)invalid('First world event must bind complete genesis');
 if(c.actor_id!==value.principal.actor_id||referee(a)!==(value.principal.role==='referee'))invalid('World event principal differs from command role');
 if(a.type==='speak'&&value.principal.role==='npc'&&a.in_reply_to===null)invalid('NPC event requires addressed inbound provenance');
 memory(value.memory);memoryIdentity(value.memory,value.genesis_hash);
 if(value.memory.request_id!==c.request_id||value.memory.actor_id!==c.actor_id||value.memory.sequence!==value.sequence||value.memory.world_time!==value.world_time)invalid('World compound memory differs from its event');
 switch(a.type){
 case 'speak':if(p.type!=='speak')invalid('Speech event needs speech memory');same(p,a,'Speech memory differs from command');break;
 case 'impress':if(p.type!=='impress'||p.subject_actor_id!==a.subject_actor_id||p.interpretation!==a.interpretation)invalid('Impression memory differs from command');break;
 case 'set_activity':if(p.type!=='set_activity')invalid('Activity memory differs');same(p,a,'Activity memory differs from command');break;
 case 'offer_loan':if(p.type!=='loan_offered')invalid('Offer event requires offered memory');for(const key of ['offer_id','policy_id','item_id','borrower_actor_id','return_location_id','repair_cap_obols','expires_at'] as const)if(p.terms[key]!==a[key])invalid('Issued terms differ from command');if(p.terms.genesis_hash!==value.genesis_hash)invalid('Issued terms differ from world');break;
 case 'withdraw_loan_offer':if(p.type!=='loan_withdrawn'||p.offer_id!==a.offer_id)invalid('Withdrawal memory differs');break;
 case 'accept_loan':if(p.type!=='loan_accepted'||p.offer_id!==a.offer_id||p.offer_hash!==a.offer_hash)invalid('Acceptance memory differs');break;
 case 'return_loan':if(p.type!=='loan_returned'||p.loan_id!==a.loan_id||p.via_mortal!==null)invalid('Return memory differs');break;
 case 'mortal':if(p.type==='mortal'){if(p.action!==a.action.type)invalid('Mortal memory action differs');}else if(p.type!=='loan_returned'||p.via_mortal!==a.action.type||!['transfer_item','pickup','loot'].includes(a.action.type))invalid('Mortal event has an invalid compound memory');break;
 case 'set_knowledge':if(p.type!=='set_knowledge'||p.knowledge_id!==a.knowledge_id||p.active!==a.active)invalid('Knowledge memory differs');break;
 case 'close_mythic_engagement':if(p.type!=='close_mythic_engagement')invalid('Closure memory differs');break;
 }
 for(let i=0;i<value.draws.length;i++){const draw=value.draws[i]!;if(draw.value>draw.sides||i>0&&draw.index!==value.draws[i-1]!.index+1)invalid('World draw values/order differ');}
 signature(value.signature);
}
/** Optional genesis establishes referential identity, not current-prefix authenticity. */
function bindGenesis(name:keyof WorldContractMap,value:WorldContractMap[keyof WorldContractMap],g:WorldGenesis):void{
 const identity=hash(g),m=g.mortal,actors=new Map(m.actors.map(a=>[a.id,a])),locations=new Set(m.locations.map(l=>l.id)),items=new Set(m.items.map(i=>i.id)),entries=new Map(g.knowledge_catalog.entries.map(e=>[e.knowledge_id,e]));
 if('scope'in value)same(value.scope,m.scope,'World data belongs to another genesis namespace');
 if('genesis_hash'in value&&value.genesis_hash!==identity)invalid('World data differs from complete genesis');
 if(name==='State'){
  const s=value as WorldState;const actual=new Set(s.physical.actors.map(a=>a.id));if(actual.size!==actors.size)invalid('Physical actor roster differs from genesis');
  for(const a of s.physical.actors){const original=actors.get(a.id);if(!original)invalid('State introduces an actor');for(const key of ['name','controller_id','kind','max_hp','abilities'] as const)same(a[key],original[key],'Physical actor identity changed');known(locations,a.location_id,'current actor location');}
  if(s.physical.items.length!==m.items.length)invalid('Physical item roster differs from genesis');for(const item of s.physical.items){const original=m.items.find(i=>i.id===item.id);if(!original)invalid('State introduces an item');for(const key of ['name','slots','kind','damage_die','attack_ability','armor_defense','tool'] as const)same(item[key],original[key],'Physical item identity changed');if(item.location_id!==null)known(locations,item.location_id,'ground item location');}
  if(s.physical.opportunities.length!==m.opportunities.length||s.physical.stocks.length!==m.stocks.length)invalid('Physical opportunity or stock roster changed');
  for(const row of s.physical.opportunities){const original=m.opportunities.find(o=>o.id===row.id);if(!original)invalid('State introduces an opportunity');const {remaining:_,...actual}=row,{remaining:__,...initial}=original;same(actual,initial,'Opportunity immutable identity changed');if(row.remaining>original.remaining)invalid('Opportunity stock increased');}
  for(const row of s.physical.stocks){const original=m.stocks.find(o=>o.id===row.id);if(!original)invalid('State introduces stock');const {remaining:_,treasury:__,...actual}=row,{remaining:___,treasury:____,...initial}=original;same(actual,initial,'Stock immutable identity changed');if(row.remaining>original.remaining)invalid('Shop stock increased');}
  for(const row of s.profiles){const initial=g.profiles.find(p=>p.actor_id===row.actor_id)!;for(const key of ['revision','nature','max_speech_characters','presentation'] as const)same(row[key],initial[key],'World profile immutable content changed');}
  for(const row of s.knowledge){if(!entries.has(row.knowledge_id)||row.origin==='genesis'&&!g.initial_knowledge_ids.includes(row.knowledge_id))invalid('State introduces unknown authored knowledge or initial grant');}
  for(const id of g.initial_knowledge_ids)if(!s.knowledge.some(k=>k.knowledge_id===id))invalid('State omits an initial knowledge acquisition');
  for(const o of s.offers){known(locations,o.terms.return_location_id,'loan checkpoint');const policy=entries.get(o.terms.policy_id);if(!policy||policy.owner_actor_id!==o.terms.lender_actor_id||policy.subject_item_id!==o.terms.item_id||o.terms.repair_cap_obols>policy.terms.repair_cap_obols)invalid('Offer exceeds its authored policy');}
  for(const row of s.memories){const p=row.payload;if(p.type==='mortal')for(const id of p.location_ids)known(locations,id,'memory location');if(p.type==='set_knowledge'&&entries.get(p.knowledge_id)?.owner_actor_id!==p.owner_actor_id)invalid('Knowledge memory owner differs from genesis');}
  if(s.cursor.sequence===0){same(s.physical,{actors:m.actors,items:m.items,opportunities:m.opportunities,stocks:m.stocks,encounter:null,rng_counter:0},'Initial physical state differs from genesis');same(s.profiles,g.profiles,'Initial profiles differ from genesis');same(s.knowledge.map(k=>k.knowledge_id).sort(),[...g.initial_knowledge_ids].sort(),'Initial knowledge differs from genesis');}
 }
 if(name==='Command'){
  const c=value as WorldCommand,a=c.action;if(c.actor_id!==null&&!actors.has(c.actor_id))invalid('Unknown command actor');
  if(a.type==='speak')for(const id of a.audience.addressed_actor_ids)if(!actors.has(id))invalid('Unknown speech addressee');
  if(a.type==='impress'&&!actors.has(a.subject_actor_id))invalid('Unknown impression subject');
  if(a.type==='offer_loan'){if(!actors.has(a.borrower_actor_id))invalid('Unknown offer borrower');known(items,a.item_id,'offered item');known(locations,a.return_location_id,'loan checkpoint');const policy=entries.get(a.policy_id);if(!policy||policy.owner_actor_id!==c.actor_id||policy.subject_item_id!==a.item_id||a.repair_cap_obols>policy.terms.repair_cap_obols)invalid('Offer command exceeds authored policy');}
  if(a.type==='set_knowledge'&&!entries.has(a.knowledge_id))invalid('Unknown knowledge command');
 }
 if(name==='Query'){const q=value as WorldContractMap['Query'];if(!actors.has(q.actor_id))invalid('Unknown world reader');}
 if(name==='ActorView'){
  const v=value as WorldActorView;same(v.query.scope,m.scope,'Actor view scope differs from genesis');if(!actors.has(v.query.actor_id))invalid('Unknown world reader');known(locations,v.scene.location_id,'visible scene');
  const original=actors.get(v.query.actor_id)!;for(const key of ['name','max_hp','abilities'] as const)same(v.physical.self[key],original[key],'Visible physical identity changed');
  const initialProfile=g.profiles.find(p=>p.actor_id===v.query.actor_id)!;for(const key of ['revision','nature','max_speech_characters','presentation'] as const)same(v.profile[key],initialProfile[key],'Visible authored profile changed');
  for(const route of v.physical.routes){const initial=m.routes.find(r=>r.id===route.id);if(!initial)invalid('Unknown visible route');same(route,initial,'Visible route changed');}
  same(v.physical.location,m.locations.find(l=>l.id===v.scene.location_id)!,'Visible location changed');
  same(v.scene.description,g.scenes.find(s=>s.location_id===v.scene.location_id)!.description,'Scene description differs from authored genesis');if(v.scene.environment!==g.environment||v.physical.location.name!==m.locations.find(l=>l.id===v.scene.location_id)!.name)invalid('Scene public identity differs');
  for(const o of v.scene.occupants)if(actors.get(o.actor_id)?.name!==o.name)invalid('Visible occupant identity differs');
  same(v.knowledge_source,{pack_hash:m.pack_hash,catalog_hash:hash(g.knowledge_catalog),source_manifest_hash:hash(g.source_manifest)},'Knowledge source pins differ from genesis');
  for(const row of v.knowledge){const entry=entries.get(row.entry.knowledge_id);if(!entry)invalid('Unknown visible policy');same(row.entry,entry,'Visible policy differs from authored catalog');}
  for(const source of v.source_definitions){const original=g.source_manifest.sources.find(s=>s.source_id===source.source_id);if(!original)invalid('Unknown visible source');same(source,original,'Visible source differs from genesis');}
  for(const item of v.physical.items)known(items,item.id,'visible owned item');
 }
 if(name==='Event'){
  const e=value as WorldEvent,p=e.principal;if(p.role==='referee'){if(p.principal_id!==m.referee_id)invalid('Event referee differs from genesis');}else{const actor=actors.get(p.actor_id);if(!actor||actor.controller_id!==p.principal_id||actor.kind!==p.role)invalid('Event controller differs from genesis');}
 }
}

/** Shape and intra-DTO invariants; optional genesis adds immutable reference checks. */
export function assertWorldContract<K extends keyof WorldContractMap>(name:K,value:unknown,context?:WorldGenesis):asserts value is WorldContractMap[K]{
 assertWorldData(value);const check=validators.get(name);if(!check||!check(value))invalid('Invalid world '+name+' contract');
 switch(name){
 case 'Genesis':genesis(value as WorldGenesis);break;
 case 'Physical':physical(value as WorldPhysical);break;
 case 'Profile':profile(value as WorldProfile);break;
 case 'Principal':assertMortalV3Contract('Principal',value);break;
 case 'Action':{const action=value as WorldAction;if(action.type==='mortal'&&action.action.type==='begin_encounter')unique([...action.action.side_a,...action.action.side_b],'encounter participant');break;}
 case 'Command':command(value as WorldCommand);break;
 case 'State':state(value as WorldState);break;
 case 'Query':scope((value as WorldContractMap['Query']).scope);break;
 case 'ActorView':actorView(value as WorldActorView);break;
 case 'Memory':memory(value as WorldMemory);break;
 case 'Impression':impression(value as WorldImpression);break;
 case 'LoanTerms':loanTerms(value as WorldLoanTerms);break;
 case 'LoanOffer':offer(value as WorldLoanOffer);break;
 case 'Loan':loan(value as WorldLoan);break;
 case 'KnowledgeAcquisition':acquisition(value as WorldKnowledgeAcquisition);break;
 case 'Event':event(value as WorldEvent);break;
 case 'Receipt':{const r=value as WorldContractMap['Receipt'];scope(r.scope);signature(r.signature);if(r.cursor.sequence===0||r.cursor.head!==r.event_hash)invalid('World receipt cursor differs from event');break;}
 case 'ReceiptTrust':{const t=value as WorldContractMap['ReceiptTrust'];scope(t.scope);publicKey(t.authority_public_key);break;}
 case 'Resolution':{const r=value as WorldContractMap['Resolution'];state(r.state);memory(r.memory);same(r.memory,r.state.memories.at(-1)??null,'Resolution memory differs from resulting state');break;}
 }
 if(context!==undefined){assertWorldGenesis(context);bindGenesis(name,value as WorldContractMap[keyof WorldContractMap],context);}
}
export function assertWorldGenesis(value:unknown):asserts value is WorldGenesis{assertWorldContract('Genesis',value);}

/** Canonical retry identity; shape/binding checks do not authenticate the controller. */
export function worldRequestHash(commandInput:unknown,principalInput:unknown):string{
 assertWorldContract('Command',commandInput);assertWorldContract('Principal',principalInput);
 same(commandInput.scope,principalInput.scope,'Request principal scope differs');
 if(commandInput.actor_id!==principalInput.actor_id||referee(commandInput.action)!==(principalInput.role==='referee'))invalid('Request principal differs from command actor or role');
 return hash({domain:'shared-world/0.1.0/request',command:commandInput,principal:principalInput});
}
