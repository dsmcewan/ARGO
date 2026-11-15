"""Independent synthetic subprocess controls for the real helper; never run a gate."""
import hashlib,json,os,subprocess,sys,tempfile
from pathlib import Path

def fixture_child(helper,sha,mode,output):
    from unittest.mock import patch
    source=Path(helper).read_bytes();out=Path(output)
    calls=[];heads=[]
    groups=['generated-types','schema','boundaries','types','board-and-dispatch','research-python','research-tests','research-package','foundation','model-and-process']
    record={'controller':'SYNTHETIC_REVIEW_FIXTURE_NOT_A_GATE_RUN','commit':sha,'merge_ready':True,'workspace_sha256':'a'*64,'checks':[{'name':x,'output_sha256':'b'*64} for x in groups]}
    if mode=='wrong_commit':record['commit']='f'*40
    if mode=='not_merge_ready':record['merge_ready']=False
    if mode=='missing_group':record['checks']=record['checks'][:-1]
    summary=b'SYNTHETIC TRANSPORT; NO APPLICATION TESTS EXECUTED\n'+json.dumps(record).encode()+b'\n'
    partial=b'SYNTHETIC PARTIAL STDOUT\nPASS generated-types\n'
    def head(argv,**kwargs):
        heads.append(argv)
        value=('e'*40 if mode=='source_head_changed' and len(heads)>1 else sha)+'\n'
        return value if kwargs.get('text') else value.encode()
    def run(argv,**kwargs):
        calls.append({'argv':argv,'timeout':kwargs.get('timeout'),'stderr_merged':kwargs.get('stderr')==subprocess.STDOUT,'captures_stdout':kwargs.get('stdout')==subprocess.PIPE})
        if argv[:2]==['git','clone']:
            if mode=='clone_nonzero':return subprocess.CompletedProcess(argv,3,b'SYNTHETIC clone partial\n')
            if mode=='missing_executable':raise FileNotFoundError('Synthetic missing executable')
            target=Path(argv[-1]);target.mkdir();(target/'pantheon').mkdir()
        if argv[0]=='/usr/bin/bwrap':
            if mode.startswith('timeout_'):
                value={'timeout_bytes':partial,'timeout_text':partial.decode(),'timeout_empty':None}[mode]
                raise subprocess.TimeoutExpired(argv,kwargs['timeout'],output=value)
            if mode=='nonzero_with_complete_summary':return subprocess.CompletedProcess(argv,7,summary)
            if mode=='killed_after_partial':return subprocess.CompletedProcess(argv,-9,partial)
            if mode=='invalid_json':return subprocess.CompletedProcess(argv,0,b'SYNTHETIC not a JSON result\n')
            return subprocess.CompletedProcess(argv,0,summary)
        return subprocess.CompletedProcess(argv,0,b'SYNTHETIC setup output\n')
    argv=[helper,'--repo',str(out.parent/'synthetic-repo'),'--candidate',sha,'--npm-cache',str(out.parent/'synthetic-cache'),'--output',str(out)]
    try:
        with patch.object(sys,'argv',argv),patch('subprocess.run',side_effect=run),patch('subprocess.check_output',side_effect=head),patch('shutil.which',return_value=None if mode=='missing_node' else '/SYNTHETIC/node'):
            exec(compile(source,helper,'exec'),{'__name__':'__main__','__file__':helper})
    finally:
        (out.parent/(out.name+'-transport.json')).write_text(json.dumps({'synthetic':True,'application_tests_executed':False,'mode':mode,'calls':calls,'head_reads':len(heads)},indent=2)+'\n')

if len(sys.argv)>1 and sys.argv[1]=='--case':
    fixture_child(*sys.argv[2:]);raise SystemExit(0)

