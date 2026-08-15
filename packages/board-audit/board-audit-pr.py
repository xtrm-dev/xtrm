#!/usr/bin/env python3
"""PR-checkpoint Board-Audit handoffs.

Implements the PR-checkpoint handoff publication contract: when repository work
reaches a Git/PR delivery event, one complete, coherent Board-Audit evidence
sidecar is published on a dedicated ``board-audit/pr-<number>`` transport
branch without modifying the caller's implementation worktree and without
coupling to any XTRM session lifecycle command.

The publication pipeline:

    receive checkpoint event
    → fetch relevant Git refs
    → verify PR and implementation head (remote authority via gh)
    → confidentiality policy check (automation fails closed)
    → create isolated Beads-managed worktree (transport policy)
    → acquire one canonical bd export --all snapshot
    → derive per-Bead read projection + handoff metadata + index
    → incremental write (unchanged canonical records are preserved)
    → NO_CHANGES when membership, issue hashes and PR head are unchanged
    → publish transport branch (exact force-with-lease)
    → seal commit records the exact published transport SHA
    → verify remote transport SHA
    → remove isolated worktree
    → return receipt

The per-Bead projection under ``.xtrm/board-audit/snapshots/**`` is a read
model only. Web-originated mutation continues to use the existing bounded
``desired_issues`` / ``new_comments`` round-trip contract followed by local
``reconcile`` and explicit authorized ``reconcile --execute``.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import sys
import tempfile
from typing import Any

HERE = Path(__file__).resolve().parent
TRANSPORT_IMPL = HERE / "board-audit-transport.py"

spec = importlib.util.spec_from_file_location("board_audit_pr_transport", TRANSPORT_IMPL)
if spec is None or spec.loader is None:
    raise RuntimeError(f"cannot load board-audit transport policy: {TRANSPORT_IMPL}")
transport = importlib.util.module_from_spec(spec)
spec.loader.exec_module(transport)

# The transport module patches the generic flow with its lease/hook/CI policy.
flow = transport.flow

HANDOFF_SCHEMA = "xtrm.board-audit.pr-handoff.v1"
PROJECTION_SCHEMA = "xtrm.board-audit.pr-projection.v1"
ROOT_SCHEMA = "xtrm.board-audit.pr-root.v1"
SNAPSHOT_MANIFEST_SCHEMA = "xtrm.board-audit.pr-snapshot-manifest.v1"
TERMINAL = {"closed", "done", "completed", "cancelled", "canceled", "tombstone", "deleted"}
PARENT_TYPES = {"parent-child", "parent", "child-of"}

# Failure classes from the PR-checkpoint contract.
PR_NOT_RESOLVED = "PR_NOT_RESOLVED"
REMOTE_HEAD_MISMATCH = "REMOTE_HEAD_MISMATCH"
BEADS_UNAVAILABLE = "BEADS_UNAVAILABLE"
SNAPSHOT_FAILED = "SNAPSHOT_FAILED"
TRANSPORT_CONFLICT = "TRANSPORT_CONFLICT"
TRANSPORT_PUSH_FAILED = "TRANSPORT_PUSH_FAILED"
TRANSPORT_VERIFY_FAILED = "TRANSPORT_VERIFY_FAILED"
CLEANUP_BLOCKED = "CLEANUP_BLOCKED"
CONFIDENTIALITY_BLOCKED = "CONFIDENTIALITY_BLOCKED"


class PRCheckpointError(flow.FlowError):
    """Board-audit PR-checkpoint failure carrying a contract failure class."""

    def __init__(self, kind: str, message: str) -> None:
        super().__init__(message)
        self.kind = kind

    def __str__(self) -> str:
        return f"{self.kind}: {super().__str__()}"


def utcnow() -> str:
    return flow.utcnow()


def canonical_bytes(obj: Any) -> bytes:
    return (json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")


def canonical_sha256(obj: Any) -> str:
    return hashlib.sha256(canonical_bytes(obj)).hexdigest()


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


# ---------------------------------------------------------------------------
# PR resolution and remote verification
# ---------------------------------------------------------------------------

def repo_slug(repo: Path) -> str:
    """Derive the owner/repo slug from the origin URL without needing gh."""
    url = flow.git_output(repo, "remote", "get-url", "origin")
    match = re.search(r"(?:github\.com[:/])([^/]+)/([^/.]+)(?:\.git)?$", url.strip())
    if match:
        return f"{match.group(1)}/{match.group(2)}"
    return flow.git_output(repo, "rev-parse", "--show-toplevel").rsplit("/", 1)[-1]


def resolve_pr_number(repo: Path, argument: str | None) -> int:
    """Resolve the PR number from the argument or the current branch."""
    if argument:
        if not re.fullmatch(r"[0-9]+", argument):
            raise PRCheckpointError(PR_NOT_RESOLVED, f"invalid pull request number {argument!r}")
        return int(argument)
    try:
        pr = flow.run(["gh", "pr", "view", "--json", "number", "--jq", ".number"], cwd=repo, capture=True).stdout.strip()
    except flow.FlowError as exc:
        raise PRCheckpointError(PR_NOT_RESOLVED, f"cannot resolve pull request for current branch: {exc}") from exc
    if not pr or not re.fullmatch(r"[0-9]+", pr):
        raise PRCheckpointError(PR_NOT_RESOLVED, "no open pull request for current branch")
    return int(pr)


def fetch_pr_info(repo: Path, pr: int) -> dict[str, Any]:
    """Fetch the remote PR identity (authoritative) through gh.

    ``BOARD_AUDIT_PR_JSON`` may point at a file containing the same JSON shape
    so integration tests can substitute a fake remote without gh.
    """
    override_raw = os.environ.get("BOARD_AUDIT_PR_JSON", "")
    if override_raw:
        override = Path(override_raw)
        if override.exists():
            data = json.loads(override.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                return data
    fields = "number,title,state,headRefName,headRefOid,baseRefName,url"
    try:
        out = flow.run(
            ["gh", "pr", "view", str(pr), "--json", fields, "--jq", "."],
            cwd=repo,
            capture=True,
        ).stdout
    except flow.FlowError as exc:
        raise PRCheckpointError(PR_NOT_RESOLVED, f"cannot resolve pull request #{pr}: {exc}") from exc
    try:
        data = json.loads(out)
    except json.JSONDecodeError as exc:
        raise PRCheckpointError(PR_NOT_RESOLVED, f"invalid gh output for pull request #{pr}: {exc}") from exc
    if not isinstance(data, dict):
        raise PRCheckpointError(PR_NOT_RESOLVED, f"invalid gh output for pull request #{pr}")
    return data


def verify_remote_head(repo: Path, info: dict[str, Any]) -> None:
    """Prove the implementation branch on the remote carries the PR head.

    ``gh pr view`` reports the remote PR head. We additionally fetch the exact
    implementation branch and require the fetched head to match, so a handoff
    is never claimed current against a code head that was not verified remote.
    """
    head_ref = str(info.get("headRefName") or "")
    head_oid = str(info.get("headRefOid") or "")
    if not head_ref or not head_oid or not re.fullmatch(r"[0-9a-f]{40}", head_oid):
        raise PRCheckpointError(PR_NOT_RESOLVED, f"pull request has no valid remote head ({head_ref} {head_oid})")
    try:
        flow.run(["git", "fetch", "origin", head_ref], cwd=repo)
    except flow.FlowError as exc:
        raise PRCheckpointError(REMOTE_HEAD_MISMATCH, f"cannot fetch implementation branch {head_ref!r}: {exc}") from exc
    try:
        remote_head = flow.git_output(repo, "rev-parse", "FETCH_HEAD")
    except flow.FlowError as exc:
        raise PRCheckpointError(REMOTE_HEAD_MISMATCH, f"cannot resolve fetched head for {head_ref!r}: {exc}") from exc
    if remote_head != head_oid:
        raise PRCheckpointError(
            REMOTE_HEAD_MISMATCH,
            f"remote PR head mismatch: gh reports {head_oid}, fetched {head_ref!r} is {remote_head}",
        )


def check_confidentiality(slug: str, trigger: str) -> None:
    """Fail closed when automation publishes lossless evidence to a non-authorized repo.

    Manual invocation (no trigger marker) publishes by operator choice. Any
    automated trigger (``BOARD_AUDIT_PR_TRIGGER`` set to ``auto``/``hook`` or
    the ``--trigger auto|hook`` flag) requires the repository slug to be listed
    in ``BOARD_AUDIT_PR_AUTHORIZED_REPOS`` (comma-separated ``owner/repo`` or
    ``*`` entries).
    """
    if trigger not in ("auto", "hook"):
        return
    allowlist = [entry.strip() for entry in os.environ.get("BOARD_AUDIT_PR_AUTHORIZED_REPOS", "").split(",") if entry.strip()]
    if any(entry in ("*", slug) for entry in allowlist):
        return
    raise PRCheckpointError(
        CONFIDENTIALITY_BLOCKED,
        f"automated publication not authorized for repository {slug}; "
        "set BOARD_AUDIT_PR_AUTHORIZED_REPOS to allow lossless evidence publication",
    )


# ---------------------------------------------------------------------------
# Snapshot builder (one canonical bd export --all acquisition)
# ---------------------------------------------------------------------------

def read_rows(raw_path: Path) -> list[dict[str, Any]]:
    text = raw_path.read_text(encoding="utf-8").strip()
    if not text:
        return []
    if text.startswith("[") or text.startswith("{"):
        try:
            parsed = json.loads(text)
            if isinstance(parsed, list):
                return [r for r in parsed if isinstance(r, dict)]
            if isinstance(parsed, dict):
                for key in ("issues", "beads", "records"):
                    if isinstance(parsed.get(key), list):
                        return [r for r in parsed[key] if isinstance(r, dict)]
                return [parsed]
        except json.JSONDecodeError:
            pass
    rows = []
    for line in text.splitlines():
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError as exc:
            raise PRCheckpointError(
                SNAPSHOT_FAILED,
                f"bd export --all produced a corrupt record line: {exc}",
            ) from exc
        if isinstance(row, dict):
            rows.append(row)
    return rows


def entity_id(value: Any) -> str | None:
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        for key in ("id", "issue_id", "bead_id", "parent_id", "target_id", "target"):
            candidate = value.get(key)
            if isinstance(candidate, str) and candidate:
                return candidate
    return None


def dependency_target(value: Any) -> str | None:
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        for key in ("depends_on_id", "depends_on_issue_id", "target_id", "target", "parent_id", "bead_id"):
            candidate = value.get(key)
            if isinstance(candidate, str) and candidate:
                return candidate
    return None


def relation_type(value: Any) -> str:
    if not isinstance(value, dict):
        return "unknown"
    return str(value.get("type") or value.get("dependency_type") or value.get("relation_type") or value.get("kind") or "unknown")


def relation_targets(row: dict[str, Any]) -> list[tuple[str, str]]:
    """Deterministic (target, type) edge list for a row's outgoing relations."""
    out: list[tuple[str, str]] = []
    for key in ("deps", "dependencies", "relations"):
        vals = row.get(key)
        if not isinstance(vals, list):
            continue
        for value in vals:
            target = dependency_target(value)
            if target:
                out.append((target, relation_type(value)))
    for key in ("parents", "parent"):
        vals = row.get(key)
        if vals is None:
            continue
        if not isinstance(vals, list):
            vals = [vals]
        for value in vals:
            target = entity_id(value)
            if target:
                typ = relation_type(value)
                out.append((target, typ if typ != "unknown" else "parent-child"))
    discovered = row.get("discovered_from")
    if discovered:
        vals = discovered if isinstance(discovered, list) else [discovered]
        for value in vals:
            target = entity_id(value)
            if target:
                out.append((target, "discovered-from"))
    return out


