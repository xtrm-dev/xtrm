"""Public CLI regression tests for index build and query."""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path


def _run_cli(root: Path, *args: str) -> dict:
    executable = shutil.which("service-knowledge", path=str(Path(sys.executable).parent))
    assert executable is not None
    result = subprocess.run(
        [executable, *args],
        cwd=root,
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(result.stdout)


def test_public_cli_build_then_query(alertmanager_consumer):
    root = Path(alertmanager_consumer)
    build = _run_cli(root, "index", "build", "--path", str(root))
    assert build["items"] > 0

    result = _run_cli(root, "index", "query", "--path", str(root), "discord webhook")
    assert result["results"]
    assert any("notification" in row["item"]["id"] for row in result["results"])
