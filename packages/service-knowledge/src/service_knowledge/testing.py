"""Helpers for this package's own tests (not part of the public API).

The tests must not assume a ``service-knowledge`` console script on PATH or in the
interpreter's bin directory, nor a relative PYTHONPATH: both only hold in an editable
``pip install`` (CI) and make the suite fail anywhere else. Child processes run the CLI
as ``python -m service_knowledge.cli`` with an absolute PYTHONPATH built from where this
process actually imported the package (and vaultctl) from.
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import service_knowledge


def cli_argv() -> list[str]:
    return [sys.executable, "-m", "service_knowledge.cli"]


def cli_env(extra: dict[str, str] | None = None) -> dict[str, str]:
    roots = [Path(service_knowledge.__file__).resolve().parents[1]]
    try:
        import vaultctl

        roots.append(Path(vaultctl.__file__).resolve().parents[1])
    except ImportError:  # the CLI will report it; do not mask that here
        pass
    inherited = [str(Path(p).resolve()) for p in os.environ.get("PYTHONPATH", "").split(os.pathsep) if p]
    env = {**os.environ, "PYTHONPATH": os.pathsep.join([*map(str, roots), *inherited])}
    return {**env, **(extra or {})}


def run_cli(args: list[str], **kwargs) -> subprocess.CompletedProcess:
    """Run the CLI in a child process; ``kwargs`` go to ``subprocess.run`` (``env`` is merged)."""
    env = cli_env(kwargs.pop("env", None))
    return subprocess.run([*cli_argv(), *args], env=env, **kwargs)
