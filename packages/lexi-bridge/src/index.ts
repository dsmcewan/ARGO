import {assertContract,assertScope,requireScope,fail,own,assertKnowledgeDisclosure,canonical} from '@argo/contracts';
import type {Scope,KnowledgeQuery,Principal,KnowledgeView,Snapshot} from '@argo/contracts';
import {serviceCall,freezeDto} from '@argo/contracts';import type {ServiceOptions} from '@argo/contracts';
export type LexiTransport=(query:KnowledgeQuery,principal:Principal,options:{signal:AbortSignal})=>Promise<unknown>;
function authorize(query:KnowledgeQuery,principal:Principal,scope:Scope):void{
 assertContract('KnowledgeQuery',query);assertContract('Principal',principal);requireScope(scope,query.scope);requireScope(scope,principal.scope);
 if(query.actor_id!==principal.actor_id)fail('UNAUTHORIZED','Knowledge actor does not match authenticated actor');
 if(query.audience==='actor'&&query.party_id!==null||query.audience==='party'&&query.party_id===null)fail('INVALID_CONTRACT','Knowledge audience and party disagree');
}
export function createLexiBridge(options:{scope:Scope;transport?:LexiTransport;timeoutMs?:number}){
 assertScope(options.scope);const scope=structuredClone(options.scope);
 return Object.freeze({query:async(input:KnowledgeQuery,auth:Principal,call:ServiceOptions={}):Promise<KnowledgeView>=>{
  // Reject accessor-bearing DTOs before cloning, then validate the detached
  // objects that are actually sent to the transport or returned to its caller.
  canonical(input);canonical(auth);
  const query=freezeDto(structuredClone(input)),principal=freezeDto(structuredClone(auth));
  authorize(query,principal,scope);
  if(!options.transport)fail('UNAVAILABLE','LEXI domain transport is not configured');
  const transport=options.transport;
  const received=await serviceCall(signal=>transport(query,principal,{signal}),options.timeoutMs??5000,call);
  canonical(received);const result=structuredClone(received);
  assertKnowledgeDisclosure(result);requireScope(scope,result.scope);
  if(result.actor_id!==query.actor_id||result.audience!==query.audience||result.party_id!==query.party_id||result.as_of_sequence!==query.as_of_sequence||result.as_of_world_time!==query.as_of_world_time)fail('INVALID_CONTRACT','LEXI response does not bind query');
  for(const claim of result.claims)if(claim.acquired_at>query.as_of_world_time||claim.sequence>query.as_of_sequence||!claim.observation.observers.includes(query.actor_id)||(query.audience==='party'&&claim.observation.party_id!==query.party_id))fail('INVALID_CONTRACT','LEXI response exposes unauthorized knowledge');
  return freezeDto(result);
 }});
}
export function projectKnowledge(current:Snapshot,query:KnowledgeQuery,principal:Principal):KnowledgeView{
 assertContract('Snapshot',current);authorize(query,principal,current.genesis.scope);
 if(!own(current.actors,query.actor_id))fail('UNAUTHORIZED','Unknown knowledge actor');
 if(query.as_of_sequence>current.sequence)fail('CONFLICT','Knowledge query exceeds materialized cursor');
 if(query.as_of_world_time>current.world_time)fail('INVALID_ACTION','Knowledge query is in the future');
 if(query.audience==='party'&&!own(current.genesis.parties,query.party_id!)?.includes(query.actor_id))fail('UNAUTHORIZED','Actor is not an authorized party member');
 const claims=current.claims.filter(c=>c.acquired_at<=query.as_of_world_time&&c.sequence<=query.as_of_sequence&&c.observation.observers.includes(query.actor_id)&&(query.audience==='actor'||c.observation.party_id===query.party_id));
 // v1 has one world encounter namespace. Apply current cutoffs to all its speaker/actor views;
 // a historical prefix or a different observer cannot reopen ontology about the vanished thread.
 const cutoffs=Object.values(current.cutoffs);
 const view:KnowledgeView={...structuredClone(query),claims:structuredClone(claims),ontology_blocked:cutoffs.length>0,engagement_closed:cutoffs.some(c=>c.named_at_sequence!==null)};
 assertKnowledgeDisclosure(view);return freezeDto(view);
}
export function createLexiMock(readAuthoritySnapshot:(options:ServiceOptions)=>Promise<Snapshot>):LexiTransport{
 // Rebuild at the durable authority cursor on each query. No background materializer or fabricated
 // live endpoint is implied; the ledger's signed journal is the mock's durable projection source.
 return async(query,principal,options)=>projectKnowledge(await readAuthoritySnapshot(options),query,principal);
}
