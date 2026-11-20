"""Integration: reconcile.gated_write gates atomic_write per the §2.7 lattice.

Uses the golden fixtures: api-gateway (CONFLICT -> no write) and runners (PASS -> write
exactly once). EVIDENCE_RACE is simulated by stubbing source_fingerprint.
"""
import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

SCRIPTS_DIR = Path(__file__).resolve().parents[2]
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import reconcile  # noqa: E402
from verifier import load_canonical_headings
from verifier.gate import GateVerdict  # noqa: E402

FIXTURES_DIR = Path(__file__).resolve().parent / "fixtures"


@pytest.fixture
def service_dir(tmp_path: Path):
    """Copy a golden fixture's source/ tree into tmp and return (tmp, candidate, current)."""

    def _make(service: str):
        base = FIXTURES_DIR / service
        shutil.copytree(base / "source", tmp_path / "source")
        candidate = (base / "candidate.md").read_text(encoding="utf-8")
        current = (base / "current.md").read_text(encoding="utf-8")
        skill = tmp_path / "SKILL.md"
        skill.write_text(current, encoding="utf-8")
        return tmp_path, skill, candidate, current

    return _make


def _counting_writer(monkeypatch):
    """Patch reconcile.atomic_write to record calls without touching disk."""
    calls: list[tuple[Path, str]] = []

    def _fake(path: Path, content: str) -> None:
        calls.append((Path(path), content))

    monkeypatch.setattr(reconcile, "atomic_write", _fake)
    return calls


def test_conflict_fixture_blocks_atomic_write(service_dir, monkeypatch):
    root, skill, candidate, current = service_dir("api-gateway")
    calls = _counting_writer(monkeypatch)

    result = reconcile.gated_write(
        skill, candidate, service_id="api-gateway", territory=["source/**"], source_root=root, state_root=root
    )

    assert result["verdict"] == GateVerdict.CONFLICT.value
    assert result["written"] is False
    assert calls == []  # atomic_write NEVER called on CONFLICT
    assert result["gate"]["conflict_count"] == 2


def test_clean_fixture_writes_exactly_once(service_dir, monkeypatch):
    root, skill, candidate, current = service_dir("runners")
    calls = _counting_writer(monkeypatch)

    result = reconcile.gated_write(
        skill, candidate, service_id="runners", territory=["source/**"], source_root=root, state_root=root
    )

    assert result["verdict"] == GateVerdict.PASS_WITH_ADVISORIES.value
    assert result["written"] is True
    assert len(calls) == 1  # atomic_write called EXACTLY once
    assert calls[0][0] == skill
    assert calls[0][1] == candidate  # with the candidate content


def test_clean_fixture_writes_candidate_to_disk(service_dir):
    root, skill, candidate, current = service_dir("runners")
    result = reconcile.gated_write(
        skill, candidate, service_id="runners", territory=["source/**"], source_root=root, state_root=root
    )
    assert result["written"] is True
    assert skill.read_text(encoding="utf-8") == candidate


def test_dry_run_never_writes_even_on_pass(service_dir, monkeypatch):
    root, skill, candidate, current = service_dir("runners")
    calls = _counting_writer(monkeypatch)
    result = reconcile.gated_write(
        skill, candidate, service_id="runners", territory=["source/**"], source_root=root, state_root=root, dry_run=True
    )
    assert result["verdict"] == GateVerdict.PASS_WITH_ADVISORIES.value
    assert result["written"] is False
    assert calls == []


def test_evidence_race_retries_then_completes(service_dir, monkeypatch):
    root, skill, candidate, current = service_dir("runners")
    calls = _counting_writer(monkeypatch)

    # First run races (start != end); retry is stable -> gate recovers to PASS.
    seq = iter(["A", "B", "STABLE", "STABLE"])
    monkeypatch.setattr(reconcile, "source_fingerprint", lambda root_, globs: next(seq))

    result = reconcile.gated_write(
        skill, candidate, service_id="runners", territory=["source/**"], source_root=root, state_root=root
    )
    assert result["verdict"] == GateVerdict.PASS_WITH_ADVISORIES.value
    assert result["written"] is True
    assert len(calls) == 1


def test_evidence_race_persistent_fails_after_one_retry(service_dir, monkeypatch):
    root, skill, candidate, current = service_dir("runners")
    calls = _counting_writer(monkeypatch)

    counter = {"n": 0}

    def _always_race(root_, globs):
        counter["n"] += 1
        return f"fp{counter['n']}"  # every fingerprint differs -> race on both attempts

    monkeypatch.setattr(reconcile, "source_fingerprint", _always_race)

    result = reconcile.gated_write(
        skill, candidate, service_id="runners", territory=["source/**"], source_root=root, state_root=root
    )
    assert result["verdict"] == GateVerdict.EVIDENCE_RACE.value
    assert result["written"] is False
    assert result["gate"]["is_retryable"] is True
    assert calls == []
    assert counter["n"] == 4  # start+end for first run AND the single retry


