#!/usr/bin/env python3
"""Run ARGO's gate in an offline, read-only disposable clone; never integrate."""
import argparse, hashlib, json, os, shutil, subprocess, tempfile, time
from pathlib import Path

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--repo', required=True)
p.add_argument('--candidate', required=True)
p.add_argument('--npm-cache', required=True)
p.add_argument('--output', required=True)
a = p.parse_args()
repo, output = Path(a.repo).resolve(), Path(a.output).resolve()
output.mkdir(parents=True, exist_ok=True)
# Each invocation owns fresh evidence. Never leave an old passing result beside
# a new failure, or overwrite the partial output of an earlier attempt.
if any(output.iterdir()):
    raise SystemExit('Output directory must be empty; preserve previous gate evidence')
started = time.monotonic()
before, after, active_step, active_timeout = None, None, 'preflight', None
def log_hashes():
    return {f.name: hashlib.sha256(f.read_bytes()).hexdigest() for f in sorted(output.glob('*.log'))}
try:
    node = shutil.which('node')
    assert node and len(a.candidate) == 40
    before = subprocess.check_output(['git', '-C', str(repo), 'rev-parse', 'HEAD'], text=True).strip()
    with tempfile.TemporaryDirectory(prefix='argo-review-gate-') as tmp:
        root = Path(tmp)
        home, stage = root/'home', root/'candidate'
        home.mkdir()
        env = {'PATH': os.environ['PATH'], 'HOME': str(home), 'LANG': 'C.UTF-8',
               'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': '/dev/null', 'GIT_TERMINAL_PROMPT': '0'}
        def run(name, argv, cwd, timeout=300):
            global active_step, active_timeout
            active_step, active_timeout = name, timeout
            try:
                result = subprocess.run(argv, cwd=cwd, env=env, stdout=subprocess.PIPE,
                                        stderr=subprocess.STDOUT, timeout=timeout)
            except subprocess.TimeoutExpired as error:
                # subprocess.run kills/reaps the child before raising. Its
                # captured stdout includes merged stderr, even on timeout.
                partial = error.stdout or b''
                (output/(name+'.log')).write_bytes(partial.encode() if isinstance(partial, str) else partial)
                raise
            (output/(name+'.log')).write_bytes(result.stdout)
            if result.returncode:
                raise subprocess.CalledProcessError(result.returncode, argv, output=result.stdout)
            return result.stdout
        run('clone', ['git', 'clone', '--no-local', '--no-checkout', str(repo), str(stage)], root)
        run('checkout', ['git', 'checkout', '--detach', a.candidate], stage)
        user, global_config = root/'user.npmrc', root/'global.npmrc'
        user.write_text(''); global_config.write_text('')
        install = ['npm', 'ci', '--ignore-scripts', '--no-audit', '--no-fund', '--offline',
                   '--cache', str(Path(a.npm_cache).resolve()), '--userconfig', str(user),
                   '--globalconfig', str(global_config)]
        run('root-install', install, stage)
        run('pantheon-install', install, stage/'pantheon')
        args = ['/usr/bin/bwrap', '--unshare-all', '--cap-drop', 'ALL', '--die-with-parent',
                '--new-session', '--ro-bind', '/usr', '/usr', '--symlink', 'usr/bin', '/bin',
                '--symlink', 'usr/sbin', '/sbin', '--symlink', 'usr/lib', '/lib',
                '--symlink', 'usr/lib64', '/lib64', '--dir', '/tools', '--ro-bind', node,
                '/tools/node', '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp',
                '--ro-bind', str(stage), '/workspace', '--chdir', '/workspace', '--clearenv',
                '--setenv', 'PATH', '/tools:/usr/bin:/bin', '--setenv', 'HOME', '/tmp',
                '--setenv', 'LANG', 'C.UTF-8', '--', '/tools/node', 'scripts/gate.mjs', '--merge-ready']
        gate = run('application-gate', args, stage, 600)
        active_step, active_timeout = 'gate-record', None
        record = json.loads(gate.decode().strip().splitlines()[-1])
        assert record['commit'] == a.candidate and record['merge_ready']
        assert len(record['checks']) == 10
    active_step, active_timeout = 'source-head', None
    after = subprocess.check_output(['git', '-C', str(repo), 'rev-parse', 'HEAD'], text=True).strip()
    assert before == after
    result = {'candidate': a.candidate, 'gate': record, 'elapsed_seconds': round(time.monotonic()-started, 3),
              'execution': 'Disposable clone; full candidate read-only; network-unshared Bubblewrap; offline dependencies',
              'source_head_unchanged': before == after, 'merged': False, 'operational_trust_promoted': False,
              'paid_model_calls': 0, 'remote_writes': False, 'logs': log_hashes()}
except Exception as error:
    head_error = None
    try:
        after = subprocess.check_output(['git', '-C', str(repo), 'rev-parse', 'HEAD'], text=True).strip()
    except Exception as check_error:
        head_error = str(check_error)[:4000]
    failure = {'status': 'failed', 'candidate': a.candidate,
               'failure': {'stage': active_step, 'type': type(error).__name__, 'message': str(error)[:4000],
                           'timed_out': isinstance(error, subprocess.TimeoutExpired),
                           'timeout_seconds': active_timeout, 'returncode': getattr(error, 'returncode', None)},
               'elapsed_seconds': round(time.monotonic()-started, 3),
               'source_head_before': before, 'source_head_after': after,
               'source_head_unchanged': None if before is None or after is None else before == after,
               'source_head_check_error': head_error, 'merged': False, 'operational_trust_promoted': False,
               'paid_model_calls': 0, 'remote_writes': False, 'logs': log_hashes()}
    (output/'gate-failure.json').write_text(json.dumps(failure, indent=2)+'\n')
    raise
(output/'gate-result.json').write_text(json.dumps(result, indent=2)+'\n')
print(json.dumps(result, indent=2))
