"""Read-time freshness gate (B1 / Layer 1): source_ref-vs-HEAD on every read path.

* Fresh clone/worktree (absent cache) self-heals on the first query within budget.
* merge/rebase/reset/checkout/amend change HEAD, so all are covered with no hooks;
  ``--no-verify`` commits (hook bypass) self-heal on the next read.
* Lock contention and rebuild failure serve stale + one-line notice + a
  ``retrieval_event{stale_served=1}`` telemetry record, never blocking past budget.
"""
from __future__ import annotations

import json
import subprocess
import time
from pathlib import Path

import pytest

from service_knowledge import index
from service_knowledge.index import gate as gate_mod
from service_knowledge.index import paths

try:
    import fcntl
except ImportError:  # non-POSIX: contention test cannot hold an flock
    fcntl = None  # type: ignore[assignment]


def _git(args: list[str], cwd: Path) -> str:
    proc = subprocess.run(["git", "-C", str(cwd), *args], check=True,
                          capture_output=True, text=True)
    return proc.stdout.strip()


def _head(repo: Path) -> str:
    return _git(["rev-parse", "HEAD"], repo)


def _commit_change(repo: Path, message: str, *, no_verify: bool = True) -> str:
    target = repo / "alertmanager" / "alertmanager.yml"
    if not target.exists():
        target = next(p for p in repo.iterdir() if p.is_dir() and p.name != ".xtrm") / "config.yml"
    with target.open("a", encoding="utf-8") as f:
        f.write(f"# {message}: {time.time_ns()}\n")
    _git(["add", "-A"], repo)
    args = ["commit", "-qm", message]
    if no_verify:
        args = ["commit", "--no-verify", "-qm", message]
    _git(args, repo)
    return _head(repo)


def _gate_events(repo: Path) -> list[dict]:
    events_file = paths.events_path(repo)
    if not events_file.exists():
        return []
    records = [json.loads(line) for line in events_file.read_text().splitlines() if line.strip()]
    return [r for r in records if r.get("event") == "gate"]


def test_first_query_self_heals_with_no_cache(alertmanager_consumer):
    """Fresh clone/worktree: absent cache counts as mismatch; first query rebuilds."""
    assert not paths.db_path(alertmanager_consumer).exists()
    head = _head(alertmanager_consumer)

    started = time.perf_counter()
    result = index.search(alertmanager_consumer, "discord webhook")
    duration_s = time.perf_counter() - started

    assert result["results"], "self-healed index must return hits on first query"
    assert result["source_ref"] == head
    assert result["stale_served"] is False
    assert result["notice"] is None
    assert duration_s < gate_mod.GATE_BUDGET_SECONDS
    events = _gate_events(alertmanager_consumer)
    assert len(events) == 1 and events[0]["rebuilt"] is True and events[0]["stale_served"] == 0


def test_evidence_for_files_self_heals_with_no_cache(alertmanager_consumer):
    bundle = index.evidence_for_files(alertmanager_consumer, ["alertmanager/alertmanager.yml"])
    assert bundle["routing"]["source_ref"] == _head(alertmanager_consumer)
    assert bundle["stale_served"] is False
    assert "freshness_notice" not in bundle["routing"]
    assert bundle["routing"]["matched_services"] == ["alertmanager"]


def test_no_verify_commit_self_heals_on_next_read(alertmanager_consumer):
    """A --no-verify commit bypasses hooks; the next read still serves fresh results."""
    index.build(alertmanager_consumer)
    new_head = _commit_change(alertmanager_consumer, "unverified change")
    assert new_head == _head(alertmanager_consumer)

    result = index.search(alertmanager_consumer, "discord webhook")
    assert result["source_ref"] == _head(alertmanager_consumer)
    assert result["stale_served"] is False
    assert result["results"], "rebuilt index must still match"


