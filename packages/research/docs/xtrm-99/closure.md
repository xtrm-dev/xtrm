# Jira XTRM-99 research completion criteria: closure table (XTRM-492)

Every criterion reads MET, REJECTED or NOT MET. The evidence paths are
relative to `packages/research/`. The runs live under
`~/.xtrm/research/runs/` and are visible in the research app.

| # | Criterion | Verdict | Evidence | Closing issue |
|---|---|---|---|---|
| C1 | System One contract mapped against XTRM runtime and extension boundaries | MET | `docs/xtrm-99/contract-map.md` §1–2, §6 | XTRM-501 |
| C2 | Canonical package and owner (OQ1, OQ2); research owner distinct from a future runtime owner | MET | `contract-map.md` §3–4. Research owner: `packages/research`. Runtime owner: a future dedicated package, not created because no production caller exists. | XTRM-501 |
| C3 | Evidence Gate dataset from real XTRM workloads, frozen and versioned | MET | Dataset v2, items `sha256:821eca67…`: provenance, selection, filters and write-once manifest. Labels `sha256:83182b7f…`, alpha 0.678 [0.572, 0.771], class balance recorded (`evidence-gate-results.md` §1). | XTRM-493, XTRM-494 |
| C4 | Local/open adapter against the frontier structured-classifier baseline | MET | Six arms on the same frozen set with cluster-bootstrap CIs and paired deltas (`evidence-gate-results.md` §2). Runs `evidence-gate-v2-{embedding,qwen,jev,frontier,llm}`. | XTRM-495–499, XTRM-510 |
| C5 | Calibration methodology and per-question thresholds | MET | `docs/xtrm-99/calibration.md`: out-of-fold Platt and isotonic, recall-targeted thresholds, rare paths disabled below 10 positives. Fold thresholds are in `compare.json`. | XTRM-498 |
| C6 | Jev verdict on quality, latency and cost | MET | `docs/xtrm-99/jev-verdict.md`. Research backend: YES. Production provider backend: NO, now. Quality, latency and cost are separate, each with a CI. Includes the System One cascade (runs `evidence-gate-v2-{battery-rule,battery-learned,cascade}`). | XTRM-500, XTRM-511 |
| C7 | Request telemetry and outcomes attached to observability and forensics | MET | `docs/xtrm-99/telemetry.md`. Answer, decision, escalation and outcome are separate linked records from the workflow runner (runs `evidence-gate-v2-cascade`, `code-locator-v1-jev-beam`). | XTRM-502, XTRM-509 |
| C8 | Contract fit with one service-knowledge and one sre-ops workload | MET | `docs/xtrm-99/contract-fit.md`: both fit (sre-ops in split form); misfits recorded. | XTRM-503 |
| C9 | Deterministic authority boundaries unchanged | MET | `docs/xtrm-99/authority-audit.md`: all three areas confirmed unchanged. | XTRM-504 |
| C10 | Implementation children only where a benchmark shows measurable value | MET (decision: none opened) | `docs/xtrm-99/value-decision.md`. The cascade loses recall (−0.027 [−0.053, −0.007]). The multi-step code-locator loses to a free prior (hit@1 −0.304 [−0.420, −0.188], `code-locator.md`). Follow-up research epic XTRM-513. | XTRM-505, XTRM-512 |
| C11 | Mercury follow-up recorded separately, if useful | REJECTED | `value-decision.md`: no value shown that transfers to Mercury. Reopen on a positive pre-registered XTRM-514 or XTRM-518. | XTRM-505 |

**Does Jira XTRM-99 close?** YES. Every criterion is MET or REJECTED with
recorded evidence.

**Declared inside the criteria, not hidden:**

- The following are **not established**:
  - contradiction preservation and injection rejection (0 and 2
    positives);
  - end-to-end answer quality;
  - the cost of the local arms.
- The reference labels are LLM-adjudicated.
- The broader System One control-loop paradigm is untested on agent,
  review, context and SRE loops; that is the research epic XTRM-513.

**Harness proven in this closure:**

- the budget policy at the transport seam (XTRM-508);
- the workflow runner and app-visible publisher (XTRM-509).

Every check is mutation-proven.

**Total model spend for the new work: USD 0.0276.** This is Jev only: 265
battery requests (USD 0.0098) plus 332 beam requests (USD 0.0178). It
includes no Claude call and no commandcode call. The earlier arms and
labels are accounted in their runs.
