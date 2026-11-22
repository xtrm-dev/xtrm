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


def _base_root_with_source() -> tuple[Path, str]:
    for env in ("SERVICE_KNOWLEDGE_ROOT", "CLAUDE_PROJECT_DIR"):
        value = os.environ.get(env)
        if value:
            return Path(value).expanduser().resolve(), env
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            capture_output=True, text=True, check=True, timeout=5,
        )
        return Path(result.stdout.strip()).resolve(), "git-toplevel"
    except (subprocess.SubprocessError, OSError):
        return Path.cwd().resolve(), "cwd"


def _base_root() -> Path:
    return _base_root_with_source()[0]


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


class NoRegistry(LookupError):
    """Raised when no service registry exists at or above the resolved root.

    ``root`` is the base the walk started from, so the message can name a real directory.
    """

    def __init__(self, root: Path) -> None:
        self.root = root
        super().__init__(
            f"no service registry under {root} — this repository has not adopted "
            "service-knowledge. Run the service-knowledge install flow, or call this tool "
            "from a repository that has .xtrm/skills/<pack>/service-knowledge/"
            "service-registry.json."
        )


def resolve_registry_root(explicit: str | None = None) -> Path:
    """Return the consumer root that OWNS a registry, or raise :class:`NoRegistry`.

    ``resolve_consumer_root`` returns the base root even when nothing was found, which is the
    right answer for the diagnostic tools: ``knowledge_status`` must be able to say "this is
    not a consumer repo". The retrieval tools are different. The Claude plugin installs at
    user scope, so its five tools appear in EVERY repository; a retrieval call outside a
    consumer repo used to answer "nothing found" as a success AND leave an ``.xtrm/`` tree
    behind, because the freshness gate creates its cache before the caller learns there is no
    registry. An agent reads that success as "the knowledge base says no" and falls back to
    grep — the behaviour this whole surface exists to remove. Refuse instead, and refuse
    before the gate touches the filesystem.
    """
    base = _base_root()
    root = resolve_consumer_root(explicit)
    if _has_registry(root):
        return root
    raise NoRegistry(base)


def _git(root: Path, *args: str) -> str | None:
    try:
        result = subprocess.run(
            ["git", "-C", str(root), *args],
            capture_output=True, text=True, check=True, timeout=5,
        )
    except (subprocess.SubprocessError, OSError):
        return None
    return result.stdout.strip() or None


def describe_resolution(explicit: str | None = None) -> dict[str, object]:
    """Say which checkout a tool call read, and whether it is behind the primary checkout.

    A linked worktree carries its own committed copy of the registry, so a call from a stale
    worktree used to index that old copy and answer "0 hits" with no sign that another checkout
    had newer knowledge. This stays a REPORT, never a silent redirect: the caller reads from the
    resolved root, and ``stale`` plus ``hint`` say when a different root would answer better.

    ``behind_primary`` counts commits reachable from the primary checkout's HEAD that the
    resolved root's HEAD lacks. It is ``None`` when the root is the primary checkout itself, or
    when git cannot answer (the report must never fail a tool call).
    """
    base, source = _base_root_with_source()
    root = resolve_consumer_root(explicit)
    info: dict[str, object] = {
        "root": str(root),
        "source": "argument" if explicit else source,
        "linked_worktree": False,
        "primary_checkout": None,
        "behind_primary": None,
        "stale": False,
        "hint": None,
    }
    git_dir = _git(root, "rev-parse", "--path-format=absolute", "--git-dir")
    common_dir = _git(root, "rev-parse", "--path-format=absolute", "--git-common-dir")
    if not git_dir or not common_dir or Path(git_dir) == Path(common_dir):
        return info
    primary = Path(common_dir).parent if Path(common_dir).name == ".git" else None
    info["linked_worktree"] = True
    if primary is None or not primary.is_dir():
        return info
    info["primary_checkout"] = str(primary)
    primary_head = _git(primary, "rev-parse", "HEAD")
    behind = _git(root, "rev-list", "--count", f"HEAD..{primary_head}") if primary_head else None
    if behind is None or not behind.isdigit():
        return info
    info["behind_primary"] = int(behind)
    if int(behind) > 0 and _has_registry(primary):
        info["stale"] = True
        usable = primary.resolve() in candidate_roots(base)
        info["hint"] = (
            f"This worktree's HEAD lacks {behind} commit(s) present on the primary checkout "
            f"{primary}, so the knowledge read here can be older than the primary checkout's. "
            + (f"Retry with consumer_root={primary} to read the primary checkout."
               if usable else
               "The primary checkout is not an ancestor of this session root, so it cannot be "
               "passed as consumer_root; start the session there to read it.")
        )
    return info
