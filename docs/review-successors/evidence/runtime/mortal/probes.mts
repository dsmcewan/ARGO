import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,createHash} from 'node:crypto';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const root=process.env.ARGO_MORTAL_REVIEW_ROOT;
if(!root)throw Error('Set ARGO_MORTAL_REVIEW_ROOT to the immutable candidate checkout');
const load=(path:string)=>import(pathToFileURL(resolve(root,path)).href);
const v3=await load('packages/ledger/src/mortal-v3/index.ts');
const v2=await load('packages/ledger/src/mortal/index.ts');
const {canonical,hash}=await load('packages/contracts/src/index.ts');
const keys=generateKeyPairSync('ed25519');
const scope={tenant_id:'review',rights_lane:'homebrew',workspace_id:'review',workspace_tenant_id:'review:homebrew:review',campaign_id:'campaign',world_id:'independent_mortal',branch_id:'main'};
function actor(id:string,location_id='harbor',kind='player'){
 return {id,name:id,controller_id:`auth_${id}`,kind,location_id,hp:30,max_hp:30,abilities:{strength:2,dexterity:2,constitution:2,intelligence:2,wisdom:2,charisma:2},resources:{rations:2,water:2,oil:6,obols:20,ammo:20},active_seconds:0,fed_until:0,next_rest_at:0,discoveries:[]};
}
function item(id:string,owner_id:string|null,location_id:string|null=null){return {id,name:id,kind:'weapon',owner_id,location_id,slots:1,equipped:owner_id!==null,damage_die:6,attack_ability:'strength',armor_defense:0,tool:null};}
function genesis(){
 return {version:'mortal-rules/0.3.0',scope:structuredClone(scope),pack_hash:'cd'.repeat(32),variant:'legend',seed:'ab'.repeat(32),authority_key_id:'review_key',authority_public_key:keys.publicKey.export({type:'spki',format:'pem'}).toString(),referee_id:'review_referee',world_time:0,
 actors:[actor('hero'),actor('ally'),actor('raider','harbor','npc'),actor('foe_two','harbor','npc'),actor('bystander'),actor('remote','ruin'),actor('trader','ruin')],
 items:[item('hero_spear','hero'),item('ally_spear','ally'),item('raider_club','raider'),item('foe_two_club','foe_two'),item('remote_spear','remote'),item('site_ground',null,'harbor'),item('remote_ground',null,'ruin')],
 locations:[{id:'harbor',name:'Harbor',safe_rest:true},{id:'ruin',name:'Ruin',safe_rest:true},{id:'grove',name:'Grove',safe_rest:true}],
 routes:[{id:'site_road',from:'harbor',to:'ruin',turns:1,requires_light:false,hazard:null},{id:'remote_road',from:'ruin',to:'grove',turns:1,requires_light:false,hazard:{ability:'wisdom',target:30,damage_die:4}}],
 opportunities:[{id:'site_forage',location_id:'harbor',kind:'forage',ability:'wisdom',target:0,turns:1,requires_light:false,remaining:2,reward_resource:'obols',reward_units:1,failure_damage_die:0},{id:'remote_forage',location_id:'ruin',kind:'forage',ability:'wisdom',target:0,turns:1,requires_light:false,remaining:2,reward_resource:'obols',reward_units:1,failure_damage_die:0}],
 stocks:[{id:'site_food',location_id:'harbor',resource:'rations',price:2,remaining:10,treasury:0},{id:'remote_food',location_id:'ruin',resource:'rations',price:2,remaining:10,treasury:0}]};
}
function principal(g:any,id='hero'){
 if(id==='referee')return {scope:structuredClone(g.scope),principal_id:g.referee_id,role:'referee',actor_id:null};
 const who=g.actors.find((a:any)=>a.id===id);assert(who);return {scope:structuredClone(g.scope),principal_id:who.controller_id,role:who.kind,actor_id:who.id};
}
function command(s:any,action:any,id='hero',request_id=`request_${s.sequence+1}`){return {version:s.version,scope:structuredClone(s.scope),request_id,actor_id:id==='referee'?null:id,expected:{sequence:s.sequence,head:s.head},causation_id:s.head,action};}
function recovery(s:any,resolution='pass',reason='host_timeout'){assert(s.encounter);return {type:'recover_encounter',encounter_id:s.encounter.id,turn_started_sequence:s.encounter.turn_started_sequence,resolution,reason};}
function sim(g=genesis()){
 let state=v3.initialMortalV3State(g);const events:any[]=[];
 const commit=(action:any,id='hero',requestId?:string)=>{const before=canonical(state),c=command(state,action,id,requestId),result=v3.createMortalV3Event(g,state,c,principal(g,id),keys.privateKey);assert.equal(canonical(state),before,'resolution mutated its accepted input');state=result.state;events.push(result.event);assert.equal(canonical(v3.replayMortalV3(g,events)),canonical(state),'signed replay differs');return result;};
 const refuse=(action:any,id='hero',auth=principal(g,id))=>{const before=canonical(state);assert.throws(()=>v3.createMortalV3Event(g,state,command(state,action,id),auth,keys.privateKey));assert.equal(canonical(state),before);};
 return {g,events,commit,refuse,get state(){return state;}};
}
function begin(w:any,a=['hero'],b=['raider'],escape_allowed=true){return w.commit({type:'begin_encounter',encounter_id:'battle',side_a:a,side_b:b,escape_allowed},'referee');}
function who(s:any,id:string){const found=s.actors.find((a:any)=>a.id===id);assert(found);return found;}
function current(s:any){return s.encounter.order[s.encounter.turn];}
function view(w:any,id:string){return v3.viewMortalV3Actor(w.g,w.state,principal(w.g,id));}
function passTo(w:any,id:string){let tries=0;while(current(w.state)!==id){assert(++tries<=8);w.commit({type:'pass'},current(w.state));}}
const digest=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');

