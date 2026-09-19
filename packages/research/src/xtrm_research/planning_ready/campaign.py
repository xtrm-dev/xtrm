"""Execute the Planning Ready-contract campaign (XTRM-99 c.13435/c.13438).

Commands:

    collect --kind atomic|holistic      one System One request per unit, cached
    mutate                              build the mutation set and collect it
    arms                                compose and publish arms A/B0/B/C
    escalate                            arm D: reasoning model on genuine uncertainty
    report                              plain-language result + markdown report

Everything goes through the existing harness: ``workflow.Workflow`` for the
System One control loop (one request per unit carrying the whole battery, with
the response cache replaying on re-runs), ``guards.guarded_send`` for every
remote send, ``publish.publish_run`` for app-visible evidence, and
``evidence_gate.stats`` for intervals. No second research runtime.
"""

from __future__ import annotations

import json
import math
import random
import re
import statistics
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Sequence

import jsonschema

from xtrm_research import publish
from xtrm_research.evidence_gate.stats import resample_indices, wilson
from xtrm_research.planning_ready import mutations as mutations_module
from xtrm_research.planning_ready import policy as policy_module
from xtrm_research.planning_ready import questions as questions_module
from xtrm_research.planning_ready.policy import (
    LearnedComposition,
    Thresholds,
    answers_of,
    auc,
    brier,
    calibrate_holistic_threshold,
    calibrate_thresholds,
    classification_metrics,
    deterministic_only_policy,
    ece,
    explicit_policy,
    fit_learned_composition,
    holistic_policy,
)
from xtrm_research.workflow import ResponseCache, Workflow

DATASET_DIR = Path("~/.xtrm/research/datasets/planning-ready-v2").expanduser()
RUNS_ROOT = Path("~/.xtrm/research/runs").expanduser()
ANSWERS_DIR = DATASET_DIR / "answers"

#: Immutable scientific meaning for this experiment: it lives here, in the
#: versioned registry definition, not in any run manifest.
#: Fully qualified persisted metric ids.
#:
#: The evaluator writes arm metrics as ``"{partition}.{name}"`` and primitive
#: metrics as ``"{primitive}_{stat}"``, and the app resolves a chart dataset
#: only by exact key or by a ``"::"`` suffix match. A bare ``"false_ready_rate"``
#: or ``"primitive_auc"`` therefore matches nothing: the chart renders empty
#: while every schema check still passes. The experiment record builds its ids
#: from these constants instead of spelling them out, so record and emitter
#: cannot drift apart. ``test_planning_ready.py`` asserts the resolution.
PARTITION_LABEL = "test"
DECISION_METRICS = (
    "false_ready_rate",
    "false_draft_rate",
    "precision",
    "recall",
    "accuracy",
    "balanced_accuracy",
    "coverage",
)
DECISION_METRIC_LEAVES = tuple(f"{PARTITION_LABEL}.{name}" for name in DECISION_METRICS)
DELTA_LEAF = f"{PARTITION_LABEL}.false_ready_rate_delta_vs_holistic"
UNPARTITIONED_METRIC_LEAVES = ("escalation_rate", "mutation_intended_direction_ok")

#: One legend line and one glossary entry per primitive and statistic, generated
#: from the primitive list the policy itself scores.
PRIMITIVE_STAT_TEXT: dict[str, dict[str, str]] = {
    "auc": {
        "legend": "ranking quality against the ready label",
        "label": "AUC",
        "description": "Discrimination / ranking performance of one primitive's P(yes) against the ready label: the probability that a ready contract scores above a not-ready one.",
        "unit": "probability scale",
        "direction": "higher_better",
        "interpretation": "0.5 is random ranking; 1.0 is perfect ranking. A primitive is not the final label, so high AUC is evidence about that primitive only.",
    },
    "brier": {
        "legend": "probability forecast error against the ready label",
        "label": "Brier",
        "description": "Mean squared error of one primitive's probability forecast against the ready label.",
        "unit": "squared probability",
        "direction": "lower_better",
        "interpretation": "0 is a perfect forecast; 0.25 equals an uninformative 0.5 forecast.",
    },
    "ece": {
        "legend": "calibration against the ready label",
        "label": "ECE",
        "description": "Expected calibration error: compares each primitive's predicted probability with the empirical frequency in ten equal-width bins.",
        "unit": "probability",
        "direction": "lower_better",
        "interpretation": "0 means predicted probabilities matched observed frequencies.",
    },
}
PRIMITIVE_STATS = tuple(PRIMITIVE_STAT_TEXT)
PRIMITIVE_LABELS = {
    name: name.replace("_", " ").capitalize() for name in policy_module.NOUL_FEATURES
}
PRIMITIVE_METRIC_LEAVES = tuple(
    f"{name}_{stat}" for name in policy_module.NOUL_FEATURES for stat in PRIMITIVE_STATS
)
PER_PRIMITIVE_LEGEND = {
    f"{name}_{stat}": f"{PRIMITIVE_LABELS[name]}: {text['legend']}"
    for name in policy_module.NOUL_FEATURES
    for stat, text in PRIMITIVE_STAT_TEXT.items()
}
PER_PRIMITIVE_GLOSSARY = {
    f"{name}_{stat}": {
        "label": f"{PRIMITIVE_LABELS[name]} {text['label']}",
        "description": text["description"],
        "unit": text["unit"],
        "direction": text["direction"],
        "interpretation": text["interpretation"],
    }
    for name in policy_module.NOUL_FEATURES
    for stat, text in PRIMITIVE_STAT_TEXT.items()
}

