import {assertCharacterContract,assertCharacterPrincipal,characterRequestHash,assertScope,requireScope,fail,freezeDto,serviceCall} from '@argo/contracts';
import type {Scope,Principal,ServiceOptions,CharacterCommand,CharacterReceipt} from '@argo/contracts';
export type CharacterTransport=(command:CharacterCommand,principal:Principal,options:{signal:AbortSignal})=>Promise<unknown>;
export function createCharacterBridge(options:{scope:Scope;transport?:CharacterTransport;timeoutMs?:number}){
 assertScope(options.scope);const scope=structuredClone(options.scope),transport=options.transport,timeout=options.timeoutMs??5000;
 return Object.freeze({submit:async(input:CharacterCommand,auth:Principal,call:ServiceOptions={}):Promise<CharacterReceipt>=>{
  assertCharacterContract('CharacterCommand',input);assertCharacterPrincipal(auth);requireScope(scope,input.scope);requireScope(scope,auth.scope);
  const command=freezeDto(structuredClone(input)),principal=freezeDto(structuredClone(auth)),requestHash=characterRequestHash(command,principal);
  if(!transport)fail('UNAVAILABLE','Character authority transport is not configured');
  const result=await serviceCall(signal=>transport(command,principal,{signal}),timeout,call);
  assertCharacterContract('CharacterReceipt',result);requireScope(scope,result.scope);
  if(result.request_id!==command.request_id||result.request_hash!==requestHash||result.kind!==command.body.type||result.cursor.sequence!==command.expected_cursor.sequence+1||result.cursor.world_time!==command.expected_cursor.world_time)fail('INVALID_CONTRACT','Character receipt does not bind the submitted request');
  return freezeDto(structuredClone(result));
 }});
}
