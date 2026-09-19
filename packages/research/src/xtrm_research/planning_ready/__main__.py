"""CLI for the Planning Ready-contract campaign.

python -m xtrm_research.planning_ready collect --kind atomic
python -m xtrm_research.planning_ready mutations
python -m xtrm_research.planning_ready arms
python -m xtrm_research.planning_ready escalate --max-calls 80
python -m xtrm_research.planning_ready report
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from xtrm_research.planning_ready import campaign
from xtrm_research.planning_ready import mutations as mutations_module
from xtrm_research.planning_ready import publish_runs
from xtrm_research import publish


def _load_manifest(dataset_dir: Path) -> dict[str, Any]:
    return json.loads((dataset_dir / "manifest.json").read_text(encoding="utf-8"))


def cmd_collect(args: argparse.Namespace) -> int:
    units = campaign.load_units(Path(args.dataset))
    if args.kind == "holistic":
        units = campaign.labelled_units(units)
    if args.limit:
        units = units[: args.limit]
    result = campaign.collect(args.kind, units, workers=args.workers)
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


def cmd_mutations(args: argparse.Namespace) -> int:
    units = campaign.load_units(Path(args.dataset))
    rows = mutations_module.build_mutations(units, per_class=args.per_class)
    path = campaign.ANSWERS_DIR / "mutations.jsonl"
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, sort_keys=True, ensure_ascii=False) + "\n")
    structural = sum(
        1
        for r in rows
        if r["structurally_valid_after"] and r["structurally_valid_before"]
    )
    print(
        json.dumps(
            {
                "mutations": len(rows),
                "classes": len({r["mutation_class"] for r in rows}),
                "strong_contracts": len({r["unit_id"] for r in rows}),
                "meaning_changed_structure_unchanged": structural,
                "path": str(path),
            },
            indent=2,
            sort_keys=True,
        )
    )
    return 0


def cmd_mutations_collect(args: argparse.Namespace) -> int:
    units = campaign.load_units(Path(args.dataset))
    rows = [
        json.loads(line)
        for line in (campaign.ANSWERS_DIR / "mutations.jsonl")
        .read_text(encoding="utf-8")
        .splitlines()
        if line.strip()
    ]
    pseudo = campaign.mutation_pseudo_units(units, rows)
    result = campaign.collect("mutation-answers", pseudo, workers=args.workers)
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


def cmd_arms(args: argparse.Namespace) -> int:
    dataset_dir = Path(args.dataset)
    units = campaign.load_units(dataset_dir)
    manifest = _load_manifest(dataset_dir)
    atomic = campaign.load_answers(campaign._answers_path("atomic"))
    holistic = campaign.load_answers(campaign._answers_path("holistic"))
    missing = [u["unit_id"] for u in units if u["unit_id"] not in atomic]
    if missing:
        raise SystemExit(
            f"{len(missing)} units have no atomic answers (run `collect --kind atomic` first)"
        )

    evaluation_population = campaign.labelled_units(units)
    composition = campaign.arms_from_answers(evaluation_population, atomic, holistic)
    decisions = composition["decisions"]
    definitions = publish_runs.definitions(
        Path(args.registry_root), manifest["units_sha256"], dataset_dir
    )

    battery_metrics = publish_runs.primitive_metrics_for_run(
        evaluation_population, atomic
    )
    battery_run = publish_runs.publish_battery_run(
        definitions,
        root=Path(args.root),
        units=evaluation_population,
        answers=atomic,
        metrics=battery_metrics,
        thresholds_detail={
            "thresholds": composition["thresholds"].freeze(),
            "threshold_search": composition["threshold_detail"],
            "holistic_threshold": composition["holistic_detail"],
            "learned": composition["learned"].freeze(),
            "learned_fit": composition["learned_detail"],
        },
    )

    published: dict[str, str] = {"jev-battery": battery_run.name}
    for arm in (
        "holistic",
        "deterministic-only",
        "atomic-explicit-policy",
        "atomic-learned-composition",
    ):
        if arm == "holistic" and not holistic:
            continue
        metrics = publish_runs.arm_metrics_for_run(
            arm,
            evaluation_population,
            decisions[arm],
            decisions["holistic"] if holistic else None,
        )
        if arm != "holistic":
            metrics.update(
                {
                    k: v
                    for k, v in publish_runs.primitive_metrics_for_run(
                        evaluation_population, atomic
                    ).items()
                    if k.startswith("primitive")
                    or "_auc" in k
                    or "_brier" in k
                    or "_ece" in k
                }
            )
        run_path = publish_runs.publish_arm_run(
            definitions,
            root=Path(args.root),
            arm=arm,
            units=evaluation_population,
            decisions=decisions[arm],
            answers=atomic,
            metrics=metrics,
            thresholds_detail={
                "fitted_on": "train partition only",
                "thresholds": composition["thresholds"].freeze(),
                "threshold_search": composition["threshold_detail"],
                "holistic_threshold": composition["holistic_detail"],
                "learned": composition["learned"].freeze(),
                "learned_fit": composition["learned_detail"],
                "cluster_unit": campaign.CLUSTER_KEY,
            },
            holistic_decisions=decisions["holistic"] if holistic else None,
            battery_run_id=battery_run.name,
        )
        published[arm] = run_path.name

    print(
        json.dumps(
            {
                "published": published,
                **{
                    k: v
                    for k, v in composition.items()
                    if k
                    in (
                        "thresholds",
                        "threshold_detail",
                        "holistic_detail",
                        "learned_detail",
                    )
                },
            },
            indent=2,
            sort_keys=True,
            default=str,
        )
    )
    return 0


def cmd_escalate(args: argparse.Namespace) -> int:
    dataset_dir = Path(args.dataset)
    units = campaign.load_units(dataset_dir)
    manifest = _load_manifest(dataset_dir)
    atomic = campaign.load_answers(campaign._answers_path("atomic"))
    holistic = campaign.load_answers(campaign._answers_path("holistic"))
    evaluation_population = campaign.labelled_units(units)
    composition = campaign.arms_from_answers(evaluation_population, atomic, holistic)
    explicit = composition["decisions"]["atomic-explicit-policy"]

    escalation = campaign.escalate_units(
        evaluation_population, explicit, max_calls=args.max_calls
    )
    escalated_decisions = campaign.apply_escalations(explicit, escalation.pop("rows"))
    definitions = publish_runs.definitions(
        Path(args.registry_root), manifest["units_sha256"], dataset_dir
    )
    metrics = publish_runs.arm_metrics_for_run(
        "atomic-policy-escalation",
        evaluation_population,
        escalated_decisions,
        composition["decisions"]["holistic"] if holistic else None,
    )
    metrics["escalation_rate"] = publish.metric(
        float(escalation["rate"]),
        None,
        escalation["escalated"],
        "escalations divided by units the explicit policy could not settle",
    )
    metrics["coverage"] = publish.metric(
        float(1.0 - escalation["rate"]),
        None,
        escalation["escalated"],
        "share of units the explicit policy settled without the reasoning model",
    )
    if escalation.get("cost_usd") is not None:
        metrics["escalation_cost_usd"] = publish.metric(
            float(escalation["cost_usd"]),
            None,
            escalation["escalated"],
            "sum of the reasoning model's own reported cost for escalations",
        )
    run_path = publish_runs.publish_arm_run(
        definitions,
        root=Path(args.root),
        arm="atomic-policy-escalation",
        units=evaluation_population,
        decisions=escalated_decisions,
        answers=atomic,
        metrics=metrics,
        thresholds_detail={
            "fitted_on": "train partition only",
            "thresholds": composition["thresholds"].freeze(),
            "escalation_model": campaign.ESCALATION_MODEL,
            "escalation_transport": campaign.ESCALATION_TRANSPORT_NAME,
            "escalation_model_deviation": (
                "The pre-registration named claude-sonnet-5; the operator allowlist does not include it, "
                "so the authorized reasoning model commandcode/deepseek/deepseek-v4.1-flash was used. "
                "No criterion, budget or decision rule changed."
            ),
            "escalation_budget_max_calls": args.max_calls,
        },
        holistic_decisions=composition["decisions"]["holistic"] if holistic else None,
        escalation=escalation,
    )
    print(json.dumps({**escalation, "run": run_path.name}, indent=2, sort_keys=True))
    return 0


def cmd_mutations_supersede(args: argparse.Namespace) -> int:
    """Mark a run invalid and point it at its replacement (runs are immutable:
    evidence is never rewritten, it is annotated)."""
    from xtrm_research.annotations import append_annotation

    root = Path(args.root)
    append_annotation(
        root,
        args.run_id,
        "operator",
        "invalid_reason",
        args.reason,
    )
    append_annotation(
        root,
        args.run_id,
        "operator",
        "superseded_by",
        args.replacement,
    )
    append_annotation(
        root,
        args.run_id,
        "operator",
        "evidence_status",
        args.reason,
        evidence_status="invalid",
    )
    print(
        json.dumps(
            {
                "run": args.run_id,
                "status": "invalid",
                "superseded_by": args.replacement,
            },
            indent=2,
        )
    )
    return 0


def cmd_mutations_evaluate(args: argparse.Namespace) -> int:
    dataset_dir = Path(args.dataset)
    manifest = _load_manifest(dataset_dir)
    rows = [
        json.loads(line)
        for line in (campaign.ANSWERS_DIR / "mutations.jsonl")
        .read_text(encoding="utf-8")
        .splitlines()
        if line.strip()
    ]
    atomic = campaign.load_answers(campaign._answers_path("atomic"))
    mutated = campaign.load_answers(campaign._answers_path("mutation-answers"))
    evaluation = campaign.evaluate_mutations(rows, atomic, mutated)
    metrics = campaign.mutation_metrics(evaluation)
    definitions = publish_runs.definitions(
        Path(args.registry_root), manifest["units_sha256"], dataset_dir
    )
    run_path = publish_runs.publish_mutation_run(
        definitions,
        root=Path(args.root),
        run_id=args.run_id,
        mutation_rows=rows,
        original_answers=atomic,
        mutated_answers=mutated,
        metrics=metrics,
    )
    print(
        json.dumps(
            {k: v for k, v in evaluation.items() if k != "classes"},
            indent=2,
            sort_keys=True,
        )
    )
    for name, klass in evaluation["classes"].items():
        print(
            f"\n{name}: ok={klass['class_ok']} unexpected={klass['unexplained_movement']}"
        )
        for check in klass["checks"]:
            print(f"   {check['primitive']}: {check}")
    print(f"\nrun: {run_path.name}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="xtrm_research.planning_ready")
    parser.add_argument("--dataset", default=str(campaign.DATASET_DIR))
    parser.add_argument("--root", default=str(campaign.RUNS_ROOT))
    parser.add_argument(
        "--registry-root",
        default=str(Path(__file__).resolve().parents[3] / "registry"),
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p_collect = sub.add_parser("collect")
    p_collect.add_argument("--kind", choices=["atomic", "holistic"], required=True)
    p_collect.add_argument("--workers", type=int, default=6)
    p_collect.add_argument(
        "--limit", type=int, default=0, help="first N units only, for a smoke test"
    )
    p_collect.set_defaults(func=cmd_collect)

    p_mut = sub.add_parser("mutations")
    p_mut.add_argument("--per-class", type=int, default=20)
    p_mut.set_defaults(func=cmd_mutations)

    p_mcollect = sub.add_parser("mutations-collect")
    p_mcollect.add_argument("--workers", type=int, default=6)
    p_mcollect.set_defaults(func=cmd_mutations_collect)

    p_arms = sub.add_parser("arms")
    p_arms.set_defaults(func=cmd_arms)

    p_esc = sub.add_parser("escalate")
    p_esc.add_argument("--max-calls", type=int, default=80)
    p_esc.set_defaults(func=cmd_escalate)

    p_meval = sub.add_parser("mutations-evaluate")
    p_meval.add_argument("--run-id", default="planning-ready-v2-mutations")
    p_meval.set_defaults(func=cmd_mutations_evaluate)

    p_msup = sub.add_parser("supersede")
    p_msup.add_argument("--run-id", required=True)
    p_msup.add_argument("--replacement", required=True)
    p_msup.add_argument("--reason", required=True)
    p_msup.set_defaults(func=cmd_mutations_supersede)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
