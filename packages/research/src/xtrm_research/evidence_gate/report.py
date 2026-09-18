"""Render the Evidence Gate comparison JSON as Markdown tables (XTRM-499).

    python -m xtrm_research.evidence_gate.report RESULT.json > results-tables.md

Every number in the results document comes from this renderer, never from
hand transcription. A value with no interval prints its null reason.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

from xtrm_research.evidence_gate.compare import ARMS, GATE_METRICS, MODEL_ARMS
from xtrm_research.evidence_gate.labels import BINARY, ORDINAL

QUESTION_METRICS = (
    "auc",
    "brier_raw",
    "ece_raw",
    "brier_calibrated",
    "ece_calibrated",
    "brier_isotonic",
    "ece_isotonic",
    "recall_at_threshold",
    "precision_at_threshold",
)


def fmt(m: dict[str, Any] | None, digits: int = 3) -> str:
    if m is None:
        return "n/a"
    value = m.get("value")
    if value is None:
        return "not established"
    ci = m.get("ci95")
    if ci is None:
        return f"{value:.{digits}f} (no CI: {m.get('null_reason', 'undefined')})"
    return f"{value:.{digits}f} [{ci[0]:.{digits}f}, {ci[1]:.{digits}f}]"


def render(result: dict[str, Any]) -> str:
    metrics, deltas = result["metrics"], result["paired_deltas"]
    lines = [
        f"Dataset `{result['dataset_items_sha256']}`; labels `{result['label_version']}` "
        f"(`{result['labels_sha256']}`); n_eval = {result['n_eval']} items in "
        f"{result['n_clusters']} clusters; exclusions {json.dumps(result['exclusions'])}; "
        f"price table {result['prices_version']}; guard alterations "
        f"{json.dumps(result.get('guard_alterations'))}; policy paths "
        f"{json.dumps(result.get('policy_paths'))}.",
        "",
        "Intervals: " + next(iter(metrics.values()))["method"] + ".",
        "",
        "### Gate metrics per arm (value [95% CI])",
        "",
        "| metric | " + " | ".join(ARMS) + " |",
        "|---|" + "---|" * len(ARMS),
    ]
    for name in GATE_METRICS:
        digits = 1 if name.startswith("latency") else 3
        row = [fmt(metrics.get(f"{arm}|gate|{name}"), digits) for arm in ARMS]
        lines.append(f"| {name} | " + " | ".join(row) + " |")
    lines += [
        "",
        "### Paired deltas on the gate (arm minus reference, same resamples)",
        "",
    ]
    lines += [
        "| metric | arm | minus frontier | minus no-filter |",
        "|---|---|---|---|",
    ]
    for name in GATE_METRICS:
        for arm in ARMS:
            a = deltas.get(f"{arm}-minus-frontier|gate|{name}")
            b = deltas.get(f"{arm}-minus-no-filter|gate|{name}")
            if a or b:
                digits = 1 if name.startswith("latency") else 3
                lines.append(
                    f"| {name} | {arm} | {fmt(a, digits)} | {fmt(b, digits)} |"
                )
    for q in BINARY:
        established = result.get("established_questions", {}).get(q, True)
        balance = result["class_balance_eval"][q]
        lines += [
            "",
            f"### `{q}` — {balance['positive']}/{balance['n']} positive"
            + (
                ""
                if established
                else " — NOT ESTABLISHED (fewer positives than min_positives)"
            ),
            "",
        ]
        arms = [a for a in MODEL_ARMS if f"{a}|{q}|auc" in metrics]
        lines += ["| metric | " + " | ".join(arms) + " |", "|---|" + "---|" * len(arms)]
        for name in QUESTION_METRICS:
            lines.append(
                f"| {name} | "
                + " | ".join(fmt(metrics.get(f"{a}|{q}|{name}")) for a in arms)
                + " |"
            )
        lines += [
            "",
            "| paired delta vs frontier | " + " | ".join(arms) + " |",
            "|---|" + "---|" * len(arms),
        ]
        for name in ("auc", "brier_calibrated", "ece_calibrated"):
            lines.append(
                f"| {name} | "
                + " | ".join(
                    fmt(deltas.get(f"{a}-minus-frontier|{q}|{name}")) for a in arms
                )
                + " |"
            )
    lines += [
        "",
        f"### `{ORDINAL}` (Score; arms that answer it)",
        "",
        "| metric | jev | frontier | jev minus frontier |",
        "|---|---|---|---|",
    ]
    for name in ("multiclass_brier", "expected_level_mae"):
        lines.append(
            f"| {name} | {fmt(metrics.get(f'jev|{ORDINAL}|{name}'))} | {fmt(metrics.get(f'frontier|{ORDINAL}|{name}'))} | "
            f"{fmt(deltas.get(f'jev-minus-frontier|{ORDINAL}|{name}'))} |"
        )
    lines += ["", "### Not established", ""]
    lines += [f"- `{k}`: {v}" for k, v in result.get("not_established", {}).items()]
    return "\n".join(lines) + "\n"


def main() -> None:
    sys.stdout.write(render(json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))))


if __name__ == "__main__":
    main()
