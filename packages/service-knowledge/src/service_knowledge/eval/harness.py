"""Eval harness — runs the labeled corpus against the shipped system (research §3.9).

The harness is self-contained: it materializes a throwaway git consumer from the service
definitions embedded in the corpus, builds the real FTS5 index, then drives every case through
``index.search`` / ``index.evidence_for_files`` (retrieval + routing + probes + stale-claim escape)
and, for cases carrying a ``verifier`` block, the PR1 verifier gate (FP/FN accounting). The twelve
§3.9 metrics are aggregated by :mod:`service_knowledge.eval.metrics`.

Structured telemetry: one ``component=eval-harness`` line per run and one per computed metric, so
``grep component=eval-harness`` finds exactly ``1 + 12`` lines per invocation.
"""
from __future__ import annotations

import json
import subprocess
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from service_knowledge.eval import metrics
from service_knowledge.eval.metrics import CaseOutcome, MetricReport

SKILL_TEMPLATE = """---
name: {sid}
description: >-
  {description}
allowed-tools: Read, Bash(python3 *)
---
# {title} Expert

## Service Overview
{overview}

## Architecture
Entry point: cmd/{sid}/main.go. Container name: {sid}.

## Cross-Service Health Check
```bash
python3 scripts/health_probe.py --json
```

## Failure Modes
| Symptom | Cause | Fix |
|---|---|---|
| {fail_symptom} | {fail_cause} | tune {sid}/config.yml |

## Deploy & Runbook
Deploy via docker compose. See {sid}/deploy/README.md.
{extra_sections}
"""


@dataclass(frozen=True)
class CorpusCase:
    """One labeled eval case (§3.9 fields + harness support blocks)."""

    case_id: str
    provenance: dict[str, Any]
    category: str
    query_or_task: str
    touched_paths: tuple[str, ...]
    expected_services: tuple[str, ...]
    required_evidence: tuple[str, ...]
    forbidden_evidence: tuple[str, ...]
    expected_probes: tuple[str, ...]
    cross_repo_required: bool
    outcome: str
    service_defs: dict[str, dict[str, Any]] = field(default_factory=dict)
    verifier: dict[str, Any] | None = None

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> "CorpusCase":
        return cls(
            case_id=str(raw["id"]),
            provenance=dict(raw.get("provenance", {})),
            category=str(raw.get("category", "general")),
            query_or_task=str(raw.get("query_or_task", "")),
            touched_paths=tuple(raw.get("touched_paths", [])),
            expected_services=tuple(raw.get("expected_services", [])),
            required_evidence=tuple(raw.get("required_evidence", [])),
            forbidden_evidence=tuple(raw.get("forbidden_evidence", [])),
            expected_probes=tuple(raw.get("expected_probes", [])),
            cross_repo_required=bool(raw.get("cross_repo_required", False)),
            outcome=str(raw.get("outcome", "")),
            service_defs=dict(raw.get("service_defs", {})),
            verifier=raw.get("verifier"),
        )


def load_corpus(corpus_dir: Path) -> list[CorpusCase]:
    """Load every ``*.json`` case under ``corpus_dir`` (sorted for determinism)."""
    cases: list[CorpusCase] = []
    for path in sorted(Path(corpus_dir).glob("*.json")):
        if path.name.startswith("_"):
            continue  # schema / metadata files are not cases
        cases.append(CorpusCase.from_dict(json.loads(path.read_text(encoding="utf-8"))))
    return cases


def _git(args: list[str], cwd: Path) -> None:
    subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True)


def _init_git(repo: Path) -> str:
    _git(["init", "-q"], repo)
    _git(["config", "user.email", "eval@service-knowledge"], repo)
    _git(["config", "user.name", "eval-harness"], repo)
    _git(["add", "-A"], repo)
    _git(["commit", "-qm", "eval corpus consumer"], repo)
    return subprocess.run(
        ["git", "-C", str(repo), "rev-parse", "HEAD"], capture_output=True, text=True, check=True
    ).stdout.strip()


