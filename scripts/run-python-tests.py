#!/usr/bin/env python3
"""Check completion of pinned unittest suites with an import-free parent.

The parent parses pinned test source; only the isolated child imports application code.
A zero process status or printed success text is insufficient. Dynamic discovery,
inherited tests, skips and expected failures are deliberately unsupported by this gate.
This is an accidental-exit guard for already trusted code. Imported code can forge
the child receipt; the merge controller must pin the complete Python import surface
before invoking this runner. It does not safely grade hostile Python implementations.
"""
import ast
from collections import Counter
import json
import os
from pathlib import Path
import selectors
import signal
import subprocess
import sys
import time

TIMEOUT = 240
OUTPUT_LIMIT = 16 * 1024 * 1024
RECEIPT_LIMIT = 1024 * 1024


def expected_tests(directory):
    files = sorted(directory.glob('test_*.py'))
    expected = []
    for file in files:
        tree = ast.parse(file.read_bytes(), filename=str(file))
        for node in tree.body:
            if isinstance(node, ast.ClassDef):
                for method in node.body:
                    if isinstance(method, (ast.FunctionDef, ast.AsyncFunctionDef)) and method.name.startswith('test_'):
                        expected.append(f'{file.stem}.{node.name}.{method.name}')
    if not expected:
        raise ValueError('No trusted Python tests discovered')
    if len(set(expected)) != len(expected):
        raise ValueError('Duplicate trusted Python test IDs')
    return expected


def child(directory, receipt_fd, add_import_path):
    # All runner dependencies are loaded before application imports. The parent never
    # imports these modules and independently checks the exact expected ID multiset.
    import importlib.util
    import unittest
    if add_import_path:
        sys.path.insert(0, str(directory))
    suite = unittest.TestSuite()
    for path in sorted(directory.glob('test_*.py')):
        spec = importlib.util.spec_from_file_location(path.stem, path)
        module = importlib.util.module_from_spec(spec)
        sys.modules[path.stem] = module
        spec.loader.exec_module(module)
        suite.addTests(unittest.defaultTestLoader.loadTestsFromModule(module))

    class Result(unittest.TextTestResult):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs)
            self.passed_ids = []

        def addSuccess(self, test):
            super().addSuccess(test)
            self.passed_ids.append(test.id())

    result = unittest.TextTestRunner(verbosity=2, resultclass=Result).run(suite)
    receipt = {'complete': True, 'passed': result.passed_ids,
               'run': result.testsRun, 'successful': result.wasSuccessful(),
               'skipped': len(result.skipped), 'expected_failures': len(result.expectedFailures)}
    with os.fdopen(receipt_fd, 'w', encoding='utf-8') as pipe:
        json.dump(receipt, pipe)
    return 0 if result.wasSuccessful() else 1


def verify(directory, add_import_path=False):
    expected = expected_tests(directory)
    read_fd, write_fd = os.pipe()
    process = None
    try:
        process = subprocess.Popen(
            [sys.executable, '-I', '-S', '-B', str(Path(__file__).resolve()),
             '--child', str(directory), str(write_fd), 'trusted' if add_import_path else 'none'],
            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            pass_fds=(write_fd,), start_new_session=True)
        os.close(write_fd)
        write_fd = None
        output, receipt = bytearray(), bytearray()
        deadline = time.monotonic() + TIMEOUT
        with selectors.DefaultSelector() as selector:
            selector.register(process.stdout, selectors.EVENT_READ, (output, OUTPUT_LIMIT))
            selector.register(read_fd, selectors.EVENT_READ, (receipt, RECEIPT_LIMIT))
            while selector.get_map() or process.poll() is None:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise ValueError('Python completion timeout')
                for key, _ in selector.select(min(remaining, .1)):
                    data = os.read(key.fd, 65536)
                    if not data:
                        selector.unregister(key.fileobj)
                        continue
                    buffer, limit = key.data
                    buffer.extend(data)
                    if len(buffer) > limit:
                        raise ValueError('Python completion output limit exceeded')
        sys.stdout.buffer.write(output)
        try:
            result = json.loads(receipt)
        except (ValueError, UnicodeError) as error:
            raise ValueError('Missing or invalid Python completion receipt') from error
        if (process.returncode != 0 or not isinstance(result, dict)
                or result.get('complete') is not True or result.get('successful') is not True
                or result.get('run') != len(expected) or result.get('skipped') != 0
                or result.get('expected_failures') != 0
                or Counter(result.get('passed', [])) != Counter(expected)):
            raise ValueError('Python completion refused: failed, skipped or missing trusted tests')
        print(f'Verified {len(expected)} Python tests; exact completion, no skips or failures.')
    finally:
        # The process group also catches descendants retaining a pipe after an early exit.
        if process is not None:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.wait()
            process.stdout.close()
        os.close(read_fd)
        if write_fd is not None:
            os.close(write_fd)


if __name__ == '__main__':
    try:
        if len(sys.argv) == 5 and sys.argv[1] == '--child':
            raise SystemExit(child(Path(sys.argv[2]).resolve(), int(sys.argv[3]), sys.argv[4] == 'trusted'))
        arguments = sys.argv[1:]
        add_import_path = bool(arguments and arguments[0] == '--trusted-import-root')
        if add_import_path:
            arguments.pop(0)
        if len(arguments) != 1:
            raise ValueError('Usage: run-python-tests.py [--trusted-import-root] TEST_DIRECTORY')
        verify(Path(arguments[0]).resolve(), add_import_path)
    except (ValueError, OSError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