def test_gate_telemetry_line_emitted(service_dir):
    root, skill, candidate, current = service_dir("api-gateway")
    reconcile.gated_write(
        skill, candidate, service_id="api-gateway", territory=["source/**"], source_root=root, state_root=root
    )
    events = root / ".xtrm" / "state" / "service-knowledge" / "events.jsonl"
    assert events.exists()
    lines = [json.loads(line) for line in events.read_text(encoding="utf-8").splitlines() if line.strip()]
    gate_lines = [ln for ln in lines if ln.get("component") == "reconcile-gate"]
    assert len(gate_lines) == 1
    record = gate_lines[0]
    assert record["event"] == "gate_decision"
    assert record["verdict"] == "CONFLICT"
    assert record["service_id"] == "api-gateway"
    assert record["conflict_count"] == 2
    # REVISION 3: no residual critic -> counters pinned to 0 but present in the schema.
    assert record["critic_calls"] == 0
    assert record["critic_tokens"] == 0
    assert {"timestamp", "invalid_count", "unknown_count", "duration_ms"} <= set(record)


def test_no_gate_bypass_flag_exists():
    # REVISION 3 / session override: there is deliberately NO override flag that lets a
    # write skip the verifier. Guard against one being added accidentally — parse_args
    # must reject every plausible bypass flag as an unknown argument.
    for flag in ("--allow-unverified", "--no-gate", "--skip-verify", "--force-write"):
        with pytest.raises(SystemExit):
            reconcile.parse_args([flag])


# --------------------------------------------------------------------------- #
# verifier CLI --gate-mode (CI gating surface)
# --------------------------------------------------------------------------- #

def _run_gate_cli(service: str, output_format: str = "json") -> subprocess.CompletedProcess:
    base = FIXTURES_DIR / service
    return subprocess.run(
        [
            sys.executable, "-m", "verifier",
            "--candidate", str(base / "candidate.md"),
            "--current", str(base / "current.md"),
            "--territory", "source/**",
            "--output-format", output_format,
            "--gate-mode",
            "--no-telemetry",
        ],
        cwd=str(SCRIPTS_DIR),
        capture_output=True,
        text=True,
        check=False,
    )


def test_gate_mode_conflict_exits_non_zero():
    proc = _run_gate_cli("api-gateway")
    assert proc.returncode == 1  # CONFLICT blocks -> non-zero so CI fails cleanly
    payload = json.loads(proc.stdout)
    assert payload["gate"]["verdict"] == "CONFLICT"
    assert payload["gate"]["is_writable"] is False
    assert payload["manifest"]["summary"]["CONFLICT"] == 2


def test_gate_mode_pass_exits_zero():
    proc = _run_gate_cli("runners")
    assert proc.returncode == 0
    payload = json.loads(proc.stdout)
    assert payload["gate"]["verdict"] == "PASS_WITH_ADVISORIES"
    assert payload["gate"]["is_writable"] is True


def test_gate_mode_markdown_renders_verdict_banner():
    proc = _run_gate_cli("api-gateway", "markdown")
    assert proc.returncode == 1
    assert "Gate Verdict — `CONFLICT`" in proc.stdout
    assert "Writable: **False**" in proc.stdout
    # The human-readable claim report still follows the banner.
    assert "quoted_literal" in proc.stdout


def test_advisory_mode_without_gate_flag_still_exits_zero():
    # Backward compat: without --gate-mode the CLI stays advisory (exit 0) even on CONFLICT.
    base = FIXTURES_DIR / "api-gateway"
    proc = subprocess.run(
        [
            sys.executable, "-m", "verifier",
            "--candidate", str(base / "candidate.md"),
            "--current", str(base / "current.md"),
            "--territory", "source/**",
            "--no-telemetry",
        ],
        cwd=str(SCRIPTS_DIR),
        capture_output=True,
        text=True,
        check=False,
    )
    assert proc.returncode == 0


def test_semantic_preservation_deletion_blocks_real_gated_write(service_dir):
    root, skill, candidate, current = service_dir("runners")
    candidate = current.replace("Curatorial notes preserved verbatim across regeneration.\n", "")
    assert len(load_canonical_headings()) == 12
    assert all(f"## {heading}\n" in candidate for heading in load_canonical_headings())
    original_bytes = skill.read_bytes()
    result = reconcile.gated_write(
        skill, candidate, service_id="runners", territory=["source/**"], source_root=root, state_root=root
    )
    assert result["verdict"] == GateVerdict.INVALID.value
    assert result["gate"]["is_writable"] is False
    assert result["written"] is False
    assert any(
        issue["code"] == "semantic_block_modified" and issue["severity"] == "error"
        for issue in result["manifest"]["structural_issues"]
    )
    assert skill.read_bytes() == original_bytes


