"""Probe metadata extraction from a SKILL's ``Cross-Service Health Check`` section.

Probes are indexed and returned as evidence (kind=probe) but NEVER executed by the knowledge
layer (non-goal: no probe execution). A probe is a runnable command found in a fenced code
block of the health-check section — conventionally ``scripts/health_probe.py`` (scaffolder
default) but any fenced command counts.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

_FENCED_RE = re.compile(r"```([^\n`]*)\n(.*?)```", re.DOTALL)
HEALTH_SECTION_HEADING = "Cross-Service Health Check"


@dataclass(frozen=True)
class Probe:
    command: str
    language: str
    section_path: str


def extract_probes(section_heading: str, section_body: str, section_path: str) -> tuple[Probe, ...]:
    """Runnable probes declared in a health-check section body (empty for other sections)."""
    if section_heading.strip().lower() != HEALTH_SECTION_HEADING.lower():
        return ()
    probes: list[Probe] = []
    for match in _FENCED_RE.finditer(section_body):
        language = match.group(1).strip().lower()
        command = match.group(2).strip()
        if not command:
            continue
        # Only shell-ish blocks are runnable probes; skip e.g. yaml/json examples.
        if language and language not in {"bash", "sh", "shell", "zsh", "console", ""}:
            continue
        probes.append(Probe(command=command, language=language or "bash", section_path=section_path))
    return tuple(probes)