def explicit_parent_ids(row: dict[str, Any]) -> list[str]:
    out: list[str] = []
    for key in ("parents", "parent"):
        vals = row.get(key)
        if vals is None:
            continue
        if not isinstance(vals, list):
            vals = [vals]
        for value in vals:
            parent = entity_id(value)
            if parent and parent not in out:
                out.append(parent)
    for target, typ in relation_targets(row):
        if typ in PARENT_TYPES and target not in out:
            out.append(target)
    return out


def is_terminal(row: dict[str, Any]) -> bool:
    return str(row.get("status", "")).lower() in TERMINAL


def build_tree(rows: list[dict[str, Any]]) -> tuple[dict[str, dict[str, Any]], dict[str, list[str]]]:
    """Return (by_id, parents) mirroring Beads' own tree semantics.

    Explicit parent-child edges win; dotted-ID ancestry is the fallback when
    no explicit parent resolves inside the snapshot.
    """
    by_id = {str(row["id"]): row for row in rows if row.get("id") is not None}
    parents: dict[str, list[str]] = {}
    for rid, row in by_id.items():
        ps = [p for p in explicit_parent_ids(row) if p != rid]
        known_explicit = [p for p in ps if p in by_id]
        if not known_explicit and "." in rid:
            dotted_parent = rid.rsplit(".", 1)[0]
            if dotted_parent in by_id and dotted_parent != rid and dotted_parent not in ps:
                ps.append(dotted_parent)
        parents[rid] = ps
    return by_id, parents


