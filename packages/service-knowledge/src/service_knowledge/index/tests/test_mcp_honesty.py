"""MCP answers say which checkout they read, how much they cut, which versions are involved and
how old the section behind a hit is. Each test fails on the code before these fields existed."""
from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path

from service_knowledge import __version__, index
from service_knowledge.index import bundle as bundle_mod
from service_knowledge.index import ranking, sync_sections
from service_knowledge.mcp import tool_registry, tool_specs
from service_knowledge.mcp._root import describe_resolution
from service_knowledge.mcp._template import SECTIONS

_PKG = Path(__file__).resolve().parents[4]  # packages/service-knowledge

_SYNC_SECTIONS = """
## Sync to stable aaaaaaa1 (2026-11-01, after promotion P1)
The older sync says webhook retention is seven days.

## Sync to stable bbbbbbb2 (2026-11-10, after promotion P2)
The newer sync says webhook retention is thirty days.
"""


def _git(repo: Path, *args: str) -> str:
    return subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True, text=True).stdout.strip()


# --- (1) which checkout was read ------------------------------------------------------------

def test_a_worktree_behind_the_primary_checkout_is_reported_stale(alertmanager_consumer, monkeypatch):
    repo = alertmanager_consumer
    wt = repo / ".xtrm" / "worktrees" / "wt"
    _git(repo, "worktree", "add", "-q", str(wt), "-b", "wt")
    (repo / "newer.txt").write_text("a newer commit on the primary checkout\n", encoding="utf-8")
    _git(repo, "add", "newer.txt")
    _git(repo, "commit", "-qm", "newer")

    monkeypatch.setenv("SERVICE_KNOWLEDGE_ROOT", str(wt))
    info = describe_resolution()

    assert info["linked_worktree"] is True
    assert Path(str(info["primary_checkout"])).resolve() == repo.resolve()
    assert info["behind_primary"] == 1
    assert info["stale"] is True
    assert f"consumer_root={info['primary_checkout']}" in str(info["hint"])

    # The same report rides on a real tool call; it never replaces the answer.
    status = tool_registry()["knowledge_status"]()
    assert status["consumer_root_resolution"]["stale"] is True
    assert Path(status["consumer_root"]).resolve() == wt.resolve()


def test_the_primary_checkout_is_not_reported_stale(alertmanager_consumer):
    info = describe_resolution()
    assert info["linked_worktree"] is False
    assert info["stale"] is False
    assert info["hint"] is None


def test_an_error_payload_stays_error_only(alertmanager_consumer):
    """The protocol layer turns ``{"error": ...}`` into isError only when it is the sole key."""
    assert set(tool_registry()["knowledge_get"]()) == {"error"}


# --- (2) output is bounded and says what was cut ---------------------------------------------

def _bundle_with(citations: int, probes: int = 0) -> dict:
    return {
        "items": [{"id": "section:svc:one"}],
        "citations": [{"item_id": "section:svc:one", "path": f"svc/file{i}.py", "line_start": i, "line_end": i}
                      for i in range(citations)],
        "verification": [{"item_id": "section:svc:one"}],
        "probes": [{"id": f"probe:{i}", "text": "x" * 400} for i in range(probes)],
    }


def test_one_item_with_many_citations_is_cut_to_the_budget_and_says_so():
    trimmed = bundle_mod._trim_to_budget(_bundle_with(citations=2000, probes=40))
    assert trimmed["token_estimate"] <= ranking.BUNDLE_MAX_TOKENS
    assert trimmed["truncated"] is True
    assert trimmed["totals"] == {"items": 1, "citations": 2000, "probes": 40}
    assert len(trimmed["items"]) == 1, "the first item is never dropped"


def test_a_small_bundle_is_not_marked_truncated():
    trimmed = bundle_mod._trim_to_budget(_bundle_with(citations=3))
    assert trimmed["truncated"] is False
    assert trimmed["totals"]["citations"] == 3 == len(trimmed["citations"])


