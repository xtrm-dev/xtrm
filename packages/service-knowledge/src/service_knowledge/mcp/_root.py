"""Resolve the consumer repo root for an MCP tool invocation.

MCP tools run inside the consumer repo; the trusted root is ``$SERVICE_KNOWLEDGE_ROOT`` or
``$CLAUDE_PROJECT_DIR`` or the git toplevel of the cwd. A request-supplied root must be one of
those bounded candidates.

Ancestor walk (CORE-2714). A consumer can run a tool from a worktree
(``<repo>/.xtrm/worktrees/<name>`` or ``<repo>/.worktrees/<name>``) that carries no ``.xtrm``
state. The pi extension has always found the registry by walking up to six ancestors; the
MCP server resolved only the exact cwd, so the same session saw five tools in pi and none in
Claude. The walk here restores the extension's semantics for the MCP surface only — the CLI's
``find_umbrella_packs`` stays root-only, because a CLI subcommand that silently retargets a
different checkout would be a worse failure than a missing registry.
"""
from __future__ import annotations

import os
import subprocess
from pathlib import Path

# Same bound as the pi extension (`selfAndAncestors`): <repo>/.xtrm/worktrees/<name> is two
# levels below the repo, and user pack roots add depth, so six covers the documented layouts.
MAX_ROOT_ANCESTOR_WALK = 6

# Mirrors service_knowledge.cli.common; duplicated so the MCP import graph stays small and
# does not pull in the whole CLI package.
_SKILLS_ROOT = Path(".xtrm") / "skills"
_RESERVED_PACK_NAMES = {"default", "optional", "user", "active", "local-legacy"}
_UMBRELLA_NAMES = ("service-knowledge", "service-skills")


def _has_registry(root: Path) -> bool:
    """True when ``root`` carries a pack with a service registry (root-level scan only)."""
    for packs_root in (root / _SKILLS_ROOT, root / _SKILLS_ROOT / "user" / "packs"):
        try:
            children = [p for p in packs_root.iterdir() if p.is_dir()]
        except OSError:
            continue
        for pack in children:
            if pack.name in _RESERVED_PACK_NAMES:
                continue
            for umbrella in _UMBRELLA_NAMES:
                if (pack / umbrella / "service-registry.json").exists():
                    return True
    return False


def candidate_roots(base: Path) -> list[Path]:
    """``base`` plus its bounded ancestors, nearest first."""
    out: list[Path] = []
    current = Path(base)
    for _ in range(MAX_ROOT_ANCESTOR_WALK):
        out.append(current)
        parent = current.parent
        if parent == current:
            break
        current = parent
    return out


def _base_root() -> Path:
    for env in ("SERVICE_KNOWLEDGE_ROOT", "CLAUDE_PROJECT_DIR"):
        value = os.environ.get(env)
        if value:
            return Path(value).expanduser().resolve()
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            capture_output=True, text=True, check=True, timeout=5,
        )
        return Path(result.stdout.strip()).resolve()
    except (subprocess.SubprocessError, OSError):
        return Path.cwd().resolve()


def resolve_consumer_root(explicit: str | None = None) -> Path:
    """Return the consumer repo root, walking bounded ancestors for a service registry.

    ``explicit`` (the tool argument) is accepted only when it names a trusted candidate: the
    base root or one of its bounded ancestors. That keeps a caller from reading an arbitrary
    path while still letting a worktree session point at the checkout that owns the registry.
    """
    base = _base_root()
    roots = candidate_roots(base)
    if explicit:
        requested = Path(explicit).expanduser().resolve()
        if requested not in roots:
            raise ValueError("consumer_root must match the trusted MCP consumer root")
        roots = candidate_roots(requested)

    for candidate in roots:
        if _has_registry(candidate):
            return candidate
    return roots[0]
