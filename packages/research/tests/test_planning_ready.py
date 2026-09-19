"""Planning Ready-contract workload: deterministic mirror, policy, mutations, dataset."""

from __future__ import annotations

import copy
import json

import pytest

from xtrm_research.planning_ready import campaign, contracts, mutations, policy, questions


def _contract(**overrides):
    contract = {
        "problem": "The readiness probe returns stale data after a daemon restart, so operators act on a dead fleet.",
        "success": "After a restart, the probe reports liveness within one polling interval and the regression test asserts it.",
        "scope": ["utils/probe.py", "tests/test_probe.py"],
        "nonGoals": ["Does not change the daemon start-up sequence."],
        "constraints": ["Must keep the existing probe CLI contract."],
        "validation": [{"check": "unit test that restarts the daemon and asserts a fresh reading"}],
        "output": [{"artifact": "commit on a branch with the failing-then-passing regression test"}],
    }
    contract.update(overrides)
    return contract


# --- deterministic mirror ---------------------------------------------------


def test_a_complete_contract_is_structurally_valid():
    assert contracts.structural_findings(_contract(), scrutiny="MEDIUM") == []


def test_mirror_reproduces_the_incumbent_messages():
    findings = contracts.structural_findings(
        _contract(scope=[], nonGoals=[], success="TODO", validation=[], output=[]),
        scrutiny="MEDIUM",
    )
    messages = {f"{f['field']}: {f['message']}" for f in findings}
    assert "scope: scope must be a non-empty array of non-empty strings" in messages
    assert "nonGoals: nonGoals must be a non-empty array of non-empty strings" in messages
    assert "success: success contains an unresolved marker" in messages
    assert "validation: validation must be a non-empty array of { check: non-empty string }" in messages
    assert "output: output must be a non-empty array of { artifact: non-empty string }" in messages


def test_mirror_reports_one_placeholder_finding_per_field():
    findings = contracts.structural_findings(
        _contract(problem="TODO: fix this. FIXME later.", success="XXX done"), scrutiny="MEDIUM"
    )
    placeholders = [f for f in findings if f["code"] == "placeholder"]
    assert len(placeholders) == 2  # one for problem, one for success — never two for one field


def test_scrutiny_and_shape_rules_match_the_incumbent():
    assert any(
        f["code"] == "scrutiny-reference"
        for f in contracts.structural_findings(_contract(), scrutiny="")
    )
    ownership = contracts.structural_findings(
        _contract(), scrutiny="HIGH", ownership={"paths": ["ok", ""]}
    )
    assert any(f["field"] == "ownership.paths" for f in ownership)
    context = contracts.structural_findings(
        _contract(),
        scrutiny="HIGH",
        context_refs=[{"key": "k", "value": 1, "kind": "journal"}],
    )
    assert any(f["code"] == "journal-authority" for f in context)


def test_contract_text_labels_every_required_section():
    text = contracts.contract_text(_contract())
    for label in ("PROBLEM:", "SUCCESS:", "SCOPE:", "NON_GOALS:", "CONSTRAINTS:", "VALIDATION:", "OUTPUT:"):
        assert label in text


def test_reference_extraction_finds_paths_and_locators_only():
    contract = _contract(
        scope=["packages/research/src/xtrm_research/policy.py"],
        constraints=["Depends on XTRM-462 and must not regress CORE-88."],
    )
    assert contracts.referenced_paths(contract) == ["packages/research/src/xtrm_research/policy.py"]
    assert set(contracts.referenced_locators(contract)) == {"XTRM-462", "CORE-88"}


# --- policy -----------------------------------------------------------------


def _thresholds(**overrides) -> policy.Thresholds:
    base = dict(
        mandatory_false_below=0.3,
        mandatory_true_above=0.8,
        open_decision_above=0.5,
        self_blocked_above=0.5,
        missing_context_above=0.5,
        micromanages_above=0.7,
        holistic_ready_above=0.5,
    )
    base.update(overrides)
    return policy.Thresholds(**base)


