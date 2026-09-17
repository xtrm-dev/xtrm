"""End-to-end coverage for XTRM-426 VALIDATION bullets not already exercised
through the public API or CLI, plus a cross-process settle-lock proof."""

from __future__ import annotations

import json
import multiprocessing
from datetime import datetime, timezone

import pytest

from xtrm_research.cli.main import main
from xtrm_research.jsonl import read_lines
from xtrm_research.manifest import build_intent
from xtrm_research.runner import RunHandle, RunSettledError, retry_run, start_run
from xtrm_research.schemas import validate
from xtrm_research.store import (
    annotations_path,
    events_path,
    load_manifest,
    load_status,
    run_dir,
    samples_path,
)

from .helpers import FIXED_NOW, make_manifest


def _sample(i, ts=FIXED_NOW):
    return {
        "schema_version": "xtrm-research-sample/v1",
        "sample_id": f"s-{i}",
        "index": i,
        "input": {},
        "status": "ok",
        "created_at": ts.isoformat(),
    }


def _event(seq, ts=FIXED_NOW):
    return {
        "schema_version": "xtrm-research-event/v1",
        "seq": seq,
        "ts": ts.isoformat(),
        "kind": "x",
    }


def _cli(argv, capsys):
    code = main(argv)
    return code, json.loads(capsys.readouterr().out.strip())


def _files(root, run_id):
    d = run_dir(root, run_id)
    return {p.name: p.read_bytes() for p in sorted(d.iterdir()) if p.is_file()}


# --- runs --json tolerates a broken manifest -------------------------------


def test_runs_json_reports_invalid_manifest_row_beside_valid_run(
    registry, runs_root, capsys
):
    start_run(runs_root, "run-good", make_manifest(registry, run_id="run-good"))
    broken = run_dir(runs_root, "run-broken")
    broken.mkdir(parents=True)
    (broken / "manifest.json").write_text("{}", encoding="utf-8")

    code, envelope = _cli(["--root", str(runs_root), "runs", "--json"], capsys)

    assert code == 0
    validate("cli_envelope", envelope)
    assert envelope["ok"] is True
    rows = {row["id"]: row for row in envelope["data"]}
    assert rows["run-good"] == {
        "id": "run-good",
        "experiment": "dup-detect-baseline",
        "variant": "baseline",
        "trigger": "baseline",
        "status": "started",
        "purpose": "prove the skeleton works",
        "latest_conclusion": None,
        "evidence_status": None,
    }
    assert rows["run-broken"]["status"] == "invalid_manifest"
    assert rows["run-broken"]["error"]


# --- retry_run ---------------------------------------------------------------


def _parent_with_sample(registry, runs_root):
    handle = start_run(runs_root, "run-p", make_manifest(registry, run_id="run-p"))
    handle.write_sample(_sample(0))
    return handle


def test_retry_forces_trigger_to_retry(registry, runs_root):
    _parent_with_sample(registry, runs_root)
    child = make_manifest(
        registry,
        run_id="run-r",
        intent=build_intent(purpose="rerun", trigger="baseline", requested_by="test"),
    )
    retry_run(runs_root, "run-p", "run-r", child, ["s-0"])
    assert load_manifest(runs_root, "run-r")["intent"]["trigger"] == "retry"


def test_retry_rejects_sample_id_missing_from_parent(registry, runs_root):
    _parent_with_sample(registry, runs_root)
    child = make_manifest(registry, run_id="run-r")
    with pytest.raises(ValueError, match="s-missing"):
        retry_run(runs_root, "run-p", "run-r", child, ["s-0", "s-missing"])
    assert not run_dir(runs_root, "run-r").exists()


# --- cross-process settle lock ----------------------------------------------


def _writer_proc(root, run_id, ready, result):
    """Heartbeat + append in a loop until the run is settled underneath us."""
    handle = RunHandle(root, run_id)
    i = 0
    deadline = datetime.now(timezone.utc).timestamp() + 10
    try:
        while datetime.now(timezone.utc).timestamp() < deadline:
            now = datetime.now(timezone.utc)
            handle.heartbeat(now=now)
            handle.write_event(_event(i, now))
            handle.write_sample(_sample(i, now))
            i += 1
            if i == 5:
                ready.set()
        result.put(("timeout", i))
    except RunSettledError:
        result.put(("settled", i))
    except Exception as exc:  # noqa: BLE001 - reported to the parent
        result.put((f"{type(exc).__name__}: {exc}", i))


def _finisher_proc(root, run_id, ready, result):
    if not ready.wait(timeout=10):
        result.put(("no-ready", None))
        return
    RunHandle(root, run_id).finish("success")
    # snapshot taken right after settle; the writer is still looping
    d = run_dir(root, run_id)
    result.put(
        (
            "finished",
            {n: (d / n).read_bytes() for n in ("samples.jsonl", "events.jsonl")},
        )
    )


