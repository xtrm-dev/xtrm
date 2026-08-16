from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


REPO_ROOT = Path(__file__).resolve().parents[3]
PR = REPO_ROOT / "packages" / "board-audit" / "board-audit-pr.py"
ROUNDTRIP = REPO_ROOT / "packages" / "board-audit" / "board-audit-roundtrip.py"

FAKE_BD_SCRIPT = r"""#!/usr/bin/env python3
import json, os, pathlib, subprocess, sys
args = sys.argv[1:]
log = pathlib.Path(os.environ['FAKE_BD_LOG'])
with log.open('a', encoding='utf-8') as h:
    h.write(' '.join(args) + '\n')
fixture = pathlib.Path(os.environ['FAKE_BD_FIXTURE']).read_text(encoding='utf-8')
if args and args[0] == 'version':
    print('bd version test')
elif args[:2] == ['export', '--all']:
    if os.environ.get('FAKE_BD_FAIL_EXPORT'):
        raise SystemExit('simulated export failure')
    if '-o' in args:
        pathlib.Path(args[args.index('-o') + 1]).write_text(fixture, encoding='utf-8')
    else:
        sys.stdout.write(fixture)
elif args[:2] == ['worktree', 'create']:
    path = args[2]
    branch = args[args.index('--branch') + 1]
    subprocess.run(['git', 'worktree', 'add', path, branch], check=True)
elif args[:2] == ['worktree', 'remove']:
    name = args[2]
    out = subprocess.check_output(['git', 'worktree', 'list', '--porcelain'], text=True)
    paths = [line.split(' ', 1)[1] for line in out.splitlines() if line.startswith('worktree ')]
    matches = [p for p in paths if pathlib.Path(p).name == name or p == name]
    if len(matches) != 1:
        raise SystemExit('cannot resolve worktree ' + name)
    subprocess.run(['git', 'worktree', 'remove', matches[0]], check=True)
elif args and args[0] == 'where':
    print('/fake/beads-workspace')
elif args[:2] == ['hooks', 'install']:
    print('fake hooks installed')
else:
    raise SystemExit('unexpected fake bd invocation: ' + ' '.join(args))
"""


def git(cwd: Path, *args: str, capture: bool = False) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", *args],
        cwd=cwd,
        text=True,
        capture_output=capture,
        check=True,
    )


def load_pr(tag: str):
    spec = importlib.util.spec_from_file_location(f"board_audit_pr_{tag}", PR)
    if spec is None or spec.loader is None:
        raise RuntimeError("cannot load board-audit pr module")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def write_pr_json(path: Path, number: int, head_oid: str, head_ref: str = "feature/x") -> None:
    path.write_text(
        json.dumps(
            {
                "number": number,
                "title": "PR fixture",
                "state": "open",
                "headRefName": head_ref,
                "headRefOid": head_oid,
                "baseRefName": "main",
                "url": "https://github.com/example/repo/pull/%d" % number,
            }
        ),
        encoding="utf-8",
    )