// Every oracle below is based on accepted signed transitions, not a forged state.
test('remote hazard changes global time/RNG without advancing encounter clocks, defense or turn token',()=>{
 const w=sim();begin(w);const before=structuredClone(w.state),first=current(w.state);
 const remote=w.commit({type:'travel',route_id:'remote_road'},'remote');
 assert.equal(w.state.world_time,600);assert.deepEqual(w.state.encounter,before.encounter);
 assert.deepEqual(who(w.state,'hero'),who(before,'hero'));assert.deepEqual(who(w.state,'raider'),who(before,'raider'));
 assert.equal(who(w.state,'remote').active_seconds,600);assert.equal(who(w.state,'remote').location_id,'grove');
 assert.deepEqual(remote.event.draws.map((d:any)=>d.purpose),['travel_hazard','travel_damage']);assert.equal(w.state.rng_counter,before.rng_counter+2);
 const pass=w.commit(recovery(w.state),'referee');assert.equal(w.state.world_time,600);assert.equal(w.state.encounter.turn_started_sequence,pass.event.sequence);assert.notEqual(current(w.state),first);
 assert(pass.event.effects.some((e:any)=>e.kind==='referee_pass'&&e.actor_id===first));assert.equal(pass.event.command.actor_id,null);assert.equal(pass.event.principal.role,'referee');
 w.commit(recovery(w.state),'referee');assert.equal(w.state.world_time,606);assert.equal(who(w.state,'hero').active_seconds,6);assert.equal(who(w.state,'raider').active_seconds,6);assert.equal(who(w.state,'remote').active_seconds,600);
 assert.equal(w.state.rng_counter,before.rng_counter+2,'ordinary provisioned pass settlement consumed extra RNG');
});

test('all ordinary remote dependency paths preserve the paused encounter and roster resources',()=>{
 const w=sim();begin(w);const encounter=structuredClone(w.state.encounter),roster=structuredClone(w.state.actors.filter((a:any)=>['hero','raider'].includes(a.id)));
 for(const action of [{type:'equip',item_id:'remote_spear',equipped:false},{type:'equip',item_id:'remote_spear',equipped:true},{type:'pickup',item_id:'remote_ground'},{type:'buy',stock_id:'remote_food',units:1},{type:'give',to_actor_id:'trader',resource:'water',units:1},{type:'transfer_item',item_id:'remote_ground',to_actor_id:'trader'},{type:'explore',opportunity_id:'remote_forage'},{type:'wait',turns:1},{type:'rest'}]){
  w.commit(action,'remote');assert.deepEqual(w.state.encounter,encounter);assert.deepEqual(w.state.actors.filter((a:any)=>['hero','raider'].includes(a.id)),roster);
 }
 const remote=view(w,'remote');assert.equal(remote.encounter,null);assert.equal(remote.activity_lock,null);
 const json=JSON.stringify(remote);for(const hidden of ['controller_id','referee_id','round_participants','turn_started_sequence','review_referee',w.g.seed])assert(!json.includes(hidden),hidden);
 assert(remote.items.every((i:any)=>i.owner_id==='remote'));
});

