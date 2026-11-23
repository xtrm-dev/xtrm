"""The before/after usage count for service-knowledge nudges (XTRM-997).

The script is the measurement instrument for this Issue, so it has to be right about what it
counts: a False positive on `service-knowledge` in prose would inflate the "after" number and a
missed Claude transcript would erase the "before" one.
"""
from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

PACKAGE_ROOT = Path(__file__).resolve().parents[1]
SCRIPT = PACKAGE_ROOT / "scripts" / "knowledge_usage.py"


def load():
    spec = importlib.util.spec_from_file_location("knowledge_usage", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    # dataclass resolution needs the module registered while its body executes.
    sys.modules["knowledge_usage"] = module
    spec.loader.exec_module(module)
    return module


usage = load()


def stamp(minutes_ago: int = 1) -> str:
    return (datetime.now(timezone.utc) - timedelta(minutes=minutes_ago)).isoformat().replace("+00:00", "Z")


def claude_record(name: str, tool_input: dict) -> dict:
    return {
        "type": "assistant",
        "timestamp": stamp(),
        "message": {"role": "assistant", "content": [{"type": "tool_use", "name": name, "input": tool_input}]},
    }


def pi_record(name: str, arguments: dict) -> dict:
    return {
        "type": "message",
        "timestamp": stamp(),
        "message": {"role": "assistant", "content": [{"type": "toolCall", "name": name, "arguments": arguments}]},
    }


def write_session(root: Path, project: str, name: str, records: list[dict]) -> Path:
    directory = root / project
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"{name}.jsonl"
    path.write_text("".join(json.dumps(record) + "\n" for record in records), encoding="utf-8")
    return path


def test_both_host_shapes_are_counted(tmp_path: Path):
    claude_root = tmp_path / "claude"
    pi_root = tmp_path / "pi"
    write_session(
        claude_root,
        "-home-dawid-dev-acme",
        "session-a",
        [
            claude_record("Read", {"file_path": "api/app.py"}),
            claude_record("Read", {"file_path": "api/other.py"}),
            claude_record("Grep", {"pattern": "x"}),
            claude_record("mcp__service-knowledge__knowledge_evidence_for_files", {"paths": ["api/app.py"]}),
            claude_record("mcp__gitnexus__query", {"query": "auth"}),
        ],
    )
    write_session(
        pi_root,
        "--home-dawid-dev-acme--",
        "session-b",
        [
            pi_record("read", {"path": "web/src/ui.ts"}),
            pi_record("knowledge_search", {"query": "session"}),
            pi_record("bash", {"command": "sed -n 1,20p web/src/ui.ts"}),
        ],
    )

    since = datetime.now(timezone.utc) - timedelta(days=1)
    sessions = usage.collect(claude_root, "claude", since) + usage.collect(pi_root, "pi", since)
    summary = usage.summarise(sessions, 1, {"claude": claude_root, "pi": pi_root})

    assert summary["sessions_with_tool_use"] == 2
    assert summary["sessions_with_knowledge_calls"] == 2
    assert summary["knowledge_calls"] == 2
    assert summary["knowledge_calls_by_tool"] == {
        "knowledge_evidence_for_files": 1,
        "knowledge_search": 1,
    }
    assert summary["tool_calls"] == {"Read": 3, "Grep": 1, "Glob": 0, "Bash": 1}
    assert summary["gitnexus_calls"] == 1


def test_a_session_without_knowledge_calls_still_shows_its_read_cost(tmp_path: Path):
    claude_root = tmp_path / "claude"
    write_session(
        claude_root,
        "-home-dawid-dev-mercury",
        "session-c",
        [claude_record("Read", {"file_path": "api/app.py"}) for _ in range(4)],
    )
    sessions = usage.collect(claude_root, "claude", datetime.now(timezone.utc) - timedelta(days=1))
    summary = usage.summarise(sessions, 1, {"claude": claude_root})
    assert summary["sessions_with_tool_use"] == 1
    assert summary["sessions_with_knowledge_calls"] == 0
    assert summary["knowledge_calls"] == 0
    assert summary["tool_calls"]["Read"] == 4


def test_messages_outside_the_window_are_ignored(tmp_path: Path):
    claude_root = tmp_path / "claude"
    old = {
        "type": "assistant",
        "timestamp": (datetime.now(timezone.utc) - timedelta(days=9)).isoformat(),
        "message": {"role": "assistant", "content": [{"type": "tool_use", "name": "Read", "input": {}}]},
    }
    write_session(claude_root, "-home-dawid-dev-acme", "old-session", [old])
    sessions = usage.collect(claude_root, "claude", datetime.now(timezone.utc) - timedelta(days=3))
    assert usage.summarise(sessions, 3, {"claude": claude_root})["sessions_with_tool_use"] == 0


def test_broken_lines_and_foreign_blocks_do_not_crash(tmp_path: Path):
    claude_root = tmp_path / "claude"
    directory = claude_root / "-home-dawid-dev-acme"
    directory.mkdir(parents=True)
    good = json.dumps(claude_record("Read", {})) + "\n"
    (directory / "mixed.jsonl").write_text(
        "not json\n" + good + '{"type":"assistant","message":{"role":"user"}}\n' + '{"type":"assistant","message":{"role":"assistant","content":"plain text"}}\n',
        encoding="utf-8",
    )
    sessions = usage.collect(claude_root, "claude", datetime.now(timezone.utc) - timedelta(days=1))
    assert usage.summarise(sessions, 1, {})["tool_calls"]["Read"] == 1


def test_knowledge_cli_counts_only_in_command_position():
    assert usage.invokes_knowledge_cli("service-knowledge reconcile")
    assert usage.invokes_knowledge_cli("cd ~/dev/acme && service-knowledge status --json")
    assert usage.invokes_knowledge_cli("TIME=1 service-knowledge drift")
    assert usage.invokes_knowledge_cli("sudo service-knowledge status")
    assert usage.invokes_knowledge_cli("env -i service-knowledge status")
    assert not usage.invokes_knowledge_cli("grep -rn service-knowledge docs/")
    assert not usage.invokes_knowledge_cli("python3 packages/service-knowledge/scripts/knowledge_usage.py")
    assert not usage.invokes_knowledge_cli("echo 'run service-knowledge reconcile' >> notes.md")
    assert not usage.invokes_knowledge_cli("cat service-registry.json | jq .")


def test_a_missing_root_is_empty_not_an_error(tmp_path: Path):
    missing = tmp_path / "nothing-here"
    assert usage.collect(missing, "claude", datetime.now(timezone.utc)) == []


def test_cli_prints_a_human_summary_and_json(tmp_path: Path):
    claude_root = tmp_path / "claude"
    write_session(
        claude_root,
        "-home-dawid-dev-acme",
        "session-d",
        [claude_record("Read", {"file_path": "api/app.py"}), claude_record("knowledge_get", {"item_id": "x"})],
    )
    pi_root = tmp_path / "pi"
    common = ["--days", "1", "--claude-root", str(claude_root), "--pi-root", str(pi_root)]
    human = subprocess.run([sys.executable, str(SCRIPT), *common], capture_output=True, text=True, check=True)
    assert "sessions with tool use:      1" in human.stdout
    assert "knowledge_* calls:           1" in human.stdout
    as_json = subprocess.run(
        [sys.executable, str(SCRIPT), *common, "--json"], capture_output=True, text=True, check=True
    )
    payload = json.loads(as_json.stdout)
    assert payload["sessions_with_tool_use"] == 1
    assert payload["knowledge_calls"] == 1
    assert payload["tool_calls"]["Read"] == 1
    assert payload["sessions"][0]["project"] == "-home-dawid-dev-acme"


def test_an_invalid_window_is_an_argument_error(tmp_path: Path):
    result = subprocess.run(
        [sys.executable, str(SCRIPT), "--days", "0", "--claude-root", str(tmp_path), "--pi-root", str(tmp_path)],
        capture_output=True,
        check=False,
        text=True,
    )
    assert result.returncode == 2
    assert "--days" in result.stderr
