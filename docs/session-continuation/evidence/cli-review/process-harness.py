#!/usr/bin/env python3
"""Exact-source ordinary CLI subprocess capture. Preparation only until a candidate is supplied."""
import argparse, hashlib, json, os, signal, subprocess, time
from pathlib import Path

def sha(value): return hashlib.sha256(value).hexdigest()
def git(repo,*args): return subprocess.check_output(['git','-C',str(repo),*args])
def identity(repo,candidate):
    if len(candidate)!=40 or any(c not in '0123456789abcdef' for c in candidate): raise ValueError('Full immutable candidate SHA required')
    head=git(repo,'rev-parse','HEAD').decode().strip()
    if head!=candidate or git(repo,'status','--porcelain')!=b'': raise ValueError('Exact clean candidate required')
    return head

def run_cli(repo,candidate,args,input_bytes,out,timeout=45,max_capture_bytes=16*1024*1024):
    """Returns metadata; exit failures remain evidence rather than becoming test successes."""
    repo=Path(repo).resolve();out=Path(out).resolve();identity(repo,candidate)
    if not isinstance(args,list) or any(not isinstance(arg,str) for arg in args): raise ValueError('Arguments must be a string list')
    if not 0<timeout<=120: raise ValueError('Bounded 1..120 second timeout required')
    out.mkdir(parents=True,exist_ok=False,mode=0o700)
    incoming=out/'stdin.jsonl';incoming.write_bytes(input_bytes);incoming.chmod(0o600)
    cli=repo/'scenarios/tempted-fates/shared-world/cli.ts';source_hash=sha(cli.read_bytes())
    env=dict(os.environ);env.pop('NODE_TEST_CONTEXT',None)
    started=time.monotonic();deadline=started+timeout;termination=None
    with incoming.open('rb') as inp,(out/'stdout.jsonl').open('xb') as stdout,(out/'stderr.log').open('xb') as stderr:
        os.chmod(stdout.name,0o600);os.chmod(stderr.name,0o600)
        child=subprocess.Popen(['node',str(cli),*args],cwd=repo,env=env,stdin=inp,stdout=stdout,stderr=stderr,start_new_session=True)
        while child.poll() is None:
            if time.monotonic()>deadline: termination='deadline'
            if sum((out/name).stat().st_size for name in ['stdout.jsonl','stderr.log'])>max_capture_bytes: termination='capture_limit'
            if termination:
                os.killpg(child.pid,signal.SIGKILL);child.wait();break
            try: child.wait(timeout=0.1)
            except subprocess.TimeoutExpired: pass
    stdout=(out/'stdout.jsonl').read_bytes();stderr=(out/'stderr.log').read_bytes()
    identity(repo,candidate)
    if sha(cli.read_bytes())!=source_hash: raise AssertionError('Candidate CLI changed during run')
    record={'candidate':candidate,'args':args,'exit_code':child.returncode,'termination':termination,'elapsed_seconds':time.monotonic()-started,'timeout_seconds':timeout,'ordinary_process':True,'node_test_context_absent':True,'stdio':'private regular files','cli_sha256':source_hash,'stdin_sha256':sha(input_bytes),'stdout_sha256':sha(stdout),'stderr_sha256':sha(stderr),'stdout_bytes':len(stdout),'stderr_bytes':len(stderr),'source_after':'clean and unchanged'}
    (out/'process.json').write_text(json.dumps(record,indent=2)+'\n');return record

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ['repo','candidate','args-json','input','output']:parser.add_argument('--'+name,required=True)
    parser.add_argument('--timeout',type=int,default=45);a=parser.parse_args();os.umask(0o077)
    record=run_cli(a.repo,a.candidate,json.loads(Path(a.args_json).read_text()),Path(a.input).read_bytes(),a.output,a.timeout)
    print(json.dumps(record));raise SystemExit(0 if record['exit_code']==0 and record['termination'] is None else 1)
