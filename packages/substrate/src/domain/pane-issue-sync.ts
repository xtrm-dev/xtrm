// CORE-2801: keep the tmux pane's `@agent_issue` in step with the Issue its agent holds.
//
// `sb issue claim` and every transition that ends a hold (`release`, `close`,
// `cancel`, `state <ref> done|cancelled`) go through `runCli`, the one dispatch
// the shipped bin (`cli/sb-ux.ts`) and `cli/sb.ts` share. After the operation
// succeeds, this module updates panes:
//
// - claim: the pane the process runs in, and only when the pane's `@agent_holder`
//   (written by the xt launcher) equals the operation's holder. An in-process
//   specialist (another SUBSTRATE_HOLDER) or a claim made on behalf of another
//   holder never changes the pane.
// - end of a hold: EVERY pane of the tmux server whose `@agent_issue` equals the
//   ref is unset, whoever ended the hold. A lead that closes a worker's Issue
//   must not leave the worker pane advertising it. Unset, not empty: absent means
//   none.
//
// Scope is the tmux server this process runs under; another server or host is not reached
// (cross-host sync is XTRM-1077). The schema is documented in core `docs/agent-identity.md`.
//
// It runs in the client process, after the result is known, so it does not
// depend on the Substrate remote. Every failure is logged and swallowed.

import { appendFileSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { parseArgs } from "./argv.ts";
import { TERMINAL_STATES } from "./issue.ts";

const PANE_ID = /^%[0-9]+$/;
const SAFE_REF = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
// `archive` is the alias of `state <ref> archived`.
const END_VERBS = new Set(["release", "close", "cancel", "archive"]);
const TMUX_TIMEOUT_MS = 2_000;

export type TmuxRunner = (args: string[]) => { status: number | null; stdout: string };

export interface PaneSyncDeps {
  env?: NodeJS.ProcessEnv;
  tmux?: TmuxRunner;
  log?: (line: string) => void;
}

export interface PaneSyncRequest {
  /** `claim` takes the pane; `end` clears every pane that holds the ref. */
  effect: "claim" | "end";
  ref: string;
  /** `--holder`, else null. */
  holder: string | null;
}

/**
 * The pane effect of an `sb` argv, or null when the command does not change who
 * holds an Issue. A terminal lifecycle state (`state <ref> done|cancelled`) ends
 * a hold exactly like `close`.
 */
export function parsePaneSyncRequest(argv: readonly string[]): PaneSyncRequest | null {
  const { flags, positionals } = parseArgs([...argv]);
  const [group, verb, ref, target] = positionals;
  if (group !== "issue" || !verb || !ref || !SAFE_REF.test(ref)) return null;
  const holderFlag = flags.get("holder");
  const holder = Array.isArray(holderFlag) ? (holderFlag[0] ?? "").trim() || null : null;
  if (verb === "claim") return { effect: "claim", ref, holder };
  if (END_VERBS.has(verb)) return { effect: "end", ref, holder };
  if (verb === "state" && target && (TERMINAL_STATES as readonly string[]).includes(target.toLowerCase())) return { effect: "end", ref, holder };
  return null;
}

// The environment is handed to tmux explicitly: it is the one the caller read $TMUX from.
const tmuxIn = (env: NodeJS.ProcessEnv): TmuxRunner => (args) => {
  const result = spawnSync("tmux", args, { env, encoding: "utf8", stdio: "pipe", timeout: TMUX_TIMEOUT_MS, killSignal: "SIGKILL" });
  return { status: result.status, stdout: String(result.stdout ?? "") };
};

function defaultLog(line: string): void {
  try {
    const base = process.env.XDG_STATE_HOME || join(homedir(), ".local", "state");
    const file = join(base, "xtrm", "pane-sync.log");
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, `${new Date().toISOString()} ${line}\n`);
  } catch { /* a log that cannot be written is not an error */ }
}

function clearHeldPanes(request: PaneSyncRequest, tmux: TmuxRunner, log: (line: string) => void): PaneSyncOutcome {
  const listing = tmux(["list-panes", "-a", "-F", "#{pane_id}\t#{@agent_issue}"]);
  if (listing.status !== 0) { log(`end ${request.ref}: list-panes failed`); return "failed"; }
  let outcome: PaneSyncOutcome = "skipped";
  for (const line of listing.stdout.split("\n")) {
    const [pane = "", issue = ""] = line.split("\t");
    if (!PANE_ID.test(pane) || issue.trim().toLowerCase() !== request.ref.toLowerCase()) continue;
    const cleared = tmux(["set-option", "-p", "-u", "-t", pane, "@agent_issue"]);
    if (cleared.status !== 0) { log(`end ${request.ref}: unset @agent_issue on ${pane} failed`); outcome = "failed"; }
    else { log(`end ${request.ref}: unset @agent_issue on ${pane}`); if (outcome !== "failed") outcome = "updated"; }
  }
  return outcome;
}

export type PaneSyncOutcome = "updated" | "skipped" | "failed";

/**
 * Apply one successful claim-state operation to the pane this process runs in.
 * Never throws: the operation already succeeded and must keep its exit status.
 */
export function syncPaneIssue(argv: readonly string[], deps: PaneSyncDeps = {}): PaneSyncOutcome {
  const env = deps.env ?? process.env;
  const log = deps.log ?? defaultLog;
  try {
    const request = parsePaneSyncRequest(argv);
    if (!request) return "skipped";
    // TMUX proves a server to ask; TMUX_PANE alone could be a leftover variable.
    if (!env.TMUX) {
      // Scope: the tmux server of THIS process only. Panes on another server or host are not reached.
      log(`skip ${request.effect} ${request.ref}: TMUX unset, no tmux server in scope`);
      return "skipped";
    }
    const tmux = deps.tmux ?? tmuxIn(env);
    if (request.effect === "end") return clearHeldPanes(request, tmux, log);
    const pane = (env.TMUX_PANE ?? "").trim();
    if (!PANE_ID.test(pane)) return "skipped";
    const actor = request.holder ?? (env.SUBSTRATE_HOLDER ?? "").trim();
    if (!actor) return "skipped";
    const read = tmux(["show-options", "-p", "-t", pane, "-qv", "@agent_holder"]);
    if (read.status !== 0) {
      log(`skip claim ${request.ref}: pane ${pane} unreadable`);
      return "failed";
    }
    const owner = read.stdout.trim();
    // No owner (a pane launched before CORE-2801) or another owner: not this pane's claim.
    if (owner === "" || owner !== actor) return "skipped";
    const set = tmux(["set-option", "-p", "-t", pane, "@agent_issue", request.ref]);
    if (set.status !== 0) { log(`claim ${request.ref}: set @agent_issue on ${pane} failed`); return "failed"; }
    return "updated";
  } catch (error) {
    try { log(`pane sync error: ${error instanceof Error ? error.message : String(error)}`); } catch { /* ignore */ }
    return "failed";
  }
}
