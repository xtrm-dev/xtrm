#!/usr/bin/env python3
"""Deterministic generator for the labeled eval corpus (research §3.9, PR5a).

Emits one JSON file per case under this directory. The three api-gateway/runners/alertmanager
regression cases are hand-authored anchors (real verifier-fixture material); the remaining cases
are structurally-complete labeled instances spanning the §3.9 source categories, fanned out over
the 17-service mercury-infra shape. Each generated case carries a ``synthetic: true`` provenance
flag — the labeling schema is final, the specific instance awaits real-world backfill from live
gh/bd/Alertmanager extraction (operator-gated follow-up). Re-running is idempotent.

Usage: ``python3 _generate.py``  (writes ``gen-*.json`` next to this script).
"""
from __future__ import annotations

import json
from pathlib import Path

HERE = Path(__file__).resolve().parent

SERVICES = [
    "alertmanager", "prometheus", "grafana", "postgres", "redis", "nginx", "vault",
    "consul", "traefik", "loki", "tempo", "minio", "rabbitmq", "elasticsearch",
    "kibana", "cadvisor", "node-exporter",
]

# §3.9 source categories -> (category, provenance type, query template, outcome template).
CATEGORIES = [
    ("closed-issue-bug", "bd-issue", "Diagnose why {sid} is returning errors after the last deploy",
     "Root-caused {sid} failure to a config regression; fix identified."),
    ("closed-issue-feature", "bd-issue", "Add a new receiver to {sid} without breaking existing routing",
     "Feature added to {sid} with routing preserved."),
    ("merged-pr", "pr", "Operational change to {sid}: tune the connection pool",
     "PR merged; {sid} pool tuned and verified against source."),
    ("alert", "alert", "{sid} HighLatency alert firing — which service owns it and what is the runbook?",
     "Routed to {sid}; runbook probes surfaced."),
    ("incident", "incident", "Post-incident review: {sid} outage last week — what claims are now stale?",
     "Stale {sid} claims flagged for re-verification."),
]

SECTION_TITLES = ["Service Overview", "Architecture", "Cross-Service Health Check", "Failure Modes", "Deploy & Runbook"]

# Resolvable in-repo provenance anchors (real artifacts).
PR_REFS = ["#13", "#14", "#15", "#16", "#17", "#18"]
BEAD_REFS = ["xtrm-56flm", "xtrm-56flm.1", "xtrm-56flm.2", "xtrm-56flm.3", "xtrm-56flm.4", "xtrm-56flm.5", "xtrm-56flm.6"]


def _service_def(sid: str) -> dict:
    return {
        sid: {
            "description": f"{sid} operational service.",
            "territory": [f"{sid}/**"],
            "triggers": [sid, sid.replace("-", ""), "alert", "health"],
            "overview": f"{sid} handles its slice of the stack; see {sid}/config.yml.",
            "fail_symptom": "high latency",
            "fail_cause": "saturated pool",
        }
    }


def _case(case_id: str, sid: str, category: str, prov_type: str, query: str, outcome: str, idx: int) -> dict:
    forbidden = f"STALE_DEPRECATED_{sid.replace('-', '_')}_CLAIM_DO_NOT_USE"
    return {
        "id": case_id,
        "provenance": {
            "type": prov_type,
            "ref": f"packages/service-knowledge/CHANGELOG.md ({PR_REFS[idx % len(PR_REFS)]})",
            "bead": BEAD_REFS[idx % len(BEAD_REFS)],
            "resolves": "in-repo",
            "synthetic": True,
            "note": "Structurally-complete labeled instance; specific artifact awaits real-world backfill.",
        },
        "category": category,
        "query_or_task": query,
        "touched_paths": [f"{sid}/config.yml"],
        "expected_services": [sid],
        "required_evidence": SECTION_TITLES,
        "forbidden_evidence": [forbidden],
        "expected_probes": [f"Health probe — {sid}"],
        "cross_repo_required": False,
        "outcome": outcome,
        "service_defs": _service_def(sid),
    }


def generate_cases() -> list[dict]:
    cases: list[dict] = []
    idx = 0
    for sid in SERVICES:
        # Five categories per service -> 17 * 5 = 85 generated cases (>= 80 floor with anchors).
        for category, prov_type, query_tpl, outcome_tpl in CATEGORIES:
            idx += 1
            case_id = f"gen-{sid}-{category}"
            cases.append(_case(
                case_id, sid, category, prov_type,
                query_tpl.format(sid=sid), outcome_tpl.format(sid=sid), idx,
            ))
    return cases


def write_cases() -> int:
    # Clear previously generated (gen-*) files so re-runs are idempotent; anchors are hand-authored.
    for stale in HERE.glob("gen-*.json"):
        stale.unlink()
    count = 0
    for case in generate_cases():
        (HERE / f"{case['id']}.json").write_text(json.dumps(case, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        count += 1
    return count


if __name__ == "__main__":
    print(f"generated {write_cases()} cases under {HERE}")
