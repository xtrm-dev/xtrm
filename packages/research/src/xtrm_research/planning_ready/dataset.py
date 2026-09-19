"""Freeze the Planning-Ready v2 dataset from the live Substrate board.

    python -m xtrm_research.planning_ready.dataset build --out DIR [--cap N]

The dataset is read-only with respect to Substrate: the builder takes a
consistent snapshot through sqlite3's backup API and never opens the live
database for writing.

Three label channels are recorded separately and are never collapsed into one
``label`` (operator constraint 2):

- ``incumbent_state``: what the incumbent readiness system says about *this
  revision* — the structural findings the mirror reproduces, the revision's own
  attestation row (attestations are keyed by issue_revision + contract_hash, so
  a historical revision's incumbency is knowable without leakage), and, for the
  current revision only, the live ``sb issue show`` readiness fields.
- ``observed_outcome``: what happened afterwards — closure outcome, whether the
  revision was superseded, journal results, work receipts. Future information by
  construction, and labelled as such.
- ``research_label``: the experimental label, with source, methodology and
  confidence. Built from incumbent/outcome evidence, never conflated with them.

Revision history is first-class (operator constraint 3): every unit is one
(issue, revision) pair, so a superseded revision and its replacement form a
natural counterfactual pair within the same work item, and no revision ever
sees a later revision's text.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sqlite3
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Sequence

from xtrm_research.planning_ready import contracts, incumbent

#: Projects in scope: the repositories currently participating in XTRM
#: development. Discovered from the live substrate `projects` table; any project
#: added there is *not* silently pulled in — the set is explicit and frozen here.
PROJECTS = ("prj_xtrm", "prj_core", "prj_specialists", "prj_xtmux", "prj_console")

#: Local checkouts used for the deterministic path-existence check. A project
#: without an entry gets no path check (recorded as not-checked, never as a
#: pass).
CHECKOUTS = {
    "prj_xtrm": "/home/dawid/dev/xtrm",
    "prj_core": "/home/dawid/dev/core",
    "prj_specialists": "/home/dawid/dev/specialists",
    "prj_xtmux": "/home/dawid/dev/xtmux",
    "prj_console": "/home/dawid/dev/console",
}

DEFAULT_DB = "~/.xtrm/state.db"

#: Bounded caps per partition, so a large population cannot make the frozen set
#: unbounded and a cheap partition cannot dominate it.
CAPS = {
    "open_current": 300,
    "transition": 400,  # pairs; two units each
    "completed_attested": 280,  # every completed attested issue available at freeze time
    "easy_negative": 60,
}

#: A unit whose contract text matches this is excluded, never redacted (same
#: posture as guards.py: a credential-bearing contract is not dataset material).
CREDENTIAL_RE = re.compile(
    r"(?:AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|(?i:\b(?:password|passwd|secret|token|api[_-]?key)\b\s*[:=]\s*\S+))"
)

#: Held-out repository for the cross-repo stability report. Deterministic, and
#: excluded from the primary train/test split so a same-repo style effect
#: cannot flatter the primary numbers.
REPO_HOLDOUT = "specialists"


def _git_head(path: Path) -> dict[str, Any]:
    """The checkout's HEAD, read from the git directory directly (no
    subprocess: the research package's only remote seam is guarded_send)."""
    git_dir = path / ".git"
    if git_dir.is_file():  # a worktree: `.git` is a file pointing at the real dir
        text = git_dir.read_text(encoding="utf-8").strip()
        if text.startswith("gitdir:"):
            git_dir = (path / text.split("gitdir:", 1)[1].strip()).resolve()
    head_file = git_dir / "HEAD"
    if not head_file.is_file():
        return {}
    head = head_file.read_text(encoding="utf-8").strip()
    if not head.startswith("ref:"):
        return {"commit": head, "branch": None, "detached": True}
    ref = head.split("ref:", 1)[1].strip()
    commit = None
    ref_file = git_dir / ref
    if ref_file.is_file():
        commit = ref_file.read_text(encoding="utf-8").strip()
    else:
        packed = git_dir / "packed-refs"
        if packed.is_file():
            for line in packed.read_text(encoding="utf-8").splitlines():
                if line.endswith(" " + ref):
                    commit = line.split(" ", 1)[0]
                    break
    return {"commit": commit, "branch": ref.split("refs/heads/", 1)[-1], "detached": False}


