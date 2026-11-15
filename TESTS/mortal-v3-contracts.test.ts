import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {Ajv2020} from 'ajv/dist/2020.js';
import {ArgoError,hash} from '../packages/contracts/src/index.ts';
import {assertMortalContract} from '../packages/contracts/src/mortal.ts';
import {mortalGenesis} from './mortal-fixtures.ts';

type V3Api=typeof import('../packages/contracts/src/mortal-v3.ts');
async function api():Promise<V3Api>{
 const result=await import(new URL('../packages/contracts/src/mortal-v3.ts',import.meta.url).href).catch(error=>{
  if(error.code==='ERR_MODULE_NOT_FOUND')return {};throw error;
 });
 assert.equal(typeof result.assertMortalV3Contract,'function','The explicit v3 contract API must exist before runtime work');return result;
}
const digest='a'.repeat(64),signature=Buffer.alloc(64).toString('base64');
const genesis=()=>({...mortalGenesis(),version:'mortal-rules/0.3.0' as const});
const state=()=>{const g=genesis();return {version:g.version,scope:g.scope,genesis_hash:hash(g),sequence:1,head:digest,world_time:0,rng_counter:1,actors:g.actors,items:g.items,opportunities:g.opportunities,stocks:g.stocks,encounter:{id:'fight',location_id:'harbor',turn_started_sequence:1,side_a:['hero'],side_b:['raider'],order:['hero','raider'],turn:0,round:1,round_participants:['hero','raider'],escaped:[],defended:[],escape_allowed:false}};};
const command=()=>({version:'mortal-rules/0.3.0',scope:genesis().scope,request_id:'recover',actor_id:null,expected:{sequence:1,head:digest},causation_id:digest,action:{type:'recover_encounter',encounter_id:'fight',turn_started_sequence:1,resolution:'pass',reason:'host_timeout'}});
const principal=()=>({scope:genesis().scope,principal_id:'host',role:'referee',actor_id:null});
const event=()=>({version:'mortal-rules/0.3.0',scope:genesis().scope,genesis_hash:hash(genesis()),sequence:2,previous_hash:digest,command:command(),principal:principal(),before_hash:digest,after_hash:digest,draws:[],effects:[],signature,hash:digest});
const receipt=()=>({version:'mortal-rules/0.3.0',scope:genesis().scope,genesis_hash:hash(genesis()),authority_key_id:'mortal_key',signature,request_id:'recover',request_hash:digest,event_hash:digest,cursor:{sequence:2,head:digest},state_hash:digest,effects:[]});
function view(){const g=genesis(),{controller_id:_,kind:__,...self}=g.actors[0]!;return {version:g.version,scope:g.scope,cursor:{sequence:0,head:hash(g)},world_time:0,self,items:g.items.filter(i=>i.owner_id==='hero'),location:g.locations[0],routes:g.routes,encounter:null,activity_lock:null};}
function refuse(run:()=>void){assert.throws(run,(error:unknown)=>error instanceof ArgoError&&error.code==='INVALID_CONTRACT');}

test('v3 explicitly accepts fresh genesis and refuses v2 or continuation state as genesis',async()=>{
 const m:V3Api=await api(),g=genesis(),before=JSON.stringify(g);m.assertMortalV3Genesis(g);m.assertMortalV3Contract('Genesis',g);assert.equal(JSON.stringify(g),before);
 m.assertMortalV3Genesis(Object.assign(Object.create(null),g));
 for(const patch of [{version:'mortal-rules/0.2.0'},{world_time:1},{origin:{profile:'mortal-rules/0.2.0'}},{seed:'A'.repeat(64)}])refuse(()=>m.assertMortalV3Genesis({...g,...patch}));
 for(const patch of [{hp:0},{hp:7},{active_seconds:1},{fed_until:1},{next_rest_at:1},{discoveries:['cache']},{id:'constructor'}]){const bad=genesis();Object.assign(bad.actors[0]!,patch);refuse(()=>m.assertMortalV3Genesis(bad));}
 refuse(()=>assertMortalContract('Genesis',g));
});

test('v3 retains genesis identity, equipment, location and capacity admission constraints',async()=>{
 const m:V3Api=await api();
 for(const mutate of [(g:any)=>g.actors.push(g.actors[0]),(g:any)=>{g.items[0].owner_id='missing';},(g:any)=>{g.actors[0].location_id='missing';},(g:any)=>{g.referee_id='hero';},(g:any)=>{g.items[0].location_id='harbor';},(g:any)=>{g.actors[0].resources.water=100;},(g:any)=>{g.authority_public_key='not a key';},(g:any)=>{g.scope.workspace_tenant_id='other';}]){const g=genesis();mutate(g);refuse(()=>m.assertMortalV3Genesis(g));}
});

