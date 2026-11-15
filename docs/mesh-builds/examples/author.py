"""Deterministic local build fixture; no model, credentials or network."""
import json, os
from pathlib import Path
job=json.loads(Path(os.environ['ARGO_TASK']).read_text())
output=Path(job['owned_paths'][0])/'result.json'
output.write_text(json.dumps({'ticket_id':job['id'],'epoch':job['epoch'],
    'base_commit':job['base_commit'],'value':'built'},sort_keys=True)+'\n')
