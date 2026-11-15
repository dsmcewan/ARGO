import {KeyObject, createPublicKey, sign, verify} from 'node:crypto';
import {types as nodeTypes} from 'node:util';
import {assertMortalV3Contract, assertMortalV3Genesis, assertMortalV3Data} from '../../../contracts/src/mortal-v3.ts';
import {assertScope, canonical, fail, hash} from '../../../contracts/src/index.ts';
import type {MortalV3Genesis, MortalV3State, MortalV3Command, MortalV3Principal, MortalV3Event, MortalV3Receipt, MortalV3ReceiptTrust} from '../../../contracts/src/mortal-v3-types.ts';
import {initialMortalV3State, resolveMortalV3, mortalV3StateHash} from './rules.ts';

function corruption(message: string): never {return fail('CORRUPT_LEDGER', message);}
function publicKey(pem: string): KeyObject {
 if (typeof pem !== 'string' || !/^-----BEGIN PUBLIC KEY-----\r?\n[A-Za-z0-9+/=\r\n]+-----END PUBLIC KEY-----$/.test(pem.trim())) fail('INVALID_CONTRACT', 'Mortal trust requires public-only PEM');
 try {
  const key = createPublicKey(pem);
  if (key.type !== 'public' || key.asymmetricKeyType !== 'ed25519') fail('INVALID_CONTRACT', 'Mortal trust requires Ed25519');
  return key;
 } catch {return fail('INVALID_CONTRACT', 'Invalid mortal trust public key');}
}
function signingKey(genesis: MortalV3Genesis, key: KeyObject): void {
 if (nodeTypes.isProxy(key) || !(key instanceof KeyObject)) fail('INVALID_CONTRACT', 'Mortal signer must be a private KeyObject');
 try {
  if (key.type !== 'private' || key.asymmetricKeyType !== 'ed25519' || !createPublicKey(key).equals(publicKey(genesis.authority_public_key))) fail('UNAUTHORIZED', 'Mortal signer differs from immutable genesis');
 } catch {fail('UNAUTHORIZED', 'Mortal signer differs from immutable genesis');}
}
function receiptBytes(receipt: Omit<MortalV3Receipt, 'signature'>): Buffer {
 return Buffer.from(canonical({domain: 'mortal-receipt/0.3.0', receipt}));
}

/** Host-only: effects in a signed receipt may concern other actors. Public trust
 * verification proves signature/identity, not permission to disclose a receipt. */
export function verifyMortalV3Receipt(receipt: MortalV3Receipt, trust: MortalV3ReceiptTrust): void {
 assertMortalV3Contract('Receipt', receipt); assertMortalV3Data(trust);
 if (!trust || typeof trust !== 'object' || Object.keys(trust).sort().join(',') !== 'authority_key_id,authority_public_key,genesis_hash,scope') fail('INVALID_CONTRACT', 'Invalid mortal receipt trust fields');
 try {assertScope(trust.scope);} catch {fail('INVALID_CONTRACT', 'Invalid mortal receipt trust scope');}
 if (typeof trust.genesis_hash !== 'string' || !/^[0-9a-f]{64}$/.test(trust.genesis_hash) || typeof trust.authority_key_id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(trust.authority_key_id) || ['prototype', 'constructor'].includes(trust.authority_key_id)) fail('INVALID_CONTRACT', 'Invalid mortal receipt trust identity');
 const key = publicKey(trust.authority_public_key);
 if (canonical(receipt.scope) !== canonical(trust.scope) || receipt.genesis_hash !== trust.genesis_hash || receipt.authority_key_id !== trust.authority_key_id) fail('UNAUTHORIZED', 'Mortal receipt does not match pinned trust');
 const {signature, ...body} = receipt;
 if (!verify(null, receiptBytes(body), key, Buffer.from(signature, 'base64'))) fail('UNAUTHORIZED', 'Mortal receipt signature does not verify');
}

/** Requires a verified prior state and the host's signing capability. It does
 * not establish request-ID uniqueness; the storage transaction owns that index. */