def _checkout_provenance(checkouts: dict[str, Path]) -> dict[str, Any]:
    """Commit and branch of every local checkout the deterministic *advisory*
    path check reads. The path check is advisory, not a gate: a contract may
    legitimately name a path that does not exist yet, or exists on another
    branch, so a 'missing' path is evidence for a human, never a verdict."""
    out: dict[str, Any] = {}
    for project, path in checkouts.items():
        if not path.exists():
            out[project] = {"path": str(path), "exists": False}
            continue
        out[project] = {"path": str(path), "exists": True, **_git_head(path)}
    return out


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return "sha256:" + digest.hexdigest()


def _stable_bucket(key: str, modulus: int = 100) -> int:
    return int(hashlib.sha256(key.encode("utf-8")).hexdigest()[:8], 16) % modulus


def snapshot_db(db_path: Path, out: Path) -> Path:
    """Consistent read-only snapshot of the live Substrate database."""
    target = out / "substrate-snapshot.db"
    source = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        destination = sqlite3.connect(target)
        try:
            source.backup(destination)
        finally:
            destination.close()
    finally:
        source.close()
    return target


# --- extraction -------------------------------------------------------------


def _issue_rows(db: sqlite3.Connection) -> dict[str, dict[str, Any]]:
    placeholders = ",".join("?" * len(PROJECTS))
    rows = db.execute(
        f"""select i.id, i.project_id, i.human_number, i.kind, i.title,
                   i.lifecycle_state, i.current_revision, i.current_contract_hash,
                   i.scrutiny, i.created_at, i.updated_at, p.prefix, i.defer_until
            from issues i join projects p on p.id = i.project_id
            where i.project_id in ({placeholders})""",
        PROJECTS,
    )
    out: dict[str, dict[str, Any]] = {}
    for row in rows:
        (issue_id, project_id, number, kind, title, lifecycle, current_revision,
         contract_hash, scrutiny, created, updated, prefix, defer_until) = row
        out[issue_id] = {
            "issue_id": issue_id,
            "project": project_id,
            "project_name": prefix.lower(),
            "locator": f"{prefix}-{number}",
            "kind": kind,
            "title": title,
            "lifecycle_state": lifecycle,
            "current_revision": current_revision,
            "current_contract_hash": contract_hash,
            "scrutiny": scrutiny,
            "created_at": created,
            "updated_at": updated,
            "defer_until": defer_until,
        }
    return out


