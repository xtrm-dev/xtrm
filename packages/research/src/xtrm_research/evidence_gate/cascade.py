"""Evidence Gate as a System One cascade (XTRM-511).

The v2 comparison asked Jev six holistic questions per candidate and scored
it as a classifier against LLM labels. This module tests the System One
pattern instead:

    candidate state
      -> ONE Jev request carrying a battery of 12 atomic noul questions
      -> code composes the answers into an evidence probability
      -> reject below a floor, retain above a ceiling, and escalate only
         the uncertain band to an LLM (DeepSeek, the ``llm`` arm)
      -> reference label as the outcome

Two compositions, both out-of-fold on the same grouped folds as
``compare.py``:

* ``battery-rule`` — a fixed soft-logic rule written before any result was
  seen (:data:`RULE`), then Platt-calibrated;
* ``battery-learned`` — L2-regularised logistic regression on the logits of
  all 12 answers.

``cascade`` uses the learned composition with the pre-registered band
(:data:`PRE_REGISTERED`); :data:`SWEEP` reports the band's sensitivity.
The escalated band is resolved by REPLAYING the recorded DeepSeek answer
and its out-of-fold decision, so no new DeepSeek call is made; its
recorded cost and latency are charged to the cascade.

    python -m xtrm_research.evidence_gate.cascade collect  --dataset D --cache C
    python -m xtrm_research.evidence_gate.cascade evaluate --dataset D --labels L --runs R --cache C --out O
    python -m xtrm_research.evidence_gate.cascade publish  --dataset D --labels L --runs R --cache C --result O
"""

from __future__ import annotations

import argparse
import json
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

from xtrm_research.evidence_gate import calibration as cal
from xtrm_research.evidence_gate import stats
from xtrm_research.evidence_gate.compare import (
    EVIDENCE,
    MODEL_ARMS,
    Evaluation,
    _ratio,
    count_tokens,
    latest_answers,
    percentile,
)
from xtrm_research.evidence_gate.dataset import load_items
from xtrm_research.hashing import compute_content_hash
from xtrm_research.workflow import ResponseCache, Workflow, jev_cost

#: The atomic battery. Each question asks ONE observable property of the
#: candidate; none asks the target construct ("usable evidence") itself.
#: ``+`` facets raise the evidence probability, ``-`` facets lower it.
BATTERY_TEXT: dict[str, tuple[str, str]] = {
    "same_subject": (
        "+",
        "The passage is about the same system, tool, project or topic that the query asks about.",
    ),
    "names_query_entity": (
        "+",
        "The passage mentions at least one specific name that also appears in the query: an identifier, file, command, package, service, error string or version.",
    ),
    "has_concrete_value": (
        "+",
        "The passage states at least one concrete value: a number, version, path, setting, date, identifier or exact name.",
    ),
    "has_code_or_command": (
        "+",
        "The passage contains code, a shell command, a configuration snippet or an exact error message.",
    ),
    "states_fact_or_decision": (
        "+",
        "The passage states a definite fact, decision or conclusion as true, not a question, a plan or a guess.",
    ),
    "answers_part_of_query": (
        "+",
        "Some sentence of the passage directly answers, or supplies a missing piece of, what the query asks.",
    ),
    "could_verify_a_claim": (
        "+",
        "The passage could be cited to confirm or refute a specific claim that the query implies.",
    ),
    "is_navigation_or_chrome": (
        "-",
        "The passage is mostly navigation, a table of contents, an index, a list of links, a license, a cookie or login notice, or other page chrome.",
    ),
    "is_headings_only": (
        "-",
        "The passage is only headings, titles or a list of names, without statements about them.",
    ),
    "is_cut_off": (
        "-",
        "The passage is truncated so that the content it introduces is missing.",
    ),
    "is_speculative": (
        "-",
        "The passage speculates, asks questions or proposes options instead of stating what is the case.",
    ),
    "is_generic": (
        "-",
        "The passage gives only general advice that would apply to many systems, not to the specific one in the query.",
    ),
}
BATTERY: dict[str, dict[str, Any]] = {
    name: {"type": "noul", "instructions": text}
    for name, (_, text) in BATTERY_TEXT.items()
}
FEATURES = tuple(BATTERY)

