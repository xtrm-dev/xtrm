"""Publish the System One cascade result as app-visible runs (XTRM-511).

Called by ``python -m xtrm_research.evidence_gate.cascade publish``. One run
per composition (``evidence-gate-v2-battery-rule``, ``-battery-learned``,
``-cascade``). Each item is replayed through :class:`BatteryWorkflow`
from the response cache (no new request): the battery answer, the policy
decision, the escalation (cascade only; the recorded DeepSeek answer) and
the reference label as outcome, as separate events.
"""

from __future__ import annotations

import json
from typing import Any

from xtrm_research import publish
from xtrm_research.evidence_gate import cascade as cs
from xtrm_research.evidence_gate.compare import EVIDENCE, Evaluation
from xtrm_research.evidence_gate.publish_runs import definitions as gate_definitions
from xtrm_research.store import DEFAULT_RUNS_ROOT
from xtrm_research.workflow import ResponseCache

EXPERIMENT_ID = "evidence-gate-v2-system-one-cascade"
EVALUATOR_ID = "evidence-gate-cascade"
ARMS = ("battery-rule", "battery-learned", "cascade")
DESCRIPTIONS = {
    "battery-rule": "One Jev request per candidate carrying 12 atomic noul questions; a fixed soft-logic rule composes them (pre-registered), Platt-calibrated out-of-fold; no escalation.",
    "battery-learned": "The same 12-question battery composed by L2 logistic regression, out-of-fold; no escalation.",
    "cascade": "battery-learned plus a pre-registered band (reject below the 0.98-recall floor, retain at or above the 0.95-precision ceiling, fitted per training fold); the band escalates to the recorded DeepSeek answer.",
}
HEADLINE = (
    ("gate.useful_evidence_recall", "useful-evidence recall"),
    ("gate.retained_precision", "retained precision"),
    ("gate.frontier_input_token_reduction", "token reduction"),
    ("gate.escalation_rate", "escalation rate"),
    ("gate.latency_p50_ms", "latency p50 ms"),
    ("gate.cost_usd_per_1000_candidates", "USD per 1000 candidates"),
)
CAVEATS = (
    "Reference labels are LLM-adjudicated (two commandcode labelers, Kimi-K2.6 tie-break), not outcomes; alpha 0.678 on usable evidence. The escalation model (DeepSeek) is close to the labelers' family and may be favoured.",
    "Escalations are REPLAYED from the recorded llm arm (same frozen text, recorded cost and latency), not new calls; cascade latency is battery latency plus the recorded DeepSeek latency (sequential).",
    "The 9-cell band sweep (cascade-lo*-hi* metrics) is exploratory: any cell other than the pre-registered lo98/hi95 was chosen after seeing results and needs a pre-registered replication on new data before it is a finding.",
    "43 of 265 items lack a final label and are excluded (n = 222, 78 clusters). Contradiction and injection are not established (0 and 2 positives). Intervals omit calibration and composition fit variance, so they are a lower bound.",
    "End-to-end answer quality of the downstream agent was not measured.",
)


def _metrics(result: dict[str, Any], arm: str) -> dict[str, dict[str, Any] | None]:
    n = result["n_eval"]
    out: dict[str, dict[str, Any] | None] = {}
    for key, m in result["metrics"].items():
        a, scope, name = key.split("|")
        if a == arm:
            out[f"{scope}.{name}"] = publish.metric(
                m.get("value"), m.get("ci95"), n, m["method"]
            )
        elif arm == "cascade" and a.startswith("cascade-") and scope == "gate":
            out[f"sweep.{a.removeprefix('cascade-')}.{name}"] = publish.metric(
                m.get("value"),
                m.get("ci95"),
                n,
                m["method"] + "; exploratory sweep cell",
            )
    for key, m in result["paired_deltas"].items():
        lhs, scope, name = key.split("|")
        a, ref = lhs.split("-minus-")
        if a == arm:
            out[f"{scope}.{name}.minus_{ref.replace('-', '_')}"] = publish.metric(
                m.get("value"), m.get("ci95"), n, m["method"]
            )
    return out


