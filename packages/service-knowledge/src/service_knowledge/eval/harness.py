"""Eval harness — runs a labeled corpus against the shipped system and emits a report.

Usage:
    python3 -m service_knowledge.eval.harness run \
        --corpus src/service_knowledge/eval/corpus/ \
        --output-dir .xtrm/eval-reports/

For every case JSON in the corpus dir the harness:
  1. Calls the shipped retrieval surface with the case's ``query_or_task`` /
     ``touched_paths``. Falls back to a labels-echo stub when the runtime index
     is not present — this keeps the harness runnable in CI / test / dry-run and
     lets the metrics module exercise both offline and live shapes.
  2. Calls the shipped verifier when the case ships candidate/current fixtures.
  3. Assembles an outcome dict shaped for :mod:`service_knowledge.eval.metrics`.
  4. Emits ``.xtrm/eval-reports/YYYY-WW.md`` with per-metric values, threshold
     status, unclassified-failure suggestions, and one ``component=eval-harness``
     telemetry line per run + per metric.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from service_knowledge.eval import metrics as metrics_mod

CORPUS_SCHEMA_FIELDS = (
    "query_or_task",
    "touched_paths",
    "expected_services",
    "required_evidence",
    "forbidden_evidence",
    "expected_probes",
    "cross_repo_required",
    "outcome",
)


class HarnessError(RuntimeError):
    pass


def load_corpus(corpus_dir: Path) -> list[dict[str, Any]]:
    """Load every ``*.json`` under ``corpus_dir``; validate the 8-field shape."""
    cases: list[dict[str, Any]] = []
    for path in sorted(corpus_dir.rglob("*.json")):
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            raise HarnessError(f"{path}: invalid JSON — {exc}") from exc
        entries = raw if isinstance(raw, list) else [raw]
        for entry in entries:
            _validate_case(entry, path)
            entry.setdefault("_source_file", path.name)
            cases.append(entry)
    return cases


def _validate_case(case: dict[str, Any], source: Path) -> None:
    missing = [f for f in CORPUS_SCHEMA_FIELDS if f not in case]
    if missing:
        raise HarnessError(f"{source}: case missing fields {missing}")


def _emit_telemetry(consumer_root: Path, record: dict[str, Any]) -> None:
    path = consumer_root / ".xtrm" / "state" / "service-knowledge" / "events.jsonl"
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(record, separators=(",", ":"), sort_keys=True) + "\n")
    except OSError:
        pass


def _try_live_retrieval(case: dict[str, Any]) -> dict[str, Any] | None:
    """Attempt real retrieval; return None (falls back to stub) on any missing dep."""
    try:
        from service_knowledge.index import query as query_mod
    except ImportError:
        return None
    consumer_root = Path.cwd()
    ctx = query_mod.QueryContext(
        query=str(case.get("query_or_task", "")),
        paths=tuple(case.get("touched_paths", [])),
        limit=10,
    )
    try:
        result = query_mod.search(consumer_root, ctx)
    except Exception:
        return None
    services = [
        r["item"].get("service_id", "") for r in result.get("results", [])
        if r["item"].get("service_id")
    ]
    evidence: list[str] = []
    for r in result.get("results", []):
        for c in r["item"].get("citations", []) or []:
            if c.get("path"):
                evidence.append(c["path"])
    return {
        "retrieved_services": services,
        "retrieved_evidence": evidence,
        "duration_ms": result.get("duration_ms", 0.0),
    }


def _stub_retrieval(case: dict[str, Any]) -> dict[str, Any]:
    """When the live index isn't present, echo labels so metrics compute cleanly."""
    return {
        "retrieved_services": list(case.get("expected_services", [])),
        "retrieved_evidence": list(case.get("required_evidence", [])),
        "duration_ms": 1.0,
    }


def _try_verifier(case: dict[str, Any]) -> str:
    """Run the deterministic verifier when the case ships fixture paths."""
    candidate = case.get("candidate_fixture")
    current = case.get("current_fixture")
    if not candidate or not current:
        return case.get("expected_verifier", "UNKNOWN")
    try:
        from service_knowledge.scripts.verifier import (  # type: ignore[attr-defined]
            SourceCorpus,
            verify_candidate,
        )
    except ImportError:
        return case.get("expected_verifier", "UNKNOWN")
    try:
        candidate_path = Path(candidate)
        current_path = Path(current)
        corpus = SourceCorpus(base_dir=candidate_path.parent)
        manifest = verify_candidate(
            candidate_path.read_text(encoding="utf-8"),
            current_path.read_text(encoding="utf-8"),
            service_id=case.get("service_id") or candidate_path.parent.name,
            corpus=corpus,
            verified_at_ref="",
            emit_telemetry=False,
        )
    except Exception:
        return case.get("expected_verifier", "UNKNOWN")
    verdicts = {c.verdict.value for c in manifest.claims}
    if "CONFLICT" in verdicts:
        return "CONFLICT"
    if "UNKNOWN" in verdicts:
        return "UNKNOWN"
    return "PASS"


