"""Publish the Evidence Gate v2 comparison as app-visible runs (XTRM-510).

    python -m xtrm_research.evidence_gate.publish_runs \
        --results RESULTS/compare.json --dataset DATASET_DIR \
        --labels LABELS_DIR --runs ARM_RUNS_DIR [--root RUNS_ROOT]

One run per model arm (``evidence-gate-v2-<arm>``): the 265 frozen items
as samples (with their reference labels), each arm's recorded answer as an
event, the comparison metrics and paired deltas as an assessment set, and
conclusion / caveat / evidence_status annotations. No model is called:
this is a replay of recorded outputs and of ``compare.json``.

Only Jev's answers are nouls, so only the Jev run carries per-sample
assessment answers; the other arms' raw scores are recorded in events and
are never labelled ``noul`` (XTRM-99 §10.2).
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from xtrm_research import publish
from xtrm_research.definitions import DefinitionRegistry
from xtrm_research.evidence_gate import frontier, local
from xtrm_research.evidence_gate.compare import GATE_METRICS, MODEL_ARMS, latest_answers
from xtrm_research.evidence_gate.dataset import load_items
from xtrm_research.evidence_gate.labels import BINARY, QUESTIONS
from xtrm_research.store import DEFAULT_RUNS_ROOT
from xtrm_research.telemetry import usage_record

EXPERIMENT_ID = "evidence-gate-v2-classifiers"
EVALUATOR_ID = "evidence-gate-compare"
TELEMETRY_RUN = "evidence-gate-v2-jev-telemetry"

ARM_VARIANTS: dict[str, dict[str, Any]] = {
    "embedding": {
        "description": "Cosine similarity of query and passage, bge-small-en-v1.5 on CPU; relevant and usable only.",
        "config": {
            "backend": "local",
            "model": local.EMBED_MODEL,
            "answer_kind": "cosine",
        },
    },
    "qwen": {
        "description": "Qwen3-Reranker-0.6B raw P(yes) on CPU, one question per call; calibrated before any threshold.",
        "config": {
            "backend": "local",
            "model": local.QWEN_MODEL,
            "answer_kind": "raw_probability",
        },
    },
    "jev": {
        "description": "TypeSafe Jev System One: one request per candidate carrying the six holistic questions as nouls plus a Score.",
        "config": {"backend": "typesafe", "model": "jev-1.13.0", "answer_kind": "noul"},
    },
    "frontier": {
        "description": "Claude Sonnet 5 (effort low) structured classification through the claude CLI, stated probabilities.",
        "config": {
            "backend": "claude_cli",
            "model": frontier.FRONTIER_MODEL,
            "effort": frontier.FRONTIER_EFFORT,
            "answer_kind": "stated_probability",
        },
    },
    "llm": {
        "description": "DeepSeek-v4.1-flash through pi (context-isolated), stated probabilities, strict JSON.",
        "config": {
            "backend": "pi",
            "model": frontier.LLM_MODEL,
            "answer_kind": "stated_probability",
        },
    },
}

HEADLINE = (
    ("contains_usable_evidence.auc", "usable-evidence AUC"),
    ("gate.retained_precision", "gate precision at the 0.95 recall target"),
    ("gate.useful_evidence_recall", "gate recall"),
    ("gate.frontier_input_token_reduction", "token reduction"),
    ("gate.latency_p50_ms", "latency p50 ms (wall clock)"),
    ("gate.cost_usd_per_1000_candidates", "USD per 1000 candidates"),
)

CAVEATS = (
    "Framing: every arm is a holistic per-candidate classifier scored against reference labels. This is NOT the System One workflow pattern (decomposed atomic question battery, code composition, selective escalation); see the cascade experiment (XTRM-511) and the multi-step showcase (XTRM-512).",
    "Reference labels are LLM-adjudicated (two commandcode labelers, Kimi-K2.6 tie-break, context-isolated re-run), not human or outcome labels; inter-labeler Krippendorff alpha on usable evidence is 0.678. An arm close to the labelers' model family may be favoured.",
    "contradicts_query_assumption (0/222 positive) and contains_prompt_injection (2/222) are NOT ESTABLISHED: below 10 positives the policy path is disabled and no metric is published for it.",
    "43 of 265 items have no final label (adjudicator parse failure or missing) and are excluded; n_eval = 222 in 78 source clusters. Intervals are cluster-bootstrap (2000 resamples, seed 20260918) and omit calibration-fit variance, so they are a lower bound.",
    "End-to-end answer quality of the downstream frontier agent with vs without the gate was not measured.",
)


def definitions(registry_root: Path) -> dict[str, Any]:
    """Register (write-once) and return the Evidence Gate definitions this
    experiment's runs reference."""
    reg = registry_root
    specs = [
        publish.register(
            reg,
            "question_spec",
            publish.question_spec(
                f"evidence-gate.{name}",
                "v1",
                body,
                provenance={
                    "module": "xtrm_research.evidence_gate.frontier.jev_questions"
                },
            ),
        )
        for name, body in frontier.jev_questions().items()
    ]
    metric_names = [f"gate.{m}" for m in GATE_METRICS] + [f"{q}.auc" for q in BINARY]
    workload = publish.register(
        reg,
        "workload",
        {
            "id": "evidence-gate",
            "version": "v1",
            "description": "Evidence Gate: decide which retrieved candidates (ctx_search passages, researcher web results) reach a frontier agent's context. High useful-evidence recall first, then reduction.",
            "sample_provider": "evidence_gate.dataset (frozen, versioned items.jsonl)",
            "runner_kind": "replay",
            "required_capabilities": ["text_compare"],
            "input_schema": {
                "type": "object",
                "required": ["query", "passage", "passage_source"],
            },
            "output_schema": {"type": "object"},
            "questions": [{"id": s["id"], "version": s["version"]} for s in specs],
            "observers": [],
            "evaluators": [{"id": EVALUATOR_ID, "version": "v1"}],
            "default_metrics": metric_names,
            "legend": {
                **{
                    s["id"]: s["instructions"]
                    if isinstance(s["instructions"], str)
                    else s["id"]
                    for s in specs
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
                "recall_target": 0.95,
                "calibration": "grouped 5-fold out-of-fold Platt, isotonic sensitivity",
                "bootstrap": "cluster percentile, 2000 resamples, seed 20260918",
                "min_positives": 10,
            },
            "code_revision": "xtrm_research.evidence_gate.compare",
        },
    )
    variants = {
        arm: publish.register(
            reg,
            "variant",
            {"id": f"evidence-gate-{arm}", "version": "v1", **ARM_VARIANTS[arm]},
        )
        for arm in MODEL_ARMS
    }
    named = [m for m, _ in HEADLINE]
    experiment = publish.register(
        reg,
        "experiment",
        {
            "id": EXPERIMENT_ID,
            "version": "v1",
            "workload": {"id": "evidence-gate", "version": "v1"},
            "description": "Five model arms as holistic per-candidate Evidence Gate classifiers on frozen dataset v2, against context-isolated reference labels, with paired cluster-bootstrap deltas.",
            "hypothesis": "A local/open model or Jev reaches frontier-level useful-evidence recall and precision at lower latency and cost.",
            "variants": [
                {"id": v["id"], "version": v["version"]} for v in variants.values()
            ],
            "named_datasets": named,
            "legend": {
                **{v["id"]: v["description"] for v in variants.values()},
                **dict(HEADLINE),
            },
            "chart_specs": [
                {
                    "schema_version": "xtrm-research-chart-spec/v1",
                    "id": "evidence-gate-quality",
                    "title": "Usable-evidence ranking quality",
                    "description": "AUC of each arm's usable-evidence score against the reference label, 95% cluster-bootstrap CI.",
                    "datasets": ["contains_usable_evidence.auc"],
                },
                {
                    "schema_version": "xtrm-research-chart-spec/v1",
                    "id": "evidence-gate-economics",
                    "title": "Gate precision, reduction and cost",
                    "description": "At the 0.95 recall target: retained precision, frontier input-token reduction, and USD per 1000 candidates.",
                    "datasets": [
                        "gate.retained_precision",
                        "gate.frontier_input_token_reduction",
                        "gate.cost_usd_per_1000_candidates",
                    ],
                },
            ],
        },
    )
    dataset = DefinitionRegistry(reg).get("dataset", "evidence-gate", "2")
    return {
        "specs": specs,
        "workload": workload,
        "evaluator": evaluator,
        "variants": variants,
        "experiment": experiment,
        "dataset": dataset,
    }


def arm_metrics(result: dict[str, Any], arm: str) -> dict[str, dict[str, Any] | None]:
    """compare.json metrics and paired deltas for ``arm`` as assessment-set
    metrics, ``<question>.<metric>`` and ``<question>.<metric>.minus_<ref>``.
    An undefined value is dropped (it reads 'not established')."""
    n = result["n_eval"]
    out: dict[str, dict[str, Any] | None] = {}
    for source, prefix in (
        (result["metrics"], f"{arm}|"),
        (result["paired_deltas"], f"{arm}-minus-"),
    ):
        for key, m in source.items():
            if not key.startswith(prefix):
                continue
            if source is result["metrics"]:
                _, question, name = key.split("|")
                label = f"{question}.{name}"
            else:
                ref, question, name = key[len(prefix) :].split("|")
                label = f"{question}.{name}.minus_{ref.replace('-', '_')}"
            if (
                question in result["established_questions"]
                and not result["established_questions"][question]
            ):
                continue
            method = m["method"] + (
                f"; {m['skipped']} resamples undefined" if m.get("skipped") else ""
            )
            out[label] = publish.metric(m.get("value"), m.get("ci95"), n, method)
    return out


def _fmt(m: dict[str, Any] | None) -> str:
    if m is None:
        return "not established"
    digits = 0 if abs(m["value"]) >= 100 else 3
    lo, hi = m["ci95"] or (None, None)
    if lo is None:
        return f"{m['value']:.{digits}f}"
    return f"{m['value']:.{digits}f} [{lo:.{digits}f}, {hi:.{digits}f}]"


def conclusion(arm: str, metrics: dict[str, dict[str, Any] | None]) -> str:
    parts = [f"{label} {_fmt(metrics.get(key))}" for key, label in HEADLINE]
    for ref in ("frontier", "llm"):
        if arm != ref:
            parts.append(
                f"AUC minus {ref} {_fmt(metrics.get(f'contains_usable_evidence.auc.minus_{ref}'))}"
            )
    return (
        f"Evidence Gate v2, {arm} as a holistic classifier (n=222, 78 clusters): "
        + "; ".join(parts)
        + "."
    )


def _usage(arm: str, row: dict[str, Any]) -> dict[str, Any]:
    """The arm row's usage as a usage_record. A field the source never
    measured is omitted rather than nulled (a local CPU arm has no tokens or
    bill, which neither schema null reason describes)."""
    u = row.get("usage") or {}
    if arm in ("embedding", "qwen"):
        record = usage_record(
            "unknown",
            latency_ms=row.get("latency_ms"),
            request_model=row.get("model_revision"),
        )
    else:
        cost = u.get("cost_usd")
        record = usage_record(
            {
                "jev": "provider_api",
                "frontier": "provider_api",
                "llm": "pi_message_usage",
            }[arm],
            input_tokens=u.get("input_tokens"),
            output_tokens=u.get("output_tokens"),
            cached_input_tokens=u.get("cached_input_tokens"),
            request_model=row.get("model") or ARM_VARIANTS[arm]["config"]["model"],
            response_model=row.get("model"),
            latency_ms=row.get("latency_ms"),
            cost=cost,
            cost_currency="USD" if cost is not None else None,
        )
    return {k: v for k, v in record.items() if v is not None}


def arm_run(
    arm: str,
    items: list[dict[str, Any]],
    labels: dict[str, dict[str, Any]],
    rows: dict[str, dict[str, Any]],
) -> tuple[list, list, list]:
    samples, records, assessments = [], [], []
    for item in items:
        sid = item["item_id"]
        samples.append(
            {
                "sample_id": sid,
                "input": {
                    **{
                        k: item["state"][k]
                        for k in ("query", "passage_source", "passage")
                    },
                    "cluster": item["source_ref"].split("#")[0].rsplit("/", 1)[-1],
                    "source_kind": item["source_kind"],
                    "stratum": item["stratum"],
                    "reference_label": labels.get(sid),
                },
                **({"output": rows[sid]["raw"]} if sid in rows else {}),
                "status": "ok" if sid in rows else "error",
            }
        )
        row = rows.get(sid)
        if row is None:
            continue
        data = {
            k: row[k]
            for k in (
                "raw",
                "score_probabilities",
                "request_id",
                "model",
                "unsupported",
                "answer_kind",
            )
            if k in row
        }
        records.append(
            {
                "kind": "system_one_call" if arm == "jev" else "model_call",
                "sample_id": sid,
                "data": data,
                "usage": _usage(arm, row),
            }
        )
        if arm == "jev":
            assessments.append(
                {
                    "sample_id": sid,
                    "answer": {"noul": row["raw"]["contains_usable_evidence"]},
                }
            )
    return samples, records, assessments


def main() -> None:
    parser = argparse.ArgumentParser()
    for flag in ("--results", "--dataset", "--labels", "--runs"):
        parser.add_argument(flag, type=Path, required=True)
    parser.add_argument("--root", type=Path, default=DEFAULT_RUNS_ROOT)
    parser.add_argument("--registry", type=Path, default=publish.REGISTRY_ROOT)
    args = parser.parse_args()
    result = json.loads(args.results.read_text(encoding="utf-8"))
    items = load_items(args.dataset)
    labels = {
        r["item_id"]: {q: r.get(q) for q in QUESTIONS}
        for r in map(
            json.loads,
            (args.labels / "labels.jsonl").read_text(encoding="utf-8").splitlines(),
        )
        if r
    }
    defs = definitions(args.registry)
    for arm in MODEL_ARMS:
        rows = latest_answers(args.runs / f"{arm}.jsonl")
        samples, records, assessments = arm_run(arm, items, labels, rows)
        metrics = arm_metrics(result, arm)
        publish.publish_run(
            args.root,
            f"evidence-gate-v2-{arm}",
            experiment=defs["experiment"],
            workload=defs["workload"],
            dataset=defs["dataset"],
            variant=defs["variants"][arm],
            question_specs=defs["specs"]
            if arm in ("jev", "frontier", "llm")
            else [
                s
                for s in defs["specs"]
                if s["id"].split(".", 1)[1] in ("relevant", "contains_usable_evidence")
            ],
            evaluator=defs["evaluator"],
            backend={
                "provider": ARM_VARIANTS[arm]["config"]["backend"],
                "model": ARM_VARIANTS[arm]["config"]["model"],
                "model_version": ARM_VARIANTS[arm]["config"]["model"],
            },
            accounting={
                "price_table_version": result["prices_version"],
                "telemetry_schema_version": "xtrm-research-telemetry/v1",
                "otel_semconv_ref": "gen_ai/v1.28",
            },
            intent={
                "purpose": f"XTRM-510: Evidence Gate v2 {arm} arm as an app-visible run (replay of recorded outputs and compare.json)",
                "trigger": "replay",
                "refs": ["XTRM-492", "XTRM-510", "Jira XTRM-99"],
                "requested_by": "XTRM-510",
                "tags": ["xtrm-99", "evidence-gate", arm],
            },
            samples=samples,
            records=records,
            assessments=assessments,
            metrics=metrics,
            annotations=[
                {"kind": "conclusion", "text": conclusion(arm, metrics)},
                *({"kind": "caveat", "text": c} for c in CAVEATS),
                {
                    "kind": "evidence_status",
                    "text": f"Replay of recorded arm outputs; dataset {result['dataset_items_sha256']}, labels {result['labels_sha256']}.",
                    "evidence_status": "reproducible",
                },
            ],
        )
        print(
            json.dumps(
                {
                    "run": f"evidence-gate-v2-{arm}",
                    "samples": len(samples),
                    "events": len(records),
                    "metrics": sum(v is not None for v in metrics.values()),
                }
            )
        )
    from xtrm_research.annotations import append_annotation
    from xtrm_research.store import run_exists

    if run_exists(args.root, TELEMETRY_RUN):
        append_annotation(
            args.root,
            TELEMETRY_RUN,
            publish.AUTHOR,
            "superseded_by",
            "evidence-gate-v2-jev: this run used stub experiment/workload/variant definitions and wrote no samples or metrics, so the app could not show it (XTRM-510).",
        )
        append_annotation(
            args.root,
            TELEMETRY_RUN,
            publish.AUTHOR,
            "evidence_status",
            "Superseded by evidence-gate-v2-jev; kept for its three-record telemetry shape (XTRM-502).",
            "superseded",
        )


if __name__ == "__main__":
    main()
