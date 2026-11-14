import {assertContract,requireScope,fail,assertKnowledgeDisclosure,canonical} from '@argo/contracts';import type {KnowledgeView,EncounterCheckpoint,IntentProposal} from '@argo/contracts';
import {serviceCall,freezeDto} from '@argo/contracts';import type {ServiceOptions} from '@argo/contracts';
export interface DerivedContext {view:KnowledgeView;checkpoint:EncounterCheckpoint}
export function createProposalSubscriber(options:{actorId:string;plan:(context:DerivedContext,options:{signal:AbortSignal})=>Promise<readonly IntentProposal[]>;timeoutMs?:number}){
 return Object.freeze({onView:async(input:DerivedContext,call:ServiceOptions={}):Promise<readonly IntentProposal[]>=>{
  canonical(input);const context=freezeDto(structuredClone(input));
  assertKnowledgeDisclosure(context.view);assertContract('EncounterCheckpoint',context.checkpoint);requireScope(context.view.scope,context.checkpoint.scope);
  if(context.checkpoint.policy!=='serialize'&&context.checkpoint.policy!=='reject')fail('CAPABILITY_UNSUPPORTED','Subscriber checkpoint policy is unsupported in v1');
  if(context.checkpoint.expires_at<=context.checkpoint.world_time)fail('EXPIRED','Subscriber checkpoint has expired');
  if(context.view.actor_id!==options.actorId||!context.checkpoint.actor_ids.includes(options.actorId))fail('UNAUTHORIZED','Subscriber actor is outside derived view');
  if(context.view.as_of_sequence!==context.checkpoint.sequence||context.view.as_of_world_time!==context.checkpoint.world_time)fail('CONFLICT','Derived view and checkpoint differ');
  const received=await serviceCall(signal=>options.plan(context,{signal}),options.timeoutMs??5000,call);
  if(!Array.isArray(received)||received.length>8)fail('INVALID_CONTRACT','Subscriber must return at most eight optional proposals');
  canonical(received);const result=structuredClone(received);
  for(const p of result){assertContract('IntentProposal',p);requireScope(p.scope,context.view.scope);
   const worldTime=p.action.type==='advance_time'?p.action.to_time:context.checkpoint.world_time;
   if(p.actor_id!==options.actorId||p.expected_sequence!==context.checkpoint.sequence||p.expected_head!==context.checkpoint.head||p.world_time!==worldTime)fail('UNAUTHORIZED','Subscriber proposal exceeds its actor/checkpoint');}
  return freezeDto(result);
 }});
}

import type {Principal,Outcome} from '@argo/contracts';
export async function runSubscriber(options:{updates:AsyncIterable<DerivedContext>;subscriber:ReturnType<typeof createProposalSubscriber>;principal:Principal;telos:{submit:(p:IntentProposal,principal:Principal,options:ServiceOptions)=>Promise<Outcome>};maxUpdates?:number;signal?:AbortSignal}):Promise<Outcome[]>{
 canonical(options.principal);const principal=freezeDto(structuredClone(options.principal));assertContract('Principal',principal);
 const limit=options.maxUpdates??1;if(!Number.isSafeInteger(limit)||limit<1||limit>1000)fail('INVALID_CONTRACT','Invalid subscriber update bound');
 const call=options.signal?{signal:options.signal}:{},iterator=options.updates[Symbol.asyncIterator](),outcomes:Outcome[]=[];
 try{
  for(let i=0;i<limit;i++){
   const next=await serviceCall(()=>iterator.next(),5000,call);if(next.done)break;
   requireScope(principal.scope,next.value.view.scope);if(next.value.view.actor_id!==principal.actor_id)fail('UNAUTHORIZED','Update actor differs from subscriber principal');
   const proposals=await options.subscriber.onView(next.value,call);
   // The bridge reauthorizes every proposal. A second proposal at an obsolete head is rejected,
   // never silently rebased; the agent must observe a new checkpoint before trying again.
   for(const p of proposals)outcomes.push(await serviceCall(signal=>options.telos.submit(p,principal,{signal}),5000,call));
  }
 }finally{if(iterator.return)await serviceCall(()=>iterator.return!(),5000).catch(()=>{});}
 return outcomes;
}

export * from './characters.ts';
export type {DialogueSupplement} from './dialogue-types.ts';