def _fmt(m: dict[str, Any] | None) -> str:
    if m is None:
        return "not established"
    digits = 0 if abs(m["value"]) >= 100 else 3
    if not m["ci95"]:
        return f"{m['value']:.{digits}f}"
    return f"{m['value']:.{digits}f} [{m['ci95'][0]:.{digits}f}, {m['ci95'][1]:.{digits}f}]"


def conclusion(arm: str, metrics: dict[str, dict[str, Any] | None]) -> str:
    parts = [
        f"{label} {_fmt(metrics.get(key))}"
        for key, label in HEADLINE
        if arm == "cascade" or key != "gate.escalation_rate"
    ]
    if arm != "cascade":
        parts.insert(
            0,
            f"usable-evidence AUC {_fmt(metrics.get('contains_usable_evidence.auc'))}, minus holistic Jev {_fmt(metrics.get('contains_usable_evidence.auc.minus_jev'))}, minus DeepSeek {_fmt(metrics.get('contains_usable_evidence.auc.minus_llm'))}",
        )
    else:
        for ref in ("llm", "jev", "frontier"):
            parts.append(
                f"minus {ref}: recall {_fmt(metrics.get(f'gate.useful_evidence_recall.minus_{ref}'))}, precision {_fmt(metrics.get(f'gate.retained_precision.minus_{ref}'))}, cost {_fmt(metrics.get(f'gate.cost_usd_per_1000_candidates.minus_{ref}'))}"
            )
    return (
        f"Evidence Gate v2 System One {arm} (n=222, 78 clusters): "
        + "; ".join(parts)
        + "."
    )


