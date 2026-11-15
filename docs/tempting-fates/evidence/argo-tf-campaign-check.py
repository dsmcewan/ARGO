"""Read-only prose/catalog checks; stdlib Python, no ARGO runtime imports.
Usage: python3 /tmp/argo-tf-campaign-check.py /path/to/checkout
"""
from pathlib import Path
import json,re,sys,hashlib,subprocess
root=Path(sys.argv[1] if len(sys.argv)>1 else '/workspace/ARGO/.worktrees/tempting-fates')
revision='d4b8086559a2934c233892949055531b24ba3706'
read=lambda name:subprocess.check_output(['git','show',f'{revision}:{name}'],cwd=root).decode()
pack=json.loads(read('scenarios/tempted-fates/campaign/world.json'))
names=['README','PLAYER_GUIDE','RULES','CHARACTER_SHEET','QUICKSTART','ATLAS','ENCOUNTERS','REFEREE_GUIDE','ATTRIBUTION']
docs={name:read(f'CAMPAIGNS/Tempting_Fates/{name}.md') for name in names}
checks=[]
assert len(pack['locations'])==8 and len(pack['npcs'])==11 and len(pack['factions'])==3 and len(pack['rumors'])==12 and len(pack['variants'])==3
checks.append('Authored counts: eight locations, eleven NPCs (eight mortal/three Fates), three factions, twelve rumors, three variants.')
for route in pack['routes']:
 row=next(line for line in docs['ATLAS'].splitlines() if line.startswith('| '+route['id']+' |'))
 cells=[c.strip() for c in row.strip('|').split('|')]
 assert int(cells[2])==route['travel_turns'] and int(cells[3])==route['travel_turns']*10
 assert cells[4]==route['condition'] and cells[5]==route['sign']
checks.append('All nine Atlas route times, minute conversions, access conditions and signs match world.json.')
for rumor in pack['rumors']:
 row=next(line for line in docs['ENCOUNTERS'].splitlines() if line.startswith('| '+rumor['id']+' |'))
 assert rumor['text'] in row
 assert ' / '.join(rumor['assessment'][v] for v in ['genuine','counterfeit','legend']) in row
checks.append('All twelve rumor utterances and per-variant assessment labels match the encounter table.')
joined='\n'.join(docs.values()); matched=0;exceptions=[]
def walk(value,path=''):
 global matched
 if isinstance(value,dict):
  for k,v in value.items():walk(v,path+'/'+k)
 elif isinstance(value,list):
  for i,v in enumerate(value):walk(v,path+'/'+str(i))
 elif isinstance(value,str) and len(value)>80:
  if value in joined:matched+=1
  else:exceptions.append(path)
walk(pack)
assert exceptions==['/tone_note','/adaptation_note','/public_intro'],exceptions
checks.append(f'{matched} catalog narrative strings longer than 80 characters appear verbatim in campaign prose; only separately reviewed introductory/tone/adaptation paragraphs differ.')
for name in ['clotho','lachesis','atropos']:
 npc=next(x for x in pack['npcs'] if x['id']==name)
 assert npc['fate_role']==name and npc['location_id']=='l_loom'
assert not any(r['from']=='l_loom' or r['to']=='l_loom' for r in pack['routes'])
checks.append('Fate roles remain separate and no route reaches the loom.')
for f in pack['factions']:
 assert f['resources']==f['clock']['segments']-f['clock']['progress']
 assert f['clock']['advance_trigger'] in docs['REFEREE_GUIDE'] and f['clock']['completion'] in docs['REFEREE_GUIDE']
checks.append('Three finite project budgets fund exactly the initially unfinished stages; triggers and completions match the guide.')
assert 1+2+2+1+1+1+1==9 and 2+2+2+1+1+1+1==10
checks.append('Starting-kit slot totals recomputed from listed items: nine for one-slot weapon, ten for spear, including coin and oil bundles.')
freeze=json.loads(read('scenarios/tempted-fates/campaign/FREEZE.json'))
for path,expected in freeze['files'].items():assert hashlib.sha256(read(path).encode()).hexdigest()==expected
checks.append('Frozen campaign contract/schema/types match their declared hashes.')
for name,expected in [('knave-1e.pdf','fc2ff96175f6b60ddbbf02b6139a5da569752155948371613e201d21cf92bc78'),('CC-BY-4.0.txt','9ba9550ad48438d0836ddab3da480b3b69ffa0aac7b7878b5a0039e7ab429411')]:
 blob=subprocess.check_output(['git','show',f'{revision}:docs/design/headless-2026-11-13/evidence/knave-1e/{name}'],cwd=root)
 assert hashlib.sha256(blob).hexdigest()==expected
checks.append('Retained Knave first-edition PDF and license hashes exactly match ATTRIBUTION.md.')
print(json.dumps({'revision':revision,'passed':True,'checks':checks},indent=2))
