"""Read pinned Git blobs; never import the harness or dispatch a build/model call."""
from pathlib import Path
import ast
import csv
import hashlib
import io
import json
import posixpath
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'repo-audit/evidence'
REF = '6f75c29'

def git(*args):
    return subprocess.check_output(['git', '-C', str(ROOT), *args])

commit = git('rev-parse', REF).decode().strip()
entries = []
for entry in git('ls-tree', '-rz', commit, '--', 'pantheon', 'pantheon-seat-core').split(b'\0'):
    if not entry:
        continue
    meta, path = entry.decode().split('\t', 1)
    mode, kind, sha = meta.split()
    assert kind == 'blob'
    entries.append((path, mode, sha))

def classify(path):
    if path.startswith('pantheon-seat-core/'):
        return 'Wrap via Adapter', 'Historical seat-only snapshot; use active pantheon implementation for new integrations, not a second runtime.'
    if path.endswith(('board/canon.mjs', 'context/chain.mjs', 'config/models.mjs')):
        return 'Expose As-Is', 'Named pure codec/hash/config lookup utilities on validated inputs; no gameplay authority implied.'
    if '/spike/' in path or '/scripts/' in path and not path.endswith(('scripts/lib/repo-root.mjs', 'scripts/agy-seat.py', 'scripts/codex-seat.py')):
        return 'Build Net-New', 'Existing build/demo entrypoint is not an ARGO service; retain as legacy support and create ARGO-specific orchestration.'
    return 'Wrap via Adapter', 'Retain build/seat semantics behind explicit boundaries; see PANTHEON_AUDIT.md for required correctness and model-capability repairs.'

manifest, modules, imports, exports, syntax = [], [], [], [], []
known = {p for p, _, _ in entries}
for path, mode, sha in entries:
    raw = git('cat-file', 'blob', sha)
    assert hashlib.sha1(b'blob ' + str(len(raw)).encode() + b'\0' + raw).hexdigest() == sha
    manifest.append(dict(path=path, mode=mode, blob_sha=sha, sha256=hashlib.sha256(raw).hexdigest(), bytes=len(raw)))
    suffix = Path(path).suffix
    if suffix not in {'.mjs', '.js', '.py', '.sh'} or any(p in path.split('/') for p in ('tests', 'docs', 'memory')):
        continue
    classification, rationale = classify(path)
    modules.append(dict(path=path, classification=classification, rationale=rationale, blob_sha=sha))
    body = raw.decode()
    if suffix in {'.mjs', '.js'}:
        # Lexical declarations, not full JavaScript semantics; review closure candidates manually.
        for match in re.finditer(r'(?:\bfrom\s*|\bimport\s*\(\s*|^\s*import\s*)[\"\']([^\"\']+)[\"\']', body, re.M):
            target = match.group(1)
            resolved = posixpath.normpath(posixpath.join(posixpath.dirname(path), target)) if target.startswith('.') else None
            imports.append(dict(path=path, line=body.count('\n', 0, match.start())+1, target=target, resolved=resolved,
                                present=resolved in known if resolved else None))
        for match in re.finditer(r'^export\s+(?:(?:async\s+)?function|class|const|let)\s+(\w+)', body, re.M):
            exports.append(dict(path=path, line=body.count('\n', 0, match.start())+1, name=match.group(1)))
        # --check parses stdin without executing the program or loading its dependencies.
        check = subprocess.run(['node', '--input-type=module', '--check'], input=raw, capture_output=True)
        syntax.append(dict(path=path, ok=check.returncode == 0, error=check.stderr.decode() if check.returncode else None))
    elif suffix == '.py':
        try:
            ast.parse(body)
            syntax.append(dict(path=path, ok=True, error=None))
        except SyntaxError as exc:
            syntax.append(dict(path=path, ok=False, error=str(exc)))

summary = dict(source_commit=commit, source_repository='https://github.com/dsmcewan/ARGO',
               files=len(manifest), verified_blobs=len(manifest), modules=len(modules),
               per_folder={folder: dict(files=sum(p['path'].startswith(folder+'/') for p in manifest),
                                       modules=sum(p['path'].startswith(folder+'/') for p in modules))
                           for folder in ('pantheon', 'pantheon-seat-core')},
               relative_import_candidates_missing=[i for i in imports if i['present'] is False],
               syntax_errors=[s for s in syntax if not s['ok']],
               live_services_started=False, vendor_inference_calls=0)
for name, value in [('pantheon-source-manifest', manifest), ('pantheon-modules', modules),
                    ('pantheon-imports', imports), ('pantheon-exports', exports),
                    ('pantheon-syntax', syntax), ('pantheon-extraction-summary', summary)]:
    (OUT / (name+'.json')).write_text(json.dumps(value, indent=2)+'\n')
csv_out = io.StringIO(newline='')
writer = csv.DictWriter(csv_out, fieldnames=list(modules[0]), lineterminator='\n')
writer.writeheader()
writer.writerows(modules)
(OUT / 'pantheon-modules.csv').write_text(csv_out.getvalue())
print(json.dumps(summary, indent=2))
