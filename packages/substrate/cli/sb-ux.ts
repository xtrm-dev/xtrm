#!/usr/bin/env node
// Human presentation entry for sb. Machine semantics stay in sb.ts: --json is
// passed through unchanged, while TTY/plain human output is projected here.

import { runCli, type CliResult } from "./sb.ts";
import {
  feedbackForCommand,
  feedbackForError,
  filterTreeWithAncestors,
  flattenIssueTree,
  renderFeedback,
  renderIssueList,
  renderIssueShow,
  type IssueTreeRow,
  type TerminalStyleOptions,
} from "../src/presentation/terminal.ts";

interface UxOptions {
  isTTY?: boolean;
  width?: number;
  env?: NodeJS.ProcessEnv;
}

interface WrapperArgs {
  base: string[];
  plain: boolean;
  noColor: boolean;
  all: boolean;
  flat: boolean;
  statuses: string[];
  search: string;
}

interface Envelope {
  schema?: string;
  command?: string;
  ok?: boolean;
  data?: unknown;
  error?: string;
}

const READ_ONLY = new Set([
  "issue.show",
  "issue.list",
  "issue.ready",
  "issue.tree",
  "issue.children",
  "issue.validate",
  "issue.resume",
  "project.list",
  "project.show",
  "project.links",
  "journal.show",
  "journal.since",
  "journal.latest",
  "journal.timeline",
  "journal.render",
  "provenance.trace",
  "provenance.commit",
  "provenance.receipt",
  "provenance.pr",
  "doctor",
]);

function commandOf(args: string[]): string {
  const positionals = args.filter((a, i) => {
    if (!a.startsWith("--")) return i === 0 || !args[i - 1]?.startsWith("--");
    return false;
  });
  const first = positionals[0] ?? "";
  const second = positionals[1] ?? "";
  return second ? `${first}.${second}` : first;
}