#: A genuinely ready answer set: every mandatory predicate confident, every
#: blocking gate confidently NOT firing. The gates are separate answers, so
#: setting them high is a different (and correctly non-READY) case.
HIGH = {name: 0.95 for name in policy.NOUL_FEATURES}
READY = {
    **HIGH,
    "open_decision": 0.05,
    "self_blocked": 0.05,
    "depends_on_missing_context": 0.05,
    "micromanages_implementation": 0.05,  # advisory gate: firing it is a REVIEW
}


def test_explicit_policy_is_ready_when_every_predicate_is_high():
    decision = policy.explicit_policy([], dict(READY), _thresholds())
    assert decision["decision"] == "READY"


def test_a_high_gate_probability_is_never_ready_however_strong_the_predicates():
    decision = policy.explicit_policy([], dict(HIGH), _thresholds())
    assert decision["decision"] == "NEEDS_DECISION"


def test_deterministic_failure_ends_the_decision_before_any_semantic_signal():
    decision = policy.explicit_policy(
        [{"field": "scope", "code": "required-field", "message": "scope must be a non-empty array"}],
        dict(READY),  # every semantic signal positive
        _thresholds(),
    )
    assert decision["decision"] == "DRAFT"
    assert decision["stage"] == "deterministic"


def test_gates_fire_and_are_not_compensated_by_positive_predicates():
    needs = policy.explicit_policy([], {**READY, "open_decision": 0.9}, _thresholds())
    assert needs["decision"] == "NEEDS_DECISION"
    blocked = policy.explicit_policy([], {**READY, "self_blocked": 0.9}, _thresholds())
    assert blocked["decision"] == "BLOCKED"
    missing = policy.explicit_policy([], {**READY, "depends_on_missing_context": 0.9}, _thresholds())
    assert missing["decision"] == "DRAFT"
    assert "fresh-worker test" in " ".join(missing["reasons"])


def test_mandatory_false_predicate_is_a_draft_even_with_everything_else_perfect():
    decision = policy.explicit_policy(
        [], {**READY, "validation_proves_success": 0.05}, _thresholds()
    )
    assert decision["decision"] == "DRAFT"
    assert any("validation_proves_success" in r for r in decision["reasons"])


def test_mandatory_uncertain_predicate_is_a_review_not_a_guess():
    decision = policy.explicit_policy([], {**READY, "scope_bounded": 0.55}, _thresholds())
    assert decision["decision"] == "REVIEW"
    assert decision["uncertain"] == ["scope_bounded"]


def test_over_prescription_is_advisory_review_not_a_silent_draft():
    decision = policy.explicit_policy([], {**READY, "micromanages_implementation": 0.95}, _thresholds())
    assert decision["decision"] == "REVIEW"
    assert decision["stage"] == "advisory"


def test_deterministic_only_policy_ignores_semantics():
    assert policy.deterministic_only_policy([])["decision"] == "READY"
    assert (
        policy.deterministic_only_policy([{"field": "scope", "code": "x", "message": "m"}])["decision"]
        == "DRAFT"
    )


def test_holistic_policy_uses_only_the_single_judgment():
    assert policy.holistic_policy({"executable": 0.9}, _thresholds())["decision"] == "READY"
    assert policy.holistic_policy({"executable": 0.2}, _thresholds())["decision"] == "DRAFT"
    assert policy.holistic_policy({}, _thresholds())["decision"] == "REVIEW"


def test_thresholds_are_fitted_on_supplied_units_only():
    units = [
        {"unit_id": "u1", "deterministic": {"structural_findings": []}},
        {"unit_id": "u2", "deterministic": {"structural_findings": []}},
    ]
    answers = {
        "u1": {name: {"noul": 0.9 if name in policy.NOUL_FEATURES[:7] else 0.02} for name in policy.NOUL_FEATURES},
        "u2": {name: {"noul": 0.02} for name in policy.NOUL_FEATURES},
    }
    thresholds, detail = policy.calibrate_thresholds(units, answers, {"u1": 1, "u2": 0})
    assert detail["n_train"] == 2
    assert detail["balanced_accuracy"] == 1.0
    decision = policy.explicit_policy(
        [], {n: (0.9 if n in policy.NOUL_FEATURES[:7] else 0.02) for n in policy.NOUL_FEATURES}, thresholds
    )
    assert decision["decision"] == "READY"


