"""Read-only final SC-640 evidence binding; never executes candidate code."""
import argparse
import ast
import hashlib
import json
import subprocess
from pathlib import Path

p = argparse.ArgumentParser()
p.add_argument('checkout')
p.add_argument('candidate')
p.add_argument('archive_commit')
p.add_argument('output')
a = p.parse_args()
root = Path(a.checkout).resolve()
out = Path(a.output).resolve()
review = Path(__file__).resolve().parent
checkpoint = '47d3fa6a3b247986a0a6bb9aaad1f65cfff25273'
base = '9fa800493a3c033b45bc3df7ab18a56e25bcd9a8'
helper_path = 'docs/characters-runtime/evidence/run-candidate-gate.py'

def git(*args):
    return subprocess.check_output(['git', '-C', str(root), *args])

def blob(sha, path):
    return git('show', sha + ':' + path)

def digest(value):
    return hashlib.sha256(value).hexdigest()

assert git('rev-parse', 'HEAD').decode().strip() == a.candidate
assert git('status', '--porcelain') == b''
interim = json.loads((review / 'helper-47d3fa6/verification.json').read_text())
before, after = blob(checkpoint, helper_path), blob(a.candidate, helper_path)
old_line = b"gate = run('application-gate', args, stage, 600)"
new_line = b"gate = run('application-gate', args, stage, 1200)"
assert before.count(old_line) == 1
assert after == before.replace(old_line, new_line)

def normalized_helper(source):
    tree = ast.parse(source)
    gates = [node for node in ast.walk(tree) if isinstance(node, ast.Assign)
             and any(isinstance(t, ast.Name) and t.id == 'gate' for t in node.targets)]
    assert len(gates) == 1
    call = gates[0].value
    assert isinstance(call, ast.Call) and len(call.args) == 4
    assert isinstance(call.args[3], ast.Constant)
    call.args[3].value = 'REVIEWED_OUTER_TIMEOUT'
    return ast.dump(tree, include_attributes=False).encode()

fingerprint = digest(normalized_helper(after))
assert normalized_helper(before) == normalized_helper(after)
assert fingerprint == interim['helper_ast_sha256_with_only_outer_deadline_normalized']
assert digest(before) == interim['helper_sha256']
controls = json.loads((review / 'helper-47d3fa6/controls/independent-helper-controls.json').read_text())
assert controls['passed'] == 16 and controls['failed'] == 0
static = json.loads((out / 'static-check.json').read_text())
assert static['candidate'] == a.candidate
assert static['foundation_ms'] == 1080000 and static['outer_ms'] == 1200000
helper_ast = json.loads((out / 'helper-ast-check.json').read_text())
assert helper_ast['candidate'] == a.candidate and helper_ast['outer_seconds'] == 1200

diagnostic_dir = Path('/workspace/reports/2026-11-14-argo-continuation/foundation-diagnostic-3c8ff55')
result_bytes = (diagnostic_dir / 'gate-result.json').read_bytes()
diagnostic = json.loads(result_bytes)
assert len(diagnostic['gate']['files']) == len(set(diagnostic['gate']['files'])) == 49
assert diagnostic['gate']['summary'] == 'Verified 567 named tests at trusted source locations; no failing tests.'
assert diagnostic['elapsed_seconds'] == 895.626
assert diagnostic['source_head_unchanged'] is True
archive = git('rev-parse', a.archive_commit).decode().strip()
archive_prefix = 'docs/session-continuation/evidence/foundation-diagnostic-3c8ff55/'
assert blob(archive, archive_prefix + 'gate-result.json') == result_bytes
for name, expected in diagnostic['logs'].items():
    local = (diagnostic_dir / name).read_bytes()
    assert digest(local) == expected
    assert blob(archive, archive_prefix + name) == local
assert blob(diagnostic['candidate'], 'scripts/run-tests.mjs') == blob(a.candidate, 'scripts/run-tests.mjs')

