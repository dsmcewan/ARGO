/** Versioned mortal wire validation; authentication and event verification are separate. */
import {types as nodeTypes} from 'node:util';
import {createPublicKey} from 'node:crypto';
import {Ajv2020} from 'ajv/dist/2020.js';
import legacy from '../../../SYSTEMS/argo-v1.schema.json' with {type:'json'};
import definition from '../../../SYSTEMS/mortal-v2/mortal.schema.json' with {type:'json'};
import {assertScope,canonical,fail} from './index.ts';
import type {Scope} from './generated.ts';
import type {MortalContractMap,MortalGenesis,MortalActor,MortalItem,MortalCommand,MortalState,MortalEvent,MortalActorView} from './mortal-types.ts';

function invalid(message:string):never{return fail('INVALID_CONTRACT',message);}
function freeze<T>(value:T):T{
 if(value!==null&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;
}
export const mortalSchema=freeze(definition);
const ajv=new Ajv2020({strict:true,allErrors:true});ajv.addSchema(legacy);ajv.addSchema(mortalSchema);
const validators=new Map(Object.keys(mortalSchema.$defs).map(name=>[name,ajv.compile({$ref:mortalSchema.$id+'#/$defs/'+name})]));

/** Inspect data before reading any caller field. Does not authenticate or clone it. */
export function assertMortalData(value:unknown):void{
 const active=new Set<object>();let entries=0;
 const visit=(value:unknown,depth:number):void=>{
  if(depth>32||++entries>100000)invalid('Mortal data exceeds its structural bound');
  if(value===null||typeof value==='string'||typeof value==='boolean')return;
  if(typeof value==='number'){if(!Number.isSafeInteger(value)||Object.is(value,-0))invalid('Mortal numbers must be canonical safe integers');return;}
  if(typeof value!=='object')invalid('Mortal data must contain only JSON values');
  if(nodeTypes.isProxy(value))invalid('Mortal data cannot contain a proxy');
  if(active.has(value))invalid('Mortal data cannot contain a cycle');
  const array=Array.isArray(value),prototype=Object.getPrototypeOf(value);
  if(array?prototype!==Array.prototype:prototype!==Object.prototype&&prototype!==null)invalid('Mortal data requires plain objects and arrays');
  const keys=Reflect.ownKeys(value);
  if(keys.length>100000-entries||keys.some(key=>typeof key!=='string'))invalid('Mortal data has too many properties or symbols');
  const descriptors=Object.getOwnPropertyDescriptors(value);active.add(value);
  try{
   if(array){
    const length=descriptors.length;
    if(!length||!('value'in length)||!Number.isSafeInteger(length.value)||length.value<0||keys.length!==length.value+1)invalid('Mortal arrays must be dense and undecorated');
    for(let i=0;i<length.value;i++){
     const item=descriptors[String(i)];if(!item||!item.enumerable||!('value'in item))invalid('Mortal array entry is active or missing');visit(item.value,depth+1);
    }
   }else for(const key of keys as string[]){
    const item=descriptors[key];
    if(['__proto__','prototype','constructor'].includes(key)||!item||!item.enumerable||!('value'in item))invalid('Mortal object contains an unsafe property');
    visit(item.value,depth+1);
   }
  }finally{active.delete(value);}
 };
 visit(value,0);
}
function safeId(value:string):void{
 if(!/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$(?![\s\S])/.test(value)||['__proto__','prototype','constructor'].includes(value))invalid('Unsafe mortal identity');
}
function scope(value:Scope):void{
 try{assertScope(value);}catch{invalid('Invalid mortal rights namespace');}
 for(const key of ['tenant_id','workspace_id','campaign_id','world_id','branch_id'] as const)safeId(value[key]);
}
function equalScope(a:Scope,b:Scope):void{if(canonical(a)!==canonical(b))invalid('Mortal nested scopes differ');}
function unique(values:readonly string[],label:string):Set<string>{
 const result=new Set(values);if(result.size!==values.length)invalid('Duplicate mortal '+label);return result;
}
function known(ids:Set<string>,id:string,label:string):void{if(!ids.has(id))invalid('Unknown mortal '+label);}
function roster(sideA:string[],sideB:string[]):Set<string>{
 unique(sideA,'side A actor');unique(sideB,'side B actor');return unique([...sideA,...sideB],'encounter actor');
}
function actorsAndItems(actors:MortalActor[],items:MortalItem[]):Set<string>{
 const actorIds=unique(actors.map(a=>a.id),'actor'),itemIds=unique(items.map(i=>i.id),'item');
 for(const id of itemIds)if(actorIds.has(id))invalid('Mortal actor and item identities overlap');
 for(const actor of actors)if(actor.hp>actor.max_hp)invalid('Mortal HP exceeds maximum');
 const equipped=new Set<string>();
 for(const item of items){
  if(item.owner_id!==null)known(actorIds,item.owner_id,'item owner');
  if(item.owner_id!==null&&item.equipped&&(item.kind==='weapon'||item.kind==='armor')){
   const key=item.owner_id+':'+item.kind;if(equipped.has(key))invalid('Actor has duplicate equipped '+item.kind);equipped.add(key);
  }
 }
 return actorIds;
}
function genesis(value:MortalGenesis):void{
 const actorIds=actorsAndItems(value.actors,value.items),locations=unique(value.locations.map(l=>l.id),'location');
 unique(value.routes.map(r=>r.id),'route');unique(value.opportunities.map(o=>o.id),'opportunity');unique(value.stocks.map(s=>s.id),'stock');
 if(actorIds.has(value.referee_id))invalid('Referee identity cannot be an actor');
 const pem=value.authority_public_key.trim();
 if(!/^-----BEGIN PUBLIC KEY-----\r?\n[A-Za-z0-9+/=\r\n]+-----END PUBLIC KEY-----$/.test(pem))invalid('Authority key must contain only public-key PEM');
 try{const key=createPublicKey(pem);if(key.type!=='public'||key.asymmetricKeyType!=='ed25519')invalid('Mortal authority requires Ed25519');}catch{invalid('Invalid mortal Ed25519 public key');}
 for(const actor of value.actors){
  known(locations,actor.location_id,'actor location');
  if(actor.hp<=0||actor.active_seconds!==0||actor.fed_until!==0||actor.next_rest_at!==0||actor.discoveries.length)invalid('Mortal genesis actor is not initial');
  const r=actor.resources;
  const used=value.items.filter(item=>item.owner_id===actor.id).reduce((sum,item)=>sum+item.slots,0)+r.rations+r.water+Math.ceil(r.oil/18)+Math.ceil(r.obols/100)+Math.ceil(r.ammo/20);
  if(used>actor.abilities.constitution+10)invalid('Mortal genesis actor exceeds carrying capacity');
 }
 for(const item of value.items)if(item.location_id!==null)known(locations,item.location_id,'ground item location');
 for(const route of value.routes){known(locations,route.from,'route origin');known(locations,route.to,'route destination');if(route.from===route.to)invalid('Mortal route endpoints must differ');}
 for(const opportunity of value.opportunities)known(locations,opportunity.location_id,'opportunity location');
 for(const stock of value.stocks)known(locations,stock.location_id,'stock location');
}
function command(value:MortalCommand):void{
 scope(value.scope);
 if(value.causation_id!==null&&value.causation_id!==value.expected.head)invalid('Mortal causation must identify the current expected head');
 if(value.action.type==='begin_encounter'){
  if(value.actor_id!==null)invalid('Referee encounter command cannot impersonate an actor');roster(value.action.side_a,value.action.side_b);
 }else if(value.actor_id===null)invalid('Mortal action requires a direct actor identity');
}
function state(value:MortalState):void{
 const actorIds=actorsAndItems(value.actors,value.items);
 const opportunities=unique(value.opportunities.map(o=>o.id),'opportunity');unique(value.stocks.map(s=>s.id),'stock');
 if(value.sequence===0&&(value.head!==value.genesis_hash||value.world_time!==0||value.rng_counter!==0))invalid('Initial mortal cursor differs from genesis');
 for(const actor of value.actors){
  if(actor.active_seconds>value.world_time)invalid('Actor active time exceeds world time');
  for(const id of actor.discoveries){known(opportunities,id,'discovered opportunity');if(value.opportunities.find(o=>o.id===id)!.kind!=='search')invalid('Mortal discoveries must identify search opportunities');}
 }
 if(value.encounter!==null){
  const e=value.encounter,participants=roster(e.side_a,e.side_b);
  for(const id of participants)known(actorIds,id,'encounter participant');
  if(e.order.length!==participants.size)invalid('Mortal turn order must cover the roster');
  for(const id of e.order)known(participants,id,'turn-order actor');
  if(e.turn>=e.order.length)invalid('Mortal encounter turn is outside its order');
  for(const id of [...e.round_participants,...e.escaped,...e.defended])known(participants,id,'encounter marker actor');
 }
}
function signature(value:string):void{
 const bytes=Buffer.from(value,'base64');if(bytes.length!==64||bytes.toString('base64')!==value)invalid('Mortal signature must be canonical Ed25519 bytes');
}
function event(value:MortalEvent):void{
 command(value.command);scope(value.principal.scope);equalScope(value.scope,value.command.scope);equalScope(value.scope,value.principal.scope);
 if(value.sequence!==value.command.expected.sequence+1||value.previous_hash!==value.command.expected.head)invalid('Mortal event order differs from its command');
 if(value.sequence===1&&value.previous_hash!==value.genesis_hash)invalid('First mortal event must reference its genesis');
 if(value.command.actor_id!==value.principal.actor_id||(value.command.action.type==='begin_encounter')!==(value.principal.role==='referee'))invalid('Mortal event requester differs from command role');
 for(let i=0;i<value.draws.length;i++){
  const draw=value.draws[i]!;
  if(draw.value>draw.sides||(i>0&&draw.index!==value.draws[i-1]!.index+1))invalid('Mortal random records have invalid values or ordering');
 }
 signature(value.signature);
}
function actorView(value:MortalActorView):void{
 const self=value.self;if(self.hp>self.max_hp||self.active_seconds>value.world_time)invalid('Invalid mortal self state');
 if(value.location.id!==self.location_id)invalid('Mortal actor view location differs');
 unique(value.items.map(item=>item.id),'view item');unique(value.routes.map(route=>route.id),'view route');
 for(const item of value.items)if(item.owner_id!==self.id||item.location_id!==null)invalid('Mortal actor view discloses another inventory');
 for(const route of value.routes)if(route.from===route.to||(route.from!==self.location_id&&route.to!==self.location_id))invalid('Mortal actor view contains a nonadjacent route');
 if(value.encounter!==null){
  const e=value.encounter,ids=unique(e.participants.map(p=>p.id),'visible encounter actor');known(ids,e.acting_id,'acting actor');
  const own=e.participants.find(p=>p.id===self.id),acting=e.participants.find(p=>p.id===e.acting_id)!;
  if(!own||own.escaped||e.your_turn!==(e.acting_id===self.id)||acting.escaped||acting.condition!=='standing')invalid('Mortal visible encounter does not bind the viewer/turn');
  if(own.condition!==(self.hp>0?'standing':self.hp===0?'unconscious':'dead'))invalid('Mortal visible health differs from self');
  if(!e.participants.some(p=>p.side==='a')||!e.participants.some(p=>p.side==='b'))invalid('Visible encounter must retain both sides');
 }
}

export function assertMortalContract<K extends keyof MortalContractMap>(name:K,value:unknown):asserts value is MortalContractMap[K]{
 assertMortalData(value);
 const validate=validators.get(name);if(!validate||!validate(value))invalid('Invalid mortal '+name+' contract');
 const record=value as MortalContractMap[keyof MortalContractMap];scope(record.scope);
 switch(name){
 case 'Genesis':genesis(value as MortalGenesis);break;
 case 'Command':command(value as MortalCommand);break;
 case 'State':state(value as MortalState);break;
 case 'Event':event(value as MortalEvent);break;
 case 'Receipt':{
  const receipt=value as MortalContractMap['Receipt'];signature(receipt.signature);
  if(receipt.cursor.sequence<1||receipt.cursor.head!==receipt.event_hash)invalid('Mortal receipt cursor differs from its event');break;
 }
 case 'ActorView':actorView(value as MortalActorView);break;
 }
}
export function assertMortalGenesis(value:unknown):asserts value is MortalGenesis{assertMortalContract('Genesis',value);}
