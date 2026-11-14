import test from 'node:test';import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {canonical,hash,assertMortalGenesis,assertMortalContract,MORTAL_PROFILE} from '../packages/contracts/src/index.ts';
import type {MortalGenesis,MortalState,MortalCommand,MortalAction,MortalPrincipal,MortalActorView} from '../packages/contracts/src/index.ts';
import {keys,scope} from './fixtures.ts';
import {mortalGenesis,mortalPrincipal,mortalCommand} from './mortal-fixtures.ts';
const load=async()=>import('../scenarios/tempted-fates/runtime.ts');
const engine=async()=>import('../packages/ledger/src/mortal/index.ts');
const pack=async()=>JSON.parse(await readFile(new URL('../scenarios/tempted-fates/campaign/world.json',import.meta.url),'utf8'));
const options=(variant:'genuine'|'counterfeit'|'legend'='legend')=>({scope:{...scope,world_id:'phase2_campaign'},seed:'87'.repeat(32),authority_key_id:'phase2_key',authority_public_key:keys.publicKey.export({type:'spki',format:'pem'}).toString(),referee_id:'host',npc_controller_id:'host_npcs',variant,hp_mode:'classic' as const,travelers:[{id:'hero',name:'Ariadne',controller_id:'auth_hero',weapon:'spear' as const},{id:'companion',name:'Theron',controller_id:'auth_companion',weapon:'sling' as const}]});

test('campaign initializes fresh deterministic mortal worlds with fixed variant and no Fate combat actors',async()=>{
 const api=await load(),world=await pack(),before=canonical(world),first=api.buildMortalCampaign(world,options());
 assertMortalGenesis(first.genesis);assert.equal(first.genesis.version,MORTAL_PROFILE);assert.equal(first.genesis.actors.length,10);assert.equal(first.genesis.locations.length,7);assert.equal(first.genesis.routes.length,9);
 assert.equal(canonical(first),canonical(api.buildMortalCampaign(world,options())));assert.equal(canonical(world),before);
 assert.equal(first.genesis.pack_hash,hash(world));assert.ok(!first.genesis.actors.some(a=>['clotho','lachesis','atropos'].includes(a.id)));
 assert.ok(!first.genesis.locations.some(l=>l.id==='l_loom'));assert.ok(first.genesis.routes.every(r=>r.hazard===null&&!r.requires_light));
 assert.ok(!first.genesis.items.some(i=>i.id==='measure_cup'));
 const genuine=api.buildMortalCampaign(world,options('genuine')),counterfeit=api.buildMortalCampaign(world,options('counterfeit'));
 assert.equal(genuine.genesis.items.find(i=>i.id==='measure_cup')!.owner_id,'ione');assert.equal(counterfeit.genesis.items.find(i=>i.id==='measure_cup')!.owner_id,'ione');
 assert.notEqual(hash(genuine.genesis),hash(counterfeit.genesis));
 const tempered=api.buildMortalCampaign(world,{...options(),hp_mode:'floor4'});assert.ok(tempered.genesis.actors.filter(a=>a.kind==='player').every(a=>a.max_hp>=4));
 first.genesis.actors[0]!.name='changed';assert.notEqual(api.buildMortalCampaign(world,options()).genesis.actors[0]!.name,'changed');
});

test('campaign host options refuse active, unknown and identity-colliding inputs',async()=>{
 const api=await load(),world=await pack();let called=0;
 const accessor=options();Object.defineProperty(accessor,'seed',{get(){called++;return 'aa'.repeat(32);},enumerable:true});
 assert.throws(()=>api.buildMortalCampaign(world,accessor));assert.equal(called,0);
 for(const patch of [{hp_mode:'invincible'},{extra:true},{travelers:[]},{travelers:[{...options().travelers[0],id:'melia'}]},{travelers:[{...options().travelers[0],id:'constructor'}]},{travelers:[{...options().travelers[0],max_hp:100}]},{seed:'wrong'}])assert.throws(()=>api.buildMortalCampaign(world,{...options(),...patch} as never));
});

