"""Commit-based freshness signal F (research §3.5).

``F = exp(-ln(2) * changed_commits_since_ref / FRESHNESS_HALF_LIFE_COMMITS)`` — a skill may be
old in days but still correct if its territory has not changed, so freshness counts the commits
that touched the service territory since ``source_ref`` rather than elapsed time. Commit counts
come from git directly (the same primitive ``drift_detector`` uses for ``last_sync_ref``); the
git HEAD helper is reused from ``drift_detector`` to keep a single source of truth for refs.
"""
from __future__ import annotations

import math
import subprocess

from service_knowledge.index import _compat  # noqa: F401  (ensures scripts/ importable)
from service_knowledge.index import ranking

import drift_detector  # type: ignore[import-not-found]  # noqa: E402


def git_head(repo: str) -> str:
    """Current HEAD sha (reuses drift_detector's helper); empty string when unavailable."""
    try:
        return drift_detector._git_head(repo)
    except Exception:
        return ""


def count_commits_touching(repo: str, source_ref: str, territory: list[str]) -> int | None:
    """Number of commits in ``source_ref..HEAD`` that touched any territory path.

    Returns None when the count cannot be computed (no ref, bad ref, git unavailable) so the
    caller can apply the absent-ref freshness + stale advisory. Territory globs are passed with
    git's ``:(glob)`` pathspec magic so ``svc/**`` matches recursively.
    """
    if not source_ref:
        return None
    pathspecs = [f":(glob){pattern}" for pattern in territory if pattern]
    cmd = ["git", "-C", repo, "rev-list", "--count", f"{source_ref}..HEAD", "--"]
    cmd.extend(pathspecs)
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, check=False, timeout=15)
    except (subprocess.SubprocessError, OSError):
        return None
    if result.returncode != 0:
        return None
    try:
        return int(result.stdout.strip())
    except ValueError:
        return None


def freshness_score(changed_commits: int | None) -> float:
    """Map a commit count to F in (0, 1]; absent ref -> low score (caller adds stale advisory)."""
    if changed_commits is None:
        return ranking.FRESHNESS_ABSENT_REF
    exponent = -math.log(2) * max(0, changed_commits) / ranking.FRESHNESS_HALF_LIFE_COMMITS
    return math.exp(exponent)


def compute(repo: str, source_ref: str, territory: list[str]) -> tuple[float, int | None]:
    """Return ``(F, changed_commits)`` for a service territory since ``source_ref``."""
    changed = count_commits_touching(repo, source_ref, territory)
    return freshness_score(changed), changed
