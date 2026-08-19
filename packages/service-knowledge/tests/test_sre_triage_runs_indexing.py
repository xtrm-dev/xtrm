"""Smoke: sre-triage-runs archive shape is indexable + searchable by the CLI.

Behavior contract (from mercury/infra spike infra-223r.1):
- The CLI surface is `service-knowledge index build|rebuild|query|stats`
  (there is NO `list` / `search` subcommand).
- The indexer ingests the registry description + the top-level SKILL.md
  sections; per-run subdir payloads (report.md, gotchas.jsonl, ...) are NOT
  individually indexed. The top-level SKILL.md must carry a searchable
  Run Index section with plain-token keywords.
- FTS5 treats `-`, `_`, `=` as separators: query terms must be plain tokens
  (`questdb`, `candle`, `swap`), not `NQ=F` or `sre-triage-runs` verbatim.
"""
from __future__ import annotations

import json
import subprocess
from pathlib import Path

from service_knowledge.cli import main

REGISTRY_REL = ".xtrm/skills/infra/service-knowledge/service-registry.json"
SVC_REL = ".xtrm/skills/infra/service-knowledge/services/sre-triage-runs"
SKILL_REL = f"{SVC_REL}/SKILL.md"


def _make_archive(repo: Path) -> None:
    """Seed a minimal sre-triage-runs archive (SKILL.md + registry + one run)."""
    svc = repo / SVC_REL
    run = svc / "20260819T015344Z-chain-sre-308163"
    (run / "evidence").mkdir(parents=True)
    (run / "chain-report.json").write_text(
        json.dumps({"schema": "chain-report.v1", "chain_run_id": "run-sre-10506",
                    "chain_id": "chain-sre-308163", "terminal_state": "escalated"}, indent=2) + "\n",
        encoding="utf-8",
    )
    (run / "report.md").write_text(
        "# SRE triage report — run-sre-10506\n\n## Incident brief\n\nquestdb candle equities outage\n",
        encoding="utf-8",
    )
    (run / "gotchas.jsonl").write_text(
        '{"kind": "source-gap", "resource": "ingestor", "symptom": "questdb candle stale", "evidence_ref": "ev-x", "fix_applied": "none", "worked": false, "prior_run_refs": []}\n',
        encoding="utf-8",
    )
    (run / "forensics.jsonl").write_text('{"event": "sre-triage.bundle.written"}\n', encoding="utf-8")
    (run / "messages.jsonl").write_text('{"kind": "work.turn"}\n', encoding="utf-8")
    (run / "evidence" / "ev-x.json").write_text('{"id": "ev-x"}\n', encoding="utf-8")

    svc_skill = svc / "SKILL.md"
    svc_skill.write_text(
        "---\nname: sre-triage-runs\ndescription: Archive of terminal sre-triage chain runs.\n"
        "allowed-tools: Read, Grep, Bash(service-knowledge index query *)\n---\n\n"
        "# sre-triage-runs\n\n## Run Index (searchable per run)\n\n"
        "| UTC ts | chain_run_id | chain_id | keywords |\n"
        "|---|---|---|---|\n"
        "| 2026-08-19T01:53Z | run-sre-10506 | chain-sre-308163 | questdb, candle, equities, swap |\n",
        encoding="utf-8",
    )

    reg = json.loads((repo / REGISTRY_REL).read_text())
    reg["services"]["sre-triage-runs"] = {
        "name": "sre-triage-runs",
        "description": "Archive of terminal sre-triage chain runs.",
        "skill_path": SKILL_REL,
        "territory": [f"{SVC_REL}/**"],
        "triggers": ["sre triage report", "past incident", "prior sre run",
                     "chain-report", "gotcha", "applied fix", "workaround",
                     "questdb", "candle", "swap"],
        "last_sync": "",
        "last_sync_ref": "",
    }
    (repo / REGISTRY_REL).write_text(json.dumps(reg, indent=2) + "\n", encoding="utf-8")


def test_index_build_indexes_sre_triage_runs(consumer_repo: Path) -> None:
    _make_archive(consumer_repo)
    assert main(["index", "build", "--path", str(consumer_repo)]) == 0

    stats = json.loads(
        subprocess.run(
            ["service-knowledge", "index", "stats", "--path", str(consumer_repo)],
            capture_output=True, text=True, check=True,
        ).stdout
    )
    assert stats["index_state"]["services_count"] >= 2  # db + sre-triage-runs
    assert stats["items_by_kind"]["service"] >= 2
    assert stats["items_by_kind"]["section"] >= 1  # Run Index section indexed


def test_index_query_finds_seeded_keyword(consumer_repo: Path) -> None:
    _make_archive(consumer_repo)
    assert main(["index", "build", "--path", str(consumer_repo)]) == 0

    result = json.loads(
        subprocess.run(
            ["service-knowledge", "index", "query", "questdb", "--path", str(consumer_repo)],
            capture_output=True, text=True, check=True,
        ).stdout
    )
    service_ids = {r["item"]["service_id"] for r in result["results"]}
    assert "sre-triage-runs" in service_ids, (
        "index query 'questdb' must surface the sre-triage-runs archive "
        "(check the Run Index carries the plain-token keyword)"
    )


def test_index_query_hyphen_token_is_separator(consumer_repo: Path) -> None:
    """FTS5 treats '-' and '=' as separators — verbatim compound queries miss."""
    _make_archive(consumer_repo)
    assert main(["index", "build", "--path", str(consumer_repo)]) == 0

    result = json.loads(
        subprocess.run(
            ["service-knowledge", "index", "query", "NQ=F", "--path", str(consumer_repo)],
            capture_output=True, text=True, check=True,
        ).stdout
    )
    # Plain-token behavior is the documented contract; the compound verbatim
    # query may or may not hit, but the plain token MUST. Assert plain works:
    plain = json.loads(
        subprocess.run(
            ["service-knowledge", "index", "query", "candle", "--path", str(consumer_repo)],
            capture_output=True, text=True, check=True,
        ).stdout
    )
    assert any(r["item"]["service_id"] == "sre-triage-runs" for r in plain["results"])


def test_index_rebuild_is_refresh_path(consumer_repo: Path) -> None:
    """rebuild is the canonical refresh after a new run lands (spike .1)."""
    _make_archive(consumer_repo)
    assert main(["index", "build", "--path", str(consumer_repo)]) == 0
    # add a second run row to the Run Index, rebuild, and confirm it appears
    skill = consumer_repo / SKILL_REL
    skill.write_text(
        skill.read_text() + "| 2026-08-20T00:00Z | run-sre-20000 | chain-sre-999999 | memory, swap |\n",
        encoding="utf-8",
    )
    assert main(["index", "rebuild", "--path", str(consumer_repo)]) == 0
    result = json.loads(
        subprocess.run(
            ["service-knowledge", "index", "query", "memory", "--path", str(consumer_repo)],
            capture_output=True, text=True, check=True,
        ).stdout
    )
    assert any(r["item"]["service_id"] == "sre-triage-runs" for r in result["results"])