def build_eval_consumer(workdir: Path, cases: list[CorpusCase]) -> Path:
    """Materialize one git consumer holding the union of every case's service definitions."""
    repo = workdir / "eval-consumer"
    umbrella = repo / ".xtrm" / "skills" / "infra" / "service-knowledge"
    registry_services: dict[str, dict[str, Any]] = {}

    merged: dict[str, dict[str, Any]] = {}
    for case in cases:
        for service_id, definition in case.service_defs.items():
            merged.setdefault(service_id, definition)

    for service_id, definition in merged.items():
        service_dir = umbrella / "services" / service_id
        service_dir.mkdir(parents=True, exist_ok=True)
        skill = definition.get("skill") or SKILL_TEMPLATE.format(
            sid=service_id,
            title=service_id.replace("-", " ").title(),
            description=definition.get("description", f"{service_id} operational service."),
            overview=definition.get("overview", f"{service_id} core behaviour."),
            fail_symptom=definition.get("fail_symptom", "high latency"),
            fail_cause=definition.get("fail_cause", "saturated pool"),
            extra_sections=definition.get("extra_sections", ""),
        )
        (service_dir / "SKILL.md").write_text(skill, encoding="utf-8")
        territory = list(definition.get("territory", [f"{service_id}/**"]))
        top = territory[0].split("/")[0]
        (repo / top).mkdir(parents=True, exist_ok=True)
        (repo / top / "config.yml").write_text("key: value\n", encoding="utf-8")
        registry_services[service_id] = {
            "name": service_id,
            "description": definition.get("description", f"{service_id} service."),
            "skill_path": f".xtrm/skills/infra/service-knowledge/services/{service_id}/SKILL.md",
            "territory": territory,
            "triggers": list(definition.get("triggers", [service_id])),
            "last_sync_ref": "",
        }

    registry = {"version": "1.0", "pack": "infra", "services": registry_services}
    umbrella.mkdir(parents=True, exist_ok=True)
    (umbrella / "service-registry.json").write_text(json.dumps(registry, indent=2) + "\n", encoding="utf-8")
    _init_git(repo)
    return repo


def _relevant_item_ids(consumer_root: Path, service_ids: set[str]) -> set[str]:
    """All indexed item ids owned by ``service_ids`` — the retrieval recall denominator."""
    from service_knowledge.index import schema

    if not service_ids:
        return set()
    conn = schema.connect(consumer_root)
    try:
        placeholders = ",".join("?" for _ in service_ids)
        rows = conn.execute(
            f"SELECT id FROM sk_items WHERE service_id IN ({placeholders})", tuple(service_ids)
        ).fetchall()
        return {str(row["id"]) for row in rows}
    finally:
        conn.close()


def _bundle_text_fragments(bundle: dict[str, Any]) -> str:
    """Concatenated searchable surface of a bundle — used for forbidden-label escape detection."""
    parts: list[str] = []
    for item in bundle.get("items", []):
        parts.extend([str(item.get("title", "")), str(item.get("section_path", "")), str(item.get("text", ""))])
    return "\n".join(parts).casefold()


def _run_verifier_case(case: CorpusCase, outcome: CaseOutcome) -> None:
    """Populate verifier FP/FN accounting for a case carrying a ``verifier`` block."""
    block = case.verifier
    if not block:
        return
    try:
        from service_knowledge.scripts.verifier import SourceCorpus, compute_gate, verify_candidate
    except (ImportError, OSError, RuntimeError):
        return

    corpus_files = dict(block.get("corpus_files", {}))
    corpus = SourceCorpus(base_dir=Path("."), files=corpus_files) if corpus_files else None
    manifest = verify_candidate(
        str(block.get("candidate", "")),
        str(block.get("current", "")),
        service_id=str(block.get("service_id", case.expected_services[0] if case.expected_services else "unknown")),
        corpus=corpus,
        verified_at_ref=str(block.get("verified_at_ref", "")),
        emit_telemetry=False,
    )
    decision = compute_gate(manifest)
    blocked = decision.blocks_pr
    expect_block = bool(block.get("expect_block", False))

    try:
        from service_knowledge.scripts.verifier import accounting
    except (ImportError, OSError, RuntimeError):
        cell = "true_positive" if (expect_block and blocked) else (
            "false_negative" if expect_block else ("false_positive" if blocked else "true_negative")
        )
    else:
        cell = accounting.classify(expect_block, blocked)

    if cell == "true_positive":
        outcome.verifier_correct_blocked += 1
    elif cell == "false_negative":
        outcome.verifier_false_negative += 1
    elif cell == "false_positive":
        outcome.verifier_false_positive += 1
    else:
        outcome.verifier_true_negative += 1


