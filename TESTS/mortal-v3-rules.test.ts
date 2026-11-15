import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,sign} from 'node:crypto';
import {ArgoError,canonical,hash} from '../packages/contracts/src/index.ts';
import {assertMortalV3Contract} from '../packages/contracts/src/mortal-v3.ts';
import type {MortalV3State,MortalV3Genesis,MortalV3Action,MortalV3Event} from '../packages/contracts/src/mortal-v3-types.ts';
import * as api from '../packages/ledger/src/mortal-v3/index.ts';
import {verifyMortalReceipt,verifyMortalEvent} from '../packages/ledger/src/mortal/journal.ts';
import {initialMortalState} from '../packages/ledger/src/mortal/rules.ts';
import {mortalGenesis} from './mortal-fixtures.ts';
import {v3Genesis,v3Command,v3Principal,v3Actor,beginAction,recover,keys} from './mortal-v3-helpers.ts';
const code=(expected:string)=>(e:unknown)=>e instanceof ArgoError&&e.code===expected;
const run=(g:MortalV3Genesis,s:MortalV3State,a:MortalV3Action,id='hero')=>api.resolveMortalV3(g,s,v3Command(s,a,id),v3Principal(g,id));
const begin=(g=v3Genesis(),extra=false)=>run(g,api.initialMortalV3State(g),beginAction(extra),'host').state;
const turn=(s:MortalV3State)=>s.encounter!.order[s.encounter!.turn]!;

test('v3 is explicit fresh-world authority with independently domain-separated initial identities',()=>{
 const g=v3Genesis(),s=api.initialMortalV3State(g);assert.equal(s.genesis_hash,hash(g));assert.equal(s.head,hash(g));assertMortalV3Contract('State',s);
 assert.throws(()=>api.initialMortalV3State(mortalGenesis() as unknown as MortalV3Genesis),code('INVALID_CONTRACT'));
 assert.throws(()=>api.initialMortalV3State({...g,world_time:600}),code('INVALID_CONTRACT'));
 const later={...s,sequence:1};
 assert.equal(api.mortalV3StateHash({...later,head:'ab'.repeat(32)}),api.mortalV3StateHash(later));
 assert.notEqual(api.mortalV3StateHash({...later,world_time:600}),api.mortalV3StateHash(later));
 assert.deepEqual(api.mortalV3Capacity(s,'hero'),{used:10,limit:12});
});

test('remote travel and rest advance shared time while leaving the encounter and combatants paused',()=>{
 const g=v3Genesis(),s=begin(g),before=canonical(s.encounter),fighters=s.actors.filter(a=>s.encounter!.order.includes(a.id));
 const r=run(g,s,{type:'travel',route_id:'outer'},'remote').state;
 assert.equal(r.world_time,600);assert.equal(v3Actor(r,'remote').active_seconds,600);assert.equal(canonical(r.encounter),before);
 assert.deepEqual(r.actors.filter(a=>s.encounter!.order.includes(a.id)),fighters);
 const slept=run(g,r,{type:'rest'},'remote').state;assert.equal(slept.world_time,29400);assert.equal(slept.encounter!.turn_started_sequence,1);
 assert.deepEqual(slept.actors.filter(a=>s.encounter!.order.includes(a.id)),fighters);
 const closed=run(g,slept,recover(slept,'close'),'host');assert.equal(closed.state.world_time,29406);
 for(const id of s.encounter!.order)assert.equal(v3Actor(closed.state,id).active_seconds,6);
 assert.equal(v3Actor(closed.state,'remote').active_seconds,29400);assert.equal(closed.state.encounter,null);
});

test('whole roster and site refuse ordinary actions; remote actions cannot enter or mutate the locked site',()=>{
 const g=v3Genesis(),s=begin(g),before=canonical(s);
 const refused:[string,MortalV3Action][]=[['hero',{type:'wait',turns:1}],['raider',{type:'equip',item_id:'club',equipped:false}],['watcher',{type:'rest'}],['companion',{type:'buy',stock_id:'food',units:1}],['remote',{type:'travel',route_id:'road'}],['remote',{type:'give',to_actor_id:'hero',resource:'obols',units:1}],['remote',{type:'transfer_item',item_id:'remote_spear',to_actor_id:'raider'}]];
 for(const [id,action] of refused){assert.throws(()=>run(g,s,action,id),code('CONFLICT'));assert.equal(canonical(s),before);}
 for(const action of [{type:'buy',stock_id:'food',units:1},{type:'explore',opportunity_id:'forage'},{type:'pickup',item_id:'spear'},{type:'loot',item_id:'club'}] as MortalV3Action[])assert.throws(()=>run(g,s,action,'remote'));
 for(const action of [{type:'wait',turns:1},{type:'explore',opportunity_id:'remote_forage'},{type:'buy',stock_id:'remote_food',units:1},{type:'pickup',item_id:'remote_loot'},{type:'equip',item_id:'remote_spear',equipped:false},{type:'transfer_item',item_id:'remote_spear',to_actor_id:null}] as MortalV3Action[]){const r=run(g,s,action,'remote');assert.deepEqual(r.state.encounter,s.encounter);assert.deepEqual(v3Actor(r.state),v3Actor(s));}
 assert.throws(()=>run(g,s,beginAction(),'host'),code('CONFLICT'));assert.throws(()=>run(g,s,{type:'pass'},'remote'),code('UNAUTHORIZED'));
});

