#!/usr/bin/env python3
"""Run portable SC-610 compatibility against exact candidate and baseline fixture."""
import argparse,hashlib,json,os,subprocess,time
from pathlib import Path
BASE='8e2104c6d466b8b2bee2d0b23d984d2e60a65e11'
p=argparse.ArgumentParser(description=__doc__)
for name in ['repo','candidate','fixture','fixture-manifest','output']:p.add_argument('--'+name,required=True)
a=p.parse_args();root=Path(a.repo).resolve();fixture=Path(a.fixture).resolve();manifest_path=Path(a.fixture_manifest).resolve();out=Path(a.output).resolve();here=Path(__file__).parent
assert len(a.candidate)==40 and all(c in '0123456789abcdef' for c in a.candidate)
out.mkdir(parents=True,exist_ok=True,mode=0o700)
def git(*args):return subprocess.check_output(['git','-C',str(root),*args])
def sha(b):return hashlib.sha256(b).hexdigest()
assert git('rev-parse','HEAD').decode().strip()==a.candidate and git('status','--porcelain')==b'','Exact clean candidate required'
manifest_bytes=manifest_path.read_bytes();manifest=json.loads(manifest_bytes);assert manifest['source']==BASE and manifest['fixture_events']==512
fixture_bytes=fixture.read_bytes();assert sha(fixture_bytes)==manifest['fixture_sha256'] and len(fixture_bytes)==manifest['fixture_bytes']
assert fixture.stat().st_mode&0o777==0o600 and fixture.parent.stat().st_mode&0o777==0o700,'Keep generated private fixtures private'
controls=['SYSTEMS','packages/contracts','packages/ledger/src/world/journal.ts','packages/ledger/src/world/storage.ts','packages/ledger/src/world/storage-worker.ts','packages/ledger/src/world/rules.ts','packages/ledger/src/world/view.ts','packages/ledger/src/world/index.ts','packages/ledger/src/mortal-v3','scripts'];preserved={}
for path in controls:
 old=git('ls-tree','-r',BASE,'--',path);new=git('ls-tree','-r',a.candidate,'--',path);assert old and old==new,path;preserved[path]={'tree_listing_sha256':sha(old),'tracked_files':len(old.splitlines())}
for path in ['packages/contracts/src/index.ts','packages/contracts/src/shared-world.ts']:
 assert sha(git('show',BASE+':'+path))==manifest['source_sha256'][path],('Manifest oracle source differs',path)
owned_paths=['packages/ledger/src/world/rules/engine.ts','packages/ledger/src/world/rules/ownership.ts','packages/ledger/src/world/journal.ts','packages/contracts/src/index.ts','packages/contracts/src/shared-world.ts']
source={path:sha((root/path).read_bytes()) for path in owned_paths}
preflight={'candidate':a.candidate,'baseline':BASE,'fixture_sha256':manifest['fixture_sha256'],'fixture_manifest_sha256':sha(manifest_bytes),'private_fixture_mode':'0700/0600','source_sha256':source,'preserved_controls':preserved,'harness_sha256':sha((here/'compatibility.mjs').read_bytes()),'status_before':'clean','ordinary_process':True,'timeout_seconds':120}
(out/'preflight.json').write_text(json.dumps(preflight,indent=2)+'\n')
subprocess.run(['node','--check',str(here/'compatibility.mjs')],check=True)
env=dict(os.environ);env.pop('NODE_TEST_CONTEXT',None);started=time.monotonic()
with (out/'compatibility.log').open('wb') as log:
 result=subprocess.run(['node',str(here/'compatibility.mjs'),'--repo',str(root),'--candidate',a.candidate,'--fixture',str(fixture),'--fixture-manifest',str(manifest_path),'--output',str(out)],env=env,stdout=log,stderr=subprocess.STDOUT,timeout=120)
assert git('rev-parse','HEAD').decode().strip()==a.candidate and git('status','--porcelain')==b''
assert all(sha((root/path).read_bytes())==h for path,h in source.items())
verification={'candidate':a.candidate,'exit_code':result.returncode,'elapsed_seconds':time.monotonic()-started,'status_before_after':'clean','source_unchanged':True,'fixture_unchanged':sha(fixture.read_bytes())==manifest['fixture_sha256'],'manifest_unchanged':sha(manifest_path.read_bytes())==sha(manifest_bytes),'harness_sha256':preflight['harness_sha256'],'log_sha256':sha((out/'compatibility.log').read_bytes())}
(out/'verification.json').write_text(json.dumps(verification,indent=2)+'\n');print(json.dumps(verification));raise SystemExit(result.returncode)
