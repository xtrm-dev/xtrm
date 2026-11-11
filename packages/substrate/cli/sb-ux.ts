#!/usr/bin/env node
// Human presentation entry for sb. The typed CLI engine in sb.ts remains the
// machine contract; this wrapper projects it for TTY/plain humans only.

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { CliResult } from "./sb.ts";
import {
  feedbackForCommand,
  feedbackForError,
  filterTreeWithAncestors,
  flattenIssueTree,
  isKnownStatusFilter,
  KNOWN_STATUS_FILTERS,
  renderFeedback,
  renderIssueList,
  renderIssueShow,
  tokenizeBrowseKeys,
  type IssueTreeRow,
  type TerminalStyleOptions,
} from "../src/presentation/terminal.ts";

const originalArgv1 = process.argv[1];
const importingThroughBinAlias = originalArgv1 === "sb" || originalArgv1?.endsWith("/sb") === true;
if (importingThroughBinAlias) process.argv[1] = fileURLToPath(import.meta.url);
const { runCli } = await import("./sb.ts");
if (importingThroughBinAlias) process.argv[1] = originalArgv1;

const ESC = "\u001b[";
const GROUPS = new Set(["init", "issue", "project", "plan", "journal", "provenance", "import", "export", "doctor", "help", "version"]);
const READ_ONLY = new Set([
  "issue.show", "issue.list", "issue.ready", "issue.tree", "issue.children", "issue.validate", "issue.resume",
  "project.list", "project.show", "project.links", "journal.show", "journal.since", "journal.latest", "journal.timeline",
  "journal.render", "provenance.trace", "provenance.commit", "provenance.receipt", "provenance.pr", "doctor", "help", "version",
  // Reads that were routed through the mutation path printed only "✓ … completed" and dropped their data.
  "issue.query", "plan.check", "provenance.session", "provenance.activation",
]);

interface UxOptions { isTTY?: boolean; width?: number; env?: NodeJS.ProcessEnv; }
interface WrapperArgs { base: string[]; plain: boolean; noColor: boolean; all: boolean; flat: boolean; statuses: string[]; search: string; }
interface Envelope { schema?: string; command?: string; ok?: boolean; data?: unknown; error?: string; }

function commandOf(args: string[]): string {
  const index = args.findIndex((arg) => GROUPS.has(arg));
  if (index < 0) return "";
  const group = args[index]!;
  if (["init", "doctor", "help", "version"].includes(group)) return group;
  for (let i = index + 1; i < args.length; i += 1) {
    if (!args[i]!.startsWith("--")) return `${group}.${args[i]}`;
    if (args[i] === "--db" || args[i] === "--project") i += 1;
  }
  return group;
}

