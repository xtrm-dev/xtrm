# ADR-001 — Agent experience: design authority and process

> Status: ACCEPTED (process); the visual direction stays OPEN until the Phase 0 operator decision (XTRM-628) · Date: 2026-10-04
> Deciders: operator; recorded by the XTRM-557/XTRM-621 coordinator
> Work: Substrate epic XTRM-621 (local board; server board XTRM-620), Phase 0 children XTRM-622–628 · Jira XTRM-104
> Related: Jira XTRM-105 (ADR: tmux-derived Sessions navigator and optional topology graph view; Proposed) · Substrate XTRM-630 (Sessions navigator)

## Context

Epic XTRM-557 delivered the Agent half of `xtrm-app` over the XTRM agent host. On 2026-10-03 it passed real-host acceptance against PRD §36.11 criteria 1–14 and the §31 Agent items: 45/45 in the worker run (xtrm PR #276) and 45/45 in an independent coordinator run. Core v0.14.1 shipped through npm trusted publishing.

The operator's first live use and a coordinator review found that the result works but does not look or feel like the intended product:

- The shell does not follow the Console v2 visual language (v15 mock).
- The Agent sidebar is a flat, jumpy list of every indexed session (555 on the operator's host). Live sessions are not separated from history.
- The Frame header has no actions. Activity renders as flat rows instead of grouped semantic cards. The composer is a plain box. There is no inspector rail.
- The component registry was not used. `src/components/registry/` is empty although `components.json` configures `@shadcn`, `@spectrumui` and `@agents-ui`, and `docs/ui-component-reference-registry.md` requires registry-first work. Only 2 of about 20 Agent files use Base UI.

Root cause: every acceptance criterion was behavioural, and no worker prompt named the mocks or the registry. Nothing in the process could detect the gap.

## Decision

1. **Close XTRM-557 on function.** Behavioural acceptance is complete. Visual and experience work is a new epic, not reopened scope.
2. **New epic XTRM-621 with an experience bar.** The goal: the operator prefers working in the XTRM Agent surface over the terminal and over other harnesses. The epic closes on the operator's verdict after a real working session of at least 30 minutes, not on tests alone.
3. **Mocks are inspiration, not authority.** The v15 mock (`docs/mocks/console-v2-v15-supernova-substrate.html`) sets the shell's visual language. The v14 mock (`docs/mocks/console-v2-v14-agent-supernova-substrate.html`) is input for the Agent composition. Neither is a pixel target.
4. **Phase 0 design discovery runs before any implementation:**
   - inputs: brief, scenario set, rubric, before screenshots (XTRM-622, done);
   - three genuinely different directions: A focus canvas (XTRM-623), B cockpit (XTRM-624), C fleet and focus (XTRM-625);
   - a component selection study across the registries (XTRM-626);
   - a Claude design pass that critiques and refines each direction and compares them side by side (XTRM-627);
   - the operator's decision on direction and component set (XTRM-628).
5. **The chosen Phase 0 design becomes the implementation reference.** Implementation children are created only after XTRM-628.
6. **Registry-first components.** Every implementation child records which `@agents-ui`, `@spectrumui`, `@shadcn` and Base UI candidates it searched, installed, adapted or rejected before building a component by hand. Dispositions go into `docs/ui-component-reference-registry.md`.
7. **Acceptance adds experience checks to the behavioural ones.** Each implementation child must:
   - keep the XTRM-601 real-host suite (45 tests) green;
   - supply side-by-side screenshots against the approved design, light and dark, opened by the coordinator;
   - show zero layout shift during 30 s of streaming.
8. **Worker prompts name the design files, the registry doc and this ADR.**
9. **Navigation model.** The tmux-derived Sessions navigator and the optional topology graph view are decided separately in Jira XTRM-105 and implemented through Substrate XTRM-630, which supersedes the earlier sidebar follow-up (local XTRM-618). The Phase 0 directions must each answer brief §5.

## Authority map

| Record | Holds | Authority |
|---|---|---|
| PRD `docs/xtrm-gui-prd.md` | product requirements and accepted deviations (§36.13) | canonical requirements |
| This ADR | why the experience work is structured this way | decision record |
| Phase 0 deliverables `docs/design/agent-experience/` | brief, directions, design pass, component study, decision | design reference after XTRM-628 |
| Substrate XTRM-621 and children | executable contracts, claims, journal, closure | work authority |
| Jira XTRM-104 (and XTRM-105) | portfolio view and navigation ADR; no mirrored subtasks (ISSUE-140 rule) | portfolio |

## Alternatives considered

- **Keep XTRM-557 open until the visuals match.** Rejected. It mixes proven behaviour with open design questions and blocks a clean release record.
- **Implement v15 at pixel fidelity now.** Rejected by the operator. v15 is inspiration, and the Agent surface was never mocked in v15.
- **One design direction, iterated.** Rejected. Comparing genuinely different directions surfaces trade-offs, for example where sessions live and how attention is handled, that one iterated layout hides.
- **Choose components per surface during implementation.** Rejected. That is how the registry went unused. A study before implementation makes the choice explicit and reviewable.

## Consequences

- Phase 0 adds design time before visible UI changes. The behavioural Agent half remains usable meanwhile.
- The approved direction becomes the comparison baseline, so visual regressions become detectable.
- The acceptance suite and screenshot sets must be maintained as the UI changes.
- Follow-ups outside this epic stay separate: XTRM-611 (Claude Code Remote Control parity, incl. XTRM-620 journal fidelity), XTRM-617 (Tree projection), XTRM-619 (busy right after settle). Numbers are local board numbers; server numbers are one lower.