EXPERIMENT = {
    "id": "planning-ready-v2",
    "version": "v1",
    "workload": {"id": "planning-ready", "version": "v1"},
    "description": (
        "Does an atomic System One battery composed by explicit, non-compensatory code decide whether "
        "a Planning contract is ready for dispatch, compared with the historical holistic judgment and "
        "with the incumbent deterministic readiness state?"
    ),
    "research_question": (
        "Can atomic System One judgments over a Planning work contract, composed by explicit code, decide "
        "READY / DRAFT / NEEDS_DECISION / BLOCKED / REVIEW as well as or better than the historical "
        "single holistic 'executable' judgment, and what does each primitive actually measure?"
    ),
    "hypothesis": (
        "Atomic System One judgments composed by an explicit non-compensatory policy separate genuinely "
        "ready contracts from not-ready ones with a lower false-READY rate than the historical holistic "
        "judgment, and each primitive moves in the expected direction under a controlled mutation of the "
        "invariant it names."
    ),
    "primary_outcomes": [
        "test.false_ready_rate",
        "test.false_draft_rate",
        "test.balanced_accuracy",
        "mutation_intended_direction_ok",
    ],
    "success_criteria": [
        "On the frozen test partition, the explicit atomic policy's false-READY rate is lower than the "
        "holistic arm's, with the paired difference's 95% interval excluding zero, and inflated neither "
        "by the easy structurally-invalid pool (excluded by construction) nor by escalation.",
        "Every mutation class moves its declared primitive in the declared direction with a 95% interval "
        "excluding zero, while no unrelated primitive moves without an explanation.",
    ],
    "falsification_criteria": [
        "The explicit atomic policy is no better than the holistic arm on the test partition: the paired "
        "false-READY difference's 95% interval contains zero.",
        "At least one mutation class leaves its declared primitive statistically unmoved, or moves "
        "unrelated primitives as much as the declared one.",
    ],
    "non_claims": [
        "No production or runtime adoption of System One readiness is claimed: Substrate readiness stays "
        "deterministic plus attestation until a benchmark supports more.",
        "No claim about the joint correctness of the incumbent's own readiness state: it is a baseline, "
        "not an oracle.",
        "No claim that a semantic judgment replaces a deterministic check: structure is checked by code.",
        "No claim about downstream dispatch outcomes beyond the closure/supersession evidence available "
        "on the frozen board snapshot.",
    ],
    "terminology": {
        "System One": "A TypeSafe model interface evaluating atomic questions over supplied state and returning typed probabilistic answers. It owns no control flow and performs no side effects.",
        "Jev": "The TypeSafe System One model this experiment calls, requested as the alias jev-latest and recorded with its resolved version.",
        "Noul": "P(yes) for a yes/no question. There is no separate confidence field: 0.5 means yes and no are similarly likely, not 'medium'.",
        "Choice": "Selection of one option from a defined set, returned with probabilities and a confidence that describes the shape of the distribution.",
        "Score": "A probability-weighted position on an ordered legend. Not used by this experiment: the Ready contract has no ordinal dimension.",
        "deterministic channel": "Facts code can prove exactly (required sections, unresolved markers, referenced artifacts). Never asked of a System One model.",
        "incumbent readiness": "Substrate's current readiness state: deterministic structural validation plus an explicit human/policy attestation per revision.",
    },
    "variants": [
        {"id": "holistic", "version": "v1"},
        {"id": "deterministic-only", "version": "v1"},
        {"id": "atomic-explicit-policy", "version": "v1"},
        {"id": "atomic-learned-composition", "version": "v1"},
        {"id": "atomic-policy-escalation", "version": "v1"},
        {"id": "jev-battery", "version": "v1"},
        {"id": "mutation-suite", "version": "v1"},
    ],
    "named_datasets": [
        *DECISION_METRIC_LEAVES,
        DELTA_LEAF,
        *UNPARTITIONED_METRIC_LEAVES,
        *PRIMITIVE_METRIC_LEAVES,
    ],
    "legend": {
        "test.false_ready_rate": "share of genuinely not-ready contracts the policy marked READY",
        "test.false_draft_rate": "share of genuinely ready contracts the policy did not mark READY",
        "test.balanced_accuracy": "mean of sensitivity and specificity for the READY decision",
        "test.accuracy": "share of units whose READY/not-READY decision matched the label",
        "test.precision": "among contracts called READY, the share genuinely ready",
        "test.recall": "among genuinely ready contracts, the share called READY",
        "test.coverage": "share of units a policy resolves without escalating to a reasoning model",
        "escalation_rate": "share of units escalated to the reasoning model",
        "test.false_ready_rate_delta_vs_holistic": "paired false-READY rate difference against the holistic arm",
        "mutation_intended_direction_ok": "share of mutation classes whose declared primitive moved in the declared direction",
        **PER_PRIMITIVE_LEGEND,
        "holistic": "the historical single 'executable' System One judgment",
        "deterministic-only": "structure checks only: no semantic judgment at all",
        "atomic-explicit-policy": "the atomic battery composed by the frozen non-compensatory policy",
        "atomic-learned-composition": "the same primitive answers composed by a calibrated learned classifier",
        "atomic-policy-escalation": "the explicit policy, with genuine uncertainty escalated to a reasoning model",
        "jev-battery": "the System One battery answers themselves, one request per contract",
        "mutation-suite": "controlled mutations of strong contracts with pre-declared expectations",
        "partition::train": "units used to fit thresholds and weights",
        "partition::calibration": "units used to calibrate the learned composition",
        "partition::test": "the pre-registered held-out partition",
        "partition::repo_holdout": "a whole repository held out for the cross-repo stability report",
    },
    "metric_glossary": {
        "test.false_ready_rate": {
            "label": "False READY rate",
            "description": "Among contracts that are genuinely not ready, the share the policy marked READY.",
            "unit": "share",
            "direction": "lower_better",
            "interpretation": "0 means no not-ready contract was dispatched; 1 means every one was.",
        },
        "test.false_draft_rate": {
            "label": "False DRAFT rate",
            "description": "Among genuinely ready contracts, the share the policy did not mark READY.",
            "unit": "share",
            "direction": "lower_better",
            "interpretation": "0 means every ready contract was dispatched; 1 means none was.",
        },
        "test.balanced_accuracy": {
            "label": "Balanced accuracy",
            "description": "Mean of sensitivity and specificity for the READY decision.",
            "unit": "share",
            "direction": "higher_better",
            "interpretation": "0.5 is chance; 1.0 is perfect. Insensitive to class imbalance.",
        },
        "test.accuracy": {
            "label": "Accuracy",
            "description": "Share of units whose READY / not-READY decision matched the label.",
            "unit": "share",
            "direction": "higher_better",
            "interpretation": "Reported beside balanced accuracy; it is not the headline because the classes are not balanced.",
        },
        "test.precision": {
            "label": "Precision",
            "description": "Among contracts the policy called READY, the share genuinely ready.",
            "unit": "share",
            "direction": "higher_better",
            "interpretation": "The dispatch-safety view of the decision.",
        },
        "test.recall": {
            "label": "Recall",
            "description": "Among genuinely ready contracts, the share the policy called READY.",
            "unit": "share",
            "direction": "higher_better",
            "interpretation": "The throughput view of the decision.",
        },
        "test.coverage": {
            "label": "Coverage",
            "description": "Share of units a policy resolves on its own, without escalating to a reasoning model.",
            "unit": "share",
            "direction": "higher_better",
            "interpretation": "Cost driver: escalation is the exceptional path.",
        },
        "escalation_rate": {
            "label": "Escalation rate",
            "description": "Share of units escalated to the reasoning model in the escalation arm.",
            "unit": "share",
            "direction": "lower_better",
            "interpretation": "Only genuine uncertainty should escalate.",
        },
        "test.false_ready_rate_delta_vs_holistic": {
            "label": "False READY delta vs holistic",
            "description": "Paired difference in false-READY rate against the holistic arm on the same units.",
            "unit": "share difference",
            "direction": "lower_better",
            "interpretation": "Negative favours the atomic policy; the interval must exclude 0 to be decisive.",
        },
        "mutation_intended_direction_ok": {
            "label": "Mutation acceptance",
            "description": "Share of mutation classes whose declared primitive moved in the declared direction with the interval excluding zero.",
            "unit": "share",
            "direction": "higher_better",
            "interpretation": "1.0 means every mutation moved the primitive it names.",
        },
        **PER_PRIMITIVE_GLOSSARY,
    },
    "chart_specs": [
        {
            "id": "arm-false-ready",
            "schema_version": "xtrm-research-chart-spec/v1",
            "title": "False READY rate by arm",
            "description": "The headline safety metric across the compared arms, with its interval.",
            "datasets": ["test.false_ready_rate"],
        },
        {
            "id": "arm-balance",
            "schema_version": "xtrm-research-chart-spec/v1",
            "title": "Balanced accuracy and coverage by arm",
            "description": "Decision quality against the share of units each arm resolves without escalation.",
            "datasets": ["test.balanced_accuracy", "test.coverage"],
        },
        {
            "id": "primitive-discrimination",
            "schema_version": "xtrm-research-chart-spec/v1",
            "title": "Primitive discrimination by arm",
            "description": "Ranking AUC of each primitive's P(yes) against the ready label. Calibration is the next chart; Brier is in the run metrics.",
            "datasets": [f"{name}_auc" for name in policy_module.NOUL_FEATURES],
        },
        {
            "id": "primitive-calibration",
            "schema_version": "xtrm-research-chart-spec/v1",
            "title": "Primitive calibration by arm",
            "description": "Expected calibration error of each primitive's P(yes) in ten equal-width bins.",
            "datasets": [f"{name}_ece" for name in policy_module.NOUL_FEATURES],
        },
    ],
}

