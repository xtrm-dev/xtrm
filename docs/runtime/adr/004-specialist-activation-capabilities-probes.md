# ADR-004 — Specialist activation, capabilities and probes

> Status: ACCEPTED · Date: 2026-08-22 · Absorbs: packet C-06/C-07; execution-protocol invariants (specialists repo)
> Evidence: decision matrix Q9/Q10/Q11/Q16; lane B/D.

## Decision

1. **SpecialistDefinition** = stable role/cognition contract, fingerprinted at load (source SHA-256 + per-skill hashes; fail-closed drift → new ChainRun revision instead of in-place cognition mutation — proven in the JSON loader work).
2. **SpecialistActivationProfile** = per-step runtime profile: model, timeout, retry policy, capability policy, thinking level. Definition ≠ profile.
3. **Capability equation (normative):**

```
Specialist requested capabilities
+ Chain/step policy
+ operator policy
+ runtime/sandbox capabilities
= ResolvedCapabilityGrant
```

Request ≠ permission. `required_tools` expresses a requirement and never auto-exposes unrestricted generic Pi built-ins. Current adapter behavior (`noTools:"builtin"` + explicit allowlist) is the documented baseline; future production behavior tightens via the grant resolver.

4. **Taxonomy replacing overloaded `skills.scripts`:**
   - cognition: skills, system prompt, procedures
   - activation policy: capabilities, model, timeout, retry
   - prepare: probes, validators, context resolvers
   - result contract: output schema, evidence requirements
   - finalize: validators, projections, terminal effects

   Legacy `skills.scripts` compile into typed `ProbeDefinition`s for compatibility. Arbitrary shell scripts are never a privileged implicit preflight API.
5. **Protocol core preserved** (PREPARE → PLAN → EXECUTE → FINALIZE) with the ten ownership-decision invariants verbatim from specialists canon, including: structurally NOK cannot proceed; read-only roles cannot acquire write through step contract; finalization side effects idempotent; chain satisfaction derived from validated evidence; notification failure does not alter verdicts.

## Consequences

- Execution protocol doc updates terminology (activation/attempt/session identity, grants, probes) without changing phase semantics (W3).
- Capability enforcement, probe enforcement become Eval Core grader categories.

## Rejected alternatives

- Definition-level permission grants (role prose granting tools).
- Keeping implicit preflight scripts as authority-bearing API.
