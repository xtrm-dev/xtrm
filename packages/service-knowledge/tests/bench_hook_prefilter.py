#!/usr/bin/env python3
"""Replay harness for the service-knowledge hook cost (XTRM-556).

Measures per-call wall time for both hooks before and after the pre-filter, using the
N=50 replay method of xtrm-dev/core#678 (CORE-2339, scripts/hook-bench): the same payloads
are replayed N times per configuration and the mean / p95 are reported.

The payload set mirrors production shape, weighted towards the common case:
out-of-territory file reads dominate a real session, with in-territory edits, Bash, and a
drift case (Edit into registered territory) represented so the "expensive" paths stay honest.

Must run under ``nice -n 19`` on the shared host.

usage: nice -n 19 python3 tests/bench_hook_prefilter.py [--n 50] [--json OUT]
"""

import argparse
import json
import os
import shutil
import statistics
import subprocess
import sys
import tempfile
import time
from pathlib import Path

SRC = Path(__file__).resolve().parent.parent / "src" / "service_knowledge" / "scripts"

REGISTRY = {
    "version": "1.0",
    "services": {
        "core": {"name": "Core", "territory": ["packages/core/src/**"],
                 "skill_path": "x", "last_sync": "2026-09-01T00:00:00Z"},
        "webui": {"name": "Web UI", "territory": ["apps/web/**", "*.tsx"],
                  "skill_path": "y", "last_sync": "2026-09-01T00:00:00Z"},
    },
}


def payloads(root: Path) -> list[tuple[str, bytes]]:
    """Production-shaped replay set: mostly out-of-territory, with the costly paths present."""
    def p(tool, key, val):
        return json.dumps({"tool_name": tool, "tool_input": {key: val}}).encode()

    out = []
    # Out-of-territory reads/writes: the dominant real-world case (60%).
    for path in ("README.md", "docs/guide/intro.md", "apps/api/main.go",
                 "packages/ui/src/x.go", "scripts/deploy.sh", "docs/adr/0001.md"):
        for tool in ("Read", "Write"):
            out.append((f"out-of-territory-{tool}-{path}", p(tool, "file_path", path)))
    # Glob / Grep (no file_path): 10%.
    for tool in ("Glob", "Grep"):
        out.append((f"glob-{tool}", json.dumps({"tool_name": tool, "tool_input": {"pattern": "**/*.py"}}).encode()))
    # In-territory reads and edits: 20%.
    for path in ("packages/core/src/a.py", "apps/web/src/app.ts"):
        out.append((f"in-territory-Read-{path}", p("Read", "file_path", path)))
        out.append((f"in-territory-Edit-{path}", p("Edit", "file_path", path)))
    # Bash: 5%.
    out.append(("bash-read", json.dumps({"tool_name": "Bash", "tool_input": {"command": "cat README.md"}}).encode()))
    out.append(("bash-mutating", json.dumps({"tool_name": "Bash", "tool_input": {"command": "rm -rf build"}}).encode()))
    # Drift case: Edit into registered territory, PostToolUse.
    out.append(("drift-edit", p("Edit", "file_path", "packages/core/src/x.py")))
    return out


