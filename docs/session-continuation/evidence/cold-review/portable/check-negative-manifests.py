#!/usr/bin/env python3
"""Bounded refusal controls for the portable manifest interface; no product edits."""
import argparse, json, os, subprocess
from pathlib import Path
p=argparse.ArgumentParser(description=__doc__)
for name in ['repo','candidate','fixture','fixture-manifest','output']: p.add_argument('--'+name,required=True)
a=p.parse_args();here=Path(__file__).resolve().parent;out=Path(a.output).resolve();out.mkdir(parents=True,exist_ok=True,mode=0o700)
manifest=json.loads(Path(a.fixture_manifest).read_bytes());env=dict(os.environ);env.pop('NODE_TEST_CONTEXT',None);checks=[]
for field in ['source','fixture_sha256','genesis_hash','terminal_state_hash','terminal_event_hash']:
 bad=dict(manifest);bad[field]='0'*(40 if field=='source' else 64);case=out/field;case.mkdir(mode=0o700);path=case/'manifest.json';path.write_text(json.dumps(bad,indent=2)+'\n');path.chmod(0o600)
 with (case/'refusal.log').open('wb') as log:
  result=subprocess.run(['node',str(here/'compatibility.mjs'),'--repo',a.repo,'--candidate',a.candidate,'--fixture',a.fixture,'--fixture-manifest',str(path),'--output',str(case)],env=env,stdout=log,stderr=subprocess.STDOUT,timeout=15)
 text=(case/'refusal.log').read_text();assert result.returncode!=0 and 'AssertionError' in text and 'PASS ' not in text and not (case/'results.json').exists(),field
 checks.append({'field':field,'exit_code':result.returncode,'rejected_before_checks':True,'log':str((case/'refusal.log').relative_to(out))})
(out/'results.json').write_text(json.dumps({'checks':checks,'passed':len(checks),'failed':0},indent=2)+'\n');print(json.dumps({'passed':len(checks),'failed':0}))
