#!/usr/bin/env python3
"""Merge lane source registers into one corpus register + compute freeze-gate metrics.

Usage: python3 merge_register.py [lanes_dir]
Writes: ../source-register.json, ../source-register-summary.json
"""
import json, re, sys
from pathlib import Path

LANES = Path(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).parent / "lanes")
OUT = LANES.parent

CLASSIFICATIONS = [
    "canonical", "normative", "current-state-ledger", "programme-sequencing",
    "implementation-reference", "experiment", "evidence", "research",
    "historical", "superseded", "duplicate", "generated", "editorial-snapshot",
    "unclassified",
]

def _infer_repo(path):
    """Infer owning repo from register path when the lane omitted it."""
    p = str(path)
    if p.startswith("docs/design/") or p.startswith("docs/archive") or \
       p.startswith("docs/ARCHITECTURE") or p == "docs/architecture.md" or \
       p == "docs/TODO.md":
        return "specialists"
    if p.startswith("experiments/"):
        return "xtrm-wt/pr71-loader"
    return "xtrm"

def _norm_repo(val, path):
    """Normalize repository spellings across lanes to canonical slugs."""
    v = str(val or "")
    p = str(path or "")
    if "pr71" in v or "worktree" in v:
        return "worktree_pr71"
    if ".pi/agent/skills" in v or ".pi/agent/skills" in p:
        return "pi_skills"
    if "specialists" in v:
        return "specialists"
    if "/core" in v or v.endswith("core") or v == "core":
        return "core"
    if not v or v in ("None", "unknown"):
        # repo value silent -> infer from path
        if p.startswith(("docs/design/", "docs/archive")) or \
           p in ("docs/TODO.md", "docs/ARCHITECTURE.md", "docs/architecture.md"):
            return "specialists"
    if "xtmux" in v:
        return "xtmux"
    if "console" in v:
        return "console"
    return "xtrm"

def key(row):
    p = str(row.get("path", ""))
    if row.get("repository") == "pi_skills":
        import os
        dn = os.path.dirname(p)
        if "test-planning" in p:
            d = "test-planning"
        elif "planning" in dn or "/planning/" in p or dn == "planning":
            d = "planning"
        else:
            d = os.path.basename(dn)
        return f'pi_skills:{d}/{os.path.basename(p)}'
    return f'{row.get("repository","")}:{p}'

# Coordinator normalizations after direct verification (see reconciliation log):
# - two console docs skimmed by lane-i were fully read by coordinator -> complete
# - empty placeholder file -> complete
# - classification label aliases resolved to controlled vocabulary
NORMALIZE = {
    "specialists:docs/design/audit-reconcile-v0724.md": {
        "read_status": "complete", "classification": "editorial-snapshot",
        "_note": "empty 0-byte placeholder file"},
    "xtrm:docs/console/architecture/console-test-guards.md": {
        "read_status": "complete", "classification": "implementation-reference",
        "_note": "fully read by coordinator; guard checklist"},
    "xtrm:docs/console/architecture/apps-console-scaffold-preflight.md": {
        "read_status": "complete", "classification": "historical",
        "_note": "fully read by coordinator; gitboard-hosted bridge-era boundary ref; cites dead /home/dawid/second-mind paths"},
    "specialists:docs/design/roadmap/chains-prompt-evals.md": {
        "classification": "superseded",
        "_note": "superseded-historical overall; section 9 remains reference text of eval entity model until PRD consolidation"},
    "xtrm:docs/shared/xtrm-v1-runtime-reconciliation-and-termination-2026-08-09.md": {
        "classification": "normative",
        "_note": "accepted programme amendment with self-declared sunset; archive after plan correction"},
    "xtrm:docs/shared/native-chain-runtime-audit-2026-08-19/native-chain-runtime-prd-draft.md": {
        "classification": "normative",
        "_note": "DRAFT pending canonicalization; absorbed by docs/runtime/prd/native-chain-runtime.md"},
    "xtrm:docs/shared/native-chain-runtime-audit-2026-08-19/source-and-authority-register.md": {
        "classification": "evidence",
        "_note": "packet authority register; superseded by docs/runtime/reconciliation/source-register.json"},
    "xtrm:docs/shared/xtrm-current-execution-plan.md": {
        "classification": "canonical"},
    "xtrm:docs/shared/xtrm-local-coordinator-bootstrap.md": {
        "classification": "programme-sequencing",
        "_note": "stale pre-amendment duplication of plan gates; regenerate or archive"},
}

