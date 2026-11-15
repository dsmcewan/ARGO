/** Fresh-world initialization for mortal-rules/0.2.0. This is host-only authoring. */
import {createHmac} from 'node:crypto';
import {assertMortalData,assertMortalGenesis,assertScope,hash,fail,MORTAL_PROFILE} from '@argo/contracts';
import type {Scope,MortalGenesis,MortalActor,MortalItem,MortalAbility} from '@argo/contracts';
import {assertCampaignPack} from './campaign/catalog.ts';
import type {CampaignPack,Variant} from './campaign/types.ts';
export type MortalCampaignOptions={scope:Scope;seed:string;authority_key_id:string;authority_public_key:string;referee_id:string;npc_controller_id:string;variant:Variant;hp_mode:'classic'|'floor4';travelers:{id:string;name:string;controller_id:string;weapon:'spear'|'sling'}[]};
export type MortalCampaignSeed={genesis:MortalGenesis;manifest:{adapter:'tempting-fates-mortal/0.2.0';pack_hash:string;genesis_hash:string;variant:Variant;hp_mode:'classic'|'floor4'}};
function invalid(message:string):never{return fail('INVALID_CONTRACT',message);}
function closed(value:unknown,fields:string[]):asserts value is Record<string,unknown>{
 if(value===null||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==fields.length||fields.some(k=>!Object.hasOwn(value,k)))invalid('Closed campaign host options required');
}
function id(value:unknown):asserts value is string{if(typeof value!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$(?![\s\S])/.test(value)||['constructor','prototype','__proto__'].includes(value))invalid('Invalid campaign identity');}
function text(value:unknown):asserts value is string{if(typeof value!=='string'||!value.trim()||[...value].length>128)invalid('Invalid campaign name');}
const abilities:MortalAbility[]=['strength','dexterity','constitution','intelligence','wisdom','charisma'];
function creationDie(seed:string,label:string,sides:number):number{
 const limit=Math.floor(2**32/sides)*sides;
 for(let attempt=0;attempt<1024;attempt++){
  const n=createHmac('sha256',Buffer.from(seed,'hex')).update(`ARGO/mortal-creation/0.2.0:${label}:${attempt}`).digest().readUInt32BE(0);
  if(n<limit)return n%sides+1;
 }
 return invalid('Creation draw rejection bound exceeded');
}
function actor(id:string,name:string,controller_id:string,kind:'player'|'npc',location_id:string,hp:number,bonus:Record<MortalAbility,number>):MortalActor{return {id,name,controller_id,kind,location_id,hp,max_hp:hp,abilities:bonus,resources:{rations:2,water:2,oil:0,obols:5,ammo:0},active_seconds:0,fed_until:0,next_rest_at:0,discoveries:[]};}
function tool(itemId:string,name:string,owner_id:string,tag:'lamp'|'firekit'):MortalItem{return {id:itemId,name,kind:'tool',owner_id,location_id:null,slots:1,equipped:false,damage_die:0,attack_ability:null,armor_defense:0,tool:tag};}
export function buildMortalCampaign(value:unknown,input:MortalCampaignOptions):MortalCampaignSeed{
 assertCampaignPack(value);const pack:CampaignPack=value;
 assertMortalData(input);closed(input,['scope','seed','authority_key_id','authority_public_key','referee_id','npc_controller_id','variant','hp_mode','travelers']);
 assertScope(input.scope);id(input.authority_key_id);id(input.referee_id);id(input.npc_controller_id);
 if(typeof input.seed!=='string'||!/^[a-f0-9]{64}$(?![\s\S])/.test(input.seed))invalid('Private seed must be 32-byte lowercase hex');
 if(typeof input.authority_public_key!=='string'||!['genuine','counterfeit','legend'].includes(input.variant)||!['classic','floor4'].includes(input.hp_mode))invalid('Explicit key, variant and HP mode required');
 if(!Array.isArray(input.travelers)||input.travelers.length<1||input.travelers.length>6)invalid('One to six travelers required');
 const reserved=new Set([...pack.npcs.map(n=>n.id),...pack.items.map(i=>i.id)]);
 for(const traveler of input.travelers){
  closed(traveler,['id','name','controller_id','weapon']);id(traveler.id);id(traveler.controller_id);text(traveler.name);
  if(reserved.has(traveler.id)||!['spear','sling'].includes(traveler.weapon))invalid('Traveler identity or equipment is unavailable');reserved.add(traveler.id);
 }
 const mortals=pack.npcs.filter(n=>n.fate_role===null),mortalIds=new Set(mortals.map(n=>n.id));
 const actors=mortals.map(n=>actor(n.id,n.name,input.npc_controller_id,'npc',n.location_id,4,{strength:1,dexterity:1,constitution:1,intelligence:1,wisdom:1,charisma:1}));
 const items:MortalItem[]=pack.items.filter(i=>i.variants.includes(input.variant)).map(i=>{
  if(i.custodian_id===null||!mortalIds.has(i.custodian_id))invalid('This adapter requires an existing mortal item custodian');
  if(i.id==='traveler_lamp')return tool(i.id,i.name,i.custodian_id,'lamp');
  return {id:i.id,name:i.name,kind:'loot',owner_id:i.custodian_id,location_id:null,slots:i.slots,equipped:false,damage_die:0,attack_ability:null,armor_defense:0,tool:null};
 });
 for(const npc of actors)items.push({id:`${npc.id}_work_knife`,name:'Ordinary working knife',kind:'weapon',owner_id:npc.id,location_id:null,slots:1,equipped:true,damage_die:4,attack_ability:'strength',armor_defense:0,tool:null});
 for(const [position,traveler] of input.travelers.entries()){
  const bonus=Object.fromEntries(abilities.map(ability=>[ability,Math.min(...[0,1,2].map(d=>creationDie(input.seed,`${position}:${ability}:${d}`,6)))])) as Record<MortalAbility,number>;
  const rolledHp=creationDie(input.seed,`${position}:hp`,8),pc=actor(traveler.id,traveler.name,traveler.controller_id,'player',pack.start_location_id,Math.max(input.hp_mode==='floor4'?4:1,rolledHp),bonus);
  pc.resources={rations:2,water:2,oil:6,obols:20,ammo:traveler.weapon==='sling'?20:0};actors.push(pc);
  items.push({id:`${pc.id}_weapon`,name:traveler.weapon==='sling'?'Sling':'Spear',kind:'weapon',owner_id:pc.id,location_id:null,slots:traveler.weapon==='sling'?1:2,equipped:true,damage_die:traveler.weapon==='sling'?4:6,attack_ability:traveler.weapon==='sling'?'wisdom':'strength',armor_defense:0,tool:null},tool(`${pc.id}_lamp`,'Ordinary lamp',pc.id,'lamp'),tool(`${pc.id}_firekit`,'Fire kit',pc.id,'firekit'));
 }
 const packHash=hash(pack);
 const genesis:MortalGenesis={version:MORTAL_PROFILE,scope:structuredClone(input.scope),variant:input.variant,pack_hash:packHash,seed:input.seed,authority_key_id:input.authority_key_id,authority_public_key:input.authority_public_key,referee_id:input.referee_id,world_time:0,actors,items,
  locations:pack.locations.filter(l=>!l.is_loom).map(l=>({id:l.id,name:l.name,safe_rest:l.id===pack.start_location_id})),
  routes:pack.routes.filter(r=>r.access==='ordinary').map(r=>({id:r.id,from:r.from,to:r.to,turns:r.travel_turns,requires_light:false,hazard:null})),
  opportunities:[{id:'harbor_olive_verge',location_id:pack.start_location_id,kind:'forage',ability:'wisdom',target:15,turns:24,requires_light:false,remaining:3,reward_resource:'rations',reward_units:1,failure_damage_die:0},{id:'quarry_oil_cache',location_id:'l_quarry',kind:'search',ability:'wisdom',target:15,turns:1,requires_light:false,remaining:1,reward_resource:'oil',reward_units:6,failure_damage_die:0}],
  stocks:[{id:'harbor_rations',location_id:pack.start_location_id,resource:'rations',price:2,remaining:20,treasury:0},{id:'harbor_water',location_id:pack.start_location_id,resource:'water',price:1,remaining:20,treasury:0}]};
 assertMortalGenesis(genesis);
 return {genesis,manifest:{adapter:'tempting-fates-mortal/0.2.0',pack_hash:packHash,genesis_hash:hash(genesis),variant:input.variant,hp_mode:input.hp_mode}};
}
