"""Fixtures for eval tests that need a live index (vaultctl-backed; run in CI)."""
from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest


def _git(args: list[str], cwd: Path) -> None:
    subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True)


def _init_git(repo: Path) -> None:
    _git(["init", "-q"], repo)
    _git(["config", "user.email", "eval@test"], repo)
    _git(["config", "user.name", "eval"], repo)
    _git(["add", "-A"], repo)
    _git(["commit", "-qm", "init"], repo)


@pytest.fixture
def routing_consumer(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Two-service consumer (api-gateway + grafana) for incident-routing + telemetry tests."""
    repo = tmp_path / "routing-infra"
    monkeypatch.setenv("SERVICE_KNOWLEDGE_ROOT", str(repo))
    umbrella = repo / ".xtrm" / "skills" / "infra" / "service-knowledge"
    services = {
        "api-gateway": {
            "desc": "Inbound HTTP proxy.",
            "territory": ["api-gateway/**"],
            "triggers": ["api-gateway", "latency", "redaction"],
            "overview": "api-gateway proxies inbound HTTP and redacts sensitive headers.",
        },
        "grafana": {
            "desc": "Dashboards.",
            "territory": ["grafana/**"],
            "triggers": ["grafana", "dashboard"],
            "overview": "grafana renders dashboards.",
        },
    }
    registry_services = {}
    for sid, meta in services.items():
        svc = umbrella / "services" / sid
        svc.mkdir(parents=True)
        (svc / "SKILL.md").write_text(
            f"---\nname: {sid}\ndescription: >-\n  {meta['desc']}\nallowed-tools: Read, Bash(python3 *)\n---\n"
            f"# {sid} Expert\n\n## Service Overview\n{meta['overview']}\n\n"
            f"## Cross-Service Health Check\n```bash\npython3 scripts/health_probe.py --json\n```\n",
            encoding="utf-8",
        )
        (repo / sid).mkdir(parents=True, exist_ok=True)
        (repo / sid / "config.yml").write_text("key: value\n", encoding="utf-8")
        registry_services[sid] = {
            "name": sid, "description": meta["desc"],
            "skill_path": f".xtrm/skills/infra/service-knowledge/services/{sid}/SKILL.md",
            "territory": meta["territory"], "triggers": meta["triggers"], "last_sync_ref": "",
        }
    umbrella.mkdir(parents=True, exist_ok=True)
    (umbrella / "service-registry.json").write_text(
        json.dumps({"version": "1.0", "pack": "infra", "services": registry_services}, indent=2) + "\n",
        encoding="utf-8",
    )
    _init_git(repo)
    return repo
