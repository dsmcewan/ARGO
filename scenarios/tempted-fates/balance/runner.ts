/** Every outcome below is a fold of the production authority reducer. */
import {canonical,hash} from '../../../packages/contracts/src/index.ts';
import type {MortalGenesis,MortalState,MortalAction,MortalCommand,MortalPrincipal} from '../../../packages/contracts/src/mortal-types.ts';
import {initialMortalState,resolveMortal,mortalStateHash} from '../../../packages/ledger/src/mortal/rules.ts';
import {PROTOCOL,actor,combatArms,combatGenesis,emptyGenesis,initialDie} from './fixtures.ts';
import type {Arm,Phase} from './fixtures.ts';
import {wilson,pairedDifference,assessTarget} from './statistics.ts';

type Step={command:MortalCommand;principal:MortalPrincipal;refusal:string|null;digest:string};
class Session{
 readonly genesis:MortalGenesis;
 state:MortalState;steps:Step[]=[];digest:string;refusals=0;playerAttacks=0;rests=0;
 constructor(genesis:MortalGenesis){this.genesis=genesis;this.state=initialMortalState(genesis);this.digest=hash({protocol:PROTOCOL,genesis_hash:this.state.genesis_hash});}
 apply(id:string|null,action:MortalAction,expectRefusal=false):boolean{
  const a=id===null?null:this.state.actors.find(a=>a.id===id)!;
  const principal:MortalPrincipal=a?{scope:this.genesis.scope,principal_id:a.controller_id,role:a.kind,actor_id:a.id}:{scope:this.genesis.scope,principal_id:this.genesis.referee_id,role:'referee',actor_id:null};
  const command:MortalCommand={version:this.genesis.version,scope:this.genesis.scope,request_id:`step_${this.steps.length}`,actor_id:id,expected:{sequence:this.state.sequence,head:this.state.head},causation_id:this.state.head,action};
  const before=canonical(this.state);let refusal:string|null=null,next=this.state,draws:unknown[]=[],effects:unknown[]=[];
  try{const result=resolveMortal(this.genesis,this.state,command,principal);next=result.state;draws=result.draws;effects=result.effects;}
  catch(error){
   if(!expectRefusal||!error||typeof error!=='object'||!('code'in error)||typeof error.code!=='string')throw error;
   refusal=error.code;this.refusals++;
  }
  if(canonical(this.state)!==before)throw Error('Reducer mutated its input');
  if(expectRefusal&&refusal===null)throw Error(`Expected refusal accepted: ${action.type}`);
  if(refusal===null){
   if(next.sequence!==this.state.sequence+1||next.head!==this.state.head)throw Error('Pure resolution cursor invariant failed');
   if(id==='hero'&&action.type==='attack')this.playerAttacks++;
   if(id==='hero'&&action.type==='rest')this.rests++;
  }
  this.state=next;this.digest=hash({previous:this.digest,command,principal,refusal,state_hash:mortalStateHash(next),draws,effects});
  this.steps.push({command,principal,refusal,digest:this.digest});return refusal===null;
 }
 replay():string{
  let state=initialMortalState(this.genesis),digest=hash({protocol:PROTOCOL,genesis_hash:state.genesis_hash});
  for(const step of this.steps){let refusal:string|null=null,draws:unknown[]=[],effects:unknown[]=[];
   try{const result=resolveMortal(this.genesis,state,step.command,step.principal);state=result.state;draws=result.draws;effects=result.effects;}
   catch(error){if(step.refusal===null||!error||typeof error!=='object'||!('code'in error)||typeof error.code!=='string')throw error;refusal=error.code;}
   digest=hash({previous:digest,command:step.command,principal:step.principal,refusal,state_hash:mortalStateHash(state),draws,effects});
   if(refusal!==step.refusal||digest!==step.digest)throw Error('Independent command fold differs during replay');
  }
  if(digest!==this.digest||canonical(state)!==canonical(this.state))throw Error('Replay final state differs');return digest;
 }
}
export function runCombatTrial(phase:Phase,index:number,arm:Arm,bounds:{maxActions?:number;maxRounds?:number}={}){
 const maxActions=bounds.maxActions??500,maxRounds=bounds.maxRounds??100;
 if(!Number.isSafeInteger(maxActions)||maxActions<1||maxActions>500||!Number.isSafeInteger(maxRounds)||maxRounds<1||maxRounds>100)throw Error('Invalid trial bounds');
 const s=new Session(combatGenesis(phase,index,arm)),foes=s.genesis.actors.filter(a=>a.kind==='npc').map(a=>a.id);
 s.apply(null,{type:'begin_encounter',encounter_id:'fixture_encounter',side_a:['hero'],side_b:foes,escape_allowed:true});
 let withdrew=false,startedRounds=1;
 while(s.state.encounter&&s.steps.length<maxActions&&s.state.encounter.round<=maxRounds){
  const e=s.state.encounter,id=e.order[e.turn];if(!id)throw Error('Encounter has no acting participant');
  const a=s.state.actors.find(a=>a.id===id)!;
  if(a.hp<=0||e.escaped.includes(id))throw Error('Engine exposed an inactive turn');
  if(id==='hero'&&(arm.policy==='immediate'||arm.policy==='threshold'&&a.hp*2<=a.max_hp)){
   s.apply(id,{type:'retreat'});withdrew=true;
  }else{
   const targets=id==='hero'?foes:['hero'],target=targets.find(id=>s.state.actors.find(a=>a.id===id)!.hp>0&&!e.escaped.includes(id));
   if(!target)throw Error('Live encounter has no eligible target');
   s.apply(id,{type:'attack',target_id:target,weapon_id:`weapon_${id}`});
  }
  startedRounds=Math.max(startedRounds,s.state.encounter?.round??startedRounds);
 }
 const hero=s.state.actors.find(a=>a.id==='hero')!,censored=s.state.encounter!==null;
 if(s.state.world_time%6!==0)throw Error('Combat duration is not an engine round multiple');
 const replayDigest=s.replay();
 return {trial:index,arm:arm.id,initial_die:initialDie(phase,index),max_hp:hero.max_hp,hp:hero.hp,standing:hero.hp>0,unconscious:hero.hp===0,dead:hero.hp<0,
  escaped:withdrew&&hero.hp>0,retreat_admitted:withdrew,won:!censored&&!withdrew&&hero.hp>0&&foes.every(id=>s.state.actors.find(a=>a.id===id)!.hp<=0),censored,
  started_rounds:startedRounds,charged_rounds:s.state.world_time/6,world_seconds:s.state.world_time,active_seconds:hero.active_seconds,
  actions:s.steps.length,sequence:s.state.sequence,rng_counter:s.state.rng_counter,player_attacks:s.playerAttacks,location:hero.location_id,resources:hero.resources,
  state_hash:mortalStateHash(s.state),transition_digest:s.digest,replay_digest:replayDigest,replay_verified:true as const};
}
export const RESOURCE_CASES=['light_exact','light_short','search_forage','needs_prepared','needs_short','rest_prepared','rest_short','clock_isolation'] as const;
export type ResourceCase=typeof RESOURCE_CASES[number];
function resourceGenesis(phase:Phase,index:number,scenario:ResourceCase):MortalGenesis{
 const g=emptyGenesis(phase,index),hero=actor('hero','player',8);g.actors.push(hero);hero.resources.obols=3;hero.resources.oil=scenario==='light_short'?4:5;
 g.locations.push({id:'cave',name:'Nearby cave',safe_rest:false});
 for(const tool of ['lamp','firekit'] as const)g.items.push({id:tool,name:tool,kind:'tool',owner_id:'hero',location_id:null,slots:1,equipped:false,damage_die:0,attack_ability:null,armor_defense:0,tool});
 g.routes.push({id:'dark_way',from:'arena',to:'cave',turns:2,requires_light:true,hazard:null});
 g.opportunities.push({id:'search',location_id:'cave',kind:'search',ability:'wisdom',target:0,turns:1,requires_light:true,remaining:1,reward_resource:'obols',reward_units:1,failure_damage_die:0});
 if(scenario==='search_forage'){
  g.opportunities[0]!.location_id='arena';g.opportunities[0]!.target=15;g.opportunities[0]!.requires_light=false;
  g.opportunities.push({id:'forage',location_id:'arena',kind:'forage',ability:'wisdom',target:0,turns:24,requires_light:false,remaining:2,reward_resource:'rations',reward_units:1,failure_damage_die:0});
 }
 if(scenario==='needs_prepared'||scenario==='needs_short')g.stocks.push({id:'food',location_id:'arena',resource:'rations',price:2,remaining:1,treasury:0},{id:'water',location_id:'arena',resource:'water',price:1,remaining:1,treasury:0});
 if(scenario==='rest_prepared'||scenario==='rest_short'){
  hero.resources.rations=hero.resources.water=scenario==='rest_prepared'?3:2;
  g.routes[0]={id:'dark_way',from:'arena',to:'cave',turns:1,requires_light:false,hazard:{ability:'dexterity',target:30,damage_die:4}};
  g.routes.push({id:'safe_return',from:'cave',to:'arena',turns:1,requires_light:false,hazard:null});
 }
 if(scenario==='clock_isolation')g.actors.push(actor('other','npc',8));
 return g;
}
export function runResourceTrial(phase:Phase,index:number,scenario:ResourceCase){
 if(!RESOURCE_CASES.includes(scenario))throw Error('Unknown resource scenario');
 const s=new Session(resourceGenesis(phase,index,scenario));let objective=false;
 const act=(a:MortalAction,refused=false)=>s.apply('hero',a,refused);
 if(scenario==='light_exact'||scenario==='light_short'){
  act({type:'travel',route_id:'dark_way'});act({type:'explore',opportunity_id:'search'});
  act({type:'travel',route_id:'dark_way'},scenario==='light_short');objective=s.state.actors[0]!.location_id==='arena';
 }else if(scenario==='search_forage'){
  act({type:'explore',opportunity_id:'search'});act({type:'explore',opportunity_id:'search'},true);
  act({type:'explore',opportunity_id:'forage'});act({type:'explore',opportunity_id:'forage'});act({type:'explore',opportunity_id:'forage'},true);
  objective=s.state.opportunities.find(o=>o.id==='forage')!.remaining===0;
 }else if(scenario==='needs_prepared'||scenario==='needs_short'){
  if(scenario==='needs_prepared'){act({type:'buy',stock_id:'food',units:1});act({type:'buy',stock_id:'water',units:1});act({type:'buy',stock_id:'water',units:1},true);}
  for(let i=0;i<6;i++)act({type:'wait',turns:24});act({type:'wait',turns:1});objective=s.state.actors[0]!.hp===8;
 }else if(scenario==='rest_prepared'||scenario==='rest_short'){
  act({type:'travel',route_id:'dark_way'});act({type:'travel',route_id:'safe_return'});
  // Reach the exact prepaid boundary using legal waits; no clock/HP patches.
  for(let i=0;i<5;i++)act({type:'wait',turns:24});act({type:'wait',turns:22});
  act({type:'rest'});act({type:'rest'},true);
  for(let i=0;i<4;i++)act({type:'wait',turns:24});act({type:'rest'},scenario==='rest_short');objective=s.rests===2;
 }else{s.apply('other',{type:'wait',turns:24});objective=s.state.actors[0]!.active_seconds===0;}
 const hero=s.state.actors.find(a=>a.id==='hero')!,replayed=s.replay();
 return {trial:index,scenario,objective_completed:objective,hp:hero.hp,standing:hero.hp>0,unconscious:hero.hp===0,dead:hero.hp<0,
  location:hero.location_id,resources:hero.resources,initial_resources:s.genesis.actors[0]!.resources,world_seconds:s.state.world_time,active_seconds:hero.active_seconds,fed_until:hero.fed_until,next_rest_at:hero.next_rest_at,
  discoveries:hero.discoveries,forage_remaining:s.state.opportunities.find(o=>o.id==='forage')?.remaining??null,stocks:s.state.stocks,
  rests:s.rests,refusals:s.refusals,refusal_codes:s.steps.filter(x=>x.refusal!==null).map(x=>x.refusal),actions:s.steps.length,sequence:s.state.sequence,rng_counter:s.state.rng_counter,
  state_hash:mortalStateHash(s.state),transition_digest:s.digest,replay_digest:replayed,replay_verified:true as const};
}
type CombatRow=ReturnType<typeof runCombatTrial>;
function total(rows:readonly CombatRow[],key:'started_rounds'|'charged_rounds'|'actions'|'world_seconds'|'active_seconds'|'rng_counter'){return rows.reduce((s,r)=>s+r[key],0);}
const COMBAT_COLUMNS=['trial','initial_die','max_hp','hp','standing','unconscious','dead','escaped','retreat_admitted','won','censored','started_rounds','charged_rounds','world_seconds','active_seconds','actions','sequence','rng_counter','player_attacks','location','resources','state_hash','transition_digest','replay_digest','replay_verified'] as const;
const RESOURCE_COLUMNS=['trial','objective_completed','hp','standing','unconscious','dead','location','resources','initial_resources','world_seconds','active_seconds','fed_until','next_rest_at','discoveries','forage_remaining','stocks','rests','refusals','refusal_codes','actions','sequence','rng_counter','state_hash','transition_digest','replay_digest','replay_verified'] as const;
function combatSummary(arm:Arm,rows:CombatRow[]){
 const endpoints={standing_at_stop:0,terminal_standing:0,unconscious:0,dead:0,escaped:0,won:0,censored:0};
 for(const r of rows){
  if(r.standing)endpoints.standing_at_stop++;
  if(r.standing&&!r.censored)endpoints.terminal_standing++;
  for(const k of ['unconscious','dead','escaped','won','censored'] as const)if(r[k])endpoints[k]++;
 }
 return {arm,count:rows.length,endpoints,totals:{started_rounds:total(rows,'started_rounds'),charged_rounds:total(rows,'charged_rounds'),actions:total(rows,'actions'),world_seconds:total(rows,'world_seconds'),active_seconds:total(rows,'active_seconds'),rng_counter:total(rows,'rng_counter')},
  means:{started_rounds:total(rows,'started_rounds')/rows.length,charged_rounds:total(rows,'charged_rounds')/rows.length},
  intervals95:endpoints.censored?null:{incapacitated:wilson(endpoints.unconscious+endpoints.dead,rows.length),escaped:wilson(endpoints.escaped,rows.length),terminal_standing:wilson(endpoints.terminal_standing,rows.length)},
  initial_hp_strata:Array.from({length:8},(_,i)=>{const group=rows.filter(r=>r.initial_die===i+1);return {die:i+1,count:group.length,standing_at_stop:group.filter(r=>r.standing).length,terminal_standing:group.filter(r=>r.standing&&!r.censored).length,escaped:group.filter(r=>r.escaped).length,unconscious:group.filter(r=>r.unconscious).length,dead:group.filter(r=>r.dead).length,censored:group.filter(r=>r.censored).length};}),
  resource_totals:{rations_remaining:rows.reduce((s,r)=>s+r.resources.rations,0),water_remaining:rows.reduce((s,r)=>s+r.resources.water,0)},
  seed_rows:{columns:COMBAT_COLUMNS,rows:rows.map(r=>COMBAT_COLUMNS.map(k=>r[k]))},
  replay_verified_trials:rows.length,replay_digest:hash(rows.map(r=>({trial:r.trial,digest:r.replay_digest}))),
  integer_results_digest:hash(rows)};
}
type ComparisonRow=Pick<CombatRow,'standing'|'unconscious'|'dead'|'escaped'|'censored'>;
/** Shared by train and holdout; unresolved terminal pairs have no survival CI. */
export function compareCombatRows(fight:readonly ComparisonRow[],escape:readonly ComparisonRow[]){
 if(fight.length!==escape.length)throw Error('Comparison rows must pair by trial');
 const censoredPairs=fight.filter((r,i)=>r.censored||escape[i]!.censored).length;
 const a=escape.map(r=>Number(r.standing)),b=fight.map(r=>Number(r.standing));
 return {censored_pairs:censoredPairs,paired95:censoredPairs?null:pairedDifference(a,b),
  target:assessTarget({count:fight.length,incapacitated:fight.filter(r=>r.unconscious||r.dead).length,escaped:escape.filter(r=>r.escaped).length,censoredPairs,paired:censoredPairs?null:pairedDifference(a,b,'target')})};
}
export function runStudy(options:{phase:'train'|'holdout';trials?:number;smallTest?:boolean;onProgress?:(completed:number,total:number)=>void}){
 const n=options.trials??2000;
 if(!['train','holdout'].includes(options.phase)||!Number.isSafeInteger(n)||n<(options.smallTest?1:500)||n>10000)throw Error('A study needs 500..10000 trials per partition and arm');
 const arms=combatArms(),rowsByArm=new Map<string,CombatRow[]>();let complete=0;const trialTotal=(arms.length+RESOURCE_CASES.length)*n;
 for(const arm of arms){const rows:CombatRow[]=[];for(let i=0;i<n;i++){rows.push(runCombatTrial(options.phase,i,arm));options.onProgress?.(++complete,trialTotal);}rowsByArm.set(arm.id,rows);}
 const combat=arms.map(arm=>combatSummary(arm,rowsByArm.get(arm.id)!));
 const comparisons=(['classic','floor4'] as const).map(hp=>{
  const fight=rowsByArm.get(`solo_${hp}_a11_fight`)!,escape=rowsByArm.get(`solo_${hp}_a11_immediate`)!;
  return {hp,...compareCombatRows(fight,escape)};
 });
 const resources=RESOURCE_CASES.map(scenario=>{
  const rows:ReturnType<typeof runResourceTrial>[]=[];
  for(let i=0;i<n;i++){rows.push(runResourceTrial(options.phase,i,scenario));options.onProgress?.(++complete,trialTotal);}
  return {scenario,count:n,objectives:rows.filter(r=>r.objective_completed).length,standing:rows.filter(r=>r.standing).length,unconscious:rows.filter(r=>r.unconscious).length,dead:rows.filter(r=>r.dead).length,
   totals:{refusals:rows.reduce((s,r)=>s+r.refusals,0),rests:rows.reduce((s,r)=>s+r.rests,0),actions:rows.reduce((s,r)=>s+r.actions,0),world_seconds:rows.reduce((s,r)=>s+r.world_seconds,0),active_seconds:rows.reduce((s,r)=>s+r.active_seconds,0)},
   stock_totals:(rows[0]?.stocks??[]).map(stock=>({id:stock.id,remaining:rows.reduce((sum,r)=>sum+r.stocks.find(s=>s.id===stock.id)!.remaining,0),treasury:rows.reduce((sum,r)=>sum+r.stocks.find(s=>s.id===stock.id)!.treasury,0)})),
   initial_resource_totals:Object.fromEntries((['rations','water','oil','obols','ammo'] as const).map(k=>[k,rows.reduce((sum,r)=>sum+r.initial_resources[k],0)])),
   resources_remaining:Object.fromEntries((['rations','water','oil','obols','ammo'] as const).map(k=>[k,rows.reduce((sum,r)=>sum+r.resources[k],0)])),
   seed_rows:{columns:RESOURCE_COLUMNS,rows:rows.map(r=>RESOURCE_COLUMNS.map(k=>r[k]))},objective_interval95:wilson(rows.filter(r=>r.objective_completed).length,n),replay_verified_trials:n,
   replay_digest:hash(rows.map(r=>({trial:r.trial,digest:r.replay_digest}))),integer_results_digest:hash(rows)};
 });
 const censored=combat.reduce((s,r)=>s+r.endpoints.censored,0),eligible=n>=500&&!options.smallTest;
 const recommendation=options.phase==='holdout'?'heldout-no-selection':!eligible?'insufficient-study':censored?'inconclusive-censored':comparisons[0]!.target.status==='match'?'classic':comparisons[1]!.target.status==='match'?'floor4':'no-target-match';
 return {protocol:PROTOCOL,phase:options.phase,trials_per_cell:n,study_eligible:eligible,total_combat_trials:n*arms.length,total_resource_trials:n*RESOURCE_CASES.length,combat,comparisons,resources,
  recommendation,selection_rule:'Retain classic if all preregistered adjusted target intervals match; otherwise floor4 only if its intervals match; otherwise no-target-match. Any censorship prevents recommendation.',
  replay_digest:hash({combat:combat.map(c=>c.replay_digest),resources:resources.map(r=>r.replay_digest)}),
  analysis_note:'Floating means and confidence intervals are analysis only. Wilson binomial and union-bounded paired score intervals assume these fixed pseudorandom seeds represent the declared encounter distribution; they do not prove fun, universal balance, physical dice fairness or deployment safety.'};
}
