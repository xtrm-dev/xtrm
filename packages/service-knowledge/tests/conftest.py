"""Fixture shells for service-knowledge tests. Real fixtures land in PR1."""
from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest


def _git(args: list[str], cwd: Path) -> None:
    subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True)


@pytest.fixture
def consumer_repo(tmp_path: Path) -> Path:
    """A throwaway git repo with a legacy ``service-skills`` umbrella + 1 service."""
    repo = tmp_path / "acme-infra"
    umb = repo / ".xtrm" / "skills" / "acme" / "service-skills"
    svc = umb / "services" / "db"
    svc.mkdir(parents=True)
    (svc / "SKILL.md").write_text("# DB\n<!-- SEMANTIC_START -->\nnotes\n<!-- SEMANTIC_END -->\n", encoding="utf-8")
    registry = {
        "version": "1.0",
        "pack": "acme",
        "services": {
            "db": {
                "name": "db",
                "description": "Primary database.",
                "skill_path": ".xtrm/skills/acme/service-skills/services/db/SKILL.md",
                "territory": ["db/**"],
            }
        },
    }
    (umb / "service-registry.json").write_text(json.dumps(registry, indent=2) + "\n", encoding="utf-8")
    (repo / ".claude").mkdir(parents=True)
    (repo / ".claude" / "settings.json").write_text("{}\n", encoding="utf-8")
    _git(["init", "-q"], repo)
    _git(["config", "user.email", "test@test"], repo)
    _git(["config", "user.name", "test"], repo)
    _git(["add", "-A"], repo)
    _git(["commit", "-qm", "init"], repo)
    return repo
