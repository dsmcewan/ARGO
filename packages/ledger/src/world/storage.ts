import {Worker} from 'node:worker_threads';
import {KeyObject,createPublicKey} from 'node:crypto';
import {types as nodeTypes} from 'node:util';
import {resolve} from 'node:path';
import {ArgoError,canonical,fail,hash} from '../../../contracts/src/index.ts';
import {assertWorldContract,assertWorldData,worldRequestHash} from '../../../contracts/src/shared-world.ts';
import type {WorldGenesis,WorldState,WorldCursor,WorldLedgerOptions,WorldLedger,WorldReceipt,WorldEvent,WorldCommand,WorldPrincipal} from '../../../contracts/src/shared-world-types.ts';
import {ownWorldGenesis} from './rules/ownership.ts';
import {readWorld} from './rules/engine.ts';
import {verifyWorldReceipt} from './journal.ts';

/** Private transport helper; values are validated/owned before serialization.
 * Reserve the largest legal request ID so every admitted state stays readable. */
export function assertWorldReplyFits(value:unknown,id=Number.MAX_SAFE_INTEGER):void{
 if(Buffer.byteLength(JSON.stringify({id,ok:true,value}),'utf8')>16777216)fail('INVALID_ACTION','Shared reply capacity reached');
}
type Pending={resolve(value:unknown):void;reject(error:Error):void};

/** Host-only storage. The worker owns SQLite, signing and replay. Snapshot
 * returns deeply immutable owned state; unchanged verified prefixes reuse that
 * exact identity. Raw state/events never substitute for an actor-scoped view.
 *
 * No per-call cancellation: after dispatch, lost acknowledgment is ambiguous
 * and callers reconcile the identical request. Live caches trust old rows to
 * remain append-only; cold replay and EXTERNAL ancestor checkpoints supply the
 * separate restart checks. A checkpoint in the same database is not an anchor. */
