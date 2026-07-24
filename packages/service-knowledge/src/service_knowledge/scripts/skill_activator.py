#!/usr/bin/env python3
"""
PreToolUse hook: skill activator (research §3.7 firing point).

Fires before Read, Write, Edit, Glob, Grep, or Bash operations. When the operation touches a
registered service territory it invokes the per-repo FTS5 retrieval surface
(``knowledge_evidence_for_files`` / ``index.evidence_for_files``) and injects the resulting §3.2
evidence bundle into the PreToolUse context — replacing the old "please read SKILL.md" reminder
with real evidence.

Narrow blocking matrix (§3.7 — overblocking pushes agents around the system):

* Read / Glob / Grep           -> evidence-inject, NEVER block (even on a broken index)
* Write / Edit (registered)    -> block ONLY if retrieval fails (broken index, no bundle)
* Bash read-only               -> evidence-inject, never block
* Bash mutating (high-risk)    -> bundle + conflict-check; block on a conflicted high-risk claim

Every block fails LOUDLY (service, territory, expected bundle, why retrieval failed) and has an
operator override: ``OVERRIDE_KNOWLEDGE_BUNDLE=1`` proceeds with a warning and is recorded in
telemetry as an override event. bd-tracking paths (``.beads/**``) never block so the promotion
gate cannot lock itself out. Telemetry: ``component=activator`` lines in
``.xtrm/state/service-knowledge/events.jsonl``.

Configured in the PreToolUse hook. Must stay fast and must never crash the tool call: any
unexpected error degrades to a silent no-op (exit 0).
"""

import fnmatch
import json
import os
import re
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# bootstrap.py is a sibling in this consolidated scripts/ dir (no cross-skill hop).
sys.path.insert(0, str(Path(__file__).parent))

from bootstrap import RootResolutionError, get_project_root, load_registry  # noqa: E402  # type: ignore[import-not-found]

COMPONENT = "activator"
OVERRIDE_ENV = "OVERRIDE_KNOWLEDGE_BUNDLE"

READ_FILE_TOOLS = frozenset({"Read", "Glob", "Grep", "NotebookRead"})
WRITE_FILE_TOOLS = frozenset({"Write", "Edit", "NotebookEdit"})

# High-risk mutating Bash: destructive / state-changing commands that warrant a conflict gate.
MUTATING_BASH_PATTERNS = (
    re.compile(r"\brm\b"),
    re.compile(r"\bmv\b"),
    re.compile(r"\bdocker\s+(rm|rmi|compose\s+(down|rm)|system\s+prune)\b"),
    re.compile(r"\bsystemctl\s+(stop|restart|disable|reset-failed|daemon-reload)\b"),
    re.compile(r"\bkubectl\s+(apply|delete|rollout|scale|patch)\b"),
    re.compile(r"\bgh\s+pr\s+merge\b"),
    re.compile(r"\b(dropdb|drop\s+database|truncate|delete\s+from)\b", re.IGNORECASE),
    re.compile(r"\bgit\s+(push|reset\s+--hard|clean\s+-[a-z]*f)\b"),
)

# Paths the gate must never block on — otherwise the bead validator locks itself out.
EXEMPT_PATH_MARKERS = (".beads/", ".beads\\", "/.beads/", ".xtrm/state/", ".xtrm/cache/")


def match_territory(file_path: str, territory: list[str], project_root: Path) -> bool:
    """Check if a file path matches any territory glob pattern."""
    # Normalize to relative path
    fp = Path(file_path)
    if fp.is_absolute():
        try:
            fp = fp.relative_to(project_root)
        except ValueError:
            return False
    rel = str(fp)

    for pattern in territory:
        # fnmatch handles * and ?, but not ** — handle ** manually
        if "**" in pattern:
            # Split on **/ and check prefix + suffix
            parts = pattern.split("**/")
            if len(parts) == 2:
                prefix, suffix = parts
                rel_check = rel[len(prefix) :] if rel.startswith(prefix) else rel
                if fnmatch.fnmatch(rel_check, suffix) or fnmatch.fnmatch(
                    rel, f"{prefix}*/{suffix}"
                ):
                    return True
                # Also check if file is anywhere under the prefix dir
                if prefix and rel.startswith(prefix.rstrip("/")):
                    return True
        else:
            if fnmatch.fnmatch(rel, pattern):
                return True
        # Direct prefix match for broad patterns
        base = pattern.split("/*")[0].split("/**")[0]
        if base and (rel.startswith(base + "/") or rel == base):
            return True

    return False


