// Additive wire guards only: authentication, freshness, signatures and append
// permissions remain authority/host responsibilities, not JSON properties.
import {Ajv2020} from 'ajv/dist/2020.js';
import {types as nodeTypes} from 'node:util';
import v1 from '../../../SYSTEMS/argo-v1.schema.json' with {type:'json'};
import definition from '../../../SYSTEMS/characters-v1/characters.schema.json' with {type:'json'};
import {assertContract,assertScope,canonical,fail,hash,requireScope} from './index.ts';
import type {Principal,Scope} from './generated.ts';
import type {CharacterContractMap,CharacterCommand,CharacterCursor,CharacterEnvelope,CharacterExperience,CharacterMemoryRecord,CharacterImpression,CharacterProjection,CharacterActorQuery,CharacterView,CharacterNarratorQuery,CharacterNarratorView,CharacterReceipt} from './character-types.ts';

export const CHARACTER_PROFILE='character-memory/1.0.0' as const;
export const CHARACTER_CLAIM_PREFIX='argo_character_' as const;
function freeze<T>(value:T):T{if(value!==null&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;}
export const characterSchema=freeze(definition);
const ajv=new Ajv2020({allErrors:true,strict:true});ajv.addSchema(v1);ajv.addSchema(characterSchema);
const validators=new Map(Object.keys(characterSchema.$defs).map(name=>[name,ajv.compile({$ref:`${characterSchema.$id}#/$defs/${name}`})]));
function invalid(message:string):never{return fail('INVALID_CONTRACT',message);}

// Depth bounds protect traversal. Complete history collections deliberately have
// no lifetime count/byte cap; public page and command bounds live in the schema.
function passive(value:unknown,active=new Set<object>(),depth=0):void{
 if(depth>32)invalid('Character DTO nesting exceeds its structural bound');
 if(value===null||typeof value==='string'||typeof value==='boolean')return;
 if(typeof value==='number'){if(!Number.isSafeInteger(value)||Object.is(value,-0))invalid('Character DTO requires safe integers');return;}
 if(typeof value!=='object')invalid('Character DTO requires JSON data');
 if(nodeTypes.isProxy(value))invalid('Character DTO cannot contain a proxy');
 if(active.has(value))invalid('Character DTO cannot contain a cycle');
 const array=Array.isArray(value),prototype=Object.getPrototypeOf(value);
 if(array?prototype!==Array.prototype:prototype!==Object.prototype&&prototype!==null)invalid('Character DTO requires plain objects and arrays');
 const descriptors=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(value);
 if(keys.some(key=>typeof key!=='string'))invalid('Character DTO cannot contain symbols');
 active.add(value);
 try{
  if(array){
   const length=descriptors.length;
   if(!length||!('value'in length)||!Number.isSafeInteger(length.value)||length.value<0||keys.length!==length.value+1)invalid('Character DTO arrays must be dense and undecorated');
   for(let i=0;i<length.value;i++){const d=descriptors[String(i)];if(!d||!d.enumerable||!('value'in d))invalid('Character DTO contains an active array entry');passive(d.value,active,depth+1);}
  }else for(const key of keys as string[]){
   const d=descriptors[key];
   if(['__proto__','constructor','prototype'].includes(key)||!d||!d.enumerable||!('value'in d))invalid('Character DTO contains an unsafe property');
   passive(d.value,active,depth+1);
  }
 }finally{active.delete(value);}
}
function cursor(value:CharacterCursor):void{if((value.sequence===0)!==(value.head===null))invalid('Character cursor head and sequence disagree');}
function flags(value:{ontology_blocked:boolean;engagement_closed:boolean}):void{if(value.engagement_closed&&!value.ontology_blocked)invalid('Closed character engagement requires ontology cutoff');}
function unique(values:readonly string[],what:string):void{if(new Set(values).size!==values.length)invalid(`Duplicate ${what}`);}
function within(sequence:number,worldTime:number,end:CharacterCursor):void{if(sequence>end.sequence||worldTime>end.world_time)invalid('Character record exceeds its cursor');}
function experience(value:CharacterExperience):void{
 if(value.kind==='speech'){
  if(value.action_type!==null||value.actor_id!==value.principal_actor_id)invalid('Speech requires its authenticated direct speaker');
 }else if(value.action_type===null||value.addressed_actor_ids.length)invalid('Action experience requires its committed action type and no invented addressing');
}
function experiences(values:CharacterExperience[],end:CharacterCursor):void{
 let prior=0;const ids:string[]=[];
 for(const value of values){experience(value);within(value.sequence,value.world_time,end);if(value.sequence<=prior)invalid('Character experiences require increasing source sequence');prior=value.sequence;ids.push(value.record_id);}
 unique(ids,'character record ID');
}
function memory(value:CharacterMemoryRecord):void{
 experience(value.experience);const keys:string[]=[];
 for(const acquisition of value.acquisitions){
  if(acquisition.sequence<value.experience.sequence||acquisition.world_time<value.experience.world_time)invalid('Character acquisition predates its source');
  keys.push(canonical(acquisition));
 }
 unique(keys,'character acquisition');
}
function impression(value:CharacterImpression):void{if(value.impression_id===value.data.previous_impression_id)invalid('An impression cannot be its own predecessor');}
function envelope(value:CharacterEnvelope):void{
 assertScope(value.scope);const body=value.body,requester=value.requester;
 if(body.type==='configure'||body.type==='witness_action'){
  if(requester.role!=='system')invalid('Character host command requires a system requester');
 }else if(requester.role!=='player'&&requester.role!=='npc')invalid('Character activity requires a direct player or NPC');
 if((body.type==='speak'||body.type==='set_activity')&&body.actor_id!==requester.actor_id)invalid('Character envelope actor differs from authenticated requester');
 if(body.type==='form_impression'&&body.data.owner_actor_id!==requester.actor_id)invalid('Impression owner differs from authenticated requester');
 if(body.type==='speak'||body.type==='witness_action'){
  if(body.witnesses.request_hash!==value.request_hash)invalid('Witness grant does not bind this request');
  if(body.type==='speak'&&!body.witnesses.actor_ids.includes(body.actor_id))invalid('Speech witness grant must include its speaker');
 }
 if(canonical(value).length>65536)invalid('Character envelope exceeds the v1 carrier content bound');
}
function projection(value:CharacterProjection):void{
 assertScope(value.scope);cursor(value.cursor);flags(value);
 if(value.activation_sequence!==null&&value.activation_sequence>value.cursor.sequence)invalid('Character activation exceeds cursor');
 if(value.activation_sequence===null&&(value.profiles.length||value.records.length||value.impressions.length))invalid('Inactive character projection cannot contain captured state');
 unique(value.actors.map(actor=>actor.actor_id),'character actor');unique(value.profiles.map(profile=>profile.actor_id),'character profile');unique(value.parties.map(party=>party.party_id),'character party');
 const actors=new Set(value.actors.map(actor=>actor.actor_id));
 for(const profile of value.profiles)if(!actors.has(profile.actor_id))invalid('Profile actor is missing');
 for(const party of value.parties)for(const actor of party.actor_ids)if(!actors.has(actor))invalid('Party actor is missing');
 experiences(value.records.map(record=>record.experience),value.cursor);
 for(const record of value.records){
  memory(record);
  if(!actors.has(record.experience.actor_id)||!actors.has(record.experience.principal_actor_id))invalid('Experience actor is missing');
  if(value.activation_sequence!==null&&record.experience.sequence<value.activation_sequence)invalid('Experience predates capture activation');
  for(const acquisition of record.acquisitions){within(acquisition.sequence,acquisition.world_time,value.cursor);if(!actors.has(acquisition.actor_id))invalid('Acquisition actor is missing');}
 }
 unique(value.impressions.map(row=>row.impression_id),'character impression');
 for(const row of value.impressions){impression(row);within(row.sequence,row.world_time,value.cursor);if(!actors.has(row.data.owner_actor_id)||!actors.has(row.data.subject_actor_id))invalid('Impression actor is missing');}
}
function actorQuery(value:CharacterActorQuery):void{assertScope(value.scope);cursor(value.cursor);}
function actorView(value:CharacterView):void{
 actorQuery(value.query);flags(value);
 if(value.profile!==null&&value.profile.actor_id!==value.query.actor_id)invalid('Character view profile does not bind its actor');
 if(value.last_spoke_at!==null&&value.last_spoke_at>value.query.cursor.world_time)invalid('Character speech time exceeds cursor');
 experiences(value.experiences,value.query.cursor);
 unique(value.impressions.map(row=>row.data.subject_actor_id),'latest impression subject');
 for(const row of value.impressions){impression(row);within(row.sequence,row.world_time,value.query.cursor);if(row.data.owner_actor_id!==value.query.actor_id)invalid('Character view exposes another observer impression');}
}
function narratorQuery(value:CharacterNarratorQuery):void{
 assertScope(value.scope);cursor(value.cursor);
 if(value.audience==='actor'?(value.party_id!==null||value.actor_id!==value.traveler_id):value.party_id===null)invalid('Narrator audience and identity disagree');
 if(value.after_sequence>value.cursor.sequence)invalid('Narrator page starts after its cursor');
}
function narratorView(value:CharacterNarratorView):void{
 narratorQuery(value.query);flags(value);experiences(value.records,value.query.cursor);
 if(value.coverage.through_sequence!==value.query.cursor.sequence)invalid('Narrator coverage differs from requested prefix');
 if(value.coverage.activation_sequence!==null&&value.coverage.activation_sequence>value.coverage.through_sequence)invalid('Narrator activation exceeds coverage');
 if(value.records.length>value.query.limit)invalid('Narrator page exceeds its requested bound');
 for(const record of value.records){
  if(record.actor_id!==value.query.traveler_id||record.sequence<=value.query.after_sequence)invalid('Narrator page exceeds its traveler or pagination scope');
  if(value.coverage.activation_sequence===null||record.sequence<value.coverage.activation_sequence)invalid('Narrator record predates capture coverage');
 }
 if(value.next_after_sequence!==null&&value.next_after_sequence!==value.records.at(-1)?.sequence)invalid('Narrator continuation must name the last visible record');
 if((value.ontology_blocked||value.engagement_closed)&&(value.records.length||value.next_after_sequence!==null))invalid('Narrator cutoff must suppress records and continuation');
}
function receipt(value:CharacterReceipt):void{assertScope(value.scope);cursor(value.cursor);if(value.cursor.head!==value.event_hash||value.event_id!==`event_${value.cursor.sequence}`)invalid('Character receipt does not bind its committed event');}

export function assertCharacterContract<K extends keyof CharacterContractMap>(name:K,value:unknown):asserts value is CharacterContractMap[K]{
 passive(value);canonical(value);const validate=validators.get(name);
 if(!validate||!validate(value))invalid(`Invalid ${name} contract`);
 switch(name){
 case 'CharacterCursor':cursor(value as CharacterCursor);break;
 case 'CharacterCommand':{const command=value as CharacterCommand;assertScope(command.scope);cursor(command.expected_cursor);break;}
 case 'CharacterEnvelope':envelope(value as CharacterEnvelope);break;
 case 'CharacterExperience':experience(value as CharacterExperience);break;
 case 'CharacterMemoryRecord':memory(value as CharacterMemoryRecord);break;
 case 'CharacterImpression':impression(value as CharacterImpression);break;
 case 'CharacterProjection':projection(value as CharacterProjection);break;
 case 'CharacterActorQuery':actorQuery(value as CharacterActorQuery);break;
 case 'CharacterView':actorView(value as CharacterView);break;
 case 'CharacterNarratorQuery':narratorQuery(value as CharacterNarratorQuery);break;
 case 'CharacterNarratorView':narratorView(value as CharacterNarratorView);break;
 case 'CharacterReceipt':receipt(value as CharacterReceipt);break;
 }
}
export function assertCharacterPrincipal(value:unknown):asserts value is Principal{
 passive(value);assertContract('Principal',value);assertScope(value.scope);
}
export function characterRequestHash(command:CharacterCommand,principal:Principal):string{
 assertCharacterContract('CharacterCommand',command);assertCharacterPrincipal(principal);requireScope(command.scope,principal.scope);
 return hash({command,principal:{principal_id:principal.principal_id,actor_id:principal.actor_id,role:principal.role,scope:principal.scope}});
}
export function characterProposalId(scope:Scope,requestId:string):string{
 passive(scope);assertScope(scope);if(typeof requestId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(requestId))invalid('Invalid character request identity');
 return CHARACTER_CLAIM_PREFIX+hash({scope,request_id:requestId});
}
