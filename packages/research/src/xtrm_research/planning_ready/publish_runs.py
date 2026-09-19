"""Publish the Planning Ready-contract campaign as app-visible runs.

One run per arm (plus the raw battery run and the mutation run). Every run
carries: the frozen definitions it references, one sample per contract, the
System One / policy / escalation records as separate events, the metrics with
their intervals and methods, and — for the arms that make a claim — a
structured ``result_summary`` annotation whose prose is generated from the
actual measured numbers, never templated into an unsupported claim.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Iterable, Sequence

from xtrm_research import publish
from xtrm_research.planning_ready import campaign
from xtrm_research.planning_ready import policy as policy_module
from xtrm_research.planning_ready import questions as questions_module
from xtrm_research.telemetry import usage_record

PRICE_TABLE_VERSION = json.loads(
    (Path(__file__).resolve().parents[1] / "evidence_gate" / "prices.json").read_text(
        encoding="utf-8"
    )
)["version"]

ACCOUNTING = {
    "price_table_version": PRICE_TABLE_VERSION,
    "telemetry_schema_version": "xtrm-research-telemetry/v1",
    "otel_semconv_ref": "gen_ai/v1.28",
}

BACKEND = {"provider": "TypeSafe", "model": "jev-latest", "model_version": "jev-1.13.0"}

EVALUATOR_ID = "planning-ready-policy"
DATASET_ID = "planning-ready-v2"

#: Run id per arm, and the variant definition id it references.
ARM_RUNS = {
    "holistic": ("planning-ready-v2-holistic", "holistic"),
    "deterministic-only": (
        "planning-ready-v2-deterministic-only",
        "deterministic-only",
    ),
    "atomic-explicit-policy": (
        "planning-ready-v2-atomic-explicit",
        "atomic-explicit-policy",
    ),
    "atomic-learned-composition": (
        "planning-ready-v2-learned",
        "atomic-learned-composition",
    ),
    "atomic-policy-escalation": (
        "planning-ready-v2-escalation",
        "atomic-policy-escalation",
    ),
}

ARM_DESCRIPTIONS = {
    "holistic": "One holistic System One judgment: could a fresh worker execute this contract from its text alone?",
    "deterministic-only": "Structure checks only, no semantic judgment: the incumbent's deterministic channel.",
    "atomic-explicit-policy": "Eleven atomic Noul judgments plus one Choice, composed by the frozen non-compensatory policy.",
    "atomic-learned-composition": "The same primitive answers composed by a calibrated learned classifier, enforcing no invariant.",
    "atomic-policy-escalation": "The explicit policy, with genuine uncertainty escalated to a reasoning model inside a bounded budget.",
    "jev-battery": "The System One battery answers themselves: one request per contract revision carrying the whole battery.",
    "mutation-suite": "Controlled single-invariant mutations of strong contracts, with expectations declared before the calls.",
}


def definitions(
    registry_root: Path, dataset_hash: str, dataset_dir: Path
) -> dict[str, Any]:
    """Register (write-once) every definition this campaign's runs reference."""
    reg = Path(registry_root)
    specs = questions_module.question_specs(
        questions_module.atomic_battery(), "planning-ready"
    )
    specs.update(
        questions_module.question_specs(
            questions_module.holistic_battery(), "planning-ready-holistic"
        )
    )
    registered_specs = [
        publish.register(reg, "question_spec", body) for body in specs.values()
    ]
    metric_names = list(campaign.EXPERIMENT["named_datasets"])
    workload = publish.register(
        reg,
        "workload",
        {
            "id": "planning-ready",
            "version": "v1",
            "description": (
                "Planning work-contract readiness: whether a contract revision is dispatchable, which "
                "readiness predicate is weak, what executing it requires, and whether it is blocked or "
                "leaves a decision open."
            ),
            "sample_provider": "xtrm_research.planning_ready.dataset (frozen Substrate snapshot)",
            "runner_kind": "system_one",
            "required_capabilities": ["text_compare", "repository_read"],
            "input_schema": {
                "type": "object",
                "required": ["locator", "contract", "ready_contract_standard"],
            },
            "output_schema": {"type": "object"},
            "state_builder": "xtrm_research.planning_ready.questions.state_of",
            "questions": [
                {"id": s["id"], "version": s["version"]} for s in registered_specs
            ],
            "observers": [],
            "evaluators": [{"id": EVALUATOR_ID, "version": "v1"}],
            "default_metrics": metric_names,
            "legend": {
                **{
                    s["id"]: (
                        s["instructions"]
                        if isinstance(s["instructions"], str)
                        else s["id"]
                    )
                    for s in registered_specs
                },
                **{m: m.replace("_", " ") for m in metric_names},
            },
        },
    )
    evaluator = publish.register(
        reg,
        "evaluator",
        {
            "id": EVALUATOR_ID,
            "version": "v1",
            "kind": "statistical",
            "config": {
                "population": "structurally valid units with an independent label",
                "cluster_unit": "work item (issue lineage)",
                "bootstrap": "cluster percentile, 2000 resamples, seed 20260919",
                "proportion_intervals": "Wilson 95%",
                "thresholds_fitted_on": "train partition only",
            },
            "code_revision": "xtrm_research.planning_ready.policy",
        },
    )
    variants = {}
    for arm, description in ARM_DESCRIPTIONS.items():
        variants[arm] = publish.register(
            reg,
            "variant",
            {
                "id": f"planning-ready-{arm}",
                "version": "v1",
                "description": description,
                "config": {"arm": arm},
            },
        )
    dataset = publish.register(
        reg,
        "dataset",
        {
            "id": DATASET_ID,
            "version": "v1",
            "description": (
                "Frozen Substrate board snapshot: every unit is one (issue, revision) contract pair from the "
                "five XTRM development repositories, with the incumbent state, observed outcome and research "
                "label recorded as separate channels and a frozen lineage-grouped split."
            ),
            "source": f"{dataset_dir} (units {dataset_hash})",
        },
    )
    experiment_payload = dict(campaign.EXPERIMENT)
    experiment_payload["variants"] = [
        {"id": v["id"], "version": v["version"]} for v in variants.values()
    ]
    # The legend must name every registered variant id (the registry enforces
    # completeness), so the arm descriptions are added under their full ids.
    experiment_payload["legend"] = {
        **campaign.EXPERIMENT["legend"],
        **{
            variants[arm]["id"]: description
            for arm, description in ARM_DESCRIPTIONS.items()
        },
    }
    experiment = publish.register(reg, "experiment", experiment_payload)
    return {
        "specs": registered_specs,
        "workload": workload,
        "evaluator": evaluator,
        "variants": variants,
        "dataset": dataset,
        "experiment": experiment,
    }