def find_service_for_file(
    file_path: str, services: dict, project_root: Path
) -> tuple[str, dict] | None:
    """Return (service_id, service_data) if file is in any territory, else None."""
    for service_id, data in services.items():
        if match_territory(file_path, data.get("territory", []), project_root):
            return service_id, data
    return None


def find_service_for_command(command: str, services: dict) -> tuple[str, dict] | None:
    """Return (service_id, service_data) if command mentions a service name."""
    cmd_lower = command.lower()
    for service_id, data in services.items():
        # Match service_id directly or as a container name in docker commands
        if service_id in cmd_lower:
            return service_id, data
        # Match the container name pattern (service name with dashes/underscores)
        if data.get("name") and data.get("name", "").lower().replace(" ", "-") in cmd_lower:
            return service_id, data
    return None


def is_mutating_bash(command: str) -> bool:
    """True if a Bash command is high-risk / state-changing (warrants the conflict gate)."""
    return any(pattern.search(command) for pattern in MUTATING_BASH_PATTERNS)


def is_exempt_path(file_path: str) -> bool:
    """True for bd-tracking / derived-state paths the gate must never block on."""
    normalized = file_path.replace("\\", "/")
    return any(marker in normalized for marker in EXEMPT_PATH_MARKERS)


@dataclass(frozen=True)
class Retrieval:
    """Outcome of an evidence-retrieval attempt."""

    available: bool  # retrieval machinery importable at all
    ok: bool  # retrieval ran and produced a bundle
    bundle: dict[str, Any] | None = None
    error: str | None = None


@dataclass(frozen=True)
class Decision:
    """Block-matrix decision for one PreToolUse invocation."""

    action: str  # inject | block | allow | override
    reason: str
    context: str = ""
    extra: dict[str, Any] = field(default_factory=dict)


def retrieve_evidence(project_root: Path, paths: list[str]) -> Retrieval:
    """Invoke knowledge_evidence_for_files for ``paths``; never raises into the caller.

    ``available=False`` means the packaged index is not importable in this process (hook running
    standalone without the pip package) — that must NEVER block, only degrade to advisory.
    ``available=True, ok=False`` means a real retrieval failure (broken index) — that may block.
    """
    try:
        from service_knowledge import index  # type: ignore[import-not-found]
    except (ImportError, OSError, RuntimeError, ValueError, TypeError, KeyError):
        return Retrieval(available=False, ok=False, error="service-knowledge index not importable")
    try:
        bundle = index.evidence_for_files(Path(project_root), list(paths))
        try:
            from service_knowledge.dispatch import bundle_identity  # type: ignore[import-not-found]

            bundle_id, evidence_hash = bundle_identity(bundle)
            bundle["bundle_id"] = bundle_id
            bundle["evidence_hash"] = evidence_hash
        except (ImportError, OSError, RuntimeError, ValueError, TypeError, KeyError):
            pass
        return Retrieval(available=True, ok=True, bundle=bundle)
    except (OSError, RuntimeError, ValueError, TypeError, KeyError) as exc:
        return Retrieval(available=True, ok=False, error=f"{type(exc).__name__}: {exc}")
    except Exception as exc:  # sqlite3.DatabaseError et al. — broken index
        return Retrieval(available=True, ok=False, error=f"{type(exc).__name__}: {exc}")


def bundle_has_blocking_conflict(bundle: dict[str, Any] | None) -> bool:
    """True if the bundle carries a conflicted high-risk claim that gates a mutating command."""
    if not bundle:
        return False
    for caveat in bundle.get("conflicts_and_caveats", []) or []:
        status = str(caveat.get("status", ""))
        if status not in ("conflicted", "invalidated"):
            continue
        if caveat.get("risk") == "high" or caveat.get("conflicts_with"):
            return True
    return False


