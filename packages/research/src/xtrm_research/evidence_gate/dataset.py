"""Evidence Gate dataset v1: real XTRM search runs -> frozen candidates (XTRM-493).

Two strata, both drawn from real XTRM agent work:

* ``L`` (local retrieval) — ``ctx_search`` calls recorded in Pi session logs
  and Claude Code transcripts, with the passages exactly as the tool
  returned them. No replay.
* ``W`` (web retrieval) — ``ddgs text`` queries issued by Specialists
  researcher jobs. The original results were truncated in the job log, so
  the query is re-run once through the same tool at freeze time; the
  retrieval date and parameters are recorded as a replay.

This module parses and freezes. It performs no network call: the ``W``
replay goes through ``guards.guarded_send`` with the ``ddgs_text``
transport, called by :func:`replay_web_queries`.
"""

from __future__ import annotations

import hashlib
import json
import re
import sqlite3
from collections.abc import Iterable, Iterator, Mapping
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from xtrm_research.guards import guarded_send, redact

DATASET_ID = "evidence-gate"
DATASET_VERSION = 1
#: Passages are cut to this many characters before freezing; every arm and
#: every labeler sees the same cut text.
PASSAGE_CHAR_LIMIT = 2000
#: Local groups keep at most this many passages, in the order the tool
#: returned them.
LOCAL_PASSAGES_PER_GROUP = 8
#: Web replays request this many results per query.
WEB_RESULTS_PER_QUERY = 10
CTX_SEARCH_NAMES = frozenset(
    {"ctx_search", "mcp__plugin_context-mode_context-mode__ctx_search"}
)

_GROUP_HEADER = re.compile(r"^## (.+)$")
_PASSAGE_HEADER = re.compile(r"^--- \[(.+)\] ---$")
_DDGS_QUERY = re.compile(r'^ddgs text\s+-q\s+"((?:[^"\\]|\\.)+)"')


@dataclass(frozen=True)
class Candidate:
    """One retrieved passage for one query, before labeling."""

    query: str
    passage: str
    passage_header: str
    rank: int


@dataclass
class Group:
    """One query with its retrieved candidates and where it came from."""

    stratum: str
    source_kind: str
    source_ref: str
    ts: str | None
    query: str
    candidates: list[Candidate] = field(default_factory=list)

    @property
    def group_id(self) -> str:
        return _digest(f"{self.stratum}\x00{self.query}")[:16]


