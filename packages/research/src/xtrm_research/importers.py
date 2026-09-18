"""Offline import of recorded Jev outputs as immutable Runs (XTRM-480).

The two original experiments in ``~/dev/specialists`` (commit a6e55215,
directories ``experiments/jev-dupes/``) already produced their answers:
``dupes.py`` wrote ``pairs.jsonl``/``answers.jsonl`` and ``sb_quality3.py``
wrote ``sb-quality-v3.jsonl`` plus blind ``blind-*.labels.json`` /
``blind-*.key.json`` label batches. This module turns those files into Runs
through the ordinary :func:`xtrm_research.runner.start_run` write path — one
Sample per recorded row — so the evaluator slice can score them without
re-running Jev.

An imported Run is provenance-complete: ``manifest.backend`` names the Jev
backend that actually produced the answers, ``manifest.code`` names the
specialists commit the scripts came from (never the research platform), and
``manifest.code.source_hashes`` records the ``sha256:`` content hash of
every source file the import read. The Run does not claim the platform
produced anything.

Nothing here evaluates, scores or re-runs Jev: it only produces Runs.
"""

from __future__ import annotations

import hashlib
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from xtrm_research.environment import capture_environment
from xtrm_research.guards import guard_versions
from xtrm_research.hashing import compute_content_hash
from xtrm_research.jsonl import read_lines
from xtrm_research.manifest import build_intent, build_manifest
from xtrm_research.runner import start_run
from xtrm_research.schemas import SchemaValidationError, validate
from xtrm_research.store import run_dir

#: The backend whose recorded outputs the import replays. ``jev-latest`` is
#: the mutable model alias the original scripts passed to
#: ``TypeSafeClient``; :func:`xtrm_research.manifest.build_manifest` records
#: it as an unresolved alias, so the Run never pretends the pointer was
#: pinned.
JEV_PROVIDER = "jev"
JEV_MODEL = "jev-latest"

#: The source repository and commit of the scripts whose outputs are being
#: imported (XTRM-429 lineage: PR #390, merge 3d41aca0).
SOURCE_REPO = "specialists"
SOURCE_COMMIT = "a6e55215"

#: A source file whose name ends with this suffix is a bad-mask artefact
#: (``dupes.check_mask`` aborted the run): it imports as an invalid Run,
#: never as a valid one and never merged into one.
BAD_MASK_SUFFIX = ".bad-mask"

_DUPLICATES_EXPERIMENT = "board-duplicates-v1"
_DUPLICATES_WORKLOAD = "board-duplicates"
_DUPLICATES_DATASET = "board-duplicates-answers"
_CONTRACT_EXPERIMENT = "contract-quality-v3"
_CONTRACT_WORKLOAD = "contract-quality"
_CONTRACT_DATASET = "contract-quality-v3"

_SAMPLE_SCHEMA_VERSION = "xtrm-research-sample/v1"


class ImporterError(ValueError):
    """Base class for every refused import."""


class MissingKeyFileError(ImporterError):
    """A ``blind-*.labels.json`` has no sibling ``.key.json``.

    The label join is ``(board, key[id]) -> row``; without the key the file
    cannot be joined, so this is an explicit refusal, never a silent skip
    and never an unlabelled import."""


class UnrepresentableRecordError(ImporterError):
    """A source record cannot become a Sample; the message names it."""


class ImportValidationError(ImporterError):
    """A Sample the importer built failed schema validation."""


def content_hash_of_file(path: Path) -> str:
    """Return the ``sha256:<hex>`` content hash of a source file's bytes."""
    digest = hashlib.sha256(Path(path).read_bytes()).hexdigest()
    return f"sha256:{digest}"


def is_bad_mask(path: Path) -> bool:
    """True when ``path``'s name ends with :data:`BAD_MASK_SUFFIX`."""
    return Path(path).name.endswith(BAD_MASK_SUFFIX)