def test_dropping_an_item_drops_its_citations_too():
    bundle = _bundle_with(citations=2)
    bundle["items"].append({"id": "section:svc:two", "text": "y" * 40000})
    bundle["citations"].append({"item_id": "section:svc:two", "path": "svc/two.py"})
    bundle["verification"].append({"item_id": "section:svc:two"})
    trimmed = bundle_mod._trim_to_budget(bundle)
    assert [i["id"] for i in trimmed["items"]] == ["section:svc:one"]
    assert all(c["item_id"] == "section:svc:one" for c in trimmed["citations"])
    assert all(v["item_id"] == "section:svc:one" for v in trimmed["verification"])


def test_evidence_for_files_stays_inside_the_budget_with_a_citation_heavy_skill(alertmanager_consumer):
    skill = alertmanager_consumer / ".xtrm/skills/infra/service-knowledge/services/alertmanager/SKILL.md"
    refs = "\n".join(f"- see alertmanager/module{i}.py:{i}-{i + 3}" for i in range(1500))
    text = skill.read_text(encoding="utf-8")
    marker = "## Cross-Service Health Check"
    skill.write_text(text.replace(marker, f"{refs}\n\n{marker}", 1), encoding="utf-8")
    result = tool_registry()["knowledge_evidence_for_files"](paths=["alertmanager/alertmanager.yml"], limit=1)
    assert result["token_estimate"] <= ranking.BUNDLE_MAX_TOKENS
    assert result["truncated"] is True
    cut_citations = result["totals"]["citations"] > len(result["citations"])
    cut_text = any(i.get("text_truncated") for i in result["items"])
    assert cut_citations or cut_text


# --- (3) CLI version and pack version are reported apart --------------------------------------

def test_status_reports_cli_and_pack_version_separately(alertmanager_consumer):
    version_file = alertmanager_consumer / ".xtrm/skills/default/service-knowledge/VERSION"
    version_file.parent.mkdir(parents=True)
    version_file.write_text("0.8.0\n", encoding="utf-8")
    status = tool_registry()["knowledge_status"]()
    assert status["cli_version"] == __version__
    assert status["pack_version"] == "0.8.0"
    assert status["version_mismatch"] is True
    assert "service-knowledge update" in status["version_note"]
    assert status["package_version"] == __version__ and status["installed_version"] == "0.8.0"


def test_status_matching_and_absent_pack_versions(alertmanager_consumer):
    status = tool_registry()["knowledge_status"]()
    assert status["pack_version"] is None and status["version_mismatch"] is None
    version_file = alertmanager_consumer / ".xtrm/skills/default/service-knowledge/VERSION"
    version_file.parent.mkdir(parents=True)
    version_file.write_text(f"{__version__}\n", encoding="utf-8")
    assert tool_registry()["knowledge_status"]()["version_mismatch"] is False


def test_every_version_string_agrees():
    pyproject = re.search(r'^version = "([^"]+)"', (_PKG / "pyproject.toml").read_text(), re.M).group(1)
    plugin = json.loads((_PKG / "plugin/service-knowledge/.claude-plugin/plugin.json").read_text())["version"]
    machinery = (_PKG / "src/service_knowledge/VERSION").read_text().strip()
    assert {__version__, pyproject, plugin, machinery} == {__version__}


# --- (4) the age of the section behind a hit ---------------------------------------------------

