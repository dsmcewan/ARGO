// Additive projection contract profile. These pure guards/selectors neither read a
// store nor authenticate a provider, a principal, an event, or policy freshness.
import {Ajv2020} from 'ajv/dist/2020.js';
import {Buffer} from 'node:buffer';
import {types as nodeTypes} from 'node:util';
import v1Schema from '../../../SYSTEMS/argo-v1.schema.json' with {type:'json'};
import definition from '../../../SYSTEMS/proposals/headless-v2/projection-v2.schema.json' with {type:'json'};
import {canonical,assertScope,requireScope,assertContract,fail,freezeDto} from './index.ts';
import type {Principal,Scope} from './generated.ts';
import type {
 ProjectionContractMap,ProjectionCommonCheckpoint,ProjectionReadPolicy,
 ProjectionActorKnowledgeQuery,ProjectionCanonicalHistoryQuery,
 ProjectionActorKnowledgeView,ProjectionCanonicalRelationVersion,ProjectionIdEntries,
} from './projection-generated.ts';

// Do not initialize from an index.ts live binding: index.ts reexports this module.
function freezeSchema<T>(value:T):T{
 if(value!==null&&typeof value==='object'){
  for(const child of Object.values(value))freezeSchema(child);
  Object.freeze(value);
 }
 return value;
}
export const projectionSchema=freezeSchema(definition);
const ajv=new Ajv2020({allErrors:true,strict:true});
ajv.addSchema(v1Schema);ajv.addSchema(projectionSchema);
const validators=new Map(Object.keys(projectionSchema.$defs).map(name=>[
 name,ajv.compile({$ref:`${projectionSchema.$id}#/$defs/${name}`}),
]));

const MAX_DEPTH=32,MAX_NODES=50000,MAX_BYTES=8*1024*1024,MAX_ARRAY=4096;
const forbiddenKeys=new Set(['__proto__','constructor','prototype']);
function invalid(message:string):never{return fail('INVALID_CONTRACT',message);}

/** Inspect descriptors before canonical() or structuredClone() can touch data.
 * One budget covers all arguments to the public operation. The root depth is 0;
 * nodes count values, while UTF-8 bytes include string values and property names.
 * Repeated aliases count at every occurrence; only ancestor cycles are rejected.
 */
function safeInputs(...values:unknown[]):void{
 let nodes=0,bytes=0;const active=new Set<object>();
 const countBytes=(text:string)=>{
  bytes+=Buffer.byteLength(text,'utf8');
  if(bytes>MAX_BYTES)invalid('Projection input exceeds the UTF-8 byte budget');
 };
 const visit=(value:unknown,depth:number):void=>{
  if(depth>MAX_DEPTH||++nodes>MAX_NODES)invalid('Projection input exceeds its structural budget');
  if(value===null||typeof value==='boolean')return;
  if(typeof value==='string'){countBytes(value);return;}
  if(typeof value==='number'){
   if(!Number.isSafeInteger(value)||Object.is(value,-0))invalid('Projection input requires safe integers');
   return;
  }
  if(typeof value!=='object')invalid('Projection input must be JSON data');
  if(nodeTypes.isProxy(value))invalid('Proxy objects are not projection DTOs');
  if(active.has(value))invalid('Projection input contains a cycle');
  const array=Array.isArray(value),prototype=Object.getPrototypeOf(value);
  if(array?prototype!==Array.prototype:prototype!==Object.prototype&&prototype!==null)invalid('Projection input requires plain objects and arrays');
  const keys=Reflect.ownKeys(value);
  if(keys.some(key=>typeof key!=='string'))invalid('Projection input contains symbol properties');
  if(keys.length>MAX_NODES)invalid('Projection input exceeds its structural budget');
  const descriptors=Object.getOwnPropertyDescriptors(value);
  active.add(value);
  try{
   if(array){
    const length=descriptors['length'];
    if(!length||!('value'in length)||!Number.isSafeInteger(length.value)||length.value<0||length.value>MAX_ARRAY)invalid('Projection array exceeds its item bound');
    if(keys.length!==length.value+1)invalid('Projection arrays must be dense and undecorated');
    countBytes('length');
    for(let index=0;index<length.value;index++){
     const key=String(index),descriptor=descriptors[key];
     if(!descriptor||!descriptor.enumerable||!('value'in descriptor))invalid('Projection array contains an unsafe entry');
     countBytes(key);visit(descriptor.value,depth+1);
    }
   }else{
    for(let index=0;index<keys.length;index++){
     const key=keys[index] as string,descriptor=descriptors[key];
     if(forbiddenKeys.has(key)||!descriptor||!descriptor.enumerable||!('value'in descriptor))invalid('Projection object contains an unsafe property');
     countBytes(key);visit(descriptor.value,depth+1);
    }
   }
  }finally{active.delete(value);}
 };
 for(let index=0;index<values.length;index++)visit(values[index],0);
 // The existing canonical codec remains unchanged and still defines the data domain.
 for(let index=0;index<values.length;index++)canonical(values[index]);
}

