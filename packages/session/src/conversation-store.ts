import {Worker} from 'node:worker_threads';
import {open,lstat,realpath} from 'node:fs/promises';
import {dirname,isAbsolute,resolve} from 'node:path';
import {ArgoError,assertWorldData,freezeDto} from '@argo/contracts';
import type {WorldGenesis} from '@argo/contracts';
import type {OpenConversationStoreOptions,WorldConversationStore,ConversationBinding,TurnInput,TurnRow,Mutation,AdvanceResult} from './conversation-types.ts';
import {fields,integer,turnId,assertInput,assertRow,buildBinding,MAX_RPC,invalid} from './conversation-guards.ts';
export {requestIdFor} from './conversation-guards.ts';
interface Access{genesis:WorldGenesis;binding:ConversationBinding;insert(input:TurnInput):Promise<TurnRow>;load(id:string):Promise<TurnRow|null>;advance(id:string,revision:number,mutation:Mutation):Promise<AdvanceResult>}
const stores=new WeakMap<WorldConversationStore,Access>();
export function storeAccess(store:WorldConversationStore):Access{const access=stores.get(store);if(!access)invalid('Conversation store is not an opened capability');return access;}
async function privatePath(path:string,mode:'create'|'open'):Promise<string>{
 if(!isAbsolute(path)||path.includes('\0')||path.startsWith('file:'))invalid('Outbox requires an absolute private filename');
 const parentPath=resolve(dirname(path)),directory=await realpath(parentPath);if(directory!==parentPath)invalid('Outbox directory aliases are not permitted');const info=await lstat(directory);if(!info.isDirectory()||(info.mode&0o777)!==0o700||process.getuid&&info.uid!==process.getuid())invalid('Outbox directory must be owned and private');
 const target=resolve(directory,path.slice(dirname(path).length+1));
 if(mode==='create'){const f=await open(target,'wx',0o600);try{await f.chmod(0o600);await f.sync();}finally{await f.close();}const parent=await open(directory,'r');try{await parent.sync();}finally{await parent.close();}}
 for(const suffix of ['','-wal','-shm']){const p=target+suffix,st=await lstat(p).catch(e=>{if(suffix&&e.code==='ENOENT')return null;throw e;});if(st&&(!st.isFile()||st.isSymbolicLink()||(st.mode&0o777)!==0o600||process.getuid&&st.uid!==process.getuid()))invalid('Outbox files must be owned private regular files');}
 return target;
}
export async function openWorldConversationStore(input:OpenConversationStoreOptions):Promise<WorldConversationStore>{
 fields(input,['path','mode','genesis','player','npc','policy']);if(typeof input.path!=='string'||!['create','open'].includes(input.mode))invalid('Invalid outbox open mode');
 const mode=input.mode,pathInput=input.path;const binding=buildBinding(input),genesis=freezeDto(structuredClone(input.genesis)),maxCharacters=genesis.profiles.find(p=>p.actor_id===binding.player.actor_id)!.max_speech_characters,maxReplyCharacters=genesis.profiles.find(p=>p.actor_id===binding.npc.actor_id)!.max_speech_characters;
 const path=await privatePath(pathInput,mode),worker=new Worker(new URL('./conversation-store-worker.ts',import.meta.url),{workerData:{path,mode,binding,maxCharacters,maxReplyCharacters}});
 type Pending={resolve:(v:unknown)=>void;reject:(e:Error)=>void};const pending=new Map<number,Pending>(),idle=new Set<()=>void>();const signalIdle=()=>{if(!pending.size){for(const resolve of idle)resolve();idle.clear();}};let next=1,dead=false,closing=false,closePromise:Promise<void>|undefined;
 const error=()=>new ArgoError('UNAVAILABLE','Conversation outbox unavailable; a pending write may have persisted');
 const stop=()=>{dead=true;for(const p of pending.values())p.reject(error());pending.clear();signalIdle();};
 const ready=new Promise<unknown>((resolve,reject)=>pending.set(0,{resolve,reject}));
 worker.on('error',stop);worker.on('exit',stop);worker.on('message',(reply:unknown)=>{
  try{assertWorldData(reply);if(Buffer.byteLength(JSON.stringify(reply))>MAX_RPC)throw error();const r=reply as {id:number;ok:boolean;value?:unknown;code?:ArgoError['code']};fields(r,r?.ok===true?['id','ok','value']:['id','ok','code']);if(r.ok!==true&&r.ok!==false||r.ok===false&&!['INVALID_CONTRACT','CORRUPT_LEDGER','UNAVAILABLE','CONFLICT','UNAUTHORIZED','INVALID_ACTION','SCOPE_DENIED'].includes(r.code??''))throw error();integer(r.id,0);const p=pending.get(r.id);if(!p)return;pending.delete(r.id);signalIdle();if(r.ok===true)p.resolve(r.value);else p.reject(new ArgoError(r.code??'UNAVAILABLE','Conversation outbox operation refused'));}catch{stop();void worker.terminate();}
 });
 function rpc(method:string,args:unknown,allowClosing=false):Promise<unknown>{
  if(dead||closing&&!allowClosing||pending.size>=64||next>=Number.MAX_SAFE_INTEGER)return Promise.reject(error());
  assertWorldData(args);if(Buffer.byteLength(JSON.stringify(args))>MAX_RPC)return Promise.reject(new ArgoError('INVALID_CONTRACT','Outbox request too large'));
  const id=next++;return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});try{worker.postMessage({id,method,args});}catch{pending.delete(id);signalIdle();reject(error());}});
 }
 try{await ready;}catch(e){await worker.terminate();throw e;}
 const guard=(v:unknown):TurnRow=>{assertRow(v,binding,maxCharacters,maxReplyCharacters);return freezeDto(structuredClone(v));};
 const store:WorldConversationStore=Object.freeze({binding,close:()=>{
  if(!closePromise){closing=true;closePromise=(async()=>{try{if(pending.size&&!dead)await new Promise<void>(resolve=>idle.add(resolve));if(!dead)await rpc('close',null,true);}finally{await worker.terminate();stop();}})();}return closePromise;
 }});
 stores.set(store,{genesis,binding,
  async insert(input){assertInput(input,maxCharacters);return guard(await rpc('insert',structuredClone(input)));},
  async load(id){turnId(id);const row=await rpc('load',{turn_id:id});return row===null?null:guard(row);},
  async advance(id,revision,mutation){turnId(id);integer(revision,0);assertWorldData(mutation);const value=await rpc('advance',{turn_id:id,revision,mutation:structuredClone(mutation)});fields(value,['changed','row']);if(typeof value.changed!=='boolean')invalid('Invalid outbox CAS result');return {changed:value.changed,row:guard(value.row)};},
 });return store;
}