#: Cluster unit for every interval: one work item (all its revisions) is one
#: cluster, because revisions of one issue are not independent.
CLUSTER_KEY = "issue_id"


# --- workflows --------------------------------------------------------------


class _RecordingWorkflow(Workflow):
    """Collects primitive answers; composition happens offline so that
    thresholds are fitted on the training partition before any decision is
    made, and so the same answers can be replayed for every arm."""

    battery: dict[str, dict[str, Any]] = {}

    def questions(self, state: dict[str, Any]) -> dict[str, dict[str, Any]]:
        return self.battery

    def policy(self, state: dict[str, Any], answers: dict[str, Any]) -> dict[str, Any]:
        return {"action": "answers_recorded"}


class AtomicWorkflow(_RecordingWorkflow):
    battery = questions_module.atomic_battery()


class HolisticWorkflow(_RecordingWorkflow):
    battery = questions_module.holistic_battery()


# --- collection -------------------------------------------------------------


def load_units(dataset_dir: Path = DATASET_DIR) -> list[dict[str, Any]]:
    path = dataset_dir / "units.jsonl"
    return [
        json.loads(line)
        for line in path.read_text(encoding="utf-8").splitlines()
        if line
    ]


def _answers_path(kind: str) -> Path:
    return ANSWERS_DIR / f"{kind}.jsonl"


def load_answers(path: Path) -> dict[str, dict[str, Any]]:
    if not path.is_file():
        return {}
    out: dict[str, dict[str, Any]] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        out.setdefault(row["unit_id"], row)
    return out


