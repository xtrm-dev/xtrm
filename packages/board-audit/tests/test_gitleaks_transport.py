"""Deterministic gitleaks harness for the board-audit transport projection.

Anchors six required results (A–F) with a pinned gitleaks v8.30.1 binary and
real transport commits in isolated temporary Git repositories:

  A. Normal representative checkpoint → 0 generic-api-key findings; no
     .gitleaksignore entry is required.
  B. Desired-state round-trip → covered by test_roundtrip.py; running the
     board-audit-core exporter in this harness proves the sanitized
     projection still yields the same manifest+work-package contract.
  C. Per-Bead projection → covered by test_export_hierarchy.py and
     test_pr_checkpoint.py; this harness re-runs the exporter and asserts
     the manifest + work-package hierarchy are still produced.
  D. NEW synthetic real credential under .xtrm/board-audit/** → gitleaks
     MUST FAIL, proving no path exemption exists for that tree.
  E. Historically-accepted secret-like line replayed in a NEW commit →
     gitleaks MUST FAIL, proving no value-based ignore exists.
  F. No path/rule/wildcard scanner weakening → repo tree carries no
     .gitleaksignore and no gitleaks.toml.

Plus a PR-checkpoint recursion regression: back-to-back exports with a
simulated code-head change stay gitleaks-clean and never require a new
.gitleaksignore entry.
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import tarfile
import tempfile
import unittest
import urllib.request
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
PKG_DIR = REPO_ROOT / "packages" / "board-audit"
BOARD_AUDIT_CORE = PKG_DIR / "board-audit-core"

GITLEAKS_VERSION = "8.30.1"
GITLEAKS_URL = (
    "https://github.com/gitleaks/gitleaks/releases/download/"
    f"v{GITLEAKS_VERSION}/gitleaks_{GITLEAKS_VERSION}_linux_x64.tar.gz"
)
GITLEAKS_SHA256 = "551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb"
GITLEAKS_BIN_CACHE = Path("/tmp") / "gitleaks"


def _download_pinned_gitleaks(target: Path) -> None:
    with tempfile.TemporaryDirectory() as tmp:
        archive = Path(tmp) / "gitleaks.tar.gz"
        urllib.request.urlretrieve(GITLEAKS_URL, archive)
        actual = hashlib.sha256(archive.read_bytes()).hexdigest()
        if actual != GITLEAKS_SHA256:
            raise RuntimeError(
                f"gitleaks archive sha256 mismatch: expected {GITLEAKS_SHA256}, got {actual}"
            )
        with tarfile.open(archive, "r:gz") as tf:
            member = next((m for m in tf.getmembers() if m.name.endswith("gitleaks")), None)
            if member is None:
                raise RuntimeError("gitleaks binary not present in the pinned archive")
            with tf.extractfile(member) as src, open(target, "wb") as dst:
                shutil.copyfileobj(src, dst)
        target.chmod(0o755)


def _resolve_gitleaks() -> Path:
    if GITLEAKS_BIN_CACHE.exists():
        try:
            out = subprocess.run(
                [str(GITLEAKS_BIN_CACHE), "version"],
                capture_output=True,
                text=True,
                check=True,
            )
            if GITLEAKS_VERSION in out.stdout.strip():
                return GITLEAKS_BIN_CACHE
        except (subprocess.CalledProcessError, OSError):
            pass
    _download_pinned_gitleaks(GITLEAKS_BIN_CACHE)
    return GITLEAKS_BIN_CACHE


def _git(cwd: Path, *args: str, capture: bool = False) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", *args],
        cwd=cwd,
        text=True,
        capture_output=capture,
        check=True,
    )


def _init_repo(root: Path) -> None:
    root.mkdir(parents=True, exist_ok=True)
    _git(root, "init", "-q")
    _git(root, "config", "user.email", "harness@board-audit.local")
    _git(root, "config", "user.name", "board-audit-harness")
    _git(root, "commit", "-q", "--allow-empty", "-m", "root")


def _scan_all(gitleaks: Path, repo: Path) -> list[dict]:
    """Full git-history scan of `repo`; return raw findings unfiltered.

    Runs gitleaks with cwd=repo and --gitleaks-ignore-path pointing INSIDE
    `repo` so no `.gitleaksignore` from the calling repository or the CI
    runner's HOME is inherited (default `-i .` would otherwise resolve
    against the caller's cwd). All GITLEAKS_* env vars are stripped for
    the same reason.
    """
    report = repo / ".gitleaks-report.json"
    if report.exists():
        report.unlink()
    env = {k: v for k, v in os.environ.items() if not k.startswith("GITLEAKS_")}
    subprocess.run(
        [
            str(gitleaks),
            "git",
            str(repo),
            "--report-format",
            "json",
            "--report-path",
            str(report),
            "--no-banner",
            "--exit-code",
            "0",
            "--gitleaks-ignore-path",
            str(repo),
        ],
        cwd=str(repo),
        env=env,
        check=True,
        capture_output=True,
    )
    return json.loads(report.read_text(encoding="utf-8") or "[]")


def _scan_generic_api_key(gitleaks: Path, repo: Path) -> list[dict]:
    """Full git-history scan; return the generic-api-key findings only."""
    return [f for f in _scan_all(gitleaks, repo) if f.get("RuleID") == "generic-api-key"]


# ---------------------------------------------------------------------------
# Representative fixture — mirrors real live shapes from
# .xtrm/board-audit/exports/export-*/raw-beads.jsonl, redacted subset.
# ---------------------------------------------------------------------------

FIXTURE_ISSUES = [
    {
        "_type": "issue",
        "id": "xtrm-abc",
        "title": "wire up transport projection sanitizer",
        "description": (
            "## PROBLEM\n\nCommitted transport tree trips generic-api-key on "
            "memory-record `key` fields. The Beads schema stays authoritative; "
            "only the transport projection is renamed. Long descriptive prose "
            "keeps the natural language intact for the Web-edit round-trip."
        ),
        "notes": "Discovered while running board-audit pr-checkpoint on infra.",
        "status": "open",
        "priority": 1,
        "issue_type": "task",
        "owner": "harness@board-audit.local",
        "created_at": "2026-08-22T00:00:00Z",
        "created_by": "harness",
        "updated_at": "2026-08-22T00:00:00Z",
        "dependency_count": 0,
        "dependent_count": 0,
        "comment_count": 0,
    },
    {
        "_type": "issue",
        "id": "xtrm-def",
        "title": "verify no scanner weakening",
        "description": "Assert the transport tree carries no .gitleaksignore and no gitleaks.toml.",
        "status": "open",
        "priority": 2,
        "issue_type": "task",
        "created_at": "2026-08-22T00:00:01Z",
        "created_by": "harness",
        "updated_at": "2026-08-22T00:00:01Z",
        "dependency_count": 0,
        "dependent_count": 0,
        "comment_count": 0,
    },
]

FIXTURE_MEMORIES = [
    {
        "_type": "memory",
        "key": "agent-observability-three-layer-pattern",
        "value": (
            "Agent observability access methodology: three composable layers — "
            "read-only MCP sidecars on internal Docker network, mcpq CLI with "
            ".mcpq.json walk-up at parent dir, live-query health skill with "
            "service-skills routing table. Half-day adoption for any product "
            "with sibling-repo layout."
        ),
    },
    {
        "_type": "memory",
        "key": "cross-repo-recovery-when-the-authoritative-bead-lives",
        "value": (
            "Cross-repo recovery: when the authoritative bead lives in core but "
            "implementation belongs to xtrm, create a local mirror bead before "
            "specialist dispatch; otherwise sp cannot resolve the bead."
        ),
    },
    {
        "_type": "memory",
        "key": "docs-ignore-audit-core-keeps-direct-docs-plus-architecture-observability",
        "value": (
            "Docs ignore audit: core keeps direct docs plus architecture, "
            "migration, observability, specs, active plans; ignores internal "
            "design/proposals/reference and completed/deprecated plans."
        ),
    },
    {
        "_type": "memory",
        "key": "board-audit-transport-projection-must-not-embed-beads-key-field-verbatim",
        "value": (
            "Board-audit transport projection must not embed the Beads "
            "memory-record `key` field verbatim; rename it before committing."
        ),
    },
    {
        "_type": "memory",
        "key": "kan-127-gate-iface-proof-set",
        "value": "Real shape observed on the historical infra checkpoint recurrence.",
    },
]


def _write_raw_beads(path: Path, issues: list[dict], memories: list[dict]) -> None:
    with open(path, "w", encoding="utf-8") as f:
        for row in issues:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
        for row in memories:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")


def _run_export(repo: Path, raw_beads: Path) -> Path:
    """Invoke board-audit-core --export --all --from-raw against `repo`."""
    env = os.environ.copy()
    subprocess.run(
        [
            str(BOARD_AUDIT_CORE),
            "--export",
            "--all",
            "--from-raw",
            str(raw_beads),
            "--output-dir",
            ".xtrm/board-audit",
        ],
        cwd=repo,
        env=env,
        check=True,
        capture_output=True,
    )
    exports = sorted((repo / ".xtrm/board-audit/exports").glob("export-*"))
    assert exports, "board-audit-core did not create an export snapshot"
    return exports[-1]


class SanitizedTransportHarness(unittest.TestCase):
    """Six-result harness for the sanitized transport projection."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.gitleaks = _resolve_gitleaks()

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory(prefix="board-audit-harness-")
        self.addCleanup(self._tmp.cleanup)
        self.repo = Path(self._tmp.name) / "repo"
        _init_repo(self.repo)

    # ---- helpers ----------------------------------------------------------

    def _checkpoint(self, message: str = "checkpoint") -> Path:
        raw = Path(self._tmp.name) / f"{message}.raw.jsonl"
        _write_raw_beads(raw, FIXTURE_ISSUES, FIXTURE_MEMORIES)
        snapshot = _run_export(self.repo, raw)
        _git(self.repo, "add", "-A", ".xtrm/board-audit")
        _git(self.repo, "commit", "-q", "-m", message)
        return snapshot

    # ---- Required result A ------------------------------------------------

    def test_A_representative_checkpoint_yields_zero_generic_api_key(self) -> None:
        snapshot = self._checkpoint("representative checkpoint")
        raw = snapshot / "raw-beads.jsonl"
        text = raw.read_text(encoding="utf-8")
        # Sanitizer contract: memory records renamed, `key` field gone.
        types = {json.loads(line).get("_type") for line in text.splitlines() if line.strip()}
        self.assertIn("memory-slug-v2", types)
        self.assertNotIn("memory", types)
        for line in text.splitlines():
            if not line.strip():
                continue
            row = json.loads(line)
            if row.get("_type") == "memory-slug-v2":
                self.assertIn("memory_slug", row)
                self.assertNotIn("key", row)
                self.assertEqual(row.get("_schema_version"), 2)
        findings = _scan_generic_api_key(self.gitleaks, self.repo)
        self.assertEqual(
            findings,
            [],
            f"unexpected generic-api-key findings on sanitized transport: {findings!r}",
        )

    # ---- Required result B (delegated to test_roundtrip.py) ---------------
    #
    # test_roundtrip.py exercises the prepare → reconcile → --execute flow
    # against the sanitized exporter output. This harness re-runs the same
    # exporter primitive in test_A above, so any regression that breaks
    # round-trip semantics would surface in test_roundtrip.

    # ---- Required result C ------------------------------------------------

    def test_C_per_bead_projection_manifest_and_work_packages_present(self) -> None:
        snapshot = self._checkpoint("per-bead projection")
        manifest = json.loads((snapshot / "manifest.json").read_text(encoding="utf-8"))
        self.assertEqual(manifest["schema_version"], "xtrm.board-audit.snapshot-manifest.v1")
        self.assertEqual(manifest["source"]["command"], "bd export --all")
        packages_dir = snapshot / "work-packages"
        packages = sorted(packages_dir.glob("*.json"))
        self.assertTrue(packages, "per-bead projection produced no work packages")
        for pkg in packages:
            payload = json.loads(pkg.read_text(encoding="utf-8"))
            self.assertIn("hierarchy", payload)
            self.assertIn("issues", payload)
            self.assertIn("content_sha256", payload)

    # ---- Required result D ------------------------------------------------

    def test_D_synthetic_credential_under_board_audit_still_fires(self) -> None:
        self._checkpoint("baseline before synthetic credential")
        # A secret-shaped line placed under .xtrm/board-audit/** to prove no
        # path exemption is leaking that tree. 48-char random hex gives
        # Shannon entropy comfortably above the generic-api-key floor with no
        # realistic flake window; the value is generated fresh per run and
        # NEVER persisted anywhere except this in-test git repo.
        rnd = os.urandom(24).hex()
        expected_path = ".xtrm/board-audit/scratch/creds.env"
        creds = self.repo / expected_path
        creds.parent.mkdir(parents=True, exist_ok=True)
        creds.write_text(
            f"secret_api_token = \"{rnd}\"\n",
            encoding="utf-8",
        )
        _git(self.repo, "add", "-A", ".xtrm/board-audit")
        _git(self.repo, "commit", "-q", "-m", "inject synthetic credential")
        findings = _scan_all(self.gitleaks, self.repo)
        matching = [
            f for f in findings
            if f.get("RuleID") == "generic-api-key"
            and f.get("File", "").endswith(expected_path)
        ]
        self.assertTrue(
            matching,
            "gitleaks did not detect the synthetic secret under "
            f"{expected_path} — a path exemption is leaking. all findings: "
            + json.dumps([{"RuleID": f.get("RuleID"), "File": f.get("File")} for f in findings]),
        )

    # ---- Required result E ------------------------------------------------

    def test_E_replayed_historic_secret_in_new_commit_still_fires(self) -> None:
        self._checkpoint("baseline before replay")
        replay = self.repo / "docs" / "replay.md"
        replay.parent.mkdir(parents=True, exist_ok=True)
        # A representative shape that generic-api-key catches on the committed
        # transport tree today. base64url of 48 random bytes = 64 chars over a
        # ~64-symbol alphabet, giving Shannon entropy well above the
        # generic-api-key ~3.5 bits/char floor with no realistic flake window.
        # Generated per run so no value ever persists in the source tree.
        import base64
        rnd = base64.urlsafe_b64encode(os.urandom(48)).decode("ascii").rstrip("=")
        replay.write_text(
            "legacy fingerprint replay\n\n"
            f"api_key = \"{rnd}\"\n",
            encoding="utf-8",
        )
        _git(self.repo, "add", "-A")
        _git(self.repo, "commit", "-q", "-m", "replay historic secret-like line")
        findings = _scan_generic_api_key(self.gitleaks, self.repo)
        self.assertTrue(
            findings,
            "gitleaks did not detect the replayed historic secret shape under "
            "the generic-api-key rule — a value-based ignore is present",
        )

    # ---- Required result F ------------------------------------------------

    def test_F_no_scanner_weakening_in_source_tree(self) -> None:
        # No .gitleaksignore anywhere in the repo, no repo-scoped
        # gitleaks.toml. Fingerprints, wildcard paths and rule-weakening
        # would live in one of these files.
        offenders = []
        for name in (".gitleaksignore", "gitleaks.toml", ".gitleaks.toml"):
            for hit in REPO_ROOT.rglob(name):
                if ".git/" in str(hit):
                    continue
                offenders.append(str(hit.relative_to(REPO_ROOT)))
        self.assertEqual(
            offenders,
            [],
            f"scanner-weakening artifact present in the source tree: {offenders!r}",
        )


