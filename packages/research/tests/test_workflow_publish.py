"""System One workflow runner and app-visible evidence publisher (XTRM-509)."""

from __future__ import annotations

import json

import pytest

from xtrm_research import guards, publish, transports
from xtrm_research.cli.main import main
from xtrm_research.definitions import DefinitionRegistry
from xtrm_research.workflow import ResponseCache, Workflow, jev_cost


class Countdown(Workflow):
    """A toy control loop: state {"n"} asks two atomic questions; the policy
    steps down while n > 0 and escalates when the answers disagree."""

    def questions(self, state):
        return {
            "is_positive": {"type": "noul", "instructions": "n > 0"},
            "is_even": {"type": "noul", "instructions": "n is even"},
        }

    def policy(self, state, answers):
        disagree = (
            abs(answers["is_positive"]["noul"] - answers["is_even"]["noul"]) > 0.5
        )
        return {
            "action": "step" if state["n"] > 0 else "stop",
            "escalate": "uncertainty_band" if disagree else None,
        }

    def escalate(self, state, answers, decision):
        return {"action": "step", "resolved_by": "replay", "usage": None}

    def next_state(self, state, decision, escalation):
        return {"n": state["n"] - 1} if decision["action"] == "step" else None

    def outcome(self, episode_id, trace):
        return {
            "resolved": {"steps": sum(r["kind"] == "system_one_call" for r in trace)}
        }


@pytest.fixture
def jev(monkeypatch):
    """Fake TypeSafe transport: answers from the state, counts calls."""
    calls = []

    def fake(payload):
        calls.append(payload)
        n = payload["state"]["n"]
        return {
            "model": "jev-1.13.0",
            "request_id": f"req-{len(calls)}",
            "sdk_version": "0",
            "usage": {"input_tokens": 1000, "output_tokens": 10},
            "answers": {
                "is_positive": {"type": "noul", "noul": 0.9 if n > 0 else 0.1},
                "is_even": {"type": "noul", "noul": 0.9 if n % 2 == 0 else 0.1},
            },
        }

    monkeypatch.setattr(transports, "typesafe_system_one", fake)
    return calls


def test_each_step_yields_separate_answer_decision_and_escalation_records(
    jev, tmp_path
):
    records = Countdown(ResponseCache(tmp_path / "c.jsonl")).run_episode(
        "ep1", {"n": 2}
    )
    kinds = [r["kind"] for r in records]
    assert kinds == [
        "system_one_call",
        "policy_action",  # n=2: agree
        "system_one_call",
        "policy_action",
        "escalation",  # n=1: positive, odd
        "system_one_call",
        "policy_action",
        "escalation",  # n=0: not positive, even -> disagree, stop
        "outcome",
    ]
    assert len(jev) == 3 and all(r["sample_id"] == "ep1" for r in records)
    call, decision = records[0]["data"], records[1]["data"]
    assert "answers" in call and "action" not in call
    assert "answers" not in decision and decision["request_id"] == call["request_id"]
    assert records[-1]["data"] == {"resolved": {"steps": 3}}
    assert call["cost"]["value"] == pytest.approx(1000 * 0.042 / 1e6)
    assert records[0]["usage"]["latency_ms"] is not None


def test_a_second_run_replays_from_the_cache_without_a_send(jev, tmp_path):
    first = Countdown(ResponseCache(tmp_path / "c.jsonl")).run_episode("ep1", {"n": 1})
    again = Countdown(ResponseCache(tmp_path / "c.jsonl")).run_episode("ep1", {"n": 1})
    assert len(jev) == 2  # only the first run sent
    def ids(rs):
        return [r["data"]["request_id"] for r in rs if r["kind"] == "system_one_call"]

    assert ids(first) == ids(again)
    assert all(r["data"]["cached"] for r in again if r["kind"] == "system_one_call")


def test_a_guard_refusal_ends_the_episode_without_a_send(jev, tmp_path, monkeypatch):
    def refuse(*args):
        raise guards.GuardFailure("mask", "test")

    monkeypatch.setattr(guards, "_run_guards", refuse)
    records = Countdown(ResponseCache(tmp_path / "c.jsonl")).run_episode(
        "ep1", {"n": 2}
    )
    assert jev == [] and records[0]["kind"] == "guard_failure"


def test_an_episode_that_does_not_end_is_marked_truncated(jev, tmp_path):
    records = Countdown(ResponseCache(tmp_path / "c.jsonl")).run_episode(
        "ep1", {"n": 10}, max_steps=2
    )
    assert [r["kind"] for r in records][-2:] == ["truncated", "outcome"]


def test_escalating_without_an_escalate_seam_fails(jev, tmp_path):
    class NoEscalate(Countdown):
        escalate = Workflow.escalate

    with pytest.raises(NotImplementedError):
        NoEscalate(ResponseCache(tmp_path / "c.jsonl")).run_episode("ep1", {"n": 1})


def test_unpriced_model_costs_null():
    assert jev_cost(10, 1, "unknown-model")["value"] is None
    assert jev_cost(None, 1, "jev-1.13.0")["value"] is None


# --- publisher ---------------------------------------------------------------


