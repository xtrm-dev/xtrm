"""Controlled adversarial mutations of otherwise-valid contracts (XTRM-99 c.13435).

Each mutation changes exactly one invariant of an otherwise strong contract and
declares, **before** any model is called:

- the changed invariant;
- the primitive(s) expected to move, and in which direction;
- the expected policy consequence.

That pre-declaration is what makes the suite an acceptance test rather than a
demonstration: a mutation whose intended primitive does not move, or whose
unrelated primitives move without explanation, is a finding about the battery.
Synthetic mutations complement the natural revision transitions in the dataset;
neither replaces the other.
"""

from __future__ import annotations

import copy
import hashlib
from dataclasses import dataclass
from typing import Any, Callable

from xtrm_research.planning_ready import contracts


#: A declared primitive must move by at least this much (mean paired delta) for
#: the mutation to count as accepted. Significance alone is not enough: with a
#: single contract pair the bootstrap interval collapses to a point, so a
#: 0.01 movement would otherwise "exclude zero". The threshold is frozen with
#: the battery, before any model is called.
MATERIAL_MOVEMENT = 0.15


@dataclass(frozen=True)
class Mutation:
    name: str
    changed_invariant: str
    #: primitive -> expected direction of movement ("up"/"down")
    expected_affected: dict[str, str]
    expected_policy_consequence: str
    apply: Callable[[dict[str, Any]], dict[str, Any]]


def _with(contract: dict[str, Any], **fields: Any) -> dict[str, Any]:
    mutated = copy.deepcopy(contract)
    mutated.update(fields)
    return mutated


MUTATIONS: dict[str, Mutation] = {
    "remove_observable_success": Mutation(
        name="remove_observable_success",
        changed_invariant="SUCCESS no longer names observable completion conditions",
        expected_affected={"success_observable": "down"},
        expected_policy_consequence="not READY (DRAFT, or REVIEW while the predicate is uncertain)",
        apply=lambda c: _with(
            c, success="The work is done when the improvement is complete."
        ),
    ),
    "static_only_validation": Mutation(
        name="static_only_validation",
        changed_invariant="VALIDATION proves only static properties, not the claimed success",
        expected_affected={"validation_proves_success": "down"},
        expected_policy_consequence="not READY (DRAFT)",
        apply=lambda c: _with(
            c,
            validation=[
                {"check": "npm run lint passes"},
                {"check": "npm run typecheck passes"},
            ],
        ),
    ),
    "introduce_unnamed_decision": Mutation(
        name="introduce_unnamed_decision",
        changed_invariant="a design decision is left open without naming who decides",
        expected_affected={"open_decision": "up"},
        expected_policy_consequence="NEEDS_DECISION",
        apply=lambda c: _with(
            c,
            constraints=[
                *[s for s in c.get("constraints", []) if isinstance(s, str)],
                "Choose the appropriate caching strategy for this path.",
            ],
        ),
    ),
    "vague_scope": Mutation(
        name="vague_scope",
        changed_invariant="SCOPE no longer bounds the owned surfaces",
        expected_affected={"scope_bounded": "down"},
        expected_policy_consequence="not READY (DRAFT)",
        apply=lambda c: _with(c, scope=["The relevant code and tests."]),
    ),
    "remove_necessary_constraint": Mutation(
        name="remove_necessary_constraint",
        changed_invariant="CONSTRAINTS no longer state a binding invariant",
        expected_affected={"constraints_actionable": "down"},
        expected_policy_consequence="not READY (DRAFT)",
        apply=lambda c: _with(
            c, constraints=["Follow the existing plan and keep things tidy."]
        ),
    ),
    "chat_only_context": Mutation(
        name="chat_only_context",
        changed_invariant="required information exists only outside the contract",
        expected_affected={"depends_on_missing_context": "up"},
        expected_policy_consequence="DRAFT (fresh-worker test fails)",
        apply=lambda c: _with(
            c,
            scope=[
                "As discussed in the planning thread: apply the agreed changes to the right places."
            ],
        ),
    ),
    "over_prescribe_implementation": Mutation(
        name="over_prescribe_implementation",
        changed_invariant="the contract prescribes a mechanism that is not itself a constraint",
        expected_affected={"micromanages_implementation": "up"},
        expected_policy_consequence="REVIEW (advisory over-prescription), not a silent DRAFT",
        apply=lambda c: _with(
            c,
            constraints=[
                *[s for s in c.get("constraints", []) if isinstance(s, str)],
                "Implement it with a Redis-backed LRU cache in a new module cache.py, class CacheManager, "
                "method get_or_compute, TTL 300 seconds, using the lru_cache-like decorator pattern.",
            ],
        ),
    ),
    "unresolved_dependency": Mutation(
        name="unresolved_dependency",
        changed_invariant="the work is blocked on an external decision",
        expected_affected={"self_blocked": "up"},
        expected_policy_consequence="BLOCKED",
        apply=lambda c: _with(
            c,
            constraints=[
                *[s for s in c.get("constraints", []) if isinstance(s, str)],
                "Blocked until the platform team decides the API shape; do not start before that.",
            ],
        ),
    ),
    "break_output_semantics": Mutation(
        name="break_output_semantics",
        changed_invariant="OUTPUT no longer names a checkable durable result",
        expected_affected={"output_unambiguous": "down"},
        expected_policy_consequence="not READY (DRAFT)",
        apply=lambda c: _with(c, output=[{"artifact": "The fix."}]),
    ),
    "hollow_non_goals": Mutation(
        name="hollow_non_goals",
        changed_invariant="NON_GOALS excludes nothing a worker would consider",
        expected_affected={"non_goals_effective": "down"},
        expected_policy_consequence="not READY (DRAFT)",
        apply=lambda c: _with(c, nonGoals=["None."]),
    ),
    "problem_as_label": Mutation(
        name="problem_as_label",
        changed_invariant="PROBLEM is a restatement rather than an actionable problem",
        expected_affected={"problem_actionable": "down"},
        expected_policy_consequence="not READY (DRAFT)",
        apply=lambda c: _with(c, problem="Improve this area of the product."),
    ),
}