def test_learned_composition_fits_a_separable_pattern_and_is_not_the_explicit_policy():
    units = []
    answers = {}
    truth = {}
    for i in range(40):
        ready = i % 2 == 0
        unit_id = f"u{i}"
        units.append({"unit_id": unit_id, "deterministic": {"structural_findings": []}})
        base = 0.95 if ready else 0.05
        gate = 0.05 if ready else 0.95
        answers[unit_id] = {
            **{n: {"noul": (gate if n in policy.NOUL_FEATURES[7:] else base)} for n in policy.NOUL_FEATURES},
            "execution_mode": {"choice": "repo_only", "probabilities": {"repo_only": 0.9, "live_environment": 0.05, "operator_or_other_team": 0.05}},
        }
        truth[unit_id] = 1 if ready else 0
    learned, detail = policy.fit_learned_composition(units, answers, truth)
    assert detail["train_balanced_accuracy_at_frozen_threshold"] > 0.9
    ready_unit = units[0]["unit_id"]
    not_ready_unit = units[1]["unit_id"]
    assert learned.policy([], answers[ready_unit])["decision"] == "READY"
    assert learned.policy([], answers[not_ready_unit])["decision"] == "DRAFT"
    assert "invariant" not in " ".join(learned.freeze()["features"])  # no hard gate smuggled in


def test_metrics_are_none_rather_than_zero_when_undefined():
    metrics = policy.classification_metrics([1, 1], [1, 1])
    assert metrics["false_ready_rate"] is None  # no negatives to be wrong about
    assert metrics["recall"] == 1.0
    assert policy.auc([1, 1], [0.9, 0.8]) is None


def test_auc_brier_and_ece_are_the_standard_estimators():
    assert policy.auc([1, 0], [0.9, 0.1]) == 1.0
    assert policy.auc([1, 0], [0.1, 0.9]) == 0.0
    assert policy.auc([1, 0], [0.5, 0.5]) == 0.5
    assert policy.brier([1, 0], [0.9, 0.1]) == pytest.approx(0.01)
    assert policy.ece([1, 0], [0.9, 0.1]) == pytest.approx(0.1)


# --- mutations --------------------------------------------------------------


def test_every_mutation_class_declares_its_expectation_and_keeps_structure_valid():
    unit = {
        "unit_id": "XTRM-1@r1",
        "issue_id": "i1",
        "locator": "XTRM-1",
        "kind": "task",
        "project_name": "xtrm",
        "title": "t",
        "revision": 1,
        "contract_hash": "h",
        "scrutiny": "MEDIUM",
        "ownership": None,
        "context_refs": [],
        "deterministic": {"structural_findings": [], "structurally_valid": True},
        "research_label": {"value": "ready"},
        "split": {"partition": "test"},
        "contract": _contract(),
    }
    rows = mutations.build_mutations([unit], per_class=1)
    assert len(rows) == len(mutations.mutation_classes())
    for row in rows:
        assert row["expected_affected"], row["mutation_class"]
        assert row["changed_invariant"]
        assert row["expected_policy_consequence"]
        # The deterministic channel must not already reject the mutation, or the
        # case would test nothing about the semantic battery.
        assert row["structurally_valid_before"] is True, row["mutation_class"]
        assert row["structurally_valid_after"] is True, row["mutation_class"]
        assert row["mutated_contract"] != unit["contract"], row["mutation_class"]


def test_mutations_are_deterministic_for_a_given_seed():
    unit = {
        "unit_id": "XTRM-1@r1", "issue_id": "i1", "locator": "XTRM-1", "kind": "task",
        "project_name": "xtrm", "title": "t", "revision": 1, "contract_hash": "h",
        "scrutiny": "MEDIUM", "ownership": None, "context_refs": [],
        "deterministic": {"structural_findings": [], "structurally_valid": True},
        "research_label": {"value": "ready"}, "split": {"partition": "test"},
        "contract": _contract(),
    }
    first = [r["mutation_id"] for r in mutations.build_mutations([unit], per_class=1)]
    second = [r["mutation_id"] for r in mutations.build_mutations([unit], per_class=1)]
    assert first == second


