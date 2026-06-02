---
title: xtrm Console Product Contract
project: xtrm
area: console
status: current-working-contract
created: 2026-06-02
updated: 2026-06-02
tags:
  - xtrm
  - gitboard
  - console
  - design
  - substrate
---

# xtrm Console Product Contract

This is the product/design source of truth for the xtrm console surface.

It supersedes UI guidance that lives incidentally inside Substrate design docs. Substrate can define the data model and runtime semantics; this document defines what the operator should see, how the console should feel, and which information must never disappear from the dashboard.

## Decision

Gitboard is evolving into **xtrm console**: a professional systems console for issues, specialist chains, evidence, GitHub activity, observability, terminals, and operator memory.

The console is not a generic dashboard and not a collection of embedded apps. It is a single operational surface with stable interaction contracts. Beads and Specialists are current data sources; Substrate is the future normalized read model. The product contract remains stable across that migration.

## Source Of Truth Order

1. This note: product role, UX contract, information architecture.
2. The `Visual Contract` section below: canonical light-first design baseline for the console.
3. `docs/backend-redesign.md`: materialization, API, storage, and naming architecture.
4. The complete HTML working example at `apps/gitboard/design-mocks/post-roadmap-console.html`.
5. `~/dev/specialists/docs/design/roadmap/specialists-roadmap.md`: specialist runtime direction.
6. `~/dev/specialists/docs/design/substrate/*`: Substrate/data-model context, not the UI authority.

The previous dark mock is deprecated as a visual authority, but some of its stronger structural ideas remain canonical after being translated into this contract: especially the Evidence surface as a dense proof ledger rather than a flat list.

## Product Role

The console answers four operator questions quickly:

- What is happening now?
- What changed, and why?
- Can I trust this result?
- What should I do next?

Every surface should reduce the distance between work item, agent work, evidence, and operator decision.

## Core Objects

The UI should treat these as first-class entities:

- **Issue**: the work item / bead / future substrate issue.
- **Chain**: a coordinated specialist workflow for one issue or goal.
- **Job / run**: one specialist execution inside a chain.
- **Verdict**: reviewer/seconder/test-runner judgement over scope, quality, tests, release readiness.
- **Evidence**: proof attached to a chain or issue: tests, diff, terminal feed, run result, screenshots, logs, artifacts.
- **Diff**: code or doc change produced by a run, ideally scoped and reviewable from the console.
- **Session**: the operator's current work context.
- **Memory**: durable lesson or decision saved after work completes.
- **Relationship**: dependency, parent/child, related, validates, caused-by, discovered-from, supersedes, etc.

## Information Architecture

Recommended main surfaces:

- **Feed**: chronological operator activity across issues, GitHub, specialists, and logs.
- **Issues**: list/feed-first substrate/beads work items with lineage.
- **Specialists**: chain cockpit, active and historical runs, job traceability.
- **Operations**: AgentOps console: specialist health by role, chain throughput by template, failure pattern clustering, token economics, active escalations, runtime backstage hygiene.
- **Graph**: issue relationship graph plus specialist overlays.
- **Evidence**: proof ledger for decisions, tests, diffs, verdicts, artifacts.
- **GitHub**: PRs, commits, reviews, releases, linked issues.
- **Observability**: system health, materializer freshness, specialist runtime metrics.
- **Sessions**: chronological operator workblocks, from initial prompt through chains, commits, memories, followups, and next-session handoff.
- **Terminal**: command surface, but not the only way to inspect history.

The console can expose fewer tabs initially, but the underlying IA should not collapse all proof and history into the Specialists tab.

Operations is distinct from Observability. Operations is the dashboard of the AI workforce; Observability is the dashboard of the backend and infrastructure that sustain it.

## Drawer Contract

The right drawer is not a secondary afterthought. It is the entity inspector and decision panel.

Rules:

- The drawer opens as an overlay and does not squash the main viewport.
- The main view stays as orientation/context; the drawer owns detail, provenance, and actions.
- The drawer can inspect any first-class entity: issue, chain, job, evidence, diff, memory, session, GitHub object.
- It should preserve operator context when switching entities from inside lineage or evidence links.
- It should support copy/open actions for IDs, branch, PR, trace, feed, artifact, and file references.

Default drawer tabs:

- **Overview**: title, status, owner, priority, contract summary.
- **Lineage**: parent/child/dependency/relationship graph in compact form.
- **Activity**: specialist runs and terminal/result history.
- **Evidence**: verdicts, tests, diff, screenshots, artifacts.
- **GitHub**: PRs, commits, reviews, linked issues.
- **Memories**: saved lessons and close-out notes.
- **Followups**: suggested beads or operator actions.