def highest_known_root(rid: str, parents: dict[str, list[str]], by_id: dict[str, dict[str, Any]]) -> str:
    current = rid
    seen = {rid}
    while True:
        known = sorted(p for p in parents.get(current, []) if p in by_id and p not in seen)
        if not known:
            return current
        current = known[0]
        seen.add(current)


def compute_snapshot(
    raw_path: Path,
    repository: str,
    bd_version: str,
    generated_at: str,
) -> dict[str, Any]:
    """Build the per-Bead read projection from one raw acquisition.

    Returns ``{snapshot_id, raw_sha256, open_ids, roots, root_of, files,
    manifest}`` where every file is deterministic: identical Beads state
    produces identical bytes, so unchanged records are never rewritten across
    checkpoints.
    """
    rows = read_rows(raw_path)
    by_id, parents = build_tree(rows)
    open_ids = sorted(rid for rid, row in by_id.items() if not is_terminal(row))

    root_of: dict[str, str] = {}
    subtree: dict[str, list[str]] = {}
    for rid in open_ids:
        root = highest_known_root(rid, parents, by_id)
        root_of[rid] = root
        subtree.setdefault(root, []).append(rid)

    projections: dict[str, dict[str, Any]] = {}
    for rid in open_ids:
        row = by_id[rid]
        source_sha = canonical_sha256(row)
        deps = sorted((target, typ) for target, typ in relation_targets(row))
        projections[rid] = {
            "schema_version": PROJECTION_SCHEMA,
            "bead_id": rid,
            "source": row,
            "navigation": {
                "root": root_of[rid],
                "parents": sorted(p for p in parents.get(rid, []) if p in by_id),
                "dependencies": deps,
                "status": str(row.get("status", "")),
                "priority": row.get("priority"),
                "owner": row.get("owner"),
                "source_sha256": source_sha,
            },
        }

    raw_sha = sha256_file(raw_path)
    # The snapshot identity is content-derived: membership, roots and every
    # open record hash. Identical boards resolve to the identical snapshot id.
    identity_payload = {
        "roots": sorted(subtree),
        "open": [(rid, projections[rid]["navigation"]["source_sha256"]) for rid in open_ids],
    }
    snapshot_id = canonical_sha256(identity_payload)

    files: dict[str, bytes] = {}
    for rid in open_ids:
        files[f"snapshots/{snapshot_id}/issues/{rid}.json"] = canonical_bytes(projections[rid])
    for root in sorted(subtree):
        files[f"snapshots/{snapshot_id}/roots/{root}.json"] = canonical_bytes({
            "schema_version": ROOT_SCHEMA,
            "root_id": root,
            "title": by_id.get(root, {}).get("title"),
            "issue_ids": sorted(subtree[root]),
            "open_issue_count": len(subtree[root]),
            "source_sha256": canonical_sha256(by_id[root]) if root in by_id else None,
        })

    file_hashes = {rel: hashlib.sha256(content).hexdigest() for rel, content in sorted(files.items())}
    manifest = {
        "schema_version": SNAPSHOT_MANIFEST_SCHEMA,
        "snapshot_id": snapshot_id,
        "generated_at": generated_at,
        "repository": repository,
        "bd_version": bd_version,
        "source": {
            "command": "bd export --all",
            "raw_file": "raw-beads.jsonl",
            "raw_sha256": raw_sha,
            "raw_record_count": len(by_id),
        },
        "selection": {
            "open_record_count": len(open_ids),
            "root_count": len(subtree),
        },
        "files": file_hashes,
    }
    files[f"snapshots/{snapshot_id}/manifest.json"] = canonical_bytes(manifest)

    return {
        "snapshot_id": snapshot_id,
        "raw_sha256": raw_sha,
        "open_ids": open_ids,
        "roots": sorted(subtree),
        "root_of": root_of,
        "files": files,
        "manifest": manifest,
    }


