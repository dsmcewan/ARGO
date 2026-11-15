import {assertMortalV3Genesis, assertMortalV3Contract} from '../../../contracts/src/mortal-v3.ts';
import {hash, requireScope, fail} from '../../../contracts/src/index.ts';
import type {MortalV3Genesis,MortalV3State,MortalV3Principal,MortalV3ActorView} from '../../../contracts/src/mortal-v3-types.ts';
/** Project an already verified host state for a directly authenticated current viewer. */
export function viewMortalV3Actor(genesis:MortalV3Genesis,state:MortalV3State,principal:MortalV3Principal):MortalV3ActorView{
 assertMortalV3Genesis(genesis);assertMortalV3Contract('State',state);assertMortalV3Contract('Principal',principal);
 requireScope(genesis.scope,state.scope);requireScope(genesis.scope,principal.scope);
 if(state.genesis_hash!==hash(genesis))fail('INVALID_CONTRACT','View state belongs to another genesis');
 const actor=state.actors.find(a=>a.id===principal.actor_id);
 if(!actor||principal.role==='referee'||actor.kind!==principal.role||actor.controller_id!==principal.principal_id)fail('UNAUTHORIZED','Actor view requires its direct controller');
 const location=genesis.locations.find(l=>l.id===actor.location_id);if(!location)fail('INVALID_CONTRACT','Unknown actor location');
 const {controller_id:_,kind:__,...self}=actor;
 let encounter:MortalV3ActorView['encounter']=null;
 const fight=state.encounter;
 const roster=fight?.order.includes(actor.id)??false;
 const activity_lock:MortalV3ActorView['activity_lock']=fight&&(roster||actor.location_id===fight.location_id)?{encounter_id:fight.id,location_id:fight.location_id,reason:roster?'roster':'site'}:null;
 if(fight&&[...fight.side_a,...fight.side_b].includes(actor.id)&&!fight.escaped.includes(actor.id)){
  encounter={id:fight.id,round:fight.round,acting_id:fight.order[fight.turn]!,your_turn:fight.order[fight.turn]===actor.id,escape_allowed:fight.escape_allowed,
   participants:[...fight.side_a,...fight.side_b].map(id=>{const participant=state.actors.find(a=>a.id===id)!;return {id,side:fight.side_a.includes(id)?'a':'b',condition:participant.hp>0?'standing':participant.hp===0?'unconscious':'dead',escaped:fight.escaped.includes(id)};})};
 }
 const result:MortalV3ActorView=structuredClone({version:state.version,scope:state.scope,cursor:{sequence:state.sequence,head:state.head},world_time:state.world_time,self,items:state.items.filter(i=>i.owner_id===actor.id),location,routes:genesis.routes.filter(r=>r.from===actor.location_id||r.to===actor.location_id),encounter,activity_lock});
 assertMortalV3Contract('ActorView',result);return result;
}
