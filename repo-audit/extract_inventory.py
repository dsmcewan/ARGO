"""Static audit only: never imports or executes repository code."""
import ast
import csv
import hashlib
import json
import os
from pathlib import Path
import posixpath
import re

ROOT = Path(__file__).resolve().parent
OUT = ROOT / 'evidence'
REPOS = ('LEXI', 'TELOS', 'claude-config')

# The archive omits copied source repos. Refuse before changing retained evidence.
manifest_path = OUT / 'source-manifest.json'
if manifest_path.exists():
    required_sources = json.loads(manifest_path.read_text())
    for expected in required_sources:
        source = ROOT / 'sources' / expected['repo'] / expected['path']
        if not source.exists() and not source.is_symlink():
            raise SystemExit('Rehydrate pinned audit sources before extraction: ' + str(source))
        raw = os.readlink(source).encode() if source.is_symlink() else source.read_bytes()
        actual = hashlib.sha1(b'blob ' + str(len(raw)).encode() + b'\0' + raw).hexdigest()
        if actual != expected['expected_blob_sha']:
            raise SystemExit('Pinned source blob mismatch: ' + str(source))

TREES = {r: json.loads((OUT / (r + '-tree.json')).read_text()) for r in REPOS}

def write(name, value):
    (OUT / name).write_text(json.dumps(value, indent=2, ensure_ascii=False) + '\n')

def disposition(repo, path):
    if repo == 'LEXI':
        if path == 'scripts/program/lib/canonical-json.mjs':
            return 'Wrap via Adapter', 'Hash helpers reusable; canonical whitespace differs from TELOS and values require validation.'
        if path.startswith(('lexi-dashboard/frontend/', 'scripts/')):
            return 'Build Net-New', 'Existing forensic product UI/analysis is not an ARGO gameplay service; selective helper reuse requires review.'
        if path.endswith('/auth.py'):
            return 'Build Net-New', 'Shared single-case identity cannot enforce per-actor tenant and world-time authorization.'
        return 'Wrap via Adapter', 'Reuse storage/API/infrastructure only behind a new scoped domain boundary; current types are forensic.'
    if repo == 'TELOS':
        if path in ('build-gate/sign.mjs', 'merkle-dag/vendor.mjs'):
            return 'Expose As-Is', 'Reuse named hash/signature/path utility functions on validated inputs; does not expose a world-state write API.'
        if path.startswith(('demo/', 'narcissus/', 'saas-forge/', 'ai-forge/', 'connectors/meta-ads-mcp/')):
            return 'Build Net-New', 'Existing product/example domain is unrelated to ARGO world authority; do not import its state model.'
        return 'Wrap via Adapter', 'Retain build/provenance semantics; add ARGO envelopes, scoped authority, and deterministic gameplay rules separately.'
    return 'Wrap via Adapter', 'Configuration/workflow mechanics require complete installed runtime and current model capabilities before reuse.'