# --- dataset labelling and splitting ----------------------------------------


def _dataset_unit(**overrides):
    unit = {
        "unit_id": "XTRM-9@r2",
        "issue_id": "issue-9",
        "locator": "XTRM-9",
        "project": "prj_xtrm",
        "project_name": "xtrm",
        "kind": "task",
        "title": "Fix the widget timeout",
        "lifecycle_state": "done",
        "revision": 2,
        "contract_hash": "h",
        "is_current_revision": True,
        "contract": _contract(),
        "contract_chars": 900,
        "scrutiny": "MEDIUM",
        "ownership": None,
        "context_refs": [],
        "deterministic": {"structural_findings": [], "structurally_valid": True},
        "incumbent_state": {
            "attestation_this_revision": [{"outcome": "ready", "policy": "default", "attested_by": "op"}],
            "attested_ready_this_revision": True,
            "attestation_other_revision": [],
            "lifecycle_state_at_snapshot": "done",
            "live_readiness": None,
        },
        "observed_outcome": {
            "closure": {"outcome": "completed", "issue_revision": 2, "contract_hash": "h"},
            "revision_is_closure_revision": True,
            "superseded": False,
            "revision_transition": None,
            "journal_after_revision": [],
            "work_receipt_count": 1,
            "final_revision": True,
        },
        "deterministic_refs": {"locators_resolve": {}, "locators_all_resolve": None},
        "research_label": None,
        "easy_negative": False,
        "stratum": {"revision_count": 2},
    }
    unit.update(overrides)
    return unit


def test_labels_use_outcome_anchors_and_never_merge_the_channels():
    from xtrm_research.planning_ready import dataset

    positive = _dataset_unit()
    label = dataset.assign_label(positive)
    assert label["value"] == "ready"
    assert label["source"] == "outcome_anchored"
    assert "confidence" in label and "method" in label
    # the three channels remain distinct objects on the unit
    assert positive["incumbent_state"] is not label
    assert positive["observed_outcome"] is not label

    superseded = _dataset_unit(
        revision=1,
        is_current_revision=False,
        **{
            "observed_outcome": {
                "closure": {"outcome": "completed", "issue_revision": 2, "contract_hash": "h2"},
                "revision_is_closure_revision": False,
                "superseded": True,
                "revision_transition": {"next_revision": 2, "changed_sections": ["validation"]},
                "journal_after_revision": [],
                "work_receipt_count": 1,
                "final_revision": False,
            }
        },
    )
    superseded["incumbent_state"]["attested_ready_this_revision"] = False
    superseded["incumbent_state"]["attestation_this_revision"] = []
    assert dataset.assign_label(superseded)["value"] == "not_ready"


def test_no_independent_evidence_yields_an_explicit_abstention():
    from xtrm_research.planning_ready import dataset

    open_unit = _dataset_unit(lifecycle_state="open")
    open_unit["incumbent_state"]["attested_ready_this_revision"] = False
    open_unit["incumbent_state"]["attestation_this_revision"] = []
    open_unit["observed_outcome"] = {
        "closure": None,
        "revision_is_closure_revision": False,
        "superseded": False,
        "revision_transition": None,
        "journal_after_revision": [],
        "work_receipt_count": 0,
        "final_revision": True,
    }
    label = dataset.assign_label(open_unit)
    assert label["value"] == "unlabelled"
    assert label["source"] == "none"
    assert label["confidence"] == "none"


