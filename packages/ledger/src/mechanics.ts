import {createHmac,createPublicKey,verify} from 'node:crypto';
import {assertContract,assertScope,canonical,hash,fail,requireScope,safeAdd} from '@argo/contracts';
import type {Genesis,Snapshot,IntentProposal,Principal,LedgerEvent,RngRecord,Outcome} from '@argo/contracts';

export function initialSnapshot(genesis:Genesis):Snapshot{
 assertContract('Genesis',genesis);assertScope(genesis.scope);
 if(createPublicKey(genesis.authority_public_key).asymmetricKeyType!=='ed25519')fail('INVALID_CONTRACT','Authority key must be Ed25519');
 for(const item of Object.values(genesis.items))if(item.custodian_id!==null&&!Object.hasOwn(genesis.actors,item.custodian_id))fail('INVALID_CONTRACT','Unknown genesis custodian');
 for(const members of Object.values(genesis.parties))for(const id of members)if(!Object.hasOwn(genesis.actors,id))fail('INVALID_CONTRACT','Unknown genesis party actor');
 const roles=Object.values(genesis.actors).map(a=>a.fate_role).filter(x=>x!==null);
 if(new Set(roles).size!==roles.length)fail('INVALID_CONTRACT','Fate jurisdictions must have independent unique actors');
 return {genesis:structuredClone(genesis),sequence:0,head:null,world_time:genesis.world_time,actors:structuredClone(genesis.actors),items:structuredClone(genesis.items),claims:[],consents:{},grants:{},cutoffs:{},transfers:[],rng_counter:0,proposals:{}};
}
const exists=(s:Snapshot,id:string)=>{const value=s.actors[id];if(!value)fail('INVALID_ACTION','Unknown actor');return value;};
function direct(p:IntentProposal,principal:Principal){if(p.proxy_grant_id!==null||p.actor_id!==principal.actor_id)fail('UNAUTHORIZED','Direct actor authentication required');}
function system(p:IntentProposal,principal:Principal){direct(p,principal);if(principal.role!=='system')fail('UNAUTHORIZED','System authority required');}
export function validate(p:IntentProposal,principal:Principal,s:Snapshot,receiptHash:string|null=null):void{
 assertContract('IntentProposal',p);assertContract('Principal',principal);requireScope(s.genesis.scope,p.scope);requireScope(p.scope,principal.scope);
 if(p.ruleset_version!==s.genesis.ruleset_version)fail('INVALID_CONTRACT','Ruleset mismatch');
 if(p.expected_sequence!==s.sequence||p.expected_head!==s.head)fail('CONFLICT','Stale encounter checkpoint');
 exists(s,p.actor_id);exists(s,principal.actor_id);
 const a=p.action;
 if(a.type==='advance_time'){if(p.world_time!==a.to_time||a.to_time<=s.world_time)fail('INVALID_ACTION','World time must increase');}
 else if(p.world_time!==s.world_time)fail('INVALID_ACTION','Action world time must equal current clock');
 if(p.proxy_grant_id!==null){
  if(a.type!=='move_item'&&a.type!=='observe_claim')fail('UNAUTHORIZED','Proxy action outside grant scope');
  const row=s.grants[p.proxy_grant_id];if(!row)fail('UNAUTHORIZED','Unknown proxy grant');
  const g=row.grant,resource=a.type==='move_item'?a.item_id:a.observation.claim_id;
  if(row.revoked)fail('REVOKED','Proxy grant revoked');
  if(s.world_time<g.valid_from||s.world_time>=g.expires_at)fail('EXPIRED','Proxy grant outside its time interval');
  if(g.grantee_id!==principal.actor_id||g.grantor_id!==p.actor_id||!g.actions.includes(a.type)||!g.resource_ids.includes(resource)||row.uses>=g.max_uses)fail('UNAUTHORIZED','Proxy grant scope or uses denied');
 }else direct(p,principal);
 switch(a.type){
 case 'advance_time':system(p,principal);break;
 case 'move_item':{
  const item=s.items[a.item_id];if(!item||item.destroyed||item.custodian_id!==p.actor_id)fail('UNAUTHORIZED','Actor does not hold movable item');
  if(a.to_actor_id!==null)exists(s,a.to_actor_id);break;
 }
 case 'record_consent':{
  direct(p,principal);const c=a.consent;const donor=exists(s,c.donor_id);exists(s,c.recipient_id);
  if(p.actor_id!==c.donor_id||principal.role!=='player'||!donor.alive||c.donor_id===c.recipient_id)fail('UNAUTHORIZED','Consent requires the living donor directly');
  if(s.consents[c.consent_id]||Object.values(s.consents).some(x=>x.consent.confirmation_id===c.confirmation_id))fail('INVALID_ACTION','Consent or receipt already recorded');
  if(c.expires_at<=s.world_time)fail('EXPIRED','Consent expiry must be future');
  if(!principal.confirmed_receipts.includes(c.confirmation_id)||receiptHash!==hash(c))fail('UNAUTHORIZED','Verified donor receipt required');
  break;
 }
 case 'revoke_consent':{
  direct(p,principal);const row=s.consents[a.consent_id];if(!row||row.consent.donor_id!==p.actor_id||row.used)fail('UNAUTHORIZED','Only direct donor can revoke unused consent');break;
 }
 case 'transfer_time':{
  direct(p,principal);const row=s.consents[a.consent_id];if(!row)fail('INVALID_ACTION','Unknown consent');const c=row.consent;
  if(![c.donor_id,c.recipient_id].includes(p.actor_id)||principal.role!=='player')fail('UNAUTHORIZED','Direct donor or recipient required');
  if(row.revoked)fail('REVOKED','Consent revoked');if(c.expires_at<=s.world_time)fail('EXPIRED','Consent expired');
  if(row.used||!exists(s,c.donor_id).alive||!exists(s,c.recipient_id).alive)fail('INVALID_ACTION','Consent spent or actor no longer living');
  if(exists(s,c.donor_id).time_balance<c.units)fail('INVALID_ACTION','Insufficient donor time');safeAdd(exists(s,c.recipient_id).time_balance,c.units);break;
 }
 case 'grant_proxy':{
  direct(p,principal);const g=a.grant;exists(s,g.grantee_id);
  if(g.grantor_id!==p.actor_id||g.grantee_id===p.actor_id||!exists(s,p.actor_id).alive)fail('UNAUTHORIZED','Direct living grantor required');
  if(s.grants[g.grant_id]||g.expires_at<=g.valid_from||g.expires_at<=s.world_time)fail('INVALID_ACTION','Invalid grant identity or interval');break;
 }
 case 'revoke_proxy':direct(p,principal);if(s.grants[a.grant_id]?.grant.grantor_id!==p.actor_id)fail('UNAUTHORIZED','Only grantor may revoke');break;
 case 'observe_claim':{
  const o=a.observation;if(o.occurred_at>s.world_time)fail('INVALID_ACTION','Observation cannot occur in the future');
  if(s.claims.some(c=>c.observation.claim_id===o.claim_id))fail('INVALID_ACTION','Claim already recorded');
  for(const id of o.observers)exists(s,id);
  if(o.source_id!==p.actor_id&&!o.observers.includes(p.actor_id))fail('UNAUTHORIZED','Actor must speak or observe the claim');
  if(o.party_id!==null){const members=s.genesis.parties[o.party_id];if(!members||!members.includes(p.actor_id)||o.observers.some(id=>!members.includes(id)))fail('UNAUTHORIZED','Party disclosure outside membership');}
  break;
 }
 case 'vanish_thread':system(p,principal);if(exists(s,a.traveler_id).thread!=='present')fail('INVALID_ACTION','Only a present thread can vanish');break;
 case 'name_anomaly':direct(p,principal);if(exists(s,p.actor_id).fate_role!=='clotho')fail('UNAUTHORIZED','Only Clotho may name the anomaly');if(exists(s,a.traveler_id).thread!=='absent'||!s.cutoffs[a.traveler_id]||s.cutoffs[a.traveler_id]!.named_at_sequence!==null)fail('INVALID_ACTION','Absent unnamed thread required');break;
 case 'end_thread':direct(p,principal);if(exists(s,p.actor_id).fate_role!=='atropos')fail('UNAUTHORIZED','Only Atropos may end a thread');if(exists(s,a.traveler_id).thread!=='present')fail('INVALID_ACTION','No present thread to end');break;
 case 'draw':system(p,principal);if(a.visibility==='authority'&&a.audience_id!==null||a.visibility!=='authority'&&a.audience_id===null)fail('INVALID_ACTION','Invalid random audience');if(a.visibility==='actor')exists(s,a.audience_id!);if(a.visibility==='party'&&!s.genesis.parties[a.audience_id!])fail('INVALID_ACTION','Unknown random audience');break;
 }
}
export function draw(seed:string,index:number,label:string,bound:number):RngRecord{
 const hmac=(body:unknown)=>createHmac('sha256',Buffer.from(seed,'hex')).update(canonical(body)).digest();
 const limit=Math.floor(2**32/bound)*bound;let value=-1;
 for(let attempt=0;attempt<1000000;attempt++){const raw=hmac({label,index,bound,attempt}).readUInt32BE();if(raw<limit){value=raw%bound;break;}}
 if(value<0)fail('INVALID_ACTION','Random rejection bound exhausted');
 const nonce=hmac({purpose:'rng-commitment',index,label}).toString('hex');
 return {algorithm:'hmac-sha256-u32-rejection-v1',index,label,bound,value,nonce,commitment:hash({index,label,bound,value,nonce})};
}
export function unsigned(event:LedgerEvent):unknown{const {hash:_,...body}=event;const {signature:__,...authority}=body.authority;return {...body,authority};}
export function eventHash(event:LedgerEvent):string{const {hash:_,...body}=event;return hash(body);}
export function apply(s:Snapshot,event:LedgerEvent):Snapshot{
 const next=structuredClone(s),p=event.proposal,a=p.action;
 next.sequence=event.sequence;next.head=event.hash;next.world_time=p.world_time;next.proposals[p.proposal_id]=hash(p);
 if(p.proxy_grant_id!==null)next.grants[p.proxy_grant_id]!.uses=safeAdd(next.grants[p.proxy_grant_id]!.uses,1);
 switch(a.type){
 case 'advance_time':break;
 case 'move_item':next.items[a.item_id]!.custodian_id=a.to_actor_id;break;
 case 'record_consent':next.consents[a.consent.consent_id]={consent:structuredClone(a.consent),revoked:false,used:false,confirmed_by:event.authority.principal_id};break;
 case 'revoke_consent':next.consents[a.consent_id]!.revoked=true;break;
 case 'transfer_time':{
  const c=next.consents[a.consent_id]!.consent;next.consents[a.consent_id]!.used=true;
  next.actors[c.donor_id]!.time_balance-=c.units;next.actors[c.recipient_id]!.time_balance=safeAdd(next.actors[c.recipient_id]!.time_balance,c.units);
  next.transfers.push({consent_id:c.consent_id,donor_id:c.donor_id,recipient_id:c.recipient_id,units:c.units,world_time:next.world_time,event_id:event.event_id});break;
 }
 case 'grant_proxy':next.grants[a.grant.grant_id]={grant:structuredClone(a.grant),revoked:false,uses:0};break;
 case 'revoke_proxy':next.grants[a.grant_id]!.revoked=true;break;
 case 'observe_claim':next.claims.push({observation:structuredClone(a.observation),acquired_at:next.world_time,sequence:next.sequence,event_id:event.event_id});break;
 case 'vanish_thread':next.actors[a.traveler_id]!.thread='absent';next.cutoffs[a.traveler_id]={vanished_at_sequence:next.sequence,named_at_sequence:null};break;
 case 'name_anomaly':next.cutoffs[a.traveler_id]!.named_at_sequence=next.sequence;break;
 case 'end_thread':next.actors[a.traveler_id]!.thread='ended';next.actors[a.traveler_id]!.alive=false;break;
 case 'draw':next.rng_counter=safeAdd(next.rng_counter,1);break;
 }
 assertContract('Snapshot',next);return next;
}
export function verifyEvent(s:Snapshot,event:LedgerEvent,parents:Set<string>):void{
 assertContract('LedgerEvent',event);requireScope(s.genesis.scope,event.scope);requireScope(event.scope,event.proposal.scope);
 if(event.ruleset_version!==s.genesis.ruleset_version||event.sequence!==s.sequence+1||event.previous_hash!==s.head||event.event_id!==`event_${event.sequence}`)fail('CORRUPT_LEDGER','Corrupt ledger identity or order');
 if(event.authority.key_id!==s.genesis.authority_key_id||event.hash!==eventHash(event)||!verify(null,Buffer.from(canonical(unsigned(event))),s.genesis.authority_public_key,Buffer.from(event.authority.signature,'base64')))fail('CORRUPT_LEDGER','Corrupt ledger signature or hash');
 if(event.proposal.causal_parents.some(p=>!parents.has(p)))fail('CORRUPT_LEDGER','Unknown causal parent');
 if(s.proposals[event.proposal.proposal_id])fail('CORRUPT_LEDGER','Duplicate committed proposal');
 const receipt=event.proposal.action.type==='record_consent'?event.proposal.action.consent.confirmation_id:null;
 if(event.proposal.action.type!=='record_consent'&&event.authority.receipt_hash!==null)fail('CORRUPT_LEDGER','Unexpected consent receipt');
 validate(event.proposal,{principal_id:event.authority.principal_id,actor_id:event.authority.principal_actor_id,role:event.authority.principal_role,scope:event.scope,confirmed_receipts:receipt?[receipt]:[]},s,event.authority.receipt_hash);
 if(event.kind!==(event.proposal.action.type==='observe_claim'?'epistemic':'causal'))fail('CORRUPT_LEDGER','Wrong causal/epistemic envelope');
 const a=event.proposal.action;const expected=a.type==='draw'?draw(s.genesis.seed,s.rng_counter,a.label,a.bound):null;
 if(canonical(expected)!==canonical(event.rng))fail('CORRUPT_LEDGER','Corrupt RNG record');
}
export function replay(genesis:Genesis,events:readonly LedgerEvent[],expectedHead?:string|null):Snapshot{
 let state=initialSnapshot(genesis);const parents=new Set<string>();
 for(const event of events){verifyEvent(state,event,parents);state=apply(state,event);parents.add(event.hash);}
 if(expectedHead!==undefined&&expectedHead!==state.head)fail('CORRUPT_LEDGER','Replay head differs');return state;
}
export function outcome(event:LedgerEvent):Outcome{return {schema_version:'1.0.0',proposal_id:event.proposal.proposal_id,event_id:event.event_id,event_hash:event.hash,sequence:event.sequence,world_time:event.proposal.world_time,kind:event.kind,action_type:event.proposal.action.type,rng_commitment:event.rng?.commitment??null};}
