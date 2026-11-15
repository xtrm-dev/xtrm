"""The packaged Claude Code plugin (CORE-2714).

The plugin is installed from the `xtrm` marketplace as a `git-subdir` source pointing at
`packages/service-knowledge/plugin/service-knowledge`, and a marketplace install copies ONLY that
folder into Claude Code's cache. Three invariants follow, and each has a way to break silently:

* the manifest version must track the Python package, or `claude plugin update` reports "already at
  the latest version" and ships nothing (the specialists plugin learned this: SPECIALISTS-4254);
* `.mcp.json` must point at a launcher inside the plugin folder, never at a sibling source tree
  that is absent in the cache (SPECIALISTS-4225);
* the launcher must fail with a named reason when the CLI is missing or too old, because a server
  that exits silently presents as "no tools" and reads like an agent choice.
"""
from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

from service_knowledge import __version__

PACKAGE_ROOT = Path(__file__).resolve().parents[4]
PLUGIN_ROOT = PACKAGE_ROOT / "plugin" / "service-knowledge"
PLUGIN_MANIFEST = PLUGIN_ROOT / ".claude-plugin" / "plugin.json"
PLUGIN_MCP = PLUGIN_ROOT / ".mcp.json"
LAUNCHER = PLUGIN_ROOT / "scripts" / "launch.mjs"
PYPROJECT = PACKAGE_ROOT / "pyproject.toml"

NODE = shutil.which("node")


def test_plugin_manifest_version_tracks_the_python_package():
    manifest = json.loads(PLUGIN_MANIFEST.read_text(encoding="utf-8"))
    assert manifest["name"] == "service-knowledge"
    assert manifest["version"] == __version__

    pyproject_version = re.search(
        r'^version = "([^"]+)"', PYPROJECT.read_text(encoding="utf-8"), re.MULTILINE
    )
    assert pyproject_version is not None, "pyproject.toml must declare a version"
    # pyproject is the packaging source of truth; __init__ carries it for runtime `--version`.
    assert manifest["version"] == pyproject_version.group(1)


def test_plugin_manifest_points_at_its_own_mcp_config():
    manifest = json.loads(PLUGIN_MANIFEST.read_text(encoding="utf-8"))
    assert manifest["mcpServers"] == "./.mcp.json"


def test_mcp_config_launches_only_code_that_travels_in_the_plugin_folder():
    """A marketplace install copies the plugin folder alone; no `../` path can resolve."""
    config = json.loads(PLUGIN_MCP.read_text(encoding="utf-8"))
    server = config["mcpServers"]["service-knowledge"]
    assert server["command"] == "node"
    args = server["args"]
    assert len(args) == 1
    assert args[0].startswith("${CLAUDE_PLUGIN_ROOT}/")
    relative = args[0].removeprefix("${CLAUDE_PLUGIN_ROOT}/")
    assert not relative.startswith(".."), "the launcher must live inside the plugin folder"
    assert (PLUGIN_ROOT / relative).exists(), f"missing launcher {relative}"


def test_launcher_exists_and_is_the_documented_entry():
    assert LAUNCHER.exists()
    source = LAUNCHER.read_text(encoding="utf-8")
    # The two responsibilities the launcher owns, asserted as source facts: an explicit root and a
    # named-reason failure. Behaviour is covered by the node tests below.
    assert "SERVICE_KNOWLEDGE_ROOT" in source
    assert "mcp" in source and "serve" in source
    assert "EX_CONFIG" in source or "78" in source


def test_launcher_gate_versions_are_ordered():
    """The minimum version must match the release that introduced `mcp`."""
    source = LAUNCHER.read_text(encoding="utf-8")
    minimum = re.search(r"const MINIMUM_VERSION = \[([^\]]+)\]", source)
    assert minimum is not None
    parts = [int(part.strip()) for part in minimum.group(1).split(",")]
    package_parts = [int(part) for part in __version__.split(".")]
    assert parts <= package_parts, (
        f"the manifest claims {__version__} but the launcher requires {' > '.join(map(str, parts))}"
    )


@pytest.mark.skipif(NODE is None, reason="node is required to run the plugin launcher")
def test_launcher_reports_a_missing_cli_with_a_named_reason(tmp_path):
    """No `service-knowledge` on PATH: exit 78 and a reason an operator can act on."""
    env = {
        "PATH": str(tmp_path),  # nothing resolvable there
        "HOME": str(tmp_path),
    }
    result = subprocess.run(
        [NODE, str(LAUNCHER)],
        capture_output=True, text=True, timeout=60, env=env, cwd=str(tmp_path),
    )
    assert result.returncode == 78
    assert "cli-missing" in result.stderr
    assert "pipx install service-knowledge" in result.stderr


@pytest.mark.skipif(NODE is None, reason="node is required to run the plugin launcher")
def test_launcher_reports_a_too_old_cli_and_names_the_version(tmp_path):
    """An 0.8.0 CLI (no `mcp` subcommand) must be refused by name, not present as no tools."""
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    stub = bin_dir / "service-knowledge"
    stub.write_text("#!/bin/sh\necho 'service-knowledge 0.8.0'\n", encoding="utf-8")
    stub.chmod(0o755)
    result = subprocess.run(
        [NODE, str(LAUNCHER)],
        capture_output=True, text=True, timeout=60,
        env={"PATH": str(bin_dir), "HOME": str(tmp_path)},
        cwd=str(tmp_path),
    )
    assert result.returncode == 78
    assert "cli-too-old" in result.stderr
    assert "0.8.0" in result.stderr
    assert "pipx upgrade service-knowledge" in result.stderr


@pytest.mark.skipif(NODE is None, reason="node is required to run the plugin launcher")
def test_launcher_pins_the_consumer_root_and_starts_the_server(tmp_path):
    """A satisfying CLI receives SERVICE_KNOWLEDGE_ROOT and the `mcp serve` arguments."""
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    recorded = tmp_path / "recorded.txt"
    stub = bin_dir / "service-knowledge"
    stub.write_text(
        "#!/bin/sh\n"
        'if [ "$1" = "--version" ]; then echo "service-knowledge 0.9.0"; exit 0; fi\n'
        f'printf "%s\\n" "$SERVICE_KNOWLEDGE_ROOT|$*" > "{recorded}"\n'
        "exit 0\n",
        encoding="utf-8",
    )
    stub.chmod(0o755)
    project = tmp_path / "consumer"
    project.mkdir()
    result = subprocess.run(
        [NODE, str(LAUNCHER)],
        capture_output=True, text=True, timeout=60,
        env={
            "PATH": str(bin_dir),
            "HOME": str(tmp_path),
            "CLAUDE_PROJECT_DIR": str(project),
        },
        cwd=str(project),
    )
    # The stub exits 0 immediately, which the launcher treats as a clean shutdown.
    assert result.returncode == 0, result.stderr
    recorded_text = recorded.read_text(encoding="utf-8").strip()
    root, _, args = recorded_text.partition("|")
    assert root == str(project), f"launcher must pin the project root, got {root!r}"
    assert args == "mcp serve"
