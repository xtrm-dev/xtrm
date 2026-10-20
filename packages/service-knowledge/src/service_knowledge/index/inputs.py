"""Indexed-inputs fingerprint (XTRM-667).

The FTS5 index is a pure function of a small input set: the service registry
plus every per-service SKILL.md the builder ingests. Layer 1 used to compare
only ``sk_index_state.source_ref`` to HEAD, which is blind to *uncommitted*
skill edits — a dispatched worker searching right after a reconcile (or
mid-flight skill edit) would read a stale index with zero signal.

This module fingerprints the inputs themselves (registry + resolved skill
files, ``relpath|size|mtime_ns`` records hashed) so the gate rebuilds on ANY
skill change, committed or not, in any checkout. Stat-only: no content reads
on the hot path. Same-size+same-mtime_ns content swaps are undetectable by
construction (documented residual; git operations always bump mtime).

Resolution mirrors the builder exactly (registry via
``bootstrap.get_registry_path``; per-service ``skill_path`` with the same
``get_service_skill_path_str`` fallback; secrets-skipped files excluded like
the builder excludes them) so the gate set can neither miss an indexed file
(stale reads) nor — beyond unreadable-file edge cases — invent one (spurious
rebuilds are fail-safe anyway: worst case is one extra bounded rebuild).

Never raises: any failure returns ``None`` (unknown), which the gate treats
as mismatch (rebuild path, itself fail-safe).
"""
from __future__ import annotations

import hashlib
import os
from pathlib import Path
from typing import Any

try:
    import bootstrap  # type: ignore[import-not-found]
except (ImportError, OSError):
    bootstrap = None  # type: ignore[assignment]

try:
    from service_knowledge.index import secrets as secrets_mod
except (ImportError, OSError):
    secrets_mod = None  # type: ignore[assignment]


def _skill_rel_for(service: dict[str, Any], service_id: str, root: Path) -> str | None:
    """Resolve a service's skill path exactly the way the builder does."""
    skill_path = service.get("skill_path")
    if skill_path:
        return str(skill_path)
    if bootstrap is None:
        return None
    try:
        return bootstrap.get_service_skill_path_str(service_id, str(root))
    except Exception:
        return None


def indexed_files(root: Path | str) -> list[Path] | None:
    """Absolute paths of the files the index is built from, or None if unresolvable."""
    try:
        root = Path(root).resolve()
        out: list[Path] = []
        if bootstrap is not None:
            try:
                reg = Path(bootstrap.get_registry_path(str(root)))
            except Exception:
                reg = None
            if reg is not None:
                out.append(reg)
                try:
                    import json

                    registry = json.loads(reg.read_text(encoding="utf-8"))
                except (OSError, ValueError):
                    registry = {}
                for service_id, service in (registry.get("services", {}) or {}).items():
                    if not isinstance(service, dict):
                        continue
                    rel = _skill_rel_for(service, service_id, root)
                    if not rel:
                        continue
                    # Mirror the builder: secrets-skipped skill files contribute
                    # no content, so their mtime must not invalidate the index.
                    if secrets_mod is not None:
                        try:
                            if secrets_mod.should_skip_file(rel):
                                continue
                        except Exception:
                            pass
                    out.append(root / rel)
        else:
            # No bootstrap (unit-only context): fall back to on-disk discovery.
            # Superset-tolerant: extra files only risk a spurious rebuild.
            for reg in sorted(root.glob(".xtrm/skills/*/service-knowledge/service-registry.json")):
                out.append(reg)
            for skill in sorted(root.glob(".xtrm/skills/*/service-knowledge/services/*/SKILL.md")):
                try:
                    rel = skill.relative_to(root).as_posix()
                except ValueError:
                    rel = skill.name
                if secrets_mod is not None:
                    try:
                        if secrets_mod.should_skip_file(rel):
                            continue
                    except Exception:
                        pass
                out.append(skill)
        # De-dupe preserving order; drop nothing (missing files are recorded, not skipped).
        seen: set[Path] = set()
        uniq: list[Path] = []
        for p in out:
            if p not in seen:
                seen.add(p)
                uniq.append(p)
        return uniq
    except Exception:
        return None


def _record(path: Path, root: Path) -> str:
    try:
        rel = path.relative_to(root).as_posix()
    except ValueError:
        rel = str(path)
    try:
        st = path.stat()
        return f"{rel}|{st.st_size}|{st.st_mtime_ns}"
    except OSError:
        return f"{rel}|MISSING"


def fingerprint_inputs(root: Path | str) -> str | None:
    """Stable sha256 over the indexed inputs' (path, size, mtime_ns). None on failure."""
    try:
        root = Path(root).resolve()
        files = indexed_files(root)
        if files is None:
            return None
        digest = hashlib.sha256()
        for path in sorted(files, key=lambda p: p.as_posix()):
            digest.update((_record(path, root) + "\n").encode("utf-8", errors="replace"))
        return "sha256:" + digest.hexdigest()
    except Exception:
        return None
