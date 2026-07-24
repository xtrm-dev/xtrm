"""Verifier FP/FN accounting hooks (research §3.9, PR5a).

Records false-positive / false-negative outcomes when the verifier runs against labeled material
(golden fixtures or eval-corpus cases). A *false positive* is a correct claim wrongly blocked; a
*false negative* is a false claim let through. Counts fold into the §3.9 verification FP/FN rates.
Emission is best-effort telemetry — accounting must never break a verification run.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

COMPONENT = "verifier-accounting"


def classify(expect_block: bool, blocked: bool) -> str:
    """Map a (label, gate-decision) pair onto a confusion-matrix cell."""
    if expect_block and blocked:
        return "true_positive"
    if expect_block and not blocked:
        return "false_negative"
    if not expect_block and blocked:
        return "false_positive"
    return "true_negative"


def account(
    expect_block: bool,
    blocked: bool,
    *,
    service_id: str = "",
    case_id: str = "",
    telemetry_dir: Path | None = None,
) -> dict[str, Any]:
    """Classify one verification outcome and (optionally) append a telemetry line.

    Returns the accounting record so callers (eval harness) can aggregate without re-deriving it.
    """
    cell = classify(expect_block, blocked)
    record = {
        "timestamp": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "component": COMPONENT,
        "event": "verification_outcome",
        "service_id": service_id,
        "case_id": case_id,
        "expect_block": expect_block,
        "blocked": blocked,
        "cell": cell,
    }
    if telemetry_dir is not None:
        _emit(telemetry_dir, record)
    return record


def _emit(telemetry_dir: Path, record: dict[str, Any]) -> None:
    try:
        path = Path(telemetry_dir) / "events.jsonl"
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(record, separators=(",", ":"), sort_keys=True) + "\n")
    except OSError:
        pass


def summarize(cells: list[str]) -> dict[str, float | None]:
    """Reduce a list of confusion-matrix cells to FP/FN rates."""
    counts = {"true_positive": 0, "false_positive": 0, "false_negative": 0, "true_negative": 0}
    for cell in cells:
        if cell in counts:
            counts[cell] += 1
    fp_denom = counts["false_positive"] + counts["true_negative"]
    fn_denom = counts["false_negative"] + counts["true_positive"]
    return {
        "false_positive_rate": (counts["false_positive"] / fp_denom) if fp_denom else None,
        "false_negative_rate": (counts["false_negative"] / fn_denom) if fn_denom else None,
        **counts,
    }
