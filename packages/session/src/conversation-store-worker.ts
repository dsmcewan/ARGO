import {parentPort,workerData} from 'node:worker_threads';
import {DatabaseSync} from 'node:sqlite';
import {lstatSync} from 'node:fs';
import {ArgoError,assertWorldData,canonical,hash} from '@argo/contracts';
import type {ConversationBinding,TurnRow,Mutation} from './conversation-types.ts';
import {CONVERSATION_VERSION} from './conversation-types.ts';
import {assertBinding,assertRow,assertInput,fields,integer,turnId,bindingHash,inputHash,initialRow,mutate,corrupt,invalid,MAX_RPC,MAX_TURNS,MAX_TOTAL} from './conversation-guards.ts';
const port=parentPort;if(!port)throw Error('Outbox worker requires parent');
const config=workerData as {path:string;mode:'create'|'open';binding:ConversationBinding;maxCharacters:number};
const APP_ID=0x41525443;
const schema=[
 `CREATE TABLE conversation_meta(singleton INTEGER PRIMARY KEY CHECK(singleton=1),format TEXT NOT NULL,binding_hash TEXT NOT NULL,binding_json TEXT NOT NULL) STRICT`,
 `CREATE TABLE conversation_turns(turn_key TEXT PRIMARY KEY,turn_id TEXT NOT NULL UNIQUE,input_hash TEXT NOT NULL,revision INTEGER NOT NULL CHECK(revision>=0),phase TEXT NOT NULL CHECK(phase IN ('accepted','input_pending','input_committed','generating','reply_pending','settled')),cancel_requested INTEGER NOT NULL CHECK(cancel_requested IN (0,1)),inbound_record_id TEXT UNIQUE,row_bytes INTEGER NOT NULL CHECK(row_bytes BETWEEN 1 AND 131072),row_hash TEXT NOT NULL,row_json TEXT NOT NULL) STRICT`,
 `CREATE TRIGGER conversation_meta_no_update BEFORE UPDATE ON conversation_meta BEGIN SELECT RAISE(ABORT,'Conversation binding is immutable'); END`,
 `CREATE TRIGGER conversation_meta_no_delete BEFORE DELETE ON conversation_meta BEGIN SELECT RAISE(ABORT,'Conversation binding is immutable'); END`,
 `CREATE TRIGGER conversation_turns_no_delete BEFORE DELETE ON conversation_turns BEGIN SELECT RAISE(ABORT,'Conversation tombstones cannot be deleted'); END`,
];
let db:DatabaseSync|undefined;
function reply(id:number,value:unknown){const envelope={id,ok:true,value};if(Buffer.byteLength(JSON.stringify(envelope))>MAX_RPC)invalid('Outbox reply capacity exceeded');port!.postMessage(envelope);}
function error(id:number,e:unknown){port!.postMessage({id,ok:false,code:e instanceof ArgoError?e.code:'UNAVAILABLE'});}
try{
 fields(config,['path','mode','binding','maxCharacters']);assertBinding(config.binding);integer(config.maxCharacters,1,2048);const binding=config.binding,identity=bindingHash(binding),bindingText=canonical(binding);
 const file=lstatSync(config.path);if(!file.isFile()||file.isSymbolicLink()||(file.mode&0o777)!==0o600||process.getuid&&file.uid!==process.getuid())invalid('Unsafe outbox file');
 db=new DatabaseSync(config.path);db.exec('PRAGMA busy_timeout=5000');
 const existing=db.prepare("SELECT sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY sql").all().map(r=>r.sql);
 if(config.mode==='create'){
  if(existing.length||Number(db.prepare('PRAGMA application_id').get()!.application_id)!==0)corrupt('New outbox file is not empty');
  db.exec('BEGIN IMMEDIATE');try{for(const sql of schema)db.exec(sql);db.exec(`PRAGMA application_id=${APP_ID}; PRAGMA user_version=1`);db.prepare('INSERT INTO conversation_meta VALUES(1,?,?,?)').run(CONVERSATION_VERSION,identity,bindingText);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
 }else if(config.mode!=='open')invalid('Invalid outbox mode');
 function metadata(){
  if(Number(db!.prepare('PRAGMA application_id').get()!.application_id)!==APP_ID||Number(db!.prepare('PRAGMA user_version').get()!.user_version)!==1)corrupt('Foreign outbox application');
  const definitions=db!.prepare("SELECT sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY sql").all().map(r=>r.sql);
  if(canonical(definitions)!==canonical([...schema].sort()))corrupt('Foreign outbox schema');
  const rows=db!.prepare('SELECT * FROM conversation_meta').all(),m=rows[0];if(rows.length!==1||!m||m.singleton!==1||m.format!==CONVERSATION_VERSION||m.binding_hash!==identity||m.binding_json!==bindingText)corrupt('Outbox binding differs');
 }
 function decode(raw:Record<string,unknown>):TurnRow{
  try{if(typeof raw.row_json!=='string')corrupt('Missing row JSON');const row:unknown=JSON.parse(raw.row_json);assertRow(row,binding,config.maxCharacters);
   if(raw.turn_key!==row.turn_key||raw.turn_id!==row.turn_id||raw.input_hash!==row.input_hash||raw.revision!==row.revision||raw.phase!==row.phase||raw.cancel_requested!==Number(row.cancel_requested)||raw.inbound_record_id!==row.inbound_record_id||raw.row_json!==canonical(row)||raw.row_hash!==hash(row)||raw.row_bytes!==Buffer.byteLength(raw.row_json))corrupt('Outbox duplicate columns differ');return row;
  }catch{corrupt('Outbox row is corrupt');}
 }
 const load=(id:string)=>{const raw=db!.prepare('SELECT * FROM conversation_turns WHERE turn_id=?').get(id);return raw?decode(raw):null;};
 function budget(delta:number,adding:boolean){const row=db!.prepare('SELECT count(*) n,coalesce(sum(row_bytes),0) bytes FROM conversation_turns').get()!;if(Number(row.n)+(adding?1:0)>MAX_TURNS||Number(row.bytes)+delta>MAX_TOTAL)invalid('Conversation outbox capacity reached');}
 function write(row:TurnRow,old:TurnRow|null){assertRow(row,binding,config.maxCharacters);const text=canonical(row),bytes=Buffer.byteLength(text);budget(bytes-(old?Buffer.byteLength(canonical(old)):0),old===null);
  const args=[row.turn_key,row.turn_id,row.input_hash,row.revision,row.phase,Number(row.cancel_requested),row.inbound_record_id,bytes,hash(row),text];
  if(old)db!.prepare('UPDATE conversation_turns SET turn_key=?,turn_id=?,input_hash=?,revision=?,phase=?,cancel_requested=?,inbound_record_id=?,row_bytes=?,row_hash=?,row_json=? WHERE turn_key=? AND revision=?').run(...args,old.turn_key,old.revision);
  else db!.prepare('INSERT INTO conversation_turns VALUES(?,?,?,?,?,?,?,?,?,?)').run(...args);
 }
 function transaction<T>(write:boolean,operation:()=>T):T{db!.exec(write?'BEGIN IMMEDIATE':'BEGIN');try{metadata();const result=operation();if(Buffer.byteLength(JSON.stringify(result))>MAX_RPC-64)invalid('Outbox reply too large');db!.exec('COMMIT');return result;}catch(e){db!.exec('ROLLBACK');throw e;}}
 metadata();transaction(false,()=>{budget(0,false);for(const raw of db!.prepare('SELECT * FROM conversation_turns').iterate())decode(raw);return null;});
 db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA trusted_schema=OFF');
 for(const suffix of ['','-wal','-shm']){try{const st=lstatSync(config.path+suffix);if(!st.isFile()||st.isSymbolicLink()||(st.mode&0o777)!==0o600)invalid('Unsafe outbox sidecar');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}}
 reply(0,null);
 port.on('message',(input:unknown)=>{let id=0;try{fields(input,['id','method','args']);integer(input.id,1);id=input.id;if(Buffer.byteLength(canonical(input))>MAX_RPC)invalid('Outbox request too large');const {method,args}=input;
  if(method==='close'){if(args!==null)invalid('Invalid close');db!.close();db=undefined;reply(id,null);port!.close();return;}
  const result=transaction(method!=='load',()=>{
   if(method==='insert'){assertInput(args,config.maxCharacters);const prior=load(args.turn_id);if(prior){if(prior.input_hash!==inputHash(binding,args))throw new ArgoError('CONFLICT','Turn ID has different content');return prior;}const row=initialRow(binding,args,Date.now());write(row,null);return row;}
   if(method==='load'){fields(args,['turn_id']);turnId(args.turn_id);return load(args.turn_id);}
   if(method==='advance'){fields(args,['turn_id','revision','mutation']);turnId(args.turn_id);integer(args.revision,0);const prior=load(args.turn_id);if(!prior)invalid('Unknown conversation turn');if(prior.revision!==args.revision)return {changed:false,row:prior};assertWorldData(args.mutation);const row=mutate(prior,args.mutation as Mutation,binding,Date.now());write(row,prior);return {changed:true,row};}
   invalid('Unknown outbox operation');
  });reply(id,result);
 }catch(e){error(id,e);}});
}catch(e){try{db?.close();}catch{}error(0,e);port.close();}
