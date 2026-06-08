---
title: console-product-contract
project: xtrm
area: console
status: current-working-contract
created: 2026-06-02
updated: 2026-06-09T01:36
tags:
  - xtrm
  - gitboard
  - console
  - design
  - substrate
  - 1
  - 2
date_created: Tuesday, June 2nd 2026, 12:51:27 pm
date_modified: Sunday, June 7th 2026, 11:50:01 am
---
---
title: xtrm Console Product Contract
project: xtrm
area: console
status: current-working-contract
created: 2026-06-02
updated: 2026-06-07T04:21
tags:
  - xtrm
  - gitboard
  - console
  - design
  - substrate
date_created: Tuesday, June 2nd 2026, 12:51:27 pm
date_modified: Friday, June 5th 2026, 1:18:39 am
---
---
title: xtrm Console Product Contract project: xtrm area: console status: current-working-contract revision: 42 (Observe identity + DevOps/AgentOps build, query_answer + recommendation lifecycle — see §16; supersedes §6.4 interaction hue and §6.10 sans) created: 2026-06-02 updated: 2026-06-07 supersedes:
- xtrm Console Product Contract rev 2026-06-02 (visual-contract section + IA section)
- issue-drawer-spec.md (now §10 of this document)
- visual-contract-light-rewrite.md (now §6 of this document) tags:
- xtrm
- gitboard
- console
- design
- substrate
---

# xtrm Console Product Contract — consolidated