test('escaped roster and site bystanders remain locked; scoped views explain only their own lock',()=>{
 const w=sim();begin(w,['hero','ally'],['raider']);passTo(w,'hero');w.commit({type:'retreat'},'hero');assert(w.state.encounter);
 const escaped=view(w,'hero');assert.equal(escaped.encounter,null);assert.deepEqual(escaped.activity_lock,{encounter_id:'battle',location_id:'harbor',reason:'roster'});
 const local=view(w,'bystander');assert.equal(local.encounter,null);assert.deepEqual(local.activity_lock,{encounter_id:'battle',location_id:'harbor',reason:'site'});
 assert.equal(view(w,'remote').activity_lock,null);
 for(const id of ['hero','bystander'])for(const action of [{type:'wait',turns:1},{type:'rest'},{type:'travel',route_id:'site_road'},{type:'pickup',item_id:'site_ground'},{type:'buy',stock_id:'site_food',units:1},{type:'explore',opportunity_id:'site_forage'},{type:'give',to_actor_id:'ally',resource:'water',units:1}])w.refuse(action,id);
 w.refuse({type:'equip',item_id:'hero_spear',equipped:false},'hero');w.refuse({type:'transfer_item',item_id:'hero_spear',to_actor_id:null},'hero');
 for(const action of [{type:'travel',route_id:'site_road'},{type:'transfer_item',item_id:'remote_spear',to_actor_id:'hero'},{type:'give',to_actor_id:'hero',resource:'water',units:1},{type:'pickup',item_id:'site_ground'},{type:'buy',stock_id:'site_food',units:1},{type:'explore',opportunity_id:'site_forage'}])w.refuse(action,'remote');
 w.commit(recovery(w.state,'close'),'referee');assert.equal(view(w,'hero').activity_lock,null);assert.equal(view(w,'bystander').activity_lock,null);w.commit({type:'wait',turns:1},'bystander');
});

test('a dead roster owner and their possessions stay protected until encounter closure',()=>{
 let selected:any;
 for(let seed=1;seed<=32;seed++){
  const g=genesis();g.seed=seed.toString(16).padStart(64,'0');who(g,'hero').abilities.strength=10;who(g,'raider').hp=1;who(g,'raider').max_hp=1;
  const w=sim(g);begin(w,['hero','ally'],['raider','foe_two']);passTo(w,'hero');w.commit({type:'attack',target_id:'raider',weapon_id:'hero_spear'},'hero');
  if(who(w.state,'raider').hp<0&&w.state.encounter){selected=w;break;}
 }
 assert(selected,'deterministic seed fixtures did not produce a continuing encounter with a corpse');const w=selected;
 assert.equal(view(w,'raider').activity_lock.reason,'roster');
 w.refuse({type:'loot',item_id:'raider_club'},'bystander');w.refuse({type:'loot',item_id:'raider_club'},'remote');
 const before=structuredClone(w.state.items.find((i:any)=>i.id==='raider_club'));w.commit(recovery(w.state,'close'),'referee');assert.deepEqual(w.state.items.find((i:any)=>i.id==='raider_club'),before);
 w.commit({type:'loot',item_id:'raider_club'},'bystander');assert.equal(w.state.items.find((i:any)=>i.id==='raider_club').owner_id,'bystander');
});