#: The fixed composition, written before any battery answer was seen:
#: on-subject AND (answers OR verifies) AND (value OR code OR fact) AND NOT
#: chrome/headings, as a product of soft truth values.
RULE = (
    "same_subject * max(answers_part_of_query, could_verify_a_claim)"
    " * max(has_concrete_value, has_code_or_command, states_fact_or_decision)"
    " * (1 - max(is_navigation_or_chrome, is_headings_only))"
)

#: Band of the reported cascade, fixed before the evaluation ran: reject
#: below the training-fold threshold that keeps 0.98 recall; retain at or
#: above the lowest threshold whose training-fold precision is 0.95.
PRE_REGISTERED = {
    "lo_recall": 0.98,
    "hi_precision": 0.95,
    "ridge": 1.0,
    "min_retained": 5,
}
SWEEP = tuple((lo, hi) for lo in (0.95, 0.98, 0.99) for hi in (0.90, 0.95, 0.98))
FEATURE_CLIP = 0.01  # logits of answers clipped to [logit(0.01), logit(0.99)]


def rule_score(a: dict[str, float]) -> float:
    return (
        a["same_subject"]
        * max(a["answers_part_of_query"], a["could_verify_a_claim"])
        * max(
            a["has_concrete_value"],
            a["has_code_or_command"],
            a["states_fact_or_decision"],
        )
        * (1 - max(a["is_navigation_or_chrome"], a["is_headings_only"]))
    )


def features(a: dict[str, float]) -> list[float]:
    return [cal.logit(min(max(a[f], FEATURE_CLIP), 1 - FEATURE_CLIP)) for f in FEATURES]


def _solve(m: list[list[float]], v: list[float]) -> list[float]:
    """Gaussian elimination with partial pivoting (small dense systems)."""
    n = len(v)
    a = [row[:] + [v[i]] for i, row in enumerate(m)]
    for c in range(n):
        p = max(range(c, n), key=lambda r: abs(a[r][c]))
        a[c], a[p] = a[p], a[c]
        if abs(a[c][c]) < 1e-12:
            raise ValueError("singular system")
        for r in range(c + 1, n):
            f = a[r][c] / a[c][c]
            for k in range(c, n + 1):
                a[r][k] -= f * a[c][k]
    x = [0.0] * n
    for r in range(n - 1, -1, -1):
        x[r] = (a[r][n] - sum(a[r][k] * x[k] for k in range(r + 1, n))) / a[r][r]
    return x


def fit_logistic(
    xs: list[list[float]], ys: list[int], ridge: float = 1.0, iters: int = 50
) -> list[float] | None:
    """Newton-Raphson logistic regression with an L2 ridge on the weights
    (not the intercept). Returns [intercept, *weights]; None for one class."""
    if len(set(ys)) < 2:
        return None
    d = len(xs[0]) + 1
    w = [cal.logit(sum(ys) / len(ys))] + [0.0] * (d - 1)
    for _ in range(iters):
        g = [ridge * w[j] if j else 0.0 for j in range(d)]
        h = [[(ridge if i == j and i else 0.0) for j in range(d)] for i in range(d)]
        for x, y in zip(xs, ys):
            z = [1.0, *x]
            p = cal.sigmoid(sum(wj * zj for wj, zj in zip(w, z)))
            q = p * (1 - p)
            for i in range(d):
                g[i] += (p - y) * z[i]
                for j in range(i, d):
                    h[i][j] += q * z[i] * z[j]
        for i in range(d):
            for j in range(i):
                h[i][j] = h[j][i]
        step = _solve(h, g)
        w = [wj - sj for wj, sj in zip(w, step)]
        if max(abs(s) for s in step) < 1e-8:
            break
    return w


def predict_logistic(w: list[float], x: list[float]) -> float:
    return cal.sigmoid(w[0] + sum(wj * xj for wj, xj in zip(w[1:], x)))