test('activity locks explain escaped roster and site exclusion without revealing the fight to outsiders',()=>{
 const g=v3Genesis();let s=begin(g,true);
 // Advance to hero, then escape while companion keeps side A viable.
 while(turn(s)!=='hero')s=run(g,s,{type:'pass'},turn(s)).state;
 s=run(g,s,{type:'retreat'},'hero').state;assert.ok(s.encounter);
 assert.throws(()=>run(g,s,{type:'travel',route_id:'road'},'hero'),code('CONFLICT'));
 const escaped=api.viewMortalV3Actor(g,s,v3Principal(g));assert.equal(escaped.encounter,null);assert.deepEqual(escaped.activity_lock,{encounter_id:'fight',location_id:'harbor',reason:'roster'});
 const watcher=api.viewMortalV3Actor(g,s,v3Principal(g,'watcher'));assert.equal(watcher.encounter,null);assert.equal(watcher.activity_lock?.reason,'site');
 const remote=api.viewMortalV3Actor(g,s,v3Principal(g,'remote'));assert.equal(remote.encounter,null);assert.equal(remote.activity_lock,null);
 const participant=api.viewMortalV3Actor(g,s,v3Principal(g,'companion'));assert.ok(participant.encounter);assert.equal(participant.activity_lock?.reason,'roster');
 assert.equal('seed' in remote,false);assert.equal('turn_started_sequence' in (participant.encounter as object),false);
 for(const p of participant.encounter!.participants)assert.deepEqual(Object.keys(p).sort(),['condition','escaped','id','side']);
 const closed=run(g,s,recover(s,'close'),'host').state;assert.equal(api.viewMortalV3Actor(g,closed,v3Principal(g)).activity_lock,null);
 assert.equal(run(g,closed,{type:'travel',route_id:'road'},'hero').state.actors[0]!.location_id,'ruin');
 assert.throws(()=>api.viewMortalV3Actor(g,s,v3Principal(g,'host')),code('UNAUTHORIZED'));
 assert.throws(()=>api.viewMortalV3Actor(g,s,{...v3Principal(g),principal_id:'impostor'}),code('UNAUTHORIZED'));
});

test('recovery requires exact authenticated referee, scope, cursor, encounter and waiting-turn token',()=>{
 const g=v3Genesis(),s=begin(g),action=recover(s),c=v3Command(s,action,'host'),p=v3Principal(g,'host'),before=canonical(s);
 assert.throws(()=>api.resolveMortalV3(g,s,c,{...p,principal_id:'forged_host'}),code('UNAUTHORIZED'));
 assert.throws(()=>api.resolveMortalV3(g,s,c,v3Principal(g)),code('UNAUTHORIZED'));
 assert.throws(()=>api.resolveMortalV3(g,s,c,{...p,scope:{...p.scope,rights_lane:'homebrew',workspace_tenant_id:'tenant:homebrew:workspace'}}),code('SCOPE_DENIED'));
 assert.throws(()=>run(g,s,{...action,type:'recover_encounter',encounter_id:'other'},'host'),code('CONFLICT'));
 const remote=run(g,s,{type:'wait',turns:1},'remote').state;assert.throws(()=>api.resolveMortalV3(g,remote,c,p),code('CONFLICT'));
 const advanced=run(g,remote,action,'host').state;assert.equal(advanced.encounter!.turn_started_sequence,remote.sequence+1);
 assert.throws(()=>run(g,advanced,action,'host'),code('CONFLICT'));assert.equal(canonical(s),before);
 const closed=run(g,advanced,recover(advanced,'close'),'host').state;assert.throws(()=>run(g,closed,action,'host'),code('CONFLICT'));
 const reused=run(g,closed,beginAction(),'host').state;assert.throws(()=>run(g,reused,action,'host'),code('CONFLICT'));
 assert.throws(()=>api.resolveMortalV3(g,reused,v3Command(reused,{type:'wait',turns:1}),p),code('UNAUTHORIZED'));
});