### Drawer Kind Polymorphism

The drawer is a uniform primitive: sticky header, tab strip, body, overlay, roughly 56vw. It is polymorphic by entity kind.

Declared drawer kinds:

- **Issue Drawer**: for root, step, gate, advisor, and followup issue classes. Tabs adapt to issue class.
- **Chain Drawer**: composition, activity, channel, outcome, trace.
- **Role Drawer**: overview, recent activity, identity memories, configuration. The entity is a specialist role classifier, not one job instance.
- **Chain Template Drawer**: resolved shape, recent instances, failure patterns, configuration.
- **Memory Drawer**: pattern, instances, cross-reference, mitigation followups, lineage. Supports failure clusters.
- **Session Drawer**: intent, opened seeds, chain runs, commits, evidence, memories, followups, next-session handoff.

Runtime component health should usually be an inline popover, not a drawer.

## Evidence Contract

Evidence is the trust layer of the console.

Evidence must read as a ledger of proof, not as a generic activity list. The preferred structure is:

- **Verdict packet**: compact summary of scope, quality, tests, release/readiness, and reviewer confidence.
- **Proof rows**: clickable rows with a left semantic rail, proof identity, human-readable result, and linked artifacts.
- **Artifact stack**: screenshots, traces, test output, command proof, logs, and generated files.
- **Diff proof**: changed files and inline diff preview when available, with an escape hatch to GitHub/local git.
- **Regression contract**: explicit anti-regression rule when the evidence proves a behavior that must not disappear.

This structure applies in both the Evidence top-level surface and the drawer Evidence tab. The drawer can be more compressed, but it must not drop verdicts, tests, artifacts, trace, or diff proof when those exist.

A completed chain or run should make these visible without leaving the dashboard:

- specialist role and model
- job id, chain id, trace id
- start/end time, elapsed time
- status and exit reason
- token/cost/tool-call summary when available
- terminal feed, collapsed by default, expandable to full height with no internal scroll trap
- run result, collapsed by default, markdown-rendered, expandable to full content with no internal scroll trap
- reviewer/seconder/test-runner verdicts
- tests run, test status, and command/proof link
- diff summary, changed files, and ideally inline diff preview
- screenshots or artifacts produced by verification
- linked issue contract and acceptance criteria
- source freshness / sync status if evidence comes from materialized data

Important anti-regression rule:

**Terminal feed and run result are both mandatory.** One must never replace the other.

Evidence-specific anti-regression rule:

**Evidence must connect verdict, proof, artifact, and diff.** Showing only a PASS/FAIL chip without the supporting proof is not acceptable.

## Specialist Activity Contract

The Specialists surface should be a chain cockpit, not only a list of jobs.

It should show:

- active chains and recent historical chains
- chain template/type
- linked issue(s)
- roles executed in order
- current role and next expected gate
- job history across all statuses, not only live or one recent done job
- waiting/input-needed state with the exact command or action needed
- failure/cancelled state with reason and last useful output
- terminal feed and markdown result per job
- reviewer/test evidence close to the chain result

Filters like `done`, `waiting`, `running`, `failed`, and `all` must filter the same complete historical corpus. A filter returning empty when the database contains matching jobs is a bug.

## Visual Contract

Baseline style: **xtrm Console Quiet** (canonical light).

A dark variant exists for long sessions and night work. It applies the same discipline on a dark substrate: one semantic accent set, rails not cards, strict color usage, and no atmospheric decoration. Design decisions are made on the light theme and validated on dark, not the other way around.

The console should feel:

- professional
- compact
- quiet
- stable
- precise
- terminal-native in details: IDs, refs, paths, durations readable like code
- silent in the surrounding chrome

### Surface Palette

- Light, canonical: primary `#FDFDFD`, secondary `#F7F8F9`, tertiary `#F1F3F5`.
- Dark: same hierarchy on the `#181818` family.
- Both variants must read as the same product at a glance. Structure is theme-invariant; luminance changes.

### Borders, Rails, Panels

- Borders: subtle <=7% alpha, default <=14%, strong <=22%.
- Use rails, usually a 2px left accent stroke, to group rows within the same entity scope.
- Use agent-color rails for activity blocks and selection rails for selected rows.
- Do not box every subsection. Group with whitespace and rails first; use borders only when a panel truly needs separation.
- Panels use minimal radius, 3-4px, with one subtle 1px border and no shadow.
- Shadow exists only on drawer overlays: `-16px 0 48px -16px rgba(15,23,42,0.18)`.

### Text Hierarchy