# ---------------------------------------------------------------------------
# Projection publication
# ---------------------------------------------------------------------------

def board_audit_dir(worktree: Path) -> Path:
    return worktree / ".xtrm" / "board-audit"


def load_previous_handoff(worktree: Path, pr: int) -> dict[str, Any] | None:
    path = board_audit_dir(worktree) / "handoffs" / f"pr-{pr}.json"
    if not path.exists():
        return None
    data = flow.read_json(path)
    if data.get("schema_version") != HANDOFF_SCHEMA:
        raise PRCheckpointError(SNAPSHOT_FAILED, f"unsupported handoff schema on transport branch: {data.get('schema_version')!r}")
    return data


def build_index(
    worktree: Path,
    snapshot: dict[str, Any],
    pr: int,
    info: dict[str, Any],
    generated_at: str,
) -> dict[str, Any]:
    """Extend the shared index with the open projection and PR checkpoint.

    ``open_issues`` is the deterministic per-Bead addressability surface: every
    open bead maps to the exact projection file inside the current snapshot.
    """
    index = flow.load_index(worktree)
    open_issues: dict[str, dict[str, Any]] = {}
    for rid in snapshot["open_ids"]:
        relpath = f"snapshots/{snapshot['snapshot_id']}/issues/{rid}.json"
        projection = json.loads(snapshot["files"][relpath].decode("utf-8"))
        open_issues[rid] = {
            "snapshot_id": snapshot["snapshot_id"],
            "file": relpath,
            "root_id": snapshot["root_of"][rid],
            "state": "open",
            "source_sha256": projection["navigation"]["source_sha256"],
        }
    index["open_issues"] = open_issues
    checkpoints = index.setdefault("pr_checkpoints", {})
    checkpoints[str(pr)] = {
        "state": "prepared",
        "branch": f"board-audit/pr-{pr}",
        "handoff": f"handoffs/pr-{pr}.json",
        "implementation_head_sha": str(info.get("headRefOid", "")),
        "snapshot_id": snapshot["snapshot_id"],
        "updated_at": generated_at,
    }
    return index