test('referee pass uses the ordinary turn transition, expires defense, and charges exactly at wrap',()=>{
 const g=v3Genesis(),s=begin(g);const normal=run(g,s,{type:'pass'},turn(s)),recovered=run(g,s,recover(s),'host');
 assert.deepEqual(recovered.state,normal.state);assert.deepEqual(recovered.draws,normal.draws);assert.equal(recovered.state.world_time,0);
 assert.equal(recovered.effects[0]!.kind,'referee_pass');assert.equal(recovered.effects[0]!.actor_id,turn(s));assert.equal(recovered.effects.some(e=>e.kind==='pass'),false);
 const defend=run(g,s,{type:'defend'},turn(s)).state;const wrapped=run(g,defend,recover(defend),'host');
 assert.equal(wrapped.state.world_time,6);assert.equal(wrapped.state.encounter!.round,2);assert.equal(wrapped.state.encounter!.turn_started_sequence,3);
 assert.equal(wrapped.state.encounter!.defended.includes(turn(s)),false);
 assert.equal(wrapped.effects.filter(e=>e.kind==='world_time').length,1);for(const id of s.encounter!.order){assert.equal(v3Actor(wrapped.state,id).active_seconds,6);assert.equal(v3Actor(wrapped.state,id).resources.rations,1);}
});

test('close always settles its pending round once without rewards, movement, healing or refunds',()=>{
 const g=v3Genesis();g.actors[0]!.resources.rations=0;g.actors[0]!.resources.water=0;g.actors[0]!.hp=1;
 const s=run(g,api.initialMortalV3State(g),{...beginAction(),escape_allowed:false} as MortalV3Action,'host').state;
 const closed=run(g,s,recover(s,'close'),'host');assert.equal(closed.state.world_time,6);assert.equal(closed.state.encounter,null);assert.ok(v3Actor(closed.state).hp<0);
 assert.deepEqual(closed.state.items,s.items);assert.equal(closed.effects.filter(e=>e.kind==='world_time').length,1);
 assert.ok(closed.effects.some(e=>e.kind==='referee_close'));assert.equal(closed.effects.some(e=>['heal','retreat','encounter_end','hit','miss'].includes(e.kind)),false);
 for(const before of s.actors){const after=v3Actor(closed.state,before.id);assert.equal(after.location_id,before.location_id);assert.equal(after.resources.obols,before.resources.obols);assert.ok(after.hp<=before.hp);}
 const good=v3Genesis();let round=begin(good);for(let i=0;i<2;i++)round=run(good,round,recover(round),'host').state;
 assert.equal(round.world_time,6);const again=run(good,round,recover(round,'close'),'host');assert.equal(again.state.world_time,12);assert.equal(v3Actor(again.state).active_seconds,12);
 assert.equal(v3Actor(again.state).resources.rations,1);
});

test('escaped participants pay their frozen round but no later rounds, and recovery respects terminal bounds',()=>{
 const g=v3Genesis();let s=begin(g,true);while(turn(s)!=='hero')s=run(g,s,{type:'pass'},turn(s)).state;
 s=run(g,s,{type:'retreat'},'hero').state;while(s.encounter!.round===1)s=run(g,s,recover(s),'host').state;
 assert.equal(v3Actor(s).active_seconds,6);assert.equal(s.encounter!.round_participants.includes('hero'),false);
 const closed=run(g,s,recover(s,'close'),'host');assert.equal(v3Actor(closed.state).active_seconds,6);assert.equal(v3Actor(closed.state,'companion').active_seconds,12);
 const limit=structuredClone(s);limit.world_time=1000000000000;assert.throws(()=>run(g,limit,recover(limit,'close'),'host'),code('INVALID_ACTION'));
 const seq=structuredClone(s);seq.sequence=1000000;assert.throws(()=>run(g,seq,recover(seq),'host'),code('INVALID_ACTION'));
});