export function createMortalV3Event(genesis: MortalV3Genesis, state: MortalV3State, command: MortalV3Command, principal: MortalV3Principal, privateKey: KeyObject): {event: MortalV3Event; state: MortalV3State; receipt: MortalV3Receipt} {
 assertMortalV3Genesis(genesis); assertMortalV3Contract('State', state); assertMortalV3Contract('Command', command); assertMortalV3Contract('Principal', principal);
 signingKey(genesis, privateKey);
 if (state.genesis_hash !== hash(genesis)) corruption('Mortal state belongs to another genesis');
 if (state.sequence >= 1000000) fail('INVALID_ACTION', 'Mortal history limit reached');
 const resolution = resolveMortalV3(genesis, state, command, principal);
 const body: Omit<MortalV3Event, 'signature' | 'hash'> = {
  version: genesis.version, scope: structuredClone(genesis.scope), genesis_hash: hash(genesis), sequence: state.sequence + 1, previous_hash: state.head,
  command: structuredClone(command), principal: structuredClone(principal), before_hash: mortalV3StateHash(state), after_hash: mortalV3StateHash(resolution.state),
  draws: structuredClone(resolution.draws), effects: structuredClone(resolution.effects),
 };
 const signed = {...body, signature: sign(null, Buffer.from(canonical(body)), privateKey).toString('base64')};
 const event: MortalV3Event = {...signed, hash: hash(signed)};
 const next = structuredClone(resolution.state); next.head = event.hash;
 const receiptBody: Omit<MortalV3Receipt, 'signature'> = {
  version: genesis.version, scope: structuredClone(genesis.scope), genesis_hash: body.genesis_hash, authority_key_id: genesis.authority_key_id,
  request_id: command.request_id, request_hash: hash({command, principal}), event_hash: event.hash, cursor: {sequence: event.sequence, head: event.hash}, state_hash: event.after_hash, effects: structuredClone(event.effects),
 };
 const receipt: MortalV3Receipt = {...receiptBody, signature: sign(null, receiptBytes(receiptBody), privateKey).toString('base64')};
 assertMortalV3Contract('Event', event); assertMortalV3Contract('State', next); assertMortalV3Contract('Receipt', receipt);
 return {event, state: next, receipt};
}

/** Verify against a trusted prior prefix. One event cannot prove history-wide
 * request-ID uniqueness; replayMortalV3 and the SQLite index enforce that rule. */
export function verifyMortalV3Event(genesis: MortalV3Genesis, state: MortalV3State, event: MortalV3Event): MortalV3State {
 assertMortalV3Genesis(genesis); assertMortalV3Contract('State', state); assertMortalV3Contract('Event', event);
 const identity = hash(genesis);
 if (state.genesis_hash !== identity || event.genesis_hash !== identity || canonical(event.scope) !== canonical(genesis.scope) || canonical(state.scope) !== canonical(genesis.scope)) corruption('Mortal event/state genesis identity differs');
 if (event.sequence !== state.sequence + 1 || event.previous_hash !== state.head || event.before_hash !== mortalV3StateHash(state)) corruption('Mortal event is not the next verified state transition');
 const {hash: eventHash, ...signed} = event;
 const {signature, ...body} = signed;
 if (hash(signed) !== eventHash || !verify(null, Buffer.from(canonical(body)), publicKey(genesis.authority_public_key), Buffer.from(signature, 'base64'))) corruption('Mortal event hash or signature does not verify');
 let resolution;
 try {resolution = resolveMortalV3(genesis, state, event.command, event.principal);} catch {return corruption('Signed mortal event violates action admission');}
 if (canonical(resolution.draws) !== canonical(event.draws) || canonical(resolution.effects) !== canonical(event.effects) || mortalV3StateHash(resolution.state) !== event.after_hash) corruption('Signed mortal event differs from deterministic resolution');
 const next = structuredClone(resolution.state); next.head = event.hash;
 assertMortalV3Contract('State', next); return next;
}

/** Whole host history, bounded to one million entries. Per-event DTO limits
 * apply individually; no unbounded in-memory history is retained by storage. */
export function replayMortalV3(genesis: MortalV3Genesis, events: MortalV3Event[]): MortalV3State {
 assertMortalV3Genesis(genesis);
 if (nodeTypes.isProxy(events) || !Array.isArray(events) || Object.getPrototypeOf(events) !== Array.prototype || events.length > 1000000) fail('INVALID_CONTRACT', 'Invalid mortal event history container');
 const ownKeys = Reflect.ownKeys(events);
 if (ownKeys.length !== events.length + 1 || ownKeys.some(key => typeof key !== 'string')) fail('INVALID_CONTRACT', 'Mortal history must be a dense undecorated array');
 let state = initialMortalV3State(genesis);
 const requests = new Set<string>();
 for (let index = 0; index < events.length; index++) {
  const descriptor = Object.getOwnPropertyDescriptor(events, String(index));
  if (!descriptor?.enumerable || !('value' in descriptor)) fail('INVALID_CONTRACT', 'Mortal history contains an active or missing entry');
  const event: unknown = descriptor.value; assertMortalV3Contract('Event', event);
  if (requests.has(event.command.request_id)) corruption('Mortal history repeats a request ID');
  requests.add(event.command.request_id); state = verifyMortalV3Event(genesis, state, event);
 }
 return state;
}