def import_board_duplicates(
    root: Path,
    *,
    run_id: str,
    pairs_path: Path,
    answers_path: Path,
    now: datetime | None = None,
) -> str:
    """Import ``answers.jsonl`` (joined to ``pairs.jsonl``) as one Run.

    One Sample per answers row: the pair ids plus the ground-truth
    ``label``/``kind``/``baseline`` (read from ``pairs.jsonl``, never
    trusted from the answer row when the two disagree) and the recorded Jev
    ``noul``/``choice``/``probs``/``conf``. Any source name ending
    ``.bad-mask`` produces an invalid Run instead of a valid one.
    """
    root, pairs_path, answers_path = Path(root), Path(pairs_path), Path(answers_path)
    now = now or datetime.now(timezone.utc)

    pair_rows = _read_jsonl(pairs_path, "pairs.jsonl")
    answer_rows = _read_jsonl(answers_path, "answers.jsonl")

    samples = _build_duplicate_samples(
        pair_rows,
        answer_rows,
        pairs_path=pairs_path,
        answers_path=answers_path,
        created_at=now.isoformat(),
    )
    manifest = _import_manifest(
        run_id=run_id,
        experiment_id=_DUPLICATES_EXPERIMENT,
        workload_id=_DUPLICATES_WORKLOAD,
        dataset_id=_DUPLICATES_DATASET,
        source_paths=[pairs_path, answers_path],
        upstream_scripts=["dupes.py"],
        now=now,
    )
    return _write_run(
        root,
        run_id,
        manifest,
        samples,
        invalid=_any_bad_mask([pairs_path, answers_path]),
    )


def import_contract_quality(
    root: Path,
    *,
    run_id: str,
    quality_path: Path,
    labels_dir: Path | None = None,
    now: datetime | None = None,
) -> str:
    """Import one board's ``sb-quality-v3.jsonl`` as one Run.

    One Sample per contract row: the row's ``board``/``ref``/``evidence``
    and its recorded Jev outputs, joined to the blind label for the same
    ``(board, ref)`` when a ``blind-*.labels.json`` and its sibling
    ``.key.json`` are present. A row with no label imports with
    ``input.label: null`` — unlabelled, never guessed. ``labels_dir``
    defaults to the quality file's own directory; every label and key file
    read is content-hashed into the Run.
    """
    root, quality_path = Path(root), Path(quality_path)
    labels_dir = Path(labels_dir) if labels_dir is not None else quality_path.parent
    now = now or datetime.now(timezone.utc)

    rows = _read_jsonl(quality_path, "sb-quality-v3.jsonl")
    board = _single_board(rows, quality_path)
    labels, label_paths = _load_blind_labels(labels_dir, board)

    samples = _build_contract_samples(
        rows,
        labels,
        quality_path=quality_path,
        created_at=now.isoformat(),
    )
    manifest = _import_manifest(
        run_id=run_id,
        experiment_id=_CONTRACT_EXPERIMENT,
        workload_id=_CONTRACT_WORKLOAD,
        dataset_id=_CONTRACT_DATASET,
        source_paths=[quality_path, *label_paths],
        upstream_scripts=["sb_prep.py", "sb_quality3.py"],
        now=now,
    )
    return _write_run(
        root,
        run_id,
        manifest,
        samples,
        invalid=_any_bad_mask([quality_path, *label_paths]),
    )


# --- reading and validating source records --------------------------------


def _read_jsonl(path: Path, what: str) -> list[dict[str, Any]]:
    if not path.exists():
        raise ImporterError(f"{what} not found: {path}")
    records: list[dict[str, Any]] = []
    try:
        for record in read_lines(path):
            records.append(record)
    except json.JSONDecodeError as exc:
        raise UnrepresentableRecordError(
            f"{what} {path}: unreadable JSON record: {exc}"
        ) from exc
    return records


def _require(record: dict[str, Any], field: str, *, source: Path, index: int) -> Any:
    if field not in record:
        raise UnrepresentableRecordError(
            f"{source}: record {index} is missing field {field!r}"
        )
    return record[field]


def _require_number(value: Any, field: str, *, source: Path, index: int) -> None:
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        raise UnrepresentableRecordError(
            f"{source}: record {index} field {field!r} is not a number: {value!r}"
        )