class PrCheckpointFixture:
    """One real git remote + source repo + fake bd + fake PR identity."""

    def __init__(self, td: Path) -> None:
        self.td = td
        self.remote = td / "remote.git"
        self.source = td / "repo"
        self.editor = td / "editor"
        self.fake_bin = td / "bin"
        self.cache = td / "cache"
        self.bd_log = td / "bd.log"
        self.fixture = td / "fixture.jsonl"
        self.pr_json = td / "pr.json"

    def setup(self, rows: list[dict]) -> "PrCheckpointFixture":
        self.fake_bin.mkdir()
        subprocess.run(["git", "init", "--bare", str(self.remote)], text=True, capture_output=True, check=True)
        self.source.mkdir()
        git(self.source, "init", "-b", "main")
        git(self.source, "config", "user.name", "Board Audit Test")
        git(self.source, "config", "user.email", "board-audit@example.invalid")
        (self.source / "README.md").write_text("fixture\n", encoding="utf-8")
        git(self.source, "add", ".")
        git(self.source, "commit", "-m", "init")
        git(self.source, "remote", "add", "origin", str(self.remote))
        git(self.source, "push", "-u", "origin", "main")
        self.set_fixture(rows)
        self.head_oid = self._push_implementation_branch()
        write_pr_json(self.pr_json, 531, self.head_oid)
        return self

    def set_fixture(self, rows: list[dict]) -> None:
        self.fixture.write_text(
            "".join(json.dumps(row) + "\n" for row in rows),
            encoding="utf-8",
        )

    def _push_implementation_branch(self) -> str:
        git(self.source, "checkout", "-b", "feature/x")
        (self.source / "feature.txt").write_text("impl\n", encoding="utf-8")
        git(self.source, "add", "feature.txt")
        git(self.source, "commit", "-m", "implementation commit")
        head_oid = git(self.source, "rev-parse", "HEAD", capture=True).stdout.strip()
        git(self.source, "push", "-u", "origin", "feature/x")
        git(self.source, "checkout", "main")
        return head_oid

    def push_new_implementation_commit(self) -> str:
        git(self.source, "checkout", "feature/x")
        (self.source / "feature2.txt").write_text("impl2\n", encoding="utf-8")
        git(self.source, "add", "feature2.txt")
        git(self.source, "commit", "-m", "later implementation commit")
        head_oid = git(self.source, "rev-parse", "HEAD", capture=True).stdout.strip()
        git(self.source, "push", "origin", "feature/x")
        git(self.source, "checkout", "main")
        write_pr_json(self.pr_json, 531, head_oid)
        return head_oid

    def env(self, **overrides: str) -> dict[str, str]:
        fake_bd = self.fake_bin / "bd"
        fake_bd.write_text(FAKE_BD_SCRIPT, encoding="utf-8")
        fake_bd.chmod(0o755)
        env = os.environ.copy()
        env["PATH"] = f"{self.fake_bin}:{env['PATH']}"
        env["XDG_CACHE_HOME"] = str(self.cache)
        env["FAKE_BD_LOG"] = str(self.bd_log)
        env["FAKE_BD_FIXTURE"] = str(self.fixture)
        env["BOARD_AUDIT_PR_JSON"] = str(self.pr_json)
        for key, value in overrides.items():
            env[key] = value
        return env

    def run(self, *args: str, **overrides: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["python3", str(PR), *args],
            cwd=self.source,
            env=self.env(**overrides),
            text=True,
            capture_output=True,
            check=False,
        )

    def transport_tree(self) -> list[str]:
        git(self.source, "fetch", "origin")
        return git(
            self.source,
            "ls-tree",
            "-r",
            "--name-only",
            "origin/board-audit/pr-531",
            capture=True,
        ).stdout.splitlines()

    def show_transport(self, relpath: str) -> str:
        return git(
            self.source,
            "show",
            f"origin/board-audit/pr-531:{relpath}",
            capture=True,
        ).stdout


BASE_ROWS = [
    {
        "id": "root-1",
        "title": "Example root",
        "description": "base",
        "status": "open",
        "priority": 1,
        "issue_type": "epic",
        "owner": "owner@example.invalid",
        "created_at": "2026-01-01T00:00:00Z",
        "updated_at": "2026-01-01T00:00:00Z",
    },
    {
        "id": "root-1.1",
        "title": "Example child",
        "description": "child",
        "status": "open",
        "priority": 2,
        "issue_type": "task",
        "owner": "owner@example.invalid",
        "created_at": "2026-01-01T00:00:00Z",
        "updated_at": "2026-01-01T00:00:00Z",
        "dependencies": [
            {
                "issue_id": "root-1.1",
                "depends_on_id": "root-1",
                "type": "parent-child",
            }
        ],
    },
    {
        "id": "root-1.2",
        "title": "Another child",
        "description": "child2",
        "status": "open",
        "priority": 3,
        "issue_type": "task",
        "owner": "owner@example.invalid",
        "created_at": "2026-01-01T00:00:00Z",
        "updated_at": "2026-01-01T00:00:00Z",
    },
    {
        "id": "done-9",
        "title": "Closed work",
        "description": "closed",
        "status": "closed",
        "priority": 4,
        "issue_type": "task",
        "owner": "owner@example.invalid",
        "created_at": "2026-01-01T00:00:00Z",
        "updated_at": "2026-01-01T00:00:00Z",
    },
]


