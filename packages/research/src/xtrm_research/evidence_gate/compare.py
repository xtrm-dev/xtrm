"""Evidence Gate five-way comparison on the frozen set (XTRM-499).

    python -m xtrm_research.evidence_gate.compare --dataset DIR --labels DIR --runs DIR --out FILE

Arms: ``no-filter`` (retain everything), ``embedding``, ``qwen``, ``jev``,
``frontier``. Every metric is computed on ONE evaluation set — the frozen
items that carry every binary reference label and an answer from every
model arm — and every interval comes from the same cluster resamples, so
each arm-vs-arm delta is paired item-for-item.

Gate policy (deterministic, identical for every arm): retain a candidate
when its out-of-fold calibrated P(contains_usable_evidence) or
P(contradicts_query_assumption) clears that question's recall-targeted
threshold; an arm that does not answer a question never retains through it.
Injection is scored as a flag (P(contains_prompt_injection) over its
threshold), reported separately.

Calibration and thresholds are fit once, out-of-fold (see
:mod:`calibration`); the bootstrap resamples evaluation items, not the
calibration fit, so intervals do not include calibration-fit variance.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from xtrm_research.evidence_gate import calibration as cal
from xtrm_research.evidence_gate import dataset as d
from xtrm_research.evidence_gate import stats
from xtrm_research.evidence_gate.labels import BINARY, ORDINAL

MODEL_ARMS = ("embedding", "qwen", "jev", "frontier", "llm")
ARMS = ("no-filter", *MODEL_ARMS)
REFERENCE_ARMS = ("frontier", "llm", "no-filter")
#: Arms whose raw answer is already a probability (Brier/ECE on raw is
#: meaningful); a cosine similarity is not.
PROBABILITY_ARMS = ("qwen", "jev", "frontier", "llm")
EVIDENCE = "contains_usable_evidence"
CONTRADICTION = "contradicts_query_assumption"
INJECTION = "contains_prompt_injection"
GATE_METRICS = (
    "useful_evidence_recall",
    "retained_precision",
    "contradiction_preservation",
    "injection_flag_recall",
    "retention_rate",
    "frontier_input_token_reduction",
    "latency_p50_ms",
    "latency_p95_ms",
    "frontier_api_latency_p50_ms",
    "cost_usd_per_1000_candidates",
)
LEVELS = ("1", "2", "3", "4")
#: A question with fewer positives than this in the evaluation set cannot
#: be calibrated or thresholded meaningfully: its policy path is disabled
#: and its metrics are reported as not established. (Without this, a fold
#: whose training part has no positive accepts every item, and one real
#: contradiction in 265 items would make every arm retain everything.)
MIN_POSITIVES = 10


def _jsonl(path: Path) -> list[dict[str, Any]]:
    return [
        json.loads(line)
        for line in path.read_text(encoding="utf-8").splitlines()
        if line
    ]


def latest_answers(path: Path) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for row in _jsonl(path):
        if row.get("status", "answered") == "answered":
            out[row["item_id"]] = row
    return out


def load_prices() -> dict[str, Any]:
    return json.loads(
        (Path(__file__).with_name("prices.json")).read_text(encoding="utf-8")
    )


def item_cost(arm: str, row: dict[str, Any], prices: dict[str, Any]) -> float | None:
    if arm == "no-filter":
        return 0.0
    if arm in ("frontier", "llm"):
        return row["usage"].get("cost_usd")
    if arm == "jev":
        entry = prices["entries"].get(row.get("model"))
        if entry is None:
            return None
        usage = row["usage"]
        return (
            usage["input_tokens"] * entry["input_per_mtok"]
            + usage["output_tokens"] * entry["output_per_mtok"]
        ) / 1e6
    return None  # local arms: CPU on the operator machine, not metered


#: One basis for every model arm: wall-clock time around the whole guarded
#: call (guard stage + transport + provider). Local arms: CPU time on the
#: operator host at 2 torch threads. The frontier arm's provider-reported
#: API time is reported separately (``frontier_api_latency_p50_ms``), never
#: mixed into the cross-arm latency comparison (XTRM-506 review finding).
LATENCY_BASIS = {
    "no-filter": "none (no call)",
    "embedding": "wall clock, local CPU, 2 torch threads, shared host",
    "qwen": "wall clock, local CPU, 2 torch threads, shared host",
    "jev": "wall clock around guarded_send: guard + HTTPS round trip to TypeSafe",
    "frontier": "wall clock around guarded_send: guard + claude CLI process start + API",
    "llm": "wall clock around guarded_send: guard + pi CLI process start + API",
}


def item_latency(arm: str, row: dict[str, Any]) -> float:
    if arm == "no-filter":
        return 0.0
    return float(row["latency_ms"])


def percentile(values: list[float], q: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    pos = q * (len(ordered) - 1)
    lo, hi = int(pos), min(int(pos) + 1, len(ordered) - 1)
    return ordered[lo] + (ordered[hi] - ordered[lo]) * (pos - lo)


def _ratio(num: float, den: float) -> float | None:
    return num / den if den else None


class Evaluation:
    """Everything fixed before resampling: labels, OOF probabilities,
    decisions, per-item latency/cost/tokens for every arm."""

    def __init__(
        self,
        items: list[dict[str, Any]],
        labels: dict[str, dict[str, Any]],
        preds: dict[str, dict[str, dict[str, Any]]],
        tokens: dict[str, int],
    ) -> None:
        self.prices = load_prices()
        eligible, self.exclusions = [], {"missing_label": 0, "missing_arm_answer": {}}
        for item in items:
            row = labels.get(item["item_id"])
            if row is None or any(row.get(q) is None for q in BINARY):
                self.exclusions["missing_label"] += 1
                continue
            missing = [a for a in MODEL_ARMS if item["item_id"] not in preds[a]]
            if missing:
                for a in missing:
                    self.exclusions["missing_arm_answer"][a] = (
                        self.exclusions["missing_arm_answer"].get(a, 0) + 1
                    )
                continue
            eligible.append(item)
        self.items = eligible
        self.ids = [i["item_id"] for i in eligible]
        self.y = {q: [int(labels[i][q]) for i in self.ids] for q in BINARY}
        self.authority = [labels[i].get(ORDINAL) for i in self.ids]
        self.tokens = [tokens[i] for i in self.ids]
        keys = [i["source_ref"] for i in eligible]
        fold_of = cal.fold_of_clusters(keys)
        self.folds = [fold_of[k] for k in keys]
        self.clusters = [
            [n for n, k in enumerate(keys) if k == key] for key in dict.fromkeys(keys)
        ]
        self.raw: dict[str, dict[str, list[float]]] = {}
        self.p: dict[str, dict[str, list[float]]] = {}
        self.p_iso: dict[str, dict[str, list[float]]] = {}
        self.decision: dict[str, dict[str, list[int]]] = {}
        self.thresholds: dict[str, dict[str, list[float | None]]] = {}
        self.fits: dict[str, dict[str, Any]] = {}
        self.latency: dict[str, list[float]] = {}
        self.cost: dict[str, list[float | None]] = {}
        self.authority_probs: dict[str, list[dict[str, float] | None]] = {}
        for arm in MODEL_ARMS:
            rows = [preds[arm][i] for i in self.ids]
            self.latency[arm] = [item_latency(arm, r) for r in rows]
            self.cost[arm] = [item_cost(arm, r, self.prices) for r in rows]
            if arm in ("jev", "frontier", "llm"):
                self.authority_probs[arm] = [
                    (r.get("score_probabilities") or {}).get(ORDINAL) for r in rows
                ]
            self.raw[arm], self.p[arm], self.p_iso[arm] = {}, {}, {}
            self.decision[arm], self.thresholds[arm], self.fits[arm] = {}, {}, {}
            for q in BINARY:
                values = [r["raw"].get(q) for r in rows]
                if any(v is None for v in values):
                    continue
                x = (
                    [cal.logit(v) for v in values]
                    if arm in PROBABILITY_ARMS
                    else list(values)
                )
                p, fit = cal.out_of_fold(x, self.y[q], self.folds, "platt")
                p_iso, fit_iso = cal.out_of_fold(x, self.y[q], self.folds, "isotonic")
                dec, thr = cal.out_of_fold_decisions(p, self.y[q], self.folds)
                self.raw[arm][q], self.p[arm][q], self.p_iso[arm][q] = values, p, p_iso
                self.decision[arm][q], self.thresholds[arm][q] = dec, thr
                self.fits[arm][q] = {"platt": fit, "isotonic": fit_iso}
        self.established = {q: sum(self.y[q]) >= MIN_POSITIVES for q in BINARY}
        self.frontier_api_ms = [
            float(preds["frontier"][i]["usage"]["duration_api_ms"]) for i in self.ids
        ]
        self.latency["no-filter"] = [0.0] * len(self.ids)
        self.cost["no-filter"] = [0.0] * len(self.ids)

    # ---- metrics on one (re)sample of item indices ------------------------

    def gate(self, arm: str, idx: list[int]) -> dict[str, float | None]:
        def dec(q: str, n: int) -> int:
            if arm == "no-filter":
                return 1
            if q not in self.decision[arm] or not self.established[q]:
                return 0
            return self.decision[arm][q][n]

        retained = [n for n in idx if dec(EVIDENCE, n) or dec(CONTRADICTION, n)]
        useful = [n for n in idx if self.y[EVIDENCE][n]]
        contra = [n for n in idx if self.y[CONTRADICTION][n]]
        inj = [n for n in idx if self.y[INJECTION][n]]
        kept = set(retained)
        answers_injection = (
            arm != "no-filter"
            and INJECTION in self.decision[arm]
            and self.established[INJECTION]
        )
        costs = [self.cost[arm][n] for n in idx]
        lat = [self.latency[arm][n] for n in idx]
        total_tokens = sum(self.tokens[n] for n in idx)
        return {
            "useful_evidence_recall": _ratio(
                sum(1 for n in useful if n in kept), len(useful)
            ),
            "retained_precision": _ratio(
                sum(
                    1
                    for n in retained
                    if self.y[EVIDENCE][n] or self.y[CONTRADICTION][n]
                ),
                len(retained),
            ),
            "contradiction_preservation": _ratio(
                sum(1 for n in contra if n in kept), len(contra)
            ),
            "injection_flag_recall": _ratio(
                sum(1 for n in inj if self.decision[arm][INJECTION][n]), len(inj)
            )
            if answers_injection
            else None,
            "retention_rate": _ratio(len(retained), len(idx)),
            "frontier_input_token_reduction": 1
            - _ratio(sum(self.tokens[n] for n in retained), total_tokens)
            if total_tokens
            else None,
            "latency_p50_ms": percentile(lat, 0.5),
            "latency_p95_ms": percentile(lat, 0.95),
            "frontier_api_latency_p50_ms": percentile(
                [self.frontier_api_ms[n] for n in idx], 0.5
            )
            if arm == "frontier"
            else None,
            "cost_usd_per_1000_candidates": None
            if any(c is None for c in costs) or not costs
            else 1000 * sum(costs) / len(costs),
        }

    def question(self, arm: str, q: str, idx: list[int]) -> dict[str, float | None]:
        y = [self.y[q][n] for n in idx]
        p = [self.p[arm][q][n] for n in idx]
        p_iso = [self.p_iso[arm][q][n] for n in idx]
        raw = [self.raw[arm][q][n] for n in idx]
        dec = [self.decision[arm][q][n] for n in idx]
        pos = sum(y)
        out = {
            "auc": cal.auc(raw, y),
            "brier_calibrated": cal.brier(p, y),
            "ece_calibrated": cal.ece(p, y),
            "brier_isotonic": cal.brier(p_iso, y),
            "ece_isotonic": cal.ece(p_iso, y),
            "recall_at_threshold": _ratio(
                sum(1 for a, b in zip(dec, y) if a and b), pos
            ),
            "precision_at_threshold": _ratio(
                sum(1 for a, b in zip(dec, y) if a and b), sum(dec)
            ),
        }
        if arm in PROBABILITY_ARMS:
            out["brier_raw"] = cal.brier(raw, y)
            out["ece_raw"] = cal.ece(raw, y)
        return out

    def authority_metrics(self, arm: str, idx: list[int]) -> dict[str, float | None]:
        rows = [
            (self.authority_probs[arm][n], self.authority[n])
            for n in idx
            if self.authority_probs[arm][n] and self.authority[n] is not None
        ]
        if not rows:
            return {"multiclass_brier": None, "expected_level_mae": None}
        brier = sum(
            sum(
                (probs.get(lv, 0.0) - (1.0 if int(lv) == label else 0.0)) ** 2
                for lv in LEVELS
            )
            for probs, label in rows
        ) / len(rows)
        mae = sum(
            abs(sum(int(lv) * probs.get(lv, 0.0) for lv in LEVELS) - label)
            for probs, label in rows
        ) / len(rows)
        return {"multiclass_brier": brier, "expected_level_mae": mae}

    def all_metrics(self, idx: list[int]) -> dict[str, float | None]:
        flat: dict[str, float | None] = {}
        for arm in ARMS:
            for name, value in self.gate(arm, idx).items():
                flat[f"{arm}|gate|{name}"] = value
        for arm in MODEL_ARMS:
            for q in self.p[arm]:
                for name, value in self.question(arm, q, idx).items():
                    flat[f"{arm}|{q}|{name}"] = value
            if arm in self.authority_probs:
                for name, value in self.authority_metrics(arm, idx).items():
                    flat[f"{arm}|{ORDINAL}|{name}"] = value
        return flat


def compare(ev: Evaluation, n_resamples: int = stats.N_RESAMPLES) -> dict[str, Any]:
    everything = list(range(len(ev.ids)))
    point = ev.all_metrics(everything)
    resamples = stats.resample_indices(len(ev.clusters), n_resamples)
    draws: list[dict[str, float | None]] = []
    for r in resamples:
        idx = [n for k in r for n in ev.clusters[k]]
        draws.append(ev.all_metrics(idx))
    metrics = {
        key: stats.interval(point[key], [dr[key] for dr in draws], len(ev.clusters))
        for key in point
    }
    deltas: dict[str, Any] = {}
    for key in point:
        arm, scope, name = key.split("|")
        for ref in REFERENCE_ARMS:
            ref_key = f"{ref}|{scope}|{name}"
            if ref == arm or ref_key not in point:
                continue

            def diff(m: dict[str, float | None]) -> float | None:
                a, b = m[key], m[ref_key]
                return None if a is None or b is None else a - b

            deltas[f"{arm}-minus-{ref}|{scope}|{name}"] = stats.interval(
                diff(point), [diff(dr) for dr in draws], len(ev.clusters)
            )
    return {"metrics": metrics, "paired_deltas": deltas}


def guard_alterations(items: list[dict[str, Any]]) -> dict[str, int]:
    """How many arm/labeler payloads the send guard would change. Every
    model saw the frozen text only if all counts are 0 (v1 failed this for
    passage_source, which is why v2 exists)."""
    from xtrm_research import guards
    from xtrm_research.evidence_gate import frontier as fr
    from xtrm_research.evidence_gate import labels as lab

    rule = guards.LabelExclusionRule()

    def altered(payload: dict[str, Any]) -> int:
        try:
            return int(guards._run_guards(payload, frozenset(), rule, None) != payload)
        except guards.GuardFailure:
            return 1

    groups: dict[str, list[dict[str, Any]]] = {}
    for item in items:
        groups.setdefault(item["group_id"], []).append(item)
    return {
        "labeler": sum(
            altered(lab.label_payload(m, g))
            for g in groups.values()
            for m in lab.LABELERS
        ),
        "frontier": sum(altered(fr.frontier_payload(i)) for i in items),
        "jev": sum(altered(fr.jev_payload(i)) for i in items),
        "llm": sum(altered(fr.llm_payload(i)) for i in items),
    }


def count_tokens(items: list[dict[str, Any]]) -> tuple[dict[str, int], str]:
    """Passage token counts with the Qwen3 tokenizer from the local cache —
    one fixed tokenizer for every arm, so the reduction ratio is comparable."""
    from transformers import AutoTokenizer

    from xtrm_research.evidence_gate.local import QWEN_MODEL, snapshot_revision

    tok = AutoTokenizer.from_pretrained(QWEN_MODEL, local_files_only=True)
    return (
        {i["item_id"]: len(tok(i["state"]["passage"])["input_ids"]) for i in items},
        f"{QWEN_MODEL}@{snapshot_revision(QWEN_MODEL)}",
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", type=Path, required=True)
    parser.add_argument("--labels", type=Path, required=True)
    parser.add_argument("--runs", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--resamples", type=int, default=stats.N_RESAMPLES)
    args = parser.parse_args()
    dataset_dir, labels_dir, runs = (
        p.expanduser() for p in (args.dataset, args.labels, args.runs)
    )
    items = d.load_items(dataset_dir)
    labels = {r["item_id"]: r for r in _jsonl(labels_dir / "labels.jsonl")}
    label_manifest = json.loads(
        (labels_dir / "labels_manifest.json").read_text(encoding="utf-8")
    )
    preds = {arm: latest_answers(runs / f"{arm}.jsonl") for arm in MODEL_ARMS}
    tokens, tokenizer = count_tokens(items)
    alterations = guard_alterations(items)
    if any(alterations.values()):
        # every model must have seen exactly the frozen text (XTRM-506)
        raise SystemExit(f"guard would alter payloads: {alterations}")
    ev = Evaluation(items, labels, preds, tokens)
    result = compare(ev, args.resamples)
    manifest = json.loads((dataset_dir / "manifest.json").read_text(encoding="utf-8"))
    result.update(
        dataset_items_sha256=manifest["items_sha256"],
        label_version=label_manifest["label_version"],
        labels_sha256=label_manifest["labels_sha256"],
        prices_version=ev.prices["version"],
        guard_alterations=alterations,
        latency_basis=LATENCY_BASIS,
        tokenizer=tokenizer,
        n_eval=len(ev.ids),
        n_clusters=len(ev.clusters),
        exclusions=ev.exclusions,
        min_positives=MIN_POSITIVES,
        established_questions=ev.established,
        policy_paths={
            "retain_evidence": "enabled"
            if ev.established["contains_usable_evidence"]
            else "disabled",
            "retain_contradiction": "enabled"
            if ev.established["contradicts_query_assumption"]
            else f"disabled: {sum(ev.y['contradicts_query_assumption'])} positive(s) < {MIN_POSITIVES}",
        },
        class_balance_eval={
            q: {"positive": sum(ev.y[q]), "n": len(ev.ids)} for q in BINARY
        },
        thresholds={arm: ev.thresholds[arm] for arm in MODEL_ARMS},
        calibration_fits={arm: ev.fits[arm] for arm in MODEL_ARMS},
        arm_meta={
            arm: json.loads((runs / f"{arm}.meta.json").read_text(encoding="utf-8"))
            for arm in MODEL_ARMS
        },
        frontier_auxiliary_cost_usd=sum(
            (preds["frontier"][i]["usage"].get("auxiliary_cost_usd") or 0)
            for i in ev.ids
        ),
        not_established={
            "end_to_end_quality": "the frontier agent's final answer quality with vs without the gate was not measured in v1",
            "local_arm_cost": "CPU inference on the operator machine is not metered; no provenanced price exists",
        },
    )
    out = args.out.expanduser()
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(
        json.dumps(result, indent=1, sort_keys=True) + "\n", encoding="utf-8"
    )
    print(
        json.dumps(
            {
                "n_eval": result["n_eval"],
                "exclusions": result["exclusions"],
                "out": str(out),
            }
        )
    )


if __name__ == "__main__":
    main()