def _revision_rows(db: sqlite3.Connection, issues: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    rows = db.execute(
        """select issue_id, revision, contract_hash, contract_json,
                  context_refs_json, ownership_json, authored_by, source_json, created_at
           from issue_revisions"""
    )
    out: list[dict[str, Any]] = []
    for row in rows:
        if row[0] not in issues:
            continue
        out.append(
            {
                "issue_id": row[0],
                "revision": row[1],
                "contract_hash": row[2],
                "contract": json.loads(row[3]),
                "context_refs": json.loads(row[4] or "[]"),
                "ownership": json.loads(row[5]) if row[5] else None,
                "authored_by": row[6],
                "source": json.loads(row[7]) if row[7] else None,
                "created_at": row[8],
            }
        )
    out.sort(key=lambda r: (r["issue_id"], r["revision"]))
    return out


def _attestations(db: sqlite3.Connection) -> dict[tuple[str, int], list[dict[str, Any]]]:
    rows = db.execute(
        """select issue_id, issue_revision, contract_hash, outcome, policy,
                  attested_by, evidence_refs_json, blocking_gaps_json, created_at
           from readiness_attestations order by id"""
    )
    out: dict[tuple[str, int], list[dict[str, Any]]] = {}
    for row in rows:
        out.setdefault((row[0], row[1]), []).append(
            {
                # issue_revision and contract_hash are what attestation currency
                # is tested against; dropping either silently makes every
                # attestation look stale.
                "issue_revision": row[1],
                "outcome": row[3],
                "policy": row[4],
                "attested_by": row[5],
                "evidence_refs": json.loads(row[6] or "[]"),
                "blocking_gaps": json.loads(row[7] or "[]"),
                "created_at": row[8],
                "contract_hash": row[2],
            }
        )
    return out


def _closures(db: sqlite3.Connection) -> dict[str, dict[str, Any]]:
    rows = db.execute(
        """select issue_id, issue_revision, contract_hash, terminal_state, outcome,
                  actor, validation_refs_json, journal_result_refs_json, closed_at
           from issue_closures"""
    )
    out: dict[str, dict[str, Any]] = {}
    for row in rows:
        out[row[0]] = {
            "terminal_state": row[3],
            "outcome": row[4],
            "issue_revision": row[1],
            "contract_hash": row[2],
            "actor": row[5],
            "validation_refs": json.loads(row[6] or "[]"),
            "journal_result_refs": json.loads(row[7] or "[]"),
            "closed_at": row[8],
        }
    return out


def _journal(db: sqlite3.Connection) -> dict[str, list[dict[str, Any]]]:
    rows = db.execute(
        """select issue_id, issue_revision, sequence, kind, semantic_json, created_at
           from issue_journal where kind in ('result','finding','milestone','decision','blocker')
           order by issue_id, sequence"""
    )
    out: dict[str, list[dict[str, Any]]] = {}
    for issue_id, revision, sequence, kind, semantic, created in rows:
        entry: dict[str, Any] = {"revision": revision, "sequence": sequence, "kind": kind, "created_at": created}
        if semantic:
            try:
                payload = json.loads(semantic)
            except json.JSONDecodeError:
                payload = {}
            if isinstance(payload, dict):
                summary = payload.get("summary") or payload.get("text") or payload.get("message")
                if isinstance(summary, str):
                    entry["summary"] = summary[:400]
        out.setdefault(issue_id, []).append(entry)
    return out


def _receipts(db: sqlite3.Connection) -> dict[str, int]:
    rows = db.execute("select issue_id, count(*) from work_receipts group by issue_id")
    return {row[0]: row[1] for row in rows}


def _unsatisfied_blockers(db: sqlite3.Connection, lifecycle: dict[str, str]) -> dict[str, list[str]]:
    """Blocker edges whose prerequisite is not done/archived (mirrors the
    incumbent: a cancelled prerequisite stays unsatisfied)."""
    rows = db.execute(
        "select from_issue, to_issue, kind from issue_edges where active = 1"
    )
    out: dict[str, list[str]] = {}
    for from_issue, to_issue, kind in rows:
        if kind not in ("blocks", "blocked_by", "depends_on"):
            continue
        # `from` blocks `to` in the Substrate edge convention used by readiness.
        prerequisite, dependent = from_issue, to_issue
        if not incumbent.is_blocker_satisfied(lifecycle.get(prerequisite, "open")):
            out.setdefault(dependent, []).append(prerequisite)
    return out


def _active_claims(db: sqlite3.Connection, now_ms: int) -> set[str]:
    rows = db.execute(
        "select issue_id, expires_at, released_at from issue_claims"
    )
    return {
        row[0]
        for row in rows
        if row[2] is None and (row[1] is None or row[1] > now_ms)
    }


# --- deterministic diagnostics ---------------------------------------------


def deterministic_diagnostics(unit: dict[str, Any], checkouts: dict[str, Path]) -> dict[str, Any]:
    contract = unit["contract"]
    findings = contracts.structural_findings(
        contract,
        scrutiny=unit.get("scrutiny"),
        ownership=unit.get("ownership"),
        context_refs=unit.get("context_refs"),
        lifecycle_state=unit.get("lifecycle_state"),
    )
    checkout = checkouts.get(unit["project"])
    paths = contracts.referenced_paths(contract)
    if checkout is None or not checkout.exists():
        path_check: dict[str, Any] = {"checked": False, "reason": "no local checkout for this project", "paths": paths, "missing": []}
    else:
        missing = [p for p in paths if not (checkout / p).exists()]
        path_check = {"checked": True, "checkout": str(checkout), "paths": paths, "missing": missing}
    return {
        "structural_findings": findings,
        "structurally_valid": len(findings) == 0,
        "referenced_paths": path_check,
        "referenced_locators": contracts.referenced_locators(contract),
    }


# --- assembly ---------------------------------------------------------------


def _excluded(text: str) -> bool:
    return bool(CREDENTIAL_RE.search(text))


def _unit(
    issue: dict[str, Any],
    revision: dict[str, Any],
    *,
    checkouts: dict[str, Path],
    attestations: dict[tuple[str, int], list[dict[str, Any]]],
    closures: dict[str, dict[str, Any]],
    journal: dict[str, list[dict[str, Any]]],
    receipts: dict[str, int],
    next_revision: dict[str, Any] | None,
    locator_index: dict[str, str],
    blockers: dict[str, list[str]],
    claims: set[str],
    now_ms: int,
) -> dict[str, Any]:
    contract = revision["contract"]
    text = contracts.contract_text(contract)
    attestation_rows = attestations.get((issue["issue_id"], revision["revision"]), [])
    current_attestation = [
        a for a in attestation_rows if a["contract_hash"] == revision["contract_hash"]
    ]
    closure = closures.get(issue["issue_id"])
    is_current = revision["revision"] == issue["current_revision"]
    later_journal = [
        e
        for e in journal.get(issue["issue_id"], [])
        if e["revision"] >= revision["revision"]
    ]
    locator_check = {
        loc: (loc in locator_index) for loc in contracts.referenced_locators(contract)
    }
    diagnostics = deterministic_diagnostics({**revision, **issue}, checkouts)

    # The next revision is the natural counterfactual, but only *after* this
    # revision: it is outcome evidence, never input.
    transition = None
    if next_revision is not None:
        changed = {
            field: next_revision["contract"].get(field) != contract.get(field)
            for field in contracts.REQUIRED_SECTIONS
        }
        transition = {
            "next_revision": next_revision["revision"],
            "next_contract_hash": next_revision["contract_hash"],
            "changed_sections": sorted(k for k, v in changed.items() if v),
            "same_problem": next_revision["contract"].get("problem") == contract.get("problem"),
        }

    unit: dict[str, Any] = {
        "unit_id": f"{issue['locator']}@r{revision['revision']}",
        "issue_id": issue["issue_id"],
        "locator": issue["locator"],
        "project": issue["project"],
        "project_name": issue["project_name"],
        "kind": issue["kind"],
        "title": issue["title"],
        "lifecycle_state": issue["lifecycle_state"],
        "revision": revision["revision"],
        "contract_hash": revision["contract_hash"],
        "authored_by": revision["authored_by"],
        "revision_created_at": revision["created_at"],
        "is_current_revision": is_current,
        "contract": contract,
        "contract_chars": len(text),
        "scrutiny": issue["scrutiny"],
        "ownership": revision["ownership"],
        "context_refs": revision["context_refs"],
        "deterministic": diagnostics,
        "incumbent_state": {
            "attestation_this_revision": [
                {"outcome": a["outcome"], "policy": a["policy"], "attested_by": a["attested_by"],
                 "blocking_gaps": a["blocking_gaps"], "created_at": a["created_at"]}
                for a in current_attestation
            ],
            "attested_ready_this_revision": any(
                a["outcome"] == "ready" for a in current_attestation
            ),
            "attestation_other_revision": [
                {"revision": rev, "outcome": a["outcome"]}
                for (issue_id, rev), rows_ in attestations.items()
                if issue_id == issue["issue_id"] and rev != revision["revision"]
                for a in rows_
            ],
            "lifecycle_state_at_snapshot": issue["lifecycle_state"],
            # The incumbent's derived readiness for *this* revision, reproduced
            # from the snapshot by the research mirror (see incumbent.py). It
            # describes what the incumbent system says about this contract, not
            # an independent truth about it.
            "derived_readiness": incumbent.derive_readiness(
                contract=contract,
                scrutiny=issue["scrutiny"],
                ownership=revision["ownership"],
                context_refs=revision["context_refs"],
                lifecycle_state=issue["lifecycle_state"] if is_current else "open",
                defer_until=issue["defer_until"] if is_current else None,
                revision=revision["revision"],
                contract_hash=revision["contract_hash"],
                attestation=current_attestation[-1] if current_attestation else None,
                unsatisfied_blockers=blockers.get(issue["issue_id"], []),
                has_active_claim=issue["issue_id"] in claims,
                now=now_ms,
            ),
            "derived_readiness_provenance": (
                "reproduced from the frozen snapshot by xtrm_research.planning_ready.incumbent; "
                "verified against the sb CLI by packages/research/scripts/verify_planning_ready_mirror.py"
            ),
        },
        "observed_outcome": {
            "closure": closure,
            "revision_is_closure_revision": bool(
                closure and closure["issue_revision"] == revision["revision"]
            ),
            "superseded": next_revision is not None,
            "revision_transition": transition,
            "journal_after_revision": later_journal[:20],
            "work_receipt_count": receipts.get(issue["issue_id"], 0),
            "final_revision": revision["revision"] == issue["current_revision"],
        },
        "deterministic_refs": {
            "locators_resolve": locator_check,
            "locators_all_resolve": all(locator_check.values()) if locator_check else None,
        },
        "research_label": None,  # assigned by assign_label below
        "excluded_reason": None,
        "easy_negative": False,
    }
    if _excluded(text) or _excluded(issue["title"]):
        unit["excluded_reason"] = "credential-shaped text"
    return unit


def assign_label(unit: dict[str, Any]) -> dict[str, Any]:
    """The research label: source, method, value, confidence.

    Deliberately conservative. A unit with no independent evidence gets
    ``unlabelled`` with an abstention reason rather than a guessed value.
    """
    incumbent = unit["incumbent_state"]
    outcome = unit["observed_outcome"]
    finds = unit["deterministic"]["structural_findings"]
    attested = incumbent["attested_ready_this_revision"]
    closure = outcome["closure"] or {}

    if finds:
        return {
            "value": "not_ready",
            "source": "deterministic_structural",
            "method": "research mirror of validateContractStructure produced findings",
            "confidence": "high",
            "rationale": f"{len(finds)} structural finding(s)",
        }
    if attested and outcome["revision_is_closure_revision"] and closure.get("outcome") == "completed":
        return {
            "value": "ready",
            "source": "outcome_anchored",
            "method": "revision attested ready AND is the closure revision of a completed issue",
            "confidence": "high",
            "rationale": f"closure outcome {closure.get('outcome')}",
        }
    if attested and outcome["final_revision"] and unit["lifecycle_state"] == "done":
        return {
            "value": "ready",
            "source": "outcome_anchored",
            "method": "final revision of a completed issue carries a current ready attestation",
            "confidence": "medium",
            "rationale": "attested ready at the final revision of a done issue",
        }
    if not attested and outcome["superseded"] and not outcome["final_revision"]:
        return {
            "value": "not_ready",
            "source": "outcome_anchored",
            "method": "revision was replaced by a later revision before completion",
            "confidence": "medium",
            "rationale": "superseded revision",
        }
    if attested and not outcome["final_revision"]:
        return {
            "value": "not_ready",
            "source": "outcome_anchored",
            "method": "attested ready, then replaced by a later revision",
            "confidence": "low",
            "rationale": "attestation did not survive; the contract changed",
        }
    return {
        "value": "unlabelled",
        "source": "none",
        "method": "no independent evidence for this revision",
        "confidence": "none",
        "rationale": "open or unattested revision; needs adjudication for a label",
    }


def _normalized_title(title: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", title.lower()).strip()


def assign_split(unit: dict[str, Any]) -> dict[str, Any]:
    """Frozen split policy: grouped by work-item lineage, blocked by
    near-duplicate title cluster, and never mixed across the held-out repo.

    All revisions of one issue share a split (lineage grouping) and all issues
    sharing a normalized title share a split (near-duplicate blocking), so a
    later revision or a re-filed copy can never sit on the other side.
    """
    cluster = f"{unit['project_name']}::{_normalized_title(unit['title'])}"
    bucket = _stable_bucket(cluster)
    if unit["project_name"] == REPO_HOLDOUT:
        partition = "repo_holdout"
    elif bucket < 60:
        partition = "train"
    elif bucket < 80:
        partition = "calibration"
    else:
        partition = "test"
    return {"partition": partition, "cluster_key": cluster, "cluster_bucket": bucket}


def build(out: Path, db_path: Path, caps: dict[str, int]) -> dict[str, Any]:
    now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
    out.mkdir(parents=True, exist_ok=True)
    out.chmod(0o700)
    snapshot = snapshot_db(db_path, out)
    snapshot_hash = _sha256_file(snapshot)

    db = sqlite3.connect(f"file:{snapshot}?mode=ro", uri=True)
    try:
        issues = _issue_rows(db)
        revisions = _revision_rows(db, issues)
        attestations = _attestations(db)
        closures = _closures(db)
        journal = _journal(db)
        receipts = _receipts(db)
        lifecycle = {i["issue_id"]: i["lifecycle_state"] for i in issues.values()}
        blockers = _unsatisfied_blockers(db, lifecycle)
        claims = _active_claims(db, int(datetime.now(timezone.utc).timestamp() * 1000))
    finally:
        db.close()

    locator_index = {issue["locator"]: issue["issue_id"] for issue in issues.values()}
    checkouts = {p: Path(path) for p, path in CHECKOUTS.items()}

    by_issue: dict[str, list[dict[str, Any]]] = {}
    for revision in revisions:
        by_issue.setdefault(revision["issue_id"], []).append(revision)
    for rows in by_issue.values():
        rows.sort(key=lambda r: r["revision"])

    def make(issue: dict[str, Any], revision: dict[str, Any]) -> dict[str, Any]:
        rows = by_issue[issue["issue_id"]]
        position = rows.index(revision)
        nxt = rows[position + 1] if position + 1 < len(rows) else None
        unit = _unit(
            issue,
            revision,
            checkouts=checkouts,
            attestations=attestations,
            closures=closures,
            journal=journal,
            receipts=receipts,
            next_revision=nxt,
            locator_index=locator_index,
            blockers=blockers,
            claims=claims,
            now_ms=now_ms,
        )
        unit["research_label"] = assign_label(unit)
        unit["stratum"] = {
            "project": unit["project_name"],
            "lifecycle": unit["lifecycle_state"],
            "revision_count": len(rows),
            "contract_size_bucket": (
                "small" if unit["contract_chars"] < 800
                else "medium" if unit["contract_chars"] < 2400
                else "large"
            ),
            "has_attestation": unit["incumbent_state"]["attested_ready_this_revision"],
            "label_source": unit["research_label"]["source"],
        }
        unit["split"] = assign_split(unit)
        return unit

    selected: dict[str, dict[str, Any]] = {}
    counts: dict[str, int] = {}

    def add(unit: dict[str, Any], partition: str) -> None:
        if unit["excluded_reason"]:
            return
        key = unit["unit_id"]
        if key in selected:
            selected[key]["partitions"] = sorted(set(selected[key]["partitions"]) | {partition})
            return
        unit["partitions"] = [partition]
        selected[key] = unit

    # 1. deployment population: current revisions of open issues
    open_issues = sorted(
        (i for i in issues.values() if i["lifecycle_state"] == "open"),
        key=lambda i: hashlib.sha256(i["issue_id"].encode()).hexdigest(),
    )
    counts["open_population_total"] = len(open_issues)
    for issue in open_issues[: caps["open_current"]]:
        add(make(issue, by_issue[issue["issue_id"]][-1]), "open_current")

    # 2. natural revision transitions: (superseded revision, replacement) pairs
    multi = sorted(
        (i for i in issues.values() if len(by_issue.get(i["issue_id"], [])) > 1),
        key=lambda i: hashlib.sha256(i["issue_id"].encode()).hexdigest(),
    )
    counts["multi_revision_issues_total"] = len(multi)
    for issue in multi[: caps["transition"]]:
        rows = by_issue[issue["issue_id"]]
        add(make(issue, rows[-2]), "transition_weak")
        add(make(issue, rows[-1]), "transition_strong")

    # 3. completed, attested final revisions: outcome-anchored positives
    done_attested = sorted(
        (
            i
            for i in issues.values()
            if i["lifecycle_state"] == "done"
            and any(
                a["outcome"] == "ready"
                for a in attestations.get((i["issue_id"], i["current_revision"]), [])
            )
        ),
        key=lambda i: hashlib.sha256(i["issue_id"].encode()).hexdigest(),
    )
    counts["completed_attested_total"] = len(done_attested)
    for issue in done_attested[: caps["completed_attested"]]:
        add(make(issue, by_issue[issue["issue_id"]][-1]), "completed_attested")

    # 4. bounded easy-negative pool, flagged so it cannot dominate
    invalid = sorted(
        (
            i
            for i in issues.values()
            if contracts.structural_findings(by_issue[i["issue_id"]][-1]["contract"], scrutiny=i["scrutiny"])
        ),
        key=lambda i: hashlib.sha256(i["issue_id"].encode()).hexdigest(),
    )
    counts["structurally_invalid_total"] = len(invalid)
    for issue in invalid[: caps["easy_negative"]]:
        unit = make(issue, by_issue[issue["issue_id"]][-1])
        unit["easy_negative"] = True
        add(unit, "easy_negative")

    units = sorted(selected.values(), key=lambda u: u["unit_id"])
    return {
        "units": units,
        "snapshot_hash": snapshot_hash,
        "counts": counts,
        "issues": issues,
    }


def distributions(units: list[dict[str, Any]], issues: dict[str, dict[str, Any]]) -> dict[str, Any]:
    def _counts(key) -> dict[str, int]:
        return dict(sorted(Counter(key(u) for u in units).items()))

    return {
        "n_units": len(units),
        "n_issues": len({u["issue_id"] for u in units}),
        "n_revisions": len(units),
        "project": _counts(lambda u: u["project_name"]),
        "lifecycle": _counts(lambda u: u["lifecycle_state"]),
        "revision_count": _counts(lambda u: str(u["stratum"]["revision_count"])),
        "contract_size": _counts(lambda u: u["stratum"]["contract_size_bucket"]),
        "contract_chars": {
            "min": min((u["contract_chars"] for u in units), default=0),
            "median": sorted(u["contract_chars"] for u in units)[len(units) // 2] if units else 0,
            "max": max((u["contract_chars"] for u in units), default=0),
        },
        "incumbent_attested_ready": _counts(
            lambda u: str(u["incumbent_state"]["attested_ready_this_revision"])
        ),
        "label_value": _counts(lambda u: u["research_label"]["value"]),
        "label_source": _counts(lambda u: u["research_label"]["source"]),
        "label_confidence": _counts(lambda u: u["research_label"]["confidence"]),
        "partition": _counts(lambda u: u["split"]["partition"]),
        "partition_x_label": dict(
            sorted(
                Counter(f"{u['split']['partition']}::{u['research_label']['value']}" for u in units).items()
            )
        ),
        "easy_negative_by_partition": dict(
            sorted(Counter(u["split"]["partition"] for u in units if u["easy_negative"]).items())
        ),
        "structural_findings": _counts(lambda u: str(len(u["deterministic"]["structural_findings"]))),
        "path_checks": _counts(
            lambda u: "not_checked" if not u["deterministic"]["referenced_paths"]["checked"]
            else ("no_paths" if not u["deterministic"]["referenced_paths"]["paths"]
                  else ("all_exist" if not u["deterministic"]["referenced_paths"]["missing"] else "has_missing"))
        ),
        "locator_checks": _counts(
            lambda u: "none" if u["deterministic_refs"]["locators_all_resolve"] is None
            else str(u["deterministic_refs"]["locators_all_resolve"])
        ),
        "superseded": _counts(lambda u: str(u["observed_outcome"]["superseded"])),
        "closure_outcome": _counts(
            lambda u: (u["observed_outcome"]["closure"] or {}).get("outcome", "none")
        ),
    }


def readiness_summary(units: Sequence[dict[str, Any]]) -> dict[str, Any]:
    """Distribution of the incumbent's derived readiness over the frozen units,
    and how it relates to the research label. This is the incumbent baseline
    read-out; the independent CLI verification of the mirror lives in
    ``packages/research/scripts/verify_planning_ready_mirror.py``."""
    states = Counter(
        u["incumbent_state"]["derived_readiness"]["state"] for u in units
    )
    agreement = Counter(
        f"{u['incumbent_state']['derived_readiness']['state']}::"
        f"{u['research_label']['value']}"
        for u in units
    )
    return {
        "derived_state_counts": dict(sorted(states.items())),
        "derived_state_x_label": dict(sorted(agreement.items())),
        "dispatchable_units": sum(
            1 for u in units if u["incumbent_state"]["derived_readiness"]["dispatchable"]
        ),
        "attested_ready_this_revision": sum(
            1 for u in units if u["incumbent_state"]["attested_ready_this_revision"]
        ),
    }


def write_dataset(out: Path, units: list[dict[str, Any]], payload: dict[str, Any], readiness: dict[str, Any], caps: dict[str, int]) -> dict[str, Any]:
    units_path = out / "units.jsonl"
    with units_path.open("w", encoding="utf-8") as handle:
        for unit in units:
            handle.write(json.dumps(unit, sort_keys=True, ensure_ascii=False) + "\n")
    units_hash = _sha256_file(units_path)

    from xtrm_research.code_state import capture_code_state

    code_state = capture_code_state(Path(__file__).resolve().parents[3])
    manifest = {
        "dataset_id": "planning-ready-v2",
        "version": "v1",
        "created_at": _now(),
        "units_sha256": units_hash,
        "substrate_snapshot_sha256": payload["snapshot_hash"],
        "substrate_db": str(Path(DEFAULT_DB).expanduser()),
        "projects": list(PROJECTS),
        "selection": {
            "open_current": "current revision of every open issue, hash-ordered, capped",
            "transition": "last two revisions of issues with >1 revision (natural counterfactual pair)",
            "completed_attested": "final revision of done issues with a current ready attestation",
            "easy_negative": "bounded pool of structurally invalid current revisions, flagged",
        },
        "exclusions": [
            "contract text or title matching a credential pattern",
            "projects outside the five explicit XTRM development repositories",
        ],
        "caps": caps,
        "split_policy": {
            "grouping": "all revisions of one issue_id share a split (lineage grouping)",
            "near_duplicate_blocking": "issues sharing a normalized title share a split",
            "partition_rule": "sha256(cluster_key) mod 100: <60 train, <80 calibration, else test",
            "repo_holdout": REPO_HOLDOUT,
            "frozen": True,
        },
        "label_channels": {
            "incumbent_state": "per-revision attestation row only; live readiness fields attach to the current revision alone",
            "observed_outcome": "closure, supersession, journal and receipts; future information by construction",
            "research_label": "source + method + confidence; 'unlabelled' when no independent evidence exists",
        },
        "code_state": code_state,
        "checkout_provenance": _checkout_provenance({p: Path(path) for p, path in CHECKOUTS.items()}),
        "path_check_status": "advisory: a named path may legitimately not exist yet or exist only on another branch; never a readiness gate",
        "distributions": distributions(units, payload["issues"]),
        "incumbent_readiness": readiness,
        "deterministic_mirror_verification": (
            "packages/research/scripts/verify_planning_ready_mirror.py re-derives the deterministic "
            "findings and the derived readiness state through the sb CLI for the sampled current "
            "revisions and writes the agreement report beside this manifest"
        ),
        "counts": payload["counts"],
    }
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return manifest


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="planning_ready.dataset")
    sub = parser.add_subparsers(dest="command", required=True)
    build_parser = sub.add_parser("build")
    build_parser.add_argument("--out", required=True)
    build_parser.add_argument("--db", default=DEFAULT_DB)
    build_parser.add_argument("--cap", type=int, default=None, help="override every partition cap")
    args = parser.parse_args(argv)

    caps = dict(CAPS)
    if args.cap is not None:
        caps = {key: args.cap for key in caps}
    out = Path(args.out).expanduser()
    payload = build(out, Path(args.db).expanduser(), caps)
    units = payload["units"]
    manifest = write_dataset(out, units, payload, readiness_summary(units), caps)
    print(json.dumps(manifest["distributions"], indent=2, sort_keys=True))
    print(json.dumps({"counts": manifest["counts"], "incumbent_readiness": manifest["incumbent_readiness"]}, indent=2))
    print(f"wrote {len(units)} units to {out} ({manifest['units_sha256']})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
