"""Generative-model budget policy at the transport seam (XTRM-508).

A frontier or other generative call needs a declared reason, a budget
scope, and room under the scope's call and cost caps; otherwise it raises
before any process starts."""

from __future__ import annotations

import json
import threading

import pytest

from xtrm_research import transports

MODEL = "commandcode/deepseek/deepseek-v4.1-flash"


def _payload(reason="uncertainty_band"):
    return {"model": MODEL, "reason": reason, "system": "s", "input": {"q": "x"}}


def _pi_reply(cost):
    usage = {"cost": {"total": cost}} if cost is not None else {}
    return json.dumps(
        {"type": "agent_end", "messages": [{"content": [], "usage": usage}]},
        separators=(",", ":"),
    )


@pytest.fixture
def started(monkeypatch):
    """Processes the transport started, and the cost each one reports."""
    calls = []
    state = {"cost": 0.0}

    def fake(argv):
        calls.append(argv)
        return _pi_reply(state["cost"])

    monkeypatch.setattr(transports, "_run_cli", fake)
    return calls, state


@pytest.mark.parametrize("reason", [None, "", "because", "UNCERTAINTY_BAND"])
def test_a_call_without_an_allowed_reason_never_starts(started, reason):
    calls, _ = started
    payload = _payload(reason)
    if reason is None:
        del payload["reason"]
    with pytest.raises(transports.BudgetError):
        transports.pi_complete(payload)
    assert calls == []


def test_every_allowed_reason_passes(started):
    calls, _ = started
    for reason in sorted(transports.BUDGET_REASONS):
        transports.pi_complete(_payload(reason))
    assert len(calls) == len(transports.BUDGET_REASONS)


def test_no_scope_means_no_generative_call(started, monkeypatch):
    calls, _ = started
    monkeypatch.delenv(transports.BUDGET_SCOPE_ENV)
    with pytest.raises(transports.BudgetError):
        transports.pi_complete(_payload())
    monkeypatch.setenv(transports.BUDGET_SCOPE_ENV, "../escape")
    with pytest.raises(transports.BudgetError):
        transports.pi_complete(_payload())
    assert calls == []


def test_the_call_cap_is_exact_and_defaults_to_twenty(started):
    calls, _ = started
    for _ in range(transports.BUDGET_DEFAULT_MAX_CALLS):
        transports.pi_complete(_payload())
    with pytest.raises(transports.BudgetError, match="max_calls=20"):
        transports.pi_complete(_payload())
    assert len(calls) == 20


def test_the_cost_cap_stops_the_next_call(started, monkeypatch):
    calls, state = started
    state["cost"] = 0.6
    transports.pi_complete(_payload())
    transports.pi_complete(_payload())  # 0.6 spent < 1.00: allowed
    with pytest.raises(transports.BudgetError, match="max_cost_usd=1.0"):
        transports.pi_complete(_payload())  # 1.2 spent
    assert len(calls) == 2
    monkeypatch.setenv(transports.BUDGET_MAX_COST_ENV, "5")  # operator raises the cap
    transports.pi_complete(_payload())
    assert len(calls) == 3


def test_an_unpriced_call_exhausts_the_scope(started):
    calls, state = started
    state["cost"] = None
    transports.pi_complete(_payload())
    with pytest.raises(transports.BudgetError, match="no cost"):
        transports.pi_complete(_payload())
    assert len(calls) == 1


def test_a_call_that_dies_settles_unpriced(monkeypatch):
    def boom(argv):
        raise TimeoutError("cli timed out")

    monkeypatch.setattr(transports, "_run_cli", boom)
    with pytest.raises(TimeoutError):
        transports.pi_complete(_payload())
    with pytest.raises(transports.BudgetError, match="no cost"):
        transports.pi_complete(_payload())


def test_scopes_are_separate_ledgers(started, monkeypatch):
    calls, _ = started
    monkeypatch.setenv(transports.BUDGET_MAX_CALLS_ENV, "1")
    transports.pi_complete(_payload())
    with pytest.raises(transports.BudgetError):
        transports.pi_complete(_payload())
    monkeypatch.setenv(transports.BUDGET_SCOPE_ENV, "another-run")
    transports.pi_complete(_payload())
    assert len(calls) == 2


def test_settings_are_read_from_the_research_dotenv(started, monkeypatch, tmp_path):
    calls, _ = started
    monkeypatch.delenv(transports.BUDGET_SCOPE_ENV)
    env = tmp_path / ".env"
    env.write_text(
        "XTRM_RESEARCH_BUDGET_SCOPE=dotenv-run\nXTRM_RESEARCH_BUDGET_MAX_CALLS=1\n"
    )
    monkeypatch.setattr(transports, "RESEARCH_DOTENV", str(env))
    transports.pi_complete(_payload())
    with pytest.raises(transports.BudgetError, match="max_calls=1"):
        transports.pi_complete(_payload())
    assert len(calls) == 1


def test_the_claude_transport_is_gated_too(monkeypatch):
    calls = []
    monkeypatch.setattr(
        transports,
        "_run_cli",
        lambda argv: calls.append(argv) or '{"total_cost_usd": 0.0}',
    )
    payload = {
        "model": "claude-x",
        "effort": "low",
        "system": "s",
        "input": {},
        "json_schema": {},
    }
    with pytest.raises(transports.BudgetError):
        transports.claude_classify(payload)
    transports.claude_classify({**payload, "reason": "adjudication"})
    assert len(calls) == 1


def test_a_reservation_waits_for_the_ledger_lock(started, monkeypatch, tmp_path):
    """Read-count-then-append is one critical section: while another
    holder has the scope's ledger locked, a reservation cannot proceed, so
    concurrent workers can never read the same count and overshoot."""
    import fcntl
    from pathlib import Path

    calls, _ = started
    ledger = Path(transports.BUDGET_DIR) / "test.jsonl"
    ledger.touch()
    done = threading.Event()
    with ledger.open("a") as held:
        fcntl.flock(held, fcntl.LOCK_EX)
        worker = threading.Thread(
            target=lambda: (transports.pi_complete(_payload()), done.set())
        )
        worker.start()
        assert not done.wait(0.3), "reservation proceeded while the ledger was locked"
        assert calls == []
    worker.join(5)
    assert done.is_set() and len(calls) == 1