def test_sync_headings_parse_in_both_forms():
    assert sync_sections.parse_sync_heading("Sync to stable e1dd24121 (2026-11-06, after promotion P5)") == ("e1dd24121", "2026-11-06")
    assert sync_sections.parse_sync_heading("Sync to master f2937394 (2026-11-04, x)") == ("f2937394", "2026-11-04")
    assert sync_sections.parse_sync_heading("2026-08-17 updates (WS-008.31 — sync to 9756947)") == ("9756947", "2026-08-17")
    assert sync_sections.parse_sync_heading("Notifications") is None
    assert sync_sections.parse_sync_heading("Sync to stable abc") is None, "a date is required too"
    # Forms seen in real packs that carry no "to <sha>": the date alone orders the section.
    assert sync_sections.parse_sync_heading("Stable sync 8c0845b24cf4 (2026-11-13, after promotion P9)") == ("8c0845b24cf4", "2026-11-13")
    assert sync_sections.parse_sync_heading("Sync to master (2026-11-04, after promotion 3)") == (None, "2026-11-04")
    assert sync_sections.parse_sync_heading("Architecture overview (2026-11-04)") is None, "no sync word, no sync heading"
    assert sync_sections.parse_section_path("Service / Sync to stable abcdef1 (2026-01-02, x) / Detail") == ("abcdef1", "2026-01-02")


def test_hits_carry_section_age_and_the_older_section_is_a_superseded_candidate(alertmanager_consumer):
    skill = alertmanager_consumer / ".xtrm/skills/infra/service-knowledge/services/alertmanager/SKILL.md"
    skill.write_text(skill.read_text(encoding="utf-8") + _SYNC_SECTIONS, encoding="utf-8")
    result = tool_registry()["knowledge_search"](query="webhook retention", limit=7)
    by_ref = {i["section_sync_ref"]: i for i in result["items"] if i.get("section_sync_ref")}
    assert set(by_ref) >= {"aaaaaaa1", "bbbbbbb2"}
    assert by_ref["aaaaaaa1"]["section_date"] == "2026-11-01"
    assert by_ref["aaaaaaa1"]["superseded_candidate"] is True
    assert by_ref["bbbbbbb2"]["superseded_candidate"] is False
    plain = [i for i in result["items"] if not i.get("section_sync_ref")]
    assert all(i["superseded_candidate"] is False and i["section_date"] is None for i in plain)


# --- (5) one description template ---------------------------------------------------------------

def test_every_tool_description_follows_the_template_and_names_no_ticket():
    for spec in tool_specs():
        text = spec["description"]
        positions = [text.find(f"{name}: ") for name in SECTIONS]
        assert all(p >= 0 for p in positions), (spec["name"], positions)
        assert positions == sorted(positions), f"{spec['name']}: sections out of order"
        assert not re.search(r"\b(?:MMD|XTRM|CORE|SPECIALISTS|SUBSTRATE)-\d+", text), spec["name"]
        assert "EXAMPLE: " in text


def test_every_example_is_valid_json_that_fits_the_tool_parameters():
    for spec in tool_specs():
        example = spec["description"].split("EXAMPLE: ", 1)[1].strip()
        arguments = json.loads(example)
        properties = spec["parameters"].get("properties", {})
        assert set(arguments) <= set(properties), (spec["name"], set(arguments) - set(properties))
        assert set(spec["parameters"].get("required", [])) <= set(arguments), spec["name"]
        for name, value in arguments.items():
            limit = properties[name].get("maximum")
            assert limit is None or value <= limit, (spec["name"], name)


def test_a_single_oversized_item_text_is_cut_and_marked():
    bundle = {"items": [{"id": "section:svc:big", "text": "z" * 120_000}], "citations": [],
              "verification": [], "probes": []}
    trimmed = bundle_mod._trim_to_budget(bundle)
    item = trimmed["items"][0]
    assert trimmed["token_estimate"] <= ranking.BUNDLE_MAX_TOKENS
    assert item["text_truncated"] is True and item["text_chars"] == 120_000
    assert item["text"].endswith(bundle_mod.TEXT_TRUNCATED_MARK)
    assert trimmed["truncated"] is True


# --- review follow-ups ---------------------------------------------------------------------------

def _stale_worktree(repo: Path) -> Path:
    wt = repo / ".xtrm" / "worktrees" / "wt"
    _git(repo, "worktree", "add", "-q", str(wt), "-b", "wt")
    (repo / "newer.txt").write_text("newer\n", encoding="utf-8")
    _git(repo, "add", "newer.txt")
    _git(repo, "commit", "-qm", "newer")
    return wt


