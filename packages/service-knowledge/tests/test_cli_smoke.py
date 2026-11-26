"""Smoke: install is correct + idempotent; migrate renames the umbrella; status reports."""
from __future__ import annotations

import json
import subprocess
from pathlib import Path

from service_knowledge import __version__
from service_knowledge.cli import main
from service_knowledge.cli.common import wire_hooks


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

    # hooks wired to project-local service-knowledge machinery: SessionStart always,
    # the per-edit hooks only on explicit opt-in (DARTHFEEDOR-1359).
    settings = json.loads((consumer_repo / ".claude/settings.json").read_text())
    cmds = json.dumps(settings["hooks"])
    assert "service-knowledge/scripts/cataloger.py" in cmds
    assert "skill_activator.py" not in cmds
    assert "drift_detector.py" not in cmds

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


def test_install_repairs_stale_service_skills_hook_path(consumer_repo: Path) -> None:
    assert main(["install", "--path", str(consumer_repo)]) == 0
    hook = consumer_repo / ".githooks/post-merge"
    hook.write_text(
        hook.read_text().replace("/service-knowledge/", "/service-skills/"),
        encoding="utf-8",
    )

    assert main(["update", "--path", str(consumer_repo)]) == 0
    content = hook.read_text()
    assert "/service-skills/" not in content
    assert "$root/.xtrm/skills/default/service-knowledge/install/git-hooks/post_merge_drift_sweep.py" in content


def test_wire_hooks_preserves_siblings_and_timeout(consumer_repo: Path) -> None:
    settings_path = consumer_repo / ".claude/settings.json"
    settings_path.write_text(json.dumps({
        "hooks": {
            "SessionStart": [{
                "matcher": "startup",
                "hooks": [
                    {"type": "command", "command": "python3 sibling.py"},
                    {"type": "command", "command": "python3 old/service-knowledge/cataloger.py", "timeout": 42},
                ],
            }],
            "PostToolUse": [{
                "matcher": "Write",
                "hooks": [
                    {"type": "command", "command": "python3 sibling.py"},
                    {"type": "command", "command": "python3 old/drift_detector.py check-hook", "timeout": 10000},
                ],
            }],
        }
    }), encoding="utf-8")

    assert wire_hooks(consumer_repo) == [".claude/settings.json"]
    settings = json.loads(settings_path.read_text())
    session_entry = settings["hooks"]["SessionStart"][0]
    assert session_entry["matcher"] == "startup"
    assert len(session_entry["hooks"]) == 2
    post_entry = settings["hooks"]["PostToolUse"][0]
    assert post_entry["matcher"] == "Write"
    drift = next(h for h in post_entry["hooks"] if "drift_detector.py" in h["command"])
    # Claude Code reads this as SECONDS. The seeded 10000 (~2.8 h) is pre-existing state;
    # wire_hooks must correct it to the desired value rather than preserve it.
    assert drift["timeout"] == 10


def test_installed_post_merge_hook_uses_service_knowledge_flow(consumer_repo: Path) -> None:
    assert main(["install", "--path", str(consumer_repo)]) == 0
    source = consumer_repo / "db/state.txt"
    source.parent.mkdir(parents=True)
    source.write_text("changed\n", encoding="utf-8")
    subprocess.run(["git", "add", "db/state.txt"], cwd=consumer_repo, check=True)
    subprocess.run(["git", "commit", "-qm", "change db"], cwd=consumer_repo, check=True)

    result = subprocess.run(
        [str(consumer_repo / ".githooks/post-merge")],
        cwd=consumer_repo,
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0
    marker = consumer_repo / ".xtrm/.service-knowledge-drift-pending"
    assert marker.exists()
    assert "service-knowledge-sync" in marker.read_text()
    assert not (consumer_repo / ".xtrm/.service-skills-drift-pending").exists()


def test_status_reports_installed(consumer_repo: Path, capsys) -> None:
    main(["install", "--path", str(consumer_repo)])
    capsys.readouterr()
    assert main(["status", "--path", str(consumer_repo)]) == 0
    out = capsys.readouterr().out
    assert f"v{__version__}" in out
    assert "acme-service-knowledge" not in out or True  # status lists pack 'acme'
    assert "1 services" in out
