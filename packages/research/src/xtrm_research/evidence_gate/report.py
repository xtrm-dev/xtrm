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
        "Latency basis per arm: "
        + "; ".join(f"{k}: {v}" for k, v in result.get("latency_basis", {}).items())
        + ".",
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
        "| metric | arm | minus frontier | minus llm | minus no-filter |",
        "|---|---|---|---|---|",
    ]
    for name in GATE_METRICS:
        for arm in ARMS:
            a = deltas.get(f"{arm}-minus-frontier|gate|{name}")
            m = deltas.get(f"{arm}-minus-llm|gate|{name}")
            b = deltas.get(f"{arm}-minus-no-filter|gate|{name}")
            if a or m or b:
                digits = 1 if name.startswith("latency") else 3
                lines.append(
                    f"| {name} | {arm} | {fmt(a, digits)} | {fmt(m, digits)} | {fmt(b, digits)} |"
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
            "| paired delta vs frontier (vs llm) | " + " | ".join(arms) + " |",
            "|---|" + "---|" * len(arms),
        ]
        for name in ("auc", "brier_calibrated", "ece_calibrated"):
            lines.append(
                f"| {name} | "
                + " | ".join(
                    f"{fmt(deltas.get(f'{a}-minus-frontier|{q}|{name}'))} "
                    f"({fmt(deltas.get(f'{a}-minus-llm|{q}|{name}'))})"
                    for a in arms
                )
                + " |"
            )
    score_arms = ("jev", "frontier", "llm")
    lines += [
        "",
        f"### `{ORDINAL}` (Score; arms that answer it)",
        "",
        "| metric | " + " | ".join(score_arms) + " | jev minus frontier | llm minus frontier |",
        "|---|" + "---|" * (len(score_arms) + 2),
    ]
    for name in ("multiclass_brier", "expected_level_mae"):
        cells = [fmt(metrics.get(f"{a}|{ORDINAL}|{name}")) for a in score_arms]
        cells += [fmt(deltas.get(f"{a}-minus-frontier|{ORDINAL}|{name}")) for a in ("jev", "llm")]
        lines.append(f"| {name} | " + " | ".join(cells) + " |")
    lines += ["", "### Not established", ""]
    lines += [f"- `{k}`: {v}" for k, v in result.get("not_established", {}).items()]
    return "\n".join(lines) + "\n"


def _row(name: str, cells: list[dict[str, Any] | None], latency: bool = False) -> str:
    return f"| {name} | " + " | ".join(fmt(c, 0 if latency else 3) for c in cells) + " |"


def render_cascade(result: dict[str, Any]) -> str:
    """Tables for the System One cascade result (XTRM-511)."""
    m, d = result["metrics"], result["paired_deltas"]
    arms = ["no-filter", "jev", "llm", "frontier", "battery-rule", "battery-learned", "cascade"]
    sweep = sorted(a for a in {k.split("|")[0] for k in m} if a.startswith("cascade-"))
    names = ["useful_evidence_recall", "retained_precision", "frontier_input_token_reduction", "escalation_rate", "latency_p50_ms", "cost_usd_per_1000_candidates"]
    lines = [
        f"n_eval = {result['n_eval']} items in {result['n_clusters']} clusters; battery `{result['battery_hash']}`; pre-registered band {json.dumps(result['pre_registered'])}; uncached requests at evaluation {result['uncached_requests']}.",
        "",
        "### Usable-evidence ranking (value [95% CI])",
        "",
        "| arm | AUC | Brier (calibrated) | AUC minus holistic Jev | AUC minus DeepSeek | AUC minus Claude |",
        "|---|---|---|---|---|---|",
    ]
    for arm in ("battery-rule", "battery-learned", "jev", "llm", "frontier"):
        cells = [m.get(f"{arm}|contains_usable_evidence|auc"), m.get(f"{arm}|contains_usable_evidence|brier_calibrated")]
        cells += [d.get(f"{arm}-minus-{ref}|contains_usable_evidence|auc") for ref in ("jev", "llm", "frontier")]
        lines.append(_row(arm, cells))
    lines += ["", "### Gate (value [95% CI])", "", "| arm | " + " | ".join(names) + " |", "|---|" + "---|" * len(names)]
    for arm in arms + sweep:
        lines.append(f"| {arm}{' (exploratory)' if arm in sweep else ''} | " + " | ".join(fmt(m.get(f"{arm}|gate|{n}"), 0 if n.startswith("latency") else 3) for n in names) + " |")
    lines += ["", "### Cascade paired deltas (cascade minus reference, same resamples)", "", "| reference | " + " | ".join(names) + " |", "|---|" + "---|" * len(names)]
    for ref in ("jev", "llm", "frontier", "no-filter"):
        lines.append(f"| {ref} | " + " | ".join(fmt(d.get(f"cascade-minus-{ref}|gate|{n}"), 0 if n.startswith("latency") else 3) for n in names) + " |")
    return "\n".join(lines) + "\n"


def render_locator(result: dict[str, Any]) -> str:
    """Tables for the code-locator showcase (XTRM-512)."""
    m, d = result["metrics"], result["paired_deltas"]
    names = ["hit@1", "hit@5", "hit@10", "recall@10", "mrr"]
    lines = [
        f"n = {result['n_items']} tasks; beam width {result['width']}; uncached requests at evaluation {result['uncached_requests']}.",
        "",
        "### Ranking quality (value [95% CI])",
        "",
        "| arm | " + " | ".join(names) + " |",
        "|---|" + "---|" * len(names),
    ]
    for arm in ("jev-beam", "lexical", "hot-files", "fusion", "jev-beam-code", "lexical-code", "hot-files-code"):
        if any(f"{arm}|{n}" in m for n in names):
            tag = "" if arm in ("jev-beam", "lexical", "hot-files") else " (exploratory)"
            lines.append(_row(arm + tag, [m.get(f"{arm}|{n}") for n in names]))
    lines += ["", "### Paired deltas", "", "| comparison | " + " | ".join(names) + " |", "|---|" + "---|" * len(names)]
    for key in sorted({k.split("|")[0] for k in d}):
        lines.append(_row(key, [d.get(f"{key}|{n}") for n in names]))
    lines += ["", "### System One cost per task (jev-beam)", "", "| requests | questions | input tokens | USD | latency ms |", "|---|---|---|---|---|"]
    cost = m.get("jev-beam|cost_usd")
    lines.append(
        "| " + " | ".join(fmt(m.get(f"jev-beam|{n}"), 1) for n in ("requests", "questions")) + f" | {fmt(m.get('jev-beam|input_tokens'), 0)} | {fmt(cost, 6)} | {fmt(m.get('jev-beam|latency_ms'), 0)} |"
    )
    return "\n".join(lines) + "\n"


def main() -> None:
    """``report.py RESULT.json [--cascade | --locator]``."""
    result = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    kind = sys.argv[2] if len(sys.argv) > 2 else ""
    renderer = {"--cascade": render_cascade, "--locator": render_locator}.get(kind, render)
    sys.stdout.write(renderer(result))


if __name__ == "__main__":
    main()