def main():
    merged = {}
    conflicts = []
    lane_files = sorted(LANES.glob("lane-*-source-register.json"))
    for lf in lane_files:
        data = json.loads(lf.read_text())
        rows = data if isinstance(data, list) else None
        if rows is None:
            for k in ("rows", "files", "entries", "sources"):
                if isinstance(data, dict) and isinstance(data.get(k), list):
                    rows = data[k]
                    break
        if rows is None:
            print(f"WARN: no row list found in {lf.name}; keys={list(data)[:10]}")
            rows = []
        for row in rows:
            # --- schema normalization across lanes ---
            p_raw = str(row.get("path") or "")
            p_clean = re.split(r"\s+\((?:excerpt|§|targeted|Workstream)", p_raw)[0].strip()
            if p_clean != p_raw:
                row["path"] = p_clean
                row["_path_note"] = p_raw
            row["repository"] = _norm_repo(row.get("repo") or row.get("repository"),
                                           p_clean)
            rs = row.get("read_status")
            if not rs or rs == "not_read":
                if row.get("read") == "complete" or row.get("read_completely") is True:
                    rs = "complete"
                elif row.get("read") or row.get("read_completely") is False:
                    rs = str(row.get("read") or "partial")
            if rs == "read-completely":
                rs = "complete"
            row["read_status"] = rs
            k = key(row)
            ov = NORMALIZE.get(k)
            if ov:
                for f2, v in ov.items():
                    if f2 == "_note":
                        row["notes"] = ((row.get("notes") or "") + "; " + v).lstrip("; ")
                    else:
                        row[f2] = v
            if k in merged:
                old = merged[k]
                for field in ("classification", "disposition"):
                    if row.get(field) and old.get(field) and row[field] != old[field]:
                        conflicts.append({"key": k, "field": field,
                                          "values": [old[field], row[field]],
                                          "sources": [old.get("_lane"), lf.name]})
                old.setdefault("_lanes", []).append(lf.name)
            else:
                row["_lane"] = lf.stem
                row["_lanes"] = [lf.name]
                merged[k] = row

    rows = list(merged.values())
    for r in rows:
        r["read_status"] = r.get("read_status", "not_read") or "not_read"
        r["classification"] = r.get("classification") or "unclassified"

    def count(pred):
        return sum(1 for r in rows if pred(r))

    summary = {
        "TOTAL_FILES": len(rows),
        "FULLY_READ": count(lambda r: r["read_status"] == "complete"),
        "PARTIAL": count(lambda r: r["read_status"] == "partial"),
        "UNREAD": count(lambda r: r["read_status"] == "not_read"),
        "UNCLASSIFIED": count(lambda r: r["classification"] == "unclassified"),
        "BY_CLASSIFICATION": {c: count(lambda r, c=c: r["classification"] == c)
                              for c in CLASSIFICATIONS},
        "BROKEN_LINKS_REPORTED": None,  # filled from lane-j-broken-links.json if present
        "AUTHORITY_CONFLICTS": len(conflicts),
        "REGISTER_CONFLICTS": conflicts,
        "LANES_MERGED": [p.name for p in lane_files],
    }
    bl = OUT / "lanes" / "lane-j-broken-links.json"
    if bl.exists():
        try:
            d = json.loads(bl.read_text())
            if isinstance(d, dict):
                for v in d.values():
                    if isinstance(v, list):
                        d = v
                        break
            summary["BROKEN_LINKS_REPORTED"] = len(d)
        except Exception as e:
            summary["BROKEN_LINKS_REPORTED"] = f"parse-error: {e}"

    (OUT / "source-register.json").write_text(json.dumps(rows, indent=2))
    (OUT / "source-register-summary.json").write_text(json.dumps(summary, indent=2))
    print(json.dumps({k: v for k, v in summary.items()
                      if k != "REGISTER_CONFLICTS"}, indent=2))
    if conflicts:
        print(f"\n{len(conflicts)} register conflicts to resolve:")
        for c in conflicts:
            print(f"  {c['key']} {c['field']}: {c['values']}")
    gate_fail = (summary["PARTIAL"] or summary["UNREAD"]
                 or summary["UNCLASSIFIED"] or summary["AUTHORITY_CONFLICTS"])
    print(f"\nFREEZE GATE: {'FAIL' if gate_fail else 'PASS'}")

if __name__ == "__main__":
    main()
