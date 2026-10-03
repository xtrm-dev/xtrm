import { BusyError } from "./types.ts";
import type {
  Activity,
  AgentAdapter,
  AgentRef,
  ContextReference,
  AgentSessionDetail,
  AgentSessionSummary,
  InteractionFrame,
  RefCandidate,
  SubmitInput,
  ToolActivity,
} from "./types.ts";

const MIN = 60_000;
const HOUR = 60 * MIN;

type Seed = Omit<AgentSessionDetail, "frameCount" | "childCount" | "title"> & { title?: string };

function tool(id: string, cls: ToolActivity["class"], name: string, subject: string, extra: Partial<ToolActivity> = {}): ToolActivity {
  return { kind: "tool", id, class: cls, name, subject, status: "done", durationMs: 400, origin: {}, ...extra };
}

function frame(id: string, index: number, title: string, at: number, text: string, activity: Activity[], response: string | null, extra: Partial<InteractionFrame> = {}): InteractionFrame {
  return { id, index, title, status: "settled", ingress: { text, origin: "gui", refs: [], at }, activity, response, startedAt: at, settledAt: at + 3 * MIN, ...extra };
}

function seed(now: number): Seed[] {
  const t = (minsAgo: number) => now - minsAgo * MIN;
  return [
    {
      id: "pi-main",
      name: "pi-main",
      provider: "pi",
      state: "working",
      role: "coordinator",
      workRef: "XTRM-310",
      repo: "xtrm-dev/xtrm",
      model: "anthropic/claude-opus-5-5",
      thinking: "high",
      context: { used: 128_400, window: 200_000 },
      startedAt: t(96),
      lastActivityAt: t(0.2),
      parentId: null,
      capabilities: ["prompt", "steer", "abort"],
      origin: "terminal",
      cwd: "~/dev/xtrm/.xtrm/worktrees/xtrm-xt-pi-7k2m",
      repositoryPath: "~/dev/xtrm",
      worktree: "xtrm-xt-pi-7k2m",
      branch: "feature/XTRM-310-frames",
      tmux: "xtrm-main:%12",
      tokens: { input: 1_284_000, output: 96_200 },
      costUsd: 14.82,
      frames: [
        frame(
          "pi-main-1",
          1,
          "Map the Frame contract against Supernova",
          t(92),
          "Compare our Frame contract with Supernova's turn model and list the mismatches we must decide.",
          [
            tool("a1", "native", "read", "packages/xtrm-app/docs/console-v2-audit-supernova.md", { durationMs: 120, output: "## 3.3 Mismatches with the invariant as worded\n- Supernova groups provider turns per user message…\n- Retries reuse the turn id…" }),
            tool("a2", "native", "read", "packages/xtrm-app/host/frame-projector.ts", { durationMs: 80, output: "export class FrameProjector {\n  private readonly frames = new Map<string, InteractionFrame>();\n  apply(event: AppEvent): InteractionFrame | undefined {" }),
            tool("a3", "native", "grep", "agent_settled", { durationMs: 310, output: "host/providers/pi.ts:8: - agent_settled closes the Frame.\nhost/providers/pi.ts:195: case \"agent_settled\":" }),
            tool("a4", "native", "read", "packages/xtrm-app/docs/xtrm-gui-prd.md", { durationMs: 140, output: "## 3. Core interaction concept: Frame\nA `Frame` represents one human interaction…" }),
          ],
          "Three mismatches need a decision before the tranche:\n\n1. **Settlement.** Supernova closes a turn on `agent_end`; our contract closes on `agent_settled`, so retries stay inside one Frame. Keep ours.\n2. **Provisional ids.** Supernova assigns ids only after the first token. We need a Frame id at submit so the dock can show it immediately.\n3. **Compaction-only units.** A compaction without a prompt has no Frame. I propose a note activity on the next Frame instead of a synthetic Frame.\n\nThe rest of `FrameProjector` maps one-to-one onto the host protocol.",
          { settledAt: t(88) },
        ),
        frame(
          "pi-main-2",
          2,
          "Split the tranche into executable contracts",
          t(64),
          "Split the agent harness tranche into contracts and get a review on the dependency graph.",
          [
            tool("b1", "mcp", "search_issues", "repo:xtrm-dev/xtrm agent host", {
              origin: { server: "github", transport: "stdio" },
              durationMs: 1_140,
              args: { query: "repo:xtrm-dev/xtrm agent host", state: "open", perPage: 10 },
              output: "3 results\n#41 Drawer keyboard trap when maximized\n#38 Tailnet preview breaks HMR\n#36 Agent route placeholder copy",
            }),
            tool("b2", "extension", "plan_check", "agent-harness-tranche.plan.json", {
              origin: { extension: "pi-substrate", version: "0.2.2" },
              durationMs: 820,
              args: { file: ".xtrm/plans/agent-harness-tranche.plan.json" },
              output: "ok · 16 issues · 0 cycles · 72 advisory ownership overlaps",
            }),
            { kind: "coordination", id: "b3", action: "message", peer: "quant-reviewer", summary: "Check the blocks edges: host-core must gate index, launcher and ssh, but not the UI tranche.", status: "done", transport: "pi-intercom · direct message" },
            { kind: "coordination", id: "b4", action: "reply", peer: "quant-reviewer", summary: "Edges are sound. Move frame-rename out of the UI path; it only gates live wiring.", status: "done", transport: "pi-intercom · reply" },
          ],
          "The board is applied: one epic and fifteen children. `quant-reviewer` confirmed the graph after one change — `frame-rename` now gates only the live wiring.\n\nReady now: XTRM-311, XTRM-313. Everything on the host side waits on the protocol contract.",
          { settledAt: t(58) },
        ),
        frame(
          "pi-main-3",
          3,
          "Wire the session sidebar to the host index",
          t(6),
          "Implement the session sidebar against the host index and get the review loop going.",
          [
            tool("c1", "native", "read", "packages/xtrm-app/src/shell/ContextSidebar.tsx", { durationMs: 90, output: "export function ContextSidebar() {\n  const pathname = useRouterState({ select: (s) => s.location.pathname });" }),
            tool("c2", "native", "edit", "packages/xtrm-app/src/agent/AgentSidebar.tsx", { durationMs: 210, output: "+ export function AgentSidebar() {\n+   const sessions = useAgentSessions();\n+   …" }),
            tool("c3", "native", "bash", "npm run typecheck", { durationMs: 6_400, output: "> tsc --noEmit\n(no output)" }),
            { kind: "coordination", id: "c4", action: "dispatch", peer: "test-engineer", summary: "Playwright coverage for session switching and restored view state", workRef: "XTRM-313", status: "running", progress: { done: 7, total: 12 }, transport: "specialists · executor activation sp-41c2" },
            { kind: "coordination", id: "c5", action: "review", peer: "quant-reviewer", summary: "Review the sidebar row anatomy against PRD §36.3", workRef: "XTRM-312", status: "waiting", transport: "specialists · reviewer activation sp-41c3" },
            tool("c6", "native", "bash", "npm test -- agent", { status: "running", durationMs: null }),
          ],
          null,
          { status: "working", settledAt: null, ingress: { text: "Implement the session sidebar against the host index and get the review loop going.", origin: "terminal", refs: [{ kind: "issue", ref: "XTRM-310" }, { kind: "file", ref: "packages/xtrm-app/src/shell/ContextSidebar.tsx" }], at: t(6) } },
        ),
      ],
    },
    {
      id: "quant-reviewer",
      name: "quant-reviewer",
      provider: "pi",
      state: "waiting",
      role: "reviewer",
      workRef: "XTRM-312",
      repo: "xtrm-dev/xtrm",
      model: "openrouter/z-ai/glm-5",
      thinking: "medium",
      context: { used: 41_000, window: 4_100_000 },
      // 1% share: a whole-percent round shows what a large-context model reports (XTRM-612),
      startedAt: t(70),
      lastActivityAt: t(1),
      parentId: "pi-main",
      capabilities: ["prompt", "steer", "abort"],
      origin: "gui",
      cwd: "~/dev/xtrm/.xtrm/worktrees/xtrm-xt-pi-7k2m",
      repositoryPath: "~/dev/xtrm",
      worktree: "xtrm-xt-pi-7k2m",
      branch: "feature/XTRM-310-frames",
      tmux: "xtrm-main:%14",
      tokens: { input: 212_000, output: 18_400 },
      costUsd: 1.94,
      frames: [
        frame(
          "qr-1",
          1,
          "Review the sidebar row anatomy",
          t(4),
          "Review the sidebar row anatomy against PRD §36.3 and push the fixups.",
          [
            tool("q1", "native", "read", "packages/xtrm-app/docs/xtrm-gui-prd.md", { durationMs: 70, output: "### 36.3 Session sidebar…" }),
            tool("q2", "native", "bash", "git diff --stat main", { durationMs: 180, output: " packages/xtrm-app/src/agent/AgentSidebar.tsx | 214 +++++\n 1 file changed, 214 insertions(+)" }),
            tool("q3", "extension", "guardrails_check", "git push origin feature/XTRM-312", {
              origin: { extension: "pi-guardrails", version: "0.4.1" },
              status: "running",
              durationMs: null,
              args: { command: "git push origin feature/XTRM-312", policy: "push-requires-confirmation" },
              ui: { type: "confirm", prompt: "Allow `git push origin feature/XTRM-312`?", options: ["Allow", "Deny"], answer: null },
            }),
          ],
          null,
          { status: "working", settledAt: null },
        ),
      ],
    },
    {
      id: "test-engineer",
      name: "test-engineer",
      provider: "pi",
      state: "settled",
      role: "executor",
      workRef: "XTRM-313",
      repo: "xtrm-dev/xtrm",
      model: "anthropic/claude-sonnet-5-5",
      thinking: "low",
      context: { used: 22_800, window: 200_000 },
      startedAt: t(40),
      lastActivityAt: t(12),
      parentId: "pi-main",
      capabilities: ["prompt", "steer", "abort"],
      origin: "gui",
      cwd: "~/dev/xtrm/.xtrm/worktrees/xtrm-xt-pi-7k2m",
      repositoryPath: "~/dev/xtrm",
      worktree: "xtrm-xt-pi-7k2m",
      branch: "feature/XTRM-310-frames",
      tmux: "xtrm-main:%15",
      tokens: { input: 98_000, output: 7_900 },
      costUsd: 0.71,
      frames: [
        frame(
          "te-1",
          1,
          "Add Playwright coverage for session switching",
          t(38),
          "Add Playwright coverage for session switching with restored view state.",
          [
            tool("t1", "native", "write", "packages/xtrm-app/e2e/agent.spec.ts", { durationMs: 60, output: "+ test('session switch restores the draft', async ({ page }) => {" }),
            tool("t2", "native", "bash", "npx playwright test e2e/agent.spec.ts", { durationMs: 21_300, output: "Running 7 tests using 2 workers\n  7 passed (21.3s)" }),
          ],
          "Seven tests pass. Remaining: the four tool classes and the drawer attach flow.",
          { settledAt: t(12) },
        ),
      ],
    },
    {
      id: "claude-ui",
      name: "claude-ui",
      provider: "claude",
      state: "working",
      role: "executor",
      workRef: "XTRM-301",
      repo: "xtrm-dev/xtrm",
      model: "anthropic/claude-opus-5-5",
      thinking: null,
      context: null,
      startedAt: t(30),
      lastActivityAt: t(0.5),
      parentId: null,
      capabilities: ["presence"],
      origin: "terminal",
      cwd: "~/dev/xtrm/.xtrm/worktrees/xtrm-xt-claude-o8h2",
      repositoryPath: "~/dev/xtrm",
      worktree: "xtrm-xt-claude-o8h2",
      branch: "xt/o8h2",
      tmux: "claude-o8h2:%3",
      tokens: null,
      costUsd: null,
      frames: [
        frame(
          "cu-1",
          1,
          "Rail keyboard model v2",
          t(9),
          "Rework the rail keyboard model for the Console/Agent switch.",
          [
            tool("u1", "native", "Read", "packages/xtrm-app/src/shell/AppShell.tsx", { durationMs: 40 }),
            tool("u2", "native", "Edit", "packages/xtrm-app/src/shell/AppShell.tsx", { durationMs: 70 }),
            tool("u3", "mcp", "impact", "ModeRail", { origin: { server: "gitnexus", transport: "stdio" }, durationMs: 940, args: { target: "ModeRail", direction: "upstream" }, output: "risk LOW · 1 direct caller" }),
          ],
          null,
          { status: "working", settledAt: null, ingress: { text: "Rework the rail keyboard model for the Console/Agent switch.", origin: "terminal", refs: [], at: t(9) } },
        ),
      ],
    },
    {
      id: "docs-sweep",
      name: "docs-sweep",
      provider: "pi",
      state: "history",
      role: null,
      workRef: "XTRM-307",
      repo: "xtrm-dev/xtrm",
      model: "anthropic/claude-haiku-4-5",
      thinking: null,
      context: { used: 61_000, window: 200_000 },
      startedAt: t(3 * 24 * 60),
      lastActivityAt: t(3 * 24 * 60 - 25),
      parentId: null,
      capabilities: [],
      origin: "terminal",
      cwd: "~/dev/xtrm",
      repositoryPath: "~/dev/xtrm",
      worktree: null,
      branch: "main",
      tmux: null,
      tokens: { input: 310_000, output: 22_000 },
      costUsd: 0.38,
      frames: [
        frame(
          "ds-1",
          1,
          "Refresh the Console v2 documentation baseline",
          t(3 * 24 * 60),
          "Refresh the documentation baseline after the shell revision.",
          [tool("d1", "native", "read", "packages/xtrm-app/docs/README.md", { durationMs: 50 }), tool("d2", "native", "edit", "packages/xtrm-app/docs/README.md", { durationMs: 90 })],
          "Updated the index and removed two stale links.",
          { settledAt: t(3 * 24 * 60 - 25) },
        ),
      ],
    },
    {
      id: "host-core",
      name: "host-core",
      provider: "pi",
      state: "settled",
      role: "executor",
      workRef: null,
      repo: "xtrm-dev/core",
      model: "anthropic/claude-opus-5-5",
      thinking: "high",
      context: { used: 88_000, window: 200_000 },
      startedAt: t(3 * 60),
      lastActivityAt: t(2 * 60),
      parentId: null,
      capabilities: ["prompt", "steer", "abort"],
      origin: "terminal",
      cwd: "~/dev/core",
      repositoryPath: "~/dev/core",
      worktree: null,
      branch: "feat/xt-host",
      tmux: "core:%2",
      tokens: { input: 402_000, output: 31_000 },
      costUsd: 4.1,
      frames: [frame("hc-1", 1, "Sketch the xt host registry", t(3 * 60), "Sketch the xt host registry module.", [tool("h1", "native", "write", "src/host/registry.ts", { durationMs: 110 })], "Registry sketch committed on feat/xt-host.", { settledAt: t(2 * 60) })],
    },
    {
      id: "scratch",
      name: "scratch",
      provider: "pi",
      state: "history",
      role: null,
      workRef: null,
      repo: null,
      model: "anthropic/claude-haiku-4-5",
      thinking: null,
      context: { used: 4_000, window: 200_000 },
      startedAt: t(5 * HOUR / MIN),
      lastActivityAt: t(5 * HOUR / MIN - 4),
      parentId: null,
      capabilities: [],
      origin: "terminal",
      cwd: "~/tmp",
      repositoryPath: null,
      worktree: null,
      branch: null,
      tmux: null,
      tokens: null,
      costUsd: null,
      frames: [frame("sc-1", 1, "Quick jq question", t(5 * HOUR / MIN), "How do I flatten nested arrays with jq?", [], "Use `flatten`, or `[.. | scalars]` for every leaf value.")],
    },
  ];
}

