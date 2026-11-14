import {test} from 'node:test';
import assert from 'node:assert/strict';
import {combatArms,combatGenesis,trialSeed,initialDie} from '../scenarios/tempted-fates/balance/fixtures.ts';
import {runCombatTrial,runResourceTrial,runStudy,compareCombatRows,RESOURCE_CASES} from '../scenarios/tempted-fates/balance/runner.ts';
import {hash} from '../packages/contracts/src/index.ts';
import {wilson,pairedDifference,assessTarget} from '../scenarios/tempted-fates/balance/statistics.ts';

test('balance preregistration pairs HP/armor/policies without reusing held-out seeds',()=>{
 assert.equal(combatArms().length,21);
 const seeds=new Set<string>();
 for(const phase of ['train','holdout','pilot'] as const)for(let i=0;i<32;i++)seeds.add(trialSeed(phase,i));
 assert.equal(seeds.size,96);
 for(let i=0;i<8;i++){
  const raw=initialDie('train',i);
  for(const arm of combatArms()){
   const g=combatGenesis('train',i,arm);
   assert.equal(g.actors[0]!.max_hp,arm.hp==='classic'?raw:Math.max(4,raw));
   assert.equal(g.seed,trialSeed('train',i));
   assert.equal(g.actors[0]!.resources.rations,1);
  }
 }
 assert.throws(()=>trialSeed('train',-1));assert.throws(()=>trialSeed('train',0.5));
});

test('balance intervals preserve exact paired counts and do not invent certainty',()=>{
 assert.deepEqual(wilson(0,0),null);
 const none=wilson(0,500)!,all=wilson(500,500)!;
 assert.equal(none.low,0);assert.ok(none.high>0);assert.equal(all.high,1);assert.ok(all.low<1);
 const pair=pairedDifference([1,1,0,0],[0,1,1,0]);
 assert.deepEqual(pair.counts,{improved:1,worsened:1,both:1,neither:1});assert.equal(pair.mean,0);
 assert.equal(assessTarget({count:500,incapacitated:0,escaped:500,censoredPairs:0,paired:pairedDifference(Array(500).fill(1),Array(500).fill(1))}).status,'miss');
});

test('balance uses genuine reducer transitions and replay for every combat endpoint',()=>{
 for(const arm of combatArms()){
  const a=runCombatTrial('train',2,arm),b=runCombatTrial('train',2,arm);
  assert.deepEqual(a,b);assert.equal(a.replay_verified,true);assert.equal(a.actions,a.sequence);
  assert.equal(a.world_seconds,a.charged_rounds*6);
  assert.equal(a.replay_digest,a.transition_digest);
  assert.equal(Number(a.standing)+Number(a.unconscious)+Number(a.dead),1);
  if(a.escaped){assert.equal(a.standing,true);assert.equal(a.location,'arena');}
 }
});

test('immediate retreat cannot win an encounter by secretly attacking',()=>{
 const arm=combatArms().find(a=>a.id==='solo_classic_a11_immediate')!;
 for(let i=0;i<12;i++){
  const row=runCombatTrial('train',i,arm);
  assert.equal(row.player_attacks,0);assert.equal(row.won,false);
  assert.ok(row.escaped||row.unconscious||row.dead);
 }
});

test('bounded trials report censorship rather than silently dropping hard seeds',()=>{
 const arm=combatArms()[0]!;
 const row=runCombatTrial('train',0,arm,{maxActions:1,maxRounds:1});
 assert.equal(row.censored,true);assert.equal(row.actions,1);assert.equal(row.replay_verified,true);
});

test('resource stress executes legal light, discovery, forage, food and rest boundaries',()=>{
 for(const scenario of RESOURCE_CASES){const a=runResourceTrial('train',0,scenario),b=runResourceTrial('train',0,scenario);assert.deepEqual(a,b);assert.equal(a.replay_verified,true);}
 const exact=runResourceTrial('train',0,'light_exact'),short=runResourceTrial('train',0,'light_short');
 assert.equal(exact.objective_completed,true);assert.equal(exact.resources.oil,0);
 assert.equal(short.objective_completed,false);assert.equal(short.location,'cave');assert.equal(short.refusals,1);
 const search=runResourceTrial('train',0,'search_forage');assert.ok(search.refusals>=1);assert.equal(search.forage_remaining,0);
 const fed=runResourceTrial('train',0,'needs_prepared'),hungry=runResourceTrial('train',0,'needs_short');
 assert.equal(fed.hp,8);assert.ok(hungry.hp<8);assert.equal(fed.resources.rations,0);assert.equal(fed.resources.water,0);
 const rest=runResourceTrial('train',0,'rest_prepared');assert.equal(rest.rests,2);assert.ok(rest.refusals>=1);
 const shortRest=runResourceTrial('train',0,'rest_short');assert.equal(shortRest.rests,1);assert.ok(shortRest.refusals>=2);
 const isolation=runResourceTrial('train',0,'clock_isolation');assert.equal(isolation.active_seconds,0);assert.equal(isolation.world_seconds,14400);assert.equal(isolation.resources.rations,1);
});

