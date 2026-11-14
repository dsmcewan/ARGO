import {types as nodeTypes} from 'node:util';
import {assertWorldData,assertWorldContract,assertWorldGenesis,canonical,hash,fail,worldRequestHash,freezeDto} from '@argo/contracts';
import type {WorldGenesis,WorldCommand,WorldPrincipal,WorldReceipt} from '@argo/contracts';
import {verifyWorldReceipt} from '@argo/ledger';
import {CAPABILITIES} from '@argo/model-client';
import {CONVERSATION_VERSION} from './conversation-types.ts';
import type {ConversationBinding,ConversationPolicy,OpenConversationStoreOptions,TurnInput,TurnRef,TurnRow,Mutation,Terminal} from './conversation-types.ts';
export const MAX_ROW=128*1024,MAX_RPC=1024*1024,MAX_TURNS=10000,MAX_TOTAL=64*1024*1024;
export function invalid(message:string):never{return fail('INVALID_CONTRACT',message);}
export function corrupt(message:string):never{return fail('CORRUPT_LEDGER',message);}
export function capabilityFields(input:unknown,required:string[],optional:string[]=[]):Record<string,unknown>{
 if(!input||typeof input!=='object'||nodeTypes.isProxy(input)||![Object.prototype,null].includes(Object.getPrototypeOf(input)))invalid('Expected plain capability options');
 const d=Object.getOwnPropertyDescriptors(input),keys=Reflect.ownKeys(input);
 if(required.some(k=>!Object.hasOwn(d,k))||keys.some(k=>typeof k!=='string'||!required.includes(k)&&!optional.includes(k)||!d[k]?.enumerable||!('value'in d[k]!)))invalid('Invalid capability fields');
 return Object.fromEntries(keys.map(k=>[k,d[k as string]!.value]));
}
export function fields(input:unknown,keys:string[]):asserts input is Record<string,unknown>{assertWorldData(input);if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length!==keys.length||keys.some(k=>!Object.hasOwn(input,k)))invalid('Invalid closed conversation fields');}
export function integer(value:unknown,min:number,max=Number.MAX_SAFE_INTEGER):asserts value is number{if(!Number.isSafeInteger(value)||(value as number)<min||(value as number)>max)invalid('Invalid bounded conversation integer');}
export function digest(value:unknown):asserts value is string{if(typeof value!=='string'||!/^[0-9a-f]{64}$/.test(value))invalid('Invalid conversation digest');}
export function turnId(value:unknown):asserts value is string{if(typeof value!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value)||['constructor','prototype','__proto__'].includes(value))invalid('Invalid conversation turn ID');}
export function assertRef(input:unknown):asserts input is TurnRef{fields(input,['turn_id']);turnId(input.turn_id);}
export function assertInput(input:unknown,maxCharacters=2048):asserts input is TurnInput{fields(input,['turn_id','text']);turnId(input.turn_id);if(typeof input.text!=='string'||!input.text.trim()||[...input.text].length>maxCharacters)invalid('Invalid player speech');}
export function assertPolicy(input:unknown):asserts input is ConversationPolicy{
 fields(input,['provider_policy_id','generation_mode','candidates','effort','timeout_ms','max_context_bytes','max_output_tokens']);
 if(typeof input.provider_policy_id!=='string'||!input.provider_policy_id.trim()||input.provider_policy_id.length>128||!['injected','offline_fixture'].includes(input.generation_mode as string)||typeof input.effort!=='string')invalid('Invalid conversation model policy');
 integer(input.timeout_ms,1,60000);integer(input.max_context_bytes,1024,131072);integer(input.max_output_tokens,1,8192);
 if(!Array.isArray(input.candidates)||!input.candidates.length||input.candidates.length>8)invalid('Invalid conversation candidates');
 const pools=new Set<string>();for(const c of input.candidates){fields(c,['vendor','model','pool']);if(typeof c.model!=='string'||typeof c.pool!=='string'||!c.pool.trim()||c.pool.length>512||pools.has(c.pool))invalid('Invalid conversation pool');const cap=CAPABILITIES[c.model];if(!cap||cap.vendor!==c.vendor||!cap.efforts.includes(input.effort))invalid('Unsupported conversation model policy');pools.add(c.pool);}
}
export function buildBinding(options:OpenConversationStoreOptions):ConversationBinding{
 assertWorldGenesis(options.genesis);assertWorldContract('Principal',options.player);assertWorldContract('Principal',options.npc);assertPolicy(options.policy);
 const g=options.genesis;for(const [p,role] of [[options.player,'player'],[options.npc,'npc']] as const){const a=g.mortal.actors.find(a=>a.id===p.actor_id);if(p.role!==role||!a||a.kind!==role||a.controller_id!==p.principal_id||canonical(p.scope)!==canonical(g.mortal.scope))fail('UNAUTHORIZED','Conversation requires the supplied immutable direct controllers');}
 return freezeDto(structuredClone({version:CONVERSATION_VERSION,scope:g.mortal.scope,genesis_hash:hash(g),authority_key_id:g.mortal.authority_key_id,authority_public_key:g.mortal.authority_public_key,player:options.player,npc:options.npc,policy:options.policy,dialogue_profile:'shared-world-dialogue/0.1.0',audience:'whisper',max_attempts_per_pool:1,communication_goal:null}));
}
export function assertBinding(b:unknown):asserts b is ConversationBinding{
 fields(b,['version','scope','genesis_hash','authority_key_id','authority_public_key','player','npc','policy','dialogue_profile','audience','max_attempts_per_pool','communication_goal']);
 if(b.version!==CONVERSATION_VERSION||b.dialogue_profile!=='shared-world-dialogue/0.1.0'||b.audience!=='whisper'||b.max_attempts_per_pool!==1||b.communication_goal!==null)invalid('Invalid conversation binding version');
 assertWorldContract('ReceiptTrust',{scope:b.scope,genesis_hash:b.genesis_hash,authority_key_id:b.authority_key_id,authority_public_key:b.authority_public_key});assertWorldContract('Principal',b.player);assertWorldContract('Principal',b.npc);assertPolicy(b.policy);
 if(b.player.role!=='player'||b.npc.role!=='npc'||b.player.actor_id===b.npc.actor_id||canonical(b.player.scope)!==canonical(b.scope)||canonical(b.npc.scope)!==canonical(b.scope))invalid('Conversation binding identities differ');
}
export const bindingHash=(b:ConversationBinding)=>hash({domain:CONVERSATION_VERSION+'/binding',binding:b});
export const turnKey=(b:ConversationBinding,id:string)=>hash({domain:CONVERSATION_VERSION+'/turn',binding_hash:bindingHash(b),turn_id:id});
export const inputHash=(b:ConversationBinding,input:TurnInput)=>hash({domain:CONVERSATION_VERSION+'/input',binding_hash:bindingHash(b),...input});
export const requestIdFor=(b:ConversationBinding,id:string,side:'input'|'reply')=>hash({domain:CONVERSATION_VERSION+'/'+side+'-request',binding_hash:bindingHash(b),turn_id:id});
export const memoryId=(b:ConversationBinding,c:WorldCommand,r:WorldReceipt)=>hash({domain:'shared-world/0.1.0/memory',genesis_hash:b.genesis_hash,request_id:c.request_id,sequence:r.cursor.sequence});
export function receiptFor(b:ConversationBinding,c:WorldCommand,p:WorldPrincipal,r:unknown):asserts r is WorldReceipt{
 assertWorldContract('Receipt',r);verifyWorldReceipt(r,{scope:b.scope,genesis_hash:b.genesis_hash,authority_key_id:b.authority_key_id,authority_public_key:b.authority_public_key});
 if(r.request_id!==c.request_id||r.request_hash!==worldRequestHash(c,p)||r.cursor.sequence!==c.expected.sequence+1||r.cursor.head!==r.event_hash||r.cursor.world_time<c.expected.world_time)invalid('Conversation receipt differs from exact pending command');
}
export function assertRow(input:unknown,b:ConversationBinding,maxCharacters=2048,maxReplyCharacters=2048):asserts input is TurnRow{
 fields(input,['version','binding_hash','turn_id','turn_key','input_hash','text','revision','phase','cancel_requested','created_at_ms','updated_at_ms','input_command','input_receipt','inbound_record_id','attempt','reply_command','reply_receipt','terminal']);
 const r=input as unknown as TurnRow;assertInput({turn_id:r.turn_id,text:r.text},maxCharacters);integer(r.revision,0);integer(r.created_at_ms,0);integer(r.updated_at_ms,r.created_at_ms);
 if(r.version!==CONVERSATION_VERSION||r.binding_hash!==bindingHash(b)||r.turn_key!==turnKey(b,r.turn_id)||r.input_hash!==inputHash(b,{turn_id:r.turn_id,text:r.text})||typeof r.cancel_requested!=='boolean'||!['accepted','input_pending','input_committed','generating','reply_pending','settled'].includes(r.phase))invalid('Conversation row identity differs');
 for(const side of ['input','reply'] as const){const c=r[side+'_command' as 'input_command'|'reply_command'];if(c===null)continue;assertWorldContract('Command',c);const actor=side==='input'?b.player:b.npc,target=side==='input'?b.npc:b.player;
  if(c.actor_id!==actor.actor_id||canonical(c.scope)!==canonical(b.scope)||c.request_id!==requestIdFor(b,r.turn_id,side)||c.causation_id!==c.expected.head||c.action.type!=='speak'||canonical(c.action.audience)!==canonical({kind:'whisper',addressed_actor_ids:[target.actor_id]})||c.action.in_reply_to!==(side==='input'?null:r.inbound_record_id)||side==='input'&&c.action.text!==r.text||side==='reply'&&[...c.action.text].length>maxReplyCharacters)invalid('Conversation command escaped its fixed speech role');
 }
 if(r.input_receipt!==null){if(!r.input_command)invalid('Input receipt lacks command');receiptFor(b,r.input_command,b.player,r.input_receipt);if(r.inbound_record_id!==memoryId(b,r.input_command,r.input_receipt))invalid('Inbound memory identity differs');}else if(r.inbound_record_id!==null)invalid('Inbound record lacks receipt');
 if(r.attempt!==null){fields(r.attempt,['attempt_id','owner_id','query','started_at_ms','deadline_at_ms']);digest(r.attempt.attempt_id);digest(r.attempt.owner_id);assertWorldContract('Query',r.attempt.query);integer(r.attempt.started_at_ms,0);integer(r.attempt.deadline_at_ms,r.attempt.started_at_ms+1);
  const q=r.attempt.query,receipt=r.input_receipt;if(!receipt||q.actor_id!==b.npc.actor_id||canonical(q.scope)!==canonical(b.scope)||q.cursor.sequence<receipt.cursor.sequence||q.cursor.world_time<receipt.cursor.world_time||q.cursor.sequence===receipt.cursor.sequence&&canonical(q.cursor)!==canonical(receipt.cursor)||r.attempt.deadline_at_ms-r.attempt.started_at_ms!==b.policy.timeout_ms)invalid('Generation attempt differs from committed input/policy');
 }
 if(r.reply_command!==null&&(!r.attempt||canonical(r.reply_command.expected)!==canonical(r.attempt.query.cursor)))invalid('Reply was rebased or lacks its attempt');
 if(r.reply_receipt!==null){if(!r.reply_command)invalid('Reply receipt lacks command');receiptFor(b,r.reply_command,b.npc,r.reply_receipt);}
 const prefix=r.reply_receipt?5:r.reply_command?4:r.attempt?3:r.input_receipt?2:r.input_command?1:0;
 if(prefix>=2&&!r.input_command||prefix>=3&&!r.input_receipt||prefix>=4&&!r.attempt||prefix>=5&&!r.reply_command)invalid('Conversation phase contains a missing prerequisite');
 if(r.phase!=='settled'){const expected=['accepted','input_pending','input_committed','generating','reply_pending'].indexOf(r.phase);if(prefix!==expected||r.terminal!==null)invalid('Conversation phase fields disagree');}
 else{
  if(!r.terminal)invalid('Settled turn lacks outcome');fields(r.terminal,['outcome','reason','rejection_proof']);const t=r.terminal;
  const valid=t.outcome==='replied'?prefix===5&&t.reason==='completed':t.outcome==='no_reply'?prefix>=2&&prefix<=3&&['unavailable_context','adapter_null'].includes(t.reason):t.outcome==='cancelled'?r.cancel_requested&&[0,2,3].includes(prefix)&&t.reason==='cancelled':t.outcome==='generation_uncertain'?prefix===3&&t.reason==='attempt_expired':t.outcome==='generation_failed'?prefix===3&&['attempt_failed','invalid_proposal'].includes(t.reason):t.outcome==='input_rejected'?prefix===1&&t.reason==='occupied_sequence':t.outcome==='reply_rejected'?prefix===4&&t.reason==='occupied_sequence':false;
  if(!valid)invalid('Invalid terminal conversation prefix');
  if(t.outcome.endsWith('_rejected')){if(!t.rejection_proof)invalid('Dispatch rejection lacks prefix proof');const p=t.rejection_proof;fields(p,['sequence','previous_hash','event_hash','request_id','request_hash']);const c=t.outcome==='input_rejected'?r.input_command!:r.reply_command!;integer(p.sequence,1);digest(p.previous_hash);digest(p.event_hash);digest(p.request_hash);if(typeof p.request_id!=='string'||p.sequence!==c.expected.sequence+1||p.previous_hash!==c.expected.head||p.request_hash===worldRequestHash(c,t.outcome==='input_rejected'?b.player:b.npc))invalid('Invalid rejection proof');}
  else if(t.rejection_proof!==null)invalid('Unexpected rejection proof');
 }
 if(Buffer.byteLength(canonical(r))>MAX_ROW)invalid('Conversation row capacity exceeded');
}
export function initialRow(b:ConversationBinding,input:TurnInput,now:number):TurnRow{return {version:CONVERSATION_VERSION,binding_hash:bindingHash(b),...input,turn_key:turnKey(b,input.turn_id),input_hash:inputHash(b,input),revision:0,phase:'accepted',cancel_requested:false,created_at_ms:now,updated_at_ms:now,input_command:null,input_receipt:null,inbound_record_id:null,attempt:null,reply_command:null,reply_receipt:null,terminal:null};}
export function mutate(row:TurnRow,m:Mutation,b:ConversationBinding,now:number):TurnRow{
 const keys:Record<string,string[]>={save_input:['command'],confirm_input:['receipt'],claim_generation:['attempt'],save_reply:['command','attempt_id'],confirm_reply:['receipt'],settle:['terminal'],cancel:[]};
 assertWorldData(m);if(!m||!Object.hasOwn(keys,m.type))invalid('Unknown conversation mutation');fields(m,['type',...keys[m.type]!]);const r=structuredClone(row);const requirePhase=(phase:string)=>{if(r.phase!==phase)invalid('Illegal conversation transition');};
 if(m.type==='cancel'){r.cancel_requested=true;if(['accepted','input_committed','generating'].includes(r.phase)){r.phase='settled';r.terminal={outcome:'cancelled',reason:'cancelled',rejection_proof:null};}}
 else if(m.type==='save_input'){requirePhase('accepted');if(r.cancel_requested)invalid('Cancelled input');r.input_command=m.command;r.phase='input_pending';}
 else if(m.type==='confirm_input'){requirePhase('input_pending');r.input_receipt=m.receipt;r.inbound_record_id=memoryId(b,r.input_command!,m.receipt);r.phase='input_committed';if(r.cancel_requested){r.phase='settled';r.terminal={outcome:'cancelled',reason:'cancelled',rejection_proof:null};}}
 else if(m.type==='claim_generation'){requirePhase('input_committed');if(r.cancel_requested||m.attempt.started_at_ms>now||m.attempt.deadline_at_ms<=now)invalid('Generation claim is expired or cancelled');r.attempt=m.attempt;r.phase='generating';}
 else if(m.type==='save_reply'){requirePhase('generating');if(r.cancel_requested||r.attempt!.attempt_id!==m.attempt_id||now>=r.attempt!.deadline_at_ms)invalid('Generation no longer owns the reply');r.reply_command=m.command;r.phase='reply_pending';}
 else if(m.type==='confirm_reply'){requirePhase('reply_pending');r.reply_receipt=m.receipt;r.phase='settled';r.terminal={outcome:'replied',reason:'completed',rejection_proof:null};}
 else{if(r.phase==='settled')invalid('Settled turns cannot be replaced');if(r.phase==='generating'&&now>=r.attempt!.deadline_at_ms&&m.terminal.outcome!=='generation_uncertain')invalid('Expired attempt cannot publish a generation result');if(m.terminal.outcome==='generation_uncertain'&&(r.phase!=='generating'||now<r.attempt!.deadline_at_ms))invalid('Generation attempt has not expired');r.phase='settled';r.terminal=m.terminal;}
 r.revision++;r.updated_at_ms=Math.max(now,r.updated_at_ms);assertRow(r,b);return r;
}