test('recovery intents require null actor identity and closed bounded turn and reason fields',async()=>{
 const m:V3Api=await api();for(const resolution of ['pass','close'])m.assertMortalV3Contract('Command',{...command(),action:{...command().action,resolution}});
 const base=command();for(const patch of [{actor_id:'hero'},{expected:{sequence:0,head:digest}},{causation_id:'b'.repeat(64)},{extra:true}])refuse(()=>m.assertMortalV3Contract('Command',{...base,...patch}));
 for(const patch of [{encounter_id:'constructor'},{turn_started_sequence:0},{turn_started_sequence:2},{turn_started_sequence:-0},{turn_started_sequence:1.5},{resolution:'attack'},{reason:''},{reason:' \n '},{reason:'x'.repeat(257)},{reason:null},{now:5000},{target_id:'hero'}])refuse(()=>m.assertMortalV3Contract('Command',{...base,action:{...base.action,...patch}}));
 m.assertMortalV3Contract('Command',{...base,action:{...base.action,reason:'🙂'.repeat(256)}});
 const absent:any=structuredClone(base);delete absent.action.turn_started_sequence;refuse(()=>m.assertMortalV3Contract('Command',absent));
 // Recovery can be syntactically well-formed while the expected prefix is newer than its turn token.
 m.assertMortalV3Contract('Command',{...base,expected:{sequence:10,head:digest}});
 refuse(()=>assertMortalContract('Command',{...base,version:'mortal-rules/0.2.0'}));
});

test('ordinary v3 command grammar preserves direct actor and encounter roster constraints',async()=>{
 const m:V3Api=await api();
 for(const action of [{type:'travel',route_id:'road'},{type:'wait',turns:1},{type:'pass'},{type:'rest'},{type:'give',to_actor_id:'companion',resource:'water',units:1}])m.assertMortalV3Contract('Command',{...command(),actor_id:'hero',action});
 refuse(()=>m.assertMortalV3Contract('Command',{...command(),action:{type:'pass'}}));
 const begin={...command(),action:{type:'begin_encounter',encounter_id:'fight',side_a:['hero'],side_b:['raider'],escape_allowed:true}};
 m.assertMortalV3Contract('Command',begin);
 for(const patch of [{actor_id:'hero'},{action:{...begin.action,side_b:['hero']}},{action:{...begin.action,location_id:'harbor'}}])refuse(()=>m.assertMortalV3Contract('Command',{...begin,...patch}));
});

test('v3 encounter state binds its site and positive turn token to the recorded prefix',async()=>{
 const m:V3Api=await api(),s=state();m.assertMortalV3Contract('State',s);m.assertMortalV3Contract('State',{...s,sequence:9});
 for(const patch of [{location_id:'ruin'},{location_id:'missing'},{turn_started_sequence:0},{turn_started_sequence:2},{order:['hero','hero']},{turn:2},{round_participants:['outsider']},{escaped:['hero']},{defended:['missing']}])refuse(()=>m.assertMortalV3Contract('State',{...s,encounter:{...s.encounter,...patch}}));
 const missing:any=structuredClone(s);delete missing.encounter.location_id;refuse(()=>m.assertMortalV3Contract('State',missing));
 const moved=state();moved.actors.find(a=>a.id==='raider')!.location_id='ruin';refuse(()=>m.assertMortalV3Contract('State',moved));
 const future=state();future.actors[0]!.active_seconds=1;refuse(()=>m.assertMortalV3Contract('State',future));
 const initial={...s,sequence:0,head:s.genesis_hash,rng_counter:0};refuse(()=>m.assertMortalV3Contract('State',initial));
 m.assertMortalV3Contract('State',{...initial,encounter:null});
});

test('recovery events retain referee provenance and reject role or nested version misbinding',async()=>{
 const m:V3Api=await api();m.assertMortalV3Contract('Principal',principal());m.assertMortalV3Contract('Event',event());
 for(const patch of [{role:'player'},{actor_id:'hero'}])refuse(()=>m.assertMortalV3Contract('Principal',{...principal(),...patch}));
 for(const mutate of [(e:any)=>{e.principal={...e.principal,role:'player',actor_id:'hero'};},(e:any)=>{e.command.actor_id='hero';},(e:any)=>{e.command.version='mortal-rules/0.2.0';},(e:any)=>{e.command.action={type:'pass'};},(e:any)=>{e.sequence=3;},(e:any)=>{e.principal.scope.world_id='other';},(e:any)=>{e.signature='AA==';}]){const e=event();mutate(e);refuse(()=>m.assertMortalV3Contract('Event',e));}
 // Shape validation does not assert that a referee was authenticated against genesis.
 m.assertMortalV3Contract('Principal',{...principal(),principal_id:'different_referee'});
});

