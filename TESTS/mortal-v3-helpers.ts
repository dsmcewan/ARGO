import {MORTAL_V3_PROFILE} from '../packages/contracts/src/mortal-v3-types.ts';
import type {MortalV3Genesis,MortalV3State,MortalV3Action,MortalV3Command,MortalV3Principal} from '../packages/contracts/src/mortal-v3-types.ts';
import {mortalGenesis,mortalActor,mortalWeapon,keys} from './mortal-fixtures.ts';
export {keys};
export function v3Genesis():MortalV3Genesis{
 const g:MortalV3Genesis={...mortalGenesis(),version:MORTAL_V3_PROFILE};
 const remote=mortalActor('remote');remote.location_id='ruin';
 g.actors.push(remote,mortalActor('watcher'));
 g.items.push(mortalWeapon('remote_spear','remote'),{id:'remote_loot',name:'Remote loot',kind:'loot',owner_id:null,location_id:'ruin',slots:1,equipped:false,damage_die:0,attack_ability:null,armor_defense:0,tool:null});
 g.locations.push({id:'camp',name:'Camp',safe_rest:true});g.locations[1]!.safe_rest=true;
 g.routes.push({id:'outer',from:'ruin',to:'camp',turns:1,requires_light:false,hazard:null});
 g.opportunities.push({id:'remote_forage',location_id:'ruin',kind:'forage',ability:'wisdom',target:0,turns:1,requires_light:false,remaining:3,reward_resource:'obols',reward_units:1,failure_damage_die:0});
 g.stocks.push({id:'remote_food',location_id:'ruin',resource:'rations',price:2,remaining:10,treasury:0});return g;
}
export function v3Principal(g:MortalV3Genesis,id='hero'):MortalV3Principal{
 if(id==='host')return {scope:structuredClone(g.scope),principal_id:g.referee_id,role:'referee',actor_id:null};
 const a=g.actors.find(a=>a.id===id)!;return {scope:structuredClone(g.scope),principal_id:a.controller_id,role:a.kind,actor_id:id};
}
export function v3Command(s:MortalV3State,action:MortalV3Action,id='hero',request_id=`command_${s.sequence+1}`):MortalV3Command{return {version:MORTAL_V3_PROFILE,scope:structuredClone(s.scope),request_id,actor_id:id==='host'?null:id,expected:{sequence:s.sequence,head:s.head},causation_id:s.head,action};}
export const v3Actor=(s:MortalV3State,id='hero')=>s.actors.find(a=>a.id===id)!;
export function recover(s:MortalV3State,resolution:'pass'|'close'='pass'):Extract<MortalV3Action,{type:'recover_encounter'}>{const e=s.encounter!;return {type:'recover_encounter',encounter_id:e.id,turn_started_sequence:e.turn_started_sequence,resolution,reason:'host_timeout'};}
export const encounter={type:'begin_encounter',encounter_id:'fight',side_a:['hero'],side_b:['raider'],escape_allowed:true} as const;
export function beginAction(extra=false):MortalV3Action{return {...encounter,side_a:extra?['hero','companion']:['hero'],side_b:['raider']};}