def _format_bundle_context(bundle: dict[str, Any], service_id: str, territory: list[str]) -> str:
    """Render a §3.2 bundle into compact PreToolUse additionalContext (evidence, not a reminder)."""
    routing = bundle.get("routing", {}) or {}
    lines = [
        f"[Service Knowledge — evidence bundle for '{service_id}'] "
        f"territory: {', '.join(territory) or '(unspecified)'}",
        f"  source_ref: {routing.get('source_ref', '(unknown)')} | "
        f"matched: {', '.join(routing.get('matched_services', []) or []) or '(none)'}",
    ]
    items = bundle.get("items", []) or []
    if items:
        lines.append("  Top evidence:")
        for item in items[:5]:
            title = item.get("title", "(untitled)")
            status = item.get("status", "active")
            text = " ".join(str(item.get("text", "")).split())[:240]
            lines.append(f"   - [{item.get('kind', '?')}|{status}] {title}: {text}")
    else:
        lines.append("  (no indexed evidence items matched — index may be empty for this service)")
    caveats = bundle.get("conflicts_and_caveats", []) or []
    if caveats:
        lines.append("  Conflicts / caveats (resolve before mutating this territory):")
        for caveat in caveats[:5]:
            lines.append(
                f"   - [{caveat.get('status', '?')}|risk={caveat.get('risk', '?')}] "
                f"{caveat.get('title') or caveat.get('id', '?')}"
            )
    skill_links = bundle.get("skill_links", {}) or {}
    if skill_links:
        links = ", ".join(f"{sid}: {path}" for sid, path in skill_links.items())
        lines.append(f"  Full skills: {links}")
    return "\n".join(lines)


def build_block_message(
    service_id: str, territory: list[str], paths: list[str], error: str | None
) -> str:
    """A LOUD, actionable block message — silent blocks train agents to ignore hooks."""
    return (
        "[BLOCKED by service-knowledge] Write/Edit in a registered service territory was stopped "
        "because the evidence bundle could not be retrieved.\n"
        f"  Service:          {service_id}\n"
        f"  Territory:        {', '.join(territory) or '(unspecified)'}\n"
        f"  Paths touched:    {', '.join(paths) or '(unspecified)'}\n"
        f"  Expected bundle:  knowledge_evidence_for_files({paths})\n"
        f"  Retrieval failed: {error or 'unknown error'}\n"
        "  Fix: rebuild the index (`service-knowledge index rebuild`) and retry, or attach the "
        "evidence bundle to the bead body.\n"
        f"  Operator override: {OVERRIDE_ENV}=1 (proceeds with a warning; recorded in telemetry)."
    )


def decide(
    tool_name: str,
    *,
    service_id: str,
    territory: list[str],
    paths: list[str],
    retrieval: Retrieval,
    is_bash: bool,
    mutating: bool,
    override: bool,
    exempt: bool,
) -> Decision:
    """Pure §3.7 block-matrix decision. Read/Glob/Grep and read-only Bash never block."""
    bundle = retrieval.bundle
    context = _format_bundle_context(bundle, service_id, territory) if bundle else ""

    # Read-only file tools: evidence-inject, NEVER block (even on a broken index).
    if tool_name in READ_FILE_TOOLS:
        if retrieval.ok:
            return Decision("inject", "read-only tool: evidence injected, never blocks", context)
        return Decision("allow", "read-only tool: retrieval unavailable, advisory only (never blocks)")

    # Read-only Bash: evidence-inject, never block.
    if is_bash and not mutating:
        if retrieval.ok:
            return Decision("inject", "read-only bash: evidence injected, never blocks", context)
        return Decision("allow", "read-only bash: retrieval unavailable, advisory only (never blocks)")

    # From here: Write/Edit in registered territory, or mutating Bash. Blocking is possible.
    conflicting = bundle_has_blocking_conflict(bundle) if mutating else False

    block_reason: str | None = None
    if mutating and conflicting:
        block_reason = (
            f"mutating Bash conflicts with a high-risk claim in '{service_id}' "
            f"(territory {', '.join(territory)}); resolve the conflict before proceeding"
        )
    elif retrieval.available and not retrieval.ok and not exempt:
        block_reason = build_block_message(service_id, territory, paths, retrieval.error)

    if block_reason is None:
        if retrieval.ok:
            return Decision("inject", "evidence injected for mutating/write operation", context)
        return Decision(
            "allow",
            "retrieval unavailable but not blocking (exempt path or machinery absent)",
            context,
        )

    if override:
        warned = f"[OVERRIDE] {OVERRIDE_ENV}=1 — proceeding despite: {block_reason}"
        return Decision(
            "override",
            block_reason,
            context=(f"{warned}\n\n{context}" if context else warned),
            extra={"override_reason": block_reason},
        )

    return Decision("block", block_reason, context)


