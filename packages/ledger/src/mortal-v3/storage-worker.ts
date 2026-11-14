import {parentPort, workerData} from 'node:worker_threads';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync, openSync, closeSync, lstatSync} from 'node:fs';
import {dirname} from 'node:path';
import {createPrivateKey, createPublicKey} from 'node:crypto';
import {ArgoError, canonical, fail, hash} from '../../../contracts/src/index.ts';
import {assertMortalV3Contract, assertMortalV3Genesis} from '../../../contracts/src/mortal-v3.ts';
import type {MortalV3Genesis, MortalV3State, MortalV3Cursor, MortalV3Event, MortalV3Receipt, MortalV3Command, MortalV3Principal} from '../../../contracts/src/mortal-v3-types.ts';
import {createMortalV3Event, verifyMortalV3Event, verifyMortalV3Receipt} from './journal.ts';
import {initialMortalV3State} from './rules.ts';

const port = parentPort;
if (!port) throw new Error('Mortal storage worker requires a parent');
const config = workerData as {path: string; genesis: MortalV3Genesis; privatePem: string; expectedHead?: MortalV3Cursor};
const genesis = config.genesis;
let db: DatabaseSync | undefined, cached: MortalV3State;
const MAX_REPLY = 16 * 1024 * 1024;
function corrupt(message: string): never {return fail('CORRUPT_LEDGER', message);}
type Row = {sequence: number; event_hash: string; request_id: string; request_hash: string; event_json: string; receipt_json: string};

function reply(id: number, value: unknown): void {
 if (Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_REPLY) fail('UNAVAILABLE', 'Mortal reply exceeds 16 MiB; request a smaller history page');
 port!.postMessage({id, ok: true, value});
}
function errorReply(id: number, error: unknown): void {
 port!.postMessage({id, ok: false, error: error instanceof ArgoError ? {code: error.code, message: error.message.slice(0, 1024)} : {code: 'UNAVAILABLE', message: 'Mortal SQLite operation unavailable; a submitted action may have committed'}});
}
function decode(value: string): unknown {
 let decoded: unknown;
 try {decoded = JSON.parse(value); if (canonical(decoded) !== value) corrupt('Noncanonical mortal database record');}
 catch {return corrupt('Invalid mortal database JSON');}
 return decoded;
}
function rowValue(row: Row): {event: MortalV3Event; receipt: MortalV3Receipt} {
 try {
  const event = decode(row.event_json), receipt = decode(row.receipt_json);
  assertMortalV3Contract('Event', event); assertMortalV3Contract('Receipt', receipt);
  // Pages and exact retries may read an already verified prefix. Its signed
  // receipt pins the complete event hash, so rebind the bytes on every read
  // without replaying the rules for that historical event.
  const {hash: eventHash, ...signedEvent} = event;
  if (hash(signedEvent) !== eventHash) corrupt('Mortal stored event bytes differ from their hash');
  verifyMortalV3Receipt(receipt, {scope: genesis.scope, genesis_hash: hash(genesis), authority_key_id: genesis.authority_key_id, authority_public_key: genesis.authority_public_key});
  if (row.sequence !== event.sequence || row.event_hash !== event.hash || row.request_id !== event.command.request_id || row.request_hash !== hash({command: event.command, principal: event.principal}) || receipt.request_hash !== row.request_hash || receipt.request_id !== row.request_id || receipt.event_hash !== event.hash || receipt.cursor.sequence !== event.sequence || receipt.state_hash !== event.after_hash || canonical(receipt.effects) !== canonical(event.effects)) corrupt('Mortal event/idempotency/receipt binding differs');
  return {event, receipt};
 } catch {return corrupt('Mortal stored event or receipt failed verification');}
}
function metadata(): void {
 const row = db!.prepare('SELECT genesis_hash,genesis_json FROM mortal_v3_meta WHERE singleton=1').get();
 if (!row || row.genesis_hash !== hash(genesis) || row.genesis_json !== canonical(genesis)) corrupt('Immutable mortal genesis differs');
}
function refresh(prior: MortalV3State): MortalV3State {
 metadata();
 if (prior.sequence) {
  const known = db!.prepare('SELECT event_hash FROM mortal_v3_events WHERE sequence=?').get(prior.sequence);
  if (!known || known.event_hash !== prior.head) corrupt('Mortal database lost or replaced the previously verified prefix');
 }
 let state = prior;
 for (const raw of db!.prepare('SELECT * FROM mortal_v3_events WHERE sequence>? ORDER BY sequence').iterate(prior.sequence)) {
  const {event} = rowValue(raw as Row);
  try {state = verifyMortalV3Event(genesis, state, event);} catch {corrupt('Mortal history failed deterministic replay');}
 }
 return state;
}
function transaction<T>(write: boolean, operation: () => {state: MortalV3State; result: T}): T {
 db!.exec(write ? 'BEGIN IMMEDIATE' : 'BEGIN');
 try {
  const {state, result} = operation(); db!.exec('COMMIT'); cached = state; return result;
 } catch (error) {try {db!.exec('ROLLBACK');} catch {} throw error;}
}

