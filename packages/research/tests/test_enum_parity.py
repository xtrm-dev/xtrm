"""Every Python literal list that mirrors a schema enum must stay in sync
with that enum, so the two can never silently drift apart."""

from __future__ import annotations

import json
from typing import Any

from xtrm_research import schemas as schemas_module
from xtrm_research.cli.main import build_parser
from xtrm_research.schemas import load_schema
from xtrm_research.status import TERMINAL_STATES
from xtrm_research.telemetry import NULL_REASONS, USAGE_SOURCES

_SCHEMA_DIR = (
    schemas_module._SCHEMA_DIR
)  # test-only reach into the package's own schema dir


def _cli_choices(command_path: tuple[str, ...], option: str) -> set[str]:
    # Reaches into argparse's private structures to read back --choices for
    # a nested subcommand; there's no public API for that.
    parser = build_parser()
    node: Any = parser
    for name in command_path:
        action = next(
            a for a in node._subparsers._group_actions if hasattr(a, "choices")
        )
        node = action.choices[name]
    action = next(a for a in node._actions if option in a.option_strings)
    return set(action.choices or [])


def test_usage_source_enum_matches_common_schema():
    common = json.loads((_SCHEMA_DIR / "common.schema.json").read_text())
    usage_enum = set(common["$defs"]["usage_record"]["properties"]["source"]["enum"])
    assert set(USAGE_SOURCES) == usage_enum


def test_null_reason_enum_matches_telemetry_vocabulary():
    common = json.loads((_SCHEMA_DIR / "common.schema.json").read_text())
    schema_enum = set(
        common["$defs"]["usage_record"]["properties"]["null_reason"]["enum"]
    ) - {None}
    assert set(NULL_REASONS) == schema_enum


def test_annotation_kind_enum_matches_cli_choices():
    schema_enum = set(load_schema("annotation")["properties"]["kind"]["enum"])
    assert _cli_choices(("run", "annotate"), "--kind") == schema_enum


def test_annotation_evidence_status_enum_matches_cli_choices():
    schema_enum = set(
        load_schema("annotation")["properties"]["evidence_status"]["enum"]
    )
    assert _cli_choices(("run", "annotate"), "--evidence-status") == schema_enum


def test_terminal_states_match_status_schema_minus_started():
    schema_enum = set(load_schema("status")["properties"]["state"]["enum"])
    assert set(TERMINAL_STATES) == schema_enum - {"started"}
