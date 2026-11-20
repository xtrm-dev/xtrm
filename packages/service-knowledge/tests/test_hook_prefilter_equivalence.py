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
from glob import glob
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from service_knowledge.cli.common import _DESIRED_HOOKS, _build_hook_entry  # noqa: E402


def _registered_pretooluse_command() -> str:
    """The exact command Claude Code runs, as produced by the installer wiring."""
    return _build_hook_entry(_DESIRED_HOOKS["PreToolUse"])["hooks"][0]["command"]

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
    # --- (1) JSON extraction: forms the awk scanner must not guess at ---
    ("json-space-before-colon", None, {"tool_name": "Read", "tool_input": {"file_path": " packages/core/src/a.py"}}),
    ("json-space-after-colon", None, {"tool_name": "Read", "tool_input": {"file_path": "packages/core/src/a.py"}}),
    # --- (2) path shapes python normalises differently ---
    ("path-double-slash", None, {"tool_name": "Read", "tool_input": {"file_path": "ROOT//packages/core/src/a.py"}}),
    ("path-trailing-slash", None, {"tool_name": "Read", "tool_input": {"file_path": "packages/core/src/a.py/"}}),
    # pathlib strips the trailing slash and fnmatch "*" crosses "/", so "a/b/x.tsx/"
    # matches "*.tsx". Found by the randomised fuzz, not by inspection.
    ("path-trailing-slash-root-glob", None, {"tool_name": "Read", "tool_input": {"path": "f.md/b/src/x.tsx/"}}),
    ("path-trailing-slash-root-glob-2", None, {"tool_name": "Edit", "tool_input": {"path": "g.js/x.tsx/"}}),
    ("path-trailing-slash-root-glob-3", None, {"tool_name": "NotebookRead", "tool_input": {"path": "other/packages/src/x.tsx/"}}),
    ("path-dot-segment", None, {"tool_name": "Read", "tool_input": {"file_path": "packages/./core/src/a.py"}}),
    ("path-parent-segment", None, {"tool_name": "Read", "tool_input": {"file_path": "packages/core/src/../src/a.py"}}),
    ("path-equals-root", None, {"tool_name": "Read", "tool_input": {"file_path": "ROOT"}}),
    # Out of territory for the stock registry, but IN territory for the registry the
    # "registry-changed-mtime-preserved" state installs. A stale index that is still
    # trusted would decide NO here and suppress a real hit -- this payload is what makes
    # the size-based freshness check load-bearing.
    ("future-territory-only", None, {"tool_name": "Read", "tool_input": {"file_path": "only/here/x.py"}}),
    ("future-territory-edit", None, {"tool_name": "Edit", "tool_input": {"file_path": "only/here/deep/y.py"}}),
]

# Raw payloads the dict form above cannot express (escapes, embedded newlines, repeats).
RAW_PAYLOADS = [
    ("json-backslash-escaped-path",
     b'{"tool_name":"Read","tool_input":{"file_path":"packages\\/core\\/src\\/a.py"}}'),
    ("json-newline-before-value",
     b'{"tool_name":"Read","tool_input":{"file_path":\n"packages/core/src/a.py"}}'),
    ("json-newline-after-colon",
     b'{"tool_name":"Read","tool_input":{"file_path":\n"packages/core/src/a.py"}}'),
    ("json-escaped-quote-in-path",
     b'{"tool_name":"Read","tool_input":{"file_path":"packages/core/src/a\\"b.py"}}'),
    ("json-repeated-key",
     b'{"tool_name":"Read","tool_input":{"file_path":"nope.py","file_path":"packages/core/src/a.py"}}'),
]


def build_fixture(root: Path, registry: dict) -> Path:
    pack = root / ".xtrm" / "skills" / "default" / "service-knowledge"
    (pack / "scripts").mkdir(parents=True, exist_ok=True)
    (root / ".xtrm" / "skills" / "default" / "service-registry.json").write_text(
        json.dumps(registry, indent=2), encoding="utf-8"
    )
    for name in ("hook_prefilter.sh", "skill_activator.py", "drift_detector.py",
                 "bootstrap.py", "build_territory_index.py", "_textio.py"):
        shutil.copy2(SRC / name, pack / "scripts" / name)
    (pack / "scripts" / "hook_prefilter.sh").chmod(0o755)
    subprocess.run(["git", "init", "-q", str(root)], check=False, capture_output=True)
    return pack / "scripts"