def mutation_classes() -> tuple[str, ...]:
    return tuple(MUTATIONS)


def build_mutations(
    units: list[dict[str, Any]],
    *,
    per_class: int = 20,
    seed: str = "planning-ready-v2",
) -> list[dict[str, Any]]:
    """Deterministically select strong contracts and mutate each once per class.

    A strong contract is structurally valid and independently labelled ready:
    mutating anything else would confound the mutation with pre-existing
    weakness.
    """
    strong = [
        u
        for u in units
        if u["deterministic"]["structurally_valid"]
        and u["research_label"]["value"] == "ready"
    ]
    strong.sort(
        key=lambda u: hashlib.sha256(f"{seed}:{u['unit_id']}".encode()).hexdigest()
    )
    selected = strong[:per_class]
    rows: list[dict[str, Any]] = []
    for unit in selected:
        for name, mutation in MUTATIONS.items():
            mutated = mutation.apply(unit["contract"])
            # The mutation must change meaning, not structure: if the deterministic channel
            # already rejects the mutated contract, the case tests nothing about the semantic
            # battery. `scrutiny`/`ownership`/`context_refs` are part of the deterministic
            # subject, so they are passed here exactly as the dataset computes them.
            subject = {
                "scrutiny": unit.get("scrutiny"),
                "ownership": unit.get("ownership"),
                "context_refs": unit.get("context_refs"),
            }
            before = contracts.structural_findings(unit["contract"], **subject)
            after = contracts.structural_findings(mutated, **subject)
            rows.append(
                {
                    "mutation_id": f"{unit['unit_id']}::{name}",
                    "mutation_class": name,
                    "unit_id": unit["unit_id"],
                    "partition": unit["split"]["partition"],
                    "changed_invariant": mutation.changed_invariant,
                    "expected_affected": mutation.expected_affected,
                    "expected_policy_consequence": mutation.expected_policy_consequence,
                    "original_contract_hash": unit["contract_hash"],
                    "mutated_contract_hash": "sha256:"
                    + hashlib.sha256(
                        repr(sorted(mutated.items())).encode("utf-8")
                    ).hexdigest(),
                    # A mutation must change meaning, not structure: if the
                    # deterministic channel already rejects it, the case tests
                    # nothing about the semantic battery.
                    "structurally_valid_before": len(before) == 0,
                    "structurally_valid_after": len(after) == 0,
                    "mutated_contract": mutated,
                }
            )
    return rows


def primitive_deltas(
    original: dict[str, float], mutated: dict[str, float]
) -> dict[str, float]:
    """Paired probability movement per primitive (mutated minus original)."""
    names = set(original) | set(mutated)
    return {
        name: (mutated.get(name, 0.0) - original.get(name, 0.0))
        for name in sorted(names)
    }
