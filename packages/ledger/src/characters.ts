/** Privileged host boundary for the additive character-memory ledger profile. */
import {
 CHARACTER_PROFILE,CHARACTER_CLAIM_PREFIX,assertCharacterContract,assertCharacterPrincipal,
 characterProposalId,characterRequestHash,canonical,fail,requireScope,own,freezeDto,serviceCall,
} from '@argo/contracts';
import type {
 Genesis,Snapshot,LedgerEvent,Principal,IntentProposal,Action,ServiceOptions,CharacterCommand,
 CharacterCommandBody,CharacterCursor,CharacterEnvelope,CharacterEnvelopeBody,CharacterProfile,
 CharacterProjection,CharacterReceipt,CharacterWitnessGrant,CharacterImpressionData,CharacterExperience,
} from '@argo/contracts';
import type {Ledger} from './index.ts';
import {initialSnapshot,verifyEvent,apply} from './mechanics.ts';

export interface CharacterWitnessRequest {
 request_hash:string;kind:'speech'|'action';actor_id:string;record_id:string|null;
 text:string|null;addressed_actor_ids:string[];
}
export type CharacterWitnessAuthorizer=(request:CharacterWitnessRequest,snapshot:Snapshot,options:{signal:AbortSignal})=>Promise<CharacterWitnessGrant>;
export interface CharacterAuthorityOptions {
 ledger:Ledger;systemPrincipal:Principal;authorizeWitnesses?:CharacterWitnessAuthorizer;timeoutMs?:number;
}
interface Replayed {
 projection:CharacterProjection;state:Snapshot;
 receipts:Map<string,CharacterReceipt>;proposalIds:Set<string>;parents:Set<string>;
}
const cursor=(state:Snapshot):CharacterCursor=>({sequence:state.sequence,head:state.head,world_time:state.world_time});
const detached=<T>(value:T):T=>freezeDto(structuredClone(value));
const cancelled=(call:ServiceOptions)=>{if(call.signal?.aborted)fail('CANCELLED','Character operation cancelled before append');};
function checkSystem(principal:Principal,genesis:Genesis):void{
 assertCharacterPrincipal(principal);requireScope(genesis.scope,principal.scope);
 if(principal.role!=='system'||!own(genesis.actors,principal.actor_id))fail('UNAUTHORIZED','Configured character authority requires a system actor');
}
function exactSystem(principal:Principal,system:Principal):void{
 if(principal.role!=='system'||principal.actor_id!==system.actor_id||principal.principal_id!==system.principal_id)fail('UNAUTHORIZED','Character command requires the configured system identity');
}
function actor(state:Snapshot,id:string,living=false):void{
 const value=own(state.actors,id);
 if(!value)fail('INVALID_ACTION','Unknown character actor');
 if(living&&!value.alive)fail('UNAUTHORIZED','Character actor must be living');
}
function profileFor(projection:CharacterProjection,id:string):CharacterProfile{
 const profile=projection.profiles.find(p=>p.actor_id===id);
 if(!profile)fail('UNAUTHORIZED','Character profile is not configured');return profile;
}
function current(command:CharacterCommand,state:Snapshot):void{
 if(canonical(command.expected_cursor)!==canonical(cursor(state)))fail('CONFLICT','Stale character cursor checkpoint');
}
function impressionData(command:Extract<CharacterCommandBody,{type:'form_impression'}>,principal:Principal,projection:CharacterProjection,state:Snapshot):CharacterImpressionData{
 actor(state,command.subject_actor_id);
 for(const id of command.evidence_ids){
  const record=projection.records.find(r=>r.experience.record_id===id);
  if(!record||record.experience.actor_id!==command.subject_actor_id)fail('UNAUTHORIZED','Impression evidence does not concern the subject');
  if(!record.acquisitions.some(a=>a.actor_id===principal.actor_id&&a.sequence<=state.sequence&&a.world_time<=state.world_time))fail('UNAUTHORIZED','Impression evidence was not acquired by this observer');
 }
 const previous=projection.impressions.findLast(i=>i.data.owner_actor_id===principal.actor_id&&i.data.subject_actor_id===command.subject_actor_id);
 if(command.previous_impression_id!==(previous?.impression_id??null))fail('CONFLICT','Impression predecessor differs from the latest revision');
 const profile=profileFor(projection,principal.actor_id);
 return {owner_actor_id:principal.actor_id,subject_actor_id:command.subject_actor_id,evidence_ids:[...command.evidence_ids],
  nature_revision:profile.revision,nature:structuredClone(profile.nature),interpretation:command.interpretation,previous_impression_id:command.previous_impression_id};
}
/** Eligibility checked before host work and identically at each replay prefix. */
function admit(command:CharacterCommand,principal:Principal,system:Principal,replayed:Pick<Replayed,'state'|'projection'>):void{
 const {state,projection}=replayed,body=command.body;
 assertCharacterContract('CharacterCommand',command);assertCharacterPrincipal(principal);
 requireScope(state.genesis.scope,command.scope);requireScope(command.scope,principal.scope);current(command,state);
 actor(state,principal.actor_id);
 if(body.type==='configure'||body.type==='witness_action')exactSystem(principal,system);
 else{
  if(principal.role!=='player'&&principal.role!=='npc')fail('UNAUTHORIZED','Character activity requires a direct player or NPC');
  actor(state,principal.actor_id,true);profileFor(projection,principal.actor_id);
 }
 switch(body.type){
 case 'configure':{
  actor(state,body.profile.actor_id);const previous=projection.profiles.find(p=>p.actor_id===body.profile.actor_id);
  if(body.profile.revision!==(previous?.revision??0)+1)fail('CONFLICT','Character nature revision must be consecutive');break;
 }
 case 'speak':{
  if(projection.ontology_blocked||projection.engagement_closed)fail('UNAUTHORIZED','Character speech is closed by the world cutoff');
  const profile=profileFor(projection,principal.actor_id);
  if(Array.from(body.text).length>profile.speech_policy.max_characters)fail('INVALID_ACTION','Character speech exceeds the configured character budget');
  for(const id of body.addressed_actor_ids)actor(state,id,true);
  const last=projection.records.findLast(r=>r.experience.kind==='speech'&&r.experience.actor_id===principal.actor_id);
  if(last&&state.world_time-last.experience.world_time<profile.speech_policy.minimum_interval)fail('INVALID_ACTION','Character speech cooldown interval has not elapsed');break;
 }
 case 'witness_action':{
  if(!projection.records.some(r=>r.experience.record_id===body.record_id&&r.experience.kind==='action'))fail('INVALID_ACTION','Action witness record is not a captured causal action');break;
 }
 case 'form_impression':impressionData(body,principal,projection,state);break;
 case 'set_activity':break;
 }
}
function checkGrant(grant:CharacterWitnessGrant,requestHash:string,source:string,state:Snapshot):void{
 assertCharacterContract('CharacterWitnessGrant',grant);
 if(grant.request_hash!==requestHash)fail('UNAUTHORIZED','Witness grant does not bind this request hash');
 for(const id of grant.actor_ids)actor(state,id,true);
 if(grant.party_id!==null){
  const party=own(state.genesis.parties,grant.party_id);
  if(!party||!party.includes(source)||grant.actor_ids.some(id=>!party.includes(id)))fail('UNAUTHORIZED','Witness party disclosure exceeds membership');
 }
}
function original(envelope:CharacterEnvelope,state:Snapshot):CharacterCommand{
 const body=envelope.body;let commandBody:CharacterCommandBody;
 switch(body.type){
 case 'configure':commandBody={type:body.type,profile:body.profile};break;
 case 'speak':commandBody={type:body.type,text:body.text,addressed_actor_ids:body.addressed_actor_ids};break;
 case 'witness_action':commandBody={type:body.type,record_id:body.record_id};break;
 case 'set_activity':commandBody={type:body.type,activity:body.activity};break;
 case 'form_impression':commandBody={type:body.type,subject_actor_id:body.data.subject_actor_id,evidence_ids:body.data.evidence_ids,interpretation:body.data.interpretation,previous_impression_id:body.data.previous_impression_id};break;
 }
 return {version:CHARACTER_PROFILE,scope:envelope.scope,request_id:envelope.request_id,expected_cursor:cursor(state),body:commandBody};
}
function applyCarrier(envelope:CharacterEnvelope,event:LedgerEvent,system:Principal,replayed:Replayed):void{
 const {state,projection}=replayed,command=original(envelope,state);
 const principal:Principal={...envelope.requester,scope:envelope.scope,confirmed_receipts:[]};
 admit(command,principal,system,replayed);
 if(characterRequestHash(command,principal)!==envelope.request_hash)fail('CORRUPT_LEDGER','Character carrier request hash differs from its reconstructed command');
 if(replayed.receipts.has(envelope.request_id))fail('CORRUPT_LEDGER','Character carrier request identity is duplicated');
 const body=envelope.body;
 switch(body.type){
 case 'configure':{
  const index=projection.profiles.findIndex(p=>p.actor_id===body.profile.actor_id);
  if(index<0)projection.profiles.push(structuredClone(body.profile));else projection.profiles[index]=structuredClone(body.profile);
  projection.activation_sequence??=event.sequence;break;
 }
 case 'speak':{
  checkGrant(body.witnesses,envelope.request_hash,body.actor_id,state);
  projection.records.push({experience:{record_id:event.hash,kind:'speech',actor_id:body.actor_id,principal_actor_id:principal.actor_id,sequence:event.sequence,world_time:state.world_time,text:body.text,action_type:null,addressed_actor_ids:[...body.addressed_actor_ids]},
   acquisitions:body.witnesses.actor_ids.map(actor_id=>({actor_id,sequence:event.sequence,world_time:state.world_time,party_id:body.witnesses.party_id}))});break;
 }
 case 'witness_action':{
  const record=projection.records.find(r=>r.experience.record_id===body.record_id)!;
  checkGrant(body.witnesses,envelope.request_hash,record.experience.actor_id,state);
  // Each grant records a new acquisition/disclosure at this time, never at source time.
  for(const actor_id of body.witnesses.actor_ids)record.acquisitions.push({actor_id,sequence:event.sequence,world_time:state.world_time,party_id:body.witnesses.party_id});break;
 }
 case 'form_impression':{
  const input=command.body;if(input.type!=='form_impression')fail('CORRUPT_LEDGER','Character command mismatch');
  if(canonical(body.data)!==canonical(impressionData(input,principal,projection,state)))fail('CORRUPT_LEDGER','Character impression nature or provenance differs from its prefix');
  projection.impressions.push({impression_id:event.hash,sequence:event.sequence,world_time:state.world_time,data:structuredClone(body.data)});break;
 }
 case 'set_activity':profileFor(projection,body.actor_id).activity=structuredClone(body.activity);break;
 }
 replayed.receipts.set(envelope.request_id,{version:CHARACTER_PROFILE,scope:structuredClone(envelope.scope),request_id:envelope.request_id,request_hash:envelope.request_hash,event_id:event.event_id,event_hash:event.hash,cursor:{sequence:event.sequence,head:event.hash,world_time:event.proposal.world_time},kind:body.type});
}
/** Only observed action details, never raw consent/grant documents or RNG. */
function actionText(action:Action,state:Snapshot):string|null{
 switch(action.type){
 case 'move_item':return action.to_actor_id===null?`Released item "${action.item_id}" from custody.`:`Moved item "${action.item_id}" to actor "${action.to_actor_id}".`;
 case 'record_consent':return `Recorded consent for a time transfer from actor "${action.consent.donor_id}" to actor "${action.consent.recipient_id}".`;
 case 'revoke_consent':return `Withdrew consent for a time transfer to actor "${own(state.consents,action.consent_id)!.consent.recipient_id}".`;
 case 'transfer_time':{
  const consent=own(state.consents,action.consent_id)!.consent;
  return `Completed a transfer of ${consent.units} time units from actor "${consent.donor_id}" to actor "${consent.recipient_id}".`;
 }
 case 'grant_proxy':return `Granted limited authority to actor "${action.grant.grantee_id}".`;
 case 'revoke_proxy':return `Revoked limited authority from actor "${own(state.grants,action.grant_id)!.grant.grantee_id}".`;
 case 'vanish_thread':return `The thread of actor "${action.traveler_id}" vanished.`;
 case 'name_anomaly':return `Named an anomaly in the thread of actor "${action.traveler_id}".`;
 case 'end_thread':return `Ended the thread of actor "${action.traveler_id}".`;
 default:return null;
 }
}
function initialReplay(genesis:Genesis,system:Principal):Replayed{
 checkSystem(system,genesis);const state=initialSnapshot(genesis);
 const projection:CharacterProjection={version:CHARACTER_PROFILE,scope:structuredClone(genesis.scope),cursor:cursor(state),activation_sequence:null,profiles:[],actors:[],parties:Object.entries(genesis.parties).map(([party_id,actor_ids])=>({party_id,actor_ids:[...actor_ids]})),records:[],impressions:[],ontology_blocked:false,engagement_closed:false};
 return {projection,state,receipts:new Map(),proposalIds:new Set(),parents:new Set()};
}
function extendReplay(result:Replayed,events:readonly LedgerEvent[],system:Principal):Replayed{
 const {projection,parents}=result,genesis=result.state.genesis;
 for(const event of events){
  verifyEvent(result.state,event,parents);const p=event.proposal,a=p.action;
  const reserved=p.proposal_id.startsWith(CHARACTER_CLAIM_PREFIX)||(a.type==='observe_claim'&&a.observation.claim_id.startsWith(CHARACTER_CLAIM_PREFIX));
  const systemCarrier=reserved&&(event.authority.principal_role==='system'||event.authority.principal_id===system.principal_id||event.authority.principal_actor_id===system.actor_id||p.actor_id===system.actor_id);
  if(systemCarrier){
   try{
    if(event.authority.principal_role!=='system'||event.authority.principal_id!==system.principal_id||event.authority.principal_actor_id!==system.actor_id||p.actor_id!==system.actor_id||p.proxy_grant_id!==null)fail('CORRUPT_LEDGER','Character carrier system identity differs');
    if(a.type!=='observe_claim')fail('CORRUPT_LEDGER','Character carrier requires an epistemic claim');
    const observation=a.observation;
    if(observation.source_id!==system.actor_id||canonical(observation.observers)!==canonical([system.actor_id])||observation.party_id!==null||observation.channel!=='belief'||observation.occurred_at!==result.state.world_time||canonical(p.causal_parents)!==canonical(result.state.head?[result.state.head]:[]))fail('CORRUPT_LEDGER','Character carrier is not a private system observation');
    const envelope:unknown=JSON.parse(observation.content);assertCharacterContract('CharacterEnvelope',envelope);requireScope(genesis.scope,envelope.scope);
    if(canonical(envelope)!==observation.content||p.proposal_id!==characterProposalId(genesis.scope,envelope.request_id)||observation.claim_id!==p.proposal_id)fail('CORRUPT_LEDGER','Character carrier identity or canonical bytes differ');
    applyCarrier(envelope,event,system,result);
   }catch(error){fail('CORRUPT_LEDGER',`Invalid character carrier: ${error instanceof Error?error.message:'invalid data'}`);}
  }else if(projection.activation_sequence!==null&&event.kind==='causal'){
   const text=actionText(a,result.state);
   if(text!==null)projection.records.push({experience:{record_id:event.hash,kind:'action',actor_id:p.actor_id,principal_actor_id:event.authority.principal_actor_id,sequence:event.sequence,world_time:p.world_time,text,action_type:a.type as NonNullable<CharacterExperience['action_type']>,addressed_actor_ids:[]},acquisitions:[{actor_id:p.actor_id,sequence:event.sequence,world_time:p.world_time,party_id:null}]});
  }
  result.state=apply(result.state,event);parents.add(event.hash);result.proposalIds.add(p.proposal_id);
  const cutoffs=Object.values(result.state.cutoffs);projection.ontology_blocked=cutoffs.length>0;projection.engagement_closed=cutoffs.some(c=>c.named_at_sequence!==null);
 }
 projection.cursor=cursor(result.state);projection.actors=Object.entries(result.state.actors).map(([actor_id,value])=>({actor_id,alive:value.alive}));
 assertCharacterContract('CharacterProjection',projection);return result;
}
export function replayCharacters(genesis:Genesis,events:readonly LedgerEvent[],systemPrincipal:Principal):CharacterProjection{
 return detached(extendReplay(initialReplay(genesis,systemPrincipal),events,systemPrincipal).projection);
}
function priorReceipt(result:Replayed,command:CharacterCommand,requestHash:string):CharacterReceipt|undefined{
 const prior=result.receipts.get(command.request_id);
 if(prior){if(prior.request_hash!==requestHash)fail('CONFLICT','Character retry request identity conflict');return detached(prior);}
 if(result.proposalIds.has(characterProposalId(command.scope,command.request_id)))fail('CONFLICT','Reserved character proposal identity collision');
 return undefined;
}
export async function createCharacterAuthority(options:CharacterAuthorityOptions){
 assertCharacterPrincipal(options.systemPrincipal);const system=detached(options.systemPrincipal),ledger=options.ledger,authorize=options.authorizeWitnesses,timeout=options.timeoutMs??5000;
 if(!Number.isSafeInteger(timeout)||timeout<1||timeout>60000)fail('INVALID_CONTRACT','Invalid character adjudication deadline');
 // Pin actual genesis once. Later snapshots are rebuilt from one verified event prefix.
 const genesis=detached((await ledger.snapshot()).genesis);checkSystem(system,genesis);
 // This handle remembers the exact verified prefix. It detects a subsequent
 // rollback/divergence here; it is not an external checkpoint across restarts.
 let cached:Replayed|undefined,bytes:string[]=[];
 let loading:Promise<void>=Promise.resolve();
 const load=(call:ServiceOptions):Promise<Replayed>=>{
  // Serialize capture as well as replay: an older delayed events() response
  // must not arrive after a newer prefix has already been published.
  const pending=loading.then(async()=>{
   cancelled(call);const events=await ledger.events(call);cancelled(call);
   if(events.length<bytes.length)fail('CORRUPT_LEDGER','Character history lost the previously verified prefix');
   const currentBytes=events.map(event=>canonical(event));
   if(bytes.some((value,index)=>value!==currentBytes[index]))fail('CORRUPT_LEDGER','Character history replaced the previously verified prefix');
   if(cached&&events.length===bytes.length)return cached;
   // Carriers mutate projections and receipt indexes. Work on detached state
   // so failure cannot poison the cache or a submit suspended in host work.
   const next=extendReplay(cached?structuredClone(cached):initialReplay(genesis,system),events.slice(bytes.length),system);
   cached=next;bytes=currentBytes;return next;
  });
  loading=pending.then(()=>{},()=>{});return pending;
 };
 return Object.freeze({
  readProjection:async(call:ServiceOptions={}):Promise<CharacterProjection>=>detached((await load(call)).projection),
  submit:async(input:CharacterCommand,authenticated:Principal,call:ServiceOptions={}):Promise<CharacterReceipt>=>{
   assertCharacterContract('CharacterCommand',input);assertCharacterPrincipal(authenticated);
   const command=detached(input),principal=detached(authenticated);requireScope(genesis.scope,command.scope);requireScope(command.scope,principal.scope);
   const requestHash=characterRequestHash(command,principal);let result=await load(call);
   const prior=priorReceipt(result,command,requestHash);if(prior)return prior;
   admit(command,principal,system,result);let body:CharacterEnvelopeBody;
   const action=command.body;
   if(action.type==='speak'||action.type==='witness_action'){
    if(!authorize)fail('UNAVAILABLE','Character witness adjudication is not configured');
    const source=action.type==='speak'?principal.actor_id:result.projection.records.find(r=>r.experience.record_id===action.record_id)!.experience.actor_id;
    const request:CharacterWitnessRequest={request_hash:requestHash,kind:action.type==='speak'?'speech':'action',actor_id:source,record_id:action.type==='witness_action'?action.record_id:null,text:action.type==='speak'?action.text:null,addressed_actor_ids:action.type==='speak'?[...action.addressed_actor_ids]:[]};
    const response=await serviceCall(signal=>authorize(detached(request),detached(result.state),{signal}),timeout,call);
    assertCharacterContract('CharacterWitnessGrant',response);const witnesses=structuredClone(response);
    if(action.type==='speak')witnesses.actor_ids=[source,...witnesses.actor_ids.filter(id=>id!==source)];
    checkGrant(witnesses,requestHash,source,result.state);cancelled(call);
    result=await load(call);const duplicate=priorReceipt(result,command,requestHash);if(duplicate)return duplicate;
    admit(command,principal,system,result);checkGrant(witnesses,requestHash,source,result.state);
    body=action.type==='speak'?{type:'speak',actor_id:principal.actor_id,text:action.text,addressed_actor_ids:[...action.addressed_actor_ids],witnesses}:{type:'witness_action',record_id:action.record_id,witnesses};
   }else if(action.type==='form_impression')body={type:action.type,data:impressionData(action,principal,result.projection,result.state)};
   else if(action.type==='set_activity')body={type:action.type,actor_id:principal.actor_id,activity:action.activity};
   else body={type:action.type,profile:action.profile};
   const envelope:CharacterEnvelope={version:CHARACTER_PROFILE,scope:command.scope,request_id:command.request_id,request_hash:requestHash,requester:{principal_id:principal.principal_id,actor_id:principal.actor_id,role:principal.role},body};
   assertCharacterContract('CharacterEnvelope',envelope);
   const id=characterProposalId(command.scope,command.request_id),state=result.state;
   const proposal:IntentProposal={schema_version:'1.0.0',ruleset_version:genesis.ruleset_version,proposal_id:id,scope:command.scope,actor_id:system.actor_id,expected_head:command.expected_cursor.head,expected_sequence:command.expected_cursor.sequence,world_time:command.expected_cursor.world_time,causal_parents:state.head?[state.head]:[],proxy_grant_id:null,action:{type:'observe_claim',observation:{claim_id:id,channel:'belief',source_id:system.actor_id,content:canonical(envelope),observers:[system.actor_id],party_id:null,occurred_at:state.world_time}}};
   cancelled(call);
   try{
    const outcome=await ledger.submit(proposal,system,call);
    const receipt:CharacterReceipt={version:CHARACTER_PROFILE,scope:command.scope,request_id:command.request_id,request_hash:requestHash,event_id:outcome.event_id,event_hash:outcome.event_hash,cursor:{sequence:outcome.sequence,head:outcome.event_hash,world_time:outcome.world_time},kind:action.type};
    assertCharacterContract('CharacterReceipt',receipt);return detached(receipt);
   }catch(error){
    // A simultaneous exact retry may carry a different host grant. Only the first
    // committed envelope owns that request; return it rather than appending twice.
    if(error&&typeof error==='object'&&'code'in error&&error.code==='CONFLICT'){
     const duplicate=priorReceipt(await load(call),command,requestHash);if(duplicate)return duplicate;
    }
    throw error;
   }
  },
 });
}
