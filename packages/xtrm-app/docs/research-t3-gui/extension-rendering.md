# Extension auto-recognition + native-specialist rendering

## 1. Verified facts (not assumptions)

- Pi's TUI mechanism is `pi.registerEntryRenderer(customType, (entry, {expanded}, theme) => node)`
  (`extensions.md:1591`) + `pi.appendEntry()` (durable, non-context) / `pi.sendMessage({customType,…})`
  (context-bearing card). Rendering is keyed by **`customType` string** — data-driven, no
  per-extension transcript code.
- XTRM extensions already emit typed payloads: `skill_suggestion`
  (`core/packages/pi-extensions/extensions/skill-suggest/index.ts:83`, via `sendMessage`
  inside the turn), `substrate_suggestion` (`substrate-suggest/index.ts:79`), `xtrm-ui` prefs
  entry (`xtrm-ui/index.ts:159`, via `appendEntry`).
- **The GUI never sees them.** The host emitter
  (`core/packages/pi-extensions/extensions/xtrm-agent-host/index.ts`, 870 lines) forwards:
  `session_identity/start`, `before_agent_start`, `agent_start`, `message_start/update/end`,
  `turn_start/end`, `tool_execution_*`, `command_result`, `extension_ui_request/resolved`,
  `session_status`, `session_compact(_failed)`, `session_shutdown`, `agent_end/settled`.
  Zero handling of `custom`/`custom_message`/`entry_appended` (verified by grep). The projector
  independently drops non-text message parts (`contentText` text-only). Two blind spots, one fix.
- Partial free ride: the emitter forwards message objects whole (`message_end … as any`), so
  custom-message content may already arrive inside live payloads — the projector discards it.
- pi-intercom: **unverified** as a session-entry producer. Mentions found only in
  `core/cli/src/core/pi-runtime.ts`, `agent-host-origin.ts`, config-injector (transport/config
  level). If it posts session entries, it joins the registry below; if it stays a coordinator
  channel, it renders from its own feed like the Fleet. Do not design until verified.

## 2. Design: customType registry end to end

1. **Emitter (core, M1):** forward `custom`/`custom_message` entries and `entry_appended`
   for them as `extension_message { customType, display?, content?, details?, entryId,
   inContext }`. Bounded like everything else (truncate details at the 64KiB rule);
   unknown customTypes pass through — never drop, render generically.
2. **Projector (app, M1):** map to `ExtensionActivity { customType, payload }`. No
   per-extension branches in the projector — the customType string is the dispatch key.
3. **Renderer registry (app, M2):** the GUI analogue of `registerEntryRenderer`:
   `skill_suggestion → SkillSuggestCard`, `substrate_suggestion → SubstrateSuggestCard`,
   `xtrm_ui_prefs → settings affordance`, fallback `GenericExtensionCard` (shows display/
   truncated details + customType label, so new extensions degrade visibly, never invisibly).
   Registry-first per ADR-001 Decision 6: record the `@agents-ui/@spectrumui/@shadcn`/Base-UI
   search per card before hand-building.
4. **Journal parity:** the history route must include `custom`/`custom_message` entries
   (bounded, same truncation); otherwise history-only Frames lose extension cards the live
   view had. Same registry renders both — one code path, two ingresses.
5. **Redaction:** follow the `forensic-renderer.ts` precedent (specialists repo): a pure
   event→row mapper with an allowlist (`pickAllowedLabels`), shared by CLI and GUI
   consumers; raw prompts/credentials/model output never reach the row. Extension card
   mappers obey the same contract.

## 3. Native specialists: Fleet entities, not subagent threads

T3 renders subagents as nested transcript task items (`emitSubagentTasks`,
`adapter.ts:1171`; capabilities: observed best-effort, `exposesSubagentThreadIds: false`,
no wait/close). **Do not copy this.** XTRM specialists (`~/dev/specialists`) already have
the right primitives:

- `src/activation/native-host.ts` (in-process Pi `AgentSession` per activation),
  `interaction.ts` (asks), `registry.ts` (`FleetRegistry`, resumable/retryable states),
  `settlement-*.ts` (result + receipt + provenance to the Substrate issue).
- `src/specialist/timeline-events.ts` — canonical RPC-grounded feed event model.
- `src/specialist/forensic-renderer.ts` — pure `ForensicEvent → RenderedRow`, consumed by
  both `sp log` and the console FeedView, with a redaction contract. **This is the pattern
  to extend to the GUI**, per the adoption-audit rule (reuse infrastructure, own identity).

Rendering rules:

- A specialist activation renders as a **SpecialistCard bound to the Fleet activation id**:
  role, issue/work ref, state (running/waiting-on-ask/settled/failed), compact result
  summary, receipt/provenance link. Data comes from the Fleet projection + timeline events,
  never scraped from transcript text.