def setup(root: Path) -> Path:
    scripts = root / ".xtrm" / "skills" / "default" / "service-knowledge" / "scripts"
    scripts.mkdir(parents=True)
    (root / ".xtrm" / "skills" / "default" / "service-registry.json").write_text(json.dumps(REGISTRY, indent=2))
    # This list is a partial vendored install: every sibling module bootstrap.py imports
    # must be here, or the fixture dies with ModuleNotFoundError instead of testing hooks.
    for name in ("hook_prefilter.sh", "skill_activator.py", "drift_detector.py",
                 "bootstrap.py", "build_territory_index.py", "_textio.py"):
        shutil.copy2(SRC / name, scripts / name)
    (scripts / "hook_prefilter.sh").chmod(0o755)
    subprocess.run([sys.executable, str(scripts / "build_territory_index.py"), str(root)],
                   capture_output=True, check=False)
    reg = root / ".xtrm" / "skills" / "default" / "service-registry.json"
    idx = scripts.parent / "cache" / "territory.index"
    if idx.exists():
        os.utime(idx, (reg.stat().st_atime + 10, reg.stat().st_mtime + 10))
    return scripts


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=50)
    ap.add_argument("--json", type=str, default="")
    args = ap.parse_args()

    base = Path(tempfile.mkdtemp(prefix="hook-bench-"))
    results = []
    try:
        for hook, extra in (("skill_activator.py", []), ("drift_detector.py", ["check-hook"])):
            # Interleave before/after on the SAME fixture and the SAME payload loop: the
            # shared host load drifts by minutes at a time, so a sequential before-then-
            # after pair is not comparable. Alternating every payload makes any drift
            # hit both sides roughly equally.
            root = base / hook
            root.mkdir(parents=True)
            scripts = setup(root)
            pl = payloads(root)
            env = {**os.environ, "CLAUDE_PROJECT_DIR": str(root)}
            mode = "post" if hook.startswith("drift") else "pre"
            argv_before = [sys.executable, str(scripts / hook), *extra]
            argv_after = ["/bin/sh", str(scripts / "hook_prefilter.sh"), mode, hook, *extra]
            for a in (argv_before, argv_after):
                for _l, body in pl:
                    subprocess.run(a, input=body, capture_output=True, env=env, cwd=str(root))

            samples = {"before": {l: [] for l, _ in pl}, "after": {l: [] for l, _ in pl}}
            for i in range(args.n):
                # Alternate which side goes first to cancel ordering bias too.
                order = (("before", argv_before), ("after", argv_after))
                if i % 2:
                    order = (("after", argv_after), ("before", argv_before))
                for label, body in pl:
                    for side, argv in order:
                        t0 = time.perf_counter()
                        subprocess.run(argv, input=body, capture_output=True, env=env, cwd=str(root))
                        samples[side][label].append((time.perf_counter() - t0) * 1000.0)

            for side in ("before", "after"):
                r = summarize(hook, side, samples[side])
                results.append(r)
                print(f"{r['side']:>6} {hook:22} mean={r['mean_ms']:7.2f} ms  p95={r['p95_ms']:7.2f} ms"
                      f"  (out-of-territory mean={r['out_of_territory_mean_ms']} ms)"
                      f"  drift-edit={r['drift_mean_ms']} ms  calls={r['calls']}")
            shutil.rmtree(root, ignore_errors=True)
    finally:
        shutil.rmtree(base, ignore_errors=True)

    if args.json:
        Path(args.json).write_text(json.dumps(results, indent=2), encoding="utf-8")
        print(f"wrote {args.json}")
    return 0


def summarize(hook: str, side: str, per_payload: dict) -> dict:
    def pct(vals, q):
        vals = sorted(vals)
        return vals[max(0, min(len(vals) - 1, int(round(q * (len(vals) - 1)))))]

    t_all = [v for vs in per_payload.values() for v in vs]
    out_of = [v for l, vs in per_payload.items() if l.startswith("out-of-territory") for v in vs]
    drift = per_payload.get("drift-edit", [])
    return {
        "hook": hook,
        "side": side,
        "calls": len(t_all),
        "mean_ms": round(statistics.mean(t_all), 2),
        "p95_ms": round(pct(t_all, 0.95), 2),
        "min_ms": round(min(t_all), 2),
        "out_of_territory_mean_ms": round(statistics.mean(out_of), 2) if out_of else None,
        "out_of_territory_p95_ms": round(pct(out_of, 0.95), 2) if out_of else None,
        "drift_mean_ms": round(statistics.mean(drift), 2) if drift else None,
        "by_payload": {l: round(statistics.mean(v), 2) for l, v in per_payload.items()},
        # On a shared, saturated host the minimum is the best available estimator of
        # unloaded cost; the mean carries contention that both sides share equally.
        "by_payload_min": {l: round(min(v), 2) for l, v in per_payload.items()},
        "out_of_territory_min_ms": round(min(out_of), 2) if out_of else None,
        "drift_min_ms": round(min(drift), 2) if drift else None,
    }


if __name__ == "__main__":
    sys.exit(main())