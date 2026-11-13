#!/usr/bin/env python
# The Antigravity seat: one Pantheon role turn run as a google-antigravity Agent (the SDK lane).
#
# Why this exists next to the tool-less SDK seats in scripts/open-items-run.mjs: a seat that cannot
# run anything can only assert. This one holds read-only tools plus a shell, a bounded subagent it
# can hand a direct checkable task to, and a budget -- and it narrates. Every tool call, subagent
# start/finish, thinking burst and text burst is appended to a progress file as one JSON line, in the
# same event vocabulary scripts/overseer.mjs already reads, so a person watching the run sees what
# the seat is doing while it does it. The 2026-09-27 reviewer runs went dark for 6-9 minutes because
# the vendor stream carried nothing the parser kept; this seat cannot go dark without the file
# saying so.
#
# Role text comes from .agents/agents/pantheon-<role>/agent.md -- the SAME files the agy CLI lane
# loads (agy -p --agent pantheon-<role>) -- so the two lanes cannot drift on what the seat is told.
#
#   SEAT_PLAN=<task_id> .venv-antigravity/bin/python scripts/agy-seat.py --role reviewer \
#       --workspace <dir> --model gemini-3.7-flash --brief brief.txt [--schema schema.json] \
#       --out <dir> [--progress <file>] [--max-model-calls 40] [--max-tool-calls 60] [--timeout 900]
#
# Exit 0 on a completed turn (whatever the verdict), 2 on usage, 3 on a vendor/harness error, 4 on
# timeout. The final result is one JSON line on stdout and result.json under --out.
# --identity anywhere in the arguments prints one runtime identity JSON line and exits 0 without a vendor call.
# The runtime field in results and progress records identifies the interpreter and the loaded SDK.
import argparse
import asyncio
import importlib
import importlib.metadata
import json
import os
import re
import sys
import time
from pathlib import Path
from typing import Any

_SDK_IMPORT_ERROR = None
try:
  from google.antigravity import Agent, LocalAgentConfig, types
  from google.antigravity.hooks import hooks, policy
except ImportError as e:
  Agent = LocalAgentConfig = types = hooks = policy = None
  _SDK_IMPORT_ERROR = str(e)

T0 = time.time()
PROGRESS: Path | None = None
SEAT = {"vendor": "agy_google", "model": None, "stage": None}
RUNTIME: dict | None = None


def runtime_identity() -> dict:
  sdk = {"module": "google.antigravity", "status": "absent",
         "distribution": None, "version": None, "path": None}
  identity = {"python": f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}",
              "executable": sys.executable, "sdk": sdk}
  if _SDK_IMPORT_ERROR is not None:
    sdk["error"] = _SDK_IMPORT_ERROR
    return identity

  try:
    module = importlib.import_module("google.antigravity")
  except ImportError as e:
    sdk["error"] = str(e)
    return identity

  sdk["status"] = "installed"
  sdk["version"] = getattr(module, "__version__", None)
  module_file = getattr(module, "__file__", None)
  if module_file is not None:
    module_path = Path(module_file).resolve()
    sdk["path"] = str(module_path.parent)
    for dist in importlib.metadata.distributions():
      if any(Path(dist.locate_file(f)).resolve() == module_path for f in (dist.files or ())):
        sdk["distribution"] = dist.metadata["Name"]
        sdk["version"] = dist.version
        break
  return identity


def progress(event: str, **kw: Any) -> None:
  rec = {"at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "elapsed_s": round(time.time() - T0, 2),
         "stage": SEAT["stage"], "seat": SEAT["vendor"], "model": SEAT["model"], "event": event,
         "runtime": RUNTIME, **kw}
  line = json.dumps(rec, ensure_ascii=False)
  if PROGRESS is not None:
    with PROGRESS.open("a", encoding="utf-8") as f:
      f.write(line + "\n")
  print(line, file=sys.stderr, flush=True)


