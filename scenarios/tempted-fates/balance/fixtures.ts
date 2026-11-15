/** Deterministic experiment fixtures, not a character-creation or authority API. */
import {createHash,createPublicKey} from 'node:crypto';
import {MORTAL_PROFILE} from '../../../packages/contracts/src/mortal-types.ts';
import type {MortalActor,MortalGenesis,MortalItem} from '../../../packages/contracts/src/mortal-types.ts';
export type Phase='train'|'holdout'|'pilot';
export type Policy='fight'|'immediate'|'threshold';
export type Arm={id:string;hp:'classic'|'floor4';armor:11|12|14;policy:Policy;enemies:1|2};
export const PROTOCOL='mortal-balance/1.0.0';
// RFC8032 test-vector public key. There is deliberately no private key here.
export const FIXTURE_PUBLIC_KEY=createPublicKey({key:Buffer.from('302a300506032b6570032100d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a','hex'),format:'der',type:'spki'}).export({type:'spki',format:'pem'}).toString();
const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
function check(phase:Phase,index:number):void{
 if(!['train','holdout','pilot'].includes(phase)||!Number.isSafeInteger(index)||index<0||index>=10000||Object.is(index,-0))throw Error('Invalid experiment phase/trial index');
}
export function trialSeed(phase:Phase,index:number):string{check(phase,index);return digest(`${PROTOCOL}|engine|${phase}|${index}`);}
export function initialDie(phase:Phase,index:number):number{
 check(phase,index); // 256 is divisible by8; this fixture draw has no modulo bias.
 return 1+Number.parseInt(digest(`${PROTOCOL}|initial-hp|${phase}|${index}`).slice(0,2),16)%8;
}
export function combatArms():Arm[]{
 const rows:Arm[]=[];
 for(const hp of ['classic','floor4'] as const)for(const armor of [11,12,14] as const)for(const policy of ['fight','immediate','threshold'] as const)
  rows.push({id:`solo_${hp}_a${armor}_${policy}`,hp,armor,policy,enemies:1});
 for(const policy of ['fight','immediate','threshold'] as const)rows.push({id:`outnumbered_classic_a11_${policy}`,hp:'classic',armor:11,policy,enemies:2});
 return rows;
}
export function actor(id:string,kind:'player'|'npc',hp:number):MortalActor{
 return {id,name:id,controller_id:`control_${id}`,kind,location_id:'arena',hp,max_hp:hp,
  abilities:{strength:kind==='player'?2:1,dexterity:kind==='player'?1:2,constitution:2,intelligence:1,wisdom:1,charisma:1},
  resources:{rations:1,water:1,oil:0,obols:0,ammo:0},active_seconds:0,fed_until:0,next_rest_at:0,discoveries:[]};
}
export function weapon(owner:string,damage:4|6):MortalItem{
 return {id:`weapon_${owner}`,name:'Fixture melee weapon',kind:'weapon',owner_id:owner,location_id:null,slots:damage===6?2:1,equipped:true,damage_die:damage,attack_ability:'strength',armor_defense:0,tool:null};
}
export function emptyGenesis(phase:Phase,index:number):MortalGenesis{
 return {version:MORTAL_PROFILE,scope:{tenant_id:'balance',rights_lane:'homebrew',workspace_id:'experiments',workspace_tenant_id:'balance:homebrew:experiments',campaign_id:'mortal_balance',world_id:`${phase}_${index}`,branch_id:'fixture'},
  pack_hash:digest(`${PROTOCOL}|fixture-pack`),variant:'legend',seed:trialSeed(phase,index),authority_key_id:'rfc8032_fixture_public',authority_public_key:FIXTURE_PUBLIC_KEY,referee_id:'balance_referee',world_time:0,
  actors:[],items:[],locations:[{id:'arena',name:'Disclosed encounter site',safe_rest:true}],routes:[],opportunities:[],stocks:[]};
}
export function combatGenesis(phase:Phase,index:number,arm:Arm):MortalGenesis{
 const g=emptyGenesis(phase,index),die=initialDie(phase,index);g.actors.push(actor('hero','player',arm.hp==='classic'?die:Math.max(4,die)));g.items.push(weapon('hero',6));
 if(arm.armor!==11)g.items.push({id:'hero_armor',name:'Fixture armor',kind:'armor',owner_id:'hero',location_id:null,slots:arm.armor===12?2:3,equipped:true,damage_die:0,attack_ability:null,armor_defense:arm.armor,tool:null});
 for(let n=1;n<=arm.enemies;n++){const id=`raider_${n}`;g.actors.push(actor(id,'npc',4));g.items.push(weapon(id,4));}
 return g;
}
