import {Worker} from 'node:worker_threads';
import {KeyObject, createPublicKey} from 'node:crypto';
import {types as nodeTypes} from 'node:util';
import {resolve} from 'node:path';
import {ArgoError, assertMortalContract, assertMortalGenesis, assertMortalData, fail} from '@argo/contracts';
import type {MortalGenesis, MortalCursor, MortalLedger, MortalEvent, MortalReceipt, MortalState, MortalCommand, MortalPrincipal} from '@argo/contracts';

type OpenOptions = {path: string; genesis: MortalGenesis; privateKey: KeyObject; expectedHead?: MortalCursor};
type Pending = {resolve(value: unknown): void; reject(error: Error): void};

/** This is a host capability, including all snapshots/events/signed receipts.
 * Actor disclosure belongs to the separate scoped view. SQLite and cryptographic
 * history work happen exclusively in the worker; parent validation is bounded.
 *
 * Resource/trust limits: 128 outstanding calls, 16 MiB worker replies, one million
 * events, pages of at most 1000, and a five-second SQLite busy timeout. The host
 * owns path permissions, authenticates principals and must close each handle.
 * Incremental caches trust previously verified rows to stay append-only. A
 * privileged OS/DB editor can invalidate that assumption; reopen verifies the
 * complete history, while an EXTERNAL expectedHead is needed to detect rollback
 * across handles/restarts. No self-stored checkpoint is an external trust anchor.
 */
