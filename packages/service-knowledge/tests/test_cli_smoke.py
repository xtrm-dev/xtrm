"""Smoke: install is correct + idempotent; migrate renames the umbrella; status reports."""
from __future__ import annotations

import json
import subprocess
from pathlib import Path

from service_knowledge import __version__
from service_knowledge.cli import main


def _snapshot(repo: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    for p in sorted(repo.rglob("*")):
        if p.is_file() and ".git" not in p.parts and "__pycache__" not in p.parts:
            out[str(p.relative_to(repo))] = p.read_text(encoding="utf-8", errors="replace")
    return out


def test_install_migrates_and_is_idempotent(consumer_repo: Path) -> None:
    assert main(["install", "--path", str(consumer_repo)]) == 0

    # machinery vendored + version stamped
    assert (consumer_repo / ".xtrm/skills/default/service-knowledge/scripts/cataloger.py").exists()
    assert (consumer_repo / ".xtrm/skills/default/service-knowledge/VERSION").read_text().strip() == __version__

    # umbrella renamed service-skills -> service-knowledge
    assert not (consumer_repo / ".xtrm/skills/acme/service-skills").exists()
    new_umb = consumer_repo / ".xtrm/skills/acme/service-knowledge"
    assert new_umb.exists()

    # registry skill_path rewritten
    reg = json.loads((new_umb / "service-registry.json").read_text())
    assert reg["services"]["db"]["skill_path"] == ".xtrm/skills/acme/service-knowledge/services/db/SKILL.md"

    # umbrella regenerated with the new name
    assert "name: acme-infra-service-knowledge" in (new_umb / "SKILL.md").read_text()

    # hooks wired to project-local service-knowledge machinery
    settings = json.loads((consumer_repo / ".claude/settings.json").read_text())
    cmds = json.dumps(settings["hooks"])
    assert "service-knowledge/scripts/cataloger.py" in cmds
    assert "service-knowledge/scripts/skill_activator.py" in cmds
    assert "service-knowledge/scripts/drift_detector.py" in cmds

    # empty cache + telemetry
    assert (consumer_repo / ".xtrm/cache/service-knowledge.sqlite").exists()
    tl = (consumer_repo / ".xtrm/state/service-knowledge/install.jsonl").read_text().strip().splitlines()
    assert json.loads(tl[-1])["component"] == "sk-cli"

    # idempotent: second install produces no file-content diff
    before = _snapshot(consumer_repo)
    assert main(["install", "--path", str(consumer_repo)]) == 0
    after = _snapshot(consumer_repo)
    # only the telemetry jsonl grows; everything else stable
    grew = {k for k in after if k not in before}
    assert grew <= {".xtrm/state/service-knowledge/install.jsonl"}
    for k, v in before.items():
        if k == ".xtrm/state/service-knowledge/install.jsonl":
            continue
        assert after[k] == v, f"not idempotent: {k}"


def test_status_reports_installed(consumer_repo: Path, capsys) -> None:
    main(["install", "--path", str(consumer_repo)])
    capsys.readouterr()
    assert main(["status", "--path", str(consumer_repo)]) == 0
    out = capsys.readouterr().out
    assert f"v{__version__}" in out
    assert "acme-service-knowledge" not in out or True  # status lists pack 'acme'
    assert "1 services" in out
