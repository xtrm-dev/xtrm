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


def git(cwd: Path, *args: str, capture: bool = False) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", *args],
        cwd=cwd,
        text=True,
        capture_output=capture,
        check=True,
    )


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
        self.assertEqual(
            transport._STAGING_TRANSPORTS["board-audit-staging/x-1"],
            branch,
        )

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

        self.assertEqual(
            calls[0],
            ["git", "add", "-f", "--", ".xtrm/board-audit/index.json"],
        )
        commit = next(call for call in calls if call[0:2] == ["git", "commit"])
        self.assertEqual(commit[:3], ["git", "commit", "--no-verify"])
        self.assertIn("[skip ci]", commit[-1])
        push = next(call for call in calls if call[0:2] == ["git", "push"])
        self.assertEqual(push[0:3], ["git", "push", "--no-verify"])
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
        self.assertEqual(
            transport._STAGING_TRANSPORTS["board-audit-staging/x-2"],
            "board-audit/x-2",
        )

    def test_commit_and_push_force_stages_transport_even_when_xtrm_is_ignored(self):
        transport = load_transport()

        with tempfile.TemporaryDirectory() as td_raw:
            td = Path(td_raw)
            remote = td / "remote.git"
            repo = td / "repo"
            subprocess.run(
                ["git", "init", "--bare", str(remote)],
                text=True,
                capture_output=True,
                check=True,
            )
            repo.mkdir()
            git(repo, "init", "-b", "main")
            git(repo, "config", "user.name", "Board Audit Test")
            git(repo, "config", "user.email", "board-audit@example.invalid")
            (repo / ".gitignore").write_text(".xtrm/\n", encoding="utf-8")
            (repo / "README.md").write_text("fixture\n", encoding="utf-8")
            git(repo, "add", ".gitignore", "README.md")
            git(repo, "commit", "-m", "init")
            git(repo, "remote", "add", "origin", str(remote))
            git(repo, "push", "-u", "origin", "main")

            artifact = repo / ".xtrm" / "board-audit" / "index.json"
            artifact.parent.mkdir(parents=True)
            artifact.write_text("{}\n", encoding="utf-8")
            branch = "board-audit/x-ignore"
            transport._HANDOFF_LEASES[branch] = None

            transport.commit_and_push(
                repo,
                paths=[artifact],
                message="handoff ignored artifact",
                remote_branch=branch,
            )

            git(repo, "fetch", "origin")
            tracked = git(
                repo,
                "ls-tree",
                "-r",
                "--name-only",
                f"origin/{branch}",
                capture=True,
            ).stdout.splitlines()
            self.assertIn(".xtrm/board-audit/index.json", tracked)
            subject = git(
                repo,
                "log",
                "-1",
                "--format=%s",
                f"origin/{branch}",
                capture=True,
            ).stdout.strip()
            self.assertIn("[skip ci]", subject)

    def test_transport_bypasses_failing_commit_and_push_hooks(self):
        transport = load_transport()

        with tempfile.TemporaryDirectory() as td_raw:
            td = Path(td_raw)
            remote = td / "remote.git"
            repo = td / "repo"
            hooks = td / "hooks"
            commit_marker = td / "pre-commit-ran"
            push_marker = td / "pre-push-ran"
            subprocess.run(
                ["git", "init", "--bare", str(remote)],
                text=True,
                capture_output=True,
                check=True,
            )
            repo.mkdir()
            git(repo, "init", "-b", "main")
            git(repo, "config", "user.name", "Board Audit Test")
            git(repo, "config", "user.email", "board-audit@example.invalid")
            (repo / "README.md").write_text("fixture\n", encoding="utf-8")
            git(repo, "add", "README.md")
            git(repo, "commit", "-m", "init")
            git(repo, "remote", "add", "origin", str(remote))
            git(repo, "push", "-u", "origin", "main")

            hooks.mkdir()
            pre_commit = hooks / "pre-commit"
            pre_commit.write_text(
                f"#!/bin/sh\ntouch {commit_marker}\nexit 99\n",
                encoding="utf-8",
            )
            pre_push = hooks / "pre-push"
            pre_push.write_text(
                f"#!/bin/sh\ntouch {push_marker}\nexit 98\n",
                encoding="utf-8",
            )
            pre_commit.chmod(0o755)
            pre_push.chmod(0o755)
            git(repo, "config", "core.hooksPath", str(hooks))

            artifact = repo / ".xtrm" / "board-audit" / "index.json"
            artifact.parent.mkdir(parents=True)
            artifact.write_text("{}\n", encoding="utf-8")
            branch = "board-audit/x-hooks"
            transport._HANDOFF_LEASES[branch] = None

            transport.commit_and_push(
                repo,
                paths=[artifact],
                message="handoff hook bypass",
                remote_branch=branch,
            )

            self.assertFalse(commit_marker.exists(), "pre-commit hook unexpectedly ran")
            self.assertFalse(push_marker.exists(), "pre-push hook unexpectedly ran")
            git(repo, "fetch", "origin")
            self.assertEqual(
                git(repo, "rev-parse", "HEAD", capture=True).stdout.strip(),
                git(repo, "rev-parse", f"origin/{branch}", capture=True).stdout.strip(),
            )

    def test_force_stage_rejects_paths_outside_board_audit_tree(self):
        transport = load_transport()

        with tempfile.TemporaryDirectory() as td_raw:
            repo = Path(td_raw)
            outside = repo / "README.md"
            outside.write_text("not transport\n", encoding="utf-8")

            with self.assertRaisesRegex(
                transport.flow.FlowError,
                "refusing to force-stage non-board-audit path",
            ):
                transport.commit_and_push(
                    repo,
                    paths=[outside],
                    message="must fail",
                    remote_branch="board-audit/x-guard",
                )

    def test_transport_commit_message_does_not_duplicate_skip_marker(self):
        transport = load_transport()
        message = "handoff [skip ci]"
        self.assertEqual(transport._transport_commit_message(message), message)

    def test_prepare_cleanup_upstream_repoints_staging_to_published_transport(self):
        transport = load_transport()

        with tempfile.TemporaryDirectory() as td_raw:
            td = Path(td_raw)
            remote = td / "remote.git"
            repo = td / "repo"
            worktree = td / "worktree"
            subprocess.run(
                ["git", "init", "--bare", str(remote)],
                text=True,
                capture_output=True,
                check=True,
            )
            repo.mkdir()
            git(repo, "init", "-b", "main")
            git(repo, "config", "user.name", "Board Audit Test")
            git(repo, "config", "user.email", "board-audit@example.invalid")
            (repo / "README.md").write_text("fixture\n", encoding="utf-8")
            git(repo, "add", "README.md")
            git(repo, "commit", "-m", "init")
            git(repo, "remote", "add", "origin", str(remote))
            git(repo, "push", "-u", "origin", "main")

            staging = "board-audit-staging/x-clean"
            branch = "board-audit/x-clean"
            git(repo, "branch", staging, "origin/main")
            git(repo, "worktree", "add", str(worktree), staging)
            artifact = worktree / ".xtrm" / "board-audit" / "index.json"
            artifact.parent.mkdir(parents=True)
            artifact.write_text("{}\n", encoding="utf-8")
            git(worktree, "add", "-f", ".xtrm/board-audit/index.json")
            git(worktree, "commit", "-m", "handoff")
            git(worktree, "push", "origin", f"HEAD:refs/heads/{branch}")

            before = git(
                worktree,
                "rev-parse",
                "--abbrev-ref",
                "--symbolic-full-name",
                "@{upstream}",
                capture=True,
            ).stdout.strip()
            self.assertEqual(before, "origin/main")

            transport._prepare_cleanup_upstream(repo, worktree, staging, branch)

            after = git(
                worktree,
                "rev-parse",
                "--abbrev-ref",
                "--symbolic-full-name",
                "@{upstream}",
                capture=True,
            ).stdout.strip()
            self.assertEqual(after, f"origin/{branch}")
            self.assertEqual(
                git(worktree, "rev-parse", "HEAD", capture=True).stdout.strip(),
                git(repo, "rev-parse", f"origin/{branch}", capture=True).stdout.strip(),
            )
            containment = subprocess.run(
                ["git", "merge-base", "--is-ancestor", "HEAD", "@{upstream}"],
                cwd=worktree,
                text=True,
                capture_output=True,
                check=False,
            )
            self.assertEqual(containment.returncode, 0, containment.stderr)

    def test_prepare_cleanup_upstream_rejects_remote_head_mismatch(self):
        transport = load_transport()
        flow = transport.flow
        repo = Path("/repo")
        worktree = Path("/worktree")
        staging = "board-audit-staging/x-race"
        branch = "board-audit/x-race"

        with (
            mock.patch.object(flow, "run") as run,
            mock.patch.object(flow, "git_output", side_effect=["local123", "remote456"]),
        ):
            run.return_value = subprocess.CompletedProcess([], 0, "", "")
            with self.assertRaisesRegex(
                flow.FlowError,
                "local transport HEAD does not match",
            ):
                transport._prepare_cleanup_upstream(
                    repo,
                    worktree,
                    staging,
                    branch,
                )

        self.assertEqual(len(run.mock_calls), 1)
        self.assertEqual(
            run.mock_calls[0],
            mock.call(
                [
                    "git",
                    "fetch",
                    "origin",
                    "+refs/heads/board-audit/x-race:refs/remotes/origin/board-audit/x-race",
                ],
                cwd=repo,
            ),
        )

    def test_cleanup_uses_transport_mapping_before_normal_bd_removal(self):
        transport = load_transport()
        repo = Path("/repo")
        worktree = Path("/worktree")
        staging = "board-audit-staging/x-cleanup"
        branch = "board-audit/x-cleanup"
        transport._STAGING_TRANSPORTS[staging] = branch

        with (
            mock.patch.object(transport, "_prepare_cleanup_upstream") as prepare,
            mock.patch.object(transport, "_BASE_CLEANUP_TRANSPORT_WORKTREE") as cleanup,
        ):
            transport.cleanup_transport_worktree(
                repo,
                worktree,
                staging,
                keep_on_error=False,
            )

        prepare.assert_called_once_with(repo, worktree, staging, branch)
        cleanup.assert_called_once_with(
            repo,
            worktree,
            staging,
            keep_on_error=False,
        )
        self.assertNotIn(staging, transport._STAGING_TRANSPORTS)


if __name__ == "__main__":
    unittest.main()