export async function openMortalLedger(options: OpenOptions): Promise<MortalLedger> {
 // privateKey is intentionally not JSON. Inspect only the option container's
 // descriptors first; validate the data half before cloning or exporting a key.
 if (!options || typeof options !== 'object' || nodeTypes.isProxy(options) || ![Object.prototype, null].includes(Object.getPrototypeOf(options))) fail('INVALID_CONTRACT', 'Invalid mortal ledger options');
 const fields = Reflect.ownKeys(options), descriptors = Object.getOwnPropertyDescriptors(options);
 if (fields.some(field => typeof field !== 'string' || !['path', 'genesis', 'privateKey', 'expectedHead'].includes(field)) || !['path', 'genesis', 'privateKey'].every(field => Object.hasOwn(descriptors, field))) fail('INVALID_CONTRACT', 'Invalid mortal ledger option fields');
 for (const field of fields) {const d = descriptors[field as string]; if (!d?.enumerable || !('value' in d)) fail('INVALID_CONTRACT', 'Active mortal ledger option');}
 const data = {path: descriptors.path!.value as unknown, genesis: descriptors.genesis!.value as unknown, ...(descriptors.expectedHead ? {expectedHead: descriptors.expectedHead.value as unknown} : {})};
 assertMortalData(data); assertMortalGenesis(data.genesis);
 if (typeof data.path !== 'string' || !data.path || data.path.includes('\0') || data.path === ':memory:' || data.path.startsWith('file:')) fail('INVALID_CONTRACT', 'Mortal storage requires a SQLite filename');
 const expectedHead = data.expectedHead;
 if (expectedHead !== undefined) {
  if (!expectedHead || typeof expectedHead !== 'object' || Array.isArray(expectedHead) || Object.keys(expectedHead).sort().join(',') !== 'head,sequence') fail('INVALID_CONTRACT', 'Invalid mortal trusted checkpoint');
  const cursor = expectedHead as MortalCursor;
  if (!Number.isSafeInteger(cursor.sequence) || cursor.sequence < 0 || cursor.sequence > 1000000 || typeof cursor.head !== 'string' || !/^[0-9a-f]{64}$/.test(cursor.head)) fail('INVALID_CONTRACT', 'Invalid mortal trusted checkpoint');
 }
 const privateKey: unknown = descriptors.privateKey!.value;
 if (nodeTypes.isProxy(privateKey) || !(privateKey instanceof KeyObject)) fail('INVALID_CONTRACT', 'Mortal private signer must be a KeyObject');
 let privatePem: string;
 try {
  if (privateKey.type !== 'private' || privateKey.asymmetricKeyType !== 'ed25519' || !createPublicKey(privateKey).equals(createPublicKey(data.genesis.authority_public_key))) fail('UNAUTHORIZED', 'Mortal signer differs from genesis');
  privatePem = privateKey.export({format: 'pem', type: 'pkcs8'}).toString();
 } catch {return fail('UNAUTHORIZED', 'Mortal signer differs from genesis');}
 const worker = new Worker(new URL('./storage-worker.ts', import.meta.url), {workerData: {path: resolve(data.path), genesis: structuredClone(data.genesis), privatePem, ...(expectedHead === undefined ? {} : {expectedHead: structuredClone(expectedHead)})}});
 privatePem = ''; // Never serialize the key into SQLite, logs or replies.
 const pending = new Map<number, Pending>(); let nextId = 1, closing = false, dead = false, closingPromise: Promise<void> | undefined;
 const idleWaiters = new Set<() => void>();
 function signalIdle(): void {if (!pending.size) {for (const done of idleWaiters) done(); idleWaiters.clear();}}
 const ready = new Promise<unknown>((resolve, reject) => pending.set(0, {resolve, reject}));
 const unavailable = () => new ArgoError('UNAVAILABLE', 'Mortal storage worker unavailable; a submitted action may have committed');
 function stop(error: Error): void {dead = true; for (const call of pending.values()) call.reject(error); pending.clear(); signalIdle();}
 worker.on('message', (reply: {id: number; ok: boolean; value?: unknown; error?: {code: ArgoError['code']; message: string}}) => {
  const call = pending.get(reply.id); if (!call) return; pending.delete(reply.id);
  if (reply.ok) call.resolve(reply.value);
  else call.reject(new ArgoError(reply.error?.code ?? 'UNAVAILABLE', reply.error?.message ?? 'Mortal storage operation failed'));
  signalIdle();
 });
 worker.on('error', () => stop(unavailable()));
 worker.on('exit', () => stop(unavailable()));
 function rpc(method: string, args: unknown, allowClosing = false): Promise<unknown> {
  if (dead || closing && !allowClosing) return Promise.reject(unavailable());
  if (pending.size >= 128 || nextId >= Number.MAX_SAFE_INTEGER) return Promise.reject(new ArgoError('UNAVAILABLE', 'Mortal worker request capacity reached'));
  const id = nextId++;
  return new Promise((resolve, reject) => {
   pending.set(id, {resolve, reject});
   try {worker.postMessage({id, method, args});} catch {pending.delete(id); reject(unavailable()); signalIdle();}
  });
 }
 try {await ready;} catch (error) {await worker.terminate(); throw error;}
 return Object.freeze({
  async snapshot(): Promise<MortalState> {
   const value = await rpc('snapshot', null); assertMortalContract('State', value); return value;
  },
  async events(input = {after: 0, limit: 256}): Promise<MortalEvent[]> {
   assertMortalData(input);
   if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).sort().join(',') !== 'after,limit' || !Number.isSafeInteger(input.after) || input.after < 0 || !Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 1000) fail('INVALID_CONTRACT', 'Invalid mortal event page');
   const page = structuredClone(input), value = await rpc('events', page);
   if (!Array.isArray(value) || value.length > page.limit) fail('CORRUPT_LEDGER', 'Invalid mortal event page response');
   for (const row of value) assertMortalContract('Event', row);
   return value;
  },
  async submit(command: MortalCommand, principal: MortalPrincipal): Promise<MortalReceipt> {
   assertMortalContract('Command', command); assertMortalContract('Principal', principal);
   const value = await rpc('submit', {command: structuredClone(command), principal: structuredClone(principal)});
   assertMortalContract('Receipt', value); return value;
  },
  close(): Promise<void> {
   if (!closingPromise) {
    closing = true;
    closingPromise = (async () => {
     // Drain already admitted operations before closing. This wait is async in
     // the parent; no SQLite lock or polling loop runs on its event thread.
     if (pending.size && !dead) await new Promise<void>(resolve => idleWaiters.add(resolve));
     try {if (!dead) await rpc('close', null, true);}
     finally {await worker.terminate(); dead = true;}
    })();
   }
   return closingPromise;
  },
 });
}
