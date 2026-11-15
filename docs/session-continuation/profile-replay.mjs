#!/usr/bin/env node
/** Ordinary-process diagnostic. Build exactly one signed campaign fixture, then
 * profile replay in a fresh process. No key is persisted; no product hooks. */
import assert from 'node:assert/strict';
import {generateKeyPairSync,createHash} from 'node:crypto';
import {mkdir,readFile,writeFile,chmod,stat} from 'node:fs/promises';
import {resolve,join,relative} from 'node:path';
import {pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
import {Session} from 'node:inspector/promises';

process.umask(0o077);
const args=process.argv.slice(2);
function option(name,fallback){const i=args.indexOf(name);return i<0?fallback:args[i+1];}
const mode=option('--mode'),repo=resolve(option('--repo','/workspace/ARGO')),output=resolve(option('--output',import.meta.dirname)),source=option('--source');
assert.ok(['build','profile'].includes(mode));assert.match(source??'',/^[a-f0-9]{40}$/);
assert.equal(Object.hasOwn(process.env,'NODE_TEST_CONTEXT'),false,'Use an ordinary process');
const sha=value=>createHash('sha256').update(value).digest('hex');
const mod=path=>import(pathToFileURL(join(repo,path)).href);
const {canonical,hash}=await mod('packages/contracts/src/index.ts');
const {createWorldEvent,replayWorld}=await mod('packages/ledger/src/world/journal.ts');
const {initialWorldState,worldStateHash}=await mod('packages/ledger/src/world/rules.ts');
const {ownWorldGenesis}=await mod('packages/ledger/src/world/rules/ownership.ts');
const sourcePaths=['packages/ledger/src/world/journal.ts','packages/ledger/src/world/rules/engine.ts','packages/ledger/src/world/rules/ownership.ts','packages/contracts/src/shared-world.ts','packages/contracts/src/index.ts','packages/contracts/src/mortal-v3.ts','packages/ledger/src/mortal-v3/rules.ts','scenarios/tempted-fates/shared-world/seed.ts'];
const sourceHashes=Object.fromEntries(await Promise.all(sourcePaths.map(async path=>[path,sha(await readFile(join(repo,path)))])));
const fixtureDir=join(output,'private-fixture'),fixturePath=join(fixtureDir,'signed-fixture.json');
await mkdir(output,{recursive:true,mode:0o700});await chmod(output,0o700);
async function save(path,value){await writeFile(path,JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});}
if(mode==='build'){
 const count=Number(option('--events','512'));assert.equal(count,512,'This diagnostic is bounded to the authorized 512-event fixture');
 const {buildSharedWorldCampaign}=await mod('scenarios/tempted-fates/shared-world/seed.ts');
 const pack=JSON.parse(await readFile(join(repo,'scenarios/tempted-fates/campaign/world.json'),'utf8'));
 const keys=generateKeyPairSync('ed25519');
 const scope={tenant_id:'measurement',rights_lane:'homebrew',workspace_id:'offline',workspace_tenant_id:'measurement:homebrew:offline',campaign_id:'fates',world_id:'cold_profile',branch_id:'main'};
 const {genesis:raw}=buildSharedWorldCampaign(pack,{
  scope,seed:'87'.repeat(32),authority_key_id:'cold_profile_key',authority_public_key:keys.publicKey.export({type:'spki',format:'pem'}).toString(),
  referee_id:'host',npc_controller_id:'npc_host',variant:'legend',hp_mode:'floor4',environment:'night',starting_kit:'borrowed_lamp',initial_knowledge_ids:['melia_lamp_loan_offer'],
  travelers:[{id:'hero',name:'Ariadne',controller_id:'auth_hero',weapon:'spear',nature:{description:'Careful and direct.',priorities:['keep promises']},presentation:{occupation:'Traveler',wants:'Find a safe route.',will_not:'Accept an unknown obligation.'},max_speech_characters:240}],
 });
 const genesis=ownWorldGenesis(raw),genesisHash=hash(genesis),events=[];let state=initialWorldState(genesis);
 const hero={scope,principal_id:'auth_hero',actor_id:'hero',role:'player'},npc={scope,principal_id:'npc_host',actor_id:'melia',role:'npc'};
 const started=performance.now();
 for(let i=1;i<=count;i++){
  const replying=i%2===0,principal=replying?npc:hero;
  const action=replying?{type:'speak',text:'It is a free loan. Bring it back and supply your own oil.',audience:{kind:'whisper',addressed_actor_ids:['hero']},in_reply_to:events.at(-1).memory.record_id}:{type:'speak',text:`Question ${i}: May I borrow the lamp without a deposit?`,audience:{kind:'whisper',addressed_actor_ids:['melia']},in_reply_to:null};
  const command={version:genesis.version,scope,request_id:`observation_${i}`,actor_id:principal.actor_id,expected:{...state.cursor},causation_id:state.cursor.head,action};
  const created=createWorldEvent(genesis,state,command,principal,keys.privateKey);events.push(created.event);state=created.state;
 }
 const creationMs=performance.now()-started,fixture={genesis,events,expected_state:state},bytes=Buffer.from(canonical(fixture));
 await mkdir(fixtureDir,{mode:0o700});await writeFile(fixturePath,bytes,{mode:0o600,flag:'wx'});
 const manifest={source,node:process.version,platform:process.platform,test_runner:false,paid_calls:0,fixture_events:count,fixture_bytes:bytes.length,fixture_sha256:sha(bytes),genesis_hash:genesisHash,terminal_state_hash:worldStateHash(state),terminal_event_hash:state.cursor.head,terminal_state_bytes:Buffer.byteLength(canonical(state)),fixture_creation_ms:creationMs,fixture_creation_profiled:false,fixture_schema:['genesis','events','expected_state'],fixture_private_mode:'0700 directory / 0600 file; generated private key never persisted',source_sha256:sourceHashes,harness_sha256:sha(await readFile(import.meta.filename))};
 await save(join(output,'fixture-manifest.json'),manifest);
 console.log(JSON.stringify({stage:'fixture-built',events:count,fixture_creation_ms:creationMs,fixture_sha256:manifest.fixture_sha256,terminal_state_hash:manifest.terminal_state_hash}));
}else{
 const manifest=JSON.parse(await readFile(join(output,'fixture-manifest.json'),'utf8'));assert.equal(manifest.source,source);assert.deepEqual(sourceHashes,manifest.source_sha256);
 assert.equal((await stat(fixtureDir)).mode&0o777,0o700);assert.equal((await stat(fixturePath)).mode&0o777,0o600);
 const bytes=await readFile(fixturePath);assert.equal(sha(bytes),manifest.fixture_sha256);
 const fixture=JSON.parse(bytes.toString('utf8'));assert.equal(fixture.events.length,512);
 const session=new Session();session.connect();await session.post('Profiler.enable');await session.post('Profiler.setSamplingInterval',{interval:1000});
 const beforeMemory=process.memoryUsage(),beforeCpu=process.cpuUsage();
 await session.post('Profiler.start');const started=performance.now();let state,elapsed,profile;
 try{state=replayWorld(fixture.genesis,fixture.events);elapsed=performance.now()-started;}finally{({profile}=await session.post('Profiler.stop'));session.disconnect();}
 const cpu=process.cpuUsage(beforeCpu),afterMemory=process.memoryUsage();
 assert.deepEqual(state,fixture.expected_state);assert.equal(worldStateHash(state),manifest.terminal_state_hash);
 await save(join(output,'replay.cpuprofile'),profile);
 const nodes=new Map(profile.nodes.map(node=>[node.id,node])),parent=new Map();for(const node of profile.nodes)for(const child of node.children??[])parent.set(child,node.id);
 const key=node=>JSON.stringify([node.callFrame.functionName||'(anonymous)',node.callFrame.url,node.callFrame.lineNumber,node.callFrame.columnNumber]);
 const aggregates=new Map();
 function item(node){const id=key(node);let row=aggregates.get(id);if(!row){let url=node.callFrame.url;if(url.startsWith('file://'))url=new URL(url).pathname;if(url.startsWith(repo+'/'))url=relative(repo,url);row={function:node.callFrame.functionName||'(anonymous)',url,line:node.callFrame.lineNumber+1,column:node.callFrame.columnNumber+1,self_us:0,inclusive_us:0};aggregates.set(id,row);}return row;}
 let totalUs=0;
 for(let i=0;i<(profile.samples??[]).length;i++){
  const dt=profile.timeDeltas?.[i]??0;totalUs+=dt;let id=profile.samples[i];const leaf=nodes.get(id);if(!leaf)continue;item(leaf).self_us+=dt;
  const seen=new Set();while(id!==undefined){const node=nodes.get(id);if(!node)break;const idKey=key(node);if(!seen.has(idKey)){item(node).inclusive_us+=dt;seen.add(idKey);}id=parent.get(id);}
 }
 const rows=[...aggregates.values()].map(row=>({...row,self_ms:row.self_us/1000,inclusive_ms:row.inclusive_us/1000,self_percent:100*row.self_us/totalUs,inclusive_percent:100*row.inclusive_us/totalUs}));
 const bySource=new Map();for(const row of rows){const name=row.url||row.function;bySource.set(name,(bySource.get(name)??0)+row.self_us);}
 const record={source,node:process.version,platform:process.platform,test_runner:false,paid_calls:0,fixture_events:fixture.events.length,fixture_sha256:manifest.fixture_sha256,genesis_hash:manifest.genesis_hash,terminal_state_hash:worldStateHash(state),replay_equals_expected_state:true,replay_ms:elapsed,cpu_usage_us:cpu,memory_before:beforeMemory,memory_after:afterMemory,sampling_interval_us:1000,profile_samples:profile.samples?.length??0,sampled_time_ms:totalUs/1000,profile_span_ms:(profile.endTime-profile.startTime)/1000,profile_sha256:sha(await readFile(join(output,'replay.cpuprofile'))),harness_sha256:sha(await readFile(import.meta.filename)),source_sha256:sourceHashes,top_self:[...rows].sort((a,b)=>b.self_us-a.self_us).slice(0,35),top_inclusive:[...rows].sort((a,b)=>b.inclusive_us-a.inclusive_us).slice(0,35),self_by_source:[...bySource].map(([url,us])=>({url,self_ms:us/1000,self_percent:100*us/totalUs})).sort((a,b)=>b.self_ms-a.self_ms),limits:['One sampled ordinary-process pure replay; imports, fixture generation and fixture parsing excluded from CPU profiling.','No SQLite worker, persisted receipt verification, first snapshot transport or provider latency measured.','Sampled self/inclusive attribution is diagnostic, not an additive causal speedup estimate; inclusive rows overlap.','Fixture generated by baseline authority and replayed in a fresh process; exact full resulting state and terminal hash matched.','90-second external process deadline bounds this replay diagnostic; no production instrumentation.']};
 await save(join(output,'measurement.json'),record);
 console.log(JSON.stringify({stage:'profile-complete',events:fixture.events.length,replay_ms:elapsed,terminal_state_hash:record.terminal_state_hash,top_self:record.top_self.slice(0,8),self_by_source:record.self_by_source.slice(0,8)}));
}
