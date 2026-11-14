import hashlib, json, pathlib, re, sqlite3, subprocess

ROOT = pathlib.Path('/workspace/ARGO/.worktrees/shared-world')
OUT = pathlib.Path(__file__).parent
HEAD = '639d31b1414c21fa7516dc9d363ad35bae148afd'
BASE = '897a2e36caf82331a2f7816b3d781e95913ea4ba'

def git(*args):
    return subprocess.check_output(['git', '-C', str(ROOT), *args])

def content(path, revision=HEAD):
    return git('show', revision + ':' + path)

def digest(data):
    return hashlib.sha256(data).hexdigest()

def ancestor(revision):
    return subprocess.run(['git', '-C', str(ROOT), 'merge-base', '--is-ancestor', revision, HEAD], capture_output=True).returncode == 0

def exists(path):
    return subprocess.run(['git', '-C', str(ROOT), 'cat-file', '-e', HEAD + ':' + path], capture_output=True).returncode == 0

result = {'candidate': HEAD, 'scope': 'Read-only documentation/provenance review; no runtime execution',
          'head_at_check': git('rev-parse', 'HEAD').decode().strip(),
          'worktree_status_at_check': git('status', '--porcelain').decode(),
          'board_read_mode': 'SQLite mode=ro; explicit metadata columns only; no lease token or identity secrets read'}
docs = ['README.md', 'STATUS_AND_ARCHITECTURE.md', 'SYSTEM_ROADMAP.md',
        'docs/shared-world/README.md', 'docs/shared-world/NEXT.md', 'docs/shared-world/PLAN.md',
        'docs/shared-world/evidence/README.md', 'docs/shared-world/evidence/contracts/README.md',
        'scenarios/tempted-fates/shared-world/README.md', 'scenarios/tempted-fates/shared-world/SEED.md']
links, broken = [], []
for path in docs:
    text = content(path).decode()
    for match in re.finditer(r'\[[^\]]+\]\(([^)]+)\)', text):
        target = match.group(1).split('#', 1)[0]
        if not target or re.match(r'[A-Za-z][A-Za-z0-9+.-]*:', target):
            continue
        normalized = pathlib.Path(str(pathlib.PurePosixPath(path).parent / target))
        relative = str((ROOT / normalized).resolve().relative_to(ROOT))
        item = {'file': path, 'line': text[:match.start()].count('\n') + 1, 'target': target, 'exists': exists(relative)}
        links.append(item)
        if not item['exists']:
            broken.append(item)
result['links'] = {'documents': docs, 'relative_link_count': len(links), 'broken': broken,
                   'limitation': 'Checks committed target paths, not HTTP availability or fragment anchor rendering'}

evidence = 'docs/shared-world/evidence/'
submission_paths = [evidence + 'contracts/freeze-acceptance.json'] + [evidence + f'SW-{n}-source-submission.json' for n in [200,300,400,500,510]]
board_names = {'SW-100':'contract', 'SW-200':'foundation', 'SW-300':'storage', 'SW-400':'foundation', 'SW-500':'foundation', 'SW-510':'host'}
submissions = []
for path in submission_paths:
    record = json.loads(content(path))
    ticket = record['ticket_id']
    board = pathlib.Path('/workspace/ARGO/.board/shared-world-' + board_names[ticket])
    definition = json.loads((board/'tickets'/(ticket+'.json')).read_text())['definition']
    owned = definition['owned_paths']
    with sqlite3.connect((board/'board.db').as_uri() + '?mode=ro', uri=True) as db:
        row = db.execute('SELECT id,status,attempt,epoch,base_commit,commit_sha,merged_commit FROM tickets WHERE id=?', (ticket,)).fetchone()
        row = dict(zip(['id','status','attempt','epoch','base_commit','commit_sha','merged_commit'], row))
        artifacts = [dict(zip(['logical_path','sha256','accepted'], a)) for a in db.execute('SELECT logical_path,sha256,accepted FROM artifacts WHERE ticket_id=? AND epoch=? ORDER BY logical_path', (ticket,row['epoch']))]
    source = record['source_commit']
    artifact_results = []
    for file, expected in record['artifacts'].items():
        cas = board/'cas'/expected[:2]/expected
        artifact_results.append({'path': file, 'expected_sha256': expected,
            'inside_ticket_ownership': any(file == p or (p.endswith('/') and file.startswith(p)) for p in owned),
            'source_matches': digest(content(file, source)) == expected,
            'candidate_matches': digest(content(file)) == expected,
            'board_artifact_matches': any(a['logical_path'] == file and a['sha256'] == expected for a in artifacts),
            'cas_matches': cas.is_file() and digest(cas.read_bytes()) == expected})
    submissions.append({'ticket':ticket, 'evidence':path, 'source':source, 'source_is_ancestor':ancestor(source),
        'board':row, 'record_matches_board_commit':row['commit_sha'] == source,
        'record_matches_board_status':row['status'] == record['board_status'], 'artifacts':artifact_results})
