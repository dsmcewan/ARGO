"""Read-only protocol fixture; its opinion never certifies the candidate."""
import json
from pathlib import Path
context=json.loads(Path('/inputs/mesh.json').read_text())
prior=context['traces'];me=context['peer_id']
other=next((row['id'] for row in prior if row['peer_id']!=me),None)
own=next((row['id'] for row in reversed(prior) if row['peer_id']==me),None)
response={key:context[key] for key in ('protocol','binding','peer_id','round','seen_version')}
response['traces']=[{'type':'result','payload':{'fixture':'read-only reconciliation',
    'observed_peer_ids':sorted({row['peer_id'] for row in prior}),
    'candidate':context['binding']['candidate_commit']},'response_to':other,'supersedes':own}]
print(json.dumps(response,sort_keys=True))
