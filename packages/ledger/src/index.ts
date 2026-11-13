import {open,mkdir,readFile,rename,unlink,stat} from 'node:fs/promises';
import {join} from 'node:path';import {sign,createPublicKey,randomUUID} from 'node:crypto';import type {KeyObject} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {assertContract,canonical,fail,hash,requireScope,safeAdd,own} from '@argo/contracts';
import type {Genesis,Snapshot,LedgerEvent,IntentProposal,Principal,Consent,Outcome} from '@argo/contracts';
import {initialSnapshot,replay,verifyEvent,apply,validate,draw,unsigned,eventHash,outcome} from './mechanics.ts';
export {replay,draw,initialSnapshot} from './mechanics.ts';

export interface LedgerOptions {
 directory:string;genesis:Genesis;privateKey:KeyObject;lockTimeoutMs?:number;
 verifyReceipt?:(consent:Consent,principal:Principal,options:{signal:AbortSignal})=>Promise<boolean>;
}
export interface CallOptions {signal?:AbortSignal}
const missing=(e:unknown):boolean=>typeof e==='object'&&e!==null&&'code' in e&&e.code==='ENOENT';
const decode=(bytes:Buffer):string=>{try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{fail('CORRUPT_LEDGER','Invalid UTF-8 ledger bytes');}};
const syncDirectory=async(directory:string)=>{const h=await open(directory,'r');try{await h.sync();}finally{await h.close();}};
async function atomicFile(directory:string,name:string,body:string):Promise<void>{
 const temporary=join(directory,`.${name}.${randomUUID()}.tmp`),target=join(directory,name);
 const handle=await open(temporary,'wx',0o600);
 try{await handle.writeFile(body);await handle.sync();}finally{await handle.close();}
 try{await rename(temporary,target);await syncDirectory(directory);}catch(error){await unlink(temporary).catch(()=>{});throw error;}
}
async function locked<T>(directory:string,timeout:number,signal:AbortSignal|undefined,fn:()=>Promise<T>):Promise<T>{
 const path=join(directory,'writer.lock'),deadline=Date.now()+timeout;let handle;
 for(;;){
  if(signal?.aborted)fail('CANCELLED','Operation cancelled');
  try{handle=await open(path,'wx',0o600);break;}catch(error){
   if(!(typeof error==='object'&&error!==null&&'code'in error&&error.code==='EEXIST'))throw error;
   if(Date.now()>=deadline)fail('UNAVAILABLE','Writer lock unavailable; no stale lock is stolen');
   try{await delay(Math.min(10,Math.max(1,deadline-Date.now())),undefined,signal?{signal}:{});}catch{fail('CANCELLED','Operation cancelled');}
  }
 }
 try{await handle.writeFile(canonical({pid:process.pid}));return await fn();}
 finally{await handle.close();await unlink(path);}
}
export async function openLedger(options:LedgerOptions){
 assertContract('Genesis',options.genesis);
 const genesis=structuredClone(options.genesis);initialSnapshot(genesis);
 if(options.privateKey.asymmetricKeyType!=='ed25519'||createPublicKey(options.privateKey).export({format:'pem',type:'spki'}).toString()!==genesis.authority_public_key)fail('UNAUTHORIZED','Signing key differs from pinned genesis');
 const directory=options.directory,timeout=options.lockTimeoutMs??5000;
 if(!Number.isFinite(timeout)||timeout<1||timeout>60000)fail('INVALID_CONTRACT','Invalid lock timeout');
 await mkdir(directory,{recursive:true,mode:0o700});
 const read=async():Promise<{state:Snapshot;events:LedgerEvent[]} >=>{
  let text:string;try{text=decode(await readFile(join(directory,'events.jsonl')));}catch(error){if(missing(error))fail('CORRUPT_LEDGER','Ledger event file missing');throw error;}
  if(text&&!text.endsWith('\n'))fail('CORRUPT_LEDGER','Partial ledger tail');
  const lines=text.split('\n');while(lines.at(-1)==='')lines.pop();const events:LedgerEvent[]=[];
  for(const line of lines){
   if(!line)fail('CORRUPT_LEDGER','Blank ledger record');
   let value:unknown;try{value=JSON.parse(line);}catch{fail('CORRUPT_LEDGER','Corrupt ledger JSON');}
   assertContract('LedgerEvent',value);if(canonical(value)!==line)fail('CORRUPT_LEDGER','Noncanonical ledger record');events.push(value);
  }
  return {state:replay(genesis,events),events};
 };
 await locked(directory,timeout,undefined,async()=>{
  let existing:string|null=null;try{existing=decode(await readFile(join(directory,'genesis.json')));}catch(error){if(!missing(error))throw error;}
  if(existing===null){
   try{await stat(join(directory,'events.jsonl'));fail('CORRUPT_LEDGER','Events exist without genesis');}catch(error){if(!missing(error))throw error;}
   await atomicFile(directory,'genesis.json',canonical(genesis)+'\n');
   const events=await open(join(directory,'events.jsonl'),'wx',0o600);try{await events.sync();}finally{await events.close();}await syncDirectory(directory);
  }else if(existing!==canonical(genesis)+'\n')fail('CORRUPT_LEDGER','Immutable genesis differs');
  await read();
 });
 const readChecked=async()=>{
  if(decode(await readFile(join(directory,'genesis.json')))!==canonical(genesis)+'\n')fail('CORRUPT_LEDGER','Immutable genesis changed');return read();
 };
 return Object.freeze({
  // These authority-only accessors must never be exposed as public transport routes.
  snapshot:async(options:CallOptions={})=>locked(directory,timeout,options.signal,async()=>structuredClone((await readChecked()).state)),
  events:async(options:CallOptions={})=>locked(directory,timeout,options.signal,async()=>structuredClone((await readChecked()).events)),
  submit:async(input:IntentProposal,authenticated:Principal,call:CallOptions={}):Promise<Outcome>=>{
   assertContract('IntentProposal',input);assertContract('Principal',authenticated);
   const p=structuredClone(input),principal=structuredClone(authenticated);
   requireScope(genesis.scope,p.scope);requireScope(genesis.scope,principal.scope);
   return locked(directory,timeout,call.signal,async()=>{
    const {state,events}=await readChecked();const prior=events.find(e=>e.proposal.proposal_id===p.proposal_id);
    if(prior){
     if(hash(p)!==hash(prior.proposal))fail('CONFLICT','Proposal idempotency conflict');
     if(principal.principal_id!==prior.authority.principal_id||principal.actor_id!==prior.authority.principal_actor_id||principal.role!==prior.authority.principal_role)fail('UNAUTHORIZED','Idempotent actor authentication differs');
     return outcome(prior);
    }
    const parents=new Set(events.map(e=>e.hash));if(p.causal_parents.some(parent=>!parents.has(parent)))fail('INVALID_ACTION','Unknown causal parent');
    let receiptHash:string|null=null;
    if(p.action.type==='record_consent'){
     // Validate cheap actor/scope/head requirements before calling any external verifier.
     receiptHash=hash(p.action.consent);validate(p,principal,state,receiptHash);
     if(!options.verifyReceipt)fail('UNAUTHORIZED','Verified donor receipt required');
     const controller=new AbortController();const onAbort=()=>controller.abort();call.signal?.addEventListener('abort',onAbort,{once:true});
     let timer:ReturnType<typeof setTimeout>|undefined;
     try{
      const stopped=new Promise<never>((_,reject)=>{
       timer=setTimeout(()=>{controller.abort();reject(new Error('Receipt verification deadline'));},5000);
       controller.signal.addEventListener('abort',()=>reject(new Error('Receipt verification cancelled')),{once:true});
      });
      if(call.signal?.aborted)controller.abort();
      const verified=await Promise.race([options.verifyReceipt(structuredClone(p.action.consent),structuredClone(principal),{signal:controller.signal}),stopped]);
      if(verified!==true)fail('UNAUTHORIZED','Donor receipt did not verify');
     }finally{clearTimeout(timer);call.signal?.removeEventListener('abort',onAbort);}
    }
    validate(p,principal,state,receiptHash);
    if(call.signal?.aborted)fail('CANCELLED','Operation cancelled before append');
    const sequence=safeAdd(state.sequence,1),a=p.action;
    const event:LedgerEvent={schema_version:'1.0.0',event_id:`event_${sequence}`,scope:structuredClone(genesis.scope),ruleset_version:genesis.ruleset_version,sequence,previous_hash:state.head,hash:'0'.repeat(64),kind:a.type==='observe_claim'?'epistemic':'causal',proposal:p,
     authority:{kind:'telos',principal_id:principal.principal_id,key_id:genesis.authority_key_id,signature:'AA==',principal_actor_id:principal.actor_id,principal_role:principal.role,receipt_hash:receiptHash},
     rng:a.type==='draw'?draw(genesis.seed,state.rng_counter,a.label,a.bound):null};
    event.authority.signature=sign(null,Buffer.from(canonical(unsigned(event))),options.privateKey).toString('base64');event.hash=eventHash(event);
    verifyEvent(state,event,parents);const next=apply(state,event);
    const file=await open(join(directory,'events.jsonl'),'a',0o600);
    try{await file.writeFile(canonical(event)+'\n');await file.sync();}finally{await file.close();}
    // This cache is derived, never authority. A crash before its write still recovers the append.
    await atomicFile(directory,'snapshot.json',canonical(next)+'\n');
    return outcome(event);
   });
  },
 });
}
export type Ledger=Awaited<ReturnType<typeof openLedger>>;

import type {EncounterCheckpoint} from '@argo/contracts';
export function makeCheckpoint(state:Snapshot,id:string,actorIds:string[],expiresAt:number,policy:EncounterCheckpoint['policy']='reject'):EncounterCheckpoint{
 if(policy!=='serialize'&&policy!=='reject')fail('CAPABILITY_UNSUPPORTED','Checkpoint queue/fork policy is unsupported in v1');
 if(expiresAt<=state.world_time||actorIds.some(actor=>!own(state.actors,actor)))fail('INVALID_ACTION','Checkpoint participants or expiry invalid');
 const value:EncounterCheckpoint={checkpoint_id:id,scope:structuredClone(state.genesis.scope),head:state.head,sequence:state.sequence,world_time:state.world_time,actor_ids:[...actorIds],policy,expires_at:expiresAt};assertContract('EncounterCheckpoint',value);return value;
}

export * from './characters.ts';