def learned_out_of_fold(
    xs: list[list[float]], ys: list[int], folds: list[int], ridge: float
) -> tuple[list[float], list[Any]]:
    preds = [0.0] * len(xs)
    fits: list[Any] = []
    for fold in sorted(set(folds)):
        train = [i for i, f in enumerate(folds) if f != fold]
        w = fit_logistic([xs[i] for i in train], [ys[i] for i in train], ridge)
        base = sum(ys[i] for i in train) / len(train)
        for i, f in enumerate(folds):
            if f == fold:
                preds[i] = predict_logistic(w, xs[i]) if w else base
        fits.append(
            {
                "fold": fold,
                "weights": dict(zip(("intercept", *FEATURES), w)) if w else None,
            }
        )
    return preds, fits


def precision_threshold(
    ps: list[float], ys: list[int], target: float, min_retained: int
) -> float | None:
    """Lowest threshold t with precision(p >= t) >= target over at least
    ``min_retained`` items; None when no such t exists."""
    order = sorted(zip(ps, ys), reverse=True)
    best, tp = None, 0
    for k, (p, y) in enumerate(order, start=1):
        tp += y
        if k >= min_retained and tp / k >= target:
            best = p
    return best


def band_decisions(
    ps: list[float],
    ys: list[int],
    folds: list[int],
    escalated_decision: list[int],
    lo_recall: float,
    hi_precision: float,
    min_retained: int,
) -> tuple[list[int], list[int], list[dict[str, Any]]]:
    """Held-out cascade decisions. Per fold, on the training part only:
    ``lo`` keeps ``lo_recall`` of positives, ``hi`` is the lowest threshold
    with ``hi_precision``. Held-out items: below lo reject, at or above hi
    retain, otherwise escalate and take ``escalated_decision``."""
    decision, escalated = [0] * len(ps), [0] * len(ps)
    bands: list[dict[str, Any]] = []
    for fold in sorted(set(folds)):
        train = [i for i, f in enumerate(folds) if f != fold]
        tp, ty = [ps[i] for i in train], [ys[i] for i in train]
        lo = cal.recall_threshold(tp, ty, lo_recall)
        hi = precision_threshold(tp, ty, hi_precision, min_retained)
        lo = 0.0 if lo is None else lo
        hi = float("inf") if hi is None else max(hi, lo)
        bands.append({"fold": fold, "lo": lo, "hi": hi if hi != float("inf") else None})
        for i, f in enumerate(folds):
            if f != fold:
                continue
            if ps[i] < lo:
                decision[i] = 0
            elif ps[i] >= hi:
                decision[i] = 1
            else:
                escalated[i], decision[i] = 1, escalated_decision[i]
    return decision, escalated, bands