def run(cmd, cwd, payload: bytes, root: Path):
    env = {**os.environ, "CLAUDE_PROJECT_DIR": str(root)}
    return subprocess.run(cmd, cwd=str(cwd), input=payload, capture_output=True, env=env)


def main(argv: list[str] | None = None) -> int:
    # argv is injectable so the pytest entry point below is not at the mercy of pytest's
    # own sys.argv (where argv[1] would be a flag like "-q", resolved as a directory).
    args = argv if argv is not None else sys.argv[1:]
    base = Path(args[0]).resolve() if args else Path(tempfile.mkdtemp(prefix="pf-golden-"))
    failures, checked, skipped = [], 0, 0

    # Index states exercised for every payload. "fresh" is the normal path; "absent" and
    # "stale" are the fail-safe paths that must fall through WITHOUT draining stdin.
    # Index integrity states. Each must either be trusted (and match) or defer; none may
    # let the filter suppress a payload the hook acts on (review finding 3).
    for index_state in ("fresh", "absent", "stale-mtime", "truncated",
                        "registry-line-only", "partial-patterns",
                        "bad-count", "wrong-registry-size", "registry-changed-mtime-preserved"):
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
            good = idx.read_text(encoding="utf-8")
            head, *rest = good.rstrip("\n").split("\n")
            if index_state == "absent":
                idx.unlink()
            elif index_state == "stale-mtime":
                os.utime(idx, (reg.stat().st_atime - 10, reg.stat().st_mtime - 10))
            elif index_state == "truncated":
                idx.write_text("\n".join([head, *rest[:1]]) + "\n", encoding="utf-8")
            elif index_state == "registry-line-only":
                idx.write_text(head + "\n", encoding="utf-8")
            elif index_state == "partial-patterns":
                idx.write_text("\n".join([head, rest[0], rest[-1]]) + "\n", encoding="utf-8")
            elif index_state == "bad-count":
                parts = head.split(" ")
                parts[2] = str(int(parts[2]) + 5)
                idx.write_text("\n".join([" ".join(parts), *rest]) + "\n", encoding="utf-8")
            elif index_state == "wrong-registry-size":
                parts = head.split(" ")
                parts[1] = str(int(parts[1]) + 7)
                idx.write_text("\n".join([" ".join(parts), *rest]) + "\n", encoding="utf-8")
            elif index_state == "registry-changed-mtime-preserved":
                # A registry edited but carried across with its old mtime (cp -p / rsync -t
                # / tar). The index is still newer, so only the size check can catch this.
                d = json.loads(reg.read_text(encoding="utf-8"))
                d["services"] = {"core": {"name": "Core", "territory": ["only/here/**"],
                                           "skill_path": "x", "last_sync": "2026-09-01T00:00:00Z"}}
                reg.write_text(json.dumps(d, indent=2), encoding="utf-8")
                old = reg.stat().st_mtime - 100000
                os.utime(reg, (old, old))
            if idx.exists() and index_state != "registry-changed-mtime-preserved":
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

    # Raw (non-dict) payloads: escapes, embedded newlines, repeated keys.
    for index_state in ("fresh",):
      for label, raw in RAW_PAYLOADS:
        work = base / f"raw-{label}"
        if work.exists():
            shutil.rmtree(work)
        work.mkdir(parents=True)
        scripts = build_fixture(work, json.loads(json.dumps(REGISTRY)))
        subprocess.run([sys.executable, str(scripts / "build_territory_index.py"), str(work)],
                       capture_output=True, check=False)
        reg = work / ".xtrm" / "skills" / "default" / "service-registry.json"
        idx = scripts.parent / "cache" / "territory.index"
        if idx.exists():
            os.utime(idx, (reg.stat().st_atime + 10, reg.stat().st_mtime + 10))
        for hook in HOOKS:
            extra = ["check-hook"] if hook.startswith("drift") else []
            mode = "post" if hook.startswith("drift") else "pre"
            b = run([sys.executable, str(scripts / hook), *extra], work, raw, work)
            a = run(["/bin/sh", str(scripts / "hook_prefilter.sh"), mode, hook, *extra], work, raw, work)
            checked += 1
            if b.stdout != a.stdout:
                failures.append(f"{index_state}/{label} [{hook}]\n  before: {b.stdout!r}\n  after:  {a.stdout!r}")

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

    # --- A: freshness must key on CONTENT, not on size + mtime (review finding A) -------
    # A same-length territory edit (docs/** -> newd/**) leaves the file size identical,
    # and cp -p / rsync -t / tar leave the mtime older than the index, so size and mtime
    # both pass while the index describes a registry the hook no longer reads.
    for state in ("same-size-edit", "same-size-edit-post"):
        work = base / state
        if work.exists():
            shutil.rmtree(work)
        work.mkdir(parents=True)
        # "umbd/**" and "newd/**" are the same length, so swapping one for the other
        # leaves the registry byte-identical in size.
        reg_registry = {"version": "1.0", "services": {"core": {
            "name": "Core", "territory": ["umbd/**"], "skill_path": "x",
            "last_sync": "2026-09-01T00:00:00Z"}}}
        scripts = build_fixture(work, reg_registry)
        subprocess.run([sys.executable, str(scripts / "build_territory_index.py"), str(work)],
                       capture_output=True, check=False)
        reg = work / ".xtrm" / "skills" / "default" / "service-registry.json"
        idx = scripts.parent / "cache" / "territory.index"
        before_size = reg.stat().st_size
        if idx.exists():
            os.utime(idx, (reg.stat().st_atime + 10, reg.stat().st_mtime + 10))
        d = json.loads(reg.read_text(encoding="utf-8"))
        d["services"]["core"]["territory"] = ["newd/**"]
        reg.write_text(json.dumps(d, indent=2), encoding="utf-8")
        assert reg.stat().st_size == before_size, (
            f"test bug: size must be unchanged ({before_size} -> {reg.stat().st_size})")
        old = 1500000000
        os.utime(reg, (old, old))
        if idx.exists():
            os.utime(idx, (old + 10, old + 10))   # index still looks newer
        body = json.dumps({"tool_name": "Edit", "tool_input": {"file_path": "newd/x.py"}}).encode()
        for hook, extra, mode in (("skill_activator.py", [], "pre"),
                                  ("drift_detector.py", ["check-hook"], "post")):
            b = run([sys.executable, str(scripts / hook), *extra], work, body, work)
            a = run(["/bin/sh", str(scripts / "hook_prefilter.sh"), mode, hook, *extra],
                    work, body, work)
            checked += 1
            if b.stdout != a.stdout:
                failures.append(
                    f"finding-A/{state} [{hook}]: registry content changed with an unchanged "
                    f"size and an older mtime, and the pre-filter suppressed the hook's "
                    f"output\n  before: {b.stdout!r}\n  after:  {a.stdout!r}")

    # --- B: a registry that OUTRANKS the indexed one must invalidate the index ---------
    # bootstrap.get_registry_path() prefers the umbrella-owned registry, so creating one
    # after the index was built silently changes which file the hook reads.
    work = base / "higher-precedence"
    if work.exists():
        shutil.rmtree(work)
    work.mkdir(parents=True)
    scripts = build_fixture(work, json.loads(json.dumps(REGISTRY)))
    subprocess.run([sys.executable, str(scripts / "build_territory_index.py"), str(work)],
                   capture_output=True, check=False)
    reg = work / ".xtrm" / "skills" / "default" / "service-registry.json"
    idx = scripts.parent / "cache" / "territory.index"
    if idx.exists():
        os.utime(idx, (reg.stat().st_atime + 10, reg.stat().st_mtime + 10))
    umbrella = scripts.parent / "service-registry.json"
    umbrella.write_text(json.dumps({"version": "1.0", "services": {"umb": {
        "name": "Umb", "territory": ["umb/**"], "skill_path": "u",
        "last_sync": "2026-09-01T00:00:00Z"}}}, indent=2), encoding="utf-8")
    body = json.dumps({"tool_name": "Edit", "tool_input": {"file_path": "umb/x.py"}}).encode()
    for hook, extra, mode in (("skill_activator.py", [], "pre"),
                              ("drift_detector.py", ["check-hook"], "post")):
        b = run([sys.executable, str(scripts / hook), *extra], work, body, work)
        a = run(["/bin/sh", str(scripts / "hook_prefilter.sh"), mode, hook, *extra],
                work, body, work)
        checked += 1
        if b.stdout != a.stdout:
            failures.append(
                f"finding-B [{hook}]: a higher-precedence registry appeared after the "
                f"index was built and the pre-filter suppressed the hook's output\n"
                f"  before: {b.stdout!r}\n  after:  {a.stdout!r}")

    # --- (4) the pre-filter must not leave payload residue on disk (review finding 4) --
    glob("/tmp/sk-prefilter.*.json")
    work = base / "residue"
    scripts = build_fixture(work, json.loads(json.dumps(REGISTRY)))
    subprocess.run([sys.executable, str(scripts / "build_territory_index.py"), str(work)],
                   capture_output=True, check=False)
    reg = work / ".xtrm" / "skills" / "default" / "service-registry.json"
    idx = scripts.parent / "cache" / "territory.index"
    if idx.exists():
        os.utime(idx, (reg.stat().st_atime + 10, reg.stat().st_mtime + 10))
    hit = json.dumps({"tool_name": "Read", "tool_input": {"file_path": "packages/core/src/a.py"}}).encode()
    for hook, extra, mode in (("skill_activator.py", [], "pre"), ("drift_detector.py", ["check-hook"], "post")):
        run(["/bin/sh", str(scripts / "hook_prefilter.sh"), mode, hook, *extra], work, hit, work)
    leftover = glob("/tmp/sk-prefilter.*.json") + glob(f"{os.environ.get('TMPDIR', '/tmp')}/sk-prefilter.*.json")
    checked += 1
    if leftover:
        failures.append(f"pre-filter left {len(leftover)} payload temp file(s) behind, "
                        f"e.g. {sorted(leftover)[0]}")

    # --- (5) a missing pre-filter must fall through to the hook, never disable it -----
    # The registered command used to exit 0 when hook_prefilter.sh was absent, which
    # silently dropped evidence bundles AND the Write/Edit blocking gate.
    work = base / "no-prefilter"
    scripts = build_fixture(work, json.loads(json.dumps(REGISTRY)))
    os.unlink(scripts / "hook_prefilter.sh")
    cmd = _registered_pretooluse_command()
    out = run(["/bin/sh", "-c", cmd], work, hit, work)
    checked += 1
    if not out.stdout:
        failures.append("registered hook produced NO output when hook_prefilter.sh is missing "
                        "(the pre-filter must fall through, not disable the hook)")

    # --- (2) root resolution variations must all preserve output (review finding 2) ----
    work = base / "roots"
    scripts = build_fixture(work, json.loads(json.dumps(REGISTRY)))
    subprocess.run([sys.executable, str(scripts / "build_territory_index.py"), str(work)],
                   capture_output=True, check=False)
    reg = work / ".xtrm" / "skills" / "default" / "service-registry.json"
    idx = scripts.parent / "cache" / "territory.index"
    if idx.exists():
        os.utime(idx, (reg.stat().st_atime + 10, reg.stat().st_mtime + 10))
    link = base / "roots-link"
    if link.is_symlink() or link.exists():
        link.unlink()
    link.symlink_to(work)
    root_cases = {
        "normal": {"CLAUDE_PROJECT_DIR": str(work)},
        "trailing-slash-root": {"CLAUDE_PROJECT_DIR": str(work) + "/"},
        "symlinked-root": {"CLAUDE_PROJECT_DIR": str(link)},
        "root-unset": {},
        "service-registry-path": {
            "CLAUDE_PROJECT_DIR": str(work),
            "SERVICE_REGISTRY_PATH": str(reg),
        },
    }
    for case, extra_env in root_cases.items():
        body = json.dumps({"tool_name": "Read",
                           "tool_input": {"file_path": f"{work}/packages/core/src/a.py"}}).encode()
        env = {k: v for k, v in os.environ.items() if k != "CLAUDE_PROJECT_DIR"}
        env.pop("SERVICE_REGISTRY_PATH", None)
        env.update(extra_env)
        argv = ["/bin/sh", str(scripts / "hook_prefilter.sh"), "pre", "skill_activator.py"]
        before = subprocess.run([sys.executable, str(scripts / "skill_activator.py")],
                                input=body, capture_output=True, env=env, cwd=str(work))
        after = subprocess.run(argv, input=body, capture_output=True, env=env, cwd=str(work))
        checked += 1
        if before.stdout != after.stdout:
            failures.append(f"root-case {case}\n  before: {before.stdout!r}\n  after:  {after.stdout!r}")

    print(f"compared: {checked}   skipped: {skipped}   failures: {len(failures)}")
    for f in failures:
        print("FAIL " + f)
    return 1 if failures else 0


def test_prefilter_equivalence() -> None:
    """Collected entry point.

    This file is primarily a script, so without an explicit ``test_*`` function pytest
    collects nothing from it and the whole equivalence suite silently never runs. An
    empty argv keeps the run off pytest's own arguments; the suite builds its own
    throwaway fixtures and needs no path.
    """
    assert main([]) == 0


if __name__ == "__main__":
    sys.exit(main())