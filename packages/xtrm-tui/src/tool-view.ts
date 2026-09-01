export type ToolViewMode = "compressed" | "normal" | "expanded";

export const TOOL_VIEW_ORDER: readonly ToolViewMode[] = [
  "compressed",
  "normal",
  "expanded",
] as const;

export function nextToolView(mode: ToolViewMode): ToolViewMode {
  const index = TOOL_VIEW_ORDER.indexOf(mode);
  return TOOL_VIEW_ORDER[(index + 1) % TOOL_VIEW_ORDER.length]!;
}

export function previousToolView(mode: ToolViewMode): ToolViewMode {
  const index = TOOL_VIEW_ORDER.indexOf(mode);
  return TOOL_VIEW_ORDER[(index + TOOL_VIEW_ORDER.length - 1) % TOOL_VIEW_ORDER.length]!;
}

export interface ToolRenderSummary {
  toolName: string;
  action: string;
  subject?: string;
  status: "pending" | "success" | "error";
  durationMs?: number;
  countLabel?: string;
  payloadLabel?: string;
  truncationLabel?: string;
  previewLines?: string[];
  expandedLines?: string[];
}

export interface ToolRenderPlan {
  headerOnly: boolean;
  lines: string[];
  showExpandHint: boolean;
}

/**
 * Pure view decision. It must never mutate the tool result.
 */
export function planToolRender(
  mode: ToolViewMode,
  summary: ToolRenderSummary,
): ToolRenderPlan {
  if (mode === "compressed") {
    return {
      headerOnly: true,
      lines: [],
      showExpandHint: Boolean(summary.previewLines?.length || summary.expandedLines?.length),
    };
  }

  if (mode === "normal") {
    return {
      headerOnly: false,
      lines: summary.previewLines ?? [],
      showExpandHint:
        (summary.expandedLines?.length ?? 0) > (summary.previewLines?.length ?? 0),
    };
  }

  return {
    headerOnly: false,
    lines: summary.expandedLines ?? summary.previewLines ?? [],
    showExpandHint: false,
  };
}