test('mortal actor view exposes own state and admitted encounter facts without host secrets',async()=>{
 const api=await engine(),g=mortalGenesis(),state=api.initialMortalState(g);
 const own=api.viewMortalActor(g,state,mortalPrincipal(g));assertMortalContract('ActorView',own);
 assert.equal(own.self.id,'hero');assert.ok(own.items.every(i=>i.owner_id==='hero'));assert.ok(!canonical(own).includes(g.seed));
 assert.equal(Object.hasOwn(own,'variant'),false);assert.equal(Object.hasOwn(own.self,'controller_id'),false);
 assert.throws(()=>api.viewMortalActor(g,state,{...mortalPrincipal(g),actor_id:'companion'}));assert.throws(()=>api.viewMortalActor(g,state,mortalPrincipal(g,'host')));
 assert.throws(()=>api.viewMortalActor(g,state,{...mortalPrincipal(g),scope:{...g.scope,world_id:'other'}}));
 const started=api.resolveMortal(g,state,mortalCommand(state,{type:'begin_encounter',encounter_id:'fight',side_a:['hero'],side_b:['raider'],escape_allowed:true},'host'),mortalPrincipal(g,'host')).state;
 const participating=api.viewMortalActor(g,started,mortalPrincipal(g));assert.ok(participating.encounter);assert.equal(participating.encounter.participants.length,2);
 assert.ok(participating.encounter.participants.every(p=>!Object.hasOwn(p,'hp')&&!Object.hasOwn(p,'resources')));
 assert.equal(api.viewMortalActor(g,started,mortalPrincipal(g,'companion')).encounter,null);
 own.self.resources.obols=999;assert.equal(state.actors[0]!.resources.obols,20);
});

test('campaign real durable loop spends food and stock once, preserves private views and replays after reopening',async t=>{
 const api=await load(),runtime=await engine(),built=api.buildMortalCampaign(await pack(),options());
 const directory=await mkdtemp(join(tmpdir(),'argo-rpg-phase2-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const path=join(directory,'world.sqlite');let ledger=await runtime.openMortalLedger({path,genesis:built.genesis,privateKey:keys.privateKey});t.after(()=>ledger.close());
 const auth:MortalPrincipal={scope:built.genesis.scope,actor_id:'hero',principal_id:'auth_hero',role:'player'};
 let i=0;const submit=async(action:MortalAction)=>{const state=await ledger.snapshot();const cmd:MortalCommand={version:MORTAL_PROFILE,scope:built.genesis.scope,request_id:`play_${++i}`,actor_id:'hero',expected:{sequence:state.sequence,head:state.head},causation_id:state.head,action};return {cmd,receipt:await ledger.submit(cmd,auth)};};
 const bought=await submit({type:'buy',stock_id:'harbor_rations',units:1});assert.equal(canonical(await ledger.submit(bought.cmd,auth)),canonical(bought.receipt));
 await submit({type:'travel',route_id:'r_harbor_market'});let state=await ledger.snapshot();const hero=state.actors.find(a=>a.id==='hero')!,other=state.actors.find(a=>a.id==='companion')!;
 assert.equal(hero.location_id,'l_market');assert.equal(hero.resources.rations,2);assert.equal(hero.resources.water,1);assert.equal(hero.resources.obols,18);assert.equal(other.active_seconds,0);assert.equal(other.resources.rations,2);assert.equal(state.world_time,600);
 const before=canonical(state);await assert.rejects(ledger.submit({...bought.cmd,request_id:'stale'},auth));assert.equal(canonical(await ledger.snapshot()),before);
 const events=await ledger.events({after:0,limit:1000});assert.equal(events.length,2);assert.equal(canonical(runtime.replayMortal(built.genesis,events)),before);
 const anchor={sequence:state.sequence,head:state.head};await ledger.close();ledger=await runtime.openMortalLedger({path,genesis:built.genesis,privateKey:keys.privateKey,expectedHead:anchor});assert.equal(canonical(await ledger.snapshot()),before);
 runtime.verifyMortalReceipt(bought.receipt,{scope:built.genesis.scope,genesis_hash:hash(built.genesis),authority_key_id:built.genesis.authority_key_id,authority_public_key:built.genesis.authority_public_key});
});
