from __future__ import annotations

import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest import mock


REPO_ROOT = Path(__file__).resolve().parents[3]
TRANSPORT = REPO_ROOT / "packages" / "board-audit" / "board-audit-transport.py"


def load_transport():
    spec = importlib.util.spec_from_file_location("board_audit_transport_test", TRANSPORT)
    if spec is None or spec.loader is None:
        raise RuntimeError("cannot load transport policy")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class TransportPolicyTests(unittest.TestCase):
    def test_existing_transport_rebases_artifacts_on_default_and_pushes_with_exact_lease(self):
        transport = load_transport()
        flow = transport.flow
        repo = Path("/repo")
        worktree = Path("/cache/x-1")
        branch = "board-audit/x-1"

        with (
            mock.patch.object(flow, "run") as run,
            mock.patch.object(flow, "remote_ref_exists", return_value=True),
            mock.patch.object(flow, "git_output", return_value="abc123"),
            mock.patch.object(flow, "default_remote_ref", return_value="origin/main"),
            mock.patch.object(flow, "make_staging_branch", return_value="board-audit-staging/x-1") as make_branch,
            mock.patch.object(flow, "cache_worktree_path", return_value=worktree),
            mock.patch.object(flow, "create_bd_worktree") as create_worktree,
            mock.patch.object(transport, "_transport_artifacts_exist", return_value=True),
        ):
            run.return_value = subprocess.CompletedProcess([], 0, "", "")
            path, staging, remote_branch = transport.start_transport_worktree(repo, "x-1")

        self.assertEqual(path, worktree)
        self.assertEqual(staging, "board-audit-staging/x-1")
        self.assertEqual(remote_branch, branch)
        make_branch.assert_called_once_with(repo, "x-1", "origin/main")
        create_worktree.assert_called_once_with(repo, worktree, "board-audit-staging/x-1")
        self.assertIn(
            mock.call(
                ["git", "checkout", "origin/board-audit/x-1", "--", ".xtrm/board-audit"],
                cwd=worktree,
            ),
            run.mock_calls,
        )
        self.assertEqual(transport._HANDOFF_LEASES[branch], "abc123")

        with tempfile.TemporaryDirectory() as td_raw:
            td = Path(td_raw)
            artifact = td / ".xtrm" / "board-audit" / "index.json"
            artifact.parent.mkdir(parents=True)
            artifact.write_text("{}\n", encoding="utf-8")
            calls: list[list[str]] = []

            def fake_run(command, *, cwd, capture=False, check=True):
                calls.append(list(command))
                if command[:4] == ["git", "diff", "--cached", "--quiet"]:
                    return subprocess.CompletedProcess(command, 1, "", "")
                return subprocess.CompletedProcess(command, 0, "", "")

            with mock.patch.object(flow, "run", side_effect=fake_run):
                transport.commit_and_push(
                    td,
                    paths=[artifact],
                    message="handoff",
                    remote_branch=branch,
                )

        push = calls[-1]
        self.assertEqual(push[0:2], ["git", "push"])
        self.assertIn(
            "--force-with-lease=refs/heads/board-audit/x-1:abc123",
            push,
        )
        self.assertEqual(push[-2:], ["origin", "HEAD:refs/heads/board-audit/x-1"])

    def test_first_handoff_uses_default_without_force_push(self):
        transport = load_transport()
        flow = transport.flow
        repo = Path("/repo")
        worktree = Path("/cache/x-2")

        with (
            mock.patch.object(flow, "run") as run,
            mock.patch.object(flow, "remote_ref_exists", return_value=False),
            mock.patch.object(flow, "default_remote_ref", return_value="origin/main"),
            mock.patch.object(flow, "make_staging_branch", return_value="board-audit-staging/x-2") as make_branch,
            mock.patch.object(flow, "cache_worktree_path", return_value=worktree),
            mock.patch.object(flow, "create_bd_worktree"),
        ):
            run.return_value = subprocess.CompletedProcess([], 0, "", "")
            transport.start_transport_worktree(repo, "x-2")

        make_branch.assert_called_once_with(repo, "x-2", "origin/main")
        self.assertIsNone(transport._HANDOFF_LEASES["board-audit/x-2"])


if __name__ == "__main__":
    unittest.main()
