import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {Ajv2020} from 'ajv/dist/2020.js';
import {ArgoError} from '../packages/contracts/src/index.ts';
import type {MortalGenesis,MortalCommand,MortalPrincipal,MortalReceipt} from '../packages/contracts/src/mortal-types.ts';

const location=new URL('../packages/contracts/src/mortal.ts',import.meta.url);
async function api(){return import(location.href) as Promise<{assertMortalContract:(name:string,value:unknown)=>void;assertMortalGenesis:(value:unknown)=>void;assertMortalData:(value:unknown)=>void;mortalSchema:any}>;}
const keys=generateKeyPairSync('ed25519');
const scope={tenant_id:'tenant',rights_lane:'homebrew' as const,workspace_id:'workspace',workspace_tenant_id:'tenant:homebrew:workspace',campaign_id:'campaign',world_id:'mortal_world',branch_id:'main'};
const digest='a'.repeat(64);
function genesis():MortalGenesis{
 const actor=(id:string,kind:'player'|'npc')=>({id,name:id,controller_id:'auth_'+id,kind,location_id:'harbor',hp:6,max_hp:6,abilities:{strength:2,dexterity:2,constitution:3,intelligence:1,wisdom:2,charisma:1},resources:{rations:2,water:2,oil:1,obols:0,ammo:0},active_seconds:0,fed_until:0,next_rest_at:0,discoveries:[]});
 return {version:'mortal-rules/0.2.0',scope:structuredClone(scope),pack_hash:digest,variant:'legend',seed:'b'.repeat(64),authority_key_id:'authority',authority_public_key:keys.publicKey.export({format:'pem',type:'spki'}).toString(),referee_id:'host_referee',world_time:0,
  actors:[actor('hero','player'),actor('guard','npc')],
  items:[{id:'spear',name:'Spear',kind:'weapon',owner_id:'hero',location_id:null,slots:1,equipped:true,damage_die:6,attack_ability:'strength',armor_defense:0,tool:null}],
  locations:[{id:'harbor',name:'Harbor',safe_rest:true},{id:'hills',name:'Hills',safe_rest:false}],
  routes:[{id:'hill_road',from:'harbor',to:'hills',turns:2,requires_light:false,hazard:null}],
  opportunities:[{id:'olives',location_id:'hills',kind:'forage',ability:'wisdom',target:15,turns:1,requires_light:false,remaining:3,reward_resource:'rations',reward_units:1,failure_damage_die:0}],
  stocks:[{id:'water_seller',location_id:'harbor',resource:'water',price:2,remaining:5,treasury:0}]};
}
const principal=():MortalPrincipal=>({scope:structuredClone(scope),principal_id:'auth_hero',role:'player',actor_id:'hero'});
const command=():MortalCommand=>({version:'mortal-rules/0.2.0',scope:structuredClone(scope),request_id:'request_1',actor_id:'hero',expected:{sequence:0,head:digest},causation_id:null,action:{type:'travel',route_id:'hill_road'}});
function refuse(run:()=>void){assert.throws(run,(error:unknown)=>error instanceof ArgoError&&error.code==='INVALID_CONTRACT');}