def test_split_groups_revisions_of_one_work_item_and_near_duplicate_titles():
    from xtrm_research.planning_ready import dataset

    a1 = dataset.assign_split(_dataset_unit(revision=1))
    a2 = dataset.assign_split(_dataset_unit(revision=2))
    assert a1["partition"] == a2["partition"]
    assert a1["cluster_key"] == a2["cluster_key"]

    other = _dataset_unit(issue_id="issue-10", locator="XTRM-10", unit_id="XTRM-10@r1")
    assert dataset.assign_split(other)["partition"] == a1["partition"]  # same normalized title

    holdout = _dataset_unit(project_name="specialists", project="prj_specialists")
    assert dataset.assign_split(holdout)["partition"] == "repo_holdout"


def test_dataset_records_a_revision_without_future_information_in_its_state():
    from xtrm_research.planning_ready import dataset

    # A revision unit's *input* state is its own contract text only; outcome
    # fields are namespaced under observed_outcome so they cannot be mistaken
    # for input.
    unit = _dataset_unit()
    state = questions.state_of(unit)
    assert set(state) == {"locator", "kind", "project", "title", "ready_contract_standard", "contract"}
    assert json.dumps(state) .find("superseded") == -1


# --- campaign plumbing ------------------------------------------------------


def test_mutation_evaluation_flags_a_declared_primitive_that_moves_and_one_that_does_not():
    row = {
        "mutation_id": "m1",
        "mutation_class": "vague_scope",
        "unit_id": "u1",
        "expected_affected": {"scope_bounded": "down"},
        "structurally_valid_after": True,
    }
    original = {"u1": {"answers": {"scope_bounded": {"noul": 0.9}, "success_observable": {"noul": 0.9}}}}
    moved = {"m1": {"answers": {"scope_bounded": {"noul": 0.2}, "success_observable": {"noul": 0.88}}}}
    evaluation = campaign.evaluate_mutations([row], original, moved)
    klass = evaluation["classes"]["vague_scope"]
    assert klass["class_ok"] is True
    assert klass["checks"][0]["ok"] is True
    assert klass["unexplained_movement"] == []

    # A tiny movement is not acceptance: materiality is required, not merely a
    # non-zero interval (which a single pair collapses to a point).
    unmoved = {"m1": {"answers": {"scope_bounded": {"noul": 0.89}, "success_observable": {"noul": 0.9}}}}
    evaluation = campaign.evaluate_mutations([row], original, unmoved)
    klass = evaluation["classes"]["vague_scope"]
    assert klass["class_ok"] is False
    assert klass["checks"][0]["materially_moved"] is False
    assert evaluation["share_checks_ok"] == 0.0


def test_mutation_materiality_threshold_is_declared_before_the_calls():
    assert mutations.MATERIAL_MOVEMENT > 0
    for mutation in mutations.MUTATIONS.values():
        assert mutation.expected_affected, mutation.name


def test_cli_annotation_kinds_match_the_schema_enum():
    from xtrm_research.schemas import load_schema

    schema_kinds = set(load_schema("annotation")["properties"]["kind"]["enum"])
    assert "result_summary" in schema_kinds


def test_escalation_only_targets_genuine_uncertainty():
    units = [{"unit_id": "a"}, {"unit_id": "b"}, {"unit_id": "c"}]
    decisions = {
        "a": {"decision": "READY", "uncertain": []},
        "b": {"decision": "REVIEW", "uncertain": ["scope_bounded"]},
        "c": {"decision": "DRAFT", "uncertain": []},
    }
    candidates = campaign.escalation_candidates(units, decisions)
    assert [u["unit_id"] for u in candidates] == ["b"]


def test_escalation_decision_supersedes_only_escalated_units():
    decisions = {
        "a": {"decision": "READY", "uncertain": [], "reasons": []},
        "b": {"decision": "REVIEW", "uncertain": ["scope_bounded"], "reasons": []},
    }
    rows = {"b": {"status": "answered", "ready": False, "weakest_mandatory_section": "scope"}}
    out = campaign.apply_escalations(decisions, rows)
    assert out["a"]["decision"] == "READY"
    assert out["b"]["decision"] == "DRAFT"
    assert out["b"]["stage"] == "escalation"


