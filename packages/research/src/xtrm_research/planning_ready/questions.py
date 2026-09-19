"""The frozen System One battery for the Planning Ready contract (Jira XTRM-99 c.13435).

Every Noul carries explicit ``criteria.true`` / ``criteria.false`` boundaries.
No Score is used: the Planning Ready policy has no ordinal dimension (operator
constraint 7). The one Choice is ``execution_mode``.

State discipline (c.13435 "State must match the question"):

- the state carries the ticket, the contract revision, and the Ready contract
  standard as it stood when the battery was frozen;
- deterministic diagnostics are **not** in the state — they are a separate
  channel composed by policy, so a semantic judgment cannot be anchored by a
  structural finding it is not being asked about;
- coordination and dispatch state (sibling work, active claims, the actual
  dispatch prompt) is not instantiated: those questions are not asked, and the
  absence is recorded in the run manifest rather than silently inferred.
"""

from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Any

#: The Ready contract standard the battery is judged against, reproduced from
#: the Planning skill's references at freeze time. The source paths and their
#: hashes are recorded so a later standard change is visible in the evidence.
STANDARD_SOURCES = (
    "/home/dawid/.pi/agent/skills/planning/SKILL.md",
    "/home/dawid/.pi/agent/skills/planning/references/contracts.md",
    "/home/dawid/.pi/agent/skills/planning/references/test-strategy.md",
)

STANDARD = """\
XTRM READY WORK CONTRACT (authority: the Planning skill's contract reference)

A dispatchable work item answers, in prose a fresh competent worker can act on
without the chat transcript that produced it:

PROBLEM      why this exists: the defect, missing capability, or decision pressure.
SUCCESS      observable conditions that mean the work is complete.
SCOPE        owned files/systems/behaviours, specific enough to prevent expansion.
NON_GOALS    nearby work deliberately excluded.
CONSTRAINTS  compatibility, safety, ownership, architecture, rollout invariants.
VALIDATION   exact checks/evidence expected, including integrated behaviour where it matters.
OUTPUT       the durable result the worker must leave.

Optional sections: LIBRARIES, REFERENCES, SCRUTINY, TELEMETRY, ROLLBACK, DEPENDENCIES.

Rules:
- A contract must tell the recipient what must be true; it must not micromanage an
  implementation that has not been investigated. Prescribe a mechanism only when the
  mechanism is itself a constraint.
- Static checks alone do not prove integrated behaviour.
- A weak contract may not be compensated by a second, private prompt at dispatch time.
- A draft may not be dispatched; a draft's unknown sections explicitly say they need
  exploration.
"""


def standard_provenance() -> dict[str, Any]:
    out: list[dict[str, Any]] = []
    for path in STANDARD_SOURCES:
        p = Path(path)
        entry: dict[str, Any] = {"path": path, "exists": p.is_file()}
        if p.is_file():
            entry["sha256"] = "sha256:" + hashlib.sha256(p.read_bytes()).hexdigest()
        out.append(entry)
    return {
        "sources": out,
        "standard_sha256": "sha256:"
        + hashlib.sha256(STANDARD.encode("utf-8")).hexdigest(),
    }


def _noul(true: str, false: str) -> dict[str, Any]:
    return {"type": "noul", "criteria": {"true": true, "false": false}}


#: The atomic readiness battery. Order is the order questions are sent and
#: rendered; the names are the primitive names used in metrics and policy.
ATOMIC_QUESTIONS: dict[str, dict[str, Any]] = {
    "problem_actionable": _noul(
        "PROBLEM names a real defect, missing capability, or decision pressure in prose: "
        "a fresh worker learns what is wrong or missing and why it matters, and can start investigating.",
        "PROBLEM is a category label, a restatement of the title, an intention, or otherwise leaves "
        "no problem a worker can act on.",
    ),
    "success_observable": _noul(
        "SUCCESS names conditions an operator can observe to decide the work is complete: a check, "
        "artifact, or observable behaviour that would differ from now once the work is done.",
        "SUCCESS restates the goal or the problem, states a feeling or intention, or names something "
        "nobody could observe to decide completion.",
    ),
    "scope_bounded": _noul(
        "SCOPE names the owned files, systems, or behaviours specifically enough to prevent accidental "
        "expansion: a worker can tell what is inside the work and what is not.",
        "SCOPE is generic (for example 'the relevant code'), permits unbounded expansion, or omits "
        "what is owned.",
    ),
    "non_goals_effective": _noul(
        "NON_GOALS excludes real nearby work that a worker might otherwise reasonably include.",
        "NON_GOALS is a formality: it restates SCOPE, states 'none' or an empty alternative, or excludes "
        "nothing a worker would plausibly consider.",
    ),
    "constraints_actionable": _noul(
        "CONSTRAINTS states real invariants (compatibility, safety, ownership, architecture, rollout) "
        "that change what a correct implementation may do.",
        "CONSTRAINTS restates the plan or SCOPE, or states nothing that binds the implementation.",
    ),
    "validation_proves_success": _noul(
        "VALIDATION demonstrates the claimed SUCCESS: the named checks would fail if the success "
        "condition were not achieved, including integrated behaviour where the change crosses a boundary.",
        "VALIDATION does not demonstrate SUCCESS: for example only static checks (lint, typecheck, build) "
        "for a behavioural change, or checks unrelated to the success condition.",
    ),
    "output_unambiguous": _noul(
        "OUTPUT names a durable result a worker can leave and another person can check: a specific commit, "
        "pull request, report, file, or record.",
        "OUTPUT is vague ('the fix'), or leaves no durable trace another person could check.",
    ),
}