def collect(
    kind: str,
    units: Sequence[dict[str, Any]],
    *,
    workers: int = 6,
    cache_path: Path | None = None,
) -> dict[str, Any]:
    """One System One request per unit, appended to an answers file so an
    interrupted run resumes without re-paying for answered units."""
    path = _answers_path(kind)
    path.parent.mkdir(parents=True, exist_ok=True)
    done = load_answers(path)
    todo = [u for u in units if u["unit_id"] not in done]
    # The battery is chosen by the *answers* bucket, not by its name: the
    # mutation bucket also carries the atomic battery, and picking the wrong
    # workflow there would silently answer the holistic question instead.
    workflow = HolisticWorkflow if kind == "holistic" else AtomicWorkflow
    cache = ResponseCache(cache_path or (ANSWERS_DIR / f"{kind}-cache.jsonl"))
    started = datetime.now(timezone.utc)

    def one(unit: dict[str, Any]) -> dict[str, Any]:
        wf = workflow(cache)
        state = questions_module.state_of(unit)
        records = wf.run_episode(unit["unit_id"], state)
        call = next((r for r in records if r["kind"] == "system_one_call"), None)
        row: dict[str, Any] = {
            "unit_id": unit["unit_id"],
            "issue_id": unit["issue_id"],
            "partition": unit["split"]["partition"],
            "label": unit["research_label"]["value"],
            "status": "answered" if call else "no_answer",
        }
        if call:
            row["answers"] = call["data"]["answers"]
            row["cached"] = call["data"]["cached"]
            row["request_id"] = call["data"].get("request_id")
            row["model_version"] = call["data"].get("model_version")
            row["state_hash"] = call["data"].get("state_hash")
            usage = call.get("usage") or {}
            row["usage"] = {
                "input_tokens": usage.get("gen_ai.usage.input_tokens"),
                "output_tokens": usage.get("gen_ai.usage.output_tokens"),
                "latency_ms": usage.get("latency_ms"),
                "cost": call["data"].get("cost"),
            }
        else:
            row["records"] = records
        return row

    with (
        path.open("a", encoding="utf-8") as handle,
        ThreadPoolExecutor(max_workers=workers) as pool,
    ):
        for row in pool.map(one, todo):
            handle.write(json.dumps(row, sort_keys=True, ensure_ascii=False) + "\n")
            handle.flush()
    answered = load_answers(path)
    return {
        "kind": kind,
        "requested": len(units),
        "new": len(todo),
        "answered_total": len(answered),
        "started_at": started.isoformat(),
        "finished_at": datetime.now(timezone.utc).isoformat(),
        "cost_usd": _total_cost(answered),
    }


def _total_cost(answers: dict[str, dict[str, Any]]) -> float:
    total = 0.0
    for row in answers.values():
        cost = (row.get("usage") or {}).get("cost") or {}
        if isinstance(cost, dict) and isinstance(cost.get("value"), (int, float)):
            total += float(cost["value"])
    return total


# --- evaluation -------------------------------------------------------------


def labelled_units(units: Sequence[dict[str, Any]]) -> list[dict[str, Any]]:
    """The primary population: structurally valid units with an independent
    label. The easy structurally-invalid pool is excluded by construction, so
    the incumbent deterministic channel cannot answer the question for free."""
    return [
        u
        for u in units
        if u["deterministic"]["structurally_valid"]
        and u["research_label"]["value"] in ("ready", "not_ready")
    ]


def truth_of(units: Sequence[dict[str, Any]]) -> dict[str, int]:
    return {
        u["unit_id"]: 1 if u["research_label"]["value"] == "ready" else 0 for u in units
    }


