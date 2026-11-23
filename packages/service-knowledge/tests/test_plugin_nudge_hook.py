"""The plugin's advisory service-knowledge nudge hook (XTRM-997).

The plugin ships its own `PreToolUse` hook so a Claude Code session is told which service owns a
path *before* it reads the source, and which knowledge tool to call next. Three properties matter
and each can break silently:

* the hook must never name a service the Python activator does not also match for that path, and it
  must name the most specific one — otherwise the plugin nudges the wrong service, or a neighbour
  that only matched through the matcher's suffix branch;
* it must speak once per service per session, or every read of a large service becomes a wall of
  identical advice;
* it must never block and never fail loudly: a broken registry, unparseable stdin, or a host that
  sends an unexpected payload degrades to no output and exit 0.
"""
from __future__ import annotations

import json
import tempfile
import pathlib
import shutil
import subprocess
import sys
import time
import uuid
from pathlib import Path

import pytest

PACKAGE_ROOT = Path(__file__).resolve().parents[1]
PLUGIN_ROOT = PACKAGE_ROOT / "plugin" / "service-knowledge"
HOOK = PLUGIN_ROOT / "hooks" / "service-knowledge-nudge.cjs"
HOOKS_CONFIG = PLUGIN_ROOT / "hooks" / "hooks.json"
PLUGIN_MANIFEST = PLUGIN_ROOT / ".claude-plugin" / "plugin.json"

sys.path.insert(0, str(PACKAGE_ROOT / "src" / "service_knowledge" / "scripts"))

from skill_activator import match_territory

NODE = shutil.which("node")

pytestmark = pytest.mark.skipif(NODE is None, reason="the hook runs on node")


def _registry(services: dict) -> dict:
    return {"version": "1.0", "pack": "acme", "services": services}


SERVICES = {
    "api": {
        "name": "api",
        "description": "API service",
        "skill_path": ".xtrm/skills/acme/service-knowledge/services/api/SKILL.md",
        "territory": ["api/app.py", "api/**/*.py", "api/**/*.ts"],
    },
    "web": {
        "name": "web",
        "description": "Web service",
        "skill_path": ".xtrm/skills/acme/service-knowledge/services/web/SKILL.md",
        "territory": ["web/src/**"],
    },
}


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    """A throwaway repo with one canonical service-knowledge registry."""
    root = tmp_path / "acme"
    umbrella = root / ".xtrm" / "skills" / "acme" / "service-knowledge"
    umbrella.mkdir(parents=True)
    (umbrella / "service-registry.json").write_text(
        json.dumps(_registry(SERVICES), indent=2) + "\n", encoding="utf-8"
    )
    subprocess.run(["git", "init", "-q"], cwd=root, check=True, capture_output=True)
    (root / "api").mkdir()
    (root / "api" / "app.py").write_text("print('api')\n", encoding="utf-8")
    (root / "web" / "src").mkdir(parents=True)
    (root / "web" / "src" / "ui.ts").write_text("export {};\n", encoding="utf-8")
    return root


def run_hook(payload: dict | str, session: str | None = None) -> tuple[str, int, float]:
    """Run the hook exactly as the host does: JSON on stdin, JSON or nothing on stdout."""
    body = payload if isinstance(payload, str) else json.dumps(payload)
    started = time.monotonic()
    proc = subprocess.run(
        [NODE, str(HOOK)],
        input=body,
        check=False,
        capture_output=True,
        text=True,
        timeout=30,
        env={"PATH": "/usr/bin:/bin", "HOME": "/tmp"},
    )
    elapsed_ms = (time.monotonic() - started) * 1000
    return proc.stdout, proc.returncode, elapsed_ms


def payload_for(repo: Path, tool: str, tool_input: dict, session: str | None = None) -> dict:
    return {
        "hook_event_name": "PreToolUse",
        "session_id": session or f"s-{uuid.uuid4().hex}",
        "cwd": str(repo),
        "tool_name": tool,
        "tool_input": tool_input,
    }


