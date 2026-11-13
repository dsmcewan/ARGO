import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {runBlackboardMesh,MESH_SHUTDOWN_GRACE_MS} from '../src/board/blackboard-mesh.mjs';

const peers=['critic','counterexample','reconciler'].map(id=>({id,command:['/usr/bin/python3','/workspace/peer.py']}));
const options=()=>({repo:'/tmp/mesh-fixture-repo',boardDir:'/tmp/mesh-fixture-board',command:['/usr/bin/python3','/workspace/author.py'],peers,seatModel:'offline-fixture',workerId:'edge-fixture',parallel:2,maxTickets:4,rounds:2,timeout:20,meshTimeout:15,leaseSeconds:900,offline:true});
const response=extra=>({status:0,signal:null,killedFor:null,stdout:JSON.stringify({mode:'offline',requested_seat_model:'offline-fixture',execution:'operator command; no model execution claimed',results:[],...extra}),stderr:''});
const invoke=async (extra,runner)=>runBlackboardMesh({...options(),...extra},{runner});

test('blackboard mesh edge stays dry-run without explicit offline execution',async()=>{
 let call;
 const result=await runBlackboardMesh({repo:'/tmp/repo'},{runner:async(...args)=>{call=args;return response({mode:'dry-run',requested_seat_model:null,board:'status'});}});
 assert.equal(result.mode,'dry-run');assert.equal(result.transport_exit,0);
 assert.ok(!call[1].includes('--offline'));assert.equal(call[0],'python3');
 assert.match(call[1][0],/\/tools\/mesh_dispatch\.py$/);assert.notEqual(call[1][0],'/tmp/repo/tools/mesh_dispatch.py');
});

test('blackboard mesh edge passes structured argv to the single Python supervisor',async()=>{
 let call;
 const result=await invoke({},async(...args)=>{call=args;return response();});
 const [cmd,args,opts]=call;
 assert.equal(cmd,'python3');assert.equal(result.mode,'offline');assert.ok(args.includes('--offline'));
 for(const [flag,value] of [['--parallel','2'],['--max-tickets','4'],['--mesh-rounds','2'],['--mesh-timeout','15'],['--timeout','20']])assert.equal(args[args.indexOf(flag)+1],value);
 assert.deepEqual(JSON.parse(args[args.indexOf('--command-json')+1]),options().command);
 assert.deepEqual(JSON.parse(args[args.indexOf('--peer-commands-json')+1]),peers);
 assert.deepEqual(Object.keys(opts.env).sort(),['HOME','LANG','PATH','PYTHONNOUSERSITE']);
 assert.equal(opts.shell,undefined);assert.equal(opts.cwd,resolve(options().repo));
});

test('blackboard mesh edge validates bounded explicit peer and scheduling inputs before spawn',async()=>{
 let calls=0;const runner=async()=>{calls++;return response();};
 for(const bad of [{parallel:0},{parallel:9},{parallel:true},{maxTickets:101},{rounds:1},{meshTimeout:Infinity},{timeout:0},{leaseSeconds:2},{peers:peers.slice(0,2)},{peers:[peers[0],peers[0],peers[2]]},{peers:[{...peers[0],id:'mesh-supervisor'},peers[1],peers[2]]},{command:'echo run'},{peers:[{...peers[0],command:[]},peers[1],peers[2]]},{repo:''}])await assert.rejects(invoke(bad,runner));
 assert.equal(calls,0);
});

test('blackboard mesh edge keeps transport failure separate from application acceptance',async()=>{
 for(const bad of [{status:1},{status:null,killedFor:'cancelled'},{status:0,killedFor:'timeout'},{stdout:'not json'},{stdout:'[]'},{stdout:JSON.stringify({mode:'offline',requested_seat_model:'wrong-seat',results:[]})}])await assert.rejects(invoke({},async()=>({...response(),...bad})));
 await assert.rejects(invoke({},async()=>response({results:[{id:'T-1',status:'MERGED'}]})),/status|accept|state/i);
 await assert.rejects(invoke({},async()=>response({mode:'dry-run'})));
});

test('blackboard mesh edge rejects overreported or duplicate attempt results',async()=>{
 const failed={id:'T-1',status:'failed',epoch:1,error:'fixture refusal'};
 await assert.rejects(invoke({},async()=>response({results:Array.from({length:5},(_,i)=>({...failed,id:`T-${i}`}))})));
 await assert.rejects(invoke({},async()=>response({results:[failed,failed]})));
 await assert.rejects(invoke({},async()=>response({results:[{id:'T-1',status:'VERIFYING',candidate_commit:'HEAD',artifacts:[]}]})));
});