function parseWrapperArgs(argv: string[]): WrapperArgs {
  const base: string[] = [];
  let plain = false;
  let noColor = false;
  let all = false;
  let flat = false;
  let search = "";
  const statuses: string[] = [];
  const isIssueListLike = argv.includes("issue") && (argv.includes("list") || argv.includes("browse"));

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === "--plain") {
      plain = true;
      continue;
    }
    if (arg === "--no-color") {
      noColor = true;
      continue;
    }
    if (isIssueListLike && arg === "--all") {
      all = true;
      continue;
    }
    if (isIssueListLike && arg === "--flat") {
      flat = true;
      continue;
    }
    if (isIssueListLike && (arg === "--status" || arg === "--search")) {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value`);
      i += 1;
      if (arg === "--status") statuses.push(...value.split(",").map((s) => s.trim()).filter(Boolean));
      else search = value;
      continue;
    }
    if (isIssueListLike && arg.startsWith("--status=")) {
      statuses.push(...arg.slice("--status=".length).split(",").map((s) => s.trim()).filter(Boolean));
      continue;
    }
    if (isIssueListLike && arg.startsWith("--search=")) {
      search = arg.slice("--search=".length);
      continue;
    }
    base.push(arg);
  }
  return { base, plain, noColor, all, flat, statuses, search };
}

function styleOptions(parsed: WrapperArgs, opts: UxOptions = {}): TerminalStyleOptions {
  const env = opts.env ?? process.env;
  const isTTY = opts.isTTY ?? Boolean(process.stdout.isTTY);
  const force = env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== "0";
  const disabled = parsed.plain || parsed.noColor || Boolean(env.NO_COLOR) || env.TERM === "dumb";
  return {
    color: !disabled && (isTTY || force),
    width: opts.width ?? Number(env.COLUMNS ?? process.stdout.columns ?? 100),
  };
}

function withJson(args: string[]): string[] {
  return args.includes("--json") ? args : ["--json", ...args];
}

function parseEnvelope(result: CliResult): Envelope {
  const text = result.stdout.trim();
  if (!text) return { ok: result.code === 0, error: result.stderr.trim() || undefined };
  try {
    return JSON.parse(text) as Envelope;
  } catch {
    return { ok: result.code === 0, data: text, error: result.code === 0 ? undefined : result.stderr.trim() || text };
  }
}

function jsonCall(args: string[]): { result: CliResult; envelope: Envelope } {
  const result = runCli(withJson(args));
  return { result, envelope: parseEnvelope(result) };
}

function errorResult(command: string, message: string, style: TerminalStyleOptions): CliResult {
  const feedback = feedbackForError(command, message);
  return { code: 1, stdout: "", stderr: renderFeedback(feedback, style) };
}

function uxHelp(base: CliResult, argv: string[]): CliResult {
  const suffix = [
    "",
    "human UX:",
    "  --plain / --no-color            disable terminal styling",
    "  sb issue list [--status <s,...>] [--all] [--flat] [--search <q>]",
    "  sb issue browse                 interactive tmux-style issue navigator (TTY only)",
    "",
    "status filters:",
    "  open | in_progress | ready | blocked | deferred | done | cancelled | archived | closed",
  ].join("\n");
  if (argv.includes("--json")) return base;
  return { ...base, stdout: base.stdout.trimEnd() + suffix + "\n" };
}

function derivedFilterRequested(statuses: string[]): boolean {
  return statuses.some((s) => ["in_progress", "ready", "blocked"].includes(s.toLowerCase()));
}

function issueRef(row: IssueTreeRow): string {
  return row.humanRef || row.locator;
}

function enrichRows(rows: IssueTreeRow[], args: string[], statuses: string[]): IssueTreeRow[] {
  if (!derivedFilterRequested(statuses)) return rows;
  return rows.map((row) => {
    const { result, envelope } = jsonCall([...args.filter((a) => a !== "list" && a !== "tree"), "show", issueRef(row)]);
    if (result.code !== 0 || envelope.ok === false || !envelope.data || typeof envelope.data !== "object") return row;
    const data = envelope.data as Record<string, unknown>;
    return {
      ...row,
      readinessState: typeof data.readinessState === "string" ? data.readinessState : row.readinessState,
      dispatchable: typeof data.dispatchable === "boolean" ? data.dispatchable : row.dispatchable,
      claimed: Boolean(data.claim),
    };
  });
}

function listBaseArgs(base: string[]): string[] {
  const out = [...base];
  const idx = out.indexOf("list");
  if (idx >= 0) out[idx] = "tree";
  return out;
}

function renderList(parsed: WrapperArgs, style: TerminalStyleOptions): CliResult {
  const call = jsonCall(listBaseArgs(parsed.base));
  if (call.result.code !== 0 || call.envelope.ok === false) {
    return errorResult("issue.list", call.envelope.error ?? call.result.stderr.trim() || "list failed", style);
  }
  let rows = flattenIssueTree(call.envelope.data);
  rows = enrichRows(rows, parsed.base, parsed.statuses);
  rows = filterTreeWithAncestors(rows, parsed.statuses, parsed.all, parsed.search);
  if (parsed.flat) rows = rows.filter((r) => !r.contextOnly).map((r) => ({ ...r, depth: 0 }));
  return { code: 0, stdout: renderIssueList(rows, style), stderr: "" };
}

function renderShow(parsed: WrapperArgs, style: TerminalStyleOptions): CliResult {
  const call = jsonCall(parsed.base);
  if (call.result.code !== 0 || call.envelope.ok === false || !call.envelope.data || typeof call.envelope.data !== "object") {
    return errorResult("issue.show", call.envelope.error ?? call.result.stderr.trim() || "show failed", style);
  }
  return { code: 0, stdout: renderIssueShow(call.envelope.data as Record<string, unknown>, style), stderr: "" };
}

function mutationResult(parsed: WrapperArgs, style: TerminalStyleOptions): CliResult {
  const command = commandOf(parsed.base);
  const call = jsonCall(parsed.base);
  if (call.result.code !== 0 || call.envelope.ok === false) {
    return errorResult(command, call.envelope.error ?? call.result.stderr.trim() || "operation failed", style);
  }
  const data = call.envelope.data && typeof call.envelope.data === "object" && !Array.isArray(call.envelope.data)
    ? call.envelope.data as Record<string, unknown>
    : { value: call.envelope.data };
  return { code: 0, stdout: renderFeedback(feedbackForCommand(command, parsed.base, data), style), stderr: "" };
}

function collapsedVisible(rows: IssueTreeRow[], collapsed: Set<string>): IssueTreeRow[] {
  const out: IssueTreeRow[] = [];
  const hiddenDepths: number[] = [];
  for (const row of rows) {
    while (hiddenDepths.length > 0 && row.depth <= hiddenDepths[hiddenDepths.length - 1]!) hiddenDepths.pop();
    if (hiddenDepths.length > 0) continue;
    out.push(row);
    if (collapsed.has(row.humanRef)) hiddenDepths.push(row.depth);
  }
  return out;
}

async function browse(parsed: WrapperArgs, style: TerminalStyleOptions, opts: UxOptions): Promise<CliResult> {
  const isTTY = opts.isTTY ?? Boolean(process.stdin.isTTY && process.stdout.isTTY);
  if (!isTTY || typeof process.stdin.setRawMode !== "function") {
    return errorResult("issue.browse", "interactive browser requires a TTY; use `sb issue list` for non-interactive output", style);
  }
  const treeCall = jsonCall(listBaseArgs(parsed.base.map((a) => a === "browse" ? "list" : a)));
  if (treeCall.result.code !== 0 || treeCall.envelope.ok === false) {
    return errorResult("issue.browse", treeCall.envelope.error ?? "cannot load issue tree", style);
  }
  const allRows = flattenIssueTree(treeCall.envelope.data);
  let mode: "active" | "all" | "closed" = parsed.all ? "all" : "active";
  let query = parsed.search;
  let selectedIndex = 0;
  let searchMode = false;
  let expandedPreview = false;
  const collapsed = new Set<string>();

  const filtered = (): IssueTreeRow[] => {
    const statuses = mode === "closed" ? ["closed"] : parsed.statuses;
    const baseRows = filterTreeWithAncestors(allRows, statuses, mode === "all", query);
    return collapsedVisible(baseRows, collapsed);
  };

  const draw = (): void => {
    const rows = filtered();
    if (selectedIndex >= rows.length) selectedIndex = Math.max(0, rows.length - 1);
    const withSelection = rows.map((r, i) => ({ ...r, selected: i === selectedIndex }));
    const selectedRow = rows[selectedIndex];
    let preview = "";
    if (selectedRow) {
      const show = jsonCall(["issue", "show", selectedRow.humanRef]);
      if (show.envelope.data && typeof show.envelope.data === "object") {
        const rendered = renderIssueShow(show.envelope.data as Record<string, unknown>, { ...style, width: style.width ?? 100 });
        preview = rendered.split("\n").slice(0, expandedPreview ? 24 : 9).join("\n");
      }
    }
    const header = `Substrate · issues · ${mode}${query ? ` · /${query}` : ""}`;
    const list = renderIssueList(withSelection, style).trimEnd();
    const hint = searchMode
      ? `search: ${query}▌  Enter apply · Esc cancel`
      : "↑↓/jk move · Enter preview · +/- collapse/expand · / search · f filter · q quit";
    process.stdout.write(`${ESC}H${ESC}2J${header}\n${"─".repeat(Math.min(style.width ?? 100, 100))}\n${list}\n\n${preview}\n${"─".repeat(Math.min(style.width ?? 100, 100))}\n${hint}\n`);
  };

  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdout.write(`${ESC}?1049h${ESC}?25l`);
  draw();

  await new Promise<void>((resolve) => {
    const cleanup = (): void => {
      process.stdin.off("data", onData);
      try { process.stdin.setRawMode(false); } catch { /* already restored */ }
      process.stdin.pause();
      process.stdout.write(`${ESC}?25h${ESC}?1049l`);
      resolve();
    };
    const onData = (chunk: Buffer): void => {
      const key = chunk.toString("utf8");
      if (searchMode) {
        if (key === "\r" || key === "\n") searchMode = false;
        else if (key === "\u001b") searchMode = false;
        else if (key === "\u007f") query = query.slice(0, -1);
        else if (/^[\x20-\x7e]$/.test(key)) query += key;
        selectedIndex = 0;
        draw();
        return;
      }
      if (key === "q" || key === "\u001b" || key === "\u0003") return cleanup();
      const rows = filtered();
      if (key === "j" || key === "\u001b[B") selectedIndex = Math.min(Math.max(0, rows.length - 1), selectedIndex + 1);
      else if (key === "k" || key === "\u001b[A") selectedIndex = Math.max(0, selectedIndex - 1);
      else if (key === "\r" || key === "\n") expandedPreview = !expandedPreview;
      else if (key === "/") { searchMode = true; query = ""; }
      else if (key === "f") { mode = mode === "active" ? "all" : mode === "all" ? "closed" : "active"; selectedIndex = 0; }
      else if (key === "-" && rows[selectedIndex]) collapsed.add(rows[selectedIndex]!.humanRef);
      else if (key === "+" && rows[selectedIndex]) collapsed.delete(rows[selectedIndex]!.humanRef);
      draw();
    };
    process.stdin.on("data", onData);
  });
  return { code: 0, stdout: "", stderr: "" };
}

export async function runUxCli(argv: string[], opts: UxOptions = {}): Promise<CliResult> {
  let parsed: WrapperArgs;
  try {
    parsed = parseWrapperArgs(argv);
  } catch (err) {
    const style = styleOptions({ base: argv, plain: false, noColor: false, all: false, flat: false, statuses: [], search: "" }, opts);
    return errorResult("sb", err instanceof Error ? err.message : String(err), style);
  }

  if (parsed.base.includes("--json")) return runCli(parsed.base);
  const style = styleOptions(parsed, opts);
  const command = commandOf(parsed.base);

  if (parsed.base.includes("--help") || parsed.base[0] === "help") return uxHelp(runCli(parsed.base), parsed.base);
  if (parsed.base[0] === "issue" && parsed.base[1] === "browse") return browse(parsed, style, opts);
  if (command === "issue.list") return renderList(parsed, style);
  if (command === "issue.show") return renderShow(parsed, style);
  if (!READ_ONLY.has(command) && command !== "" && command !== "version" && command !== "help") return mutationResult(parsed, style);

  const result = runCli(parsed.base);
  if (result.code !== 0) return errorResult(command, result.stderr.trim() || result.stdout.trim() || "operation failed", style);
  return result;
}

const invokedPath = process.argv[1] ?? "";
const invokedAsMain = invokedPath.endsWith("sb-ux.ts") || invokedPath.endsWith("sb-ux.js") || invokedPath.endsWith("/sb") || invokedPath === "sb";
if (invokedAsMain) {
  const result = await runUxCli(process.argv.slice(2));
  const ignoreBrokenPipe = (err: Error): void => {
    if ((err as NodeJS.ErrnoException).code !== "EPIPE") throw err;
  };
  process.stdout.on("error", ignoreBrokenPipe);
  process.stderr.on("error", ignoreBrokenPipe);
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exitCode = result.code;
}