def context_of(stdout: str) -> str:
    if not stdout.strip():
        return ""
    data = json.loads(stdout)
    return data["hookSpecificOutput"]["additionalContext"]


def test_hook_is_registered_by_the_plugin_and_travels_inside_it():
    manifest = json.loads(PLUGIN_MANIFEST.read_text(encoding="utf-8"))
    assert manifest["hooks"] == "./hooks/hooks.json"
    config = json.loads(HOOKS_CONFIG.read_text(encoding="utf-8"))
    entries = config["hooks"]["PreToolUse"]
    assert len(entries) == 1
    matcher = entries[0]["matcher"]
    assert set(matcher.split("|")) == {"Read", "Grep", "Glob", "Bash"}
    command = entries[0]["hooks"][0]["command"]
    assert command.startswith("node ${CLAUDE_PLUGIN_ROOT}/")
    relative = command.removeprefix("node ${CLAUDE_PLUGIN_ROOT}/")
    assert not relative.startswith(".."), "the hook must live inside the plugin folder"
    assert (PLUGIN_ROOT / relative).exists()
    # Claude Code reads this field in SECONDS, not milliseconds: a 100 here would stall a tool
    # call for 100 s behind a hung hook. Two seconds is a ceiling, not the script's running cost.
    timeout = entries[0]["hooks"][0]["timeout"]
    assert isinstance(timeout, int)
    assert 0 < timeout <= 2, f"hook timeout is seconds; {timeout} is not a tool-call budget"


def test_read_inside_a_territory_names_the_next_knowledge_call(repo: Path):
    payload = payload_for(repo, "Read", {"file_path": str(repo / "api" / "app.py")})
    stdout, code, _ = run_hook(payload)
    assert code == 0
    data = json.loads(stdout)
    assert data["hookSpecificOutput"]["hookEventName"] == "PreToolUse"
    context = data["hookSpecificOutput"]["additionalContext"]
    assert "api" in context
    assert "knowledge_evidence_for_files" in context
    assert "knowledge_get" in context
    assert "api/app.py" in context
    # Advisory only: the hook must never carry a permission decision.
    assert "permissionDecision" not in stdout


def test_nudge_is_once_per_service_per_session(repo: Path):
    payload = payload_for(repo, "Read", {"file_path": str(repo / "api" / "app.py")})
    first, code, _ = run_hook(payload)
    assert code == 0
    assert context_of(first)
    second, code, _ = run_hook(payload)
    assert code == 0
    assert second.strip() == "", "a second read of the same service must stay silent"
    # A different service in the same session is still nudged once.
    third, _, _ = run_hook(
        {**payload, "tool_name": "Read", "tool_input": {"file_path": str(repo / "web" / "src" / "ui.ts")}}
    )
    assert "web" in context_of(third)


def test_grep_and_bash_reads_are_nudged_but_writes_and_mutations_are_not(repo: Path):
    grep = payload_for(repo, "Grep", {"pattern": "session", "path": str(repo / "api")})
    assert "api" in context_of(run_hook(grep)[0])

    bash_read = payload_for(repo, "Bash", {"command": "sed -n '1,40p' api/app.py"})
    assert "api" in context_of(run_hook(bash_read)[0])

    # A sed script is not a path: the nudge must name the file, never the `1,5p` range.
    sed_range = payload_for(repo, "Bash", {"command": "sed -n 1,5p api/app.py"})
    sed_context = context_of(run_hook(sed_range)[0])
    assert "api/app.py" in sed_context
    assert "1,5p" not in sed_context

    bash_mutation = payload_for(repo, "Bash", {"command": "rm -f api/app.py"})
    assert run_hook(bash_mutation)[0].strip() == ""

    # The read command must BE the segment's command, not merely appear in the line. Both hosts
    # must agree on all three of these (Pi parity is asserted in the extension suite).
    for command in ("rm -f api/app.py && ls", "git log --grep api", "echo hi > api/app.py; cat"):
        anchored = payload_for(repo, "Bash", {"command": command})
        assert run_hook(anchored)[0].strip() == "", command

    # A genuine read behind another segment still counts, for that segment only. A `cd`-relative
    # path cannot be resolved against the hook's cwd, so it stays silent rather than guessing.
    behind_other = payload_for(repo, "Bash", {"command": "echo start && cat api/app.py"})
    assert "api/app.py" in context_of(run_hook(behind_other)[0])
    assert run_hook(payload_for(repo, "Bash", {"command": "cd api && cat app.py"}))[0].strip() == ""

    # The first non-flag token of grep/rg is the PATTERN: `grep -rn api .` must not name the
    # owner of `api`, and `grep -rn session api` must name the directory actually searched.
    pattern_is_not_a_path = payload_for(repo, "Bash", {"command": "grep -rn api ."})
    assert run_hook(pattern_is_not_a_path)[0].strip() == ""
    pattern_then_dir = payload_for(repo, "Bash", {"command": "grep -rn session api"})
    assert "[service-knowledge] api" in context_of(run_hook(pattern_then_dir)[0])

    write = payload_for(repo, "Write", {"file_path": str(repo / "api" / "app.py")})
    assert run_hook(write)[0].strip() == ""