def handoff_payload(
    repository: str,
    pr: int,
    info: dict[str, Any],
    snapshot: dict[str, Any],
    generated_at: str,
) -> dict[str, Any]:
    return {
        "schema_version": HANDOFF_SCHEMA,
        "repository": repository,
        "pull_request": pr,
        "implementation_branch": str(info.get("headRefName", "")),
        "implementation_head_sha": str(info.get("headRefOid", "")),
        "beads_root_ids": snapshot["roots"],
        "snapshot_id": snapshot["snapshot_id"],
        # Digest of the one canonical bd export --all acquisition backing this
        # snapshot (the manifest records the same value as raw_sha256).
        "snapshot_sha256": snapshot["raw_sha256"],
        "generated_at": generated_at,
        "transport_branch": f"board-audit/pr-{pr}",
        "transport_head_sha": None,  # sealed after the artifacts commit
        "state": "prepared",
        "open_issue_count": len(snapshot["open_ids"]),
        "index": ".xtrm/board-audit/index.json",
        "handoff": f".xtrm/board-audit/handoffs/pr-{pr}.json",
    }


def locator_block(handoff: dict[str, Any]) -> str:
    return (
        "Board-Audit Handoff\n"
        f"PR: #{handoff['pull_request']}\n"
        f"Code head: {handoff['implementation_head_sha']}\n"
        f"Beads root: {', '.join(handoff['beads_root_ids']) if handoff['beads_root_ids'] else '(none)'}\n"
        f"Transport: {handoff['transport_branch']}\n"
        f"Snapshot: {handoff['snapshot_id']}\n"
        f"Generated: {handoff['generated_at']}\n"
        f"State: {handoff['state']}\n"
        f"Index: {handoff['index']}\n"
        f"PR handoff: {handoff['handoff']}\n"
    )


