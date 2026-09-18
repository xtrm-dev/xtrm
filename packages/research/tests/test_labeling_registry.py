"""The shipped labeling experiment definition and fixed labeler brief.

XTRM-478 ships one experiment definition next to the XTRM-476 definitions
and one fixed brief. The brief is a small self-hashed JSON object; its
``content_hash`` is the existing :func:`hashing.compute_content_hash` of the
brief's own content, and the labeling experiment records that same hash so
every labeling run can state which brief it used.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from xtrm_research.definitions import DefinitionRegistry
from xtrm_research.hashing import compute_content_hash
from xtrm_research.schemas import validate

REGISTRY_ROOT = Path(__file__).resolve().parent.parent / "registry"
BRIEF_PATH = REGISTRY_ROOT / "labeler-brief-v1.json"
EXPERIMENT_ID = "reference-labeling-v1"

#: A Jira-style key (e.g. "CORE-101"): no definition may carry board text.
_JIRA_KEY = re.compile(r"\b[A-Z][A-Z0-9]{1,}-\d+\b")

#: Phrases that would reward a longer answer instead of a correct one.
_LENGTH_REWARDING = (
    "thorough",
    "detailed",
    "elaborate",
    "in detail",
    "comprehensive",
    "as much",
    "word count",
    "verbose",
    "explain your",
)


def _load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _brief_text(brief: dict) -> str:
    return " ".join(brief["instructions"])


def test_brief_recorded_hash_matches_its_content():
    brief = _load(BRIEF_PATH)
    assert brief["content_hash"] == compute_content_hash(brief)


def test_brief_asks_for_the_three_campaign_fields():
    brief = _load(BRIEF_PATH)
    assert set(brief["fields"]) == {"dispatchable", "main_gap", "execution_mode"}
    text = _brief_text(brief)
    for field in brief["fields"]:
        assert field in text


def test_brief_does_not_reward_length():
    text = _brief_text(_load(BRIEF_PATH)).lower()
    for phrase in _LENGTH_REWARDING:
        assert phrase not in text, f"brief rewards length via {phrase!r}"
    assert "at most 15 words" in text


def test_labeling_experiment_validates_and_loads_through_registry():
    registry = DefinitionRegistry(REGISTRY_ROOT)
    experiment = registry.get("experiment", EXPERIMENT_ID, "v1")
    validate("experiment", experiment)


def test_labeling_experiment_records_the_brief_hash():
    experiment = _load(REGISTRY_ROOT / "experiment" / f"{EXPERIMENT_ID}.json")
    brief = _load(BRIEF_PATH)
    recorded = experiment["labeling"]["brief"]
    assert recorded["id"] == brief["id"]
    assert recorded["version"] == brief["version"]
    assert recorded["content_hash"] == compute_content_hash(brief)


def test_labeling_experiment_carries_no_board_text():
    experiment = _load(REGISTRY_ROOT / "experiment" / f"{EXPERIMENT_ID}.json")
    assert not _JIRA_KEY.search(json.dumps(experiment))