- Four levels: `primary`, `secondary`, `muted`, `disabled`.
- Sizes: `xs` 10.5px for IDs/meta, `sm` 11.5px for body, `base` 12.5px default, `lg` 14px emphasis, `xl` 18-22px hero numbers.
- Italic is preserved for titles and ephemeral narration: closed-state notes, live coordination, role labels. It is existing house style, not decoration.
- Mono only for IDs, SHAs, commands, file paths, durations, currency, percentages, log content. Never for prose.

### Color Discipline

One semantic accent set, applied coherently:

| Token | Light | Dark | Use |
|---|---|---|---|
| `--accent` | `#3A5FCE` | `#7B9BE8` | interactive affordances, focus ring, primary button, selected row rail |
| `--graph-state-ready` | `#2F8D5E` | `#5BCB8D` | success, healthy state, gate PASS |
| `--graph-state-blocked` | `#8C4A1F` | `#D89150` | caution, degraded but functional, gate PARTIAL |
| `--accent-red` | `#C84D3C` | `#E87469` | failure, blocking issue, P0, gate FAIL, escalation |
| `--accent-purple` | `#5A51B8` | `#9088D1` | deliberative content, design/research issues, planning, advisor class |

- Subtle background, <=10% alpha, is used only for semantic state pills and selected rows. Never decoratively and never for category-coding.
- Agent palette tokens, such as executor/reviewer/debugger/code-sanity/security-auditor/seconder/test-engineer, are used only as discrete dots and role chip colors. Never as background, gradient, or decorative fill.
- No gradients, orbs, mesh, glows, or bokeh.
- Sparklines and micro-charts are hand-drawn SVG, single color, opacity <=0.8, not a chart library with its own theme.

### Chips

- One primitive: `<Chip>`. Never multiple chip systems in the same console.
- Compact: 1-2px vertical padding, 6px horizontal padding, 3px radius.
- Text-color-first, with optional 4px status dot before the label.
- Subtle background <=10% alpha only for semantic state. Other chips are background-transparent.
- Chips behave like compact entity nodes: clickable and identity-bearing, not decorative pill badges.
- ID chip labels use mono. State chip labels use UI font.

### IDs And Refs

- Every issue, chain, container, job, commit SHA, trace ID, message ID, and branch renders mono and visually scannable.
- Identity separator is `·` or `/`, mirroring the existing `.identity-separator` class.
- IDs are clickable and navigate to the relevant drawer entity when substrate-native routing exists.
- Branches and file paths render mono but in `text-secondary`; they are context, not identity.

### Markdown

- Markdown renders within available width, with no internal scroll trap.
- Terminal feed and run result must never live in mini-scroll boxes.
- Code blocks inherit mono. Headings respect UI hierarchy: h2 = lg, h3 = base, h4 = sm.
- Inline code uses subtle background <=10%. Block code uses `--surface-2`.
- Links use `--accent`; underline only on hover.

### Iconography

- Octicon-style glyphs only.
- Use `@primer/octicons-react` in production, or one inline SVG path for prototypes.
- Do not mix Lucide, Heroicons, Material, Fluent, or Phosphor.
- Icon sizes step predictably: 9-10px in chips, 11-12px inline meta, 13-14px tabs/buttons, 16-20px panel headers, 24px+ only for rare illustrative use.

### Anti-Decoration

- No panel box-shadow; only drawer overlay shadow.
- No animation beyond subtle opacity/background transition, 120ms ease.
- No icon-only button for primary actions. Use icon plus label.
- No tooltip-only affordance for critical information.
- No dark-on-dark or light-on-light placeholder text.
- No decorative hero header or banner on internal pages.
- No emoji as UI elements; user-generated content may contain emoji.

### Continuity With Minimal FUI

The previous Minimal FUI spirit remains: quiet, professional, terminal-native in details, no decoration.

What changes:

- The chromatic substrate: canonical light, dark as variant.
- Richer color: restrained semantic palette plus agent palette, not single-cyan-only.
- Radius discipline: minimal 3-4px radius is allowed. On light theme, hard corners are too hostile; minimal radius softens without decorating.

What does not change:

- Rails, not cards.
- Density, not blobs.
- Anti-decoration.
- Quiet density.
- Terminal-native details.
- One semantic family per role.

## Layout Principles

- Rows are the primary object.
- Details expand inline for row-level dossiers.
- The drawer owns cross-entity detail.
- No nested app chrome.
- One topbar, one repo/project rail.
- Avoid inner scroll regions for normal detail text.
- Expanded terminal/result sections should reveal full content in the page/drawer flow.
- Preserve visual continuity between a run rail, terminal feed, result, verdict, and evidence.

## Session Contract

A session anchors an operator workblock over time:

- initial command or prompt
- seeds/issues opened
- chains run
- commits produced
- evidence collected
- memories distilled
- followups created
- next-session handoff