def _fmt(entry: dict[str, Any] | None) -> str:
    if not entry or entry.get("value") is None:
        return "not established"
    value = entry["value"]
    interval = entry.get("ci95")
    if interval:
        return f"{value:.3f} [{interval[0]:.3f}, {interval[1]:.3f}]"
    return f"{value:.3f}"


def _metric_row(
    name: str, entry: dict[str, Any] | None, n: int, *, method: str | None = None
) -> dict[str, Any] | None:
    if not entry or entry.get("value") is None:
        return None
    return publish.metric(
        float(entry["value"]),
        entry.get("ci95"),
        int(entry.get("n") or n),
        method or str(entry.get("method") or "unspecified"),
    )


def arm_metrics_for_run(
    arm: str,
    units: Sequence[dict[str, Any]],
    decisions: dict[str, dict[str, Any]],
    holistic_decisions: dict[str, dict[str, Any]] | None = None,
) -> dict[str, dict[str, Any] | None]:
    """The metrics one arm's run publishes, namespaced by partition.

    ``test`` is the pre-registered held-out partition and carries the headline;
    ``pooled`` merges train+calibration+test for context and ``holdout`` is the
    whole-repository stability check.
    """
    by_partition = {
        "test": [u for u in units if u["split"]["partition"] == "test"],
        "pooled": [u for u in units if u["split"]["partition"] != "repo_holdout"],
        "holdout": [u for u in units if u["split"]["partition"] == "repo_holdout"],
    }
    out: dict[str, dict[str, Any] | None] = {}
    for label, population in by_partition.items():
        if not population:
            continue
        metrics = campaign.arm_metrics(population, arm, decisions)
        for name in (
            "false_ready_rate",
            "false_draft_rate",
            "precision",
            "recall",
            "accuracy",
            "balanced_accuracy",
            "coverage",
        ):
            out[f"{label}.{name}"] = _metric_row(name, metrics.get(name), metrics["n"])
        out[f"{label}.n"] = publish.metric(
            float(metrics["n"]), None, metrics["n"], "unit count on this population"
        )
        # Positive and negative counts, so a reader can see the class balance.
        out[f"{label}.positives"] = publish.metric(
            float(metrics["positives"]),
            None,
            metrics["n"],
            "independently labelled ready units",
        )
        out[f"{label}.negatives"] = publish.metric(
            float(metrics["negatives"]),
            None,
            metrics["n"],
            "independently labelled not-ready units",
        )
        if holistic_decisions is not None and arm != "holistic":
            delta = campaign.paired_false_ready_delta(
                population, decisions, holistic_decisions
            )
            out[f"{label}.false_ready_rate_delta_vs_holistic"] = _metric_row(
                "false_ready_rate_delta_vs_holistic", delta, metrics["n"]
            )
    return out


