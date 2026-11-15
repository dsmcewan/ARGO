import {Buffer} from 'node:buffer';
import {types as nodeTypes} from 'node:util';
import {assertCharacterContract,canonical,fail,freezeDto} from '@argo/contracts';
import type {CharacterActorQuery,CharacterNature,CharacterView} from '@argo/contracts';
import type {DialogueSupplement} from './dialogue-types.ts';
import {assertAuthoredKnowledgeContract} from '../../contracts/src/dialogue-knowledge.ts';

function invalid(message:string):never{return fail('INVALID_CONTRACT',message);}
const id=/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/;

/** Inspect descriptors before reading values; caller-labelled facts confer no authority. */
function passive(value:unknown):void{
 let nodes=0,bytes=0;const active=new Set<object>();
 const visit=(item:unknown,depth:number):void=>{
  if(++nodes>4096||depth>16)invalid('Dialogue data exceeds structural limits');
  if(typeof item==='string'){bytes+=Buffer.byteLength(item);if(bytes>131072)invalid('Dialogue data exceeds byte limit');return;}
  if(item===null||typeof item==='boolean')return;
  if(typeof item==='number'){if(!Number.isSafeInteger(item)||Object.is(item,-0))invalid('Dialogue numbers must be safe integers');return;}
  if(typeof item!=='object'||nodeTypes.isProxy(item))invalid('Dialogue requires passive JSON data');
  if(active.has(item))invalid('Dialogue data contains a cycle');
  const array=Array.isArray(item),prototype=Object.getPrototypeOf(item);
  if(array?prototype!==Array.prototype:prototype!==Object.prototype&&prototype!==null)invalid('Dialogue requires plain objects');
  const keys=Reflect.ownKeys(item),descriptors=Object.getOwnPropertyDescriptors(item);
  if(keys.some(key=>typeof key!=='string'))invalid('Dialogue data contains a symbol');
  active.add(item);
  try{
   if(array){
    const length=descriptors.length?.value;
    if(!Number.isSafeInteger(length)||length<0||keys.length!==length+1)invalid('Dialogue arrays must be dense');
    for(let i=0;i<length;i++){const d=descriptors[String(i)];if(!d?.enumerable||!('value'in d))invalid('Dialogue array contains an accessor');visit(d.value,depth+1);}
   }else for(const key of keys as string[]){
    const d=descriptors[key];if(['__proto__','constructor','prototype'].includes(key)||!d?.enumerable||!('value'in d))invalid('Dialogue contains an unsafe property');
    visit(d.value,depth+1);
   }
  }finally{active.delete(item);}
 };
 visit(value,0);
}
function object(value:unknown,keys:string[]):asserts value is Record<string,unknown>{
 if(value===null||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key)))invalid('Dialogue object fields differ from the contract');
}
function text(value:unknown,max:number):asserts value is string{
 if(typeof value!=='string'||!value.trim()||[...value].length>max)invalid('Dialogue text is empty or over its character limit');
}
function identifier(value:unknown):asserts value is string{if(typeof value!=='string'||!id.test(value))invalid('Invalid dialogue identity');}

