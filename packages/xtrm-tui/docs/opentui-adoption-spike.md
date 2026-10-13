# OpenTUI adoption spike for `xtrm-tui`

**Status:** bounded evaluation plan; no renderer decision made  
**Owner:** `xtrm-dev/xtrm/packages/xtrm-tui`  
**Tracking:** XTRM-112; implementation/product parent XTRM-86  
**Target runtime:** Bun + TypeScript  
**Baseline:** `@earendil-works/pi-tui`  
**Candidate:** `@opentui/core` + `@opentui/solid` + pinned `solid-js`

## 1. Decision under test

Determine whether OpenTUI offers a material enough advantage for XTRM's first-party Frame interface to justify replacing the current planned `pi-tui` rendering/input foundation.

This is not approval to migrate the product. Until evidence passes the acceptance gates below, `pi-tui` remains the baseline specified by the current PRD and adoption audit.

OpenCode is a reference implementation and evidence that OpenTUI is used in a substantial terminal application. It is not a proposed application dependency.

## 2. Current repository baseline

Verified on `xtrm-dev/xtrm` `main` at `6656c8e7aa6dbe0ac0ee035bf95b95db1144edf1`:

- Product contract: `packages/xtrm-tui/docs/xtrm-tui-prd.md`.
- Adoption gate: `packages/xtrm-tui/docs/adoption-audit.md`, which explicitly retains `pi-tui` unless a local spike demonstrates a concrete blocker or advantage.
- `packages/xtrm-tui/src/tool-view.ts` contains a pure, renderer-independent tri-state policy: `compressed`, `normal`, `expanded`.
- `packages/xtrm-tui/src/agent-command-sketch.ts` is explicitly a structural sketch and throws rather than launching a TUI.
- `packages/xtrm-tui/package.json` currently declares Node `>=24.0.0`, not Bun. This is metadata to reconcile before a runnable Bun entrypoint is merged; do not assume it proves Bun incompatibility or that the runtime has already been migrated.
- The PRD requires Pi's runtime/resource/session machinery, extension compatibility, native session topology and `agent_settled` Frame completion semantics to remain authoritative.

This spike therefore compares rendering/input libraries only. It must not conflate renderer choice with the separate runtime/fork discussion in XTRM-111.

## 3. Source-backed candidate facts

### OpenTUI

Official project: https://github.com/anomalyco/opentui  
Runtime/platform matrix: https://opentui.com/docs/getting-started/runtime-support/  
Solid bindings: https://opentui.com/docs/bindings/solid/  
Core docs: https://opentui.com/docs/

Current official documentation states:

- The rendering core is implemented in Zig and exposed through TypeScript bindings.
- `@opentui/core` provides the native renderer; `@opentui/solid` provides Solid components and reactive primitives.
- The documented minimum Bun version is 1.3.14. The package's native operation loads a platform-specific optional native artifact through the runtime's FFI path.
- `@opentui/solid` requires `solid-js` 1.9.12 exactly according to the current runtime-support documentation.
- The project documents Linux glibc and musl variants, macOS x64/arm64 and Windows x64/arm64 artifacts, but explicitly warns that artifact availability is not proof of parity for every target.
- OpenTUI is MIT licensed. Verify the license again at the exact version pinned for the spike.

These facts make OpenTUI a plausible Bun candidate, but also create packaging, optional-dependency, FFI, platform and native-lifecycle risks that do not exist in the same form for a pure TypeScript renderer.

### `@earendil-works/pi-tui`

Repository: https://github.com/earendil-works/pi

The current adoption audit identifies existing capabilities including differential rendering, synchronized output, component/focus contracts, stack layout, scrolling, overlays, keyboard/input handling, terminal-width utilities, Markdown, selection and image/capability support.

Its primary advantage is not merely rendering: it is already the TUI surface used by Pi, which is important to XTRM's explicit extension-UI compatibility requirement. Replacing it could require an adapter or deliberate compatibility limits for custom Pi components and `ctx.ui` interactions.

## 4. Required prototype

Build the smallest runnable Bun application that can be implemented equivalently with both renderers. Do not port the entire product.

### Shared renderer-neutral model

Use the existing `ToolViewMode` / `planToolRender` policy and a small deterministic fixture model. The renderer must consume the same model; do not fork the Frame projector or duplicate tool-display policy.

Minimum screen:

- bottom-docked Frame navigator with three sample Frames;
- selected-Frame viewport;
- streaming assistant text;
- compact tool-activity rows;
- composer with multiline/paste behavior;
- one keyboard-opened Frame overview overlay;
- error and working states;
- resize-aware layout at 80, 120, 160 and 220 columns.