test('v3 receipts and scoped views stay closed and cannot be accepted as v2',async()=>{
 const m:V3Api=await api(),r=receipt(),v=view();m.assertMortalV3Contract('Receipt',r);m.assertMortalV3Contract('ActorView',v);
 for(const patch of [{seed:'secret'},{actors:genesis().actors},{referee_reason:'host_timeout'},{variant:'legend'}])refuse(()=>m.assertMortalV3Contract('ActorView',{...v,...patch}));
 refuse(()=>m.assertMortalV3Contract('ActorView',{...v,items:genesis().items}));
 refuse(()=>m.assertMortalV3Contract('Receipt',{...r,cursor:{sequence:2,head:'b'.repeat(64)}}));
 for(const [name,value] of [['Receipt',r],['ActorView',v],['Event',event()],['State',state()],['Command',command()]] as const){refuse(()=>assertMortalContract(name,value));refuse(()=>m.assertMortalV3Contract(name,{...value,version:'mortal-rules/0.2.0'}));}
});


test('actor activity locks explain roster and local-site exclusion without disclosing the battle',async()=>{
 const m:V3Api=await api(),v=view();m.assertMortalV3Contract('ActorView',v);
 const lock={encounter_id:'fight',location_id:'harbor',reason:'roster'};
 // An escaped roster member retains a lock with no participant summary.
 m.assertMortalV3Contract('ActorView',{...v,activity_lock:lock});
 m.assertMortalV3Contract('ActorView',{...v,activity_lock:{...lock,reason:'site'}});
 for(const patch of [{location_id:'ruin'},{reason:'global'},{participant_ids:['hero','raider']},{timeout_ms:100}])refuse(()=>m.assertMortalV3Contract('ActorView',{...v,activity_lock:{...lock,...patch}}));
 const missing:any={...v};delete missing.activity_lock;refuse(()=>m.assertMortalV3Contract('ActorView',missing));
 const encounter={id:'fight',round:1,acting_id:'raider',your_turn:false,escape_allowed:false,participants:[{id:'hero',side:'a',condition:'standing',escaped:false},{id:'raider',side:'b',condition:'standing',escaped:false}]};
 m.assertMortalV3Contract('ActorView',{...v,encounter,activity_lock:lock});
 for(const activity_lock of [null,{...lock,reason:'site'},{...lock,encounter_id:'different'}])refuse(()=>m.assertMortalV3Contract('ActorView',{...v,encounter,activity_lock}));
});

test('v3 contract inspection rejects proxies, accessors and noncanonical data before execution',async()=>{
 const m:V3Api=await api();let touched=0;const active=Object.defineProperty(genesis(),'actors',{enumerable:true,get(){touched++;return [];}});
 const proxy=new Proxy(genesis(),{getPrototypeOf(){touched++;return Object.prototype;}}),cyclic:any={};cyclic.self=cyclic;
 for(const value of [active,proxy,cyclic,new Date(),{n:NaN},{n:-0},{n:1.5},[,,1],Object.assign([1],{extra:true}),Object.defineProperty({},'hidden',{value:1})])refuse(()=>m.assertMortalV3Data(value));
 refuse(()=>m.assertMortalV3Genesis(active));refuse(()=>m.assertMortalV3Contract('Command',proxy));assert.equal(touched,0);
});

test('v3 schema compiles independently and freeze preserves both versioned interfaces',async()=>{
 const m:V3Api=await api(),legacy=JSON.parse(await readFile(new URL('../SYSTEMS/argo-v1.schema.json',import.meta.url),'utf8'));
 const ajv=new Ajv2020({strict:true,allErrors:true});ajv.addSchema(legacy);assert.equal(ajv.validateSchema(m.mortalV3Schema),true);ajv.addSchema(m.mortalV3Schema);
 for(const name of ['Genesis','Command','Principal','State','Event','Receipt','ActorView'])ajv.compile({$ref:m.mortalV3Schema.$id+'#/$defs/'+name});
 assert.ok(Object.isFrozen(m.mortalV3Schema));assert.ok(Object.isFrozen(m.mortalV3Schema.$defs.Action_recover_encounter));
 for(const version of ['v2','v3']){
  const freeze=JSON.parse(await readFile(new URL(`../SYSTEMS/mortal-${version}/FREEZE.json`,import.meta.url),'utf8'));
  for(const [path,digest] of Object.entries(freeze.files))assert.equal(createHash('sha256').update(await readFile(new URL('../'+path,import.meta.url))).digest('hex'),digest,path);
  if(version==='v3'){assert.equal(freeze.profile_version,'mortal-rules/0.3.0');assert.deepEqual(Object.keys(freeze.files).sort(),['SYSTEMS/mortal-v3/CONTRACT.md','SYSTEMS/mortal-v3/mortal.schema.json','packages/contracts/src/mortal-v3-types.ts'].sort());}
 }
});
