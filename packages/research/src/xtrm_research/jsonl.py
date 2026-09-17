"""Append-only JSONL helpers shared by samples.jsonl, events.jsonl and annotations.jsonl.

Each write flushes one complete line at a time. Readers tolerate a torn
trailing line (a writer killed mid-write): every complete line up to that
point parses; the last, incomplete line is dropped rather than raising.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Iterator


def append_line(path: Path, record: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
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