const COMMITS: RefCandidate[] = [
  { kind: "commit", ref: "c874ca2", title: "docs(xtrm-app): accept PRD §35/§36 Agent mode and record harness decisions (XTRM-558)", preview: " packages/xtrm-app/docs/xtrm-gui-prd.md | 248 ++++++++++-\n 1 file changed" },
  { kind: "commit", ref: "0991ae2", title: "docs(xtrm-app): propose PRD §35 — agent hosting, external sessions, remote access (#260)", preview: " packages/xtrm-app/docs/xtrm-gui-prd.md | 104 +++++\n 1 file changed" },
  { kind: "commit", ref: "ed68bcf", title: "chore(release): @jaggerxtrm/substrate 0.2.2 (#255)", preview: " packages/substrate/package.json | 2 +-\n packages/substrate/CHANGELOG.md | 9 +++" },
  { kind: "commit", ref: "fef8541", title: "fix(substrate): read closure evidence refs back from issue show and provenance trace", preview: " packages/substrate/src/service/issue-service.ts | 41 ++++--" },
  { kind: "commit", ref: "57d3546", title: "fix(xtrm-app): resolve sb without PATH and ship the supervised tailnet deploy", preview: " packages/xtrm-app/server/substrate-cli.ts | 33 +++--\n packages/xtrm-app/deploy/ | 3 files" },
];

