"""Append-only JSONL helpers shared by samples.jsonl, events.jsonl and annotations.jsonl.

Each write first repairs the file's trailing fragment, then appends one
complete, newline-terminated line. A trailing fragment that already parses
as JSON (just missing its newline, e.g. a writer that wrote the record but
was killed before the trailing ``\\n`` flushed) is kept — a newline is
appended, no data is lost. A trailing fragment that does NOT parse (a
writer killed mid-record) is truncated off — never glued onto the new
line — and the raw dropped bytes are copied into a sibling ``<file>.torn``
log. Readers additionally tolerate a torn trailing line on their own:
every complete line up to that point parses; a corrupt line that is NOT
the last line is a real error and raises.

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


def _record_torn(path: Path, dropped: bytes) -> None:
    torn_log = path.with_name(path.name + ".torn")
    with torn_log.open("a", encoding="utf-8") as f:
        f.write(
            json.dumps(
                {
                    "repaired_at": datetime.now(timezone.utc).isoformat(),
                    "dropped_bytes": len(dropped),
                    "dropped_raw": dropped.decode("utf-8", errors="replace"),
                }
            )
            + "\n"
        )


def _repair_tail(path: Path) -> None:
    if not path.exists():
        return
    data = path.read_bytes()
    if not data or data.endswith(b"\n"):
        return
    last_newline = data.rfind(b"\n")
    tail = data[last_newline + 1 :]
    try:
        json.loads(tail)
    except json.JSONDecodeError:
        # genuinely torn mid-record: drop it, never glue new data onto it
        good = data[: last_newline + 1] if last_newline != -1 else b""
        path.write_bytes(good)
        _record_torn(path, tail)
    else:
        # a complete record that's just missing its trailing newline
        path.write_bytes(data + b"\n")


def append_line(path: Path, record: dict[str, Any]) -> None:
    # ponytail: _repair_tail reads the whole file on every append (O(n) per
    # append, O(n^2) per run). Fine at this package's scale; if it matters,
    # track a trusted byte offset + last seq in status.json and only
    # inspect bytes past that offset.
    path.parent.mkdir(parents=True, exist_ok=True)
    _repair_tail(path)
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