Proposed substrate shape: a container with `kind: session`, pending confirmation in the Substrate model.

The session-close report should become a structured evidence body. The Sessions surface is a chronological list of past operator workblocks and should rank above Terminal in the long-term IA.

## Pre-Substrate Mapping

Today the console can populate this contract from:

- `bd` / Beads: issues, dependencies, descriptions, notes, status, relationships.
- `sp` / Specialists: jobs, roles, chain ids, status, terminal feed, run result.
- `observability.db`: specialist_jobs, specialist_events, runtime metrics, historical job rows.
- Git: diff, commits, branches, PR links.
- Gitboard materializer: freshness, source health, cross-source joins.
- Playwright/test artifacts: screenshots and verification proofs.
- `bd remember`: memories and close-out lessons.

The UI should already use product concepts like `issue`, `chain`, `job`, `evidence`, `verdict`, and `memory`, even if the adapter still reads legacy source names.

## Post-Substrate Mapping

After Substrate lands, the UI contract should remain mostly unchanged.

Expected migration:

- Beads adapter becomes Substrate issue reader.
- Specialist jobs become a normalized chain/job/event projection.
- Evidence becomes a first-class relation or materialized view.
- Relationships become typed edges instead of ad hoc dependency lists.
- Drawer tabs keep the same shape, but their backing queries become cleaner.

The migration should feel like an adapter swap, not a redesign.

## Anti-Regression Checklist

Before merging any console UI change, verify:

- The route still shows the same entity identity and status after refresh.
- Completed specialist jobs remain visible historically.
- Terminal feed exists for live and completed jobs when available.
- Run result exists separately from terminal feed.
- Run result markdown renders correctly.
- Expanded feed/result sections do not trap content in tiny scroll boxes.
- Evidence shows verdicts, tests, artifacts, trace, and diff proof where available.
- Evidence uses ledger structure: verdict packet, proof rows, artifact stack, and regression contract.
- Relationship visibility matches or improves on Graph view.
- Drawer opens as overlay and does not squash the viewport.
- Filters operate over the complete corpus, not a partial live set.
- GitHub links navigate to GitHub-specific surfaces, not dead or unrelated views.
- Source freshness/degraded state is visible when data may be stale.
- Color usage respects the semantic accent set; the agent palette is never used decoratively as background or gradient.

## Locked Decisions

- Evidence is both a top-level surface and a drawer tab. The top-level surface is the ledger; the drawer tab is the compact proof packet for the selected entity.
- Diffs should render inline when short enough to inspect comfortably and link out to GitHub/local git for deeper review.
- Verdicts should use a provisional normalized schema before Substrate: `scope`, `quality`, `tests`, `release`, plus optional `confidence` and `reviewer`.
- Memories can appear in both places: as close-out metadata on sessions and as evidence when they encode an anti-regression rule, lesson, or design decision.
- The minimum useful customer-facing version is: Issues + Specialists + Evidence + Drawer + GitHub links + source freshness. Observability and Sessions can deepen later, but the trust loop must exist from day one.

## Remaining Open Questions

- Should `Session` become a first-class Substrate kind or a materialized view over prompts, chains, commits, and memories?
- Which artifact storage path becomes canonical for screenshots and generated verification files?
- How much inline diff is too much before the console should hand off to GitHub/local git?

## Complete HTML Example

The complete product/design example is the HTML mock:

- Gitboard route: `/gitboard/design-preview`
- Repo file: `apps/gitboard/design-mocks/post-roadmap-console.html`
- Screenshot: `apps/gitboard/design-mocks/post-roadmap-console.png`

This HTML is not a sketch fragment. It is the current complete example for a designer to inspect and critique. It should be treated as the visual and interaction reference for the pre-Substrate console direction.

It demonstrates:

- xtrm Console Quiet light baseline.
- Drawer as overlay entity inspector.
- Entity switching across chain, issue, evidence, role, template, memory, and session.
- Operations as distinct from Observability.
- Evidence as proof ledger: verdict packet, proof rows, artifact stack, diff proof, and regression contract.
- Sessions as first-class workblocks.
- Post-roadmap/pre-Substrate vocabulary.

It remains a mock, not production implementation. When the real app diverges from it, update either the implementation or this contract explicitly; do not let a silent third design emerge.

## Derived Specs

Natural follow-up specs:

1. Drawer System Spec: extend the Issue Drawer spec to cover Issue, Chain, Role, Chain Template, Memory, and Session drawer kinds.
2. Operations Page Spec: ground the AgentOps surface and distinguish it from Observability.
3. Session Drawer Spec: define session as a first-class entity after Substrate confirms or rejects `kind: session`.
