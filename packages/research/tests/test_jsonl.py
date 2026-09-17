from __future__ import annotations

from pathlib import Path

from xtrm_research.jsonl import append_line, read_lines


def test_reader_tolerates_torn_trailing_line(tmp_path: Path):
    path = tmp_path / "events.jsonl"
    append_line(path, {"seq": 0, "kind": "a"})
    append_line(path, {"seq": 1, "kind": "b"})
    with path.open("a", encoding="utf-8") as f:
        f.write('{"seq": 2, "kind": "tor')  # simulate a writer killed mid-line

    rows = list(read_lines(path))
    assert [r["seq"] for r in rows] == [0, 1]


def test_reader_returns_empty_for_missing_file(tmp_path: Path):
    assert list(read_lines(tmp_path / "missing.jsonl")) == []
