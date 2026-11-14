import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sign,generateKeyPairSync} from 'node:crypto';
import {canonical,hash,ArgoError} from '../packages/contracts/src/index.ts';
import {worldRequestHash} from '../packages/contracts/src/shared-world.ts';
import type {WorldEvent,WorldReceipt,WorldReceiptTrust} from '../packages/contracts/src/shared-world-types.ts';
import {initialWorldState,worldStateHash} from '../packages/ledger/src/world/rules.ts';
import {viewWorldActor} from '../packages/ledger/src/world/view.ts';
import {genesis,principal,command,speak,offer,accept} from './shared-world-rules-helpers.ts';
import {keys} from './mortal-fixtures.ts';

const source='../packages/ledger/src/world/journal.ts';
const loaded=await import(source).catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return {};throw error;});
const api:typeof import('../packages/ledger/src/world/journal.ts')=loaded as typeof import('../packages/ledger/src/world/journal.ts');
function available(){assert.equal(typeof api.createWorldEvent,'function','Shared journal must be implemented');}
const code=(c:string)=>(e:unknown)=>e instanceof ArgoError&&e.code===c;
function resign(event:WorldEvent):WorldEvent{
 const {hash:_,signature:__,...body}=event;
 const signed={...body,signature:sign(null,Buffer.from(canonical({domain:'shared-world/0.1.0/event',event:body})),keys.privateKey).toString('base64')};
 return {...signed,hash:hash(signed)};
}
function trust(g=genesis()):WorldReceiptTrust{return {scope:g.mortal.scope,genesis_hash:hash(g),authority_key_id:g.mortal.authority_key_id,authority_public_key:g.mortal.authority_public_key};}

test('signed compound transitions replay every prefix with one cursor and atomic loan knowledge',()=>{
 available();const g=genesis(),events:WorldEvent[]=[];let state=initialWorldState(g);
 for(const [action,id] of [[speak(),'hero'],[offer(),'hero']] as const){
  const c=command(state,action,id),created=api.createWorldEvent(g,state,c,principal(g,id),keys.privateKey);events.push(created.event);state=created.state;
  assert.equal(created.event.before_hash,worldStateHash(api.replayWorld(g,events.slice(0,-1))));
  assert.equal(created.receipt.request_hash,worldRequestHash(c,principal(g,id)));api.verifyWorldReceipt(created.receipt,trust(g));assert.deepEqual(api.replayWorld(g,events),state);
 }
 const accepted=api.createWorldEvent(g,state,command(state,accept(state),'companion'),principal(g,'companion'),keys.privateKey);events.push(accepted.event);state=accepted.state;
 assert.equal(state.physical.items.find(i=>i.id==='lamp')!.owner_id,'companion');assert.equal(state.loans.length,1);
 assert.equal(accepted.event.memory.payload.type,'loan_accepted');assert.deepEqual(accepted.event.memory.acquired_by,['hero','companion']);assert.equal(state.cursor.head,accepted.event.hash);
 assert.equal(accepted.receipt.state_hash,worldStateHash(state));assert.equal('effects'in accepted.receipt,false);assert.deepEqual(api.replayWorld(g,events),state);
 const moved=api.createWorldEvent(g,state,command(state,{type:'mortal',action:{type:'travel',route_id:'road'}},'companion'),principal(g,'companion'),keys.privateKey);events.push(moved.event);
 assert.equal(moved.state.cursor.world_time,600);assert.deepEqual(api.replayWorld(g,events),moved.state);
 const view=viewWorldActor(g,moved.state,{version:g.version,scope:g.mortal.scope,actor_id:'hero',cursor:moved.state.cursor},principal(g));assert.equal(view.query.cursor.head,moved.event.hash);
});

test('replay rejects independently re-signed incorrect witnesses, effects, draws and state commitments',()=>{
 available();const g=genesis(),state=initialWorldState(g),c=command(state,{type:'speak',text:'A public account',audience:{kind:'room',addressed_actor_ids:[]},in_reply_to:null});
 const {event}=api.createWorldEvent(g,state,c,principal(g),keys.privateKey);
 for(const change of [(e:WorldEvent)=>{e.memory.acquired_by=e.memory.acquired_by.filter(id=>id!=='companion');},(e:WorldEvent)=>{e.after_hash='f'.repeat(64);},(e:WorldEvent)=>{e.before_hash='f'.repeat(64);},(e:WorldEvent)=>{e.effects=[{kind:'world_time',actor_id:null,subject_id:null,amount:1}];},(e:WorldEvent)=>{e.draws=[{index:0,purpose:'forged',sides:6,value:1}];}]){
  const altered=structuredClone(event);change(altered);assert.throws(()=>api.verifyWorldEvent(g,state,resign(altered)),code('CORRUPT_LEDGER'));
 }
 const broken=structuredClone(event);broken.signature=Buffer.alloc(64).toString('base64');broken.hash=hash((({hash:_,...signed})=>signed)(broken));assert.throws(()=>api.verifyWorldEvent(g,state,broken),code('CORRUPT_LEDGER'));
});