def write_projection(worktree: Path, snapshot: dict[str, Any]) -> list[Path]:
    """Write changed projection files, preserving unchanged records.

    A file whose content already matches the previously published projection
    (restored from the transport branch) is preserved untouched. Stale snapshot
    directories from earlier identities are removed so the committed tree
    carries exactly one current snapshot.
    """
    base = board_audit_dir(worktree)
    written: list[Path] = []
    for relpath, content in snapshot["files"].items():
        target = base / relpath
        if target.exists() and target.read_bytes() == content:
            continue  # unchanged record: preserve the published projection
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
        written.append(target)

    snapshots_dir = base / "snapshots"
    if snapshots_dir.exists():
        for candidate in snapshots_dir.iterdir():
            if candidate.is_dir() and candidate.name != snapshot["snapshot_id"]:
                shutil.rmtree(candidate)
    return written


def cmd_pr_checkpoint(args: argparse.Namespace) -> int:
    flow.require_commands("git", "bd", "python3", "gh")
    repo = flow.repo_root()
    original_branch = flow.git_output(repo, "branch", "--show-current") or "(detached)"
    trigger = args.trigger or os.environ.get("BOARD_AUDIT_PR_TRIGGER", "manual")

    pr = resolve_pr_number(repo, args.pr_number)
    info = fetch_pr_info(repo, pr)
    state = str(info.get("state", "")).lower()
    if state != "open":
        raise PRCheckpointError(PR_NOT_RESOLVED, f"pull request #{pr} is not open (state={state})")
    slug = repo_slug(repo)
    check_confidentiality(slug, trigger)
    verify_remote_head(repo, info)

    identity = f"pr-{pr}"
    remote_branch = f"board-audit/pr-{pr}"
    generated_at = utcnow()

    worktree: Path | None = None
    staging = ""
    no_changes = False
    handoff: dict[str, Any] | None = None
    head_after_push = ""
    keep = False
    try:
        worktree, staging, _ = transport.start_transport_worktree(repo, identity, remote_branch=remote_branch)
        previous = load_previous_handoff(worktree, pr)

        # The raw acquisition lives outside the worktree (cache dir) so the
        # isolated checkout stays clean for bd worktree remove; it is retained
        # on failure as recovery evidence and removed after a successful run.
        raw = worktree.parent / f"{identity}-{os.getpid()}.raw.jsonl"
        try:
            flow.run(["bd", "export", "--all", "-o", str(raw)], cwd=worktree)
        except flow.FlowError as exc:
            raise PRCheckpointError(BEADS_UNAVAILABLE, f"bd export --all failed: {exc}") from exc
        if not raw.exists() or raw.stat().st_size == 0:
            print("warning: Beads export is empty; publishing an empty open projection", file=sys.stderr)
        try:
            bd_version = flow.run(["bd", "version"], cwd=worktree, capture=True).stdout.strip().splitlines()[0]
        except flow.FlowError:
            bd_version = "unknown"

        snapshot = compute_snapshot(raw, slug, bd_version, generated_at)
        # The projection files inside the worktree already carry lossless
        # source records; the raw acquisition is no longer needed and keeping
        # the checkout clean is what allows bd worktree remove to succeed.
        if raw.exists():
            raw.unlink()

        # NO_CHANGES: membership, issue hashes and PR head are unchanged.
        if (
            previous is not None
            and str(previous.get("implementation_head_sha", "")) == str(info.get("headRefOid", ""))
            and str(previous.get("snapshot_id", "")) == snapshot["snapshot_id"]
        ):
            no_changes = True
            print(f"NO_CHANGES: PR #{pr} handoff is already current")
            print(f"  snapshot: {snapshot['snapshot_id']}")
            print(f"  head:     {info.get('headRefOid')}")
            return 0

        # Committed evidence tree. transport_head_sha is sealed after the
        # artifacts commit so the recorded SHA is an exact published transport
        # SHA; the seal commit then becomes the branch head.
        handoff = handoff_payload(slug, pr, info, snapshot, generated_at)
        index = build_index(worktree, snapshot, pr, info, generated_at)
        write_projection(worktree, snapshot)

        handoff_path = board_audit_dir(worktree) / "handoffs" / f"pr-{pr}.json"
        handoff_path.parent.mkdir(parents=True, exist_ok=True)
        flow.write_json(handoff_path, handoff)
        index_path = board_audit_dir(worktree) / "index.json"
        flow.write_json(index_path, index)
        snapshots_path = board_audit_dir(worktree) / "snapshots"

        try:
            transport.commit_transport(
                worktree,
                paths=[snapshots_path, index_path, handoff_path],
                message=f"chore(board-audit): pr #{pr} checkpoint",
            )
        except flow.FlowError as exc:
            raise PRCheckpointError(TRANSPORT_PUSH_FAILED, f"transport commit failed: {exc}") from exc

        artifacts_sha = flow.git_output(worktree, "rev-parse", "HEAD")
        handoff["transport_head_sha"] = artifacts_sha
        flow.write_json(handoff_path, handoff)
        try:
            transport.commit_transport(
                worktree,
                paths=[handoff_path],
                message=f"chore(board-audit): seal pr #{pr} transport head",
            )
        except flow.FlowError as exc:
            raise PRCheckpointError(TRANSPORT_PUSH_FAILED, f"transport seal commit failed: {exc}") from exc

        # The lease is popped inside push_transport, so capture whether a
        # concurrent-update guard was armed before the push attempt: a failure
        # with a lease held is a remote race (TRANSPORT_CONFLICT).
        had_lease = remote_branch in transport._HANDOFF_LEASES
        try:
            transport.push_transport(worktree, remote_branch=remote_branch)
        except flow.FlowError as exc:
            kind = TRANSPORT_CONFLICT if had_lease else TRANSPORT_PUSH_FAILED
            raise PRCheckpointError(kind, f"transport push failed: {exc}") from exc

        head_after_push = flow.git_output(worktree, "rev-parse", "HEAD")
        if args.comment:
            tmp_path: str | None = None
            try:
                with tempfile.NamedTemporaryFile("w", encoding="utf-8", delete=False) as tmp:
                    tmp.write(locator_block(handoff))
                    tmp_path = tmp.name
                flow.run(["gh", "pr", "comment", str(pr), "--body-file", tmp_path], cwd=worktree)
            except flow.FlowError as exc:
                print(f"warning: could not post PR comment: {exc}", file=sys.stderr)
            finally:
                if tmp_path is not None:
                    os.unlink(tmp_path)
    except PRCheckpointError:
        keep = True
        raise
    except flow.FlowError as exc:
        keep = True
        raise PRCheckpointError(CLEANUP_BLOCKED, f"checkpoint failed: {exc}") from exc
    finally:
        if worktree is not None and staging:
            if keep:
                transport.cleanup_transport_worktree(repo, worktree, staging, keep_on_error=True)
            elif no_changes:
                # Nothing was committed. The transport-branch restore staged
                # the previous artifacts into the index; discard them so the
                # untouched staging worktree matches HEAD exactly. Real bd
                # worktree removal refuses branches without a resolvable
                # upstream, so point the staging branch at the origin default
                # (HEAD equals it: the branch was created from it).
                flow.run(["git", "reset", "-q"], cwd=worktree)
                flow.run(
                    ["git", "clean", "-fdx", "--", ".xtrm/board-audit"],
                    cwd=worktree,
                )
                flow.run(
                    ["git", "branch", "--set-upstream-to", flow.default_remote_ref(repo), staging],
                    cwd=repo,
                )
                # flow.cleanup_transport_worktree is the transport-patched
                # version; the raw base implementation is preserved separately.
                transport._BASE_CLEANUP_TRANSPORT_WORKTREE(
                    repo,
                    worktree,
                    staging,
                    keep_on_error=False,
                )
            else:
                # Verification of the exact remote transport SHA happens here;
                # a mismatch is a failed publication and retains recovery state.
                try:
                    transport.cleanup_transport_worktree(repo, worktree, staging, keep_on_error=False)
                except flow.FlowError as exc:
                    raise PRCheckpointError(TRANSPORT_VERIFY_FAILED, f"transport verification/cleanup failed: {exc}") from exc

    assert handoff is not None
    print(f"✓ PR #{pr} checkpoint published")
    print(f"  branch:   {remote_branch}")
    print(f"  head:     {info.get('headRefOid')}")
    print(f"  snapshot: {snapshot['snapshot_id']}")
    print(f"  transport:{head_after_push}")
    print(f"  checkout: unchanged ({original_branch})")
    print()
    print(locator_block(handoff), end="")
    return 0


