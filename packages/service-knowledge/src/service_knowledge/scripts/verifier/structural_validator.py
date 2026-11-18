#!/usr/bin/env python3
"""Structural validator for SKILL Markdown.

Enforces the invariants that umbrella_generator + verifier must never corrupt
(research §2.6): YAML frontmatter, canonical heading order, the preserved
``SEMANTIC_START``/``SEMANTIC_END`` block, a parseable Markdown AST, and sane
inline-link syntax. A deleted or unbalanced semantic block is a hard failure —
that is the regression this validator exists to catch.

Hand-written text OUTSIDE the semantic blocks is guarded too: removed/rewritten
lines raise the ``curated_text_removed`` advisory (a ``warning`` the gate counts
as ``PASS_WITH_ADVISORIES``), and removing more than ``CURATED_REMOVAL_ERROR_RATIO``
of it (and at least ``CURATED_REMOVAL_ERROR_MIN_LINES`` lines) raises the blocking ``curated_text_removed_excessive`` error.

Decoupled from I/O: callers pass the canonical heading list (loaded from the
service-skill contract) rather than this module reaching for it.
"""
from __future__ import annotations

import difflib
import re
from collections import Counter
from dataclasses import dataclass

from markdown_it import MarkdownIt

SEMANTIC_START = "<!-- SEMANTIC_START -->"
SEMANTIC_END = "<!-- SEMANTIC_END -->"

_SEMANTIC_BLOCK_RE = re.compile(re.escape(SEMANTIC_START) + r"(.*?)" + re.escape(SEMANTIC_END), re.DOTALL)
# Share of current non-blank curated lines (outside semantic blocks) whose removal blocks the write.
CURATED_REMOVAL_ERROR_RATIO = 0.25
# ...but only once at least this many lines are gone, so a legit drift fix in a small file stays advisory.
CURATED_REMOVAL_ERROR_MIN_LINES = 8
CURATED_REMOVED_ADVISORY_CODE = "curated_text_removed"
CURATED_REMOVED_ERROR_CODE = "curated_text_removed_excessive"
_CURATED_LISTING_LIMIT = 10

_FRONTMATTER_RE = re.compile(r"\A---\s*\n(.*?)\n---\s*\n", re.DOTALL)
# Inline link with a broken/empty target: [text]( ) or [text]( or a dangling [text]
_BROKEN_LINK_RE = re.compile(r"\[[^\]]*\]\(\s*\)|\[[^\]]*\]\([^)]*$", re.MULTILINE)


@dataclass(frozen=True)
class StructuralIssue:
    """One structural defect."""

    severity: str  # "error" | "warning"
    code: str
    message: str
    line: int = 0


def _check_frontmatter(text: str) -> list[StructuralIssue]:
    if _FRONTMATTER_RE.match(text):
        return []
    return [StructuralIssue("error", "missing_frontmatter", "Document must begin with a YAML frontmatter block (--- ... ---).", 1)]


def _check_semantic_block(text: str) -> list[StructuralIssue]:
    starts = text.count(SEMANTIC_START)
    ends = text.count(SEMANTIC_END)
    issues: list[StructuralIssue] = []
    if starts == 0 and ends == 0:
        issues.append(
            StructuralIssue(
                "error",
                "semantic_block_deleted",
                "SEMANTIC_START/SEMANTIC_END block is missing — curatorial content must be preserved verbatim.",
                _line_of(text, "Semantic Deep Dive") or 1,
            )
        )
        return issues
    if starts != ends:
        issues.append(
            StructuralIssue(
                "error",
                "semantic_block_unbalanced",
                f"Unbalanced semantic markers: {starts} start vs {ends} end.",
                _line_of(text, SEMANTIC_START) or 1,
            )
        )
        return issues
    start_idx = text.find(SEMANTIC_START)
    end_idx = text.find(SEMANTIC_END)
    if end_idx < start_idx:
        issues.append(
            StructuralIssue(
                "error",
                "semantic_block_order",
                "SEMANTIC_END appears before SEMANTIC_START.",
                _line_of(text, SEMANTIC_END) or 1,
            )
        )
    return issues


def _check_semantic_preservation(text: str, current_text: str) -> list[StructuralIssue]:
    current_blocks = _SEMANTIC_BLOCK_RE.findall(current_text)
    if not current_blocks or current_blocks == _SEMANTIC_BLOCK_RE.findall(text):
        return []
    return [
        StructuralIssue(
            "error",
            "semantic_block_modified",
            "Semantic block interiors must be preserved verbatim and in order from the current document.",
            _line_of(text, SEMANTIC_START) or 1,
        )
    ]


def _semantic_line_indexes(text: str) -> set[int]:
    """Zero-based line indexes covered by SEMANTIC blocks, markers included."""
    covered: set[int] = set()
    for match in _SEMANTIC_BLOCK_RE.finditer(text):
        first = text.count("\n", 0, match.start())
        last = text.count("\n", 0, match.end())
        covered.update(range(first, last + 1))
    return covered


