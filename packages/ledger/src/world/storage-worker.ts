import {parentPort,workerData} from 'node:worker_threads';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,openSync,closeSync,lstatSync} from 'node:fs';
import {dirname} from 'node:path';
import {createPrivateKey,createPublicKey} from 'node:crypto';
import {ArgoError,canonical,hash,fail} from '../../../contracts/src/index.ts';
import {assertWorldContract,assertWorldData,worldRequestHash} from '../../../contracts/src/shared-world.ts';
import type {WorldGenesis,WorldCursor,WorldState,WorldEvent,WorldReceipt,WorldCommand,WorldPrincipal} from '../../../contracts/src/shared-world-types.ts';
import {initialWorldState} from './rules.ts';
import {ownWorldGenesis} from './rules/ownership.ts';
import {createWorldEvent,verifyWorldEvent,verifyWorldReceipt} from './journal.ts';
import {assertWorldReplyFits} from './storage.ts';

const port=parentPort;if(!port)throw Error('Shared storage worker requires a parent');
const config=workerData as {path:string;genesis:WorldGenesis;privatePem:string;expectedHead?:WorldCursor};
let db:DatabaseSync|undefined,cached:WorldState;
const MAX_REPLY=16777216;
type Row={sequence:number;event_hash:string;request_id:string;request_hash:string;event_json:string;receipt_json:string};
const corrupt=(message:string):never=>fail('CORRUPT_LEDGER',message);
function reply(id:number,value:unknown):void{assertWorldReplyFits(value,id);port!.postMessage({id,ok:true,value});}
function errorReply(id:number,error:unknown):void{port!.postMessage({id,ok:false,error:error instanceof ArgoError?{code:error.code,message:error.message.slice(0,1024)}:{code:'UNAVAILABLE',message:'Shared SQLite operation unavailable; a submitted action may have committed'}});}
function decode(text:string):unknown{try{if(Buffer.byteLength(text)>MAX_REPLY)corrupt('Oversized shared database record');const value:unknown=JSON.parse(text);assertWorldData(value);if(canonical(value)!==text)corrupt('Noncanonical shared database record');return value;}catch{return corrupt('Invalid shared database JSON');}}

