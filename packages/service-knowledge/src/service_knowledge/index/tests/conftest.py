"""Fixtures for the service-knowledge index tests.

Builds throwaway git consumer repos with a service registry + SKILL.md files so the builder,
ranker, MCP tools and cataloger can be exercised end-to-end without a live mercury-infra
checkout. ``infra_consumer`` mirrors the 17-service mercury-infra shape for the rebuild-timing
gate; ``alertmanager_consumer`` is the small smoke fixture ('discord webhook' lives in a section).
"""
from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest
import sys

# Make the standalone machinery scripts (cataloger, umbrella_generator) importable as
# top-level modules — they rely on a sys.path insert of their own dir, replicated here.
_SCRIPTS = Path(__file__).resolve().parent.parent.parent / "scripts"
if str(_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS))

_SKILL_TEMPLATE = """---
name: {sid}
description: >-
  Operational knowledge for the {sid} service.
allowed-tools: Read, Bash(python3 *)
---
# {title} Expert

## Service Overview
{sid} runs continuously. {overview}

## Architecture
Entry point: cmd/{sid}/main.go. Container name: {sid}. Depends on postgres and redis.

## Cross-Service Health Check
```bash
python3 scripts/health_probe.py --json
```

## Failure Modes
| Symptom | Cause | Fix |
|---|---|---|
| high latency | saturated pool | tune {sid}/config.yml:30 |

## Deploy & Runbook
Deploy via docker compose. See {sid}/deploy/README.md.
"""


def _git(args: list[str], cwd: Path) -> None:
    subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True)


def _init_git(repo: Path) -> str:
    _git(["init", "-q"], repo)
    _git(["config", "user.email", "test@test"], repo)
    _git(["config", "user.name", "test"], repo)
    _git(["add", "-A"], repo)
    _git(["commit", "-qm", "init"], repo)
    return subprocess.run(["git", "-C", str(repo), "rev-parse", "HEAD"],
                          capture_output=True, text=True, check=True).stdout.strip()


def make_consumer(root: Path, services: dict[str, dict]) -> Path:
    """Create a consumer repo. ``services`` maps service_id -> {description, territory, overview, triggers}."""
    repo = root / "consumer-infra"
    umb = repo / ".xtrm" / "skills" / "infra" / "service-knowledge"
    registry_services: dict[str, dict] = {}
    for sid, meta in services.items():
        svc_dir = umb / "services" / sid
        svc_dir.mkdir(parents=True)
        skill = _SKILL_TEMPLATE.format(sid=sid, title=sid.replace("-", " ").title(),
                                       overview=meta.get("overview", f"{sid} core behaviour."))
        (svc_dir / "SKILL.md").write_text(skill, encoding="utf-8")
        territory = meta.get("territory", [f"{sid}/**"])
        (repo / territory[0].split("/")[0]).mkdir(exist_ok=True)
        (repo / territory[0].split("/")[0] / "config.yml").write_text("key: value\n", encoding="utf-8")
        registry_services[sid] = {
            "name": sid,
            "description": meta.get("description", f"{sid} service."),
            "skill_path": f".xtrm/skills/infra/service-knowledge/services/{sid}/SKILL.md",
            "territory": territory,
            "triggers": meta.get("triggers", []),
            "last_sync_ref": "",
        }
    registry = {"version": "1.0", "pack": "infra", "services": registry_services}
    umb.mkdir(parents=True, exist_ok=True)
    (umb / "service-registry.json").write_text(json.dumps(registry, indent=2) + "\n", encoding="utf-8")
    _init_git(repo)
    return repo


@pytest.fixture
def alertmanager_consumer(tmp_path: Path) -> Path:
    """One service whose 'discord webhook' detail lives in a SECTION (not the registry desc)."""
    repo = tmp_path / "am-infra"
    umb = repo / ".xtrm" / "skills" / "infra" / "service-knowledge"
    svc = umb / "services" / "alertmanager"
    svc.mkdir(parents=True)
    skill = """---
name: alertmanager
description: >-
  Alert routing for the monitoring stack.
allowed-tools: Read, Bash(python3 *)
---
# Alertmanager Expert

## Service Overview
Alertmanager deduplicates and groups alerts, then routes them to receivers.

## Notifications
The Discord webhook receiver posts alerts to #ops-alerts. The webhook URL is configured in
alertmanager/alertmanager.yml:18-42 and validated by the discord notifier module.

## Cross-Service Health Check
```bash
python3 scripts/health_probe.py --json
```
"""
    (svc / "SKILL.md").write_text(skill, encoding="utf-8")
    (repo / "alertmanager").mkdir()
    (repo / "alertmanager" / "alertmanager.yml").write_text("route:\n  receiver: discord\n", encoding="utf-8")
    registry = {"version": "1.0", "pack": "infra", "services": {
        "alertmanager": {
            "name": "alertmanager",
            "description": "Alert routing for the monitoring stack.",
            "skill_path": ".xtrm/skills/infra/service-knowledge/services/alertmanager/SKILL.md",
            "territory": ["alertmanager/**"],
            "triggers": ["discord", "webhook", "alert"],
            "last_sync_ref": "",
        }}}
    (umb / "service-registry.json").write_text(json.dumps(registry, indent=2) + "\n", encoding="utf-8")
    _init_git(repo)
    return repo


@pytest.fixture
def infra_consumer(tmp_path: Path) -> Path:
    """17-service mercury-infra-shaped consumer for the rebuild-timing gate."""
    service_ids = [
        "alertmanager", "prometheus", "grafana", "postgres", "redis", "nginx", "vault",
        "consul", "traefik", "loki", "tempo", "minio", "rabbitmq", "elasticsearch",
        "kibana", "cadvisor", "node-exporter",
    ]
    services = {
        sid: {
            "description": f"{sid} operational service.",
            "territory": [f"{sid}/**"],
            "triggers": [sid, sid.replace("-", "")],
            "overview": f"{sid} handles its slice of the stack; see {sid}/config.yml.",
        }
        for sid in service_ids
    }
    return make_consumer(tmp_path, services)