def _build_duplicate_samples(
    pair_rows: list[dict[str, Any]],
    answer_rows: list[dict[str, Any]],
    *,
    pairs_path: Path,
    answers_path: Path,
    created_at: str,
) -> list[dict[str, Any]]:
    truth: dict[tuple[str, str], dict[str, Any]] = {}
    order: list[tuple[str, str]] = []
    for i, row in enumerate(pair_rows):
        a = _require(row, "a", source=pairs_path, index=i)
        b = _require(row, "b", source=pairs_path, index=i)
        label = _require(row, "label", source=pairs_path, index=i)
        kind = _require(row, "kind", source=pairs_path, index=i)
        baseline = _require(row, "baseline", source=pairs_path, index=i)
        if label not in (0, 1):
            raise UnrepresentableRecordError(
                f"{pairs_path}: record {i} has a non-binary label: {label!r}"
            )
        _require_number(baseline, "baseline", source=pairs_path, index=i)
        key = (a, b)
        if key in truth:
            raise UnrepresentableRecordError(
                f"{pairs_path}: record {i} repeats the pair {key}"
            )
        truth[key] = {"label": label, "kind": kind, "baseline": baseline}
        order.append(key)

    outputs: dict[tuple[str, str], dict[str, Any]] = {}
    for i, row in enumerate(answer_rows):
        a = _require(row, "a", source=answers_path, index=i)
        b = _require(row, "b", source=answers_path, index=i)
        key = (a, b)
        if key in outputs:
            raise UnrepresentableRecordError(
                f"{answers_path}: record {i} repeats the pair {key}; "
                f"answers.jsonl must be deduplicated on (a, b)"
            )
        if key not in truth:
            raise UnrepresentableRecordError(
                f"{answers_path}: record {i} pair {key} has no row in {pairs_path}"
            )
        expected = truth[key]
        for field in ("label", "kind", "baseline"):
            if field in row and row[field] != expected[field]:
                raise UnrepresentableRecordError(
                    f"{answers_path}: record {i} field {field!r}={row[field]!r} "
                    f"disagrees with {pairs_path} ({expected[field]!r})"
                )
        noul = _require(row, "noul", source=answers_path, index=i)
        choice = _require(row, "choice", source=answers_path, index=i)
        probs = _require(row, "probs", source=answers_path, index=i)
        conf = _require(row, "conf", source=answers_path, index=i)
        _require_number(noul, "noul", source=answers_path, index=i)
        _require_number(conf, "conf", source=answers_path, index=i)
        if not isinstance(choice, str):
            raise UnrepresentableRecordError(
                f"{answers_path}: record {i} field 'choice' is not a string: {choice!r}"
            )
        if not isinstance(probs, dict):
            raise UnrepresentableRecordError(
                f"{answers_path}: record {i} field 'probs' is not an object: {probs!r}"
            )
        outputs[key] = {
            "noul": noul,
            "choice": choice,
            "probs": probs,
            "conf": conf,
        }

    # One Sample per pairs.jsonl row, in file order. A pair with no recorded
    # answer is an explicit ``skipped`` Sample, never a silent drop.
    samples: list[dict[str, Any]] = []
    for a, b in order:
        expected = truth[(a, b)]
        answer = outputs.get((a, b))
        sample: dict[str, Any] = {
            "schema_version": _SAMPLE_SCHEMA_VERSION,
            "sample_id": f"dupe-{a}--{b}",
            "index": len(samples),
            "input": {
                "a": a,
                "b": b,
                "label": expected["label"],
                "kind": expected["kind"],
                "baseline": expected["baseline"],
            },
            "status": "ok" if answer is not None else "skipped",
            "created_at": created_at,
        }
        if answer is not None:
            sample["output"] = answer
        samples.append(sample)
    return samples


def _single_board(rows: list[dict[str, Any]], quality_path: Path) -> str:
    boards = sorted(
        {
            _require(row, "board", source=quality_path, index=i)
            for i, row in enumerate(rows)
        }
    )
    if len(boards) > 1:
        offender = next(
            i
            for i, row in enumerate(rows)
            if _require(row, "board", source=quality_path, index=i) != boards[0]
        )
        raise UnrepresentableRecordError(
            f"{quality_path}: record {offender} mixes boards {boards}; "
            f"one Run holds one board"
        )
    return boards[0] if boards else quality_path.parent.name


def _load_blind_labels(
    labels_dir: Path, board: str
) -> tuple[dict[tuple[str, str], dict[str, Any]], list[Path]]:
    if not labels_dir.is_dir():
        raise ImporterError(f"labels directory not found: {labels_dir}")
    labels: dict[tuple[str, str], dict[str, Any]] = {}
    sources: list[Path] = []
    for labels_path in sorted(labels_dir.glob("blind-*.labels.json")):
        key_path = labels_path.with_name(
            labels_path.name.replace(".labels.json", ".key.json")
        )
        if not key_path.exists():
            raise MissingKeyFileError(
                f"label file {labels_path} has no sibling key file {key_path}"
            )
        sources.extend([labels_path, key_path])
        key_map = json.loads(key_path.read_text(encoding="utf-8"))
        if not isinstance(key_map, dict):
            raise UnrepresentableRecordError(
                f"{key_path}: key file is not a C-id -> ref object"
            )
        entries = json.loads(labels_path.read_text(encoding="utf-8"))
        if not isinstance(entries, list):
            raise UnrepresentableRecordError(
                f"{labels_path}: label file is not a list of label objects"
            )
        for j, entry in enumerate(entries):
            label_id = _require(entry, "id", source=labels_path, index=j)
            ref = key_map.get(label_id)
            if ref is None:
                raise UnrepresentableRecordError(
                    f"label {label_id!r} in {labels_path} has no entry in key file {key_path}"
                )
            labels[(board, ref)] = entry
    return labels, sources


