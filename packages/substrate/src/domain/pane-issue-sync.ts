// CORE-2801: keep the tmux pane's `@agent_issue` in step with the Issue its agent holds.
//
// `sb issue claim|release|close|cancel` is the one place that knows an agent took
// or dropped an Issue. After the operation succeeds, this module updates the pane
// the process runs in, and only that pane, and only when the operation was made
// by the pane's owner: the pane's `@agent_holder` (written by the xt launcher)
// must equal the holder of the operation. An in-process specialist (another
// SUBSTRATE_HOLDER) or a claim made on behalf of another holder never changes the
// pane. The schema is documented in core `docs/agent-identity.md`.
//
// It runs in the client process, after the result is known, so it does not
// depend on the Substrate remote. Every failure is logged and swallowed.

import { appendFileSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { BOOLEAN_FLAGS } from "./argv.ts";

const PANE_ID = /^%[0-9]+$/;
const SAFE_REF = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const PANE_VERBS = new Set(["claim", "release", "close", "cancel"]);
const TMUX_TIMEOUT_MS = 2_000;

export type TmuxRunner = (args: string[]) => { status: number | null; stdout: string };

export interface PaneSyncDeps {
  env?: NodeJS.ProcessEnv;
  tmux?: TmuxRunner;
  log?: (line: string) => void;
}

export interface PaneSyncRequest {
  verb: "claim" | "release" | "close" | "cancel";
  ref: string;
  /** `--holder`, else null. */
  holder: string | null;
}

/** The pane operation an `sb` argv asks for, or null when it is not a claim-state verb. */
export function parsePaneSyncRequest(argv: readonly string[]): PaneSyncRequest | null {
  const at = argv.indexOf("issue");
  if (at < 0) return null;
  const verb = argv[at + 1];
  if (!verb || !PANE_VERBS.has(verb)) return null;
  let ref: string | null = null;
  let holder: string | null = null;
  const rest = argv.slice(at + 2);
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i] as string;
    if (token === "--holder") {
      holder = (rest[i + 1] ?? "").trim() || null;
      i += 1;
    } else if (token.startsWith("--holder=")) {
      holder = token.slice("--holder=".length).trim() || null;
    } else if (token.startsWith("--")) {
      // Same rule as parseArgs: a non-boolean flag consumes the next token as its value.
      const key = token.slice(2);
      const next = rest[i + 1];
      if (!token.includes("=") && !BOOLEAN_FLAGS.has(key) && next !== undefined && !next.startsWith("--")) i += 1;
    } else if (ref === null) {
      ref = token;
    }
  }
  if (!ref || !SAFE_REF.test(ref)) return null;
  return { verb: verb as PaneSyncRequest["verb"], ref, holder };
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
    const pane = (env.TMUX_PANE ?? "").trim();
    if (!env.TMUX || !PANE_ID.test(pane)) return "skipped";
    const actor = request.holder ?? (env.SUBSTRATE_HOLDER ?? "").trim();
    if (!actor) return "skipped";
    const tmux = deps.tmux ?? tmuxIn(env);
    const read = (option: string): string | null => {
      const result = tmux(["show-options", "-p", "-t", pane, "-qv", option]);
      return result.status === 0 ? result.stdout.trim() : null;
    };
    const owner = read("@agent_holder");
    if (owner === null) {
      log(`skip ${request.verb} ${request.ref}: pane ${pane} unreadable`);
      return "failed";
    }
    // No owner (a pane launched before CORE-2801) or another owner: not this pane's claim.
    if (owner === "" || owner !== actor) return "skipped";
    if (request.verb === "claim") {
      const set = tmux(["set-option", "-p", "-t", pane, "@agent_issue", request.ref]);
      if (set.status !== 0) { log(`claim ${request.ref}: set @agent_issue on ${pane} failed`); return "failed"; }
      return "updated";
    }
    // release, close, cancel: clear only the Issue this operation ended.
    const current = read("@agent_issue");
    if (current === null) { log(`${request.verb} ${request.ref}: read @agent_issue on ${pane} failed`); return "failed"; }
    if (current.toLowerCase() !== request.ref.toLowerCase()) return "skipped";
    const cleared = tmux(["set-option", "-p", "-t", pane, "@agent_issue", ""]);
    if (cleared.status !== 0) { log(`${request.verb} ${request.ref}: clear @agent_issue on ${pane} failed`); return "failed"; }
    return "updated";
  } catch (error) {
    try { log(`pane sync error: ${error instanceof Error ? error.message : String(error)}`); } catch { /* ignore */ }
    return "failed";
  }
}
