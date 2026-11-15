// One edge into ARGO's trusted supervisor. Peers propose; only the separate
// application controller accepts code. This module never creates a vendor client.
import {resolve,dirname,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnPromise} from './spawn.mjs';

export const MESH_SHUTDOWN_GRACE_MS=60000;
const SCRIPT=resolve(dirname(fileURLToPath(import.meta.url)),'../../../tools/mesh_dispatch.py');
const HASH=/^[a-f0-9]{64}$/,COMMIT=/^[a-f0-9]{40}$/;
const ID=/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;
const refuse=message=>{throw new Error(`blackboard mesh refused: ${message}`);};
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const bounded=(value,limit)=>typeof value==='string'&&value.length>0&&Buffer.byteLength(value)<=limit&&!value.includes('\0');
function integer(value,min,max,name){if(!Number.isSafeInteger(value)||value<min||value>max)refuse(`invalid ${name}`);}
function number(value,min,max,name){if(typeof value!=='number'||!Number.isFinite(value)||value<=min||value>max)refuse(`invalid ${name}`);}
function argv(value){
 if(!Array.isArray(value)||value.length<1||value.length>256||!bounded(value[0],65536)||value.some(v=>typeof v!=='string'||v.includes('\0'))||value.reduce((n,v)=>n+Buffer.byteLength(v),0)>65536)refuse('command must be a bounded argv array');
}
function resultContract(parsed,{offline,seatModel,maxTickets,peers,rounds,boardDir}){
 if(!object(parsed)||parsed.mode!==(offline?'offline':'dry-run')||parsed.requested_seat_model!==(seatModel??null))refuse('mismatched result mode or scheduling label');
 for(const key of ['approved','merged','shipped','gate_passed','lease_token'])if(Object.hasOwn(parsed,key))refuse('transport cannot report application acceptance or capabilities');
 if(!offline){if(parsed.results!==undefined&&(!Array.isArray(parsed.results)||parsed.results.length))refuse('dry-run reported execution');return;}
 if(!Array.isArray(parsed.results)||parsed.results.length>maxTickets)refuse('invalid result count');
 const attempts=new Set();
 for(const row of parsed.results){
  if(!object(row)||typeof row.id!=='string'||!(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/).test(row.id)||!['failed','VERIFYING'].includes(row.status))refuse('invalid ticket state; this edge cannot accept merges');
  integer(row.epoch,1,Number.MAX_SAFE_INTEGER,'result epoch');
  const key=JSON.stringify([row.id,row.epoch]);if(attempts.has(key))refuse('duplicate attempt result');attempts.add(key);
  if(Object.hasOwn(row,'lease_token'))refuse('result contains a supervisor capability');
  if(row.status==='failed'){if(!bounded(row.error,2048))refuse('missing bounded failure');continue;}
  if(!COMMIT.test(row.candidate_commit??'')||!COMMIT.test(row.base_commit??'')||!HASH.test(row.spec_sha256??''))refuse('invalid candidate binding');
  if(!Array.isArray(row.artifacts)||row.artifacts.length>256)refuse('invalid artifact count');
  const paths=new Set();
  for(const artifact of row.artifacts){
   if(!object(artifact)||!bounded(artifact.logical_path,4096)||isAbsolute(artifact.logical_path)||artifact.logical_path.includes('\\')||artifact.logical_path.split('/').some(p=>!p||p==='.'||p==='..'||p==='.git'||p==='.board')||!HASH.test(artifact.sha256??'')||paths.has(artifact.logical_path))refuse('invalid artifact reference');
   paths.add(artifact.logical_path);
  }
  const mesh=row.mesh;
  if(!object(mesh)||mesh.protocol!=='argo.mesh/1'||mesh.status!=='completed'||!HASH.test(mesh.scope??'')||!HASH.test(mesh.trace_sha256??'')||mesh.candidate_commit!==row.candidate_commit||mesh.rounds!==rounds||JSON.stringify(mesh.peer_ids)!==JSON.stringify(peers.map(p=>p.id)))refuse('invalid Mesh trace correlation');
  const scope=createHash('sha256').update(JSON.stringify({base_commit:row.base_commit,candidate_commit:row.candidate_commit,epoch:row.epoch,spec_sha256:row.spec_sha256,ticket_id:row.id})).digest('hex');
  if(mesh.scope!==scope)refuse('Mesh scope differs from the exact attempt binding');
  if(mesh.trace_path!==resolve(boardDir,'mesh-traces',mesh.scope+'.jsonl'))refuse('trace path is outside this board attempt');
 }
}

