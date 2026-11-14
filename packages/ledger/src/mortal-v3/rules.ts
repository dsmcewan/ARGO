/** Pure, versioned mortal authority. No storage, callbacks, models or caller dice. */
import {createHmac} from 'node:crypto';
import {MORTAL_V3_PROFILE} from '../../../contracts/src/mortal-v3-types.ts';
import {assertMortalV3Genesis, assertMortalV3Contract} from '../../../contracts/src/mortal-v3.ts';
import {canonical, hash, fail} from '../../../contracts/src/index.ts';
import type {MortalV3Genesis,MortalV3State,MortalV3Actor,MortalV3Item,MortalV3Command,MortalV3Principal,MortalV3Resolution,MortalV3Draw,MortalV3Effect,MortalV3Encounter,MortalV3Resource} from '../../../contracts/src/mortal-v3-types.ts';

const DAY=86400,CLOCK=1000000000000,RESOURCE=1000000;
// structuredClone preserves shared references. Canonical JSON materializes each
// value separately, so aliased host input can never couple two actors' resources.
const copy=<T>(value:T):T=>JSON.parse(canonical(value)) as T;
function bounded(value:number,max=CLOCK,min=0):number{
 if(!Number.isSafeInteger(value)||value<min||value>max)fail('INVALID_ACTION','Mortal arithmetic exceeds its bound');return value;
}
function actor(state:MortalV3State,id:string):MortalV3Actor{
 const found=state.actors.find(a=>a.id===id);if(!found)fail('INVALID_ACTION','Unknown mortal actor');return found;
}
function item(state:MortalV3State,id:string):MortalV3Item{
 const found=state.items.find(i=>i.id===id);if(!found)fail('INVALID_ACTION','Unknown mortal item');return found;
}
function capacity(state:MortalV3State,id:string):{used:number;limit:number}{
 const a=actor(state,id),r=a.resources;
 return {used:state.items.filter(i=>i.owner_id===id).reduce((sum,i)=>sum+i.slots,0)+r.rations+r.water+Math.ceil(r.oil/18)+Math.ceil(r.obols/100)+Math.ceil(r.ammo/20),limit:a.abilities.constitution+10};
}
function fits(state:MortalV3State,id:string):void{const c=capacity(state,id);if(c.used>c.limit)fail('INVALID_ACTION','Mortal carrying capacity exceeded');}
export function mortalV3Capacity(state:MortalV3State,actorId:string):{used:number;limit:number}{
 assertMortalV3Contract('State',state);return capacity(state,actorId);
}
export function mortalV3StateHash(state:MortalV3State):string{
 assertMortalV3Contract('State',state);const {head:_,...body}=state;return hash(body);
}
export function initialMortalV3State(genesis:MortalV3Genesis):MortalV3State{
 assertMortalV3Genesis(genesis);const g=copy(genesis),genesisHash=hash(g);
 const state:MortalV3State={version:MORTAL_V3_PROFILE,scope:g.scope,genesis_hash:genesisHash,sequence:0,head:genesisHash,world_time:0,rng_counter:0,actors:g.actors,items:g.items,opportunities:g.opportunities,stocks:g.stocks,encounter:null};
 assertMortalV3Contract('State',state);return state;
}
function without(value:object,mutable:readonly string[]):object{
 return Object.fromEntries(Object.entries(value).filter(([key])=>!mutable.includes(key)));
}
function sameDefinitions<T extends {id:string}>(original:T[],current:T[],mutable:readonly string[]):void{
 if(original.length!==current.length)fail('CORRUPT_LEDGER','Mortal state collection differs from genesis');
 for(let i=0;i<original.length;i++)if(canonical(without(original[i]!,mutable))!==canonical(without(current[i]!,mutable)))fail('CORRUPT_LEDGER','Mortal immutable definition differs from genesis');
}
function bindState(g:MortalV3Genesis,s:MortalV3State):void{
 if(s.genesis_hash!==hash(g)||canonical(s.scope)!==canonical(g.scope))fail('CORRUPT_LEDGER','Mortal state genesis identity differs');
 sameDefinitions(g.actors,s.actors,['location_id','hp','resources','active_seconds','fed_until','next_rest_at','discoveries']);
 sameDefinitions(g.items,s.items,['owner_id','location_id','equipped']);
 sameDefinitions(g.opportunities,s.opportunities,['remaining']);sameDefinitions(g.stocks,s.stocks,['remaining','treasury']);
 const locations=new Set(g.locations.map(l=>l.id));
 for(const a of s.actors){
  if(!locations.has(a.location_id))fail('CORRUPT_LEDGER','Unknown mortal state location');
  // Every accepted living prefix has already assessed its active periods. This
  // rejects fabricated debt backlogs instead of walking an unbounded time loop.
  if(a.hp>=0&&a.fed_until<a.active_seconds)fail('CORRUPT_LEDGER','Mortal active time has unassessed needs');
 }
 for(const i of s.items)if(i.location_id!==null&&!locations.has(i.location_id))fail('CORRUPT_LEDGER','Unknown mortal ground-item location');
 for(let i=0;i<s.opportunities.length;i++)if(s.opportunities[i]!.remaining>g.opportunities[i]!.remaining)fail('CORRUPT_LEDGER','Mortal opportunity stock increased');
 for(let i=0;i<s.stocks.length;i++)if(s.stocks[i]!.remaining>g.stocks[i]!.remaining||s.stocks[i]!.treasury<g.stocks[i]!.treasury)fail('CORRUPT_LEDGER','Mortal stock moved outside its allowed transitions');
 if(s.sequence===0&&canonical(s)!==canonical(initialMortalV3State(g)))fail('CORRUPT_LEDGER','Mortal initial state differs from genesis');
 if(s.encounter){
  const locations=new Set(s.encounter.order.map(id=>actor(s,id).location_id));
  if(locations.size!==1||!locations.has(s.encounter.location_id))fail('CORRUPT_LEDGER','Mortal encounter actors are outside the fixed site');
  if(!viable(s,s.encounter))fail('CORRUPT_LEDGER','An ended mortal encounter remained open');
 }
}
const eligible=(s:MortalV3State,e:MortalV3Encounter,id:string):boolean=>actor(s,id).hp>0&&!e.escaped.includes(id);
const viable=(s:MortalV3State,e:MortalV3Encounter):boolean=>e.side_a.some(id=>eligible(s,e,id))&&e.side_b.some(id=>eligible(s,e,id));
function nextEligible(s:MortalV3State,e:MortalV3Encounter,from:number):number{
 for(let n=from;n<e.order.length;n++)if(eligible(s,e,e.order[n]!))return n;return -1;
}
function checkTime(s:MortalV3State,ids:readonly string[],duration:number):void{
 bounded(s.world_time+duration);for(const id of ids)bounded(actor(s,id).active_seconds+duration);
}
function needed(a:MortalV3Actor,duration:number):number{return Math.max(0,Math.ceil((a.active_seconds+duration-a.fed_until)/DAY));}
function light(s:MortalV3State,a:MortalV3Actor,turns:number,required:boolean):void{
 if(!required)return;
 for(const tool of ['lamp','firekit'])if(!s.items.some(i=>i.owner_id===a.id&&i.kind==='tool'&&i.tool===tool))fail('INVALID_ACTION','Travel or exploration requires held lamp and firekit');
 if(a.resources.oil<turns)fail('INVALID_ACTION','Insufficient oil for the declared duration');
}
function recipient(s:MortalV3State,source:MortalV3Actor,id:string):MortalV3Actor{
 const to=actor(s,id);if(to.hp<0||to.location_id!==source.location_id)fail('UNAUTHORIZED','Recipient must be living and co-located');return to;
}
function checkIncrease(s:MortalV3State,id:string,resource:MortalV3Resource,units:number):void{
 const preview=copy(s);const to=actor(preview,id);to.resources[resource]=bounded(to.resources[resource]+units,RESOURCE);fits(preview,id);
}