def _defs(reg):
    qs = [
        publish.register(
            reg,
            "question_spec",
            {
                "id": "toy.is_positive",
                "version": "v1",
                "type": "noul",
                "instructions": "n > 0",
            },
        ),
    ]
    workload = publish.register(
        reg,
        "workload",
        {
            "id": "toy",
            "version": "v1",
            "description": "toy countdown",
            "sample_provider": "inline",
            "runner_kind": "system_one_workflow",
            "required_capabilities": [],
            "input_schema": {"type": "object"},
            "output_schema": {"type": "object"},
            "questions": [{"id": "toy.is_positive", "version": "v1"}],
            "observers": [],
            "evaluators": [{"id": "toy-eval", "version": "v1"}],
            "default_metrics": ["steps"],
            "legend": {"steps": "System One calls per episode", "toy.is_positive": "n > 0"},
        },
    )
    variant = publish.register(
        reg,
        "variant",
        {
            "id": "toy-jev",
            "version": "v1",
            "description": "jev",
            "config": {"model": "jev-latest"},
        },
    )
    experiment = publish.register(
        reg,
        "experiment",
        {
            "id": "toy-exp",
            "version": "v1",
            "workload": {"id": "toy", "version": "v1"},
            "description": "toy",
            "hypothesis": "h",
            "variants": [{"id": "toy-jev", "version": "v1"}],
            "named_datasets": ["steps"],
            "legend": {"steps": "System One calls per episode", "toy-jev": "jev"},
            "chart_specs": [],
        },
    )
    dataset = publish.register(
        reg,
        "dataset",
        {
            "id": "toy-ds",
            "version": "v1",
            "description": "toy",
            "source": "inline",
        },
    )
    evaluator = publish.register(
        reg,
        "evaluator",
        {
            "id": "toy-eval",
            "version": "v1",
            "kind": "outcome",
            "config": {},
            "code_revision": "test",
        },
    )
    return dict(
        experiment=experiment,
        workload=workload,
        dataset=dataset,
        variant=variant,
        question_specs=qs,
        evaluator=evaluator,
    )


def _publish(root, reg, records, **over):
    kwargs = dict(
        **_defs(reg),
        backend={
            "provider": "typesafe",
            "model": "jev-1.13.0",
            "model_version": "jev-1.13.0",
        },
        accounting={
            "price_table_version": "2026-09-18.1",
            "telemetry_schema_version": "xtrm-research-telemetry/v1",
            "otel_semconv_ref": "gen_ai/v1.28",
        },
        intent={
            "purpose": "test",
            "trigger": "exploration",
            "requested_by": "XTRM-509",
            "tags": ["test"],
        },
        samples=[{"sample_id": "ep1", "input": {"n": 2}}],
        records=records,
        assessments=[{"sample_id": "ep1", "answer": {"noul": 0.9}}],
        metrics={
            "steps": publish.metric(3.0, [2.0, 4.0], 1, "count"),
            "absent": publish.metric(None, None, 0, "x"),
        },
        annotations=[
            {"kind": "conclusion", "text": "toy concluded"},
            {
                "kind": "evidence_status",
                "text": "reproducible replay",
                "evidence_status": "reproducible",
            },
        ],
    )
    kwargs.update(over)
    return publish.publish_run(root, "toy-run", **kwargs)


def _cli(argv, capsys):
    main(argv + ["--json"])
    return json.loads(capsys.readouterr().out)


def test_a_published_run_is_visible_through_every_app_read_verb(
    jev, tmp_path, capsys, monkeypatch
):
    root, reg = tmp_path / "runs", tmp_path / "registry"
    records = Countdown(ResponseCache(tmp_path / "c.jsonl")).run_episode(
        "ep1", {"n": 2}
    )
    _publish(root, reg, records)

    row = _cli(["--root", str(root), "runs"], capsys)["data"][0]
    assert (
        row["experiment"] == "toy-exp" and row["latest_conclusion"] == "toy concluded"
    )
    assert row["evidence_status"] == "reproducible" and row["status"] == "success"
    summary = _cli(["--root", str(root), "metrics", "toy-run"], capsys)["data"]
    assert summary["sample_count"] == 1 and summary["event_count"] == len(records)
    assert summary["metrics"]["toy-eval::steps"]["ci95"] == [2.0, 4.0]
    assert "toy-eval::absent" not in summary["metrics"]
    tail = _cli(["--root", str(root), "tail", "toy-run"], capsys)["data"]
    assert {e["sample_id"] for e in tail["events"]} == {"ep1"}
    shown = _cli(["experiment", "show", "toy-exp", "--registry-root", str(reg)], capsys)
    assert shown["ok"] and shown["data"]["hypothesis"] == "h"

    manifest = _cli(["--root", str(root), "run", "show", "toy-run"], capsys)["data"][
        "manifest"
    ]
    registry = DefinitionRegistry(reg)
    for kind in ("experiment", "workload", "variant", "dataset"):
        ref = manifest[kind]
        assert (
            registry.get(kind, ref["id"], ref["version"])["content_hash"]
            == ref["content_hash"]
        )


def test_a_failed_publish_leaves_no_run_behind(jev, tmp_path):
    root, reg = tmp_path / "runs", tmp_path / "registry"
    with pytest.raises(ValueError):
        _publish(
            root, reg, [], assessments=[{"sample_id": "nope", "answer": {"noul": 0.5}}]
        )
    assert not (root / "toy-run").exists()


def test_a_definition_version_is_immutable(tmp_path):
    body = {
        "id": "d",
        "version": "v1",
        "description": "x",
        "source": "inline",
    }
    first = publish.register(tmp_path, "dataset", body)
    assert publish.register(tmp_path, "dataset", body) == first
    with pytest.raises(FileExistsError):
        publish.register(tmp_path, "dataset", {**body, "description": "changed"})
