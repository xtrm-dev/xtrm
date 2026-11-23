#!/usr/bin/env python3
"""Count knowledge_* tool use against Read/Grep, per session, from host session logs (XTRM-997).

The nudge hook only pays for itself if sessions actually call the knowledge tools. This script is
the before/after measure: it reads the Claude Code transcripts (``~/.claude/projects/**/*.jsonl``)
and the Pi session logs (``~/.pi/agent/sessions/**/*.jsonl``), and prints, per session, how many
Read/Grep/Glob/Bash calls a session made against how many ``knowledge_*`` calls.

Both hosts log tool calls as JSONL, with different block shapes:
  * Claude Code: ``{"type":"assistant","message":{"content":[{"type":"tool_use","name":...}]}}``
  * Pi:          ``{"type":"message","message":{"role":"assistant","content":[{"type":"toolCall","name":...}]}}``
Tool names are matched case-insensitively; ``knowledge_*`` covers the plugin MCP names
(``mcp__service-knowledge__knowledge_get``) and the Pi extension names, and a
``service-knowledge <verb>`` console invocation found in a shell command is counted separately.

Usage:
    python3 packages/service-knowledge/scripts/knowledge_usage.py --days 3
    python3 packages/service-knowledge/scripts/knowledge_usage.py --days 7 --json
    python3 packages/service-knowledge/scripts/knowledge_usage.py --claude-root ~/.claude/projects

Exit codes: 0 on success, 2 on an argument error. A missing log root is not an error; the script
reports it as empty, so it can run on a host that has only one of the two harnesses.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path

KNOWLEDGE_PREFIX = "knowledge_"
MCP_KNOWLEDGE_MARKERS = ("mcp__service-knowledge__", "mcp__plugin_service-knowledge")
COUNTED = ("Read", "Grep", "Glob", "Bash")
GITNEXUS = "gitnexus"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def default_claude_root() -> Path:
    return Path(os.environ.get("CLAUDE_PROJECTS_DIR", "~/.claude/projects")).expanduser()


def default_pi_root() -> Path:
    return Path(os.environ.get("PI_SESSIONS_DIR", "~/.pi/agent/sessions")).expanduser()


def _timestamp(value: object) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    text = value.replace("Z", "+00:00")
    try:
        stamp = datetime.fromisoformat(text)
    except ValueError:
        return None
    return stamp if stamp.tzinfo else stamp.replace(tzinfo=timezone.utc)


@dataclass
class Session:
    """One session log: where it ran, when it ran, and the tool calls inside the window."""

    source: str
    path: Path
    project: str
    started: datetime | None = None
    counts: dict[str, int] = field(default_factory=dict)
    knowledge_cli: int = 0

    @property
    def tool_calls(self) -> int:
        return sum(self.counts.values())

    @property
    def knowledge_calls(self) -> int:
        return sum(count for name, count in self.counts.items() if name.lower().startswith(KNOWLEDGE_PREFIX))

    def bump(self, name: str) -> None:
        self.counts[name] = self.counts.get(name, 0) + 1


SEGMENT_SPLIT = re.compile(r"\s*(?:&&|\|\||;|\||\n)\s*")
CLI_NAMES = ("service-knowledge", "svc-knowledge")


def classify(name: str) -> str | None:
    """Map a logged tool name to the counter it belongs to, or None when it is not counted."""
    lowered = name.lower()
    if lowered.startswith(KNOWLEDGE_PREFIX):
        return name
    for marker in MCP_KNOWLEDGE_MARKERS:
        if lowered.startswith(marker):
            return lowered.removeprefix(marker)
    if "gitnexus" in lowered:
        return "gitnexus"
    # Pi and Claude both spell these in lower case in some releases.
    for counted in COUNTED:
        if lowered == counted.lower():
            return counted
    return None


def invokes_knowledge_cli(command: str) -> bool:
    """True when the shell command starts a segment with the service-knowledge console script.

    A plain substring test is wrong here: sessions quote the phrase in prose, heredocs, and file
    paths constantly. Only a command position counts, so ``service-knowledge reconcile`` and
    ``cd repo && service-knowledge reconcile`` are invocations and ``grep service-knowledge docs``
    is not.
    """
    for segment in SEGMENT_SPLIT.split(command):
        words = segment.split()
        while words:
            head = words[0]
            if head in ("cd", "pushd"):
                words = words[2:]  # the directory argument is not a command
                continue
            if head in ("time", "command", "env", "sudo", "nohup"):
                words = words[1:]
                continue
            if "=" in head and not head.startswith("-"):
                words = words[1:]  # VAR=value prefix
                continue
            if head.startswith("-"):
                words = words[1:]  # a flag of the prefix command, e.g. `env -i`
                continue
            break
        if words and Path(words[0]).name in CLI_NAMES:
            return True
    return False


def _blocks(record: dict) -> list[dict]:
    """Tool-call blocks of one assistant message, in either host's shape."""
    message = record.get("message")
    if not isinstance(message, dict) or message.get("role") != "assistant":
        return []
    content = message.get("content")
    if not isinstance(content, list):
        return []
    return [block for block in content if isinstance(block, dict) and block.get("type") in ("tool_use", "toolCall")]


def _input_of(block: dict) -> dict:
    for key in ("input", "arguments"):
        value = block.get(key)
        if isinstance(value, dict):
            return value
    return {}