def test_an_error_from_a_stale_worktree_carries_the_hint_and_stays_error_only(alertmanager_consumer, monkeypatch):
    wt = _stale_worktree(alertmanager_consumer)
    monkeypatch.setenv("SERVICE_KNOWLEDGE_ROOT", str(wt))
    result = tool_registry()["knowledge_get"](item_id="section:nothing:here")
    assert set(result) == {"error"}, "the protocol layer needs the error to be the only key"
    assert result["error"].startswith("item not found: section:nothing:here")
    primary = alertmanager_consumer.resolve()
    assert f"consumer_root={primary}" in result["error"] or f"consumer_root={alertmanager_consumer}" in result["error"]


def test_an_error_from_the_primary_checkout_is_left_alone(alertmanager_consumer):
    assert tool_registry()["knowledge_get"](item_id="section:nothing:here") == {"error": "item not found: section:nothing:here"}


def _status_with_pack_version(repo: Path, version: str) -> dict:
    version_file = repo / ".xtrm/skills/default/service-knowledge/VERSION"
    version_file.parent.mkdir(parents=True, exist_ok=True)
    version_file.write_text(f"{version}\n", encoding="utf-8")
    return tool_registry()["knowledge_status"]()


def test_a_pack_newer_than_the_cli_is_never_told_to_run_update(alertmanager_consumer):
    status = _status_with_pack_version(alertmanager_consumer, "99.0.0")
    assert status["version_mismatch"] is True
    assert "NEWER than the CLI" in status["version_note"]
    assert "Do not run `service-knowledge update`" in status["version_note"]


def test_an_older_pack_is_told_to_update_and_an_unorderable_one_is_neutral(alertmanager_consumer):
    assert "older than the CLI" in _status_with_pack_version(alertmanager_consumer, "0.1.0")["version_note"]
    note = _status_with_pack_version(alertmanager_consumer, "weird-build")["version_note"]
    assert "cannot be ordered" in note and "run `service-knowledge update`" not in note


def test_escape_heavy_text_is_not_over_cut():
    text = '"\n' * 60_000  # every character is two bytes once JSON-escaped
    trimmed = bundle_mod._trim_to_budget({"items": [{"id": "section:svc:esc", "text": text}], "citations": [],
                                          "verification": [], "probes": []})
    kept = len(trimmed["items"][0]["text"])
    assert trimmed["token_estimate"] <= ranking.BUNDLE_MAX_TOKENS
    assert kept > 5_000, f"cut to {kept} chars although about 8000 would fit"


def test_text_is_left_alone_when_something_else_already_exceeds_the_budget():
    caveats = [{"id": f"c{i}", "note": "n" * 400} for i in range(120)]  # never trimmed, > budget alone
    bundle = {"items": [{"id": "section:svc:x", "text": "t" * 250}], "citations": [], "verification": [],
              "probes": [], "conflicts_and_caveats": caveats}
    trimmed = bundle_mod._trim_to_budget(bundle)
    assert trimmed["items"][0]["text"] == "t" * 250
    assert "text_truncated" not in trimmed["items"][0]
    assert trimmed["truncated"] is False


def test_sync_ref_rejects_dates_and_words_that_look_like_hex():
    assert sync_sections.parse_sync_heading("Sync to master 20261106 (2026-11-06, x)") == (None, "2026-11-06")
    assert sync_sections.parse_sync_heading("Sync to defaced (2026-11-06, x)") == (None, "2026-11-06")
    assert sync_sections.parse_sync_heading("Sync to ABCDEF1 (2026-11-06, x)") == (None, "2026-11-06"), "refs are lowercase hex"
    assert sync_sections.parse_sync_heading("SYNC TO master abcdef1 (2026-11-06, x)") == ("abcdef1", "2026-11-06")


