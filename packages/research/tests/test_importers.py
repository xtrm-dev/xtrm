"""Importer coverage for XTRM-480: recorded Jev outputs become Runs.

Every fixture here is synthetic (invented ids and titles) and lives under
``tests/fixtures/imports/``. The real data under ``~/.xtrm/research/data/``
is never opened.
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest

import xtrm_research.importers as importers
from xtrm_research.assessments import write_assessment_set
from xtrm_research.cli.main import main
from xtrm_research.importers import (
    ImportValidationError,
    MissingKeyFileError,
    UnrepresentableRecordError,
    content_hash_of_file,
    import_board_duplicates,
    import_contract_quality,
)
from xtrm_research.jsonl import read_lines
from xtrm_research.schemas import SchemaValidationError, validate
from xtrm_research.store import (
    list_run_ids,
    load_manifest,
    load_status,
    run_dir,
    samples_path,
)
from xtrm_research.views import chart_dataset_rows, run_metrics

from .helpers import FIXED_NOW

FIXTURES = Path(__file__).parent / "fixtures" / "imports"
DUPES = FIXTURES / "board-duplicates"
DUPES_PAIRS = DUPES / "pairs.jsonl"
DUPES_ANSWERS = DUPES / "answers.jsonl"
QUALITY_DIR = FIXTURES / "contract-quality" / "core"
QUALITY_FILE = QUALITY_DIR / "sb-quality-v3.jsonl"
QUALITY_LABELS = QUALITY_DIR / "blind-a.labels.json"
QUALITY_KEY = QUALITY_DIR / "blind-a.key.json"
NOKEY_FILE = FIXTURES / "contract-quality-nokey" / "core" / "sb-quality-v3.jsonl"


def _count_lines(path: Path) -> int:
    return sum(1 for line in path.read_text(encoding="utf-8").splitlines() if line)


def _samples(root: Path, run_id: str) -> list[dict]:
    return list(read_lines(samples_path(root, run_id)))


def _import_dupes(
    root: Path,
    run_id: str,
    answers: Path = DUPES_ANSWERS,
    pairs: Path = DUPES_PAIRS,
) -> str:
    return import_board_duplicates(
        root,
        run_id=run_id,
        pairs_path=pairs,
        answers_path=answers,
        now=FIXED_NOW,
    )


# --- SUCCESS 1: one Sample per recorded pair, count asserted from fixture ---


def test_board_duplicates_import_has_one_sample_per_answer_row(runs_root):
    run_id = _import_dupes(runs_root, "imp-dupes")
    samples = _samples(runs_root, run_id)

    # Asserted against the fixture, never against an importer-reported count.
    assert len(samples) == _count_lines(DUPES_ANSWERS)
    assert len(samples) == _count_lines(DUPES_PAIRS)

    for i, sample in enumerate(samples):
        validate("sample", sample)
        assert sample["index"] == i
        assert set(sample["input"]) == {"a", "b", "label", "kind", "baseline"}
        assert set(sample["output"]) == {"noul", "choice", "probs", "conf"}

    by_pair = {(s["input"]["a"], s["input"]["b"]): s for s in samples}
    first = by_pair[("alpha-1", "alpha-2")]
    # ground truth comes from pairs.jsonl, not trusted from the answer row
    assert first["input"]["label"] == 1
    assert first["input"]["kind"] == "superseded"
    assert first["input"]["baseline"] == 0.8123
    assert first["output"]["noul"] == 0.93
    assert first["output"]["choice"] == "same_work"
    assert first["output"]["probs"]["same_work"] == 0.9


# --- one Sample per pair, including a pair with no recorded answer --------


def test_board_duplicates_unanswered_pair_is_an_explicit_skipped_sample(
    runs_root, tmp_path
):
    pairs = tmp_path / "pairs.jsonl"
    pairs.write_text(
        DUPES_PAIRS.read_text(encoding="utf-8")
        + '{"a": "delta-1", "b": "delta-2", "label": 0, '
        '"kind": "random", "baseline": 0.1}\n',
        encoding="utf-8",
    )
    run_id = _import_dupes(runs_root, "imp-partial", answers=DUPES_ANSWERS, pairs=pairs)
    samples = _samples(runs_root, run_id)

    assert len(samples) == _count_lines(pairs)
    assert len(samples) == _count_lines(DUPES_ANSWERS) + 1
    by_pair = {(s["input"]["a"], s["input"]["b"]): s for s in samples}
    assert by_pair[("delta-1", "delta-2")]["status"] == "skipped"
    assert "output" not in by_pair[("delta-1", "delta-2")]
    assert all(
        s["status"] == "ok"
        for key, s in by_pair.items()
        if key != ("delta-1", "delta-2")
    )


# --- SUCCESS 2: blind label join, unlabelled rows stay unlabelled -----------


def test_contract_quality_joins_labels_and_leaves_others_unlabelled(runs_root):
    run_id = import_contract_quality(
        runs_root, run_id="imp-quality", quality_path=QUALITY_FILE, now=FIXED_NOW
    )
    samples = _samples(runs_root, run_id)
    assert len(samples) == _count_lines(QUALITY_FILE)

    by_ref = {s["input"]["ref"]: s for s in samples}
    assert set(by_ref) == {"CORE-101", "CORE-102", "CORE-103"}
    # both outcomes asserted in the same Run
    assert by_ref["CORE-101"]["input"]["label"]["dispatchable"] == "yes"
    assert by_ref["CORE-102"]["input"]["label"]["dispatchable"] == "no"
    assert by_ref["CORE-103"]["input"]["label"] is None
    assert by_ref["CORE-103"]["output"]["execution_mode"] == "live_environment"
    assert by_ref["CORE-102"]["input"]["evidence"]["problem_symbols_missing"] == []


# --- SUCCESS 6: a label file with no sibling key is an explicit error -------


def test_label_file_without_key_file_raises_naming_the_missing_file(runs_root):
    with pytest.raises(MissingKeyFileError) as excinfo:
        import_contract_quality(
            runs_root, run_id="imp-nokey", quality_path=NOKEY_FILE, now=FIXED_NOW
        )
    assert "blind-a.key.json" in str(excinfo.value)
    assert "blind-a.labels.json" in str(excinfo.value)
    assert not run_dir(runs_root, "imp-nokey").exists()


# --- SUCCESS 5: .bad-mask imports invalid and never reaches a metric --------


def test_bad_mask_source_imports_invalid_and_absent_from_metric_rows(
    registry, runs_root, tmp_path
):
    valid = _import_dupes(runs_root, "imp-valid")
    evaluator = registry.latest("evaluator", "exact-match")
    assessments = [
        {"sample_id": s["sample_id"], "answer": {"noul": 1.0}}
        for s in _samples(runs_root, valid)
    ]
    write_assessment_set(
        runs_root,
        valid,
        "as-1",
        evaluator,
        assessments,
        {
            "accuracy": {
                "value": 1.0,
                "se": None,
                "ci95": None,
                "n": len(assessments),
                "method": "test",
            }
        },
        now=FIXED_NOW,
    )

    bad_answers = tmp_path / "answers.jsonl.bad-mask"
    shutil.copyfile(DUPES_ANSWERS, bad_answers)
    invalid = _import_dupes(runs_root, "imp-bad-mask", answers=bad_answers)

    assert load_status(runs_root, invalid)["state"] == "invalid"
    assert load_status(runs_root, valid)["state"] == "success"
    assert run_metrics(runs_root, invalid) == {}

    rows = chart_dataset_rows(
        runs_root, list_run_ids(runs_root), "exact-match::accuracy"
    )
    assert {row["run_id"] for row in rows} == {valid}


def test_import_never_merges_into_an_existing_run(runs_root):
    _import_dupes(runs_root, "imp-fixed")
    before = {
        p.name: p.read_bytes()
        for p in run_dir(runs_root, "imp-fixed").iterdir()
        if p.is_file()
    }
    with pytest.raises(FileExistsError):
        _import_dupes(runs_root, "imp-fixed")
    after = {
        p.name: p.read_bytes()
        for p in run_dir(runs_root, "imp-fixed").iterdir()
        if p.is_file()
    }
    assert after == before
    assert load_status(runs_root, "imp-fixed")["state"] == "success"


# --- SUCCESS 3: every source file is content-hashed; one byte, one hash -----


def test_source_hashes_cover_every_source_and_tamper_changes_exactly_one(
    runs_root, tmp_path
):
    source_dir = tmp_path / "dupes"
    source_dir.mkdir()
    pairs = source_dir / "pairs.jsonl"
    answers = source_dir / "answers.jsonl"
    shutil.copyfile(DUPES_PAIRS, pairs)
    shutil.copyfile(DUPES_ANSWERS, answers)

    run_a = _import_dupes(runs_root, "imp-hash-a", answers=answers, pairs=pairs)
    hashes_a = load_manifest(runs_root, run_a)["code"]["source_hashes"]
    assert set(hashes_a) == {str(pairs), str(answers)}
    assert hashes_a[str(answers)] == content_hash_of_file(answers)

    changed = answers.read_bytes().replace(b"0.93", b"0.94", 1)
    answers.write_bytes(changed)
    run_b = _import_dupes(runs_root, "imp-hash-b", answers=answers, pairs=pairs)
    hashes_b = load_manifest(runs_root, run_b)["code"]["source_hashes"]

    differing = {key for key in hashes_a if hashes_a[key] != hashes_b[key]}
    assert differing == {str(answers)}


def test_contract_quality_hashes_quality_labels_and_key(runs_root):
    run_id = import_contract_quality(
        runs_root, run_id="imp-quality-hash", quality_path=QUALITY_FILE, now=FIXED_NOW
    )
    hashes = load_manifest(runs_root, run_id)["code"]["source_hashes"]
    assert set(hashes) == {str(QUALITY_FILE), str(QUALITY_LABELS), str(QUALITY_KEY)}
    assert all(value.startswith("sha256:") for value in hashes.values())


# --- SUCCESS 4: provenance is Jev + the original scripts, not the platform --


def test_imported_manifest_records_jev_backend_and_script_commit(runs_root):
    run_id = import_contract_quality(
        runs_root, run_id="imp-provenance", quality_path=QUALITY_FILE, now=FIXED_NOW
    )
    manifest = load_manifest(runs_root, run_id)
    validate("manifest", manifest)
    assert manifest["backend"]["provider"] == "jev"
    assert manifest["backend"]["model"] == "jev-latest"
    assert manifest["code"]["repo"] == "specialists"
    assert manifest["code"]["commit"] == "a6e55215"
    assert manifest["code"]["upstream_scripts"] == ["sb_prep.py", "sb_quality3.py"]
    assert manifest["intent"]["trigger"] == "replay"
    assert [a["input"] for a in manifest["aliases"]["unresolved"]] == ["jev-latest"]


# --- SUCCESS 7: a record that cannot be represented is a named refusal ------


def test_unrepresentable_duplicate_record_names_record_and_leaves_no_run_dir(
    runs_root, tmp_path
):
    answers = tmp_path / "answers.jsonl"
    answers.write_text(
        '{"a": "ghost-1", "b": "ghost-2", "noul": 0.5, "choice": "same_work", '
        '"probs": {}, "conf": 0.5}\n',
        encoding="utf-8",
    )
    with pytest.raises(UnrepresentableRecordError) as excinfo:
        _import_dupes(runs_root, "imp-unrepresentable", answers=answers)
    message = str(excinfo.value)
    assert "record 0" in message
    assert "ghost-1" in message
    assert not run_dir(runs_root, "imp-unrepresentable").exists()


def test_contract_label_missing_from_key_names_record_and_leaves_no_run_dir(
    runs_root, tmp_path
):
    board_dir = tmp_path / "core"
    board_dir.mkdir()
    quality = board_dir / "sb-quality-v3.jsonl"
    shutil.copyfile(QUALITY_FILE, quality)
    (board_dir / "blind-a.labels.json").write_text(
        '[{"id": "C-999", "dispatchable": "yes"}]\n', encoding="utf-8"
    )
    (board_dir / "blind-a.key.json").write_text(
        '{"C-001": "CORE-101"}\n', encoding="utf-8"
    )
    with pytest.raises(UnrepresentableRecordError) as excinfo:
        import_contract_quality(
            runs_root, run_id="imp-unlabelled-key", quality_path=quality, now=FIXED_NOW
        )
    assert "C-999" in str(excinfo.value)
    assert "blind-a.key.json" in str(excinfo.value)
    assert not run_dir(runs_root, "imp-unlabelled-key").exists()


def test_schema_invalid_sample_refused_before_run_dir_is_created(
    runs_root, monkeypatch
):
    real_validate = importers.validate

    def fake_validate(kind: str, payload: object) -> None:
        if kind == "sample":
            raise SchemaValidationError("sample: forced failure")
        real_validate(kind, payload)

    monkeypatch.setattr(importers, "validate", fake_validate)
    with pytest.raises(ImportValidationError) as excinfo:
        _import_dupes(runs_root, "imp-invalid-sample")
    assert "record 0" in str(excinfo.value)
    assert not run_dir(runs_root, "imp-invalid-sample").exists()


# --- one CLI import verb ----------------------------------------------------


def _run_cli(argv: list[str], capsys) -> tuple[int, dict]:
    exit_code = main(argv)
    out = capsys.readouterr().out.strip()
    return exit_code, json.loads(out)


def test_cli_import_board_duplicates_envelope(runs_root, capsys):
    code, envelope = _run_cli(
        [
            "--root",
            str(runs_root),
            "--json",
            "import",
            "board-duplicates",
            "--pairs",
            str(DUPES_PAIRS),
            "--answers",
            str(DUPES_ANSWERS),
            "--run-id",
            "imp-cli-dupes",
        ],
        capsys,
    )
    assert code == 0
    validate("cli_envelope", envelope)
    assert envelope["ok"] is True
    assert envelope["command"] == "import board-duplicates"
    assert envelope["data"]["run_id"] == "imp-cli-dupes"
    assert len(_samples(runs_root, "imp-cli-dupes")) == _count_lines(DUPES_ANSWERS)


def test_cli_import_contract_quality_envelope(runs_root, capsys):
    code, envelope = _run_cli(
        [
            "--root",
            str(runs_root),
            "--json",
            "import",
            "contract-quality",
            "--quality",
            str(QUALITY_FILE),
            "--run-id",
            "imp-cli-quality",
        ],
        capsys,
    )
    assert code == 0
    validate("cli_envelope", envelope)
    assert envelope["ok"] is True
    assert envelope["command"] == "import contract-quality"
    assert envelope["data"]["run_id"] == "imp-cli-quality"


def test_cli_import_missing_key_file_is_error_envelope(runs_root, capsys):
    code, envelope = _run_cli(
        [
            "--root",
            str(runs_root),
            "--json",
            "import",
            "contract-quality",
            "--quality",
            str(NOKEY_FILE),
            "--run-id",
            "imp-cli-nokey",
        ],
        capsys,
    )
    assert code != 0
    assert envelope["ok"] is False
    assert "blind-a.key.json" in envelope["error"]