export function resolveMortalV3(genesis:MortalV3Genesis,input:MortalV3State,command:MortalV3Command,principal:MortalV3Principal):MortalV3Resolution{
 assertMortalV3Genesis(genesis);assertMortalV3Contract('State',input);assertMortalV3Contract('Command',command);assertMortalV3Contract('Principal',principal);
 bindState(genesis,input);
 if(canonical(genesis.scope)!==canonical(command.scope)||canonical(genesis.scope)!==canonical(principal.scope))fail('SCOPE_DENIED','Mortal command scope differs');
 if(command.expected.sequence!==input.sequence||command.expected.head!==input.head)fail('CONFLICT','Stale mortal cursor');
 if(command.causation_id!==null&&command.causation_id!==input.head)fail('CONFLICT','Mortal causation is not current');
 bounded(input.sequence+1,1000000);
 const action=command.action,combat=['attack','defend','retreat','pass'].includes(action.type),recovery=action.type==='recover_encounter';
 let acting:MortalV3Actor|null=null,currentTurn=-1;
 if(action.type==='begin_encounter'||recovery){
  if(principal.role!=='referee'||principal.actor_id!==null||principal.principal_id!==genesis.referee_id||command.actor_id!==null)fail('UNAUTHORIZED','Only configured referee can administer an encounter');
 }
 if(action.type==='begin_encounter'){
  if(input.encounter)fail('CONFLICT','A mortal encounter is already active');
  const roster=[...action.side_a,...action.side_b],where=new Set<string>();
  for(const id of roster){const a=actor(input,id);if(a.hp<=0)fail('INVALID_ACTION','Encounter participant must be standing');fits(input,id);where.add(a.location_id);}
  if(where.size!==1)fail('INVALID_ACTION','Encounter participants must be co-located');checkTime(input,roster,6);
 }else if(action.type==='recover_encounter'){
  const e=input.encounter;
  if(!e||e.id!==action.encounter_id||e.turn_started_sequence!==action.turn_started_sequence)fail('CONFLICT','Recovery no longer identifies the waiting turn');
  currentTurn=e.turn;acting=actor(input,e.order[currentTurn]!);checkTime(input,e.round_participants,6);
 }else{
  if(principal.role==='referee'||principal.actor_id!==command.actor_id||command.actor_id===null)fail('UNAUTHORIZED','Direct mortal actor authentication required');
  acting=actor(input,command.actor_id);
  if(principal.principal_id!==acting.controller_id||principal.role!==acting.kind)fail('UNAUTHORIZED','Mortal controller or role differs');
  if(acting.hp<0||acting.hp===0&&action.type!=='rest')fail('UNAUTHORIZED','Mortal action requires a standing actor; only rest admits unconscious survivors');
  if(input.encounter){
   const e=input.encounter;
   if(combat){
    currentTurn=e.turn;
    if(e.order[currentTurn]!==acting.id)fail('UNAUTHORIZED','Mortal actor is out of turn');checkTime(input,e.round_participants,6);
   }else{
    // Lock the complete original roster and site. All other ordinary actions
    // retain their local ownership/co-location checks below; no remote action
    // may enter the site or transfer to a roster actor, including an escapee.
    if(e.order.includes(acting.id)||acting.location_id===e.location_id)fail('CONFLICT','Mortal activity is locked');
    if(action.type==='travel'){
     const route=genesis.routes.find(r=>r.id===action.route_id);
     if(route&&(route.from===e.location_id||route.to===e.location_id))fail('CONFLICT','Mortal activity is locked');
    }
    if((action.type==='give'||action.type==='transfer_item')&&action.to_actor_id!==null&&e.order.includes(action.to_actor_id))fail('CONFLICT','Mortal activity is locked');
   }
  }else if(combat)fail('INVALID_ACTION','Combat action requires an active encounter');
 }
 // All cheap permissions, resource amounts and possible reward capacity are
 // checked on the supplied prefix, before any random draw or copied mutation.
 if(acting)switch(action.type){
 case 'travel':{
  const route=genesis.routes.find(r=>r.id===action.route_id);if(!route||route.from!==acting.location_id&&route.to!==acting.location_id)fail('INVALID_ACTION','Route is not adjacent to this actor');
  fits(input,acting.id);light(input,acting,route.turns,route.requires_light);checkTime(input,[acting.id],route.turns*600);break;
 }
 case 'explore':{
  const opportunity=input.opportunities.find(o=>o.id===action.opportunity_id);
  if(!opportunity||opportunity.location_id!==acting.location_id||opportunity.remaining<=0)fail('INVALID_ACTION','Opportunity is absent, remote or exhausted');
  if(opportunity.kind==='search'&&acting.discoveries.includes(opportunity.id))fail('CONFLICT','Search opportunity was already attempted by this actor');
  light(input,acting,opportunity.turns,opportunity.requires_light);checkIncrease(input,acting.id,opportunity.reward_resource,opportunity.reward_units);checkTime(input,[acting.id],opportunity.turns*600);break;
 }
 case 'wait':checkTime(input,[acting.id],action.turns*600);break;
 case 'rest':{
  if(!genesis.locations.find(l=>l.id===acting!.location_id)!.safe_rest)fail('INVALID_ACTION','Location does not permit safe rest');
  if(acting.active_seconds<acting.next_rest_at)fail('CONFLICT','Mortal rest allowance has not elapsed');
  const periods=needed(acting,28800);if(acting.resources.rations<periods||acting.resources.water<periods)fail('INVALID_ACTION','Rest needs sufficient food and water coverage');
  checkTime(input,[acting.id],28800);bounded(acting.active_seconds+DAY);break;
 }
 case 'equip':{
  const i=item(input,action.item_id);if(i.owner_id!==acting.id||i.kind!=='weapon'&&i.kind!=='armor')fail('UNAUTHORIZED','Only an owned weapon or armor can be equipped');
  if(action.equipped&&input.items.some(other=>other.id!==i.id&&other.owner_id===acting!.id&&other.kind===i.kind&&other.equipped))fail('CONFLICT','Unequip the existing item of this kind first');break;
 }
 case 'transfer_item':{
  const i=item(input,action.item_id);if(i.owner_id!==acting.id)fail('UNAUTHORIZED','Only the current owner can transfer an item');
  if(action.to_actor_id!==null){recipient(input,acting,action.to_actor_id);const preview=copy(input),moving=item(preview,i.id);moving.owner_id=action.to_actor_id;moving.location_id=null;moving.equipped=false;fits(preview,action.to_actor_id);}break;
 }
 case 'pickup':case 'loot':{
  const i=item(input,action.item_id);
  if(action.type==='pickup'?(i.owner_id!==null||i.location_id!==acting.location_id):(i.owner_id===null||actor(input,i.owner_id).hp>=0||actor(input,i.owner_id).location_id!==acting.location_id))fail('UNAUTHORIZED','Item is not available for this local pickup or corpse recovery');
  const preview=copy(input),moving=item(preview,i.id);moving.owner_id=acting.id;moving.location_id=null;moving.equipped=false;fits(preview,acting.id);break;
 }
 case 'give':{
  recipient(input,acting,action.to_actor_id);if(acting.resources[action.resource]<action.units)fail('INVALID_ACTION','Insufficient owned resources');
  const preview=copy(input),from=actor(preview,acting.id),to=actor(preview,action.to_actor_id);from.resources[action.resource]-=action.units;to.resources[action.resource]=bounded(to.resources[action.resource]+action.units,RESOURCE);fits(preview,to.id);break;
 }
 case 'buy':{
  const stock=input.stocks.find(s=>s.id===action.stock_id);if(!stock||stock.location_id!==acting.location_id||stock.remaining<action.units)fail('INVALID_ACTION','Local stock is absent or exhausted');
  const price=bounded(action.units*stock.price,RESOURCE);if(acting.resources.obols<price)fail('INVALID_ACTION','Insufficient obols');bounded(stock.treasury+price,RESOURCE);
  const preview=copy(input),to=actor(preview,acting.id);to.resources.obols-=price;to.resources[stock.resource]=bounded(to.resources[stock.resource]+action.units,RESOURCE);fits(preview,to.id);break;
 }
 case 'attack':{
  const e=input.encounter!,target=actor(input,action.target_id),weapon=item(input,action.weapon_id);
  const enemy=e.side_a.includes(acting.id)?e.side_b:e.side_a;
  if(!enemy.includes(target.id)||!eligible(input,e,target.id)||target.location_id!==acting.location_id)fail('UNAUTHORIZED','Attack requires an opposing standing encounter target');
  if(weapon.owner_id!==acting.id||weapon.kind!=='weapon'||!weapon.equipped)fail('UNAUTHORIZED','Attack requires the equipped owned weapon');
  if(weapon.attack_ability==='wisdom'&&acting.resources.ammo<1)fail('INVALID_ACTION','Ranged attack requires ammunition');break;
 }
 case 'retreat':if(!input.encounter!.escape_allowed)fail('UNAUTHORIZED','This encounter does not declare an escape');fits(input,acting.id);break;
 case 'pass':case 'defend':break;
 }
 const state=copy(input),draws:MortalV3Draw[]=[],effects:MortalV3Effect[]=[];
 const effect=(kind:string,actor_id:string|null,subject_id:string|null,amount:number)=>{if(effects.length>=1024)fail('INVALID_ACTION','Mortal effect bound exceeded');effects.push({kind,actor_id,subject_id,amount});};
 const draw=(purpose:string,sides:number):number=>{
  if(draws.length>=256)fail('INVALID_ACTION','Mortal draw bound exceeded');const index=state.rng_counter;bounded(index+1);
  const limit=Math.floor(2**32/sides)*sides;let value:number|undefined;
  for(let attempt=0;attempt<1000000;attempt++){
   const bytes=createHmac('sha256',Buffer.from(genesis.seed,'hex')).update(canonical({domain:'mortal-rng/0.3.0',index,purpose,sides,attempt})).digest();const raw=bytes.readUInt32BE();
   if(raw<limit){value=raw%sides+1;break;}
  }
  if(value===undefined)fail('INVALID_ACTION','Mortal rejection-sampling bound exhausted');state.rng_counter++;draws.push({index,purpose,sides,value});return value;
 };
 const damage=(who:MortalV3Actor,amount:number,source:string|null)=>{who.hp=bounded(who.hp-amount,100,-1000000);effect('damage',who.id,source,-amount);};
 const resource=(who:MortalV3Actor,kind:MortalV3Resource,delta:number,source:string|null=null)=>{who.resources[kind]=bounded(who.resources[kind]+delta,RESOURCE);effect(`resource_${kind}`,who.id,source,delta);};
 const advance=(ids:readonly string[],seconds:number)=>{
  state.world_time=bounded(state.world_time+seconds);effect('world_time',null,null,seconds);
  for(const id of ids){
   const a=actor(state,id);a.active_seconds=bounded(a.active_seconds+seconds);effect('active_time',id,null,seconds);
   while(a.hp>=0&&a.active_seconds>a.fed_until){
    a.fed_until=bounded(a.fed_until+DAY);
    // Capture simultaneous missing provisions before either damage changes life.
    const hungry=a.resources.rations===0,thirsty=a.resources.water===0;
    if(hungry)damage(a,draw('hunger',4),null);else resource(a,'rations',-1);
    if(thirsty)damage(a,draw('thirst',4),null);else resource(a,'water',-1);
   }
  }
 };
 const burn=(a:MortalV3Actor,turns:number,required:boolean)=>{if(required)resource(a,'oil',-turns);};
 const finishCombat=()=>{
  const e=state.encounter!;const next=nextEligible(state,e,e.turn+1);
  if(viable(state,e)&&next>=0){e.turn=next;e.turn_started_sequence=state.sequence+1;e.defended=e.defended.filter(id=>id!==e.order[next]);return;}
  advance(e.round_participants,6);
  if(!viable(state,e)){effect('encounter_end',null,e.id,0);state.encounter=null;return;}
  e.round=bounded(e.round+1,1000000);e.round_participants=e.order.filter(id=>eligible(state,e,id));e.turn=nextEligible(state,e,0);
  e.turn_started_sequence=state.sequence+1;
  if(e.turn<0)fail('CORRUPT_LEDGER','Mortal round has no eligible actor');e.defended=e.defended.filter(id=>id!==e.order[e.turn]);
 };
 const a=acting?actor(state,acting.id):null;
 if(combat||recovery){state.encounter!.turn=currentTurn;state.encounter!.defended=state.encounter!.defended.filter(id=>id!==a!.id);}
 switch(action.type){
 case 'travel':{
  const route=genesis.routes.find(r=>r.id===action.route_id)!;a!.location_id=a!.location_id===route.from?route.to:route.from;effect('travel',a!.id,a!.location_id,0);
  burn(a!,route.turns,route.requires_light);advance([a!.id],route.turns*600);
  if(a!.hp>0&&route.hazard){const total=draw('travel_hazard',20)+a!.abilities[route.hazard.ability];effect(total>route.hazard.target?'check_success':'check_failure',a!.id,route.id,total);if(total<=route.hazard.target)damage(a!,draw('travel_damage',route.hazard.damage_die),route.id);}break;
 }
 case 'explore':{
  const opportunity=state.opportunities.find(o=>o.id===action.opportunity_id)!;
  if(opportunity.kind==='search'){a!.discoveries.push(opportunity.id);effect('discovery',a!.id,opportunity.id,0);}
  burn(a!,opportunity.turns,opportunity.requires_light);advance([a!.id],opportunity.turns*600);
  if(a!.hp>0){
   const total=draw('explore',20)+a!.abilities[opportunity.ability],success=total>opportunity.target;effect(success?'check_success':'check_failure',a!.id,opportunity.id,total);
   if(success){opportunity.remaining--;effect('opportunity_spent',a!.id,opportunity.id,-1);resource(a!,opportunity.reward_resource,opportunity.reward_units,opportunity.id);}
   else if(opportunity.failure_damage_die)damage(a!,draw('explore_damage',opportunity.failure_damage_die),opportunity.id);
  }break;
 }
 case 'wait':advance([a!.id],action.turns*600);break;
 case 'rest':{
  const start=a!.active_seconds;advance([a!.id],28800);const prior=a!.hp;a!.hp=Math.min(a!.max_hp,a!.hp+draw('rest',8)+a!.abilities.constitution);a!.next_rest_at=bounded(start+DAY);effect('heal',a!.id,null,a!.hp-prior);effect('rest',a!.id,a!.location_id,28800);break;
 }
 case 'equip':{const i=item(state,action.item_id);i.equipped=action.equipped;effect(action.equipped?'equip':'unequip',a!.id,i.id,0);break;}
 case 'transfer_item':{
  const i=item(state,action.item_id);i.equipped=false;
  if(action.to_actor_id===null){i.owner_id=null;i.location_id=a!.location_id;}else{i.owner_id=action.to_actor_id;i.location_id=null;}
  effect('transfer_item',a!.id,i.id,0);break;
 }
 case 'pickup':case 'loot':{const i=item(state,action.item_id);i.owner_id=a!.id;i.location_id=null;i.equipped=false;effect(action.type,a!.id,i.id,0);break;}
 case 'give':resource(a!,action.resource,-action.units,action.to_actor_id);resource(actor(state,action.to_actor_id),action.resource,action.units,a!.id);break;
 case 'buy':{
  const stock=state.stocks.find(s=>s.id===action.stock_id)!,price=action.units*stock.price;
  resource(a!,'obols',-price,stock.id);resource(a!,stock.resource,action.units,stock.id);stock.remaining-=action.units;stock.treasury+=price;effect('stock_remaining',null,stock.id,-action.units);effect('treasury',null,stock.id,price);break;
 }
 case 'begin_encounter':{
  const first=draw('initiative',6)<=3,order=first?[...action.side_a,...action.side_b]:[...action.side_b,...action.side_a];
  state.encounter={id:action.encounter_id,location_id:actor(state,order[0]!).location_id,turn_started_sequence:state.sequence+1,side_a:[...action.side_a],side_b:[...action.side_b],order,turn:0,round:1,round_participants:[...order],escaped:[],defended:[],escape_allowed:action.escape_allowed};effect('begin_encounter',null,action.encounter_id,0);break;
 }
 case 'attack':{
  const target=actor(state,action.target_id),weapon=item(state,action.weapon_id);if(weapon.kind!=='weapon')fail('CORRUPT_LEDGER','Validated weapon changed');
  if(weapon.attack_ability==='wisdom')resource(a!,'ammo',-1,weapon.id);
  const armor=state.items.find(i=>i.owner_id===target.id&&i.kind==='armor'&&i.equipped)?.armor_defense??11;
  const total=draw('attack',20)+a!.abilities[weapon.attack_ability],defense=armor+(state.encounter!.defended.includes(target.id)?2:0);
  if(total>defense){const amount=draw('weapon_damage',weapon.damage_die);effect('hit',a!.id,target.id,amount);damage(target,amount,a!.id);}else effect('miss',a!.id,target.id,0);
  finishCombat();break;
 }
 case 'defend':state.encounter!.defended.push(a!.id);effect('defend',a!.id,state.encounter!.id,2);finishCombat();break;
 case 'retreat':state.encounter!.escaped.push(a!.id);effect('retreat',a!.id,state.encounter!.id,0);finishCombat();break;
 case 'pass':effect('pass',a!.id,state.encounter!.id,0);finishCombat();break;
 case 'recover_encounter':{
  const e=state.encounter!;
  if(action.resolution==='pass'){effect('referee_pass',a!.id,e.id,0);finishCombat();}
  else{effect('referee_close',null,e.id,0);advance(e.round_participants,6);state.encounter=null;}
  break;
 }
 }
 state.sequence++;assertMortalV3Contract('State',state);return {state,draws,effects};
}
