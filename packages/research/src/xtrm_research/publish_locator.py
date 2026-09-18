"""Publish the code-locator showcase as app-visible runs (XTRM-512).

Called by ``python -m xtrm_research.code_locator publish``. Three runs on
the frozen code-locator v1 set: ``code-locator-v1-jev-beam`` (the System
One control loop, one event per step), and the two deterministic
baselines ``-lexical`` and ``-hot-files`` (one ranking event per task).
No request is made: the beam replays from the response cache.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from xtrm_research import code_locator as cl
from xtrm_research import publish
from xtrm_research.store import DEFAULT_RUNS_ROOT

EXPERIMENT_ID = "code-locator-v1"
EVALUATOR_ID = "code-locator-hits"
DESCRIPTIONS = {
    "jev-beam": f"System One beam routing: one Jev request per step carrying one Choice per beam node (width {cl.WIDTH}); code keeps the best directories by geometric-mean path probability over answered steps; files become ranked leaves.",
    "lexical": "Deterministic: idf-weighted overlap of task words and path words over every file at the base commit.",
    "hot-files": "Deterministic: files ranked by how often they were modified before the base commit.",
}
HEADLINE = (
    ("hit@1", "hit@1"),
    ("hit@5", "hit@5"),
    ("hit@10", "hit@10"),
    ("recall@10", "recall@10"),
    ("mrr", "mean reciprocal rank"),
)
CAVEATS = (
    "Truth is deterministic (git: files the change modified that existed at the base commit, minus changelogs and lockfiles), but a change can legitimately touch files a task does not imply, and a task can be done in more than one place; hit@k is a lower bound on usefulness.",
    "Task text is the FIRST revision of the Substrate contract (PROBLEM + SUCCESS), path-like tokens replaced by [path]. 69 tasks from 2 repositories (xtrm 46, specialists 23), one cluster per task.",
    "Scoring change disclosed: after a 2-task smoke run, path scores were changed to average only over steps Jev answered (a forced single-entry step had inflated `apps/.gitkeep`). The 69-task run used the corrected scoring; no other change was made after seeing results.",
    "Exploratory (chosen after the primary result): reciprocal-rank fusion of the beam with the hot-files prior, and all arms re-scored on non-Markdown truth. Neither closes the gap to the hot-files prior.",
    "Only one System One design was tested (contract text only in the state, no history prior in the state, width 3, no escalation). A design that gives Jev the prior as state is untested.",
)


def _metrics(result: dict[str, Any], arm: str) -> dict[str, dict[str, Any] | None]:
    n = result["n_items"]
    out: dict[str, dict[str, Any] | None] = {}
    for key, m in result["metrics"].items():
        a, name = key.split("|")
        if a == arm:
            out[name] = publish.metric(m.get("value"), m.get("ci95"), n, m["method"])
        elif arm == "jev-beam" and a in cl.EXPLORATORY_ARMS:
            out[f"exploratory.{a}.{name}"] = publish.metric(
                m.get("value"), m.get("ci95"), n, m["method"] + "; exploratory"
            )
    for key, m in result["paired_deltas"].items():
        lhs, name = key.split("|")
        a, ref = lhs.split("-minus-")
        if a == arm:
            out[f"{name}.minus_{ref.replace('-', '_')}"] = publish.metric(
                m.get("value"), m.get("ci95"), n, m["method"]
            )
        elif arm == "jev-beam" and a in cl.EXPLORATORY_ARMS:
            out[f"exploratory.{a}.{name}.minus_{ref.replace('-', '_')}"] = (
                publish.metric(
                    m.get("value"), m.get("ci95"), n, m["method"] + "; exploratory"
                )
            )
    return out


def _fmt(m: dict[str, Any] | None) -> str:
    if m is None:
        return "not established"
    v = abs(m["value"])
    digits = 0 if v >= 100 else 6 if 0 < v < 0.01 else 3
    if not m["ci95"]:
        return f"{m['value']:.{digits}f}"
    return f"{m['value']:.{digits}f} [{m['ci95'][0]:.{digits}f}, {m['ci95'][1]:.{digits}f}]"


def conclusion(arm: str, metrics: dict[str, dict[str, Any] | None]) -> str:
    parts = [f"{label} {_fmt(metrics.get(key))}" for key, label in HEADLINE]
    if arm == "jev-beam":
        for ref in ("lexical", "hot_files"):
            parts.append(
                f"minus {ref}: hit@1 {_fmt(metrics.get(f'hit@1.minus_{ref}'))}, mrr {_fmt(metrics.get(f'mrr.minus_{ref}'))}"
            )
        parts.append(
            f"{_fmt(metrics.get('requests'))} requests and {_fmt(metrics.get('latency_ms'))} ms per task, USD {_fmt(metrics.get('cost_usd'))} per task"
        )
    return f"Code locator v1, {arm} (69 tasks): " + "; ".join(parts) + "."


def publish_all(
    args: Any,
    items: list[dict[str, Any]],
    wf: cl.BeamWorkflow,
    records: dict[str, list[dict[str, Any]]],
    table: dict,
) -> None:
    result = json.loads(Path(args.result).read_text(encoding="utf-8"))
    root = args.root or DEFAULT_RUNS_ROOT
    reg = args.registry or publish.REGISTRY_ROOT
    manifest = json.loads((args.dataset / "manifest.json").read_text(encoding="utf-8"))
    dataset = publish.register(
        reg,
        "dataset",
        {
            "id": "code-locator",
            "version": "1",
            "description": manifest["selection"]
            + ". Task: "
            + manifest["task_text"]
            + ". Truth: "
            + manifest["truth"]
            + ".",
            "source": f"{args.dataset} (items.jsonl {manifest['items_sha256']})",
        },
    )
    spec = publish.register(
        reg,
        "question_spec",
        {
            "id": "code-locator.entry-choice",
            "version": "v1",
            "type": "choice",
            "instructions": "A developer must carry out `task`. Which entry of <directory> contains the files that this work changes? Choose the most likely entry.",
            "criteria": "the directory's immediate entries at the base commit, name -> 'file' | 'directory' (dynamic per step)",
            "options": ["<entry of the current directory>"],
        },
    )
    workload = publish.register(
        reg,
        "workload",
        {
            "id": "code-locator",
            "version": "v1",
            "description": "Locate the files a task changes by walking the repository tree at the task's base commit.",
            "sample_provider": "code_locator.build (Substrate first-revision contracts x git history)",
            "runner_kind": "system_one_workflow",
            "required_capabilities": ["repository_read"],
            "input_schema": {"type": "object", "required": ["task"]},
            "output_schema": {"type": "object"},
            "questions": [{"id": spec["id"], "version": spec["version"]}],
            "observers": [],
            "evaluators": [{"id": EVALUATOR_ID, "version": "v1"}],
            "default_metrics": [k for k, _ in HEADLINE],
            "legend": {spec["id"]: spec["instructions"], **dict(HEADLINE)},
        },
    )
    evaluator = publish.register(
        reg,
        "evaluator",
        {
            "id": EVALUATOR_ID,
            "version": "v1",
            "kind": "outcome",
            "config": {
                "k": list(cl.TOP_K),
                "bootstrap": "percentile over tasks, 2000 resamples, seed 20260918",
                "width": cl.WIDTH,
                "max_depth": cl.MAX_DEPTH,
            },
            "code_revision": "xtrm_research.code_locator",
        },
    )
    variants = {
        arm: publish.register(
            reg,
            "variant",
            {
                "id": f"code-locator-{arm}",
                "version": "v1",
                "description": DESCRIPTIONS[arm],
                "config": {
                    "backend": "typesafe" if arm == "jev-beam" else "deterministic",
                    "model": "jev-1.13.0" if arm == "jev-beam" else "none",
                },
            },
        )
        for arm in cl.ARMS
    }
    experiment = publish.register(
        reg,
        "experiment",
        {
            "id": EXPERIMENT_ID,
            "version": "v1",
            "workload": {"id": "code-locator", "version": "v1"},
            "description": "Multi-step System One showcase (XTRM-512): beam routing over the repository tree vs deterministic baselines, graded by git.",
            "hypothesis": "A System One beam over the tree, given only the task text, ranks the changed files above deterministic baselines at a cost of cents per hundred tasks.",
            "variants": [
                {"id": v["id"], "version": v["version"]} for v in variants.values()
            ],
            "named_datasets": [k for k, _ in HEADLINE],
            "legend": {
                **{v["id"]: v["description"] for v in variants.values()},
                **dict(HEADLINE),
            },
            "chart_specs": [
                {
                    "schema_version": "xtrm-research-chart-spec/v1",
                    "id": "code-locator-hits",
                    "title": "Changed file found in the top k",
                    "description": "hit@1, hit@5, hit@10 per arm with 95% bootstrap CI over tasks.",
                    "datasets": ["hit@1", "hit@5", "hit@10"],
                }
            ],
        },
    )
    for arm in cl.ARMS:
        samples, recs = [], []
        for item in items:
            iid = item["item_id"]
            samples.append(
                {
                    "sample_id": iid,
                    "input": {
                        "task": item["task"],
                        "repo": item["repo"],
                        "ref": item["ref"],
                        "base": item["base"],
                        "truth": item["truth"],
                    },
                    "output": table[arm][iid],
                }
            )
            if arm == "jev-beam":
                recs += records[iid]
            else:
                repo = Path(cl.REPOS[item["repo"]]["path"]).expanduser()
                files = wf.trees[iid]
                ranked = (
                    cl.lexical_rank(item["task"], files)
                    if arm == "lexical"
                    else cl.hot_rank(repo, item["base"], files)
                )
                recs.append(
                    {
                        "kind": "baseline_rank",
                        "sample_id": iid,
                        "data": {"top10": ranked[:10]},
                    }
                )
                recs.append(
                    {
                        "kind": "outcome",
                        "sample_id": iid,
                        "data": {
                            "resolved": {"truth": item["truth"]},
                            "resolver": "git: files modified by the change",
                            **table[arm][iid],
                        },
                    }
                )
        if arm == "jev-beam" and any(
            r["kind"] == "system_one_call"
            and r["data"]["request_id"]
            and not r["data"]["cached"]
            for r in recs
        ):
            raise RuntimeError("publish must replay from the cache")
        metrics = _metrics(result, arm)
        publish.publish_run(
            root,
            f"code-locator-v1-{arm}",
            experiment=experiment,
            workload=workload,
            dataset=dataset,
            variant=variants[arm],
            question_specs=[spec] if arm == "jev-beam" else [],
            evaluator=evaluator,
            backend={
                "provider": "typesafe",
                "model": "jev-1.13.0",
                "model_version": "jev-1.13.0",
            }
            if arm == "jev-beam"
            else {"provider": "deterministic", "model": arm, "model_version": "v1"},
            accounting={
                "price_table_version": "2026-09-18.1",
                "telemetry_schema_version": "xtrm-research-telemetry/v1",
                "otel_semconv_ref": "gen_ai/v1.28",
            },
            intent={
                "purpose": f"XTRM-512: multi-step System One showcase, code-locator {arm}",
                "trigger": "exploration" if arm == "jev-beam" else "baseline",
                "refs": ["XTRM-492", "XTRM-512", "Jira XTRM-99"],
                "requested_by": "XTRM-512",
                "tags": ["xtrm-99", "code-locator", "system-one", arm],
            },
            samples=samples,
            records=recs,
            assessments=[],
            metrics=metrics,
            annotations=[
                {"kind": "conclusion", "text": conclusion(arm, metrics)},
                *({"kind": "caveat", "text": c} for c in CAVEATS),
                {
                    "kind": "evidence_status",
                    "text": f"Dataset {manifest['items_sha256']}; beam replayable from the response cache; Jev spend 332 requests, USD 0.0178.",
                    "evidence_status": "exploratory"
                    if arm == "jev-beam"
                    else "reproducible",
                },
            ],
        )
        print(
            json.dumps(
                {
                    "run": f"code-locator-v1-{arm}",
                    "samples": len(samples),
                    "events": len(recs),
                    "metrics": sum(v is not None for v in metrics.values()),
                }
            )
        )