def load_agent_card(repo: Path, role: str) -> tuple[dict, str]:
  """Frontmatter (as a flat dict of scalars/lists) and body of .agents/agents/pantheon-<role>/agent.md."""
  p = repo / ".agents" / "agents" / f"pantheon-{role}" / "agent.md"
  text = p.read_text(encoding="utf-8")
  m = re.match(r"^---\n(.*?)\n---\n(.*)$", text, re.S)
  if not m:
    raise SystemExit(f"{p}: no frontmatter")
  fm: dict[str, Any] = {}
  key = None
  for raw in m.group(1).splitlines():
    if re.match(r"^\s+- ", raw) and key:
      fm.setdefault(key, []).append(raw.split("- ", 1)[1].strip())
    elif ":" in raw:
      key, _, val = raw.partition(":")
      key = key.strip(); val = val.strip()
      fm[key] = val if val else []
  return fm, m.group(2).strip()


DESTRUCTIVE = re.compile(r"(?:^|[\s;&|])(?:rm\s+-[a-zA-Z]*r|git\s+(?:push|reset\s+--hard|clean|checkout\s+--)|mkfs|dd\s+if=|>\s*/dev/sd|chmod\s+-R\s+777|curl[^|]*\|\s*(?:ba)?sh)")


def _destructive(call: "types.ToolCall") -> bool:
  blob = json.dumps(call.args, ensure_ascii=False) if getattr(call, "args", None) is not None else ""
  return bool(DESTRUCTIVE.search(blob))


READ_ONLY = ([types.BuiltinTools.VIEW_FILE, types.BuiltinTools.LIST_DIR, types.BuiltinTools.SEARCH_DIR,
              types.BuiltinTools.FIND_FILE] if types is not None else [])


def build_hooks(state: dict) -> list:
  @hooks.pre_tool_call_decide
  async def pre_tool(data: types.ToolCall) -> types.HookResult:
    args = json.dumps(getattr(data, "args", None), ensure_ascii=False)
    short = args if len(args) <= 300 else args[:300] + "…"
    if data.name in ("start_subagent", "invoke_subagent"):
      state["subagents"] += 1
      progress("subagent.start", detail=short)
    else:
      state["tools"] += 1
      progress("tool.start", detail=f"{data.name} {short}")
    return types.HookResult(allow=True)

  @hooks.post_tool_call
  async def post_tool(data: Any) -> None:
    name = getattr(data, "name", "?")
    res = getattr(data, "result", None)
    size = len(json.dumps(res, ensure_ascii=False, default=str)) if res is not None else 0
    if name in ("start_subagent", "invoke_subagent"):
      progress("subagent.done", detail=f"{size} chars returned")
    else:
      progress("tool.done", detail=f"{name} -> {size} chars")

  @hooks.on_tool_error
  async def on_error(data: Exception) -> None:
    progress("tool.error", detail=repr(data)[:300])

  @hooks.pre_turn
  async def pre_turn(data: Any) -> types.HookResult:
    progress("turn.start", detail=f"brief {state['brief_chars']} chars")
    return types.HookResult(allow=True)

  @hooks.post_turn
  async def post_turn(data: Any) -> None:
    progress("turn.text", detail=f"{len(str(data))} chars of final text")

  return [pre_tool, post_tool, on_error, pre_turn, post_turn]


async def narrate(response: Any, state: dict, every: float = 15.0) -> None:
  """Fold the thought and text streams into one heartbeat line per `every` seconds."""
  async def drain_thoughts():
    try:
      async for t in response.thoughts:
        state["thought_chars"] += len(t)
    except Exception as e:  # a closed stream is not a failure of the turn
      state["stream_note"] = f"thoughts: {e!r}"[:200]

  async def drain_text():
    try:
      async for tok in response:
        state["text_chars"] += len(tok)
    except Exception as e:
      state["stream_note"] = f"text: {e!r}"[:200]

  async def heartbeat():
    while not state["done"]:
      await asyncio.sleep(every)
      if state["done"]:
        break
      progress("turn.progress", detail=f"thinking {state['thought_chars'] // 1024} KB, text {state['text_chars']} chars, "
               f"{state['tools']} tool call(s), {state['subagents']} subagent(s)")

  hb = asyncio.create_task(heartbeat())
  try:
    await asyncio.gather(drain_thoughts(), drain_text())
  finally:
    state["done"] = True
    hb.cancel()