try{
 const genesis=ownWorldGenesis(config.genesis),identity=hash(genesis),genesisText=canonical(genesis),m=genesis.mortal;
 const trust={scope:m.scope,genesis_hash:identity,authority_key_id:m.authority_key_id,authority_public_key:m.authority_public_key};
 const privateKey=createPrivateKey(config.privatePem);config.privatePem='';
 if(privateKey.type!=='private'||privateKey.asymmetricKeyType!=='ed25519'||!createPublicKey(privateKey).equals(createPublicKey(m.authority_public_key)))fail('UNAUTHORIZED','Shared worker signer differs from genesis');
 function metadata():void{const row=db!.prepare('SELECT genesis_hash,genesis_json FROM shared_world_v1_meta WHERE singleton=1').get();if(!row||row.genesis_hash!==identity||row.genesis_json!==genesisText)corrupt('Immutable shared genesis differs');}
 function rowValue(row:Row):{event:WorldEvent;receipt:WorldReceipt}{
  try{
   const event=decode(row.event_json),receipt=decode(row.receipt_json);assertWorldContract('Event',event);assertWorldContract('Receipt',receipt);
   const {hash:eventHash,...signed}=event;if(hash(signed)!==eventHash)corrupt('Shared event bytes differ from their hash');verifyWorldReceipt(receipt,trust);
   if(event.genesis_hash!==identity||canonical(event.scope)!==canonical(m.scope)||row.sequence!==event.sequence||row.event_hash!==event.hash||row.request_id!==event.command.request_id||row.request_hash!==worldRequestHash(event.command,event.principal)||receipt.request_id!==row.request_id||receipt.request_hash!==row.request_hash||receipt.event_hash!==event.hash||receipt.cursor.sequence!==event.sequence||receipt.cursor.head!==event.hash||receipt.cursor.world_time!==event.world_time||receipt.state_hash!==event.after_hash)corrupt('Shared event, request index or receipt binding differs');
   return {event,receipt};
  }catch{return corrupt('Shared stored event or receipt failed verification');}
 }
 function refresh(prior:WorldState):WorldState{
  metadata();if(prior.cursor.sequence){const known=db!.prepare('SELECT event_hash FROM shared_world_v1_events WHERE sequence=?').get(prior.cursor.sequence);if(!known||known.event_hash!==prior.cursor.head)corrupt('Shared database lost or replaced the previously verified prefix');}
  let state=prior;
  for(const raw of db!.prepare('SELECT * FROM shared_world_v1_events WHERE sequence>? ORDER BY sequence').iterate(prior.cursor.sequence)){
   const {event}=rowValue(raw as Row);try{state=verifyWorldEvent(genesis,state,event);}catch{corrupt('Shared history failed deterministic replay');}
  }
  return state;
 }
 function transaction<T>(write:boolean,operation:()=>{state:WorldState;result:T}):T{
  db!.exec(write?'BEGIN IMMEDIATE':'BEGIN');
  try{const {state,result}=operation();assertWorldReplyFits(result);db!.exec('COMMIT');cached=state;return result;}
  catch(error){try{db!.exec('ROLLBACK');}catch{}throw error;}
 }
 mkdirSync(dirname(config.path),{recursive:true,mode:0o700});
 try{closeSync(openSync(config.path,'wx',0o600));}catch(error){if(!(error&&typeof error==='object'&&'code'in error&&error.code==='EEXIST'))throw error;}
 if(!lstatSync(config.path).isFile())fail('INVALID_CONTRACT','Shared SQLite path is not a regular file');
 db=new DatabaseSync(config.path,{timeout:5000,enableForeignKeyConstraints:true,enableDoubleQuotedStringLiterals:false,allowExtension:false});
 const schema=db.prepare("SELECT name,type FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").all(),allowed=new Set(['shared_world_v1_meta','shared_world_v1_events','shared_world_v1_events_no_update','shared_world_v1_events_no_delete','shared_world_v1_meta_no_update','shared_world_v1_meta_no_delete']);
 if(schema.some(row=>typeof row.name!=='string'||!allowed.has(row.name)||!['table','trigger'].includes(String(row.type))))corrupt('SQLite file belongs to another application');
 const tables=schema.filter(row=>row.type==='table');if(schema.length){if(tables.length!==2)corrupt('Incomplete shared world database');metadata();}
 db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA trusted_schema=OFF; BEGIN IMMEDIATE;');
 try{
  db.exec(`CREATE TABLE IF NOT EXISTS shared_world_v1_meta(singleton INTEGER PRIMARY KEY CHECK(singleton=1),genesis_hash TEXT NOT NULL,genesis_json TEXT NOT NULL) STRICT;
CREATE TABLE IF NOT EXISTS shared_world_v1_events(sequence INTEGER PRIMARY KEY CHECK(sequence BETWEEN 1 AND 1000000),event_hash TEXT NOT NULL UNIQUE,request_id TEXT NOT NULL UNIQUE,request_hash TEXT NOT NULL,event_json TEXT NOT NULL,receipt_json TEXT NOT NULL) STRICT;
CREATE TRIGGER IF NOT EXISTS shared_world_v1_events_no_update BEFORE UPDATE ON shared_world_v1_events BEGIN SELECT RAISE(ABORT,'Shared events are append-only'); END;
CREATE TRIGGER IF NOT EXISTS shared_world_v1_events_no_delete BEFORE DELETE ON shared_world_v1_events BEGIN SELECT RAISE(ABORT,'Shared events are append-only'); END;
CREATE TRIGGER IF NOT EXISTS shared_world_v1_meta_no_update BEFORE UPDATE ON shared_world_v1_meta BEGIN SELECT RAISE(ABORT,'Shared genesis is immutable'); END;
CREATE TRIGGER IF NOT EXISTS shared_world_v1_meta_no_delete BEFORE DELETE ON shared_world_v1_meta BEGIN SELECT RAISE(ABORT,'Shared genesis is immutable'); END;`);
  if(!db.prepare('SELECT singleton FROM shared_world_v1_meta').get()){if(db.prepare('SELECT sequence FROM shared_world_v1_events LIMIT 1').get())corrupt('Shared events exist without genesis');db.prepare('INSERT INTO shared_world_v1_meta(singleton,genesis_hash,genesis_json) VALUES(1,?,?)').run(identity,genesisText);}
  metadata();db.exec('COMMIT');
 }catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}
 cached=initialWorldState(genesis);
 transaction(false,()=>{
  const state=refresh(cached),expected=config.expectedHead;assertWorldReplyFits(state);
  if(expected){assertWorldContract('Cursor',expected);let actual:WorldCursor={sequence:0,head:identity,world_time:0};
   if(expected.sequence){const raw=db!.prepare('SELECT * FROM shared_world_v1_events WHERE sequence=?').get(expected.sequence);if(!raw)corrupt('Trusted shared checkpoint is missing');actual=rowValue(raw as Row).receipt.cursor;}
   if(canonical(actual)!==canonical(expected)||expected.sequence>state.cursor.sequence)corrupt('Trusted shared checkpoint is not a committed prefix');
  }
  return {state,result:null};
 });reply(0,null);
 port.on('message',(message:{id:number;method:string;args:any})=>{
  try{let result:unknown;
   switch(message.method){
   case 'snapshot':result=transaction(false,()=>{const state=refresh(cached),known=message.args as WorldCursor|null;if(known!==null)assertWorldContract('Cursor',known);return {state,result:known!==null&&canonical(known)===canonical(state.cursor)?null:state};});break;
   case 'events':result=transaction(false,()=>{
    const state=refresh(cached),{after,limit}=message.args as {after:number;limit:number};if(!Number.isSafeInteger(after)||after<0||!Number.isSafeInteger(limit)||limit<1||limit>1000)fail('INVALID_CONTRACT','Invalid shared event page');
    const events:WorldEvent[]=[];let bytes=Buffer.byteLength(JSON.stringify({id:Number.MAX_SAFE_INTEGER,ok:true,value:[]}));
    for(const raw of db!.prepare('SELECT * FROM shared_world_v1_events WHERE sequence>? ORDER BY sequence LIMIT ?').iterate(after,limit)){
     const row=raw as Row;bytes+=Buffer.byteLength(row.event_json)+(events.length?1:0);if(bytes>MAX_REPLY)fail('UNAVAILABLE','Shared reply exceeds 16 MiB; request a smaller history page');events.push(rowValue(row).event);
    }return {state,result:events};
   });break;
   case 'submit':result=transaction(true,()=>{
    const {command,principal}=message.args as {command:WorldCommand;principal:WorldPrincipal},requestHash=worldRequestHash(command,principal),state=refresh(cached);
    const prior=db!.prepare('SELECT * FROM shared_world_v1_events WHERE request_id=?').get(command.request_id);
    if(prior){const {receipt}=rowValue(prior as Row);if(prior.request_hash!==requestHash)fail('CONFLICT','Shared request ID was reused with different content or identity');return {state,result:receipt};}
    const created=createWorldEvent(genesis,state,command,principal,privateKey);
    // Pure authority enforces complete State/Resolution DTO budgets. Reserve
    // the full transport wrapper before any durable event/request insertion.
    assertWorldReplyFits(created.state);assertWorldReplyFits(created.receipt);
    db!.prepare('INSERT INTO shared_world_v1_events(sequence,event_hash,request_id,request_hash,event_json,receipt_json) VALUES(?,?,?,?,?,?)').run(created.event.sequence,created.event.hash,command.request_id,requestHash,canonical(created.event),canonical(created.receipt));
    return {state:created.state,result:created.receipt};
   });break;
   case 'close':db!.close();db=undefined;reply(message.id,null);port!.close();return;
   default:fail('INVALID_CONTRACT','Unknown shared worker operation');
   }reply(message.id,result);
  }catch(error){errorReply(message.id,error);}
 });
}catch(error){try{db?.close();}catch{}errorReply(0,error);port.close();}
