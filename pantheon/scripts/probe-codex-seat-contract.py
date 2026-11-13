#!/usr/bin/env python3
"""Does a GENERATED Codex seat spec resolve to a real thread_start() call?

npm test cannot answer this. The suite checks what render.mjs emits against assertions in the same
repo; this checks it against `openai_codex.Codex.thread_start`'s ACTUAL signature in the installed
SDK. The two can disagree silently: a spec key that is not a real parameter would be accepted by
every JS test and rejected (or worse, ignored) at the seat.

This is the same failure the antigravity probe caught -- a card that parsed perfectly and was never
opened -- so it gets the same kind of oracle: the consumer's own definition, read by reflection,
never retyped here.

Run:  .venv-codex/bin/python scripts/probe-codex-seat-contract.py
Pass: every check prints OK and the exit code is 0.
"""
import inspect
import json
import subprocess
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
FAILURES = []


def check(label: str, ok: bool, detail: str = "") -> None:
    print(f"  {'OK  ' if ok else 'FAIL'}  {label}{(' -- ' + detail) if detail else ''}")
    if not ok:
        FAILURES.append(label)


def main() -> int:
    try:
        from openai_codex import Codex, Sandbox, ApprovalMode
    except ImportError as e:
        print(f"openai_codex not importable ({e}). Run this with .venv-codex/bin/python.")
        return 2

    # --- 1. the SDK's real parameter set, by reflection ---
    sig = inspect.signature(Codex.thread_start)
    real_params = {n for n in sig.parameters if n != "self"}
    print(f"thread_start() accepts {len(real_params)} parameters")

    # --- 2. generate a spec through the actual MCP install path ---
    with tempfile.TemporaryDirectory(prefix="codex-seat-probe-") as tmp:
        req = {"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {
            "name": "install_agents", "arguments": {
                "ids": ["reviewer@xai/grok-4.7", "implementer@openai/gpt-6-astra"],
                "format": "codex", "root": tmp}}}
        out = subprocess.run(
            ["/usr/bin/node", str(REPO / "bin" / "pantheon-agents-mcp.mjs")],
            input=json.dumps(req) + "\n", capture_output=True, text=True,
            env={"PATH": "/usr/bin:/bin", "PANTHEON_AGENTS_ROOT": tmp})
        line = out.stdout.strip().splitlines()[-1] if out.stdout.strip() else ""
        if not line:
            print("FAIL: MCP server produced no output\n" + out.stderr[:500])
            return 1
        written = json.loads(json.loads(line)["result"]["content"][0]["text"])["written"]
        print(f"generated {len(written)} seat spec(s)\n")

        for w in written:
            spec_path = Path(tmp) / w["filename"]
            spec = json.loads(spec_path.read_text())
            pantheon = spec.pop("pantheon", None)
            print(f"{w['id']}  ->  {w['filename']}")

            # --- 3. every emitted key is a REAL thread_start parameter ---
            unknown = set(spec) - real_params
            check("every spec key is a thread_start() parameter", not unknown,
                  f"unknown: {sorted(unknown)}" if unknown else "")

            # --- 4. enum values are accepted by the SDK's OWN enums, not by a copy of them ---
            try:
                Sandbox(spec["sandbox"]); ok_s = True; why_s = ""
            except Exception as e:
                ok_s, why_s = False, str(e)
            check(f"sandbox {spec.get('sandbox')!r} is a real Sandbox value", ok_s, why_s)
            try:
                ApprovalMode(spec["approval_mode"]); ok_a = True; why_a = ""
            except Exception as e:
                ok_a, why_a = False, str(e)
            check(f"approval_mode {spec.get('approval_mode')!r} is a real ApprovalMode", ok_a, why_a)

            # --- 5. the properties that matter for THIS project ---
            check("developer_instructions carries the charter",
                  bool(spec.get("developer_instructions", "").strip()))
            check("pantheon metadata is namespaced, not mixed into SDK kwargs", pantheon is not None)
            role = (pantheon or {}).get("role")
            if role == "implementer":
                check("implementer gets a writable sandbox", spec["sandbox"] == "workspace-write")
            else:
                check(f"{role} is read-only", spec["sandbox"] == "read-only")
            check("approval never delegated to the seat", spec["approval_mode"] == "deny_all")

            # --- 6. the seat script itself accepts it, end to end ---
            ws = Path(tmp) / "ws"; ws.mkdir(exist_ok=True)
            pf = Path(tmp) / "prompt.txt"; pf.write_text("probe prompt\n")
            r = subprocess.run(
                [sys.executable, str(REPO / "scripts" / "codex-seat.py"),
                 "--spec", str(spec_path), "--workspace", str(ws),
                 "--prompt-file", str(pf), "--dry-run"],
                capture_output=True, text=True)
            check("codex-seat.py --dry-run accepts the generated spec", r.returncode == 0,
                  (r.stderr.strip().splitlines() or [""])[-1] if r.returncode else "")
            print()

    if FAILURES:
        print(f"FAILED: {len(FAILURES)} check(s): {FAILURES}")
        return 1
    print("all checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
