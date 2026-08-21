// Shell context for XTS: reads the compact state file written by the silent
// shell hooks (history/hook.bash, history/hook.zsh) and redacts secrets from
// the recent-command list (PRD §9, §25).
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const MAX_RECENT_COMMANDS = 10;

// Base state directory: XTS_STATE_DIR overrides everything (used by tests),
// then $XDG_STATE_HOME, then ~/.local/state. The hooks compute the same base,
// so the state file is always <base>/xts/state.json.
function stateBaseDir() {
  return (
    process.env.XTS_STATE_DIR ??
    process.env.XDG_STATE_HOME ??
    path.join(os.homedir(), ".local", "state")
  );
}

export function getStatePath() {
  return path.join(stateBaseDir(), "xts", "state.json");
}

export function getCommandsPath() {
  return path.join(stateBaseDir(), "xts", "cmds.txt");
}

// Tolerant read: missing or corrupt file -> null, never throws. Shape is
// validated loosely: wrong-typed fields -> null, absent fields are allowed.
export async function readShellState() {
  let raw;
  try {
    raw = await readFile(getStatePath(), "utf8");
  } catch {
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return isValidState(parsed) ? parsed : null;
}

function isValidState(state) {
  if (state === null || typeof state !== "object" || Array.isArray(state)) return false;
  if (state.cwd !== undefined && typeof state.cwd !== "string") return false;
  if (state.shell !== undefined && typeof state.shell !== "string") return false;
  if (state.lastExitCode !== undefined && typeof state.lastExitCode !== "number") return false;
  if (state.recentCommands !== undefined) {
    if (!Array.isArray(state.recentCommands)) return false;
    if (state.recentCommands.some((c) => typeof c !== "string")) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Deterministic, conservative secret redaction (PRD §25). A command is
// replaced wholesale with "[redacted]" when it contains an obvious
// secret-bearing form. Normal commands pass through unchanged.

// KEY=value assignments where the key is an obvious secret name. No word
// boundary on the key on purpose: it must catch "AZURE_OPENAI_API_KEY=..." and
// "OPENAI_API_KEY=..." (the key sits inside a longer underscore name).
const KEY_VALUE_RE = /(?:token|tokens|password|passwd|api[_-]?key|secret|key)\s*=\s*(\S+)/i;
const FLAG_SECRET_RE = /(?:^|\s)(?:--password|-p)(?:=|\s+|(?=\S))\S+/i;
const BEARER_SECRET_RE = /(?:bearer|token)\s+[A-Za-z0-9._~+/=-]{8,}/i;
// Common inline env exports whose key hides the secret name behind
// underscores, so KEY_VALUE_RE does not see "secret=" directly.
const SECRET_VAR_RE =
  /(?:aws_secret_access_key|azure_openai_api_key|openai_api_key)\s*=\s*(\S+)/i;
const PEM_RE = /BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY|PRIVATE KEY BLOCK|-----BEGIN/i;
// Token prefixes. The \b keeps ordinary words ending in "sk" ("disk-usage",
// "mask-util") intact while still matching "sk-abc...", "ghp_...", etc.
const TOKEN_PREFIX_RE = /\b(?:github_pat_|ghp_|glpat-|sk-)\S+/i;

const TRAILING_PUNCT_RE = /["'`,;)]+$/;

function hasLongSecretValue(cmd) {
  const match = cmd.match(KEY_VALUE_RE) ?? cmd.match(SECRET_VAR_RE);
  if (!match) return false;
  return match[1].replace(TRAILING_PUNCT_RE, "").length >= 8;
}

export function redactCommand(cmd) {
  if (typeof cmd !== "string") return cmd;
  if (PEM_RE.test(cmd) || TOKEN_PREFIX_RE.test(cmd) || FLAG_SECRET_RE.test(cmd) || BEARER_SECRET_RE.test(cmd) || hasLongSecretValue(cmd)) {
    return "[redacted]";
  }
  return cmd;
}

export function redactCommands(cmds) {
  return cmds.map(redactCommand);
}

// ---------------------------------------------------------------------------

// Reads the hook state. With no state installed the context degrades to
// { cwd, shell: null, lastExitCode: null, recentCommands: [], source: null }
// (PRD §21: XTS still works without the shell integration).
export async function loadShellContext() {
  const state = await readShellState();
  if (state === null) {
    return {
      cwd: process.cwd(),
      shell: null,
      lastExitCode: null,
      recentCommands: [],
      source: null,
    };
  }
  return {
    cwd: state.cwd ?? process.cwd(),
    shell: state.shell ?? null,
    lastExitCode: state.lastExitCode ?? null,
    recentCommands: redactCommands(state.recentCommands ?? []),
    source: "hook",
  };
}

// Compact one-block rendering for the model prompt envelope. Absent fields
// are omitted; the recent-command header shows the actual count.
export function formatShellContext(ctx) {
  const lines = [`cwd: ${ctx.cwd}`];
  if (ctx.shell) lines.push(`shell: ${ctx.shell}`);
  if (ctx.lastExitCode !== null && ctx.lastExitCode !== undefined) {
    lines.push(`last exit code: ${ctx.lastExitCode}`);
  }
  if (ctx.recentCommands.length > 0) {
    lines.push(`recent commands (last ${ctx.recentCommands.length}):`);
    for (const cmd of ctx.recentCommands) lines.push(`  ${cmd}`);
  } else {
    lines.push("recent commands: none available");
  }
  return lines.join("\n");
}