test('blackboard mesh cancellation has an explicit drain grace and whole-batch deadline',async()=>{
 const controller=new AbortController();let captured;
 await invoke({signal:controller.signal},async(_cmd,_args,opts)=>{captured=opts;return response();});
 assert.equal(captured.signal,controller.signal);
 assert.equal(MESH_SHUTDOWN_GRACE_MS,60000);assert.equal(captured.killGraceMs,MESH_SHUTDOWN_GRACE_MS);
 assert.equal(captured.timeout,4*(20+15+120)*1000+60000);
 controller.abort();let called=false;
 await assert.rejects(invoke({signal:controller.signal},async()=>{called=true;return response();}));assert.equal(called,false);
});

test('blackboard mesh CLI cannot enable offline work through a config file alone',()=>{
 const directory=mkdtempSync(join(tmpdir(),'mesh-edge-cli-'));
 try{
  const config=join(directory,'config.json');writeFileSync(config,JSON.stringify({...options(),offline:true}));
  const cli=fileURLToPath(new URL('../bin/pantheon-mesh.mjs',import.meta.url));
  let caught;try{execFileSync(process.execPath,[cli,'--config',config],{encoding:'utf8',timeout:10000,env:{PATH:process.env.PATH??'/usr/bin:/bin'}});}catch(error){caught=error;}
  assert.ok(caught);assert.match(String(caught.stderr),/offline.*flag|--offline|explicit/i);
  assert.match(execFileSync(process.execPath,[cli,'--help'],{encoding:'utf8',timeout:10000}),/offline/);
 }finally{rmSync(directory,{recursive:true,force:true});}
});

const verifying=()=>{
 const row={id:'T-1',status:'VERIFYING',epoch:1,base_commit:'a'.repeat(40),candidate_commit:'b'.repeat(40),spec_sha256:'c'.repeat(64),artifacts:[{logical_path:'out/a.txt',sha256:'d'.repeat(64)}]};
 const scope=createHash('sha256').update(JSON.stringify({base_commit:row.base_commit,candidate_commit:row.candidate_commit,epoch:row.epoch,spec_sha256:row.spec_sha256,ticket_id:row.id})).digest('hex');
 row.mesh={protocol:'argo.mesh/1',scope,candidate_commit:row.candidate_commit,status:'completed',trace_sha256:'e'.repeat(64),trace_path:join(options().boardDir,'mesh-traces',scope+'.jsonl'),rounds:2,peer_ids:peers.map(p=>p.id)};
 return row;
};

test('blackboard mesh edge accepts a complete attempt binding without claiming acceptance',async()=>{
 const row=verifying(),r=await invoke({},async()=>response({results:[row]}));
 assert.deepEqual(r.results,[row]);assert.equal(r.results[0].status,'VERIFYING');assert.equal(r.merged,undefined);
});

test('blackboard mesh edge derives scope from exact ticket epoch base candidate and spec',async()=>{
 for(const patch of [{id:'T-foreign'},{epoch:2},{base_commit:'f'.repeat(40)},{spec_sha256:'f'.repeat(64)}]){
  const row={...verifying(),...patch};
  await assert.rejects(invoke({},async()=>response({results:[row]})),/scope|correlation|binding/i);
 }
 const row=verifying();row.mesh.scope='f'.repeat(64);row.mesh.trace_path=join(options().boardDir,'mesh-traces',row.mesh.scope+'.jsonl');
 await assert.rejects(invoke({},async()=>response({results:[row]})),/scope|correlation|binding/i);
});
// Independent native edge cancellation oracle. Append unchanged to the protected
// Pantheon test file; all helper bindings are prefixed to avoid existing names.
import {test as meshNativeTest} from 'node:test';
import meshNativeAssert from 'node:assert/strict';
import {mkdtempSync as meshNativeMkdtemp,readFileSync as meshNativeRead,readdirSync as meshNativeReaddir,rmSync as meshNativeRm} from 'node:fs';
import {tmpdir as meshNativeTmpdir} from 'node:os';
import {join as meshNativeJoin,resolve as meshNativeResolve} from 'node:path';
import {fileURLToPath as meshNativeFileURLToPath} from 'node:url';
import {execFileSync as meshNativeExec} from 'node:child_process';
import {randomUUID as meshNativeUUID} from 'node:crypto';
import {runBlackboardMesh as meshNativeRun} from '../src/board/blackboard-mesh.mjs';