def test_cross_process_finish_settles_against_looping_heartbeat(registry, runs_root):
    start_run(runs_root, "run-mp", make_manifest(registry, run_id="run-mp"))
    ctx = multiprocessing.get_context("spawn")  # fresh interpreters, no shared locks
    ready, writer_q, finisher_q = ctx.Event(), ctx.Queue(), ctx.Queue()
    writer = ctx.Process(
        target=_writer_proc, args=(str(runs_root), "run-mp", ready, writer_q)
    )
    finisher = ctx.Process(
        target=_finisher_proc, args=(str(runs_root), "run-mp", ready, finisher_q)
    )
    writer.start()
    finisher.start()
    writer_outcome, writes = writer_q.get(timeout=15)
    finisher_outcome, snapshot = finisher_q.get(timeout=15)
    writer.join(timeout=5)
    finisher.join(timeout=5)

    assert (writer.exitcode, finisher.exitcode) == (0, 0)
    assert finisher_outcome == "finished"
    assert writer_outcome == "settled"
    assert writes >= 5

    status = load_status(runs_root, "run-mp")
    assert status["state"] == "success"
    settled_at = datetime.fromisoformat(status["last_heartbeat"])

    # nothing landed after finish() returned ...
    d = run_dir(runs_root, "run-mp")
    assert (d / "samples.jsonl").read_bytes() == snapshot["samples.jsonl"]
    assert (d / "events.jsonl").read_bytes() == snapshot["events.jsonl"]
    # ... and nothing on disk is stamped after the settle timestamp
    events = list(read_lines(events_path(runs_root, "run-mp")))
    samples = list(read_lines(samples_path(runs_root, "run-mp")))
    assert all(datetime.fromisoformat(e["ts"]) <= settled_at for e in events)
    assert all(datetime.fromisoformat(s["created_at"]) <= settled_at for s in samples)
    # the writer's partial iteration may have landed an event without its sample
    assert len(samples) <= len(events) <= len(samples) + 1


# --- VALIDATION gaps: end-to-end through start_run + CLI --------------------


def test_alias_resolution_persisted_and_shown_by_cli(registry, runs_root, capsys):
    manifest = make_manifest(
        registry,
        run_id="run-alias",
        backend={
            "provider": "typesafe",
            "model": "jev-latest",
            "model_version": "main",
        },
        alias_resolver={"jev-latest": "jev-2026-09-01"},
    )
    start_run(runs_root, "run-alias", manifest)

    code, envelope = _cli(
        ["--root", str(runs_root), "run", "show", "run-alias", "--json"], capsys
    )

    assert code == 0
    shown = envelope["data"]["manifest"]
    assert shown["backend"]["model"] == "jev-2026-09-01"
    assert shown["aliases"]["resolved"] == [
        {"input": "jev-latest", "resolved": "jev-2026-09-01"}
    ]
    assert [u["input"] for u in shown["aliases"]["unresolved"]] == ["main"]
    assert all(u["reason"] for u in shown["aliases"]["unresolved"])


def test_cli_annotate_appends_and_leaves_manifest_samples_events_identical(
    registry, runs_root, capsys
):
    handle = start_run(runs_root, "run-ann", make_manifest(registry, run_id="run-ann"))
    handle.write_sample(_sample(0))
    handle.write_event(_event(0))
    before = _files(runs_root, "run-ann")

    for text in ("first", "second"):
        code, envelope = _cli(
            [
                "--root", str(runs_root), "run", "annotate", "run-ann",
                "--author", "me", "--kind", "conclusion", "--text", text, "--json",
            ],
            capsys,
        )  # fmt: skip
        assert code == 0 and envelope["ok"] is True

    after = _files(runs_root, "run-ann")
    for name in ("manifest.json", "samples.jsonl", "events.jsonl"):
        assert after[name] == before[name]
    texts = [a["text"] for a in read_lines(annotations_path(runs_root, "run-ann"))]
    assert texts == ["first", "second"]


def test_killed_writer_tail_returns_complete_lines_only(registry, runs_root, capsys):
    handle = start_run(
        runs_root, "run-torn", make_manifest(registry, run_id="run-torn")
    )
    handle.write_event(_event(0))
    handle.write_event(_event(1))
    with events_path(runs_root, "run-torn").open("a", encoding="utf-8") as f:
        f.write('{"seq": 2, "ki')

    code, envelope = _cli(
        ["--root", str(runs_root), "--json", "tail", "run-torn"], capsys
    )

    assert code == 0
    assert [e["seq"] for e in envelope["data"]["events"]] == [0, 1]
    assert envelope["data"]["next_offset"] == 1


def test_runs_and_run_show_envelopes_validate_against_cli_schema(
    registry, runs_root, capsys
):
    start_run(runs_root, "run-env", make_manifest(registry, run_id="run-env"))
    for argv, command in [
        (["runs", "--json"], "runs"),
        (["run", "show", "run-env", "--json"], "run show"),
    ]:
        code, envelope = _cli(["--root", str(runs_root), *argv], capsys)
        assert code == 0
        validate("cli_envelope", envelope)
        assert envelope["schema"] == "xtrm-research-cli/v1"
        assert envelope["command"] == command
