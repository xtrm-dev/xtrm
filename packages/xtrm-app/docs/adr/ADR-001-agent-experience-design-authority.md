# ADR-001 — Agent experience: design authority and process

> Status: ACCEPTED (process); the visual direction stays OPEN until the Phase 0 operator decision (XTRM-628) · Date: 2026-10-04
> Deciders: operator; recorded by the XTRM-557/XTRM-621 coordinator
> Amended 2026-10-04: operator requirements, Decision 9 (shipped data layer, open hierarchy, graph library) and Decision 10 (behaviour), preconditions and known gaps
> Work: Substrate epic XTRM-621 (local board; server board XTRM-620): Phase 0 children XTRM-622–628, navigation children XTRM-629 (host topology feed) and XTRM-630 (Sessions navigator) · Jira XTRM-104
> Numbering: this is the xtrm-app ADR series (`packages/xtrm-app/docs/adr/`). It is separate from the runtime ADR series in `docs/runtime/adr/` (001–006); the numbers do not refer to each other.
> Related: Jira XTRM-105 (ADR: tmux-derived Sessions navigator and optional topology graph view; Proposed) · Substrate XTRM-630 (Sessions navigator)

## Context

Epic XTRM-557 delivered the Agent half of `xtrm-app` over the XTRM agent host. On 2026-10-03 it passed real-host acceptance against PRD §36.11 criteria 1–14 and the §31 Agent items: 45/45 in the worker run (xtrm PR #276) and 45/45 in an independent coordinator run. Core v0.14.1 shipped through npm trusted publishing.

The operator's first live use and a coordinator review found that the result works but does not look or feel like the intended product:

- The shell does not follow the Console v2 visual language (v15 mock).
- The Agent sidebar is a flat, jumpy list of every indexed session (555 on the operator's host). Live sessions are not separated from history.
- The Frame header has no actions. Activity renders as flat rows instead of grouped semantic cards. The composer is a plain box. There is no inspector rail.
- The component registry was not used. `src/components/registry/` is empty although `components.json` configures `@shadcn`, `@spectrumui` and `@agents-ui`, and `docs/ui-component-reference-registry.md` requires registry-first work. Only 2 of about 20 Agent files use Base UI.

Root cause: every acceptance criterion was behavioural, and no worker prompt named the mocks or the registry. Nothing in the process could detect the gap.

### Operator requirements (2026-10-03 and 2026-10-04)

These statements come from the operator's live use and review. They are the requirements the Phase 0 directions are judged against (brief §4 and §9):

- **The bar:** "a harness that makes me say: I want to stay here, not in the terminal, not another harness." Functional first, but also pleasant to look at and to use.
- **Live sessions first:** the Agent navigation shows the active tmux sessions first, notification-style, instead of a flat list of every indexed session. The list must not jump.
- **tmux is the working structure:** "all is based on tmux anyway." The navigation is derived from the operator's open tmux sessions, the way the xtmux fzf picker (`~/dev/xtmux/bin/tmux-session-picker`) works, but more professional. It replaces the per-project view as the default. The coordinator chooses the exact form.
- **Graph view:** optional, never forced, and expanded with features later.
- **Chat window:** "a lot of polish to be done in the chat window": Frame, activity, composer.
- **Components:** the configured component libraries must actually be used (see Decision 6).
- **Process:** design comes before implementation, with more mocks, a Claude design pass and better component selection. The result must not be a high-fidelity copy of v15.
- **Remote use:** the operator also runs the app against hosts over SSH and Tailscale, where relayed links add 50–300 ms per round trip. Designs must keep the surface responsive and honest under latency: immediate local echo, a visible connection state, and no layout that waits on the network to settle.

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

   Board state on 2026-10-04: XTRM-622 is done (PR #278). XTRM-623 to XTRM-626 are ready and not yet dispatched. XTRM-627 and XTRM-628 wait on them.
5. **The chosen Phase 0 design becomes the implementation reference.** UI implementation children are created only after XTRM-628. There are two exceptions, both from the operator's navigation request (Decision 9):
   - XTRM-629 (host topology feed) is a data dependency with no UI. It ran before XTRM-628 and is done (core PR #717).
   - XTRM-630 (Sessions navigator) was created early so its contract could be reviewed. It is blocked by XTRM-628 and XTRM-629 and implements the chosen design, not one fixed in advance.
6. **Registry-first components.** Every implementation child records which `@agents-ui`, `@spectrumui`, `@shadcn` and Base UI candidates it searched, installed, adapted or rejected before building a component by hand. Dispositions go into `docs/ui-component-reference-registry.md`.
7. **Acceptance adds experience checks to the behavioural ones.** Each implementation child must:
   - keep the XTRM-601 real-host suite (45 tests) green;
   - supply side-by-side screenshots against the approved design, light and dark, opened by the coordinator;
   - show zero layout shift during 30 s of streaming.
8. **Worker prompts name the design files, the registry doc and this ADR.**
9. **Navigation model.** The tmux-derived Sessions navigator and the optional topology graph view are decided separately in Jira XTRM-105 and implemented through Substrate XTRM-630, which supersedes the earlier sidebar follow-up (local XTRM-618). The Phase 0 directions must each answer brief §5.
   - **Data layer (shipped):** the agent host serves the `xtrm.topology.projection.v1` projection as a live feed (Substrate XTRM-629, core PR #717). `GET /v1/topology` returns a snapshot. `GET /v1/topology/events` is an SSE stream that sends a snapshot first, then diff updates. The feed works over loopback, SSH and direct mode behind the existing auth. One tmux read serves all clients. Measured update latency on a private tmux server is 9–300 ms. Issue data comes from Substrate. Each pane carries its agent session id. The designs may assume this data (brief §7.3).
   - **Open until XTRM-628:** the hierarchy, because tmux sessions and repositories do not nest. The candidates are session-first with a repository chip, repository-first with the tmux session as a label, or a toggle. Each direction shows its answer.
   - **Graph library:** chosen by the component study (XTRM-626). Candidates include `@xyflow/react`, elkjs and cytoscape.js. The view is built on a node-kind and edge-kind registry, so later features add overlays without a rewrite.
10. **Behaviour decided before visuals.** These hold for every direction, whatever its visual design:
    - Live sessions are ordered attention-first: needs input, failed, finished and unread, working, idle.
    - Rows move only on state transitions, never while the pointer or keyboard focus is in the list.
    - Full history (hundreds of sessions) lives in the Agents fleet view, not in the navigator.
    - Every primary action is reachable by keyboard.

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
- Follow-ups outside this epic stay separate: XTRM-611 (Claude Code Remote Control parity, incl. XTRM-620 journal fidelity), XTRM-617 (Tree projection), XTRM-619 (busy right after settle). XTRM-584 (durable Pi sessions) is deferred by the operator. Numbers are local board numbers; server numbers are one lower.

## Preconditions and known gaps

These were found by the XTRM-622 and XTRM-629 workers on 2026-10-04. They do not block Phase 0. They block parts of the implementation.

| Gap | Blocks | Resolution |
|---|---|---|
| The topology feed is merged but unreleased: the operator's installed `xt` does not serve it | XTRM-630 real-host acceptance | next `xt` release, after coordination with the session that released v0.15.1 and v0.15.2 |
| Agents do not record who dispatched them: `parent_pane_id` and `parent_session_id` are empty on the real host | graph view lineage edges | `xt` writes the lineage pane options at launch (XTRM-631, blocks XTRM-630) |
| No last-state-change timestamp per pane | "stale" and "finished, unread" states | XTRM-631: write `@agent_last_transition` reliably |
| The feed's tmux control-mode watcher appears as an attached client | any "operator is watching" signal | consumers ignore control-mode clients |
| `checks_state` is always null without GitHub enrichment | PR check badges | GitHub enrichment stays opt-in (`xt host start --topology-github`); designs show the absent state