def test_amend_and_reset_covered_without_hooks(alertmanager_consumer):
    index.build(alertmanager_consumer)
    _commit_change(alertmanager_consumer, "first change")

    # amend: new tree + new message -> new HEAD, no hook involved.
    target = alertmanager_consumer / "alertmanager" / "alertmanager.yml"
    with target.open("a", encoding="utf-8") as f:
        f.write("# amended line\n")
    _git(["add", "-A"], alertmanager_consumer)
    _git(["commit", "--amend", "-qm", "amended message"], alertmanager_consumer)
    amended = _head(alertmanager_consumer)
    result = index.search(alertmanager_consumer, "discord webhook")
    assert result["source_ref"] == amended

    # reset: HEAD moves back; gate rebuilds again.
    _git(["reset", "--hard", "HEAD~1"], alertmanager_consumer)
    reset_head = _head(alertmanager_consumer)
    assert reset_head != amended
    result = index.search(alertmanager_consumer, "discord webhook")
    assert result["source_ref"] == reset_head
    assert result["stale_served"] is False


@pytest.mark.skipif(fcntl is None, reason="requires POSIX flock")
def test_lock_contention_serves_stale_within_budget(alertmanager_consumer, monkeypatch):
    index.build(alertmanager_consumer)
    stale_head = _head(alertmanager_consumer)
    _commit_change(alertmanager_consumer, "change while locked")
    assert _head(alertmanager_consumer) != stale_head

    monkeypatch.setenv(gate_mod.GATE_BUDGET_ENV, "2")
    lock_file = paths.lock_path(alertmanager_consumer)
    lock_file.parent.mkdir(parents=True, exist_ok=True)
    holder = open(lock_file, "a+b")
    try:
        fcntl.flock(holder.fileno(), fcntl.LOCK_EX)
        started = time.perf_counter()
        result = index.search(alertmanager_consumer, "discord webhook")
        waited_s = time.perf_counter() - started
    finally:
        fcntl.flock(holder.fileno(), fcntl.LOCK_UN)
        holder.close()

    assert result["stale_served"] is True
    assert result["source_ref"] == stale_head, "exhaustion serves the stale cache"
    assert result["notice"] is not None and "\n" not in result["notice"]
    assert waited_s < 15, f"gate must never block past budget (waited {waited_s:.1f}s)"
    events = _gate_events(alertmanager_consumer)
    assert events and events[-1]["stale_served"] == 1 and events[-1]["rebuilt"] is False


@pytest.mark.skipif(fcntl is None, reason="requires POSIX flock")
def test_build_bundle_reports_stale_notice_on_exhaustion(alertmanager_consumer, monkeypatch):
    index.build(alertmanager_consumer)
    _commit_change(alertmanager_consumer, "change while locked")

    monkeypatch.setenv(gate_mod.GATE_BUDGET_ENV, "2")
    lock_file = paths.lock_path(alertmanager_consumer)
    lock_file.parent.mkdir(parents=True, exist_ok=True)
    holder = open(lock_file, "a+b")
    try:
        fcntl.flock(holder.fileno(), fcntl.LOCK_EX)
        bundle = index.build_bundle({"results": [], "paths": [], "source_ref": ""},
                                    alertmanager_consumer)
    finally:
        fcntl.flock(holder.fileno(), fcntl.LOCK_UN)
        holder.close()

    assert bundle["stale_served"] is True
    notice = bundle["routing"].get("freshness_notice", "")
    assert notice and "\n" not in notice