class CascadeEvaluation:
    """The v2 :class:`Evaluation` (same items, labels, folds, clusters and
    reference-arm decisions) extended with the battery arms."""

    def __init__(self, ev: Evaluation, battery: dict[str, dict[str, Any]]) -> None:
        self.ev = ev
        self.y = ev.y[EVIDENCE]
        rows = [battery[i] for i in ev.ids]
        answers = [{f: r["answers"][f]["noul"] for f in FEATURES} for r in rows]
        self.rule_raw = [rule_score(a) for a in answers]
        self.rule_p, self.rule_fit = cal.out_of_fold(
            [cal.logit(v) for v in self.rule_raw], self.y, ev.folds, "platt"
        )
        self.learned_p, self.learned_fit = learned_out_of_fold(
            [features(a) for a in answers], self.y, ev.folds, PRE_REGISTERED["ridge"]
        )
        self.battery_cost = [
            jev_cost(
                r["usage"]["input_tokens"], r["usage"]["output_tokens"], r["model"]
            )["value"]
            for r in rows
        ]
        self.battery_latency = [float(r["latency_ms"]) for r in rows]
        self.decision: dict[str, list[int]] = {}
        self.escalated: dict[str, list[int]] = {}
        self.bands: dict[str, list[dict[str, Any]]] = {}
        for name, p in (
            ("battery-rule", self.rule_p),
            ("battery-learned", self.learned_p),
        ):
            self.decision[name], _ = cal.out_of_fold_decisions(p, self.y, ev.folds)
            self.escalated[name] = [0] * len(p)
        llm_dec = ev.decision["llm"][EVIDENCE]
        for lo, hi in SWEEP:
            name = (
                "cascade"
                if (lo, hi)
                == (PRE_REGISTERED["lo_recall"], PRE_REGISTERED["hi_precision"])
                else f"cascade-lo{round(lo * 100)}-hi{round(hi * 100)}"
            )
            dec, esc, bands = band_decisions(
                self.learned_p,
                self.y,
                ev.folds,
                llm_dec,
                lo,
                hi,
                PRE_REGISTERED["min_retained"],
            )
            self.decision[name], self.escalated[name], self.bands[name] = (
                dec,
                esc,
                bands,
            )
        self.arms = list(self.decision)

    def cost(self, arm: str, n: int) -> float | None:
        base = self.battery_cost[n]
        if base is None:
            return None
        if not self.escalated[arm][n]:
            return base
        extra = self.ev.cost["llm"][n]
        return None if extra is None else base + extra

    def latency(self, arm: str, n: int) -> float:
        return self.battery_latency[n] + (
            self.ev.latency["llm"][n] if self.escalated[arm][n] else 0.0
        )

    def gate(self, arm: str, idx: list[int]) -> dict[str, float | None]:
        # escalation_rate here means "share of candidates sent to a generative
        # LLM": every item for DeepSeek and Claude, none for Jev or no-filter.
        if arm in ("no-filter", *MODEL_ARMS):
            out = self.ev.gate(arm, idx)
            return {k: out[k] for k in GATE_KEYS if k in out} | {
                "escalation_rate": 1.0 if arm in ("llm", "frontier") else 0.0
            }
        dec, y, tok = self.decision[arm], self.y, self.ev.tokens
        retained = [n for n in idx if dec[n]]
        useful = [n for n in idx if y[n]]
        total = sum(tok[n] for n in idx)
        costs = [self.cost(arm, n) for n in idx]
        return {
            "useful_evidence_recall": _ratio(
                sum(1 for n in useful if dec[n]), len(useful)
            ),
            "retained_precision": _ratio(
                sum(1 for n in retained if y[n]), len(retained)
            ),
            "retention_rate": _ratio(len(retained), len(idx)),
            "frontier_input_token_reduction": 1
            - _ratio(sum(tok[n] for n in retained), total)
            if total
            else None,
            "latency_p50_ms": percentile([self.latency(arm, n) for n in idx], 0.5),
            "latency_p95_ms": percentile([self.latency(arm, n) for n in idx], 0.95),
            "cost_usd_per_1000_candidates": None
            if any(c is None for c in costs) or not costs
            else 1000 * sum(costs) / len(costs),
            "escalation_rate": _ratio(
                sum(self.escalated[arm][n] for n in idx), len(idx)
            ),
        }

    def scores(self, idx: list[int]) -> dict[str, float | None]:
        y = [self.y[n] for n in idx]
        out: dict[str, float | None] = {}
        for name, raw, p in (
            ("battery-rule", self.rule_raw, self.rule_p),
            ("battery-learned", self.learned_p, self.learned_p),
        ):
            out[f"{name}|{EVIDENCE}|auc"] = cal.auc([raw[n] for n in idx], y)
            out[f"{name}|{EVIDENCE}|brier_calibrated"] = cal.brier(
                [p[n] for n in idx], y
            )
            out[f"{name}|{EVIDENCE}|ece_calibrated"] = cal.ece([p[n] for n in idx], y)
        for arm in ("jev", "llm", "frontier"):
            out[f"{arm}|{EVIDENCE}|auc"] = cal.auc(
                [self.ev.raw[arm][EVIDENCE][n] for n in idx], y
            )
            out[f"{arm}|{EVIDENCE}|brier_calibrated"] = cal.brier(
                [self.ev.p[arm][EVIDENCE][n] for n in idx], y
            )
        return out

    def all_metrics(self, idx: list[int]) -> dict[str, float | None]:
        flat = self.scores(idx)
        for arm in (*REFERENCES, *self.arms):
            for name, value in self.gate(arm, idx).items():
                flat[f"{arm}|gate|{name}"] = value
        return flat


