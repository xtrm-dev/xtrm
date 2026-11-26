"""Per-edit hooks are opt-in (DARTHFEEDOR-1359).

The PreToolUse activator and the PostToolUse drift detector run on every tool call and
cost 82-358 ms per call in a real consumer. The installer therefore wires them only when
the consumer opts in, and records that decision so the next install/update keeps it.
"""
from __future__ import annotations

import json
from pathlib import Path

from service_knowledge.cli import main
from service_knowledge.cli import common

CONFIG_REL = Path(".xtrm/config/service-knowledge.json")

PER_EDIT_SCRIPTS = ("skill_activator.py", "drift_detector.py")


def _settings(repo: Path) -> str:
    return (repo / ".claude/settings.json").read_text(encoding="utf-8")


def test_install_defaults_to_no_per_edit_hooks(consumer_repo: Path) -> None:
    assert main(["install", "--path", str(consumer_repo)]) == 0

    settings = _settings(consumer_repo)
    assert "cataloger.py" in settings
    for script in PER_EDIT_SCRIPTS:
        assert script not in settings
    # Default-off writes no config file: absent means off.
    assert not (consumer_repo / CONFIG_REL).exists()


def test_flag_opts_in_and_persists_across_update(consumer_repo: Path) -> None:
    assert main(["install", "--path", str(consumer_repo), "--per-edit-hooks"]) == 0

    settings = _settings(consumer_repo)
    assert "cataloger.py" in settings
    for script in PER_EDIT_SCRIPTS:
        assert script in settings
    config = json.loads((consumer_repo / CONFIG_REL).read_text(encoding="utf-8"))
    assert config["per_edit_hooks"] is True

    # The recorded decision survives a plain update: no flag needed next time.
    assert main(["update", "--path", str(consumer_repo)]) == 0
    settings = _settings(consumer_repo)
    for script in PER_EDIT_SCRIPTS:
        assert script in settings
    # ... and the per-edit entries are still the packaged ones (idempotent merge).
    hooks = json.loads(settings)["hooks"]
    drift = next(
        h for e in hooks["PostToolUse"] for h in e["hooks"] if "drift_detector.py" in h["command"]
    )
    assert drift["timeout"] == 10


def test_config_key_alone_opts_in(consumer_repo: Path) -> None:
    config = consumer_repo / CONFIG_REL
    config.parent.mkdir(parents=True)
    config.write_text(json.dumps({"per_edit_hooks": True}) + "\n", encoding="utf-8")

    assert main(["install", "--path", str(consumer_repo)]) == 0
    settings = _settings(consumer_repo)
    for script in PER_EDIT_SCRIPTS:
        assert script in settings


def test_truthy_string_does_not_opt_in(consumer_repo: Path) -> None:
    config = consumer_repo / CONFIG_REL
    config.parent.mkdir(parents=True)
    config.write_text(json.dumps({"per_edit_hooks": "true"}) + "\n", encoding="utf-8")

    assert common.per_edit_hooks_enabled(consumer_repo) is False
    assert main(["install", "--path", str(consumer_repo)]) == 0
    settings = _settings(consumer_repo)
    for script in PER_EDIT_SCRIPTS:
        assert script not in settings


def test_no_per_edit_hooks_strips_them_and_records_opt_out(consumer_repo: Path) -> None:
    assert main(["install", "--path", str(consumer_repo), "--per-edit-hooks"]) == 0
    assert "skill_activator.py" in _settings(consumer_repo)

    assert main(["update", "--path", str(consumer_repo), "--no-per-edit-hooks"]) == 0

    settings = _settings(consumer_repo)
    assert "cataloger.py" in settings
    for script in PER_EDIT_SCRIPTS:
        assert script not in settings
    config = json.loads((consumer_repo / CONFIG_REL).read_text(encoding="utf-8"))
    assert config["per_edit_hooks"] is False

    # The opt-out is durable: a later plain update does not re-add them.
    assert main(["update", "--path", str(consumer_repo)]) == 0
    for script in PER_EDIT_SCRIPTS:
        assert script not in _settings(consumer_repo)


def test_default_off_leaves_legacy_entries_in_place(consumer_repo: Path) -> None:
    """A consumer wired by an older package keeps its hooks until it opts out explicitly."""
    assert main(["install", "--path", str(consumer_repo), "--per-edit-hooks"]) == 0

    # Simulate a legacy consumer: hooks present, no config recorded.
    (consumer_repo / CONFIG_REL).unlink()
    assert main(["update", "--path", str(consumer_repo)]) == 0

    settings = _settings(consumer_repo)
    for script in PER_EDIT_SCRIPTS:
        assert script in settings