doc = blob(a.candidate, 'docs/session-continuation/GATE_BUDGET.md')
for value in [digest(result_bytes), diagnostic['logs']['application-gate.log'],
              '895.626', 'including clone and dependency installation',
              'foundation-only duration was not isolated',
              'not a portable performance benchmark',
              '20-minute total job cap', 'CI can expire earlier',
              'later CLI additions', 'quiet complete ten-group run',
              'supports no passed-group or assertion-completion count']:
    assert value.encode() in doc, value
prior_path = Path('/workspace/reports/2026-11-14-argo-continuation/host-gate-3c8ff55/runner-result.json')
prior = prior_path.read_bytes()
assert digest(prior) == interim['prior_real_timeout_record']['sha256']
assert json.loads(prior)['exit_code'] == 1
assert b'TimeoutExpired' in prior
for linked in ['failure.json', 'runner-result.json']:
    assert blob(archive, 'docs/session-continuation/evidence/host-gate-3c8ff55/' + linked)

changed = git('diff', '--name-only', base, a.candidate).decode().splitlines()
assert sorted(changed) == sorted(['controller/merge.mjs', helper_path,
    'docs/session-continuation/GATE_BUDGET.md', 'scripts/gate.mjs'])
out.mkdir(parents=True, exist_ok=True)
(out / 'reviewed-helper.py').write_bytes(after)
(out / 'reviewed-GATE_BUDGET.md').write_bytes(doc)
(out / 'checkpoint-to-final.diff').write_bytes(git('diff', checkpoint, a.candidate))
assert git('rev-parse', 'HEAD').decode().strip() == a.candidate
assert git('status', '--porcelain') == b''
verification = {
    'candidate': a.candidate, 'base': base,
    'verdict': 'READY_SC640_SOURCE_REVIEW_NOT_APPLICATION_ACCEPTANCE',
    'source_clean': True, 'changed_files': changed,
    'source_sha256': {path: digest(blob(a.candidate, path)) for path in changed},
    'helper_failure_controls': {
        'executed_at': checkpoint, 'passed': 16, 'failed': 0,
        'carried_forward_to': a.candidate,
        'basis': 'Exact byte comparison changes only gate timeout 600 to 1200; whole-helper normalized AST identical.',
        'normalized_ast_sha256': fingerprint,
        'not_reexecuted_at_final_candidate': True,
        'application_tests_executed': 0,
    },
    'static_check': static,
    'diagnostic': {
        'candidate': diagnostic['candidate'], 'archive_commit': archive,
        'files': 49, 'named_tests': 567, 'elapsed_seconds': 895.626,
        'elapsed_includes_clone_and_install': True,
        'result_sha256': digest(result_bytes),
        'log_hashes_verified': diagnostic['logs'],
        'archived_bytes_match_local_evidence': True,
        'foundation_only_external_diagnostic_not_full_gate': True,
    },
    'prior_timeout': {'path': str(prior_path), 'sha256': digest(prior), 'exit_code': 1, 'status': 'Preserved failure, no acceptance count'},
    'limitations': [
        'Final integrated ten-group gate including CLI remains required.',
        'Single loaded-workspace diagnostic is not a portable performance guarantee.',
        'Foundation duration was not isolated from clone/install.',
        'CI job still caps setup plus execution at 20 minutes and may expire sooner.',
        'No operational trust-pin movement or merge authorization from this review.',
    ],
    'review_evidence_sha256': {
        str(path.relative_to(review)): digest(path.read_bytes())
        for path in [review / 'static-check.mjs', review / 'helper-ast-check.py', Path(__file__),
                     out / 'static-check.json', out / 'helper-ast-check.json',
                     out / 'checkpoint-to-final.diff', review / 'helper-47d3fa6/verification.json',
                     review / 'helper-47d3fa6/controls/independent-helper-controls.json']
    },
    'source_edits': False, 'full_gate_executed': False,
    'trust_pin_modified': False, 'paid_calls': 0,
}
(out / 'verification.json').write_text(json.dumps(verification, indent=2) + '\n')
print(json.dumps({key: verification[key] for key in ['candidate', 'verdict', 'source_clean', 'source_sha256']}))