def _emit_telemetry(project_root: Path, record: dict[str, Any]) -> None:
    """Append a component=activator line; never raises into the caller."""
    try:
        path = Path(project_root) / ".xtrm" / "state" / "service-knowledge" / "events.jsonl"
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(record, separators=(",", ":"), sort_keys=True) + "\n")
    except OSError:
        pass


def _resolve_paths(tool_name: str, tool_input: dict, service_data: dict) -> list[str]:
    """Paths to retrieve evidence for: the file path, or the service territory for Bash."""
    if tool_name in READ_FILE_TOOLS or tool_name in WRITE_FILE_TOOLS:
        file_path = (
            tool_input.get("file_path")
            or tool_input.get("path")
            or tool_input.get("notebook_path")
            or ""
        )
        return [file_path] if file_path else []
    # Bash: seed retrieval with the matched service's territory (routing entry point).
    return list(service_data.get("territory", []) or [])


def main() -> None:
    started = time.perf_counter()
    try:
        data = json.load(sys.stdin)
    except (json.JSONDecodeError, EOFError):
        sys.exit(0)

    tool_name = data.get("tool_name", "")
    tool_input = data.get("tool_input", {}) or {}

    # This hook fires in EVERY repo (registry-gated at runtime), so stay cheap:
    # prefer $CLAUDE_PROJECT_DIR and avoid the git subprocess on the hot path.
    project_root_str = os.environ.get("CLAUDE_PROJECT_DIR")
    try:
        if not project_root_str:
            project_root_str = get_project_root()
        project_root = Path(project_root_str)
        services = load_registry(project_root_str).get("services", {})
    except (RootResolutionError, Exception):
        sys.exit(0)

    if not services:
        sys.exit(0)

    match = None
    file_path = ""
    command = ""

    if tool_name in READ_FILE_TOOLS or tool_name in WRITE_FILE_TOOLS:
        file_path = (
            tool_input.get("file_path")
            or tool_input.get("path")
            or tool_input.get("notebook_path")
            or ""
        )
        if file_path:
            match = find_service_for_file(file_path, services, project_root)
    elif tool_name == "Bash":
        command = tool_input.get("command", "")
        if command:
            match = find_service_for_command(command, services)

    if not match:
        sys.exit(0)

    service_id, service_data = match
    territory = list(service_data.get("territory", []) or [])
    mutating = bool(command) and is_mutating_bash(command)
    paths = _resolve_paths(tool_name, tool_input, service_data)
    retrieval = retrieve_evidence(project_root, paths)
    override = os.environ.get(OVERRIDE_ENV, "") == "1"
    exempt = bool(file_path) and is_exempt_path(file_path)

    decision = decide(
        tool_name,
        service_id=service_id,
        territory=territory,
        paths=paths,
        retrieval=retrieval,
        is_bash=tool_name == "Bash",
        mutating=mutating,
        override=override,
        exempt=exempt,
    )

    duration_ms = round((time.perf_counter() - started) * 1000.0, 2)
    bundle_id = (retrieval.bundle or {}).get("bundle_id")
    _emit_telemetry(
        project_root,
        {
            "timestamp": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
            "component": COMPONENT,
            "event": "override" if decision.action == "override" else "pretooluse",
            "tool_name": tool_name,
            "service_ids": [service_id],
            "bundle_id": bundle_id,
            "decision": decision.action,
            "duration_ms": duration_ms,
            **({"override_reason": decision.extra.get("override_reason")} if decision.action == "override" else {}),
        },
    )

    if decision.action == "block":
        output = {
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "deny",
                "permissionDecisionReason": decision.reason,
            }
        }
        print(json.dumps(output))
        sys.exit(0)

    if decision.context:
        output = {
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "additionalContext": decision.context,
            }
        }
        print(json.dumps(output))

    sys.exit(0)


if __name__ == "__main__":
    main()