def _build_contract_samples(
    rows: list[dict[str, Any]],
    labels: dict[tuple[str, str], dict[str, Any]],
    *,
    quality_path: Path,
    created_at: str,
) -> list[dict[str, Any]]:
    output_fields = (
        "execution_mode",
        "executable",
        "open_decision",
        "validation_covers_success",
        "self_blocked",
    )
    samples: list[dict[str, Any]] = []
    for i, row in enumerate(rows):
        board = _require(row, "board", source=quality_path, index=i)
        ref = _require(row, "ref", source=quality_path, index=i)
        evidence = _require(row, "evidence", source=quality_path, index=i)
        for field in output_fields:
            _require(row, field, source=quality_path, index=i)
        for field in (
            "executable",
            "open_decision",
            "validation_covers_success",
            "self_blocked",
        ):
            _require_number(row[field], field, source=quality_path, index=i)
        samples.append(
            {
                "schema_version": _SAMPLE_SCHEMA_VERSION,
                "sample_id": f"contract-{board}--{ref}",
                "index": len(samples),
                "input": {
                    "board": board,
                    "ref": ref,
                    "evidence": evidence,
                    "label": labels.get((board, ref)),
                },
                "output": {field: row[field] for field in output_fields},
                "status": "ok",
                "created_at": created_at,
            }
        )
    return samples


# --- manifest and write path ----------------------------------------------


def _stub_definition(definition_id: str) -> dict[str, str]:
    payload = {"id": definition_id, "version": "v1"}
    return {**payload, "content_hash": compute_content_hash(payload)}


def _import_manifest(
    *,
    run_id: str,
    experiment_id: str,
    workload_id: str,
    dataset_id: str,
    source_paths: list[Path],
    upstream_scripts: list[str],
    now: datetime,
) -> dict[str, Any]:
    source_hashes = {
        str(path): content_hash_of_file(path)
        for path in sorted(set(source_paths), key=str)
    }
    return build_manifest(
        run_id=run_id,
        experiment=_stub_definition(experiment_id),
        workload=_stub_definition(workload_id),
        dataset=_stub_definition(dataset_id),
        variant=_stub_definition("jev-recorded"),
        evaluators=[],
        question_specs=[],
        backend={
            "provider": JEV_PROVIDER,
            "model": JEV_MODEL,
            "model_version": "unrecorded",
        },
        code={
            "repo": SOURCE_REPO,
            "commit": SOURCE_COMMIT,
            "dirty": False,
            "source_hashes": source_hashes,
            "upstream_scripts": upstream_scripts,
        },
        guards=guard_versions(),
        accounting={
            "price_table_version": "recorded",
            "telemetry_schema_version": "xtrm-research-telemetry/v1",
            "otel_semconv_ref": "gen_ai/v1.28",
        },
        environment=capture_environment(),
        seed=0,
        intent=build_intent(
            purpose=f"offline replay of recorded Jev outputs ({experiment_id})",
            trigger="replay",
            requested_by="xtrm-research import",
            tags=["import", "jev", SOURCE_COMMIT],
        ),
        now=now,
    )


def _any_bad_mask(paths: list[Path]) -> bool:
    return any(is_bad_mask(path) for path in paths)


def _write_run(
    root: Path,
    run_id: str,
    manifest: dict[str, Any],
    samples: list[dict[str, Any]],
    *,
    invalid: bool,
) -> str:
    # Validate every Sample before start_run so a refused import never
    # leaves a partial Run directory behind, and the failure names the
    # record that could not be represented.
    for i, sample in enumerate(samples):
        try:
            validate("sample", sample)
        except SchemaValidationError as exc:
            raise ImportValidationError(
                f"record {i} (sample_id={sample.get('sample_id')!r}) failed "
                f"sample validation: {exc}"
            ) from exc

    handle = start_run(root, run_id, manifest)
    try:
        for sample in samples:
            handle.write_sample(sample)
        handle.finish("invalid" if invalid else "success")
    except BaseException:
        # start_run is the only thing that created the directory; a failed
        # write must not leave a half-written Run for a metric to read.
        shutil.rmtree(run_dir(root, run_id), ignore_errors=True)
        raise
    return run_id
