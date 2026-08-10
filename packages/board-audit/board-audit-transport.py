#!/usr/bin/env python3
"""Transport-branch freshness policy for board-audit handoff/reconcile.

The generic high-level flow lives in ``board-audit-flow.py``. This shim keeps
transport branches as artifact branches rooted on the current origin default
branch instead of letting them accumulate stale code history. Existing
``.xtrm/board-audit/**`` artifacts are restored from the previous transport
branch, and the rewritten transport branch is pushed with an exact
``--force-with-lease`` guard.
"""
from __future__ import annotations

import importlib.util
from pathlib import Path
import sys
from typing import Any


HERE = Path(__file__).resolve().parent
FLOW_IMPL = HERE / "board-audit-flow.py"

spec = importlib.util.spec_from_file_location("board_audit_flow_impl", FLOW_IMPL)
if spec is None or spec.loader is None:
    raise RuntimeError(f"cannot load board-audit flow implementation: {FLOW_IMPL}")
flow = importlib.util.module_from_spec(spec)
spec.loader.exec_module(flow)

# Each CLI invocation is one process. A lease recorded here belongs only to the
# handoff started in that process; reconcile --execute therefore falls back to a
# normal fast-forward push from the fetched transport head.
_HANDOFF_LEASES: dict[str, str | None] = {}


def _transport_artifacts_exist(repo: Path, remote_branch: str) -> bool:
    return (
        flow.run(
            [
                "git",
                "cat-file",
                "-e",
                f"origin/{remote_branch}:.xtrm/board-audit",
            ],
            cwd=repo,
            check=False,
        ).returncode
        == 0
    )


def start_transport_worktree(repo: Path, bead_id: str) -> tuple[Path, str, str]:
    """Start handoff from current origin default while preserving artifacts.

    If a transport branch already exists we capture its exact remote SHA for a
    later lease-protected rewrite, then restore only the interchange tree into
    a staging branch rooted at current origin/main (or origin/HEAD).
    """
    flow.run(["git", "fetch", "origin"], cwd=repo)
    remote_branch = flow.transport_branch(bead_id)
    remote_ref = f"refs/remotes/origin/{remote_branch}"

    previous_sha: str | None = None
    if flow.remote_ref_exists(repo, remote_ref):
        previous_sha = flow.git_output(repo, "rev-parse", f"origin/{remote_branch}")

    staging = flow.make_staging_branch(repo, bead_id, flow.default_remote_ref(repo))
    path = flow.cache_worktree_path(repo, bead_id)
    try:
        flow.create_bd_worktree(repo, path, staging)
        if previous_sha and _transport_artifacts_exist(repo, remote_branch):
            # Path checkout updates the staging worktree/index without importing
            # stale code from the previous transport branch.
            flow.run(
                [
                    "git",
                    "checkout",
                    f"origin/{remote_branch}",
                    "--",
                    ".xtrm/board-audit",
                ],
                cwd=path,
            )
    except Exception:
        # Match the base flow's recovery behaviour: preserve a partially-created
        # worktree for inspection, but remove the staging ref if creation failed
        # before the worktree became usable.
        if not path.exists():
            flow.delete_local_branch(repo, staging)
        raise

    _HANDOFF_LEASES[remote_branch] = previous_sha
    return path, staging, remote_branch


def commit_and_push(
    worktree: Path,
    *,
    paths: list[Path],
    message: str,
    remote_branch: str,
) -> None:
    flow.run(
        ["git", "add", "--", *[flow.rel(worktree, path) for path in paths]],
        cwd=worktree,
    )
    staged = (
        flow.run(
            ["git", "diff", "--cached", "--quiet"],
            cwd=worktree,
            check=False,
        ).returncode
        != 0
    )
    if staged:
        flow.run(["git", "commit", "-m", message], cwd=worktree)

    push = ["git", "push"]
    lease = _HANDOFF_LEASES.pop(remote_branch, None)
    if lease:
        push.append(
            f"--force-with-lease=refs/heads/{remote_branch}:{lease}"
        )
    push.extend(["origin", f"HEAD:refs/heads/{remote_branch}"])
    flow.run(push, cwd=worktree)


# Install the transport policy into the generic flow implementation.
flow.start_transport_worktree = start_transport_worktree
flow.commit_and_push = commit_and_push


def main(argv: list[str] | None = None) -> int:
    return int(flow.main(argv))


if __name__ == "__main__":
    raise SystemExit(main())