test('referee identity and waiting-turn token cannot be replaced by a fresh cursor or timeout label',()=>{
 const w=sim();begin(w);const token=w.state.encounter.turn_started_sequence,requested=recovery(w.state,'close');
 w.refuse(requested,'referee',{...principal(w.g,'referee'),principal_id:'auth_hero'});
 w.refuse(requested,'referee',{...principal(w.g,'referee'),scope:{...scope,world_id:'foreign'}});
 w.refuse(requested,'hero');
 w.commit({type:'wait',turns:1},'remote');assert.equal(w.state.encounter.turn_started_sequence,token);
 w.commit(recovery(w.state),'referee');assert.notEqual(w.state.encounter.turn_started_sequence,token);
 w.refuse({...requested,turn_started_sequence:token},'referee');w.refuse({...recovery(w.state,'close'),encounter_id:'other'},'referee');
 w.commit(recovery(w.state,'close'),'referee');w.refuse(requested,'referee');
 begin(w);assert.notEqual(w.state.encounter.turn_started_sequence,token);w.refuse(requested,'referee');
});

test('immediate administrative close pays exactly one round and simultaneous missing needs',()=>{
 const g=genesis();who(g,'hero').hp=1;who(g,'hero').max_hp=1;who(g,'hero').resources.rations=0;who(g,'hero').resources.water=0;
 const w=sim(g);begin(w,['hero'],['raider'],false);const before=structuredClone(w.state),closed=w.commit(recovery(w.state,'close'),'referee');
 assert.equal(w.state.encounter,null);assert.equal(w.state.world_time,6);assert.equal(who(w.state,'hero').active_seconds,6);assert.equal(who(w.state,'raider').active_seconds,6);
 assert.deepEqual(closed.event.draws.map((d:any)=>d.purpose),['hunger','thirst']);assert.equal(who(w.state,'hero').hp,1-closed.event.draws.reduce((n:number,d:any)=>n+d.value,0));
 assert(who(w.state,'hero').hp<0);assert.equal(w.state.rng_counter,before.rng_counter+2);assert(closed.event.effects.some((e:any)=>e.kind==='referee_close'));
 assert.deepEqual(w.state.items,before.items);for(const id of ['ally','remote','trader','bystander','foe_two'])assert.deepEqual(who(w.state,id),who(before,id));
 for(const e of closed.event.effects)assert(!['attack','loot','heal','refund','victory','travel'].includes(e.kind));
});

test('retreat pays its original round once; a later close charges only the next pending roster',()=>{
 const g=genesis();who(g,'hero').hp=1;who(g,'hero').max_hp=1;who(g,'hero').resources.rations=0;who(g,'hero').resources.water=0;
 const w=sim(g);begin(w,['hero','ally'],['raider']);passTo(w,'hero');w.commit({type:'retreat'},'hero');
 let turns=0;while(w.state.encounter.round===1){assert(++turns<=4);w.commit(recovery(w.state),'referee');}
 assert.equal(w.state.world_time,6);assert.equal(who(w.state,'hero').active_seconds,6);assert(who(w.state,'hero').hp<0);assert(!w.state.encounter.round_participants.includes('hero'));
 const before=structuredClone(w.state);const closed=w.commit(recovery(w.state,'close'),'referee');assert.equal(w.state.world_time,12);assert.equal(w.state.encounter,null);
 assert.deepEqual(who(w.state,'hero'),who(before,'hero'));assert.equal(who(w.state,'ally').active_seconds,12);assert.equal(who(w.state,'raider').active_seconds,12);assert.equal(closed.event.draws.length,0);assert.equal(w.state.rng_counter,before.rng_counter);assert.deepEqual(w.state.items,before.items);
});

async function stored(t:any,run:(f:any)=>Promise<void>){
 const directory=await mkdtemp(join(tmpdir(),'argo-independent-mortal-v3-')),g=genesis(),path=join(directory,'mortal.sqlite');const handles:any[]=[];
 t.after(async()=>{for(const h of handles)await h.close().catch(()=>{});await rm(directory,{recursive:true,force:true});});
 const open=async(extra={})=>{const h=await v3.openMortalV3Ledger({path,genesis:g,privateKey:keys.privateKey,...extra});handles.push(h);return h;};
 const ledger=await open();await run({directory,path,g,ledger,open});
}
async function submit(g:any,ledger:any,action:any,id='hero',requestId?:string){return ledger.submit(command(await ledger.snapshot(),action,id,requestId),principal(g,id));}

