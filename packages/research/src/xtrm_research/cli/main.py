"""xtrm-research CLI entry point."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from xtrm_research.annotations import append_annotation, latest_conclusion, latest_evidence_status, list_annotations
from xtrm_research.cli.envelope import error_envelope, ok_envelope
from xtrm_research.definitions import DefinitionRegistry
from xtrm_research.jsonl import read_lines
from xtrm_research.lineage import lineage_tree
from xtrm_research.schemas import SchemaValidationError
from xtrm_research.status import effective_status
from xtrm_research.store import DEFAULT_RUNS_ROOT, events_path, list_run_ids, load_manifest
from xtrm_research.views import compare_runs, run_metrics


def _emit(command: str, data: Any, as_json: bool) -> None:
    if as_json:
        print(json.dumps(ok_envelope(command, data), sort_keys=True))
    else:
        print(json.dumps(data, indent=2, sort_keys=True))


def _emit_error(command: str, error: str, as_json: bool) -> None:
    if as_json:
        print(json.dumps(error_envelope(command, error), sort_keys=True))
    else:
        print(f"error: {error}", file=sys.stderr)


def _cmd_runs(args: argparse.Namespace) -> None:
    root = Path(args.root)
    if args.lineage:
        data = lineage_tree(root, args.lineage)
        _emit("runs", data, args.json)
        return
    rows = []
    for run_id in list_run_ids(root):
        manifest = load_manifest(root, run_id)
        rows.append(
            {
                "id": run_id,
                "experiment": manifest["experiment"]["id"],
                "variant": manifest["variant"]["id"],
                "trigger": manifest["intent"]["trigger"],
                "status": effective_status(manifest["status"]),
                "purpose": manifest["intent"]["purpose"],
                "latest_conclusion": latest_conclusion(root, run_id),
                "evidence_status": latest_evidence_status(root, run_id),
            }
        )
    _emit("runs", rows, args.json)


def _cmd_run_show(args: argparse.Namespace) -> None:
    root = Path(args.root)
    manifest = load_manifest(root, args.run_id)
    data = {
        "manifest": manifest,
        "status": effective_status(manifest["status"]),
        "annotations": list_annotations(root, args.run_id),
    }
    _emit("run show", data, args.json)


def _cmd_run_annotate(args: argparse.Namespace) -> None:
    root = Path(args.root)
    annotation = append_annotation(
        root, args.run_id, args.author, args.kind, args.text, evidence_status=args.evidence_status
    )
    _emit("run annotate", annotation, args.json)


def _cmd_experiment_show(args: argparse.Namespace) -> None:
    registry = DefinitionRegistry(Path(args.registry_root))
    experiment = registry.get("experiment", args.experiment_id, args.version) if args.version else registry.latest("experiment", args.experiment_id)
    _emit("experiment show", experiment, args.json)


def _cmd_workload_show(args: argparse.Namespace) -> None:
    registry = DefinitionRegistry(Path(args.registry_root))
    workload = registry.get("workload", args.workload_id, args.version) if args.version else registry.latest("workload", args.workload_id)
    _emit("workload show", workload, args.json)


def _cmd_tail(args: argparse.Namespace) -> None:
    root = Path(args.root)
    events = [e for e in read_lines(events_path(root, args.run_id)) if e["seq"] > args.after]
    next_offset = max((e["seq"] for e in events), default=args.after)
    _emit("tail", {"events": events, "next_offset": next_offset}, args.json)


def _cmd_metrics(args: argparse.Namespace) -> None:
    root = Path(args.root)
    _emit("metrics", run_metrics(root, args.run_id), args.json)


def _cmd_compare(args: argparse.Namespace) -> None:
    root = Path(args.root)
    _emit("compare", compare_runs(root, args.run_ids), args.json)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="xtrm-research")
    parser.add_argument("--root", default=str(DEFAULT_RUNS_ROOT), help="run directory root")
    parser.add_argument("--json", action="store_true", help="emit the xtrm-research-cli/v1 envelope")
    sub = parser.add_subparsers(dest="command", required=True)

    p_runs = sub.add_parser("runs")
    p_runs.add_argument("--lineage", metavar="RUN_ID")
    p_runs.set_defaults(func=_cmd_runs)

    p_run = sub.add_parser("run")
    run_sub = p_run.add_subparsers(dest="run_command", required=True)

    p_run_show = run_sub.add_parser("show")
    p_run_show.add_argument("run_id")
    p_run_show.set_defaults(func=_cmd_run_show)

    p_run_annotate = run_sub.add_parser("annotate")
    p_run_annotate.add_argument("run_id")
    p_run_annotate.add_argument("--author", required=True)
    p_run_annotate.add_argument(
        "--kind", required=True,
        choices=["conclusion", "caveat", "superseded_by", "invalid_reason", "evidence_status"],
    )
    p_run_annotate.add_argument("--text", required=True)
    p_run_annotate.add_argument(
        "--evidence-status", dest="evidence_status", default=None,
        choices=["exploratory", "reproducible", "validated", "regression", "superseded", "invalid"],
    )
    p_run_annotate.set_defaults(func=_cmd_run_annotate)

    p_experiment = sub.add_parser("experiment")
    experiment_sub = p_experiment.add_subparsers(dest="experiment_command", required=True)
    p_experiment_show = experiment_sub.add_parser("show")
    p_experiment_show.add_argument("experiment_id")
    p_experiment_show.add_argument("--version", default=None)
    p_experiment_show.add_argument("--registry-root", required=True)
    p_experiment_show.set_defaults(func=_cmd_experiment_show)

    p_workload = sub.add_parser("workload")
    workload_sub = p_workload.add_subparsers(dest="workload_command", required=True)
    p_workload_show = workload_sub.add_parser("show")
    p_workload_show.add_argument("workload_id")
    p_workload_show.add_argument("--version", default=None)
    p_workload_show.add_argument("--registry-root", required=True)
    p_workload_show.set_defaults(func=_cmd_workload_show)

    p_tail = sub.add_parser("tail")
    p_tail.add_argument("run_id")
    p_tail.add_argument("--after", type=int, default=-1)
    p_tail.set_defaults(func=_cmd_tail)

    p_metrics = sub.add_parser("metrics")
    p_metrics.add_argument("run_id")
    p_metrics.set_defaults(func=_cmd_metrics)

    p_compare = sub.add_parser("compare")
    p_compare.add_argument("run_ids", nargs="+")
    p_compare.set_defaults(func=_cmd_compare)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    command = " ".join(
        part for part in (args.command, getattr(args, f"{args.command}_command", None)) if part
    )
    try:
        args.func(args)
        return 0
    except (SchemaValidationError, ValueError, FileNotFoundError) as exc:
        _emit_error(command, str(exc), args.json)
        return 1


if __name__ == "__main__":
    sys.exit(main())
