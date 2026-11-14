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
node = shutil.which('node')
assert node and len(a.candidate) == 40
before = subprocess.check_output(['git', '-C', str(repo), 'rev-parse', 'HEAD'], text=True).strip()
started = time.monotonic()
with tempfile.TemporaryDirectory(prefix='argo-review-gate-') as tmp:
    root = Path(tmp)
    home, stage = root/'home', root/'candidate'
    home.mkdir()
    env = {'PATH': os.environ['PATH'], 'HOME': str(home), 'LANG': 'C.UTF-8',
           'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': '/dev/null', 'GIT_TERMINAL_PROMPT': '0'}
    def run(name, argv, cwd, timeout=300):
        result = subprocess.run(argv, cwd=cwd, env=env, stdout=subprocess.PIPE,
                                stderr=subprocess.STDOUT, timeout=timeout)
        (output/(name+'.log')).write_bytes(result.stdout)
        if result.returncode:
            raise RuntimeError(f'{name} exited {result.returncode}; see {output/name}.log')
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
    record = json.loads(gate.decode().strip().splitlines()[-1])
    assert record['commit'] == a.candidate and record['merge_ready']
    assert len(record['checks']) == 10
after = subprocess.check_output(['git', '-C', str(repo), 'rev-parse', 'HEAD'], text=True).strip()
assert before == after
result = {'candidate': a.candidate, 'gate': record, 'elapsed_seconds': round(time.monotonic()-started, 3),
          'execution': 'Disposable clone; full candidate read-only; network-unshared Bubblewrap; offline dependencies',
          'source_head_unchanged': before == after, 'merged': False, 'operational_trust_promoted': False,
          'paid_model_calls': 0, 'remote_writes': False,
          'logs': {f.name: hashlib.sha256(f.read_bytes()).hexdigest() for f in sorted(output.glob('*.log'))}}
(output/'gate-result.json').write_text(json.dumps(result, indent=2)+'\n')
print(json.dumps(result, indent=2))
