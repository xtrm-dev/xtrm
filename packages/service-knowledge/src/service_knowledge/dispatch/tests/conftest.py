"""Fixtures for the dispatch / activator tests.

Builds a throwaway git consumer repo with an ``api-gateway`` service (the §3.7 canonical
example), builds its FTS5 index, and provides a helper that runs the real PreToolUse activator
script as a subprocess (exactly how the hook fires) so block / inject / override behaviour is
exercised end-to-end.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

from service_knowledge import index
from service_knowledge.index.tests.conftest import make_consumer

_ACTIVATOR = Path(__file__).resolve().parent.parent.parent / "scripts" / "skill_activator.py"

# A faithful boundary stub for the external `bd` CLI: implements `show <id> --json` and
# `update <id> --body-file -` against a JSON store, so dispatch/promotion wiring is exercised
# end-to-end through the real activator subprocess without touching a real beads database.
_FAKE_BD = '''#!/usr/bin/env python3
import json, os, sys
store = os.environ["FAKE_BD_STORE"]
def load():
    try:
        with open(store) as f:
            return json.load(f)
    except (FileNotFoundError, ValueError):
        return {}
def save(d):
    with open(store, "w") as f:
        json.dump(d, f)
args = sys.argv[1:]
cmd = args[0] if args else ""
if cmd == "show":
    rec = load().get(args[1])
    if rec is None:
        sys.stderr.write("not found\\n")
        sys.exit(1)
    print(json.dumps([rec]))
    sys.exit(0)
if cmd == "update":
    d = load()
    rec = d.setdefault(args[1], {"id": args[1], "title": "t", "description": "",
                                 "created_at": "2026-08-01T00:00:00Z"})
    if "--body-file" in args:
        rec["description"] = sys.stdin.read()
    save(d)
    print("updated")
    sys.exit(0)
if cmd == "set-state":
    sys.exit(0)
sys.exit(0)
'''


@pytest.fixture
def gateway_consumer(tmp_path: Path) -> Path:
    """Consumer repo with one ``api-gateway`` service + a built FTS5 index."""
    repo = make_consumer(
        tmp_path,
        {
            "api-gateway": {
                "description": "Edge API gateway.",
                "territory": ["api-gateway/**"],
                "triggers": ["gateway", "api", "rate limit"],
                "overview": "api-gateway terminates TLS and enforces rate limits.",
            }
        },
    )
    index.build(repo)
    return repo


def run_activator(
    consumer: Path,
    tool_name: str,
    tool_input: dict,
    *,
    override: bool = False,
    extra_env: dict | None = None,
) -> tuple[int, dict | None, str]:
    """Run the real activator script as the hook would; return (exit_code, parsed_json, stderr)."""
    env = dict(os.environ)
    env["CLAUDE_PROJECT_DIR"] = str(consumer)
    env.pop("SERVICE_KNOWLEDGE_ROOT", None)
    if override:
        env["OVERRIDE_KNOWLEDGE_BUNDLE"] = "1"
    else:
        env.pop("OVERRIDE_KNOWLEDGE_BUNDLE", None)
    if extra_env:
        env.update(extra_env)
    payload = json.dumps({"tool_name": tool_name, "tool_input": tool_input})
    proc = subprocess.run(
        [sys.executable, str(_ACTIVATOR)],
        input=payload,
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
    )
    parsed = json.loads(proc.stdout) if proc.stdout.strip() else None
    return proc.returncode, parsed, proc.stderr


@pytest.fixture
def fake_bd(tmp_path: Path) -> dict:
    """A fake `bd` executable on PATH backed by a JSON store; returns {bin, store, env}."""
    bin_dir = tmp_path / "fakebin"
    bin_dir.mkdir()
    script = bin_dir / "bd"
    script.write_text(_FAKE_BD, encoding="utf-8")
    script.chmod(0o755)
    store = tmp_path / "bd-store.json"
    store.write_text("{}", encoding="utf-8")
    env = {
        "PATH": f"{bin_dir}{os.pathsep}{os.environ.get('PATH', '')}",
        "FAKE_BD_STORE": str(store),
    }
    return {"bin": str(bin_dir), "store": str(store), "env": env}


def write_bead(fake_bd: dict, bead_id: str, description: str,
               created_at: str = "2026-08-01T00:00:00Z", title: str = "t") -> None:
    path = Path(fake_bd["store"])
    store = json.loads(path.read_text(encoding="utf-8"))
    store[bead_id] = {"id": bead_id, "title": title,
                      "description": description, "created_at": created_at}
    path.write_text(json.dumps(store), encoding="utf-8")


def read_bead(fake_bd: dict, bead_id: str) -> dict | None:
    return json.loads(Path(fake_bd["store"]).read_text(encoding="utf-8")).get(bead_id)


def read_telemetry(consumer: Path) -> list[dict]:
    path = consumer / ".xtrm" / "state" / "service-knowledge" / "events.jsonl"
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
