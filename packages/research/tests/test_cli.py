from __future__ import annotations

import json

import pytest

from xtrm_research.cli.main import main
from xtrm_research.runner import start_run

from .conftest import REGISTRY_ROOT
from .helpers import FIXED_NOW, make_manifest


@pytest.fixture
def seeded_root(registry, runs_root):
    manifest = make_manifest(registry, run_id="run-cli")
    handle = start_run(runs_root, "run-cli", manifest)
    handle.write_event(
        {
            "schema_version": "xtrm-research-event/v1",
            "seq": 0,
            "ts": FIXED_NOW.isoformat(),
            "kind": "started",
        }
    )
    handle.write_event(
        {
            "schema_version": "xtrm-research-event/v1",
            "seq": 1,
            "ts": FIXED_NOW.isoformat(),
            "kind": "progress",
        }
    )
    return runs_root


def _run_cli(argv, capsys):
    exit_code = main(argv)
    out = capsys.readouterr().out.strip()
    return exit_code, json.loads(out)


def test_runs_json_envelope(seeded_root, capsys):
    code, envelope = _run_cli(["--root", str(seeded_root), "--json", "runs"], capsys)
    assert code == 0
    assert envelope["schema"] == "xtrm-research-cli/v1"
    assert envelope["ok"] is True
    assert envelope["data"][0]["id"] == "run-cli"


def test_run_show_json_envelope(seeded_root, capsys):
    code, envelope = _run_cli(
        ["--root", str(seeded_root), "--json", "run", "show", "run-cli"], capsys
    )
    assert code == 0
    assert envelope["data"]["manifest"]["run_id"] == "run-cli"


def test_run_annotate_then_show(seeded_root, capsys):
    code, _ = _run_cli(
        [
            "--root",
            str(seeded_root),
            "--json",
            "run",
            "annotate",
            "run-cli",
            "--author",
            "me",
            "--kind",
            "conclusion",
            "--text",
            "evidence holds",
        ],
        capsys,
    )
    assert code == 0
    _, envelope = _run_cli(
        ["--root", str(seeded_root), "--json", "run", "show", "run-cli"], capsys
    )
    assert envelope["data"]["annotations"][0]["text"] == "evidence holds"


def test_experiment_and_workload_show(capsys):
    code, envelope = _run_cli(
        [
            "--json",
            "experiment",
            "show",
            "dup-detect-baseline",
            "--registry-root",
            str(REGISTRY_ROOT),
        ],
        capsys,
    )
    assert code == 0
    assert envelope["data"]["id"] == "dup-detect-baseline"

    code, envelope = _run_cli(
        [
            "--json",
            "workload",
            "show",
            "dup-detect",
            "--registry-root",
            str(REGISTRY_ROOT),
        ],
        capsys,
    )
    assert code == 0
    assert envelope["data"]["id"] == "dup-detect"


def test_tail_returns_events_after_offset(seeded_root, capsys):
    code, envelope = _run_cli(
        ["--root", str(seeded_root), "--json", "tail", "run-cli", "--after", "0"],
        capsys,
    )
    assert code == 0
    assert [e["seq"] for e in envelope["data"]["events"]] == [1]
    assert envelope["data"]["next_offset"] == 1


def test_runs_lineage(seeded_root, capsys):
    code, envelope = _run_cli(
        ["--root", str(seeded_root), "--json", "runs", "--lineage", "run-cli"], capsys
    )
    assert code == 0
    assert envelope["data"]["run_id"] == "run-cli"


def test_error_command_returns_error_envelope(seeded_root, capsys):
    code, envelope = _run_cli(
        ["--root", str(seeded_root), "--json", "run", "show", "no-such-run"], capsys
    )
    assert code == 1
    assert envelope["ok"] is False
    assert envelope["error"]
