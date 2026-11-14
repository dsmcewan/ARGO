from pathlib import Path
import subprocess,hashlib,json,re
root=Path('/workspace/ARGO/.board/shared-world-gate-budget/worktrees/SW-520-1-4136752cec');out=Path(__file__).parent
base='1ea79ef89c649f4930b18327071d4a5ef9f97ebd';candidate='0c4b1026f40dbc804f38c274f6cbbc0415e97bcd'
def git(*args):return subprocess.check_output(['git','-C',str(root),*args])
def blob(sha,p):return git('show',sha+':'+p)
def digest(b):return hashlib.sha256(b).hexdigest()
assert git('rev-parse','HEAD').decode().strip()==candidate;assert git('status','--porcelain')==b''
paths=git('diff','--name-only',base,candidate).decode().splitlines();assert paths==['docs/shared-world/GATE_BUDGET.md','scripts/gate.mjs']
before=blob(base,'scripts/gate.mjs');after=blob(candidate,'scripts/gate.mjs');old=next(l for l in before.splitlines(keepends=True) if l.startswith(b" ['foundation',"));assert old.endswith(b']],\n');new=old[:-4]+b'],{timeout:600000}],\n';assert before.count(old)==1;assert before.replace(old,new)==after
(out/'base-gate.mjs').write_bytes(before);(out/'candidate-gate.mjs').write_bytes(after)
with (out/'syntax.log').open('wb') as log:subprocess.run(['node','--check',str(root/'scripts/gate.mjs')],stdout=log,stderr=subprocess.STDOUT,check=True)
git('diff','--check',base,candidate)
controls=['scripts/run-tests.mjs','scripts/run-python-tests.py','controller/acceptance-policy.mjs','controller/policy.ts','controller/merge.mjs','tools/board.py','.github/workflows/deterministic-gate.yml','docs/characters-runtime/evidence/run-candidate-gate.py']
preserved={}
for p in controls:
 assert blob(base,p)==blob(candidate,p);preserved[p]=digest(blob(candidate,p))
gate=after.decode();native=blob(candidate,'scripts/run-tests.mjs').decode();controller=blob(candidate,'controller/merge.mjs').decode();outer=blob(candidate,'docs/characters-runtime/evidence/run-candidate-gate.py').decode();ci=blob(candidate,'.github/workflows/deterministic-gate.yml').decode()
groups=re.findall(r"^ \['([^']+)'",gate,re.M);assert groups==['generated-types','schema','boundaries','types','board-and-dispatch','research-python','research-tests','research-package','foundation','model-and-process']
for f in ["timeout:300000,killSignal:'SIGKILL',maxBuffer:16*1024*1024,...opts","const output=await run(cmd,args,opts)","if(await candidate()!==before","Merge gate requires a clean committed candidate",".filter(f=>f.endsWith('.test.ts')).sort().map(f=>'TESTS/'+f)"]:assert f in gate,f
for f in ["run({files,concurrency:1})","event.type==='test:summary'","event.data.entryFile","['failed','cancelled','skipped','todo']","expected.get(key)===event.data.name","failures||missing.length||incomplete.length"]:assert f in native,f
assert "process.env.ARGO_CONTROLLER_TRUSTED_SHA!==trusted" in controller;assert 'assertCandidatePolicy(source,policy,protectedPaths)' in controller;assert 'source,false,600000' in controller
assert "gate = run('application-gate', args, stage, 600)" in outer;assert "assert record['commit'] == a.candidate and record['merge_ready']" in outer;assert "assert len(record['checks']) == 10" in outer;assert 'timeout-minutes: 20' in ci
with (out/'policy-refusal.json').open('wb') as log:subprocess.run(['node',str(out/'policy-refusal.mjs')],stdout=log,stderr=subprocess.STDOUT,check=True)
policy=json.loads((out/'policy-refusal.json').read_text());assert policy['exact_changed_gate_policy_comparison']=='Candidate protected policy differs: scripts'
failurepath='docs/shared-world/evidence/full-gate-83bc6c1/failure.json';failure=json.loads(blob(candidate,failurepath));assert failure['candidate']=='83bc6c154cd0879f481185eb159cded8fa1e507d';assert failure['exit_code']==1 and failure['merge_ready']==False and len(failure['passed_groups'])==8
assert blob(base,failurepath)==blob(candidate,failurepath);evidence={failurepath:digest(blob(candidate,failurepath))}
for p,h in failure['logs'].items():
 path='docs/shared-world/evidence/full-gate-83bc6c1/'+p;assert digest(blob(candidate,path))==h;assert blob(base,path)==blob(candidate,path);evidence[path]=h
failurelog=blob(candidate,'docs/shared-world/evidence/full-gate-83bc6c1/application-gate.log').decode();assert 'killed: true' in failurelog and "signal: 'SIGKILL'" in failurelog and len(re.findall('^PASS ',failurelog,re.M))==8
assert git('rev-parse','HEAD').decode().strip()==candidate and git('status','--porcelain')==b''
result={'candidate':candidate,'base':base,'status_before_after':'clean','byte_exact_only_executable_change':'foundation fourth tuple argument {timeout:600000}','gate_sha256_before':digest(before),'gate_sha256_after':digest(after),'groups':groups,'preserved_controls_sha256':preserved,'protected_policy_refusal':policy,'prior_failure_log_hashes':evidence,'syntax_check':'pass','diff_check':'pass','full_suite_executed':False,'trust_pin_modified':False}
(out/'static-check.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'checks':'PASS','candidate':candidate,'protected_policy_refusal':policy['exact_changed_gate_policy_comparison']}))
