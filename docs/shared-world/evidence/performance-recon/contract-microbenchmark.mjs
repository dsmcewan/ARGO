#!/usr/bin/env node
/** Read-only contract microbenchmark. No providers, ledger writes or acceptance verdict. */
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {platform,arch} from 'node:os';

const root=resolve(process.argv[2]??'.');
const paths=[
 'packages/contracts/src/shared-world.ts','packages/contracts/src/shared-world-types.ts',
 'SYSTEMS/shared-world-v1/world.schema.json','TESTS/shared-world-contract-fixtures.ts',
 'TESTS/mortal-fixtures.ts','packages/contracts/src/index.ts','packages/contracts/src/mortal-v3.ts',
 'packages/contracts/src/mortal-v3-types.ts','packages/contracts/src/dialogue-knowledge.ts',
 'packages/contracts/src/dialogue-knowledge-types.ts','packages/contracts/src/character-types.ts',
 'SYSTEMS/argo-v1.schema.json','SYSTEMS/characters-v1/characters.schema.json',
 'SYSTEMS/mortal-v3/mortal.schema.json','SYSTEMS/dialogue-knowledge-v1/knowledge.schema.json',
 'package.json','package-lock.json',
];
async function identities(){return Object.fromEntries(await Promise.all(paths.map(async path=>[path,createHash('sha256').update(await readFile(join(root,path))).digest('hex')])));}
async function gitHead(){
 const dotGit=join(root,'.git');let directory=dotGit;
 try{const marker=await readFile(dotGit,'utf8');if(!marker.startsWith('gitdir: '))throw Error('Unknown Git marker');directory=resolve(root,marker.slice(8).trim());}
 catch(error){if(error.code!=='EISDIR')throw error;}
 // Detached worktrees yield a full SHA. Symbolic refs remain honestly labeled;
 // this runner never launches Git or any subprocess.
 return (await readFile(join(directory,'HEAD'),'utf8')).trim();
}
const before=await identities(),headBefore=await gitHead();
const imported=path=>import(pathToFileURL(join(root,path)).href);
const {hash}=await imported('packages/contracts/src/index.ts');
const {assertWorldContract}=await imported('packages/contracts/src/shared-world.ts');
const {worldGenesis,worldState}=await imported('TESTS/shared-world-contract-fixtures.ts');
const genesis=worldGenesis(),rows=[];
for(const n of [128,512,1000,2000]){
 const state=worldState();state.cursor={sequence:n,head:'a'.repeat(64),world_time:0};
 state.memories=Array.from({length:n},(_,i)=>({
  record_id:hash({domain:'shared-world/0.1.0/memory',genesis_hash:state.genesis_hash,request_id:`request_${i+1}`,sequence:i+1}),
  request_id:`request_${i+1}`,sequence:i+1,world_time:0,actor_id:'hero',acquired_by:['hero'],
  payload:{type:'speak',text:'x'.repeat(240),audience:{kind:'self',addressed_actor_ids:[]},in_reply_to:null},
 }));
 assertWorldContract('State',state,genesis);
 const measurements={};
 for(const [name,fn] of [
  ['guard',()=>assertWorldContract('State',state,genesis)],
  ['hash',()=>{const {cursor,...rest}=state;return hash({...rest,cursor:{sequence:cursor.sequence,world_time:cursor.world_time}});}],
  ['clone',()=>structuredClone(state)],
 ]){
  const samples=[];for(let i=0;i<7;i++){const start=performance.now();fn();samples.push(performance.now()-start);}
  const ordered=[...samples].sort((a,b)=>a-b);
  measurements[name]={samples_ms:samples.map(x=>+x.toFixed(4)),median_ms:+ordered[3].toFixed(4)};
 }
 rows.push({memories:n,json_bytes:Buffer.byteLength(JSON.stringify(state)),...measurements});
}
const after=await identities(),headAfter=await gitHead();
const unchanged=JSON.stringify(before)===JSON.stringify(after)&&headBefore===headAfter;
console.log(JSON.stringify({
 kind:'provisional_mutable_contract_microbenchmark',measured_at_utc:new Date().toISOString(),
 root,node_version:process.version,platform:platform(),architecture:arch(),
 git_head_contents_before:headBefore,git_head_contents_after:headAfter,
 source_sha256_before:before,source_sha256_after:after,observed_sources_unchanged:unchanged,
 methodology:{samples:7,reported_statistic:'median',memory_shape:'240-character self-addressed player speech; one row per sequence; no impressions or loans',
  fixture_setup_timed:false,schema_compilation_timed:false,guard:'assertWorldContract(State, state, genesis)',
  hash:'Existing canonical hash of aggregate state excluding cursor.head; not a production worldStateHash implementation',
  clone:'structuredClone(state)',signed_history:false,sqlite:false,provider_calls:0,
  acceptance_verdict:false,caveat:'Single-process synthetic draft measurement, not session latency, cold replay, signed-journal throughput or unique acceptance evidence. Fixture keys are generated in memory and not exported.'},
 rows,
},null,2));
if(!unchanged)process.exitCode=1;
