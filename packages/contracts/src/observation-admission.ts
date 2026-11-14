/** Transient host admission only. These guards neither authenticate a host nor
 * add witness evidence to frozen v1 events, receipts or historical replay. */
import {Ajv2020} from 'ajv/dist/2020.js';
import {types as nodeTypes} from 'node:util';
import v1 from '../../../SYSTEMS/argo-v1.schema.json' with {type:'json'};
import definition from '../../../SYSTEMS/observation-admission-v1/observation-admission.schema.json' with {type:'json'};
import {assertContract,assertScope,canonical,fail,freezeDto,hash,requireScope} from './index.ts';
import type {Action_observe_claim,IntentProposal,Principal,Scope,Snapshot} from './generated.ts';

export const OBSERVATION_ADMISSION_PROFILE='observation-admission/1.0.0' as const;
export type ObservationProposal=Omit<IntentProposal,'action'>&{action:Action_observe_claim};
export interface ObservationAdmissionCursor {sequence:number;head:string|null;world_time:number}
export interface ObservationAdmissionAttempt {attempt_id:string;issued_at_ms:number;deadline_ms:number}
export interface ObservationAdmissionRequest {
 version:typeof OBSERVATION_ADMISSION_PROFILE;proposal:ObservationProposal;principal:Principal;
 attempt:ObservationAdmissionAttempt;request_hash:string;
}
export interface ObservationWitnessGrant {
 version:typeof OBSERVATION_ADMISSION_PROFILE;request_hash:string;attempt_id:string;deadline_ms:number;
 scope:Scope;cursor:ObservationAdmissionCursor;source_id:string;observers:string[];party_id:string|null;
}
export type ObservationWitnessVerifier=(request:ObservationAdmissionRequest,snapshot:Snapshot,options:{signal:AbortSignal})=>Promise<ObservationWitnessGrant|null>;
export interface ObservationAdmissionContractMap {
 ObservationProposal:ObservationProposal;ObservationAdmissionCursor:ObservationAdmissionCursor;
 ObservationAdmissionAttempt:ObservationAdmissionAttempt;ObservationAdmissionRequest:ObservationAdmissionRequest;ObservationWitnessGrant:ObservationWitnessGrant;
}
export const observationAdmissionSchema=freezeDto(definition);
const ajv=new Ajv2020({allErrors:true,strict:true});ajv.addSchema(v1);ajv.addSchema(observationAdmissionSchema);
const validators=new Map(Object.keys(observationAdmissionSchema.$defs).map(name=>[name,ajv.compile({$ref:`${observationAdmissionSchema.$id}#/$defs/${name}`})]));
function invalid(message:string):never{return fail('INVALID_CONTRACT',message);}