def test_rebuild_failure_serves_stale_and_never_raises(alertmanager_consumer, monkeypatch):
    index.build(alertmanager_consumer)
    stale_head = _head(alertmanager_consumer)
    _commit_change(alertmanager_consumer, "change before failed rebuild")

    def _boom(root, **kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr("service_knowledge.index.builder.build", _boom)
    result = index.search(alertmanager_consumer, "discord webhook")

    assert result["stale_served"] is True
    assert result["source_ref"] == stale_head
    assert result["notice"] is not None and "rebuild failed" in result["notice"]
    events = _gate_events(alertmanager_consumer)
    assert events and events[-1]["stale_served"] == 1


def test_fresh_read_takes_fast_path_silently(alertmanager_consumer):
    index.build(alertmanager_consumer)
    assert _gate_events(alertmanager_consumer) == []
    result = index.search(alertmanager_consumer, "discord webhook")
    assert result["stale_served"] is False
    assert result["notice"] is None
    assert _gate_events(alertmanager_consumer) == [], "fast path must not log"


def test_absent_cache_counts_as_mismatch(alertmanager_consumer):
    assert gate_mod.read_index_source_ref(alertmanager_consumer) is None
    outcome = gate_mod.ensure_fresh(alertmanager_consumer, reason="test")
    assert outcome.rebuilt is True
    assert outcome.stale_served is False
    assert outcome.source_ref == _head(alertmanager_consumer)


def test_rebuild_wall_within_provisional_budget(infra_consumer):
    """Pin the budget datum: 17-service rebuild wall time vs the 90s provisional budget."""
    assert gate_mod.GATE_BUDGET_SECONDS == 90.0, "provisional; retune from measured data"
    stats = index.build(infra_consumer)
    assert stats.services == 17
    assert (stats.duration_ms / 1000.0) < gate_mod.GATE_BUDGET_SECONDS

def _first_skill(repo: Path) -> Path:
    skills = sorted((repo / ".xtrm" / "skills").rglob("services/*/SKILL.md"))
    assert skills, "fixture must carry at least one per-service SKILL.md"
    return skills[0]


def test_uncommitted_skill_edit_triggers_rebuild(alertmanager_consumer):
    """HEAD-blind spot (XTRM-667): an uncommitted SKILL.md edit must rebuild on next read."""
    index.build(alertmanager_consumer)
    quiet = gate_mod.ensure_fresh(alertmanager_consumer)
    assert quiet.rebuilt is False and quiet.stale_served is False

    skill = _first_skill(alertmanager_consumer)
    with skill.open("a", encoding="utf-8") as fh:
        fh.write("\nquux-uncommitted-freshness-probe reconciled wiring detail.\n")

    out = gate_mod.ensure_fresh(alertmanager_consumer)
    assert out.rebuilt is True, "uncommitted skill edit must force a rebuild"
    assert out.stale_served is False
    result = index.search(alertmanager_consumer, "quux-uncommitted-freshness-probe")
    assert result["results"], "rebuilt index must contain the uncommitted edit"
    assert result["stale_served"] is False


def test_unchanged_inputs_take_silent_fast_path(alertmanager_consumer):
    """No input change: single stat sweep, no rebuild, no telemetry noise."""
    from service_knowledge.index import inputs as inputs_mod

    index.build(alertmanager_consumer)
    stored = gate_mod.read_index_fingerprint(alertmanager_consumer)
    assert stored, "build must stamp an inputs fingerprint"
    assert stored == inputs_mod.fingerprint_inputs(alertmanager_consumer)
    before = _gate_events(alertmanager_consumer)
    out = gate_mod.ensure_fresh(alertmanager_consumer)
    assert out.rebuilt is False and out.stale_served is False
    assert _gate_events(alertmanager_consumer) == before


def test_territory_source_touch_does_not_rebuild(alertmanager_consumer):
    """Precision: indexed inputs are registry + SKILL.md only — touching a
    territory source file must NOT invalidate the index."""
    index.build(alertmanager_consumer)
    gate_mod.ensure_fresh(alertmanager_consumer)
    touched = False
    for cand in alertmanager_consumer.rglob("*.yml"):
        if ".xtrm" not in cand.parts:
            cand.write_text(cand.read_text(encoding="utf-8") + "# touch\n", encoding="utf-8")
            touched = True
            break
    assert touched, "fixture must contain a territory source file"
    out = gate_mod.ensure_fresh(alertmanager_consumer)
    assert out.rebuilt is False and out.stale_served is False