const FILES: RefCandidate[] = [
  { kind: "file", ref: "packages/xtrm-app/src/shell/ContextSidebar.tsx", title: "ContextSidebar.tsx", detail: "packages/xtrm-app/src/shell", preview: "export function ContextSidebar() {\n  const pathname = useRouterState({ select: (s) => s.location.pathname });\n  const mode = MODES.find((m) => m.id === modeForPath(pathname))!;" },
  { kind: "file", ref: "packages/xtrm-app/src/shell/AppShell.tsx", title: "AppShell.tsx", detail: "packages/xtrm-app/src/shell", preview: "/** Mode rail: selects the workspace mode; never shows repository state (§3). */\nfunction ModeRail() {" },
  { kind: "file", ref: "packages/xtrm-app/host/providers/pi.ts", title: "pi.ts", detail: "packages/xtrm-app/host/providers", preview: "/**\n * Pi adapter sketch.\n *\n * - agent_end does NOT close the Frame because AgentSession may auto-retry;\n * - agent_settled closes the Frame.\n */" },
  { kind: "file", ref: "packages/xtrm-app/docs/xtrm-gui-prd.md", title: "xtrm-gui-prd.md", detail: "packages/xtrm-app/docs", preview: "# XTRM Agentic Operating Environment PRD\n\n**Status:** Draft v0.3 …" },
  { kind: "file", ref: "packages/substrate/src/domain/contract.ts", title: "contract.ts", detail: "packages/substrate/src/domain", preview: "// Canonical seven-field executable work contract (PRD §11)." },
];