def evaluate_case(consumer_root: Path, case: CorpusCase) -> CaseOutcome:
    """Drive one case through retrieval + (optionally) the verifier; return measured signals."""
    from service_knowledge import index  # lazy: vaultctl-backed, not needed for corpus loading

    outcome = CaseOutcome(
        case_id=case.case_id,
        expected_services=set(case.expected_services),
        forbidden_evidence=set(case.forbidden_evidence),
        expected_probes=set(case.expected_probes),
    )

    bundle = index.evidence_for_files(
        consumer_root, list(case.touched_paths) or [case.query_or_task], limit=7
    )
    items = bundle.get("items", [])
    top_ids = {str(item.get("id")) for item in items if item.get("id")}
    outcome.predicted_services = {
        str(item.get("service_id")) for item in items if item.get("service_id")
    }
    outcome.retrieved_evidence = top_ids
    outcome.required_evidence = _relevant_item_ids(consumer_root, set(case.expected_services))
    outcome.surfaced_probes = {str(probe.get("title", "")) for probe in bundle.get("probes", [])}

    surface = _bundle_text_fragments(bundle)
    outcome.escaped_forbidden = {
        label for label in case.forbidden_evidence if label and label.casefold() in surface
    }

    _run_verifier_case(case, outcome)
    return outcome


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _emit_harness_telemetry(report_dir: Path, event: str, **fields: Any) -> None:
    """Append a component=eval-harness line to the report-dir events log; never raises."""
    record = {"timestamp": _utc_now(), "component": "eval-harness", "event": event}
    record.update(fields)
    try:
        report_dir.mkdir(parents=True, exist_ok=True)
        with (report_dir / "events.jsonl").open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(record, separators=(",", ":"), sort_keys=True) + "\n")
    except OSError:
        pass


def run_corpus(
    corpus_dir: Path,
    workdir: Path,
    *,
    corpus_version: str = "dev",
    report_dir: Path | None = None,
) -> tuple[MetricReport, list[CaseOutcome]]:
    """Build the eval consumer, evaluate every case, aggregate the twelve metrics.

    Telemetry lands in ``report_dir`` (default: ``reports/`` next to the corpus). Pass an explicit
    ``report_dir`` to avoid writing into the packaged corpus tree (tests do this).
    """
    cases = load_corpus(corpus_dir)
    if not cases:
        raise ValueError(f"no corpus cases found under {corpus_dir}")

    from service_knowledge import index  # lazy: vaultctl-backed

    started = time.perf_counter()
    consumer_root = build_eval_consumer(workdir, cases)
    index.build(consumer_root)

    outcomes = [evaluate_case(consumer_root, case) for case in cases]
    report = metrics.aggregate(outcomes)
    duration_ms = round((time.perf_counter() - started) * 1000.0, 2)

    effective_report_dir = report_dir if report_dir is not None else Path(corpus_dir).parent / "reports"
    _emit_harness_telemetry(
        effective_report_dir, "run",
        corpus_version=corpus_version, case_count=len(cases), duration_ms=duration_ms,
    )
    for name in metrics.METRIC_ROWS:
        _emit_harness_telemetry(
            effective_report_dir, "metric_computed",
            corpus_version=corpus_version, metric=name,
            value=report.values.get(name), status=report.status.get(name),
        )
    return report, outcomes


def iso_week_label(now: datetime | None = None) -> str:
    """``YYYY-WW`` ISO week label for the report filename."""
    moment = now or datetime.now(timezone.utc)
    year, week, _ = moment.isocalendar()
    return f"{year}-{week:02d}"
