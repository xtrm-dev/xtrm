"""Regression: `bd` precondition on the board-audit-core export path.

`board-audit-core --export --all --from-raw <acquisition>` derives packages
from an acquisition supplied by the caller. That path must NOT require `bd`
on PATH; only the auto-acquire path (no --from-raw) does.

Anchored:

A. --from-raw succeeds in an isolated repository when bd is absent from PATH.
B. --export --all without --from-raw fails clearly when bd is required but absent.

Test C ("the existing Gitleaks transport harness runs rather than errors during
setup") is delivered by the four `test_gitleaks_transport.SanitizedTransportHarness`
cases + the recursion regression case turning GREEN under the precondition
fix; that suite runs under `python -m unittest discover` in the same job.
"""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
BOARD_AUDIT_CORE = REPO_ROOT / "packages" / "board-audit" / "board-audit-core"


def _bd_free_path() -> str:
    """Return a PATH string that contains all system bin dirs EXCEPT any
    directory that supplies a `bd` binary."""
    filtered = []
    seen_bd = False
    for entry in os.environ.get("PATH", "").split(os.pathsep):
        if not entry:
            continue
        candidate = Path(entry) / "bd"
        if candidate.exists():
            seen_bd = True
            continue
        filtered.append(entry)
    if not seen_bd:
        # If the runner doesn't have bd at all, the plain PATH is already
        # bd-free — return it verbatim so the test proves the same invariant.
        return os.environ.get("PATH", "")
    return os.pathsep.join(filtered)


def _init_repo(root: Path) -> None:
    subprocess.run(["git", "init", "-q", "-b", "main", str(root)], check=True)
    subprocess.run(["git", "-C", str(root), "config", "user.email", "t@e"], check=True)
    subprocess.run(["git", "-C", str(root), "config", "user.name", "t"], check=True)


def _minimal_raw_beads(path: Path) -> None:
    """Emit a small valid raw-beads.jsonl acquisition (1 issue, 1 memory)."""
    rows = [
        {
            "_type": "issue",
            "id": "test-abcd",
            "title": "sample",
            "status": "open",
            "priority": 2,
            "issue_type": "task",
            "assignee": "",
            "created_at": "2026-08-22T00:00:00Z",
            "updated_at": "2026-08-22T00:00:00Z",
        },
        {
            "_type": "memory",
            "key": "sample-memory-key",
            "value": "sample memory value.",
        },
    ]
    with open(path, "w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")


class BdPreconditionTests(unittest.TestCase):
    def test_A_from_raw_succeeds_when_bd_absent_from_path(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp) / "r"
            repo.mkdir()
            _init_repo(repo)
            raw = Path(tmp) / "sample.raw.jsonl"
            _minimal_raw_beads(raw)

            env = os.environ.copy()
            env["PATH"] = _bd_free_path()

            # Sanity: bd really is absent under this PATH.
            probe = subprocess.run(
                ["bash", "-c", "command -v bd || echo ABSENT"],
                env=env,
                capture_output=True,
                text=True,
            )
            self.assertIn("ABSENT", probe.stdout, "expected bd to be absent from PATH")

            result = subprocess.run(
                [
                    str(BOARD_AUDIT_CORE),
                    "--export",
                    "--all",
                    "--from-raw",
                    str(raw),
                    "--output-dir",
                    ".xtrm/board-audit",
                ],
                cwd=repo,
                env=env,
                capture_output=True,
                text=True,
            )
            self.assertEqual(
                result.returncode,
                0,
                f"expected --from-raw to succeed without bd; stderr={result.stderr!r}",
            )
            snapshots = sorted((repo / ".xtrm/board-audit/exports").glob("export-*"))
            self.assertTrue(snapshots, "no snapshot was emitted")
            manifest = snapshots[-1] / "manifest.json"
            self.assertTrue(manifest.exists(), "manifest.json missing under snapshot")

    def test_B_auto_acquire_fails_clearly_when_bd_absent(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp) / "r"
            repo.mkdir()
            _init_repo(repo)

            env = os.environ.copy()
            env["PATH"] = _bd_free_path()

            result = subprocess.run(
                [
                    str(BOARD_AUDIT_CORE),
                    "--export",
                    "--all",
                    "--output-dir",
                    ".xtrm/board-audit",
                ],
                cwd=repo,
                env=env,
                capture_output=True,
                text=True,
            )
            self.assertNotEqual(
                result.returncode,
                0,
                "expected --export --all (no --from-raw) to fail without bd",
            )
            # Error must name the missing tool so the operator knows what to install.
            combined = (result.stderr or "") + (result.stdout or "")
            self.assertIn("bd", combined, f"expected 'bd' in error output; got: {combined!r}")


if __name__ == "__main__":
    unittest.main()
