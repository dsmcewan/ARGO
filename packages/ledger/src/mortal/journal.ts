import {KeyObject, createPublicKey, sign, verify} from 'node:crypto';
import {types as nodeTypes} from 'node:util';
import {assertMortalContract, assertMortalGenesis, assertMortalData, assertScope, canonical, fail, hash} from '@argo/contracts';
import type {MortalGenesis, MortalState, MortalCommand, MortalPrincipal, MortalEvent, MortalReceipt, MortalReceiptTrust} from '@argo/contracts';
import {initialMortalState, resolveMortal, mortalStateHash} from './rules.ts';

function corruption(message: string): never {return fail('CORRUPT_LEDGER', message);}
function publicKey(pem: string): KeyObject {
 if (typeof pem !== 'string' || !/^-----BEGIN PUBLIC KEY-----\r?\n[A-Za-z0-9+/=\r\n]+-----END PUBLIC KEY-----$/.test(pem.trim())) fail('INVALID_CONTRACT', 'Mortal trust requires public-only PEM');
 try {
  const key = createPublicKey(pem);
  if (key.type !== 'public' || key.asymmetricKeyType !== 'ed25519') fail('INVALID_CONTRACT', 'Mortal trust requires Ed25519');
  return key;
 } catch {return fail('INVALID_CONTRACT', 'Invalid mortal trust public key');}
}
function signingKey(genesis: MortalGenesis, key: KeyObject): void {
 if (nodeTypes.isProxy(key) || !(key instanceof KeyObject)) fail('INVALID_CONTRACT', 'Mortal signer must be a private KeyObject');
 try {
  if (key.type !== 'private' || key.asymmetricKeyType !== 'ed25519' || !createPublicKey(key).equals(publicKey(genesis.authority_public_key))) fail('UNAUTHORIZED', 'Mortal signer differs from immutable genesis');
 } catch {fail('UNAUTHORIZED', 'Mortal signer differs from immutable genesis');}
}
function receiptBytes(receipt: Omit<MortalReceipt, 'signature'>): Buffer {
 return Buffer.from(canonical({domain: 'mortal-receipt/0.2.0', receipt}));
}

/** Host-only: effects in a signed receipt may concern other actors. Public trust
 * verification proves signature/identity, not permission to disclose a receipt. */
export function verifyMortalReceipt(receipt: MortalReceipt, trust: MortalReceiptTrust): void {
 assertMortalContract('Receipt', receipt); assertMortalData(trust);
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
export function createMortalEvent(genesis: MortalGenesis, state: MortalState, command: MortalCommand, principal: MortalPrincipal, privateKey: KeyObject): {event: MortalEvent; state: MortalState; receipt: MortalReceipt} {
 assertMortalGenesis(genesis); assertMortalContract('State', state); assertMortalContract('Command', command); assertMortalContract('Principal', principal);
 signingKey(genesis, privateKey);
 if (state.genesis_hash !== hash(genesis)) corruption('Mortal state belongs to another genesis');
 if (state.sequence >= 1000000) fail('INVALID_ACTION', 'Mortal history limit reached');
 const resolution = resolveMortal(genesis, state, command, principal);
 const body: Omit<MortalEvent, 'signature' | 'hash'> = {
  version: genesis.version, scope: structuredClone(genesis.scope), genesis_hash: hash(genesis), sequence: state.sequence + 1, previous_hash: state.head,
  command: structuredClone(command), principal: structuredClone(principal), before_hash: mortalStateHash(state), after_hash: mortalStateHash(resolution.state),
  draws: structuredClone(resolution.draws), effects: structuredClone(resolution.effects),
 };
 const signed = {...body, signature: sign(null, Buffer.from(canonical(body)), privateKey).toString('base64')};
 const event: MortalEvent = {...signed, hash: hash(signed)};
 const next = structuredClone(resolution.state); next.head = event.hash;
 const receiptBody: Omit<MortalReceipt, 'signature'> = {
  version: genesis.version, scope: structuredClone(genesis.scope), genesis_hash: body.genesis_hash, authority_key_id: genesis.authority_key_id,
  request_id: command.request_id, request_hash: hash({command, principal}), event_hash: event.hash, cursor: {sequence: event.sequence, head: event.hash}, state_hash: event.after_hash, effects: structuredClone(event.effects),
 };
 const receipt: MortalReceipt = {...receiptBody, signature: sign(null, receiptBytes(receiptBody), privateKey).toString('base64')};
 assertMortalContract('Event', event); assertMortalContract('State', next); assertMortalContract('Receipt', receipt);
 return {event, state: next, receipt};
}

/** Verify against a trusted prior prefix. One event cannot prove history-wide
 * request-ID uniqueness; replayMortal and the SQLite index enforce that rule. */
export function verifyMortalEvent(genesis: MortalGenesis, state: MortalState, event: MortalEvent): MortalState {
 assertMortalGenesis(genesis); assertMortalContract('State', state); assertMortalContract('Event', event);
 const identity = hash(genesis);
 if (state.genesis_hash !== identity || event.genesis_hash !== identity || canonical(event.scope) !== canonical(genesis.scope) || canonical(state.scope) !== canonical(genesis.scope)) corruption('Mortal event/state genesis identity differs');
 if (event.sequence !== state.sequence + 1 || event.previous_hash !== state.head || event.before_hash !== mortalStateHash(state)) corruption('Mortal event is not the next verified state transition');
 const {hash: eventHash, ...signed} = event;
 const {signature, ...body} = signed;
 if (hash(signed) !== eventHash || !verify(null, Buffer.from(canonical(body)), publicKey(genesis.authority_public_key), Buffer.from(signature, 'base64'))) corruption('Mortal event hash or signature does not verify');
 let resolution;
 try {resolution = resolveMortal(genesis, state, event.command, event.principal);} catch {return corruption('Signed mortal event violates action admission');}
 if (canonical(resolution.draws) !== canonical(event.draws) || canonical(resolution.effects) !== canonical(event.effects) || mortalStateHash(resolution.state) !== event.after_hash) corruption('Signed mortal event differs from deterministic resolution');
 const next = structuredClone(resolution.state); next.head = event.hash;
 assertMortalContract('State', next); return next;
}

/** Whole host history, bounded to one million entries. Per-event DTO limits
 * apply individually; no unbounded in-memory history is retained by storage. */
export function replayMortal(genesis: MortalGenesis, events: MortalEvent[]): MortalState {
 assertMortalGenesis(genesis);
 if (nodeTypes.isProxy(events) || !Array.isArray(events) || Object.getPrototypeOf(events) !== Array.prototype || events.length > 1000000) fail('INVALID_CONTRACT', 'Invalid mortal event history container');
 const ownKeys = Reflect.ownKeys(events);
 if (ownKeys.length !== events.length + 1 || ownKeys.some(key => typeof key !== 'string')) fail('INVALID_CONTRACT', 'Mortal history must be a dense undecorated array');
 let state = initialMortalState(genesis);
 const requests = new Set<string>();
 for (let index = 0; index < events.length; index++) {
  const descriptor = Object.getOwnPropertyDescriptor(events, String(index));
  if (!descriptor?.enumerable || !('value' in descriptor)) fail('INVALID_CONTRACT', 'Mortal history contains an active or missing entry');
  const event: unknown = descriptor.value; assertMortalContract('Event', event);
  if (requests.has(event.command.request_id)) corruption('Mortal history repeats a request ID');
  requests.add(event.command.request_id); state = verifyMortalEvent(genesis, state, event);
 }
 return state;
}
