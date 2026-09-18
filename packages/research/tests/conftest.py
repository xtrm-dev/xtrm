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


@pytest.fixture(autouse=True)
def research_budget(tmp_path_factory, monkeypatch):
    """Every test gets its own budget ledger directory and scope, so the
    XTRM-508 budget policy is exercised, never the operator's real ledger."""
    from xtrm_research import transports

    monkeypatch.setattr(
        transports, "BUDGET_DIR", str(tmp_path_factory.mktemp("budget"))
    )
    monkeypatch.setattr(
        transports,
        "RESEARCH_DOTENV",
        str(tmp_path_factory.mktemp("env") / "absent.env"),
    )
    monkeypatch.setenv(transports.BUDGET_SCOPE_ENV, "test")
    for key in (
        transports.BUDGET_MAX_CALLS_ENV,
        transports.BUDGET_MAX_COST_ENV,
        transports.ALLOWED_MODELS_ENV,
    ):
        monkeypatch.delenv(key, raising=False)
