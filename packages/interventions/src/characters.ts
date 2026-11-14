import {CHARACTER_PROFILE,assertCharacterContract,fail,freezeDto,serviceCall} from '@argo/contracts';
import type {CharacterCommand,CharacterCommandBody,CharacterExperience,CharacterImpression,CharacterView,ServiceOptions} from '@argo/contracts';

export interface CharacterInterpretationContext {
 view:CharacterView;
 subject_actor_id:string;
 evidence:readonly CharacterExperience[];
 previous:CharacterImpression|null;
}
export interface CharacterSpeechContext {view:CharacterView;record:CharacterExperience}
export interface CharacterAgentOptions {
 actorId:string;
 interpret:(context:CharacterInterpretationContext,options:{signal:AbortSignal})=>Promise<string|null>;
 speak:(context:CharacterSpeechContext,options:{signal:AbortSignal})=>Promise<string|null>;
 timeoutMs?:number;
}
function cancelled(call:ServiceOptions):void{if(call.signal?.aborted)fail('CANCELLED','Character planning cancelled');}

/** This planner receives an actor DTO and returns untrusted commands only.
 * It cannot acquire an archive, authenticate an actor or append an event. The
 * host must refresh the view before planning a second command after a commit.
 */
export function createCharacterAgent(options:CharacterAgentOptions){
 const {actorId,interpret,speak}=options,timeout=options.timeoutMs??5000;
 if(typeof actorId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(actorId)||
   typeof interpret!=='function'||typeof speak!=='function'||!Number.isSafeInteger(timeout)||timeout<1||timeout>60000)
  fail('INVALID_CONTRACT','Invalid character planner configuration');
 const read=(input:CharacterView,call:ServiceOptions):CharacterView=>{
  cancelled(call);assertCharacterContract('CharacterView',input);
  if(input.query.actor_id!==actorId)fail('UNAUTHORIZED','Character view belongs to another observer');
  return freezeDto(structuredClone(input));
 };
 const command=(view:CharacterView,requestId:string,body:unknown):CharacterCommand=>{
  const value:unknown={version:CHARACTER_PROFILE,scope:view.query.scope,request_id:requestId,expected_cursor:view.query.cursor,body};
  assertCharacterContract('CharacterCommand',value);return freezeDto(structuredClone(value));
 };
 const active=(view:CharacterView):boolean=>view.alive&&view.profile!==null&&!view.ontology_blocked&&!view.engagement_closed;
 return Object.freeze({
  impress:async(input:CharacterView,subjectActorId:string,evidenceIds:readonly string[],requestId:string,call:ServiceOptions={}):Promise<CharacterCommand|null>=>{
   const view=read(input,call);
   const prepared=command(view,requestId,{type:'form_impression',subject_actor_id:subjectActorId,evidence_ids:evidenceIds,interpretation:'pending',previous_impression_id:null});
   if(!active(view))return null;
   if(prepared.body.type!=='form_impression')fail('INVALID_CONTRACT','Invalid impression preparation');
   const body=prepared.body,evidence=body.evidence_ids.map(id=>{
    const item=view.experiences.find(record=>record.record_id===id);
    if(!item||item.actor_id!==body.subject_actor_id)fail('UNAUTHORIZED','Impression evidence is not acquired about this subject');
    return item;
   });
   const previous=view.impressions.find(row=>row.data.subject_actor_id===body.subject_actor_id)??null;
   const context=freezeDto({view,subject_actor_id:body.subject_actor_id,evidence,previous});
   const text=await serviceCall(signal=>interpret(context,{signal}),timeout,call);cancelled(call);
   if(text===null)return null;
   return command(view,requestId,{...body,interpretation:text,previous_impression_id:previous?.impression_id??null});
  },
  respond:async(input:CharacterView,recordId:string,requestId:string,call:ServiceOptions={}):Promise<CharacterCommand|null>=>{
   const view=read(input,call);
   command(view,requestId,{type:'speak',text:'pending',addressed_actor_ids:[]});
   if(typeof recordId!=='string'||!/^[0-9a-f]{64}$/.test(recordId))fail('INVALID_CONTRACT','Invalid addressed record identity');
   if(!active(view))return null;
   const profile=view.profile!,record=view.experiences.find(item=>item.record_id===recordId),now=view.query.cursor.world_time;
   if(!record||record.actor_id===actorId||!record.addressed_actor_ids.includes(actorId)||profile.activity.busy_until>now||
     (view.last_spoke_at!==null&&now-view.last_spoke_at<profile.speech_policy.minimum_interval))return null;
   const text=await serviceCall(signal=>speak(freezeDto({view,record}),{signal}),timeout,call);cancelled(call);
   if(text===null)return null;
   if(typeof text!=='string'||[...text].length>profile.speech_policy.max_characters)fail('INVALID_CONTRACT','Speech exceeds the configured character budget');
   const body:CharacterCommandBody={type:'speak',text,addressed_actor_ids:[record.actor_id]};
   return command(view,requestId,body);
  },
 });
}