function parseWrapperArgs(argv: string[]): WrapperArgs {
  const base: string[] = [];
  let plain = false;
  let noColor = false;
  let all = false;
  let flat = false;
  let search = "";
  const statuses: string[] = [];
  const listLike = argv.includes("issue") && (argv.includes("list") || argv.includes("browse"));
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === "--plain") { plain = true; continue; }
    if (arg === "--no-color") { noColor = true; continue; }
    if (listLike && arg === "--all") { all = true; continue; }
    if (listLike && arg === "--flat") { flat = true; continue; }
    if (listLike && (arg === "--status" || arg === "--search")) {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value`);
      i += 1;
      if (arg === "--status") statuses.push(...value.split(",").map((s) => s.trim()).filter(Boolean));
      else search = value;
      continue;
    }
    if (listLike && arg.startsWith("--status=")) { statuses.push(...arg.slice(9).split(",").map((s) => s.trim()).filter(Boolean)); continue; }
    if (listLike && arg.startsWith("--search=")) { search = arg.slice(9); continue; }
    base.push(arg);
  }
  return { base, plain, noColor, all, flat, statuses, search };
}

function styleOptions(parsed: WrapperArgs, opts: UxOptions = {}): TerminalStyleOptions {
  const env = opts.env ?? process.env;
  const tty = opts.isTTY ?? Boolean(process.stdout.isTTY);
  const force = env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== "0";
  const disabled = parsed.plain || parsed.noColor || Boolean(env.NO_COLOR) || env.TERM === "dumb";
  const widthValue = opts.width ?? Number(env.COLUMNS ?? process.stdout.columns ?? 100);
  return { color: !disabled && (tty || force), width: Number.isFinite(widthValue) ? widthValue : 100 };
}

function humanOnlyFilters(parsed: WrapperArgs): string[] {
  const used: string[] = [];
  if (parsed.all) used.push("--all");
  if (parsed.flat) used.push("--flat");
  if (parsed.statuses.length > 0) used.push("--status");
  if (parsed.search) used.push("--search");
  return used;
}
function withJson(args: string[]): string[] { return args.includes("--json") ? args : ["--json", ...args]; }
function parseEnvelope(result: CliResult): Envelope {
  const text = result.stdout.trim();
  if (!text) return { ok: result.code === 0, error: result.stderr.trim() || undefined };
  try { return JSON.parse(text) as Envelope; }
  catch { return { ok: result.code === 0, data: text, error: result.code === 0 ? undefined : (result.stderr.trim() || text) }; }
}
function jsonCall(args: string[]): { result: CliResult; envelope: Envelope } {
  const result = runCli(withJson(args));
  return { result, envelope: parseEnvelope(result) };
}
function errorResult(command: string, message: string, style: TerminalStyleOptions): CliResult {
  return { code: 1, stdout: "", stderr: renderFeedback(feedbackForError(command, message), style) };
}

function uxHelp(base: CliResult, argv: string[]): CliResult {
  if (argv.includes("--json")) return base;
  const suffix = [
    "", "human UX:",
    "  --plain / --no-color            disable terminal styling",
    "  sb issue show <ref>              Markdown-aware terminal contract + bounded context",
    "  sb issue list [--status <s,...>] [--all] [--flat] [--search <q>]",
    "                                    defaults to the active hierarchical board",
    "  sb issue browse [filters]        interactive tmux-style navigator (TTY only)",
    "", "status filters:",
    "  open | in_progress | ready | blocked | deferred | done | cancelled | archived | closed",
    "  in_progress / ready / blocked are derived views, not stored lifecycle states",
    "", "machine boundary:",
    "  --status/--all/--flat/--search are human presentation filters;",
    "  combining them with --json fails closed instead of returning falsely filtered JSON",
  ].join("\n");
  return { ...base, stdout: `${base.stdout.trimEnd()}\n${suffix}\n` };
}

function browseHelp(): CliResult {
  const stdout = [
    "usage: sb issue browse [--status <s,...>] [--all] [--search <q>] [--plain|--no-color]",
    "",
    "interactive read-first Issue navigator (TTY only). Starts on the active board unless --all is passed.",
    "",
    "keys:",
    "  ↑↓ / j k     move",
    "  Enter        expand/collapse preview",
    "  /            search",
    "  f            cycle active → all → closed",
    "  - / +        collapse / expand children",
    "  q / Ctrl-C   quit and restore terminal state",
    "",
    `status filters: ${KNOWN_STATUS_FILTERS.join(" | ")}`,
  ].join("\n") + "\n";
  return { code: 0, stdout, stderr: "" };
}

// The list and browse renderers call the tree engine, so an engine error names
// the verb the wrapper substituted (`issue.tree`) rather than the one the
// operator typed. This maps it back, using the same token search as
// listEngineArgs so the two cannot disagree about which word was rewritten.
function typedVerbPair(base: string[]): { engine: string; typed: string } | null {
  const verb = ["list", "browse"].find((candidate) => base.includes(candidate));
  if (verb === undefined) return null;
  const index = base.indexOf(verb);
  const group = base.slice(0, index).reverse().find((token) => GROUPS.has(token));
  if (group === undefined) return null;
  return { engine: `${group}.tree`, typed: `${group}.${verb}` };
}

function withTypedVerb(base: string[], message: string): string {
  const pair = typedVerbPair(base);
  if (pair === null) return message;
  return message.split(`\`${pair.engine}\``).join(`\`${pair.typed}\``);
}

