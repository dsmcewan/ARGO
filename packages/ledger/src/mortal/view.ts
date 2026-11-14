import {assertMortalGenesis,assertMortalContract,hash,requireScope,fail} from '@argo/contracts';
import type {MortalGenesis,MortalState,MortalPrincipal,MortalActorView} from '@argo/contracts';
/** Project an already verified host state for a directly authenticated current viewer. */
export function viewMortalActor(genesis:MortalGenesis,state:MortalState,principal:MortalPrincipal):MortalActorView{
 assertMortalGenesis(genesis);assertMortalContract('State',state);assertMortalContract('Principal',principal);
 requireScope(genesis.scope,state.scope);requireScope(genesis.scope,principal.scope);
 if(state.genesis_hash!==hash(genesis))fail('INVALID_CONTRACT','View state belongs to another genesis');
 const actor=state.actors.find(a=>a.id===principal.actor_id);
 if(!actor||principal.role==='referee'||actor.kind!==principal.role||actor.controller_id!==principal.principal_id)fail('UNAUTHORIZED','Actor view requires its direct controller');
 const location=genesis.locations.find(l=>l.id===actor.location_id);if(!location)fail('INVALID_CONTRACT','Unknown actor location');
 const {controller_id:_,kind:__,...self}=actor;
 let encounter:MortalActorView['encounter']=null;
 const fight=state.encounter;
 if(fight&&[...fight.side_a,...fight.side_b].includes(actor.id)&&!fight.escaped.includes(actor.id)){
  encounter={id:fight.id,round:fight.round,acting_id:fight.order[fight.turn]!,your_turn:fight.order[fight.turn]===actor.id,escape_allowed:fight.escape_allowed,
   participants:[...fight.side_a,...fight.side_b].map(id=>{const participant=state.actors.find(a=>a.id===id)!;return {id,side:fight.side_a.includes(id)?'a':'b',condition:participant.hp>0?'standing':participant.hp===0?'unconscious':'dead',escaped:fight.escaped.includes(id)};})};
 }
 const result:MortalActorView=structuredClone({version:state.version,scope:state.scope,cursor:{sequence:state.sequence,head:state.head},world_time:state.world_time,self,items:state.items.filter(i=>i.owner_id===actor.id),location,routes:genesis.routes.filter(r=>r.from===actor.location_id||r.to===actor.location_id),encounter});
 assertMortalContract('ActorView',result);return result;
}