test('complete genesis, controller identity and request bytes are bound by journal and receipt signatures',()=>{
 available();const g=genesis(),s=initialWorldState(g),c=command(s,speak()),p=principal(g),result=api.createWorldEvent(g,s,c,p,keys.privateKey);
 for(const other of [{...g,environment:'day' as const},{...g,mortal:{...g.mortal,seed:'f'.repeat(64)}},{...g,mortal:{...g.mortal,scope:{...g.mortal.scope,branch_id:'other'}}}])assert.throws(()=>api.verifyWorldEvent(other,s,result.event));
 assert.throws(()=>api.createWorldEvent(g,s,c,{...p,principal_id:'impostor'},keys.privateKey),code('UNAUTHORIZED'));
 assert.throws(()=>api.createWorldEvent(g,s,c,p,generateKeyPairSync('ed25519').privateKey),code('UNAUTHORIZED'));
 for(const key of ['request_id','request_hash','event_hash','state_hash','genesis_hash','authority_key_id'] as const){const receipt=structuredClone(result.receipt);receipt[key]=key.endsWith('hash')?'f'.repeat(64):'other';assert.throws(()=>api.verifyWorldReceipt(receipt,trust(g)));}
 const wrong=structuredClone(result.receipt);wrong.scope.branch_id='other';assert.throws(()=>api.verifyWorldReceipt(wrong,trust(g)),code('UNAUTHORIZED'));
 const time=structuredClone(result.receipt);time.cursor.world_time++;assert.throws(()=>api.verifyWorldReceipt(time,trust(g)),code('UNAUTHORIZED'));
 for(const foreign of [{...trust(g),genesis_hash:'f'.repeat(64)},{...trust(g),authority_key_id:'other'},{...trust(g),scope:{...g.mortal.scope,world_id:'other'}}])assert.throws(()=>api.verifyWorldReceipt(result.receipt,foreign),code('UNAUTHORIZED'));
 assert.equal(result.receipt.request_hash,worldRequestHash(c,p));
});

test('whole replay refuses duplicate requests, reordered prefixes and active history without evaluating traps',()=>{
 available();const g=genesis(),s=initialWorldState(g),a=api.createWorldEvent(g,s,command(s,speak()),principal(g),keys.privateKey),b=api.createWorldEvent(g,a.state,command(a.state,speak()),principal(g),keys.privateKey);
 assert.throws(()=>api.replayWorld(g,[b.event,a.event]),code('CORRUPT_LEDGER'));
 const duplicate=structuredClone(b.event);duplicate.command.request_id=a.event.command.request_id;duplicate.memory.request_id=duplicate.command.request_id;duplicate.memory.record_id=hash({domain:'shared-world/0.1.0/memory',genesis_hash:hash(g),request_id:duplicate.command.request_id,sequence:2});
 assert.throws(()=>api.replayWorld(g,[a.event,resign(duplicate)]),code('CORRUPT_LEDGER'));
 let touched=0;const active=[a.event];Object.defineProperty(active,'0',{enumerable:true,get(){touched++;return a.event;}});assert.throws(()=>api.replayWorld(g,active),code('INVALID_CONTRACT'));
 const proxy=new Proxy([a.event],{get(){touched++;throw Error('active');},getPrototypeOf(){touched++;throw Error('active');}});assert.throws(()=>api.replayWorld(g,proxy),code('INVALID_CONTRACT'));
 const receipt=structuredClone(a.receipt);Object.defineProperty(receipt,'signature',{enumerable:true,get(){touched++;return a.receipt.signature;}});assert.throws(()=>api.verifyWorldReceipt(receipt,trust(g)),code('INVALID_CONTRACT'));assert.equal(touched,0);
});

test('journal owns inputs and finalizes the immutable state head without mutating prior states',()=>{
 available();const g=genesis(),s=initialWorldState(g),c=command(s,speak()),p=principal(g),before=canonical({g,s,c,p}),created=api.createWorldEvent(g,s,c,p,keys.privateKey);
 assert.equal(canonical({g,s,c,p}),before);assert.ok(Object.isFrozen(created.state.memories[0]!.payload));assert.equal(s.memories.length,0);
 c.action={type:'speak',text:'Changed',audience:{kind:'self',addressed_actor_ids:[]},in_reply_to:null};p.principal_id='changed';assert.notEqual(canonical(created.event.command),canonical(c));
 assert.deepEqual(api.verifyWorldEvent(g,s,created.event),created.state);assert.equal(worldStateHash(created.state),created.event.after_hash);
 const malformed=structuredClone(created.state);malformed.memories[0]!.payload={type:'close_mythic_engagement'};assert.throws(()=>api.createWorldEvent(g,malformed,command(malformed,speak()),principal(g),keys.privateKey));
});