GATE_KEYS = (
    "useful_evidence_recall",
    "retained_precision",
    "retention_rate",
    "frontier_input_token_reduction",
    "latency_p50_ms",
    "latency_p95_ms",
    "cost_usd_per_1000_candidates",
)
REFERENCES = ("no-filter", "jev", "llm", "frontier")


def evaluate(
    ce: CascadeEvaluation, n_resamples: int = stats.N_RESAMPLES
) -> dict[str, Any]:
    """Point values, cluster-bootstrap intervals and paired deltas (the
    same resamples as compare.py: same seed, same clusters)."""
    everything = list(range(len(ce.ev.ids)))
    point = ce.all_metrics(everything)
    draws = [
        ce.all_metrics([n for k in r for n in ce.ev.clusters[k]])
        for r in stats.resample_indices(len(ce.ev.clusters), n_resamples)
    ]
    n_clusters = len(ce.ev.clusters)
    metrics = {
        k: stats.interval(point[k], [d[k] for d in draws], n_clusters) for k in point
    }
    deltas: dict[str, Any] = {}
    for key in point:
        arm, scope, name = key.split("|")
        if arm in REFERENCES:
            continue
        for ref in REFERENCES:
            ref_key = f"{ref}|{scope}|{name}"
            if ref_key not in point:
                continue

            def diff(m: dict[str, float | None]) -> float | None:
                a, b = m[key], m[ref_key]
                return None if a is None or b is None else a - b

            deltas[f"{arm}-minus-{ref}|{scope}|{name}"] = stats.interval(
                diff(point), [diff(d) for d in draws], n_clusters
            )
    return {"metrics": metrics, "paired_deltas": deltas}


# --- the workflow ------------------------------------------------------------


class BatteryWorkflow(Workflow):
    """One candidate per episode, one step: the battery request, the
    cascade decision (from :class:`CascadeEvaluation`, keyed by item id),
    the replayed escalation, the reference label as outcome."""

    model = "jev-latest"

    def __init__(
        self,
        cache: ResponseCache,
        plan: dict[str, dict[str, Any]] | None = None,
        llm_rows: dict[str, dict[str, Any]] | None = None,
        labels: dict[str, dict[str, Any]] | None = None,
    ) -> None:
        super().__init__(cache)
        self.plan, self.llm_rows, self.labels = plan or {}, llm_rows or {}, labels or {}

    def questions(self, state: dict[str, Any]) -> dict[str, dict[str, Any]]:
        return BATTERY

    def state_view(self, state: dict[str, Any]) -> dict[str, Any]:
        return {k: state[k] for k in ("query", "passage_source", "passage")}

    def policy(self, state: dict[str, Any], answers: dict[str, Any]) -> dict[str, Any]:
        plan = self.plan.get(state["item_id"])
        if plan is None:
            return {"action": "collect_only", "escalate": None}
        return {
            "action": "retain_evidence" if plan["decision"] else "reject",
            "escalate": "uncertainty_band" if plan["escalated"] else None,
            "composition": "battery-learned (L2 logistic, out-of-fold)",
            "composed_probability": plan["p"],
            "band": plan["band"],
            "rule_score": plan["rule"],
        }

    def escalate(
        self, state: dict[str, Any], answers: dict[str, Any], decision: dict[str, Any]
    ) -> dict[str, Any]:
        row = self.llm_rows[state["item_id"]]
        u = row.get("usage") or {}
        return {
            "resolved_by": "replay of the recorded llm arm answer (no new call)",
            "model": row.get("model"),
            "stated_probability": row["raw"][EVIDENCE],
            "decision": decision["action"],
            "usage": {
                "source": "pi_message_usage",
                "gen_ai.usage.input_tokens": u.get("input_tokens"),
                "gen_ai.usage.output_tokens": u.get("output_tokens"),
                "gen_ai.request.model": row.get("model"),
                "latency_ms": row.get("latency_ms"),
                "cost": u.get("cost_usd"),
                "cost_currency": "USD",
            },
        }

    def outcome(
        self, episode_id: str, trace: list[dict[str, Any]]
    ) -> dict[str, Any] | None:
        label = self.labels.get(episode_id)
        if label is None or label.get(EVIDENCE) is None:
            return None
        return {
            "resolved": {EVIDENCE: label[EVIDENCE]},
            "resolver": "evidence-gate-v2-labels-isolated",
        }


