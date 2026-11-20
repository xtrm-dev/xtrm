#!/usr/bin/env python3
"""
layout_migrator.py — one-time migration of a service-skills pack from the FLAT
layout to the UMBRELLA layout.

    FROM:  .xtrm/skills/<pack>/<svc>/SKILL.md
           .xtrm/skills/<pack>/service-registry.json
    TO:    .xtrm/skills/<pack>/service-skills/services/<svc>/SKILL.md
           .xtrm/skills/<pack>/service-skills/service-registry.json
           .xtrm/skills/<pack>/service-skills/SKILL.md   (generated umbrella)

This is DISTINCT from skill_migrator.py: that edits a SKILL.md's headings; this
*moves files* and *relocates/merges the registry*, then generates the umbrella.

Hard-cut: after this runs, resolvers see only the new layout. Idempotent (re-run =
all-skipped, no mutation) and SAFE over the WHOLE pack, not just SKILL.md:

1. PREFLIGHT, READ-ONLY. Before any mutation, every service's flat tree is compared to
   its umbrella tree by relative path plus sha256, and two registries (when both exist)
   are compared field by field. ANY difference, or any flat-only path, refuses the whole
   pack ONCE and lists every offending path of every service. Nothing is touched. The
   same resolution runs in ``--preflight`` and in the real migration, so the dry run can
   never report ``ok`` where the real run refuses.
   STATED LIMITS of the redundancy proof: it compares relative paths and file CONTENT
   only. File mode, empty directories, and the *resolution* of a symlink target are not
   part of the digest, so a mode or empty-dir difference, or a relative link that
   resolves differently in the two layouts, does not by itself block a dedupe. Nothing is
   lost when that happens: step 2 keeps the whole flat tree, modes and empty directories
   included.
2. EQUAL TREES ARE MOVED ASIDE, never deleted: the flat directory is renamed to
   ``<svc>.legacy-<UTC timestamp>`` inside the pack, so a later re-run or a human can
   still recover it.
3. The two registries merge BY SERVICE ID (the umbrella copy wins on ``skill_path``);
   they must agree on everything else, otherwise the pack is refused.
4. PACK.json is KEPT and reported. Its retirement is not a proof of redundancy: nothing
   in-tree declares its schema, so the migrator cannot show that every field it carries
   is reproduced by the registry. Removal is a human decision.

Per-service SKILL.md content (incl. the SEMANTIC block) is moved verbatim — never
regenerated. CLI prints one line per service (``migrated:``/``skipped:``) so the
installer can summarize.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# A legacy in-body reference: ".claude/skills/<segment>" where <segment> is a service-id
# (self-ref) or a registry 'container' name (container-named self/cross-ref). The trailing
# "/scripts/...", "/SKILL.md", or nothing (e.g. `make -C .claude/skills/<seg>`) is preserved.
_CLAUDE_SKILLS_REF = re.compile(r"\.claude/skills/([a-z0-9][a-z0-9_-]*)")

# Sibling imports (consolidated scripts/ dir).
sys.path.insert(0, str(Path(__file__).parent))
from _textio import write_text as _write_text  # noqa: E402  # type: ignore[import-not-found]
from bootstrap import (  # noqa: E402  # type: ignore[import-not-found]
    RootResolutionError,
    get_pack_path,
    get_project_root,
)
from umbrella_generator import write_umbrella  # noqa: E402  # type: ignore[import-not-found]


class MigrationRefused(Exception):
    """Raised when the read-only preflight cannot prove the migration lossless.

    Carries every offending path of every service in ``problems``; the message names the
    count and each problem on its own line. No mutation has happened when this is raised.
    """

    def __init__(self, problems: list[str]) -> None:
        self.problems = list(problems)
        lines = [
            f"{len(self.problems)} problem(s) found by the read-only preflight; nothing was changed:",
            *self.problems,
            "Resolve each one (or migrate that service by hand), then re-run.",
        ]
        super().__init__("\n  ".join(lines))


def _new_skill_path_str(project_root: Path, pack: Path, service_id: str) -> str:
    new_md = pack / "service-skills" / "services" / service_id / "SKILL.md"
    try:
        return str(new_md.resolve(strict=False).relative_to(project_root.resolve())).replace(os.sep, "/")
    except ValueError:
        return str(new_md).replace(os.sep, "/")


def _new_skill_dir_str(project_root: Path, pack: Path, service_id: str) -> str:
    """Project-relative POSIX path to a service's NEW skill *directory* (no /SKILL.md), used
    as the rewrite target for legacy in-body ``.claude/skills/<alias>`` references."""
    new_dir = pack / "service-skills" / "services" / service_id
    try:
        return str(new_dir.resolve(strict=False).relative_to(project_root.resolve())).replace(os.sep, "/")
    except ValueError:
        return str(new_dir).replace(os.sep, "/")


def _rewrite_claude_refs(body: str, new_dir_for: Any) -> tuple[str, int, set[str]]:
    """Rewrite legacy ``.claude/skills/<alias>`` refs in a moved SKILL.md body to the new
    ``.xtrm/.../service-skills/services/<service-id>`` dir.

    ``new_dir_for(alias)`` returns the new dir path for a known alias, or ``None`` to leave the
    ref untouched (and report it as unmapped). The migrator MOVES SKILL.md bodies verbatim, so
    self-refs (``.claude/skills/<service-id>/scripts/...``, ``make -C .claude/skills/<container>``)
    and umbrella cross-refs are left pointing at the dead flat path unless rewritten here
    (xtrm-8ike5). Returns ``(new_body, rewritten_count, unmapped_segments)``.
    """
    unmapped: set[str] = set()
    rewrites = 0

    def _repl(m: "re.Match[str]") -> str:
        nonlocal rewrites
        alias = m.group(1)
        new_dir = new_dir_for(alias)
        if new_dir is None:
            unmapped.add(alias)
            return m.group(0)
        rewrites += 1
        return new_dir

    return _CLAUDE_SKILLS_REF.sub(_repl, body), rewrites, unmapped


# --- read-only preflight ------------------------------------------------------
def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _tree_digest(root: Path) -> dict[str, str]:
    """Map every file under ``root`` to a content digest, keyed by POSIX relative path.

    Directories carry no content of their own, so they are implied by their files. Symlinks
    are recorded by their target and never followed: a symlinked ``SKILL.md`` is data that a
    rmtree/move would break, not a duplicate of the file it points at.
    """
    out: dict[str, str] = {}
    if not root.exists() and not root.is_symlink():
        return out
    if root.is_symlink() or not root.is_dir():
        out[""] = "symlink:" + os.readlink(root) if root.is_symlink() else _sha256_file(root)
        return out
    for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
        base = Path(dirpath)
        for name in sorted(dirnames):
            candidate = base / name
            if candidate.is_symlink():
                out[candidate.relative_to(root).as_posix()] = "symlink:" + os.readlink(candidate)
        for name in sorted(filenames):
            candidate = base / name
            rel = candidate.relative_to(root).as_posix()
            out[rel] = (
                "symlink:" + os.readlink(candidate) if candidate.is_symlink() else _sha256_file(candidate)
            )
    return out


def _tree_problems(service_id: str, old_dir: Path, new_dir: Path) -> list[str]:
    """Every flat-layout path that the umbrella layout does NOT already hold identically.

    Only the flat side matters: a target-only file is not lost by removing the source.
    """
    flat = _tree_digest(old_dir)
    new = _tree_digest(new_dir)
    problems: list[str] = []
    for rel in sorted(flat):
        old_path = old_dir / rel if rel else old_dir
        new_path = new_dir / rel if rel else new_dir
        if rel not in new:
            problems.append(f"{service_id}: {old_path} is flat-only ({new_path} does not exist)")
        elif flat[rel] != new[rel]:
            problems.append(f"{service_id}: {old_path} differs from {new_path}")
    return problems


def _registry_view(registry: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    """Split a registry into (top-level fields, per-service entries minus ``skill_path``).

    ``skill_path`` is excluded because the migration legitimately rewrites it; everything
    else must agree before two registries may be merged.
    """
    top = {key: value for key, value in registry.items() if key != "services"}
    services: dict[str, Any] = {}
    raw_services = registry.get("services")
    if isinstance(raw_services, dict):
        for service_id, entry in raw_services.items():
            body = dict(entry) if isinstance(entry, dict) else entry
            if isinstance(body, dict):
                body.pop("skill_path", None)
            services[service_id] = body
    return top, services


def _load_registry(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        # Unreadable JSON is a refusal, not a traceback: nothing has been mutated yet.
        raise MigrationRefused([f"registry: {path} is not readable JSON ({exc})"]) from exc
    if not isinstance(data, dict):
        raise MigrationRefused([f"registry: {path} is not a JSON object"])
    return data


def _registry_paths(pack: Path) -> tuple[Path, Path]:
    """The flat (``old``) and umbrella (``new``) registry paths for ``pack``."""
    return pack / "service-registry.json", pack / "service-skills" / "service-registry.json"


def _resolve_registry(pack: Path) -> tuple[dict[str, Any] | None, list[str]]:
    """Resolve the registry the migration will act on, plus any registry-level problems.

    THE single source of truth for both ``--preflight`` and ``migrate_pack``: two
    registries merge by service id only when they agree on everything but ``skill_path``.
    Returns ``(None, [])`` when the pack carries no registry at all.
    """
    old_registry, new_registry = _registry_paths(pack)
    old_reg = _load_registry(old_registry)
    new_reg = _load_registry(new_registry)
    if old_reg is not None and new_reg is not None:
        return _merge_registries(old_reg, new_reg), _registry_problems(old_registry, old_reg, new_registry, new_reg)
    return (new_reg if new_reg is not None else old_reg), []


def _registry_problems(old_path: Path, old_reg: dict[str, Any], new_path: Path, new_reg: dict[str, Any]) -> list[str]:
    problems: list[str] = []
    old_top, old_services = _registry_view(old_reg)
    new_top, new_services = _registry_view(new_reg)
    for key in sorted(set(old_top) & set(new_top)):
        if old_top[key] != new_top[key]:
            problems.append(f"registry: top-level field {key!r} differs between {old_path} and {new_path}")
    for service_id in sorted(set(old_services) & set(new_services)):
        if old_services[service_id] != new_services[service_id]:
            problems.append(
                f"registry: service {service_id!r} differs between {old_path} and {new_path} "
                f"(ignoring skill_path, which the migration rewrites)"
            )
    return problems


def _merge_registries(old_reg: dict[str, Any], new_reg: dict[str, Any]) -> dict[str, Any]:
    """Union two preflight-compatible registries by service id; the umbrella copy wins."""
    merged: dict[str, Any] = dict(old_reg)
    merged.update(new_reg)
    services: dict[str, Any] = {}
    for source in (old_reg, new_reg):
        raw = source.get("services")
        if isinstance(raw, dict):
            services.update(raw)
    merged["services"] = services
    return merged


def preflight_pack(pack: Path, services: dict[str, Any] | None = None) -> list[str]:
    """Return every problem that makes migrating ``pack`` lossy. Read-only, mutates nothing.

    With ``services=None`` this resolves the registry exactly as ``migrate_pack`` does
    (both registries, merged, registry problems included), so the dry run and the real run
    reach the same verdict. An empty list means the migration is provably lossless with
    respect to the flat layout.
    """
    problems: list[str] = []
    if services is None:
        registry, registry_problems = _resolve_registry(pack)
        problems.extend(registry_problems)
        raw_services = (registry or {}).get("services")
        services = raw_services if isinstance(raw_services, dict) else {}

    for service_id in services:
        old_dir = pack / service_id
        new_dir = pack / "service-skills" / "services" / service_id
        if not old_dir.exists() and not old_dir.is_symlink():
            continue  # nothing in the flat layout to lose
        if not new_dir.exists() and not new_dir.is_symlink():
            continue  # pure move; the whole flat dir relocates with its content
        problems.extend(_tree_problems(service_id, old_dir, new_dir))
    return problems


# --- migration ----------------------------------------------------------------
def _move_aside(pack: Path, old_dir: Path) -> Path:
    """Rename ``old_dir`` to ``<name>.legacy-<UTC timestamp>`` inside the pack. Never deletes."""
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    target = pack / f"{old_dir.name}.legacy-{stamp}"
    suffix = 1
    while target.exists() or target.is_symlink():
        target = pack / f"{old_dir.name}.legacy-{stamp}-{suffix}"
        suffix += 1
    shutil.move(str(old_dir), str(target))
    return target


def migrate_pack(project_root: Path, pack: Path, repo_name: str) -> dict[str, Any]:
    """Migrate one pack. Returns a result dict with per-service outcomes.

    Runs the read-only preflight for the whole pack FIRST and raises MigrationRefused
    before any mutation (registry write, move-aside, umbrella regeneration) when it cannot
    prove the migration lossless.
    """
    umbrella_dir = pack / "service-skills"
    services_dir = umbrella_dir / "services"
    old_registry, new_registry = _registry_paths(pack)

    # Resolve the registry WITHOUT touching either file: two registries merge by service id
    # only when they agree on everything else.
    registry, problems = _resolve_registry(pack)
    if registry is None:
        return {"pack": pack.name, "status": "no-registry", "services": {}}
    services: dict[str, Any] = registry.get("services") if isinstance(registry.get("services"), dict) else {}
    registry["services"] = services

    # 1. PREFLIGHT (read-only) over the registry and every service; refuse ONCE.
    problems.extend(preflight_pack(pack, services))
    if problems:
        raise MigrationRefused(problems)

    # Alias map for in-body ref rewriting: every legacy ".claude/skills/<segment>" segment is
    # either a service-id (self-ref / umbrella cross-ref) or a service's registry 'container'
    # name (container-named self-ref). Map both to the service-id so the new dir resolves.
    alias_to_service: dict[str, str] = {}
    for sid, info in services.items():
        alias_to_service[sid] = sid
        container = info.get("container") if isinstance(info, dict) else None
        if isinstance(container, str) and container:
            alias_to_service.setdefault(container, sid)
    _dir_cache: dict[str, str] = {}

    def _new_dir_for(alias: str) -> str | None:
        sid = alias_to_service.get(alias)
        if sid is None:
            return None
        if sid not in _dir_cache:
            _dir_cache[sid] = _new_skill_dir_str(project_root, pack, sid)
        return _dir_cache[sid]

    refs_rewritten = 0
    stale_refs: set[str] = set()

    outcomes: dict[str, str] = {}
    moved_aside: dict[str, str] = {}
    for service_id, info in services.items():
        old_dir = pack / service_id
        new_dir = services_dir / service_id

        if new_dir.exists():
            # Already in place. If the flat copy also lingers, the preflight proved it equal;
            # move it aside so nothing is deleted and everything stays recoverable.
            if old_dir.exists():
                aside = _move_aside(pack, old_dir)
                moved_aside[service_id] = aside.name
                outcomes[service_id] = "deduped"
            else:
                outcomes[service_id] = "already-migrated"
        elif old_dir.exists() and old_dir.is_dir():
            services_dir.mkdir(parents=True, exist_ok=True)
            shutil.move(str(old_dir), str(new_dir))  # rename — atomic on same fs
            outcomes[service_id] = "migrated"
        elif old_dir.exists():
            # A non-directory at the flat path is not ours to delete or move into services/.
            outcomes[service_id] = "flat-entry-not-a-directory"
        else:
            outcomes[service_id] = "missing-source"

        if isinstance(info, dict):
            info["skill_path"] = _new_skill_path_str(project_root, pack, service_id)

        # Rewrite legacy in-body ".claude/skills/<alias>/..." refs in the moved SKILL.md so
        # Data-Inspection / Diagnostic-Scripts / `make -C` blocks point at the new services/
        # path instead of the dead flat one (xtrm-8ike5). Idempotent: a re-run finds no
        # ".claude/skills" refs and is a no-op.
        moved_md = new_dir / "SKILL.md"
        if moved_md.exists():
            body = moved_md.read_text(encoding="utf-8")
            rewritten, n, unmapped = _rewrite_claude_refs(body, _new_dir_for)
            if n:
                # Line endings follow the moved SKILL.md (XTRM-850).
                _write_text(moved_md, rewritten)
                refs_rewritten += n
            stale_refs |= unmapped

    # Relocate the registry under the umbrella with rewritten skill_paths. Line endings
    # follow the file being written: when the umbrella registry already exists it is
    # overwritten, so ITS convention must survive (taking the stale flat registry's endings
    # would convert it — the reverse of the bug this fix closed). Only on a first migration,
    # where the new path does not exist yet, is there nothing to sniff but the flat registry
    # that supplies the content (XTRM-850).
    umbrella_dir.mkdir(parents=True, exist_ok=True)
    newline_source = new_registry if new_registry.exists() else old_registry
    _write_text(
        new_registry,
        json.dumps(registry, indent=2) + "\n",
        newline_source=newline_source,
    )
    if old_registry.exists() and old_registry.resolve() != new_registry.resolve():
        old_registry.unlink()

    # Generate the umbrella (preserves any existing SEMANTIC block).
    umbrella_changed = write_umbrella(umbrella_dir / "SKILL.md", registry, repo_name)

    # PACK.json is retired by the umbrella layout, but retirement is not proof of redundancy:
    # nothing in-tree declares its schema, so the migrator cannot show that every field it
    # carries is reproduced by the registry. Keep it and report it.
    pack_json_kept = (pack / "PACK.json").exists()

    return {
        "pack": pack.name,
        "status": "ok",
        "services": outcomes,
        "umbrella_written": umbrella_changed,
        "registry": str(new_registry),
        "refs_rewritten": refs_rewritten,
        "stale_refs": sorted(stale_refs),
        "moved_aside": moved_aside,
        "pack_json_kept": pack_json_kept,
    }


def demote_shadowing_registries(project_root: Path) -> list[str]:
    """Remove/flag the stale repo-root + legacy `.claude/skills` registries that
    would otherwise SHADOW the migrated umbrella registry. Symlinks (stale pointers)
    are removed; real files are left in place but reported so nothing is silently
    lost. Returns human-readable notes."""
    notes: list[str] = []
    for label, candidate in (
        ("root", project_root / "service-registry.json"),
        ("legacy", project_root / ".claude" / "skills" / "service-registry.json"),
    ):
        if candidate.is_symlink():
            candidate.unlink()
            notes.append(f"removed stale {label} registry symlink: {candidate}")
        elif candidate.exists():
            notes.append(
                f"WARNING: real {label} registry still present at {candidate} — the umbrella "
                f"registry is now canonical; review and remove this duplicate manually"
            )
    return notes


def main() -> None:
    args = sys.argv[1:]
    preflight_only = "--preflight" in args
    positional = [a for a in args if not a.startswith("-")]
    project_root_str = os.environ.get("CLAUDE_PROJECT_DIR")
    if not project_root_str:
        try:
            project_root_str = get_project_root()
        except RootResolutionError as e:
            print(f"Error: {e}", file=sys.stderr)
            sys.exit(1)
    project_root = Path(project_root_str)
    repo_name = positional[0] if positional else project_root.name

    pack = get_pack_path(project_root_str)
    if pack is None:
        print("Error: unable to resolve pack path. Set XTRM_PACK or leave only one pack under .xtrm/skills.", file=sys.stderr)
        sys.exit(1)

    if preflight_only:
        try:
            problems = preflight_pack(pack)
        except MigrationRefused as e:
            print(f"refused: {e}", file=sys.stderr)
            sys.exit(2)
        if problems:
            print(f"refused: {len(problems)} problem(s); nothing would be changed:", file=sys.stderr)
            for problem in problems:
                print(f"  {problem}", file=sys.stderr)
            sys.exit(2)
        print(f"preflight: ok ({pack.name})")
        sys.exit(0)

    try:
        result = migrate_pack(project_root, pack, repo_name)
    except MigrationRefused as e:
        print(f"refused: {e}", file=sys.stderr)
        sys.exit(2)

    if result["status"] == "no-registry":
        print(f"skipped: {pack.name} (no service-registry.json)")
        sys.exit(0)
    for sid, outcome in result["services"].items():
        prefix = "migrated" if outcome in ("migrated", "deduped") else "skipped"
        print(f"{prefix}: {sid} ({outcome})")
    print(f"registry: {result['registry']}")
    print(f"umbrella: {'written' if result['umbrella_written'] else 'unchanged'}")
    if result.get("refs_rewritten"):
        print(f"refs: rewrote {result['refs_rewritten']} legacy .claude/skills path(s) in SKILL.md bodies")
    for sid, aside in sorted(result.get("moved_aside", {}).items()):
        print(f"kept: the flat {sid} copy was moved aside to {aside} (not deleted) — remove it once verified")
    if result.get("pack_json_kept"):
        print(f"kept: {pack.name}/PACK.json (its content cannot be proven redundant — review manually)")
    for seg in result.get("stale_refs", []):
        print(
            f"WARNING: unmapped .claude/skills/{seg} ref left as-is "
            f"(no matching service-id or registry container) — review manually",
            file=sys.stderr,
        )
    for note in demote_shadowing_registries(project_root):
        print(note)
    sys.exit(0)


if __name__ == "__main__":
    main()
