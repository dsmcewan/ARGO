#!/usr/bin/env node
/** Offline, ordinary-process measurement of the real signed shared store.
 * Not a CI timing assertion. Requires the completed shared-world runtime.
 * Usage: node docs/shared-world/measure-runtime.mjs --output /tmp/argo-measure
 */
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {mkdtemp, readFile, mkdir, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve, join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {performance, monitorEventLoopDelay} from 'node:perf_hooks';
import {execFileSync} from 'node:child_process';

const args = process.argv.slice(2);
function option(name, fallback) {
 const i = args.indexOf(name);
 if (i < 0) return fallback;
 if (!args[i + 1] || args[i + 1].startsWith('--')) throw Error(`Missing ${name} value`);
 return args[i + 1];
}
if (Object.hasOwn(process.env, 'NODE_TEST_CONTEXT')) throw Error('Run outside the test runner');
const repo = resolve(option('--repo', join(import.meta.dirname, '../..')));
const output = resolve(option('--output', join(tmpdir(), 'argo-shared-world-measurement')));
const targets = [128, 512, 1000, 2000];
const mod = async path => import(pathToFileURL(join(repo, path)).href);
const {hash, WORLD_PROFILE} = await mod('packages/contracts/src/index.ts');
const {openWorldLedger, viewWorldActor, worldStateHash, replayWorld} = await mod('packages/ledger/src/index.ts');
const {createWorldModelAgent} = await mod('packages/interventions/src/index.ts');
const {buildSharedWorldCampaign} = await mod('scenarios/tempted-fates/shared-world/seed.ts');
const pack = JSON.parse(await readFile(join(repo, 'scenarios/tempted-fates/campaign/world.json'), 'utf8'));
const keys = generateKeyPairSync('ed25519');
const scope = {tenant_id:'measurement', rights_lane:'homebrew', workspace_id:'offline', workspace_tenant_id:'measurement:homebrew:offline', campaign_id:'fates', world_id:'measurement', branch_id:'main'};
const {genesis} = buildSharedWorldCampaign(pack, {
 scope, seed:'87'.repeat(32), authority_key_id:'measurement_key', authority_public_key:keys.publicKey.export({type:'spki',format:'pem'}).toString(),
 referee_id:'host', npc_controller_id:'npc_host', variant:'legend', hp_mode:'floor4', environment:'night', starting_kit:'borrowed_lamp', initial_knowledge_ids:['melia_lamp_loan_offer'],
 travelers:[{id:'hero', name:'Ariadne', controller_id:'auth_hero', weapon:'spear', nature:{description:'Careful and direct.', priorities:['keep promises']}, presentation:{occupation:'Traveler', wants:'Find a safe route.', will_not:'Accept an unknown obligation.'}, max_speech_characters:240}],
});
const principal = {scope, principal_id:'auth_hero', actor_id:'hero', role:'player'};
const npcPrincipal = {scope, principal_id:'npc_host', actor_id:'melia', role:'npc'};
const genesisHash = hash(genesis);
const memoryId = sequence => hash({domain:'shared-world/0.1.0/memory',genesis_hash:genesisHash,request_id:`observation_${sequence}`,sequence});
const directory = await mkdtemp(join(tmpdir(), 'argo-shared-runtime-'));
const path = join(directory, 'world.db');
let writer, sibling;
const rows = [], eventLoop = monitorEventLoopDelay({resolution:10});
eventLoop.enable();
const elapsed = async operation => {const start = performance.now(); const value = await operation(); return {value, ms:performance.now()-start};};
const median = values => [...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
async function samples(operation) {const values=[];for(let n=0;n<5;n++) values.push((await elapsed(operation)).ms);return {median_ms:median(values),samples_ms:values};}
try {
 const options = {path, genesis, privateKey:keys.privateKey};
 writer = await openWorldLedger(options);
 let cursor = (await writer.snapshot()).cursor;
 const command = () => ({version:WORLD_PROFILE, scope, request_id:`observation_${cursor.sequence+1}`, actor_id:'hero', expected:cursor, causation_id:cursor.head,
  action:{type:'speak', text:`Question ${cursor.sequence+1}: May I borrow the lamp without a deposit?`, audience:{kind:'whisper',addressed_actor_ids:['melia']}, in_reply_to:null}});
 const npcCommand = () => ({...command(),actor_id:'melia',action:{type:'speak',text:'It is a free loan. Bring it back and supply your own oil.',audience:{kind:'whisper',addressed_actor_ids:['hero']},in_reply_to:memoryId(cursor.sequence)}});
 for (const target of targets) {
  const fillStart = performance.now();
  while (cursor.sequence < target) {
   const npc=cursor.sequence%2===1;
   cursor = (await writer.submit(npc?npcCommand():command(),npc?npcPrincipal:principal)).cursor;
  }
  const fill_ms = performance.now()-fillStart;
  const snap = await writer.snapshot();
  const currentQuery = () => ({version:WORLD_PROFILE,scope,actor_id:'melia',cursor});
  const snapshot = await samples(() => writer.snapshot());
  const scoped_view = await samples(async () => viewWorldActor(genesis,await writer.snapshot(),currentQuery(),npcPrincipal));
  const opening = await elapsed(() => openWorldLedger({...options,expectedHead:cursor}));
  sibling = opening.value;
  assert.equal(worldStateHash(await sibling.snapshot()),worldStateHash(snap));
  const pending = command();
  const append = await elapsed(() => writer.submit(pending,principal));
  cursor = append.value.cursor;
  const retry = await samples(async () => assert.deepEqual(await writer.submit(pending,principal),append.value));
  const refresh = await elapsed(() => sibling.snapshot());
  assert.deepEqual(refresh.value.cursor,cursor);
  let modelCalls=0,contextReads=0;
  const agent=createWorldModelAgent({scope,actorId:'melia',sessionId:'offline_measurement',candidates:[{vendor:'xai',model:'grok-4.7',pool:'injected'}],
   clientFor:()=>({responses:{create:async()=>{modelCalls++;return {id:'fixture',status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({text:'It is a free loan. Bring it back and supply your own oil.'})}]}]};}}}),
   refreshContext:async query=>{contextReads++;return viewWorldActor(genesis,await writer.snapshot(),query,npcPrincipal);},
  });
  const dialogue=await elapsed(async()=>{
   const proposal=await agent.respond(currentQuery(),memoryId(cursor.sequence),`observation_${cursor.sequence+1}`);
   assert.ok(proposal);const receipt=await writer.submit(proposal,npcPrincipal);cursor=receipt.cursor;return receipt;
  });
  assert.equal(modelCalls,1);
  const expected = await writer.snapshot();
  assert.equal(worldStateHash(await sibling.snapshot()),worldStateHash(expected));
  await sibling.close(); sibling = undefined;
  const row={prefix_events:target,after_sample_events:cursor.sequence,fill_ms,cold_handle_open_ms:opening.ms,warm_snapshot:snapshot,warm_scoped_view:scoped_view,
   warm_speech_append_ms:append.ms,warm_contextual_dialogue_and_commit_ms:dialogue.ms,dialogue_context_reads:contextReads,injected_model_calls:modelCalls,
   exact_retry:retry,two_handle_one_event_refresh_ms:refresh.ms,state_bytes:Buffer.byteLength(JSON.stringify(expected)),state_hash:worldStateHash(expected)};
  rows.push(row);process.stdout.write(JSON.stringify(row)+'\n');
 }
 const allEvents=[];
 while (true) {const page=await writer.events({after:allEvents.length,limit:256});if(!page.length)break;allEvents.push(...page);}
 await new Promise(resolve=>setImmediate(resolve));
 eventLoop.disable();
 const host_workload_parent_event_loop_delay_ms={mean:eventLoop.mean/1e6,max:eventLoop.max/1e6,p99:eventLoop.percentile(99)/1e6};
 const replay=await elapsed(()=>replayWorld(genesis,allEvents));
 const final=await writer.snapshot();
 assert.deepEqual(replay.value,final);
 const record={candidate:execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim(),node:process.version,platform:process.platform,
  test_runner:false,paid_calls:0,genesis_hash:hash(genesis),targets,rows,final_sequence:final.cursor.sequence,full_replay_ms:replay.ms,
  replay_equals_snapshot:true,final_state_hash:worldStateHash(final),host_workload_parent_event_loop_delay_ms,
  limits:['One machine; five warm read/retry samples, one append and one suffix refresh per checkpoint.',
   'History-bearing state hashes grow with history; cold replay is not claimed to be linear.',
   'Cold handle opening includes full verification but uses a warmed OS page cache; this is not a cold-disk measurement.',
   'Parent event-loop samples cover the whole host workload, including projection, hashes, JSON sizing and logging; they do not isolate store/worker blocking. The final standalone synchronous forensic replay is measured separately.',
   'Alternating addressed speech in the actual campaign; bulk turns use explicit fixtures and the measured contextual reply uses an injected provider.',
   'No provider latency, combat-load or general graph-scale claim.']};
 await mkdir(output,{recursive:true});await writeFile(join(output,'measurement.json'),JSON.stringify(record,null,2)+'\n');
 process.stdout.write(`Saved ${join(output,'measurement.json')}\n`);
} finally {eventLoop.disable();await sibling?.close();await writer?.close();await rm(directory,{recursive:true,force:true});}