def primitive_metrics_for_run(
    units: Sequence[dict[str, Any]],
    atomic: dict[str, dict[str, Any]],
    *,
    partition: str = "pooled",
) -> dict[str, dict[str, Any] | None]:
    population = [
        u
        for u in units
        if (u["split"]["partition"] != "repo_holdout") == (partition == "pooled")
    ]
    rows = campaign.primitive_metrics(population, atomic, policy_module.NOUL_FEATURES)
    out: dict[str, dict[str, Any] | None] = {}
    for key, entry in rows.items():
        name = key.replace(".", "_")
        method = {
            "auc": "rank AUC (Mann-Whitney, ties half) against the ready label",
            "brier": "mean squared error against the ready label",
            "ece": "expected calibration error, ten equal-width bins",
            "mean_p": "mean P(yes) over the population",
        }[key.split(".")[-1]]
        out[name] = _metric_row(name, entry, len(population), method=method)
    return out


def _refused(answers: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    """Answer rows with no answer: the guard refused this unit, so its text was
    never sent and must not be published raw."""
    return [row for row in answers.values() if "answers" not in row]


def battery_samples(
    units: Sequence[dict[str, Any]],
    refused_ids: Iterable[str] = (),
) -> list[dict[str, Any]]:
    """One published sample per unit.

    A unit the send-guard refused never had its contract text sent, so its raw
    text must not be published either: the guard's own redaction is applied to
    the published contract (and the sample is marked), so a run artifact can
    never carry text the guard would strip. The unredacted text stays only in
    the local dataset directory (mode 700, outside git).
    """
    from xtrm_research.guards import redact as _redact_text

    def _redact_value(value: Any) -> Any:
        """Redact every string leaf, keeping the structure (and its shape)
        intact: a round-trip through JSON text would make the published value
        a string, and a redaction token is not guaranteed to be JSON-safe."""
        if isinstance(value, str):
            return _redact_text(value)
        if isinstance(value, list):
            return [_redact_value(v) for v in value]
        if isinstance(value, dict):
            return {k: _redact_value(v) for k, v in value.items()}
        return value

    refused = set(refused_ids)
    rows: list[dict[str, Any]] = []
    for u in units:
        contract = u["contract"]
        status = "ok"
        if u["unit_id"] in refused:
            contract = _redact_value(contract)
            status = "refused_by_guard"
        rows.append(
            {
                "sample_id": u["unit_id"],
                "input": {
                    "locator": u["locator"],
                    "project": u["project_name"],
                    "revision": u["revision"],
                    "contract_hash": u["contract_hash"],
                    "contract": contract,
                    **(
                        {
                            "body_note": "contract text published in redacted form: the send-guard refused this unit"
                        }
                        if u["unit_id"] in refused
                        else {}
                    ),
                },
                "output": {
                    "label": u["research_label"]["value"],
                    "label_source": u["research_label"]["source"],
                    "incumbent": {
                        "attested_ready_this_revision": u["incumbent_state"][
                            "attested_ready_this_revision"
                        ],
                        "lifecycle_state": u["incumbent_state"][
                            "lifecycle_state_at_snapshot"
                        ],
                    },
                },
                "status": status,
            }
        )
    return rows


def battery_records(
    units: Sequence[dict[str, Any]], answers: dict[str, dict[str, Any]]
) -> list[dict[str, Any]]:
    """The recorded System One call, policy action and realized outcome for each
    unit — separate records, never one collapsed row."""
    records: list[dict[str, Any]] = []
    for unit in units:
        row = answers.get(unit["unit_id"])
        if not row or "answers" not in row:
            records.append(
                {
                    "kind": "guard_failure",
                    "sample_id": unit["unit_id"],
                    "data": {"reason": (row or {}).get("status", "no_answer")},
                }
            )
            continue
        usage = row.get("usage") or {}
        records.append(
            {
                "kind": "system_one_call",
                "sample_id": unit["unit_id"],
                "data": {
                    "request_id": row.get("request_id"),
                    "model": "jev-latest",
                    "model_version": row.get("model_version"),
                    "state_hash": row.get("state_hash"),
                    "answers": row["answers"],
                    "cached": row.get("cached", False),
                    "cost": usage.get("cost"),
                },
                "usage": usage_record(
                    "provider_api",
                    input_tokens=usage.get("input_tokens"),
                    output_tokens=usage.get("output_tokens"),
                    request_model="jev-latest",
                    response_model=row.get("model_version"),
                    latency_ms=usage.get("latency_ms"),
                    null_reason="not_exposed_by_provider",
                    null_detail="TypeSafe returns no cost; cost is priced from the versioned price table",
                ),
            }
        )
        records.append(
            {
                "kind": "outcome",
                "sample_id": unit["unit_id"],
                "data": {
                    "research_label": unit[
                        "research_label"
                    ],  # source + method + confidence
                    "incumbent_state": unit["incumbent_state"],
                    "observed_outcome": unit["observed_outcome"],
                },
            }
        )
    return records


def arm_records(
    units: Sequence[dict[str, Any]],
    decisions: dict[str, dict[str, Any]],
    answers: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for unit in units:
        row = answers.get(unit["unit_id"])
        if not row or "answers" not in row:
            records.append(
                {
                    "kind": "guard_failure",
                    "sample_id": unit["unit_id"],
                    "data": {"reason": (row or {}).get("status", "no_answer")},
                }
            )
            continue
        records.append(
            {
                "kind": "system_one_call",
                "sample_id": unit["unit_id"],
                "data": {
                    "request_id": row.get("request_id"),
                    "model_version": row.get("model_version"),
                    "answers": row["answers"],
                },
            }
        )
        decision = decisions[unit["unit_id"]]
        records.append(
            {
                "kind": "policy_action",
                "sample_id": unit["unit_id"],
                "data": {"step": 0, "request_id": row.get("request_id"), **decision},
            }
        )
        records.append(
            {
                "kind": "outcome",
                "sample_id": unit["unit_id"],
                "data": {
                    "research_label": unit["research_label"],
                    "observed_outcome": unit["observed_outcome"],
                },
            }
        )
    return records


def result_summary_for_arm(
    arm: str,
    metrics: dict[str, dict[str, Any] | None],
    thresholds_detail: dict[str, Any],
    *,
    escalation: dict[str, Any] | None = None,
) -> tuple[str, dict[str, Any]]:
    """Plain-language result plus the structured claims, generated from the
    measured numbers. No number is stated that is not in the assessment set."""
    false_ready = metrics.get("test.false_ready_rate")
    false_draft = metrics.get("test.false_draft_rate")
    balanced = metrics.get("test.balanced_accuracy")
    n_row = metrics.get("test.n")
    pos_row = metrics.get("test.positives")
    neg_row = metrics.get("test.negatives")
    delta = metrics.get("test.false_ready_rate_delta_vs_holistic")

    def value(entry: dict[str, Any] | None) -> float | None:
        return None if not entry else entry.get("value")

    n = int(value(n_row) or 0)
    positives = int(value(pos_row) or 0)
    negatives = int(value(neg_row) or 0)
    fr = value(false_ready)
    fd = value(false_draft)

    prose = (
        f"Arm `{arm}` was evaluated on the pre-registered held-out test partition of {n} independently "
        f"labelled, structurally valid contract revisions ({positives} ready, {negatives} not ready). "
    )
    if (
        fr is not None
        and fd is not None
        and metrics.get("test.false_ready_rate", {}).get("ci95")
    ):
        fr_ci = metrics["test.false_ready_rate"]["ci95"]
        fd_ci = metrics["test.false_draft_rate"]["ci95"]
        prose += (
            f"It marked {fr:.1%} [{fr_ci[0]:.1%}, {fr_ci[1]:.1%}] of genuinely not-ready contracts as READY, "
            f"and withheld READY from {fd:.1%} [{fd_ci[0]:.1%}, {fd_ci[1]:.1%}] of genuinely ready contracts. "
        )
    if balanced and balanced.get("value") is not None:
        prose += f"Balanced accuracy was {balanced['value']:.3f}"
        if balanced.get("ci95"):
            prose += f" [{balanced['ci95'][0]:.3f}, {balanced['ci95'][1]:.3f}]"
        prose += ". "
    if arm == "atomic-policy-escalation" and escalation:
        prose += (
            f"Genuine uncertainty escalated {escalation.get('escalated', 0)} of {escalation.get('considered', 0)} "
            f"otherwise undecided units to the reasoning model ({escalation.get('rate', 0.0):.1%}); "
            f"total escalation spend was USD {escalation.get('cost_usd', 0.0):.4f}. "
        )
    if delta and delta.get("value") is not None:
        ci = delta.get("ci95")
        prose += (
            f"Against the holistic arm on the same units, the paired false-READY difference was "
            f"{delta['value']:+.3f}"
            + (f" [{ci[0]:+.3f}, {ci[1]:+.3f}]" if ci else "")
            + (
                "; the interval excludes zero."
                if ci and (ci[0] > 0 or ci[1] < 0)
                else "; the interval contains zero, so this comparison is not decisive."
            )
            + " "
        )
    prose += (
        "Thresholds and any learned weights were fitted on the training partition only; the test partition "
        "was not used to choose them. This run makes no production-adoption claim."
    )

    supported: list[str] = []
    unsupported: list[str] = []
    caveats: list[str] = []
    if fr is not None and negatives < 20:
        caveats.append(
            f"Only {negatives} independently labelled not-ready units are in the test partition, so "
            "the false-READY interval is wide."
        )
    caveats.append(
        "Labels are outcome-anchored (closure and supersession), not human judgements of readiness; "
        "an attested-but-superseded revision counts as not ready."
    )
    caveats.append(
        "The population excludes structurally invalid contracts by construction: the deterministic channel "
        "answers those, and including them would make readiness classification trivially easy."
    )
    if arm == "atomic-explicit-policy":
        supported.append(
            "The explicit atomic policy's decision quality on this population is measured with intervals."
        )
        unsupported.append(
            "That the atomic battery beats the holistic arm: see the paired difference above."
        )
    if arm == "holistic":
        supported.append(
            "The historical holistic judgment is reproduced on the same frozen population."
        )
    if arm == "atomic-learned-composition":
        caveats.append(
            "The learned composition enforces no invariant: a strong score here would not license replacing "
            "the non-compensatory policy for dispatch."
        )
    unsupported.append("Any production adoption of System One readiness.")

    decision = (
        "Hold: the incumbent deterministic-plus-attestation readiness stays authoritative until the atomic "
        "policy's advantage on the test partition is visible with an interval excluding zero."
        if not (
            delta
            and delta.get("ci95")
            and (delta["ci95"][0] > 0 or delta["ci95"][1] < 0)
        )
        else "The paired difference on the held-out partition favours the atomic policy; the next step is a "
        "larger independently labelled sample before any runtime change."
    )

    evidence_status = "exploratory"
    if n >= 40 and (
        delta and delta.get("ci95") and (delta["ci95"][0] > 0 or delta["ci95"][1] < 0)
    ):
        evidence_status = "reproducible"

    summary = {
        "plain_language": prose.strip(),
        "supported_claims": supported,
        "unsupported_claims": unsupported,
        "caveats": caveats,
        "decision": decision,
        "evidence_status": evidence_status,
        "thresholds": thresholds_detail,
    }
    return prose.strip(), summary


def publish_arm_run(
    definitions_map: dict[str, Any],
    *,
    root: Path,
    arm: str,
    units: Sequence[dict[str, Any]],
    decisions: dict[str, dict[str, Any]],
    answers: dict[str, dict[str, Any]],
    metrics: dict[str, dict[str, Any] | None],
    thresholds_detail: dict[str, Any],
    holistic_decisions: dict[str, dict[str, Any]] | None = None,
    escalation: dict[str, Any] | None = None,
    battery_run_id: str | None = None,
    assistant_notes: Iterable[str] = (),
) -> Path:
    run_id, variant_id = ARM_RUNS[arm]
    prose, summary = result_summary_for_arm(
        arm, metrics, thresholds_detail, escalation=escalation
    )
    metric_rows = {k: v for k, v in metrics.items() if v is not None}
    annotations = [
        {"kind": "conclusion", "text": prose},
        {
            "kind": "result_summary",
            "text": prose,
            "evidence_status": summary["evidence_status"],
            "result_summary": {
                "plain_language": summary["plain_language"],
                "supported_claims": summary["supported_claims"],
                "unsupported_claims": summary["unsupported_claims"],
                "caveats": summary["caveats"],
                "decision": summary["decision"],
            },
        },
        {
            "kind": "caveat",
            "text": (
                "Population: structurally valid units with an outcome-anchored label. The "
                "structurally invalid pool is excluded by construction and reported separately."
            ),
        },
    ]
    for note in assistant_notes:
        annotations.append({"kind": "caveat", "text": note})
    return publish.publish_run(
        root,
        run_id,
        experiment=definitions_map["experiment"],
        workload=definitions_map["workload"],
        dataset=definitions_map["dataset"],
        variant=definitions_map["variants"][arm],
        question_specs=definitions_map["specs"],
        evaluator=definitions_map["evaluator"],
        backend=BACKEND,
        accounting=ACCOUNTING,
        intent={
            "purpose": (
                f"Planning Ready-contract v2, arm {arm}: {ARM_DESCRIPTIONS[arm]}"
            ),
            "trigger": "baseline"
            if arm in ("holistic", "deterministic-only")
            else "change_test",
            "rationale": (
                "First board rerun after the Substrate migration; the historical contract-quality study is "
                "kept only as a comparison arm, and the Ready policy is now decomposed into deterministic "
                "checks plus atomic System One judgments."
            ),
            "refs": [
                "jira:XTRM-99#13435",
                "jira:XTRM-99#13438",
                f"dataset:{DATASET_ID}@v1",
            ],
            "requested_by": "operator",
            "tags": ["system-one", "planning-ready", "board-v2", arm],
        },
        samples=battery_samples(
            units, refused_ids=(a["unit_id"] for a in _refused(answers))
        ),
        records=arm_records(units, decisions, answers),
        # Per-sample primitive answers live in the `system_one_call` events (their durable
        # home). The assessment set carries this arm's derived metrics, and an assessment
        # row is only written when a sample has exactly one typed answer to record.
        assessments=[],
        metrics=metric_rows,
        annotations=annotations,
        lineage=(
            [{"relation": "replay_of", "run_id": battery_run_id}]
            if battery_run_id
            else None
        ),
        seed=20260919,
    )


def publish_battery_run(
    definitions_map: dict[str, Any],
    *,
    root: Path,
    units: Sequence[dict[str, Any]],
    answers: dict[str, dict[str, Any]],
    metrics: dict[str, dict[str, Any] | None],
    thresholds_detail: dict[str, Any],
) -> Path:
    run_id = "planning-ready-v2-jev-battery"
    prose = (
        f"The System One battery was answered for {len(units)} contract revisions in one request per "
        "revision (eleven Noul questions and one Choice question together). These are the raw primitive "
        "answers every composed arm replays; no policy decision is recorded in this run."
    )
    return publish.publish_run(
        root,
        run_id,
        experiment=definitions_map["experiment"],
        workload=definitions_map["workload"],
        dataset=definitions_map["dataset"],
        variant=definitions_map["variants"]["jev-battery"],
        question_specs=definitions_map["specs"],
        evaluator=definitions_map["evaluator"],
        backend=BACKEND,
        accounting=ACCOUNTING,
        intent={
            "purpose": "Planning Ready-contract v2: the System One battery answers over the frozen dataset",
            "trigger": "baseline",
            "rationale": "Primitive answers are collected once and replayed by every composed arm, so arms differ only in composition.",
            "refs": ["jira:XTRM-99#13435", f"dataset:{DATASET_ID}@v1"],
            "requested_by": "operator",
            "tags": ["system-one", "planning-ready", "board-v2", "battery"],
        },
        samples=battery_samples(
            units, refused_ids=(a["unit_id"] for a in _refused(answers))
        ),
        records=battery_records(units, answers),
        assessments=[],
        metrics={k: v for k, v in metrics.items() if v is not None},
        annotations=[
            {"kind": "conclusion", "text": prose},
            {
                "kind": "evidence_status",
                "text": "primitive answers over a frozen dataset snapshot",
                "evidence_status": "reproducible",
            },
        ],
        seed=20260919,
    )


def publish_mutation_run(
    definitions_map: dict[str, Any],
    *,
    root: Path,
    mutation_rows: Sequence[dict[str, Any]],
    original_answers: dict[str, dict[str, Any]],
    mutated_answers: dict[str, dict[str, Any]],
    metrics: dict[str, dict[str, Any] | None],
    run_id: str = "planning-ready-v2-mutations",
) -> Path:
    classes = sorted({row["mutation_class"] for row in mutation_rows})
    ok = metrics.get("mutation_intended_direction_ok")
    ok_value = ok.get("value") if ok else None
    if ok_value is not None:
        prose = (
            f"{len(mutation_rows)} controlled mutations across {len(classes)} classes were applied to "
            f"{len({row['unit_id'] for row in mutation_rows})} strong contracts, each changing exactly one "
            "invariant. The share of classes whose declared primitive moved in the declared direction with an "
            f"interval excluding zero is {ok_value:.1%}."
        )
    else:
        prose = (
            f"{len(mutation_rows)} controlled mutations across {len(classes)} classes were applied to strong "
            "contracts, each changing exactly one invariant."
        )
    return publish.publish_run(
        root,
        run_id,
        experiment=definitions_map["experiment"],
        workload=definitions_map["workload"],
        dataset=definitions_map["dataset"],
        variant=definitions_map["variants"]["mutation-suite"],
        question_specs=definitions_map["specs"],
        evaluator=definitions_map["evaluator"],
        backend=BACKEND,
        accounting=ACCOUNTING,
        intent={
            "purpose": "Planning Ready-contract v2: adversarial mutation acceptance test",
            "trigger": "change_test",
            "rationale": "Synthetic single-invariant mutations complement the natural revision transitions in the dataset and test whether each primitive means what its name claims.",
            "refs": ["jira:XTRM-99#13435", f"dataset:{DATASET_ID}@v1"],
            "requested_by": "operator",
            "tags": ["system-one", "planning-ready", "board-v2", "mutations"],
        },
        samples=[
            {
                "sample_id": row["mutation_id"],
                "input": {
                    "unit_id": row["unit_id"],
                    "mutation_class": row["mutation_class"],
                    "changed_invariant": row["changed_invariant"],
                    "expected_affected": row["expected_affected"],
                    "expected_policy_consequence": row["expected_policy_consequence"],
                    "mutated_contract": row["mutated_contract"],
                },
                "status": "ok",
            }
            for row in mutation_rows
        ],
        records=[
            {
                "kind": "system_one_call",
                "sample_id": row["mutation_id"],
                "data": {
                    "answers": (mutated_answers.get(row["mutation_id"]) or {}).get(
                        "answers"
                    ),
                    "original_answers": (
                        original_answers.get(row["unit_id"]) or {}
                    ).get("answers"),
                    "request_id": (mutated_answers.get(row["mutation_id"]) or {}).get(
                        "request_id"
                    ),
                },
            }
            for row in mutation_rows
        ],
        assessments=[],
        metrics={k: v for k, v in metrics.items() if v is not None},
        annotations=[
            {"kind": "conclusion", "text": prose},
            {
                "kind": "result_summary",
                "text": prose,
                "evidence_status": "exploratory",
                "result_summary": {
                    "plain_language": prose,
                    "supported_claims": [
                        f"Each of the {len(classes)} mutation classes changed exactly one declared invariant of a structurally valid, labelled-ready contract."
                    ],
                    "unsupported_claims": [
                        "That the battery is complete: mutations test the primitives they name, not readiness in general.",
                        "Any production adoption.",
                    ],
                    "caveats": [
                        "Mutations are synthetic and author-written; they can themselves bias which primitives move.",
                        "Paired movement is measured against the same contract before mutation, so contract-to-contract variation is controlled.",
                    ],
                    "decision": "Use the mutation table to decide which primitives are trustworthy enough to compose; investigate any class whose declared primitive does not move.",
                },
            },
        ],
        seed=20260919,
    )
