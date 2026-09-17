from __future__ import annotations

from datetime import timedelta

import pytest

from xtrm_research.hashing import compute_content_hash
from xtrm_research.runner import (
    ManifestMutatedError,
    RunHandle,
    RunNotStartedError,
    RunSettledError,
    retry_run,
    start_run,
)
from xtrm_research.status import effective_status
from xtrm_research.store import (
    load_manifest,
    load_status,
    manifest_path,
    write_json_atomic,
)

from .helpers import FIXED_NOW, make_manifest


def _sample(i, **extra):
    return {
        "schema_version": "xtrm-research-sample/v1",
        "sample_id": f"s-{i}",
        "index": i,
        "input": {},
        "status": "ok",
        "created_at": FIXED_NOW.isoformat(),
        **extra,
    }


def _event(seq, **extra):
    return {
        "schema_version": "xtrm-research-event/v1",
        "seq": seq,
        "ts": FIXED_NOW.isoformat(),
        "kind": "x",
        **extra,
    }


def test_refuses_to_write_sample_before_manifest_written(runs_root):
    handle = RunHandle(runs_root, "ghost-run")
    with pytest.raises(RunNotStartedError):
        handle.write_sample(_sample(0))


def test_refuses_to_write_event_before_manifest_written(runs_root):
    handle = RunHandle(runs_root, "ghost-run")
    with pytest.raises(RunNotStartedError):
        handle.write_event(_event(0))


def test_start_run_writes_manifest_then_allows_samples(registry, runs_root):
    manifest = make_manifest(registry)
    handle = start_run(runs_root, manifest["run_id"], manifest)
    assert manifest_path(runs_root, manifest["run_id"]).exists()
    handle.write_sample(_sample(0))


def test_start_run_rejects_manifest_run_id_mismatch(registry, runs_root):
    manifest = make_manifest(registry, run_id="other")
    with pytest.raises(ValueError, match="run_id"):
        start_run(runs_root, "dirX", manifest)


# --- R1: immutability after settlement -------------------------------------


def _seeded_settled_run(registry, runs_root, run_id="run-a"):
    manifest = make_manifest(registry, run_id=run_id)
    handle = start_run(runs_root, run_id, manifest)
    handle.write_sample(_sample(0))
    handle.write_event(_event(0))
    handle.finish("success", now=FIXED_NOW)
    return handle


def _snapshot(runs_root, run_id):
    from xtrm_research.store import run_dir

    d = run_dir(runs_root, run_id)
    return {
        name: (d / name).read_bytes()
        for name in ("manifest.json", "status.json", "samples.jsonl", "events.jsonl")
        if (d / name).exists()
    }


@pytest.mark.parametrize(
    "action",
    [
        lambda h: h.write_sample(_sample(9)),
        lambda h: h.write_event(_event(9)),
        lambda h: h.heartbeat(),
        lambda h: h.finish("error"),
    ],
)
def test_settled_run_rejects_every_write(registry, runs_root, action):
    handle = _seeded_settled_run(registry, runs_root)
    before = _snapshot(runs_root, "run-a")
    with pytest.raises(RunSettledError):
        action(handle)
    assert _snapshot(runs_root, "run-a") == before


def test_new_handle_on_settled_run_raises_at_construction(registry, runs_root):
    _seeded_settled_run(registry, runs_root)
    with pytest.raises(RunSettledError):
        RunHandle(runs_root, "run-a")


def test_settled_run_state_is_success(registry, runs_root):
    _seeded_settled_run(registry, runs_root)
    assert load_status(runs_root, "run-a")["state"] == "success"


# --- R2: manifest gate -------------------------------------------------------


def test_gate_detects_manifest_mutation_after_start(registry, runs_root):
    manifest = make_manifest(registry, run_id="run-m")
    handle = start_run(runs_root, "run-m", manifest)
    mutated = load_manifest(runs_root, "run-m")
    mutated["dataset"]["version"] = "v999"
    write_json_atomic(manifest_path(runs_root, "run-m"), mutated)
    with pytest.raises(ManifestMutatedError):
        handle.write_sample(_sample(0))


def test_gate_rejects_malformed_manifest(runs_root):
    from xtrm_research.store import run_dir

    d = run_dir(runs_root, "bogus")
    d.mkdir(parents=True)
    (d / "manifest.json").write_text("{}")
    with pytest.raises(Exception):
        RunHandle(runs_root, "bogus").write_sample(_sample(0))


# --- R3: retry, parent files fully byte-identical ---------------------------


def test_retry_of_nonexistent_parent_raises(registry, runs_root):
    with pytest.raises(ValueError, match="does not exist"):
        retry_run(
            runs_root,
            "no-such-parent",
            "rt1",
            make_manifest(registry, run_id="rt1"),
            ["zzz"],
        )


def test_retry_creates_new_run_parent_files_fully_untouched(registry, runs_root):
    parent = make_manifest(registry, run_id="run-parent")
    parent_handle = start_run(runs_root, "run-parent", parent)
    parent_handle.write_sample(_sample(0))
    parent_handle.write_event(_event(0))
    parent_handle.heartbeat(now=FIXED_NOW)
    parent_handle.finish("success", now=FIXED_NOW)
    before = _snapshot(runs_root, "run-parent")

    child_manifest = make_manifest(registry, run_id="run-retry")
    retry_run(
        runs_root, "run-parent", "run-retry", child_manifest, retried_sample_ids=["s-0"]
    )

    assert _snapshot(runs_root, "run-parent") == before

    child = load_manifest(runs_root, "run-retry")
    assert {"relation": "retry_of", "run_id": "run-parent"} in child["lineage"]
    assert child["retried_sample_ids"] == ["s-0"]


