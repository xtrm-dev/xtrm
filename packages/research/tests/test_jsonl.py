from __future__ import annotations

import json
from pathlib import Path

import pytest

from xtrm_research.jsonl import append_line, read_lines


def test_reader_tolerates_torn_trailing_line(tmp_path: Path):
    path = tmp_path / "events.jsonl"
    append_line(path, {"seq": 0, "kind": "a"})
    append_line(path, {"seq": 1, "kind": "b"})
    with path.open("a", encoding="utf-8") as f:
        f.write('{"seq": 2, "kind": "tor')  # simulate a writer killed mid-line

    rows = list(read_lines(path))
    assert [r["seq"] for r in rows] == [0, 1]


def test_reader_raises_on_corrupt_interior_line(tmp_path: Path):
    path = tmp_path / "events.jsonl"
    path.write_text('{"seq": 0}\nnot json at all\n{"seq": 2}\n', encoding="utf-8")
    with pytest.raises(Exception):
        list(read_lines(path))


def test_writer_repairs_torn_tail_before_one_append(tmp_path: Path):
    path = tmp_path / "events.jsonl"
    append_line(path, {"seq": 0})
    with path.open("a", encoding="utf-8") as f:
        f.write('{"seq": 1, "kind": "tor')
    append_line(path, {"seq": 2})  # must not glue onto the fragment

    rows = list(read_lines(path))
    assert [r["seq"] for r in rows] == [0, 2]
    assert path.with_name(path.name + ".torn").exists()


def test_writer_repairs_torn_tail_before_two_appends(tmp_path: Path):
    path = tmp_path / "events.jsonl"
    append_line(path, {"seq": 0})
    with path.open("a", encoding="utf-8") as f:
        f.write('{"seq": 1, "kind": "tor')
    append_line(path, {"seq": 2})
    append_line(path, {"seq": 3})

    rows = list(read_lines(path))
    assert [r["seq"] for r in rows] == [0, 2, 3]
    # every line on disk parses cleanly now, including the last
    for line in path.read_text().splitlines():
        json.loads(line)


def test_reader_returns_empty_for_missing_file(tmp_path: Path):
    assert list(read_lines(tmp_path / "missing.jsonl")) == []


def test_single_complete_unterminated_line_kept_not_truncated(tmp_path: Path):
    # A complete record missing only its trailing newline (writer died
    # right after the record, right before the \n flushed) must be KEPT,
    # not treated as torn.
    path = tmp_path / "single.jsonl"
    path.write_text('{"seq": 0}')
    append_line(path, {"seq": 1})

    rows = list(read_lines(path))
    assert [r["seq"] for r in rows] == [0, 1]
    assert not path.with_name(path.name + ".torn").exists()


def test_complete_line_plus_torn_fragment_keeps_complete_line(tmp_path: Path):
    path = tmp_path / "mixed.jsonl"
    path.write_text('{"seq": 0}\n{"seq": 1}')  # complete, unterminated last line
    append_line(path, {"seq": 2})
    rows = list(read_lines(path))
    assert [r["seq"] for r in rows] == [0, 1, 2]

    # now make the trailing record genuinely torn (not just unterminated)
    with path.open("a", encoding="utf-8") as f:
        f.write('\n{"seq": 3, "kind": "tor')
    append_line(path, {"seq": 4})
    rows = list(read_lines(path))
    assert [r["seq"] for r in rows] == [0, 1, 2, 4]  # the complete lines survive
