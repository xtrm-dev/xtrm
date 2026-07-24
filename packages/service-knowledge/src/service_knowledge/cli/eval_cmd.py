"""``service-knowledge eval`` — run the labeled corpus + emit the weekly §3.9 report.

``run`` materializes a throwaway consumer from the corpus, drives every case through the shipped
index + verifier, aggregates the twelve metrics and writes ``YYYY-WW.md`` (+ a JSON sidecar) to the
report dir (default ``.beads/eval-reports``). Stdlib-only; mirrors the ``index`` subcommand shape.
"""
from __future__ import annotations

import argparse
import tempfile
from pathlib import Path

from service_knowledge.eval import harness, report
from service_knowledge.eval.metrics import METRIC_ROWS

_DEFAULT_CORPUS = Path(__file__).resolve().parent.parent / "eval" / "corpus"


def _resolve_report_dir(raw: str | None) -> Path:
    if raw:
        return Path(raw)
    return Path(".beads") / "eval-reports"


def _cmd_run(args: argparse.Namespace) -> int:
    corpus_dir = Path(args.corpus) if args.corpus else _DEFAULT_CORPUS
    report_dir = _resolve_report_dir(args.out)
    week_label = args.week or harness.iso_week_label()
    report_dir.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix="sk-eval-") as tmp:
        metric_report, outcomes = harness.run_corpus(
            corpus_dir, Path(tmp), corpus_version=args.corpus_version, report_dir=report_dir
        )

    previous_sidecar = report.find_previous_sidecar(report_dir, week_label)
    previous_values = report.parse_previous_values(previous_sidecar)

    unclassified = [
        f"{outcome.case_id}: predicted {sorted(outcome.predicted_services) or '∅'} "
        f"vs expected {sorted(outcome.expected_services)}"
        for outcome in outcomes
        if outcome.expected_services and not (outcome.predicted_services & outcome.expected_services)
    ]

    markdown = report.render_markdown(
        metric_report,
        week_label=week_label,
        corpus_version=args.corpus_version,
        previous_values=previous_values,
        unclassified_failures=unclassified,
    )
    (report_dir / f"{week_label}.md").write_text(markdown, encoding="utf-8")
    (report_dir / f"{week_label}.json").write_text(
        report.render_json(metric_report, week_label=week_label, corpus_version=args.corpus_version),
        encoding="utf-8",
    )

    print(f"eval report: {report_dir / f'{week_label}.md'}")
    print(f"cases: {metric_report.case_count}")
    for name in METRIC_ROWS:
        print(f"  {name}: {metric_report.values.get(name)} [{metric_report.status.get(name)}]")
    return 0


def register(subparsers: argparse._SubParsersAction) -> None:
    parser = subparsers.add_parser(
        "eval",
        help="Run the labeled eval corpus + emit the weekly §3.9 report.",
        description="Run the labeled eval corpus + emit the weekly §3.9 report.",
    )
    action = parser.add_subparsers(dest="eval_command", metavar="<action>")
    run_parser = action.add_parser("run", help="Run the corpus and write the weekly report.")
    run_parser.add_argument("--corpus", default=None, help="Corpus dir (default: packaged corpus).")
    run_parser.add_argument("--out", default=None, help="Report dir (default: .beads/eval-reports).")
    run_parser.add_argument("--week", default=None, help="Override YYYY-WW label (default: current ISO week).")
    run_parser.add_argument("--corpus-version", default="dev", help="Corpus version tag recorded in telemetry.")
    run_parser.set_defaults(func=_cmd_run)
    parser.set_defaults(func=lambda args: (parser.print_help() or 2))


def run(args: argparse.Namespace) -> int:
    func = getattr(args, "func", None)
    if func is None:
        return 2
    return func(args)