def _removed_curated_lines(text: str, current_text: str) -> tuple[list[tuple[int, str]], int]:
    """(removed (zero-based index, line) pairs, total) for current curated lines.

    Curated = non-blank lines outside SEMANTIC blocks, compared whitespace-trimmed.
    Multiset semantics: lines matched in ``equal`` opcodes are taken out of the
    candidate pool first; a removed line only counts as moved when it can consume
    one remaining pool entry. The pool holds candidate lines outside SEMANTIC blocks.
    """
    current_lines = [line.strip() for line in current_text.splitlines()]
    candidate_lines = [line.strip() for line in text.splitlines()]
    current_semantic = _semantic_line_indexes(current_text)
    candidate_semantic = _semantic_line_indexes(text)
    pool = Counter(line for j, line in enumerate(candidate_lines) if j not in candidate_semantic)
    opcodes = difflib.SequenceMatcher(a=current_lines, b=candidate_lines, autojunk=False).get_opcodes()
    for tag, i1, i2, j1, j2 in opcodes:
        if tag != "equal":
            continue
        for j in range(j1, j2):
            if j not in candidate_semantic:
                pool[candidate_lines[j]] -= 1
    removed: list[tuple[int, str]] = []
    for tag, i1, i2, _, _ in opcodes:
        if tag not in ("delete", "replace"):
            continue
        for index in range(i1, i2):
            line = current_lines[index]
            if not line or index in current_semantic:
                continue
            if pool[line] > 0:
                pool[line] -= 1
                continue
            removed.append((index, line))
    total = sum(1 for i, line in enumerate(current_lines) if line and i not in current_semantic)
    return removed, total


def _check_curated_preservation(text: str, current_text: str) -> list[StructuralIssue]:
    removed, total = _removed_curated_lines(text, current_text)
    if not removed:
        return []
    line = removed[0][0] + 1
    if len(removed) >= CURATED_REMOVAL_ERROR_MIN_LINES and len(removed) / total > CURATED_REMOVAL_ERROR_RATIO:
        return [
            StructuralIssue(
                "error",
                CURATED_REMOVED_ERROR_CODE,
                f"{len(removed)} of {total} curated lines outside semantic blocks were removed or rewritten "
                f"(limit {CURATED_REMOVAL_ERROR_RATIO:.0%} and {CURATED_REMOVAL_ERROR_MIN_LINES} lines); "
                "the candidate must keep unaffected text verbatim.",
                line,
            )
        ]
    shown = "; ".join(repr(r) for _, r in removed[:_CURATED_LISTING_LIMIT])
    more = len(removed) - _CURATED_LISTING_LIMIT
    suffix = f" (+{more} more)" if more > 0 else ""
    return [
        StructuralIssue(
            "warning",
            CURATED_REMOVED_ADVISORY_CODE,
            f"{len(removed)} curated line(s) outside semantic blocks removed or rewritten: {shown}{suffix}",
            line,
        )
    ]


def _line_of(text: str, needle: str) -> int | None:
    idx = text.find(needle)
    if idx < 0:
        return None
    return text.count("\n", 0, idx) + 1


def _check_headings(text: str, canonical_headings: list[str] | None) -> list[StructuralIssue]:
    if not canonical_headings:
        return []
    # Canonical headings are all H2; collect them in document order.
    found = [m.group(1).strip() for m in re.finditer(r"^##\s+(.*\S)\s*$", text, re.MULTILINE)]

    issues: list[StructuralIssue] = []
    found_set = set(found)
    for heading in canonical_headings:
        if heading not in found_set:
            issues.append(
                StructuralIssue(
                    "error",
                    "missing_heading",
                    f"Required canonical heading missing: '{heading}'.",
                    1,
                )
            )
    # Order check over the headings that ARE present.
    expected_order = [h for h in canonical_headings if h in found_set]
    present_in_order = [h for h in found if h in expected_order]
    if present_in_order != expected_order:
        issues.append(
            StructuralIssue(
                "warning",
                "heading_order",
                "Canonical headings are out of order.",
                1,
            )
        )
    return issues


def _check_markdown_ast(text: str) -> list[StructuralIssue]:
    try:
        MarkdownIt("commonmark").parse(text)
    except Exception as exc:  # markdown-it is lenient; a raise means truly malformed input
        return [StructuralIssue("error", "markdown_parse_error", f"Markdown AST failed to parse: {exc}", 1)]
    return []


def _check_links(text: str) -> list[StructuralIssue]:
    issues: list[StructuralIssue] = []
    for match in _BROKEN_LINK_RE.finditer(text):
        line = text.count("\n", 0, match.start()) + 1
        issues.append(
            StructuralIssue("warning", "broken_link", f"Malformed inline link near: {match.group(0)!r}", line)
        )
    return issues


def validate_structure(
    text: str,
    *,
    canonical_headings: list[str] | None = None,
    require_semantic_block: bool = True,
    current_text: str = "",
) -> list[StructuralIssue]:
    """Run all structural checks; returns every issue found (empty == valid)."""
    issues: list[StructuralIssue] = []
    issues += _check_frontmatter(text)
    if require_semantic_block:
        issues += _check_semantic_block(text)
    issues += _check_semantic_preservation(text, current_text)
    issues += _check_curated_preservation(text, current_text)
    issues += _check_headings(text, canonical_headings)
    issues += _check_markdown_ast(text)
    issues += _check_links(text)
    return issues


def has_errors(issues: list[StructuralIssue]) -> bool:
    return any(issue.severity == "error" for issue in issues)
