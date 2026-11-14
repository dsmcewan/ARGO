import {KeyObject,createPublicKey,sign,verify} from 'node:crypto';
import {types as nodeTypes} from 'node:util';
import {canonical,hash,fail} from '../../../contracts/src/index.ts';
import {assertWorldContract,worldRequestHash} from '../../../contracts/src/shared-world.ts';
import type {WorldGenesis,WorldState,WorldCommand,WorldPrincipal,WorldEvent,WorldReceipt,WorldReceiptTrust} from '../../../contracts/src/shared-world-types.ts';
import {initialWorldState,resolveWorld,worldStateHash} from './rules.ts';
import {ownWorldGenesis,withWorldHead} from './rules/ownership.ts';
import {readWorld} from './rules/engine.ts';

const eventBytes=(event:Omit<WorldEvent,'signature'|'hash'>)=>Buffer.from(canonical({domain:'shared-world/0.1.0/event',event}));
const receiptBytes=(receipt:Omit<WorldReceipt,'signature'>)=>Buffer.from(canonical({domain:'shared-world/0.1.0/receipt',receipt}));
const corrupt=(message:string):never=>fail('CORRUPT_LEDGER',message);
const genesisKeys=new WeakMap<WorldGenesis,KeyObject>();
function keyFor(genesis:WorldGenesis):KeyObject{
 let key=genesisKeys.get(genesis);if(!key){key=createPublicKey(genesis.mortal.authority_public_key);genesisKeys.set(genesis,key);}return key;
}
function signer(genesis:WorldGenesis,key:KeyObject):void{
 if(nodeTypes.isProxy(key)||!(key instanceof KeyObject))fail('INVALID_CONTRACT','Shared signer requires a private KeyObject');
 try{if(key.type!=='private'||key.asymmetricKeyType!=='ed25519'||!createPublicKey(key).equals(keyFor(genesis)))fail('UNAUTHORIZED','Shared signer differs from genesis');}
 catch{fail('UNAUTHORIZED','Shared signer differs from genesis');}
}

/** Verify the acknowledgment against separately pinned public trust. It does
 * not authorize disclosure or replace matching the caller's request identity. */
export function verifyWorldReceipt(receipt:WorldReceipt,trust:WorldReceiptTrust):void{
 assertWorldContract('Receipt',receipt);assertWorldContract('ReceiptTrust',trust);
 if(canonical(receipt.scope)!==canonical(trust.scope)||receipt.genesis_hash!==trust.genesis_hash||receipt.authority_key_id!==trust.authority_key_id)fail('UNAUTHORIZED','Shared receipt differs from pinned trust');
 const {signature,...body}=receipt;
 if(!verify(null,receiptBytes(body),createPublicKey(trust.authority_public_key),Buffer.from(signature,'base64')))fail('UNAUTHORIZED','Shared receipt signature does not verify');
}

/** A verified prior prefix and the host signer are capabilities. Storage owns
 * durable request uniqueness; pure resolution also refuses prior memory IDs. */
export function createWorldEvent(inputGenesis:WorldGenesis,inputState:WorldState,command:WorldCommand,principal:WorldPrincipal,privateKey:KeyObject):{event:WorldEvent;state:WorldState;receipt:WorldReceipt}{
 const genesis=ownWorldGenesis(inputGenesis),state=readWorld(genesis,inputState).state;
 signer(genesis,privateKey);const requestHash=worldRequestHash(command,principal);
 const resolution=resolveWorld(genesis,state,command,principal);
 const body:Omit<WorldEvent,'signature'|'hash'>={
  version:genesis.version,scope:structuredClone(genesis.mortal.scope),genesis_hash:state.genesis_hash,
  sequence:resolution.state.cursor.sequence,previous_hash:state.cursor.head,world_time:resolution.state.cursor.world_time,
  command:structuredClone(command),principal:structuredClone(principal),before_hash:worldStateHash(state),after_hash:worldStateHash(resolution.state),
  draws:structuredClone(resolution.draws),effects:structuredClone(resolution.effects),memory:structuredClone(resolution.memory),
 };
 const signed={...body,signature:sign(null,eventBytes(body),privateKey).toString('base64')},event:WorldEvent={...signed,hash:hash(signed)};
 const next=withWorldHead(resolution.state,event.hash);
 const receiptBody:Omit<WorldReceipt,'signature'>={version:genesis.version,scope:structuredClone(genesis.mortal.scope),genesis_hash:state.genesis_hash,
  authority_key_id:genesis.mortal.authority_key_id,request_id:command.request_id,request_hash:requestHash,event_hash:event.hash,cursor:{...next.cursor},state_hash:event.after_hash};
 const receipt:WorldReceipt={...receiptBody,signature:sign(null,receiptBytes(receiptBody),privateKey).toString('base64')};
 assertWorldContract('Event',event);assertWorldContract('Receipt',receipt);return {event,state:next,receipt};
}

export function verifyWorldEvent(inputGenesis:WorldGenesis,inputState:WorldState,event:WorldEvent):WorldState{
 const genesis=ownWorldGenesis(inputGenesis),state=readWorld(genesis,inputState).state;assertWorldContract('Event',event);
 if(event.genesis_hash!==state.genesis_hash||canonical(event.scope)!==canonical(genesis.mortal.scope)||event.sequence!==state.cursor.sequence+1||event.previous_hash!==state.cursor.head||event.before_hash!==worldStateHash(state))corrupt('Shared event does not extend its verified prefix');
 const {hash:eventHash,...signed}=event,{signature,...body}=signed;
 if(hash(signed)!==eventHash||!verify(null,eventBytes(body),keyFor(genesis),Buffer.from(signature,'base64')))corrupt('Shared event hash or signature does not verify');
 let resolution;
 try{resolution=resolveWorld(genesis,state,event.command,event.principal);}catch{return corrupt('Signed shared event violates action admission');}
 if(resolution.state.cursor.sequence!==event.sequence||resolution.state.cursor.world_time!==event.world_time||canonical(resolution.draws)!==canonical(event.draws)||canonical(resolution.effects)!==canonical(event.effects)||canonical(resolution.memory)!==canonical(event.memory)||worldStateHash(resolution.state)!==event.after_hash)corrupt('Signed shared event differs from deterministic resolution');
 return withWorldHead(resolution.state,event.hash);
}

/** Each event has its own bounded DTO. The history container is dense/passive
 * and capped separately; no complete-array 16 MiB transport limit is implied. */
export function replayWorld(inputGenesis:WorldGenesis,events:WorldEvent[]):WorldState{
 const genesis=ownWorldGenesis(inputGenesis);
 if(nodeTypes.isProxy(events)||!Array.isArray(events)||Object.getPrototypeOf(events)!==Array.prototype||events.length>1000000)fail('INVALID_CONTRACT','Invalid shared event history');
 const keys=Reflect.ownKeys(events);if(keys.length!==events.length+1||keys.some(key=>typeof key!=='string'))fail('INVALID_CONTRACT','Shared history must be a dense undecorated array');
 let state=initialWorldState(genesis);const requests=new Set<string>();
 for(let index=0;index<events.length;index++){
  const descriptor=Object.getOwnPropertyDescriptor(events,String(index));if(!descriptor?.enumerable||!('value'in descriptor))fail('INVALID_CONTRACT','Shared history contains an active or missing event');
  const event:unknown=descriptor.value;assertWorldContract('Event',event);
  if(requests.has(event.command.request_id))corrupt('Shared history repeats a request ID');requests.add(event.command.request_id);
  state=verifyWorldEvent(genesis,state,event);
 }
 return state;
}