export async function runBlackboardMesh(options={}, {runner=spawnPromise}={}){
 if(!object(options)||typeof runner!=='function')refuse('invalid supervisor options');
 const {repo,boardDir,command,peers=[],seatModel,workerId=`mesh-edge-${process.pid}`,parallel=1,maxTickets=1,rounds=2,timeout=300,meshTimeout=120,leaseSeconds=900,offline=false,signal,python='python3'}=options;
 if(!bounded(repo,4096)||typeof offline!=='boolean'||!bounded(python,4096)||!bounded(workerId,128)||(seatModel!==undefined&&!bounded(seatModel,128)))refuse('invalid repository, mode, executable or scheduling label');
 if(boardDir!==undefined&&!bounded(boardDir,4096))refuse('invalid board directory');
 integer(parallel,1,8,'parallel');integer(maxTickets,1,100,'maxTickets');integer(rounds,2,8,'rounds');
 number(timeout,0,3600,'timeout');number(meshTimeout,0,300,'meshTimeout');integer(leaseSeconds,3,3600,'leaseSeconds');
 if(offline){
  argv(command);if(!bounded(seatModel,128))refuse('offline execution requires an explicit scheduling label');
  if(!Array.isArray(peers)||peers.length!==3||new Set(peers.map(p=>p?.id)).size!==3)refuse('exactly three distinct peers required');
  for(const peer of peers){
   if(!object(peer)||JSON.stringify(Object.keys(peer).sort())!==JSON.stringify(['command','id'])||!ID.test(peer.id)||peer.id==='mesh-supervisor')refuse('invalid peer identity or fields');
   argv(peer.command);
  }
 }
 signal?.throwIfAborted();
 const repository=resolve(repo),board=resolve(boardDir??resolve(repository,'.board'));
 const args=[SCRIPT,'--repo',repository,'--board-dir',board,'--worker-id',workerId,'--parallel',String(parallel),'--max-tickets',String(maxTickets),'--mesh-rounds',String(rounds),'--timeout',String(timeout),'--mesh-timeout',String(meshTimeout),'--lease-seconds',String(leaseSeconds)];
 if(seatModel!==undefined)args.push('--seat-model',seatModel);
 if(offline)args.push('--offline','--command-json',JSON.stringify(command),'--peer-commands-json',JSON.stringify(peers));
 // The author deadline does not cover later peer rounds or subsequent jobs.
 // SIGTERM asks Python to cancel/drain separate worker groups; allow that cleanup
 // before escalation. A forced kill is a failed transport, never a completion.
 const result=await runner(python,args,{cwd:repository,env:{PATH:process.env.PATH??'/usr/bin:/bin',LANG:'C.UTF-8',HOME:'/nonexistent',PYTHONNOUSERSITE:'1'},signal,
  timeout:maxTickets*(timeout+meshTimeout+120)*1000+MESH_SHUTDOWN_GRACE_MS,killGraceMs:MESH_SHUTDOWN_GRACE_MS,maxBuffer:8*1024*1024});
 if(!object(result)||result.status!==0||result.killedFor||result.signal)refuse(`supervisor transport failed (${result?.killedFor??result?.status??'no status'}): ${String(result?.stderr??'').slice(-2048)}`);
 if(typeof result.stdout!=='string'||Buffer.byteLength(result.stdout)>8*1024*1024)refuse('invalid bounded supervisor result');
 let parsed;try{parsed=JSON.parse(result.stdout);}catch{refuse('supervisor did not return one JSON document');}
 resultContract(parsed,{offline,seatModel,maxTickets,peers,rounds,boardDir:board});
 return {...parsed,transport_exit:0};
}