export function validateDialogueSupplement(input:unknown,query:CharacterActorQuery):DialogueSupplement|null{
 if(input===null)return null;
 passive(input);
 if(typeof input==='object'&&input!==null&&'version'in input&&input.version==='character-dialogue/0.2.0'){
  assertAuthoredKnowledgeContract('DialogueSupplementV2',input);assertCharacterContract('CharacterActorQuery',query);
  if(canonical(input.query)!==canonical(query))fail('UNAUTHORIZED','Dialogue supplement must bind the complete actor query');
  return freezeDto(structuredClone(input));
 }
 object(input,['version','query','source','actor','scene']);
 if(input.version!=='character-dialogue/0.1.0')invalid('Unsupported dialogue presentation version');
 assertCharacterContract('CharacterActorQuery',input.query);
 if(canonical(input.query)!==canonical(query))fail('UNAUTHORIZED','Dialogue supplement must bind the complete actor query');
 object(input.source,['content_hash','revision']);
 if(typeof input.source.content_hash!=='string'||!/^[0-9a-f]{64}$/.test(input.source.content_hash))invalid('Dialogue source requires SHA-256 identity');
 text(input.source.revision,96);
 if(input.actor!==null){
  object(input.actor,['actor_id','name','occupation','wants','will_not']);identifier(input.actor.actor_id);
  if(input.actor.actor_id!==query.actor_id)fail('UNAUTHORIZED','Private dialogue goals belong to another actor');
  text(input.actor.name,256);text(input.actor.occupation,512);text(input.actor.wants,2048);text(input.actor.will_not,2048);
 }
 if(input.scene!==null){object(input.scene,['location_id','name','description']);identifier(input.scene.location_id);text(input.scene.name,256);text(input.scene.description,8192);}
 return freezeDto(structuredClone(input)) as unknown as DialogueSupplement;
}

export function validateCommunicationGoal(value:unknown):string|null{
 if(value===undefined)return null;text(value,512);return value;
}

export function dialoguePacket(view:CharacterView,supplement:DialogueSupplement|null,task:'speech'|'impression',subjectActorId:string,recordIds:readonly string[],communicationGoal:string|null){
 const profile=view.profile;if(!profile)invalid('Dialogue requires a configured character');
 const definitions=new Map<string,{owner_actor_id:string;revision:number;nature:CharacterNature}>();
 const nature=(owner:string,revision:number,value:CharacterNature):string=>{
  const key=owner+':'+revision,previous=definitions.get(key);
  if(previous&&canonical(previous.nature)!==canonical(value))invalid('Conflicting nature definitions for one actor revision');
  if(!previous)definitions.set(key,{owner_actor_id:owner,revision,nature:value});return key;
 };
 const currentNature=nature(profile.actor_id,profile.revision,profile.nature);
 const selected=view.impressions.filter(row=>row.data.subject_actor_id===subjectActorId);
 const impressions=selected.map(row=>({impression_id:row.impression_id,sequence:row.sequence,world_time:row.world_time,
  owner_actor_id:row.data.owner_actor_id,subject_actor_id:row.data.subject_actor_id,evidence_ids:row.data.evidence_ids,
  nature_ref:nature(row.data.owner_actor_id,row.data.nature_revision,row.data.nature),interpretation:row.data.interpretation,previous_impression_id:row.data.previous_impression_id}));
 // The DTO is fully query-bound; the packet carries that identical query once.
 const selectedKnowledge=supplement?.version==='character-dialogue/0.2.0'&&supplement.actor_knowledge!==null?
  (({query:_,...value})=>value)(supplement.actor_knowledge):null;
 return {version:supplement?.version??'character-dialogue/0.1.0',task,query:view.query,
  character:{actor_id:profile.actor_id,profile_revision:profile.revision,nature_ref:currentNature,activity:profile.activity,speech_policy:profile.speech_policy},
  nature_definitions:Object.fromEntries(definitions),experiences:view.experiences,impressions,
  subject_actor_id:subjectActorId,focus_record_ids:recordIds,communication_goal:communicationGoal,
  supplement:supplement?{source:supplement.source,actor:supplement.actor,scene:supplement.scene,...(supplement.version==='character-dialogue/0.2.0'?{actor_knowledge:selectedKnowledge}:{})}:null,
  coverage:{acquired_experiences_in_view:view.experiences.length,omitted_impressions:view.impressions.length-selected.length,archive_is_complete:false}};
}

export function parseDialogueResponse(raw:string,maxCharacters:number):string|null{
 if(Buffer.byteLength(raw)>32768)invalid('Dialogue response exceeds its byte budget');
 let value:unknown;try{value=JSON.parse(raw);}catch{invalid('Dialogue response must be one JSON object');}
 passive(value);object(value,['text']);if(value.text===null)return null;text(value.text,maxCharacters);return value.text;
}
