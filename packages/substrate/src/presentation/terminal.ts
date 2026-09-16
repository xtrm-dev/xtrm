// Terminal-native Substrate presentation primitives.
// Sparse by design: data semantics stay in services/JSON; this module only
// projects them for human TTY/plain surfaces.

import {
  errorFeedback,
  noopFeedback,
  successFeedback,
  warningFeedback,
  type OperationFeedback,
} from "./operation-feedback.ts";

const ESC = "\u001b[";
const RESET = `${ESC}0m`;

export interface TerminalStyleOptions {
  color: boolean;
  width?: number;
}

export interface IssueTreeRow {
  id?: string;
  locator: string;
  humanRef: string;
  title: string;
  kind: string;
  lifecycleState: string;
  revision: number;
  depth: number;
  contextOnly?: boolean;
  readinessState?: string;
  dispatchable?: boolean;
  claimed?: boolean;
  selected?: boolean;
}

function sgr(text: string, code: string, enabled: boolean): string {
  return enabled ? `${ESC}${code}m${text}${RESET}` : text;
}

export function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, "");
}

function bold(text: string, color: boolean): string {
  return sgr(text, "1", color);
}
function dim(text: string, color: boolean): string {
  return sgr(text, "2", color);
}
function yellow(text: string, color: boolean): string {
  return sgr(text, "33", color);
}
function cyan(text: string, color: boolean): string {
  return sgr(text, "36", color);
}
function green(text: string, color: boolean): string {
  return sgr(text, "32", color);
}
function red(text: string, color: boolean): string {
  return sgr(text, "31", color);
}
function selected(text: string, color: boolean): string {
  return color ? `${ESC}30;43m${text}${RESET}` : `> ${text}`;
}

function padRight(text: string, width: number): string {
  const n = stripAnsi(text).length;
  return n >= width ? text : text + " ".repeat(width - n);
}

function truncate(text: string, width: number): string {
  if (width <= 1) return "";
  if (text.length <= width) return text;
  return `${text.slice(0, Math.max(0, width - 1))}…`;
}

function wrapPlain(text: string, width: number): string[] {
  const out: string[] = [];
  for (const raw of text.split("\n")) {
    if (raw.length <= width || raw.trim() === "") {
      out.push(raw);
      continue;
    }
    let rest = raw;
    while (rest.length > width) {
      let cut = rest.lastIndexOf(" ", width);
      if (cut < Math.floor(width * 0.5)) cut = width;
      out.push(rest.slice(0, cut).trimEnd());
      rest = rest.slice(cut).trimStart();
    }
    out.push(rest);
  }
  return out;
}