modules, sources, routes, models, exports, missing = [], [], [], [], [], []
parse_errors = []
for repo, tree in TREES.items():
    entries = {f['path']: f for f in tree['tree'] if f['type'] == 'blob'}
    for rel, meta in sorted(entries.items()):
        p = ROOT / 'sources' / repo / rel
        if p.exists() or p.is_symlink():
            data = os.readlink(p).encode() if p.is_symlink() else p.read_bytes()
            actual = hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()
            sources.append(dict(repo=repo, path=rel, mode=meta['mode'], expected_blob_sha=meta['sha'], actual_blob_sha=actual,
                                sha256=hashlib.sha256(data).hexdigest(), matches=actual == meta['sha']))
        iscode = p.suffix in {'.py', '.mjs', '.js', '.ts', '.tsx', '.jsx', '.sh', '.ps1', '.tf'}
        excluded = any(s in rel.split('/') for s in ('docs', 'tests', 'test', 'fixtures', 'examples', 'memory'))
        istest = bool(re.search(r'(^|/)test[-_]|\.test\.|\.spec\.', rel))
        if iscode and not excluded and not istest:
            cat, rationale = disposition(repo, rel)
            modules.append(dict(repo=repo, path=rel, classification=cat, rationale=rationale,
                                source_available=p.exists(), blob_sha=meta['sha'], review='static source catalog; targeted semantic review in REPO_INVENTORY.md'))
        if not p.exists() or p.is_symlink() or p.suffix not in {'.py', '.mjs', '.js', '.ts', '.tsx', '.jsx'}:
            continue
        text = p.read_text()
        if p.suffix == '.py' and rel.startswith('lexi-dashboard/backend/') and '/tests/' not in rel:
            try:
                tree_ast = ast.parse(text)
            except SyntaxError as e:
                parse_errors.append(dict(repo=repo, path=rel, error=str(e)))
                continue
            prefixes = {}
            for node in tree_ast.body:
                if isinstance(node, ast.Assign) and isinstance(node.value, ast.Call):
                    if ast.unparse(node.value.func).endswith('APIRouter'):
                        prefix = next((ast.literal_eval(k.value) for k in node.value.keywords if k.arg == 'prefix' and isinstance(k.value, ast.Constant)), '')
                        for target in node.targets:
                            if isinstance(target, ast.Name): prefixes[target.id] = prefix
                if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    for d in node.decorator_list:
                        if not isinstance(d, ast.Call) or not isinstance(d.func, ast.Attribute): continue
                        if d.func.attr not in {'get','post','put','patch','delete','options','head','websocket'}: continue
                        if not d.args or not isinstance(d.args[0], ast.Constant): continue
                        receiver = ast.unparse(d.func.value)
                        routes.append(dict(repo=repo,path=rel,line=node.lineno,method=d.func.attr.upper(),
                                           route=prefixes.get(receiver,'')+d.args[0].value,
                                           function=node.name,parameters=ast.unparse(node.args),
                                           returns=ast.unparse(node.returns) if node.returns else None,
                                           decorator=ast.unparse(d),async_handler=isinstance(node,ast.AsyncFunctionDef),
                                           caveat='Static declaration; include_router prefixes/conditional mounts require main.py review; no live OpenAPI verification.'))
                if isinstance(node, ast.ClassDef):
                    fields=[]
                    for f in node.body:
                        if isinstance(f,ast.AnnAssign):
                            fields.append(dict(name=ast.unparse(f.target),annotation=ast.unparse(f.annotation),
                                               default=ast.unparse(f.value) if f.value else None,line=f.lineno))
                    tablename=next((ast.literal_eval(f.value) for f in node.body if isinstance(f,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='__tablename__' for t in f.targets)), None)
                    models.append(dict(repo=repo,path=rel,line=node.lineno,name=node.name,bases=[ast.unparse(b) for b in node.bases],table=tablename,fields=fields))
        if p.suffix in {'.mjs','.js','.ts','.tsx','.jsx'}:
            for n,line in enumerate(text.splitlines(),1):
                if re.match(r'export\s+(?:async\s+)?(?:function|class|const|let)\s+',line):
                    exports.append(dict(repo=repo,path=rel,line=n,declaration=line))
            for match in re.finditer(r'(?:from\s*|import\s*\(|require\s*\()\s*[\'\"](\.[^\'\"]+)[\'\"]',text):
                spec=match.group(1)
                target=posixpath.normpath(posixpath.join(posixpath.dirname(rel),spec))
                candidates=[target,target+'.mjs',target+'.js',target+'.ts',target+'.tsx',target+'/index.js',target+'/index.ts']
                if not any(c in entries for c in candidates):
                    missing.append(dict(repo=repo,path=rel,line=text[:match.start()].count('\n')+1,specifier=spec,resolved=target,
                                        status='not in tracked tree; may be external/generated; static scan requires review'))

for name,value in [('source-manifest.json',sources),('module-inventory.json',modules),('lexi-routes.json',routes),
                   ('lexi-models.json',models),('javascript-exports.json',exports),('missing-relative-imports.json',missing)]: write(name,value)
with (OUT/'module-inventory.csv').open('w',newline='') as f:
    w=csv.DictWriter(f,fieldnames=list(modules[0]));w.writeheader();w.writerows(modules)
stats=dict(source_files=len(sources),verified_blob_hashes=sum(s['matches'] for s in sources),
           modules=len(modules),modules_without_source=sum(not m['source_available'] for m in modules),
           route_declarations=len(routes),model_classes=len(models),sqlmodel_tables=sum(bool(m['table']) for m in models),
           javascript_export_declarations=len(exports),missing_relative_imports=len(missing),parse_errors=parse_errors,
           per_repo={r:dict(source_files=sum(s['repo']==r for s in sources),modules=sum(m['repo']==r for m in modules)) for r in REPOS})
write('extraction-summary.json',stats)
print(json.dumps(stats,indent=2))
assert all(s['matches'] for s in sources), 'Source hash mismatch; do not freeze the inventory.'
assert not parse_errors, 'Static contract extraction failed.'