def test_the_session_throttle_needs_a_session_id(repo: Path):
    """No session id means no throttle key: silence, never one throttle shared by every session."""
    payload = payload_for(repo, "Read", {"file_path": str(repo / "api" / "app.py")})
    del payload["session_id"]
    assert run_hook(payload)[0].strip() == ""
    assert run_hook({**payload, "session_id": ""})[0].strip() == ""
    # A real session still gets its nudge, so the guard is not over-broad.
    assert "api" in context_of(run_hook(payload_for(repo, "Read", {"file_path": str(repo / "api" / "app.py")}))[0])


def test_the_session_cache_key_uses_the_whole_checkout_path(tmp_path: Path):
    """Two sibling checkouts that share a long prefix must not share one state cache.

    The key used to keep 32 base64url characters, so `mercury-market-data` and
    `mercury-economic-data` collided: the second read the first's registry cache.
    """
    session = f"collide-{uuid.uuid4().hex}"
    specs = [("mercury-market-data", "svc-mmd", "market/file.py"), ("mercury-economic-data", "svc-med", "econ/file.py")]
    payloads = []
    for name, service_id, owned in specs:
        root = tmp_path / "xtrm-xt-pi-probe-long-prefix-parent" / name
        umbrella = root / ".xtrm" / "skills" / "acme" / "service-knowledge"
        umbrella.mkdir(parents=True)
        (umbrella / "service-registry.json").write_text(
            json.dumps(_registry({service_id: {"description": name, "territory": [owned]}})), encoding="utf-8"
        )
        subprocess.run(["git", "init", "-q"], cwd=root, check=True, capture_output=True)
        owned_path = root / owned
        owned_path.parent.mkdir(parents=True, exist_ok=True)
        owned_path.write_text("x\n", encoding="utf-8")
        payloads.append(
            {"hook_event_name": "PreToolUse", "session_id": session, "cwd": str(root),
             "tool_name": "Read", "tool_input": {"file_path": str(owned_path)}}
        )
    # Same session id, two checkouts: a shared key would either silence the second or name the
    # first checkout's service for the second checkout's file. Both must answer with their own.
    first_out, _, _ = run_hook(payloads[0])
    second_out, _, _ = run_hook(payloads[1])
    assert "[service-knowledge] svc-mmd" in context_of(first_out)
    assert "[service-knowledge] svc-med" in context_of(second_out)


