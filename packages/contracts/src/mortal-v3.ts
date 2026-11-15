/** Versioned mortal wire validation; authentication and event verification are separate. */
import {types as nodeTypes} from 'node:util';
import {createPublicKey} from 'node:crypto';
import {Ajv2020} from 'ajv/dist/2020.js';
import legacy from '../../../SYSTEMS/argo-v1.schema.json' with {type:'json'};
import definition from '../../../SYSTEMS/mortal-v3/mortal.schema.json' with {type:'json'};
import {assertScope,canonical,fail} from './index.ts';
import type {Scope} from './generated.ts';
import type {MortalV3ContractMap,MortalV3Genesis,MortalV3Actor,MortalV3Item,MortalV3Command,MortalV3State,MortalV3Event,MortalV3ActorView} from './mortal-v3-types.ts';

function invalid(message:string):never{return fail('INVALID_CONTRACT',message);}
function freeze<T>(value:T):T{
 if(value!==null&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;
}
export const mortalV3Schema=freeze(definition);
const ajv=new Ajv2020({strict:true,allErrors:true});ajv.addSchema(legacy);ajv.addSchema(mortalV3Schema);
const validators=new Map(Object.keys(mortalV3Schema.$defs).map(name=>[name,ajv.compile({$ref:mortalV3Schema.$id+'#/$defs/'+name})]));

/** Inspect data before reading any caller field. Does not authenticate or clone it. */
export function assertMortalV3Data(value:unknown):void{
 const active=new Set<object>();let entries=0;
 const visit=(value:unknown,depth:number):void=>{
  if(depth>32||++entries>100000)invalid('MortalV3 data exceeds its structural bound');
  if(value===null||typeof value==='string'||typeof value==='boolean')return;
  if(typeof value==='number'){if(!Number.isSafeInteger(value)||Object.is(value,-0))invalid('MortalV3 numbers must be canonical safe integers');return;}
  if(typeof value!=='object')invalid('MortalV3 data must contain only JSON values');
  if(nodeTypes.isProxy(value))invalid('MortalV3 data cannot contain a proxy');
  if(active.has(value))invalid('MortalV3 data cannot contain a cycle');
  const array=Array.isArray(value),prototype=Object.getPrototypeOf(value);
  if(array?prototype!==Array.prototype:prototype!==Object.prototype&&prototype!==null)invalid('MortalV3 data requires plain objects and arrays');
  const keys=Reflect.ownKeys(value);
  if(keys.length>100000-entries||keys.some(key=>typeof key!=='string'))invalid('MortalV3 data has too many properties or symbols');
  const descriptors=Object.getOwnPropertyDescriptors(value);active.add(value);
  try{
   if(array){
    const length=descriptors.length;
    if(!length||!('value'in length)||!Number.isSafeInteger(length.value)||length.value<0||keys.length!==length.value+1)invalid('MortalV3 arrays must be dense and undecorated');
    for(let i=0;i<length.value;i++){
     const item=descriptors[String(i)];if(!item||!item.enumerable||!('value'in item))invalid('MortalV3 array entry is active or missing');visit(item.value,depth+1);
    }
   }else for(const key of keys as string[]){
    const item=descriptors[key];
    if(['__proto__','prototype','constructor'].includes(key)||!item||!item.enumerable||!('value'in item))invalid('MortalV3 object contains an unsafe property');
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
function equalScope(a:Scope,b:Scope):void{if(canonical(a)!==canonical(b))invalid('MortalV3 nested scopes differ');}
function unique(values:readonly string[],label:string):Set<string>{
 const result=new Set(values);if(result.size!==values.length)invalid('Duplicate mortal '+label);return result;
}
function known(ids:Set<string>,id:string,label:string):void{if(!ids.has(id))invalid('Unknown mortal '+label);}
function roster(sideA:string[],sideB:string[]):Set<string>{
 unique(sideA,'side A actor');unique(sideB,'side B actor');return unique([...sideA,...sideB],'encounter actor');
}
function actorsAndItems(actors:MortalV3Actor[],items:MortalV3Item[]):Set<string>{
 const actorIds=unique(actors.map(a=>a.id),'actor'),itemIds=unique(items.map(i=>i.id),'item');
 for(const id of itemIds)if(actorIds.has(id))invalid('MortalV3 actor and item identities overlap');
 for(const actor of actors)if(actor.hp>actor.max_hp)invalid('MortalV3 HP exceeds maximum');
 const equipped=new Set<string>();
 for(const item of items){
  if(item.owner_id!==null)known(actorIds,item.owner_id,'item owner');
  if(item.owner_id!==null&&item.equipped&&(item.kind==='weapon'||item.kind==='armor')){
   const key=item.owner_id+':'+item.kind;if(equipped.has(key))invalid('Actor has duplicate equipped '+item.kind);equipped.add(key);
  }
 }
 return actorIds;
}
function genesis(value:MortalV3Genesis):void{
 const actorIds=actorsAndItems(value.actors,value.items),locations=unique(value.locations.map(l=>l.id),'location');
 unique(value.routes.map(r=>r.id),'route');unique(value.opportunities.map(o=>o.id),'opportunity');unique(value.stocks.map(s=>s.id),'stock');
 if(actorIds.has(value.referee_id))invalid('Referee identity cannot be an actor');
 const pem=value.authority_public_key.trim();
 if(!/^-----BEGIN PUBLIC KEY-----\r?\n[A-Za-z0-9+/=\r\n]+-----END PUBLIC KEY-----$/.test(pem))invalid('Authority key must contain only public-key PEM');
 try{const key=createPublicKey(pem);if(key.type!=='public'||key.asymmetricKeyType!=='ed25519')invalid('MortalV3 authority requires Ed25519');}catch{invalid('Invalid mortal Ed25519 public key');}
 for(const actor of value.actors){
  known(locations,actor.location_id,'actor location');
  if(actor.hp<=0||actor.active_seconds!==0||actor.fed_until!==0||actor.next_rest_at!==0||actor.discoveries.length)invalid('MortalV3 genesis actor is not initial');
  const r=actor.resources;
  const used=value.items.filter(item=>item.owner_id===actor.id).reduce((sum,item)=>sum+item.slots,0)+r.rations+r.water+Math.ceil(r.oil/18)+Math.ceil(r.obols/100)+Math.ceil(r.ammo/20);
  if(used>actor.abilities.constitution+10)invalid('MortalV3 genesis actor exceeds carrying capacity');
 }
 for(const item of value.items)if(item.location_id!==null)known(locations,item.location_id,'ground item location');
 for(const route of value.routes){known(locations,route.from,'route origin');known(locations,route.to,'route destination');if(route.from===route.to)invalid('MortalV3 route endpoints must differ');}
 for(const opportunity of value.opportunities)known(locations,opportunity.location_id,'opportunity location');
 for(const stock of value.stocks)known(locations,stock.location_id,'stock location');
}
function command(value:MortalV3Command):void{
 scope(value.scope);
 if(value.causation_id!==null&&value.causation_id!==value.expected.head)invalid('MortalV3 causation must identify the current expected head');
 if(value.action.type==='begin_encounter'||value.action.type==='recover_encounter'){
  if(value.actor_id!==null)invalid('Referee encounter command cannot impersonate an actor');
  if(value.action.type==='begin_encounter')roster(value.action.side_a,value.action.side_b);
  else if(value.action.turn_started_sequence>value.expected.sequence)invalid('Recovery turn token exceeds its expected prefix');
 }else if(value.actor_id===null)invalid('MortalV3 action requires a direct actor identity');
}
function state(value:MortalV3State):void{
 const actorIds=actorsAndItems(value.actors,value.items);
 const opportunities=unique(value.opportunities.map(o=>o.id),'opportunity');unique(value.stocks.map(s=>s.id),'stock');
 if(value.sequence===0&&(value.head!==value.genesis_hash||value.world_time!==0||value.rng_counter!==0||value.encounter!==null))invalid('Initial mortal cursor differs from genesis');
 for(const actor of value.actors){
  if(actor.active_seconds>value.world_time)invalid('Actor active time exceeds world time');
  for(const id of actor.discoveries){known(opportunities,id,'discovered opportunity');if(value.opportunities.find(o=>o.id===id)!.kind!=='search')invalid('MortalV3 discoveries must identify search opportunities');}
 }
 if(value.encounter!==null){
  const e=value.encounter,participants=roster(e.side_a,e.side_b);
  for(const id of participants){
   known(actorIds,id,'encounter participant');
   if(value.actors.find(actor=>actor.id===id)!.location_id!==e.location_id)invalid('Encounter roster is outside its fixed site');
  }
  if(e.turn_started_sequence>value.sequence)invalid('Encounter turn token exceeds its recorded prefix');
  if(e.order.length!==participants.size)invalid('MortalV3 turn order must cover the roster');
  for(const id of e.order)known(participants,id,'turn-order actor');
  if(e.turn>=e.order.length)invalid('MortalV3 encounter turn is outside its order');
  const acting=e.order[e.turn]!;
  if(e.escaped.includes(acting)||value.actors.find(actor=>actor.id===acting)!.hp<=0)invalid('Encounter current actor is inactive');
  for(const id of [...e.round_participants,...e.escaped,...e.defended])known(participants,id,'encounter marker actor');
 }
}
function signature(value:string):void{
 const bytes=Buffer.from(value,'base64');if(bytes.length!==64||bytes.toString('base64')!==value)invalid('MortalV3 signature must be canonical Ed25519 bytes');
}
function event(value:MortalV3Event):void{
 command(value.command);scope(value.principal.scope);equalScope(value.scope,value.command.scope);equalScope(value.scope,value.principal.scope);
 if(value.sequence!==value.command.expected.sequence+1||value.previous_hash!==value.command.expected.head)invalid('MortalV3 event order differs from its command');
 if(value.sequence===1&&value.previous_hash!==value.genesis_hash)invalid('First mortal event must reference its genesis');
 if(value.command.actor_id!==value.principal.actor_id||(['begin_encounter','recover_encounter'].includes(value.command.action.type))!==(value.principal.role==='referee'))invalid('MortalV3 event requester differs from command role');
 for(let i=0;i<value.draws.length;i++){
  const draw=value.draws[i]!;
  if(draw.value>draw.sides||(i>0&&draw.index!==value.draws[i-1]!.index+1))invalid('MortalV3 random records have invalid values or ordering');
 }
 signature(value.signature);
}
function actorView(value:MortalV3ActorView):void{
 const self=value.self;if(self.hp>self.max_hp||self.active_seconds>value.world_time)invalid('Invalid mortal self state');
 if(value.location.id!==self.location_id)invalid('MortalV3 actor view location differs');
 unique(value.items.map(item=>item.id),'view item');unique(value.routes.map(route=>route.id),'view route');
 for(const item of value.items)if(item.owner_id!==self.id||item.location_id!==null)invalid('MortalV3 actor view discloses another inventory');
 for(const route of value.routes)if(route.from===route.to||(route.from!==self.location_id&&route.to!==self.location_id))invalid('MortalV3 actor view contains a nonadjacent route');
 if(value.activity_lock!==null&&value.activity_lock.location_id!==self.location_id)invalid('Activity lock is outside the viewer location');
 if(value.encounter!==null){
  if(value.activity_lock===null||value.activity_lock.reason!=='roster'||value.activity_lock.encounter_id!==value.encounter.id)invalid('Visible encounter requires the matching roster activity lock');
  const e=value.encounter,ids=unique(e.participants.map(p=>p.id),'visible encounter actor');known(ids,e.acting_id,'acting actor');
  const own=e.participants.find(p=>p.id===self.id),acting=e.participants.find(p=>p.id===e.acting_id)!;
  if(!own||own.escaped||e.your_turn!==(e.acting_id===self.id)||acting.escaped||acting.condition!=='standing')invalid('MortalV3 visible encounter does not bind the viewer/turn');
  if(own.condition!==(self.hp>0?'standing':self.hp===0?'unconscious':'dead'))invalid('MortalV3 visible health differs from self');
  if(!e.participants.some(p=>p.side==='a')||!e.participants.some(p=>p.side==='b'))invalid('Visible encounter must retain both sides');
 }
}

export function assertMortalV3Contract<K extends keyof MortalV3ContractMap>(name:K,value:unknown):asserts value is MortalV3ContractMap[K]{
 assertMortalV3Data(value);
 const validate=validators.get(name);if(!validate||!validate(value))invalid('Invalid mortal '+name+' contract');
 const record=value as MortalV3ContractMap[keyof MortalV3ContractMap];scope(record.scope);
 switch(name){
 case 'Genesis':genesis(value as MortalV3Genesis);break;
 case 'Command':command(value as MortalV3Command);break;
 case 'State':state(value as MortalV3State);break;
 case 'Event':event(value as MortalV3Event);break;
 case 'Receipt':{
  const receipt=value as MortalV3ContractMap['Receipt'];signature(receipt.signature);
  if(receipt.cursor.sequence<1||receipt.cursor.head!==receipt.event_hash)invalid('MortalV3 receipt cursor differs from its event');break;
 }
 case 'ActorView':actorView(value as MortalV3ActorView);break;
 }
}
export function assertMortalV3Genesis(value:unknown):asserts value is MortalV3Genesis{assertMortalV3Contract('Genesis',value);}