def publish_all(
    args: Any,
    items: list,
    labels: dict,
    preds: dict,
    ev: Evaluation,
    battery: dict,
    cache: ResponseCache,
) -> None:
    result = json.loads(args.result.read_text(encoding="utf-8"))
    ce = cs.CascadeEvaluation(ev, battery)
    root = args.root or DEFAULT_RUNS_ROOT
    reg = args.registry or publish.REGISTRY_ROOT
    base = gate_definitions(reg)
    specs = [
        publish.register(
            reg,
            "question_spec",
            publish.question_spec(
                f"evidence-gate-battery.{name}",
                "v1",
                body,
                polarity=cs.BATTERY_TEXT[name][0],
            ),
        )
        for name, body in cs.BATTERY.items()
    ]
    evaluator = publish.register(
        reg,
        "evaluator",
        {
            "id": EVALUATOR_ID,
            "version": "v1",
            "kind": "statistical",
            "config": {
                "rule": cs.RULE,
                "pre_registered": cs.PRE_REGISTERED,
                "sweep": [list(s) for s in cs.SWEEP],
                "battery_hash": result["battery_hash"],
                "bootstrap": "cluster percentile, 2000 resamples, seed 20260918 (same resamples as evidence-gate-compare)",
            },
            "code_revision": "xtrm_research.evidence_gate.cascade",
        },
    )
    variants = {
        arm: publish.register(
            reg,
            "variant",
            {
                "id": f"evidence-gate-{arm}",
                "version": "v1",
                "description": DESCRIPTIONS[arm],
                "config": {
                    "backend": "typesafe",
                    "model": "jev-1.13.0",
                    "battery_hash": result["battery_hash"],
                    **(
                        {
                            "escalation_model": "commandcode/deepseek/deepseek-v4.1-flash (replayed)"
                        }
                        if arm == "cascade"
                        else {}
                    ),
                },
            },
        )
        for arm in ARMS
    }
    experiment = publish.register(
        reg,
        "experiment",
        {
            "id": EXPERIMENT_ID,
            "version": "v1",
            "workload": {"id": "evidence-gate", "version": "v1"},
            "description": "The System One pattern on the frozen Evidence Gate v2 set: a battery of atomic Jev questions per candidate, composed by code, with selective escalation of the uncertain band to an LLM. Compared on the same resamples with holistic Jev, DeepSeek on every item and Claude.",
            "hypothesis": "Decomposing the gate question into atomic System One judgments composed by code matches the LLM gate's recall and precision while calling the LLM on a minority of candidates.",
            "variants": [
                {"id": v["id"], "version": v["version"]} for v in variants.values()
            ],
            "named_datasets": [k for k, _ in HEADLINE]
            + ["contains_usable_evidence.auc"],
            "legend": {
                **{v["id"]: v["description"] for v in variants.values()},
                **dict(HEADLINE),
                "contains_usable_evidence.auc": "usable-evidence AUC of the composed score",
            },
            "chart_specs": [
                {
                    "schema_version": "xtrm-research-chart-spec/v1",
                    "id": "cascade-economics",
                    "title": "Cascade: quality kept vs LLM calls avoided",
                    "description": "Recall, precision, escalation rate and cost per 1000 candidates, 95% cluster-bootstrap CI.",
                    "datasets": [
                        "gate.useful_evidence_recall",
                        "gate.retained_precision",
                        "gate.escalation_rate",
                        "gate.cost_usd_per_1000_candidates",
                    ],
                },
            ],
        },
    )
    llm_rows = preds["llm"]
    for arm in ARMS:
        p = ce.learned_p if arm != "battery-rule" else ce.rule_p
        plan = {}
        for n, iid in enumerate(ev.ids):
            fold = ev.folds[n]
            band = ce.bands.get(arm, [{}] * 5)[fold] if arm == "cascade" else None
            plan[iid] = {
                "decision": ce.decision[arm][n],
                "escalated": ce.escalated[arm][n],
                "p": p[n],
                "band": band,
                "rule": ce.rule_raw[n],
            }
        wf = cs.BatteryWorkflow(cache, plan, llm_rows, labels)
        samples, records = [], []
        for item in items:
            iid = item["item_id"]
            samples.append(
                {
                    "sample_id": iid,
                    "input": {
                        **{
                            k: item["state"][k]
                            for k in ("query", "passage_source", "passage")
                        },
                        "reference_label": {
                            EVIDENCE: (labels.get(iid) or {}).get(EVIDENCE)
                        },
                    },
                    "status": "ok" if iid in plan else "skipped",
                }
            )
            if iid in plan:
                records += wf.run_episode(iid, {"item_id": iid, **item["state"]})
        uncached = sum(
            1
            for r in records
            if r["kind"] == "system_one_call" and not r["data"]["cached"]
        )
        if uncached:
            raise RuntimeError(
                f"{uncached} battery requests were not cached; publish must be a pure replay"
            )
        metrics = _metrics(result, arm)
        publish.publish_run(
            root,
            f"evidence-gate-v2-{arm}",
            experiment=experiment,
            workload=base["workload"],
            dataset=base["dataset"],
            variant=variants[arm],
            question_specs=specs,
            evaluator=evaluator,
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
                "purpose": f"XTRM-511: Evidence Gate as a System One {arm} (atomic battery, code composition{', selective escalation' if arm == 'cascade' else ''})",
                "trigger": "exploration",
                "refs": ["XTRM-492", "XTRM-511", "Jira XTRM-99"],
                "requested_by": "XTRM-511",
                "tags": ["xtrm-99", "evidence-gate", "system-one", arm],
            },
            samples=samples,
            records=records,
            assessments=[
                {
                    "sample_id": iid,
                    "answer": {
                        "noul": battery[iid]["answers"]["answers_part_of_query"]["noul"]
                    },
                }
                for iid in plan
            ],
            metrics=metrics,
            annotations=[
                {"kind": "conclusion", "text": conclusion(arm, metrics)},
                *({"kind": "caveat", "text": c} for c in CAVEATS),
                {
                    "kind": "evidence_status",
                    "text": f"Battery collected once (265 Jev requests, $0.0098), evaluation replayable from the response cache; battery {result['battery_hash']}.",
                    "evidence_status": "exploratory",
                },
            ],
            lineage=[{"run_id": "evidence-gate-v2-jev", "relation": "forked_from"}],
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