#: The blocking gates. These are not compensable by positive readiness signals.
GATE_QUESTIONS: dict[str, dict[str, Any]] = {
    "open_decision": _noul(
        "The contract leaves a design or scope decision unresolved and does not name who decides it.",
        "Every decision the work needs is already made in the contract, or the contract explicitly names "
        "who decides the open one.",
    ),
    "depends_on_missing_context": _noul(
        "Completing this contract requires information that exists only outside it: a chat thread, a "
        "private dispatch prompt, or unstated convention.",
        "The contract together with repository access is sufficient: a fresh worker would not have to ask "
        "or guess what the work requires.",
    ),
    "micromanages_implementation": _noul(
        "The contract prescribes an implementation mechanism (specific code structure, algorithm, or naming) "
        "that is not itself a required constraint.",
        "The contract states what must be true and leaves the implementation mechanism to the worker, or the "
        "prescribed mechanism is itself a stated constraint.",
    ),
    "self_blocked": _noul(
        "The work is blocked on an external decision or another work item that has not happened yet.",
        "The work can start now from the contract alone, without waiting on a decision or another item.",
    ),
}

#: The mutually exclusive execution modes a worker needs.
EXECUTION_MODE_QUESTION: dict[str, Any] = {
    "type": "choice",
    "criteria": {
        "repo_only": "Changes and checks are possible inside the repository: code, tests, docs, CI.",
        "live_environment": "The work needs access to a running system, host, cluster, or cloud account.",
        "operator_or_other_team": "A human operator, another team, or another repository must act or decide.",
    },
}

#: The holistic arm's single question: the historical `executable` judgment.
HOLISTIC_QUESTION: dict[str, Any] = _noul(
    "A fresh, competent worker with repository access could execute this contract from its text alone "
    "and produce the stated OUTPUT.",
    "The contract as written is not executable without further information, decisions, or access.",
)

#: Names in dispatch order, for the deterministic battery (gates last).
BATTERY_ORDER = tuple(ATOMIC_QUESTIONS) + tuple(GATE_QUESTIONS) + ("execution_mode",)
#: The seven mandatory readiness predicates; a failure in any of them is not
#: compensable by a positive result in another.
MANDATORY_PREDICATES = tuple(ATOMIC_QUESTIONS)
#: Gate names that force a decision class when their probability is high.
BLOCKING_GATES = tuple(GATE_QUESTIONS)


def atomic_battery() -> dict[str, dict[str, Any]]:
    """The full battery (mandatory predicates, gates, execution mode)."""
    battery = dict(ATOMIC_QUESTIONS)
    battery.update(GATE_QUESTIONS)
    battery["execution_mode"] = EXECUTION_MODE_QUESTION
    return battery


def holistic_battery() -> dict[str, dict[str, Any]]:
    return {"executable": HOLISTIC_QUESTION}


def question_specs(
    battery: dict[str, dict[str, Any]], prefix: str
) -> dict[str, dict[str, Any]]:
    """Registry-shaped QuestionSpec bodies, built through
    :func:`xtrm_research.publish.question_spec` so a Choice derives its
    ``options`` and a Score its ``legend`` from ``criteria`` in exactly one
    place."""
    from xtrm_research.publish import question_spec

    specs: dict[str, dict[str, Any]] = {}
    for name, body in battery.items():
        instructions = (
            body["criteria"]["true"]
            if body["type"] == "noul"
            else "What does completing this contract require?"
        )
        specs[name] = question_spec(
            f"{prefix}.{name}",
            "v1",
            {
                "type": body["type"],
                "instructions": instructions,
                "criteria": body["criteria"],
            },
        )
    return specs


def state_of(unit: dict[str, Any]) -> dict[str, Any]:
    """The System One state for one dataset unit.

    Only what the questions are asked about: the ticket, the contract revision,
    and the standard. Deterministic diagnostics are deliberately absent.
    """
    return {
        "locator": unit["locator"],
        "kind": unit["kind"],
        "project": unit["project_name"],
        "title": unit["title"],
        "ready_contract_standard": STANDARD,
        "contract": unit["contract"],
    }