test('two SQLite handles reconcile exact recovery once and preserve the result across restart',async t=>stored(t,async f=>{
 await submit(f.g,f.ledger,{type:'begin_encounter',encounter_id:'battle',side_a:['hero'],side_b:['raider'],escape_allowed:false},'referee');
 const other=await f.open(),state=await f.ledger.snapshot(),c=command(state,recovery(state,'close'),'referee','one_close');
 const [a,b]=await Promise.all([f.ledger.submit(c,principal(f.g,'referee')),other.submit(c,principal(f.g,'referee'))]);assert.deepEqual(a,b);
 const final=await f.ledger.snapshot();assert.equal(final.sequence,2);assert.equal(final.world_time,6);assert.equal(final.encounter,null);
 const history=await f.ledger.events({after:0,limit:1000});assert.equal(history.length,2);assert.deepEqual(v3.replayMortalV3(f.g,history),final);
 final.actors[0].resources.water=999;assert.notEqual((await other.snapshot()).actors[0].resources.water,999);
 await f.ledger.close();await f.ledger.close();await other.close();const resumed=await f.open({expectedHead:a.cursor});assert.deepEqual(await resumed.submit(c,principal(f.g,'referee')),a);assert.equal((await resumed.snapshot()).world_time,6);
 await assert.rejects(f.open({expectedHead:{sequence:2,head:'f'.repeat(64)}}));
 v3.verifyMortalV3Receipt(a,{scope:f.g.scope,genesis_hash:hash(f.g),authority_key_id:f.g.authority_key_id,authority_public_key:f.g.authority_public_key});assert.throws(()=>v2.verifyMortalReceipt(a,{scope:f.g.scope,genesis_hash:hash(f.g),authority_key_id:f.g.authority_key_id,authority_public_key:f.g.authority_public_key}));
}));

test('a normal-turn/recovery race has one winner and rejects the stale competing command',async t=>stored(t,async f=>{
 await submit(f.g,f.ledger,{type:'begin_encounter',encounter_id:'battle',side_a:['hero'],side_b:['raider'],escape_allowed:true},'referee');
 const second=await f.open(),state=await f.ledger.snapshot(),id=current(state),pass=command(state,{type:'pass'},id,'actor_turn'),close=command(state,recovery(state,'close'),'referee','referee_close');
 const results=await Promise.allSettled([f.ledger.submit(pass,principal(f.g,id)),second.submit(close,principal(f.g,'referee'))]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);
 const failure=results.find(r=>r.status==='rejected') as PromiseRejectedResult;assert.equal(failure.reason.code,'CONFLICT');
 let latest=await f.ledger.snapshot();assert.equal(latest.sequence,2);assert([0,6].includes(latest.world_time));
 if(latest.encounter)await submit(f.g,f.ledger,recovery(latest,'close'),'referee','finish_close');latest=await f.ledger.snapshot();assert.equal(latest.world_time,6);
 assert.deepEqual(v3.replayMortalV3(f.g,await f.ledger.events({after:0,limit:1000})),latest);
}));

test('v2/v3 database mixing is rejected without changing either committed database',async t=>stored(t,async f=>{
 await submit(f.g,f.ledger,{type:'wait',turns:1},'remote');await f.ledger.close();
 const v3bytes=digest(await readFile(f.path)),oldGenesis={...f.g,version:'mortal-rules/0.2.0'};
 await assert.rejects(v2.openMortalLedger({path:f.path,genesis:oldGenesis,privateKey:keys.privateKey}));assert.equal(digest(await readFile(f.path)),v3bytes);
 const oldPath=join(f.directory,'old.sqlite'),old=await v2.openMortalLedger({path:oldPath,genesis:oldGenesis,privateKey:keys.privateKey});await old.close();const oldBytes=digest(await readFile(oldPath));
 await assert.rejects(v3.openMortalV3Ledger({path:oldPath,genesis:f.g,privateKey:keys.privateKey}));assert.equal(digest(await readFile(oldPath)),oldBytes);
 const reopened=await f.open();assert.equal((await reopened.snapshot()).sequence,1);
}));
