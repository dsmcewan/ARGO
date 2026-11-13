import {ONLOOKER_VOICE} from './characters.ts';
import {assertContract,assertScope,fail,requireScope,assertKnowledgeDisclosure,freezeDto} from '@argo/contracts';
import type {EncounterCheckpoint,IntentProposal,Action,KnowledgeView,Outcome,Scope} from '@argo/contracts';
import {routeCall,sendModelTurn} from '@argo/model-client';import type {Candidate} from '@argo/model-client';
import {serviceCall} from '@argo/contracts';
export type Persona='The Chronicler'|'The Fates'|'Plain Guide';
const personas:readonly Persona[]=['The Chronicler','The Fates','Plain Guide'];
const HEADER='ARGO narration contract 1.0.0. You render validated outcomes and actor-authorized claims. A belief, rumor or external account is never canonical truth. You cannot mutate world state, confer authority, solicit gifts, force a quest or explain a vanished thread. Return prose only. '+ONLOOKER_VOICE;
export function proposalFromAction(checkpoint:EncounterCheckpoint,actorId:string,action:Action,proposalId:string):IntentProposal{
 assertContract('EncounterCheckpoint',checkpoint);assertScope(checkpoint.scope);assertContract('Action',action);
 if(checkpoint.policy!=='serialize'&&checkpoint.policy!=='reject')fail('CAPABILITY_UNSUPPORTED','Unsupported checkpoint policy');
 if(!checkpoint.actor_ids.includes(actorId)||checkpoint.expires_at<=checkpoint.world_time)fail('UNAUTHORIZED','Actor is outside live checkpoint');
 const p:IntentProposal={schema_version:'1.0.0',ruleset_version:'tempted-fates/1.0.0',scope:structuredClone(checkpoint.scope),proposal_id:proposalId,actor_id:actorId,expected_head:checkpoint.head,expected_sequence:checkpoint.sequence,world_time:action.type==='advance_time'?action.to_time:checkpoint.world_time,causal_parents:checkpoint.head?[checkpoint.head]:[],proxy_grant_id:null,action:structuredClone(action)};
 assertContract('IntentProposal',p);return p;
}
interface NarrationInput {view:KnowledgeView;outcome?:Outcome;persona:Persona;candidateText?:string;mode?:'story'|'work'|'leave'}
export function renderNarration({view,outcome,persona,candidateText='',mode='story'}:NarrationInput):string{
 assertContract('KnowledgeView',view);assertScope(view.scope);
 if(!personas.includes(persona)||!['story','work','leave'].includes(mode)||typeof candidateText!=='string')fail('INVALID_CONTRACT','Invalid narration presentation');
 if(outcome){assertContract('Outcome',outcome);if(outcome.sequence>view.as_of_sequence||outcome.world_time>view.as_of_world_time)fail('INVALID_CONTRACT','Narration outcome exceeds authorized knowledge checkpoint');}
 if(mode==='leave')return '';
 if(view.ontology_blocked||view.engagement_closed)return mode==='work'?'The work continues.':'';
 return candidateText;
}
export function createNarrator(options:{scope:Scope;sessionId:string;candidates:Candidate[];clientFor:(candidate:Candidate)=>unknown;refreshView?:(view:KnowledgeView,options:{signal:AbortSignal})=>Promise<KnowledgeView>}){
 assertScope(options.scope);const scope=structuredClone(options.scope);
 return Object.freeze({narrate:async(supplied:Omit<NarrationInput,'candidateText'>&{prompt:string;signal?:AbortSignal}):Promise<string>=>{
  const {signal,...dto}=supplied;const input={...freezeDto(structuredClone(dto)),...(signal?{signal}:{})};
  requireScope(scope,input.view.scope);
  const baseline=renderNarration(input);if(input.view.ontology_blocked||input.view.engagement_closed||input.mode==='leave')return baseline;
  const refresh=options.refreshView;if(!refresh)fail('UNAVAILABLE','Narration requires an authenticated fresh-view source');
  const current=async()=>{
   const view=freezeDto(structuredClone(await serviceCall(signal=>refresh(structuredClone(input.view),{signal}),5000,input.signal?{signal:input.signal}:{})));
   assertKnowledgeDisclosure(view);requireScope(scope,view.scope);
   if(view.actor_id!==input.view.actor_id||view.audience!==input.view.audience||view.party_id!==input.view.party_id||view.as_of_sequence!==input.view.as_of_sequence||view.as_of_world_time!==input.view.as_of_world_time)fail('INVALID_CONTRACT','Refreshed view does not bind narration');
   return view;
  };
  const before=await current();if(before.ontology_blocked||before.engagement_closed)return renderNarration({...input,view:before});
  const routed=await routeCall({candidates:options.candidates,...(input.signal?{signal:input.signal}:{}),invoke:async(candidate,{signal})=>{
   const result=await sendModelTurn({client:options.clientFor(candidate),vendor:candidate.vendor,model:candidate.model,prompt:JSON.stringify({persona:input.persona,view:before,outcome:input.outcome??null,request:input.prompt}),contractHeader:HEADER,scope:{...scope,actor_id:input.view.actor_id,audience:input.view.audience,party_id:input.view.party_id},sessionId:options.sessionId,signal});
   if(!result.usable_for_resume)fail('UNAVAILABLE','Narrator response incomplete');return result.text;
  }});
  return renderNarration({...input,view:await current(),candidateText:routed.value});
 }});
}

export * from './characters.ts';