def cmd_pr_status(args: argparse.Namespace) -> int:
    """Report handoff freshness against the live remote PR head."""
    flow.require_commands("git", "gh")
    repo = flow.repo_root()
    pr = resolve_pr_number(repo, args.pr_number)
    info = fetch_pr_info(repo, pr)

    flow.run(["git", "fetch", "origin"], cwd=repo)
    branch = f"board-audit/pr-{pr}"
    handoff_rel = f".xtrm/board-audit/handoffs/pr-{pr}.json"
    proc = flow.run(
        ["git", "cat-file", "-e", f"origin/{branch}:{handoff_rel}"],
        cwd=repo,
        check=False,
    )
    if proc.returncode != 0:
        print(f"STATUS: NO_HANDOFF (PR #{pr})")
        return 3 if args.check else 0

    text = flow.git_output(repo, "show", f"origin/{branch}:{handoff_rel}")
    try:
        handoff = json.loads(text)
    except json.JSONDecodeError as exc:
        print(f"STATUS: CORRUPT_HANDOFF (PR #{pr}: {exc})")
        return 3 if args.check else 0

    head_oid = str(info.get("headRefOid", ""))
    current_head = head_oid == str(handoff.get("implementation_head_sha", ""))
    snapshot_id = str(handoff.get("snapshot_id", ""))
    # The snapshot is current only when its manifest actually resolves on the
    # transport branch; a missing snapshot directory is a stale/broken handoff.
    current_snapshot = False
    if snapshot_id:
        manifest_rel = f".xtrm/board-audit/snapshots/{snapshot_id}/manifest.json"
        current_snapshot = (
            flow.run(
                ["git", "cat-file", "-e", f"origin/{branch}:{manifest_rel}"],
                cwd=repo,
                check=False,
            ).returncode
            == 0
        )
    if current_head and current_snapshot:
        status = "FRESH"
    elif not current_head:
        status = "STALE_CODE_HEAD"
    else:
        status = "STALE_SNAPSHOT"

    print(f"STATUS: {status} (PR #{pr})")
    print(locator_block(handoff), end="")
    print(f"Live head: {head_oid}")
    if not current_head:
        print(f"Handoff head: {handoff.get('implementation_head_sha')}")
    if args.check and status != "FRESH":
        return 3
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="board-audit pr",
        description="PR-checkpoint Board-Audit handoffs: per-Bead evidence projection bound to an exact PR head.",
    )
    sub = parser.add_subparsers(dest="command")

    checkpoint = sub.add_parser("pr-checkpoint", help="publish/refresh a PR-checkpoint handoff for the exact remote PR head")
    checkpoint.add_argument("pr_number", nargs="?", help="pull request number; default: current branch's PR")
    checkpoint.add_argument("--comment", action="store_true", help="post/update the compact Board-Audit locator as a PR comment")
    checkpoint.add_argument("--trigger", choices=["manual", "auto", "hook"], default=None, help="publication trigger class; auto/hook fail closed without BOARD_AUDIT_PR_AUTHORIZED_REPOS")
    checkpoint.set_defaults(func=cmd_pr_checkpoint)

    status = sub.add_parser("pr-status", help="report handoff freshness (FRESH / STALE_CODE_HEAD / STALE_SNAPSHOT / NO_HANDOFF)")
    status.add_argument("pr_number", nargs="?", help="pull request number; default: current branch's PR")
    status.add_argument("--check", action="store_true", help="exit 3 when the handoff is not FRESH")
    status.set_defaults(func=cmd_pr_status)
    return parser


def main(argv: list[str] | None = None) -> int:
    try:
        parser = build_parser()
        args = parser.parse_args(argv)
        if not getattr(args, "command", None):
            parser.print_help()
            return 0
        return int(args.func(args))
    except PRCheckpointError as exc:
        print(f"FAILURE: {exc}", file=sys.stderr)
        return 2
    except flow.FlowError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
