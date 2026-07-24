"""Markdown AST parsing of a SKILL.md into frontmatter + H2 sections.

The section is the primary retrieval carrier (research §3.2), so the builder needs each SKILL
split into its ``## <heading>`` sections with stable heading paths and source line ranges (for
citations). Uses PyYAML (already a package dep) for the frontmatter and a small line-based
heading walker for the body — no new dependency is introduced for parsing.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

import yaml

_FRONTMATTER_RE = re.compile(r"\A---\n(.*?)\n---\n?", re.DOTALL)
_HEADING_RE = re.compile(r"^(#{1,6})\s+(.+?)\s*$")


@dataclass(frozen=True)
class Section:
    heading: str
    heading_path: str  # "H1 / H2" breadcrumb used as the section's stable path
    body: str
    line_start: int  # 1-based line of the heading in the source file
    line_end: int    # 1-based last body line (inclusive) of this section
    level: int


@dataclass(frozen=True)
class ParsedSkill:
    title: str
    frontmatter: dict[str, Any]
    sections: tuple[Section, ...] = field(default_factory=tuple)
    body: str = ""


def parse_frontmatter(text: str) -> tuple[dict[str, Any], str]:
    """Split a leading ``---`` YAML block from the body. Returns ({}, text) when absent."""
    match = _FRONTMATTER_RE.match(text)
    if not match:
        return {}, text
    try:
        data = yaml.safe_load(match.group(1)) or {}
    except yaml.YAMLError:
        data = {}
    if not isinstance(data, dict):
        data = {}
    return data, text[match.end():]


def parse_skill(text: str) -> ParsedSkill:
    """Parse a SKILL.md into frontmatter + H2 sections (with H1 title breadcrumb)."""
    frontmatter, body = parse_frontmatter(text)
    lines = body.splitlines()

    h1_title = ""
    sections: list[Section] = []
    current: dict[str, Any] | None = None
    body_lines: list[str] = []

    def flush(end_line: int) -> None:
        nonlocal current
        if current is None:
            return
        section_body = "\n".join(body_lines).strip("\n")
        sections.append(
            Section(
                heading=current["heading"],
                heading_path=current["heading_path"],
                body=section_body,
                line_start=current["line_start"],
                line_end=max(current["line_start"], end_line),
                level=current["level"],
            )
        )
        current = None
        body_lines.clear()

    for idx, line in enumerate(lines, start=1):
        heading_match = _HEADING_RE.match(line)
        if heading_match:
            level = len(heading_match.group(1))
            heading_text = heading_match.group(2).strip()
            if level == 1 and not h1_title:
                h1_title = heading_text
                continue
            if level == 2:
                flush(idx - 1)
                breadcrumb = f"{h1_title} / {heading_text}" if h1_title else heading_text
                current = {
                    "heading": heading_text,
                    "heading_path": breadcrumb,
                    "line_start": idx,
                    "level": level,
                }
                continue
        if current is not None:
            body_lines.append(line)

    flush(len(lines))

    title = str(frontmatter.get("name") or h1_title or "").strip()
    return ParsedSkill(title=title, frontmatter=frontmatter, sections=tuple(sections), body=body.strip("\n"))
