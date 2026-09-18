"""xtrm-research CLI entry point.

``--root``/``--json`` are accepted both before and after the subcommand
(argparse merges them via SUPPRESS-defaulted duplicates on every
subparser). No command ever lets an exception escape as a traceback: every
failure becomes an ``ok: false`` envelope (or a plain ``error:`` line in
human mode) and a non-zero exit code.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from xtrm_research.annotations import (
    append_annotation,
    latest_conclusion,
    latest_evidence_status,
    list_annotations,
)
from xtrm_research.cli.envelope import error_envelope, ok_envelope
from xtrm_research.definitions import DefinitionRegistry
from xtrm_research.jsonl import read_lines
from xtrm_research.lineage import format_tree, lineage_tree
from xtrm_research.status import effective_status
from xtrm_research.store import (
    DEFAULT_RUNS_ROOT,
    events_path,
    list_run_ids,
    load_manifest,
    manifest_path,
)
from xtrm_research.views import chart_dataset_rows, compare_runs, run_summary


def _emit(command: str, data: Any, as_json: bool) -> None:
    if as_json:
        print(json.dumps(ok_envelope(command, data), sort_keys=True))
    else:
        print(json.dumps(data, indent=2, sort_keys=True, default=str))


def _emit_error(command: str, error: str, as_json: bool) -> None:
    if as_json:
        print(json.dumps(error_envelope(command, error), sort_keys=True))
    else:
        print(f"error: {error}", file=sys.stderr)


def _runs_row(root: Path, run_id: str) -> dict[str, Any]:
    """One `runs` row. A run whose manifest.json fails to load or
    validate is reported as an `invalid_manifest` row with the reason,
    rather than failing the whole listing."""
    try:
        manifest = load_manifest(root, run_id)
        return {
            "id": run_id,
            "experiment": manifest["experiment"]["id"],
            "variant": manifest["variant"]["id"],
            "trigger": manifest["intent"]["trigger"],
            "status": _run_status(root, run_id),
            "purpose": manifest["intent"]["purpose"],
            "latest_conclusion": latest_conclusion(root, run_id),
            "evidence_status": latest_evidence_status(root, run_id),
        }
    except Exception as exc:
        return {
            "id": run_id,
            "experiment": None,
            "variant": None,
            "trigger": None,
            "status": "invalid_manifest",
            "purpose": None,
            "latest_conclusion": None,
            "evidence_status": None,
            "error": f"{type(exc).__name__}: {exc}",
        }


def _cmd_runs(args: argparse.Namespace) -> None:
    root = Path(args.root)
    if args.lineage:
        tree = lineage_tree(root, args.lineage)
        if args.json:
            _emit("runs", tree, True)
        else:
            print(format_tree(tree))
        return
    rows = [_runs_row(root, run_id) for run_id in list_run_ids(root)]
    _emit("runs", rows, args.json)


def _run_status(root: Path, run_id: str) -> str:
    from xtrm_research.store import load_status

    return effective_status(load_status(root, run_id))


def _cmd_run_show(args: argparse.Namespace) -> None:
    root = Path(args.root)
    if not manifest_path(root, args.run_id).exists():
        raise FileNotFoundError(f"no such run: {args.run_id!r}")
    manifest = load_manifest(root, args.run_id)
    data = {
        "manifest": manifest,
        "status": _run_status(root, args.run_id),
        "annotations": list_annotations(root, args.run_id),
    }
    _emit("run show", data, args.json)


def _cmd_run_annotate(args: argparse.Namespace) -> None:
    root = Path(args.root)
    annotation = append_annotation(
        root,
        args.run_id,
        args.author,
        args.kind,
        args.text,
        evidence_status=args.evidence_status,
    )
    _emit("run annotate", annotation, args.json)


def _cmd_experiment_show(args: argparse.Namespace) -> None:
    registry = DefinitionRegistry(Path(args.registry_root))
    experiment = (
        registry.get("experiment", args.experiment_id, args.version)
        if args.version
        else registry.latest("experiment", args.experiment_id)
    )
    _emit("experiment show", experiment, args.json)


def _cmd_workload_show(args: argparse.Namespace) -> None:
    registry = DefinitionRegistry(Path(args.registry_root))
    workload = (
        registry.get("workload", args.workload_id, args.version)
        if args.version
        else registry.latest("workload", args.workload_id)
    )
    _emit("workload show", workload, args.json)


def _cmd_tail(args: argparse.Namespace) -> None:
    root = Path(args.root)
    if not manifest_path(root, args.run_id).exists():
        raise FileNotFoundError(f"no such run: {args.run_id!r}")
    events = [
        e for e in read_lines(events_path(root, args.run_id)) if e["seq"] > args.after
    ]
    next_offset = max((e["seq"] for e in events), default=args.after)
    _emit("tail", {"events": events, "next_offset": next_offset}, args.json)


def _cmd_chart_data(args: argparse.Namespace) -> None:
    root = Path(args.root)
    for run_id in args.run_ids:
        # Fail the whole verb (never an empty success): an unknown run
        # or an unreadable manifest is an explicit ok:false, not a gap.
        load_manifest(root, run_id)
    rows = chart_dataset_rows(root, args.run_ids, args.metric)
    present = {row["run_id"] for row in rows}
    out = list(rows)
    for run_id in args.run_ids:
        if run_id not in present:
            out.append(
                {
                    "run_id": run_id,
                    "state": "no_metric",
                    "reason": f"run {run_id!r} has no metric {args.metric!r}",
                }
            )
    _emit("chart-data", out, args.json)


def _cmd_metrics(args: argparse.Namespace) -> None:
    root = Path(args.root)
    _emit("metrics", run_summary(root, args.run_id), args.json)


def _cmd_compare(args: argparse.Namespace) -> None:
    root = Path(args.root)
    _emit("compare", compare_runs(root, args.run_ids), args.json)


def _add_common(p: argparse.ArgumentParser, *, top_level: bool = False) -> None:
    if top_level:
        p.add_argument(
            "--root", default=str(DEFAULT_RUNS_ROOT), help="run directory root"
        )
        p.add_argument(
            "--json", action="store_true", help="emit the xtrm-research-cli/v1 envelope"
        )
    else:
        # SUPPRESS default: if not given here, the value already parsed at
        # an outer parser level (or the top-level default) is left alone.
        p.add_argument("--root", default=argparse.SUPPRESS)
        p.add_argument("--json", action="store_true", default=argparse.SUPPRESS)


class _ArgparseUsageError(Exception):
    """Raised instead of argparse's default sys.exit(2), so a usage error
    (bad/missing/unknown argument) can become a CLI envelope like every
    other failure, when --json was requested."""


class _EnvelopeArgumentParser(argparse.ArgumentParser):
    def error(self, message: str) -> None:  # type: ignore[override]
        raise _ArgparseUsageError(message)


def build_parser() -> argparse.ArgumentParser:
    # add_subparsers defaults parser_class to type(self), so every
    # subparser below is a _EnvelopeArgumentParser too.
    parser = _EnvelopeArgumentParser(prog="xtrm-research")
    _add_common(parser, top_level=True)
    sub = parser.add_subparsers(dest="command", required=True)

    p_runs = sub.add_parser("runs")
    _add_common(p_runs)
    p_runs.add_argument("--lineage", metavar="RUN_ID")
    p_runs.set_defaults(func=_cmd_runs)

    p_run = sub.add_parser("run")
    _add_common(p_run)
    run_sub = p_run.add_subparsers(dest="run_command", required=True)

    p_run_show = run_sub.add_parser("show")
    _add_common(p_run_show)
    p_run_show.add_argument("run_id")
    p_run_show.set_defaults(func=_cmd_run_show)

    p_run_annotate = run_sub.add_parser("annotate")
    _add_common(p_run_annotate)
    p_run_annotate.add_argument("run_id")
    p_run_annotate.add_argument("--author", required=True)
    p_run_annotate.add_argument(
        "--kind",
        required=True,
        choices=[
            "conclusion",
            "caveat",
            "superseded_by",
            "invalid_reason",
            "evidence_status",
        ],
    )
    p_run_annotate.add_argument("--text", required=True)
    p_run_annotate.add_argument(
        "--evidence-status",
        dest="evidence_status",
        default=None,
        choices=[
            "exploratory",
            "reproducible",
            "validated",
            "regression",
            "superseded",
            "invalid",
        ],
    )
    p_run_annotate.set_defaults(func=_cmd_run_annotate)

    p_experiment = sub.add_parser("experiment")
    _add_common(p_experiment)
    experiment_sub = p_experiment.add_subparsers(
        dest="experiment_command", required=True
    )
    p_experiment_show = experiment_sub.add_parser("show")
    _add_common(p_experiment_show)
    p_experiment_show.add_argument("experiment_id")
    p_experiment_show.add_argument("--version", default=None)
    p_experiment_show.add_argument("--registry-root", required=True)
    p_experiment_show.set_defaults(func=_cmd_experiment_show)

    p_workload = sub.add_parser("workload")
    _add_common(p_workload)
    workload_sub = p_workload.add_subparsers(dest="workload_command", required=True)
    p_workload_show = workload_sub.add_parser("show")
    _add_common(p_workload_show)
    p_workload_show.add_argument("workload_id")
    p_workload_show.add_argument("--version", default=None)
    p_workload_show.add_argument("--registry-root", required=True)
    p_workload_show.set_defaults(func=_cmd_workload_show)

    p_tail = sub.add_parser("tail")
    _add_common(p_tail)
    p_tail.add_argument("run_id")
    p_tail.add_argument("--after", type=int, default=-1)
    p_tail.set_defaults(func=_cmd_tail)

    p_metrics = sub.add_parser("metrics")
    _add_common(p_metrics)
    p_metrics.add_argument("run_id")
    p_metrics.set_defaults(func=_cmd_metrics)

    p_compare = sub.add_parser("compare")
    _add_common(p_compare)
    p_compare.add_argument("run_ids", nargs="+")
    p_compare.set_defaults(func=_cmd_compare)

    p_chart = sub.add_parser("chart-data")
    _add_common(p_chart)
    p_chart.add_argument("run_ids", nargs="+", metavar="RUN_ID")
    p_chart.add_argument("--metric", required=True)
    p_chart.set_defaults(func=_cmd_chart_data)

    return parser


def main(argv: list[str] | None = None) -> int:
    raw_argv = list(argv if argv is not None else sys.argv[1:])
    parser = build_parser()
    try:
        args = parser.parse_args(raw_argv)
    except _ArgparseUsageError as exc:
        # argparse's own default (usage text to stderr, exit 2) still
        # applies when --json wasn't requested; only wrap it in an
        # envelope when the caller asked for one, since we can't rely on
        # a parsed --json here — parsing itself is what failed.
        if "--json" in raw_argv:
            _emit_error("cli", str(exc), True)
        else:
            parser.print_usage(sys.stderr)
            print(f"{parser.prog}: error: {exc}", file=sys.stderr)
        return 2

    command = " ".join(
        part
        for part in (args.command, getattr(args, f"{args.command}_command", None))
        if part
    )
    as_json = getattr(args, "json", False)
    try:
        args.func(args)
        return 0
    except SystemExit:
        raise
    except Exception as exc:  # every failure is an envelope, never a traceback
        _emit_error(command, f"{type(exc).__name__}: {exc}", as_json)
        return 1


if __name__ == "__main__":
    sys.exit(main())
