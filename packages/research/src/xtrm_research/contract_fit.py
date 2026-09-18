"""System One contract fit: one service-knowledge and one sre-ops workload (XTRM-503).

    python -m xtrm_research.contract_fit --instances DIR --specs FILE --out FILE

A fit check, not a benchmark (operator constraint §10.4): the instances
have no gold labels, and n is too small for any metric with a useful
interval. What it establishes, per workload, is whether real state and the
question specs the workload needs are expressible in the contract, whether
a real backend answers them in contract shape (every answer is validated
against ``common.schema.json``), and which parts of the workload the
contract cannot express. Answers are sent through ``guards.guarded_send``.

A spec is run only on instances whose state carries every field its
instructions name; the others are recorded as not instantiated, with the
missing field — never filled in.
"""

from __future__ import annotations

import argparse
import json
import re
import time
from pathlib import Path
from typing import Any

import jsonschema

from xtrm_research.guards import GuardFailure, guarded_send
from xtrm_research.jev import DEFAULT_MODEL
from xtrm_research import schemas
from xtrm_research.schemas import validate

WORKLOADS = {"sk": "sk_instances.jsonl", "sre": "sre_instances.jsonl"}
_FIELD = re.compile(r"`([a-z_]+)`")


def answer_errors(answer: dict[str, Any], question_type: str) -> list[str]:
    """Validation errors of one answer against its ``common.schema.json`` def."""
    common = json.loads(
        Path(schemas.__file__)
        .with_name("common.schema.json")
        .read_text(encoding="utf-8")
    )
    schema = {"$ref": f"#/$defs/{question_type}_answer", "$defs": common["$defs"]}
    return [
        e.message for e in jsonschema.Draft202012Validator(schema).iter_errors(answer)
    ]


def to_contract_answer(raw: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in raw.items() if k != "type"}


def needed_fields(spec: dict[str, Any], state_keys: set[str]) -> set[str]:
    """Backticked names in the instructions that look like state fields;
    only names that are field-shaped and not option labels count."""
    options = set(spec.get("options") or [])
    return {f for f in _FIELD.findall(spec["instructions"]) if f not in options} - {
        "none"
    }


def jev_body(spec: dict[str, Any]) -> dict[str, Any]:
    body: dict[str, Any] = {"type": spec["type"], "instructions": spec["instructions"]}
    if spec["type"] == "choice":
        body["criteria"] = spec.get("criteria") or {o: None for o in spec["options"]}
    elif spec["type"] == "score":
        body["criteria"] = spec["criteria"]
    elif spec.get("criteria"):
        body["criteria"] = spec["criteria"]
    return body


def run(instances_dir: Path, specs: list[dict[str, Any]]) -> dict[str, Any]:
    for spec in specs:
        validate("question_spec", spec)
    result: dict[str, Any] = {"backend_model": DEFAULT_MODEL, "workloads": {}}
    for workload, filename in WORKLOADS.items():
        instances = [
            json.loads(line)
            for line in (instances_dir / filename)
            .read_text(encoding="utf-8")
            .splitlines()
            if line
        ]
        mine = [s for s in specs if s["id"].startswith(workload + ".")]
        report: dict[str, Any] = {
            "n_instances": len(instances),
            "specs": {},
            "calls": [],
        }
        for spec in mine:
            report["specs"][spec["id"]] = {
                "type": spec["type"],
                "instantiated": 0,
                "not_instantiated": {},
            }
        for inst in instances:
            keys = set(inst["state"])
            runnable = []
            for spec in mine:
                missing = needed_fields(spec, keys) - keys
                entry = report["specs"][spec["id"]]
                if missing:
                    for m in missing:
                        entry["not_instantiated"][m] = (
                            entry["not_instantiated"].get(m, 0) + 1
                        )
                else:
                    entry["instantiated"] += 1
                    runnable.append(spec)
            if not runnable:
                continue
            started = time.perf_counter()
            call: dict[str, Any] = {
                "instance": inst["id"],
                "questions": [s["id"] for s in runnable],
            }
            try:
                response = guarded_send(
                    {
                        "model": DEFAULT_MODEL,
                        "state": inst["state"],
                        "questions": {s["id"]: jev_body(s) for s in runnable},
                    },
                    "typesafe_system_one",
                )
            except GuardFailure as exc:
                report["calls"].append(
                    {**call, "status": "guard_failure", "guard": exc.guard}
                )
                continue
            except (
                Exception
            ) as exc:  # provider refusal is a fit finding, recorded verbatim
                report["calls"].append(
                    {
                        **call,
                        "status": "provider_error",
                        "error": f"{type(exc).__name__}: {str(exc)[:300]}",
                    }
                )
                continue
            answers = {k: to_contract_answer(v) for k, v in response["answers"].items()}
            call.update(
                status="answered",
                latency_ms=(time.perf_counter() - started) * 1000.0,
                model=response["model"],
                request_id=response.get("request_id"),
                usage=response["usage"],
                answers=answers,
                schema_errors={
                    s["id"]: answer_errors(answers[s["id"]], s["type"])
                    for s in runnable
                },
            )
            report["calls"].append(call)
        answered = [c for c in report["calls"] if c["status"] == "answered"]
        report["summary"] = {
            "calls": len(report["calls"]),
            "answered": len(answered),
            "answers_schema_valid": sum(
                1 for c in answered for e in c["schema_errors"].values() if not e
            ),
            "answers_schema_invalid": sum(
                1 for c in answered for e in c["schema_errors"].values() if e
            ),
        }
        result["workloads"][workload] = report
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--instances", type=Path, required=True)
    parser.add_argument("--specs", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    # each entry: {workload, decision, authority, state_shape, spec}
    entries = json.loads(args.specs.read_text(encoding="utf-8"))
    result = run(args.instances.expanduser(), [e["spec"] for e in entries])
    result["spec_context"] = {
        e["spec"]["id"]: {
            k: e[k] for k in ("workload", "decision", "authority", "state_shape")
        }
        for e in entries
    }
    out = args.out.expanduser()
    out.write_text(
        json.dumps(result, indent=1, sort_keys=True) + "\n", encoding="utf-8"
    )
    print(
        json.dumps({w: r["summary"] for w, r in result["workloads"].items()}, indent=1)
    )


if __name__ == "__main__":
    main()