test('study rejects undersized claims while small test studies retain every arm and seed',()=>{
 assert.throws(()=>runStudy({phase:'train',trials:2}),/500/);
 const a=runStudy({phase:'train',trials:2,smallTest:true});
 assert.equal(a.study_eligible,false);assert.equal(a.combat.length,21);assert.equal(a.total_combat_trials,42);
 assert.ok(a.combat.every(c=>c.count===2));assert.equal(a.resources.length,RESOURCE_CASES.length);
 assert.equal(a.recommendation,'insufficient-study');
});


test('paired score bounds retain uncertainty for all-equal, all-improved and all-worsened samples',()=>{
 const ones=Array<number>(500).fill(1),zeros=Array<number>(500).fill(0);
 for(const purpose of ['descriptive','target'] as const){
  const same=pairedDifference(ones,ones,purpose),up=pairedDifference(ones,zeros,purpose),down=pairedDifference(zeros,ones,purpose);
  assert.ok(same.interval.low<0&&same.interval.high>0);
  assert.ok(same.interval.high>.001,'A zero-discordance sample must not exclude a tiny unseen improvement with certainty');
  assert.ok(up.interval.low<1);assert.equal(up.interval.high,1);
  assert.equal(down.interval.low,-1);assert.ok(down.interval.high>-1);
  assert.equal(same.marginal_one_sided_alpha,purpose==='target'?.00625:.0125);
 }
 const descriptive=pairedDifference(ones,zeros),target=pairedDifference(ones,zeros,'target');
 assert.ok(target.interval.low<descriptive.interval.low);
 assert.deepEqual(pairedDifference([],[]).interval,{low:-1,high:1});
});

test('shared train and heldout comparison suppresses terminal inference for a censored pair in either arm',()=>{
 const fight=Array.from({length:500},(_,i)=>({standing:i<300,unconscious:i>=300,dead:false,escaped:false,censored:false}));
 const escape=Array.from({length:500},(_,i)=>({standing:i<450,unconscious:i>=450,dead:false,escaped:i<450,censored:false}));
 assert.equal(compareCombatRows(fight,escape).target.status,'match');
 for(const arm of [fight,escape]){
  arm[0]!.censored=true;
  const comparison=compareCombatRows(fight,escape);
  assert.equal(comparison.censored_pairs,1);assert.equal(comparison.paired95,null);
  assert.equal(comparison.target.status,'inconclusive');assert.equal(comparison.target.reason,'censored-comparison');
  assert.equal(comparison.target.delta,null);arm[0]!.censored=false;
 }
});

test('retained compact seed rows reconstruct exact outcomes and aggregate commitments',()=>{
 const study=runStudy({phase:'train',trials:2,smallTest:true});
 for(const cell of study.combat){
  const rows=cell.seed_rows.rows.map(values=>Object.fromEntries(cell.seed_rows.columns.map((column,i)=>[column,values[i]])));
  assert.deepEqual(rows.map(r=>r.trial),[0,1]);
  const full=rows.map(row=>({...row,arm:cell.arm.id}));
  assert.equal(hash(full),cell.integer_results_digest);
  assert.equal(hash(rows.map(row=>({trial:row.trial,digest:row.replay_digest}))),cell.replay_digest);
  assert.equal(cell.endpoints.standing_at_stop,cell.endpoints.terminal_standing);
 }
 for(const cell of study.resources){
  const rows=cell.seed_rows.rows.map(values=>Object.fromEntries(cell.seed_rows.columns.map((column,i)=>[column,values[i]])));
  assert.deepEqual(rows.map(r=>r.trial),[0,1]);
  assert.equal(hash(rows.map(row=>({...row,scenario:cell.scenario}))),cell.integer_results_digest);
  assert.equal(hash(rows.map(row=>({trial:row.trial,digest:row.replay_digest}))),cell.replay_digest);
 }
});
