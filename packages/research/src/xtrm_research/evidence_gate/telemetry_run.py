"""System One telemetry as three separate records per request (XTRM-502).

    python -m xtrm_research.evidence_gate.telemetry_run --dataset DIR --labels DIR --runs DIR --root DIR

XTRM-99 §4: "System One answer, policy decision, side effect and realized
outcome are different events and are never collapsed into one record."
This writes one platform run over the Jev arm of the Evidence Gate (the
recorded answers; no new model call) in which every frozen item yields:

1. ``system_one_call`` — the answer: request_id (TypeSafe's own), model,
   model_version, backend, question_spec_hash, state_hash, workload,
   nouls (no confidence), usage, latency; cost from the versioned price
   table in ``data.cost`` (the usage record's cost stays null: TypeSafe
   does not expose one, and the usage record never derives cost).
2. ``policy_action`` — the deterministic gate's decision on those answers,
   by a separately versioned policy, with the calibrated inputs, the
   thresholds it applied, the calibration bucket, and ``side_effect:
   none`` (the research run performs none).
3. ``outcome`` — the reference labels that resolve the request, with the
   resolver (label version and labels hash) and ``resolved_at``.

All three carry the same ``request_id`` and ``sample_id``, and
``telemetry_refs`` pointing at the observation the item came from (the Pi
session or Specialists job whose search produced the passage).
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from xtrm_research.code_state import capture_code_state
from xtrm_research.environment import capture_environment
from xtrm_research.evidence_gate import compare as cmp
from xtrm_research.evidence_gate import dataset as d
from xtrm_research.evidence_gate.frontier import jev_questions
from xtrm_research.evidence_gate.labels import BINARY
from xtrm_research.guards import guard_versions
from xtrm_research.hashing import compute_content_hash
from xtrm_research.importers import _stub_definition
from xtrm_research.manifest import build_intent, build_manifest
from xtrm_research.runner import start_run
from xtrm_research.system_one import state_hash
from xtrm_research.telemetry import telemetry_refs, usage_record

POLICY = {
    "id": "evidence-gate-policy",
    "version": "v1",
    "rule": "retain_evidence if calibrated P(contains_usable_evidence) >= fold threshold; "
    "else retain_contradiction if that path is established and P(contradicts_query_assumption) "
    ">= its threshold; else reject. Thresholds: largest t with training-fold recall >= 0.95.",
}
POLICY["content_hash"] = compute_content_hash(POLICY)
ARM = "jev"


def refs_for(item: dict[str, Any]) -> dict[str, Any]:
    ref = item["source_ref"]
    if "#job=" in ref:
        return telemetry_refs(specialists_job_id=ref.split("#job=")[1].split(";")[0])
    if item["source_kind"] == "pi-ctx_search":
        return telemetry_refs(pi_session_id=Path(ref.split("#")[0]).stem)
    # Claude Code transcripts have no telemetry_refs field (gap recorded in
    # docs/xtrm-99/telemetry.md); the source_ref stays in data.
    return telemetry_refs()


def bucket(p: float) -> str:
    lo = min(int(p * 10), 9) / 10
    return f"[{lo:.1f},{lo + 0.1:.1f})"


def records(
    ev: cmp.Evaluation,
    preds: dict[str, dict[str, Any]],
    labels_meta: dict[str, Any],
    resolved_at: str,
) -> list[tuple[str, dict[str, Any], dict[str, Any] | None, dict[str, Any] | None]]:
    """(kind, data, usage, telemetry_refs) triples in write order."""
    spec_hash = compute_content_hash({"questions": jev_questions()})
    out = []
    by_id = {i["item_id"]: i for i in ev.items}
    for n, item_id in enumerate(ev.ids):
        item, row = by_id[item_id], preds[item_id]
        rid = row["request_id"]
        refs = refs_for(item)
        entry = ev.prices["entries"].get(row["model"])
        cost = (
            {
                "value": cmp.item_cost(ARM, row, ev.prices),
                "currency": entry["currency"],
                "basis": f"prices.json {ev.prices['version']} x provider token counts",
            }
            if entry
            else {"value": None, "null_reason": "no_price_entry"}
        )
        usage = usage_record(
            source="provider_api",
            input_tokens=row["usage"]["input_tokens"],
            output_tokens=row["usage"]["output_tokens"],
            request_model="jev-latest",
            response_model=row["model"],
            latency_ms=row["latency_ms"],
            null_reason="not_exposed_by_provider",
            null_detail="TypeSafe returns no cost; data.cost is derived from the price table",
        )
        out.append(
            (
                "system_one_call",
                {
                    "request_id": rid,
                    "backend": "jev-typesafe-v1",
                    "model": "jev-latest",
                    "model_version": row["model"],
                    "question_spec_hash": spec_hash,
                    "state_hash": state_hash(item["state"]),
                    "workload": "evidence-gate",
                    "answers": {q: {"noul": row["raw"][q]} for q in BINARY},
                    "latency_ms": row["latency_ms"],
                    "cost": cost,
                    "source_ref": item["source_ref"],
                },
                usage,
                refs,
            )
        )
        evidence = ev.decision[ARM]["contains_usable_evidence"][n] == 1
        contra = (
            ev.established["contradicts_query_assumption"]
            and ev.decision[ARM]["contradicts_query_assumption"][n] == 1
        )
        fold = ev.folds[n]
        out.append(
            (
                "policy_action",
                {
                    "request_id": rid,
                    "policy": {k: POLICY[k] for k in ("id", "version", "content_hash")},
                    "action": "retain_evidence"
                    if evidence
                    else "retain_contradiction"
                    if contra
                    else "reject",
                    "inputs": {
                        q: ev.p[ARM][q][n]
                        for q in (
                            "contains_usable_evidence",
                            "contradicts_query_assumption",
                        )
                    },
                    "thresholds": {
                        q: ev.thresholds[ARM][q][fold]
                        for q in (
                            "contains_usable_evidence",
                            "contradicts_query_assumption",
                        )
                    },
                    "calibration": {"method": "platt, out-of-fold", "fold": fold},
                    "calibration_bucket": bucket(
                        ev.p[ARM]["contains_usable_evidence"][n]
                    ),
                    "side_effect": "none",
                },
                None,
                refs,
            )
        )
        out.append(
            (
                "outcome",
                {
                    "request_id": rid,
                    "resolved": {q: ev.y[q][n] for q in BINARY},
                    "resolver": {
                        "kind": "reference_labels",
                        "label_version": labels_meta["label_version"],
                        "labels_sha256": labels_meta["labels_sha256"],
                    },
                    "resolved_at": resolved_at,
                },
                None,
                refs,
            )
        )
    return out


def write_run(
    root: Path,
    run_id: str,
    ev: cmp.Evaluation,
    preds: dict[str, dict[str, Any]],
    labels_meta: dict[str, Any],
    resolved_at: str,
    dataset_def: dict[str, Any],
) -> Path:
    manifest = build_manifest(
        run_id=run_id,
        experiment=_stub_definition("evidence-gate-v2"),
        workload=_stub_definition("evidence-gate"),
        dataset={k: dataset_def[k] for k in ("id", "version", "content_hash")},
        variant=_stub_definition("jev-latest-gate-policy-v1"),
        evaluators=[],
        question_specs=[],
        backend={
            "provider": "typesafe",
            "model": "jev-1.13.0",
            "model_version": "jev-1.13.0",
        },
        code=capture_code_state(Path(__file__).resolve().parents[3]),
        guards=guard_versions(),
        accounting={
            "price_table_version": ev.prices["version"],
            "telemetry_schema_version": "xtrm-research-telemetry/v1",
            "otel_semconv_ref": "gen_ai/v1.28",
        },
        environment=capture_environment(),
        seed=0,
        intent=build_intent(
            purpose="XTRM-502: System One answer, policy decision and outcome as separate linked records",
            trigger="replay",
            requested_by="XTRM-492",
            tags=["xtrm-99", "evidence-gate", "telemetry"],
        ),
    )
    handle = start_run(root, run_id, manifest)
    for seq, (kind, data, usage, refs) in enumerate(
        records(ev, preds, labels_meta, resolved_at)
    ):
        event: dict[str, Any] = {
            "schema_version": "xtrm-research-event/v1",
            "seq": seq,
            "ts": datetime.now(timezone.utc).isoformat(),
            "kind": kind,
            "sample_id": data["request_id"],
            "data": data,
            "telemetry_refs": refs,
        }
        if usage is not None:
            event["usage"] = usage
        handle.write_event(event)
    handle.finish("success")
    return root / run_id


def main() -> None:
    parser = argparse.ArgumentParser()
    for flag in ("--dataset", "--labels", "--runs", "--root"):
        parser.add_argument(flag, type=Path, required=True)
    parser.add_argument("--run-id", default="evidence-gate-v2-jev-telemetry")
    parser.add_argument(
        "--dataset-def",
        type=Path,
        default=Path(__file__).resolve().parents[3]
        / "registry/dataset/evidence-gate-v2.json",
    )
    args = parser.parse_args()
    ds, lb, runs = (p.expanduser() for p in (args.dataset, args.labels, args.runs))
    items = d.load_items(ds)
    labels = {r["item_id"]: r for r in cmp._jsonl(lb / "labels.jsonl")}
    labels_meta = json.loads((lb / "labels_manifest.json").read_text(encoding="utf-8"))
    preds = {a: cmp.latest_answers(runs / f"{a}.jsonl") for a in cmp.MODEL_ARMS}
    tokens, _ = cmp.count_tokens(items)
    ev = cmp.Evaluation(items, labels, preds, tokens)
    resolved_at = datetime.fromtimestamp(
        (lb / "labels.jsonl").stat().st_mtime, timezone.utc
    ).isoformat()
    dataset_def = json.loads(args.dataset_def.read_text(encoding="utf-8"))
    path = write_run(
        args.root.expanduser(),
        args.run_id,
        ev,
        preds[ARM],
        labels_meta,
        resolved_at,
        dataset_def,
    )
    print(path)


if __name__ == "__main__":
    main()
