from __future__ import annotations

import json

import pytest

from xtrm_research.cli.main import main
from xtrm_research.runner import start_run
from xtrm_research.store import manifest_path, samples_path, status_path

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


# --- literal VALIDATION forms, --json after the subcommand -----------------


def test_runs_json_literal_form(seeded_root, capsys):
    code, envelope = _run_cli(["--root", str(seeded_root), "runs", "--json"], capsys)
    assert code == 0
    assert envelope["schema"] == "xtrm-research-cli/v1"
    assert envelope["ok"] is True
    assert envelope["data"][0]["id"] == "run-cli"


def test_run_show_json_literal_form(seeded_root, capsys):
    code, envelope = _run_cli(
        ["--root", str(seeded_root), "run", "show", "run-cli", "--json"], capsys
    )
    assert code == 0
    assert envelope["data"]["manifest"]["run_id"] == "run-cli"


def test_json_flag_before_subcommand_still_works(seeded_root, capsys):
    code, envelope = _run_cli(["--root", str(seeded_root), "--json", "runs"], capsys)
    assert code == 0
    assert envelope["ok"] is True


def test_root_flag_after_subcommand_works(seeded_root, capsys):
    code, envelope = _run_cli(["runs", "--root", str(seeded_root), "--json"], capsys)
    assert code == 0
    assert envelope["data"][0]["id"] == "run-cli"


def test_run_annotate_then_show_byte_identical_execution_files(seeded_root, capsys):
    def snapshot():
        return {
            "manifest": manifest_path(seeded_root, "run-cli").read_bytes(),
            "status": status_path(seeded_root, "run-cli").read_bytes(),
            "samples": samples_path(seeded_root, "run-cli").read_bytes()
            if samples_path(seeded_root, "run-cli").exists()
            else b"",
        }

    before = snapshot()
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
    assert snapshot() == before

    _, envelope = _run_cli(
        ["--root", str(seeded_root), "--json", "run", "show", "run-cli"], capsys
    )
    assert envelope["data"]["annotations"][0]["text"] == "evidence holds"


def test_run_annotate_empty_author_returns_error_envelope(seeded_root, capsys):
    code, envelope = _run_cli(
        [
            "--root",
            str(seeded_root),
            "--json",
            "run",
            "annotate",
            "run-cli",
            "--author",
            "",
            "--kind",
            "caveat",
            "--text",
            "t",
        ],
        capsys,
    )
    assert code != 0
    assert envelope["ok"] is False


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


def test_experiment_show_bad_registry_root_returns_error_envelope(capsys):
    code, envelope = _run_cli(
        ["--json", "experiment", "show", "zz", "--registry-root", "/nonexistent"],
        capsys,
    )
    assert code != 0
    assert envelope["ok"] is False


def test_tail_returns_events_after_offset(seeded_root, capsys):
    code, envelope = _run_cli(
        ["--root", str(seeded_root), "--json", "tail", "run-cli", "--after", "0"],
        capsys,
    )
    assert code == 0
    assert [e["seq"] for e in envelope["data"]["events"]] == [1]
    assert envelope["data"]["next_offset"] == 1


def test_tail_unknown_run_returns_error_envelope(seeded_root, capsys):
    code, envelope = _run_cli(
        ["--root", str(seeded_root), "--json", "tail", "nope"], capsys
    )
    assert code != 0
    assert envelope["ok"] is False


def test_metrics_includes_sample_and_event_counts(seeded_root, capsys):
    code, envelope = _run_cli(
        ["--root", str(seeded_root), "--json", "metrics", "run-cli"], capsys
    )
    assert code == 0
    assert envelope["data"]["event_count"] == 2
    assert envelope["data"]["sample_count"] == 0


def test_metrics_unknown_run_returns_error_envelope(seeded_root, capsys):
    code, envelope = _run_cli(
        ["--root", str(seeded_root), "--json", "metrics", "nope"], capsys
    )
    assert code != 0
    assert envelope["ok"] is False


def test_runs_lineage_json_is_nested_structure(seeded_root, capsys):
    code, envelope = _run_cli(
        ["--root", str(seeded_root), "--json", "runs", "--lineage", "run-cli"], capsys
    )
    assert code == 0
    assert envelope["data"]["run_id"] == "run-cli"
    assert envelope["data"]["children"] == []


def test_runs_lineage_human_mode_prints_tree(seeded_root, capsys):
    exit_code = main(["--root", str(seeded_root), "runs", "--lineage", "run-cli"])
    out = capsys.readouterr().out
    assert exit_code == 0
    assert "run-cli" in out