async def main() -> int:
  if "--identity" in sys.argv[1:]:
    print(json.dumps(runtime_identity()), flush=True)
    return 0

  global RUNTIME
  runtime = runtime_identity()
  RUNTIME = runtime
  if runtime["sdk"]["status"] == "absent":
    print(json.dumps({"ok": False, "error": runtime["sdk"]["error"], "runtime": runtime}), flush=True)
    return 3

  ap = argparse.ArgumentParser()
  ap.add_argument("--identity", action="store_true", help="print runtime identity and exit")
  ap.add_argument("--role", required=True, choices=["reviewer", "scout", "fact-checker"])
  ap.add_argument("--workspace", required=True)
  ap.add_argument("--repo", default=str(Path(__file__).resolve().parent.parent))
  ap.add_argument("--model", default="gemini-3.7-flash")
  ap.add_argument("--brief", required=True, help="file with the task text, or - for stdin")
  ap.add_argument("--schema", help="JSON schema file for structured output")
  ap.add_argument("--out", required=True)
  ap.add_argument("--progress", help="progress.jsonl to append to (default: <out>/progress.jsonl)")
  ap.add_argument("--stage", default="check")
  ap.add_argument("--max-model-calls", type=int, default=40)
  ap.add_argument("--max-tool-calls", type=int, default=60)
  ap.add_argument("--max-output-tokens", type=int, default=60000)
  ap.add_argument("--timeout", type=float, default=900.0)
  ap.add_argument("--no-subagent", action="store_true")
  a = ap.parse_args()

  global PROGRESS
  out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
  PROGRESS = Path(a.progress) if a.progress else out / "progress.jsonl"
  SEAT["model"] = a.model; SEAT["stage"] = a.stage
  vertex_project = os.environ.get("PANTHEON_AGY_VERTEX_PROJECT")
  if not os.environ.get("GEMINI_API_KEY") and not vertex_project:
    print(json.dumps({"ok": False, "error": "GEMINI_API_KEY absent", "runtime": runtime}), flush=True)
    return 2

  repo = Path(a.repo)
  fm, body = load_agent_card(repo, a.role)
  brief = sys.stdin.read() if a.brief == "-" else Path(a.brief).read_text(encoding="utf-8")
  schema = json.loads(Path(a.schema).read_text(encoding="utf-8")) if a.schema else None

  subagents: list[types.SubagentConfig] = []
  allowed: list[str] | None = None
  if a.role == "reviewer" and not a.no_subagent:
    _, fc_body = load_agent_card(repo, "fact-checker")
    subagents.append(types.SubagentConfig(
        name="pantheon-fact-checker",
        description="Runs ONE direct, checkable task in this tree (a command, a probe, a file read) and returns commands, exit codes and output. Never a verdict.",
        system_instructions=fc_body,
        capabilities=types.SubagentCapabilities(enabled_tools=READ_ONLY + [types.BuiltinTools.RUN_COMMAND]),
    ))
    allowed = ["pantheon-fact-checker"]

  enabled = READ_ONLY + [types.BuiltinTools.RUN_COMMAND, types.BuiltinTools.FINISH]
  if a.role == "scout":
    enabled += [types.BuiltinTools.SEARCH_WEB, types.BuiltinTools.READ_URL_CONTENT]
  if subagents:
    enabled.append(types.BuiltinTools.START_SUBAGENT)

  state = {"tools": 0, "subagents": 0, "thought_chars": 0, "text_chars": 0, "done": False,
           "brief_chars": len(brief), "stream_note": None}
  vertex_kw = ({"vertex": True, "project": vertex_project,
                "location": os.environ.get("PANTHEON_AGY_VERTEX_LOCATION", "global")} if vertex_project else {})
  config = LocalAgentConfig(
      **vertex_kw,
      model=a.model,
      system_instructions=body,
      workspaces=[a.workspace],
      capabilities=types.CapabilitiesConfig(
          enable_subagents=bool(subagents), enabled_tools=enabled,
          max_subagent_depth=1 if subagents else None, allowed_subagents=allowed),
      subagents=subagents,
      policies=[policy.allow_all(),
                policy.deny(types.BuiltinTools.RUN_COMMAND.value, when=_destructive, name="no-destructive-commands")],
      hooks=build_hooks(state),
      budget_config=types.BudgetConfig(max_model_calls=a.max_model_calls, max_tool_calls=a.max_tool_calls,
                                       max_output_tokens=a.max_output_tokens),
      response_schema=schema,
  )
  progress("seat.start", runtime=runtime, detail=f"role {a.role}, workspace {a.workspace}, subagents {[s.name for s in subagents]}, "
           f"budget calls {a.max_model_calls}/tools {a.max_tool_calls}/out {a.max_output_tokens}, timeout {a.timeout:.0f}s")

  result: dict[str, Any] = {"ok": False, "role": a.role, "model": a.model, "runtime": runtime}
  started = time.time()
  try:
    async with Agent(config) as agent:
      response = await agent.chat(brief)
      try:
        await asyncio.wait_for(narrate(response, state), timeout=a.timeout)
      except asyncio.TimeoutError:
        progress("turn.error", detail=f"timeout after {a.timeout:.0f}s; cancelling")
        try:
          await response.cancel()
        except Exception:
          pass
        result["error"] = "timeout"
        (out / "result.json").write_text(json.dumps(result, indent=1), encoding="utf-8")
        print(json.dumps(result), flush=True)
        return 4
      text = await response.text()
      structured = None
      if schema is not None:
        try:
          structured = await response.structured_output()
        except Exception as e:
          result["structured_error"] = repr(e)[:300]
      um = response.usage_metadata
      usage = None
      if um is not None:
        usage = {k: getattr(um, k, None) for k in ("prompt_token_count", "candidates_token_count", "thoughts_token_count",
                                                     "cached_content_token_count", "total_token_count",
                                                     "input_tokens", "output_tokens", "thinking_tokens", "total_tokens")}
        usage = {k: v for k, v in usage.items() if v is not None}
      result.update(ok=True, text=text, structured_output=structured, usage=usage,
                    stop_reason=str(getattr(response, "stop_reason", None)),
                    conversation_id=getattr(agent, "conversation_id", None),
                    tool_calls=state["tools"], subagent_calls=state["subagents"],
                    thought_chars=state["thought_chars"], duration_s=round(time.time() - started, 2),
                    stream_note=state["stream_note"])
  except Exception as e:
    result["error"] = f"{type(e).__name__}: {e}"[:1500]
    progress("turn.error", detail=result["error"][:300])
    (out / "result.json").write_text(json.dumps(result, indent=1), encoding="utf-8")
    print(json.dumps(result), flush=True)
    return 3

  (out / "result.json").write_text(json.dumps(result, indent=1, ensure_ascii=False), encoding="utf-8")
  (out / "response.md").write_text(text, encoding="utf-8")
  progress("turn.done", ms=int((time.time() - started) * 1000),
           detail=f"{len(text)} chars, {state['tools']} tool call(s), {state['subagents']} subagent(s), stop {result['stop_reason']}")
  print(json.dumps({k: v for k, v in result.items() if k != "text"}, ensure_ascii=False), flush=True)
  return 0


if __name__ == "__main__":
  sys.exit(asyncio.run(main()))