export async function openWorldLedger(options:WorldLedgerOptions):Promise<WorldLedger>{
 if(!options||typeof options!=='object'||nodeTypes.isProxy(options)||![Object.prototype,null].includes(Object.getPrototypeOf(options)))fail('INVALID_CONTRACT','Invalid shared ledger options');
 const fields=Reflect.ownKeys(options),descriptors=Object.getOwnPropertyDescriptors(options);
 if(fields.some(k=>typeof k!=='string'||!['path','genesis','privateKey','expectedHead'].includes(k))||!['path','genesis','privateKey'].every(k=>Object.hasOwn(descriptors,k)))fail('INVALID_CONTRACT','Invalid shared ledger option fields');
 for(const key of fields){const d=descriptors[key as keyof WorldLedgerOptions];if(!d?.enumerable||!('value'in d))fail('INVALID_CONTRACT','Active shared ledger option');}
 const data={path:descriptors.path!.value as unknown,genesis:descriptors.genesis!.value as unknown,...(descriptors.expectedHead?{expectedHead:descriptors.expectedHead.value as unknown}:{})};assertWorldData(data);
 const genesis=ownWorldGenesis(data.genesis as WorldGenesis),identity=hash(genesis);
 if(typeof data.path!=='string'||!data.path||data.path.includes('\0')||data.path===':memory:'||data.path.startsWith('file:'))fail('INVALID_CONTRACT','Shared storage requires a SQLite filename');
 if(data.expectedHead!==undefined)assertWorldContract('Cursor',data.expectedHead);
 const privateKey:unknown=descriptors.privateKey!.value;
 if(nodeTypes.isProxy(privateKey)||!(privateKey instanceof KeyObject))fail('INVALID_CONTRACT','Shared signer requires a private KeyObject');
 let privatePem:string;
 try{if(privateKey.type!=='private'||privateKey.asymmetricKeyType!=='ed25519'||!createPublicKey(privateKey).equals(createPublicKey(genesis.mortal.authority_public_key)))fail('UNAUTHORIZED','Shared signer differs from genesis');privatePem=privateKey.export({format:'pem',type:'pkcs8'}).toString();}
 catch{return fail('UNAUTHORIZED','Shared signer differs from genesis');}
 const worker=new Worker(new URL('./storage-worker.ts',import.meta.url),{workerData:{path:resolve(data.path),genesis:structuredClone(genesis),privatePem,...(data.expectedHead===undefined?{}:{expectedHead:structuredClone(data.expectedHead)})}});privatePem='';
 const pending=new Map<number,Pending>(),idleWaiters=new Set<()=>void>();let nextId=1,closing=false,dead=false,closingPromise:Promise<void>|undefined,snapshotCache:WorldState|undefined;
 const trust={scope:genesis.mortal.scope,genesis_hash:identity,authority_key_id:genesis.mortal.authority_key_id,authority_public_key:genesis.mortal.authority_public_key};
 const unavailable=()=>new ArgoError('UNAVAILABLE','Shared storage worker unavailable; a submitted action may have committed');
 const signalIdle=()=>{if(!pending.size){for(const done of idleWaiters)done();idleWaiters.clear();}};
 const stop=(error:Error)=>{dead=true;for(const call of pending.values())call.reject(error);pending.clear();signalIdle();};
 const ready=new Promise<unknown>((resolve,reject)=>pending.set(0,{resolve,reject}));
 worker.on('message',(reply:{id:number;ok:boolean;value?:unknown;error?:{code:ArgoError['code'];message:string}})=>{
  const call=pending.get(reply.id);if(!call)return;pending.delete(reply.id);
  if(reply.ok)call.resolve(reply.value);else call.reject(new ArgoError(reply.error?.code??'UNAVAILABLE',reply.error?.message??'Shared storage operation failed'));signalIdle();
 });
 worker.on('error',()=>stop(unavailable()));worker.on('exit',()=>stop(unavailable()));
 function rpc(method:string,args:unknown,allowClosing=false):Promise<unknown>{
  if(dead||closing&&!allowClosing)return Promise.reject(unavailable());
  if(pending.size>=128||nextId>=Number.MAX_SAFE_INTEGER)return Promise.reject(new ArgoError('UNAVAILABLE','Shared worker request capacity reached'));
  const id=nextId++;return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});try{worker.postMessage({id,method,args});}catch{pending.delete(id);reject(unavailable());signalIdle();}});
 }
 try{await ready;}catch(error){await worker.terminate();throw error;}
 return Object.freeze({
  async snapshot():Promise<WorldState>{
   const previous=snapshotCache,value=await rpc('snapshot',previous?.cursor??null);
   // Only this private worker protocol can supply the unchanged marker; every
   // request still refreshes SQLite and checks its verified prefix first.
   if(value===null){if(!previous)fail('CORRUPT_LEDGER','Shared snapshot lacks its cached prefix');return previous;}
   const state=readWorld(genesis,value as WorldState).state;
   if(snapshotCache&&(state.cursor.sequence<snapshotCache.cursor.sequence||state.cursor.sequence===snapshotCache.cursor.sequence&&canonical(state.cursor)!==canonical(snapshotCache.cursor)))fail('CORRUPT_LEDGER','Shared snapshot regressed or diverged');
   snapshotCache=state;return state;
  },
  async events(input={after:0,limit:256}):Promise<WorldEvent[]>{
   assertWorldData(input);if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).sort().join(',')!=='after,limit'||!Number.isSafeInteger(input.after)||input.after<0||!Number.isSafeInteger(input.limit)||input.limit<1||input.limit>1000)fail('INVALID_CONTRACT','Invalid shared event page');
   const page=structuredClone(input),value=await rpc('events',page);if(!Array.isArray(value)||value.length>page.limit)fail('CORRUPT_LEDGER','Invalid shared event page response');
   for(const event of value)assertWorldContract('Event',event);return value;
  },
  async submit(command:WorldCommand,principal:WorldPrincipal):Promise<WorldReceipt>{
   const requestHash=worldRequestHash(command,principal),id=command.request_id,value=await rpc('submit',{command:structuredClone(command),principal:structuredClone(principal)});
   assertWorldContract('Receipt',value);verifyWorldReceipt(value,trust);
   if(value.request_id!==id||value.request_hash!==requestHash)fail('CORRUPT_LEDGER','Shared acknowledgment differs from submitted request');return value;
  },
  close():Promise<void>{
   if(!closingPromise){closing=true;closingPromise=(async()=>{if(pending.size&&!dead)await new Promise<void>(resolve=>idleWaiters.add(resolve));try{if(!dead)await rpc('close',null,true);}finally{await worker.terminate();dead=true;}})();}return closingPromise;
  },
 });
}