test('mortal genesis validates independent passive data and preserves its bytes',async()=>{
 const m=await api(),value=genesis(),before=JSON.stringify(value);m.assertMortalGenesis(value);m.assertMortalContract('Genesis',value);assert.equal(JSON.stringify(value),before);
 const nullProto=Object.assign(Object.create(null),value);m.assertMortalGenesis(nullProto);
 assert.ok(Object.isFrozen(m.mortalSchema));assert.ok(Object.isFrozen(m.mortalSchema.$defs.Genesis));
});
test('mortal genesis refuses noninitial health, activity and unsafe identity or resource values',async()=>{
 const m=await api();
 const changes:Array<(g:any)=>void>=[g=>{g.authoritative=false;},g=>{g.world_time=1;},g=>{g.actors[0].hp=0;},g=>{g.actors[0].hp=7;},g=>{g.actors[0].max_hp=101;},g=>{g.actors[0].active_seconds=1;},g=>{g.actors[0].fed_until=1;},g=>{g.actors[0].next_rest_at=1;},g=>{g.actors[0].discoveries=['olives'];},g=>{g.actors[0].abilities.strength=11;},g=>{g.actors[0].resources.water=1000001;},g=>{g.actors[0].id='constructor';},g=>{g.actors[0].id='hero\n';},g=>{g.scope.tenant_id='prototype';g.scope.workspace_tenant_id='prototype:homebrew:workspace';},g=>{g.scope.workspace_tenant_id='foreign';},g=>{g.referee_id='hero';},g=>{g.seed='B'.repeat(64);},g=>{g.pack_hash='x'.repeat(64);}];
 for(const change of changes){const value=genesis();change(value);refuse(()=>m.assertMortalGenesis(value));}
});
test('mortal genesis requires public-only Ed25519 keys',async()=>{
 const m=await api();
 for(const publicKey of [keys.privateKey.export({format:'pem',type:'pkcs8'}).toString(),keys.publicKey.export({format:'pem',type:'spki'}).toString()+keys.privateKey.export({format:'pem',type:'pkcs8'}).toString(),'not a key',generateKeyPairSync('ec',{namedCurve:'prime256v1'}).publicKey.export({format:'pem',type:'spki'}).toString()])refuse(()=>m.assertMortalGenesis({...genesis(),authority_public_key:publicKey}));
});
test('mortal genesis retains explicit private world variant without adding it to actor views',async()=>{
 const m=await api();
 for(const variant of ['genuine','counterfeit','legend'])m.assertMortalGenesis({...genesis(),variant});
 const missing:any=genesis();delete missing.variant;refuse(()=>m.assertMortalGenesis(missing));
 refuse(()=>m.assertMortalGenesis({...genesis(),variant:'reroll'}));
 const g=genesis(),{controller_id:_,kind:__,...self}=g.actors[0]!;
 const view={version:g.version,scope:g.scope,cursor:{sequence:0,head:digest},world_time:0,self,items:g.items,location:g.locations[0],routes:g.routes,encounter:null};
 m.assertMortalContract('ActorView',view);refuse(()=>m.assertMortalContract('ActorView',{...view,variant:'legend'}));
});
test('mortal genesis rejects dangling and duplicate identities before authority initialization',async()=>{
 const m=await api();
 for(const change of [
  (g:any)=>g.actors.push(structuredClone(g.actors[0])),(g:any)=>g.items.push(structuredClone(g.items[0])),(g:any)=>g.locations.push(structuredClone(g.locations[0])),
  (g:any)=>{g.items[0].id='hero';},(g:any)=>{g.actors[0].location_id='missing';},(g:any)=>{g.items[0].owner_id='missing';},
  (g:any)=>{g.items[0].owner_id=null;g.items[0].equipped=false;g.items[0].location_id='missing';},
  (g:any)=>{g.routes[0].from='missing';},(g:any)=>{g.routes[0].to='harbor';},(g:any)=>{g.opportunities[0].location_id='missing';},(g:any)=>{g.stocks[0].location_id='missing';},
  (g:any)=>g.routes.push(structuredClone(g.routes[0])),(g:any)=>g.opportunities.push(structuredClone(g.opportunities[0])),(g:any)=>g.stocks.push(structuredClone(g.stocks[0])),
 ]){const value=genesis();change(value);refuse(()=>m.assertMortalGenesis(value));}
});
test('mortal equipment has one placement and mechanically consistent item kind',async()=>{
 const m=await api();
 for(const patch of [{location_id:'harbor'},{owner_id:null},{owner_id:null,location_id:'harbor'},{attack_ability:null},{damage_die:0},{armor_defense:12},{tool:'lamp'},{kind:'loot'},{kind:'armor',damage_die:0,attack_ability:null,armor_defense:11}]){const value=genesis();Object.assign(value.items[0]!,patch);refuse(()=>m.assertMortalGenesis(value));}
 const grounded=genesis();Object.assign(grounded.items[0]!,{owner_id:null,location_id:'harbor',equipped:false});m.assertMortalGenesis(grounded);
 const duplicate=genesis();duplicate.items.push({...duplicate.items[0]!,id:'second_spear'});refuse(()=>m.assertMortalGenesis(duplicate));
 for(const kind of ['tool','loot']){const bad=genesis();Object.assign(bad.items[0]!,{kind,damage_die:0,attack_ability:null,equipped:true});refuse(()=>m.assertMortalGenesis(bad));}
});
test('initial capacity counts resource bundles once and rejects a single excess slot',async()=>{
 const m=await api(),fits=genesis();fits.actors[0]!.resources={rations:3,water:3,oil:19,obols:101,ammo:21};
 // 1 spear +3 rations +3 water +2 oil bundles +2 coin bundles +2 ammo bundles =13.
 m.assertMortalGenesis(fits);
 fits.actors[0]!.resources.rations=4;refuse(()=>m.assertMortalGenesis(fits));
});
test('passive mortal inspection refuses active and noncanonical data without triggering it',async()=>{
 const m=await api();let touched=0;
 const accessor=genesis();Object.defineProperty(accessor,'seed',{enumerable:true,get(){touched++;return 'b'.repeat(64);}});
 const proxy=new Proxy(genesis(),{getPrototypeOf(){touched++;return Object.prototype;}});
 for(const value of [accessor,proxy,new Date(),{x:NaN},{x:-0},{x:1.5},{x:9007199254740992},{x:undefined},Object.assign([1],{extra:2}),[,,1],Object.defineProperty({},'hidden',{value:1}),{[Symbol('x')]:1}])refuse(()=>m.assertMortalData(value));
 const cyclic:any={};cyclic.self=cyclic;refuse(()=>m.assertMortalData(cyclic));
 let deep:any={};for(let i=0;i<34;i++)deep={next:deep};refuse(()=>m.assertMortalData(deep));
 refuse(()=>m.assertMortalData(Array(100001).fill(null)));assert.equal(touched,0);
});
test('commands carry closed intents, bounded participant rosters and exact role identities',async()=>{
 const m=await api();m.assertMortalContract('Principal',principal());m.assertMortalContract('Command',command());
 for(const action of [{type:'rest'},{type:'wait',turns:24},{type:'equip',item_id:'spear',equipped:false},{type:'transfer_item',item_id:'spear',to_actor_id:null},{type:'pickup',item_id:'spear'},{type:'loot',item_id:'spear'},{type:'give',to_actor_id:'guard',resource:'water',units:100},{type:'buy',stock_id:'water_seller',units:1},{type:'attack',target_id:'guard',weapon_id:'spear'},{type:'defend'},{type:'retreat'},{type:'pass'}])m.assertMortalContract('Command',{...command(),action});
 const encounter={...command(),actor_id:null,action:{type:'begin_encounter',encounter_id:'fight',side_a:['hero'],side_b:['guard'],escape_allowed:true}};m.assertMortalContract('Command',encounter);
 for(const value of [{...principal(),role:'referee'},{...principal(),actor_id:null}])refuse(()=>m.assertMortalContract('Principal',value));
 for(const value of [{...command(),actor_id:null},{...encounter,actor_id:'hero'},{...command(),action:{type:'attack',target_id:'guard',weapon_id:'spear',damage:10}},{...command(),action:{type:'wait',turns:25}},{...command(),action:{type:'give',to_actor_id:'guard',resource:'water',units:101}},{...encounter,action:{...encounter.action,side_b:['hero']}},{...encounter,action:{...encounter.action,side_a:[]}}, {...command(),expected:{sequence:1000001,head:digest}}, {...command(),causation_id:'b'.repeat(64)}])refuse(()=>m.assertMortalContract('Command',value));
});
test('state and event contracts bind scopes, cursors, round rosters and bounded random records',async()=>{
 const m=await api(),g=genesis();
 const state={version:g.version,scope:g.scope,genesis_hash:digest,sequence:0,head:digest,world_time:0,rng_counter:0,actors:g.actors,items:g.items,opportunities:g.opportunities,stocks:g.stocks,encounter:null};m.assertMortalContract('State',state);
 const encounter={id:'fight',side_a:['hero'],side_b:['guard'],order:['hero','guard'],turn:0,round:1,round_participants:['hero','guard'],escaped:[],defended:[],escape_allowed:true};m.assertMortalContract('State',{...state,encounter});
 for(const patch of [{round_participants:['hero','hero']},{round_participants:['missing']},{order:['hero','hero']},{turn:2},{escaped:['missing']}])refuse(()=>m.assertMortalContract('State',{...state,encounter:{...encounter,...patch}}));
 const event={version:g.version,scope:g.scope,genesis_hash:digest,sequence:1,previous_hash:digest,command:command(),principal:principal(),before_hash:digest,after_hash:digest,draws:[{index:0,purpose:'attack',sides:20,value:1}],effects:[],signature:Buffer.alloc(64).toString('base64'),hash:digest};m.assertMortalContract('Event',event);
 refuse(()=>m.assertMortalContract('Event',{...event,draws:[{index:0,purpose:'attack',sides:6,value:7}]}));
 refuse(()=>m.assertMortalContract('Event',{...event,principal:{...principal(),scope:{...scope,world_id:'other'}}}));
 refuse(()=>m.assertMortalContract('Event',{...event,sequence:2}));
});
test('receipts retain public verification identity and reject legacy unbound shapes',async()=>{
 const m=await api();
 const receipt:MortalReceipt={version:'mortal-rules/0.2.0',scope:structuredClone(scope),genesis_hash:digest,authority_key_id:'authority',signature:Buffer.alloc(64).toString('base64'),request_id:'request_1',request_hash:digest,event_hash:digest,cursor:{sequence:1,head:digest},state_hash:digest,effects:[]};
 m.assertMortalContract('Receipt',receipt);
 for(const key of ['genesis_hash','authority_key_id','signature','scope','request_hash']){const bad:any={...receipt};delete bad[key];refuse(()=>m.assertMortalContract('Receipt',bad));}
 refuse(()=>m.assertMortalContract('Receipt',{...receipt,cursor:{sequence:1,head:'b'.repeat(64)}}));
 refuse(()=>m.assertMortalContract('Receipt',{...receipt,signature:'AA=='}));
});
test('actor views admit only own stores and equipment with bounded visible encounter facts',async()=>{
 const m=await api(),g=genesis(),{controller_id:_,kind:__,...self}=g.actors[0]!;
 const view={version:g.version,scope:g.scope,cursor:{sequence:0,head:digest},world_time:0,self,items:g.items,location:g.locations[0],routes:g.routes,encounter:null};m.assertMortalContract('ActorView',view);
 for(const patch of [{seed:g.seed},{draws:[]},{actors:g.actors},{self:{...self,controller_id:'auth_hero'}},{items:[{...g.items[0]!,owner_id:'guard'}]},{location:g.locations[1]}])refuse(()=>m.assertMortalContract('ActorView',{...view,...patch}));
 const encounter={id:'fight',round:1,acting_id:'hero',your_turn:true,escape_allowed:true,participants:[{id:'hero',side:'a',condition:'standing',escaped:false},{id:'guard',side:'b',condition:'standing',escaped:false}]};m.assertMortalContract('ActorView',{...view,encounter});
 refuse(()=>m.assertMortalContract('ActorView',{...view,encounter:{...encounter,your_turn:false}}));
 refuse(()=>m.assertMortalContract('ActorView',{...view,encounter:{...encounter,participants:[{...encounter.participants[0],hp:6},encounter.participants[1]]}}));
});
test('mortal schema meta-validation and interface freeze pin all shared source files',async()=>{
 const m=await api(),legacy=JSON.parse(await readFile(new URL('../SYSTEMS/argo-v1.schema.json',import.meta.url),'utf8'));
 const ajv=new Ajv2020({strict:true,allErrors:true});ajv.addSchema(legacy);assert.equal(ajv.validateSchema(m.mortalSchema),true);ajv.addSchema(m.mortalSchema);
 for(const name of ['Genesis','Principal','Command','State','Event','Receipt','ActorView'])ajv.compile({$ref:m.mortalSchema.$id+'#/$defs/'+name});
 const freeze=JSON.parse(await readFile(new URL('../SYSTEMS/mortal-v2/FREEZE.json',import.meta.url),'utf8'));
 assert.equal(freeze.profile_version,'mortal-rules/0.2.0');
 assert.deepEqual(Object.keys(freeze.files).sort(),['SYSTEMS/mortal-v2/CONTRACT.md','SYSTEMS/mortal-v2/mortal.schema.json','packages/contracts/src/mortal-types.ts'].sort());
 for(const [path,digest] of Object.entries(freeze.files))assert.equal(createHash('sha256').update(await readFile(new URL('../'+path,import.meta.url))).digest('hex'),digest,path);
});