def test_a_future_dated_section_does_not_mark_every_other_section_superseded(alertmanager_consumer):
    skill = alertmanager_consumer / ".xtrm/skills/infra/service-knowledge/services/alertmanager/SKILL.md"
    skill.write_text(skill.read_text(encoding="utf-8") + _SYNC_SECTIONS + """
## Sync to stable ccccccc3 (2099-01-01, a typo)
The mistyped section says retention is forever.
""", encoding="utf-8")
    result = tool_registry()["knowledge_search"](query="webhook retention", limit=7)
    by_ref = {i["section_sync_ref"]: i for i in result["items"] if i.get("section_sync_ref")}
    assert by_ref["bbbbbbb2"]["superseded_candidate"] is False, "the real newest section must stay current"
    assert by_ref["aaaaaaa1"]["superseded_candidate"] is True


def test_the_hint_says_so_when_the_primary_checkout_cannot_be_passed(alertmanager_consumer, tmp_path, monkeypatch):
    repo = alertmanager_consumer
    outside = tmp_path / "elsewhere-wt"  # a sibling, so the primary is not an ancestor of the session root
    _git(repo, "worktree", "add", "-q", str(outside), "-b", "wt2")
    (repo / "newer.txt").write_text("newer\n", encoding="utf-8")
    _git(repo, "add", "newer.txt")
    _git(repo, "commit", "-qm", "newer")
    monkeypatch.setenv("SERVICE_KNOWLEDGE_ROOT", str(outside))
    info = describe_resolution()
    assert info["stale"] is True
    assert "cannot be passed as consumer_root" in str(info["hint"])


def test_a_git_failure_never_fails_the_report(alertmanager_consumer, monkeypatch):
    from service_knowledge.mcp import _root

    monkeypatch.setattr(_root, "_git", lambda *a, **k: None)
    info = describe_resolution()
    assert info["stale"] is False and info["linked_worktree"] is False
    assert "consumer_root_resolution" in tool_registry()["knowledge_status"]()


def test_a_non_ascii_digit_in_the_pack_version_does_not_break_status(alertmanager_consumer):
    status = _status_with_pack_version(alertmanager_consumer, "0.9.\u00b2")  # superscript two: isdigit() is True
    assert status["version_mismatch"] is True
    assert "cannot be ordered" in status["version_note"]


def test_a_skipped_cut_leaves_no_text_chars():
    caveats = [{"id": f"c{i}", "note": "n" * 400} for i in range(120)]
    trimmed = bundle_mod._trim_to_budget({"items": [{"id": "section:svc:x", "text": "t" * 250}], "citations": [],
                                          "verification": [], "probes": [], "conflicts_and_caveats": caveats})
    assert "text_chars" not in trimmed["items"][0]


def test_a_sync_section_without_a_sha_still_ages_its_older_siblings(alertmanager_consumer):
    skill = alertmanager_consumer / ".xtrm/skills/infra/service-knowledge/services/alertmanager/SKILL.md"
    skill.write_text(skill.read_text(encoding="utf-8") + """
## Sync to master (2026-11-01, after promotion 1)
The older sync says webhook retention is seven days.

## Stable sync bbbbbbb2 (2026-11-10, after promotion 2)
The newer sync says webhook retention is thirty days.
""", encoding="utf-8")
    result = tool_registry()["knowledge_search"](query="webhook retention", limit=7)
    older = [i for i in result["items"] if i.get("section_date") == "2026-11-01"]
    assert older and older[0]["section_sync_ref"] is None and older[0]["superseded_candidate"] is True


def test_a_failing_report_says_so_instead_of_vanishing(alertmanager_consumer, monkeypatch):
    from service_knowledge.mcp import _root

    def boom(*_a, **_k):
        raise PermissionError("denied")

    monkeypatch.setattr("service_knowledge.mcp.describe_resolution", boom)
    status = tool_registry()["knowledge_status"]()
    assert status["consumer_root_resolution"] == {"unavailable": "PermissionError: denied"}
    assert status["registry_present"] is True, "the answer itself is unharmed"
