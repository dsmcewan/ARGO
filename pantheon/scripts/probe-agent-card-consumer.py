#!/usr/bin/env python3
# Does a GENERATED Antigravity card actually reach the seat that loads it?
#
# npm test cannot answer this. The suite checks what the renderer emits; this checks what
# scripts/agy-seat.py accepts -- the only consumer of these cards that exists. On 2026-09-28 the
# two disagreed: every render test was green while `load_agent_card` raised FileNotFoundError,
# because the renderer named cards pantheon-<role>-<vendor>-<model> and the loader opens
# pantheon-<role>/agent.md by role alone. A card that parses perfectly and is never opened is the
# failure this probe exists to catch.
#
# The oracle is agy-seat.py's OWN load_agent_card, extracted with ast so the antigravity SDK is not
# imported. It is their function, not a copy: retyping the parser would test this file's idea of it.
#
# Run:  python3 scripts/probe-agent-card-consumer.py
# Pass: TEST 1 FOUND, TEST 2 PARSED OK with ISSUES: none.

import ast, re, json, subprocess, sys, tempfile, shutil
from pathlib import Path

REPO = Path("/home/colchis/Projects/pantheon")
SRC = (REPO / "scripts" / "agy-seat.py").read_text(encoding="utf-8")

# Extract the REAL load_agent_card, byte-for-byte, without importing the antigravity SDK.
tree = ast.parse(SRC)
fn = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "load_agent_card")
ns = {"re": re, "Path": Path, "Any": object, "SystemExit": SystemExit}
exec(compile(ast.Module(body=[fn], type_ignores=[]), "agy-seat.py", "exec"), ns)
load_agent_card = ns["load_agent_card"]

tmp = Path(tempfile.mkdtemp(prefix="consumer-probe-"))
try:
    # Generate a card with MY renderer, via the MCP server's own install path.
    req = {"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"install_agents",
           "arguments":{"ids":["reviewer@agy_google/gemini-3.5-flash"],"format":"antigravity","root":str(tmp)}}}
    out = subprocess.run([ "/usr/bin/node", str(REPO/"bin"/"pantheon-agents-mcp.mjs")],
        input=json.dumps(req)+"\n", capture_output=True, text=True,
        env={"PATH":"/usr/bin:/bin","PANTHEON_AGENTS_ROOT":str(tmp)})
    written = json.loads(json.loads(out.stdout.strip().splitlines()[-1])["result"]["content"][0]["text"])["written"]
    generated = written[0]["filename"]
    print(f"generated: {generated}")

    print("\n--- TEST 1: can the consumer FIND it at the name I generated? ---")
    try:
        load_agent_card(tmp, "reviewer")
        print("  FOUND")
    except FileNotFoundError as e:
        print(f"  NOT FOUND -> {e}")
        print(f"  consumer looks for: .agents/agents/pantheon-reviewer/agent.md")
        print(f"  I wrote:            {generated}")

    print("\n--- TEST 2: if placed at the expected path, does it PARSE? ---")
    src = tmp / generated
    dst = tmp / ".agents" / "agents" / "pantheon-reviewer" / "agent.md"
    dst.parent.mkdir(parents=True, exist_ok=True)
    if src.resolve() != dst.resolve():
        shutil.copy(src, dst)
    else:
        print('  (already at the expected path -- the fix landed)')
    try:
        fm, body = load_agent_card(tmp, "reviewer")
        print("  PARSED OK")
        print(f"  tools      = {fm.get('tools')}")
        print(f"  model      = {fm.get('model')!r}")
        print(f"  policy     = {fm.get('commandExecutionPolicy')!r}")
        print(f"  description= {str(fm.get('description'))[:60]!r}...")
        print(f"  body chars = {len(body)}")
        # What the real seat depends on:
        problems = []
        if not isinstance(fm.get("tools"), list): problems.append("tools is not a list -> seat gets no tools")
        if str(fm.get("description","")).startswith('"'): problems.append('description keeps literal quotes (parser does not strip them)')
        print("  ISSUES:", problems if problems else "none")
    except SystemExit as e:
        print(f"  PARSE FAILED -> {e}")
finally:
    shutil.rmtree(tmp, ignore_errors=True)