function passive(value:unknown):void{
 const active=new Set<object>();let nodes=0,bytes=0;
 const visit=(item:unknown,depth:number):void=>{
  if(++nodes>8192||depth>32)invalid('Observation admission DTO exceeds its structural bounds');
  if(typeof item==='string'){bytes+=Buffer.byteLength(item,'utf8');if(bytes>1024*1024)invalid('Observation admission DTO exceeds its text bound');return;}
  if(item===null||typeof item==='boolean')return;
  if(typeof item==='number'){if(!Number.isSafeInteger(item)||Object.is(item,-0))invalid('Observation admission requires safe integers');return;}
  if(typeof item!=='object'||nodeTypes.isProxy(item))invalid('Observation admission requires passive JSON data');
  if(active.has(item))invalid('Observation admission cannot contain a cycle');
  const array=Array.isArray(item),prototype=Object.getPrototypeOf(item);
  if(array?prototype!==Array.prototype:prototype!==Object.prototype&&prototype!==null)invalid('Observation admission requires plain containers');
  const keys=Reflect.ownKeys(item);if(keys.length>8192)invalid('Observation admission container exceeds its structural bound');
  const descriptors=Object.getOwnPropertyDescriptors(item);
  if(keys.some(key=>typeof key!=='string'))invalid('Observation admission cannot contain symbols');
  active.add(item);
  try{
   if(array){
    const length=descriptors.length;
    if(!length||!('value'in length)||keys.length!==length.value+1)invalid('Observation admission arrays must be dense and undecorated');
    for(let index=0;index<length.value;index++){
     const entry=descriptors[String(index)];if(!entry?.enumerable||!('value'in entry))invalid('Observation admission contains an active array entry');
     visit(entry.value,depth+1);
    }
   }else for(const key of keys as string[]){
    const entry=descriptors[key];
    if(['__proto__','constructor','prototype'].includes(key)||!entry?.enumerable||!('value'in entry))invalid('Observation admission contains an unsafe property');
    bytes+=Buffer.byteLength(key,'utf8');if(bytes>1024*1024)invalid('Observation admission DTO exceeds its text bound');
    visit(entry.value,depth+1);
   }
  }finally{active.delete(item);}
 };
 visit(value,0);
}
function shape(name:string,value:unknown):void{
 const check=validators.get(name);if(!check||!check(value))invalid(`Invalid ${name} contract`);
}
function cursor(value:ObservationAdmissionCursor):void{if((value.sequence===0)!==(value.head===null))invalid('Observation cursor head and sequence disagree');}
function window(value:ObservationAdmissionAttempt):void{
 if(value.deadline_ms<=value.issued_at_ms||value.deadline_ms-value.issued_at_ms>5000)invalid('Observation attempt must last between one and 5000 milliseconds');
}
function author(proposal:ObservationProposal,principal:Principal):void{
 assertScope(proposal.scope);assertContract('Principal',principal);requireScope(proposal.scope,principal.scope);
 cursor({sequence:proposal.expected_sequence,head:proposal.expected_head,world_time:proposal.world_time});
 if(proposal.proxy_grant_id!==null||proposal.actor_id!==principal.actor_id||proposal.action.observation.source_id!==proposal.actor_id)fail('UNAUTHORIZED','Observation requires its direct authenticated author');
}
function identity(proposal:ObservationProposal,principal:Principal,attempt:ObservationAdmissionAttempt):string{
 return hash({domain:OBSERVATION_ADMISSION_PROFILE,proposal,principal,attempt});
}
export function assertObservationAdmissionContract<K extends keyof ObservationAdmissionContractMap>(name:K,value:unknown):asserts value is ObservationAdmissionContractMap[K]{
 passive(value);shape(name,value);
 switch(name){
 case 'ObservationProposal':{const p=value as ObservationProposal;assertScope(p.scope);cursor({sequence:p.expected_sequence,head:p.expected_head,world_time:p.world_time});break;}
 case 'ObservationAdmissionCursor':cursor(value as ObservationAdmissionCursor);break;
 case 'ObservationAdmissionAttempt':window(value as ObservationAdmissionAttempt);break;
 case 'ObservationAdmissionRequest':{
  const request=value as ObservationAdmissionRequest;author(request.proposal,request.principal);window(request.attempt);
  if(request.request_hash!==identity(request.proposal,request.principal,request.attempt))invalid('Observation request hash differs from its complete request');break;
 }
 case 'ObservationWitnessGrant':{const grant=value as ObservationWitnessGrant;assertScope(grant.scope);cursor(grant.cursor);break;}
 }
}
/** Locally decidable author/default checks only; no actor existence, party
 * membership, scene perception, current-head check or append is performed. */
export function observationNeedsWitness(proposal:unknown,principal:unknown):boolean{
 passive({proposal,principal});shape('ObservationProposal',proposal);
 const p=proposal as ObservationProposal,auth=principal as Principal;author(p,auth);
 const o=p.action.observation;return o.party_id!==null||o.observers.length!==1||o.observers[0]!==auth.actor_id;
}
export function observationRequestHash(proposal:unknown,principal:unknown,attempt:unknown):string{
 passive({proposal,principal,attempt});observationNeedsWitness(proposal,principal);
 assertObservationAdmissionContract('ObservationAdmissionAttempt',attempt);
 return identity(proposal as ObservationProposal,principal as Principal,attempt);
}
export function createObservationAdmissionRequest(proposal:unknown,principal:unknown,attempt:unknown):ObservationAdmissionRequest{
 const request_hash=observationRequestHash(proposal,principal,attempt);
 const request={version:OBSERVATION_ADMISSION_PROFILE,proposal,principal,attempt,request_hash};
 assertObservationAdmissionContract('ObservationAdmissionRequest',request);return freezeDto(structuredClone(request));
}
/** A trusted callback must supply the grant. Matching these fields proves only
 * its binding and lifetime, never the callback's authenticity or perception. */
export function assertObservationWitnessGrant(value:unknown,request:ObservationAdmissionRequest,nowMs:number):asserts value is ObservationWitnessGrant{
 assertObservationAdmissionContract('ObservationAdmissionRequest',request);assertObservationAdmissionContract('ObservationWitnessGrant',value);
 if(!Number.isSafeInteger(nowMs)||nowMs<0||Object.is(nowMs,-0))invalid('Observation validation time must be a safe nonnegative integer');
 const p=request.proposal,o=p.action.observation;
 if(value.request_hash!==request.request_hash||value.attempt_id!==request.attempt.attempt_id||value.deadline_ms!==request.attempt.deadline_ms||canonical(value.scope)!==canonical(p.scope)||canonical(value.cursor)!==canonical({sequence:p.expected_sequence,head:p.expected_head,world_time:p.world_time})||value.source_id!==o.source_id||canonical(value.observers)!==canonical(o.observers)||value.party_id!==o.party_id)fail('UNAUTHORIZED','Observation witness grant does not bind the exact request');
 if(nowMs<request.attempt.issued_at_ms||nowMs>=request.attempt.deadline_ms)fail('EXPIRED','Observation witness authorization is outside its attempt window');
}