function inlineMarkdown(line: string, color: boolean): string {
  if (!color) {
    return line
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 <$2>");
  }
  let out = line.replace(/\*\*([^*]+)\*\*/g, (_m, x) => `${ESC}1m${x}${RESET}`);
  out = out.replace(/`([^`]+)`/g, (_m, x) => `${ESC}36m${x}${RESET}`);
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label, url) => `${ESC}36;4m${label}${RESET} ${ESC}2m<${url}>${RESET}`);
  return out;
}

export function renderMarkdown(text: string, opts: TerminalStyleOptions, indent = "  "): string[] {
  const width = Math.max(24, (opts.width ?? 100) - indent.length);
  const lines: string[] = [];
  let inFence = false;
  for (const raw of text.split("\n")) {
    if (raw.trim().startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      lines.push(`${indent}${cyan(raw, opts.color)}`);
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(raw);
    if (heading) {
      lines.push(`${indent}${yellow(bold(heading[2]!, opts.color), opts.color)}`);
      continue;
    }
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(raw);
    if (bullet) {
      const wrapped = wrapPlain(bullet[1]!, Math.max(12, width - 2));
      wrapped.forEach((part, i) => lines.push(`${indent}${i === 0 ? "• " : "  "}${inlineMarkdown(part, opts.color)}`));
      continue;
    }
    const numbered = /^\s*(\d+\.)\s+(.*)$/.exec(raw);
    if (numbered) {
      const prefix = `${numbered[1]} `;
      const wrapped = wrapPlain(numbered[2]!, Math.max(12, width - prefix.length));
      wrapped.forEach((part, i) => lines.push(`${indent}${i === 0 ? prefix : " ".repeat(prefix.length)}${inlineMarkdown(part, opts.color)}`));
      continue;
    }
    for (const part of wrapPlain(raw, width)) lines.push(`${indent}${inlineMarkdown(part, opts.color)}`);
  }
  return lines;
}

function renderContractValue(value: unknown, opts: TerminalStyleOptions): string[] {
  if (typeof value === "string") return renderMarkdown(value, opts);
  if (Array.isArray(value)) {
    return value.flatMap((item) => renderMarkdown(`- ${typeof item === "string" ? item : JSON.stringify(item)}`, opts));
  }
  return renderMarkdown(JSON.stringify(value, null, 2), opts);
}

function formatState(value: string, color: boolean): string {
  const state = value.toLowerCase();
  if (["done", "completed", "ready"].includes(state)) return green(value.toUpperCase(), color);
  if (["blocked", "failed", "cancelled", "error"].includes(state)) return red(value.toUpperCase(), color);
  if (["claimed", "in_progress", "deferred", "warning"].includes(state)) return yellow(value.toUpperCase(), color);
  return cyan(value.toUpperCase(), color);
}

function issueStatus(row: Pick<IssueTreeRow, "lifecycleState" | "readinessState" | "dispatchable" | "claimed">): string {
  if (["done", "cancelled", "archived"].includes(row.lifecycleState)) return row.lifecycleState;
  if (row.lifecycleState === "deferred") return "deferred";
  if (row.claimed) return "in_progress";
  if (row.readinessState === "blocked") return "blocked";
  if (row.dispatchable || row.readinessState === "ready") return "ready";
  return row.lifecycleState;
}

export function renderIssueShow(payload: Record<string, unknown>, opts: TerminalStyleOptions): string {
  const width = Math.max(50, opts.width ?? 100);
  const ref = String(payload.humanRef ?? payload.locator ?? "issue");
  const title = String(payload.title ?? "");
  const headerText = ` ${ref}  ${truncate(title, Math.max(12, width - ref.length - 5))} `;
  const header = opts.color ? selected(padRight(headerText, width), true) : `${ref}  ${title}`;
  const state = String(payload.lifecycleState ?? "unknown");
  const readiness = String(payload.readinessState ?? "unknown");
  const kind = String(payload.kind ?? "issue").toUpperCase();
  const revision = String(payload.revision ?? "?");
  const claim = payload.claim as Record<string, unknown> | null | undefined;
  const claimText = claim ? ` · claim ${String(claim.holder ?? "unknown")}` : "";
  const lines = [
    header,
    `${formatState(state, opts.color)}  ${dim(kind, opts.color)}  ${formatState(readiness, opts.color)}  ${dim(`rev ${revision}${claimText}`, opts.color)}`,
  ];

  const contract = payload.contract;
  if (contract && typeof contract === "object" && !Array.isArray(contract)) {
    const preferred = ["problem", "success", "scope", "nonGoals", "constraints", "validation", "output"];
    const seen = new Set<string>();
    for (const key of [...preferred, ...Object.keys(contract as Record<string, unknown>)]) {
      if (seen.has(key) || (contract as Record<string, unknown>)[key] === undefined) continue;
      seen.add(key);
      const label = key === "nonGoals" ? "NON-GOALS" : key.replace(/([a-z])([A-Z])/g, "$1 $2").toUpperCase();
      lines.push("", yellow(bold(label, opts.color), opts.color));
      lines.push(...renderContractValue((contract as Record<string, unknown>)[key], opts));
    }
  }

  const operational = payload.operationalContext as Record<string, unknown> | undefined;
  const provenance = payload.provenance as Record<string, unknown> | undefined;
  const closure = payload.closure as Record<string, unknown> | null | undefined;
  const summary: string[] = [];
  if (operational) {
    const total = Number(operational.total ?? 0);
    const recent = Array.isArray(operational.recent) ? operational.recent : [];
    const latest = recent[recent.length - 1] as Record<string, unknown> | undefined;
    summary.push(`Journal ${total} entries${latest ? ` · latest ${String(latest.kind)} seq${String(latest.sequence)}` : ""}`);
  }
  if (provenance) summary.push(`Provenance ${String(provenance.eventCount ?? 0)} events${provenance.lastEventType ? ` · ${String(provenance.lastEventType)}` : ""}`);
  if (closure) summary.push(`Closure ${String(closure.outcome ?? closure.terminalState ?? "terminal")} · ${String(closure.reason ?? "")}`.trim());
  if (summary.length > 0) {
    lines.push("", dim("─".repeat(Math.min(width, 72)), opts.color));
    for (const s of summary) lines.push(dim(s, opts.color));
  }
  return lines.join("\n") + "\n";
}

export function flattenIssueTree(data: unknown): IssueTreeRow[] {
  const out: IssueTreeRow[] = [];
  const walk = (node: Record<string, unknown>, depth: number): void => {
    out.push({
      id: typeof node.id === "string" ? node.id : undefined,
      locator: String(node.locator ?? node.humanRef ?? "?"),
      humanRef: String(node.humanRef ?? node.locator ?? "?"),
      title: String(node.title ?? ""),
      kind: String(node.kind ?? "issue"),
      lifecycleState: String(node.lifecycleState ?? "open"),
      revision: Number(node.revision ?? 0),
      depth,
      readinessState: typeof node.readinessState === "string" ? node.readinessState : undefined,
      dispatchable: typeof node.dispatchable === "boolean" ? node.dispatchable : undefined,
      claimed: Boolean(node.claim),
    });
    const children = Array.isArray(node.children) ? node.children : [];
    for (const child of children) walk(child as Record<string, unknown>, depth + 1);
  };
  if (Array.isArray(data)) for (const root of data) walk(root as Record<string, unknown>, 0);
  else if (data && typeof data === "object") walk(data as Record<string, unknown>, 0);
  return out;
}

export function statusMatches(row: IssueTreeRow, requested: string[]): boolean {
  if (requested.length === 0) return row.lifecycleState === "open";
  const current = issueStatus(row);
  return requested.some((raw) => {
    const wanted = raw.trim().toLowerCase();
    if (wanted === "all") return true;
    if (wanted === "closed" || wanted === "terminal") return ["done", "cancelled", "archived"].includes(row.lifecycleState);
    if (wanted === "open") return row.lifecycleState === "open";
    return current === wanted || row.lifecycleState === wanted || row.readinessState === wanted;
  });
}

export function filterTreeWithAncestors(rows: IssueTreeRow[], requested: string[], all: boolean, query = ""): IssueTreeRow[] {
  const lower = query.trim().toLowerCase();
  const matches = rows.map((row) => {
    const stateOk = all ? true : statusMatches(row, requested);
    const queryOk = !lower || `${row.humanRef} ${row.locator} ${row.title} ${row.kind}`.toLowerCase().includes(lower);
    return stateOk && queryOk;
  });
  const keep = new Set<number>();
  for (let i = 0; i < rows.length; i += 1) {
    if (!matches[i]) continue;
    keep.add(i);
    let depth = rows[i]!.depth;
    for (let j = i - 1; j >= 0 && depth > 0; j -= 1) {
      if (rows[j]!.depth === depth - 1) {
        keep.add(j);
        depth -= 1;
      }
    }
  }
  return rows.filter((_r, i) => keep.has(i)).map((r, i) => ({ ...r, contextOnly: !matches[rows.indexOf(r)] }));
}

function epicText(text: string, opts: TerminalStyleOptions): string {
  return opts.color ? `${ESC}1;35m${text}${RESET}` : text;
}

function kindText(kind: string, opts: TerminalStyleOptions): string {
  const upper = kind.toUpperCase();
  if (!opts.color) return upper;
  if (kind === "epic") return `${ESC}1;35m${upper}${RESET}`;
  if (kind === "bug") return `${ESC}31m${upper}${RESET}`;
  if (kind === "research" || kind === "decision") return `${ESC}36m${upper}${RESET}`;
  return dim(upper, true);
}

export function renderIssueList(rows: IssueTreeRow[], opts: TerminalStyleOptions): string {
  if (rows.length === 0) return "(no issues)\n";
  const width = Math.max(48, opts.width ?? 100);
  // One aligned column block: <indent><glyph> <locator>  <KIND>  <title>  <state>.
  // The hierarchical locator is the row id: it carries parentage (XTRM-13.1),
  // which a flat humanRef cannot, and it is a resolvable ref for every verb.
  const idWidth = Math.max(8, ...rows.map((r) => r.locator.length));
  const kindWidth = Math.max(4, ...rows.map((r) => r.kind.length));
  const lines = rows.map((row) => {
    const status = issueStatus(row);
    const isEpic = row.kind === "epic";
    const glyph = isEpic ? "◆"
      : ["done", "archived"].includes(status) ? "✓"
        : status === "cancelled" ? "×"
          : status === "blocked" ? "!"
            : status === "in_progress" ? "●" : "○";
    const indent = "  ".repeat(row.depth);
    const id = padRight(row.locator, idWidth);
    const state = row.contextOnly ? "context" : status;
    const kind = padRight(kindText(row.kind, opts), kindWidth);
    const fixed = indent.length + 2 + idWidth + 2 + kindWidth + 2 + 2 + state.length;
    const available = Math.max(8, width - fixed);
    const title = truncate(row.title, available);
    const head = `${indent}${glyph} ${isEpic ? epicText(id, opts) : id}`;
    const titleCell = isEpic ? bold(title, opts.color) : title;
    let line = `${head}  ${kind}  ${padRight(titleCell, available)}  ${formatState(state, opts.color)}`;
    if (row.contextOnly) line = dim(line, opts.color);
    if (row.selected) line = selected(padRight(stripAnsi(line), width), opts.color);
    return line;
  });
  return lines.join("\n") + "\n";
}

// Accepted --status values, mirroring statusMatches(): lifecycle states,
// derived readiness/claim states, and the terminal aliases.
export const KNOWN_STATUS_FILTERS = [
  "open", "in_progress", "ready", "blocked", "deferred",
  "done", "cancelled", "archived", "closed", "terminal", "all",
] as const;

export function isKnownStatusFilter(value: string): boolean {
  return (KNOWN_STATUS_FILTERS as readonly string[]).includes(value.trim().toLowerCase());
}

// Split one stdin chunk into key events. The browser must apply every
// keystroke in a chunk: fast typing, key repeat and paste deliver several
// events per read, and comparing the whole chunk against one key silently
// drops them. A lone ESC reports "escape"; an arrow sequence split across two
// reads therefore reads as ESC, which is the behavior the browser had before
// chunk tokenization.
export function tokenizeBrowseKeys(chunk: string): string[] {
  const keys: string[] = [];
  for (let i = 0; i < chunk.length;) {
    if (chunk.startsWith("\u001b[A", i)) { keys.push("up"); i += 3; continue; }
    if (chunk.startsWith("\u001b[B", i)) { keys.push("down"); i += 3; continue; }
    const ch = chunk[i]!;
    if (ch === "\r" || ch === "\n") keys.push("enter");
    else if (ch === "\u0003") keys.push("quit");
    else if (ch === "\u007f") keys.push("backspace");
    else if (ch === "\u001b") keys.push("escape");
    else keys.push(ch);
    i += 1;
  }
  return keys;
}

function issueRefFromArgs(args: string[]): string | null {
  const idx = args.findIndex((a) => a === "issue");
  return idx >= 0 && args[idx + 2] ? args[idx + 2]! : null;
}

export function feedbackForCommand(command: string, args: string[], data: Record<string, unknown>): OperationFeedback {
  const ref = String(data.humanRef ?? data.locator ?? issueRefFromArgs(args) ?? data.issueId ?? "issue");
  switch (command) {
    case "issue.create":
      return successFeedback("issue_created", `Created ${ref}${data.kind ? ` [${String(data.kind)}]` : ""}${data.title ? ` · ${String(data.title)}` : ""}`);
    case "issue.edit":
      return successFeedback("issue_updated", `Updated ${ref}`, data.revisionCreated ? "new revision created; readiness must be revalidated" : undefined);
    case "issue.note":
      return successFeedback("journal_written", `Added ${String(data.kind ?? "note")} to ${issueRefFromArgs(args) ?? ref}`, data.sequence ? `journal seq ${String(data.sequence)}` : undefined);
    case "issue.claim":
      return successFeedback("issue_claimed", `Claimed ${issueRefFromArgs(args) ?? ref}`, data.holder ? `holder ${String(data.holder)}` : undefined);
    case "issue.release":
      return data.released === false
        ? noopFeedback("claim_absent", `No live claim was released for ${issueRefFromArgs(args) ?? ref}`)
        : successFeedback("issue_released", `Released ${issueRefFromArgs(args) ?? ref}`);
    case "issue.close":
      return successFeedback("issue_closed", `Closed ${ref}`, data.outcome ? `outcome ${String(data.outcome)}` : undefined);
    case "issue.reopen":
      return successFeedback("issue_reopened", `Reopened ${ref}`);
    case "issue.cancel":
      return successFeedback("issue_cancelled", `Cancelled ${ref}`);
    case "issue.archive":
      return successFeedback("issue_archived", `Archived ${ref}`);
    case "issue.defer":
      return successFeedback("issue_deferred", `Deferred ${ref}`);
    case "issue.relate":
      return successFeedback("issues_linked", "Linked issues", `${String(data.kind ?? "relation")}`);
    case "issue.unrelate":
      return successFeedback("issues_unlinked", "Removed issue relation", `${String(data.kind ?? "relation")}`);
    case "project.repair":
      return data.repaired === false
        ? noopFeedback("project_link_current", "Repository link already correct")
        : successFeedback("project_link_repaired", "Repaired repository link");
    case "plan.apply":
      return successFeedback("plan_applied", "Applied plan");
    case "journal.append":
    case "journal.checkpoint":
      return data.degraded
        ? warningFeedback("journal_degraded", "Checkpoint persisted with degraded semantic enrichment", String(data.reason ?? "mechanical checkpoint is durable"))
        : successFeedback("journal_written", "Journal entry persisted", data.sequence ? `seq ${String(data.sequence)}` : undefined);
    default:
      return successFeedback("operation_completed", `${command.replace(/\./g, " ")} completed`);
  }
}

export function renderFeedback(feedback: OperationFeedback, opts: TerminalStyleOptions): string {
  const glyph = feedback.level === "success" ? "✓" : feedback.level === "noop" ? "○" : feedback.level === "warning" ? "!" : "✗";
  const paint = feedback.level === "success" ? green : feedback.level === "warning" ? yellow : feedback.level === "error" ? red : cyan;
  const lines = [`${paint(glyph, opts.color)} ${feedback.message}`];
  if (feedback.detail) lines.push(`  ${dim(feedback.detail, opts.color)}`);
  if (feedback.hint) lines.push(`  ${dim(`next: ${feedback.hint}`, opts.color)}`);
  return lines.join("\n") + "\n";
}

export function feedbackForError(command: string, message: string): OperationFeedback {
  let hint: string | undefined;
  if (/not initialized|no repository binding|run ['`]?sb init/i.test(message)) hint = "sb init";
  else if (/unknown flag|usage:|required/i.test(message)) hint = `sb help ${command.replace(".", " ")}`;
  else if (/unresolvable ref|unknown ref|no such issue/i.test(message)) hint = "sb issue list --all  (or --search <ref>)";
  else if (/unknown issue verb|unknown group|unknown verb/i.test(message)) hint = "sb help";
  else if (/unknown closure outcome/i.test(message)) hint = "sb help issue close";
  else if (/must be an integer|must be a number/i.test(message)) hint = `sb help ${command.replace(".", " ")}`;
  else if (/claim|holder|activation/i.test(message) && command.startsWith("issue.")) hint = "sb issue show <ref>";
  return errorFeedback("operation_failed", `${command || "sb"} failed`, message, hint, false);
}
