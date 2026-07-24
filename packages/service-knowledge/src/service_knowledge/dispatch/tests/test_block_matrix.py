"""Block-matrix unit tests: every (tool, territory-match, index-state) combination.

Drives the pure ``decide()`` function directly — no subprocess, no index — so the full §3.7
matrix is pinned: Read/Glob/Grep never block; Write/Edit block only on a real retrieval failure;
read-only Bash never blocks; mutating Bash blocks on a conflicted high-risk claim. Override and
exempt paths always defuse a block.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "scripts"))

import skill_activator as sa  # type: ignore[import-not-found]  # noqa: E402

KW = dict(service_id="api-gateway", territory=["api-gateway/**"], paths=["api-gateway/main.py"])


def _retrieval(ok: bool, *, available: bool = True, bundle=None, error=None) -> sa.Retrieval:
    return sa.Retrieval(available=available, ok=ok, bundle=bundle, error=error)


OK_BUNDLE = {"items": [], "routing": {"matched_services": ["api-gateway"]}, "conflicts_and_caveats": []}
# A blocking caveat must be conflicted AND high-risk AND a prerequisite (conflicts_with edge).
CONFLICT_BUNDLE = {
    "items": [],
    "routing": {"matched_services": ["api-gateway"]},
    "conflicts_and_caveats": [
        {"status": "conflicted", "risk": "high", "conflicts_with": "claim:other", "title": "bad claim"}
    ],
}


@pytest.mark.parametrize("tool", ["Read", "Glob", "Grep", "NotebookRead"])
@pytest.mark.parametrize("retrieval", [_retrieval(True, bundle=OK_BUNDLE), _retrieval(False, error="broken")])
def test_read_tools_never_block(tool, retrieval):
    decision = sa.decide(tool, retrieval=retrieval, is_bash=False, mutating=False,
                         override=False, exempt=False, **KW)
    assert decision.action in ("inject", "allow")
    assert decision.action != "block"


def test_write_with_healthy_index_injects():
    decision = sa.decide("Write", retrieval=_retrieval(True, bundle=OK_BUNDLE), is_bash=False,
                         mutating=False, override=False, exempt=False, **KW)
    assert decision.action == "inject"


@pytest.mark.parametrize("tool", ["Write", "Edit", "NotebookEdit"])
def test_write_with_broken_index_blocks(tool):
    decision = sa.decide(tool, retrieval=_retrieval(False, error="DatabaseError: file is not a database"),
                         is_bash=False, mutating=False, override=False, exempt=False, **KW)
    assert decision.action == "block"
    assert "api-gateway" in decision.reason
    assert "api-gateway/**" in decision.reason
    assert "OVERRIDE_KNOWLEDGE_BUNDLE" in decision.reason


def test_write_broken_index_override_defuses():
    decision = sa.decide("Write", retrieval=_retrieval(False, error="broken"), is_bash=False,
                         mutating=False, override=True, exempt=False, **KW)
    assert decision.action == "override"
    assert decision.extra["override_reason"]


def test_write_broken_index_exempt_path_does_not_block():
    decision = sa.decide("Write", retrieval=_retrieval(False, error="broken"), is_bash=False,
                         mutating=False, override=False, exempt=True, **KW)
    assert decision.action != "block"


def test_write_machinery_absent_blocks_registered_territory():
    # Unavailable retrieval (machinery not importable) must BLOCK registered Write/Edit — the gate
    # demands evidence; only exempt bd-tracking paths or an override defuse it.
    decision = sa.decide("Write", retrieval=_retrieval(False, available=False, error="no import"),
                         is_bash=False, mutating=False, override=False, exempt=False, **KW)
    assert decision.action == "block"


def test_write_machinery_absent_exempt_path_does_not_block():
    decision = sa.decide("Write", retrieval=_retrieval(False, available=False, error="no import"),
                         is_bash=False, mutating=False, override=False, exempt=True, **KW)
    assert decision.action != "block"


def test_readonly_bash_never_blocks_even_broken():
    decision = sa.decide("Bash", retrieval=_retrieval(False, error="broken"), is_bash=True,
                         mutating=False, override=False, exempt=False, **KW)
    assert decision.action != "block"


def test_mutating_bash_blocks_on_conflicted_high_risk_prerequisite():
    decision = sa.decide("Bash", retrieval=_retrieval(True, bundle=CONFLICT_BUNDLE), is_bash=True,
                         mutating=True, override=False, exempt=False, **KW)
    assert decision.action == "block"


@pytest.mark.parametrize("caveat", [
    {"status": "conflicted", "risk": "high", "title": "no prerequisite edge"},  # missing conflicts_with
    {"status": "conflicted", "risk": "low", "conflicts_with": "claim:x"},  # not high-risk
    {"status": "invalidated", "risk": "high", "conflicts_with": "claim:x"},  # not conflicted
    {"status": "stale", "risk": "high", "conflicts_with": "claim:x"},  # not conflicted
])
def test_mutating_bash_does_not_block_without_all_three_predicates(caveat):
    bundle = {"items": [], "routing": {"matched_services": ["api-gateway"]},
              "conflicts_and_caveats": [caveat]}
    decision = sa.decide("Bash", retrieval=_retrieval(True, bundle=bundle), is_bash=True,
                         mutating=True, override=False, exempt=False, **KW)
    assert decision.action != "block"


def test_mutating_bash_conflict_override_defuses():
    decision = sa.decide("Bash", retrieval=_retrieval(True, bundle=CONFLICT_BUNDLE), is_bash=True,
                         mutating=True, override=True, exempt=False, **KW)
    assert decision.action == "override"


def test_mutating_bash_no_conflict_injects():
    decision = sa.decide("Bash", retrieval=_retrieval(True, bundle=OK_BUNDLE), is_bash=True,
                         mutating=True, override=False, exempt=False, **KW)
    assert decision.action == "inject"


@pytest.mark.parametrize("command,expected", [
    ("rm -rf /tmp/x", True),
    ("mv a b", True),
    ("docker rm container", True),
    ("systemctl restart nginx", True),
    ("kubectl apply -f deploy.yaml", True),
    ("gh pr merge 12", True),
    ("ls -la", False),
    ("cat config.yml", False),
    ("kubectl get pods", False),
    ("docker ps", False),
    ("python3 scripts/health_probe.py --json", False),
])
def test_mutating_bash_classification(command, expected):
    assert sa.is_mutating_bash(command) is expected


def test_exempt_paths():
    assert sa.is_exempt_path(".beads/issues/xtrm-1.json")
    assert sa.is_exempt_path("repo/.beads/x.json")
    assert not sa.is_exempt_path("api-gateway/main.py")
