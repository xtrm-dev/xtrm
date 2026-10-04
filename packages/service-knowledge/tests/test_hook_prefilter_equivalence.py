#!/usr/bin/env python3
"""Golden equivalence test for the service-knowledge hook pre-filter (XTRM-556).

The pre-filter may only ever SKIP a hook that would have produced nothing. This test drives
both hooks twice over the same replay set -- once through the unmodified hook (the "before"
oracle) and once through ``hook_prefilter.sh`` -- and asserts byte-identical stdout.

The replay set deliberately spans every decision branch:

* in-territory paths (both ``**`` and plain-prefix patterns, and a root-level glob)
* out-of-territory paths, inside and outside the project root
* Bash payloads (command matching, dispatch/promotion gates)
* a drift case (an Edit into registered territory -> drift marker)
* payloads with no file_path, unresolvable roots, and malformed JSON
* a registry containing a character-class pattern the filter must refuse to decide

Run: python3 tests/test_hook_prefilter_equivalence.py [fixture-root]
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

SRC = Path(__file__).resolve().parent.parent / "src" / "service_knowledge" / "scripts"
HOOKS = ("skill_activator.py", "drift_detector.py")

REGISTRY = {
    "version": "1.0",
    "services": {
        "core": {
            "name": "Core",
            "territory": ["packages/core/src/**"],
            "skill_path": ".xtrm/skills/default/service-knowledge/core",
            "last_sync": "2026-09-01T00:00:00Z",
        },
        "webui": {
            "name": "Web UI",
            "territory": ["apps/web/**", "*.tsx"],
            "skill_path": ".xtrm/skills/default/service-knowledge/webui",
            "last_sync": "2026-09-01T00:00:00Z",
        },
    },
}

# (label, registry_override_or_None, payload)
PAYLOADS = [
    ("in-territory-deep", None, {"tool_name": "Read", "tool_input": {"file_path": "packages/core/src/a/b.py"}}),
    ("in-territory-root-glob", None, {"tool_name": "Read", "tool_input": {"file_path": "Widget.tsx"}}),
    ("in-territory-absolute", None, {"tool_name": "Edit", "tool_input": {"file_path": "ROOT/packages/core/src/z.py"}}),
    ("in-territory-apps-web", None, {"tool_name": "Write", "tool_input": {"file_path": "apps/web/src/app.ts"}}),
    # DRIFT CASE: PostToolUse Edit into registered territory.
    ("drift-edit-in-territory", None, {"tool_name": "Edit", "tool_input": {"file_path": "packages/core/src/x.py"}}),
    ("drift-edit-root-glob", None, {"tool_name": "Edit", "tool_input": {"file_path": "App.tsx"}}),
    ("out-of-territory", None, {"tool_name": "Read", "tool_input": {"file_path": "docs/guide/intro.md"}}),
    ("out-of-territory-absolute-outside-root", None, {"tool_name": "Read", "tool_input": {"file_path": "/etc/passwd"}}),
    ("out-of-territory-similar-prefix", None, {"tool_name": "Read", "tool_input": {"file_path": "packages/core/srcX/a.py"}}),
    ("out-of-territory-partial", None, {"tool_name": "Grep", "tool_input": {"file_path": "apps/api/main.go"}}),
    ("bash-command", None, {"tool_name": "Bash", "tool_input": {"command": "cat packages/core/src/a.py"}}),
    ("bash-mutating", None, {"tool_name": "Bash", "tool_input": {"command": "rm -rf packages/core/src"}}),
    ("bash-dispatch", None, {"tool_name": "Bash", "tool_input": {"command": "sp run executor --bead xtrm-1"}}),
    ("no-file-path", None, {"tool_name": "Glob", "tool_input": {"pattern": "**/*.py"}}),
    ("notebook-path", None, {"tool_name": "NotebookEdit", "tool_input": {"notebook_path": "packages/core/src/n.ipynb"}}),
    ("charclass-in-territory", {"charclass": True}, {"tool_name": "Read", "tool_input": {"file_path": "weird/b.txt"}}),
    ("charclass-out-territory", {"charclass": True}, {"tool_name": "Read", "tool_input": {"file_path": "other/z.txt"}}),
]


def build_fixture(root: Path, registry: dict) -> Path:
    pack = root / ".xtrm" / "skills" / "default" / "service-knowledge"
    (pack / "scripts").mkdir(parents=True, exist_ok=True)
    (root / ".xtrm" / "skills" / "default" / "service-registry.json").write_text(
        json.dumps(registry, indent=2), encoding="utf-8"
    )
    for name in ("hook_prefilter.sh", "skill_activator.py", "drift_detector.py",
                 "bootstrap.py", "build_territory_index.py"):
        shutil.copy2(SRC / name, pack / "scripts" / name)
    (pack / "scripts" / "hook_prefilter.sh").chmod(0o755)
    subprocess.run(["git", "init", "-q", str(root)], check=False, capture_output=True)
    return pack / "scripts"


def run(cmd, cwd, payload: bytes, root: Path):
    env = {**os.environ, "CLAUDE_PROJECT_DIR": str(root)}
    return subprocess.run(cmd, cwd=str(cwd), input=payload, capture_output=True, env=env)


def main() -> int:
    base = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path(tempfile.mkdtemp(prefix="pf-golden-"))
    failures, checked, skipped = [], 0, 0

    # Index states exercised for every payload. "fresh" is the normal path; "absent" and
    # "stale" are the fail-safe paths that must fall through WITHOUT draining stdin.
    for index_state in ("fresh", "absent", "stale"):
      for label, override, payload in PAYLOADS:
        registry = json.loads(json.dumps(REGISTRY))
        if override and override.get("charclass"):
            registry["services"]["weird"] = {
                "name": "Weird", "territory": ["weird/[abc].txt"],
                "skill_path": "x", "last_sync": "2026-09-01T00:00:00Z",
            }
        work = base / f"{index_state}-{label}"
        if work.exists():
            shutil.rmtree(work)
        work.mkdir(parents=True)
        scripts = build_fixture(work, registry)

        # Fresh index per fixture, then made newer than the registry.
        subprocess.run([sys.executable, str(scripts / "build_territory_index.py"), str(work)],
                       capture_output=True, check=False)
        idx = scripts.parent / "cache" / "territory.index"
        reg = work / ".xtrm" / "skills" / "default" / "service-registry.json"
        if idx.exists():
            if index_state == "absent":
                idx.unlink()
            elif index_state == "stale":
                os.utime(idx, (reg.stat().st_atime - 10, reg.stat().st_mtime - 10))
            else:
                os.utime(idx, (reg.stat().st_atime + 10, reg.stat().st_mtime + 10))

        body = json.dumps(payload).replace("ROOT", str(work)).encode()

        for hook in HOOKS:
            argv_hook = [sys.executable, str(scripts / hook)] + (["check-hook"] if hook.startswith("drift") else [])
            mode = "post" if hook.startswith("drift") else "pre"
            argv_pf = ["/bin/sh", str(scripts / "hook_prefilter.sh"), mode, hook] + (
                ["check-hook"] if hook.startswith("drift") else [])

            before = run(argv_hook, work, body, work)
            after = run(argv_pf, work, body, work)

            if before.returncode == 1 and not before.stdout:
                # Hook refused the payload outright (drift_detector needs a subcommand);
                # nothing to compare.
                skipped += 1
                continue
            checked += 1
            if before.stdout != after.stdout:
                failures.append(
                    f"{index_state}/{label} [{hook}]\n"
                    f"  before: {before.stdout!r}\n  after:  {after.stdout!r}"
                )

    # Malformed / empty stdin must not crash either side.
    for raw in (b"", b"not json", b"{}", b'{"tool_name":"Read"}'):
        work = base / "malformed"
        scripts = build_fixture(work, json.loads(json.dumps(REGISTRY)))
        subprocess.run([sys.executable, str(scripts / "build_territory_index.py"), str(work)],
                       capture_output=True, check=False)
        for hook in HOOKS:
            argv_hook = [sys.executable, str(scripts / hook)] + (["check-hook"] if hook.startswith("drift") else [])
            mode = "post" if hook.startswith("drift") else "pre"
            argv_pf = ["/bin/sh", str(scripts / "hook_prefilter.sh"), mode, hook] + (
                ["check-hook"] if hook.startswith("drift") else [])
            b, a = run(argv_hook, work, raw, work), run(argv_pf, work, raw, work)
            checked += 1
            if b.stdout != a.stdout:
                failures.append(f"malformed {raw!r} [{hook}]\n  before: {b.stdout!r}\n  after:  {a.stdout!r}")
            if a.returncode not in (0, 1):
                failures.append(f"malformed {raw!r} [{hook}] prefilter rc={a.returncode}")

    print(f"compared: {checked}   skipped: {skipped}   failures: {len(failures)}")
    for f in failures:
        print("FAIL " + f)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())