const FIXTURE_RESPONSE =
  "This response comes from the typed fixture. When the agent host is wired (XTRM-572), the provider's streamed output and real tool activity appear here.";

const clone = <T,>(v: T): T => structuredClone(v);

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The Frame keeps the revision each reference had at submit (PRD §36.6 rule 2). */
const withRevisions = (refs: AgentRef[], references: ContextReference[]): AgentRef[] =>
  refs.map((r) => {
    const c = references.find((x) => x.raw === `@${r.kind}:${r.ref}`);
    return c?.revision ? { ...r, revision: c.revision, ...(c.truncated && c.pointer ? { pointer: c.pointer } : {}) } : r;
  });

export function createFixtureAgent({ now = Date.now(), delayMs = 900 }: { now?: number; delayMs?: number } = {}): AgentAdapter {
  const sessions = new Map(seed(now).map((s) => [s.id, s]));
  const listeners = new Set<(id: string) => void>();
  const emit = (id: string) => listeners.forEach((l) => l(id));
  const later = (fn: () => void, ms = delayMs) => setTimeout(fn, ms);

  const summary = (s: Seed): AgentSessionSummary => ({
    id: s.id,
    name: s.name,
    title: s.title ?? s.frames[0]?.title ?? s.name,
    provider: s.provider,
    state: s.state,
    role: s.role,
    workRef: s.workRef,
    repo: s.repo,
    model: s.model,
    thinking: s.thinking,
    context: s.context,
    startedAt: s.startedAt,
    lastActivityAt: s.lastActivityAt,
    parentId: s.parentId,
    childCount: [...sessions.values()].filter((c) => c.parentId === s.id).length,
    frameCount: s.frames.length,
    capabilities: s.capabilities,
    origin: s.origin,
  });

  const settle = (s: Seed, f: InteractionFrame) => {
    f.status = "settled";
    f.settledAt = Date.now();
    f.response = FIXTURE_RESPONSE;
    for (const a of f.activity) if (a.kind === "tool" && a.status === "running" && !a.ui) a.status = "done";
    s.state = "settled";
    s.lastActivityAt = Date.now();
    emit(s.id);
  };

  return {
    source: "fixture",
    async listSessions() {
      return [...sessions.values()].map(summary);
    },
    async getSession(id) {
      const s = sessions.get(id);
      return s ? clone({ ...s, ...summary(s) }) : null;
    },
    async submit(id, input: SubmitInput) {
      const s = sessions.get(id);
      if (!s) throw new Error(`unknown session ${id}`);
      if (!s.capabilities.includes("prompt")) throw new Error("session does not accept prompts");
      const current = s.frames[s.frames.length - 1];
      if (input.mode === "prompt" && current?.status === "working") throw new BusyError();
      if (input.mode !== "prompt") {
        if (!current || current.status !== "working") throw new Error("nothing to steer");
        current.activity.push({ kind: "steer", id: `steer-${Date.now()}`, text: `${input.mode === "steer" ? "Steer" : "Follow-up"}: ${input.text}` });
        emit(id);
        return;
      }
      const at = Date.now();
      const f: InteractionFrame = {
        id: `${id}-${s.frames.length + 1}`,
        index: s.frames.length + 1,
        title: input.text.split("\n")[0]!.slice(0, 72),
        status: "working",
        ingress: { text: input.text, origin: "gui", refs: withRevisions(input.refs, input.references), at },
        activity: [],
        response: null,
        startedAt: at,
        settledAt: null,
      };
      s.frames.push(f);
      s.state = "working";
      s.lastActivityAt = at;
      emit(id);
      later(() => {
        const first = input.refs.find((r) => r.kind === "file")?.ref ?? "packages/xtrm-app/docs/xtrm-gui-prd.md";
        f.activity.push(tool(`${f.id}-r`, "native", "read", first, { durationMs: 120 }));
        emit(id);
        later(() => settle(s, f));
      });
    },
    async launch(input) {
      if (!input.cwd.startsWith("/") && !input.cwd.startsWith("~")) throw new Error(`cwd ${input.cwd} is not an absolute path`);
      const name = input.name?.trim() || `pi-${Math.random().toString(16).slice(2, 8)}`;
      const at = Date.now();
      later(() => {
        sessions.set(name, {
          id: name,
          name,
          provider: "pi",
          state: "settled",
          role: input.command === "xt pi" ? input.role?.trim() || null : null,
          workRef: input.command === "xt pi" ? input.bead?.trim() || null : null,
          repo: "xtrm-dev/xtrm",
          model: input.model?.trim() || "opencode-go/deepseek-v4.1-flash",
          thinking: "medium",
          context: null,
          startedAt: at,
          lastActivityAt: at,
          parentId: null,
          capabilities: ["prompt", "steer", "abort"],
          origin: "gui",
          cwd: input.cwd,
          repositoryPath: null,
          worktree: null,
          branch: null,
          tmux: `${name}:%1`,
          tokens: null,
          costUsd: null,
          frames: [],
        });
        emit(name);
      });
      return { tmuxSession: name };
    },
    async abort(id) {
      const s = sessions.get(id);
      const f = s?.frames[s.frames.length - 1];
      if (!s || !f || f.status !== "working") throw new Error("nothing to abort");
      f.status = "aborted";
      f.settledAt = Date.now();
      for (const a of f.activity) if (a.kind === "tool" && a.status === "running") a.status = "error";
      s.state = "settled";
      s.lastActivityAt = Date.now();
      emit(id);
    },
    async respond(id, activityId, answer) {
      const s = sessions.get(id);
      const f = s?.frames[s.frames.length - 1];
      const a = f?.activity.find((x) => x.id === activityId);
      if (!s || !f || !a || a.kind !== "tool" || !a.ui) throw new Error("no pending request");
      a.ui.answer = answer ?? "Cancelled";
      a.ui.resolved = { by: "host", outcome: answer === null ? "cancelled" : "answered" };
      a.status = answer === null || answer === "Deny" ? "error" : "done";
      a.durationMs = 2_000;
      s.state = "working";
      emit(id);
      later(() => settle(s, f));
    },
    async searchReferences(query, kind, repo) {
      const q = query.toLowerCase();
      const hit = (c: RefCandidate) => !q || c.ref.toLowerCase().includes(q) || c.title.toLowerCase().includes(q);
      if (kind === "commit") return COMMITS.filter(hit);
      if (kind === "file") return FILES.filter(hit);
      return [...sessions.values()]
        .filter((s) => s.repo === repo)
        .map((s): RefCandidate => ({ kind: "session", ref: s.id, title: summary(s).title, detail: [s.role, s.state].filter(Boolean).join(" · ") }))
        .filter(hit);
    },
    async resolveReferences(sessionId, refs) {
      const out: ContextReference[] = [];
      for (const ref of refs) {
        const raw = `@${ref.kind}:${ref.ref}`;
        const fail = (error: string): ContextReference => ({ kind: ref.kind, raw, status: "unresolved", error });
        const ok = (title: string, revision: string, content: string, budget: number): ContextReference => ({
          kind: ref.kind,
          raw,
          status: "resolved",
          title,
          revision,
          content,
          bytes: new TextEncoder().encode(content).length,
          budgetBytes: budget,
          truncated: false,
        });
        if (!sessions.has(sessionId)) out.push(fail("session_not_found"));
        else if (ref.kind === "file") {
          const path = ref.ref.replace(/#L\d+(?:-L?\d+)?$/, "");
          const f = FILES.find((c) => c.ref === path);
          if (path.split("/").includes("..") || path.startsWith("/")) out.push(fail("path_outside_cwd"));
          else if (!f) out.push(fail("file_not_found"));
          else out.push(ok(f.ref, `sha256:${await sha256(f.preview ?? "")}`, f.preview ?? "", 32 * 1024));
        } else if (ref.kind === "commit") {
          const c = COMMITS.find((x) => x.ref === ref.ref || ref.ref.startsWith(x.ref));
          out.push(c ? ok(c.title, c.ref, `${c.title}\n\n${c.preview ?? ""}`, 4 * 1024) : fail("commit_not_found"));
        } else if (ref.kind === "session" || ref.kind === "agent") {
          const s = sessions.get(ref.ref) ?? [...sessions.values()].find((x) => x.name === ref.ref || (ref.kind === "agent" && x.role === ref.ref));
          out.push(s ? ok(s.name, `seq:${s.frames.length}`, `session ${s.id} "${s.name}"\nprovider: ${s.provider}  state: ${s.state}`, 4 * 1024) : fail(ref.kind === "agent" ? "agent_not_live" : "session_not_found"));
        } else if (ref.kind === "frame") {
          const [sid, n] = [ref.ref.slice(0, ref.ref.lastIndexOf("/")), Number(ref.ref.slice(ref.ref.lastIndexOf("/") + 1))];
          const f = sessions.get(sid)?.frames[n - 1];
          out.push(f ? ok(`frame ${n} · ${sid}`, `seq:${n}`, `request:\n${f.ingress.text}\n\nresponse:\n${f.response ?? ""}`, 8 * 1024) : fail("frame_not_found"));
        } else out.push(fail("not_host_resolved"));
      }
      return out;
    },
    async resolveReference(ref: AgentRef) {
      if (ref.kind === "commit") return COMMITS.find((c) => c.ref === ref.ref || ref.ref.startsWith(c.ref)) ?? null;
      if (ref.kind === "file") return FILES.find((c) => c.ref === ref.ref) ?? null;
      if (ref.kind === "session") {
        const s = sessions.get(ref.ref);
        return s ? { kind: "session", ref: s.id, title: summary(s).title, detail: [s.role, s.state].filter(Boolean).join(" · ") } : null;
      }
      return null;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    streamState: () => "connected",
    subscribeStream: () => () => {},
  };
}

export const fixtureAgent: AgentAdapter = createFixtureAgent();
