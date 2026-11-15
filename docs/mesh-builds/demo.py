#!/usr/bin/env python3
"""Prepare a new disposable two-ticket repository; never launch workers or models.

The printed config is consumed by the explicitly offline Pantheon Mesh CLI.
The target directory must not already exist. No ARGO source or database changes.
"""
import argparse,json,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'tools'))
from board import Board
p=argparse.ArgumentParser(description=__doc__);p.add_argument('directory',type=Path);args=p.parse_args()
repo=args.directory.resolve();repo.mkdir(parents=True,exist_ok=False)
def git(*argv):
 return subprocess.check_output(['git','-C',str(repo),'-c','core.hooksPath=/dev/null','-c','commit.gpgsign=false',*argv],stderr=subprocess.PIPE,text=True).strip()
for name in ('author.py','peer.py'):(repo/name).write_bytes((ROOT/'docs/mesh-builds/examples'/name).read_bytes())
(repo/'spec.md').write_text('Write only the owned result.json fixture; all peers are read-only and advisory.\n')
(repo/'.gitignore').write_text('.board/\nmesh-config.json\n')
git('init','-q');git('add','--all');git('-c','user.name=ARGO Offline Demo','-c','user.email=offline@argo.invalid','commit','-qm','disposable fixture baseline')
tickets=[]
for ticket,path in [('A','results/a/'),('B','results/b/')]:
 gate="import json\nfrom pathlib import Path\nx=json.loads(Path("+repr(path+'result.json')+").read_text())\nassert x['ticket_id']=="+repr(ticket)+" and x['value']=='built'\n"
 tickets.append({'id':ticket,'wave':0,'lane':'offline-demo','title':'Build '+ticket,'seat_model':'gpt-6-astra','reviewer_model':None,'owned_paths':[path],'gate_cmd':['python3','-c',gate],'spec_path':'spec.md','depends_on':[],'max_attempts':3})
board=Board(repo);board.init({'schema_version':1,'tickets':tickets});board.render()
config={'repo':str(repo),'boardDir':str(repo/'.board'),'command':['/usr/bin/python3','/workspace/author.py'],
 'peers':[{'id':peer,'command':['/usr/bin/python3','/workspace/peer.py']} for peer in ('critic','counterexample','reconciler')],
 'seatModel':'gpt-6-astra','workerId':'offline-demo','parallel':2,'maxTickets':2,'rounds':2,'timeout':20,'meshTimeout':30,'leaseSeconds':900}
(repo/'mesh-config.json').write_text(json.dumps(config,indent=2)+'\n')
print(json.dumps({'repo':str(repo),'config':str(repo/'mesh-config.json'),'tickets':2,'workers_launched':0,'paid_calls':0},indent=2))
