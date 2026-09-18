# Jev verdict (XTRM-500, criterion 6)

Question: does TypeSafe Jev justify a provider backend on quality, latency
and cost?

Quality, latency and cost are stated separately below. Each value comes
from a published run or result file with its interval, or it reads **not
established**. The model is `jev-1.13.0`, resolved from `jev-latest`, and
every recorded answer keeps its TypeSafe `request_id`.

## Verdict

| Scope | Verdict |
|---|---|
| Research backend | **YES.** Keep it. |
| Production provider backend | **NO, now.** |

**Why YES for research.** It is the cheapest and fastest model arm that
answers every System One question type, with provider request ids. Every
study in this document cost under USD 0.02 in Jev spend.

**Why NO for production now.**
- As a holistic classifier it is measurably below both LLMs.
- Decomposition did not close that gap.
- In the one multi-step control loop tested, a free deterministic prior
  beat it.
- The only positive result is a pre-registered cascade that saves 39% of
  LLM calls and matches DeepSeek precision, but it loses 2.7 points of
  recall, and the gate's first priority is recall.

**What would change the production verdict.** A pre-registered result, on
new data, in which a System One workflow meets the LLM path's recall and
precision and removes a material share of LLM calls or of human review.
The follow-up epic (see `value-decision.md`) names the candidate
workloads.

## Quality

| Evidence | Result (95% CI) | Run / file |
|---|---|---|
| Evidence Gate, holistic (6 questions per request) | usable-evidence AUC 0.844 [0.786, 0.896]; minus DeepSeek −0.099 [−0.142, −0.058]; minus Claude −0.106 [−0.154, −0.060]. For reference: Qwen3-Reranker 0.827 [0.767, 0.885] and embedding 0.688 [0.598, 0.779]. No paired delta between Jev and the local arms was computed. | `evidence-gate-v2-jev` |
| Evidence Gate, 12-question atomic battery | AUC 0.855–0.865; minus holistic Jev +0.012 [−0.046, 0.070] (learned) and +0.021 [−0.035, 0.073] (rule): no measurable gain | `evidence-gate-v2-battery-{rule,learned}` |
| Evidence Gate, System One cascade (pre-registered) | minus DeepSeek-all: precision +0.007 [−0.005, 0.023], recall −0.027 [−0.053, −0.007], LLM calls −38.7% | `evidence-gate-v2-cascade` |
| Source authority (4-level Score) | multiclass Brier: Jev 0.284 vs Claude 0.490, delta −0.206 [−0.288, −0.136]. Jev is better calibrated on this Score. | `compare.json`, `evidence-gate-v2-jev` |
| Code-locator beam (multi-step, 69 tasks) | hit@1 0.188 [0.101, 0.275]; minus lexical +0.101 [0.014, 0.203]; minus hot-files prior −0.304 [−0.420, −0.188] | `code-locator-v1-jev-beam` |
| Board duplicates (earlier study, imported) | AUC noul 0.769, choice 0.806 against a 0.519 baseline on 205 pairs. No interval was recorded in that import. | `dupes-market-data` |
| Contract fit (service-knowledge routing) | 10 of 10 schema-valid answers; disagrees with the deterministic router on 9 of 10. No labels, so accuracy is **not established**. | `contract-fit.md` |

## Latency

All values are wall clock around `guarded_send`: guard stage plus the
HTTPS round trip to TypeSafe, measured on a shared host.

| Request shape | p50 (95% CI) | Source |
|---|---|---|
| 6 holistic questions, 1 candidate | 734 ms [713, 758]; p95 in `compare.json` | `evidence-gate-v2-jev` |
| 12 atomic nouls, 1 candidate | 636 ms [629, 646] | `evidence-gate-v2-battery-learned` |
| Beam step, up to 3 Choices | 3196 ms [3060, 3334] per task over 4.8 requests (about 660 ms per request) | `code-locator-v1-jev-beam` |

For comparison: DeepSeek through pi takes 4313 ms p50 (includes pi CLI
start), and Claude through the CLI takes 8274 ms p50 (API 5298 ms).

Provider-side latency, excluding the guard and the network, is **not
established**: TypeSafe returns no timing.

## Cost

Price source: `evidence_gate/prices.json` version `2026-09-18.1`. The rates
are USD 0.042 per million input tokens and USD 0 per million output
tokens, from the TypeSafe launch post and corroborated by OpenRouter and
Vercel. Caveat: this is launch pricing, and TypeSafe states it cannot prove
the price is not subsidised.

TypeSafe returns token counts but no cost. Cost is therefore computed from
the price table, never reported by the provider.

| Workload | Cost (95% CI) |
|---|---|
| Evidence Gate, holistic | USD 0.047 [0.046, 0.049] per 1000 candidates |
| Evidence Gate, battery | USD 0.037 [0.036, 0.039] per 1000 candidates |
| Evidence Gate, cascade (Jev + replayed DeepSeek) | USD 0.429 [0.365, 0.491] per 1000 candidates |
| Code-locator | USD 0.000258 [0.000238, 0.000281] per task |

For comparison: DeepSeek costs USD 0.617 per 1000 candidates
(provider-reported), and Claude costs USD 8.79 per 1000 candidates
(list-price basis).

**Not established:**
- the long-run price;
- rate limits under load;
- the cost of the guard stage.