type Prefix=ProjectionContractMap['Prefix'];
type Cursor=ProjectionContractMap['PlaneCursor'];
type Source=ProjectionContractMap['SourceRef'];
type Claim=ProjectionContractMap['EpistemicClaim'];
type Acquisition=ProjectionContractMap['Acquisition'];
type DisclosedClaim=ProjectionContractMap['DisclosedClaim'];

function sortedIds(ids:readonly string[],description:string):void{
 let previous:string|undefined;
 for(let index=0;index<ids.length;index++){
  const current=ids[index]!;
  if(previous!==undefined&&previous>=current)invalid(`${description} must be strictly sorted and unique`);
  previous=current;
 }
}
function prefix(value:Prefix):void{
 assertScope(value.scope);
 if((value.sequence===0)!==(value.head===null))invalid('A projection prefix requires sequence zero exactly when its head is null');
}
function cursor(value:Cursor):void{prefix(value.prefix);}
function checkpoint(value:ProjectionCommonCheckpoint):void{
 prefix(value.prefix);cursor(value.canonical);cursor(value.epistemic);
 if(value.canonical.plane!=='canonical'||value.epistemic.plane!=='epistemic')invalid('Projection cursor planes do not match their checkpoint slots');
 if(canonical(value.canonical.prefix)!==canonical(value.prefix)||canonical(value.epistemic.prefix)!==canonical(value.prefix))invalid('Projection checkpoint contains mixed prefixes');
}
function flags(ontologyBlocked:boolean,engagementClosed:boolean):void{
 if(engagementClosed&&!ontologyBlocked)invalid('Closed engagement requires an ontology cutoff');
}
function actorQuery(value:ProjectionActorKnowledgeQuery):void{
 assertScope(value.scope);
 if((value.audience==='actor')!==(value.party_id===null))invalid('Projection query audience and party disagree');
}
function disclosed(value:DisclosedClaim):void{
 if(value.occurred_at_tick>value.acquired_at_tick)invalid('A claim cannot be acquired before its occurrence');
}
function relation(value:ProjectionCanonicalRelationVersion):void{
 assertScope(value.scope);
 if(value.valid_to_tick!==null&&value.valid_from_tick>=value.valid_to_tick)invalid('Canonical valid interval must be nonempty and half-open');
 if(value.recorded_to_sequence!==null&&value.recorded_from_sequence>=value.recorded_to_sequence)invalid('Canonical recorded interval must be nonempty and half-open');
 if(value.source.kind==='genesis'){
  if(value.recorded_from_sequence!==0)invalid('Genesis provenance must start at sequence zero');
 }else if(value.recorded_from_sequence===0||value.source.sequence!==value.recorded_from_sequence){
  invalid('Canonical event provenance must match its recorded start');
 }
}
function semantics(name:keyof ProjectionContractMap,value:unknown):void{
 switch(name){
  case 'Prefix':prefix(value as Prefix);break;
  case 'PlaneCursor':cursor(value as Cursor);break;
  case 'CommonCheckpoint':checkpoint(value as ProjectionCommonCheckpoint);break;
  case 'CanonicalRelationVersion':relation(value as ProjectionCanonicalRelationVersion);break;
  case 'EpistemicClaim':{
   const claim=value as Claim;assertScope(claim.scope);
   if(claim.source.kind!=='event')invalid('Epistemic claims require event provenance');
   break;
  }
  case 'Acquisition':{
   const acquisition=value as Acquisition;assertScope(acquisition.scope);
   if(acquisition.source.kind!=='event'||acquisition.source.sequence!==acquisition.acquired_at_sequence)invalid('Acquisition provenance must match acquisition sequence');
   break;
  }
  case 'ActorKnowledgeQuery':actorQuery(value as ProjectionActorKnowledgeQuery);break;
  case 'CanonicalHistoryQuery':assertScope((value as ProjectionCanonicalHistoryQuery).scope);break;
  case 'DisclosedClaim':disclosed(value as DisclosedClaim);break;
  case 'ActorKnowledgeView':{
   const view=value as ProjectionActorKnowledgeView;actorQuery(view.query);flags(view.ontology_blocked,view.engagement_closed);
   sortedIds(view.claims.map(claim=>claim.claim_id),'Disclosed claim IDs');
   if((view.ontology_blocked||view.engagement_closed)&&view.claims.length)invalid('Projection cutoff views cannot release claim payloads');
   for(let index=0;index<view.claims.length;index++){
    const claim=view.claims[index]!;disclosed(claim);
    if(claim.acquired_at_tick>view.query.acquired_through_tick||claim.acquired_at_sequence>view.query.acquired_through_sequence)invalid('Disclosed claim exceeds the acquisition cutoff');
   }
   break;
  }
  case 'ReadPolicy':{
   const policy=value as ProjectionReadPolicy;prefix(policy.prefix);flags(policy.ontology_blocked,policy.engagement_closed);
   sortedIds(policy.party_ids,'Policy party IDs');break;
  }
  case 'IdEntries':sortedIds((value as ProjectionIdEntries).map(entry=>entry.id),'Entry IDs');break;
 }
}
function assertPrepared<K extends keyof ProjectionContractMap>(name:K,value:unknown):asserts value is ProjectionContractMap[K]{
 const validate=validators.get(name);
 if(!validate||!validate(value))invalid(`Invalid projection ${name} contract`);
 semantics(name,value);
}
export function assertProjectionContract<K extends keyof ProjectionContractMap>(name:K,value:unknown):asserts value is ProjectionContractMap[K]{
 safeInputs(name,value);
 if(typeof name!=='string')invalid('Invalid projection contract name');
 assertPrepared(name,value);
}

