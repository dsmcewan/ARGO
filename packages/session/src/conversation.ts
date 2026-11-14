/** Explicit one-question/one-reply orchestration; the world journal alone commits. */
import {randomBytes,createPublicKey,verify} from 'node:crypto';
import {types as nodeTypes} from 'node:util';
import {ArgoError,assertWorldContract,canonical,hash,freezeDto,fail,worldRequestHash} from '@argo/contracts';
import type {WorldCommand,WorldReceipt,WorldPrincipal,WorldEvent,WorldQuery} from '@argo/contracts';
import {createWorldModelAgent,worldDialoguePacket} from '@argo/interventions';
import {createWorldSession} from './index.ts';
import {storeAccess} from './conversation-store.ts';
import {CONVERSATION_VERSION} from './conversation-types.ts';
import type {CreateConversationOptions,WorldConversation,WaitOptions,TurnInput,TurnRef,TurnRow,TurnResult,Terminal,RejectionProof,ConversationModelInjection,Mutation} from './conversation-types.ts';
import {capabilityFields,assertInput,assertRef,assertRow,receiptFor,requestIdFor,memoryId,invalid,corrupt,bindingHash} from './conversation-guards.ts';

function waiter(options:WaitOptions):AbortSignal|undefined{
 const data=capabilityFields(options,[],['signal']),signal=data.signal;
 if(signal!==undefined&&(nodeTypes.isProxy(signal)||!(signal instanceof AbortSignal)))invalid('Invalid conversation waiter signal');
 const result=signal as AbortSignal|undefined;result?.throwIfAborted();return result;
}
function waitFor<T>(promise:Promise<T>,signal?:AbortSignal):Promise<T>{
 if(!signal)return promise;
 return new Promise((resolve,reject)=>{const abort=()=>reject(signal.reason);signal.addEventListener('abort',abort,{once:true});promise.then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));if(signal.aborted)abort();});
}
function terminal(outcome:Terminal['outcome'],reason:Terminal['reason'],proof:RejectionProof|null=null):Terminal{return {outcome,reason,rejection_proof:proof};}
export function createWorldConversation(input:CreateConversationOptions):WorldConversation{
 const raw=capabilityFields(input,['store','ledger','model']),access=storeAccess(raw.store as CreateConversationOptions['store']),b=access.binding,g=access.genesis;
 const clients=capabilityFields(raw.model,['clientFor'],['countTokensFor','cooldown']);if(typeof clients.clientFor!=='function'||clients.countTokensFor!==undefined&&typeof clients.countTokensFor!=='function')invalid('Conversation requires injected client factories');
 if(clients.cooldown!==undefined){const methods=capabilityFields(clients.cooldown,['get','success','refuse']);for(const method of Object.values(methods))if(typeof method!=='function')invalid('Invalid conversation cooldown');}
 const model=clients as ConversationModelInjection,ledger=raw.ledger as CreateConversationOptions['ledger'];
 const player=createWorldSession({genesis:g,ledger,principal:b.player}),npc=createWorldSession({genesis:g,ledger,principal:b.npc});
 const publicKey=createPublicKey(b.authority_public_key),active=new Map<string,Promise<TurnResult>>(),controllers=new Map<string,AbortController>(),operations=new Set<Promise<unknown>>();let closing=false,closePromise:Promise<void>|undefined;
 const maxSpeech=g.profiles.find(p=>p.actor_id===b.player.actor_id)!.max_speech_characters,maxReply=g.profiles.find(p=>p.actor_id===b.npc.actor_id)!.max_speech_characters;
 function track<T>(promise:Promise<T>):Promise<T>{operations.add(promise);void promise.finally(()=>operations.delete(promise)).catch(()=>{});return promise;}
 const requireOpen=()=>{if(closing)fail('UNAVAILABLE','Conversation host is closed');};
 async function eventAt(sequence:number):Promise<WorldEvent|null>{
  const page=await ledger.events({after:sequence-1,limit:1});if(!Array.isArray(page)||page.length>1)corrupt('Invalid conversation prefix page');if(!page.length)return null;
  const event=page[0]!;assertWorldContract('Event',event);const {hash:digest,...signed}=event,{signature,...body}=signed;
  if(event.sequence!==sequence||event.genesis_hash!==b.genesis_hash||canonical(event.scope)!==canonical(b.scope)||hash(signed)!==digest||!verify(null,Buffer.from(canonical({domain:'shared-world/0.1.0/event',event:body})),publicKey,Buffer.from(signature,'base64')))corrupt('Conversation prefix event does not verify');return event;
 }
 async function receiptPrefix(c:WorldCommand,p:WorldPrincipal,r:WorldReceipt):Promise<void>{
  receiptFor(b,c,p,r);const event=await eventAt(r.cursor.sequence);
  if(!event||canonical(event.command)!==canonical(c)||canonical(event.principal)!==canonical(p)||event.hash!==r.event_hash||event.previous_hash!==c.expected.head||event.world_time!==r.cursor.world_time||event.after_hash!==r.state_hash||worldRequestHash(event.command,event.principal)!==r.request_hash)corrupt('Acknowledged conversation prefix is missing or divergent');
 }
 async function proofPrefix(proof:RejectionProof,c:WorldCommand,p:WorldPrincipal):Promise<void>{
  const event=await eventAt(proof.sequence);if(!event||event.hash!==proof.event_hash||event.previous_hash!==proof.previous_hash||event.command.request_id!==proof.request_id||worldRequestHash(event.command,event.principal)!==proof.request_hash||event.previous_hash!==c.expected.head||proof.request_hash===worldRequestHash(c,p))corrupt('Conversation rejection prefix differs');
 }
 async function validateSaved(row:TurnRow):Promise<void>{
  assertRow(row,b,maxSpeech,maxReply);
  if(row.input_receipt)await receiptPrefix(row.input_command!,b.player,row.input_receipt);
  if(row.reply_receipt)await receiptPrefix(row.reply_command!,b.npc,row.reply_receipt);
  const proof=row.terminal?.rejection_proof;if(proof)await proofPrefix(proof,row.terminal!.outcome==='input_rejected'?row.input_command!:row.reply_command!,row.terminal!.outcome==='input_rejected'?b.player:b.npc);
 }
 async function occupied(c:WorldCommand,p:WorldPrincipal):Promise<RejectionProof|null>{
  try{const event=await eventAt(c.expected.sequence+1);if(!event||event.previous_hash!==c.expected.head||worldRequestHash(event.command,event.principal)===worldRequestHash(c,p))return null;
   return {sequence:event.sequence,previous_hash:event.previous_hash,event_hash:event.hash,request_id:event.command.request_id,request_hash:worldRequestHash(event.command,event.principal)};
  }catch(e){if(e instanceof ArgoError&&e.code==='CORRUPT_LEDGER')throw e;return null;}
 }
 async function present(id:string):Promise<TurnResult|null>{
  for(let retry=0;retry<2;retry++){
   const row=await access.load(id);if(!row)return null;await validateSaved(row);let delivery:TurnResult['delivery']=null;
   if(row.reply_receipt&&!row.cancel_requested){
    try{const view=await player.view(await player.query()),c=row.reply_command!,r=row.reply_receipt,recordId=memoryId(b,c,r),record=view.memories.find(m=>m.record_id===recordId);
     if(!view.mythic_closed&&record?.sequence===r.cursor.sequence&&record.actor_id===b.npc.actor_id&&record.payload.type==='speak'&&c.action.type==='speak'&&record.payload.text===c.action.text&&canonical(record.payload.audience)===canonical(c.action.audience)&&record.payload.in_reply_to===row.inbound_record_id)delivery={delivery_id:hash({domain:CONVERSATION_VERSION+'/delivery',binding_hash:row.binding_hash,turn_key:row.turn_key,record_id:recordId}),record_id:recordId,speaker_id:b.npc.actor_id,text:record.payload.text};
    }catch(e){if(!(e instanceof ArgoError)||!['CONFLICT','UNAVAILABLE'].includes(e.code))throw e;}
   }
   const latest=await access.load(id);if(!latest)corrupt('Conversation row disappeared');if(latest.revision!==row.revision)continue;
   return freezeDto({version:CONVERSATION_VERSION,turn_id:id,phase:row.phase,revision:row.revision,cancel_requested:row.cancel_requested,generation_mode:b.policy.generation_mode,outcome:row.terminal?.outcome??null,input_receipt:row.input_receipt,reply_receipt:row.reply_receipt,delivery});
  }return fail('UNAVAILABLE','Conversation changed while reading; read again');
 }
 const advance=async(row:TurnRow,mutation:Mutation)=>access.advance(row.turn_id,row.revision,mutation);
 async function settle(row:TurnRow,value:Terminal):Promise<TurnRow>{return (await advance(row,{type:'settle',terminal:value})).row;}
 async function generation(row:TurnRow):Promise<TurnRow>{
  const attempt=row.attempt!,controller=new AbortController();controllers.set(row.turn_id,controller);
  const remaining=attempt.deadline_at_ms-Date.now(),timer=setTimeout(()=>controller.abort(new Error('Generation deadline reached')),Math.max(0,remaining));
  const call=freezeDto({turn_id:row.turn_id,attempt_id:attempt.attempt_id,binding_hash:row.binding_hash});
  try{
   const agent=createWorldModelAgent({scope:b.scope,actorId:b.npc.actor_id,sessionId:row.turn_key,candidates:b.policy.candidates,effort:b.policy.effort,timeoutMs:b.policy.timeout_ms,maxContextBytes:b.policy.max_context_bytes,maxOutputTokens:b.policy.max_output_tokens,
    clientFor:candidate=>model.clientFor(candidate,call),...(model.countTokensFor?{countTokensFor:candidate=>model.countTokensFor!(candidate,call)}:{}),...(model.cooldown?{cooldown:model.cooldown}:{}),
    refreshContext:async(query,options)=>{options.signal.throwIfAborted();const latest=await access.load(row.turn_id);if(!latest||latest.revision!==row.revision||latest.phase!=='generating'||latest.cancel_requested||Date.now()>=attempt.deadline_at_ms)fail('UNAVAILABLE','Generation attempt lost its claim');return npc.view(query);}});
   if(closing||remaining<=0)controller.abort();
   const proposal=await agent.respond(attempt.query,row.inbound_record_id!,requestIdFor(b,row.turn_id,'reply'),{signal:controller.signal});
   const current=await access.load(row.turn_id);if(!current)corrupt('Generation row disappeared');if(current.revision!==row.revision)return current;
   if(Date.now()>=attempt.deadline_at_ms)return settle(current,terminal('generation_uncertain','attempt_expired'));
   if(proposal===null)return settle(current,terminal('no_reply','adapter_null'));
   try{assertRow({...current,phase:'reply_pending',reply_command:proposal},b,maxSpeech,maxReply);}catch{return settle(current,terminal('generation_failed','invalid_proposal'));}
   if(closing||controller.signal.aborted)return settle(current,terminal('generation_failed','attempt_failed'));
   return (await advance(current,{type:'save_reply',command:proposal,attempt_id:attempt.attempt_id})).row;
  }catch(error){
   const current=await access.load(row.turn_id);if(!current)throw error;if(current.revision!==row.revision||current.phase!=='generating')return current;
   return settle(current,Date.now()>=attempt.deadline_at_ms?terminal('generation_uncertain','attempt_expired'):terminal('generation_failed','attempt_failed'));
  }finally{clearTimeout(timer);if(controllers.get(row.turn_id)===controller)controllers.delete(row.turn_id);}
 }
 async function drive(initial:TurnRow):Promise<TurnResult>{
  let row=initial;await validateSaved(row);
  for(let step=0;step<8;step++){
   if(row.phase==='settled')break;
   if(row.phase==='accepted'){
    if(closing)break;
    const c=await player.prepare({type:'speak',text:row.text,audience:{kind:'whisper',addressed_actor_ids:[b.npc.actor_id]},in_reply_to:null},requestIdFor(b,row.turn_id,'input'));
    const view=await player.view({version:g.version,scope:b.scope,actor_id:b.player.actor_id,cursor:c.expected});
    if(view.mythic_closed||view.physical.self.hp<=0||!view.scene.occupants.some(a=>a.actor_id===b.npc.actor_id&&a.condition==='standing'))fail('INVALID_ACTION','Conversation participants are unavailable');
    if(closing)break;const result=await advance(row,{type:'save_input',command:c});row=result.row;if(!result.changed)break;continue;
   }
   if(row.phase==='input_pending'||row.phase==='reply_pending'){
    const isInput=row.phase==='input_pending',c=isInput?row.input_command!:row.reply_command!,p=isInput?b.player:b.npc;
    try{
     const receipt=await (isInput?player:npc).submit(c);await receiptPrefix(c,p,receipt);
     const result=await advance(row,isInput?{type:'confirm_input',receipt}:{type:'confirm_reply',receipt});row=result.row;if(!result.changed)break;
    }catch(error){
     // Receipt verification and outbox acknowledgment can fail after COMMIT.
     // Error codes never authorize replacement or a new generation attempt.
     const proof=await occupied(c,p);if(proof)row=await settle(row,terminal(isInput?'input_rejected':'reply_rejected','occupied_sequence',proof));
     break;
    }continue;
   }
   if(row.phase==='input_committed'){
    if(closing)break;await validateSaved(row);
    let query:WorldQuery;
    try{const view=await npc.view(await npc.query());if(!worldDialoguePacket(view,row.inbound_record_id!)){row=await settle(row,terminal('no_reply','unavailable_context'));break;}query=view.query;}
    catch(e){if(e instanceof ArgoError&&e.code==='CORRUPT_LEDGER')throw e;break;}
    const now=Date.now(),attempt={attempt_id:randomBytes(32).toString('hex'),owner_id:randomBytes(32).toString('hex'),query,started_at_ms:now,deadline_at_ms:now+b.policy.timeout_ms};
    if(closing)break;const result=await advance(row,{type:'claim_generation',attempt});row=result.row;if(!result.changed)break;row=await generation(row);continue;
   }
   if(row.phase==='generating'){if(Date.now()>=row.attempt!.deadline_at_ms)row=await settle(row,terminal('generation_uncertain','attempt_expired'));break;}
  }
  const result=await present(row.turn_id);if(!result)corrupt('Conversation turn disappeared');return result;
 }
 function launch(row:TurnRow):Promise<TurnResult>{const prior=active.get(row.turn_id);if(prior)return prior;const promise=drive(row);active.set(row.turn_id,promise);void promise.finally(()=>{if(active.get(row.turn_id)===promise)active.delete(row.turn_id);}).catch(()=>{});return promise;}
 async function known(id:string):Promise<TurnRow>{const row=await access.load(id);if(!row)invalid('Unknown conversation turn');return row;}
 return Object.freeze({
  async turn(input:TurnInput,options:WaitOptions={}){requireOpen();assertInput(input,maxSpeech);const signal=waiter(options),copy=freezeDto(structuredClone(input));return waitFor(track((async()=>launch(await access.insert(copy)))()),signal);},
  async resume(input:TurnRef,options:WaitOptions={}){requireOpen();assertRef(input);const signal=waiter(options),id=input.turn_id;return waitFor(track((async()=>launch(await known(id)))()),signal);},
  async read(input:TurnRef,options:WaitOptions={}){requireOpen();assertRef(input);const signal=waiter(options),id=input.turn_id;return waitFor(track(present(id)),signal);},
  async cancel(input:TurnRef,options:WaitOptions={}){requireOpen();assertRef(input);const signal=waiter(options),id=input.turn_id;return waitFor(track((async()=>{
   let row=await known(id);for(let retry=0;retry<8&&!row.cancel_requested;retry++){const result=await advance(row,{type:'cancel'});row=result.row;if(result.changed)break;}
   if(!row.cancel_requested)fail('UNAVAILABLE','Cancellation raced with updates; retry cancellation');controllers.get(id)?.abort(new Error('Turn durably cancelled'));
   if(row.phase==='input_pending'||row.phase==='reply_pending')return drive(row);
   const result=await present(id);if(!result)corrupt('Cancelled turn disappeared');return result;
  })()),signal);},
  close(){if(!closePromise){closing=true;for(const controller of controllers.values())controller.abort(new Error('Conversation host closing'));closePromise=(async()=>{await Promise.allSettled([...operations,...active.values()]);})();}return closePromise;},
 });
}