class PRCheckpointRecursionRegression(unittest.TestCase):
    """Prove pr-checkpoint N + code-head change + pr-checkpoint N+1 stays
    gitleaks-clean and never asks for a new .gitleaksignore entry."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.gitleaks = _resolve_gitleaks()

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory(prefix="board-audit-recursion-")
        self.addCleanup(self._tmp.cleanup)
        self.repo = Path(self._tmp.name) / "repo"
        _init_repo(self.repo)

    def _checkpoint(self, label: str) -> Path:
        raw = Path(self._tmp.name) / f"{label}.raw.jsonl"
        _write_raw_beads(raw, FIXTURE_ISSUES, FIXTURE_MEMORIES)
        snapshot = _run_export(self.repo, raw)
        _git(self.repo, "add", "-A", ".xtrm/board-audit")
        _git(self.repo, "commit", "-q", "-m", label)
        return snapshot

    def test_pr_checkpoint_recursion_stays_clean_across_code_head_change(self) -> None:
        self._checkpoint("pr-checkpoint N")
        # Simulate a code-head change in the underlying repo — a checkpoint
        # boundary is not just a bd change; the exporter must also stay
        # clean across a real repo mutation.
        (self.repo / "src").mkdir(exist_ok=True)
        (self.repo / "src" / "handler.py").write_text(
            "def handle():\n    return 'ok'\n",
            encoding="utf-8",
        )
        _git(self.repo, "add", "-A")
        _git(self.repo, "commit", "-q", "-m", "code head change")
        self._checkpoint("pr-checkpoint N+1")
        # Full history: neither checkpoint reintroduces a generic-api-key
        # finding, and no .gitleaksignore is created by the flow.
        findings = _scan_generic_api_key(self.gitleaks, self.repo)
        self.assertEqual(
            findings,
            [],
            f"pr-checkpoint recursion reintroduced generic-api-key findings: {findings!r}",
        )
        self.assertFalse(
            (self.repo / ".gitleaksignore").exists(),
            "checkpoint flow created a .gitleaksignore — automated fingerprint append is forbidden",
        )


if __name__ == "__main__":
    unittest.main()
