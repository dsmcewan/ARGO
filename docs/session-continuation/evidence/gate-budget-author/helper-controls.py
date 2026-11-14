#!/usr/bin/env python3
"""Synthetic subprocess controls only; never an ARGO application gate."""
import argparse,json,os,subprocess,sys,tempfile
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--helper',required=True);p.add_argument('--results',required=True);a=p.parse_args()
helper=Path(a.helper).resolve();candidate='1'*40
wrapper='''
import json,pathlib,runpy,subprocess,sys
helper,output,mode,candidate=sys.argv[1:]
original=subprocess.run
head_reads=0
def source_head(*args,**kwargs):
 global head_reads
 head_reads+=1
 return ('2'*40 if mode=='head-moved' and head_reads>1 else candidate)+'\\n'
subprocess.check_output=source_head
def controlled(argv,*args,**kwargs):
 if argv[0]=='/usr/bin/bwrap':
  record={'commit':'2'*40 if mode=='wrong-candidate' else candidate,'merge_ready':True,'checks':[{'name':str(i)} for i in range(9 if mode=='missing-check' else 10)]}
  code="import sys,time; print('CONTROL partial output',flush=True); "
  if mode=='timeout': code+="time.sleep(60)"
  elif mode=='nonzero': code+="sys.exit(7)"
  elif mode=='malformed': code+="print('not-a-gate-record')"
  else: code+='print('+repr(json.dumps(record))+')'
  kwargs['timeout']=1 if mode=='timeout' else 3
  return original([sys.executable,'-u','-c',code],*args,**kwargs)
 if argv[:2]==['git','clone']: pathlib.Path(argv[-1]).mkdir()
 return subprocess.CompletedProcess(argv,0,stdout=b'CONTROL setup\\n')
subprocess.run=controlled
sys.argv=[helper,'--repo',str(pathlib.Path(output).parent),'--candidate',candidate,'--npm-cache',str(pathlib.Path(output).parent),'--output',output]
runpy.run_path(helper,run_name='__main__')
'''
results=[]
with tempfile.TemporaryDirectory(prefix='argo-gate-helper-controls-') as tmp:
 root=Path(tmp);runner=root/'runner.py';runner.write_text(wrapper)
 for mode in ['timeout','nonzero','malformed','wrong-candidate','missing-check','head-moved','success','existing-output']:
  dest=root/mode
  if mode=='existing-output':
   dest.mkdir();(dest/'gate-result.json').write_text('PRESERVED ORIGINAL RECORD\n')
  process=subprocess.run([sys.executable,str(runner),str(helper),str(dest),mode,candidate],capture_output=True,text=True,timeout=15)
  try:
   if mode=='success':
    assert process.returncode==0,process.stderr
    record=json.loads((dest/'gate-result.json').read_text());assert record['candidate']==candidate
    assert not (dest/'gate-failure.json').exists()
   elif mode=='existing-output':
    assert process.returncode!=0
    assert (dest/'gate-result.json').read_text()=='PRESERVED ORIGINAL RECORD\n'
    assert list(dest.iterdir())==[dest/'gate-result.json']
   else:
    assert process.returncode!=0
    assert not (dest/'gate-result.json').exists()
    log=(dest/'application-gate.log').read_bytes();assert b'CONTROL partial output' in log, 'Synthetic child did not print before its deadline: '+repr(log)
    record=json.loads((dest/'gate-failure.json').read_text());assert record['status']=='failed' and record['candidate']==candidate
    assert record['source_head_unchanged'] is (mode!='head-moved')
    assert record['failure']['stage']==('source-head' if mode=='head-moved' else 'gate-record' if mode in ['malformed','wrong-candidate','missing-check'] else 'application-gate')
    assert record['failure']['timed_out'] is (mode=='timeout')
    if mode=='nonzero':assert record['failure']['returncode']==7
    assert record['logs']['application-gate.log']
   results.append({'case':mode,'passed':True})
  except Exception as e:results.append({'case':mode,'passed':False,'error':str(e),'stderr':process.stderr[-2000:]})
Path(a.results).write_text(json.dumps({'kind':'synthetic controls; not application acceptance','results':results},indent=2)+'\n')
for r in results:print(('PASS' if r['passed'] else 'FAIL')+' '+r['case'])
raise SystemExit(any(not r['passed'] for r in results))
