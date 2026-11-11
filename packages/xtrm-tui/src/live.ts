/**
 * Live binding: one AgentSessionRuntime driving the FrameShell.
 *
 * Event law (Pi 1.5.2): `agent_end` is informational (retries/queue may
 * follow); `agent_settled` is the final notification-only boundary and the
 * SOLE frame-close signal. `prompt()` while streaming is rejected by Pi, so
 * the shell only submits new frames when idle.
 */

import {
  SessionManager,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  getAgentDir,
  type AgentSession,
  type AgentSessionEvent,
  type CreateAgentSessionRuntimeFactory,
} from "@earendil-works/pi-coding-agent";
import { FrameShell } from "./shell.js";
import { planToolRender, type ToolRenderSummary } from "./tool-view.js";

export interface LiveJournalEntry {
  frame: number;
  event: string;
  detail?: string;
}

const VERB: Record<string, string> = {
  bash: "Ran",
  read: "Read",
  edit: "Edited",
  write: "Wrote",
  grep: "Searched",
  find: "Found",
  ls: "Listed",
};

function summarizeArgs(args: unknown): string {
  if (typeof args === "string") return args.slice(0, 48);
  if (args && typeof args === "object") {
    const o = args as Record<string, unknown>;
    for (const key of ["command", "path", "file", "pattern", "query", "url"]) {
      const v = o[key];
      if (typeof v === "string" && v) return v.slice(0, 48);
    }
  }
  return "";
}

function compressedRow(toolName: string, subject: string, durationMs?: number, isError?: boolean): string {
  const summary: ToolRenderSummary = {
    toolName,
    action: VERB[toolName] ?? toolName,
    subject: subject || undefined,
    status: isError ? "error" : "success",
    durationMs,
  };
  const plan = planToolRender("compressed", summary);
  // Compressed contract: exactly one physical row, no body.
  if (plan.headerOnly !== true || plan.lines.length !== 0) {
    throw new Error("compressed plan violated: headerOnly must be true with no lines");
  }
  const meta = `${isError ? "error · " : ""}${durationMs != null ? `${(durationMs / 1000).toFixed(1)}s` : ""}`;
  return `• ${summary.action} ${subject}${meta ? `  ${meta}` : ""}`.trimEnd();
}

interface PendingTool {
  toolName: string;
  subject: string;
}

export class LiveBinding {
  private pendingTools = new Map<string, PendingTool>();
  journal: LiveJournalEntry[] = [];
  private settleTransitions = 0;

  constructor(
    private shell: FrameShell,
    private session: () => AgentSession,
    private promptFn: (text: string) => Promise<void>,
  ) {}

  get settleCount(): number {
    return this.settleTransitions;
  }

  handleEvent(event: AgentSessionEvent): void {
    switch (event.type) {
      case "message_update": {
        const m = event.assistantMessageEvent;
        if (m.type === "text_delta") this.shell.appendDelta(m.delta);
        break;
      }
      case "tool_execution_start": {
        const e = event as { toolCallId?: string; toolName?: string; args?: unknown };
        if (e.toolCallId) {
          this.pendingTools.set(e.toolCallId, {
            toolName: e.toolName ?? "tool",
            subject: summarizeArgs(e.args),
          });
        }
        break;
      }
      case "tool_execution_end": {
        const e = event as {
          toolCallId?: string;
          toolName?: string;
          isError?: boolean;
          durationMs?: number;
        };
        let pending: PendingTool = { toolName: e.toolName ?? "tool", subject: "" };
        if (e.toolCallId) {
          const found = this.pendingTools.get(e.toolCallId);
          if (found) pending = found;
          this.pendingTools.delete(e.toolCallId);
        }
        this.shell.appendToolRow(
          compressedRow(pending.toolName, pending.subject, e.durationMs, e.isError),
        );
        this.journal.push({ frame: this.shell.frameCount(), event: "tool_end", detail: pending.toolName });
        break;
      }
      case "agent_end":
        // Informational only: retries or queued work may follow. NEVER settles.
        this.journal.push({
          frame: this.shell.frameCount(),
          event: "agent_end_ignored",
          detail: `willRetry=${(event as { willRetry?: boolean }).willRetry === true}`,
        });
        break;
      // Aborted or clean: settled is settled. The spike intentionally does not
      // distinguish `aborted`; agent_settled is final either way.
      case "agent_settled": {
        if (this.shell.settleFrame()) {
          this.settleTransitions += 1;
          this.journal.push({ frame: this.shell.frameCount(), event: "settled" });
        } else {
          this.journal.push({ frame: this.shell.frameCount(), event: "redundant_settle_ignored" });
        }
        this.shell.setBusy(false);
        break;
      }
      default:
        break;
    }
  }

  /**
   * Idle submit: open exactly one frame and prompt the session.
   * Returns false without opening a frame when the session is streaming
   * (Pi `prompt()` without steering choice would reject; never fabricate a frame).
   */
  async submit(text: string): Promise<boolean> {
    if (this.session().isStreaming) return false;
    this.shell.newFrame(text);
    this.shell.setBusy(true);
    this.journal.push({ frame: this.shell.frameCount(), event: "frame_open", detail: text.slice(0, 80) });
    try {
      await this.promptFn(text);
    } catch (error) {
      this.shell.setBusy(false);
      this.shell.appendDelta(`\nerror: ${String(error)}`);
    }
    return true;
  }

  sessionRef(): AgentSession {
    return this.session();
  }
}

function modelLabel(session: AgentSession): string {
  const m = session.model as unknown as
    | { id?: unknown; modelId?: unknown; name?: unknown }
    | undefined;
  const label = m?.id ?? m?.modelId ?? m?.name;
  return typeof label === "string" && label ? label : "model";
}

export async function createLiveBinding(
  shell: FrameShell,
  cwd: string,
  thinkingLevel?: AgentSession["thinkingLevel"],
): Promise<{ binding: LiveBinding; dispose: () => void }> {
  const createRuntime: CreateAgentSessionRuntimeFactory = async ({
    cwd: runtimeCwd,
    sessionManager,
    sessionStartEvent,
  }) => {
    const services = await createAgentSessionServices({ cwd: runtimeCwd });
    return {
      ...(await createAgentSessionFromServices({
        services,
        sessionManager,
        sessionStartEvent,
        ...(thinkingLevel ? { thinkingLevel } : {}),
      })),
      services,
      diagnostics: services.diagnostics,
    };
  };

  // In-memory session history: the spike must not write session files and the
  // provider session stays authoritative for the live run.
  const runtime = await createAgentSessionRuntime(createRuntime, {
    cwd,
    agentDir: getAgentDir(),
    sessionManager: SessionManager.inMemory(cwd),
  });

  let current = runtime.session;
  await current.bindExtensions({});
  shell.setModelLabel(modelLabel(current));

  const binding = new LiveBinding(
    shell,
    () => current,
    (text) => current.prompt(text),
  );
  const unsubscribe = current.subscribe((event) => binding.handleEvent(event));

  // newSession/switch/fork deferred to a later task; runtime disposal is owned here.
  // Bounded: session_shutdown fan-out has been observed to stall after a live run
  // (open provider keep-alives; root cause open for the product vertical), so a
  // hanging dispose must never block process exit.
  return {
    binding,
    dispose: async () => {
      unsubscribe();
      current.dispose();
      await Promise.race([
        runtime.dispose(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("runtime dispose timeout")), 10_000),
        ),
      ]).catch((error) => {
        console.error(`warning: ${String(error)} — continuing teardown`);
      });
    },
  };
}