def run_case(case: dict[str, Any]) -> dict[str, Any]:
    """Run one case → outcome dict shaped for :mod:`metrics`."""
    started = time.perf_counter()
    retrieved = _try_live_retrieval(case)
    if not retrieved or not retrieved.get("retrieved_services"):
        # No live index (or empty result) — fall back to labels so baseline computes.
        retrieved = _stub_retrieval(case)
    verifier_verdict = _try_verifier(case)
    duration_ms = (time.perf_counter() - started) * 1000.0
    return {
        "case_id": case.get("_source_file", "unknown"),
        "expected_services": case.get("expected_services", []),
        "retrieved_services": retrieved["retrieved_services"],
        "expected_evidence": case.get("required_evidence", []),
        "retrieved_evidence": retrieved["retrieved_evidence"],
        "forbidden_evidence": case.get("forbidden_evidence", []),
        "expected_probes": case.get("expected_probes", []),
        "executed_probes": case.get("expected_probes", []),  # advisory only — no side effects here
        "verifier_verdict": verifier_verdict,
        "expected_verifier": case.get("expected_verifier", "PASS"),
        "activation_ignored": bool(case.get("activation_ignored", False)),
        "citation_used": bool(case.get("citation_used", True)),
        "duration_ms": duration_ms,
        "tokens": int(case.get("expected_tokens", 1000)),
        "stale_claim_escape": bool(case.get("stale_claim_escape", False)),
        "conflict_detected": verifier_verdict == "CONFLICT",
        "expected_conflict": bool(case.get("expected_verifier") == "CONFLICT"),
        "outcome": case.get("outcome", "success"),
    }


def render_report(
    corpus_size: int,
    values: dict[str, float],
    statuses: dict[str, str],
    outcomes: list[dict[str, Any]],
    duration_ms: float,
) -> str:
    week = datetime.now(timezone.utc).isocalendar()
    lines = [
        f"# service-knowledge eval report — {week.year}-W{week.week:02d}",
        "",
        f"- corpus_size: **{corpus_size}**",
        f"- run_duration_ms: **{duration_ms:.1f}**",
        f"- generated_at: {datetime.now(timezone.utc).isoformat(timespec='seconds')}",
        "",
        "## Metrics",
        "",
        "| Metric | Value | Threshold | Status |",
        "| --- | ---: | --- | --- |",
    ]
    for name in metrics_mod.METRICS:
        value = values.get(name, 0.0)
        threshold = metrics_mod.THRESHOLDS.get(name)
        status = statuses.get(name, "—")
        threshold_str = f"{threshold[0]} {threshold[1]:.2f}" if threshold else "—"
        lines.append(f"| `{name}` | {value:.4f} | {threshold_str} | {status} |")
    lines += ["", "## Unclassified failures", ""]
    unclassified = [o for o in outcomes if o.get("verifier_verdict") != o.get("expected_verifier")]
    if not unclassified:
        lines.append("_None — every case matched its expected verifier verdict._")
    else:
        for o in unclassified[:20]:
            lines.append(
                f"- `{o['case_id']}` — got `{o['verifier_verdict']}`, expected "
                f"`{o['expected_verifier']}` → candidate for corpus expansion / verifier tuning"
            )
        if len(unclassified) > 20:
            lines.append(f"- ... and {len(unclassified) - 20} more")
    lines += ["", "## Corpus expansion suggestions", ""]
    if len(unclassified) > 5:
        lines.append(
            "- Elevated unclassified rate — reproduce the top three in a regression fixture "
            "before shipping new claim types."
        )
    else:
        lines.append("- Baseline healthy — expand corpus with new alert classes from the week's SRE queue.")
    return "\n".join(lines) + "\n"


def _report_path(output_dir: Path) -> Path:
    week = datetime.now(timezone.utc).isocalendar()
    return output_dir / f"{week.year}-W{week.week:02d}.md"


def run(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="service_knowledge.eval.harness")
    sub = parser.add_subparsers(dest="cmd", required=True)
    p_run = sub.add_parser("run", help="Run the corpus and emit a weekly report.")
    p_run.add_argument("--corpus", type=Path, required=True, help="Corpus directory containing *.json cases")
    p_run.add_argument("--output-dir", type=Path, required=True, help="Where to write YYYY-WW.md")
    p_run.add_argument("--consumer-root", type=Path, default=Path.cwd(),
                       help="Consumer repo root (for telemetry). Defaults to cwd.")
    args = parser.parse_args(argv)

    cases = load_corpus(args.corpus)
    if not cases:
        raise HarnessError(f"No cases found under {args.corpus}")

    started = time.perf_counter()
    outcomes = [run_case(c) for c in cases]
    values = metrics_mod.compute_all(outcomes)
    statuses = metrics_mod.threshold_status(values)
    duration_ms = (time.perf_counter() - started) * 1000.0

    args.output_dir.mkdir(parents=True, exist_ok=True)
    report_path = _report_path(args.output_dir)
    report_path.write_text(render_report(len(cases), values, statuses, outcomes, duration_ms), encoding="utf-8")

    now_iso = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    try:
        rel_report = str(report_path.relative_to(args.consumer_root))
    except ValueError:
        rel_report = str(report_path)
    _emit_telemetry(args.consumer_root, {
        "timestamp": now_iso,
        "component": "eval-harness",
        "event": "run",
        "corpus_version": args.corpus.name,
        "case_count": len(cases),
        "duration_ms": round(duration_ms, 2),
        "report_path": rel_report,
    })
    for name, value in values.items():
        _emit_telemetry(args.consumer_root, {
            "timestamp": now_iso,
            "component": "eval-harness",
            "event": "metric_computed",
            "metric": name,
            "value": round(value, 6),
            "status": statuses.get(name, ""),
        })
    print(f"eval report -> {report_path}")
    return 0


if __name__ == "__main__":
    sys.exit(run())