# --- R1/R3: event seq strictly monotonic ------------------------------------


def test_event_seq_must_be_strictly_monotonic(registry, runs_root):
    manifest = make_manifest(registry, run_id="run-seq")
    handle = start_run(runs_root, "run-seq", manifest)
    handle.write_event(_event(0))
    with pytest.raises(ValueError, match="monotonic"):
        handle.write_event(_event(0))  # reused seq
    with pytest.raises(ValueError, match="monotonic"):
        handle.write_event(_event(0))  # still not > last


def test_heartbeat_stale_run_reports_interrupted(registry, runs_root):
    manifest = make_manifest(registry, run_id="run-stale", now=FIXED_NOW)
    handle = start_run(runs_root, "run-stale", manifest)
    handle.heartbeat(now=FIXED_NOW)

    reloaded = load_status(runs_root, "run-stale")
    much_later = FIXED_NOW + timedelta(hours=1)
    assert effective_status(reloaded, now=much_later) == "interrupted"
    assert effective_status(reloaded, now=FIXED_NOW + timedelta(seconds=1)) == "started"


def test_effective_status_rejects_naive_heartbeat_cleanly():
    naive = {"state": "started", "last_heartbeat": "2026-09-17T12:00:00"}
    with pytest.raises(ValueError, match="naive"):
        effective_status(naive)


def test_future_heartbeat_not_treated_as_live_forever(registry, runs_root):
    manifest = make_manifest(registry, run_id="run-skew", now=FIXED_NOW)
    handle = start_run(runs_root, "run-skew", manifest)
    future = FIXED_NOW + timedelta(hours=2)
    handle.heartbeat(now=future)
    reloaded = load_status(runs_root, "run-skew")
    assert effective_status(reloaded, now=FIXED_NOW) == "interrupted"


def test_finish_run_sets_terminal_status(registry, runs_root):
    manifest = make_manifest(registry, run_id="run-done")
    handle = start_run(runs_root, "run-done", manifest)
    handle.finish("success", now=FIXED_NOW)
    reloaded = load_status(runs_root, "run-done")
    assert effective_status(reloaded, now=FIXED_NOW) == "success"


def test_finish_rejects_non_terminal_state(registry, runs_root):
    manifest = make_manifest(registry, run_id="run-bad-finish")
    handle = start_run(runs_root, "run-bad-finish", manifest)
    with pytest.raises(ValueError):
        handle.finish("started")


def test_status_manifest_content_hash_matches_manifest(registry, runs_root):
    manifest = make_manifest(registry, run_id="run-hash")
    start_run(runs_root, "run-hash", manifest)
    status = load_status(runs_root, "run-hash")
    assert status["manifest_content_hash"] == compute_content_hash(manifest)


# --- S1: real thread-interleaved settle race ---------------------------


def test_concurrent_finish_and_heartbeat_finish_wins(registry, runs_root):
    import threading

    manifest = make_manifest(registry, run_id="run-thread-race")
    handle = start_run(runs_root, "run-thread-race", manifest)

    start_barrier = threading.Barrier(2)
    results: dict[str, Exception | None] = {}

    def do_heartbeat():
        start_barrier.wait()
        try:
            handle.heartbeat()
            results["heartbeat"] = None
        except Exception as exc:  # noqa: BLE001 - captured for assertion
            results["heartbeat"] = exc

    def do_finish():
        start_barrier.wait()
        try:
            RunHandle(runs_root, "run-thread-race").finish("success")
            results["finish"] = None
        except Exception as exc:  # noqa: BLE001 - captured for assertion
            results["finish"] = exc

    t1 = threading.Thread(target=do_heartbeat)
    t2 = threading.Thread(target=do_finish)
    t1.start()
    t2.start()
    t1.join(timeout=5)
    t2.join(timeout=5)

    assert not t1.is_alive() and not t2.is_alive()  # no deadlock
    # exactly one of the two operations settles the run; the other either
    # succeeds harmlessly (heartbeat landed first, run still "started") or
    # is rejected as settled — never both "succeed" against a settled run.
    final_state = load_status(runs_root, "run-thread-race")["state"]
    assert final_state in ("started", "success")
    if final_state == "success":
        assert results["finish"] is None


# --- D2: start_run defense against a hand-built manifest bypassing build_manifest ---


def test_start_run_rejects_unrecorded_alias_in_backend_model(registry, runs_root):
    manifest = make_manifest(registry, run_id="run-alias-bypass")
    manifest["backend"] = {**manifest["backend"], "model": "jev-latest"}
    # aliases block untouched: doesn't mention "jev-latest" at all
    with pytest.raises(ValueError, match="alias"):
        start_run(runs_root, "run-alias-bypass", manifest)
    assert not (runs_root / "run-alias-bypass").exists()


def test_start_run_rejects_unrecorded_alias_in_model_version(registry, runs_root):
    manifest = make_manifest(registry, run_id="run-alias-bypass-2")
    manifest["backend"] = {**manifest["backend"], "model_version": "latest"}
    with pytest.raises(ValueError, match="alias"):
        start_run(runs_root, "run-alias-bypass-2", manifest)