test('shared RNG uses the v3 domain and preserves serialized draw order across remote work and combat',()=>{
 const g=v3Genesis(),s=api.initialMortalV3State(g),begun=run(g,s,beginAction(),'host');
 const expected=(index:number,purpose:string,sides:number)=>{const limit=Math.floor(2**32/sides)*sides;for(let attempt=0;;attempt++){const n=createHmac('sha256',Buffer.from(g.seed,'hex')).update(canonical({domain:'mortal-rng/0.3.0',index,purpose,sides,attempt})).digest().readUInt32BE();if(n<limit)return n%sides+1;}};
 assert.equal(begun.draws[0]!.value,expected(0,'initiative',6));
 const remote=run(g,begun.state,{type:'explore',opportunity_id:'remote_forage'},'remote');assert.deepEqual(remote.draws.map(d=>[d.index,d.purpose]),[[1,'explore']]);
 const id=turn(remote.state),target=id==='hero'?'raider':'hero',weapon=id==='hero'?'spear':'club';
 const combat=run(g,remote.state,{type:'attack',target_id:target,weapon_id:weapon},id);assert.equal(combat.draws[0]!.index,2);assert.equal(combat.draws[0]!.value,expected(2,'attack',20));
 const without=run(g,begun.state,{type:'attack',target_id:target,weapon_id:weapon},id);assert.equal(without.draws[0]!.index,1);
 assert.equal(remote.state.encounter!.turn_started_sequence,1);assert.equal(combat.state.world_time,remote.state.world_time+(combat.effects.some(e=>e.kind==='world_time')?6:0));
});

test('signed v3 history replays referee provenance and rejects derived-field tampering, duplicates and v2 mixing',()=>{
 const g=v3Genesis();let state=api.initialMortalV3State(g);const events:MortalV3Event[]=[];
 for(const [id,action] of [['host',beginAction()],['remote',{type:'wait',turns:1}]] as [string,MortalV3Action][]){const made=api.createMortalV3Event(g,state,v3Command(state,action,id),v3Principal(g,id),keys.privateKey);state=made.state;events.push(made.event);}
 const made=api.createMortalV3Event(g,state,v3Command(state,recover(state,'close'),'host'),v3Principal(g,'host'),keys.privateKey);events.push(made.event);state=made.state;
 assert.equal(made.event.principal.role,'referee');assert.equal(made.event.command.actor_id,null);assert.deepEqual(api.replayMortalV3(g,events),state);
 const trust={scope:g.scope,genesis_hash:hash(g),authority_key_id:g.authority_key_id,authority_public_key:g.authority_public_key};api.verifyMortalV3Receipt(made.receipt,trust);
 assert.throws(()=>verifyMortalReceipt(made.receipt as never,trust),code('INVALID_CONTRACT'));
 assert.throws(()=>verifyMortalEvent(mortalGenesis(),initialMortalState(mortalGenesis()),events[0] as never),code('INVALID_CONTRACT'));
 const forged=structuredClone(made.event);forged.effects=forged.effects.filter(e=>e.kind!=='world_time');const {hash:_,signature:__,...body}=forged;forged.signature=sign(null,Buffer.from(canonical(body)),keys.privateKey).toString('base64');const {hash:___,...signed}=forged;forged.hash=hash(signed);
 assert.throws(()=>api.verifyMortalV3Event(g,api.replayMortalV3(g,events.slice(0,2)),forged),code('CORRUPT_LEDGER'));
 assert.throws(()=>api.replayMortalV3(g,[...events,events[0]!]),code('CORRUPT_LEDGER'));
 assert.throws(()=>api.verifyMortalV3Receipt({...made.receipt,effects:[]},trust),code('UNAUTHORIZED'));
});

test('v3 retains resource custody, paid ranged attacks, and remote light costs through referee closure',()=>{
 const g=v3Genesis();g.actors.find(a=>a.id==='companion')!.location_id='ruin';
 const bow=g.items.find(i=>i.id==='spear')!;if(bow.kind!=='weapon')throw Error('fixture');bow.attack_ability='wisdom';
 const remoteLamp=structuredClone(g.items.find(i=>i.id==='lamp')!);remoteLamp.id='remote_lamp';remoteLamp.owner_id='remote';g.items.push(remoteLamp);
 const remoteKit=structuredClone(g.items.find(i=>i.id==='firekit')!);remoteKit.id='remote_kit';remoteKit.owner_id='remote';g.items.push(remoteKit);g.routes.find(r=>r.id==='outer')!.requires_light=true;
 let s=begin(g);s=run(g,s,{type:'give',to_actor_id:'companion',resource:'obols',units:3},'remote').state;
 assert.equal(v3Actor(s,'remote').resources.obols,17);assert.equal(v3Actor(s,'companion').resources.obols,23);
 s=run(g,s,{type:'travel',route_id:'outer'},'remote').state;assert.equal(v3Actor(s,'remote').resources.oil,5);
 while(turn(s)!=='hero')s=run(g,s,recover(s),'host').state;
 s=run(g,s,{type:'attack',target_id:'raider',weapon_id:'spear'},'hero').state;assert.equal(v3Actor(s).resources.ammo,19);
 // If the attack ended combat its ordinary settlement is already final.
 if(s.encounter)s=run(g,s,recover(s,'close'),'host').state;
 assert.equal(v3Actor(s).resources.ammo,19);assert.equal(v3Actor(s,'remote').resources.oil,5);assert.equal(v3Actor(s,'remote').resources.obols,17);
 assert.equal(v3Actor(s,'remote').active_seconds,600);assert.equal(s.world_time,606);
});

