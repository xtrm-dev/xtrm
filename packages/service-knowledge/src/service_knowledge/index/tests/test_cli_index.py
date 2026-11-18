"""Public CLI regression tests for index build and query."""
from __future__ import annotations

import json
from pathlib import Path

from service_knowledge.testing import run_cli


def _run_cli(root: Path, *args: str) -> dict:
    result = run_cli(list(args), cwd=root, check=True, capture_output=True, text=True)
    return json.loads(result.stdout)


def test_public_cli_build_then_query(alertmanager_consumer):
    root = Path(alertmanager_consumer)
    build = _run_cli(root, "index", "build", "--path", str(root))
    assert build["items"] > 0

    result = _run_cli(root, "index", "query", "--path", str(root), "discord webhook")
    assert result["results"]
    assert any("notification" in row["item"]["id"] for row in result["results"])
