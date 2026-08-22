#!/usr/bin/env python3
"""Merge lane source registers into one corpus register + compute freeze-gate metrics.

Usage: python3 merge_register.py [lanes_dir]
Writes: ../source-register.json, ../source-register-summary.json
"""
import json, sys
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

def key(row):
    return f'{row.get("repository","")}:{row.get("path","")}'

def main():
    merged = {}
    conflicts = []
    lane_files = sorted(LANES.glob("lane-*-source-register.json"))
    for lf in lane_files:
        data = json.loads(lf.read_text())
        rows = data if isinstance(data, list) else data.get("rows", data.get("files", []))
        for row in rows:
            # --- schema normalization across lanes ---
            if not row.get("repository"):
                p = row.get("path", "")
                row["repository"] = row.get("repo") or _infer_repo(p)
            rs = row.get("read_status")
            if not rs or rs == "not_read":
                if row.get("read") == "complete" or row.get("read_completely") is True:
                    rs = "complete"
                elif row.get("read") or row.get("read_completely") is False:
                    rs = str(row.get("read") or "partial")
            row["read_status"] = rs
            k = key(row)
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