repo,sha,out_arg=sys.argv[1:];root=Path(repo).resolve();out=Path(out_arg).resolve();out.mkdir(parents=True,exist_ok=True)
helper=root/'docs/characters-runtime/evidence/run-candidate-gate.py'
def git(*args):return subprocess.check_output(['git','-C',str(root),*args],text=True).strip()
assert git('rev-parse','HEAD')==sha and git('status','--porcelain')==''
source_hash=hashlib.sha256(helper.read_bytes()).hexdigest()
modes=['timeout_bytes','timeout_text','timeout_empty','nonzero_with_complete_summary','killed_after_partial','invalid_json','wrong_commit','not_merge_ready','missing_group','source_head_changed','clone_nonzero','missing_node','missing_executable','synthetic_success','reuse_success','reuse_partial']
checks=[]
for mode in modes:
    directory=out/('SYNTHETIC-'+mode);directory.mkdir()
    old=None
    if mode=='reuse_success':old=b'{"synthetic_old_evidence":true,"candidate":"older-fixture"}\n';(directory/'gate-result.json').write_bytes(old)
    if mode=='reuse_partial':old=b'preserved older partial output\n';(directory/'application-gate.log').write_bytes(old)
    completed=subprocess.run([sys.executable,'-I',str(Path(__file__).resolve()),'--case',str(helper),sha,mode,str(directory)],stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=15)
    (out/(mode+'.stdout')).write_bytes(completed.stdout);(out/(mode+'.stderr')).write_bytes(completed.stderr)
    transport=json.loads((out/(directory.name+'-transport.json')).read_text())
    failure=directory/'gate-failure.json';success=directory/'gate-result.json'
    if mode=='synthetic_success':
        assert completed.returncode==0 and success.exists() and not failure.exists(),mode
        result=json.loads(success.read_text());assert result['gate']['controller']=='SYNTHETIC_REVIEW_FIXTURE_NOT_A_GATE_RUN'
        assert len(result['gate']['checks'])==10 and result['candidate']==sha
    elif mode.startswith('reuse_'):
        assert completed.returncode!=0 and not transport['calls'] and transport['head_reads']==0,mode
        assert not failure.exists(),mode
        path=success if mode=='reuse_success' else directory/'application-gate.log';assert path.read_bytes()==old,mode
        assert b'Output directory must be empty' in completed.stderr,mode
    else:
        assert completed.returncode!=0 and failure.exists() and not success.exists(),mode
        record=json.loads(failure.read_text());assert record['status']=='failed' and record['candidate']==sha and record['merged'] is False
        f=record['failure']
        for name,digest in record['logs'].items():assert hashlib.sha256((directory/name).read_bytes()).hexdigest()==digest,(mode,name)
        if mode.startswith('timeout_'):
            assert f['timed_out'] is True and f['timeout_seconds']==600 and f['stage']=='application-gate'
            expect=b'' if mode=='timeout_empty' else b'SYNTHETIC PARTIAL STDOUT\nPASS generated-types\n'
            assert (directory/'application-gate.log').read_bytes()==expect,mode
        elif mode=='nonzero_with_complete_summary':assert f['returncode']==7 and f['timed_out'] is False
        elif mode=='killed_after_partial':assert f['returncode']==-9 and (directory/'application-gate.log').read_bytes().startswith(b'SYNTHETIC PARTIAL')
        elif mode=='source_head_changed':assert f['stage']=='source-head' and record['source_head_unchanged'] is False
        elif mode=='clone_nonzero':assert f['returncode']==3 and f['stage']=='clone' and (directory/'clone.log').read_bytes()==b'SYNTHETIC clone partial\n'
        elif mode=='missing_node':assert f['stage']=='preflight' and record['source_head_before'] is None
        elif mode=='missing_executable':assert f['stage']=='clone' and f['type']=='FileNotFoundError'
        else:assert f['stage']=='gate-record',mode
    checks.append({'mode':mode,'passed':True,'child_exit_code':completed.returncode,'application_tests_executed':False})
assert git('rev-parse','HEAD')==sha and git('status','--porcelain')=='' and hashlib.sha256(helper.read_bytes()).hexdigest()==source_hash
result={'candidate':sha,'helper_sha256':source_hash,'scope':'Independent synthetic transport controls for exact real helper source. No clone/npm/gate/test/controller/merge command actually ran.','passed':len(checks),'failed':0,'checks':checks,'source_clean':True,'new_deadline_approval':False}
(out/'independent-helper-controls.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))
