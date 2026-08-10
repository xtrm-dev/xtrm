from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


REPO_ROOT = Path(__file__).resolve().parents[3]
FLOW = REPO_ROOT / "packages" / "board-audit" / "board-audit-flow.py"
CORE = REPO_ROOT / "packages" / "board-audit" / "board-audit-core"
ROUNDTRIP = REPO_ROOT / "packages" / "board-audit" / "board-audit-roundtrip.py"


def git(cwd: Path, *args: str, capture: bool = False) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", *args],
        cwd=cwd,
        text=True,
        capture_output=capture,
        check=True,
    )


class FlowIntegrationTests(unittest.TestCase):
    def test_handoff_and_reconcile_use_bd_worktrees_without_switching_caller(self):
        rows = [
            {
                "id": "x-1",
                "title": "Example epic",
                "description": "base",
                "status": "open",
                "priority": 1,
                "issue_type": "epic",
            },
            {
                "id": "x-1.1",
                "title": "Example child",
                "description": "child",
                "status": "open",
                "priority": 2,
                "issue_type": "task",
                "dependencies": [
                    {
                        "issue_id": "x-1.1",
                        "depends_on_id": "x-1",
                        "type": "parent-child",
                    }
                ],
            },
        ]

        with tempfile.TemporaryDirectory() as td_raw:
            td = Path(td_raw)
            remote = td / "remote.git"
            source = td / "source"
            editor = td / "editor"
            fake_bin = td / "bin"
            fake_bin.mkdir()
            cache = td / "cache"
            log = td / "bd.log"
            fixture = td / "fixture.jsonl"
            fixture.write_text(
                "".join(json.dumps(row) + "\n" for row in rows),
                encoding="utf-8",
            )

            subprocess.run(["git", "init", "--bare", str(remote)], check=True, capture_output=True)
            source.mkdir()
            git(source, "init", "-b", "main")
            git(source, "config", "user.name", "Board Audit Test")
            git(source, "config", "user.email", "board-audit@example.invalid")
            (source / ".gitignore").write_text(
                ".xtrm/*\n!.xtrm/board-audit/\n!.xtrm/board-audit/**\n",
                encoding="utf-8",
            )
            (source / "README.md").write_text("fixture\n", encoding="utf-8")
            git(source, "add", ".")
            git(source, "commit", "-m", "init")
            git(source, "remote", "add", "origin", str(remote))
            git(source, "push", "-u", "origin", "main")

            fake_bd = fake_bin / "bd"
            fake_bd.write_text(
                "#!/usr/bin/env python3\n"
                "import json, os, pathlib, subprocess, sys\n"
                "args = sys.argv[1:]\n"
                "log = pathlib.Path(os.environ['FAKE_BD_LOG'])\n"
                "with log.open('a', encoding='utf-8') as h: h.write(' '.join(args) + '\\n')\n"
                "fixture = pathlib.Path(os.environ['FAKE_BD_FIXTURE']).read_text(encoding='utf-8')\n"
                "if args and args[0] == 'version':\n"
                "    print('bd version test')\n"
                "elif args[:2] == ['export', '--all']:\n"
                "    if '-o' in args:\n"
                "        pathlib.Path(args[args.index('-o') + 1]).write_text(fixture, encoding='utf-8')\n"
                "    else:\n"
                "        sys.stdout.write(fixture)\n"
                "elif args[:2] == ['worktree', 'create']:\n"
                "    path = args[2]\n"
                "    branch = args[args.index('--branch') + 1]\n"
                "    subprocess.run(['git', 'worktree', 'add', path, branch], check=True)\n"
                "elif args[:2] == ['worktree', 'remove']:\n"
                "    name = args[2]\n"
                "    out = subprocess.check_output(['git', 'worktree', 'list', '--porcelain'], text=True)\n"
                "    paths = [line.split(' ', 1)[1] for line in out.splitlines() if line.startswith('worktree ')]\n"
                "    matches = [p for p in paths if pathlib.Path(p).name == name or p == name]\n"
                "    if len(matches) != 1: raise SystemExit('cannot resolve worktree ' + name)\n"
                "    subprocess.run(['git', 'worktree', 'remove', matches[0]], check=True)\n"
                "elif args and args[0] == 'import':\n"
                "    if '--dry-run' not in args: raise SystemExit('test forbids mutating import')\n"
                "    print(json.dumps({'dry_run': True}))\n"
                "else:\n"
                "    raise SystemExit('unexpected fake bd invocation: ' + ' '.join(args))\n",
                encoding="utf-8",
            )
            fake_bd.chmod(0o755)

            env = os.environ.copy()
            env["PATH"] = f"{fake_bin}:{env['PATH']}"
            env["XDG_CACHE_HOME"] = str(cache)
            env["FAKE_BD_LOG"] = str(log)
            env["FAKE_BD_FIXTURE"] = str(fixture)
            env["BOARD_AUDIT_CORE"] = str(CORE)
            env["BOARD_AUDIT_ROUNDTRIP"] = str(ROUNDTRIP)

            before = git(source, "branch", "--show-current", capture=True).stdout.strip()
            handoff = subprocess.run(
                ["python3", str(FLOW), "handoff", "x-1"],
                cwd=source,
                env=env,
                text=True,
                capture_output=True,
                check=False,
            )
            self.assertEqual(handoff.returncode, 0, handoff.stderr + handoff.stdout)
            self.assertIn("ready for handoff", handoff.stdout)
            self.assertIn("checkout: unchanged (main)", handoff.stdout)
            self.assertEqual(before, git(source, "branch", "--show-current", capture=True).stdout.strip())

            git(source, "fetch", "origin")
            index_text = git(
                source,
                "show",
                "origin/board-audit/x-1:.xtrm/board-audit/index.json",
                capture=True,
            ).stdout
            index = json.loads(index_text)
            entry = index["packages"]["x-1"]
            self.assertEqual(entry["state"], "prepared")
            self.assertEqual(entry["branch"], "board-audit/x-1")
            self.assertTrue(entry["editable"].endswith(".editable.json"))

            editable_text = git(
                source,
                "show",
                f"origin/board-audit/x-1:{entry['editable']}",
                capture=True,
            ).stdout
            editable = json.loads(editable_text)
            self.assertEqual(editable["desired_issues"]["x-1"]["description"], "base")

            # Simulate ChatGPT/human editing the transport artifact remotely.
            git(td, "clone", str(remote), str(editor))
            git(editor, "config", "user.name", "Remote Editor")
            git(editor, "config", "user.email", "editor@example.invalid")
            git(editor, "checkout", "board-audit/x-1")
            editable_path = editor / entry["editable"]
            edited = json.loads(editable_path.read_text(encoding="utf-8"))
            edited["desired_issues"]["x-1"]["description"] = "edited remotely"
            editable_path.write_text(json.dumps(edited, indent=2, sort_keys=True) + "\n", encoding="utf-8")
            git(editor, "add", entry["editable"])
            git(editor, "commit", "-m", "edit desired state")
            git(editor, "push", "origin", "board-audit/x-1")

            reconcile = subprocess.run(
                ["python3", str(FLOW), "reconcile", "x-1"],
                cwd=source,
                env=env,
                text=True,
                capture_output=True,
                check=False,
            )
            self.assertEqual(reconcile.returncode, 0, reconcile.stderr + reconcile.stdout)
            self.assertIn("reconciled safely; no Beads mutation performed", reconcile.stdout)
            self.assertEqual("main", git(source, "branch", "--show-current", capture=True).stdout.strip())

            bd_log = log.read_text(encoding="utf-8")
            self.assertIn("worktree create", bd_log)
            self.assertIn("worktree remove", bd_log)
            self.assertIn("import", bd_log)
            self.assertIn("--dry-run", bd_log)

            worktrees = git(source, "worktree", "list", "--porcelain", capture=True).stdout
            self.assertEqual(worktrees.count("worktree "), 1)


if __name__ == "__main__":
    unittest.main()
