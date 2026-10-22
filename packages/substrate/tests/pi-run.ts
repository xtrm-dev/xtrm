// Test helper: run one shared-surface tool through the Pi adapter wiring
// (piToolContext + toolHandles) against an already-open service bundle.
import { piToolContext, toolHandles, type SessionBindings, type SubstrateServices } from "../integrations/pi/handlers.ts";
import { runTool } from "../integrations/tool-core.ts";
import type { ToolName } from "../integrations/tool-surface.ts";
import type { ExecutionContext } from "../src/domain/execution-context.ts";

export async function runPiTool(
  svc: SubstrateServices,
  name: ToolName,
  args: Record<string, unknown>,
  opts: { bindings?: SessionBindings; sessionId?: string; cwd?: string; executionContext?: ExecutionContext | null } = {},
): Promise<Record<string, any>> {
  const { SessionBindings: Bindings } = await import("../integrations/pi/handlers.ts");
  const context = piToolContext(opts.bindings ?? new Bindings(), opts);
  return (await runTool(name, args, toolHandles(svc), context)) as Record<string, any>;
}
