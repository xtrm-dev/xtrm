#!/usr/bin/env python3
"""
Standalone service-knowledge git-hook + migration installer (runtime-agnostic fallback).

> NORMAL PATH: ``service-knowledge install`` (the package CLI) vendors the machinery and
> calls this script with ``--hooks-only`` to wire the non-blocking git reminders. You only
> need to run this file directly when the ``service-knowledge`` CLI cannot be installed.

Run from inside your target project directory. Idempotent. It only:
  - installs the non-blocking git pre-commit/pre-push/post-merge doc + staleness reminders
  - (full mode) migrates the pack layout, upgrades per-service SKILL.md, regenerates the
    per-repo ``<repo>-service-knowledge`` umbrella

The Claude SessionStart/PreToolUse/PostToolUse hooks are wired by the CLI into
``.claude/settings.json`` (project-local machinery under ``.xtrm/skills/default/service-knowledge``).
"""

import json
import os
import subprocess
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent.resolve()            # .../service-knowledge/install/
GIT_HOOKS  = SCRIPT_DIR / "git-hooks"                   # install/git-hooks/
SCRIPTS    = SCRIPT_DIR.parent / "scripts"             # .../service-knowledge/scripts/ (location-independent)

GREEN  = "\033[0;32m"
YELLOW = "\033[1;33m"
NC     = "\033[0m"

MARKER_DOC        = "# [jaggers] doc-reminder"
MARKER_STALENESS  = "# [jaggers] skill-staleness"
MARKER_DRIFT_SWEEP = "# [jaggers] drift-sweep"
MARKER_CHAIN      = "# [jaggers] chain-githooks"

NEW_UMBRELLA = "service-knowledge"
LEGACY_UMBRELLA = "service-skills"


def get_project_root() -> Path:
    try:
        r = subprocess.run(["git", "rev-parse", "--show-toplevel"],
                           capture_output=True, text=True, check=True, timeout=5)
        return Path(r.stdout.strip())
    except subprocess.CalledProcessError:
        print("Error: not inside a git repository.")
        sys.exit(1)


def install_git_hooks(project_root: Path) -> None:
    print("\n── Git hooks ───────────────────────────")
    doc_script       = GIT_HOOKS / "doc_reminder.py"
    staleness_script = GIT_HOOKS / "skill_staleness.py"
    drift_script     = GIT_HOOKS / "post_merge_drift_sweep.py"

    pre_commit = project_root / ".githooks" / "pre-commit"
    pre_push   = project_root / ".githooks" / "pre-push"
    post_merge = project_root / ".githooks" / "post-merge"

    for hp in (pre_commit, pre_push, post_merge):
        if not hp.exists():
            hp.parent.mkdir(parents=True, exist_ok=True)
            hp.write_text("#!/usr/bin/env bash\n", encoding="utf-8")
            hp.chmod(0o755)

    snippets = [
        (pre_commit, MARKER_DOC,
         f"\n{MARKER_DOC}\nif command -v python3 &>/dev/null && [ -f \"{doc_script}\" ]; then\n    python3 \"{doc_script}\" || true\nfi\n"),
        (pre_push, MARKER_STALENESS,
         f"\n{MARKER_STALENESS}\nif command -v python3 &>/dev/null && [ -f \"{staleness_script}\" ]; then\n    python3 \"{staleness_script}\" || true\nfi\n"),
        (post_merge, MARKER_DRIFT_SWEEP,
         f"\n{MARKER_DRIFT_SWEEP}\nif command -v python3 &>/dev/null && [ -f \"{drift_script}\" ]; then\n    python3 \"{drift_script}\" || true\nfi\n"),
    ]

    for hook_path, marker, snippet in snippets:
        content = hook_path.read_text(encoding="utf-8")
        if marker not in content:
            hook_path.write_text(content + snippet, encoding="utf-8")
            print(f"{GREEN}  ✓{NC} {hook_path.relative_to(project_root)}")
        elif snippet not in content:
            start = content.index(marker)
            end = content.find("\n# [jaggers]", start + len(marker))
            hook_path.write_text(content[:start] + snippet.lstrip("\n") + content[end if end >= 0 else len(content):], encoding="utf-8")
            print(f"{GREEN}  ✓{NC} updated: {hook_path.name}")
        else:
            print(f"{YELLOW}  ○{NC} already installed: {hook_path.name}")

    hooks_path = ""
    try:
        r = subprocess.run(["git", "config", "--get", "core.hooksPath"], cwd=project_root,
                           capture_output=True, text=True, timeout=5, check=False)
        if r.returncode == 0:
            hooks_path = r.stdout.strip()
    except Exception:
        hooks_path = ""

    if hooks_path:
        active_hooks_dir = Path(hooks_path) if Path(hooks_path).is_absolute() else project_root / hooks_path
    else:
        # Use git-resolved hooks path — handles linked worktrees where .git is a file not a dir
        try:
            resolved = subprocess.check_output(["git", "-C", str(project_root), "rev-parse", "--git-path", "hooks"], text=True).strip()
            active_hooks_dir = Path(resolved) if Path(resolved).is_absolute() else project_root / resolved
        except Exception:
            active_hooks_dir = project_root / ".git" / "hooks"
    activation_targets = {active_hooks_dir}

    for hooks_dir in activation_targets:
        hooks_dir.mkdir(parents=True, exist_ok=True)
        for name, source_hook in (("pre-commit", pre_commit), ("pre-push", pre_push), ("post-merge", post_merge)):
            target_hook = hooks_dir / name
            if not target_hook.exists():
                target_hook.write_text("#!/usr/bin/env bash\n", encoding="utf-8")
            target_hook.chmod(0o755)
            if target_hook.resolve() == source_hook.resolve():
                continue
            chain_snippet = (
                f"\n{MARKER_CHAIN}\n"
                f"if [ -x \"{source_hook}\" ]; then\n"
                f"    \"{source_hook}\" \"$@\"\n"
                "fi\n"
            )
            target_content = target_hook.read_text(encoding="utf-8")
            if MARKER_CHAIN not in target_content:
                target_hook.write_text(target_content + chain_snippet, encoding="utf-8")

    print(f"{GREEN}  ✓{NC} activated in .git/hooks/")


