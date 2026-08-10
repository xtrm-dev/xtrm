from __future__ import annotations

import pytest

from arena_top import CATEGORIES, cli

SAMPLE = {
    "meta": {
        "leaderboard": "code",
        "source_url": "https://arena.ai/leaderboard/code",
        "fetched_at": "2026-08-04T04:47:04+00:00",
        "last_updated": "Aug 1, 2026",
        "model_count": 2,
    },
    "models": [
        {"rank": 1, "model": "kimi-k3-max", "vendor": "Moonshot", "license": "open",
         "score": 1676.0, "ci": 12.0, "votes": 4366},
        {"rank": 2, "model": "deepseek-v4-flash-high", "vendor": "DeepSeek", "license": "open",
         "score": 1577.0, "ci": 9.0, "votes": 1319},
    ],
}


def test_render_table_respects_n():
    out = cli.render_table(SAMPLE, 1)
    assert "kimi-k3-max" in out
    assert "Moonshot" in out
    assert "1676" in out
    assert "deepseek-v4-flash-high" not in out  # n=1 drops the 2nd model
    # 2 header lines (title + column header) + exactly 1 data row
    assert len(out.splitlines()) == 3


def test_unknown_category_rejected_without_network():
    with pytest.raises(ValueError):
        cli.fetch_leaderboard("bogus", snapshot="2026-08-04")


def test_categories_cover_basics():
    for c in ("text", "code", "vision"):
        assert c in CATEGORIES
