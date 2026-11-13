import {assertContract,requireScope,fail,assertScope} from '@argo/contracts';
import type {Scope,IntentProposal,Principal,Outcome} from '@argo/contracts';
import {serviceCall,freezeDto} from '@argo/contracts';import type {ServiceOptions} from '@argo/contracts';
export type TelosTransport=(proposal:IntentProposal,principal:Principal,options:{signal:AbortSignal})=>Promise<unknown>;
export function createTelosBridge(options:{scope:Scope;transport?:TelosTransport;timeoutMs?:number}){
 assertScope(options.scope);const scope=structuredClone(options.scope);
 return Object.freeze({submit:async(input:IntentProposal,auth:Principal,call:ServiceOptions={}):Promise<Outcome>=>{
  assertContract('IntentProposal',input);assertContract('Principal',auth);requireScope(scope,input.scope);requireScope(scope,auth.scope);
  if(!options.transport)fail('UNAVAILABLE','TELOS domain transport is not configured');
  const p=freezeDto(structuredClone(input)),principal=freezeDto(structuredClone(auth)),transport=options.transport;
  const result=await serviceCall(signal=>transport(p,principal,{signal}),options.timeoutMs??5000,call);
  assertContract('Outcome',result);
  if(result.proposal_id!==p.proposal_id||result.sequence!==p.expected_sequence+1||result.world_time!==p.world_time||result.action_type!==p.action.type||result.kind!==(p.action.type==='observe_claim'?'epistemic':'causal'))fail('INVALID_CONTRACT','TELOS response does not bind submitted proposal');
  return freezeDto(structuredClone(result));
 }});
}
// In-process deterministic mock only. Principal construction belongs to an authenticated gateway.
export function createTelosMock(authority:{submit:(proposal:IntentProposal,principal:Principal,options:ServiceOptions)=>Promise<Outcome>}):TelosTransport{
 return (proposal,principal,options)=>authority.submit(proposal,principal,options);
}