RESERVED_PACK_NAMES = {"default", "optional", "user", "active", "local-legacy"}


def _pack_roots(project_root: Path) -> list[Path]:
    skills_root = project_root / ".xtrm" / "skills"
    return [skills_root, skills_root / "user" / "packs"]


def _packs_with_registry(project_root: Path) -> list[Path]:
    """Packs that carry a service registry; new umbrella name wins over legacy/v1 shim."""
    out: list[Path] = []
    seen: set[Path] = set()
    for packs_root in _pack_roots(project_root):
        if not packs_root.exists():
            continue
        for pack in sorted(p for p in packs_root.iterdir() if p.is_dir() and p.name not in RESERVED_PACK_NAMES):
            resolved = pack.resolve()
            if resolved in seen:
                continue
            has_registry = (
                (pack / NEW_UMBRELLA / "service-registry.json").exists()
                or (pack / LEGACY_UMBRELLA / "service-registry.json").exists()
                or (pack / "service-registry.json").exists()
            )
            if has_registry:
                seen.add(resolved)
                out.append(pack)
    return out


def _pack_registry(pack: Path) -> Path | None:
    for name in (NEW_UMBRELLA, LEGACY_UMBRELLA):
        candidate = pack / name / "service-registry.json"
        if candidate.exists():
            return candidate
    old = pack / "service-registry.json"
    return old if old.exists() else None


def migrate_existing_skills(project_root: Path) -> None:
    """Upgrade already-installed per-service SKILL.md files to the current canonical
    section set (idempotent, SEMANTIC-preserving)."""
    print("\n── Migrate existing skills ─────────────")
    migrator = SCRIPTS / "skill_migrator.py"
    packs = _packs_with_registry(project_root)
    if not migrator.exists() or not packs:
        print(f"{YELLOW}  ○{NC} nothing to migrate (no registry or migrator)")
        return
    changed = 0
    for pack in packs:
        registry = _pack_registry(pack)
        if registry is None:
            continue
        try:
            services = json.loads(registry.read_text(encoding="utf-8")).get("services", {})
        except json.JSONDecodeError:
            print(f"{YELLOW}  ○{NC} registry malformed in pack '{pack.name}'; skipping")
            continue
        for service_id, info in services.items():
            skill_rel = info.get("skill_path")
            if not skill_rel:
                continue
            skill_md = project_root / skill_rel
            if not skill_md.exists():
                continue
            r = subprocess.run(["python3", str(migrator), str(skill_md)],
                               capture_output=True, text=True, check=False)
            if r.returncode == 0 and r.stdout.strip().startswith("migrated:"):
                changed += 1
                print(f"{GREEN}  ✓{NC} upgraded {service_id} → devops sections")
    if changed == 0:
        print(f"{GREEN}  ✓{NC} all service skills already current")


def generate_umbrellas(project_root: Path) -> None:
    """Generate/refresh the per-repo umbrella SKILL.md (``<repo>-service-knowledge``)."""
    print("\n── Umbrella ────────────────────────────")
    generator = SCRIPTS / "umbrella_generator.py"
    packs = _packs_with_registry(project_root)
    if not generator.exists() or not packs:
        print(f"{YELLOW}  ○{NC} nothing to generate (no generator or packs)")
        return
    repo_name = project_root.name
    wrote = 0
    for pack in packs:
        env = {**os.environ, "XTRM_PACK": pack.name}
        r = subprocess.run(["python3", str(generator), repo_name],
                           cwd=str(project_root), env=env, capture_output=True, text=True, check=False)
        if r.returncode == 0 and r.stdout.strip().startswith("generated:"):
            wrote += 1
            print(f"{GREEN}  ✓{NC} umbrella refreshed for pack '{pack.name}' → {repo_name}-service-knowledge")
    if wrote == 0:
        print(f"{GREEN}  ✓{NC} all umbrellas already current")


def main() -> None:
    project_root = get_project_root()

    if "--hooks-only" in sys.argv[1:]:
        install_git_hooks(project_root)
        return

    print(f"Installing into: {project_root}")
    install_git_hooks(project_root)
    migrate_existing_skills(project_root)
    generate_umbrellas(project_root)
    print(f"\n{GREEN}Done.{NC}")
    print("  Migration applied. For the full, foolproof path use the package CLI:")
    print("      service-knowledge install")


if __name__ == "__main__":
    main()
