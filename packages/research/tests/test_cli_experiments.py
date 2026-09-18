"""Experiments read verb (XTRM-474 slice 2): the registry's experiment list.

Read straight from the registry directory so an experiment with zero
runs is visible; unreadable registries are ok:false, never empty success.
"""

from __future__ import annotations

import json

from xtrm_research.cli.main import main

from .conftest import REGISTRY_ROOT


def _run_cli(argv, capsys):
    exit_code = main(argv)
    out = capsys.readouterr().out.strip()
    return exit_code, json.loads(out)


# --- experiments -----------------------------------------------------------


def test_experiments_lists_registry_including_zero_run_experiment(capsys):
    # The fixture registry's experiment has no runs seeded anywhere in
    # this test — visibility comes from the registry, not from run rows.
    code, envelope = _run_cli(
        ["--json", "experiments", "--registry-root", str(REGISTRY_ROOT)], capsys
    )
    assert code == 0
    assert envelope["schema"] == "xtrm-research-cli/v1"
    assert envelope["command"] == "experiments"
    assert envelope["ok"] is True
    assert envelope["error"] is None
    assert {"id": "dup-detect-baseline", "version": "v1"} in envelope["data"]


def test_experiments_unreadable_registry_returns_error_envelope(capsys):
    code, envelope = _run_cli(
        ["--json", "experiments", "--registry-root", "/nonexistent"], capsys
    )
    assert code != 0
    assert envelope["ok"] is False
    assert envelope["data"] is None
    assert envelope["error"]


def test_experiments_flags_work_in_either_position(capsys):
    code, envelope = _run_cli(
        ["experiments", "--registry-root", str(REGISTRY_ROOT), "--json"], capsys
    )
    assert code == 0
    assert envelope["ok"] is True
    assert {"id": "dup-detect-baseline", "version": "v1"} in envelope["data"]