function listEngineArgs(base: string[]): string[] {
  const out = [...base];
  const listIndex = out.indexOf("list");
  const browseIndex = out.indexOf("browse");
  if (listIndex >= 0) out[listIndex] = "tree";
  else if (browseIndex >= 0) out[browseIndex] = "tree";
  return out;
}
function showEngineArgs(base: string[], ref: string): string[] {
  const prefix: string[] = [];
  for (let i = 0; i < base.length; i += 1) {
    if (base[i] === "--db" && base[i + 1]) { prefix.push("--db", base[i + 1]!); i += 1; }
  }
  return [...prefix, "issue", "show", ref];
}
function derivedFilterRequested(statuses: string[]): boolean {
  return statuses.some((s) => ["in_progress", "ready", "blocked"].includes(s.toLowerCase()));
}
function enrichRows(rows: IssueTreeRow[], base: string[], statuses: string[]): IssueTreeRow[] {
  if (!derivedFilterRequested(statuses)) return rows;
  return rows.map((row) => {
    const call = jsonCall(showEngineArgs(base, row.humanRef));
    if (call.result.code !== 0 || call.envelope.ok === false || !call.envelope.data || typeof call.envelope.data !== "object") return row;
    const data = call.envelope.data as Record<string, unknown>;
    return {
      ...row,
      readinessState: typeof data.readinessState === "string" ? data.readinessState : row.readinessState,
      dispatchable: typeof data.dispatchable === "boolean" ? data.dispatchable : row.dispatchable,
      claimed: Boolean(data.claim),
    };
  });
}
function filteredRows(parsed: WrapperArgs): { rows: IssueTreeRow[]; error?: string } {
  const call = jsonCall(listEngineArgs(parsed.base));
  if (call.result.code !== 0 || call.envelope.ok === false) {
    const raw = call.envelope.error ?? (call.result.stderr.trim() || "list failed");
    return { rows: [], error: withTypedVerb(parsed.base, raw) };
  }
  let rows = flattenIssueTree(call.envelope.data);
  rows = enrichRows(rows, parsed.base, parsed.statuses);
  rows = filterTreeWithAncestors(rows, parsed.statuses, parsed.all, parsed.search);
  if (parsed.flat) rows = rows.filter((r) => !r.contextOnly).map((r) => ({ ...r, depth: 0 }));
  return { rows };
}
function renderList(parsed: WrapperArgs, style: TerminalStyleOptions): CliResult {
  const filtered = filteredRows(parsed);
  if (filtered.error) return errorResult("issue.list", filtered.error, style);
  return { code: 0, stdout: renderIssueList(filtered.rows, style), stderr: "" };
}
function renderShow(parsed: WrapperArgs, style: TerminalStyleOptions): CliResult {
  const call = jsonCall(parsed.base);
  if (call.result.code !== 0 || call.envelope.ok === false || !call.envelope.data || typeof call.envelope.data !== "object") {
    return errorResult("issue.show", call.envelope.error ?? (call.result.stderr.trim() || "show failed"), style);
  }
  return { code: 0, stdout: renderIssueShow(call.envelope.data as Record<string, unknown>, style), stderr: "" };
}
function mutationResult(parsed: WrapperArgs, style: TerminalStyleOptions): CliResult {
  const command = commandOf(parsed.base);
  const call = jsonCall(parsed.base);
  if (call.result.code !== 0 || call.envelope.ok === false) return errorResult(command, call.envelope.error ?? (call.result.stderr.trim() || "operation failed"), style);
  const data = call.envelope.data && typeof call.envelope.data === "object" && !Array.isArray(call.envelope.data)
    ? call.envelope.data as Record<string, unknown> : { value: call.envelope.data };
  return { code: 0, stdout: renderFeedback(feedbackForCommand(command, parsed.base, data), style), stderr: call.result.stderr };
}
function collapsedVisible(rows: IssueTreeRow[], collapsed: Set<string>): IssueTreeRow[] {
  const out: IssueTreeRow[] = [];
  let hiddenBelow: number | null = null;
  for (const row of rows) {
    if (hiddenBelow !== null && row.depth > hiddenBelow) continue;
    if (hiddenBelow !== null && row.depth <= hiddenBelow) hiddenBelow = null;
    out.push(row);
    if (collapsed.has(row.humanRef)) hiddenBelow = row.depth;
  }
  return out;
}