const meshNativeRepoRoot=meshNativeResolve(meshNativeFileURLToPath(new URL('../../',import.meta.url)));
const meshNativeChildCode='import time; time.sleep(90)';
const meshNativeBootstrap=String.raw`
import fcntl,json,os,subprocess,sys
from pathlib import Path
sys.path.insert(0,sys.argv[1])
from board import Board
operation,root=sys.argv[2],Path(sys.argv[3])
def git(*args):
 return subprocess.check_output(['/usr/bin/git','-c','core.hooksPath=/dev/null',*args],cwd=root,text=True,timeout=10).strip()
if operation=='create':
 root.mkdir()
 git('init','-q')
 git('config','user.name','Independent native edge oracle')
 git('config','user.email','offline@argo.invalid')
 author='''import json,subprocess,sys,time
from pathlib import Path
mode,tag=sys.argv[1:]
if mode=='hold':
 subprocess.Popen([sys.executable,'-c','import time; time.sleep(90)',tag,'author-child'])
 time.sleep(90)
Path('out').mkdir(exist_ok=True)
Path('out/value.json').write_text(json.dumps({'value':'native edge fixture'})+'\\n')
'''
 peer='''import json,subprocess,sys,time
from pathlib import Path
tag=sys.argv[1]
mesh=json.loads(Path('/inputs/mesh.json').read_text())
subprocess.Popen([sys.executable,'-c','import time; time.sleep(90)',tag,mesh['peer_id']])
time.sleep(90)
raise RuntimeError('a held peer must have been cancelled')
'''
 for name,text in {'.gitignore':'.board/\n','spec.md':'Produce the owned data. Peer results are advisory.\n','author.py':author,'peer.py':peer,'gate.py':'import json\nfrom pathlib import Path\nassert json.loads(Path("out/value.json").read_text())=={"value":"native edge fixture"}\n'}.items():
  (root/name).write_text(text)
 git('add','.')
 git('commit','-qm','Trusted native edge fixture')
 board=Board(root)
 board.init({'schema_version':1,'tickets':[{'id':'EDGE','wave':0,'lane':'native-edge','title':'Native edge cancellation','seat_model':'gpt-6-astra','reviewer_model':None,'owned_paths':['out/'],'gate_cmd':['/usr/bin/python3','gate.py'],'spec_path':'spec.md','depends_on':[],'max_attempts':1}]})
 print(json.dumps({'head':git('rev-parse','HEAD')}))
elif operation=='inspect':
 board=Board(root)
 row=board.get('EDGE')
 lock_path=Path(git('rev-parse','--path-format=absolute','--git-common-dir'))/'argo-mesh-supervisor.lock'
 with lock_path.open('r+') as lock:
  try:
   fcntl.flock(lock.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)
   lock_held=False
  except BlockingIOError:
   lock_held=True
 print(json.dumps({'status':row['status'],'commit_sha':row['commit_sha'],'head':git('rev-parse','HEAD'),'lock_held':lock_held,'audit_ok':board.verify_audit()}))
else:
 raise RuntimeError('unknown fixed oracle operation')
`;
function meshNativeBootstrapCall(operation,repo){
 return JSON.parse(meshNativeExec('/usr/bin/python3',['-c',meshNativeBootstrap,meshNativeJoin(meshNativeRepoRoot,'tools'),operation,repo],{
  encoding:'utf8',timeout:15000,maxBuffer:1024*1024,env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8',HOME:'/nonexistent',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'},
 }));
}
function meshNativeProcesses(tag){
 const found=[];
 for(const entry of meshNativeReaddir('/proc')){
  if(!/^\d+$/.test(entry))continue;
  try{
   const argv=meshNativeRead(`/proc/${entry}/cmdline`).toString('utf8').split('\0').filter(Boolean);
   const stat=meshNativeRead(`/proc/${entry}/stat`,'utf8');
   if(argv.includes(tag)&&!/^Z(?: |$)/.test(stat.slice(stat.lastIndexOf(')')+2)))found.push({pid:Number(entry),argv});
  }catch(error){if(!['ENOENT','ESRCH','EACCES','EPERM'].includes(error.code))throw error;}
 }
 return found;
}
const meshNativePause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function meshNativeDeadline(promise,ms,label){
 let timer;
 try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(label)),ms);})]);}
 finally{clearTimeout(timer);}
}
async function meshNativeCancelPhase(phase){
 const temporary=meshNativeMkdtemp(meshNativeJoin(meshNativeTmpdir(),'argo-mesh-edge-native-'));
 const repo=meshNativeJoin(temporary,'repo'),tag='edge-native-'+meshNativeUUID().replaceAll('-','');
 const controller=new AbortController();
 let outcome,settled=false;
 try{
  const baseline=meshNativeBootstrapCall('create',repo);
  const peers=['peer_a','peer_b','peer_c'].map(id=>({id,command:['/usr/bin/python3','/workspace/peer.py',tag,id]}));
  // The descendant lifetime exceeds both readiness and cancellation watchdogs:
  // ignoring the abort must fail, rather than succeeding through natural exit.
  outcome=meshNativeRun({repo,boardDir:meshNativeJoin(repo,'.board'),offline:true,workerId:tag,seatModel:'gpt-6-astra',parallel:1,maxTickets:1,rounds:2,
   timeout:90,meshTimeout:90,leaseSeconds:120,command:['/usr/bin/python3','/workspace/author.py',phase==='author'?'hold':'normal',tag],peers,signal:controller.signal,
  }).then(value=>({ok:true,value}),error=>({ok:false,error})).finally(()=>{settled=true;});
  const wanted=phase==='author'?1:3,script=phase==='author'?'/workspace/author.py':'/workspace/peer.py';
  const deadline=Date.now()+15000;
  let observed=[];
  while(Date.now()<deadline){
   meshNativeAssert.equal(settled,false,'edge settled before actual worker/descendant readiness');
   observed=meshNativeProcesses(tag);
   const parents=observed.filter(p=>p.argv[1]===script);
   const children=observed.filter(p=>p.argv[1]==='-c'&&p.argv[2]===meshNativeChildCode);
   if(parents.length===wanted&&children.length===wanted)break;
   await meshNativePause(25);
  }
  meshNativeAssert.equal(observed.filter(p=>p.argv[1]===script).length,wanted,'actual confined worker processes did not reach readiness');
  meshNativeAssert.equal(observed.filter(p=>p.argv[1]==='-c'&&p.argv[2]===meshNativeChildCode).length,wanted,'actual host-visible worker descendants did not reach readiness');
  const running=meshNativeBootstrapCall('inspect',repo);
  meshNativeAssert.equal(running.status,'CLAIMED');
  meshNativeAssert.equal(running.lock_held,true,'supervisor lock was released while native workers were active');
  controller.abort(new Error('independent native edge cancellation'));
  const result=await meshNativeDeadline(outcome,20000,'edge did not settle cancellation within the bounded cleanup watchdog');
  meshNativeAssert.equal(result.ok,false,'cancelled edge reported successful transport');
  meshNativeAssert.match(String(result.error),/cancel|transport|abort/i);
  // This assertion runs before any test cleanup, with no grace/retry masking an
  // edge that settles early while its separately grouped descendants still live.
  meshNativeAssert.deepEqual(meshNativeProcesses(tag),[],'edge settled before all tagged supervisor/worker/peer descendants exited');
  const ended=meshNativeBootstrapCall('inspect',repo);
  meshNativeAssert.equal(ended.status,'FAILED','cancelled pre-submit attempt did not fail its exact lease');
  meshNativeAssert.equal(ended.commit_sha,null,'cancelled author/peer phase submitted a candidate');
  meshNativeAssert.equal(ended.lock_held,false,'settled supervisor retained its common-repository lock');
  meshNativeAssert.equal(ended.head,baseline.head,'edge cancellation changed the integration target');
  meshNativeAssert.equal(ended.audit_ok,true,'Board audit was corrupted by cancellation');
 }finally{
  controller.abort();
  // Failure cleanup only: exact unique argv tokens avoid touching other builds.
  for(const {pid} of meshNativeProcesses(tag))try{process.kill(pid,'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw error;}
  if(outcome&&!settled)await meshNativeDeadline(outcome,5000,'native edge failed to settle after test cleanup').catch(()=>{});
  meshNativeRm(temporary,{recursive:true,force:true});
 }
}
meshNativeTest('native blackboard Mesh edge AbortSignal drains a confined author and descendant before settlement',{timeout:45000},async()=>{
 await meshNativeCancelPhase('author');
});
meshNativeTest('native blackboard Mesh edge AbortSignal drains all confined peer groups and descendants before settlement',{timeout:45000},async()=>{
 await meshNativeCancelPhase('peer');
});
