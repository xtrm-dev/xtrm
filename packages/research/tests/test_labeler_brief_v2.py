"""The v2 labeler brief must ask Jev's ``executable`` question (XTRM-485).

v1 asked whether a worker could complete the work "from the item text alone",
which makes a repository-discoverable fact a gap and recouples ``dispatchable``
to ``execution_mode``. v2 keeps the three-field shape but:

- grants repository access, so a fact the repository states is not a gap;
- carries Jev's decoupling softener *verbatim* on its own instruction line,
  so needing an operator is not itself a reason to answer "no";
- keeps the decision predicate free of who-must-act tokens, so the two fields
  stay independent by wording;
- carries the three ``execution_mode`` criteria exactly as Jev received them;
- adds an explicit ``abstain`` outcome with a stated condition; and
- puts the JSON output-format instruction inside the hashed brief.

The Jev wording is read through ``git show`` from the checkout named by
``XTRM_SPECIALISTS_REPO`` (default ``~/dev/specialists``) at ``a6e55215``; if
that checkout or commit is unavailable the source comparison skips with a
reason rather than passing silently, the same convention ``test_parity_ast.py``
uses. It is a source-of-truth comparison, not a fixture.
"""

from __future__ import annotations

import ast
import copy
import json
import os
import subprocess
from functools import lru_cache
from pathlib import Path

import pytest

from xtrm_research.hashing import compute_content_hash

REGISTRY_ROOT = Path(__file__).resolve().parent.parent / "registry"
V1_PATH = REGISTRY_ROOT / "labeler-brief-v1.json"
V2_PATH = REGISTRY_ROOT / "labeler-brief-v2.json"

#: v1 is hashed and referenced by runs that already exist; it must not change.
V1_CONTENT_HASH = (
    "sha256:4b7f1487dd07c04673f08d8e5c397c40d0222e73d7b846ca5b116e58de9989e5"
)

REPO = Path(
    os.environ.get("XTRM_SPECIALISTS_REPO", Path.home() / "dev" / "specialists")
)
COMMIT = "a6e55215"
SB_QUALITY = "experiments/jev-dupes/sb_quality3.py"

#: Tokens that would recouple ``dispatchable`` to ``execution_mode`` if they
#: appeared in the decision predicate. Jev's softener uses them only to rule
#: them out, so it is scanned separately from the predicate.
_COUPLING_TOKENS = (
    "operator",
    "another team",
    "waiting on a decision",
    "another decision",
)


def _load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _instruction_starting(brief: dict, prefix: str) -> str:
    matches = [text for text in brief["instructions"] if text.startswith(prefix)]
    assert len(matches) == 1, f"expected one instruction starting {prefix!r}: {matches}"
    return matches[0]


@lru_cache(maxsize=None)
def _sb_quality_source() -> str:
    if not REPO.is_dir():
        pytest.skip(f"specialists checkout not found at {REPO}")
    result = subprocess.run(
        ["git", "-C", str(REPO), "show", f"{COMMIT}:{SB_QUALITY}"],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        pytest.skip(f"{COMMIT}:{SB_QUALITY} unavailable: {result.stderr.strip()}")
    return result.stdout


@lru_cache(maxsize=None)
def _questions() -> dict[str, ast.Call]:
    """The ``questions()`` dict of Jev question nodes, parsed from source."""
    tree = ast.parse(_sb_quality_source())
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.name == "questions":
            returned = next(n for n in ast.walk(node) if isinstance(n, ast.Return))
            assert isinstance(returned.value, ast.Dict)
            return {
                ast.literal_eval(key): value
                for key, value in zip(returned.value.keys, returned.value.values)
            }
    raise AssertionError("no questions() in the source")


def _keyword(call: ast.Call, name: str) -> object:
    return ast.literal_eval(next(kw.value for kw in call.keywords if kw.arg == name))


def _jev_executable() -> str:
    return _keyword(_questions()["executable"], "instructions")


def _jev_softener() -> str:
    """Jev's second sentence, the clause that decouples operator-need from executable."""
    return _jev_executable().split(". ", 1)[1]


def _jev_execution_mode_criteria() -> dict[str, str]:
    return _keyword(_questions()["execution_mode"], "criteria")


def test_v1_is_unchanged_and_still_hashes():
    brief = _load(V1_PATH)
    assert brief["content_hash"] == V1_CONTENT_HASH
    assert compute_content_hash(brief) == V1_CONTENT_HASH


def test_v2_hash_covers_its_content():
    brief = _load(V2_PATH)
    assert brief["content_hash"] == compute_content_hash(brief)


def test_v2_keeps_the_three_campaign_fields():
    v2 = _load(V2_PATH)
    assert v2["fields"] == _load(V1_PATH)["fields"]
    assert set(v2["fields"]) == {"dispatchable", "main_gap", "execution_mode"}


def test_v2_dispatchable_text_contains_both_softeners():
    brief = _load(V2_PATH)
    predicate = _instruction_starting(brief, "dispatchable:")
    softener = _jev_softener()
    # softener 1: repository access means a repo-discoverable fact is not a gap
    assert "with repository access" in predicate
    # softener 2: Jev's still-counts clause, carried verbatim
    assert softener in brief["instructions"]
    assert "live systems or an operator still counts" in softener
    assert "exactly what to do, in what order, and how to prove it" in softener


def test_v2_carries_jev_softener_byte_for_byte():
    brief = _load(V2_PATH)
    assert _jev_softener() in brief["instructions"]
    matching = [
        text for text in brief["instructions"] if text.startswith("Work that needs")
    ]
    assert matching == [_jev_softener()]


def test_v2_dispatchable_predicate_is_independent_of_who_must_act():
    predicate = _instruction_starting(_load(V2_PATH), "dispatchable:").lower()
    for token in _COUPLING_TOKENS:
        assert token not in predicate, f"predicate recouples via {token!r}"


def test_v2_execution_mode_criteria_match_jev_exactly():
    brief = _load(V2_PATH)
    criteria = brief["criteria"]["execution_mode"]
    assert criteria == _jev_execution_mode_criteria()
    # the same text is on the instruction line the labeler reads
    execution_mode = _instruction_starting(brief, "execution_mode:")
    for value in criteria.values():
        assert value in execution_mode


def test_v2_declares_an_abstain_outcome_distinct_from_yes_and_no():
    brief = _load(V2_PATH)
    predicate = _instruction_starting(brief, "dispatchable:")
    output = _instruction_starting(brief, "Return exactly")
    # abstain has its own guard, separate from the yes and no answers
    assert '"abstain" only when' in predicate
    assert '"yes"' in predicate and '"no"' in predicate
    # all three outcomes are declared as distinct values in the output format
    for outcome in ('"yes"', '"no"', '"abstain"'):
        assert outcome in output
    # main_gap has an abstain branch separate from the no branch
    assert '"abstain"' in _instruction_starting(brief, "main_gap:")


def test_v2_output_format_lives_inside_the_hashed_brief():
    brief = _load(V2_PATH)
    output = _instruction_starting(brief, "Return exactly")
    assert "JSON object" in output
    # the hash covers the output instruction: changing it changes the hash
    mutated = copy.deepcopy(brief)
    mutated["instructions"] = [
        text.replace("JSON object", "plain text") for text in mutated["instructions"]
    ]
    assert compute_content_hash(mutated) != brief["content_hash"]
