# service-knowledge eval corpus (research §3.9)

Labeled cases the harness (`service_knowledge.eval.harness`) runs against the shipped index +
verifier to produce the twelve §3.9 metrics. One JSON file per case; files prefixed `_` are
metadata, not cases.

## Case schema (§3.9 label set + harness support)

| Field | Type | §3.9 | Description |
|---|---|---|---|
| `id` | string | | Unique case id (filename stem). |
| `provenance` | object | | `{type, ref, bead?, resolves, synthetic, note}` — permalink to the source artifact (bd id, PR number, alert id, incident path, verifier fixture). |
| `category` | string | | `regression` / `closed-issue-bug` / `closed-issue-feature` / `merged-pr` / `alert` / `incident` / `drift` / `diagnostic` / `wrong-command`. |
| `query_or_task` | string | ✓ | Initial prompt, bead, or alert. |
| `touched_paths` | string[] | ✓ | Files really involved. |
| `expected_services` | string[] | ✓ | Correct owning service(s). |
| `required_evidence` | string[] | ✓ | Indispensable claims / section titles. |
| `forbidden_evidence` | string[] | ✓ | Stale / misleading claims that must NOT surface. |
| `expected_probes` | string[] | ✓ | Pertinent probe titles (`Health probe — <service>`). |
| `cross_repo_required` | bool | ✓ | Whether federation is needed. |
| `outcome` | string | ✓ | Correct diagnosis or change. |
| `service_defs` | object | | Service definitions the harness builds into the throwaway consumer (`{service_id: {description, territory, triggers, overview, extra_sections?}}`). |
| `verifier` | object? | | Optional FP/FN block: `{service_id, expect_block, candidate, current, corpus_files, verified_at_ref}`. |

## Regression anchors

The three anchor cases are hand-authored from the real verifier fixtures and encode the observed
api-gateway/runners specialist failure classes (wrong claims, wrong commands, stale webhook claim).
Each carries a `verifier` block with `expect_block: true`; the shipped gate must block all three
(true positives, zero false negatives).

## Regenerating

`python3 _generate.py` re-emits the `gen-*.json` cases deterministically (idempotent; anchors are
hand-authored and untouched). Generated cases carry `provenance.synthetic: true` — the labeling
schema is final, the specific instance awaits real-world backfill from live gh/bd/Alertmanager
extraction (operator-gated follow-up).

## Telemetry retention

Eval-harness telemetry (`component=eval-harness`) lands in the report dir `events.jsonl`; weekly
reports land in `.beads/eval-reports/`. Retention **inherits the `.beads/` / `.xtrm/state/`
default** — no separate 90-day policy is introduced in PR5a.
