"""knowledge_status — is this repo's service knowledge installed, current and usable?

Read-only answer to "can I rely on the service knowledge in THIS checkout?". It reports the
consumer root, the installed machinery version, the umbrella packs and their service counts, the
index cache, and whether every service's ``last_sync_ref`` matches git HEAD.

Not the same question as :mod:`knowledge_drift`: status says whether the knowledge layer is
healthy and current; drift says which services' knowledge is stale against the code. Status never
scans territories and never writes.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from service_knowledge import __version__
from service_knowledge.mcp._template import describe
from service_knowledge.mcp._root import resolve_consumer_root

TOOL_NAME = "knowledge_status"
DESCRIPTION = describe(
    purpose="Check whether this repo's service knowledge is installed, indexed and current, and which versions are involved. Call it when results look empty or stale. Read-only; never writes or rebuilds.",
    parameters="consumer_root (string, optional): repo root to inspect; must be the session root or one of its ancestors, default: the session root.",
    returns="consumer_root, registry_present, packs (name, umbrella, services), service_count, index_present, git_head, services_out_of_sync, usable, cli_version (the installed command), pack_version (the machinery vendored in this repo, null when absent), version_mismatch (true, false, or null when pack_version is absent) with version_note, plus consumer_root_resolution.",
    empty_or_stale="registry_present=false means this repo has not adopted service-knowledge: the retrieval tools (knowledge_search, knowledge_get, knowledge_evidence_for_files) refuse here. version_mismatch=true means the repo's vendored machinery is older than the CLI: run `service-knowledge update` in the repo. services_out_of_sync lists services whose last_sync_ref differs from git_head. consumer_root_resolution.stale=true means the primary checkout is ahead of this worktree.",
    example="{}",
)
PARAMETERS = {
    "type": "object",
    "properties": {
        "consumer_root": {"type": "string", "description": "Consumer repo root (default: auto-resolved)."},
    },
}

SKILLS_ROOT = Path(".xtrm") / "skills"
MACHINERY_REL = SKILLS_ROOT / "default" / "service-knowledge"
CACHE_REL = Path(".xtrm") / "cache" / "service-knowledge.sqlite"
VERSION_REL = MACHINERY_REL / "VERSION"
RESERVED_PACK_NAMES = {"default", "optional", "user", "active", "local-legacy"}
UMBRELLA_NAMES = ("service-knowledge", "service-skills")


def _umbrella_packs(root: Path) -> list[tuple[str, str, int]]:
    """``(pack_name, umbrella_name, service_count)`` per pack carrying a registry."""
    out: list[tuple[str, str, int]] = []
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
                try:
                    count = len(json.loads(registry.read_text(encoding="utf-8")).get("services", {}))
                except (OSError, json.JSONDecodeError, AttributeError):
                    count = -1
                out.append((pack.name, umbrella, count))
                break
    return out


def _sync_refs(root: Path) -> dict[str, str]:
    """``service_id -> last_sync_ref`` across every pack registry (first 7 chars)."""
    refs: dict[str, str] = {}
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
                    if isinstance(info, dict):
                        refs[service_id] = str(info.get("last_sync_ref") or "")[:7]
                break
    return refs


def _git_head(root: Path) -> str | None:
    try:
        import subprocess

        result = subprocess.run(
            ["git", "rev-parse", "--short=7", "HEAD"],
            cwd=root, capture_output=True, text=True, check=True, timeout=5,
        )
        return result.stdout.strip() or None
    except Exception:  # subprocess/OS failures are "not a git repo", never a tool failure
        return None


def run(consumer_root: str | None = None, **_: Any) -> dict[str, Any]:
    try:
        root = resolve_consumer_root(consumer_root)
    except ValueError as exc:
        return {"error": str(exc)}

    installed = None
    try:
        installed = (root / VERSION_REL).read_text(encoding="utf-8").strip() or None
    except OSError:
        installed = None

    packs = _umbrella_packs(root)
    refs = _sync_refs(root)
    head = _git_head(root)
    out_of_sync = sorted(sid for sid, ref in refs.items() if ref and head and ref != head)

    # None when the consumer has no vendored VERSION file: there is nothing to compare.
    mismatch = None if installed is None else installed != __version__
    return {
        "consumer_root": str(root),
        "cli_version": __version__,
        "pack_version": installed,
        "version_mismatch": mismatch,
        "version_note": (
            f"The CLI is {__version__} but this repo's vendored machinery is {installed}; "
            "run `service-knowledge update` in this repo."
        ) if mismatch else None,
        "package_version": __version__,    # alias of cli_version, kept for existing callers
        "installed_version": installed,    # alias of pack_version, kept for existing callers
        "registry_present": bool(packs),
        "packs": [
            {"pack": name, "umbrella": umbrella, "services": count}
            for name, umbrella, count in packs
        ],
        "service_count": len(refs),
        "machinery_dir": MACHINERY_REL.as_posix(),
        "machinery_present": (root / MACHINERY_REL).exists(),
        "index_cache": CACHE_REL.as_posix(),
        "index_present": (root / CACHE_REL).exists(),
        "git_head": head,
        "services_out_of_sync": out_of_sync,
        "usable": bool(packs),
    }
