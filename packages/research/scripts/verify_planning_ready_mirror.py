#!/usr/bin/env python3
"""Independently verify the research mirror against the live Substrate CLI.

    ./.venv/bin/python scripts/verify_planning_ready_mirror.py --dataset DIR

This script lives outside `src/xtrm_research` on purpose. The package's only
remote seam is `guards.guarded_send` (enforced by tests/test_guards.py), so the
mirror itself must not shell out; the *verification* of the mirror does, and it
is an operator-run check whose report is written next to the frozen manifest.

It re-derives, for every sampled current revision, the deterministic findings
and the incumbent's readiness reasons through `sb --json issue show`, and writes
`mirror-verification.json` with the agreement counts and every disagreement.
"""

from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", default="~/.xtrm/research/datasets/planning-ready-v2")
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()

    dataset = Path(args.dataset).expanduser()
    units = [
        json.loads(line)
        for line in (dataset / "units.jsonl").read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    current = [u for u in units if u["is_current_revision"] and u["lifecycle_state"] == "open"]
    if args.limit:
        current = current[: args.limit]

    structure_agree = 0
    state_agree = 0
    checked = 0
    disagreements: list[dict[str, object]] = []
    for unit in current:
        result = subprocess.run(
            ["sb", "--json", "issue", "show", unit["locator"]],
            capture_output=True,
            text=True,
            check=False,
            timeout=60,
        )
        try:
            envelope = json.loads(result.stdout)
        except json.JSONDecodeError:
            disagreements.append({"locator": unit["locator"], "error": "unparseable sb output"})
            continue
        if not envelope.get("ok"):
            disagreements.append({"locator": unit["locator"], "error": str(envelope.get("error"))[:200]})
            continue
        data = envelope["data"]
        checked += 1

        mirror_findings = [
            f"{f['field']}: {f['message']}"
            for f in unit["deterministic"]["structural_findings"]
        ]
        incumbent_findings = [
            r for r in (data.get("reasons") or [])
            if not r.startswith("no current semantic attestation")
            and not r.startswith("unsatisfied blockers")
            and not r.startswith("an active claim")
            and not r.startswith("lifecycle is")
            and not r.startswith("deferred until")
            and not r.startswith("scrutiny policy")
        ]
        if set(mirror_findings) == set(incumbent_findings):
            structure_agree += 1

        derived = unit["incumbent_state"]["derived_readiness"]
        if derived["state"] == data.get("readinessState") and bool(derived["dispatchable"]) == bool(data.get("dispatchable")):
            state_agree += 1
        else:
            disagreements.append(
                {
                    "locator": unit["locator"],
                    "derived_state": derived["state"],
                    "incumbent_state": data.get("readinessState"),
                    "derived_dispatchable": derived["dispatchable"],
                    "incumbent_dispatchable": data.get("dispatchable"),
                    "derived_reasons": derived["reasons"],
                    "incumbent_reasons": data.get("reasons"),
                }
            )

    report = {
        "checked": checked,
        "structural_findings_agree": structure_agree,
        "structural_agreement_rate": (structure_agree / checked) if checked else None,
        "derived_state_agree": state_agree,
        "derived_state_agreement_rate": (state_agree / checked) if checked else None,
        "disagreements": disagreements,
        "method": "sb --json issue show per sampled current revision, compared against the frozen dataset mirror",
    }
    out = dataset / "mirror-verification.json"
    out.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({k: v for k, v in report.items() if k != "disagreements"}, indent=2, sort_keys=True))
    print(f"wrote {out}")
    return 0 if not disagreements else 1


if __name__ == "__main__":
    raise SystemExit(main())