def read_session(path: Path, source: str, since: datetime) -> Session | None:
    """Parse one session log. Returns None when it holds no tool call inside the window."""
    session = Session(source=source, path=path, project=path.parent.name)
    try:
        handle = path.open(encoding="utf-8", errors="replace")
    except OSError:
        return None
    with handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            try:
                record = json.loads(line)
            except json.JSONDecodeError:
                continue
            if not isinstance(record, dict):
                continue
            stamp = _timestamp(record.get("timestamp"))
            if stamp is not None and session.started is None:
                session.started = stamp
            if stamp is not None and stamp < since:
                continue
            for block in _blocks(record):
                name = block.get("name")
                if not isinstance(name, str):
                    continue
                counter = classify(name)
                if counter is not None:
                    session.bump(counter)
                command = _input_of(block).get("command")
                if isinstance(command, str) and invokes_knowledge_cli(command):
                    session.knowledge_cli += 1
    if session.tool_calls == 0 and session.knowledge_cli == 0:
        return None
    return session


def collect(root: Path, source: str, since: datetime) -> list[Session]:
    if not root.exists():
        return []
    sessions = []
    for path in sorted(root.rglob("*.jsonl")):
        try:
            if datetime.fromtimestamp(path.stat().st_mtime, timezone.utc) < since - timedelta(days=1):
                continue  # cheap pre-filter; the message timestamps decide inclusion
        except OSError:
            continue
        session = read_session(path, source, since)
        if session is not None:
            sessions.append(session)
    return sessions


def summarise(sessions: list[Session], days: int, roots: dict[str, Path]) -> dict:
    total = {name: 0 for name in COUNTED}
    knowledge: dict[str, int] = {}
    gitnexus = 0
    for session in sessions:
        for name, count in session.counts.items():
            if name in total:
                total[name] += count
            elif name == GITNEXUS:
                gitnexus += count
            elif name.lower().startswith(KNOWLEDGE_PREFIX):
                knowledge[name] = knowledge.get(name, 0) + count
    with_tools = [s for s in sessions if s.tool_calls]
    with_knowledge = [s for s in sessions if s.knowledge_calls]
    knowledge_calls = sum(knowledge.values())
    return {
        "window_days": days,
        "since": None,
        "roots": {name: str(path) for name, path in roots.items()},
        "sessions_with_tool_use": len(with_tools),
        "sessions_with_knowledge_calls": len(with_knowledge),
        "knowledge_calls": knowledge_calls,
        "knowledge_calls_by_tool": dict(sorted(knowledge.items())),
        "knowledge_cli_invocations": sum(s.knowledge_cli for s in sessions),
        "gitnexus_calls": gitnexus,
        "tool_calls": total,
        "tool_calls_total": sum(total.values()),
        "sessions": [
            {
                "source": s.source,
                "project": s.project,
                "session": s.path.stem.split("_")[-1][:8] or s.path.stem[:8],
                "started": s.started.isoformat() if s.started else None,
                "tool_calls": s.tool_calls,
                "knowledge_calls": s.knowledge_calls,
                "counts": dict(sorted(s.counts.items())),
            }
            for s in sorted(sessions, key=lambda item: item.started or datetime.min.replace(tzinfo=timezone.utc))
        ],
    }


def render(summary: dict, days: int) -> str:
    lines = [
        f"tool use, last {days} day(s), roots: "
        + ", ".join(f"{name}={path}" for name, path in summary["roots"].items()),
        "",
        f"sessions with tool use:      {summary['sessions_with_tool_use']}",
        f"sessions with knowledge_*:   {summary['sessions_with_knowledge_calls']}",
        f"knowledge_* calls:           {summary['knowledge_calls']}"
        + (f"  {summary['knowledge_calls_by_tool']}" if summary["knowledge_calls_by_tool"] else ""),
        f"service-knowledge CLI calls: {summary['knowledge_cli_invocations']}",
        f"gitnexus tool calls:         {summary['gitnexus_calls']}",
        "other tool calls:            " + ", ".join(f"{name}={count}" for name, count in summary["tool_calls"].items()),
        "",
        f"{'source':7} {'project':44} {'session':9} {'tools':>5} {'know':>4}",
    ]
    for row in summary["sessions"]:
        project = row["project"]
        if len(project) > 44:
            project = project[:41] + "..."
        lines.append(
            f"{row['source']:7} {project:44} {row['session']:9} {row['tool_calls']:5d} {row['knowledge_calls']:4d}"
        )
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Count knowledge_* use against Read/Grep per session.")
    parser.add_argument("--days", type=int, default=3, help="window in days, counted back from now (default 3)")
    parser.add_argument("--claude-root", type=Path, default=default_claude_root(), help="Claude Code projects dir")
    parser.add_argument("--pi-root", type=Path, default=default_pi_root(), help="Pi sessions dir")
    parser.add_argument("--json", action="store_true", help="print the summary as JSON")
    args = parser.parse_args(argv)
    if args.days < 1:
        parser.error("--days must be at least 1")

    since = _now() - timedelta(days=args.days)
    roots = {"claude": args.claude_root, "pi": args.pi_root}
    sessions = collect(args.claude_root.expanduser(), "claude", since) + collect(args.pi_root.expanduser(), "pi", since)
    summary = summarise(sessions, args.days, roots)
    summary["since"] = since.isoformat()
    if args.json:
        print(json.dumps(summary, indent=2))
    else:
        print(render(summary, args.days))
    return 0


if __name__ == "__main__":
    sys.exit(main())