export type ProjectionReadContext={
 checkpoint:ProjectionCommonCheckpoint;
 policy:ProjectionReadPolicy|null;
 principal:Principal;
 genesis_world_time:number;
};
type CheckedContext=Omit<ProjectionReadContext,'policy'>&{policy:ProjectionReadPolicy};
function readContext(value:ProjectionReadContext):CheckedContext{
 if(value===null||typeof value!=='object'||Array.isArray(value))invalid('Projection read context must be an object');
 const expected=['checkpoint','genesis_world_time','policy','principal'];
 if(canonical(Object.keys(value).sort())!==canonical(expected))invalid('Projection read context has missing or extra fields');
 assertPrepared('CommonCheckpoint',value.checkpoint);assertContract('Principal',value.principal);
 if(value.policy===null)fail('UNAVAILABLE','A current trusted read policy is required');
 assertPrepared('ReadPolicy',value.policy);
 const common=value.checkpoint.prefix,policy=value.policy;
 requireScope(common.scope,value.principal.scope);requireScope(common.scope,policy.prefix.scope);
 if(policy.actor_id!==value.principal.actor_id||policy.actor_authorized!==true)fail('UNAUTHORIZED','Read policy does not authorize this principal actor');
 if(policy.prefix.sequence<common.sequence||policy.prefix.world_time<common.world_time)fail('CONFLICT','Read policy precedes the requested checkpoint');
 if(policy.prefix.sequence===common.sequence&&(policy.prefix.head!==common.head||policy.prefix.world_time!==common.world_time))fail('CONFLICT','Read policy disagrees with the checkpoint at the same sequence');
 if(!Number.isSafeInteger(value.genesis_world_time)||value.genesis_world_time<0||value.genesis_world_time>common.world_time)invalid('Invalid supported genesis world time');
 // Sequence/time dominance is a consistency check, not proof of ancestry or freshness.
 return {...value,policy};
}
function bindQuery(scope:Scope,checkpointId:string,context:CheckedContext):void{
 requireScope(scope,context.checkpoint.prefix.scope);
 if(checkpointId!==context.checkpoint.checkpoint_id)fail('CONFLICT','Projection query checkpoint does not match its context');
}
function actorRead(input:unknown,context:CheckedContext):ProjectionActorKnowledgeQuery{
 assertPrepared('ActorKnowledgeQuery',input);bindQuery(input.scope,input.checkpoint_id,context);
 if(input.actor_id!==context.principal.actor_id)fail('UNAUTHORIZED','Knowledge query actor does not match the principal');
 if(input.audience==='party'&&!context.policy.party_ids.includes(input.party_id!))fail('UNAUTHORIZED','Read policy does not authorize this party');
 if(input.acquired_through_tick<context.genesis_world_time||input.acquired_through_tick>context.checkpoint.prefix.world_time||input.acquired_through_sequence>context.checkpoint.prefix.sequence)invalid('Knowledge query cutoffs exceed the supported checkpoint interval');
 return input;
}
function canonicalRead(input:unknown,context:CheckedContext):ProjectionCanonicalHistoryQuery{
 assertPrepared('CanonicalHistoryQuery',input);bindQuery(input.scope,input.checkpoint_id,context);
 if(context.principal.role!=='system'||context.policy.canonical_read!==true)fail('UNAUTHORIZED','Canonical history requires a system principal and explicit read grant');
 if(input.valid_at_tick<context.genesis_world_time||input.valid_at_tick>context.checkpoint.prefix.world_time)invalid('Canonical query time exceeds the supported checkpoint interval');
 return input;
}
export function validateActorQuery(input:unknown,context:ProjectionReadContext):ProjectionActorKnowledgeQuery{
 safeInputs(input,context);
 const checked=readContext(structuredClone(context));
 return freezeDto(actorRead(structuredClone(input),checked));
}
export function validateCanonicalQuery(input:unknown,context:ProjectionReadContext):ProjectionCanonicalHistoryQuery{
 safeInputs(input,context);
 const checked=readContext(structuredClone(context));
 return freezeDto(canonicalRead(structuredClone(input),checked));
}
function rowArray(input:unknown):unknown[]{
 if(!Array.isArray(input)||input.length>MAX_ARRAY)invalid('Projection rows must be a bounded array');
 return input;
}
function sourceAt(source:Source,context:CheckedContext,hashes:Map<number,string>,allowFuture:boolean):void{
 if(source.kind==='genesis'){
  if(source.genesis_ref!==context.checkpoint.genesis_ref)invalid('Projection row refers to a different genesis');
  return;
 }
 const prefix=context.checkpoint.prefix;
 if(!allowFuture&&source.sequence>prefix.sequence)invalid('Projection source exceeds the checkpoint sequence');
 if(source.sequence===prefix.sequence&&source.event_hash!==prefix.head)invalid('Projection source disagrees with the known checkpoint tail');
 const previous=hashes.get(source.sequence);
 if(previous!==undefined&&previous!==source.event_hash)invalid('Projection rows disagree on an event hash at the same sequence');
 hashes.set(source.sequence,source.event_hash);
 // Historical event membership/signatures remain the trusted projector's responsibility.
}
function compareIds(a:string,b:string):number{return a<b?-1:a>b?1:0;}
function earlier(a:Acquisition,b:Acquisition):boolean{
 return a.acquired_at_sequence<b.acquired_at_sequence||
  a.acquired_at_sequence===b.acquired_at_sequence&&(
   a.acquired_at_tick<b.acquired_at_tick||a.acquired_at_tick===b.acquired_at_tick&&a.acquisition_id<b.acquisition_id);
}
export function buildActorView(input:unknown,context:ProjectionReadContext,claims:unknown,acquisitions:unknown):ProjectionActorKnowledgeView{
 safeInputs(input,context,claims,acquisitions);
 const checked=readContext(structuredClone(context)),query=actorRead(structuredClone(input),checked);
 const claimRows=rowArray(structuredClone(claims)),acquisitionRows=rowArray(structuredClone(acquisitions));
 const byClaim=new Map<string,Claim>(),acquisitionIds=new Set<string>(),hashes=new Map<number,string>(),eligible=new Map<string,Acquisition>();
 for(let index=0;index<claimRows.length;index++){
  const claim=claimRows[index];assertPrepared('EpistemicClaim',claim);requireScope(claim.scope,query.scope);
  if(byClaim.has(claim.claim_id))invalid('Duplicate epistemic claim ID');
  if(claim.occurred_at_tick>checked.checkpoint.prefix.world_time)invalid('Claim occurrence exceeds the checkpoint clock');
  sourceAt(claim.source,checked,hashes,false);byClaim.set(claim.claim_id,claim);
 }
 for(let index=0;index<acquisitionRows.length;index++){
  const acquisition=acquisitionRows[index];assertPrepared('Acquisition',acquisition);requireScope(acquisition.scope,query.scope);
  if(acquisitionIds.has(acquisition.acquisition_id))invalid('Duplicate acquisition ID');
  acquisitionIds.add(acquisition.acquisition_id);sourceAt(acquisition.source,checked,hashes,false);
  const prefix=checked.checkpoint.prefix;
  if(acquisition.acquired_at_tick<checked.genesis_world_time||acquisition.acquired_at_tick>prefix.world_time)invalid('Acquisition is outside the supported world-time interval');
  if(acquisition.acquired_at_sequence===prefix.sequence&&acquisition.acquired_at_tick!==prefix.world_time)invalid('Acquisition time disagrees with the known checkpoint tail');
  const claim=byClaim.get(acquisition.claim_id);
  if(!claim)invalid('Acquisition refers to an absent claim');
  if(claim.source.kind!=='event'||claim.source.sequence>acquisition.acquired_at_sequence||claim.occurred_at_tick>acquisition.acquired_at_tick)invalid('Acquisition precedes its claim source or occurrence');
  if(acquisition.knower_id!==query.actor_id||acquisition.acquired_at_tick>query.acquired_through_tick||acquisition.acquired_at_sequence>query.acquired_through_sequence||query.audience==='party'&&acquisition.party_id!==query.party_id)continue;
  const previous=eligible.get(acquisition.claim_id);
  if(!previous||earlier(acquisition,previous))eligible.set(acquisition.claim_id,acquisition);
 }
 const released:DisclosedClaim[]=[];
 if(!checked.policy.ontology_blocked&&!checked.policy.engagement_closed){
  for(const [claimId,acquisition] of eligible){
   const claim=byClaim.get(claimId)!;
   released.push({claim_id:claim.claim_id,channel:claim.channel,content:claim.content,occurred_at_tick:claim.occurred_at_tick,acquired_at_tick:acquisition.acquired_at_tick,acquired_at_sequence:acquisition.acquired_at_sequence});
  }
  released.sort((a,b)=>compareIds(a.claim_id,b.claim_id));
 }
 const view:ProjectionActorKnowledgeView={schema_version:'2.0.0',query,policy_id:checked.policy.policy_id,ontology_blocked:checked.policy.ontology_blocked,engagement_closed:checked.policy.engagement_closed,claims:released};
 assertPrepared('ActorKnowledgeView',view);return freezeDto(view);
}
export function selectCanonicalRelations(input:unknown,context:ProjectionReadContext,relations:unknown):ProjectionCanonicalRelationVersion[]{
 safeInputs(input,context,relations);
 const checked=readContext(structuredClone(context)),query=canonicalRead(structuredClone(input),checked),rows=rowArray(structuredClone(relations));
 const revisions=new Map<string,Set<string>>(),active=new Set<string>(),hashes=new Map<number,string>(),selected:ProjectionCanonicalRelationVersion[]=[];
 for(let index=0;index<rows.length;index++){
  const row=rows[index];assertPrepared('CanonicalRelationVersion',row);requireScope(row.scope,query.scope);
  const seen=revisions.get(row.relation_id)??new Set<string>();
  if(seen.has(row.revision_id))invalid('Duplicate canonical revision ID for a relation');
  seen.add(row.revision_id);revisions.set(row.relation_id,seen);sourceAt(row.source,checked,hashes,true);
  const sequence=checked.checkpoint.prefix.sequence,time=query.valid_at_tick;
  if(row.recorded_from_sequence>sequence||row.recorded_to_sequence!==null&&sequence>=row.recorded_to_sequence||row.valid_from_tick>time||row.valid_to_tick!==null&&time>=row.valid_to_tick)continue;
  if(active.has(row.relation_id))invalid('Multiple canonical revisions are active for one relation');
  active.add(row.relation_id);selected.push(row);
 }
 selected.sort((a,b)=>compareIds(a.relation_id,b.relation_id)||compareIds(a.revision_id,b.revision_id));
 return freezeDto(selected);
}
export function adaptV1KnowledgeQuery(input:unknown,checkpoint_id:string,request_id:string):ProjectionActorKnowledgeQuery{
 safeInputs(input,checkpoint_id,request_id);
 const old=structuredClone(input);assertContract('KnowledgeQuery',old);assertScope(old.scope);
 const query:ProjectionActorKnowledgeQuery={schema_version:'2.0.0',request_id,scope:old.scope,checkpoint_id,actor_id:old.actor_id,audience:old.audience,party_id:old.party_id,acquired_through_tick:old.as_of_world_time,acquired_through_sequence:old.as_of_sequence};
 assertPrepared('ActorKnowledgeQuery',query);return freezeDto(query);
}
export function encodeIdEntries(input:readonly (readonly [string,unknown])[]):ProjectionIdEntries{
 safeInputs(input);
 const tuples=rowArray(structuredClone(input)),seen=new Set<string>(),entries:{id:string;value:unknown}[]=[];
 for(let index=0;index<tuples.length;index++){
  const tuple=tuples[index];
  if(!Array.isArray(tuple)||tuple.length!==2||typeof tuple[0]!=='string')invalid('ID entries require data tuples containing an ID and value');
  const id=tuple[0];if(seen.has(id))invalid('Duplicate ID entry');seen.add(id);
  entries.push({id,value:tuple[1]});
 }
 entries.sort((a,b)=>compareIds(a.id,b.id));assertPrepared('IdEntries',entries);
 return freezeDto(entries);
}
