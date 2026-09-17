"""Append-only JSONL helpers shared by samples.jsonl, events.jsonl and annotations.jsonl.

Each write flushes one complete line at a time, and first repairs any torn
trailing fragment left by a writer killed mid-line (truncates it off and
records the repair in a sibling ``<file>.torn`` log — never glues new data
onto a fragment). Readers additionally tolerate a torn trailing line on
their own: every complete line up to that point parses; a corrupt line
that is NOT the last line is a real error and raises.

This module is a raw, unchecked primitive: it has no notion of a run's
lifecycle. Writing to a run's samples.jsonl/events.jsonl/annotations.jsonl
should go through :class:`xtrm_research.runner.RunHandle` or
:mod:`xtrm_research.annotations`, which gate every write against the run's
settled/mutated state before calling this.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator


def _repair_torn_tail(path: Path) -> None:
    if not path.exists():
        return
    data = path.read_bytes()
    if not data or data.endswith(b"\n"):
        return
    last_newline = data.rfind(b"\n")
    good = data[: last_newline + 1] if last_newline != -1 else b""
    dropped = len(data) - len(good)
    path.write_bytes(good)
    torn_log = path.with_name(path.name + ".torn")
    with torn_log.open("a", encoding="utf-8") as f:
        f.write(
            json.dumps(
                {
                    "repaired_at": datetime.now(timezone.utc).isoformat(),
                    "dropped_bytes": dropped,
                }
            )
            + "\n"
        )


def append_line(path: Path, record: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    _repair_torn_tail(path)
    line = json.dumps(record, sort_keys=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(line + "\n")
        f.flush()


def read_lines(path: Path) -> Iterator[dict[str, Any]]:
    if not path.exists():
        return
    with path.open("r", encoding="utf-8") as f:
        lines = f.readlines()
    for i, raw in enumerate(lines):
        raw = raw.rstrip("\n")
        if not raw:
            continue
        try:
            yield json.loads(raw)
        except json.JSONDecodeError:
            if i != len(lines) - 1:
                raise  # a torn line is only tolerated as the last line