try {
 assertMortalV3Genesis(genesis);
 const privateKey = createPrivateKey(config.privatePem); config.privatePem = '';
 if (privateKey.type !== 'private' || privateKey.asymmetricKeyType !== 'ed25519' || !createPublicKey(privateKey).equals(createPublicKey(genesis.authority_public_key))) fail('UNAUTHORIZED', 'Mortal worker signer differs from genesis');
 mkdirSync(dirname(config.path), {recursive: true, mode: 0o700});
 try {closeSync(openSync(config.path, 'wx', 0o600));} catch (error) {if (!(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST')) throw error;}
 if (!lstatSync(config.path).isFile()) fail('INVALID_CONTRACT', 'Mortal SQLite path is not a regular file');
 db = new DatabaseSync(config.path, {timeout: 5000, enableForeignKeyConstraints: true, enableDoubleQuotedStringLiterals: false, allowExtension: false});
 const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(row => row.name);
 if (tables.some(name => name !== 'mortal_v3_meta' && name !== 'mortal_v3_events')) corrupt('SQLite file belongs to another application');
 // Refuse foreign or mismatched existing files before WAL/schema/metadata
 // mutation. Only a completely empty application database can initialize.
 if (tables.length) {
  if (tables.length !== 2) corrupt('Incomplete mortal v3 database');
  metadata();
 }
 db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA trusted_schema=OFF; BEGIN IMMEDIATE;');
 try {
  db.exec(`CREATE TABLE IF NOT EXISTS mortal_v3_meta(singleton INTEGER PRIMARY KEY CHECK(singleton=1),genesis_hash TEXT NOT NULL,genesis_json TEXT NOT NULL) STRICT;
CREATE TABLE IF NOT EXISTS mortal_v3_events(sequence INTEGER PRIMARY KEY CHECK(sequence BETWEEN 1 AND 1000000),event_hash TEXT NOT NULL UNIQUE,request_id TEXT NOT NULL UNIQUE,request_hash TEXT NOT NULL,event_json TEXT NOT NULL,receipt_json TEXT NOT NULL) STRICT;
CREATE TRIGGER IF NOT EXISTS mortal_v3_events_no_update BEFORE UPDATE ON mortal_v3_events BEGIN SELECT RAISE(ABORT,'Mortal events are append-only'); END;
CREATE TRIGGER IF NOT EXISTS mortal_v3_events_no_delete BEFORE DELETE ON mortal_v3_events BEGIN SELECT RAISE(ABORT,'Mortal events are append-only'); END;
CREATE TRIGGER IF NOT EXISTS mortal_v3_meta_no_update BEFORE UPDATE ON mortal_v3_meta BEGIN SELECT RAISE(ABORT,'Mortal genesis is immutable'); END;
CREATE TRIGGER IF NOT EXISTS mortal_v3_meta_no_delete BEFORE DELETE ON mortal_v3_meta BEGIN SELECT RAISE(ABORT,'Mortal genesis is immutable'); END;`);
  if (!db.prepare('SELECT singleton FROM mortal_v3_meta').get()) {
   if (db.prepare('SELECT sequence FROM mortal_v3_events LIMIT 1').get()) corrupt('Mortal events exist without genesis');
   db.prepare('INSERT INTO mortal_v3_meta(singleton,genesis_hash,genesis_json) VALUES (1,?,?)').run(hash(genesis), canonical(genesis));
  }
  metadata(); db.exec('COMMIT');
 } catch (error) {try {db.exec('ROLLBACK');} catch {} throw error;}
 cached = initialMortalV3State(genesis);
 transaction(false, () => {
  const state = refresh(cached);
  const expected = config.expectedHead;
  if (expected) {
   const head = expected.sequence === 0 ? hash(genesis) : db!.prepare('SELECT event_hash FROM mortal_v3_events WHERE sequence=?').get(expected.sequence)?.event_hash;
   if (head !== expected.head || expected.sequence > state.sequence) corrupt('Mortal trusted checkpoint is not a committed prefix');
  }
  return {state, result: null};
 });
 reply(0, null);
 port.on('message', (message: {id: number; method: string; args: any}) => {
  try {
   let result: unknown;
   switch (message.method) {
    case 'snapshot': result = transaction(false, () => {const state = refresh(cached); return {state, result: state};}); break;
    case 'events': result = transaction(false, () => {
     const state = refresh(cached), {after, limit} = message.args as {after: number; limit: number};
     if (!Number.isSafeInteger(after) || after < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000) fail('INVALID_CONTRACT', 'Invalid mortal event page');
     const events: MortalV3Event[] = []; let bytes = 2;
     for (const raw of db!.prepare('SELECT * FROM mortal_v3_events WHERE sequence>? ORDER BY sequence LIMIT ?').iterate(after, limit)) {
      const row = raw as Row; bytes += Buffer.byteLength(row.event_json, 'utf8') + 1;
      if (bytes > MAX_REPLY) fail('UNAVAILABLE', 'Mortal reply exceeds 16 MiB; request a smaller history page');
      events.push(rowValue(row).event);
     }
     return {state, result: events};
    }); break;
    case 'submit': result = transaction(true, () => {
     const {command, principal} = message.args as {command: MortalV3Command; principal: MortalV3Principal};
     assertMortalV3Contract('Command', command); assertMortalV3Contract('Principal', principal);
     const state = refresh(cached), requestHash = hash({command, principal});
     const prior = db!.prepare('SELECT * FROM mortal_v3_events WHERE request_id=?').get(command.request_id);
     if (prior) {
      const {receipt} = rowValue(prior as Row);
      if (prior.request_hash !== requestHash) fail('CONFLICT', 'Mortal request ID was reused with different content or identity');
      return {state, result: receipt};
     }
     const created = createMortalV3Event(genesis, state, command, principal, privateKey);
     db!.prepare('INSERT INTO mortal_v3_events(sequence,event_hash,request_id,request_hash,event_json,receipt_json) VALUES (?,?,?,?,?,?)').run(created.event.sequence, created.event.hash, command.request_id, requestHash, canonical(created.event), canonical(created.receipt));
     return {state: created.state, result: created.receipt};
    }); break;
    case 'close': db!.close(); db = undefined; reply(message.id, null); port!.close(); return;
    default: fail('INVALID_CONTRACT', 'Unknown mortal worker operation');
   }
   reply(message.id, result);
  } catch (error) {errorReply(message.id, error);}
 });
} catch (error) {
 try {db?.close();} catch {} errorReply(0, error); port.close();
}