This is the **single source of truth** for the xtrm console surface. It replaces the previously sparse set of documents (this contract's earlier revision, the visual-rewrite document, the issue-drawer-spec, the ops-page concept) by absorbing all of them into one place.
It supersedes UI guidance that lives incidentally inside Substrate design docs. Substrate defines the data model and runtime semantics; this document defines what the operator should see, how the console should feel, and which information must never disappear from the dashboard.

## How to read this document

Sections are tagged:
- **LOCKED** — decided, do not revisit without explicit reason.
- **DRAFT** — written, validated in mock or spec, but expected to evolve as Substrate lands.
- **OPEN** — explicitly unresolved; either deferred to a later decision or waiting on Substrate/runtime confirmation.
Cross-references inside the document are by `§n` (section number); never by external file path, since this document is now the canonical reference.
The **working mock HTML** at `console/xtrm-console.html` (sibling to this contract, the canonical source) is the **visual companion** to this document. A synced copy may be served from the app under `apps/gitboard/design-mocks/` for in-app preview, but the contract sibling is the source of truth. It contains the current complete pre-Substrate reference: Operations/query lab plus the Issues/Beads feed + Bead Inspector scenario. When mock and contract diverge, update either the implementation or this contract explicitly — never let a silent third design emerge.
---

## §1. Decision [LOCKED]

Gitboard is evolving into **xtrm console**: a professional systems console for issues, specialist chains, evidence, GitHub activity, observability, terminals, and operator memory.
The console is not a generic dashboard and not a collection of embedded apps. It is a single operational surface with stable interaction contracts. Beads and Specialists are current data sources; Substrate is the future normalized read model. **The product contract remains stable across that migration** — adapter swap, not redesign.
---

## §2. Product role [LOCKED]

The console answers four operator questions, fast:
- **What is happening now?**
- **What changed, and why?**
- **Can I trust this result?**
- **What should I do next?**
Every surface should reduce the distance between work item, agent work, evidence, and operator decision.
---

## §3. Core objects [LOCKED]

The UI treats these as first-class entities:
- **Issue** — work item / bead / future substrate issue. Has `class` (root, step, gate, advisor, followup), `type` (only on root: task, bug, chore, spike, design, research), `role` (only on non-root).
- **Chain** — coordinated specialist workflow for one issue or goal. Has `chain_template`, `resolved_chain_json`, `worktree_lease`, `chain_coordinator`.
- **Job / Run** — one specialist execution inside a chain.
- **Verdict** — reviewer/seconder/test-runner judgment over scope, quality, tests, release readiness. Normalized provisional schema: `scope`, `quality`, `tests`, `release`, plus optional `confidence` and `reviewer`.
- **Evidence** — proof attached to a chain or issue: tests, diff, terminal feed, run result, screenshots, logs, artifacts.
- **Diff** — code or doc change produced by a run, scoped and reviewable from the console.
- **Session** — operator's current work context. (Pending substrate confirmation as `kind: session`, see §13.)
- **Memory** — durable lesson or decision saved after work completes. Has `type` (failure, hint, best_practice, bug), `created_by_role`, `created_by_job`, `in_container`, `reason`, `body`.
- **Role** — specialist role classifier (executor, reviewer, debugger, etc.). Not a single entity instance; a classifier that aggregates across instances.
- **Chain Template** — chain shape classifier (code-standard, debug, quantitative-validation, etc.). Not a single chain instance; a template that aggregates across instances.
- **Relationship** — typed edge between issues: blocks, parent-child, until (gate); discovered-from, validates, caused-by, relates, tracks (context); supersedes (lifecycle).
Role and Chain Template are **classifiers, not singular entities** in substrate, but the console treats them as first-class because the operator reasons about them as objects (clicking on `executor` reveals analytics across all executor runs; clicking on `debug` template reveals analytics across all debug chains).
---

## §4. Information architecture [LOCKED]

Main surfaces (tab order):
1. **Feed** — chronological operator activity across issues, GitHub, specialists, logs.
2. **Issues** — list/feed-first work items with lineage.
3. **Specialists** — chain cockpit: active and historical runs, job traceability.
4. **Operations** — AgentOps console: specialist health by role, chain throughput by template, failure pattern clustering, token economics, active escalations, runtime backstage hygiene. **Distinct from Observability** (see §4.1).
5. **Evidence** — proof ledger: decisions, tests, diffs, verdicts, artifacts.
6. **Graph** — issue relationship graph plus specialist overlays.
7. **GitHub** — PRs, commits, reviews, releases, linked issues.
8. **Observability** — system health, materializer freshness, specialist runtime metrics. **Distinct from Operations** (see §4.1).
9. **Sessions** — chronological operator workblocks: prompt, chains run, commits, memories, followups, next-session handoff.
10. **Terminal** — command surface, but not the only way to inspect history.
The console can expose fewer tabs initially, but the underlying IA must not collapse all proof and history into the Specialists tab.
### §4.1 Operations vs Observability [LOCKED]
These are deliberately separate surfaces because they answer different questions:
|Surface|Subject|Examples|
|---|---|---|
|**Operations**|The AI workforce|Specialist health by role, chain throughput by template, failure clusters, token economics, active escalations|
|**Observability**|The backend sustaining it|System health, materializer freshness, runtime daemon metrics, infra/network|
Operations is built natively over OTel/Prom/Loki backends through the console's own UI primitives — **not via embedded Grafana iframes** (see §6.x color & integration decision). Observability surfaces backend-of-record state and may embed external dashboards where appropriate, but Operations does not.
---

## §5. Drawer contract [LOCKED]

The right drawer is **not a secondary afterthought**. It is the entity inspector and decision panel — and the navigation primitive of the entire console.
### §5.1 Behavior [LOCKED, revised rev 36 — non-modal]
- Drawer opens as an overlay panel docked right; **does not squash the main viewport**.
- **NON-MODAL (rev 36, supersedes scrim + backdrop-close):** no scrim; the main view stays fully **interactive and scrollable** while the drawer is open. The operator can scroll lists, expand inline dossiers, and compare content next to the open inspector (the Datadog side-panel model).
- **Retarget, don't reopen:** clicking another entity while the drawer is open **replaces the drawer content with that entity** (the §5.3 replace semantics, now the default gesture) — the drawer never has to be closed first.
- **Close is explicit only:** X control in the drawer header, `]`, or Esc. Backdrop-click close is removed (there is no backdrop).
- Main view stays as orientation/context; drawer owns detail, provenance, and actions.
- Drawer can inspect any first-class entity from §3.
- Preserves operator context when switching entities from inside lineage or evidence links.
- Supports copy/open actions for IDs, branch, PR, trace, feed, artifact, and file references.
- **Width:** `min(50vw, 720px)` (matches shipped `.bead-side-drawer`).
- **Shadow:** `--drawer-shadow` (light `-16px 0 48px -16px rgba(15, 23, 42, 0.18)` / dark `-12px 0 32px rgba(0, 0, 0, 0.45)`) — drawer is the only place shadow exists in the console. (`--scrim` is **deprecated**, §6.12.)
- **Breadcrumb in header:** `xtrm / <kind> / <id>` always visible — the navigation context that survives entity switching.
### §5.2 Drawer kind polymorphism [LOCKED]
The drawer is a **uniform primitive** (sticky header, tab strip, body, overlay, ~56vw). It is **polymorphic by entity kind**. The kinds declared, with locked tab sets:
|Drawer kind|Tabs|Entity source|
|---|---|---|
|**Issue Drawer**|Overview · Lineage · Activity · Evidence · GitHub · Memories · Followups|substrate `issues` (class adapts the tab content; see §10)|
|**Chain Drawer**|Composition · Activity · Channel · Outcome · Trace · Diff · Memories|substrate `containers WHERE kind=chain`|
|**Role Drawer**|Overview · Recent Activity · Identity Memories · Configuration|classifier query: `WHERE role=X`|
|**Chain Template Drawer**|Resolved Shape · Recent Instances · Failure Patterns · Configuration|classifier query: `WHERE chain_template=X`|
|**Memory Drawer**|Pattern · Instances · Cross-reference · Mitigation Followups · Lineage|substrate `memories` (supports failure clusters)|
|**Session Drawer**|Intent · Opened Seeds · Chain Runs · Commits · Evidence · Memories · Followups · Next-session Handoff|substrate `containers WHERE kind=session` (pending §13)|
|**GitHub Drawer**|Overview · Commits · Files · Checks · Linked|materialized GitHub events (PR / commit / release / review); reuses `EventDetail` / `PrTimeline` (§11.6)|
**Runtime component health** (LSP, Dolt, MCP, daemon) is an **inline popover, not a drawer** — these are 95% green and don't justify a kind. Promote to drawer later if usage shows it's needed.
### §5.2.1 Shell primitive and reuse [LOCKED]
The polymorphic drawer is one **kind-agnostic shell** — `DrawerShell`: overlay, scrim, focus-trap, ESC, portal, sticky-header slot, tab strip, body — **extracted from the shipped `BeadSideDrawer.tsx`**, which already provides overlay/focus/portal/backdrop-close and reuses `IssueDossier`. Polymorphism is configuration, not forking: each kind supplies a header descriptor + tab list + per-tab content over the same shell.
- **kind=issue is the first instance.** Its Overview tab renders the existing `IssueDossier` component **unchanged** — no reimplementation, no regression.
- **New kinds** (Chain / Role / Chain-Template / Memory / Session) are new tab configs over the same shell. The shipped `ChainDetailPane` becomes the Chain drawer's Activity/Composition content rather than a parallel pane.
- **Build incrementally on the extracted shell; do not fork a second inspector.** This is the migration path from the shipped single-pane bead drawer to the full §10 tabbed, §5.2 polymorphic inspector.
### §5.3 Cross-entity navigation [LOCKED]
When the operator clicks a related entity inside an open drawer (an ID chip in Lineage, a related entity in Followups, a job in Activity), the navigation behavior is:
- **Depth 1-3:** cascade or replace, depending on the relationship (Linear-style replace with breadcrumb is the default).
- **Depth ≥ 4:** **promotion to full-page view**. The drawer navigation does not become a stack four levels deep. The fourth click opens a dedicated route (`/operations/role/executor/chain/<id>`, etc.) — shareable URL, refresh-safe, more screen real estate.
The breadcrumb in the drawer header (`xtrm / <kind> / <id>`) reflects the current depth. Back navigation respects browser history.
### §5.4 Drawer click targets per surface [LOCKED]
Per-surface mapping of click targets to drawer kinds:
|Surface|Click target|Drawer kind|Notes|
|---|---|---|---|
|Feed|issue/bead event|Issue Drawer|focused on the tab the event implies (status → Overview; activity → Activity)|
|Feed|specialist event (verdict / job)|Chain Drawer (Outcome) **or** Issue Drawer · Activity on the job|per event; a `review.verdict.fail` → Chain · Outcome|
|Feed|GitHub event (PR / commit / release / review)|GitHub Drawer|inline commit accordion stays as the row peek (§8.1)|
|Issues|issue row|Issue Drawer|adapts by class|
|Specialists|chain row|Chain Drawer|primary|
|Specialists|job row|Issue Drawer (the step-issue of that job)|each job is backed by a step-issue|
|Specialists · Roles (rev 39)|specialist health row (`executor`)|Role Drawer|new kind, see §11|
|Specialists · Templates (rev 39)|chain throughput row (`debug` template)|Chain Template Drawer|new kind, see §11|
|Operations|failure cluster|Memory Drawer|new kind, see §11|
|Operations|active escalation row|Chain Drawer||
|Operations|SRE-agent activity row|Chain Drawer||
|Operations|runtime backstage card|**popover inline, not drawer**|see §5.2|
|Operations|top pulse strip cell|**scroll-focus the relevant panel, no drawer**|aggregates, not entities|
|Evidence|proof row|Issue Drawer or Chain Drawer (depending on `evidence.refers_to`)||
|Sessions|session row|Session Drawer|pending §13|
|Graph|node|drawer of the node's entity kind|polymorphic|
The pulse strip exception is deliberate: aggregates don't get drawers. Every entity does.
### §5.5 Bead Inspector vs inline issue preview [LOCKED]
The **Issue/Bead drawer is the canonical bead detail surface**, but it must not erase the inline feed affordance that already works.
The contract is:
- **IssueFeed row primary click:** toggles the inline expanded dossier **in place** — the fast, non-modal peek, the default triage gesture (matches shipped `IssueFeed.tsx`). The row is a disclosure (`aria-expanded`/`aria-controls` on the dossier).
- **Chevron control + issue ID chip + keyboard:** open the canonical Bead Inspector drawer. The drawer is the heavier, semi-modal surface, so it is the explicit affordance, not the default click — reachable via the chevron, the mono ID chip (IDs are entity nodes, §6.6), and a shortcut on the focused row.
- **Rationale [design, supersedes rev-4]:** the largest target maps to the cheapest, least-disruptive action (in-context peek, preserves feed scroll); the modal drawer is a deliberate escalation. "Canonical detail surface" ≠ "default click". Reversed after validating against shipped, tested code (`BeadSideDrawer` opens from the chevron, the row expands inline).
- **Inline expanded preview:** remains a fast local dossier. It keeps the current `IssueFeed.tsx`/`IssueDossier` information shape: header, description, specialist activity summary, notes, labels, related beads, audit log, and dependency tree.
- **Bead Inspector Overview:** reconstructs the inline dossier first, then extends it with deeper navigation and proof. The drawer must feel like "the full version of what I just previewed", not a different object model.
- **Specialist/run chips in the feed:** open Bead Inspector on `Activity`, with the relevant job highlighted when available.
- **Lineage links:** clicking a related/dependency/closed/future issue replaces the drawer target with that issue and preserves a back stack.
- **Chain/container links:** open the chain/container view where the target is a chain/container. Bead links inside those views still open Bead Inspector.
Anti-regression rule: never replace the inline expanded preview with the drawer, and never replace the drawer's bead-centric content with a chain/operations object just because the user entered from Operations.
---

## §6. Visual contract [LOCKED]

Baseline: **xtrm Console Quiet** (canonical light).
A **dark variant** exists for long sessions and night work. It applies the same discipline on a dark substrate: one semantic accent set, rails not cards, strict color usage, no atmospheric decoration. **Design decisions are made on the light theme and validated on dark, never the reverse.**
The console should feel:
- professional
- compact
- quiet
- stable
- precise
- terminal-native in details (IDs, refs, paths, durations readable like code)
- silent in the surrounding chrome
### §6.1 Surface palette [LOCKED]
Canonical = the shipped production `.ide-shell[data-theme]` ramp (Slate light), not the old `tokens.css` base. Var names are the production namespace `--surface-primary/secondary/tertiary/quaternary` (with `--surface-1..4` kept as aliases).
|Semantic|Var|Light (canonical)|Dark (variant)|
|---|---|---|---|
|surface-1|`--surface-primary`|`#FFFFFF`|`#101010`|
|surface-2|`--surface-secondary`|`#F8FAFC`|`#1A1A1A`|
|surface-3|`--surface-tertiary`|`#F1F5F9`|`#222222`|
|surface-4|`--surface-quaternary`|`#E2E8F0`|`#2D2D2D`|
Both variants must read as the same product at a glance. Structure is theme-invariant; only luminance changes. Light is canonical; dark is validated, not designed-first.
### §6.2 Borders, rails, panels [LOCKED]
- Borders: subtle ≤7% alpha, default ≤14%, strong ≤22%.
- **Use rails** — a 2px left accent stroke — to group rows within the same entity scope. Agent-color rail for activity blocks; selection rail (`--accent`) for selected rows.
- Do not box every subsection. Group with whitespace and rails first; use borders only when a panel truly needs separation.
- Panels: minimal radius 3-4px, one subtle 1px border, no shadow.
- Shadow exists **only on drawer overlay** (`-16px 0 48px -16px rgba(15, 23, 42, 0.18)`).
### §6.3 Text hierarchy [LOCKED]
- Four levels (`--text-primary/secondary/muted/disabled`). Light (canonical): `#0F172A` / `#334155` / `#64748B` / `#8F8F8F`. Dark: `#F2F2F2` / `#C7C7C7` / `#8F8F8F` / `#626262`.
- Sizes: `xs` 10.5px (IDs, meta), `sm` 11.5px (body), `base` 12.5px (default), `lg` 14px (emphasis), `xl` 18-22px (hero numbers).
- **Italic preserved** for titles and ephemeral narration (closed-state notes, live coordination, role labels). House style, not decoration.
- **Mono only** for IDs, SHAs, commands, file paths, durations, currency, percentages, log content. **Never for prose.**
### §6.4 Color discipline [LOCKED]
**One precise color identity** (rev 28, user palette). Five chromatic roles + one interaction accent; corporate-grade plain, Datadog-class restraint. **There is deliberately no green**: success is the calm dark cyan — only red and amber "shout".
|Role|Var|Light|Use|
|---|---|---|---|
|interaction|`--blue`|`#3A5FCE`|**only** nav attiva, links, selection, focus, primary buttons, selected filter chip. Never inside a status chip.|
|state primary|`--green` (cyan)|`#155E75`|specialist activity + the live/settled axis: **running (solid)** / **pass · done · ok (tint)**|
|alert|`--red`|`#DC2626`|fail / blocking / P0 / breached — solid|
|warn|`--amber-fill` + `--amber`|`#FBBF24` fill (`#451A03` ink) / `#B45309` text|waiting / partial / escalated / P1|
|special|`--violet`|`#7E22CE`|epic / merged / gate class — tint|
|chip base|`--chip-base` + `--chip-line`|`#F8FAFC` / `#E2E8F0`|resting surface of every neutral chip|
Discipline:
- **Form encodes urgency (the Datadog rule): SOLID = live or needs attention** (running, failed, escalated, breached — saturated fill, white or dark ink) · **TINT = settled state** (pass, merged, closed, blocked — ≤10–16% alpha bg + colored text + hairline border) · **NEUTRAL = metadata** (`--chip-base` bg, slate text).
- **Blue/cyan role split is hard:** royal blue answers *"where can I go / what is selected"*; cyan answers *"what is the system doing"*. They never swap.
- **Categories carry meaning through icons, not colour.** Type / kind / source / template / evidence chips are neutral; colour is reserved for semantic state (status, verdict, priority) and diffstats `+/−`.
- **Agent roles** colored in cyan text + status dot only. Never as background fill.
- **No gradients, orbs, mesh, glows, bokeh.**
- Sparklines and micro-charts: hand-drawn SVG, single color, opacity ≤0.8.
- Dark-theme pairs: to be derived at implementation (same roles, lifted values); the light set above is canonical.
- *Graph exception:* the Graph surface keeps its legacy type/priority coloring (form fidelity, §9.1).
### §6.5 Chips [LOCKED]
- **One primitive: `<Chip>`.** Never multiple chip systems in the same console.
- Compact: 1-2px vertical padding, 6px horizontal padding, 3px radius.
- Text-color-first, with optional 4px status dot before the label.
- Subtle background ≤10% alpha only for semantic state. Other chips are background-transparent.
- Chips behave like **compact entity nodes** — clickable, identity-bearing — not decorative pill badges.
- ID chip labels: mono. State chip labels: UI font.
- **Segmented chip** `(a / b / c)` [LOCKED, revised rev 32]: a single tight, light pill carrying 2-3 **slash-separated slots** for compact classification — one pill instead of several scattered chips. ~10.5px, padding `1px 7px`, 3px radius, subtle bg + hairline border; slashes in `--line-strong`. The first slot may be an **icon** (source: `robot` / `git-merge` / `issue-opened`). **Slots are strictly neutral**: the only coloured content allowed inside a slot is the diffstat `+/−` pair (§6.4) and the **cyan agent-role identity text** (roles are identity, not state). **Semantic state never rides inside a slot** — it leaves the seg-chip and becomes a **trailing status pill** (variant set below); priority leaves as a `prib`. This supersedes the rev-14 "colour on genuine semantic state in slots" allowance. Row anatomy everywhere: `seg-chip (source / meta, neutral) [+ prib] + status pill`. Standard across Feed rows, GitHub rows, Specialists chain rows, the activity-card header, and any dense classification.
- **Status-pill variant set** [LOCKED, rev 32] — the three-tier rule typed as named variants (the §6.13 CVA mapping, one rule per variant): `run` (solid cyan + pulsing dot: running · working · in progress · in review) · `pass` (tint cyan: passed · done · closed) · `fail` (solid red: failed · error · breached) · `warn` (solid amber, dark ink: escalated · waiting on operator) · `part` (tint amber: partial · advisory) · `closed` (tint red: blocked · closed without merge) · `special` (tint violet: merged · release · gate · epic) · `idle` (neutral: next · queued · draft · open). A `sm` modifier (10px, `0 6px`) for in-row use. **Chips never carry state colours** — state is exclusively pill-shaped; the only chromatic chip is the solid-blue *selected filter* chip (interaction, §6.4).
- **Icon slot** [LOCKED]: any chip may carry one leading **Octicon** (status / kind / source / evidence). **Status chips are icon + word** — redundant with colour for scannability and colour-blind accessibility (`check-circle` passed, `play` running, `clock` waiting, `flame` escalated, `x-circle` failed). **Kind / source / evidence chips are neutral**: the icon carries the category, never colour. No emoji, no character-glyph icons (§6.8).
- **Three-tier form rule** (rev 28, §6.4): every chip is one of **status pill** (SOLID live / TINT settled), **entity chip** (neutral base, detail-rich), or **tag** (neutral, mono). The running pill carries a pulsing dot.
- **Priority block `prib`** [LOCKED]: priority leaves the slash slots and becomes a leading **solid mini-block** — `P0` solid red, `P1` solid amber (dark ink), `P2+` neutral slate, epic = purple tint. Mono, 10px, 2px radius.
- **Specialist entity chip** [LOCKED]: one compressed line, detail-rich — `[status dot] role (cyan, mono 650) / job-id (muted mono) / model (dim) · metrics`, with a trailing status pill (`running` solid · `pass` tint · `failed` solid red). This is the `id-chip` evolution; used in job cards, joblines, cockpit rows.
- **Issue entity chip** [LOCKED]: one compressed line — `[prib] id (mono 650) / type (neutral; epic in purple) · state pill` (`in progress` solid cyan · `open` neutral · `closed` tint cyan · `blocked` tint red). Used in issue rows, feed rows, drawer headers.
### §6.6 IDs and refs [LOCKED]
- Every issue, chain, container, job, commit SHA, trace ID, message ID, branch: **mono, visually scannable**.
- Identity separator: `·` or `/`, mirroring the existing `.identity-separator` class.
- IDs clickable; navigate to the relevant drawer entity when substrate-native routing exists.
- Branches and file paths: mono but `text-secondary` (context, not identity).
### §6.7 Markdown [LOCKED]
- Renders within available width, **no internal scroll trap**.
- **Terminal feed and run result must never live in mini-scroll boxes** (anti-regression rule, see §9).
- Code blocks: mono. Headings: UI hierarchy (h2 = lg, h3 = base, h4 = sm).
- Inline code: subtle background ≤10%. Block code: `--surface-2`.
- Links: `--accent`, underline only on hover.
### §6.8 Iconography [LOCKED]
- **Octicon-style glyphs only.**
- Use `@primer/octicons-react` in production, or one inline SVG path for prototypes.
- **Do not mix** Lucide, Heroicons, Material, Fluent, Phosphor.
- Icon sizes step predictably: 9-10px (chips), 11-12px (inline meta), 13-14px (tabs/buttons), 16-20px (panel headers), 24px+ (rare illustrative).
- **Status (2026-06-04):** the shipped app already uses `@primer/octicons-react` for chrome/controls — Octicon is satisfied in production; the working mock is the lagging artifact and must be migrated off text glyphs. Icons are now **first-class in the navigation** (§9.2): every primary-rail surface and secondary-nav item carries an Octicon.
- **Octicon-only, no exceptions [LOCKED, revised 2026-06-04].** Every icon role — status, kind, source, evidence, **dependency markers**, nav, actions, disclosures — is an Octicon (production: `@primer/octicons-react`; mock prototype: inline SVG / sprite). **No emoji and no character-glyph icons** (`✓ ✕ › v ↪ ↩ ◌` and similar). The earlier dependency-glyph exception is **withdrawn** — dependency/relationship markers become Octicons too, at the smallest size step. (User-generated content may still contain emoji; this rule governs UI chrome only.)
### §6.9 Anti-decoration [LOCKED]
- No panel box-shadow (only drawer overlay).
- No animation beyond subtle opacity/background transition (120ms ease).
- No icon-only button for primary actions — icon + label.
- No tooltip-only affordance for critical information.
- No dark-on-dark or light-on-light placeholder text.
- No decorative hero header or banner on internal pages.
- No emoji as UI elements (user-generated content may contain emoji).
### §6.10 Theming font stack [LOCKED]
- UI: `Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
- Mono: `"JetBrains Mono", "SFMono-Regular", Consolas, monospace`
Inter must be self-hosted or loaded reliably; do not depend solely on Google Fonts. JetBrains Mono is required for ID scannability.
**Status (2026-06-04) [decision LOCKED]:** the shipped `tokens.css` currently sets `--font-mono: 'Inter'` (no real monospace — IDs/SHAs render proportional) and loads Inter via a Google Fonts `@import`. Both must change: adopt **JetBrains Mono** self-hosted for `--font-mono`, and self-host Inter. This is a migration task, not an open question.
### §6.11 Continuity with the previous Minimal FUI [LOCKED]
The previous Minimal FUI baseline (dark, single-cyan accent) is **deprecated as a visual authority**. What survives:
- Rails not cards
- Density not blobs
- Anti-decoration
- Quiet density
- Terminal-native details
- One semantic family per role
What changes:
- The chromatic substrate: canonical light, dark as variant.
- Richer color: restrained semantic palette plus agent palette, not single-cyan-only.
- Radius discipline [LOCKED]: minimal **3-4px** radius (`--radius-sm: 3px`, `--radius-md: 4px`). The shipped `tokens.css` scale is `0px` (square); migrate. Hard square corners on light read too hostile; minimal radius softens without decorating.
### §6.12 Canonical token system & deprecations [LOCKED]
**One semantic token layer, two themes.** Canonical = the shipped production `.ide-shell[data-theme="light"|"dark"]` mechanism mounted in `apps/gitboard` (already a light/dark shell). Light is canonical, dark is the validated variant. All surfaces consume the same semantic var names (§6.1, §6.4); themes only swap values.
**Deprecated — remove, do not extend:**
- `tokens.css :root` base (dark GitHub palette, gray `--accent: #b8b8b8`, `--font-mono: 'Inter'`, radius `0`, shadow `none`) — superseded by the `.ide-shell` themes; keep only as low-level fallback, never as a design authority.
- `.fui-*` Minimal-FUI skin (radial-gradient atmosphere, blur, glow `box-shadow: 0 0 12px`, cyan `#5cd1e3`) — violates §6.9 anti-decoration.
- `.westworld-app` skin and the `.design-preview-container` override — redundant once §6 values *are* the shell's light theme (the mock then renders under the canonical light tokens, not a separate preview override).
- Google Fonts `@import` — replace with self-hosted Inter + JetBrains Mono.
**Drawer tokens** (§5.1): `--drawer-shadow` light `-16px 0 48px -16px rgba(15,23,42,0.18)` / dark `-12px 0 32px rgba(0,0,0,0.45)`. Drawer width aligns to the shipped `min(50vw, 720px)` (supersedes the earlier 56vw). `--scrim` is **deprecated as of rev 36** — the drawer is non-modal (§5.1), there is no backdrop.
### §6.13 Implementation stack [OPEN — recommended for evaluation]
Recommendation for the production implementation (not locked; to be validated by the implementing dev). Guiding constraint: a **visually dense** app — Datadog-class information density, compact rows, tight chips — with a fully custom identity (§6.4/§6.5). That constraint rules out opinionated component libraries (MUI / Ant / Mantine / Carbon: their spacing scales and look fight both our density and our identity) and points to the **headless + utility** standard:
- **Tailwind CSS v4** as the token engine, not as the design system: §6.4 palette + §6.10 fonts + 3–4px radii become the `@theme` tokens; **density is encoded in the scale** (tight spacing steps, 10–12.5px type sizes as first-class tokens, compressed line-heights) so compactness is the default, not a per-component fight. Dark theme = token swap (§6.12).
- **Radix UI primitives** (already in the codebase via `@radix-ui/react-collapsible`) for everything accessible we must not reinvent: `Dialog` → `DrawerShell` (§5.2.1: focus trap, Esc, aria), `Tabs` → drawer tab strips, `Tooltip` (e.g. the est-cost caveat), `DropdownMenu`, `Popover`.
- **shadcn/ui** as the assembly pattern: Radix + Tailwind components **copied into the repo and owned**, restyled to this contract — never a themed dependency to fight.
- **CVA (class-variance-authority)** to encode §6.5 as types: `<Chip variant="solid|tint|neutral" tone="state|alert|warn|special">`, `<Prib p={0|1|2} epic>`, and the specialist / issue **entity chips** as composed components. One design rule = one typed variant; no class drift.
- **TanStack Table + TanStack Virtual** (headless) for the dense lists — issues feed, chain list, proof ledger, timelines (`ActivityTimeline` already virtualizes); headless keeps our row anatomy (§8.1) untouched.
- Keep: **Primer Octicons** (§6.8), **ReactFlow** for Graph (§9.1 legacy form), hand-drawn single-color SVG micro-charts (§6.4 — no chart library themes).
The contract stays the source of truth: Tailwind/CVA are how §6 materializes in code, never an alternative authority.
---

## §7. Evidence contract [LOCKED]

Evidence is the **trust layer** of the console.
Evidence must read as a **ledger of proof**, not as a generic activity list.
### §7.1 Evidence structure [LOCKED]
The preferred structure (applies to both the Evidence top-level surface and the Evidence drawer tab):
1. **Verdict packet** — compact summary of scope, quality, tests, release/readiness, reviewer confidence. Rendered as a 4-card row at the top: `verdict`, `tests`, `findings`, `artifacts`.
2. **Proof rows** — clickable rows with left semantic rail (PASS green / PARTIAL orange / FAIL red), proof identity (mono ID + state chip + timestamp), human-readable result (bold lede + secondary text), and linked artifacts (chip-list right-justified).
3. **Artifact stack** — screenshots, traces, test outputs, command proofs, logs, generated files. Rendered as left-rail cards inside the drawer Evidence tab; as inline chip references in the top-level ledger.
4. **Diff proof** — changed files and inline diff preview when available, with escape hatch to GitHub/local git for deeper review.
5. **Regression contract** — explicit anti-regression rule when the evidence proves a behavior that must not disappear. Rendered as a `warn`-railed diff block (`- old behavior` / `+ new behavior`).
The drawer Evidence tab can be more compressed than the top-level surface, but **must not drop verdicts, tests, artifacts, trace, or diff proof when those exist**.
### §7.2 Required evidence fields on completed work [LOCKED]
A completed chain or run must make these visible without leaving the dashboard:
- specialist role and model
- job id, chain id, trace id
- start/end time, elapsed time
- status and exit reason
- token/tool-call summary when available (cost is a non-authoritative token-derived estimate; USD deferred)
- **terminal feed**, collapsed by default, expandable to full height **without internal scroll trap**
- **run result**, collapsed by default, markdown-rendered, expandable to full content **without internal scroll trap**
- reviewer/seconder/test-runner verdicts
- tests run, test status, and command/proof link
- diff summary, changed files, and ideally inline diff preview
- screenshots or artifacts produced by verification
- linked issue contract and acceptance criteria
- source freshness / sync status if evidence comes from materialized data
### §7.3 Anti-regression rules [LOCKED]
- **The forensic activity stream and the run result are both mandatory, and separate (§10.2).** The forensic event stream supersedes the old raw terminal-feed dump as the live/structured view (the raw transcript stays reachable as an escape-hatch detail); the result keeps its own dedicated zone. One must never replace the other.
- **Evidence must connect verdict, proof, artifact, and diff.** Showing only a PASS/FAIL chip without the supporting proof is not acceptable.
- **Filters must operate over the complete corpus**, not a partial live set. A filter returning empty when the database contains matching jobs is a bug.
- **Completed specialist jobs must remain visible historically**, indefinitely, regardless of chain close state.
### §7.4 Evidence vs Memory [LOCKED]
Both can carry lesson-learned content, but they live in different drawers:
- **Evidence** is per-entity proof: tied to a specific issue/chain/run.
- **Memory** is durable, cross-task knowledge: distilled by the chain coordinator at close time (`type:failure`, `type:best_practice`), queryable across herd / workgroup / identity lenses.
A memory that encodes an **anti-regression rule** appears in both places: as a `mem:*` evidence row in the relevant chain's Evidence tab, and as the canonical Memory entity in the Memory drawer.
---

## §8. Specialist activity contract [LOCKED]

The Specialists surface is a **chain cockpit**, not only a list of jobs.
It must show:
- active chains and recent historical chains
- chain template/type
- linked issue(s)
- roles executed in order
- current role and next expected gate
- **job history across all statuses**, not only live or one recent done job
- waiting/input-needed state with the exact command or action needed
- failure/cancelled state with reason and last useful output
- terminal feed and markdown result per job
- reviewer/test evidence close to the chain result
Filters (`done`, `waiting`, `running`, `failed`, `all`) must filter the same complete historical corpus.
### §8.1 Feed surface [DRAFT]
The **Feed** (§4 #1) is the ecosystem-level reverse-chronological stream — the "what is happening now / what changed" answer (§2). Where the drawer Activity timeline (§10.2) is one job's forensic stream, the Feed merges streams across the whole ecosystem.
**Merges:**
- specialist job forensic events (`xtrm.forensic.v1` families — the §10.2 row design);
- issue lifecycle (bead status changes / interactions, `listInteractions`);
- GitHub events (push / PR / review / release — reuse the shipped `ActivityTimeline` / `EventIcon` / `EventDetail`);
- logs.
**Row anatomy [LOCKED]** — the Feed reuses the **IssueFeed row language** (§9.1) plus a timeline gutter:
- a **left time gutter** (~44px) for chronological scanning, and a **source-color left rail**;
- a **single line**: identity (`entity-id / summary`) + one **neutral segmented chip** `(source / meta)` plus a **trailing status pill** (and a `prib` where priority applies) per §6.5 rev 32 — state never inside the seg slots;
- **gesture = the issue gesture (§5.5):** a **row click expands an inline mini-dossier** of the event (verdict + metrics + files + role path + "Open in drawer"); the **chevron / id opens the drawer** (target per source, §5.4).
Color encodes outcome/source (pass green, fail red, escalated amber, PR-merge purple, issue blue, push neutral). Day-grouped headers (Today / Yesterday / date). Each row is an **activity rollup**, not a raw event. GitHub push rows use the inline commit-accordion as their mini-dossier; other rows show a source-appropriate mini-dossier.
**Filters:** by source/family (issues / specialists / github / logs), by scope (repo / project), by entity. Reverse-chronological, virtualized (reuse `IssueFeed`'s `useVirtualizer`).
**Same compact-then-expand logic as the job card (§10.2):** a Feed row shows only the short summary; expanding (or opening the drawer) reveals the detail. The Feed never dumps raw events — the firehose lives behind the drawer, never on the surface.
**Backing:** a cross-source time-ordered merge. Pre-substrate: merge of `specialist_job_events`, bead interactions, and materialized GitHub events. A unified `GET /api/feed` (paginated by `(t, seq)`) is the target; correlation IDs stay in the payload, never as metric labels.
**Reuse, do not rewrite (§9.1):** the GitHub timeline components, the bead row identity style, and the forensic row design are composed here, not reimplemented.
**Architecture [LOCKED] — one timeline, not three.** The Feed *is* the single cross-source activity timeline. The shipped GitHub `ActivityTimeline` is **generalized into the shared timeline engine** (day grouping, time gutter, dot + icon + content, diffstats, virtualization, new-events banner, `j/k` nav); the GitHub **Activity** tab becomes that same engine **scoped to `source=github` + the selected repo**. No parallel second timeline.
Feed is **distinct from Issues (§4 #2).** Feed = "what happened" (chronological activity stream); Issues = "what to work on" (the `IssueFeed` work-item list with grouping, dossier, lineage). Today the app's `feed` route renders the beads view (`BeadsRepoView`) — that becomes **Issues**; this unified timeline becomes **Feed**.
---

## §9. Layout principles [LOCKED]

- **Rows are the primary object.**
- Details expand inline for row-level dossiers.
- The drawer owns cross-entity detail.
- No nested app chrome.
- One topbar, one repo/project rail.
- Avoid inner scroll regions for normal detail text.
- Expanded terminal/result sections reveal full content in the page/drawer flow.
- Preserve visual continuity between a run rail, terminal feed, result, verdict, and evidence.
### §9.1 Reuse inventory — compose, do not rewrite [LOCKED]
The shipped Gitboard app contains carefully tuned pieces. The console contract **reuses them as shared primitives**; the new model is built on top of them, never reimplemented or regressed:
- **Markdown rendering** — `IssueFeed.tsx` `renderSafeBody` / `ResultMarkdown` (`lib/markdown.tsx`): sanitized markdown for descriptions, notes, and run results.
- **Dependency tree + relationship grouping** — `DependencyTree`, `renderRelationshipGroups`, and the grouping logic (`groupChildrenByBlocker` / `choosePrimaryBlocker` / `groupChildrenByParent`, `getDisplayStatus` blocked-derivation). These are regression-protected before any visual migration.
- **Issue row identity/metadata style** — `IssueRow`: `id · separator · title`, priority/type/status classification, dependency chips.
- **Inline dossier** — `IssueDossier`: the canonical Overview source reused by the drawer (§5.2.1).
- **Specialist activity detail** — `BeadActivityPane` (terminal feed + markdown result, grouped by chain) and `ChainDetailPane` (chain-centric job blocks with role chip + turns/tools/model meta).
- **Graph** — `pages/console/Graph.tsx` per-cluster panes + `g-node` bead chips (priority rail, type/state, agent badge), NOW strip, orphans strip, buckets, foot. The mock reproduces this **form statically** (SVG node-link), with the one change that **clicking a node chip / orphan opens its drawer** — parity with the legacy `openSidebar` (§11).
- **GitHub view** — `StatsHeader` (events/pushes/PRs/commits/repos), `EventIcon` / `eventColor` event-type taxonomy, `ActivityTimeline` day-grouping, and `EventDetail` (proportional diffstat bar + expandable `CommitRow` bodies + files). Inherited into the GitHub surface + drawer (§11.6), mapped to the restrained mock palette.
- **Evidence** — verdict packet (4-card) + proof-row ledger (semantic rail) + artifact stack + diff/regression blocks per §7. New (no shipped component — grounded in the contract).
These are the floor. Contract surfaces extend them; they do not replace or duplicate them.
### §9.2 Navigation & shell [LOCKED]
The console navigation lives in **two horizontal top bars + a left context sidebar**, icons throughout (Octicon, §6.8). The two bars have **one semantic each — navigation only**; filtering never lives in a top bar.
- **Top bar 1 — parent sections:** brand + five parents: **Feed · Issues · Specialists · Operations · GitHub**. Clicking a parent opens its default surface (the parent's first child).
- **Top bar 2 — child surfaces of the active parent [revised rev 39 — dedicated pages, not scroll anchors]:** the conceptual split is **Specialists = the workforce · Operations = running the system**:
  - Feed → Feed; Issues → Issues · **Graph**; GitHub → GitHub.
  - **Specialists → Cockpit · Roles · Templates** — instances (chains/jobs live), aggregates by role (rows → Role Drawer), aggregates by template (rows → Chain Template Drawer). Each is a dedicated page.
  - **Operations → Overview · Explore · Economics · Incidents · Evidence · Observability · Sessions · Terminal** — Overview is the only composite page (pulse strip + failure clusters + escalations + runtime + SRE strip); Explore (§12.5), Economics and Incidents (§12.7) are dedicated pages.
  - **In-surface section anchors survive only where a page is legitimately long** (Observability → Overview · Logs · Traces · Components, scroll-focus). The former Operations section anchors are gone — its content became real child pages.
  - **Cross-page handoffs:** pulse-strip cells navigate to the dedicated page when their panel moved (specialists active → Roles, chains in flight → Templates, tokens → Economics); every panel's "Open in Explore" loads its query and switches to the Explore page.
  - **Shared classifier drawers:** Role / Memory / Chain-Template drawers live outside the surfaces in a shared layer, reachable from any page (`data-open-drawer="<kind>"`) — cascades (e.g. Template → Failure Patterns → Memory) work across pages; switching surface closes them.
- **Left sidebar — query lab + filters:** scopes, a **contextual Filters group for the active surface** (Feed → sources; Issues → states; Specialists → run states; Evidence → proof state + proof type; GitHub → event types), saved queries, and fields, each icon-styled. **Filtering lives here and only here** — the former per-surface filter chip rows (and the filter-style topbar2 blocks) are removed as duplicates. Exception: the Graph keeps its legacy in-surface header toggles (parent-child / related / deferred) because they are render lenses owned by the legacy form (§9.1).
**Space management — drawer-aware [LOCKED]:** the left sidebar is **collapsible to icon-only** (toggle in top bar 1, `sidebar-left` icon; state persisted). **Opening the drawer auto-collapses the sidebar; closing restores it**; a manual toggle overrides. The **Inspector toggle** (top bar 1, `sidebar-right` icon, mirrored from the collapse icon) opens/closes the drawer at will (shortcut `]`). On narrow viewports the drawer is full-width.
*History:* an earlier revision used a vertical two-rail nav (icon rail + contextual rail), replaced by two top bars + sidebar (rev 22). A later pass (rev 27) found topbar2 **semantically incoherent** — sections on Operations, *filters* on Specialists/Evidence/Graph (duplicating in-surface chips), empty on six surfaces — and resolved it with the **parent-sections model** above (user-chosen grouping) plus **filters moved to the sidebar**.
---

## §10. Issue drawer specification [LOCKED]

The Issue Drawer is the first and most exercised drawer kind. Its specification is canonical here; other drawer kinds (§11) follow the same pattern with kind-specific adaptations.
### §10.1 Sticky header — identity always visible [LOCKED]
|Element|Substrate field|Rendering|
|---|---|---|
|ID|`issues.id`|mono, primary text, copy-on-click|
|Title|`issues.title` (≤120 char)|italic preserved (house style)|
|Class chip|`issues.class`|root (accent) / step (muted) / gate (orange) / advisor (blue) / followup (green)|
|Type chip|`issues.type` (root only)|bug red / task neutral / design purple / research purple / spike neutral / chore neutral|
|Priority|`issues.priority`|P0 red / P1 orange / P2+ neutral|
|State chip|derived from `work_state` + `close_reason`|ready / working / blocked / close_ready / done / archived|
|Scrutiny|`contract.scrutiny` (root only)|none / low / medium / high / critical|
|Owner|`containers.owned_by` (primary container)|display + delegation affordance|
**Quick actions:** open container · copy ID · copy XML contract · link to git branch.
### §10.2 Tab structure for class:root (canonical case) [LOCKED]
Order: **Overview → Lineage → Activity → Evidence → GitHub → Memories → Followups**.
This ordering reflects the operator's natural reading: provenance → graph context → what was done → what was produced → what was generated → what was learned.
#### Tab 1 — Overview [LOCKED]
Answers: **why does this exist? what is its decision context?**
Overview starts by reconstructing the existing inline expanded issue preview. This is not optional: the drawer's first tab is the canonical, full-detail version of the feed dossier, not a separate "executive summary".
Reads:
- current Beads/Gitboard issue detail: `id`, `title`, `description`, `notes`, `labels`, `status`, `priority`, `issue_type`, `owner`, `created_at`, `updated_at`
- current Beads/Gitboard relationships: `dependencies`, `dependents`, `children`, `related_ids`
- current Beads/Gitboard interactions: audit/status/tool-call log for the issue
- `containers.opened_by`, `containers.opened_reason`, `containers.origin_chain`
- If `opened_by` points to a `seed:*`: `plans.body_json.advisor_findings_log`
- If `opened_by` points to a pulse: `pulse_dedup.idempotency_key` + emitter
- If manual: CLI command + operator + timestamp
Renders:
- Same dossier blocks as `IssueFeed.tsx` expanded preview:
  - header/identity
  - description / contract
  - specialist activity summary
  - notes
  - labels
  - related summary
  - audit log
  - dependency tree summary
- Decision context narrative (markdown)
- Properties grid (status, template, current gate, tokens; cost shown as non-authoritative estimate)
- Acceptance criteria (markdown, from `contract.acceptance`)
- Quick links: opener entity (clickable chip), parent container
The inline feed preview can be shorter, but the drawer cannot be poorer. If data exists in the expanded preview, it must exist in Overview or a directly adjacent canonical tab.
OTel: the `trace_id` of the originating operator command is the trace root; substrate provides the causal walk, OTel provides the temporal trace of the same relationship.
#### Tab 2 — Lineage [LOCKED]
Answers: **how did we get here, what is connected, and where can I go next?**
Reads:
- existing Beads relationship graph: dependencies, dependents, children, parent, epic, related ids
- `issue_dependencies` WHERE `kind IN ('discovered-from', 'caused-by', 'supersedes', 'validates')`
- chain/container edges that link the issue to specialist chains
- Transitive walk depth = 3 by default
Renders:
- Dependency tree, matching the inline dossier's dependency semantics.
- Related beads/issues, including closed issues and future issues when available in the database/API.
- Children, parent, epic, and container/chain context.
- Each node: ID + class/type + status chip, clickable.
- Edge kinds annotated: blocks, blocked-by, parent-child, tracks, related, discovered-from, caused-by, validates, supersedes, until.
- Clicking a bead/issue node replaces the drawer target with that issue and preserves back navigation.
- Clicking a chain/container node opens the appropriate chain/container view; bead links inside that view still open Bead Inspector.
- "Expand depth" button on terminal nodes when substrate can resolve additional graph depth.
Lineage is not merely provenance. It is the operator's navigation map across beads, future issues, epics, and containers.
#### Tab 3 — Activity [LOCKED]
Answers: **what specialist runs operated on this?**
This is the tab that solves the original Feed regression (closed beads losing activity). It is **bead-specific**, not "currently active chain"-specific. Queries by `bead_id`, not by chain active-set, and includes historical completed jobs.
Reads (cross-domain join, §13.1 of substrate.md):
- pre-Substrate Gitboard endpoint: `/api/specialists/jobs?bead_id=<id>&include_history=1`
- per-job feed endpoint: `/api/specialists/jobs/:job_id/feed`
- per-job result endpoint: `/api/specialists/jobs/:job_id/result`
- per-job structured events endpoint when available: `/api/specialists/jobs/:job_id/feed-events`
- substrate `containers WHERE kind=chain AND <linked to this issue>`
- specialists `jobs WHERE workstream_id IN (chain_ids)`
- channels last `kind IN ('verdict', 'finding', 'turn_end')` per job for lastOutput
- Survives `issue.closed_at_ms` because substrate doesn't trigger cleanup.
Renders:
- Chain-grouped list, newest first
- Per chain: chain.id (mono) + chain_template + closed_at_ms + close_reason + mini-waterfall (optional, from OTel)
- Per job: role chip with dot, jobId (mono), status pill, meta inline (`{turns}t · {tokens/1000}k tok · ${cost} · {duration}`), lastOutput italic dimmed
- Per job: terminal feed disclosure, collapsed for completed jobs unless opened by a job chip; expanded content has no mini-scroll trap.
- Per job: run result disclosure, collapsed by default; markdown rendered with the same mono/detail treatment as feed outputs and no mini-scroll trap when expanded.
- Per job: structured forensic event timeline when `/feed-events` is available.
- Per chain/job: buttons "view feed" (opens/scrolls terminal feed) + "view evidence" (jumps to Evidence tab, focused on the job).
**Job activity card [LOCKED].** Each job renders as **one framed card**: rounded 4px (§6.11), full subtle border, with the **role-color left rail kept *inside* the frame** (`overflow:hidden` clips the rail to the rounded corners, so rail and rounding coexist — §6.2).
- **Metadata header — always on top, one dense row (no monospace, to use the width):** a solid **identity chip** `role │ job-id │ model` (with dividers), then the status word (`done` / `running`), then the outcome pill (`✓ passed`), and **right-aligned metrics** `{tests} tests · {files} files · {elapsed} · {tokens} tok`. `{files}` is clickable → Files touched. The metadata never disappears across states.
- **While running:** the card body is the **live forensic event stream, event by event** (`xtrm.forensic.v1`). This **replaces the old raw terminal-feed dump** as the live view — the forensic stream *is* the live activity.
- **When finished:** the body collapses to the compact view, in order:
  1. the **verdict/status** is carried by the header (outcome pill + metric row);
  2. a discreet **one-line role path**: `executor → reviewer`;
  3. a **"view details"** disclosure (collapsed) → expands the full event-by-event forensic stream (row spec below);
  4. **Files touched** — the changed-file list with +/− line counts and an inline **diff** preview, sourced from forensic `diff`/`commit` evidence (§15.1). File paths proportional; only the diff content is monospace (code).
  5. the **Result** in its **own distinct zone** — separate background, "Result" header, full markdown. Its own space; never buried inside "view details".
**Net-new backing:** today only the latest `result`/`terminal_output` event is read (`/jobs/:job_id/result`, `specialist_job_events` `LIMIT 1`); the live stream + view-details need `GET /jobs/:job_id/feed-events` (ordered, catalog-normalized; same admin gating as `/result`).
Anti-regression rule: the forensic stream and the result are both preserved and **separate**. The forensic stream supersedes the raw terminal dump as the live/structured view (the raw transcript stays reachable as an escape-hatch detail); neither silently replaces the other.
**Forensic event row [DRAFT]** — inside "view details", each event renders compact:
- `event_family` marker + family octicon (job, review, tool, command, process, worktree, mcp, pulse, …).
- `event_name` mono (e.g. `job.started`, `tool.call.completed`, `review.verdict.pass`).
- timestamp (relative; absolute on hover), mono.
- key body fields inline, per the catalog's *Body fields* column (`tool.call.completed` → `tool_name · duration_ms`; `job.completed` → `elapsed_ms · turns · result_ref`; `review.verdict.partial` → `findings_count · blocking_count`).
- redaction status (`clean` / `redacted`) from the envelope.
- correlation chips (`job_id` / `chain_id` / `trace_id`) clickable → drawer / trace.
- optional Prometheus-eligibility dot (catalog *Prometheus* column: yes / state / optional) → pivot to the Operations aggregate.
Family filter chips at the top of the expanded list; verdict (`review.verdict.*`) and terminal (`job.completed/failed/cancelled`) events are emphasized.
OTel: each chain is a span; each job is a child span; chain trace_id retrievable as `containers.trace_id` (field to add to substrate schema, see §15).
Prom (bounded aggregates only): `xtrm_chains_total{chain_template, result}`, `xtrm_chain_duration_seconds{chain_template, result}`, `xtrm_jobs_total{participant_role, result}`, `xtrm_llm_tokens_total{participant_role, direction}`, `xtrm_gate_verdicts_total{participant_role, gate_kind, verdict}`.
**Boundary [LOCKED]:** per-chain duration, tokens, and cost are **derived from the forensic/state layer** (sum of job metrics by `chain_id`), never a Prometheus label — `chain_id`, `job_id`, `trace_id` are forbidden as labels (telemetry projection §3.2). Drill-down to a specific chain/job uses forensic events / `trace_id` exemplars, never Prom labels ("ask for opaque IDs only after drill-down, via logs/traces/events", infra-console handoff). **Cost is a non-authoritative token-derived estimate; no USD metric is exported** — the project uses subscription plans (event catalog §11, projection §4/§5.2). The metrics named here are assumed fixed/verified/present upstream in `specialists` (`xtrm_chains_total`, `xtrm_chain_duration_seconds`, with `chain_template`/`gate_kind` added to the projection allowlist §3.1).
Loki: per-job button "tail logs" opens Loki with `{chain_id="X", job_id="Y"} | json`.
#### Tab 4 — Evidence [LOCKED]
Renders the ledger structure (§7.1) compressed for the drawer: verdict packet at top, proof rows in the middle, artifact stack and diff proof at bottom. Regression contract block if applicable.
Reads: `issues.evidence_json` array (§6.1 substrate).
Each evidence item:
- `kind` chip (diff / verdict / test / checklist / screenshot / artifact)
- `ref` mono, clickable to expand body inline
- `by` (job id) clickable, jumps to Activity tab focused on that job
- `at_ms` relative timestamp ("13h ago")
#### Tab 5 — GitHub [LOCKED]
Answers: **what landed in code, where, and what was reviewed?**
Reads (cross-source, pre-substrate via gitboard materializer):
- PRs linked to this issue
- Commits in the issue's branches/worktrees
- Reviews on those PRs
- Linked GitHub issues
Renders:
- PR list with status, mergeable state, review state
- Commit list with SHA (mono), message, author, timestamp
- "Open in GitHub" button per item — external navigation, not embedded
#### Tab 6 — Memories [LOCKED]
Renders: memories with `in_container IN (containers of this issue)`, filtered by default to `type IN ('failure', 'best_practice')` with toggle "show all types".
Grouped by type. Each memory:
- type chip (failure red, best_practice green)
- `reason` italic lede
- `body` collapsible (FTS5-able)
- attribution: "Distilled by `<chain_coordinator_id>` at close of chain `<chain_id>`"
- "cross-reference" button opens Memory drawer (cascade)
#### Tab 7 — Followups [LOCKED]
Reads:
- `issue_dependencies WHERE depends_on = self.id AND kind IN ('discovered-from', 'supersedes')`
- `containers WHERE parent_id = self.container_id AND kind=chain AND opened_at_ms > self.closed_at_ms`
Renders:
- Section "Followups" — issues with `class:followup` and `--rel discovered-from:<self>`, generated by chain coordinator at close
- Section "Supersedes" — issues that replaced this
- Section "Downstream chains" — chains opened later in the same container
### §10.3 Tab adaptations per class [LOCKED]
|Class|Tabs active|Notes|
|---|---|---|
|`root`|All 7 (canonical above)||
|`step`|Overview · Activity (self only) · Evidence · GitHub|No Followups. Origin emphasis on parent_id → root issue.|
|`gate`|Overview · **Verdict** (replaces Activity) · Evidence · GitHub|Verdict tab = structured verdict body + findings, clickable back to writer step.|
|`advisor`|Overview · **Output** (replaces Activity) · Evidence|Output = advisor finding artifact; no verdict structure (advisor doesn't block).|
|`followup`|All 7 (inherits root)|Overview emphasizes `discovered-from` edge to originating issue (jump to chain coordinator close-time).|
---

## §11. Other drawer kinds [DRAFT]

These follow the same pattern as the Issue Drawer (§10) — sticky header + tabs + per-tab reads/renders — but the entity sources and tab content differ.
### §11.0 Polymorphism contract [LOCKED]
All kinds render through the one `DrawerShell` primitive (§5.2.1): same overlay, focus-trap, sticky-header slot, tab strip, body. A kind is a **config, not a component fork**:
- **header descriptor** — identity fields + chips for the sticky header.
- **tab list** — the ordered tabs (below).
- **per-tab `{reads, renders}`** — each tab declares its data source(s) and what it renders, exactly as §10.2 does for the Issue Drawer. This is the fidelity bar: a kind is not "done" until every tab has reads + renders, not just a name.
**Dispatch** = §5.4 (click target → kind) + §5.2 (kind → tab set). **Acceptance / regression [LOCKED]:** clicking a role / template / memory / chain entity renders *that kind's* tabs and header — never the Issue tab set. This resolves the former §18.4 open item; the mock must demonstrate at least the Chain Drawer tabs and one classifier kind.
**Pre-substrate data sources already in the app:** Chain → `/api/specialists/chains/:chain_id` (`useChainDetail`) + `/api/specialists/jobs/in-flight` (`useChains`); Role / Chain-Template → classifier aggregation over that same jobs corpus; Memory → `bd remember` / substrate `memories`. Missing sources (e.g. chain channel log, OTel trace) are flagged in §15.1.
### §11.1 Chain Drawer [DRAFT]
**Entity:** substrate `containers WHERE kind=chain`.
**Sticky header:** chain.id (mono) + linked issue title (italic) + chain_template chip + state chip + worktree lease holder + scrutiny + tokens (cost as non-authoritative estimate).
**Tabs:**
- **Composition** — `resolved_chain_json` rendered visually: Layer-1 domain steps + Layer-2 mandatory gates overlaid, each step with role/class/blocking. Mirrors §6.9.10 of substrate.md visually.
- **Activity** — jobs in linea, current step, lease holder, channel messages of kind `turn_end`/`verdict`/`finding` interleaved.
- **Channel** — pulse log (incoming + outgoing) + cross-chain pulses received from coordinator. Useful for coordinator-driven chains.
- **Outcome** — verdict packet (if closed), close_reason, memories distilled at close, followups created.
- **Trace** — OTel waterfall of the chain trace.
- **Diff** — aggregated diff produced by all writer steps, with breakdown per step.
- **Memories** — memories distilled at close + memories cited during the chain.
### §11.2 Role Drawer [DRAFT]
**Entity:** specialist role classifier (executor, reviewer, etc.). Not a substrate row; an aggregation query.
**Sticky header:** dot in agent-color + role italic + label "specialist role" + stats inline (success rate, jobs 24h, total ever, today's token usage).
**Tabs:**
- **Overview** — per-role analytics: 7-day success rate distribution, jobs/day bars, top 5 failure reasons under this role.
- **Recent Activity** — chains that used this role; click → cascade in Chain Drawer.
- **Identity Memories** — query §10.1 substrate identity-lens: `created_by_role=R AND project_id=X`. What the role has learned in this project, grouped by type. **The valuable bit** — accumulated identity, normally invisible.
- **Configuration** — `mandatory_rules` from `.specialist.json`, service-skills assigned (§6 devops canon), chain_template defaults that include this role, model preferences.
### §11.3 Chain Template Drawer [DRAFT]
**Entity:** chain_template classifier.
**Sticky header:** template italic + label "chain_template" + `applies_when` summary inline + 24h counts.
**Tabs:**
- **Resolved Shape** — Layer-1 + Layer-2 visually overlaid for this template. The §6.9.10 substrate visualization.
- **Recent Instances** — chains that used this template.
- **Failure Patterns** — failure clusters specifically under this template.
- **Configuration** — YAML in `config/chains/<template>.yaml` rendered, applies_when matcher, defaults.
### §11.4 Memory Drawer [DRAFT]
**Entity:** memory or memory cluster (failure pattern aggregation).
**Sticky header:** label "failure pattern" (or "best practice", etc.) + pattern italic + stats (occurrences, first seen, last seen) + type chip.
**Tabs:**
- **Pattern** — distilled reason + aggregated body + type classification.
- **Instances** — each memory in cluster with chainId/bead/when/created_by_role. Click → cascade Chain Drawer where memory was distilled.
- **Cross-reference** — same pattern under other lenses (workgroup, identity).
- **Mitigation Followups** — issues with `--rel discovered-from: <these memories>`, with remediation state.
- **Lineage** — walk back through `opened_by` of originating chains.
### §11.5 Session Drawer [OPEN]
**Entity:** session — pending Substrate confirmation of `kind: session`, see §13.
**Status (rev 35):** the mock demonstrates this kind provisionally (Sessions surface, `data-drawer="session"`, all 8 tabs below) — explicitly labelled provisional in the drawer header; the tab set locks only when substrate confirms.
**Provisional tabs** (will lock when substrate confirms):
- **Intent** — initial operator command/prompt, optional clarifications.
- **Opened Seeds** — seeds opened during this session.
- **Chain Runs** — all chains that ran in scope.
- **Commits** — commits produced (across all repos touched).
- **Evidence** — aggregated evidence packet across all session work.
- **Memories** — distilled during the session.
- **Followups** — created during the session, with state.
- **Next-session Handoff** — the session-close report rendered as structured content.
### §11.6 GitHub Drawer [DRAFT]
**Entity:** a materialized GitHub object/event — PR / commit / release / review. Promotes the GitHub detail (today an inline accordion / `EventDetail` side panel) to a first-class drawer, now that the drawer is the canonical detail primitive (§5).
**Sticky header:** repo + `#<pr>` / SHA / tag (mono) + title (italic) + state chip (open / merged / closed) + branch + diffstat (`+adds −dels · N files`). Actions: Copy id · View on GitHub (external).
**Tabs** (reads/renders, reusing `EventDetail` / `PrTimeline` / `CommitRow` — §9.1):
- **Overview** — diffstat bar + PR/commit body (markdown) + **linked-issue chip** (→ Issue Drawer) + reviews summary.
- **Commits** — the commit list (reuse the `CommitRow` accordion); SHA mono → external.
- **Files** — changed files with +/− and inline diff (same source as the job card's files/diff, §10.2).
- **Checks** — CI / status checks where available.
- **Linked** — linked issues/beads; clicking opens the Issue Drawer (the bead's GitHub tab §10.2 is the reverse view).
**Inline peek vs drawer (§5.5 pattern):** in the Feed and the GitHub surface, a push row's commit accordion stays as the **inline peek**; clicking the event (or its chevron / id) opens this drawer. External GitHub is one click away via the header CTA.
---

## §12. Operations page specification [DRAFT]

The Operations surface is the AgentOps console. **Distinct from Observability** (§4.1).
### §12.1 Layout [DRAFT, revised rev 37]
Five zones (top-down):
1. **Top pulse strip** — single line of 6 ecosystem indicators: specialists active, chains in flight, failure rate 24h, token usage 24h, runtime health, escalations. (No USD; token usage replaces "daily spend" — cost is estimate-only, USD deferred.)
2. **Scope tree** (left sidebar) — xtrm ecosystem scope: `all xtrm / specialists / substrate / channels / core / gitboard / runtime deps` — plus the **Datasources** group (§12.6).
3. **Explore workbench** (§12.5) — the query surface; every panel round-trips into it.
4. **Main panel grid** — 6 native panels (no Grafana iframes), each backed by a declared query with an **"Open in Explore"** action:
    - Specialist health by role
    - Chain throughput by chain_template
    - Failure pattern clustering
    - Token economics
    - Active escalations
    - Runtime backstage hygiene
5. **SRE-agent activity strip** (bottom) — chains where the SRE-agent is investigating/sweeping the ecosystem itself.
### §12.2 Panel specifications [DRAFT]
|Panel|What it shows|Data source|Drawer on click|
|---|---|---|---|
|Specialist health|per-role table: success rate, p50, p99, sparkline|OTel spans + Prom (`xtrm_jobs_total{participant_role, result}`, `xtrm_job_duration_seconds`)|Role Drawer|
|Chain throughput|per-template table: chains, completed, escalated, p50|Prom (`xtrm_chains_total{chain_template, result}`, `xtrm_chain_duration_seconds`) + substrate `containers kind=chain`|Chain Template Drawer|
|Failure clusters|grouped by `reason` pattern, with instances|substrate `memories type:failure` aggregated|Memory Drawer|
|Token economics|token usage with `participant_role` + `direction` breakdown; cost as non-authoritative estimate (USD deferred)|Prom (`xtrm_llm_tokens_total{participant_role, direction}`)|(no drawer; inline detail)|
|Active escalations|chains in `escalated` state with reason + action buttons|substrate `containers state=escalated`|Chain Drawer|
|Runtime backstage|8 micro-cards (daemon, store, Dolt, LSP, MCP, channels, worktrees, processes)|custom infra-wrapper MCP|popover inline (§5.2)|
### §12.3 Native, not embedded [LOCKED]
The Operations page **does not embed Grafana iframes**. Native UI primitives query OTel/Prom/Loki backends directly (the dash0 model). Reasons:
- Entities are substrate entities (chains, jobs, roles, templates). Grafana doesn't speak this language.
- Drill-down targets are the drawer system. Iframe breaks navigation.
- Beyond viewing: recommend, dispatch, escalate, approve. Grafana is read-only.
- Style coherence with rest of console.
Backend stays: OTel + Prom + Loki, hosted in `mercury/infra` (per devops canon §0.1). Frontend is native xtrm.
**Nuance (rev 41, from console-observability-spec §E.5/§E.9):** no iframes ≠ no Grafana. The console may **deeplink** to Grafana dashboards as evidence/escape-hatch references — "linked, not recreated as the authority". Datasource queries go through a **server-side proxy** (`/api/console/observability`); the browser never holds raw credentials; Grafana/MCP posture is read-only by default (§A.10).
### §12.4 Top pulse strip — no drawer [LOCKED]
The 6 cells in the top strip are aggregates, not entities. Clicking them **scrolls and pulse-highlights** the relevant panel — does not open a drawer. This is the only click target in Operations that doesn't open a drawer; declaring it explicitly preserves the "every entity → drawer" rule (§5.4).
### §12.5 Explore workbench [DRAFT, new rev 38]
Operations is not a report; it is a **query surface** (the Grafana Explore model, rendered natively per §12.3). The Explore zone:
- **Query row:** datasource picker (§12.6) · **Builder/Code toggle** — Builder composes label-filter chips (`chain_template = debug`) plus an operations pipeline (`rate 5m → sum by(participant_role)`); Code exposes the raw query (PromQL/LogQL) in mono.
- **Actions:** Run query · **Query history** (recent queries, one click to restore) · Inspector (raw response) · **Split** (two result panes side by side over the same time range, for correlation).
- **Results area:** one result set, three renders — **Chart / Table / Logs** — switchable without re-querying. Log rows reuse the §6.5 row language with severity rails; IDs in results are entity links (§6.6) and open drawers **without losing the query** (the §5.1 non-modal behavior is what makes this loop work).
- **Panel round-trip [the key rule]:** every §12.2 panel declares its backing query; its **"Open in Explore"** action loads that query into the workbench. Dashboard panels and Explore are two views of the same query, never two systems.
- Telemetry boundary unchanged (§17): aggregates from Prom projections; per-entity drill-down via forensic events / trace exemplars, never Prom labels.
### §12.6 Datasource model [DRAFT, new rev 38 — grounded rev 41]
Every panel and Explore query is a **`{datasource, query, render}`** triple. Datasources are first-class and user-extensible.
**This is not net-new design (rev 41):** the wired contract already exists as **`ObserveDatasourceDescriptor`** + **`ObserveQueryRequest/Response`** (console-observability-spec, Slice A — shipped). This section adopts it:
- **Datasource types (descriptor):** `prometheus` · `grafana` (deeplink/panel lookup) · `loki` · `otel_trace` · `specialists_forensic` · `substrate` · `aws_agentcore` · `static_fixture` — richer than the rev-38 sketch; the mock's sidebar list maps onto these.
- **Query kinds (request):** `promql`, `logql`, `grafana_panel` lookup, `trace_lookup`, `forensic_events` query, plus `eval/recommendation/journal/runbook` lookups. Response carries `{status, range, freshness, data, evidence, diagnostics}` — **freshness and evidence are part of the query contract**, which is exactly what §7.2 source-freshness visibility needs.
- **Posture:** server-side proxy, read-only by default, no credentials in the browser (§12.3 nuance).
- **User-added:** the operator can register additional endpoints from the sidebar **Datasources** group; panels built on them sit next to the xtrm panels with identical chrome.
- **Product stance:** the console is a **generic ops workbench whose default workspace is xtrm's own agentops**. A user wiring their stack into it gets a devops console; xtrm's specialists/chains/evidence are the preinstalled content, not a hard-coded limit.
- Saved queries are first-class (sidebar), independent of which datasource they target.
- **Dashboard-as-data (Slice B, open upstream):** panel/layout schema with validation; **agent-authored dashboard drafts require operator approval** (§E.6) — keep this rule when the workbench learns to save layouts.
- Constraint: datasource plurality must never weaken the entity model — xtrm entities keep their drawers; foreign metrics render as panels without pretending to be entities.
### §12.7 Incident analysis [DRAFT, new rev 38]
The incident loop ties Operations and Observability together:
- **Incident rows** (Operations section): derived from active escalations + correlated backend alerts (e.g. `INC-7 · github materializer behind · open 22m · 2 chains impacted`).
- **Incident view:** correlated timeline = the Feed engine (§8.1) scoped to the incident window + involved entities (chains, memories, runtime components); actions: acknowledge · open followup (`class:followup`, `discovered-from` the incident) · resolve with reason.
- **The cascade** is the §5.3 mechanism end-to-end: incident → Chain Drawer → Trace → Logs → Diff, all without closing the inspector (§5.1 non-modal).
- Post-substrate, an incident is a candidate container kind (like session, §13) — decision deferred to the substrate design pass; pre-substrate it is a materialized view over escalations + alerts.
- Status: contract-first (this section); mock demo in a later revision.
---

## §13. Session contract [DRAFT]

A session anchors an operator workblock over time:
- initial command or prompt
- seeds/issues opened
- chains run
- commits produced
- evidence collected
- memories distilled
- followups created
- next-session handoff
**Proposed substrate shape:** a container with `kind: session`, pending confirmation in the Substrate model.
The session-close report should become a **structured evidence body** (currently a markdown blob; the structured form will allow tabs to render it). The Sessions surface (§4) is a chronological list of past operator workblocks.
**Open:** Should `session` become a first-class Substrate kind, or a materialized view over prompts, chains, commits, and memories? This decision lives in the Substrate next-design-pass; the console contract accommodates either outcome.
---

## §14. Pre-Substrate mapping [LOCKED]

Today the console populates this contract from:
|Source|Provides|
|---|---|
|`bd` / Beads|issues, dependencies, descriptions, notes, status, relationships|
|`sp` / Specialists|jobs, roles, chain ids, status, terminal feed, run result|
|`observability.db`|specialist_jobs, specialist_events, runtime metrics, historical job rows|
|Git|diff, commits, branches, PR links|
|Gitboard materializer|freshness, source health, cross-source joins|
|Playwright/test artifacts|screenshots and verification proofs|
|`bd remember`|memories and close-out lessons|
The UI **already uses product concepts** (`issue`, `chain`, `job`, `evidence`, `verdict`, `memory`) even though the adapter still reads legacy source names.
---

## §15. Post-Substrate mapping [LOCKED]

After Substrate lands, the UI contract remains mostly unchanged.
|Today|After Substrate|
|---|---|
|Beads adapter|Substrate issue reader|
|Specialist jobs|Normalized chain/job/event projection|
|Evidence|First-class relation or materialized view|
|Relationships|Typed edges instead of ad hoc dependency lists|
|Drawer tabs|Same shape, cleaner backing queries|
**Migration shape:** adapter swap, not redesign.
### §15.1 Console-implied substrate fields [DRAFT]
This console contract implies the following fields/concepts that substrate should expose (additions to substrate §13.3 schema):
- **`containers.trace_id`** — OTel trace ID assigned at container open. Allows drawer mini-waterfall and Loki/Tempo linking.
- **`containers.session_id`** — links every container to a session record (§13). The temporal glue.
- **`memories.created_by_chain`** — explicit chain ID (currently implicit via `in_container` + `created_by_job`). Reduces join queries.
- **`evidence.trace_id`** + **`evidence.span_id`** — link evidence to OTel span where it was produced.
- **`containers.trust_tier`** (devops canon §5) — six tiers from report-only to terraform apply. Could be derived from `autonomy_json`.
Backend/data needs surfaced by the forensic-feed design (§8.1, §10.2), pre-substrate. **Ownership is split** (see `console/specialists-console-handoff.md`): the **specialists runtime** only *emits* the events it alone observes (the richness ceiling); **normalization to the `xtrm.forensic.v1` envelope, files/diff derivation from git, the read endpoints, and table-derived metrics live in the gitboard materializer**.
**Status reconciled against the wired telemetry/architecture docs (rev 41** — `docs/telemetry/*` + `docs/console/architecture/*`):
- **`GET /api/specialists/jobs/:job_id/feed-events`** — **SHIPPED** (forensic-event-contract §2; canonical-envelope-first per console-architecture §6). Returns `{events: [xtrm.forensic.v1 envelope], cursor: {t_unix_ms, seq}}`. Backs the Activity forensic timeline.
- **Forensic normalization of legacy `specialist_events`** — **SHIPPED**: the materializer's observability adapter dual-writes legacy rows wrapped in envelopes into `xtrm_forensic_events`; native emission via the shared emitter (`src/specialist/forensic-events.ts`). Remaining (forensic-event-contract §16): expand native source emission beyond persistence-time dual-write; live MCP emitters; migrate gitboard off text `sp feed` to `sp feed --json`.
- **Files/diff per run** — **PARTIAL**: `diff`/`commit`/`pr` evidence refs land in `xtrm_evidence_refs`; full changed-file list + hunks materialization not yet done. Paths and diff stay in forensic body, never Prometheus labels (confirmed by the §3.2 forbidden-label list).
- **`specialist_job_metrics` join** — **SHIPPED**: `turns`/`tools`/`token_split`/`context_usage_ratio`/`active_runtime_ms`/`wait_time_ms` are read by the materializer and projected to the API (never as Prom labels).
- **`GET /api/feed`** — **EXISTS** (console-architecture §3/§8): cursor-paginated cross-source rollup `{rows: [{source, kind, repo_slug, title, summary, severity, status, redaction_status, drilldown}], cursor}`.
- **Materializer freshness** — `materialization_state` table exists (cursor, last-success, failure flags); **no exported freshness metric yet** (planned, console-observability-spec §D.3.4). The Observability freshness panel reads the table via API meanwhile.
- **Retirements:** `/api/beads` is retired → `/api/substrate/*`; `/beadboard` 404s (console-test-guards §4.5/§8).
- **Metric reality is richer than this contract assumed:** beyond the §10.2/§12.2 set, the projection ships `xtrm_job_wait_seconds`, `xtrm_job_queue_depth`, `xtrm_job_state`, `xtrm_tool_calls_total`, `xtrm_pulses_total`/`xtrm_pulse_queue_depth`, `xtrm_worktrees`/`xtrm_worktree_age_seconds`, `xtrm_processes`/`xtrm_process_orphans_total`, `xtrm_service_skills_drift_total`, eval/identity/policy families (prometheus-projection-contract §5.1-5.10) — the Runtime backstage micro-cards and cockpit KPIs have real backing. Labels also carry `service_name`/`repo`/`participant_kind` (and `model_provider`/`model` on tokens) in addition to the ones named here.
- **Forensic families are 21**, not the 8 sketched in §10.2: `job, turn, model, tool, mcp, identity, policy, eval, control, retry, compaction, error, result, git, process_health, service_skills, pulse, node, review, chain, epic, command` (worktree events live under `process_health`). Verified body fields: `tool.call.completed{tool_name, duration_ms, result_shape}` · `job.completed{elapsed_ms, active_runtime_ms, turns, result_ref}` · `review.verdict.partial{gate_kind, verdict, findings_count, blocking_count, evidence_refs}`.
The remaining substrate asks (`containers.trace_id`, `containers.session_id`, `memories.created_by_chain`, `evidence.trace_id/span_id`, `containers.trust_tier`) still need the substrate design-pass acknowledgment before schema freeze.
---

## §16. Anti-regression checklist [LOCKED]

Before merging any console UI change, verify:
- [ ] The route still shows the same entity identity and status after refresh.
- [ ] Completed specialist jobs remain visible historically.
- [ ] Terminal feed exists for live and completed jobs when available.
- [ ] Run result exists separately from terminal feed.
- [ ] Run result markdown renders correctly.
- [ ] Expanded feed/result sections do not trap content in tiny scroll boxes.
- [ ] Evidence shows verdicts, tests, artifacts, trace, and diff proof where available.
- [ ] Evidence uses ledger structure: verdict packet, proof rows, artifact stack, regression contract.
- [ ] Relationship visibility matches or improves on Graph view.
- [ ] Drawer opens as overlay and does not squash the viewport.
- [ ] Drawer breadcrumb (`xtrm / kind / id`) is present and accurate.
- [ ] Drawer tabs adapt per entity kind (Issue ≠ Role ≠ Memory).
- [ ] Cross-entity navigation depth ≥4 promotes to full-page view, not drawer stack.
- [ ] Filters operate over the complete corpus, not a partial live set.
- [ ] GitHub links navigate to GitHub-specific surfaces, not dead or unrelated views.
- [ ] Source freshness/degraded state is visible when data may be stale.
- [ ] Color usage respects the semantic accent set; the agent palette is never used decoratively as background or gradient.
- [ ] No iframes in Operations page; native UI primitives over OTel/Prom/Loki.
- [ ] Top pulse strip cells scroll-focus their panel; do not open drawers.
- [ ] Iconography: Octicon-only, no mixed families.
**Convergence note (rev 41):** the shipped test suite already guards part of this checklist — `console-test-guards.md` §6 protects the IssueFeed row language, chip identity, dependency-tree expansion, the **non-modal drawer behavior** and the **ia-restructure** (dedicated child pages); the Operations Explore workbench is tracked as `forge-9xet.4` and the AgentOps panels as `forge-ow7c.4`. Mock and production are converging on the same contract.
---

## §17. Locked decisions [LOCKED]

These have been decided and do not need to be revisited:
- **Evidence is both** a top-level surface (the ledger) and a drawer tab (the compact proof packet for the selected entity).
- **Diffs render inline** when short enough to inspect comfortably; link to GitHub/local git for deeper review.
- **Verdicts use a provisional normalized schema** before Substrate: `scope`, `quality`, `tests`, `release`, plus optional `confidence` and `reviewer`.
- **Memories appear in both places**: as close-out metadata on sessions and as evidence when they encode an anti-regression rule, lesson, or design decision.
- **MVP scope:** Issues + Specialists + Evidence + Drawer + GitHub links + source freshness. Observability and Sessions deepen later, but the trust loop exists from day one.
- **Operations is distinct from Observability.** Two tabs, two surfaces. Operations = AI workforce. Observability = backend.
- **Light theme is canonical.** Dark variant exists, decisions made on light, validated on dark.
- **No Grafana iframes in Operations.** Native UI primitives over OTel/Prom/Loki backends.
- **Drawer is polymorphic by entity kind**, with six kinds declared (§5.2).
- **Bead Inspector is bead-centric**, not chain/operations-centric. Overview reconstructs the expanded issue feed dossier before adding deeper tabs (§5.5, §10).
- **IssueFeed inline preview remains intact.** Row click toggles the inline dossier (default peek); chevron + ID chip + keyboard open the Bead Inspector drawer (§5.5, supersedes rev-4 mapping).
- **Bead Activity is historical.** It queries all specialist runs for the selected bead and preserves terminal feed, run result markdown, and forensic events as separate sibling evidence (§10.2).
- **Cross-entity navigation promotes to full-page view at depth ≥4.**
- **Top pulse strip cells don't open drawers** — they scroll-focus the relevant panel.
- **Telemetry boundary is mandatory.** Operations panels read low-cardinality Prometheus aggregates (`participant_role`, `chain_template`, `result`, `verdict`, `direction`); every per-entity view (chain/job/role drawer, Activity, Feed) reads the forensic event layer (`xtrm.forensic.v1`) which keeps correlation IDs. Per-chain duration/tokens/cost are derived from forensic/state aggregation by `chain_id`, never a Prom label. **No authoritative USD metric** — cost is an estimate; the project runs on subscription plans (telemetry catalog §11, projection §4/§5.2).
---

## §18. Open questions [OPEN]

These remain explicitly unresolved; either deferred to a later decision or waiting on Substrate/runtime confirmation.
1. **Should `Session` become a first-class Substrate kind, or a materialized view** over prompts, chains, commits, and memories? Decision lives in the Substrate next-design-pass.
2. **Which artifact storage path becomes canonical** for screenshots and generated verification files? Operations decision.
3. **How much inline diff is too much** before the console should hand off to GitHub/local git? UX threshold to be validated in mock testing.
4. **Drawer tab adaptation per kind** — RESOLVED in the mock (rev 33-34): the Operations surface hosts **four drawer kinds** — Chain (§11.1), **Role** (§11.2, from the Specialist-health row), **Memory** (§11.4, from a failure cluster) and **Chain Template** (§11.3: Resolved Shape · Recent Instances · Failure Patterns · Configuration, from a Chain-throughput row) — plus the GitHub Drawer (§11.6). Every classifier kind renders its own tabs and header, never the Issue set (§11.0 acceptance); the template drawer's Failure Patterns even cascades into the Memory drawer. What remains is only the production implementation over `DrawerShell`.
5. **Dark variant** — when to ship, and validation of all tokens on dark substrate. Validation pass required before public release.
6. **Iconography in mock vs production** — RESOLVED: the mock now uses inline-SVG icons (sprite) throughout — nav, chips, status, disclosures — with no emoji and no character-glyph icons (§6.8). Production swaps the sprite for `@primer/octicons-react`.
7. **`containers.trace_id` and related substrate field additions** (§15.1) need substrate design-pass acknowledgment before schema freeze.
8. **Inter font loading** — the contract specifies Inter; current mocks use system stack fallback. Production must self-host or load Inter reliably.
---

## §19. Derived specs — status [LOCKED]

|Spec|Status|Lives where|
|---|---|---|
|Issue Drawer Spec|**ABSORBED**|§10 of this document|
|Visual Contract|**ABSORBED**|§6 of this document|
|Drawer System Spec (all 6 kinds)|**DRAFT**|§11 of this document — full spec for non-Issue kinds is in DRAFT status, will lock per kind as production hits each|
|Operations Page Spec|**DRAFT**|§12 of this document|
|Session Drawer Spec|**OPEN**|§11.5 of this document — provisional, locks when substrate confirms `kind: session`|
|Chain Drawer Spec|**DRAFT**|§11.1 of this document|
|Role Drawer Spec|**DRAFT**|§11.2 of this document|
|Chain Template Drawer Spec|**DRAFT**|§11.3 of this document|
|Memory Drawer Spec|**DRAFT**|§11.4 of this document|
There are **no separate specification files**. This document contains everything. When a draft section locks, its status tag updates here.
---

## §20. Working mock [LOCKED]

The complete product/design visual example is the HTML mock:
- Canonical file: `console/xtrm-console.html` (sibling to this contract — source of truth)
- Route: `/gitboard/design-preview` (served from a synced copy under `apps/gitboard/design-mocks/`)
- Current mounted review URL, when served from the VPS: `http://100.113.49.52:5367/`
- Screenshot smoke artifact from the latest review pass: `/tmp/xtrm-console-complete-beads-smoke.png`
This is **not a sketch fragment**. It is the current complete example for designer inspection and critique. It is the **visual and interaction reference** for the pre-Substrate console direction.
It demonstrates:
- xtrm Console Quiet light baseline.
- Drawer as overlay entity inspector.
- Operations/query lab as a refined chain/template/evidence scenario.
- Issues/Beads feed as the `IssueFeed.tsx`-style inline surface with expanded dossier preview.
- Bead Inspector as the canonical bead detail, starting from inline dossier parity and extending to Overview, Lineage, Activity, Evidence, GitHub, Memories, Followups.
- Entity switching across chain, issue, evidence, role, template, memory, session.
- Operations as distinct from Observability.
- Evidence as proof ledger: verdict packet, proof rows, artifact stack, diff proof, regression contract.
- Sessions as first-class workblocks.
- Post-roadmap/pre-Substrate vocabulary.
When the real app diverges from it, **update either the implementation or this contract explicitly** — do not let a silent third design emerge.
### §20.1 Mock limitations to address in production [DRAFT]
The working mock is the visual reference but has known limitations not yet addressed:
- **Drawer tab polymorphism** — RESOLVED (rev 33-34): the mock demonstrates **all declared kinds with their own tab sets** — Chain, Role, Memory, Chain Template, GitHub, Issue (multi-drawer surfaces via `data-drawer` / `data-open-drawer="<kind>"`). Only Session (§11.5) remains, pending substrate confirmation (§13). Production must implement the same polymorphism over `DrawerShell` (§5.2.1).
- **Iconography** — RESOLVED: the mock uses an inline-SVG icon sprite (nav, chips, status, disclosures); no emoji, no char-glyphs. Production swaps to `@primer/octicons-react`.
- **Inter font not loaded** — fallback to system stack. Production must load Inter.
- **Surface coverage** — RESOLVED (rev 35): **all §4 surfaces are mocked** — Operations, Issues/Beads, Feed, GitHub, Specialists cockpit, Evidence (ledger), Graph, Observability (backend health: materializer freshness, ingest metrics, alerts), Sessions (workblock list + provisional Session Drawer), Terminal (command surface with entity-link note).
- **Issues feed behavior is representative, not live** — the mock demonstrates row click vs chevron preview and drawer parity, but production must preserve the actual `IssueFeed.tsx` interaction semantics.
- **Mobile breakpoint exists but is collapsed** — drawer becomes full-width below 1180px; this is acceptable for the prototype but production should validate on real mobile.
- **Mock data inconsistencies** — minor (e.g., escalations metric says 2 but failure clusters show 3); cosmetic only.
---

## §21. Revision history

- **rev 1 (2026-06-02 morning)** — initial contract by external designer.
- **rev 2 (2026-06-02 afternoon)** — visual contract section rewritten light-canonical; Operations/Observability split; drawer polymorphism declared; Sessions added; Evidence ledger structure formalized.
- **rev 3 (2026-06-02 evening)** — consolidated. All previously sparse documents (issue-drawer-spec, visual-rewrite, ops-page concept) absorbed into this single file. Status tags (LOCKED/DRAFT/OPEN) added per section.
- **rev 4 (2026-06-04)** — locked the Bead Inspector integration model: IssueFeed inline preview remains intact; primary bead click opens drawer; Overview reconstructs the expanded issue dossier; Lineage navigates related/dependency/closed/future issues; Activity shows all historical specialist runs for the selected bead with terminal feed, run result markdown, and forensic events.
- **rev 5 (2026-06-04, this revision)** — aligned the contract with the shipped telemetry contracts (`docs/telemetry/`). Replaced phantom metric names (`xtrm_chain_duration_seconds{template,status}`, `xtrm_chain_tokens_total{role}`, `xtrm_chain_cost_dollars{model}`, `xtrm_job_outcome_total`) in §10.2/§12.2 with real low-cardinality projections (`xtrm_jobs_total`, `xtrm_job_duration_seconds`, `xtrm_chains_total`, `xtrm_chain_duration_seconds`, `xtrm_llm_tokens_total{direction}`, `xtrm_gate_verdicts_total`) using `participant_role`/`chain_template`. Removed authoritative USD (cost = token-derived estimate; subscription plans). Declared the Prometheus-vs-forensic drill-down boundary as a locked decision (§17). Working mock updated to match (tokens over USD, `participant_role`, Console Quiet tokens, locked drawer shadow/clamp/scrim, Inter italic).
- **rev 6 (2026-06-04, this revision)** — design pass after reading the shipped app (`apps/gitboard/src/dashboard`). Reversed the §5.5 feed gesture to match shipped, tested code and a better interaction hierarchy: row click = inline dossier (default peek), chevron + ID chip + keyboard = Bead Inspector drawer. Declared the drawer **shell primitive** (§5.2.1): one kind-agnostic `DrawerShell` extracted from `BeadSideDrawer`, kind=issue Overview reuses `IssueDossier`, polymorphism built incrementally (not forked). Added §9.1 reuse inventory (markdown, dependency tree, grouping, row style, specialist activity, graph are reused not rewritten) and the §6.8 typographic-glyph exception + Octicon production-status note. Confirmed Octicon and no-USD are already true in production; the mock is the lagging artifact.
- **rev 7 (2026-06-04, this revision)** — unified token system after reading the shipped CSS (`tokens.css`, `globals.css`). Canonical = the production `.ide-shell[data-theme]` light/dark shell; the rest (`tokens.css` gray-accent base, `.fui-*`, `.westworld-app`, `.design-preview-container` override, Google-Fonts `@import`) is deprecated (§6.12). Decisions: light palette = **Slate** production ramp (§6.1, white/slate); mono font = **JetBrains Mono** self-hosted (§6.10, today `--font-mono` is Inter); radius = **3-4px** (§6.11, today shipped at 0). §6.4 colour table now uses real var names with shipped light/dark pairs (graph-state/priority). Drawer tokens (width `min(50vw,720px)`, `--scrim`, `--drawer-shadow`) made theme pairs (§5.1). Mock retuned to Slate + 3-4px radius.
- **rev 8 (2026-06-04, this revision)** — two design threads, grounded in the shipped data model. (1) **Forensic feed**: §10.2 Activity now specifies three sibling layers (terminal feed / run result / forensic timeline) + a forensic-row spec; new §8.1 Feed surface (cross-entity chronological stream); §15.1 lists the backend needs (`/jobs/:id/feed-events`, forensic normalization of `specialist_job_events`, `specialist_job_metrics` join, `/api/feed`). Today the app reads only the latest `result`/`terminal_output` event — the timeline is net-new. (2) **Drawer polymorphism**: new §11.0 polymorphism contract (config-not-fork over `DrawerShell`, per-tab reads/renders fidelity bar, dispatch, acceptance criterion) resolving the former §18.4 open item. Mock: forensic rows now show catalog body fields + redaction + Prometheus-eligibility dot.
- **rev 9 (2026-06-04, this revision)** — refined the job activity visualization (§10.2) into the **job activity card**: one framed card (4px, role rail clipped inside), metadata header always on top, the **forensic event stream replaces the raw terminal dump** (live event-by-event while running), and on completion a compact view = verdict lede + one-line role path + collapsed "view details" (full event stream) + the **Result in its own separate zone**. §7.3 anti-regression updated accordingly; §8.1 Feed uses the same compact-then-expand logic (no raw firehose on the surface). Mock Activity panels rebuilt to the card. Validated visually with the user before encoding.
- **rev 10 (2026-06-04, this revision)** — refined the activity card presentation (§10.2): dense single-row header (no monospace) with a solid identity chip `role │ job-id │ model`, status word, outcome pill, and right-aligned metrics; added **Files touched + inline diff per run** (sourced from forensic `diff`/`commit` evidence), with the file/diff emission added to §15.1. Mock rebuilt to the compact chip card with files/diff. Created `console/specialists-console-handoff.md` — the complete, dev-ready list of forensic + telemetry + endpoint dependencies the console needs from the `specialists` repo.
- **rev 11 (2026-06-04, this revision)** — Feed surface (§8.1) resolved as the **one unified cross-source activity timeline**, aligned to the shipped GitHub `ActivityTimeline` (day grouping, time gutter, dot + icon + content, diffstats, virtualization, `j/k`) and **generalized** so the GitHub Activity tab becomes that same engine scoped to `source=github` + repo (no parallel timeline). Locked the row anatomy and the Feed-vs-Issues distinction (Feed = "what happened"; Issues = the `IssueFeed` work-item list). Added the Feed surface to the mock (cross-source rows: specialists / github / issues, day-grouped, click → drawer).
- **rev 12 (2026-06-04, this revision)** — added the **GitHub Drawer** kind (§5.2, §11.6: Overview · Commits · Files · Checks · Linked, reusing `EventDetail`/`PrTimeline`), promoting PR/commit detail from the inline accordion to a first-class drawer now that the drawer is the canonical primitive; the accordion stays as the row inline peek. Extended §5.4 with Feed → drawer targets per source (issue → Issue Drawer, specialist → Chain/Issue, GitHub → GitHub Drawer). Reworked `specialists-console-handoff.md` into a **two-owner split** after the specialists agent flagged that most of the work is gitboard-materializer, not specialists: runtime *emits* the events it alone observes (the richness ceiling); the materializer *normalizes/derives/projects* (envelope normalization, files/diff from git, `/feed-events`, `/api/feed`, table-derived metrics). §15.1 points to the split.
- **rev 13 (2026-06-04, this revision)** — Feed row anatomy (§8.1) finalized: reuses the **IssueFeed row language** (two-line identity + classification chips) plus a **left time gutter** and a **source-color rail**, with the **issue gesture (§5.5)** — row click expands an inline mini-dossier of the event, chevron/id opens the drawer (target per source, §5.4). Mock Feed rebuilt to this (one row shown expanded).
- **rev 14 (2026-06-04, this revision)** — added the **segmented chip** `(a / b / c)` standard primitive (§6.5): one tight, light, slash-separated pill for compact classification, source-adaptive slots, aligned to gitboard's shipped chip density. Feed row (§8.1) moved to a **single line** (identity + one segmented chip) for a cleaner, more refined look; mock Feed rebuilt accordingly (still with the inline-expand on the first row).
- **rev 15 (2026-06-04, this revision)** — propagated the segmented chip (§6.5) across the mock for consistency: the activity-card identity chip now uses `/` slash slots (was `│`), and the Issue-row classification (`type / state / priority`) is now a single segmented chip, keeping date/dependency/agent meta separate. The standard chip is now visible on Feed, Issues and the activity card.
- **rev 16 (2026-06-04, this revision)** — added a **GitHub surface + GitHub PR Drawer** to the mock (§11.6 made visual): the surface demonstrates "GitHub Activity = the Feed timeline scoped to `source=github`", and the PR drawer shows the header (repo · PR · merged · branch · diffstat) + tab strip (Overview · Commits · Files · Checks · Linked) + Overview (diffstat bar, description, Linked-issue → Issue Drawer, reviews), reusing `EventDetail` content.
- **rev 17 (2026-06-04, this revision)** — the mock Operations drawer is now a true **Chain Drawer** (§11.1): tab set Composition · Activity · Channel · Outcome · Trace · Diff · Memories, with real Composition (Layer-1 steps + Layer-2 gates), Channel (pulse log), Outcome (verdict + close + memories + followups) and Trace (OTel waterfall) panels. Together with the GitHub Drawer (rev 16), the mock now **demonstrates drawer polymorphism** (§11.0); §18.4 updated — only a classifier-kind (Role/Memory) demo remains.
- **rev 18 (2026-06-04, this revision)** — added §9.2 **Navigation & shell**: a two-level left navigation (primary surface rail + secondary contextual grouped nav, icons throughout) replacing the horizontal top tabs, inspired by the New Relic sidebar. **Drawer-aware space management:** both rails independently collapsible to icon-only; opening the drawer auto-collapses them and closing restores; a topbar **Inspector toggle** (+ `]`) opens/closes the drawer at will. Icons are now first-class in the nav (§6.8). Mock shell rebuild to follow.
- **rev 19 (2026-06-04, this revision)** — icon + colour discipline. §6.4: **colour reserved for semantic state** (status / verdict / priority / diffstats) from the limited theme-strong palette; **categories carry meaning through icons, not colour** (no category-coding). §6.5: chips gain an **icon slot** — status chips are icon + word (redundant encoding, accessibility), kind/source/evidence chips are neutral + icon. §6.8: **Octicon-only with no exceptions** — dependency markers become Octicons too, **no emoji, no character-glyph icons**. These govern the upcoming mock shell + chip rebuild.
- **rev 20 (2026-06-04, this revision)** — mock shell + icon rebuild (§9.2, §6.8). **Phase 1:** topbar + vertical primary icon rail (inline-SVG sprite) replacing the horizontal top tabs; collapse + drawer-aware JS (Inspector toggle + `]` + scrim). **Phase 2:** Operations secondary contextual nav (grouped sections + icons, independent collapse, drawer-aware); default opens with the drawer closed so both navs are visible. **Phase 3:** Octicons (sprite) propagated across chips, status, disclosures and the Feed seg-chip source slot; all character-glyph icons (`✓ › v`) and emoji removed (diff-code `<…>` excepted). Collapse control is the clickable sidebar title (brand / surface name) with an inverted panel (sidebar-left) icon — mirroring the Inspector's panel (sidebar-right) — not a hamburger. §18/§20.1 iconography items marked resolved.
- **rev 21 (2026-06-04, this revision)** — added the **Specialists cockpit** surface to the mock (§8): a master-detail cockpit (the shipped `ChainListRow`/`ChainDetailPane` pattern) — filter chips (all/running/waiting/done/failed, icon-led), a chain list grouped Active/Historical with rich rows (segmented chip `template / state / gate`, roles-in-order with status icons, event counts), and a detail pane showing the selected chain's jobs in order with status pills. Wired the Specialists nav-item.
- **rev 22 (2026-06-04, this revision)** — reworked the navigation per user direction (§9.2): replaced the vertical two-rail nav with **two horizontal top bars** (primary surfaces + secondary contextual, no group labels — grouping implicit) and **restored the query-lab left sidebar** (scopes / saved queries / fields), now icon-styled. Same icons and menu set, redistributed. The sidebar is collapsible + drawer-aware; Inspector toggle (`sidebar-right`) mirrors the collapse icon (`sidebar-left`). Nothing of the surface content was lost — only the shell chrome changed. Mock rebuilt; dead vertical-rail CSS left harmless.
- **rev 23 (2026-06-06)** — **restored mock interactivity** lost in the shell rebuild and fixed the root cause. (1) The §5.5 **row gestures had not been re-wired** after the two-top-bar rebuild — issue/chain/feed/PR rows did nothing; re-wired per surface (Issues row→inline dossier, chevron→Bead drawer; Operations recent-object→Chain drawer; GitHub PR row→PR drawer; Specialists chain-row→detail select; Feed row→inline dossier). (2) The entire interaction layer was rewritten to a **single delegated handler on `document`** (immune to null-ref aborts and partial attachment). (3) **Critical CSS bug:** the global `svg { width:100%; height:100% }` rule overrode the hidden inline SVG **sprite's** `width=0/height=0`, inflating it — `position:absolute` — into a full-viewport transparent overlay that swallowed *every* click (page rendered, JS ran, nothing was clickable, in every browser). Fixed by forcing the sprite to zero size inline. Diagnosed live via the connected Chrome extension (`elementFromPoint`).
- **rev 24 (2026-06-06)** — **GitHub surface enriched in place** (user direction: inherit the good of legacy gitboard without a second repo-rail). Added a **StatsHeader** strip (Events · Pushes · PRs · Commits · Repos), the **event-type taxonomy** (`EventIcon`/`eventColor`) as per-row coloured icons mapped to the restrained mock palette (merge/review/commit/PR-open/PR-closed/tag/branch/issue — 9 new sprite icons), **day-grouped** timeline with real event variety, and an **enriched drawer**: proportional diffstat, working tabs Overview · Commits (**expandable `CommitRow` bodies**) · Files (+/−) · Checks · Linked. §9.1 reuse inventory updated; §11.6 unchanged (already described the enriched tabs).
- **rev 25 (2026-06-06)** — **Evidence surface mocked** per §7 (LOCKED) as a *ledger of proof*: verdict packet **4-card** row (`verdict / tests / findings / artifacts`), **proof rows** with PASS/PARTIAL/FAIL semantic rail + mono id + state chip + timestamp + result lede + artifact chips, the §5.5 gesture (row→inline mini-dossier, chevron→Evidence drawer), an `mem:anti-regression` row carrying a **regression contract** block, and an **Evidence drawer** (Proof · Artifacts · Diff) with verdict packet, artifact stack, changed files + inline diff + regression contract. Topbar2 Evidence ctx added.
- **rev 26 (2026-06-06)** — **Graph surface mocked** keeping the legacy `Graph.tsx` **form as-is**, with the single requested change that **clicking a chip opens the drawer**. Reproduced statically: header (path · counts · parent-child/related/deferred toggles), NOW strip, a cluster pane with a **static SVG node-link graph** (priority-railed `g-node` chips + arrowed edges with labels), orphans strip, buckets (`<details>`), foot. Legacy character-glyphs (◐ ◈ ◇ ✓ ✕ ▶) replaced with **Octicons** per §6.8; palette mapped to mock tokens. Node/orphan click → **Graph drawer** (Node · Relations · Activity) — parity with legacy `openSidebar`; header toggles flip on/off; topbar2 Graph ctx added. Remaining un-mocked surfaces: Observability, Sessions, Terminal.
- **rev 27 (2026-06-06)** — **navigation coherence pass** (§9.2 rewritten). Diagnosis: topbar2 had three different semantics (sections / filters / empty) and duplicated in-surface filter chips. Decision (user): **parent-sections model** — bar 1 = **Feed · Issues · Specialists · Operations · GitHub**; bar 2 = **child surfaces of the active parent** (Issues → Graph; Operations → Evidence · Observability · Sessions · Terminal; Feed/Specialists/GitHub pure) + the active child's sections after a divider (Operations only). **Filtering moved to the query-lab sidebar** as a contextual Filters group per surface (Feed sources / Issue states / Specialist run states / Evidence proof state+type / GitHub event types); duplicated in-surface filter rows slimmed to count lines; Graph keeps its legacy header lenses. Mock rebuilt: two-level nav JS (`PARENT_OF` + `activateSurface`), contextual sections + sidebar filters visibility, all prior gestures preserved.
- **rev 28 (2026-06-06)** — **chip identity pass** (§6.4 + §6.5 rewritten; user palette). New 5-role palette: `#F8FAFC` chip base · `#155E75` cyan = state primary (**no green by design**: running solid / pass tint) · `#DC2626` alert · `#FBBF24`/`#B45309` warn · `#7E22CE` special; royal blue `#3A5FCE` kept **for interaction only** (hard blue/cyan role split: "where can I go" vs "what is the system doing"). **Three-tier form rule**: SOLID = live/attention, TINT = settled, NEUTRAL = metadata. New primitives: **priority block `prib`** (P0 red / P1 amber / P2+ slate / epic purple), **specialist entity chip** (status dot + role/job/model · metrics + status pill), **issue entity chip** (prib + id/type + state pill), running pill with pulsing dot. Mock retokened and restyled (chips, pills, seg/id-chips, issue rows, feed roles, joblines); Graph keeps legacy coloring (form fidelity). Diffstat `+` now reads cyan per the no-green identity.
- **rev 29 (2026-06-06)** — **drawer coverage fix**: Feed and Specialists promised the drawer (§5.4 targets, "Open in drawer" / "Open chain drawer" affordances) but had no drawer element in the mock. Added a **Feed event drawer** (Event · Activity, forensic stream) and a **Specialists Chain drawer** (Composition · Outcome) with scrims; introduced the generic `data-open-drawer` affordance (any button so marked opens the active surface's drawer); wired Feed chevron → drawer (row body keeps the inline dossier, §5.5) and Specialists chain-row chevron → drawer (row body keeps detail-pane selection). Every surface that promises a drawer now has one: Operations, Issues, Evidence, GitHub, Graph, Feed, Specialists.
- **rev 30 (2026-06-06)** — **drawer consistency pass.** (1) The Specialists drawer is now the **full Chain Drawer** (Composition · Activity · Channel · Outcome · Trace · Diff · Memories) — same §11.1 kind already built for Operations, not a reduced copy; the compact 2-tab stub from rev 29 is gone. (2) **Drawer-head chips normalized to the rev-28 system**: category chips (`kind:*`, `type:*`, labels, sources) → neutral (icon optional); live states (`working`, `in progress`) → solid cyan pill with pulsing dot; priorities → `prib`; est. cost → neutral (caveat in tooltip); settled verdicts stay tints. Applied to the Chain, Bead, Graph-node and dossier heads.
- **rev 31 (2026-06-06)** — added **§6.13 Implementation stack [OPEN]**: recommended (for open evaluation, not locked) headless + utility stack — Tailwind v4 as token engine with **density encoded in the scale** (the app is deliberately visually dense, Datadog-class), Radix primitives (Dialog→DrawerShell, Tabs, Tooltip), shadcn/ui copy-in assembly, CVA to type the §6.5 chip variants, TanStack Table/Virtual for dense lists; Octicons and ReactFlow stay. Opinionated component libraries explicitly ruled out (density + identity conflict). Contract remains the design authority.
- **rev 32 (2026-06-07)** — **status-pill propagation pass** (§6.5 revised). (1) Pill variants renamed from colour names to **semantic names** (`run / pass / fail / warn / part / closed / special / idle` + `sm`), the direct §6.13 CVA mapping; the confusing `.pill.blue`-is-cyan drift is gone. (2) **State moved out of seg-chip slots** across Feed, GitHub, Specialists chain rows and the Issues dossier: slots stay neutral (source icon, template, meta, diffstat `+/−`, cyan agent-role identity), state is a trailing status pill, priority a `prib`; supersedes the rev-14 in-slot-state allowance; §8.1 row anatomy updated. (3) State-coloured `.chip.*` removed — verdict packets (scope/quality/tests PASS), Evidence proof rows (PASS/PARTIAL/FAIL), comp-steps (done/pass/next) and drawer-head states are pills; chips are exclusively neutral entity/tag forms (sole exception: solid-blue selected filter chip). (4) Form hygiene: `agent-badge` restyled neutral + cyan dot/role (was interaction-blue); `.job-metrics .link` now blue (links = interaction); chart polylines retokened off legacy hex greens; `btn:hover` / `.btn.quiet` variants; global `:focus-visible` blue ring; files-head char-glyph `v` → Octicon chevron; dead `.run` block CSS removed (collided with `.pill.run`); `.relation.violet` added.
- **rev 33 (2026-06-07)** — **classifier-kind drawers demonstrated** (§18.4 → resolved). Operations now hosts three drawer kinds: a **Specialist health** panel (per-role table, §12.2) whose rows open the **Role Drawer** (§11.2: Overview with 7-day success bars + failure reasons · Recent Activity cascading to chains · **Identity Memories** via the identity-lens query · Configuration), and failure-cluster rows open the **Memory Drawer** (§11.4: Pattern · Instances · Cross-reference · Mitigation Followups · Lineage). Mock shell now supports **multiple drawer kinds per surface**: `data-drawer="<kind>"` on drawers, `data-open-drawer="<kind>"` on triggers (valueless = surface default), drawer-tab handling scoped to the owning drawer. §20.1 polymorphism limitation resolved; remaining classifier: Chain Template (§11.3).
- **rev 34 (2026-06-07)** — **Chain Template Drawer mocked** (§11.3): Resolved Shape (Layer-1 debug steps + Layer-2 gates) · Recent Instances (cascade to Chain Drawer) · Failure Patterns (clusters under the template, cascading to the Memory drawer) · Configuration (`config/chains/debug.yaml` rendered + applies_when matcher). Opened from the Chain-throughput rows (`data-open-drawer="template"`), per the §5.4 mapping. With this, **every declared drawer kind except Session is demonstrated in the mock** (§18.4, §20.1 updated). Also: `#surface-operations > .main` scrolls (content outgrew the viewport after the Specialist-health panel).
- **rev 35 (2026-06-07)** — **full §4 surface coverage in the mock.** (1) **Observability** (§4.1 backend side): backend KPIs, materializer-freshness table per source (state pills, github "behind"), ingest/daemon chart, backend-only alerts + OTel/Prom/Loki backends rail; no drawer (runtime health = popover per §5.2). (2) **Sessions** (§13): chronological workblock list (seg-chip counts + state pill) and the **provisional Session Drawer** (§11.5 OPEN, labelled as such) with all 8 tabs Intent → Next-session Handoff. (3) **Terminal**: command surface with bd/sp history, status bar, prompt line, and the entity-link rule made explicit (IDs in output open drawers, §6.6). With rev 33-35 the mock covers every surface and every drawer kind (Session provisional).
- **rev 36 (2026-06-07)** — **drawer made NON-MODAL** (§5.1 revised, user direction after reviewing Grafana/Datadog references). Scrim and backdrop-close removed; the page stays interactive and scrollable with the inspector open; clicking another entity **retargets** the drawer (replace, §5.3); close is explicit only (injected X control, `]`, Esc). `--scrim` deprecated (§6.12). Mock: underlay elements removed, close control injected into every drawer, Escape wired.
- **rev 37 (2026-06-07)** — **density pass on Operations, Specialists, Observability** (user direction: real Grafana/Datadog-class surfaces, not sparse reports). (1) **Operations** rebuilt to the five-zone §12.1: pulse strip (scroll-focus + flash, §12.4), **Explore workbench** (§12.5: Builder/Code, label chips + pipeline, Run/History/Inspector/Split, results as Chart/Table/Logs), full panel grid (Specialist health, Chain throughput, Failure clusters, **Token economics**, **Active escalations** with recommend/dispatch/approve, **Runtime backstage** 8 micro-cards with inline popovers), **SRE-agent strip**; topbar2 sections now scroll-focus their panels; every panel has "Open in Explore". (2) **Specialists**: cockpit KPI strip; the detail pane is per-chain and §10.2-fidelity — forge-70el (job cards with files+result, trace, pulses, evidence chips), forge-9xet (**waiting-on-operator block with the exact command** `sp resume … --cap +15m`, failed job with reason + last useful output — the §8 requirements made visible), historical (outcome + memories). (3) **Observability** gains bar-2 sections (Overview · Logs · Traces · Components): Loki-style logs (label filters, volume histogram, severity-railed rows, expandable label table), Tempo-style traces (rows + waterfall), and a Datadog-style **small-multiples Components grid**.
- **rev 38 (2026-06-07)** — **§12.5-12.7 added [DRAFT]**, contract-first: **Explore workbench** (query row, results renders, panel round-trip rule), **Datasource model** (`{datasource, query, render}`; built-ins + user-added endpoints; the console as a generic ops workbench whose default workspace is xtrm's own agentops), **Incident analysis** (incident rows from escalations + alerts, correlated Feed-scoped timeline, cascade incident → chain → trace → logs → diff; candidate substrate kind deferred). Sidebar Datasources group mocked.
- **rev 39 (2026-06-07)** — **bar-2 reorganized into dedicated pages** (§9.2 revised; user direction "le tab dedicate non esistono", option B chosen). Conceptual split: **Specialists = the workforce** (Cockpit · **Roles** · **Templates** — health and throughput promoted from Operations panels to pages, rows keep their classifier drawers); **Operations = running the system** (Overview · **Explore** · **Economics** · **Incidents** · Evidence · Observability · Sessions · Terminal). Operations Overview is the only composite page (pulse strip + failure clusters + escalations + runtime + SRE); the former scroll-anchor sections are gone. Pulse cells navigate cross-page (`data-go`); "Open in Explore" switches to the Explore page with the query loaded. **Shared classifier drawer layer**: Role/Memory/Template drawers moved outside the surfaces (`.shared-drawers`), reachable from any page, closed on surface switch — no duplication, cross-page cascades intact. §5.4 rows updated. Incidents page mocks two §12.7 rows (full incident view still to come).
- **rev 40 (2026-06-07)** — **detail-recovery pass** after the rev-39 reorganization (user caught losses). Restored: Operations page-title (was stale "query lab"), the **p95 duration chart** (now on Roles, with Open-in-Explore), the **forensic coverage** KPI (now in Observability overview), and **Gate verdicts** as a real panel (Roles page — workforce quality, per gate kind, with the §10.2 prom query). Added the **inline incident view** (§12.7 first visual): INC-7 expands to the correlated timeline (Feed-engine-scoped loglines), involved-entity chips (chains, materializer, trace, memory) and cross-page jumps to Cockpit/Logs. Scroll enabled on all tall child pages.
- **rev 41 (2026-06-07)** — **telemetry reconciliation pass** against the wired docs (`docs/telemetry/`: projection contract, forensic event contract, agentops event catalog, infra handoff; `docs/console/architecture/`: architecture, observability spec, test guards, scaffold preflight). §15.1 rewritten with statuses: `/api/specialists/jobs/:job_id/feed-events` **SHIPPED**, forensic normalization **SHIPPED** (dual-write + shared emitter), `specialist_job_metrics` join **SHIPPED**, `/api/feed` **EXISTS**, files/diff **PARTIAL** (evidence refs only), freshness metric not yet exported. Metric reality richer than assumed (wait/queue/state/tool/pulse/worktree/process/eval families; labels + `service_name`/`repo`/`participant_kind`, tokens + `model_provider`/`model`); forensic families are **21**; verified body fields noted. §12.6 grounded on the shipped **ObserveDatasourceDescriptor / ObserveQueryRequest** (Slice A) — datasource types and query kinds adopted, freshness+evidence in the query response; dashboard-as-data (Slice B) open upstream with the operator-approval rule for agent-authored drafts. §12.3 nuance: Grafana **deeplinks allowed**, embedding no; server-side query proxy, read-only posture. §16 convergence note: production test guards already protect the non-modal drawer, chip identity and ia-restructure; Explore = `forge-9xet.4`, AgentOps panels = `forge-ow7c.4`. `/api/beads` retired → `/api/substrate/*`. Mock: Explore datasource picker aligned to the descriptor types.
Future revisions should update the relevant section in place and increment the revision number here; do not create parallel files.
---

## §16. Applied implementation — `xtrm-console-v2.html` (rev 42) [DRAFT — built & verified in mock]

This section records **exactly what is built and validated** in the current visual companion `console/xtrm-console-v2.html` so the React app implements it 1:1. The v2 mock supersedes `xtrm-console.html` as the visual companion. Where a change touches a prior LOCKED decision, the **supersession is explicit and scoped** — nothing else in §1–§15 changes.
### §16.1 Visual identity — "Observe" [supersedes §6.4 interaction hue, §6.10 sans, §6.11 radius numbers]
- **Typeface:** **Geist** (UI sans) + **JetBrains Mono** (mono — unchanged, §6.10 scannability rule stands). Self-host in production; the mock loads them via Google Fonts.
- **Colour roles (rev 42):** the five-role discipline and the SOLID-live / TINT-settled / NEUTRAL-metadata form rule (§6.4/§6.5) are **unchanged**; only two hues move, with no role lost:
  | Role | rev 41 | **rev 42 (applied)** | Use |
  |---|---|---|---|
  | interaction / brand | royal blue `#3A5FCE` | **violet `oklch(0.50 0.205 291)`** | nav active, links, selection, focus, primary, selected filter chip |
  | special (epic/merged/gate) | violet `#7E22CE` | **indigo `oklch(0.50 0.16 262)`** (the former interaction blue, repurposed) | tint only |
  | activity / running / pass | cyan `#155E75` | cyan `#155E75` (unchanged) | running solid / pass tint |
  | fail / warn | red / amber | red / amber (unchanged) | solid / tint |
  Five distinct hues, Datadog-class restraint preserved; no green by design.
- **Token layer:** one `:root` (light, canonical) + `html[data-theme="dark"]`. Accent tints are `--accent-soft|softer|line|ring|flash|focus|strong` (oklch with alpha). Dark = **near-black neutral** (`--bg:#0a0c0d`, `--surface:#14181a`), violet lifted. Theme-adaptive pill/badge tints use `color-mix(in oklab, var(--role) N%, …)` so one source var drives both themes.
- **Radius:** `--radius-sm 4px`, `--radius-md 6px` (tempered from §6.11's 3–4px). **Status pills fully rounded (999px)** — the Observe signature; `prib` priority blocks stay square.
- **Brand:** pulse-ring mark + wordmark `xtrm/console`.
- **Display settings popover** (topbar, not a contract change): theme (light/dark), accent (violet/indigo/cyan/rose), density (cozy/compact/dense), typeface (Geist/Inter/Plex); persisted to `localStorage`. Defaults: **light · compact · Geist · violet**.
### §16.2 Density & viewport-fill pattern [LOCKED in mock]
- Default density **compact** (`--base-fs` 12.5/12/11.5 per tier). Stat/pulse tiles are **2-row compact** (label; then number + caption inline) — never tall squares.
- **Every scrollable surface fills the viewport instead of leaving a void:** main grid `auto minmax(0,1fr)`; the primary data panel flexes to fill and its internal list/table region owns `overflow-y:auto`. Block panels that must not shrink below content use `minmax(auto,1fr)`. React: a layout primitive (header + fill region; the data region owns overflow).
### §16.3 Navigation & IA changes [updates §4, §9.2]
- **New top-nav parent `DevOps`** (infra/cloud — the §0 second face of the DevOps system), beside Operations.
- **Operations secondary nav (final):** Overview · Run · Explore · Evidence · Observability · Sessions · Terminal.
- **Economics folded into Explore** as a saved **"Cost"** results mode (token cost by template, alongside Chart/Table/Logs). The Economics tab is removed.
- **Incidents unified** (§16.6): the standalone Operations·Incidents tab is removed; incidents live under DevOps·Incidents with an AgentOps/Infra filter.
- **DevOps secondary nav:** Incidents · Topology · Dashboards · Recommendations. Right of the ctx bar: `env: prod` · `Agent Space · read-only` · time-range chips.
### §16.4 Drawer system — global-by-kind + new kinds [extends §5.2 / §5.2.1]
- **Resolution is global:** `data-open-drawer="<kind>"` opens `.drawer[data-drawer="<kind>"]` **anywhere in the document**; no-kind opens the active surface's own default drawer; switching surfaces closes any open drawer; **one drawer visible at a time (retarget, §5.3)**. This lets the new chat/RCA views feed the SAME drawers without forking a second inspector.
- **Reusable kinds** (unchanged shells, now globally reachable): `bead` (Issue Inspector — now tagged `data-drawer="bead"`), `chain`, `role`, `memory`, `template`, `session`, `github`.
- **New kinds** (same `DrawerShell`, config not fork):
  - **`incident`** — Overview · Timeline · RCA · Mitigation · Evidence.
  - **`plan`** (mitigation/recommendation) — Spec · Steps · Validation · Approvals. The **Steps** tab renders the plan materialized as **root + ordered step issues** (§0.2); each step opens the Bead drawer. Header carries the recommendation lifecycle stepper (§16.7) + `class:root` + risk.
  - **`answer`** (`query_answer.v1`, §16.7) — single scroll: verdict · evidence-by-kind · missing-telemetry gaps · recommended actions.
- **Chat-view ↔ drawer relationship** (resolves the "stepping on toes" concern): the chat/RCA stream is **orientation**; the drawer remains the **inspector** (§5). Every entity in a stream (ids, recommendation, memory, role, deploy, plan, chain) opens the appropriate drawer; the stream never duplicates drawer content.
### §16.5 AgentOps Run console — Operations · Run [DRAFT]
The chain-progress that lived only inside the Chain drawer is promoted to a **full-viewport chat-like "Run" view** (operator note in §0). 
- **Reason-for-run banner** always visible: issue + acceptance criteria + template + state.
- **Stream** = the chain's steps as messages: coordinator (resolved chain — L1 steps + L2 gates) → executor/writer (files touched + diff) → code-sanity gate → reviewer verdict → test-runner (live forensic events) → finalize. Avatar variant encodes role.
- **Native viz rail** (NOT embedded, §12.3): Run vitals (token-burn line, step-duration bars, elapsed/tokens/cost/eta), Verdict packet, distilled memory.
- **Chain selector:** the top chips select which active chain is live (swap banner + stream); ids in the banner open Chain/Bead/Memory drawers.
### §16.6 DevOps module [DRAFT — the §0 infra/cloud face, native over OTel/Prom/Loki + coexisting Grafana]
- **Incidents / RCA console** (reactive lane, §4/§5.3): reason-for-incident banner; chat-like loop **detect → triage (correlated timeline) → investigate (parallel hypotheses, discarded paths kept) → RCA (confidence) → mitigation plan (prepare→pre-validate→apply→post-validate→rollback) → approval gate → prevention (followup)**.
  - **AgentOps / Infra filter** unifies both incident domains in one view. **Infra** (e.g. market-data latency) shows the **Grafana scene embed** + infra topology rail; **AgentOps** (e.g. github materializer behind) swaps to a **native Specialist-health rail** (no infra Grafana for a workforce incident). Selecting a domain/incident swaps both the chat view and the domain rail.
  - **Autonomy ladder** (6 staged levels, §5) with the current level highlighted; **Agent Space scope** card (read-only / gated / out-of-scope — IAM-scoped blast radius); **DevOps team roster** card (devops-sre · deployer · iac-terraform · database · security-devops · cost-capacity · service-skills-sync, each with permission tier → Role drawer).
  - Approval gate = Level-4 gated deploy; Approve flips to applied; "View plan diff" / the recommendation open the **Plan drawer**.
- **Topology** — Mercury service map (4 tiers: Edge/DNS · Services · Data · Infra/Obs), health dots, dashed **blast-radius** edge; nodes open detail; a **service-skill runbook** card (health-check command + failure modes). This is the §4 reasoning substrate, distinct from the GitNexus code graph.
- **Dashboards** — **embedded Grafana** panels (coexist-not-rebuild, §2): a grid of dark Grafana-styled panels, clearly foreign; the market-data p99 panel highlighted. Prod = real Grafana embed/deeplink (§12.3 nuance).
- **Recommendations** (proactive lane) — clustered posture recommendations (Reliability · Capacity · Cost · Drift & backups) from the preventive node; each row = class badge (advisor/followup/gate) + risk + lifecycle status; opens the Plan drawer.
### §16.7 Data contracts surfaced [DRAFT]
- **`query_answer.v1`** (SRE answer object, rendered by the `answer` drawer): `verdict.status ∈ {PASS, DEGRADED, FAIL, UNKNOWN}` + confidence + one-line summary + scope/time-window; `evidence[]` **grouped by kind** (metric · forensic · dashboard · deployment · runbook); `missing_telemetry[]` rendered as **explicit gaps** (UNKNOWN/DEGRADED is a first-class, honest verdict — gaps are shown, never hidden, and a missing blocking signal cannot become PASS); `recommended_actions[]` each with substrate class + approval flag.
- **`recommendation.v1` lifecycle:** `PROPOSED → ACCEPTED → COMPLETED` (· REJECTED · CLOSED) stepper in the Plan drawer header + `class` (advisor/followup/gate/root) + risk; **Approve advances PROPOSED→ACCEPTED**.
### §16.8 Chip/pill discipline — applied corrections [enforces §6.5/§6.6]
- Inline issue dossier **Related** beads: bead-chip format (mono id **link** + state **pill** closed/open) and **clickable → Bead drawer** (was raw `<code>` + bare text).
- Inline **Specialist activity** rows: **seg-chip** role format (cyan mono role / slot) + trailing state pill, **clickable → Chain drawer** (the owning chain, §5.4).
- Reaffirmed everywhere: **state is always a pill; IDs are mono links that open their drawer; roles are cyan identity inside a neutral seg-chip**.
### §16.9 React implementation mapping [extends §6.13]
- **Tokens:** the `:root`/`[data-theme]` var layer → Tailwind v4 `@theme` + a `data-theme` swap; accent presets + density tiers via the same var layer; settings popover → a small client store persisted to `localStorage`.
- **DrawerShell:** one component; kind = config; `openDrawer(kind, id)` resolves globally; retarget + single-open. New kinds (`incident`/`plan`/`answer`) are tab/section configs over the same shell.
- **Stream:** a `Stream` / `StreamMessage` component (avatar role variant + step tag + card), reused by DevOps Incidents and AgentOps Run.
- **Typed objects + CVA:** `query_answer.v1` (verdict + evidence-by-kind + gaps) and `recommendation.v1` (class + lifecycle) as typed models with CVA-driven badges; rendered by the `answer` and `plan` drawers.
- **Topology:** ReactFlow (§6.13) or the positioned-node + percentage-coordinate SVG-edge approach used in the mock.
- **Grafana:** real embed/deeplink in prod (§2, §12.3) — keep it visibly foreign; native viz only for AgentOps.
- **Viewport-fill:** a layout primitive (header + fill region; the data region owns overflow), per §16.2.
