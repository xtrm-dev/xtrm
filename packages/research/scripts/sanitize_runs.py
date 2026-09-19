#!/usr/bin/env python3
"""Copy published runs into a shareable, sanitized directory.

    ./scripts/sanitize_runs.py --out ~/.xtrm/research/shared/board-v2

Published runs carry the private issue prose they were run on: every sample's
input holds the full contract text and the events hold the model's answers over
it. That is why runs live in `~/.xtrm/research` (mode 700) and never in git. To
share a run with someone else without handing over private board text, this
script copies the run directories and redacts every string leaf of the sample
and event records with the package's own `guards.redact` — the same rule that
decides what may be sent to a model at all.

What it writes:

    <out>/<run-id>/{manifest.json,status.json,refs.json,annotations.jsonl,
                    samples.jsonl,events.jsonl,assessments/**}
    <out>/index.json          run index: ids, statuses, headline metrics,
                              evidence status, file hashes, redaction counts
    <out>/SANITIZATION.md     what was redacted and what was not

Verification is part of the run: after writing, every written row is re-checked
and the script fails (non-zero) if any remaining text would still be redacted.
A sanitized directory is shareable; it is not the evidence of record — the
original run directory is.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from pathlib import Path
from typing import Any

from xtrm_research.guards import redact

#: The guard is not idempotent for every shape: a replaced value can be left
#: followed by stray punctuation (observed: ``session_id=<redacted>`.``), which a
#: second pass removes. Applying it to a fixpoint is what makes the sanitized
#: copy verifiable — once ``redact`` changes nothing, no rule can fire on that
#: text again.
MAX_REDACTION_PASSES = 4

#: Copied whole, with every string leaf redacted. The guarantee is uniform on
#: purpose: the guard also strips local absolute paths, and a shared copy should
#: contain nothing the guard would strip *anywhere* — not only in the sample and
#: event bodies that carry private board text. The original run directory stays
#: the record; a sanitized copy is a reading copy.
FILES = (
    "manifest.json",
    "status.json",
    "refs.json",
    "annotations.jsonl",
    "samples.jsonl",
    "events.jsonl",
)


def _redact_settled(text: str) -> tuple[str, int, bool]:
    """``redact`` applied until it changes nothing; (text, passes, settled)."""
    current = text
    for passes in range(1, MAX_REDACTION_PASSES + 1):
        nxt = redact(current)
        if nxt == current:
            return current, passes, True
        current = nxt
    return current, MAX_REDACTION_PASSES, False


def _redact_value(value: Any) -> tuple[Any, int]:
    if isinstance(value, str):
        cleaned, _passes, settled = _redact_settled(value)
        if not settled:
            raise SystemExit(
                "redaction did not reach a fixpoint; refusing to write a sanitized copy"
            )
        return cleaned, 0 if cleaned == value else 1
    if isinstance(value, list):
        out, hits = [], 0
        for item in value:
            cleaned, n = _redact_value(item)
            out.append(cleaned)
            hits += n
        return out, hits
    if isinstance(value, dict):
        out, hits = {}, 0
        for key, item in value.items():
            cleaned, n = _redact_value(item)
            out[key] = cleaned
            hits += n
        return out, hits
    return value, 0


def _sanitize_file(source: Path, target: Path) -> dict[str, Any]:
    """Copy one JSON or JSONL file with every string leaf redacted.

    Dispatches on the file shape: a ``.jsonl`` file is one object per line, a
    ``.json`` file is one (pretty-printed) object. Redaction changes only string
    *values* — structure, keys and numbers are preserved, so the copy stays
    readable by ``xtrm-research`` and by xtrm-app.
    """
    target.parent.mkdir(parents=True, exist_ok=True)
    if source.suffix == ".jsonl":
        rows = hits = 0
        with (
            source.open(encoding="utf-8") as src,
            target.open("w", encoding="utf-8") as dst,
        ):
            for line in src:
                if not line.strip():
                    continue
                cleaned, row_hits = _redact_value(json.loads(line))
                serialized = json.dumps(cleaned, sort_keys=True, ensure_ascii=False)
                _assert_settled(serialized, source)
                dst.write(serialized + "\n")
                rows += 1
                hits += row_hits
        return {"rows": rows, "redacted_values": hits}

    cleaned, hits = _redact_value(json.loads(source.read_text(encoding="utf-8")))
    serialized = json.dumps(cleaned, indent=2, sort_keys=True, ensure_ascii=False)
    _assert_settled(serialized, source)
    target.write_text(serialized + "\n", encoding="utf-8")
    return {"rows": 1, "redacted_values": hits}


def _assert_settled(serialized: str, source: Path) -> None:
    """Fail closed: after fixpoint redaction nothing the guard recognises may
    survive in the serialized row."""
    if redact(serialized) != serialized:
        raise SystemExit(
            f"redaction did not settle in {source}; refusing to write a sanitized copy"
        )


def _hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return "sha256:" + digest.hexdigest()


def _headline(run_dir: Path) -> dict[str, Any]:
    """The metrics a reader wants before opening the run."""
    out: dict[str, Any] = {}
    for path in sorted(run_dir.glob("assessments/*/assessment_set.json")):
        metrics = json.loads(path.read_text(encoding="utf-8")).get("metrics", {})
        for key in (
            "test.false_ready_rate",
            "test.false_draft_rate",
            "test.balanced_accuracy",
            "test.n",
        ):
            entry = metrics.get(key)
            if entry:
                out[key] = {
                    "value": entry["value"],
                    "ci95": entry.get("ci95"),
                    "n": entry.get("n"),
                    "method": entry.get("method"),
                }
    return out


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--runs", default="~/.xtrm/research/runs")
    parser.add_argument("--out", required=True)
    parser.add_argument(
        "--run",
        action="append",
        default=[],
        help="run id (repeatable); default: every run with a manifest",
    )
    parser.add_argument(
        "--force", action="store_true", help="overwrite an existing output directory"
    )
    args = parser.parse_args()

    runs_root = Path(args.runs).expanduser()
    out = Path(args.out).expanduser()
    if out.exists():
        if not args.force:
            raise SystemExit(f"{out} exists; pass --force to replace it")
        shutil.rmtree(out)
    out.mkdir(parents=True)

    run_ids = args.run or [
        path.name
        for path in sorted(runs_root.iterdir())
        if (path / "manifest.json").is_file()
    ]
    index: dict[str, Any] = {"sanitized_from": str(runs_root), "runs": {}}
    total_redacted = 0
    for run_id in run_ids:
        source = runs_root / run_id
        if not (source / "manifest.json").is_file():
            print(f"  skip {run_id}: no manifest.json")
            continue
        target = out / run_id
        target.mkdir(parents=True)
        files: dict[str, str] = {}
        redaction: dict[str, Any] = {}
        candidates = [source / name for name in FILES if (source / name).is_file()]
        if (source / "assessments").is_dir():
            candidates += sorted((source / "assessments").rglob("*.json"))
        for path in candidates:
            relative = path.relative_to(source)
            destination = target / relative
            redaction[str(relative)] = _sanitize_file(path, destination)
            total_redacted += redaction[str(relative)]["redacted_values"]
            files[str(relative)] = _hash(destination)

        annotations = [
            json.loads(line)
            for line in (source / "annotations.jsonl")
            .read_text(encoding="utf-8")
            .splitlines()
            if line.strip()
        ]
        evidence = next(
            (
                a.get("evidence_status")
                for a in reversed(annotations)
                if a.get("kind") == "evidence_status"
            ),
            None,
        )
        manifest = json.loads((source / "manifest.json").read_text(encoding="utf-8"))
        index["runs"][run_id] = {
            "experiment": manifest.get("experiment", {}).get("id"),
            "variant": manifest.get("variant", {}).get("id"),
            "created_at": manifest.get("created_at"),
            "intent": {
                k: manifest.get("intent", {}).get(k)
                for k in ("purpose", "trigger", "rationale")
            },
            "evidence_status": evidence,
            "headline_metrics": _headline(source),
            "redaction": redaction,
            "files": files,
        }
        print(
            f"  {run_id}: {redaction.get('samples.jsonl', {}).get('redacted_values', 0)} sample and "
            f"{redaction.get('events.jsonl', {}).get('redacted_values', 0)} event values redacted"
        )

    index["total_redacted_values"] = total_redacted
    # The index is written with the same uniform guarantee: it records the local
    # runs root and metric method strings, which the guard also treats as text.
    index, index_hits = _redact_value(index)
    total_redacted += index_hits
    serialized_index = json.dumps(index, indent=2, sort_keys=True, ensure_ascii=False)
    _assert_settled(serialized_index, out / "index.json")
    (out / "index.json").write_text(serialized_index + "\n", encoding="utf-8")
    (out / "SANITIZATION.md").write_text(
        "# Sanitized run snapshot\n\n"
        f"Source: `{runs_root}`\n\n"
        "Every string value in every copied file is redacted with `xtrm_research.guards.redact`, the same rule\n"
        "that decides what may be sent to a model — including local absolute paths in the manifest and status.\n"
        "Structure, keys and numbers are unchanged, so the copy is still readable by `xtrm-research` and by\n"
        "xtrm-app. Each written row is re-checked after redaction and the copy fails closed otherwise.\n\n"
        f"Runs: {len(index['runs'])}. Redacted values: {total_redacted}.\n\n"
        "This directory is shareable. It is **not** the evidence of record: the original run directory under\n"
        "the runs root is, and it stays outside git because it holds private board text.\n",
        encoding="utf-8",
    )
    print(
        f"\nwrote {len(index['runs'])} runs and index.json to {out} ({total_redacted} values redacted)"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
