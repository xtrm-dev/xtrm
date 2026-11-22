"""knowledge_drift — which services' operational knowledge is stale against the code?

Read-only companion to :mod:`knowledge_status`. Status answers "is the knowledge layer healthy
in this checkout?"; drift answers "which services' knowledge has fallen behind the code?".

Every returned fact is a live read:
  * the pending drift marker, canonical name preferred over the legacy one;
  * each service's recorded ``last_sync_ref`` from the pack registry, compared with git HEAD;
  * the marker's own inventory (services, reason, commit range, timestamp) when present.

It deliberately does NOT wrap ``service-knowledge drift``: that CLI verb runs a filesystem scan
and WRITES the pending marker, and ``clear`` rebuilds the index. A tool advertised as read-only
must not mutate the workspace, so nothing here writes, rebuilds, or shells out to a scan.
Reconciliation stays with ``/updating-service-knowledge``, which stamps ``last_sync_ref``.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from service_knowledge.mcp._template import describe
from service_knowledge.mcp._root import resolve_consumer_root

TOOL_NAME = "knowledge_drift"
DESCRIPTION = describe(
    purpose="Report which services' knowledge has drifted from the code they describe. Call it before trusting knowledge about recently changed code. Advisory; never blocks work. Read-only.",
    parameters="consumer_root (string, optional): repo root to inspect; must be the session root or one of its ancestors, default: the session root.",
    returns="git_head, marker_present and marker (reason, services, commit range, timestamp), service_count, services_behind_head (service_id, last_sync_ref), services_never_synced, drift_detected, suggested_action, plus consumer_root_resolution.",
    empty_or_stale="drift_detected=false with empty lists means every service's last_sync_ref equals git_head and no drift marker is pending. services_never_synced lists services with no last_sync_ref: their knowledge has no verified baseline. Drift is judged against this checkout's HEAD, so check consumer_root_resolution.stale in a worktree.",
    example="{}",
)
PARAMETERS = {
    "type": "object",
    "properties": {
        "consumer_root": {"type": "string", "description": "Consumer repo root (default: auto-resolved)."},
    },
}

SKILLS_ROOT = Path(".xtrm") / "skills"
RESERVED_PACK_NAMES = {"default", "optional", "user", "active", "local-legacy"}
UMBRELLA_NAMES = ("service-knowledge", "service-skills")

# Dual marker names — the canonical one wins when both are present (core 16118989).
CANONICAL_MARKER_REL = Path(".xtrm") / ".service-knowledge-drift-pending"
LEGACY_MARKER_REL = Path(".xtrm") / ".service-skills-drift-pending"

RECONCILE_HINT = "run /updating-service-knowledge to reconcile and stamp last_sync_ref"


def _read_marker(root: Path) -> dict[str, Any] | None:
    """Live parse of the pending marker; canonical wins, legacy predates the schema."""
    for rel in (CANONICAL_MARKER_REL, LEGACY_MARKER_REL):
        try:
            text = (root / rel).read_text(encoding="utf-8")
        except OSError:
            continue
        fields: dict[str, Any] = {"path": rel.as_posix(), "legacy_name": rel == LEGACY_MARKER_REL}
        for line in text.splitlines():
            stripped = line.strip()
            for key in ("trigger", "range", "reason", "services", "timestamp"):
                if stripped.startswith(f"{key}:"):
                    fields[key] = stripped.split(":", 1)[1].strip()
        return fields
    return None


def _registry_services(root: Path) -> dict[str, dict[str, Any]]:
    """``service_id -> service record`` across every pack registry (first registry wins)."""
    out: dict[str, dict[str, Any]] = {}
    seen: set[Path] = set()
    for packs_root in (root / SKILLS_ROOT, root / SKILLS_ROOT / "user" / "packs"):
        try:
            packs = sorted(p for p in packs_root.iterdir() if p.is_dir())
        except OSError:
            continue
        for pack in packs:
            if pack.name in RESERVED_PACK_NAMES:
                continue
            for umbrella in UMBRELLA_NAMES:
                registry = pack / umbrella / "service-registry.json"
                if not registry.exists():
                    continue
                resolved = registry.resolve()
                if resolved in seen:
                    break
                seen.add(resolved)
                try:
                    services = json.loads(registry.read_text(encoding="utf-8")).get("services", {})
                except (OSError, json.JSONDecodeError, AttributeError):
                    break
                for service_id, info in services.items():
                    if isinstance(info, dict) and service_id not in out:
                        out[service_id] = info
                break
    return out


def _git_head(root: Path) -> str | None:
    try:
        import subprocess

        result = subprocess.run(
            ["git", "rev-parse", "--short=7", "HEAD"],
            cwd=root, capture_output=True, text=True, check=True, timeout=5,
        )
        return result.stdout.strip() or None
    except Exception:  # subprocess/OS failures mean "not a git repo", never a tool failure
        return None


def run(consumer_root: str | None = None, **_: Any) -> dict[str, Any]:
    try:
        root = resolve_consumer_root(consumer_root)
    except ValueError as exc:
        return {"error": str(exc)}

    head = _git_head(root)
    services = _registry_services(root)
    stale: list[dict[str, str]] = []
    never_synced: list[str] = []
    for service_id, info in sorted(services.items()):
        ref = str(info.get("last_sync_ref") or "")[:7]
        if not ref:
            never_synced.append(service_id)
        elif head and ref != head:
            stale.append({"service_id": service_id, "last_sync_ref": ref})

    marker = _read_marker(root)
    return {
        "consumer_root": str(root),
        "git_head": head,
        "marker_present": marker is not None,
        "marker": marker,
        "service_count": len(services),
        "services_behind_head": stale,
        "services_never_synced": never_synced,
        "drift_detected": bool(marker) or bool(stale) or bool(never_synced),
        "suggested_action": RECONCILE_HINT if (marker or stale or never_synced) else None,
    }