class PrCheckpointTests(unittest.TestCase):
    def test_pr_creation_publishes_handoff_bound_to_exact_remote_head(self):
        # AC1: PR creation produces one complete handoff bound to the exact
        # remote PR head. AC3: exactly one bd export --all. AC4: open beads
        # individually addressable through a deterministic index. AC11: all
        # generated files confined to .xtrm/board-audit/**. AC2: caller
        # checkout unchanged.
        with tempfile.TemporaryDirectory() as td_raw:
            fx = PrCheckpointFixture(Path(td_raw)).setup(BASE_ROWS)
            before_branch = git(fx.source, "branch", "--show-current", capture=True).stdout.strip()

            result = fx.run("pr-checkpoint", "531")
            self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
            self.assertIn("✓ PR #531 checkpoint published", result.stdout)
            self.assertNotIn("NO_CHANGES", result.stdout)

            # AC2: caller branch and working tree untouched, no generated files.
            self.assertEqual(before_branch, git(fx.source, "branch", "--show-current", capture=True).stdout.strip())
            status = git(fx.source, "status", "--porcelain", capture=True).stdout.strip()
            self.assertEqual(status, "", f"implementation checkout must stay clean: {status!r}")
            tracked = git(fx.source, "ls-files", capture=True).stdout.splitlines()
            self.assertFalse(any(p.startswith(".xtrm") for p in tracked), tracked)

            # AC3: one canonical acquisition per checkpoint.
            bd_log = fx.bd_log.read_text(encoding="utf-8").splitlines()
            self.assertEqual(
                len([line for line in bd_log if line.startswith("export --all")]),
                1,
            )

            # AC11: generated files are fenced to .xtrm/board-audit/**. The
            # transport branch base carries the repo tree (from origin/main);
            # the fence applies to everything the checkpoint generated.
            generated = git(
                fx.source,
                "diff",
                "--name-only",
                "origin/main",
                "origin/board-audit/pr-531",
                capture=True,
            ).stdout.splitlines()
            self.assertTrue(generated, "checkpoint must generate files")
            self.assertTrue(all(p.startswith(".xtrm/board-audit/") for p in generated), generated)

            handoff = json.loads(fx.show_transport(".xtrm/board-audit/handoffs/pr-531.json"))
            self.assertEqual(handoff["schema_version"], "xtrm.board-audit.pr-handoff.v1")
            self.assertEqual(handoff["pull_request"], 531)
            self.assertEqual(handoff["implementation_branch"], "feature/x")
            self.assertEqual(handoff["implementation_head_sha"], fx.head_oid)
            self.assertEqual(handoff["transport_branch"], "board-audit/pr-531")
            self.assertEqual(handoff["state"], "prepared")
            self.assertNotEqual(handoff["snapshot_id"], "")
            self.assertNotEqual(handoff["snapshot_sha256"], "")
            # The bounded root/work-package handoff (export + editable) is part
            # of the same publication, derived from the same acquisition.
            self.assertEqual(handoff["work_package_count"], 1)

            index = json.loads(fx.show_transport(".xtrm/board-audit/index.json"))
            open_issues = index["open_issues"]
            self.assertEqual(sorted(open_issues), ["root-1", "root-1.1", "root-1.2"])
            self.assertNotIn("done-9", open_issues)
            for bead_id, entry in open_issues.items():
                self.assertEqual(entry["snapshot_id"], handoff["snapshot_id"])
                self.assertIn(f".xtrm/board-audit/{entry['file']}", fx.transport_tree())
                self.assertEqual(entry["root_id"], "root-1")
            self.assertEqual(index["pr_checkpoints"]["531"]["implementation_head_sha"], fx.head_oid)

            # The round-trip contract resolves off the PR transport branch:
            # per-root work package + prepared editable, indexed by the
            # existing handoff index entry.
            package_entry = index["packages"]["root-1"]
            self.assertEqual(package_entry["state"], "prepared")
            self.assertEqual(package_entry["branch"], "board-audit/pr-531")
            self.assertTrue(package_entry["editable"].endswith(".editable.json"))
            work_package = json.loads(fx.show_transport(package_entry["package"]))
            self.assertEqual(work_package["schema_version"], "xtrm.board-audit.work-package.v1")
            self.assertEqual(work_package["root_id"], "root-1")
            self.assertEqual(work_package["issues"]["root-1.1"]["source"]["title"], "Example child")
            editable = json.loads(fx.show_transport(package_entry["editable"]))
            self.assertEqual(editable["desired_issues"]["root-1"]["description"], "base")
            self.assertIn("new_comments", editable)

            # transport_head_sha is the exact artifacts commit (first commit
            # on the branch; the seal commit is the head).
            commits = git(fx.source, "log", "--format=%H", "-2", "origin/board-audit/pr-531", capture=True).stdout.splitlines()
            self.assertEqual(len(commits), 2)
            self.assertEqual(handoff["transport_head_sha"], commits[1])

            # Producer provenance: this fixture carries no repo package, so the
            # caller's package is recorded with its digest (and the checkout
            # SHA when the package lives inside a git working tree).
            producer = handoff["producer"]
            self.assertEqual(producer["board_audit_source"], "caller")
            self.assertRegex(producer["package_sha256"], r"[0-9a-f]{64}")
            if producer["git_sha"] is not None:
                self.assertRegex(producer["git_sha"], r"[0-9a-f]{40}")

            # The open projection is individually addressable per bead.
            first_projection = json.loads(fx.show_transport(f".xtrm/board-audit/{open_issues['root-1.1']['file']}"))
            self.assertEqual(first_projection["navigation"]["root"], "root-1")
            self.assertEqual(first_projection["navigation"]["parents"], ["root-1"])
            self.assertEqual(first_projection["source"]["title"], "Example child")

    def test_no_change_checkpoint_returns_no_changes_without_transport_commit(self):
        # AC9 + AC5: identical board + identical PR head yields NO_CHANGES and
        # no new transport commit; canonical hashes stay identical.
        with tempfile.TemporaryDirectory() as td_raw:
            fx = PrCheckpointFixture(Path(td_raw)).setup(BASE_ROWS)
            first = fx.run("pr-checkpoint", "531")
            self.assertEqual(first.returncode, 0, first.stderr + first.stdout)
            git(fx.source, "fetch", "origin")
            head_before = git(fx.source, "rev-parse", "origin/board-audit/pr-531", capture=True).stdout.strip()
            index_before = json.loads(fx.show_transport(".xtrm/board-audit/index.json"))
            first_hash = index_before["open_issues"]["root-1.1"]["source_sha256"]

            second = fx.run("pr-checkpoint", "531")
            self.assertEqual(second.returncode, 0, second.stderr + second.stdout)
            self.assertIn("NO_CHANGES", second.stdout)
            self.assertIn("already current", second.stdout)

            git(fx.source, "fetch", "origin")
            head_after = git(fx.source, "rev-parse", "origin/board-audit/pr-531", capture=True).stdout.strip()
            self.assertEqual(head_before, head_after, "NO_CHANGES must not add a transport commit")

            index = json.loads(fx.show_transport(".xtrm/board-audit/index.json"))
            self.assertEqual(sorted(index["open_issues"]), ["root-1", "root-1.1", "root-1.2"])
            # AC5: the unchanged record retains its identical canonical hash
            # across the second checkpoint.
            self.assertEqual(
                index["open_issues"]["root-1.1"]["source_sha256"],
                first_hash,
            )
            self.assertEqual(git(fx.source, "branch", "--show-current", capture=True).stdout.strip(), "main")

    def test_membership_changes_update_projection_and_unchanged_records_keep_hashes(self):
        # AC6: new, changed, closed beads update the projection. AC5: an
        # unchanged record keeps its identical canonical hash.
        with tempfile.TemporaryDirectory() as td_raw:
            fx = PrCheckpointFixture(Path(td_raw)).setup(BASE_ROWS)
            first = fx.run("pr-checkpoint", "531")
            self.assertEqual(first.returncode, 0, first.stderr + first.stdout)
            index_before = json.loads(fx.show_transport(".xtrm/board-audit/index.json"))
            before_hashes = {rid: e["source_sha256"] for rid, e in index_before["open_issues"].items()}
            before_snapshot = index_before["open_issues"]["root-1"]["snapshot_id"]

            changed = [
                {**row, "title": "Example child (edited)"} if row["id"] == "root-1.1" else row
                for row in BASE_ROWS
            ]
            changed = [
                {**row, "status": "closed"} if row["id"] == "root-1.2" else row
                for row in changed
            ]
            # AC6 reopen: a previously closed bead re-enters the projection.
            changed = [
                {**row, "status": "open", "title": "Reopened work"} if row["id"] == "done-9" else row
                for row in changed
            ]
            changed.append(
                {
                    "id": "root-1.3",
                    "title": "New child",
                    "description": "new",
                    "status": "open",
                    "priority": 2,
                    "issue_type": "task",
                    "owner": "owner@example.invalid",
                    "created_at": "2026-01-01T00:00:00Z",
                    "updated_at": "2026-01-01T00:00:00Z",
                }
            )
            fx.set_fixture(changed)
            second = fx.run("pr-checkpoint", "531")
            self.assertEqual(second.returncode, 0, second.stderr + second.stdout)
            self.assertNotIn("NO_CHANGES", second.stdout)

            git(fx.source, "fetch", "origin")
            index_after = json.loads(fx.show_transport(".xtrm/board-audit/index.json"))
            after_hashes = {rid: e["source_sha256"] for rid, e in index_after["open_issues"].items()}

            # Closed bead removed, reopened bead re-enters, new bead added,
            # changed bead rehashed.
            self.assertNotIn("root-1.2", after_hashes)
            self.assertIn("root-1.3", after_hashes)
            self.assertIn("done-9", after_hashes)
            self.assertNotEqual(after_hashes["root-1.1"], before_hashes["root-1.1"])
            # Unchanged record keeps its identical canonical hash.
            self.assertEqual(after_hashes["root-1"], before_hashes["root-1"])

            # New snapshot identity; only one snapshot dir in the tree.
            self.assertNotEqual(index_after["open_issues"]["root-1"]["snapshot_id"], before_snapshot)
            snapshots = sorted({p.split("/")[2] for p in fx.transport_tree() if p.startswith(".xtrm/board-audit/snapshots/") and p.count("/") >= 4})
            self.assertEqual(len(snapshots), 1, snapshots)

    def test_later_push_marks_old_head_stale_then_refresh_binds_new_head(self):
        # AC7: a later PR push makes the old head binding detectably stale.
        # AC8: a successful refresh binds the new exact PR head.
        with tempfile.TemporaryDirectory() as td_raw:
            fx = PrCheckpointFixture(Path(td_raw)).setup(BASE_ROWS)
            first = fx.run("pr-checkpoint", "531")
            self.assertEqual(first.returncode, 0, first.stderr + first.stdout)

            new_head = fx.push_new_implementation_commit()
            self.assertNotEqual(new_head, fx.head_oid)

            stale = fx.run("pr-status", "531")
            self.assertEqual(stale.returncode, 0, stale.stderr + stale.stdout)
            self.assertIn("STATUS: STALE_CODE_HEAD", stale.stdout)
            self.assertIn(f"Live head: {new_head}", stale.stdout)

            stale_check = fx.run("pr-status", "531", "--check")
            self.assertEqual(stale_check.returncode, 3, stale_check.stderr + stale_check.stdout)

            refreshed = fx.run("pr-checkpoint", "531")
            self.assertEqual(refreshed.returncode, 0, refreshed.stderr + refreshed.stdout)
            self.assertIn("✓ PR #531 checkpoint published", refreshed.stdout)

            git(fx.source, "fetch", "origin")
            handoff = json.loads(fx.show_transport(".xtrm/board-audit/handoffs/pr-531.json"))
            self.assertEqual(handoff["implementation_head_sha"], new_head)
            self.assertNotEqual(handoff["snapshot_id"], "")

            fresh = fx.run("pr-status", "531")
            self.assertIn("STATUS: FRESH", fresh.stdout)

    def test_concurrent_transport_update_fails_closed_through_lease(self):
        # AC10: concurrent transport updates fail closed through the exact
        # force-with-lease guard; the remote ref is never clobbered.
        with tempfile.TemporaryDirectory() as td_raw:
            fx = PrCheckpointFixture(Path(td_raw)).setup(BASE_ROWS)
            first = fx.run("pr-checkpoint", "531")
            self.assertEqual(first.returncode, 0, first.stderr + first.stdout)
            git(fx.source, "fetch", "origin")
            original_head = git(fx.source, "rev-parse", "origin/board-audit/pr-531", capture=True).stdout.strip()

            # A concurrent actor rewrites the transport branch.
            pr = load_pr("lease")
            git(fx.td, "clone", str(fx.remote), str(fx.editor))
            git(fx.editor, "config", "user.name", "Concurrent Editor")
            git(fx.editor, "config", "user.email", "editor@example.invalid")
            git(fx.editor, "checkout", "-b", "board-audit/pr-531", "origin/board-audit/pr-531")
            (fx.editor / "concurrent.txt").write_text("E\n", encoding="utf-8")
            git(fx.editor, "add", "concurrent.txt")
            git(fx.editor, "commit", "-m", "concurrent transport rewrite")
            git(fx.editor, "push", "origin", "board-audit/pr-531")
            concurrent_pushed = git(
                fx.editor, "rev-parse", "origin/board-audit/pr-531", capture=True
            ).stdout.strip()
            # A second local commit makes the lease-protected push a real ref
            # update that must be rejected against the stale expected SHA.
            (fx.editor / "concurrent2.txt").write_text("E2\n", encoding="utf-8")
            git(fx.editor, "add", "concurrent2.txt")
            git(fx.editor, "commit", "-m", "concurrent transport rewrite 2")

            # The publisher still holds a lease on the pre-concurrency SHA.
            pr.transport._HANDOFF_LEASES["board-audit/pr-531"] = original_head
            with self.assertRaises(pr.flow.FlowError):
                pr.transport.push_transport(fx.editor, remote_branch="board-audit/pr-531")

            git(fx.source, "fetch", "origin")
            remote_now = git(fx.source, "rev-parse", "origin/board-audit/pr-531", capture=True).stdout.strip()
            self.assertEqual(remote_now, concurrent_pushed, "lease-protected push must not clobber the concurrent ref")

    def test_per_bead_read_files_cannot_be_compiled_as_mutations(self):
        # AC12: per-Bead read projections are a read model only; they cannot be
        # compiled by the round-trip compiler as Web-originated mutations.
        with tempfile.TemporaryDirectory() as td_raw:
            fx = PrCheckpointFixture(Path(td_raw)).setup(BASE_ROWS)
            first = fx.run("pr-checkpoint", "531")
            self.assertEqual(first.returncode, 0, first.stderr + first.stdout)

            git(fx.source, "fetch", "origin")
            index = json.loads(fx.show_transport(".xtrm/board-audit/index.json"))
            projection_rel = index["open_issues"]["root-1.1"]["file"]
            projection_text = fx.show_transport(f".xtrm/board-audit/{projection_rel}")
            local = fx.td / "projection.json"
            local.write_text(projection_text, encoding="utf-8")

            compiled = subprocess.run(
                ["python3", str(ROUNDTRIP), "validate", str(local)],
                cwd=fx.source,
                text=True,
                capture_output=True,
                check=False,
            )
            self.assertNotEqual(compiled.returncode, 0, "read projection must not compile as an editable mutation")
            self.assertIn("unsupported package schema", compiled.stderr + compiled.stdout)

    def test_failure_leaves_beads_and_implementation_checkout_unchanged(self):
        # AC14: a failed acquisition leaves authoritative Beads untouched and
        # the implementation checkout unchanged; recovery evidence is retained.
        with tempfile.TemporaryDirectory() as td_raw:
            fx = PrCheckpointFixture(Path(td_raw)).setup(BASE_ROWS)
            before_branch = git(fx.source, "branch", "--show-current", capture=True).stdout.strip()

            result = fx.run("pr-checkpoint", "531", FAKE_BD_FAIL_EXPORT="1")
            self.assertEqual(result.returncode, 2, result.stderr + result.stdout)
            self.assertIn("BEADS_UNAVAILABLE", result.stderr)

            self.assertEqual(before_branch, git(fx.source, "branch", "--show-current", capture=True).stdout.strip())
            self.assertEqual(git(fx.source, "status", "--porcelain", capture=True).stdout.strip(), "")
            tracked = git(fx.source, "ls-files", capture=True).stdout.splitlines()
            self.assertFalse(any(p.startswith(".xtrm") for p in tracked), tracked)

            bd_log = fx.bd_log.read_text(encoding="utf-8")
            self.assertNotIn("import", bd_log, "failed publication must not mutate Beads")
            self.assertIn("export --all", bd_log)
            # No transport branch was published.
            refs = git(fx.source, "ls-remote", "origin", "refs/heads/board-audit/*", capture=True).stdout
            self.assertEqual(refs.strip(), "")

            # Recovery evidence retained: the isolated worktree still exists.
            worktrees = git(fx.source, "worktree", "list", "--porcelain", capture=True).stdout
            self.assertGreater(worktrees.count("worktree "), 1)

    def test_confidentiality_blocks_automated_publication_before_transport_push(self):
        # AC15: automation fails closed before transport push unless the
        # repository is authorized; pr-status reports NO_HANDOFF.
        with tempfile.TemporaryDirectory() as td_raw:
            fx = PrCheckpointFixture(Path(td_raw)).setup(BASE_ROWS)

            denied = fx.run("pr-checkpoint", "531", "--trigger", "auto")
            self.assertEqual(denied.returncode, 2, denied.stderr + denied.stdout)
            self.assertIn("CONFIDENTIALITY_BLOCKED", denied.stderr)
            refs = git(fx.source, "ls-remote", "origin", "refs/heads/board-audit/*", capture=True).stdout
            self.assertEqual(refs.strip(), "", "confidentiality block must precede any transport push")

            no_handoff = fx.run("pr-status", "531", "--check")
            self.assertEqual(no_handoff.returncode, 3, no_handoff.stderr + no_handoff.stdout)
            self.assertIn("STATUS: NO_HANDOFF", no_handoff.stdout)

            # Wrong allowlist entry also fails closed.
            wrong = fx.run(
                "pr-checkpoint", "531", "--trigger", "auto",
                BOARD_AUDIT_PR_AUTHORIZED_REPOS="owner/other",
            )
            self.assertEqual(wrong.returncode, 2, wrong.stderr + wrong.stdout)
            self.assertIn("CONFIDENTIALITY_BLOCKED", wrong.stderr)

            # Authorized automation publishes.
            allowed = fx.run(
                "pr-checkpoint", "531", "--trigger", "auto",
                BOARD_AUDIT_PR_AUTHORIZED_REPOS="*",
            )
            self.assertEqual(allowed.returncode, 0, allowed.stderr + allowed.stdout)
            self.assertIn("✓ PR #531 checkpoint published", allowed.stdout)

    def test_event_adapter_publishes_via_explicit_pr_argument(self):
        # The adapter's explicit-argument form must forward exactly one PR
        # number and publish under the automated (fail-closed) trigger.
        adapter = REPO_ROOT / "packages" / "board-audit" / "board-audit-pr-adapter.sh"
        with tempfile.TemporaryDirectory() as td_raw:
            fx = PrCheckpointFixture(Path(td_raw)).setup(BASE_ROWS)
            env = fx.env(BOARD_AUDIT_PR_AUTHORIZED_REPOS="*")
            env.pop("BOARD_AUDIT_PR_TRIGGER", None)
            first = subprocess.run(
                [str(adapter), "531"],
                cwd=fx.source,
                env=env,
                text=True,
                capture_output=True,
                check=False,
            )
            self.assertEqual(first.returncode, 0, first.stderr + first.stdout)
            self.assertIn("✓ PR #531 checkpoint published", first.stdout)

            git(fx.source, "fetch", "origin")
            transport_head = git(fx.source, "rev-parse", "origin/board-audit/pr-531", capture=True).stdout.strip()
            self.assertTrue(transport_head)
            # A second adapter run on the unchanged board reports NO_CHANGES.
            second = subprocess.run(
                [str(adapter), "531"],
                cwd=fx.source,
                env=env,
                text=True,
                capture_output=True,
                check=False,
            )
            self.assertEqual(second.returncode, 0, second.stderr + second.stdout)
            self.assertIn("NO_CHANGES", second.stdout)

    def test_doctor_reports_environment_and_hook_state(self):
        with tempfile.TemporaryDirectory() as td_raw:
            fx = PrCheckpointFixture(Path(td_raw)).setup(BASE_ROWS)

            before = fx.run("doctor")
            self.assertEqual(before.returncode, 0, before.stderr + before.stdout)
            self.assertIn("[PASS] git repository", before.stdout)
            self.assertIn("[PASS] beads workspace", before.stdout)
            # gh presence is not enough: usable authentication is probed.
            self.assertIn("[PASS] GitHub authentication", before.stdout)
            # The fixture repo does not carry the package: warning, not failure.
            self.assertIn("[WARN] board-audit package", before.stdout)
            # No hooks installed yet: the pre-push warning covers it.
            self.assertIn("[WARN] pre-push hook", before.stdout)
            self.assertNotIn("[FAIL]", before.stdout)

            installed = fx.run("init")
            self.assertEqual(installed.returncode, 0, installed.stderr + installed.stdout)
            # init writes into the hooks dir only; the repo tree stays clean.
            self.assertEqual(git(fx.source, "status", "--porcelain", capture=True).stdout.strip(), "")

            after = fx.run("doctor")
            self.assertIn("[PASS] checkpoint hook", after.stdout)
            # The hook alone is not authorization: without an allowlist entry
            # every automated trigger is rejected with CONFIDENTIALITY_BLOCKED.
            self.assertIn("[WARN] auto-publication authorization", after.stdout)
            # With the repository allowlisted, authorization is explicit.
            authorized = fx.run("doctor", BOARD_AUDIT_PR_AUTHORIZED_REPOS="repo")
            self.assertIn("[PASS] auto-publication authorization", authorized.stdout)
            self.assertNotIn("[WARN] auto-publication authorization", authorized.stdout)

    def test_init_is_additive_and_idempotent(self):
        with tempfile.TemporaryDirectory() as td_raw:
            fx = PrCheckpointFixture(Path(td_raw)).setup(BASE_ROWS)
            first = fx.run("init")
            self.assertEqual(first.returncode, 0, first.stderr + first.stdout)
            hooks_dir = fx.source / ".git" / "hooks"
            pre_push = (hooks_dir / "pre-push").read_text(encoding="utf-8")
            self.assertIn("board-audit-pr-adapter", pre_push)
            self.assertIn("if [ $rc -ne 0 ]; then exit $rc; fi", pre_push)
            self.assertNotIn("[ $rc -ne 0 ] && exit $rc", pre_push)
            # The adapter block references the adapter script twice (-x test and
            # the exec line); exactly one block must exist.
            self.assertEqual(pre_push.count("board-audit-pr-adapter"), 2)
            self.assertTrue((hooks_dir / "pre-push.bd-sync").exists())
            self.assertTrue((hooks_dir / "post-merge.bd-sync").exists())

            second = fx.run("init")
            self.assertEqual(second.returncode, 0, second.stderr + second.stdout)
            pre_push_again = (hooks_dir / "pre-push").read_text(encoding="utf-8")
            self.assertEqual(pre_push.count("if [ $rc -ne 0 ]; then exit $rc; fi"),
                             pre_push_again.count("if [ $rc -ne 0 ]; then exit $rc; fi"))

            # The hooks dir is outside the repo tree: still no tracked changes.
            self.assertEqual(git(fx.source, "status", "--porcelain", capture=True).stdout.strip(), "")

    def test_checkpoint_cherry_picks_package_from_repo_and_stays_fenced(self):
        # The repo carries packages/board-audit on its default branch; the
        # checkpoint must cherry-pick it into the isolated worktree (archive,
        # unstaged) and still push only .xtrm/board-audit/** assets.
        with tempfile.TemporaryDirectory() as td_raw:
            fx = PrCheckpointFixture(Path(td_raw)).setup(BASE_ROWS)
            package_src = REPO_ROOT / "packages" / "board-audit"
            target = fx.source / "packages" / "board-audit"
            shutil.copytree(package_src, target, ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
            git(fx.source, "add", "packages")
            git(fx.source, "commit", "-m", "add board-audit package")
            git(fx.source, "push", "origin", "main")

            result = fx.run("pr-checkpoint", "531")
            self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
            self.assertIn("✓ PR #531 checkpoint published", result.stdout)

            git(fx.source, "fetch", "origin")
            generated = git(
                fx.source,
                "diff",
                "--name-only",
                "origin/main",
                "origin/board-audit/pr-531",
                capture=True,
            ).stdout.splitlines()
            self.assertTrue(generated)
            self.assertTrue(all(p.startswith(".xtrm/board-audit/") for p in generated), generated)
            # The cherry-picked package must never be pushed with the assets.
            self.assertFalse(any(p.startswith("packages/") for p in generated), generated)

            status = fx.run("pr-status", "531", "--check")
            self.assertEqual(status.returncode, 0, status.stderr + status.stdout)
            self.assertIn("STATUS: FRESH", status.stdout)

            # Producer provenance: the repo-carried package is pinned to the
            # exact default-branch SHA used for the archive, and the digest
            # covers the executed package tree.
            handoff = json.loads(fx.show_transport(".xtrm/board-audit/handoffs/pr-531.json"))
            producer = handoff["producer"]
            self.assertEqual(producer["board_audit_source"], "repository")
            self.assertEqual(producer["repository"], "repo")
            main_sha = git(fx.source, "rev-parse", "origin/main", capture=True).stdout.strip()
            self.assertEqual(producer["git_sha"], main_sha)
            self.assertRegex(producer["package_sha256"], r"[0-9a-f]{64}")

    def test_no_implementation_path_invokes_or_depends_on_xt_end(self):
        # AC16: no implementation path invokes or depends on xt end.
        package = REPO_ROOT / "packages" / "board-audit"
        needles = ("xt end", "xt_end", "xt-end", "session-close")
        for path in package.iterdir():
            if path.suffix == ".py" or (path.is_file() and path.name.startswith("board-audit") and not path.name.endswith(".md")):
                text = path.read_text(encoding="utf-8", errors="replace")
                for needle in needles:
                    self.assertNotIn(needle, text, f"{path.name} must not reference {needle!r}")


if __name__ == "__main__":
    unittest.main()
