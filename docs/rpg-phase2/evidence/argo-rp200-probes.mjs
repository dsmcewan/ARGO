import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {sign,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
const root=resolve(process.argv[2]),integration=resolve(process.argv[3]);
const load=(base,p)=>import(pathToFileURL(resolve(base,p)).href);
const r=await load(root,'packages/ledger/src/mortal/rules.ts');
const c=await load(root,'packages/contracts/src/index.ts');
const f=await load(root,'TESTS/mortal-fixtures.ts');
const j=await load(integration,'packages/ledger/src/mortal/journal.ts');
assert.equal(process.env.NODE_TEST_CONTEXT,undefined,'Must run outside Node test context');
const digest=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
assert.equal(digest(resolve(root,'packages/ledger/src/mortal/rules.ts')),digest(resolve(integration,'packages/ledger/src/mortal/rules.ts')));
let checks=0,steps=0;
const eq=(a,b)=>{assert.deepEqual(a,b);checks++;};
const actor=(s,id='hero')=>s.actors.find(a=>a.id===id);
function deny(fn,before){assert.throws(fn,e=>typeof e?.code==='string');checks++;if(before){eq(c.canonical(before.value),before.text);}}
function run(g,s,action,id='hero'){steps++;return r.resolveMortal(g,s,f.mortalCommand(s,action,id),f.mortalPrincipal(g,id));}
const snapshot=value=>({value,text:c.canonical(value)});

// Authentication precedes every state-changing category; bad actors cannot
// consume a draw merely by submitting a plausible action.
const g=f.mortalGenesis(),s=r.initialMortalState(g),saved=snapshot({g,s});
for(const action of [{type:'wait',turns:1},{type:'travel',route_id:'road'},{type:'rest'},{type:'equip',item_id:'spear',equipped:false},{type:'transfer_item',item_id:'spear',to_actor_id:'companion'},{type:'pickup',item_id:'lamp'},{type:'loot',item_id:'club'},{type:'give',to_actor_id:'companion',resource:'obols',units:1},{type:'buy',stock_id:'food',units:1},{type:'explore',opportunity_id:'forage'},{type:'attack',weapon_id:'spear',target_id:'raider'},{type:'pass'},{type:'defend'},{type:'retreat'}]){
 const cmd=f.mortalCommand(s,action),p=f.mortalPrincipal(g);p.principal_id='untrusted_controller';
 deny(()=>r.resolveMortal(g,s,cmd,p),saved);
}
eq(s.rng_counter,0);

// Finite stock + recipient resources conserve both currency and purchased food.
const coins=x=>x.actors.reduce((sum,a)=>sum+a.resources.obols,0)+x.stocks.reduce((sum,a)=>sum+a.treasury,0);
const food=x=>x.actors.reduce((sum,a)=>sum+a.resources.rations,0)+x.stocks.filter(a=>a.resource==='rations').reduce((sum,a)=>sum+a.remaining,0);
let trade=run(g,s,{type:'buy',stock_id:'food',units:2}).state;
eq(coins(trade),60);eq(food(trade),16);eq(r.mortalCapacity(trade,'hero'),{used:12,limit:12});
deny(()=>run(g,trade,{type:'buy',stock_id:'food',units:1}),snapshot(trade));
trade=run(g,trade,{type:'give',to_actor_id:'companion',resource:'obols',units:5}).state;
trade=run(g,trade,{type:'give',to_actor_id:'hero',resource:'obols',units:1}).state;
eq(coins(trade),60);eq(food(trade),16);eq(actor(trade).resources.obols,11);
trade=run(g,trade,{type:'transfer_item',item_id:'spear',to_actor_id:null}).state;
eq(trade.items.find(i=>i.id==='spear').owner_id,null);
trade=run(g,trade,{type:'pickup',item_id:'spear'}).state;
eq(trade.items.find(i=>i.id==='spear').owner_id,'hero');eq(trade.items.find(i=>i.id==='spear').equipped,false);
eq(trade.items.map(i=>i.id),s.items.map(i=>i.id));eq(coins(trade),60);

// Maximum encounter roster: one round costs six seconds, not six per actor.
const many=f.mortalGenesis();many.actors=Array.from({length:25},(_,i)=>f.mortalActor('a'+i,i%2?'npc':'player'));many.items=[];
const sides={side_a:many.actors.slice(0,12).map(a=>a.id),side_b:many.actors.slice(12,24).map(a=>a.id)};
let battle=run(many,r.initialMortalState(many),{type:'begin_encounter',encounter_id:'full',...sides,escape_allowed:true},'host').state;
const order=[...battle.encounter.order],absent=structuredClone(actor(battle,'a24'));
eq(battle.rng_counter,1);eq(battle.world_time,0);
for(let round=1;round<=2;round++)for(let turn=0;turn<24;turn++){
 eq(battle.encounter.round,round);eq(battle.encounter.order,order);eq(battle.encounter.order[battle.encounter.turn],order[turn]);
 deny(()=>run(many,battle,{type:'pass'},'a24'),snapshot(battle));
 deny(()=>run(many,battle,{type:'wait',turns:1},'a24'),snapshot(battle));
 const whom=order[turn],action=round===1&&turn===0?{type:'defend'}:{type:'pass'};
 battle=run(many,battle,action,whom).state;
 eq(battle.world_time,turn===23?round*6:(round-1)*6);
 if(round===1&&turn<23)assert(battle.encounter.defended.includes(order[0]));
}
eq(battle.world_time,12);eq(battle.encounter.round,3);eq(battle.rng_counter,1);
for(const id of order){eq(actor(battle,id).active_seconds,12);eq(actor(battle,id).resources.rations,1);eq(actor(battle,id).resources.water,1);}
eq(actor(battle,'a24'),absent);eq(battle.encounter.defended,[]);

// Advance only another actor: elapsed world time cannot farm personal rest.
let rest=run(g,s,{type:'rest'}).state;eq(actor(rest).next_rest_at,86400);eq(actor(rest).active_seconds,28800);
for(let i=0;i<6;i++)rest=run(g,rest,{type:'wait',turns:24},'companion').state;
eq(rest.world_time,115200);eq(actor(rest).active_seconds,28800);deny(()=>run(g,rest,{type:'rest'}),snapshot(rest));
for(let i=0;i<4;i++)rest=run(g,rest,{type:'wait',turns:24}).state;
eq(actor(rest).active_seconds,86400);rest=run(g,rest,{type:'rest'}).state;
eq(actor(rest).next_rest_at,172800);eq(actor(rest).resources.rations,0);eq(actor(rest).resources.water,0);eq(actor(rest).hp,6);

// Lack of provisions kills before exploration reward; both d4s still resolve.
const starving=f.mortalGenesis();starving.actors[0].hp=1;starving.actors[0].resources.rations=0;starving.actors[0].resources.water=0;
starving.opportunities[0].location_id='harbor';starving.opportunities[0].target=0;
const dead=run(starving,r.initialMortalState(starving),{type:'explore',opportunity_id:'cache'});
eq(actor(dead.state).hp,-3);eq(actor(dead.state).discoveries,['cache']);eq(actor(dead.state).resources.obols,20);eq(dead.state.opportunities[0].remaining,1);
eq(dead.draws.map(d=>[d.index,d.purpose,d.value]),[[0,'hunger',3],[1,'thirst',1]]);eq(actor(dead.state).resources.oil,5);
deny(()=>run(starving,dead.state,{type:'rest'}),snapshot(dead.state));

// Aliases must not couple inventories or clocks; RNG ignores caller labels.
const shared=f.mortalGenesis();shared.actors[1].resources=shared.actors[0].resources;
const first=r.initialMortalState(shared),updated=run(shared,first,{type:'wait',turns:1}).state;
eq(actor(updated).resources.rations,1);eq(actor(updated,'companion').resources.rations,2);eq(shared.actors[0].resources.rations,2);
const initiative={type:'begin_encounter',encounter_id:'fixed',side_a:['hero'],side_b:['raider'],escape_allowed:true};
const p=f.mortalPrincipal(g,'host'),cmd=f.mortalCommand(s,initiative,'host','request_a');
const a=r.resolveMortal(g,s,cmd,p),b=r.resolveMortal(g,s,{...cmd,request_id:'request_b'},p);
eq(a,b);eq(a.draws,[{index:0,purpose:'initiative',sides:6,value:4}]);

// Real journal replay verifies the same reducer, including a signed forgery:
// trusted signing material cannot turn an impossible rules result into truth.
let live=r.initialMortalState(g);const events=[];
for(const [action,id] of [[{type:'buy',stock_id:'food',units:2},'hero'],[{type:'travel',route_id:'road'},'hero'],[{type:'explore',opportunity_id:'cache'},'hero'],[{type:'travel',route_id:'road'},'hero'],[initiative,'host'],[{type:'pass'},'raider'],[{type:'retreat'},'hero']]){
 const made=j.createMortalEvent(g,live,f.mortalCommand(live,action,id),f.mortalPrincipal(g,id),f.keys.privateKey);events.push(made.event);live=made.state;
 eq(c.canonical(j.replayMortal(g,events)),c.canonical(live));
}
const resign=event=>{const {hash:_,signature:__,...body}=event;const signed={...body,signature:sign(null,Buffer.from(c.canonical(body)),f.keys.privateKey).toString('base64')};return {...signed,hash:c.hash(signed)};};
for(const change of [e=>{e.draws[0].value=e.draws[0].value%e.draws[0].sides+1;},e=>{e.effects.push({kind:'heal',actor_id:'hero',subject_id:null,amount:100});},e=>{e.after_hash='aa'.repeat(32);},e=>{e.principal.principal_id='untrusted_controller';}]){
 const forged=structuredClone(events[4]);change(forged);const attack=[...events.slice(0,4),resign(forged)];deny(()=>j.replayMortal(g,attack));
}
deny(()=>j.replayMortal({...g,variant:'genuine'},events));
eq(c.canonical({g,s}),saved.text);
console.log(JSON.stringify({status:'pass',ordinary_process:true,checks,resolve_calls:steps,short_signed_history_events:events.length,no_test_context:true,skipped_already_passed_10k_suite:true,cases:['controller denial on14 action types','currency/food/item conservation and posttransaction capacity','24-actor turn order, one charge per round and outsider isolation','personal rest allowance independent of global time','simultaneous starvation before task reward','alias separation and request-label-independent RNG','signed short-history replay and re-signed forged draw/effect/result/controller rejection']}));
