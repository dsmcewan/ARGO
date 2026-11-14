import {keys,scope} from './fixtures.ts';
import {MORTAL_PROFILE} from '../packages/contracts/src/mortal-types.ts';
import type {MortalGenesis,MortalActor,MortalItem,MortalState,MortalCommand,MortalAction,MortalPrincipal} from '../packages/contracts/src/mortal-types.ts';
export {keys};
export function mortalActor(id='hero',kind:'player'|'npc'='player'):MortalActor{return {id,name:id,controller_id:`auth_${id}`,kind,location_id:'harbor',hp:6,max_hp:6,abilities:{strength:2,dexterity:2,constitution:2,intelligence:2,wisdom:2,charisma:2},resources:{rations:2,water:2,oil:6,obols:20,ammo:20},active_seconds:0,fed_until:0,next_rest_at:0,discoveries:[]};}
export function mortalWeapon(id:string,owner_id:string):MortalItem{return {id,name:id,kind:'weapon',owner_id,location_id:null,slots:1,equipped:true,damage_die:6,attack_ability:'strength',armor_defense:0,tool:null};}
export function mortalGenesis():MortalGenesis{
 const hero=mortalActor(),companion=mortalActor('companion'),foe=mortalActor('raider','npc');foe.hp=foe.max_hp=4;
 return {version:MORTAL_PROFILE,variant:'legend',scope:{...scope,world_id:'mortal_world'},pack_hash:'cd'.repeat(32),seed:'ab'.repeat(32),authority_key_id:'mortal_key',authority_public_key:keys.publicKey.export({type:'spki',format:'pem'}).toString(),referee_id:'host',world_time:0,actors:[hero,companion,foe],items:[mortalWeapon('spear','hero'),mortalWeapon('club','raider'),{id:'lamp',name:'Lamp',kind:'tool',owner_id:'hero',location_id:null,slots:1,equipped:false,damage_die:0,attack_ability:null,armor_defense:0,tool:'lamp'},{id:'firekit',name:'Fire kit',kind:'tool',owner_id:'hero',location_id:null,slots:1,equipped:false,damage_die:0,attack_ability:null,armor_defense:0,tool:'firekit'}],locations:[{id:'harbor',name:'Harbor',safe_rest:true},{id:'ruin',name:'Ruin',safe_rest:false}],routes:[{id:'road',from:'harbor',to:'ruin',turns:1,requires_light:false,hazard:null}],opportunities:[{id:'cache',location_id:'ruin',kind:'search',ability:'wisdom',target:15,turns:1,requires_light:true,remaining:1,reward_resource:'obols',reward_units:2,failure_damage_die:0},{id:'forage',location_id:'harbor',kind:'forage',ability:'wisdom',target:15,turns:24,requires_light:false,remaining:2,reward_resource:'rations',reward_units:1,failure_damage_die:0}],stocks:[{id:'food',location_id:'harbor',resource:'rations',price:2,remaining:10,treasury:0}]};
}
export function mortalPrincipal(g:MortalGenesis,id='hero'):MortalPrincipal{
 if(id==='host')return {scope:structuredClone(g.scope),principal_id:g.referee_id,role:'referee',actor_id:null};
 const a=g.actors.find(a=>a.id===id)!;return {scope:structuredClone(g.scope),principal_id:a.controller_id,role:a.kind,actor_id:id};
}
export function mortalCommand(s:MortalState,action:MortalAction,id='hero',request_id=`command_${s.sequence+1}`):MortalCommand{return {version:MORTAL_PROFILE,scope:structuredClone(s.scope),request_id,actor_id:id==='host'?null:id,expected:{sequence:s.sequence,head:s.head},causation_id:s.head,action};}