def test_parallel_tool_calls_do_not_lose_each_others_nudges(repo: Path):
    """Eight hooks racing on one session: the seen set is append-only, so no announcement is lost."""
    session = f"race-{uuid.uuid4().hex}"
    # Eight services, each owning its own file, announced by eight concurrent tool calls.
    services = {
        f"svc{index}": {"description": f"Service {index}", "territory": [f"dir{index}/file{index}.py"]}
        for index in range(8)
    }
    umbrella = repo / ".xtrm" / "skills" / "acme" / "service-knowledge"
    (umbrella / "services").mkdir(parents=True, exist_ok=True)
    for index in range(8):
        (repo / f"dir{index}").mkdir()
        (repo / f"dir{index}" / f"file{index}.py").write_text("x\n", encoding="utf-8")
    (umbrella / "service-registry.json").write_text(json.dumps(_registry(services)), encoding="utf-8")

    payloads = [
        {"hook_event_name": "PreToolUse", "session_id": session, "cwd": str(repo), "tool_name": "Read",
         "tool_input": {"file_path": str(repo / f"dir{index}" / f"file{index}.py")}}
        for index in range(8)
    ]
    procs = [
        subprocess.Popen(
            [NODE, str(HOOK)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, env={"PATH": "/usr/bin:/bin", "HOME": "/tmp"},
        )
        for _ in payloads
    ]
    for proc, payload in zip(procs, payloads):
        proc.communicate(json.dumps(payload), timeout=30)
    seen_path = pathlib.Path(tempfile.gettempdir()) / f"service-knowledge-nudge-seen-{session}"
    announced = [line for line in seen_path.read_text(encoding="utf-8").split("\n") if line]
    assert sorted(set(announced)) == sorted(services), f"lost announcements: {announced}"
    # Append-only: one line per service, no temp files left behind.
    assert not list(pathlib.Path(tempfile.gettempdir()).glob(f"service-knowledge-nudge-seen-{session}*.tmp"))


def test_unowned_paths_and_other_tools_stay_silent(repo: Path):
    assert run_hook(payload_for(repo, "Read", {"file_path": str(repo / "README.md")}))[0].strip() == ""
    assert run_hook(payload_for(repo, "PostToolUse", {"file_path": str(repo / "api" / "app.py")}))[0].strip() == ""


def test_shared_territory_names_every_co_owner(repo: Path):
    registry = repo / ".xtrm" / "skills" / "acme" / "service-knowledge" / "service-registry.json"
    registry.write_text(
        json.dumps(
            _registry(
                {
                    "store": {"name": "store", "territory": ["docker-compose.yml"]},
                    "platform": {"name": "platform", "territory": ["docker-compose.yml"]},
                    "schema": {"name": "schema", "territory": ["alembic/**/*"]},
                }
            )
        ),
        encoding="utf-8",
    )
    (repo / "docker-compose.yml").write_text("services: {}\n", encoding="utf-8")
    context = context_of(run_hook(payload_for(repo, "Read", {"file_path": str(repo / "docker-compose.yml")}))[0])
    # One injection, one line per owner, each with its own exact next call.
    assert context.startswith("[service-knowledge] 2 services own these paths:")
    assert "- store owns docker-compose.yml. Next: knowledge_evidence_for_files" in context
    assert "- platform owns docker-compose.yml. Next: knowledge_evidence_for_files" in context
    # A directory pattern is not ownership of a file outside its own tree.
    assert "schema" not in context


def test_single_owner_message_is_the_exact_shared_text(repo: Path):
    """The text is a contract: the pi extension appends the same string to a tool result."""
    context = context_of(run_hook(payload_for(repo, "Read", {"file_path": str(repo / "api" / "app.py")}))[0])
    assert context == (
        "[service-knowledge] api owns api/app.py. Next: knowledge_evidence_for_files "
        '{"paths":["api/app.py"]}, or knowledge_get with skill_path '
        ".xtrm/skills/acme/service-knowledge/services/api/SKILL.md."
    )


def test_one_injection_names_at_most_three_services(repo: Path):
    registry = repo / ".xtrm" / "skills" / "acme" / "service-knowledge" / "service-registry.json"
    services = {sid: {"name": sid, "territory": ["api/**/*.py"]} for sid in ["a01", "a02", "a03", "a04", "a05"]}
    registry.write_text(json.dumps(_registry(services)), encoding="utf-8")
    payload = payload_for(repo, "Read", {"file_path": str(repo / "api" / "app.py")})
    context = context_of(run_hook(payload)[0])
    assert context.startswith("[service-knowledge] 3 services own these paths:")
    assert context.count(" knowledge_evidence_for_files ") == 3
    # The services that were not named stay eligible for the next call in the same session.
    (repo / "api" / "other.py").write_text("print('x')\n", encoding="utf-8")
    second = payload_for(repo, "Read", {"file_path": str(repo / "api" / "other.py")})
    second["session_id"] = payload["session_id"]
    assert context_of(run_hook(second)[0]).startswith("[service-knowledge] 2 services own these paths:")


def test_a_directory_grep_resolves_to_the_territories_under_it(repo: Path):
    registry = repo / ".xtrm" / "skills" / "acme" / "service-knowledge" / "service-registry.json"
    registry.write_text(
        json.dumps(
            _registry(
                {
                    "api": {"name": "api", "territory": ["api/app.py"]},
                    "schema": {"name": "schema", "territory": ["alembic/**/*"]},
                }
            )
        ),
        encoding="utf-8",
    )
    context = context_of(run_hook(payload_for(repo, "Grep", {"pattern": "session", "path": str(repo / "api")}))[0])
    assert context.startswith("[service-knowledge] api owns api."), context
    # `alembic/**/*` matches a bare `api` only through the matcher's suffix branch: not ownership.
    assert "schema" not in context


def test_the_hook_defers_to_the_repo_activator(repo: Path):
    """A repo that wires skill_activator.py already injects a full bundle on the same events."""
    claude = repo / ".claude"
    claude.mkdir()
    (claude / "settings.json").write_text(
        json.dumps(
            {
                "hooks": {
                    "PreToolUse": [
                        {
                            "matcher": "Read|Grep|Glob|Bash",
                            "hooks": [{"type": "command", "command": "python3 $CLAUDE_PROJECT_DIR/.xtrm/skills/default/service-knowledge/scripts/skill_activator.py"}],
                        }
                    ]
                }
            }
        ),
        encoding="utf-8",
    )
    stdout, code, _ = run_hook(payload_for(repo, "Read", {"file_path": str(repo / "api" / "app.py")}))
    assert code == 0
    assert stdout.strip() == "", "two hooks must not answer the same read"


def test_the_activator_check_is_cached_with_the_registry(repo: Path):
    """One settings read per session, not per call: the decision is part of the cached snapshot."""
    claude = repo / ".claude"
    claude.mkdir()
    settings = claude / "settings.json"
    settings.write_text(
        json.dumps({"hooks": {"PreToolUse": [{"hooks": [{"command": "python3 skill_activator.py"}]}]}}),
        encoding="utf-8",
    )
    session = f"s-{uuid.uuid4().hex}"
    first, code, _ = run_hook(payload_for(repo, "Read", {"file_path": str(repo / "api" / "app.py")}, session))
    assert code == 0
    assert first.strip() == ""
    # The snapshot is taken on the first call; removing the wiring mid-session cannot un-cache it.
    settings.unlink()
    second, code, _ = run_hook(payload_for(repo, "Read", {"file_path": str(repo / "web" / "src" / "ui.ts")}, session))
    assert code == 0
    assert second.strip() == "", "the cached activator decision must still hold for the session"


def test_an_unreadable_registry_is_silent_and_exits_zero(repo: Path):
    registry = repo / ".xtrm" / "skills" / "acme" / "service-knowledge" / "service-registry.json"
    registry.chmod(0o000)
    try:
        stdout, code, _ = run_hook(payload_for(repo, "Read", {"file_path": str(repo / "api" / "app.py")}))
    finally:
        registry.chmod(0o644)
    assert code == 0
    assert stdout.strip() == ""


def test_drift_marker_adds_the_drift_call(repo: Path):
    (repo / ".xtrm" / ".service-knowledge-drift-pending").write_text("", encoding="utf-8")
    context = context_of(run_hook(payload_for(repo, "Read", {"file_path": str(repo / "api" / "app.py")}))[0])
    assert "knowledge_drift" in context


@pytest.mark.parametrize(
    "stdin",
    ["", "not json at all", "{}", '{"hook_event_name": "PreToolUse"}', '{"tool_name": "Read"}'],
)
def test_fail_open_on_stdin_it_cannot_use(repo: Path, stdin: str):
    stdout, code, _ = run_hook(stdin)
    assert code == 0
    assert stdout.strip() == ""


def test_a_broken_registry_never_blocks_the_tool_call(repo: Path):
    registry = repo / ".xtrm" / "skills" / "acme" / "service-knowledge" / "service-registry.json"
    registry.write_text("{ this is not json", encoding="utf-8")
    stdout, code, _ = run_hook(payload_for(repo, "Read", {"file_path": str(repo / "api" / "app.py")}))
    assert code == 0
    assert stdout.strip() == ""


def test_no_registry_anywhere_is_silent(tmp_path: Path):
    bare = tmp_path / "bare"
    bare.mkdir()
    stdout, code, _ = run_hook(payload_for(bare, "Read", {"file_path": str(bare / "api" / "app.py")}))
    assert code == 0
    assert stdout.strip() == ""


def test_hook_nudge_agrees_with_the_python_activator_and_prefers_the_owner(repo: Path):
    """The nudge never invents an owner, and it prefers the owner the gate would name first.

    The plugin and the Python activator share one matcher, so every service the hook names must be
    one Python also matches for that path. The hook is deliberately *narrower*: `match_territory`
    also answers yes for a path outside a directory pattern's own tree (its suffix branch), and
    that is not ownership. When two services match, the more specific territory wins.
    """
    for rel, owner in [
        ("api/app.py", "api"),  # exact path beats the file families
        ("api/nested/deep.py", "api"),  # a named file family still owns its own tree
        ("api/app.txt", "api"),  # directory containment, which Python also reports
        ("web/src/ui.ts", "web"),  # web/src/** owns it; api only matched it through `api/**/*.ts`
    ]:
        expected = [sid for sid, data in SERVICES.items() if match_territory(rel, data["territory"], repo)]
        assert owner in expected, f"{rel}: python does not match {owner}"
        stdout, code, _ = run_hook(payload_for(repo, "Read", {"file_path": str(repo / rel)}))
        assert code == 0
        context = context_of(stdout)
        assert context.startswith(f"[service-knowledge] {owner} "), f"{rel}: hook said {context!r}"

    # Python matches `other/app.py` only through the suffix branch of `api/**/*.py`, so the hook
    # stays silent rather than naming a service whose territory does not cover the path.
    assert match_territory("other/app.py", SERVICES["api"]["territory"], repo) is True
    stdout, code, _ = run_hook(payload_for(repo, "Read", {"file_path": str(repo / "other" / "app.py")}))
    assert code == 0
    assert context_of(stdout) == ""

    # Genuinely unowned paths are silent for both.
    for rel in ["web/README.md", "README.md"]:
        assert [sid for sid, data in SERVICES.items() if match_territory(rel, data["territory"], repo)] == []
        stdout, code, _ = run_hook(payload_for(repo, "Read", {"file_path": str(repo / rel)}))
        assert code == 0
        assert context_of(stdout) == ""


def test_hook_stays_far_below_the_tool_call_budget(repo: Path):
    """Measured cold-start cost of the whole hook process, not just the registry lookup.

    The declared hook timeout is 2 s (Claude Code reads the field in seconds). Node's own start-up dominates and is outside this
    script's control, so the assertion bounds what the script adds on top: the median of five
    runs must stay under one second on this host, and a warm run is checked separately below.
    """
    timings: list[float] = []
    for _ in range(5):
        payload = payload_for(repo, "Read", {"file_path": str(repo / "api" / "app.py")})
        payload["session_id"] = f"timing-{uuid.uuid4().hex}"
        _, code, elapsed_ms = run_hook(payload)
        assert code == 0
        timings.append(elapsed_ms)
    median = sorted(timings)[len(timings) // 2]
    assert median < 1000, f"hook median {median:.1f} ms exceeds the deliberate ceiling"
