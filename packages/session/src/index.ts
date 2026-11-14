/** A fixed authenticated capability over one journal, never another writer. */
import {types as nodeTypes} from 'node:util';
import {assertWorldContract,assertWorldGenesis,canonical,fail,freezeDto,hash,worldRequestHash,WORLD_PROFILE} from '@argo/contracts';
import type {WorldAction,WorldActorView,WorldCommand,WorldGenesis,WorldLedger,WorldPrincipal,WorldQuery,WorldReceipt,WorldReceiptTrust,WorldState} from '@argo/contracts';
import {verifyWorldReceipt,viewWorldActor} from '@argo/ledger';

export interface WorldSessionOptions {genesis:WorldGenesis;ledger:WorldLedger;principal:WorldPrincipal}
export interface WorldSession {
 query():Promise<WorldQuery>;
 view(query:WorldQuery):Promise<WorldActorView>;
 prepare(action:WorldAction,requestId:string):Promise<WorldCommand>;
 submit(command:WorldCommand):Promise<WorldReceipt>;
}
function options(input:WorldSessionOptions):WorldSessionOptions{
 if(!input||typeof input!=='object'||nodeTypes.isProxy(input)||![Object.prototype,null].includes(Object.getPrototypeOf(input)))fail('INVALID_CONTRACT','Session options require plain fields');
 const keys=Reflect.ownKeys(input),fields=Object.getOwnPropertyDescriptors(input);
 if(keys.length!==3||keys.some(k=>typeof k!=='string'||!['genesis','ledger','principal'].includes(k)||!fields[k]?.enumerable||!('value'in fields[k]!)))fail('INVALID_CONTRACT','Invalid session option fields');
 const ledger=fields.ledger!.value as WorldLedger;
 if(!ledger||typeof ledger!=='object'||nodeTypes.isProxy(ledger))fail('INVALID_CONTRACT','Session requires an injected ledger');
 for(const name of ['snapshot','events','submit','close']){const field=Object.getOwnPropertyDescriptor(ledger,name);if(!field||!('value'in field)||typeof field.value!=='function')fail('INVALID_CONTRACT','Session ledger requires explicit methods');}
 return {genesis:fields.genesis!.value as WorldGenesis,ledger,principal:fields.principal!.value as WorldPrincipal};
}

/** Authentication precedes this constructor. A caller with this capability may
 * act only as the pinned principal; supplying an ID is not authentication. */
export function createWorldSession(input:WorldSessionOptions):WorldSession{
 const supplied=options(input);assertWorldGenesis(supplied.genesis);assertWorldContract('Principal',supplied.principal);
 const genesis=freezeDto(structuredClone(supplied.genesis)),principal=freezeDto(structuredClone(supplied.principal)),ledger=supplied.ledger;
 if(canonical(principal.scope)!==canonical(genesis.mortal.scope))fail('SCOPE_DENIED','Session principal scope differs');
 const actor=genesis.mortal.actors.find(a=>a.id===principal.actor_id);
 if(principal.role==='referee'?principal.principal_id!==genesis.mortal.referee_id:!actor||actor.controller_id!==principal.principal_id||actor.kind!==principal.role)fail('UNAUTHORIZED','Session principal is not the immutable controller');
 const trust:WorldReceiptTrust=freezeDto({scope:genesis.mortal.scope,genesis_hash:hash(genesis),authority_key_id:genesis.mortal.authority_key_id,authority_public_key:genesis.mortal.authority_public_key});
 const actorId=()=>{if(principal.role==='referee')fail('UNAUTHORIZED','An actorless referee has no actor view');return principal.actor_id;};
 const currentReferee=async():Promise<WorldState>=>{
  const state=await ledger.snapshot();assertWorldContract('State',state,genesis);
  if(state.genesis_hash!==trust.genesis_hash||canonical(state.scope)!==canonical(trust.scope))fail('UNAUTHORIZED','Session snapshot differs from pinned world');
  return state;
 };
 const actorView=async(query?:WorldQuery):Promise<WorldActorView>=>{
  const id=actorId(),state=await ledger.snapshot();
  // Read only a passive cursor descriptor to form the query. viewWorldActor
  // validates raw injected DTOs and recognizes private storage-owned snapshots;
  // a shallow Object.freeze never bypasses its validation/authentication.
  if(!state||typeof state!=='object'||nodeTypes.isProxy(state))fail('INVALID_CONTRACT','Invalid session snapshot');
  const cursor=Object.getOwnPropertyDescriptor(state,'cursor');if(!cursor?.enumerable||!('value'in cursor))fail('INVALID_CONTRACT','Snapshot requires a passive cursor');
  assertWorldContract('Cursor',cursor.value);
  const currentQuery=query??{version:WORLD_PROFILE,scope:trust.scope,actor_id:id,cursor:structuredClone(cursor.value)};
  return viewWorldActor(genesis,state,currentQuery,principal);
 };
 return Object.freeze({
  async query(){return (await actorView()).query;},
  async view(input:WorldQuery){
   const id=actorId();assertWorldContract('Query',input);const query=freezeDto(structuredClone(input));
   if(query.actor_id!==id||canonical(query.scope)!==canonical(trust.scope))fail('UNAUTHORIZED','Session query belongs to another actor or scope');
   return actorView(query);
  },
  async prepare(input:WorldAction,requestId:string){
   assertWorldContract('Action',input);const action=freezeDto(structuredClone(input));
   // Validate request identity before any asynchronous snapshot operation.
   const skeleton:WorldCommand={version:WORLD_PROFILE,scope:trust.scope,actor_id:principal.actor_id,request_id:requestId,expected:{sequence:0,head:trust.genesis_hash,world_time:genesis.mortal.world_time},causation_id:trust.genesis_hash,action};
   worldRequestHash(skeleton,principal);
   const cursor=principal.role==='referee'?(await currentReferee()).cursor:(await actorView()).query.cursor;
   const command={...skeleton,expected:structuredClone(cursor),causation_id:cursor.head};
   assertWorldContract('Command',command);return freezeDto(command);
  },
  async submit(input:WorldCommand){
   assertWorldContract('Command',input);const command=freezeDto(structuredClone(input));
   if(command.actor_id!==principal.actor_id||canonical(command.scope)!==canonical(trust.scope))fail('UNAUTHORIZED','Session command belongs to another actor or scope');
   const requestHash=worldRequestHash(command,principal);
   // Storage must consult its exact retry index before fresh-prefix admission.
   // An acknowledgment loss may have committed: reconcile this exact command.
   const received=await ledger.submit(command,principal);verifyWorldReceipt(received,trust);
   if(received.request_id!==command.request_id||received.request_hash!==requestHash||received.cursor.sequence!==command.expected.sequence+1||received.cursor.head!==received.event_hash||received.cursor.world_time<command.expected.world_time)fail('UNAUTHORIZED','Signed receipt does not acknowledge this exact request');
   return freezeDto(structuredClone(received));
  },
 });
}