The same fixture sequence must run against each implementation: initial render, streamed text deltas, repeated activity updates, a failed tool, Frame switch, overlay open/close, scroll and terminal resize.

After fixture parity, connect one real Pi `AgentSession` and confirm that the renderer receives projected events without owning or rewriting runtime/session state.

### Candidate implementations

1. Baseline: `@earendil-works/pi-tui` with the smallest viable adapter.
2. Candidate: `@opentui/core` + `@opentui/solid` using Bun's documented Solid preload/transform setup.

Keep both prototypes isolated from the production dependency graph. Do not introduce OpenTUI as a production dependency during the spike.

## 5. Measurements and manual checks

Record exact OS, architecture, Bun/Pi/library versions, terminal emulator, tmux version, commands and raw outputs. Do not substitute estimates for measurements.

| Area | Evidence required |
|---|---|
| Cold start | Repeated process startup; report median and spread |
| Memory | Peak and steady-state RSS after initial render and during streaming |
| Rendering | CPU use, redraw behavior and visible flicker during a fixed update stream |
| Input | Key dispatch, paste, multiline editing, focus and overlay behavior |
| Layout | 80/120/160/220 columns; resize while streaming; scroll position stability |
| Environment | Alacritty, tmux locally and tmux over SSH; record failures separately |
| Shutdown | Ctrl+C, normal exit, resize/interrupt during active work; verify terminal restoration and native renderer disposal |
| Distribution | Clean install with lockfile; optional native package availability; missing/corrupt native artifact error quality |
| Compatibility | Pi custom component, editor/input, Markdown, overlay and extension `ctx.ui` interaction implications |
| Engineering cost | LOC, adapter complexity, test complexity, version pinning and required custom work |

Use the same machine, fixture, Bun version, terminal and measurement procedure for both candidates. Report each run; do not select only the best result.

## 6. Hard invariants

The renderer choice must not change:

- `Frame` / `InteractionFrame` semantics;
- one accepted idle submit creating one Frame;
- `agent_end` being informational and `agent_settled` being the authoritative completion boundary;
- Pi ownership of model execution, tools, resource loading, extensions, sessions, branching, retries and compaction;
- XTRM's pure tri-state tool display policy or the underlying tool-result object;
- `xt pi` or ordinary `pi` behavior;
- the absence of a competing transcript store or second agent runtime.

Do not create a second XTRM design system. Retain the existing `xtrm-ui` work and document the adapter/extraction cost for each renderer.

## 7. Decision rubric

Score each category 1–5 and attach evidence, not intuition:

- Frame layout fidelity and component ergonomics;
- streaming stability, redraw cost and terminal restoration;
- keyboard/input/IME/paste and overlay/focus behavior;
- Pi extension and component compatibility;
- Bun installation and native artifact distribution;
- tmux/SSH and terminal compatibility;
- implementation and long-term maintenance cost.

A renderer is not selected on raw rendering speed alone. OpenTUI should replace the baseline only if it demonstrates a material UX or performance benefit and the adapter/compatibility cost is acceptable.

### Outcomes

- **ADOPT OpenTUI:** fixture and real-session tests pass; platform/distribution risks are understood; advantage is material; update PRD/adoption audit in a reviewed follow-up.
- **RETAIN pi-tui:** Pi compatibility or implementation advantage dominates, or OpenTUI's native/runtime distribution cost outweighs benefits.
- **DEFER:** evidence is incomplete or neither candidate is materially better.

## 8. Exit criteria

- [ ] Exact dependency versions and licenses recorded.
- [ ] Both fixture prototypes exist and run under Bun.
- [ ] Shared fixture and measurement script documented.
- [ ] 80/120/160/220 width and resize checks recorded.
- [ ] tmux and tmux-over-SSH behavior recorded.
- [ ] Clean shutdown and terminal restoration verified.
- [ ] Real Pi AgentSession event projection smoke-tested after fixture parity.
- [ ] Extension/UI compatibility disposition documented.
- [ ] Raw measurements and commands retained.
- [ ] Adopt/retain/defer recommendation reviewed.
- [ ] No production dependency migration made without separate acceptance.

## 9. Upstream references

- OpenTUI repository and MIT license: https://github.com/anomalyco/opentui
- OpenTUI runtime/platform requirements: https://opentui.com/docs/getting-started/runtime-support/
- OpenTUI Solid setup: https://opentui.com/docs/bindings/solid/
- OpenTUI quickstart/docs: https://opentui.com/docs/
- Pi repository and package sources: https://github.com/earendil-works/pi

Re-check all version-sensitive statements against the exact release pinned for the prototype before implementation.
