from __future__ import annotations

import json
from pathlib import Path

import pytest

from xtrm_research.definitions import DefinitionRegistry

FIXTURES_DIR = Path(__file__).parent / "fixtures"
REGISTRY_ROOT = FIXTURES_DIR / "registry"


@pytest.fixture
def registry() -> DefinitionRegistry:
    return DefinitionRegistry(REGISTRY_ROOT)


@pytest.fixture
def raw_definition():
    def _load(kind: str, filename: str) -> dict:
        return json.loads((REGISTRY_ROOT / kind / filename).read_text(encoding="utf-8"))

    return _load


@pytest.fixture
def runs_root(tmp_path: Path) -> Path:
    return tmp_path / "runs"