async function browse(parsed: WrapperArgs, style: TerminalStyleOptions, opts: UxOptions): Promise<CliResult> {
  const tty = opts.isTTY ?? Boolean(process.stdin.isTTY && process.stdout.isTTY);
  if (!tty || typeof process.stdin.setRawMode !== "function") return errorResult("issue.browse", "interactive browser requires a TTY; use `sb issue list` for non-interactive output", style);
  const initial = filteredRows({ ...parsed, all: true, flat: false, statuses: [], search: "" });
  if (initial.error) return errorResult("issue.browse", initial.error, style);
  const sourceRows = enrichRows(initial.rows, parsed.base, parsed.statuses);
  let mode: "active" | "all" | "closed" = parsed.all ? "all" : "active";
  let query = parsed.search;
  let selectedIndex = 0;
  let searchMode = false;
  let expandedPreview = false;
  const collapsed = new Set<string>();
  const currentRows = (): IssueTreeRow[] => {
    const statuses = mode === "closed" ? ["closed"] : parsed.statuses;
    return collapsedVisible(filterTreeWithAncestors(sourceRows, statuses, mode === "all", query), collapsed);
  };
  const draw = (): void => {
    const rows = currentRows();
    selectedIndex = Math.min(selectedIndex, Math.max(0, rows.length - 1));
    const selectedRow = rows[selectedIndex];
    const list = renderIssueList(rows.map((r, i) => ({ ...r, selected: i === selectedIndex })), style).trimEnd();
    let preview = "";
    if (selectedRow) {
      const show = jsonCall(showEngineArgs(parsed.base, selectedRow.humanRef));
      if (show.envelope.data && typeof show.envelope.data === "object") {
        preview = renderIssueShow(show.envelope.data as Record<string, unknown>, style).split("\n").slice(0, expandedPreview ? 24 : 9).join("\n");
      }
    }
    const width = Math.min(style.width ?? 100, 120);
    const header = `Substrate · issues · ${mode}${query ? ` · /${query}` : ""}`;
    const hint = searchMode ? `search: ${query}▌  Enter apply · Esc cancel` : "↑↓/jk move · Enter preview · +/- collapse/expand · / search · f filter · q/Ctrl-C quit";
    process.stdout.write(`${ESC}H${ESC}2J${header}\n${"─".repeat(width)}\n${list}\n\n${preview}\n${"─".repeat(width)}\n${hint}\n`);
  };
  process.stdin.setRawMode(true);
  process.stdin.resume();
  const done = new Promise<void>((resolve) => {
    const quit = (): void => { process.stdin.off("data", onData); resolve(); };
    const onData = (chunk: Buffer): void => {
      let redraw = false;
      for (const key of tokenizeBrowseKeys(chunk.toString("utf8"))) {
        if (key === "quit") { quit(); return; }
        const rows = currentRows();
        if (searchMode) {
          if (key === "enter" || key === "escape") searchMode = false;
          else if (key === "backspace") query = query.slice(0, -1);
          else if (/^[\x20-\x7e]$/.test(key)) query += key;
          selectedIndex = 0; redraw = true; continue;
        }
        if (key === "escape" || key === "q") { quit(); return; }
        if (key === "down" || key === "j") selectedIndex = Math.min(Math.max(0, rows.length - 1), selectedIndex + 1);
        else if (key === "up" || key === "k") selectedIndex = Math.max(0, selectedIndex - 1);
        else if (key === "enter") expandedPreview = !expandedPreview;
        else if (key === "/") { searchMode = true; query = ""; }
        else if (key === "f") { mode = mode === "active" ? "all" : mode === "all" ? "closed" : "active"; selectedIndex = 0; }
        else if (key === "-" && rows[selectedIndex]) collapsed.add(rows[selectedIndex]!.humanRef);
        else if (key === "+" && rows[selectedIndex]) collapsed.delete(rows[selectedIndex]!.humanRef);
        else continue;
        redraw = true;
      }
      if (redraw) draw();
    };
    process.stdin.on("data", onData);
  });
  process.stdout.write(`${ESC}?1049h${ESC}?25l`);
  draw();
  try {
    await done;
  } finally {
    try { process.stdin.setRawMode(false); } catch { /* terminal already gone */ }
    process.stdin.pause();
    process.stdout.write(`${ESC}?25h${ESC}?1049l`);
  }
  return { code: 0, stdout: "", stderr: "" };
}