def test_runs_lineage_unknown_run_returns_error_envelope(seeded_root, capsys):
    code, envelope = _run_cli(
        ["--root", str(seeded_root), "--json", "runs", "--lineage", "nope"], capsys
    )
    assert code != 0
    assert envelope["ok"] is False


def test_run_show_unknown_run_returns_error_envelope(seeded_root, capsys):
    code, envelope = _run_cli(
        ["--root", str(seeded_root), "run", "show", "no-such-run", "--json"], capsys
    )
    assert code == 1
    assert envelope["ok"] is False
    assert envelope["error"]


def test_cli_never_prints_a_traceback_on_error(seeded_root, capsys):
    exit_code = main(["--root", str(seeded_root), "run", "show", "no-such-run"])
    captured = capsys.readouterr()
    assert exit_code != 0
    assert "Traceback" not in captured.out
    assert "Traceback" not in captured.err


def test_argparse_usage_error_returns_envelope_when_json_present(seeded_root, capsys):
    code, envelope = _run_cli(
        ["--root", str(seeded_root), "--json", "runs", "--bogus"], capsys
    )
    assert code == 2
    assert envelope["ok"] is False
    assert "bogus" in envelope["error"]


def test_argparse_usage_error_without_json_is_plain_text(seeded_root, capsys):
    exit_code = main(["--root", str(seeded_root), "runs", "--bogus"])
    captured = capsys.readouterr()
    assert exit_code == 2
    assert captured.out == ""
    assert "bogus" in captured.err


@pytest.fixture
def lineage_root(seeded_root, registry):
    from xtrm_research.runner import retry_run

    retry_run(
        seeded_root,
        "run-cli",
        "run-cli-retry",
        make_manifest(registry, run_id="run-cli-retry"),
        [],
    )
    fork = make_manifest(
        registry,
        run_id="run-cli-fork",
        lineage=[{"relation": "forked_from", "run_id": "run-cli"}],
    )
    start_run(seeded_root, "run-cli-fork", fork)
    return seeded_root


def test_cli_lineage_json_shows_retry_and_fork_children(lineage_root, capsys):
    code, envelope = _run_cli(
        ["--root", str(lineage_root), "--json", "runs", "--lineage", "run-cli"], capsys
    )
    assert code == 0
    children = {(c["relation"], c["run_id"]) for c in envelope["data"]["children"]}
    assert children == {("retry_of", "run-cli-retry"), ("forked_from", "run-cli-fork")}


def test_cli_lineage_human_shows_retry_and_fork_children(lineage_root, capsys):
    exit_code = main(["--root", str(lineage_root), "runs", "--lineage", "run-cli"])
    out = capsys.readouterr().out
    assert exit_code == 0
    assert "run-cli-retry" in out
    assert "run-cli-fork" in out


def test_killed_writer_reports_interrupted_end_to_end(registry, runs_root, capsys):
    from xtrm_research.store import events_path

    manifest = make_manifest(registry, run_id="run-killed")
    handle = start_run(runs_root, "run-killed", manifest)
    handle.write_event(
        {
            "schema_version": "xtrm-research-event/v1",
            "seq": 0,
            "ts": FIXED_NOW.isoformat(),
            "kind": "x",
        }
    )
    with events_path(runs_root, "run-killed").open("a", encoding="utf-8") as f:
        f.write(
            '{"seq": 1, "ki'
        )  # writer killed mid-line, heartbeat never updated again

    code, envelope = _run_cli(
        ["--root", str(runs_root), "--json", "run", "show", "run-killed"], capsys
    )
    assert code == 0
    assert (
        envelope["data"]["status"] == "started"
    )  # freshly started, real heartbeat just set

    # simulate a writer that died: push the heartbeat far enough into the
    # past (relative to FIXED_NOW, not to whenever this test happens to
    # run) that it's stale under any real wall clock from FIXED_NOW onward.
    from datetime import timedelta

    from xtrm_research.store import load_status, status_path, write_json_atomic

    status = load_status(runs_root, "run-killed")
    status["last_heartbeat"] = (FIXED_NOW - timedelta(days=3650)).isoformat()
    write_json_atomic(status_path(runs_root, "run-killed"), status)

    code, envelope = _run_cli(
        ["--root", str(runs_root), "--json", "run", "show", "run-killed"], capsys
    )
    assert code == 0
    assert envelope["data"]["status"] == "interrupted"
    # the torn tail is still readable up to its last complete line
    assert envelope["data"]["manifest"]["run_id"] == "run-killed"