def arms_from_answers(
    units: Sequence[dict[str, Any]],
    atomic: dict[str, dict[str, Any]],
    holistic: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    """Fit every threshold on train/calibration, then evaluate every arm.

    A unit with no recorded answer (refused by a guard) is excluded from
    *fitting* — there is nothing to fit to — but stays in evaluation, where the
    explicit policy resolves it to REVIEW rather than pretending it was judged.
    """

    def answered(unit: dict[str, Any], source: dict[str, dict[str, Any]]) -> bool:
        return "answers" in (source.get(unit["unit_id"]) or {})

    train = [
        u for u in units if u["split"]["partition"] == "train" and answered(u, atomic)
    ]
    calibration = [
        u
        for u in units
        if u["split"]["partition"] == "calibration" and answered(u, atomic)
    ]
    test = [u for u in units if u["split"]["partition"] == "test"]
    holdout = [u for u in units if u["split"]["partition"] == "repo_holdout"]

    train_atomic = {u["unit_id"]: atomic[u["unit_id"]]["answers"] for u in train}
    train_truth = truth_of(train)
    thresholds, threshold_detail = calibrate_thresholds(
        train, train_atomic, train_truth
    )

    holistic_train = {
        u["unit_id"]: holistic[u["unit_id"]]["answers"]
        for u in train
        if answered(u, holistic)
    }
    holistic_threshold, holistic_detail = calibrate_holistic_threshold(
        [u for u in train if u["unit_id"] in holistic_train],
        holistic_train,
        train_truth,
    )
    thresholds = Thresholds(
        thresholds.mandatory_false_below,
        thresholds.mandatory_true_above,
        thresholds.open_decision_above,
        thresholds.self_blocked_above,
        thresholds.missing_context_above,
        thresholds.micromanages_above,
        holistic_threshold,
    )

    # The learned composition is fitted on train and its threshold calibrated
    # on the calibration partition — never on test.
    learned, learned_detail = fit_learned_composition(train, train_atomic, train_truth)
    if calibration:
        calibration_atomic = {
            u["unit_id"]: atomic[u["unit_id"]]["answers"] for u in calibration
        }
        learned, calibration_detail = _recalibrate_on(
            learned, calibration, calibration_atomic, truth_of(calibration)
        )
        learned_detail["calibration"] = calibration_detail
    learned_detail["fit_note"] = (
        "units with no recorded answer (guard refusal) are excluded from fitting and "
        "remain in evaluation, where the explicit policy resolves them to REVIEW"
    )

    decisions: dict[str, dict[str, dict[str, Any]]] = {
        arm: {}
        for arm in (
            "holistic",
            "deterministic-only",
            "atomic-explicit-policy",
            "atomic-learned-composition",
        )
    }
    for unit in units:
        uid = unit["unit_id"]
        findings = unit["deterministic"]["structural_findings"]
        answers = atomic.get(uid, {}).get("answers") or {}
        decisions["holistic"][uid] = (
            holistic_policy(
                answers_of(holistic.get(uid, {}).get("answers") or {}), thresholds
            )
            if uid in holistic
            else {
                "decision": "REVIEW",
                "reasons": ["no holistic answer"],
                "uncertain": [],
                "stage": "missing",
            }
        )
        decisions["deterministic-only"][uid] = deterministic_only_policy(findings)
        decisions["atomic-explicit-policy"][uid] = explicit_policy(
            findings, answers_of(answers), thresholds
        )
        decisions["atomic-learned-composition"][uid] = learned.policy(findings, answers)

    return {
        "thresholds": thresholds,
        "threshold_detail": threshold_detail,
        "holistic_detail": holistic_detail,
        "learned": learned,
        "learned_detail": learned_detail,
        "decisions": decisions,
        "partitions": {
            "train": train,
            "calibration": calibration,
            "test": test,
            "repo_holdout": holdout,
        },
    }


def _recalibrate_on(
    learned: LearnedComposition,
    units: Sequence[dict[str, Any]],
    answers: dict[str, dict[str, Any]],
    truth: dict[str, int],
) -> tuple[LearnedComposition, dict[str, Any]]:
    best = None
    probabilities = []
    for unit in units:
        probabilities.append(
            learned.probability(
                unit["deterministic"]["structural_findings"], answers[unit["unit_id"]]
            )
        )
    labels = [truth[u["unit_id"]] for u in units]
    for candidate in [i / 100 for i in range(5, 96)]:
        predicted = [1 if p >= candidate else 0 for p in probabilities]
        score = policy_module.balanced_accuracy(labels, predicted)
        if math.isnan(score):
            continue
        false_ready = sum(1 for o, p in zip(labels, predicted) if o == 0 and p == 1)
        key = (score, -false_ready)
        if best is None or key > (best[0], best[1]):
            best = (score, -false_ready, candidate)
    if best is None:
        return learned, {"calibration_available": False}
    return (
        LearnedComposition(learned.weights, best[2]),
        {
            "calibration_available": True,
            "calibration_balanced_accuracy_at_threshold": best[0],
            "calibration_false_ready_count": -best[1],
            "threshold": best[2],
        },
    )


def _blocks(units: Sequence[dict[str, Any]]) -> list[list[int]]:
    """Cluster indices by work item, so resampling respects the clustering."""
    groups: dict[str, list[int]] = {}
    for i, unit in enumerate(units):
        groups.setdefault(unit[CLUSTER_KEY], []).append(i)
    return list(groups.values())


def _bootstrap_ci(
    units: Sequence[dict[str, Any]],
    statistics_fn,
    *,
    resamples: int = 2000,
    seed: int = 20260919,
) -> dict[str, Any]:
    """Percentile interval over cluster resamples (never over units)."""
    clusters = _blocks(units)
    indices = resample_indices(len(clusters), resamples, seed)
    draws: list[float | None] = []
    for draw in indices:
        picked = [i for c in draw for i in clusters[c]]
        value = statistics_fn(picked)
        draws.append(value)
    defined = sorted(d for d in draws if d is not None)
    point = statistics_fn(list(range(len(units))))
    if not defined or len(defined) < 0.95 * len(draws):
        return {
            "value": point,
            "ci95": None,
            "method": f"cluster percentile bootstrap, {resamples} resamples, seed {seed}, insufficient defined resamples",
        }
    low = defined[int(0.025 * len(defined))]
    high = defined[min(int(0.975 * len(defined)), len(defined) - 1)]
    return {
        "value": point,
        "ci95": [low, high],
        "method": f"cluster percentile bootstrap over {len(clusters)} work items, {resamples} resamples, seed {seed}",
    }


def arm_metrics(
    units: Sequence[dict[str, Any]],
    arm: str,
    decisions: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    """Decision metrics for one arm over one population, with intervals."""
    truth = [1 if u["research_label"]["value"] == "ready" else 0 for u in units]
    predicted = [
        1 if decisions[u["unit_id"]]["decision"] == "READY" else 0 for u in units
    ]
    base = classification_metrics(truth, predicted)

    def _stat(fn):
        return lambda picked: fn(
            [truth[i] for i in picked], [predicted[i] for i in picked]
        )

    out: dict[str, Any] = {
        "n": base["n"],
        "positives": base["positives"],
        "negatives": base["negatives"],
        "confusion": {
            k: base[k]
            for k in (
                "true_positive",
                "true_negative",
                "false_positive",
                "false_negative",
            )
        },
    }
    for name, value in (
        ("false_ready_rate", base["false_ready_rate"]),
        ("false_draft_rate", base["false_draft_rate"]),
        ("precision", base["precision"]),
        ("recall", base["recall"]),
        ("accuracy", base["accuracy"]),
        ("balanced_accuracy", base["balanced_accuracy"]),
    ):
        if value is None:
            out[name] = {
                "value": None,
                "ci95": None,
                "method": "undefined on this population",
            }
            continue
        if name in (
            "false_ready_rate",
            "false_draft_rate",
            "precision",
            "recall",
            "accuracy",
        ):
            count = {
                "false_ready_rate": base["false_positive"],
                "false_draft_rate": base["false_negative"],
                "precision": base["true_positive"],
                "recall": base["true_positive"],
                "accuracy": base["true_positive"] + base["true_negative"],
            }[name]
            denominator = {
                "false_ready_rate": base["negatives"],
                "false_draft_rate": base["positives"],
                "precision": base["true_positive"] + base["false_positive"],
                "recall": base["positives"],
                "accuracy": base["n"],
            }[name]
            interval = wilson(count, denominator)
            out[name] = {
                "value": value,
                "ci95": interval,
                "method": f"Wilson 95% interval for {count}/{denominator}",
            }
        else:
            out[name] = _bootstrap_ci(
                units, _stat(lambda t, p: policy_module.balanced_accuracy(t, p))
            )
    out["coverage"] = {
        "value": sum(
            1 for u in units if decisions[u["unit_id"]]["decision"] != "REVIEW"
        )
        / len(units)
        if units
        else None,
        "ci95": None,
        "method": "share of units the policy resolves without REVIEW",
    }
    return out


def paired_false_ready_delta(
    units: Sequence[dict[str, Any]],
    left: dict[str, dict[str, Any]],
    right: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    """Paired false-READY difference (left minus right) over the same units."""

    def _rate(decisions, picked) -> float | None:
        negatives = [
            i for i in picked if units[i]["research_label"]["value"] == "not_ready"
        ]
        if not negatives:
            return None
        return sum(
            1
            for i in negatives
            if decisions[units[i]["unit_id"]]["decision"] == "READY"
        ) / len(negatives)

    def _diff(picked) -> float | None:
        a, b = _rate(left, picked), _rate(right, picked)
        if a is None or b is None:
            return None
        return a - b

    result = _bootstrap_ci(units, _diff)
    result["method"] = (
        "paired cluster percentile bootstrap of (false-READY rate difference); "
        + str(result["method"])
    )
    return result


def primitive_metrics(
    units: Sequence[dict[str, Any]],
    atomic: dict[str, dict[str, Any]],
    primitive_names: Iterable[str],
) -> dict[str, Any]:
    """Per-primitive discrimination and calibration against the ready label,
    with cluster-bootstrap intervals."""
    truth = [1 if u["research_label"]["value"] == "ready" else 0 for u in units]
    out: dict[str, Any] = {}
    for name in primitive_names:
        scores = [
            float(
                (atomic.get(u["unit_id"], {}).get("answers") or {})
                .get(name, {})
                .get("noul", 0.5)
            )
            for u in units
        ]

        def _stat(fn):
            return lambda picked: fn(
                [truth[i] for i in picked], [scores[i] for i in picked]
            )

        out[f"{name}.auc"] = _bootstrap_ci(units, _stat(auc))
        out[f"{name}.brier"] = _bootstrap_ci(units, _stat(brier))
        out[f"{name}.ece"] = _bootstrap_ci(units, _stat(lambda t, s: ece(t, s, 10)))
        out[f"{name}.mean_p"] = {
            "value": statistics.fmean(scores) if scores else None,
            "ci95": None,
            "method": "arithmetic mean of the primitive's P(yes) over this population",
        }
    return out


def metric_rows(prefix: str, metrics: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Flatten an arm's metric bundle into assessment-set metric rows, dropping
    entries whose value is not established."""
    rows: dict[str, dict[str, Any]] = {}
    for name, entry in metrics.items():
        if not isinstance(entry, dict) or "value" not in entry:
            continue
        value = entry.get("value")
        if not isinstance(value, (int, float)):
            continue
        rows[f"{prefix}.{name}"] = publish.metric(
            float(value),
            entry.get("ci95"),
            int(entry.get("n") or metrics.get("n") or 0),
            str(entry.get("method") or "unspecified"),
        )
    return {k: v for k, v in rows.items() if v is not None}


# --- adversarial mutations --------------------------------------------------

#: Primitives the mutation suite never expects to move. Used only to report
#: unexplained movement; it is not a pass/fail gate on its own.
STABILITY_WATCH = (
    "problem_actionable",
    "success_observable",
    "scope_bounded",
    "non_goals_effective",
    "constraints_actionable",
    "validation_proves_success",
    "output_unambiguous",
    "open_decision",
    "depends_on_missing_context",
    "micromanages_implementation",
    "self_blocked",
)


def evaluate_mutations(
    mutation_rows: Sequence[dict[str, Any]],
    original_answers: dict[str, dict[str, Any]],
    mutated_answers: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    """Paired primitive movement per mutation class, with a cluster bootstrap
    over the mutated contracts (one contract is one cluster)."""
    classes = sorted({row["mutation_class"] for row in mutation_rows})
    per_class: dict[str, Any] = {}
    intended_ok_count = 0
    declared_checks = 0
    membership: dict[str, list[dict[str, Any]]] = {c: [] for c in classes}
    for row in mutation_rows:
        membership[row["mutation_class"]].append(row)

    for name in classes:
        rows = membership[name]
        pairs: list[tuple[dict[str, float], dict[str, float]]] = []
        for row in rows:
            before = answers_of(
                (original_answers.get(row["unit_id"]) or {}).get("answers") or {}
            )
            after = answers_of(
                (mutated_answers.get(row["mutation_id"]) or {}).get("answers") or {}
            )
            if before and after:
                pairs.append((before, after))
        stats: dict[str, Any] = {"n_pairs": len(pairs)}
        for primitive in STABILITY_WATCH:
            deltas = [
                after.get(primitive, 0.0) - before.get(primitive, 0.0)
                for before, after in pairs
            ]
            if not deltas:
                continue
            resamples = 2000
            rng = random.Random(20260919)
            draws = []
            for _ in range(resamples):
                sample = [deltas[rng.randrange(len(deltas))] for _ in deltas]
                draws.append(statistics.fmean(sample))
            draws.sort()
            low = draws[int(0.025 * len(draws))]
            high = draws[min(int(0.975 * len(draws)), len(draws) - 1)]
            stats[primitive] = {
                "mean_delta": statistics.fmean(deltas),
                "ci95": [low, high],
                "method": f"percentile bootstrap over {len(deltas)} mutated contracts, {resamples} resamples, seed 20260919",
            }
        expected = rows[0]["expected_affected"]
        checks = []
        for primitive, direction in expected.items():
            entry = stats.get(primitive)
            if not entry:
                checks.append(
                    {
                        "primitive": primitive,
                        "direction": direction,
                        "ok": False,
                        "reason": "no paired answers",
                    }
                )
                continue
            moved = entry["mean_delta"]
            excludes_zero = entry["ci95"][0] > 0 or entry["ci95"][1] < 0
            sign_ok = (moved > 0) if direction == "up" else (moved < 0)
            material = abs(moved) >= mutations_module.MATERIAL_MOVEMENT
            checks.append(
                {
                    "primitive": primitive,
                    "direction": direction,
                    "mean_delta": moved,
                    "ci95": entry["ci95"],
                    "materiality_threshold": mutations_module.MATERIAL_MOVEMENT,
                    "sign_ok": sign_ok,
                    "interval_excludes_zero": excludes_zero,
                    "materially_moved": material,
                    "ok": bool(sign_ok and excludes_zero and material),
                }
            )
        declared_checks += len(checks)
        intended_ok_count += sum(1 for c in checks if c["ok"])
        unintended = {
            primitive: entry
            for primitive, entry in stats.items()
            if isinstance(entry, dict) and primitive not in expected
        }
        declared_magnitude = max(
            (abs(c.get("mean_delta") or 0.0) for c in checks), default=0.0
        )
        unexplained = sorted(
            primitive
            for primitive, entry in unintended.items()
            if abs(entry["mean_delta"]) > declared_magnitude
        )
        all_ok = bool(checks) and all(c["ok"] for c in checks)
        if all_ok:
            stats["ok_count"] = len(checks)
        per_class[name] = {
            "changed_invariant": rows[0].get("changed_invariant", ""),
            "expected_policy_consequence": rows[0].get(
                "expected_policy_consequence", ""
            ),
            "structurally_valid_after": sum(
                1 for r in rows if r.get("structurally_valid_after")
            ),
            "primitives": stats,
            "checks": checks,
            "class_ok": all_ok,
            "unexplained_movement": unexplained,
            "declared_magnitude": declared_magnitude,
        }

    share = intended_ok_count / declared_checks if declared_checks else None
    return {
        "classes": per_class,
        "n_classes": len(classes),
        "n_checks": declared_checks,
        "n_checks_ok": intended_ok_count,
        "share_checks_ok": share,
        "classes_ok": sum(1 for c in per_class.values() if c["class_ok"]),
        "unexplained_total": sum(
            len(c["unexplained_movement"]) for c in per_class.values()
        ),
    }


def mutation_metrics(evaluation: dict[str, Any]) -> dict[str, dict[str, Any] | None]:
    rows: dict[str, dict[str, Any] | None] = {}
    for name, klass in evaluation["classes"].items():
        for check in klass["checks"]:
            primitive = check["primitive"]
            entry = klass["primitives"].get(primitive)
            label = f"mutation_{name}_{primitive}_delta_p"
            if entry:
                rows[label] = publish.metric(
                    float(entry["mean_delta"]),
                    entry["ci95"],
                    int(klass["primitives"]["n_pairs"]),
                    entry["method"]
                    + f"; declared direction {check['direction']}; "
                    + (
                        "interval excludes zero"
                        if check["interval_excludes_zero"]
                        else "interval contains zero"
                    )
                    + f"; materiality threshold {check['materiality_threshold']} "
                    + ("met" if check["materially_moved"] else "not met"),
                )
        rows[f"mutation_{name}_intended_direction_ok"] = publish.metric(
            float(sum(1 for c in klass["checks"] if c["ok"])),
            None,
            len(klass["checks"]),
            "declared primitives that moved in the declared direction with an interval excluding zero (count)",
        )
    share = evaluation.get("share_checks_ok")
    if share is not None:
        rows["mutation_intended_direction_ok"] = publish.metric(
            float(share),
            None,
            evaluation["n_checks"],
            "share of declared primitive checks that moved as declared, interval excluding zero",
        )
    rows["mutation_classes_ok"] = publish.metric(
        float(evaluation["classes_ok"]),
        None,
        evaluation["n_classes"],
        "mutation classes in which every declared primitive moved as declared (count)",
    )
    rows["mutation_unexplained_movement"] = publish.metric(
        float(evaluation["unexplained_total"]),
        None,
        evaluation["n_classes"],
        "count of primitives that moved further than the declared primitive without being declared (count)",
    )
    return rows


# --- arm D: bounded reasoning-model escalation -------------------------------

#: Escalation model. The pre-registration named `claude-sonnet-5`; the
#: operator's allowlist ($XTRM_RESEARCH_ALLOWED_MODELS) does not include it, so
#: the authorized reasoning model is used instead and the substitution is
#: recorded as a deviation in the run manifest and the report. No pre-registered
#: *criterion* changed: the escalation arm's role, budget and decision rule are
#: exactly as frozen.
ESCALATION_MODEL = "commandcode/deepseek/deepseek-v4.1-flash"
ESCALATION_TRANSPORT = "pi_complete"
ESCALATION_TRANSPORT_NAME = "pi (context-isolated completion)"
ESCALATION_SYSTEM = (
    "You are deciding whether one engineering work contract is ready to dispatch, using the supplied "
    "Ready-contract standard. You are consulted only because an atomic screening battery found the case "
    "genuinely uncertain. Answer with the schema only. Judge the contract as written; do not assume "
    "context that is not in it."
)
ESCALATION_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "ready": {"type": "boolean"},
        "weakest_mandatory_section": {
            "type": "string",
            "enum": [
                "none",
                "problem",
                "success",
                "scope",
                "non_goals",
                "constraints",
                "validation",
                "output",
            ],
        },
        "rationale": {"type": "string"},
    },
    "required": ["ready", "weakest_mandatory_section", "rationale"],
    "additionalProperties": False,
}
ESCALATION_SYSTEM_TEXT = (
    ESCALATION_SYSTEM
    + "\n\nReply with ONLY a JSON object, no prose, no code fence, matching this JSON Schema: "
    + json.dumps(ESCALATION_SCHEMA)
)
ESCALATION_PROMPT = """\
{standard}

CONTRACT UNDER REVIEW
{contract_text}

EVIDENCE FROM THE ATOMIC SCREENING (uncertain primitives only)
{uncertain}

Decide whether this contract is READY to dispatch as written."""


def escalation_candidates(
    units: Sequence[dict[str, Any]],
    decisions: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    """Only genuine uncertainty escalates: the policy reached REVIEW, or a
    mandatory predicate sat inside the uncertainty band."""
    return [
        u
        for u in units
        if decisions.get(u["unit_id"], {}).get("decision") == "REVIEW"
        or decisions.get(u["unit_id"], {}).get("uncertain")
    ]


def escalate_units(
    units: Sequence[dict[str, Any]],
    decisions: dict[str, dict[str, Any]],
    *,
    max_calls: int = 80,
    path: Path | None = None,
) -> dict[str, Any]:
    """Ask the reasoning model only about units the atomic policy could not
    settle, inside an explicit call budget. Resumable: answered units are
    replayed from the file rather than re-paid."""
    from xtrm_research.guards import GuardFailure, guarded_send

    path = path or (ANSWERS_DIR / "escalations.jsonl")
    path.parent.mkdir(parents=True, exist_ok=True)
    existing = {}
    if path.is_file():
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.strip():
                row = json.loads(line)
                existing.setdefault(row["unit_id"], row)
    candidates = escalation_candidates(units, decisions)
    todo = [u for u in candidates if u["unit_id"] not in existing][
        : max(0, max_calls - len(existing))
    ]
    cost = 0.0
    with path.open("a", encoding="utf-8") as handle:
        for unit in todo:
            uncertain = {name: round(float(p), 3) for name, p in answers_of({}).items()}
            decision = decisions[unit["unit_id"]]
            uncertain = {
                name: decision.get("reasons", [])
                for name in (decision.get("uncertain") or [])
            }
            payload = {
                "model": ESCALATION_MODEL,
                "reason": "uncertainty_band",
                "system": ESCALATION_SYSTEM_TEXT,
                "prompt_template": ESCALATION_PROMPT,
                "input": {
                    "standard": questions_module.STANDARD,
                    "contract_text": _contract_text(unit),
                    "uncertain": json.dumps(uncertain, indent=1),
                },
            }
            row: dict[str, Any] = {"unit_id": unit["unit_id"], "status": "error"}
            try:
                response = guarded_send(payload, ESCALATION_TRANSPORT)
                out = _parse_escalation_reply(response.get("text"))
                usage = response.get("usage") or {}
                if out is None:
                    row = {
                        "unit_id": unit["unit_id"],
                        "status": "no_output",
                        "model": ESCALATION_MODEL,
                        "detail": (response.get("error") or "reply did not validate")[
                            :300
                        ],
                    }
                else:
                    row = {
                        "unit_id": unit["unit_id"],
                        "status": "answered",
                        "ready": bool(out.get("ready")),
                        "weakest_mandatory_section": out.get(
                            "weakest_mandatory_section"
                        ),
                        "rationale": (out.get("rationale") or "")[:600],
                        "model": ESCALATION_MODEL,
                        "cost_usd": usage.get("cost")
                        if isinstance(usage.get("cost"), (int, float))
                        else (usage.get("cost") or {}).get("total")
                        if isinstance(usage.get("cost"), dict)
                        else None,
                        "input_tokens": usage.get("input_tokens")
                        or usage.get("inputTokens"),
                        "output_tokens": usage.get("output_tokens")
                        or usage.get("outputTokens"),
                    }
                if isinstance(row.get("cost_usd"), (int, float)):
                    cost += float(row["cost_usd"])
            except GuardFailure as exc:
                row = {
                    "unit_id": unit["unit_id"],
                    "status": "guard_failure",
                    "detail": exc.guard,
                }
            except (
                Exception
            ) as exc:  # a refused budget is a recorded outcome, not a crash
                row = {
                    "unit_id": unit["unit_id"],
                    "status": "error",
                    "detail": f"{type(exc).__name__}: {exc}"[:300],
                }
            handle.write(json.dumps(row, sort_keys=True, ensure_ascii=False) + "\n")
            handle.flush()
    answered = {
        row["unit_id"]: row
        for row in (
            [
                json.loads(line)
                for line in path.read_text(encoding="utf-8").splitlines()
                if line.strip()
            ]
            if path.is_file()
            else []
        )
    }
    total_cost = sum(
        float(r["cost_usd"])
        for r in answered.values()
        if isinstance(r.get("cost_usd"), (int, float))
    )
    return {
        "candidates": len(candidates),
        "considered": len(candidates),
        "escalated": sum(1 for r in answered.values() if r.get("status") == "answered"),
        "rate": (len(answered) / len(candidates)) if candidates else 0.0,
        "cost_usd": total_cost,
        "rows": answered,
    }


def _parse_escalation_reply(text: str | None) -> dict[str, Any] | None:
    """The reply's JSON object if it validates against ESCALATION_SCHEMA, else
    None — a malformed reply is a recorded failure, never repaired."""
    if not text:
        return None
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        return None
    try:
        out = json.loads(match.group(0))
    except json.JSONDecodeError:
        return None
    if list(jsonschema.Draft202012Validator(ESCALATION_SCHEMA).iter_errors(out)):
        return None
    return out


def _contract_text(unit: dict[str, Any]) -> str:
    from xtrm_research.planning_ready import contracts as contracts_module

    return contracts_module.contract_text(unit["contract"])


def apply_escalations(
    decisions: dict[str, dict[str, Any]], rows: dict[str, dict[str, Any]]
) -> dict[str, dict[str, Any]]:
    """Arm D: the escalated decision supersedes the policy's REVIEW; every
    other unit keeps the explicit policy's decision."""
    out = {unit_id: dict(decision) for unit_id, decision in decisions.items()}
    for unit_id, row in rows.items():
        if row.get("status") != "answered":
            continue
        out[unit_id] = {
            "decision": "READY" if row.get("ready") else "DRAFT",
            "reasons": [
                f"escalated to {ESCALATION_MODEL}: {row.get('weakest_mandatory_section')}"
            ],
            "uncertain": [],
            "stage": "escalation",
        }
    return out


def mutation_pseudo_units(
    units: Sequence[dict[str, Any]], rows: Sequence[dict[str, Any]]
) -> list[dict[str, Any]]:
    """Mutation rows as units the collector can send.

    Only the contract changes: the ticket metadata (locator, kind, project,
    title) is taken from the unmutated unit, so a primitive's movement cannot
    come from a change of ticket rather than a change of invariant.
    """
    by_id = {u["unit_id"]: u for u in units}
    out: list[dict[str, Any]] = []
    for row in rows:
        original = by_id.get(row["unit_id"])
        if original is None:
            continue
        out.append(
            {
                **original,
                "unit_id": row["mutation_id"],
                "issue_id": row["mutation_id"],
                "partition_original": original["split"]["partition"],
                "contract": row["mutated_contract"],
                "deterministic": {
                    "structural_findings": [],
                    "structurally_valid": True,
                },
                "research_label": {
                    "value": "ready",
                    "source": "mutation",
                    "method": "strong contract, unchanged structure",
                    "confidence": "high",
                },
                "split": {
                    "partition": original["split"]["partition"],
                    "cluster_key": row["mutation_id"],
                    "cluster_bucket": 0,
                },
            }
        )
    return out
