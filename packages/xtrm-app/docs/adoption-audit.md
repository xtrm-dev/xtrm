# xtrm-app — open-source adoption audit

**Status:** implementation guidance / adoption gate  
**Scope:** `packages/xtrm-app`  
**Product:** XTRM agent-first operating environment (Console v2 base shell + later Agent/Frames runtime)  
**Reconciled:** 2026-09-16 — canonical Console v2 baseline (PR #170 audit pack + `xt/rq8w @ a13989f`)

> **2026-09-12 audit round.** This document now also records the Console v2 base-UI adoption decisions.
> Full evidence is in the pinned audit artifacts:
>
> - `console-v2-audit-conar-ui.md` — Conar UI craftsmanship and primitive adoption (`wannabespace/conar` @ `d50f1d1`, AGPL-3.0)
> - `console-v2-audit-deepseek-harness.md` — Agent/observability architecture compatibility (`deepseek-ai/deepseek-harness` @ `c291e79`, MIT)
> - `console-v2-audit-console-v1-preservation.md` — current Console preservation/migration matrix (`Jaggerxtrm/console` @ `4b0d9f5`)
> - `console-v2-audit-substrate-issues-contract.md` — Substrate typed-service integration contract (`xtrm-dev/xtrm` @ `9263f91`)
>
> - `console-v2-audit-supernova.md` — primary visual benchmark and session-local runtime reference (`mattiacerutti/supernova` @ `d0fa686`, MIT), added 2026-09-16
> - `console-v2-audit-pichamber.md` — protocol/runtime engineering reference (`RyderAsKing/PiChamber` @ `87fe511`, MIT), added 2026-09-16
>
> Sections 10–14 below are the normative adoption decisions extracted from those audits. Where they conflict with sections 1–9, sections 10–14 win.
>
> **Terminology.** Sections 1–9 predate the Frame rename and use `Episode`. Read `Episode` as `Frame` (`InteractionFrame`), per `xtrm-gui-prd.md` §3.

## 1. Governing decision

Do not build commodity agent-client infrastructure from scratch when a maintained, compatible, permissively licensed implementation already exists.

At the same time, do not let an upstream workbench define the XTRM product identity.

Use this boundary:

```text
reuse aggressively
├── session/runtime plumbing
├── process and transport lifecycle
├── auth and permission mechanics
├── state stores
├── tool/diff/file primitives
├── markdown/composer primitives
├── desktop/Tauri integration patterns
└── performance/recovery techniques

own deliberately
├── Episode identity and boundaries
├── horizontal Episode navigation
├── zoomed-out Episode overview
├── conversation/fork information architecture
├── visual branch compression
├── XTRM interaction language
├── XTRM visual system
└── later XTRM ChainRun/Channels/runtime projections
```

The target is not a reskinned ACP client. The target is an XTRM product assembled from proven infrastructure.

## 2. Adoption classes

Every external reference must receive one explicit disposition before code is copied or a dependency is added.

```text
DEPEND
  consume the maintained package/API directly

ADAPT
  port or wrap a bounded implementation into XTRM-owned code
  preserve license/attribution requirements

REFERENCE
  study architecture/tests/failure handling only
  implement independently

REJECT
  do not adopt because of architecture, maintenance, license, or product-fit concerns
```

A worker must not silently vendor a repository or copy a component because it looks convenient.

## 3. High-value GUI references

### 3.1 `zvzuola/acp-components` — candidate DEPEND/ADAPT

License: MIT.

Why it matters:

- framework-independent ACP core;
- React workbench components;
- vanilla Zustand stores;
- multi-agent and multi-session lifecycle;
- workspace/session state;
- streaming text/thought/tool state;
- permission prompts;
- file tree and viewer;
- diff view;
- plan/thought/tool components;
- session create/load/switch/close/delete/fork;
- Tauri/stdin transport examples;
- host `Platform` abstraction for filesystem, dialogs, clipboard, updater, system and process spawning.

This is the highest-priority GUI adoption spike.

Do not adopt `WorkbenchShell` wholesale without first proving that its navigation and state ownership can accommodate XTRM Episodes. Prefer its lower-level core/stores/components where the stock workbench imposes chat-first information architecture.

Spike questions:

1. Can `@acp-components/core` own generic ACP session state while XTRM owns the Episode projection?
2. Can `ToolCallCard`, permission, diff, file and composer primitives be reused independently?
3. Can its Tauri `Platform` seam replace custom host-capability plumbing?
4. Does its session fork representation preserve enough provider identity for the XTRM conversation graph?
5. What is the smallest dependency surface that avoids importing a full competing workbench shell?

### 3.2 `AcpKit/acp-kit` — candidate DEPEND

License: MIT.

Purpose: reusable ACP client runtime above `@agentclientprotocol/sdk`.

It already owns the repetitive machinery that a product otherwise tends to reimplement:

```text
agent profile
→ spawn/connect
→ initialize/auth
→ session lifecycle
→ raw ACP updates
→ normalized message/reasoning/tool/turn events
→ transcript reduction
```

It also keeps host-specific filesystem, terminal and permission capabilities behind adapters.

Recommended direction:

```text
Pi
  → native XTRM Pi adapter first

Claude / Codex / OpenCode / other ACP agents
  → AcpAdapter
      → ACP Kit
```

Do not replace the native Pi lane solely to force protocol uniformity. Pi exposes richer provider-native turn/tree/settled semantics that are useful to the Episode model.

### 3.3 Pi ACP adapters — candidate ADAPT/REFERENCE

Relevant implementations include direct in-process Pi SDK adapters that map `AgentSession` to ACP.

Useful machinery:

- Pi event → ACP message/thought/tool translation;
- structured tool titles and file locations;
- edit/write diff translation;
- session list/load/resume/close;
- model and thinking configuration;
- usage/cost updates;
- client filesystem and terminal delegation;
- experimental fork handling;
- session registry patterns.

Use these to avoid rediscovering translation and capability-negotiation edge cases.

The first XTRM Pi vertical should still consume `AgentSessionRuntime` directly until an ACP path proves semantic parity for:

```text
turn_start / turn_end
agent_end(willRetry)
agent_settled
SessionManager.getTree()
navigateTree()
independent fork
compaction / branch summaries
```

### 3.4 OpenCode `packages/session-ui` — candidate ADAPT/REFERENCE

License: MIT.

OpenCode has already solved several UI problems that overlap strongly with XTRM:

- a shared session-turn UI package;
- message-part dispatch by content type;
- specialized and generic tool rendering;
- reasoning/thinking blocks;
- prompt state machine with mentions/attachments/commands;
- default-open policy for tool/reasoning content;
- virtualized timeline projection;
- row reuse during streaming;
- diff summary and review surfaces;
- deferred mounting of expensive tool content.

The conceptual mapping is useful:

```text
OpenCode SessionTurn
  user prompt + assistant parts

XTRM Episode
  ingress + all provider turns/activity until settled + final response
```

Do not copy OpenCode's vertical timeline as the product navigation model. Reuse projection and rendering techniques beneath the XTRM horizontal Episode surface.

### 3.5 `wygoralves/panes` — candidate REFERENCE/ADAPT

License: MIT.

Important Linux/Tauri implementation reference:

- Tauri 2 + React + Zustand;
- Rust backend ownership of persistence and native resources;
- Claude Agent SDK sidecar;
- Codex app-server integration;
- SQLite/FTS;
- PTY/xterm integration;
- session replay/resume;
- crash recovery;
- windowed message loading and lazy hydration for long sessions/tool output;
- setup/update flows.

The highest-value pieces are lifecycle, persistence, lazy hydration and packaging patterns. Do not import its overall cockpit information architecture if it conflicts with Episodes.

### 3.6 Hermes IDE — REFERENCE ONLY

License: Business Source License 1.1 with restrictions relevant to competing IDE/editor products.

Do not copy production code into XTRM.

Study these failure-handling patterns only:

- Node SDK bridge behind Tauri/Rust;
- NDJSON process bridge;
- stdout backpressure;
- maximum line/output bounds;
- permission round-trip normalization;
- startup control-operation buffering;
- idempotent initialization latch;
- generation-aware stale-exit rejection;
- long-lived session stores that survive component unmounts.

Equivalent XTRM code must be independently implemented or sourced from permissively licensed projects.

## 4. Architecture after adoption research

Recommended desktop layering:

```text
<XtrmApp>
  XTRM product layer
    EpisodeWorkspace
    EpisodeTabStrip
    EpisodeOverview
    ConversationGraph
    BranchCompression

  reusable interaction primitives
    Composer
    Markdown
    Tool cards
    Permission UI
    Diff/review
    Files

  product-neutral session/runtime layer
    PiNativeAdapter
      AgentSessionRuntime

    AcpAdapter
      ACP Kit
        Claude
        Codex
        OpenCode
        future ACP agents

  host layer
    Tauri 2
    Node 24 sidecar where required
    filesystem / process / notifications / persistence
```

Do not introduce one provider adapter per ACP-speaking agent unless a provider-specific capability actually requires it.

## 5. XTRM product personality

Reuse must remain visually and conceptually subordinate to XTRM.

The desktop application should feel like one coherent product, not a gallery of imported agent components.

### Interaction identity

The defining interaction is:

```text
Episode
  ingress
  collapsed activity
  final response
```

not an endless alternating chat stream.

Navigation is horizontal and stateful:

```text
thin Episode tabs
    ↕ zoom
Episode card overview
```

Conversation topology is first-class:

```text
main
├─ Episode...
└─ fork
   └─ +N compressed
```

### Visual identity

Use:

- restrained monochrome/graphite surfaces;
- one restrained accent family;
- thin separators instead of stacked cards where possible;
- high information density without clutter;
- browser-tab-like Episode chrome;
- Linear/Vercel-level spacing discipline;
- ChatGPT/Codex familiarity only where it reduces learning cost;
- XTRM naming and interaction vocabulary.

Avoid:

- rainbow provider badges;
- dashboard-style boxed layouts;
- visually importing another project's theme wholesale;
- making ACP or provider implementation details the dominant product vocabulary;
- rendering every event as permanent vertical transcript content.

### Product invariant

A user should be able to identify the XTRM app from a screenshot even if every provider name and logo is removed.

## 6. Adoption spikes before full implementation

Do these before building commodity components ourselves.

### APP-SPIKE-1 — acp-components

Build a disposable integration under the package/worktree, not a new permanent product architecture.

Prove:

- one local ACP session;
- streaming message/tool state;
- permission UI;
- session switch/fork;
- one reused tool/diff component;
- XTRM Episode projector consuming the state without adopting the stock chat layout.

Decision output:

```text
DEPEND / ADAPT / REFERENCE / REJECT
+ exact packages/components
+ version/license
+ integration friction
+ code removed from our starter as a result
```

### APP-SPIKE-2 — ACP Kit

Prove one non-Pi provider through a single generic adapter.

Acceptance:

- launch/auth/session bootstrap;
- normalized text/reasoning/tool events;
- cancel;
- provider capability discovery;
- no provider-specific branches in React UI;
- raw event access remains available for diagnostics.

### APP-SPIKE-3 — native Pi versus Pi-over-ACP

Run equivalent prompts through:

```text
native AgentSessionRuntime
Pi ACP adapter
```

Compare:

- turn boundaries;
- settled/completion semantics;
- tool correlation;
- tree/fork identity;
- compaction visibility;
- resume/reload fidelity;
- implementation complexity.

Native Pi remains preferred unless ACP reaches semantic parity for the Episode requirements.

### APP-SPIKE-4 — long-session rendering

Borrow the proven projection/lazy-hydration ideas from OpenCode/Panes.

Prove that thousands of event/message/tool records do not require mounting the whole historical transcript.

The Episode overview and selected Episode should remain responsive independently of total history size.

## 7. License and provenance gate

Before DEPEND or ADAPT:

1. record repository/package and exact license;
2. record exact version/commit used for evaluation;
3. preserve required copyright/license notices;
4. distinguish copied/adapted code from architectural reference;
5. reject code reuse from incompatible source-available licenses;
6. prefer package dependency over vendoring when the upstream API is stable enough;
7. keep a small provenance section in the implementation PR for material reused code.

Current high-value permissive references found in this audit include Pi, OpenCode, Prime Agent, `acp-components`, and ACP Kit under MIT terms. Verify licenses again at adoption time.

Hermes is reference-only under its current BSL terms.

## 8. Definition of successful reuse

Reuse is successful only when it removes product code or maintenance burden without weakening XTRM's interaction model.

Good result:

```text
less custom transport/auth/session/tool/file machinery
+ more upstream-tested behavior
+ XTRM Episodes remain the top-level mental model
```

Bad result:

```text
fork a whole workbench
+ hide XTRM concepts inside its chat model
+ inherit upstream navigation/theme/state coupling
```

## 9. Implementation rule

Before writing a new generic UI/runtime primitive, the worker must answer:

```text
Does Pi, acp-components, ACP Kit, OpenCode session-ui, Panes,
or another already-approved reference provide this?
```

If yes, evaluate adoption first.

If custom code is still chosen, record the concrete reason: missing semantic capability, incompatible ownership, unacceptable dependency, license, performance, security, or product identity.

## 10. Conar audit — base-UI adoption decisions (2026-09-12)

Audited: `wannabespace/conar` @ `d50f1d12790a5e3e32b16baaae46c732bd36ff35`, **AGPL-3.0** at the repository root, product identity "Tamery" (database client, package scope `@tamery`). Full evidence: `console-v2-audit-conar-ui.md`.

### 10.1 Shell verdict (material correction)

The operator's "double-sidebar" observation does **not** describe a persistent global icon rail. `VERIFIED`: Conar's shell is `title bar + left contextual navigator + tabbed workspace (+ collapsible bottom query logger) + right contextual chat panel`, composed inside a single `motion-panels` resizable group (`apps/app/src/routes/_protected/connection/$resourceId.tsx:115-179`). The navigator is route-scoped and absent on the dashboard route. The product's own minimum-window copy names the real layout: "the navigator, tabs and chat side by side".

Consequences:

1. Conar supplies **no precedent** for the XTRM persistent global icon rail. The rail is an XTRM invention and must be designed from scratch.
2. Conar's contextual sidebar collapses to **extent 0** and relocates its reopen affordance into the workspace tab bar. That **contradicts** the XTRM requirement (collapse to a narrow rounded reopen rail, never a second icon menu, affordance stays at the collapse edge).
3. Conar's drawer viewport is `fixed inset-0 z-50` with a `75%`-wide popup. That **contradicts** the XTRM requirement that a maximized drawer must never cover the global rail.
4. What Conar *does* validate is the **mechanism**: an independently sized, keyboard- and ARIA-correct, collapse-aware panel stack with a fill center, plus drag-threshold collapse and persisted open/width state.

### 10.2 Dispositions

| primitive / concern | disposition | note |
|---|---|---|
| Collapse-aware resizable panel + separator + fill center | **DEPEND** | `motion-panels` MIT — the single highest-value dependency in this audit |
| Panel motion / mode-switch / list reorder | **DEPEND** | `motion` MIT |
| Collapse-to-narrow-rounded-reopen-rail affordance | **ADAPT** | `motion-panels` gives the animation and 1px focusable separator; the rounded rail element and its reserved width are XTRM-owned (~30 lines) |
| Maximized drawer that cannot cover the rail | **ADAPT** | Base UI Drawer primitive + XTRM-owned portal/container scoping; Conar's mounting is REJECT |
| Menu / popover / tooltip / tabs / dialog / drawer / select primitives | **DEPEND** | `@base-ui/react` MIT (PROPOSAL — see §12.4 for the Radix migration question) |
| Command palette / fuzzy list | **DEPEND** | `cmdk` MIT |
| Icon family | **DEPEND** | `@hugeicons/react` + `@hugeicons/core-free-icons` MIT; single family, thin wrapper |
| Virtualization | **DEPEND** | `@tanstack/react-virtual` MIT |
| Global hotkeys | **DEPEND** | `@tanstack/react-hotkeys` MIT |
| Class-name utility, scroll affordances, toaster | **DEPEND** | `cn` MIT, `shadcn` CSS preset MIT, `tailwind-scrollbar` MIT, `sonner` MIT |
| Persisted UI state (collapse + width + theme) | **DEPEND** | `seitu` MIT (`createWebStorageValue`), optionally with `arktype` MIT schema validation |
| Variant matrix authoring | **DEPEND (library)** / **REFERENCE (recipes)** | `class-variance-authority` Apache-2.0 — NOTICE obligations apply |
| Type / space / radius scale, tokens, dark-light ladder | **REFERENCE** | XTRM owns its token values; the four-tier surface ladder and a single alpha knob are the reusable pattern |
| Sidebar row/list primitives | **REFERENCE** | Conar's rows derive from shadcn's MIT sidebar shape; do not copy AGPL class strings |
| All `@tamery/**` source (ui kit, app, table, shared) | **REJECT** | AGPL-3.0, no per-file notices; contamination risk |
| `packages/ui/src/components/aceternity/*` | **REJECT** | No licence/attribution header; upstream (Aceternity) terms must be checked independently — do not launder through Conar |
| `custom/resize-handle.tsx` | **REJECT** | Superseded by `motion-panels` separators; no pointer capture, no keyboard, no ARIA |
| Decorative overlays / marketing effects / animated brand | **REJECT** | Product-identity leakage, no shell value, extra Apache-2.0 NOTICE surface |
| `memoza@1.3.1` | **REJECT until licensed** | No `license` field and no `LICENSE` in the published tarball (`UNKNOWN`) |

### 10.3 Legal rule (restated for this audit)

Reading Conar for structure, dimensions, sequencing, and library selection is permitted. Copying, translating, paraphrasing-with-substitution, or mechanically reformatting Conar-owned source — including its CSS class recipes and its `@theme` / `:root` / `.dark` token blocks — is prohibited. No case in this audit required it: every mechanism XTRM needs is obtainable from a permissively licensed upstream package listed in §12.

---

## 11. DeepSeek Harness audit — Agent/observability compatibility decisions (2026-09-12)

Audited: `deepseek-ai/deepseek-harness` @ `c291e7961a515f6d7af9304e7fd1d257929aef26`, **MIT** (`Copyright (c) 2026 DeepSeek`); Cordis is vendored MIT under `Copyright (c) 2021-present Shigma`; `native/system` is BSD-3-Clause. Full evidence: `console-v2-audit-deepseek-harness.md`.

### 11.1 Governing result

**DEPEND count: 0.** Every harness package declares the source-vendored `@deepseek-ai/cordis` as a peer, and the framework layer is republished under the same scope. Any `DEPEND` imports a second plugin/DI runtime beside Pi, which the hard boundaries exclude. The value of this repository is **specifications**, not code.

Two facts that do matter:

- `@deepseek-ai/dsh-llm-pi-ai` depends on `@earendil-works/pi-ai@^0.85.1`. Pi and DeepSeek Harness already share one model-provider library. Align XTRM's provider/model catalog semantics there, not on DeepSeek's `LlmRuntime`.
- DeepSeek's own doctrine ("model-visible ⟺ logged"; durable session events vs live `agent/*` events as three separate domains) is the cleanest written statement of the durable/live separation XTRM needs for Frames and Observability.

### 11.2 Dispositions

| DeepSeek concept | XTRM equivalent | disposition | transferable / forbidden |
|---|---|---|---|
| Agent registry + durable identity | `Agent` | **ADAPT** | registry operations `get/list/roots/isOwnedBy`; "presence is not liveness proof". Forbidden: collapsing agent identity onto provider `SessionId` |
| create / resume / dispose lifecycle | `AgentSession`, Specialists activation | **ADAPT** | fixed publication order with rollback pairing; `dispose()` as an owner-held capability |
| Parent relationships | `AgentRelation.kind` | **ADAPT** | split runtime ownership from durable lineage; never conflate |
| Fork lineage | `AgentRelation.kind = fork` | **ADAPT** | fork seed = completed-turn prefix captured once, then owned by the child |
| Session identity | `AgentSession` | **REFERENCE** | map to `AgentSession.externalId`; provider keeps durable session authority |
| Durable SessionEvent log | `Evidence` + existing forensic authority | **REFERENCE** | adopt only as a compatibility/verification projection; NOT as a second transcript store |
| Live `agent/*` events | XTRM live Agent events | **REFERENCE** | naming/shape reference only; do not put foreign names on XTRM's bus |
| Durable-vs-live separation | not yet written in XTRM | **ADAPT** | highest-value doctrine: record which events survive restart and which are explicitly transient |
| Typed projection architecture | `Frame` | **ADAPT** | `ProjectionDefinition`-style unit with `stateVersion`, watermark, consistent cut, change suppression; no Cordis, no `ctx.inject`, no Zod |
| Tool-call lifecycle | XTRM tool surface | **ADAPT** | pre/execute/post envelope + scoped restriction + loud unknown-name validation |
| Streaming | XTRM live output | **ADAPT** | chunks transient; exactly one durable settlement per attempt |
| Cancellation | XTRM stop/interrupt | **ADAPT** | closed cause union (`user \| parent \| hook \| disposed`) with first-cause-wins |
| Inbox / followup / steer / inject | XTRM steer/followup | **ADAPT** | two ordered boundaries (`next-turn` / `next-step`), non-waking `inject`, durable splice record, `keepInbox` |
| Agent Teams roster | Specialists → unified Agents | **REFERENCE** | shape only; role identity stays with XTRM |
| Mailbox / peer messaging | `AgentRelation.kind = peer` | **REFERENCE** | queued-minus-delivered recovery idea only |
| Team task DAG | Substrate Issues | **REJECT** | a second task authority = dual-write and reconciliation debt |
| Telemetry / logging | `TelemetryEvent`, AgentOps evidence | **ADAPT** | redaction waterfall before emit; fail-closed on a throwing rule; harness ends at `emit()` |
| Approvals | none in the XTRM model | **REFERENCE** | closed fail-closed outcome enum + durable asked/decided audit pair |
| Remote/client projection, Web UI, desktop | Console v2 | **REFERENCE** | no code reuse; the two-stream `snapshot`+append / `control` baseline-then-replace shape is worth a shell-level decision |
| SDK / ACP / profiles / bundles / storage / jobs / plan / goal / invariants | XTRM control plane | **REFERENCE** | no Console v2 requirement |

### 11.3 Hard boundaries (unchanged)

Pi remains native-first. Substrate Issues remains executable-work authority. No second transcript/session source of truth. No import of DeepSeek team/roster/task authority. No DeepSeek or Cordis runtime beside Pi.

---

## 12. Base-UI dependency decision list (Console v2 shell)

The only packages XTRM may `DEPEND` for the base Console v2 shell, with versions verified from per-version registry metadata. License text/notices must be retained in the implementation PR.

| package | version (audited in Conar) | license | purpose |
|---|---|---|---|
| `motion-panels` | `0.4.0` (latest `0.5.1`) | MIT | collapse-aware resizable rail/sidebar/inspector panels + fill center |
| `motion` | `13.2.0` | MIT | panel/mode/list motion |
| `@base-ui/react` | `1.7.0` (latest `1.8.0`) | MIT | menus, popovers, tooltips, tabs, dialogs, drawer, select, scroll-area |
| `@hugeicons/react` + `@hugeicons/core-free-icons` | `1.1.10` / `4.3.0` | MIT | single icon family |
| `cmdk` | `1.1.1` | MIT | command palette |
| `@tanstack/react-virtual` | `3.14.10` | MIT | virtualization |
| `@tanstack/react-hotkeys` | `0.10.0` | MIT | global hotkeys |
| `cn` | `0.2.4` | MIT | class-name merge |
| `shadcn` (CSS preset) | `4.20.1` | MIT | scroll-fade / no-scrollbar utilities |
| `seitu` | `0.16.1` | MIT | persisted UI state |
| `arktype` | `2.2.3` | MIT | schema validation of persisted state |
| `sonner` | `2.0.8` | MIT | toasts |
| `tailwind-scrollbar` | `4.0.2` | MIT | scrollbar styling |
| `class-variance-authority` | `0.7.1` | Apache-2.0 | variant matrices (NOTICE) |
| `tailwindcss` (`+ tw-animate-css`, `@tailwindcss/typography`) | `4.3.3` / `1.4.0` / `0.5.20` | MIT | styling |
| `@fontsource-variable/geist{,-mono}` | `5.3.0` | OFL-1.1 | fonts |

### 12.1 Pre-1.0 dependency risk

`motion-panels@0.4.0` is a `0.x` package with a single maintainer. Mitigation: pin an exact version, wrap every `motion-panels` primitive behind an XTRM-owned shell adapter module so the dependency has exactly one import site, and record the fallback — XTRM-owned CSS-custom-property width math plus a plain focusable separator. Do not spread `motion-panels` imports through feature code.

### 12.2 Reopen-rail mechanics gap

`motion-panels` has no `collapsedSize`: collapse is always to extent `0`. The XTRM "collapse to a narrow rounded reopen rail" therefore cannot be a bare `collapsed` panel. Two XTRM-owned options, to be chosen at implementation wave B:

- **PROPOSAL B1** — the collapsed rail is a sibling fixed-width element (not a `ResizablePanel`); expanding replaces it with the sized panel.
- **PROPOSAL B2** — the sidebar panel is never `collapsed`; at rail width it renders only the reopen affordance and the library's separator handles drag-out.
`UNKNOWN` which better satisfies "restore returns the prior sidebar state" together with drawer maximize auto-collapse.

### 12.3 Drawer scoping gap

`@base-ui/react` Drawer portals to `document.body` in Conar. XTRM requires the maximized drawer to leave the global rail visible. This requires either a portal `container` override into the workspace region or an `absolute` drawer inside a `relative` shell region, plus an explicit z-index contract. Verify container-override support in the pinned `@base-ui/react` version during wave D; `UNKNOWN` until then.

### 12.4 Radix migration question (PROPOSAL, needs an operator decision)

Console v1 uses `@radix-ui/react-accordion`, `react-collapsible`, `react-tooltip` (`apps/console/package.json`). Adopting `@base-ui/react` as the single primitive layer means either a bounded migration of those three surfaces or accepting two primitive libraries during the transition. Running two libraries indefinitely violates the "one coherent primitive layer" goal; the recommended path is to adopt `@base-ui/react` for all new Console v2 surfaces and migrate the three Radix usages as their Console v1 surfaces are replaced (waves C and D).

---

## 13. Supernova audit — session-local UI/runtime reference (2026-09-16)

Audited: `mattiacerutti/supernova` @ `d0fa6869a950788045d5e10f6d500a75fe46e229`, **MIT** (`Copyright (c) 2026 Mattia Cerutti`). Full evidence: `console-v2-audit-supernova.md`.


### 13.1 What Supernova is

A Pi-native agent client (Electron + server + React) whose value is restraint: flat surfaces, hairline borders, hover-until-needed chrome, one accent, `max-w-3xl` reading column, collapsible `work` groups, one-line tool titles with lazy-mounted details. Server owns execution/settlement/identity; React owns projection/cache; contracts own serializable shape; desktop owns shell. This **strengthens** the P1 placement direction (§4 of the Supernova audit).

### 13.2 Dispositions

| primitive / concern | disposition | note |
|---|---|---|
| Seed→runtime theme resolver + flat surface scale | **ADAPT** (shape) / **REFERENCE** (values) | port resolver + surface ladder; XTRM keeps own palette/violet |
| Superellipse rounding | **DEPEND** | `@toolwind/corner-shape@0.0.8-3` MIT (license VERIFIED via npm) |
| Offline curated icon registry pattern + xs–lg size scale | **ADAPT** | copy registry pattern, re-pick glyph sets; does not overturn the HugeIcons DEPEND in §12 |
| Base-UI menu/dialog shells, message-scroller, scroll-fade utilities | **DEPEND** (license permitting) | converges with existing Base UI direction |
| Sidebar layout + collapsible headers + compact session row state machine | **ADAPT** | highest-value sidebar idea: timestamp↔spinner↔dot swap, hover actions, prefetch, inline rename |
| Timeline item model + turn→items builder + `max-w-3xl` frame + user bubble + markdown overrides + `ContentPanel` + hover-only actions | **ADAPT** | core timeline recipe; details in `console-v2-audit-supernova.md` §1.2 |
| "Worked for Xs" activity group + tool one-liners + per-kind tool details | **ADAPT** | signature density pattern: cheap title always, expensive details lazy-mount |
| Cached Shiki highlighting + Pierre diff rendering | **DEPEND** (NOTICE-acceptable) / **REFERENCE** | `@pierre/diffs` Apache-2.0 (license VERIFIED via npm); both Supernova + PiChamber converge on Pierre |
| Virtualized timeline + expandable virtual list | **DEPEND** | `@tanstack/react-virtual` MIT; carry the `getVirtualDistanceFromEnd` patch rationale |
| Streaming footer (loader + tail-fade + `aria-busy`) | **ADAPT** | port loader + window constants |
| Tiptap composer chrome + atomic reference node + suggestion/model-picker/context-ring/undone-drawer recipes | **ADAPT** | `@tiptap/* ^3.23.4` MIT; no prior composer decision exists |
| `virtua` (declared, unused in `src`) | **REJECT** | no evidenced use |
| Supernova token values / accent / Inter font | **REJECT** | XTRM owns palette/violet/Geist (PRD §27) |
| Supernova desktop shell as UI source | **REJECT** | OS shell only, no UI primitives |

### 13.3 Frame semantics carried from Supernova

Session-local single-ingress units with server-owned settlement (`waitForIdle`-equivalent + snapshot publish), synthetic-live ID quarantine, and one-active-unit-per-session are proven patterns — adopt as Frame requirements. `Turn.id = userMessage.id` is the fielded precedent for durable Frame identity. Child-agent linkage and cross-agent aggregation are greenfield (no Supernova evidence). Proposed Frame contract and wave-H deferral list: `console-v2-audit-supernova.md` §3.5–3.6.

## 14. PiChamber audit — protocol/runtime engineering reference (2026-09-16)

Audited: `RyderAsKing/PiChamber` @ `87fe511db5ebcee2a44f9f4ea08aebe0b219fde6`, **MIT** on disk with dual `OpenChamber (2025 Bohdan Triapitsyn)` + `PiChamber (2026 RyderAsKing)` copyright; GitHub `NOASSERTION` is metadata noise. Preserve both copyright lines + MIT text at redistribution root for any copied file. Full evidence: `console-v2-audit-pichamber.md`.

### 14.1 Dispositions

| primitive / concern | disposition | note |
|---|---|---|
| Private daemon + local-socket IPC + supervisor/lease/lock | **ADAPT** | best-in-class isolation pattern; XTRM runtime differs |
| SSE lifecycle budgets + epoch replay + drain/terminate deadlines | **ADAPT** | copy budgets, not the file |
| Send idempotency receipts (`operationId+streamEpoch`, 409/410) | **ADAPT** | exact semantics worth cloning |
| Header-only JSONL list + tail paging + `before` cursor | **ADAPT** | paging contract, not the Pi JSONL parser |
| Sanitized `Usage` projection | **ADAPT** | prevents NaN-token UI bugs |
| Alias-resolved live message IDs | **ADAPT** | same quarantine doctrine as Supernova synthetic IDs |
| Archive-as-sidecar | **ADAPT** | overlay metadata, never mutate agent log |
| Bearer + Pairing v2 + 60s URL tokens; WebAuthn issuance libs | **ADAPT** model / **DEPEND** libs when auth is scoped | `@simplewebauthn/server 13.3.1`, `browser 13.3.0`, `jose ^6.1.3` |
| E2EE relay design | **REFERENCE** | unwired at audited SHA; do not depend yet |
| Electron packaging layout | **REFERENCE** | proven layout; not evidence against Tauri |
| Sidebar interaction (flat recency + family color + virtualized archive) | **ADAPT** | interaction, not the 15-hook implementation |
| Turn/tool rendering metadata + clock normalization | **ADAPT** | skip todo-coupled StatusRow |
| Command palette wiring | **DEPEND** (`cmdk`) + **ADAPT** wiring | converges with existing `cmdk` direction |
| Icon sprite + file-type ID centralization | **ADAPT** | pattern only; glyph set stays XTRM's |
| File viewer IA | **ADAPT selectively** | viewer IA yes; triple-stack + beta diff no |
| Dual primitive/virtual/markdown stacks | **REJECT dual** | DEPEND on one family each (Base UI; TanStack Virtual; one markdown lib) |
| Mobile/Capacitor/PWA/push/STT/diagram extras | **REJECT** | matrix explosion unless mobile is committed |
| 3k-line session store shape; unwired relay host as dependency | **REJECT** | tested but not restrained; design-doc only |

### 14.2 Structural note

PiChamber proves Pi-native protocol engineering (isolation, reconnect/send correctness, bounded-everywhere budgets) can coexist with an unrestrained UI (dual stacks, 15-hook sidebar, beta deps). Take the former; do not lift the latter. Supernova remains the structural reference for restraint.

---

## 15. Accepted decisions — canonical Console v2 baseline (2026-09-16)

This section records operator-accepted decisions. It resolves the open `PROPOSAL` and `UNKNOWN` items in sections 10–14 where a decision exists. Items that still need implementation evidence stay open and name the wave that closes them.

### 15.1 Accepted

| decision | status | resolves |
|---|---|---|
| Implementation root is `xtrm-dev/xtrm/packages/xtrm-app` (placement P1). The Console v1 host is a reusable backend during migration, not the UI target. | **ACCEPTED** | shell architecture §1; PRD amendment A11 of PR #170 |
| Supernova is the primary visual benchmark for restraint and density. XTRM keeps its own palette, violet accent, and typography. | **ACCEPTED** | §13.2 |
| Shell = persistent global icon rail + contextual sidebar + primary surface + inspector rail and canonical drawer. | **ACCEPTED** | §10.1 |
| Collapsed contextual sidebar = reserved narrow rounded reopen rail, implemented as a sibling element outside the resizable group (B1). B2 is the recorded fallback. | **ACCEPTED** (B1 default) | §12.2 |
| `@base-ui/react` is the single primitive layer for all new surfaces. Console v1 Radix usages migrate at their surface cutover. | **ACCEPTED** | §12.4 |
| `motion-panels` behind one XTRM shell adapter module (single import site, exact pin). | **ACCEPTED** | §12.1 |
| `@tanstack/react-router` is the router. The hand-rolled route registry alternative is rejected. | **ACCEPTED** | shell architecture §9.1 |
| `@tanstack/react-virtual` is the only virtualization library. | **ACCEPTED** | §12, §13.2, §14.1 |
| `cmdk` powers the command palette and global search result list. | **ACCEPTED** | §12, §14.1 |
| Substrate Issues are read through the Substrate typed service and projections. No direct SQLite access from UI or app backend. No dual-write. | **ACCEPTED** | §11.3; Substrate contract audit §4.1 |
| A Frame belongs to exactly one AgentSession. Cross-agent aggregation belongs to Agents / ChainRun / Graph / Observability and is not Frame identity. | **ACCEPTED** | §13.3; shell architecture R12 |
| The Agent/Frames runtime is a separate, later tranche. | **ACCEPTED** | shell architecture §12, wave H |

### 15.2 Still open

| item | owner wave | note |
|---|---|---|
| Base UI Drawer portal `container` override in the pinned version | D | if unsupported, use a shell-owned absolute panel for the drawer (shell architecture §7.2) |
| `@pierre/diffs` Apache-2.0 NOTICE acceptance | H (timeline) or first diff surface | not needed by the first executable vertical |
| `@toolwind/corner-shape` (superellipse) adoption | A | optional polish; XTRM radius family (PRD §27) remains authoritative |
| Tiptap composer | H | no composer ships in the base tranche |
| Frame contract details: optional response body, provisional IDs, child-agent references, compaction-only units | H | inputs recorded in `console-v2-audit-supernova.md` §3.3–3.6; the accepted invariant in §15.1 is the only settled part |