def collect(
    items: list[dict[str, Any]], cache: ResponseCache, workers: int = 4
) -> dict[str, dict[str, Any]]:
    """Ask the battery for every item (cached replays cost nothing)."""
    wf = BatteryWorkflow(cache)
    lock = threading.Lock()
    out: dict[str, dict[str, Any]] = {}

    def one(item: dict[str, Any]) -> None:
        state = {"item_id": item["item_id"], **item["state"]}
        response = wf.ask(state, BATTERY)
        with lock:
            out[item["item_id"]] = response

    with ThreadPoolExecutor(workers) as pool:
        list(pool.map(one, items))
    return out


def battery_hash() -> str:
    return compute_content_hash(
        {"battery": BATTERY, "rule": RULE, "pre_registered": PRE_REGISTERED}
    )


def _load(args: argparse.Namespace) -> tuple[list, dict, dict, Evaluation]:
    items = load_items(args.dataset)
    labels = {
        r["item_id"]: r
        for r in map(
            json.loads,
            (args.labels / "labels.jsonl").read_text(encoding="utf-8").splitlines(),
        )
        if r
    }
    preds = {arm: latest_answers(args.runs / f"{arm}.jsonl") for arm in MODEL_ARMS}
    tokens, _ = count_tokens(items)
    return items, labels, preds, Evaluation(items, labels, preds, tokens)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("collect", "evaluate", "publish"))
    for flag in ("--dataset", "--cache"):
        parser.add_argument(flag, type=Path, required=True)
    for flag in ("--labels", "--runs", "--out", "--result", "--root", "--registry"):
        parser.add_argument(flag, type=Path)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--resamples", type=int, default=stats.N_RESAMPLES)
    args = parser.parse_args()
    cache = ResponseCache(args.cache)
    if args.command == "collect":
        items = load_items(args.dataset)
        before = len(cache._entries)
        answers = collect(items, cache, args.workers)
        print(
            json.dumps(
                {
                    "items": len(answers),
                    "new_requests": len(cache._entries) - before,
                    "battery_hash": battery_hash(),
                }
            )
        )
        return
    items, labels, preds, ev = _load(args)
    battery = collect(items, cache, args.workers)
    new = sum(1 for r in battery.values() if not r["cached"])
    if args.command == "evaluate":
        ce = CascadeEvaluation(ev, battery)
        result = evaluate(ce, args.resamples)
        result.update(
            battery_hash=battery_hash(),
            battery=BATTERY_TEXT,
            rule=RULE,
            pre_registered=PRE_REGISTERED,
            sweep=[list(s) for s in SWEEP],
            bands=ce.bands,
            rule_fit=ce.rule_fit,
            learned_fit=ce.learned_fit,
            n_eval=len(ev.ids),
            n_clusters=len(ev.clusters),
            exclusions=ev.exclusions,
            uncached_requests=new,
        )
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(
            json.dumps(result, indent=1, sort_keys=True) + "\n", encoding="utf-8"
        )
        print(
            json.dumps(
                {"n_eval": len(ev.ids), "uncached_requests": new, "out": str(args.out)}
            )
        )
        return
    from xtrm_research.evidence_gate import publish_cascade

    publish_cascade.publish_all(args, items, labels, preds, ev, battery, cache)


if __name__ == "__main__":
    main()