def test_semantic_preservation_identical_interior_allows_real_outside_write(service_dir):
    root, skill, candidate, current = service_dir("runners")
    candidate = current.replace("# Runners\n", "# Runners\n\nAdded intro.\n")
    result = reconcile.gated_write(
        skill, candidate, service_id="runners", territory=["source/**"], source_root=root, state_root=root
    )
    assert result["verdict"] == GateVerdict.PASS.value
    assert result["gate"]["is_writable"] is True
    assert result["written"] is True
    assert not any(issue["code"] == "semantic_block_modified" for issue in result["manifest"]["structural_issues"])
    assert skill.read_bytes() == candidate.encode("utf-8")


@pytest.mark.parametrize("delete_interior", [True, False], ids=["deletion", "identical"])
def test_semantic_preservation_cli_checks_current_and_candidate(service_dir, delete_interior):
    root, skill, candidate, current = service_dir("runners")
    candidate = current.replace("# Runners\n", "# Runners\n\nAdded intro.\n")
    if delete_interior:
        candidate = candidate.replace("Curatorial notes preserved verbatim across regeneration.\n", "")
    candidate_path = root / "candidate.md"
    candidate_path.write_text(candidate, encoding="utf-8")
    original_bytes = skill.read_bytes()
    proc = subprocess.run(
        [
            sys.executable, "-m", "verifier",
            "--candidate", str(candidate_path),
            "--current", str(skill),
            "--source-root", str(root),
            "--territory", "source/**",
            "--service-id", "runners",
            "--gate-mode", "--no-telemetry",
        ],
        cwd=str(SCRIPTS_DIR), capture_output=True, text=True, check=False,
    )
    assert proc.returncode == (1 if delete_interior else 0), proc.stderr
    payload = json.loads(proc.stdout)
    assert payload["gate"]["verdict"] == ("INVALID" if delete_interior else "PASS")
    assert payload["gate"]["is_writable"] is (not delete_interior)
    preservation_issues = [
        issue for issue in payload["manifest"]["structural_issues"]
        if issue["code"] == "semantic_block_modified"
    ]
    assert bool(preservation_issues) is delete_interior
    assert all(issue["severity"] == "error" for issue in preservation_issues)
    assert skill.read_bytes() == original_bytes


def _runners_with_prose(service_dir, notes: int):
    root, skill, _, current = service_dir("runners")
    prose = "".join(f"Runbook note {i}.\n\n" for i in range(notes))
    current = current.replace("# Runners\n\n", f"# Runners\n\n{prose}")
    skill.write_text(current, encoding="utf-8")
    return root, skill, current


def test_few_removed_curated_lines_still_write_with_advisory(service_dir):
    root, skill, current = _runners_with_prose(service_dir, 40)
    candidate = current.replace("Runbook note 2.\n\n", "")
    result = reconcile.gated_write(
        skill, candidate, service_id="runners", territory=["source/**"], source_root=root, state_root=root
    )
    assert result["verdict"] == GateVerdict.PASS_WITH_ADVISORIES.value
    assert result["written"] is True
    assert any(i["code"] == "curated_text_removed" for i in result["manifest"]["structural_issues"])
    assert skill.read_bytes() == candidate.encode("utf-8")


def test_wholesale_curated_deletion_blocks_real_gated_write(service_dir):
    root, skill, current = _runners_with_prose(service_dir, 40)
    candidate = current
    for i in range(40):
        candidate = candidate.replace(f"Runbook note {i}.\n\n", "")
    original_bytes = skill.read_bytes()
    result = reconcile.gated_write(
        skill, candidate, service_id="runners", territory=["source/**"], source_root=root, state_root=root
    )
    assert result["verdict"] == GateVerdict.INVALID.value
    assert result["written"] is False
    assert any(
        i["code"] == "curated_text_removed_excessive" and i["severity"] == "error"
        for i in result["manifest"]["structural_issues"]
    )
    assert skill.read_bytes() == original_bytes


def test_reconcile_result_names_the_removed_curated_lines(service_dir):
    # the operator-visible reconcile result carries the structural detail, not only a count
    root, skill, current = _runners_with_prose(service_dir, 40)
    candidate = current
    for i in range(40):
        candidate = candidate.replace(f"Runbook note {i}.\n\n", "")
    gate_result = reconcile.gated_write(
        skill, candidate, service_id="runners", territory=["source/**"], source_root=root, state_root=root
    )
    notes = reconcile._structural_notes(gate_result)
    assert [n for n in notes if n.startswith("curated_text_removed_excessive: ")], notes