test('referee pass settles needs and closes a nonviable round exactly as a voluntary pass',()=>{
 const g=v3Genesis();for(const id of ['hero','raider']){const a=g.actors.find(a=>a.id===id)!;a.hp=1;a.resources.rations=0;a.resources.water=0;}
 let s=begin(g);s=run(g,s,recover(s),'host').state;const voluntary=run(g,s,{type:'pass'},turn(s)),referee=run(g,s,recover(s),'host');
 assert.deepEqual(referee.state,voluntary.state);assert.deepEqual(referee.draws,voluntary.draws);assert.equal(referee.state.encounter,null);assert.equal(referee.state.world_time,6);
 assert.equal(referee.effects.filter(e=>e.kind==='world_time').length,1);assert.equal(referee.effects.filter(e=>e.kind==='encounter_end').length,1);
 assert.ok(v3Actor(referee.state).hp<0);assert.ok(v3Actor(referee.state,'raider').hp<0);
 assert.throws(()=>run(g,referee.state,{type:'rest'}),code('UNAUTHORIZED'));
});

test('v3 rejects malformed active inputs and forged encounter principals before executing getters or mutating data',()=>{
 const g=v3Genesis(),s=api.initialMortalV3State(g),c=v3Command(s,beginAction(),'host'),p=v3Principal(g,'host'),before=canonical({g,s,c,p});let touched=0;
 assert.throws(()=>api.resolveMortalV3(g,s,c,{...p,principal_id:'impostor'}),code('UNAUTHORIZED'));
 assert.throws(()=>api.resolveMortalV3(g,s,c,v3Principal(g)),code('UNAUTHORIZED'));
 const getter={...c};Object.defineProperty(getter,'action',{enumerable:true,get(){touched++;return c.action;}});
 assert.throws(()=>api.resolveMortalV3(g,s,getter,p),code('INVALID_CONTRACT'));
 assert.throws(()=>api.resolveMortalV3(g,s,new Proxy(c,{get(){touched++;return undefined;}}),p),code('INVALID_CONTRACT'));
 assert.equal(touched,0);assert.equal(canonical({g,s,c,p}),before);
 const result=api.createMortalV3Event(g,s,c,p,keys.privateKey);result.event.command.action={...beginAction(),escape_allowed:false} as MortalV3Action;result.state.actors[0]!.resources.oil=0;result.receipt.effects.length=0;
 assert.equal(canonical({g,s,c,p}),before);
 const corrupt=begin(g);v3Actor(corrupt,'raider').hp=-1;assert.throws(()=>run(g,corrupt,recover(corrupt,'close'),'host'));
});

test('v3 replay checks duplicate request IDs across otherwise valid events and immutable genesis trust',()=>{
 const g=v3Genesis(),s=api.initialMortalV3State(g),p=v3Principal(g),first=api.createMortalV3Event(g,s,v3Command(s,{type:'wait',turns:1},'hero','same'),p,keys.privateKey);
 const second=api.createMortalV3Event(g,first.state,v3Command(first.state,{type:'wait',turns:1},'hero','same'),p,keys.privateKey);
 assert.equal(api.verifyMortalV3Event(g,first.state,second.event).sequence,2);assert.throws(()=>api.replayMortalV3(g,[first.event,second.event]),code('CORRUPT_LEDGER'));
 for(const altered of [{...g,seed:'01'.repeat(32)},{...g,variant:'genuine' as const},{...g,pack_hash:'02'.repeat(32)}])assert.throws(()=>api.replayMortalV3(altered,[first.event]),code('CORRUPT_LEDGER'));
 let touched=0;const proxy=new Proxy([first.event],{get(){touched++;return undefined;}});assert.throws(()=>api.replayMortalV3(g,proxy),code('INVALID_CONTRACT'));assert.equal(touched,0);
 const trust={scope:g.scope,genesis_hash:hash(g),authority_key_id:g.authority_key_id,authority_public_key:g.authority_public_key};
 assert.throws(()=>api.verifyMortalV3Receipt(first.receipt,{...trust,scope:{...g.scope,world_id:'other'}}),code('UNAUTHORIZED'));
 assert.throws(()=>api.verifyMortalV3Receipt(first.receipt,{...trust,genesis_hash:'03'.repeat(32)}),code('UNAUTHORIZED'));
});