export async function runUxCli(argv: string[], opts: UxOptions = {}): Promise<CliResult> {
  let parsed: WrapperArgs;
  try { parsed = parseWrapperArgs(argv); }
  catch (err) {
    const style = styleOptions({ base: argv, plain: false, noColor: false, all: false, flat: false, statuses: [], search: "" }, opts);
    return errorResult("sb", err instanceof Error ? err.message : String(err), style);
  }
  const style = styleOptions(parsed, opts);
  const command = commandOf(parsed.base);
  if (parsed.base.includes("--json")) {
    const humanOnly = humanOnlyFilters(parsed);
    if (humanOnly.length > 0) {
      return errorResult(
        command || "issue.list",
        `--json cannot apply ${humanOnly.join(", ")}: these are human-facing list filters (the JSON contract returns the unfiltered tree)`,
        style,
      );
    }
    return runCli(parsed.base);
  }
  const unknownStatus = parsed.statuses.find((s) => !isKnownStatusFilter(s));
  if (unknownStatus !== undefined) {
    return errorResult(
      command || "issue.list",
      `unknown --status value: ${unknownStatus} (want ${KNOWN_STATUS_FILTERS.join("|")})`,
      style,
    );
  }
  if (parsed.base.includes("--help") || parsed.base[0] === "help") {
    if (command === "issue.browse") return browseHelp();
    return uxHelp(runCli(parsed.base), parsed.base);
  }
  if (parsed.base[0] === "issue" && parsed.base[1] === "browse") return browse(parsed, style, opts);
  if (command === "issue.list") return renderList(parsed, style);
  if (command === "issue.show") return renderShow(parsed, style);
  if (!READ_ONLY.has(command) && command !== "") return mutationResult(parsed, style);
  const result = runCli(parsed.base);
  if (result.code !== 0) return errorResult(command, result.stderr.trim() || result.stdout.trim() || "operation failed", style);
  return result;
}

const invokedAsMain = (() => {
  try { return realpathSync(process.argv[1] ?? "") === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return false; }
})();
if (invokedAsMain) {
  const result = await runUxCli(process.argv.slice(2));
  const ignoreBrokenPipe = (err: Error): void => { if ((err as NodeJS.ErrnoException).code !== "EPIPE") throw err; };
  process.stdout.on("error", ignoreBrokenPipe);
  process.stderr.on("error", ignoreBrokenPipe);
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exitCode = result.code;
}