- The dispatching Frame shows a `coordination` activity ("Dispatched \<role\> · \<work\>",
  transport on expand — already the accepted pattern) **linked by activation id** to the
  card, in the fleet view or drawer. No nested fake transcript.
- Asks (`interaction.ts`) surface through the same interactive-request channel as
  `extension_ui_request` (PromptActivity), attributed to the activation, answerable with
  provenance recorded — never as free text in the parent session.
- Specialist definitions themselves stay schema-driven (`schema.ts`, resolved-config view,
  least-capability models) per the using-specialists authoring doctrine; the GUI may browse
  the catalog but must not fork definition semantics into view code.

## 4. Backlog additions (append to `migration.md` list on filing)

## 5. High-volume extensions (background tasks and friends): a second lane

No `background-tasks` extension exists today (only passing mentions in `xtrm-ui` and
`substrate-suggest`); Pi docs define no background-task primitive either — lifecycle
guidance only (`extensions.md:222`). But the question stands for any chatty extension
(long-running tools, task runners, progress streams). Answer: **not the card lane.**

- **Cards (`extension_message`) are discrete, bounded, persisted artifacts.** A card per
  tick would bloat the session journal and — worse for `sendMessage`-style cards — the
  LLM context itself. Never emit per-tick custom messages.
- **Streams ride id-keyed update events**, the established `tool_execution_update`
  pattern: the emitter already forwards `{toolCallId, partialResult}` (`toolPayload`,
  `xtrm-agent-host/index.ts:504`), the GUI maps it to in-place `tool_updated` on one
  activity row. A background-task extension gets `task_started/task_progress/task_finished`
  shaped the same way (task id ≈ toolCallId), rendered as one progress row under a
  background-task origin class. The customType registry still picks the *row* component —
  same recognition, different transport.
- **Persist summaries, not ticks.** Journal start/end + final result only; progress is
  ephemeral/best-effort like tool updates. Precedent: specialists'
  `live-aggregates.ts` — pure, bounded scalar rollups (counts, tokens, max context) over
  the full job set, one row per call — for the live view, with durable truth kept
  elsewhere. Completion may write one summary card so history shows the outcome.
- Rule of thumb: fewer than ~1 event per turn and worth re-reading later → card lane;
  continuous progress during a turn → stream lane with a summary card at close.

## 6. Coordination tools (first-party post-M1; research used the retired third-party set): render the data, never their UI

> Outcome (M1, CORE-2443, 2026-10-17): `pi-background-tasks`, `pi-intercom` and `pi-claude-link` are retired and no longer installed; the first-party `SendMessage`/`ListAgents`/`BashBackground`/`Monitor` tools replace them. The rendering rules below now apply to the first-party tools; the package names above are the pre-decision research record.

These are installed, not owned — verified on disk: `pi-background-tasks` (ISC) at
`~/.bun/.../pi-background-tasks`, plus the `pi-intercom` / `pi-claude-link` skills. They
reach the transcript through different channels, and only some are portable:

- **Tool-form** (intercom `send/ask`, claude-link `list/send/ask`): ordinary tool calls.
  Generic `ToolActivity` already renders them by toolName/args/result — no customType
  needed. Required addition: **provenance attribution**. Peer messages are explicitly
  untrusted input (claude-link skill guidance), so they render as peer-attributed
  content, never as principal/user content, and must never satisfy an approval prompt.
- **Custom entries with foreign customTypes**: covered by the §2 generic fallback card.
  Their `registerEntryRenderer` code cannot run in the GUI (pi-tui widgets vs React) —
  curated adapters only for extensions worth it, fallback for the rest.
- **TUI manager views are not portable.** `background-tasks-manager.js` (29KB) polls local
  task files every second (`STATUS_INTERVAL_MS=1000`, 128KiB tail, ANSI drawing) — a
  terminal UI over local files. The GUI equivalent is never "run their renderer": it is
  a **host-side reader over the same underlying data** (task list + tails) with an
  XTRM-native surface — the exact pattern of the topology consumer and Sessions
  navigator. The GUI reads subscribed host data; it never reads another machine's files
  (remote-boundary rule already adopted in `decision.md` §5).
- License check per extension before vendoring anything (pi-background-tasks is ISC —
  permissive; verify each of the others the same way, not by assumption).

Backlog additions: 27. Peer-attribution rendering + approval-exclusion rule for
tool-form peer messages (M2). 28. Host-side background-task reader + native surface
(M3, alongside the topology consumer — same shape). 29. Per-extension license sweep
before any curated adapter (M2, with each card).

21. Emitter `extension_message` payload + bounds (M1). 22. Projector `ExtensionActivity` +
    history-route custom entries (M1). 23. Renderer registry + first two cards (M2).
24. Verify pi-intercom entry production, then route or feed-render (M2). 25. SpecialistCard
    from Fleet projection + activation-id link from coordination activity (M2/M3).
26. Interactive asks from activations via the prompt channel with provenance (M3).
