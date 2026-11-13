"""Pinned supervisor wrapper for v1 Python data-validation gates.

This file runs only inside the board's Bubblewrap sandbox using Python -I -S.
The trusted entrypoint may inspect candidate bytes as data; candidate code and
subprocesses cannot run in the oracle's process. Application test adapters are
deliberately unsupported. Only the supervisor wrapper issues completion.
"""
import argparse
import ast
import collections
import dataclasses
import hashlib
import json
import os
import pathlib
import re
import sys
import typing


def main():
    config = json.loads(sys.argv[1])
    if config["kind"] == "file":
        source = pathlib.Path(config["source"]).read_bytes()
    else:
        source = config["source"].encode()
    if hashlib.sha256(source).hexdigest() != config["source_sha256"]:
        raise RuntimeError("Pinned gate entrypoint differs")
    entrypoint = compile(source, "<argo-pinned-gate>", "exec")
    forbidden = {"subprocess.Popen", "os.system", "os.exec", "os.posix_spawn", "os.fork", "os.forkpty",
                 "ctypes.dlopen", "code.__new__", "function.__new__"}

    def data_only(event, args):
        if event in forbidden:
            raise RuntimeError("Data-only gate cannot spawn processes or load native code")
        if event == "compile":
            compiled_source, filename = args
            path = pathlib.Path(str(filename))
            raw = compiled_source.encode() if isinstance(compiled_source, str) else compiled_source
            if not str(path.resolve()).startswith("/usr/") or not path.is_file() or raw != path.read_bytes():
                raise RuntimeError("Data-only gate cannot dynamically compile candidate code")
        if event in ("marshal.loads", "marshal.load"):
            # System import machinery may read installed bytecode; the validator
            # cannot deserialize an arbitrary forged code object supplied as data.
            caller = sys._getframe(1).f_code.co_filename
            if caller != "<frozen importlib._bootstrap_external>":
                raise RuntimeError("Data-only gate cannot deserialize executable code")
        if event == "exec":
            code = args[0]
            if code is not entrypoint and not code.co_filename.startswith("/usr/"):
                raise RuntimeError("Data-only gate cannot execute candidate or dynamically compiled code")
        if event == "import" and len(args) > 1 and args[1]:
            path = os.path.realpath(str(args[1]))
            if not path.startswith("/usr/"):
                raise RuntimeError("Data-only gate imports must come from the system standard library")

    sys.addaudithook(data_only)
    sys.argv = config["argv"]
    namespace = {"__name__": "__main__", "__file__": config["argv"][0], "__builtins__": __builtins__}
    try:
        exec(entrypoint, namespace)
    except SystemExit as error:
        if error.code not in (None, 0):
            raise
    # Candidate code never executes in this process. This is a completion record
    # emitted by the trusted supervisor, not a model- or candidate-printed verdict.
    print("\nARGO_GATE_COMPLETED " + config["completion"], flush=True)


if __name__ == "__main__":
    main()
