#!/usr/bin/env python3
"""Read committed release evidence only; no runtime, database mutation or private values."""
import hashlib,json,pathlib,posixpath,re,sqlite3,subprocess,datetime
ROOT=pathlib.Path('/workspace/ARGO/.worktrees/session-continuation')
OUT=pathlib.Path(__file__).parent
PIN='9fa800493a3c033b45bc3df7ab18a56e25bcd9a8'
E='docs/session-continuation/evidence/'
def git(*args):return subprocess.check_output(['git','-C',str(ROOT),*args])
def digest(b):return hashlib.sha256(b).hexdigest()
files=set(git('ls-tree','-r','--name-only',PIN).decode().splitlines())
cache={}
def blob(path,rev=PIN):
 k=(rev,path)
 if k not in cache:cache[k]=git('show',rev+':'+path)
 return cache[k]
def data(path):return json.loads(blob(path))
result={'candidate':PIN,'checked_at_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'head_before':git('rev-parse','HEAD').decode().strip(),'status_before':git('status','--porcelain').decode(),'scope':'Committed evidence/docs/ancestry plus whitelisted read-only Board state; no runtime or acceptance rerun','source_checks':[],'artifact_checks':[],'unresolved_artifact_references':[],'ancestry':[],'links':{'checked':0,'broken':[]},'boards':[],'cas_checks':[],'private_artifact_checks':[]}
def source(rev,path,expected,record,compare_current=False):
 b=blob(path,rev); row={'record':record,'revision':rev,'path':path,'expected':expected,'actual':digest(b),'matches':digest(b)==expected}
 if compare_current:row['current_matches']=digest(blob(path))==expected
 result['source_checks'].append(row)
def ancestor(rev):
 result['ancestry'].append({'revision':rev,'is_ancestor':subprocess.run(['git','-C',str(ROOT),'merge-base','--is-ancestor',rev,PIN],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode==0})
for name in ['SC-610-source-record.json','SC-620-source-record.json']:
 d=data(E+name); ancestor(d['source_commit']); ancestor(d['base_commit'])
 for path,h in d['artifacts'].items():source(d['source_commit'],path,h,name,True)
for name in ['turn-author/verification-followup.json','turn-author/verification.json','turn-review-host/verification-0458268.json','turn-review-host/verification-e096530.json','turn-review-store/final-e096530/verification.json','turn-review-store/checkpoint-review.json']:
 d=data(E+name); rev=d.get('candidate') or d.get('head')
 if rev:
  ancestor(rev)
  for path,h in d.get('source_sha256',d.get('source_hashes',{})).items():source(rev,path,h,name)
d=data(E+'cold-review/review.json')
for path,v in d['source_files'].items():source(d['candidate'],path,v['sha256'],'cold-review/review.json')
d=data(E+'design-review-source.json')
for label,v in d['sources'].items():
 ancestor(v['commit'])
 for path,val in v['files'].items():source(v['commit'],path,val['sha256'],'design-review-source.json:'+label)
d=data(E+'turn-api-review.json')['committed_contract'];ancestor(d['commit']);source(d['commit'],d['path'],d['sha256'],'turn-api-review.json',True)
for rev in ['7c16c0d8709b0b53dba0ab36051c1fe0100bd35a','3c8ff55d872891014c89fe43515b3c28fd492626','de737c5db88042db2150f47d6dc4e0280e80ba96']:ancestor(rev)
def artifact(record,path,h):
 exact=posixpath.normpath(posixpath.join(posixpath.dirname(record),path))
 candidates=[exact] if exact in files else []
 if not candidates:
  # Historical original-run paths are intentionally preserved; bind retained bytes by hash.
  candidates=[p for p in files if p.startswith(E) and posixpath.basename(p)==posixpath.basename(path) and digest(blob(p))==h]
 if not candidates:
  result['unresolved_artifact_references'].append({'record':record,'path':path,'expected':h});return
 for p in candidates:
  actual=digest(blob(p));result['artifact_checks'].append({'record':record,'reference':path,'retained_path':p,'expected':h,'actual':actual,'matches':actual==h,'relocated':p!=exact})
for f in sorted(files):
 if not f.startswith(E) or not f.endswith('.json'):continue
 try:d=data(f)
 except (ValueError,UnicodeDecodeError):continue
 if not isinstance(d,dict):continue
 for key in ['evidence_sha256','evidence_hashes','log_sha256','artifacts_sha256']:
  for path,h in (d.get(key) or {}).items() if isinstance(d.get(key),dict) else []:
   if isinstance(h,str) and re.fullmatch('[0-9a-f]{64}',h):artifact(f,path,h)
 if f==E+'cold-review/review.json':
  for path,h in d['artifacts'].items():artifact(f,path,h)
 if f==E+'turn-review-store/final-0458268/verification.json':
  v=d['prior_evidence'];artifact(f,v['path'],v['sha256'])
  for path,h in d['author_followup_artifacts'].items():artifact(f,path,h)
  for path,v in d['store_hash_comparison'].items():
   source(d['candidate'],path,v['candidate_sha256'],f)
   source(d['previous_reviewed_candidate'],path,v['previous_sha256'],f)
 if f==E+'turn-api-review.json':
  artifact(f,d['proposal'],d['proposal_sha256']);v=d['committed_contract'];artifact(f,v['diff'],v['diff_sha256'])
d=data(E+'cold-native-c4654d5.json')
artifact(E+'cold-native-c4654d5.json','cold-native-c4654d5.log',d['logs']['application-gate.log'])
result['native_gate_record']={'candidate':d['candidate'],'scope':d['gate'],'log_hash_matches':digest(blob(E+'cold-native-c4654d5.log'))==d['logs']['application-gate.log'],'current_harness_hash_matches':digest(blob('docs/session-continuation/run-native-subset.py'))==d['harness_sha256'],'not_rerun':True}
result['measurement_record']={k:data(E+'cold-measurement-7c16c0d.json')[k] for k in ['candidate','checkout_clean_before_after','paid_calls','final_sequence','replay_equals_snapshot','full_replay_ms']}
result['measurement_record']['runner_source_equal_to_prior']=blob('docs/shared-world/measure-runtime.mjs','7c16c0d8709b0b53dba0ab36051c1fe0100bd35a')==blob('docs/shared-world/measure-runtime.mjs','639d31b1414c21fa7516dc9d363ad35bae148afd')
result['measurement_record']['runner_sha256']=digest(blob('docs/shared-world/measure-runtime.mjs','7c16c0d8709b0b53dba0ab36051c1fe0100bd35a'))
docfiles=[f for f in files if f.endswith('.md') and (f.startswith('docs/session-continuation/') and '/evidence/' not in f or f in ['README.md','STATUS_AND_ARCHITECTURE.md','SYSTEM_ROADMAP.md','docs/shared-world/README.md','docs/shared-world/NEXT.md'])]
for f in docfiles:
 t=blob(f).decode()
 for raw in re.findall(r'(?<!!)\[[^\]]*\]\(([^)]+)\)',t):
  target=raw.strip().split(' ',1)[0].strip('<>');target=target.split('#',1)[0]
  if not target or target.startswith(('/', 'http:', 'https:', 'mailto:', 'plugin:')):continue
  path=posixpath.normpath(posixpath.join(posixpath.dirname(f),target));result['links']['checked']+=1
  if path not in files and not any(p.startswith(path.rstrip('/')+'/') for p in files):result['links']['broken'].append({'document':f,'target':target,'resolved':path})
for board in ['board-cold','board-sc-620','board-sc-630','board-sc-640']:
 p=pathlib.Path('/workspace/reports/2026-11-14-argo-continuation')/board
 c=sqlite3.connect(f'file:{p}/board.db?mode=ro',uri=True);c.row_factory=sqlite3.Row
 rows=[dict(r) for r in c.execute('SELECT id,status,attempt,epoch,base_commit,commit_sha,merged_commit FROM tickets')];c.close()
 result['boards'].append({'board':board,'rows':rows})
 if board in ['board-cold','board-sc-620']:
  d=data(E+('SC-610' if board=='board-cold' else 'SC-620')+'-source-record.json')
  for path,h in d['artifacts'].items():
   pcas=p/'cas'/h[:2]/h
   result['cas_checks'].append({'board':board,'path':path,'hash':h,'exists':pcas.is_file(),'matches':pcas.is_file() and digest(pcas.read_bytes())==h})
# Scan only added/changed files for this continuation, not unrelated historical fixtures.
changed=git('diff','--name-only','8e2104c6d466b8b2bee2d0b23d984d2e60a65e11',PIN).decode().splitlines()
suspects=[]
for f in changed:
 if f not in files:continue
 b=blob(f)
 if b.startswith(b'SQLite format 3\0'):suspects.append({'path':f,'kind':'sqlite_file'})
 if re.search(rb'-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----\s+[A-Za-z0-9+/=\r\n]{32,}-----END (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----',b):suspects.append({'path':f,'kind':'private_key_block'})
 if re.search(r'\.(?:db|sqlite|sqlite3|pem|key)(?:-wal|-shm)?$',f,re.I):suspects.append({'path':f,'kind':'private_file_extension'})
 if f.endswith('.json'):
  try:jd=json.loads(b)
  except (ValueError,UnicodeDecodeError):continue
  def walk(x):
   if isinstance(x,dict):
    for k,v in x.items():
     if k.lower() in ['lease_token','access_token','refresh_token','api_key','private_key'] and v not in [None,'',False]:suspects.append({'path':f,'kind':'sensitive_json_key','key':k,'value_type':type(v).__name__})
     walk(v)
   elif isinstance(x,list):
    for y in x:walk(y)
  walk(jd)
result['private_artifact_checks']={'scanned_changed_files':len(changed),'suspects':suspects,'limits':'Complete private PEM blocks, SQLite headers, private-file suffixes and nonempty sensitive JSON keys. Code references/absolute historical paths are not secret values; not a general credential scanner.'}
result['head_after']=git('rev-parse','HEAD').decode().strip();result['status_after']=git('status','--porcelain').decode()
result['summary']={'source_checks':len(result['source_checks']),'source_mismatches':sum(not r['matches'] for r in result['source_checks']),'current_source_mismatches':sum(r.get('current_matches') is False for r in result['source_checks']),'artifact_checks':len(result['artifact_checks']),'artifact_mismatches':sum(not r['matches'] for r in result['artifact_checks']),'unresolved_artifact_references':len(result['unresolved_artifact_references']),'ancestry_failures':sum(not r['is_ancestor'] for r in result['ancestry']),'broken_links':len(result['links']['broken']),'cas_mismatches':sum(not r['matches'] for r in result['cas_checks']),'private_artifact_suspects':len(suspects)}
(OUT/'checks.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result['summary'],indent=2));print('unresolved',json.dumps(result['unresolved_artifact_references'],indent=2));print('broken_links',json.dumps(result['links']['broken'],indent=2));print('private_suspects',json.dumps(suspects,indent=2))
