import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ArgoError,assertMortalContract,hash,canonical} from '../packages/contracts/src/index.ts';
import type {MortalGenesis,MortalState,MortalAction,MortalCommand,MortalResolution} from '../packages/contracts/src/index.ts';
import {mortalGenesis,mortalPrincipal,mortalCommand,mortalWeapon} from './mortal-fixtures.ts';
import * as rules from '../packages/ledger/src/mortal/rules.ts';
const reject=(fn:()=>unknown,code?:string)=>assert.throws(fn,e=>e instanceof ArgoError&&(!code||e.code===code));
const actor=(s:MortalState,id='hero')=>s.actors.find(a=>a.id===id)!;
function start(g=mortalGenesis()):MortalState{assert.equal(typeof rules.initialMortalState,'function');return rules.initialMortalState(g);}
function run(g:MortalGenesis,s:MortalState,action:MortalAction,id='hero'):MortalResolution{return rules.resolveMortal(g,s,mortalCommand(s,action,id),mortalPrincipal(g,id));}
function later(g:MortalGenesis,edit:(state:MortalState)=>void):MortalState{const s=start(g);s.sequence=1;s.head='de'.repeat(32);edit(s);return s;}

test('initial state binds the complete variant/genesis; hashing excludes only head',()=>{
 const g=mortalGenesis(),s=start(g);assert.equal(s.genesis_hash,hash(g));assert.equal(s.head,hash(g));assert.equal(s.sequence,0);assert.equal(s.rng_counter,0);
 assertMortalContract('State',s);assert.notEqual(s.actors,g.actors);assert.notEqual(s.items,g.items);
 const head={...s,sequence:1,head:'aa'.repeat(32)},other={...head,head:'bb'.repeat(32)};assert.equal(rules.mortalStateHash(head),rules.mortalStateHash(other));
 assert.notEqual(rules.mortalStateHash(head),rules.mortalStateHash({...head,world_time:1}));
 assert.notEqual(start({...g,variant:'genuine'}).genesis_hash,s.genesis_hash);
 reject(()=>start({...g,actors:g.actors.map(a=>({...a,hp:0}))}));
});
test('capacity counts items and exact consumable bundle ceilings',()=>{
 const g=mortalGenesis(),s=start(g);assert.deepEqual(rules.mortalCapacity(s,'hero'),{used:10,limit:12});
 const edge=later(g,s=>{actor(s).resources={rations:0,water:0,oil:19,obols:101,ammo:21};});
 assert.deepEqual(rules.mortalCapacity(edge,'hero'),{used:9,limit:12});reject(()=>rules.mortalCapacity(s,'missing'));
});
test('permissions, scope, stale heads and malformed active DTOs refuse without input mutation',()=>{
 const g=mortalGenesis(),s=start(g),c=mortalCommand(s,{type:'wait',turns:1}),p=mortalPrincipal(g);const before=canonical({g,s,c,p});
 reject(()=>rules.resolveMortal(g,s,c,{...p,principal_id:'wrong'}),'UNAUTHORIZED');
 reject(()=>rules.resolveMortal(g,s,c,{...p,role:'npc',actor_id:'hero'}),'UNAUTHORIZED');
 reject(()=>rules.resolveMortal(g,s,{...c,actor_id:'companion'},p),'UNAUTHORIZED');
 reject(()=>rules.resolveMortal(g,s,{...c,expected:{...c.expected,sequence:1}},p),'CONFLICT');
 reject(()=>rules.resolveMortal(g,s,{...c,scope:{...c.scope,world_id:'other'}},p));
 reject(()=>rules.resolveMortal(g,s,{...c,action:{type:'wait',turns:0}},p));
 let invoked=0;const active={...c};Object.defineProperty(active,'action',{enumerable:true,get(){invoked++;throw Error();}});reject(()=>rules.resolveMortal(g,s,active,p));
 reject(()=>rules.resolveMortal(g,s,new Proxy(c,{get(){invoked++;throw Error();}}),p));assert.equal(invoked,0);assert.equal(canonical({g,s,c,p}),before);
});
test('travel costs apply only to its actor, with prepaid food at strict active-period boundaries',()=>{
 const g=mortalGenesis(),s=start(g),r=run(g,s,{type:'travel',route_id:'road'});assert.equal(r.state.sequence,1);assert.equal(r.state.head,s.head);
 assert.equal(r.state.world_time,600);assert.equal(actor(r.state).location_id,'ruin');assert.equal(actor(r.state).active_seconds,600);assert.equal(actor(r.state).fed_until,86400);
 assert.equal(actor(r.state).resources.rations,1);assert.equal(actor(r.state).resources.water,1);assert.deepEqual(actor(r.state,'companion'),actor(s,'companion'));assert.equal(r.draws.length,0);
 const boundary=later(g,s=>{s.world_time=85800;actor(s).active_seconds=85800;actor(s).fed_until=86400;});
 const at=run(g,boundary,{type:'wait',turns:1}).state;assert.equal(actor(at).active_seconds,86400);assert.equal(actor(at).resources.rations,2);
 const beyond=run(g,at,{type:'wait',turns:1}).state;assert.equal(actor(beyond).fed_until,172800);assert.equal(actor(beyond).resources.rations,1);
});
test('light is preflighted and spent per turn; travel arrival persists when simultaneous needs kill before hazard',()=>{
 const g=mortalGenesis();g.routes[0]!.requires_light=true;g.routes[0]!.hazard={ability:'dexterity',target:15,damage_die:6};
 const s=start(g);const r=run(g,s,{type:'travel',route_id:'road'});assert.equal(actor(r.state).resources.oil,5);assert.deepEqual(r.draws.map((d:any)=>[d.index,d.purpose,d.sides,d.value]).slice(0,1),[[0,'travel_hazard',20,1]]);
 const starving=later(g,s=>{actor(s).hp=1;actor(s).resources.rations=0;actor(s).resources.water=0;});
 const death=run(g,starving,{type:'travel',route_id:'road'});assert.equal(actor(death.state).location_id,'ruin');assert.equal(actor(death.state).resources.oil,5);assert.equal(actor(death.state).hp,-3);
 assert.deepEqual(death.draws.map((d:any)=>[d.purpose,d.value]),[['hunger',3],['thirst',1]]);assert.equal(actor(death.state).fed_until,86400);assert.equal(death.state.world_time,600);
 const dark=later(g,s=>{actor(s).resources.oil=0;});const before=canonical(dark);reject(()=>run(g,dark,{type:'travel',route_id:'road'}));assert.equal(canonical(dark),before);
 const noKit=later(g,s=>{s.items.find(i=>i.id==='firekit')!.owner_id='companion';});reject(()=>run(g,noKit,{type:'travel',route_id:'road'}));
});
test('search attempts persist on failure or incapacity; finite forage rewards cannot exceed capacity',()=>{
 const g=mortalGenesis(),s=later(g,s=>{actor(s).location_id='ruin';});const r=run(g,s,{type:'explore',opportunity_id:'cache'});
 assert.deepEqual(r.draws.map((d:any)=>[d.purpose,d.value]),[['explore',2]]);assert.deepEqual(actor(r.state).discoveries,['cache']);assert.equal(r.state.opportunities[0]!.remaining,1);assert.equal(actor(r.state).resources.obols,20);
 reject(()=>run(g,r.state,{type:'explore',opportunity_id:'cache'}));
 const starve=later(g,s=>{actor(s).location_id='ruin';actor(s).hp=1;actor(s).resources.rations=0;actor(s).resources.water=0;});const gone=run(g,starve,{type:'explore',opportunity_id:'cache'});assert.deepEqual(actor(gone.state).discoveries,['cache']);assert.equal(gone.draws.length,2);
 const easy=mortalGenesis();easy.opportunities[1]!.target=0;const reward=run(easy,start(easy),{type:'explore',opportunity_id:'forage'});assert.equal(actor(reward.state).resources.rations,2);assert.equal(reward.state.opportunities[1]!.remaining,1);
 const full=later(easy,s=>{actor(s).resources.rations=4;});assert.equal(rules.mortalCapacity(full,'hero').used,12);reject(()=>run(easy,full,{type:'explore',opportunity_id:'forage'}));
 const depleted=later(easy,s=>{s.opportunities[1]!.remaining=0;});reject(()=>run(easy,depleted,{type:'explore',opportunity_id:'forage'}));
});
test('rest admits unconscious survivors, charges full coverage and uses only personal active cooldown',()=>{
 const g=mortalGenesis(),s=later(g,s=>{actor(s).hp=0;});const r=run(g,s,{type:'rest'});assert.equal(actor(r.state).hp,6);assert.deepEqual(r.draws.map((d:any)=>[d.purpose,d.value]),[['rest',6]]);assert.equal(actor(r.state).active_seconds,28800);assert.equal(actor(r.state).next_rest_at,86400);assert.equal(actor(r.state).resources.rations,1);
 reject(()=>run(g,r.state,{type:'rest'}));const changed=run(g,r.state,{type:'wait',turns:24},'companion').state;reject(()=>run(g,changed,{type:'rest'}));
 for(const change of [(s:MortalState)=>{actor(s).hp=-1;},(s:MortalState)=>{actor(s).location_id='ruin';},(s:MortalState)=>{actor(s).resources.water=0;}])reject(()=>run(g,later(g,change),{type:'rest'}));
 const crossing=later(g,s=>{s.world_time=72000;actor(s).active_seconds=72000;actor(s).fed_until=86400;actor(s).resources.rations=1;actor(s).resources.water=1;});const slept=run(g,crossing,{type:'rest'}).state;assert.equal(actor(slept).fed_until,172800);assert.equal(actor(slept).resources.rations,0);assert.equal(actor(slept).next_rest_at,158400);
});
test('all other actor commands refuse unconscious and dead controllers',()=>{
 const g=mortalGenesis();
 for(const hp of [0,-1]){
  const s=later(g,s=>{actor(s).hp=hp;});
  for(const action of [{type:'wait',turns:1},{type:'travel',route_id:'road'},{type:'equip',item_id:'spear',equipped:false},{type:'give',to_actor_id:'companion',resource:'obols',units:1},{type:'buy',stock_id:'food',units:1}] as MortalAction[])reject(()=>run(g,s,action));
 }
});
test('equipment, physical custody and corpse looting conserve actual items and clear equipment',()=>{
 const g=mortalGenesis(),s=start(g);const sent=run(g,s,{type:'transfer_item',item_id:'spear',to_actor_id:'companion'}).state;
 assert.equal(sent.items[0]!.owner_id,'companion');assert.equal(sent.items[0]!.equipped,false);reject(()=>run(g,sent,{type:'equip',item_id:'spear',equipped:true}));
 const armed=run(g,sent,{type:'equip',item_id:'spear',equipped:true},'companion').state;assert.equal(armed.items[0]!.equipped,true);
 const ground=run(g,armed,{type:'transfer_item',item_id:'spear',to_actor_id:null},'companion').state;assert.equal(ground.items[0]!.location_id,'harbor');assert.equal(ground.items[0]!.owner_id,null);
 const picked=run(g,ground,{type:'pickup',item_id:'spear'}).state;assert.equal(picked.items[0]!.owner_id,'hero');assert.equal(picked.items[0]!.equipped,false);
 reject(()=>run(g,picked,{type:'equip',item_id:'lamp',equipped:true}));reject(()=>run(g,picked,{type:'loot',item_id:'club'}));
 const corpse=later(g,s=>{actor(s,'raider').hp=-1;});assert.equal(run(g,corpse,{type:'loot',item_id:'club'}).state.items[1]!.owner_id,'hero');
 const unconscious=later(g,s=>{actor(s,'raider').hp=0;});reject(()=>run(g,unconscious,{type:'loot',item_id:'club'}));
 const far=later(g,s=>{actor(s,'companion').location_id='ruin';});reject(()=>run(g,far,{type:'transfer_item',item_id:'spear',to_actor_id:'companion'}));
});
test('resource transfers and finite purchases validate post-transaction capacity and conserve coin',()=>{
 const g=mortalGenesis(),s=start(g);const given=run(g,s,{type:'give',to_actor_id:'companion',resource:'obols',units:5}).state;assert.equal(actor(given).resources.obols,15);assert.equal(actor(given,'companion').resources.obols,25);
 const bought=run(g,s,{type:'buy',stock_id:'food',units:2}).state;assert.equal(actor(bought).resources.rations,4);assert.equal(actor(bought).resources.obols,16);assert.equal(bought.stocks[0]!.remaining,8);assert.equal(bought.stocks[0]!.treasury,4);
 reject(()=>run(g,s,{type:'buy',stock_id:'food',units:3}));reject(()=>run(g,s,{type:'give',to_actor_id:'companion',resource:'obols',units:21}));
 const dead=later(g,s=>{actor(s,'companion').hp=-1;});reject(()=>run(g,dead,{type:'give',to_actor_id:'companion',resource:'obols',units:1}));
 const fullTreasury=later(g,s=>{s.stocks[0]!.treasury=1000000;});reject(()=>run(g,fullTreasury,{type:'buy',stock_id:'food',units:1}));
 const coinsFreeSlot=later(g,s=>{actor(s).resources.rations=4;actor(s).resources.obols=2;});assert.equal(rules.mortalCapacity(coinsFreeSlot,'hero').used,12);
 const exchange=run(g,coinsFreeSlot,{type:'buy',stock_id:'food',units:1}).state;assert.equal(actor(exchange).resources.obols,0);assert.equal(actor(exchange).resources.rations,5);assert.equal(rules.mortalCapacity(exchange,'hero').used,12);
});
test('shared mutable host references cannot couple actors, genesis or returned state',()=>{
 const g=mortalGenesis();g.actors[1]!.resources=g.actors[0]!.resources;g.actors[1]!.abilities=g.actors[0]!.abilities;
 const initial=start(g);assert.notEqual(actor(initial).resources,actor(initial,'companion').resources);assert.notEqual(actor(initial).abilities,actor(initial,'companion').abilities);
 initial.actors[1]!.resources=initial.actors[0]!.resources;initial.actors[1]!.abilities=initial.actors[0]!.abilities;
 const before=canonical({g,initial}),result=run(g,initial,{type:'wait',turns:1}).state;
 assert.equal(actor(result).resources.rations,1);assert.equal(actor(result,'companion').resources.rations,2);assert.equal(canonical({g,initial}),before);
 actor(result).resources.water=0;actor(result).abilities.strength=9;
 assert.equal(actor(result,'companion').resources.water,2);assert.equal(actor(result,'companion').abilities.strength,2);assert.equal(canonical({g,initial}),before);
});
test('equipment replacement and encounter attacks cannot bypass ownership, live target, ammo or exit permissions',()=>{
 const g=mortalGenesis();const spare=mortalWeapon('spare','hero');spare.equipped=false;g.items.push(spare);let s=start(g);
 reject(()=>run(g,s,{type:'equip',item_id:'spare',equipped:true}));s=run(g,s,{type:'equip',item_id:'spear',equipped:false}).state;s=run(g,s,{type:'equip',item_id:'spare',equipped:true}).state;assert.equal(s.items.find(i=>i.id==='spare')!.equipped,true);
 s=run(g,s,{type:'begin_encounter',encounter_id:'closed',side_a:['raider'],side_b:['hero','companion'],escape_allowed:false},'host').state;
 reject(()=>run(g,s,{type:'attack',target_id:'companion',weapon_id:'spare'}));reject(()=>run(g,s,{type:'attack',target_id:'raider',weapon_id:'club'}));reject(()=>run(g,s,{type:'attack',target_id:'raider',weapon_id:'spear'}));reject(()=>run(g,s,{type:'retreat'}));
 const ranged=mortalGenesis();const weapon=ranged.items[0]!;if(weapon.kind==='weapon')weapon.attack_ability='wisdom';ranged.actors[0]!.resources.ammo=0;
 const encounter=run(ranged,start(ranged),{type:'begin_encounter',encounter_id:'dry',side_a:['raider'],side_b:['hero'],escape_allowed:true},'host').state;const before=canonical(encounter);reject(()=>run(ranged,encounter,{type:'attack',target_id:'raider',weapon_id:'spear'}));assert.equal(canonical(encounter),before);
 const remote=later(g,s=>{actor(s,'raider').location_id='ruin';});reject(()=>run(g,remote,{type:'begin_encounter',encounter_id:'remote',side_a:['hero'],side_b:['raider'],escape_allowed:true},'host'));
});
test('only the referee creates a co-located encounter; its fixed initiative and turn identity bind every action',()=>{
 const g=mortalGenesis(),s=start(g),action:MortalAction={type:'begin_encounter',encounter_id:'fight',side_a:['hero'],side_b:['raider'],escape_allowed:true};
 reject(()=>run(g,s,action));const r=run(g,s,action,'host');assert.deepEqual(r.draws,[{index:0,purpose:'initiative',sides:6,value:4}]);assert.deepEqual(r.state.encounter!.order,['raider','hero']);assert.deepEqual(r.state.encounter!.round_participants,['raider','hero']);
 assert.equal(r.state.world_time,0);reject(()=>run(g,r.state,{type:'attack',target_id:'raider',weapon_id:'spear'}));reject(()=>run(g,r.state,{type:'wait',turns:1}));reject(()=>run(g,r.state,action,'host'));
 const hit=run(g,r.state,{type:'attack',target_id:'hero',weapon_id:'club'},'raider');assert.equal(actor(hit.state).hp,1);assert.equal(hit.state.encounter!.turn,1);assert.equal(hit.state.world_time,0);assert.deepEqual(hit.draws.map((d:any)=>d.value),[17,5]);
 const end=run(g,hit.state,{type:'pass'});assert.equal(end.state.world_time,6);assert.equal(end.state.encounter!.round,2);assert.equal(end.state.encounter!.turn,0);assert.equal(end.draws.length,0);
});
test('defend expires at the next turn; strict ties miss and ranged ammunition is still spent',()=>{
 const g=mortalGenesis();g.actors.find(a=>a.id==='raider')!.abilities.wisdom=0;const club=g.items.find(i=>i.id==='club')!;if(club.kind==='weapon')club.attack_ability='wisdom';
 g.items.push({id:'cuirass',name:'Cuirass',kind:'armor',owner_id:'hero',location_id:null,slots:1,equipped:true,damage_die:0,attack_ability:null,armor_defense:15,tool:null});
 const encounter=run(g,start(g),{type:'begin_encounter',encounter_id:'tie',side_a:['raider'],side_b:['hero'],escape_allowed:true},'host').state;
 const defense=run(g,encounter,{type:'defend'}).state;assert.deepEqual(defense.encounter!.defended,['hero']);
 const shot=run(g,defense,{type:'attack',target_id:'hero',weapon_id:'club'},'raider');assert.equal(actor(shot.state).hp,6);assert.equal(actor(shot.state,'raider').resources.ammo,19);assert.deepEqual(shot.draws.map((d:any)=>d.value),[17]);assert.equal(shot.state.encounter!.defended.includes('hero'),false);
});
test('zero-HP and negative-HP attacks close a round once; dead participants skip food but keep elapsed participation',()=>{
 for(const [hp,result] of [[5,0],[4,-1]]){
  const g=mortalGenesis();g.actors[0]!.hp=hp!;
  const s=run(g,start(g),{type:'begin_encounter',encounter_id:'end',side_a:['hero'],side_b:['raider'],escape_allowed:true},'host').state;
  const r=run(g,s,{type:'attack',target_id:'hero',weapon_id:'club'},'raider');assert.equal(actor(r.state).hp,result);assert.equal(r.state.encounter,null);assert.equal(r.state.world_time,6);assert.equal(actor(r.state).active_seconds,6);assert.equal(actor(r.state).resources.rations,result!<0?2:1);
 }
});
test('retreat has no free retaliation and charges current-round escapees but never prior-round escapees',()=>{
 const g=mortalGenesis();g.items.push(mortalWeapon('companion_spear','companion'));
 let s=run(g,start(g),{type:'begin_encounter',encounter_id:'escape',side_a:['raider'],side_b:['hero','companion'],escape_allowed:true},'host').state;
 const exit=run(g,s,{type:'retreat'});s=exit.state;assert.equal(actor(s).hp,6);assert.equal(actor(s).location_id,'harbor');assert.equal(s.world_time,0);assert.equal(exit.draws.length,0);assert.ok(exit.effects.some((e:any)=>e.kind==='retreat'&&e.actor_id==='hero'&&e.subject_id==='escape'));
 s=run(g,s,{type:'pass'},'companion').state;s=run(g,s,{type:'pass'},'raider').state;assert.equal(actor(s).active_seconds,6);assert.equal(s.encounter!.round_participants.includes('hero'),false);
 s=run(g,s,{type:'pass'},'companion').state;s=run(g,s,{type:'pass'},'raider').state;assert.equal(s.world_time,12);assert.equal(actor(s).active_seconds,6);
 const finish=run(g,s,{type:'retreat'},'companion');assert.equal(finish.state.encounter,null);assert.equal(finish.state.world_time,18);assert.equal(actor(finish.state).active_seconds,6);assert.equal(actor(finish.state,'companion').active_seconds,18);
});
test('round starvation is simultaneous per actor and can end combat without recursively charging another round',()=>{
 const g=mortalGenesis();g.actors[0]!.hp=1;g.actors[0]!.resources.rations=0;g.actors[0]!.resources.water=0;
 let s=run(g,start(g),{type:'begin_encounter',encounter_id:'hungry',side_a:['hero'],side_b:['raider'],escape_allowed:true},'host').state;
 s=run(g,s,{type:'pass'},'raider').state;const r=run(g,s,{type:'pass'});assert.equal(r.state.world_time,6);assert.equal(r.state.encounter,null);assert.equal(r.draws.filter((d:any)=>d.purpose==='hunger'||d.purpose==='thirst').length,2);assert.ok(actor(r.state).hp<0);
});
test('request IDs cannot grind RNG and all rejected proposals preserve state and counter',()=>{
 const g=mortalGenesis(),s=start(g),action:MortalAction={type:'begin_encounter',encounter_id:'fixed',side_a:['hero'],side_b:['raider'],escape_allowed:true};
 const first=mortalCommand(s,action,'host','first'),second={...first,request_id:'another'};
 const a=rules.resolveMortal(g,s,first,mortalPrincipal(g,'host')),b=rules.resolveMortal(g,s,second,mortalPrincipal(g,'host'));assert.deepEqual(a,b);
 const before=canonical(s);for(let n=0;n<50;n++)reject(()=>run(g,s,{type:'attack',target_id:'raider',weapon_id:'spear'}));assert.equal(canonical(s),before);
 const frozen=Object.freeze(structuredClone(g));const frozenState=structuredClone(s);for(const x of frozenState.actors)Object.freeze(x.resources);Object.freeze(frozenState);run(frozen,frozenState,{type:'wait',turns:1});assert.equal(canonical(s),before);
});
test('immutable genesis references and exhausted bounded counters fail closed',()=>{
 const g=mortalGenesis();
 for(const edit of [(s:MortalState)=>{s.genesis_hash='aa'.repeat(32);},(s:MortalState)=>{actor(s).location_id='missing';},(s:MortalState)=>{actor(s).abilities.strength=10;},(s:MortalState)=>{s.opportunities[0]!.target=0;},(s:MortalState)=>{s.sequence=1000000;},(s:MortalState)=>{s.world_time=1000000000000;}])reject(()=>run(g,later(g,edit),{type:'wait',turns:1}));
});
test('10,000 seeded accepted/rejected proposals preserve conservation and replay sampled prefixes',()=>{
 let accepted=0,rejected=0;
 for(let batch=0;batch<100;batch++){
  const g=mortalGenesis();g.seed=hash({suite:'mortal-transition-fuzz',batch});let s=start(g);const history:{command:MortalCommand;hash:string}[]=[];
  let generator=batch+1;const next=()=>{generator=(Math.imul(generator,1664525)+1013904223)>>>0;return generator;};
  for(let i=0;i<100;i++){
   const choice=next()%8;
   const action:MortalAction=choice===0?{type:'wait',turns:1}:choice===1?{type:'travel',route_id:'road'}:choice===2?{type:'equip',item_id:'spear',equipped:!s.items[0]!.equipped}:choice===3?{type:'give',to_actor_id:'companion',resource:'obols',units:1}:choice===4?{type:'travel',route_id:'missing'}:choice===5?{type:'attack',target_id:'raider',weapon_id:'spear'}:choice===6?{type:'buy',stock_id:'food',units:100}:{type:'give',to_actor_id:'companion',resource:'water',units:100};
   const command=mortalCommand(s,action,'hero',`batch_${batch}_step_${i}`),before=canonical(s);
   try{const resolution=rules.resolveMortal(g,s,command,mortalPrincipal(g));s=resolution.state;accepted++;assertMortalContract('State',s);assert.equal(actor(s).resources.obols+actor(s,'companion').resources.obols,40);history.push({command,hash:rules.mortalStateHash(s)});}
   catch(e){assert.ok(e instanceof ArgoError);rejected++;assert.equal(canonical(s),before);}
  }
  for(const length of [0,1,Math.floor(history.length/2),history.length]){
   let replay=start(g);for(const entry of history.slice(0,length))replay=rules.resolveMortal(g,replay,entry.command,mortalPrincipal(g)).state;
   if(length>0)assert.equal(rules.mortalStateHash(replay),history[length-1]!.hash);
  }
 }
 assert.equal(accepted+rejected,10000);assert.ok(accepted>2000);assert.ok(rejected>4000);
});