def _digest(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


# ---- stratum L: ctx_search results -------------------------------------------


def parse_ctx_search_result(text: str) -> list[tuple[str, list[tuple[str, str]]]]:
    """Split one ``ctx_search`` result into ``(query, [(header, passage)])``.

    The tool prints ``## <query>`` per query and ``--- [<source>] ---``
    before each passage; query groups are separated by a bare ``---`` line.
    A ``## `` line is a query header only at the start of the text or right
    after that separator — passage bodies are markdown and carry their own
    ``## `` headings. A query with no passage under it yields an empty
    list, never an invented passage.
    """
    groups: list[tuple[str, list[tuple[str, str]]]] = []
    header: str | None = None
    lines: list[str] = []
    previous = "---"  # the start of the text counts as a separator

    def flush() -> None:
        if header is not None and groups:
            body = "\n".join(lines).strip().removesuffix("---").strip()
            if body:
                groups[-1][1].append((header, body))

    for line in text.splitlines():
        group = _GROUP_HEADER.match(line)
        passage = _PASSAGE_HEADER.match(line)
        if group and previous == "---":
            flush()
            header, lines = None, []
            groups.append((group.group(1).strip(), []))
        elif passage and groups:
            flush()
            header, lines = passage.group(1).strip(), []
        elif header is not None:
            lines.append(line)
        if line.strip():
            previous = line.strip()
    flush()
    return groups


def _text_of(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(
            block.get("text", "") for block in content if isinstance(block, dict)
        )
    return ""


def iter_ctx_search_calls(path: Path) -> Iterator[tuple[str | None, str]]:
    """Yield ``(timestamp, result_text)`` for every ctx_search result in a
    Pi session log or Claude Code transcript (both are JSONL)."""
    pending: dict[str, str | None] = {}
    with path.open(encoding="utf-8", errors="ignore") as handle:
        for line in handle:
            if "ctx_search" not in line and "tool_result" not in line:
                continue
            try:
                record = json.loads(line)
            except json.JSONDecodeError:
                continue
            message = record.get("message")
            if not isinstance(message, dict):
                continue
            ts = record.get("timestamp") or message.get("timestamp")
            ts = str(ts) if ts is not None else None
            if message.get("role") == "toolResult":  # Pi
                if message.get("toolName") in CTX_SEARCH_NAMES:
                    yield ts, _text_of(message.get("content"))
                continue
            content = message.get("content")
            if not isinstance(content, list):
                continue
            for block in content:  # Claude Code
                if not isinstance(block, dict):
                    continue
                if (
                    block.get("type") == "tool_use"
                    and block.get("name") in CTX_SEARCH_NAMES
                ):
                    pending[block.get("id", "")] = ts
                elif (
                    block.get("type") == "tool_result"
                    and block.get("tool_use_id") in pending
                ):
                    pending.pop(block["tool_use_id"])
                    yield ts, _text_of(block.get("content"))


def local_groups(paths: Iterable[Path], source_kind: str) -> list[Group]:
    groups: list[Group] = []
    for path in paths:
        for index, (ts, text) in enumerate(iter_ctx_search_calls(path)):
            for query, passages in parse_ctx_search_result(text):
                group = Group("L", source_kind, f"{path}#result{index}", ts, query)
                group.candidates = [
                    Candidate(query, passage, header, rank)
                    for rank, (header, passage) in enumerate(passages)
                ]
                groups.append(group)
    return groups


# ---- stratum W: researcher web queries ---------------------------------------


def parse_ddgs_query(command: str) -> str | None:
    """The ``-q`` argument of a ``ddgs text`` command, or None."""
    match = _DDGS_QUERY.match(command.strip())
    return match.group(1).replace('\\"', '"') if match else None


def researcher_web_queries(db_path: Path) -> list[tuple[str, str, str]]:
    """``(query, job_ref, ts)`` for every ``ddgs text`` command a Specialists
    researcher job ran, read-only from its observability DB."""
    uri = f"file:{db_path}?mode=ro"
    with sqlite3.connect(uri, uri=True) as conn:
        rows = conn.execute(
            "select job_id, t, json_extract(event_json, '$.args.command') "
            "from specialist_events where specialist in ('researcher', "
            "'quant-researcher') and type = 'tool' and "
            "json_extract(event_json, '$.phase') = 'start'"
        ).fetchall()
    found = []
    for job_id, t, command in rows:
        query = parse_ddgs_query(command or "")
        if query:
            ts = datetime.fromtimestamp(t / 1000, timezone.utc).isoformat()
            found.append((query, f"{db_path}#job={job_id}", ts))
    return found


def replay_web_queries(
    queries: Iterable[tuple[str, str, str]], retrieved_at: str
) -> list[Group]:
    """Re-run each query once through the guarded ``ddgs_text`` transport."""
    groups = []
    for query, ref, ts in queries:
        response = guarded_send(
            {"query": query, "max_results": WEB_RESULTS_PER_QUERY}, "ddgs_text"
        )
        group = Group("W", "specialists-researcher-ddgs", ref, ts, query)
        group.candidates = [
            Candidate(
                query,
                f"{hit.get('title', '')}\n{hit.get('body', '')}".strip(),
                hit.get("href", ""),
                rank,
            )
            for rank, hit in enumerate(response["results"])
        ]
        group.source_ref += f";replayed_at={retrieved_at}"
        groups.append(group)
    return groups


# ---- filters, sampling, freezing ---------------------------------------------


@dataclass
class FilterCounts:
    empty: int = 0
    duplicate: int = 0
    redacted: int = 0
    truncated: int = 0
    short_query_groups: int = 0
    duplicate_query_groups: int = 0
    no_candidate_groups: int = 0


def eligible_query(query: str) -> bool:
    return len(re.findall(r"\w+", query)) >= 3


def apply_filters(
    groups: list[Group], cap: Mapping[str, int]
) -> tuple[list[Group], FilterCounts]:
    """Deterministic pre-System-One filters.

    Every passage and query is frozen *after* ``guards.redact``: the text
    at rest is exactly what the send seam would forward, so no
    credential-shaped string is stored and every arm and labeler reads the
    same text. Redaction runs before truncation, so a cut can never split
    a credential out of a rule's reach. Passages that redaction altered
    are kept (excluding them would bias the set against code and journal
    passages, which carry hashes) and counted in ``redacted``."""
    counts = FilterCounts()
    seen_queries: set[tuple[str, str]] = set()
    kept: list[Group] = []
    for group in groups:
        if not eligible_query(group.query):
            counts.short_query_groups += 1
            continue
        key = (group.stratum, group.query.strip().lower())
        if key in seen_queries:
            counts.duplicate_query_groups += 1
            continue
        seen_queries.add(key)
        seen_passages: set[str] = set()
        candidates = []
        for candidate in group.candidates:
            text = candidate.passage.strip()
            if not text:
                counts.empty += 1
                continue
            if text in seen_passages:
                counts.duplicate += 1
                continue
            seen_passages.add(text)
            query = redact(candidate.query)
            clean = redact(text)
            if clean != text or query != candidate.query:
                counts.redacted += 1
                text = clean
            if len(text) > PASSAGE_CHAR_LIMIT:
                counts.truncated += 1
                text = text[:PASSAGE_CHAR_LIMIT]
            candidates.append(
                Candidate(query, text, candidate.passage_header, candidate.rank)
            )
        candidates = candidates[: cap.get(group.stratum, len(candidates))]
        if not candidates:
            counts.no_candidate_groups += 1
            continue
        group.candidates = candidates
        kept.append(group)
    return kept, counts


def select_groups(
    groups: list[Group], per_stratum: Mapping[str, int], seed: int
) -> list[Group]:
    """Seeded selection: within each (stratum, source_kind) the groups with
    the smallest ``sha256(seed, group_id)`` are taken, so the sample is a
    pure function of the population and the seed. A stratum's quota is
    split evenly across its source kinds (remainder to the largest)."""
    chosen: list[Group] = []
    for stratum, quota in per_stratum.items():
        by_kind: dict[str, list[Group]] = {}
        for group in groups:
            if group.stratum == stratum:
                by_kind.setdefault(group.source_kind, []).append(group)
        kinds = sorted(by_kind, key=lambda k: -len(by_kind[k]))
        remaining = quota
        for position, kind in enumerate(kinds):
            share = remaining // (len(kinds) - position)
            ranked = sorted(
                by_kind[kind], key=lambda g: _digest(f"{seed}:{g.group_id}")
            )
            take = ranked[:share]
            remaining -= len(take)
            chosen.extend(take)
    return chosen


def items_of(groups: Iterable[Group]) -> list[dict[str, Any]]:
    items = []
    for group in groups:
        for candidate in group.candidates:
            items.append(
                {
                    "item_id": _digest(
                        f"{group.group_id}\x00{candidate.rank}\x00{candidate.passage}"
                    )[:16],
                    "group_id": group.group_id,
                    "stratum": group.stratum,
                    "source_kind": group.source_kind,
                    "source_ref": group.source_ref,
                    "source_ts": group.ts,
                    "rank": candidate.rank,
                    "state": {
                        "query": candidate.query,
                        "passage": candidate.passage,
                        "passage_source": candidate.passage_header,
                        "accepted_evidence": [],
                    },
                }
            )
    return items


def freeze(
    items: list[dict[str, Any]], out_dir: Path, manifest_fields: Mapping[str, Any]
) -> dict[str, Any]:
    """Write ``items.jsonl`` and a write-once ``manifest.json`` whose
    ``items_sha256`` is the hash of the exact bytes written."""
    out_dir.mkdir(parents=True, exist_ok=True)
    out_dir.chmod(0o700)
    items_path = out_dir / "items.jsonl"
    manifest_path = out_dir / "manifest.json"
    if manifest_path.exists():
        raise FileExistsError(
            f"{manifest_path} exists: a frozen dataset is never rewritten"
        )
    body = "".join(json.dumps(item, sort_keys=True) + "\n" for item in items)
    items_path.write_text(body, encoding="utf-8")
    items_path.chmod(0o600)
    manifest = {
        "dataset_id": DATASET_ID,
        "version": DATASET_VERSION,
        "items_file": items_path.name,
        "items_sha256": "sha256:" + _digest(body),
        "n_items": len(items),
        "n_groups": len({item["group_id"] for item in items}),
        "by_stratum": _count(items, "stratum"),
        "by_source_kind": _count(items, "source_kind"),
        **manifest_fields,
    }
    manifest_path.write_text(
        json.dumps(manifest, indent=1, sort_keys=True) + "\n", encoding="utf-8"
    )
    manifest_path.chmod(0o400)
    return manifest


def verify(out_dir: Path) -> bool:
    manifest = json.loads((out_dir / "manifest.json").read_text(encoding="utf-8"))
    body = (out_dir / manifest["items_file"]).read_text(encoding="utf-8")
    return manifest["items_sha256"] == "sha256:" + _digest(body)


def load_items(out_dir: Path) -> list[dict[str, Any]]:
    if not verify(out_dir):
        raise ValueError(f"{out_dir}: items do not match the frozen manifest hash")
    manifest = json.loads((out_dir / "manifest.json").read_text(encoding="utf-8"))
    lines = (out_dir / manifest["items_file"]).read_text(encoding="utf-8").splitlines()
    return [json.loads(line) for line in lines if line]


def _count(items: list[dict[str, Any]], key: str) -> dict[str, int]:
    counts: dict[str, int] = {}
    for item in items:
        counts[item[key]] = counts.get(item[key], 0) + 1
    return dict(sorted(counts.items()))


def filter_counts_dict(counts: FilterCounts) -> dict[str, int]:
    return asdict(counts)