def test_labelled_population_excludes_structurally_invalid_and_unlabelled_units():
    units = [
        {"unit_id": "a", "deterministic": {"structurally_valid": True}, "research_label": {"value": "ready"}},
        {"unit_id": "b", "deterministic": {"structurally_valid": False}, "research_label": {"value": "not_ready"}},
        {"unit_id": "c", "deterministic": {"structurally_valid": True}, "research_label": {"value": "unlabelled"}},
    ]
    assert [u["unit_id"] for u in campaign.labelled_units(units)] == ["a"]


def test_question_battery_uses_canonical_primitives_and_no_score():
    battery = questions.atomic_battery()
    types = {name: body["type"] for name, body in battery.items()}
    assert types["execution_mode"] == "choice"
    assert set(types.values()) <= {"noul", "choice"}
    for name, body in battery.items():
        if body["type"] == "noul":
            assert set(body["criteria"]) == {"true", "false"}, name
    assert len(battery) == len(questions.MANDATORY_PREDICATES) + len(questions.BLOCKING_GATES) + 1


def _synthetic_units_and_answers():
    units = []
    answers = {}
    for i in range(12):
        ready = i % 2 == 0
        unit_id = f"u{i}"
        units.append(
            {
                "unit_id": unit_id,
                "issue_id": f"issue-{i}",
                "locator": f"XTRM-{i}",
                "kind": "task",
                "project_name": "xtrm",
                "title": "t",
                "revision": 1,
                "contract_hash": f"h{i}",
                "contract": _contract(),
                "deterministic": {"structural_findings": [], "structurally_valid": True},
                "research_label": {"value": "ready" if ready else "not_ready"},
                "incumbent_state": {"derived_readiness": {"state": "draft", "dispatchable": False}},
                "observed_outcome": {"closure": None, "superseded": False},
                "split": {"partition": "test" if i < 6 else "train"},
            }
        )
        base = 0.95 if ready else 0.05
        gate = 0.05 if ready else 0.95
        answers[unit_id] = {
            "answers": {
                **{
                    n: {"noul": (gate if n in policy.NOUL_FEATURES[7:] else base)}
                    for n in policy.NOUL_FEATURES
                },
                "execution_mode": {"choice": "repo_only", "probabilities": {"repo_only": 0.9, "live_environment": 0.05, "operator_or_other_team": 0.05}},
            }
        }
    return units, answers


def test_arm_and_primitive_metric_bundles_are_computable_and_carry_intervals():
    units, answers = _synthetic_units_and_answers()
    evaluation = campaign.labelled_units(units)
    decisions = {
        u["unit_id"]: policy.explicit_policy([], policy.answers_of(answers[u["unit_id"]]["answers"]), _thresholds())
        for u in evaluation
    }
    metrics = campaign.arm_metrics(evaluation, "atomic-explicit-policy", decisions)
    assert metrics["n"] == len(evaluation)
    assert metrics["false_ready_rate"]["value"] is not None
    assert metrics["false_ready_rate"]["ci95"] is not None  # Wilson interval, not a bare point
    assert "Wilson" in metrics["false_ready_rate"]["method"]

    primitives = campaign.primitive_metrics(evaluation, answers, policy.NOUL_FEATURES)
    assert "problem_actionable.auc" in primitives
    assert primitives["problem_actionable.auc"]["value"] == 1.0  # perfectly separated by construction
    assert primitives["problem_actionable.brier"]["value"] is not None


def test_paired_delta_and_metric_rows_flatten_into_assessment_rows():
    units, answers = _synthetic_units_and_answers()
    evaluation = campaign.labelled_units(units)
    good = {
        u["unit_id"]: {"decision": "READY" if u["research_label"]["value"] == "ready" else "DRAFT"}
        for u in evaluation
    }
    bad = {u["unit_id"]: {"decision": "READY"} for u in evaluation}
    delta = campaign.paired_false_ready_delta(evaluation, good, bad)
    assert delta["value"] == -1.0  # the perfect arm makes no false-READY error; the always-READY arm makes all of them
    rows = campaign.metric_rows("test", campaign.arm_metrics(evaluation, "x", good))
    assert all(row is None or "method" in row for row in rows.values())
    assert any(name.endswith("false_ready_rate") for name in rows)