result['submissions'] = submissions

reviews = ['contracts/authority/review-186e052.json','contracts/privacy/fixed-186e052/verification.json',
    'rules-authority-review-4774dfb/fixed-2c0c1c8/review.json','rules-privacy-review-4774dfb/fixed-2c0c1c8/verification.json',
    'dialogue-review-dfed2b9/verification.json','seed-review-31e8c42/verification.json',
    'storage-authority-review-2a2f02f/review.json','storage-boundary-review-2a2f02f/verification.json',
    'host-authority-review-0d29515/review.json','host-privacy-review-0d29515/verification.json']
review_results = []
for path in reviews:
    record = json.loads(content(evidence + path))
    source = record['candidate']
    hashes = record.get('source_sha256', record.get('source_hashes', {}))
    hashes.update({i['path']:i['sha256'] for i in record.get('source_files', [])})
    historical_mismatches, candidate_differences = [], []
    for file, expected in hashes.items():
        if digest(content(file,source)) != expected:
            historical_mismatches.append(file)
        if digest(content(file)) != expected:
            candidate_differences.append(file)
    review_results.append({'record':evidence+path, 'candidate':source, 'verdict':record['verdict'],
        'source_is_ancestor':ancestor(source), 'hash_count':len(hashes),
        'historical_mismatches':historical_mismatches, 'current_differences':candidate_differences})
result['review_records'] = review_results
runner = 'docs/shared-world/measure-runtime.mjs'
result['measurement_runner'] = {'reviewed_source':BASE, 'sha256':digest(content(runner)), 'identical_to_reviewed_source':content(runner) == content(runner,BASE)}
lock = json.loads(content('package-lock.json'))['packages']
session = json.loads(content('packages/session/package.json'))
scenario = json.loads(content('scenarios/tempted-fates/package.json'))
ownership = json.loads(content('OWNERSHIP.json'))
result['wiring_spot_check'] = {
    'session_lock_matches_dependencies': session['dependencies'] == lock['packages/session']['dependencies'],
    'scenario_lock_matches_dependencies': scenario['dependencies'] == lock['scenarios/tempted-fates']['dependencies'],
    'session_workspace_link': lock['node_modules/@argo/session'],
    'session_public_export_exists': exists('packages/session/' + session['exports'].removeprefix('./')),
    'sole_world_writer_lane': [o['lane'] for o in ownership['owners'] if o['writes_world_state']],
    'shared_state_writer': ownership['shared_state_writer'],
    'session_ownership': [o for o in ownership['owners'] if o['lane'] == 'session'],
    'coordinator_exports_present': {p: marker in content(p).decode() for p,marker in {
        'packages/contracts/src/index.ts':"export * from './shared-world-types.ts'",
        'packages/ledger/src/index.ts':"export * from './world/index.ts'",
        'packages/interventions/src/index.ts':"export * from './world-model.ts'",
        'scenarios/tempted-fates/index.ts':"export * from './shared-world/seed.ts'"}.items()}}
result['changes_since_measurement_review'] = git('diff','--name-only',BASE,HEAD).decode().splitlines()
result['head_after_check'] = git('rev-parse','HEAD').decode().strip()
result['worktree_status_after_check'] = git('status','--porcelain').decode()
(OUT/'verification.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({'candidate':HEAD,'links':result['links'], 'board_states':[{k:v for k,v in s['board'].items() if k in ['id','status','attempt','commit_sha','merged_commit']} for s in submissions],
    'submission_failures':[s['ticket'] for s in submissions if not s['source_is_ancestor'] or not s['record_matches_board_commit'] or not s['record_matches_board_status']],
    'artifact_failures':[{**a,'ticket':s['ticket']} for s in submissions for a in s['artifacts'] if not all(a[k] for k in ['source_matches','candidate_matches','board_artifact_matches','cas_matches'])],
    'review_differences':[r for r in review_results if r['historical_mismatches'] or r['current_differences']],
    'runner':result['measurement_runner']},indent=2))
